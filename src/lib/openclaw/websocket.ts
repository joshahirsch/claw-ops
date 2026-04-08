import { getConfig } from './config';
import type { OpenClawMessage, OpenClawSession } from './types';

type SessionMessageHandler = (sessionKey: string, message: OpenClawMessage) => void;
type SessionChangedHandler = (session: Partial<OpenClawSession> & { sessionKey: string }) => void;

interface OpenClawWSOptions {
  onSessionMessage?: SessionMessageHandler;
  onSessionChanged?: SessionChangedHandler;
  onError?: (err: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onAuthRejected?: (status: string, detail: string) => void;
  onScopeLimited?: (scopes: string) => void;
}

/**
 * WebSocket client for OpenClaw real-time events.
 *
 * Auth is applied at connection time:
 *   - token passed as query parameter `?token=...`
 *   - also sent as first JSON-RPC `auth.authenticate` message after connect
 *
 * Subscribes to `sessions.subscribe` and `sessions.messages.subscribe`.
 * Receives `session.message` and `sessions.changed` events.
 */
export class OpenClawWebSocket {
  private ws: WebSocket | null = null;
  private opts: OpenClawWSOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribedKeys = new Set<string>();
  private disposed = false;
  private msgId = 0;
  private authAccepted = false;
  private consecutiveFailures = 0;

  constructor(opts: OpenClawWSOptions) {
    this.opts = opts;
  }

  get isAuthenticated(): boolean {
    return this.authAccepted;
  }

  connect(): void {
    if (this.disposed) return;
    const { wsUrl, authMode, authToken } = getConfig();

    if (!wsUrl || !(wsUrl.startsWith('ws://') || wsUrl.startsWith('wss://'))) {
      console.warn('[OpenClaw WS] skipped — invalid wsUrl:', wsUrl);
      return;
    }

    // Build connection URL with auth token as query param
    let connectionUrl = wsUrl;
    if (authMode !== 'none' && authToken) {
      const separator = wsUrl.includes('?') ? '&' : '?';
      connectionUrl = `${wsUrl}${separator}token=${encodeURIComponent(authToken)}`;
    }

    try {
      this.ws = new WebSocket(connectionUrl);
    } catch (e) {
      this.opts.onError?.(e instanceof Error ? e : new Error(String(e)));
      this.scheduleReconnect();
      return;
    }

    this.authAccepted = false;

    this.ws.onopen = () => {
      this.consecutiveFailures = 0;
      this.opts.onConnect?.();

      // Send auth message as first action
      this.sendAuthMessage();

      // Re-subscribe to all tracked keys
      this.subscribedKeys.forEach((key) => this.sendSubscribe(key));
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleEvent(data);
      } catch (e) {
        this.opts.onError?.(e instanceof Error ? e : new Error('WS parse error'));
      }
    };

    this.ws.onerror = () => {
      this.opts.onError?.(new Error('WebSocket connection error'));
    };

    this.ws.onclose = (event) => {
      // Detect auth rejection from close codes
      if (event.code === 4401 || event.code === 4403 || event.code === 1008) {
        const detail = event.reason || `WebSocket closed with code ${event.code}`;
        this.opts.onAuthRejected?.(String(event.code), detail);
        // Don't reconnect on auth rejection — it'll keep failing
        this.opts.onDisconnect?.();
        return;
      }

      this.opts.onDisconnect?.();
      if (!this.disposed) this.scheduleReconnect();
    };
  }

  subscribeSession(sessionKey: string): void {
    this.subscribedKeys.add(sessionKey);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(sessionKey);
    }
  }

  unsubscribeSession(sessionKey: string): void {
    this.subscribedKeys.delete(sessionKey);
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.subscribedKeys.clear();
  }

  /**
   * Send an auth message after WebSocket opens.
   * OpenClaw may expect this as a JSON-RPC call.
   */
  private sendAuthMessage(): void {
    const { authMode, authToken } = getConfig();
    if (authMode === 'none' || !authToken) return;

    this.send({
      jsonrpc: '2.0',
      id: ++this.msgId,
      method: 'auth.authenticate',
      params: { token: authToken },
    });
  }

  private sendSubscribe(sessionKey: string): void {
    this.send({
      jsonrpc: '2.0',
      id: ++this.msgId,
      method: 'sessions.messages.subscribe',
      params: { key: sessionKey },
    });
    this.send({
      jsonrpc: '2.0',
      id: ++this.msgId,
      method: 'sessions.subscribe',
      params: {},
    });
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private handleEvent(data: Record<string, unknown>): void {
    const method = data.method as string | undefined;

    // Handle auth response
    if (data.id && data.result !== undefined) {
      const result = data.result as Record<string, unknown> | null;
      if (result && typeof result === 'object') {
        if (result.authenticated === true) {
          this.authAccepted = true;
        }
        if (result.error === 'unauthorized' || result.error === 'forbidden') {
          const scopes = typeof result.requiredScopes === 'string' ? result.requiredScopes : '';
          this.opts.onAuthRejected?.(String(result.error), scopes);
        }
        if (result.scopeLimited === true || (typeof result.missingScopes === 'string')) {
          this.opts.onScopeLimited?.(String(result.missingScopes || ''));
        }
      }
      return;
    }

    // Handle JSON-RPC error responses
    if (data.id && data.error !== undefined) {
      const err = data.error as Record<string, unknown>;
      const code = err.code as number | undefined;
      const message = (err.message as string) || 'Unknown error';

      if (code === -32000 || message.toLowerCase().includes('unauthorized')) {
        this.opts.onAuthRejected?.('rpc-error', message);
      } else if (message.toLowerCase().includes('scope')) {
        this.opts.onScopeLimited?.(message);
      } else {
        this.opts.onError?.(new Error(`WS RPC error: ${message}`));
      }
      return;
    }

    if (method === 'session.message') {
      const params = data.params as { key?: string; message?: OpenClawMessage } | undefined;
      if (params?.key && params?.message) {
        this.opts.onSessionMessage?.(params.key, params.message);
      }
    } else if (method === 'sessions.changed') {
      const params = data.params as (Partial<OpenClawSession> & { sessionKey: string }) | undefined;
      if (params?.sessionKey) {
        this.opts.onSessionChanged?.(params);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.consecutiveFailures += 1;
    // Exponential backoff: 3s, 6s, 12s, max 30s
    const delay = Math.min(3000 * Math.pow(2, this.consecutiveFailures - 1), 30000);
    this.reconnectTimer = setTimeout(() => {
      if (!this.disposed) this.connect();
    }, delay);
  }
}

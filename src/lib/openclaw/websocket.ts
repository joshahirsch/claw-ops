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
}

/**
 * WebSocket client for OpenClaw real-time events.
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

  constructor(opts: OpenClawWSOptions) {
    this.opts = opts;
  }

  connect(): void {
    if (this.disposed) return;
    const { wsUrl } = getConfig();
    try {
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      this.opts.onError?.(e instanceof Error ? e : new Error(String(e)));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.opts.onConnect?.();
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

    this.ws.onclose = () => {
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
    // Optionally send unsubscribe — depends on OpenClaw protocol
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.subscribedKeys.clear();
  }

  private sendSubscribe(sessionKey: string): void {
    this.send({
      jsonrpc: '2.0',
      id: ++this.msgId,
      method: 'sessions.messages.subscribe',
      params: { key: sessionKey },
    });
    // Also subscribe to session-level changes
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
    this.reconnectTimer = setTimeout(() => {
      if (!this.disposed) this.connect();
    }, 3000);
  }
}

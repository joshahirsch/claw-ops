import { getConfig } from './config';
import type { OpenClawSession, OpenClawMessage } from './types';

/**
 * Build the proxy function URL for the openclaw-proxy edge function.
 */
function proxyUrl(params: Record<string, string>): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const base = `${supabaseUrl}/functions/v1/openclaw-proxy`;
  const search = new URLSearchParams(params);
  return `${base}?${search}`;
}

/**
 * Build proxy headers that pass OpenClaw config to the edge function.
 */
function proxyHeaders(): Record<string, string> {
  const config = getConfig();
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  return {
    'Content-Type': 'application/json',
    'apikey': anonKey,
    'x-openclaw-base-url': config.baseUrl,
    'x-openclaw-auth-mode': config.authMode,
    'x-openclaw-auth-token': config.authToken,
    'x-openclaw-auth-header-name': config.authHeaderName,
    'x-openclaw-auth-header-prefix': config.authHeaderPrefix,
  };
}

/**
 * Classify an error into a specific label instead of generic "Failed to fetch".
 */
function classifyError(e: unknown): string {
  if (e instanceof TypeError && (e as TypeError).message === 'Failed to fetch') {
    return 'Network error — could not reach the proxy. Check CORS or connectivity.';
  }
  if (e instanceof DOMException && e.name === 'AbortError') {
    return 'Request timed out';
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Fetch session history via the proxy edge function.
 */
export async function fetchSessionHistory(
  sessionKey: string,
  opts?: { limit?: number; cursor?: string; includeTools?: boolean }
): Promise<OpenClawSession> {
  const params: Record<string, string> = { sessionKey };
  if (opts?.limit) params.limit = String(opts.limit);
  if (opts?.cursor) params.cursor = opts.cursor;
  if (opts?.includeTools) params.includeTools = '1';

  const res = await fetch(proxyUrl(params), { headers: proxyHeaders() });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.error || body.errorLabel || `${res.status} ${res.statusText}`;
    throw new Error(detail);
  }
  return res.json();
}

/**
 * Fetch multiple sessions in parallel via the proxy.
 */
export async function fetchAllSessions(
  sessionKeys: string[],
  opts?: { includeTools?: boolean }
): Promise<OpenClawSession[]> {
  const results = await Promise.allSettled(
    sessionKeys.map((key) => fetchSessionHistory(key, { includeTools: opts?.includeTools ?? true }))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<OpenClawSession> => r.status === 'fulfilled')
    .map((r) => r.value);
}

/**
 * Subscribe to live session updates via SSE through the proxy.
 */
export function subscribeSessionSSE(
  sessionKey: string,
  onMessage: (msg: OpenClawMessage) => void,
  onError?: (err: Error) => void
): AbortController {
  const controller = new AbortController();
  const url = proxyUrl({ sessionKey, follow: '1', includeTools: '1' });

  const connect = async () => {
    try {
      const res = await fetch(url, {
        headers: proxyHeaders(),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        onError?.(new Error(body.error || body.errorLabel || `SSE proxy error: ${res.status}`));
        if (!controller.signal.aborted) {
          setTimeout(() => { if (!controller.signal.aborted) connect(); }, 5000);
        }
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as OpenClawMessage;
              onMessage(data);
            } catch {
              // Skip non-JSON SSE lines
            }
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        onError?.(new Error(classifyError(e)));
        setTimeout(() => { if (!controller.signal.aborted) connect(); }, 5000);
      }
    }
  };

  connect();
  return controller;
}

// ─── Probe / Diagnostic types ────────────────────────────────────────

export interface ProbeResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  errorLabel?: string | null;
  endpoint?: string;
  encodedPath?: string;
  authApplied?: boolean;
  authMode?: string;
  latencyMs?: number;
  failurePoint?: string;
  bodySnippet?: string;
  parsedBody?: unknown;
  diagnostics?: Record<string, unknown>;
  // client-side meta
  proxyUrl?: string;
  sessionKeyRaw?: string;
  sessionKeyEncoded?: string;
  clientError?: string;
  clientErrorType?: string;
}

/**
 * Run a basic probe (no SSE) through the proxy.
 */
export async function runBasicProbe(sessionKey: string): Promise<ProbeResult> {
  const start = performance.now();
  const url = proxyUrl({ sessionKey, probe: 'basic' });
  try {
    const res = await fetch(url, {
      headers: proxyHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    const latency = Math.round(performance.now() - start);
    const body = await res.json().catch(() => ({}));
    return {
      ...body,
      latencyMs: body.latencyMs ?? latency,
      proxyUrl: url,
      sessionKeyRaw: sessionKey,
      sessionKeyEncoded: encodeURIComponent(sessionKey),
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      proxyUrl: url,
      sessionKeyRaw: sessionKey,
      sessionKeyEncoded: encodeURIComponent(sessionKey),
      clientError: classifyError(e),
      clientErrorType: e instanceof TypeError ? 'network' : e instanceof DOMException ? 'timeout' : 'unknown',
    };
  }
}

/**
 * Run an SSE probe through the proxy (tests follow=1 initialization).
 */
export async function runSSEProbe(sessionKey: string): Promise<ProbeResult> {
  const start = performance.now();
  const url = proxyUrl({ sessionKey, probe: 'sse' });
  try {
    const res = await fetch(url, {
      headers: proxyHeaders(),
      signal: AbortSignal.timeout(12000),
    });
    const latency = Math.round(performance.now() - start);
    const body = await res.json().catch(() => ({}));
    return {
      ...body,
      latencyMs: body.latencyMs ?? latency,
      proxyUrl: url,
      sessionKeyRaw: sessionKey,
      sessionKeyEncoded: encodeURIComponent(sessionKey),
      failurePoint: body.failurePoint ?? 'sse_stream_init',
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      proxyUrl: url,
      sessionKeyRaw: sessionKey,
      sessionKeyEncoded: encodeURIComponent(sessionKey),
      clientError: classifyError(e),
      clientErrorType: e instanceof TypeError ? 'network' : e instanceof DOMException ? 'timeout' : 'unknown',
      failurePoint: 'sse_stream_init',
    };
  }
}

/**
 * Legacy test connection (wraps basic probe).
 */
export async function testConnection(): Promise<ProbeResult> {
  const config = getConfig();
  return runBasicProbe(config.sessionKeys[0] || 'test');
}

/**
 * Send a prompt to OpenClaw via POST /v1/responses through the proxy.
 */
export async function sendPrompt(
  prompt: string,
  opts?: { sessionKey?: string }
): Promise<unknown> {
  const config = getConfig();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.sessionKey) headers['x-openclaw-session-key'] = opts.sessionKey;

  const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input: prompt }),
  });
  if (!res.ok) throw new Error(`OpenClaw: ${res.status} ${res.statusText}`);
  return res.json();
}

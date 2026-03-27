import { getConfig } from './config';
import { supabase } from '@/integrations/supabase/client';
import type { OpenClawSession, OpenClawMessage } from './types';

/**
 * Build the proxy function URL for the openclaw-proxy edge function.
 */
function proxyUrl(params: Record<string, string>): string {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const base = `https://${projectId}.supabase.co/functions/v1/openclaw-proxy`;
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
    const detail = body.error || `${res.status} ${res.statusText}`;
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
        onError?.(new Error(body.error || `SSE proxy error: ${res.status}`));
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
            } catch (e) {
              // Skip non-JSON SSE lines
            }
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
        setTimeout(() => { if (!controller.signal.aborted) connect(); }, 5000);
      }
    }
  };

  connect();
  return controller;
}

export interface TestConnectionResult {
  ok: boolean;
  latency: number;
  status?: number;
  statusText?: string;
  endpoint?: string;
  authApplied?: boolean;
  authMode?: string;
  bodySnippet?: string;
  error?: string;
}

/**
 * Test connectivity via the proxy edge function.
 */
export async function testConnection(): Promise<TestConnectionResult> {
  const config = getConfig();
  const start = performance.now();

  try {
    const res = await fetch(
      proxyUrl({ sessionKey: config.sessionKeys[0] || 'test', test: '1' }),
      {
        headers: proxyHeaders(),
        signal: AbortSignal.timeout(8000),
      }
    );

    const latency = Math.round(performance.now() - start);
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        latency,
        status: body.status || res.status,
        statusText: body.statusText || res.statusText,
        endpoint: body.endpoint,
        authApplied: body.authApplied,
        authMode: body.authMode,
        bodySnippet: body.bodySnippet || body.error,
        error: body.error || `HTTP ${res.status}`,
      };
    }

    // Proxy returns diagnostic info in test mode
    const upstreamOk = body.status >= 200 && body.status < 400;
    return {
      ok: upstreamOk,
      latency,
      status: body.status,
      statusText: body.statusText,
      endpoint: body.endpoint,
      authApplied: body.authApplied,
      authMode: body.authMode,
      bodySnippet: body.bodySnippet,
      error: upstreamOk ? undefined : `Upstream returned ${body.status}: ${body.bodySnippet?.slice(0, 100)}`,
    };
  } catch (e) {
    return {
      ok: false,
      latency: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message : 'Connection failed',
    };
  }
}

/**
 * Send a prompt to OpenClaw via POST /v1/responses through the proxy.
 */
export async function sendPrompt(
  prompt: string,
  opts?: { sessionKey?: string }
): Promise<unknown> {
  // For now, POST goes direct — can be proxied later if needed
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

import { getConfig } from './config';
import type { OpenClawSession, OpenClawMessage } from './types';

function baseUrl(): string {
  return getConfig().baseUrl.replace(/\/+$/, '');
}

/**
 * Fetch session history via GET /sessions/{sessionKey}/history
 */
export async function fetchSessionHistory(
  sessionKey: string,
  opts?: { limit?: number; cursor?: string; includeTools?: boolean }
): Promise<OpenClawSession> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.includeTools) params.set('includeTools', '1');

  const url = `${baseUrl()}/sessions/${sessionKey}/history?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenClaw: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Fetch multiple sessions in parallel.
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
 * Subscribe to live session updates via SSE (follow=1).
 * Returns an AbortController to cancel the stream.
 */
export function subscribeSessionSSE(
  sessionKey: string,
  onMessage: (msg: OpenClawMessage) => void,
  onError?: (err: Error) => void
): AbortController {
  const controller = new AbortController();
  const url = `${baseUrl()}/sessions/${sessionKey}/history?follow=1&includeTools=1`;

  const connect = () => {
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as OpenClawMessage;
        onMessage(data);
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      if (!controller.signal.aborted) {
        setTimeout(() => {
          if (!controller.signal.aborted) connect();
        }, 3000);
      }
    };

    controller.signal.addEventListener('abort', () => eventSource.close());
  };

  connect();
  return controller;
}

/**
 * Test connectivity to the OpenClaw instance.
 */
export async function testConnection(): Promise<{ ok: boolean; latency: number; error?: string }> {
  const start = performance.now();
  try {
    const res = await fetch(`${baseUrl()}/sessions/test/history?limit=0`, {
      signal: AbortSignal.timeout(5000),
    });
    const latency = Math.round(performance.now() - start);
    return { ok: res.ok || res.status === 404, latency };
  } catch (e) {
    return {
      ok: false,
      latency: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message : 'Connection failed',
    };
  }
}

/**
 * Send a prompt to OpenClaw via POST /v1/responses.
 */
export async function sendPrompt(
  prompt: string,
  opts?: { sessionKey?: string }
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.sessionKey) headers['x-openclaw-session-key'] = opts.sessionKey;

  const res = await fetch(`${baseUrl()}/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input: prompt }),
  });
  if (!res.ok) throw new Error(`OpenClaw: ${res.status} ${res.statusText}`);
  return res.json();
}

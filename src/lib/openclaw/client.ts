import { getConfig } from './config';
import type { OpenClawSession, OpenClawMessage } from './types';

interface ProxyRequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Build the proxy function URL for the openclaw-proxy edge function.
 */
function proxyUrl(params: Record<string, string> = {}): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const base = `${supabaseUrl}/functions/v1/openclaw-proxy`;
  const search = new URLSearchParams(params);
  const query = search.toString();
  return query ? `${base}?${query}` : base;
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

function browserHeaders(method: 'GET' | 'POST', includeBody: boolean): Record<string, string> {
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  return includeBody
    ? {
        'apikey': anonKey,
        'Content-Type': 'application/json',
      }
    : {
        'apikey': anonKey,
      };
}

function labelFromStatus(status?: number): string | undefined {
  if (status === undefined) return undefined;
  if (status === 401) return '401 Unauthorized';
  if (status === 403) return '403 Forbidden';
  if (status === 404) return '404 Not Found';
  if (status === 422) return '422 Invalid session key/path';
  if (status >= 500) return '5xx Proxy or upstream error';
  return undefined;
}

/**
 * Classify an error into a specific label instead of generic "Failed to fetch".
 */
function classifyError(e: unknown): { message: string; type: string } {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return { message: 'network timeout', type: 'timeout' };
  }

  if (e instanceof TypeError) {
    return { message: 'function unreachable or CORS blocked', type: 'network_or_cors' };
  }

  if (e instanceof Error) {
    const lowered = e.message.toLowerCase();
    if (lowered.includes('timeout') || lowered.includes('abort')) {
      return { message: 'network timeout', type: 'timeout' };
    }
    return { message: e.message, type: 'exception' };
  }

  return { message: String(e), type: 'unknown' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeMessage(raw: unknown, index: number): OpenClawMessage | null {
  if (!isRecord(raw)) return null;

  const role =
    raw.role === 'user' || raw.role === 'assistant' || raw.role === 'toolResult'
      ? raw.role
      : 'assistant';

  const type =
    raw.type === 'message' ||
    raw.type === 'custom_message' ||
    raw.type === 'custom' ||
    raw.type === 'compaction' ||
    raw.type === 'branch_summary' ||
    raw.type === 'session_header'
      ? raw.type
      : 'message';

  const timestamp =
    typeof raw.timestamp === 'string' && raw.timestamp.trim()
      ? raw.timestamp
      : new Date().toISOString();

  const content =
    typeof raw.content === 'string' || isRecord(raw.content)
      ? raw.content
      : '';

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `msg-${index}-${crypto.randomUUID()}`,
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    type,
    role,
    content,
    timestamp,
    toolName: typeof raw.toolName === 'string' ? raw.toolName : undefined,
    toolInput: isRecord(raw.toolInput) ? raw.toolInput : undefined,
    toolOutput: typeof raw.toolOutput === 'string' ? raw.toolOutput : undefined,
  };
}

function normalizeSession(raw: unknown): OpenClawSession | null {
  if (!isRecord(raw)) return null;

  const sessionKey = typeof raw.sessionKey === 'string' ? raw.sessionKey.trim() : '';
  if (!sessionKey) return null;

  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map((message, index) => normalizeMessage(message, index))
        .filter((message): message is OpenClawMessage => message !== null)
    : [];

  const statusRecord = isRecord(raw.status) ? raw.status : null;
  const phase =
    statusRecord?.phase === 'idle' || statusRecord?.phase === 'running' || statusRecord?.phase === 'waiting'
      ? statusRecord.phase
      : 'idle';

  const updatedAt =
    typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
      ? raw.updatedAt
      : messages[messages.length - 1]?.timestamp || new Date().toISOString();

  return {
    sessionKey,
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId : sessionKey,
    updatedAt,
    messages,
    status: {
      phase,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
      },
    },
  };
}

function buildProbePayload(probe: 'basic' | 'sse') {
  const config = getConfig();
  return {
    probe,
    baseUrl: config.baseUrl,
    sessionKey: config.sessionKeys[0] || 'test',
    authMode: config.authMode,
    authToken: config.authToken,
    authHeaderName: config.authHeaderName,
    authHeaderPrefix: config.authHeaderPrefix,
  };
}

function normalizeProbeResult(
  response: Response,
  requestUrl: string,
  requestMethod: 'GET' | 'POST',
  requestHeadersSent: Record<string, string>,
  rawText: string,
  parsedBody: Record<string, unknown> | null,
  fallbackFailurePoint: string,
  startedAt: number
): ProbeResult {
  const upstreamStatus = typeof parsedBody?.upstreamStatus === 'number'
    ? parsedBody.upstreamStatus
    : typeof parsedBody?.status === 'number'
      ? parsedBody.status
      : undefined;

  const latency = Math.round(performance.now() - startedAt);

  return {
    ...(parsedBody ?? {}),
    ok: typeof parsedBody?.ok === 'boolean' ? parsedBody.ok : response.ok,
    proxyUrl: requestUrl,
    endpoint: typeof parsedBody?.upstreamUrl === 'string'
      ? parsedBody.upstreamUrl
      : typeof parsedBody?.endpoint === 'string'
        ? parsedBody.endpoint
        : undefined,
    requestMethod,
    requestHeadersSent,
    proxyHttpStatus: response.status,
    proxyStatusText: response.statusText,
    upstreamStatus,
    status: upstreamStatus,
    statusText: typeof parsedBody?.statusText === 'string' ? parsedBody.statusText : undefined,
    latencyMs: typeof parsedBody?.latencyMs === 'number' ? parsedBody.latencyMs : latency,
    failurePoint: typeof parsedBody?.failurePoint === 'string' ? parsedBody.failurePoint : fallbackFailurePoint,
    bodySnippet: typeof parsedBody?.bodySnippet === 'string' ? parsedBody.bodySnippet : rawText.slice(0, 500),
    parsedBody: parsedBody?.parsedBody ?? parsedBody ?? undefined,
    errorLabel:
      (typeof parsedBody?.errorLabel === 'string' && parsedBody.errorLabel) ||
      (typeof parsedBody?.message === 'string' && parsedBody.message) ||
      labelFromStatus(upstreamStatus) ||
      labelFromStatus(response.status),
    clientError:
      typeof parsedBody?.message === 'string' && !parsedBody.ok
        ? parsedBody.message
        : !response.ok
          ? `Function returned ${response.status}`
          : undefined,
    clientErrorType:
      typeof parsedBody?.errorType === 'string'
        ? parsedBody.errorType
        : !response.ok
          ? response.status === 401
            ? 'function_unauthorized'
            : response.status === 403
              ? 'function_forbidden'
              : response.status >= 500
                ? 'function_exception'
                : 'function_error'
          : undefined,
    rawErrorObject: parsedBody?.rawErrorObject,
  };
}

async function callProxyJson({ method = 'GET', params = {}, body, timeoutMs = 10000 }: ProxyRequestOptions): Promise<ProbeResult> {
  const requestUrl = proxyUrl(params);
  const requestHeadersSent = browserHeaders(method, Boolean(body));
  const startedAt = performance.now();

  try {
    const response = await fetch(requestUrl, {
      method,
      headers: requestHeadersSent,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const rawText = await response.text();
    let parsedBody: Record<string, unknown> | null = null;

    try {
      parsedBody = rawText ? JSON.parse(rawText) as Record<string, unknown> : null;
    } catch {
      parsedBody = null;
    }

    return normalizeProbeResult(
      response,
      requestUrl,
      method,
      requestHeadersSent,
      rawText,
      parsedBody,
      (params.probe as string) || (typeof body?.probe === 'string' ? body.probe : 'proxy_request'),
      startedAt
    );
  } catch (e) {
    const classified = classifyError(e);
    return {
      ok: false,
      proxyUrl: requestUrl,
      requestMethod: method,
      requestHeadersSent,
      latencyMs: Math.round(performance.now() - startedAt),
      failurePoint: (params.probe as string) || (typeof body?.probe === 'string' ? body.probe : 'proxy_request'),
      clientError: classified.message,
      clientErrorType: classified.type,
      errorLabel: classified.message,
      rawErrorObject: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : { value: String(e) },
    };
  }
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

  const payload = await res.json();
  const normalized = normalizeSession(payload);
  if (!normalized) {
    throw new Error(`Invalid session payload received for sessionKey=${sessionKey}`);
  }

  return normalized;
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
    .map((r) => normalizeSession(r.value))
    .filter((session): session is OpenClawSession => session !== null);
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
              const parsed = JSON.parse(line.slice(6)) as unknown;
              const data = normalizeMessage(parsed, 0);
              if (data) {
                onMessage(data);
              }
            } catch {
              // Skip non-JSON SSE lines
            }
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        onError?.(new Error(classifyError(e).message));
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
  stage?: string;
  errorType?: string;
  message?: string;
  status?: number;
  statusText?: string;
  errorLabel?: string | null;
  endpoint?: string;
  upstreamUrl?: string;
  proxyRouteInvoked?: string;
  sessionKeyRaw?: string;
  sessionKeyEncoded?: string;
  authApplied?: boolean;
  authMode?: string;
  latencyMs?: number;
  failurePoint?: string;
  bodySnippet?: string;
  parsedBody?: unknown;
  diagnostics?: Record<string, unknown>;
  proxyUrl?: string;
  proxyHttpStatus?: number;
  proxyStatusText?: string;
  upstreamStatus?: number;
  requestMethod?: string;
  requestHeadersSent?: Record<string, string>;
  headersReceived?: Record<string, string>;
  queryParamsReceived?: Record<string, string>;
  optionsHit?: boolean;
  requestBodyReceived?: Record<string, unknown>;
  clientError?: string;
  clientErrorType?: string;
  rawErrorObject?: unknown;
}

/**
 * Run a basic probe (no SSE) through the proxy.
 */
export async function runBasicProbe(sessionKey: string): Promise<ProbeResult> {
  const payload = buildProbePayload('basic');
  payload.sessionKey = sessionKey;

  const result = await callProxyJson({
    method: 'POST',
    body: payload,
    timeoutMs: 10000,
  });

  return {
    ...result,
    sessionKeyRaw: result.sessionKeyRaw ?? sessionKey,
    sessionKeyEncoded: result.sessionKeyEncoded ?? encodeURIComponent(sessionKey),
    failurePoint: result.failurePoint ?? 'session_history_fetch',
  };
}

/**
 * Run an SSE probe through the proxy (tests follow=1 initialization).
 */
export async function runSSEProbe(sessionKey: string): Promise<ProbeResult> {
  const payload = buildProbePayload('sse');
  payload.sessionKey = sessionKey;

  const result = await callProxyJson({
    method: 'POST',
    body: payload,
    timeoutMs: 12000,
  });

  return {
    ...result,
    sessionKeyRaw: result.sessionKeyRaw ?? sessionKey,
    sessionKeyEncoded: result.sessionKeyEncoded ?? encodeURIComponent(sessionKey),
    failurePoint: result.failurePoint ?? 'sse_stream_init',
  };
}

/**
 * Run a health probe that only checks if the proxy edge function is reachable.
 * Does NOT contact OpenClaw upstream.
 */
export async function runHealthProbe(): Promise<ProbeResult> {
  return callProxyJson({
    method: 'GET',
    params: { probe: 'health' },
    timeoutMs: 8000,
  });
}

/**
 * Run an echo probe to show exactly what the function received from the browser.
 */
export async function runEchoProbe(): Promise<ProbeResult> {
  const config = getConfig();
  const params: Record<string, string> = { probe: 'echo' };

  if (config.baseUrl) params.baseUrl = config.baseUrl;
  if (config.sessionKeys[0]) params.sessionKey = config.sessionKeys[0];
  if (config.authMode) params.authMode = config.authMode;
  if (config.authHeaderName) params.authHeaderName = config.authHeaderName;
  if (config.authHeaderPrefix) params.authHeaderPrefix = config.authHeaderPrefix;
  if (config.authToken) params.hasAuthToken = '1';

  return callProxyJson({
    method: 'GET',
    params,
    timeoutMs: 8000,
  });
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

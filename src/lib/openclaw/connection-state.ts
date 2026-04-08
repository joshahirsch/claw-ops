/**
 * Connection state machine for OpenClaw gateway interaction.
 *
 * States flow:  idle → validating-config → probing-http → opening-websocket
 *   → websocket-connected → authenticating → auth-accepted → session-binding
 *   → session-ready → stream-active
 *
 * Failure branches:  auth-rejected | scope-limited | degraded | failed
 */

export type ConnectionState =
  | 'idle'
  | 'validating-config'
  | 'probing-http'
  | 'opening-websocket'
  | 'websocket-connected'
  | 'authenticating'
  | 'auth-accepted'
  | 'auth-rejected'
  | 'scope-limited'
  | 'session-binding'
  | 'session-ready'
  | 'stream-active'
  | 'degraded'
  | 'failed';

export type FailureCategory =
  | 'none'
  | 'dns-or-tunnel'
  | 'gateway-unreachable'
  | 'token-rejected'
  | 'token-accepted-missing-scope'
  | 'wrong-endpoint-or-protocol'
  | 'session-stream-failure'
  | 'config-invalid'
  | 'unknown';

export interface ConnectionAttemptStep {
  timestamp: string;
  state: ConnectionState;
  detail: string;
  httpStatus?: number;
  error?: string;
  durationMs?: number;
}

export interface ConnectionDiagnostics {
  correlationId: string;
  state: ConnectionState;
  failureCategory: FailureCategory;
  steps: ConnectionAttemptStep[];
  lastSuccessfulStep: ConnectionState | null;
  firstFailedStep: ConnectionState | null;
  firstError: string | null;
  rawStatusCode: number | null;
  responseSummary: string | null;
  lastAttemptTimestamp: string | null;
  authMode: string;
  tokenPresent: boolean;
  tokenMasked: string | null;
  baseUrl: string;
  wsUrl: string;
  sessionKey: string;
}

function generateCorrelationId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function maskToken(token: string): string | null {
  if (!token) return null;
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function createDiagnostics(config: {
  baseUrl: string;
  wsUrl: string;
  sessionKey: string;
  authMode: string;
  authToken: string;
}): ConnectionDiagnostics {
  return {
    correlationId: generateCorrelationId(),
    state: 'idle',
    failureCategory: 'none',
    steps: [],
    lastSuccessfulStep: null,
    firstFailedStep: null,
    firstError: null,
    rawStatusCode: null,
    responseSummary: null,
    lastAttemptTimestamp: null,
    authMode: config.authMode,
    tokenPresent: Boolean(config.authToken),
    tokenMasked: maskToken(config.authToken),
    baseUrl: config.baseUrl,
    wsUrl: config.wsUrl,
    sessionKey: config.sessionKey,
  };
}

const FAILED_STATES: ConnectionState[] = [
  'auth-rejected', 'scope-limited', 'degraded', 'failed',
];

export function addStep(
  diag: ConnectionDiagnostics,
  state: ConnectionState,
  detail: string,
  opts?: { httpStatus?: number; error?: string; durationMs?: number }
): ConnectionDiagnostics {
  const step: ConnectionAttemptStep = {
    timestamp: new Date().toISOString(),
    state,
    detail,
    ...opts,
  };

  const isFail = FAILED_STATES.includes(state) || Boolean(opts?.error);

  return {
    ...diag,
    state,
    steps: [...diag.steps, step],
    lastAttemptTimestamp: step.timestamp,
    lastSuccessfulStep: isFail ? diag.lastSuccessfulStep : state,
    firstFailedStep: isFail && !diag.firstFailedStep ? state : diag.firstFailedStep,
    firstError: isFail && !diag.firstError ? (opts?.error || detail) : diag.firstError,
    rawStatusCode: opts?.httpStatus ?? diag.rawStatusCode,
    responseSummary: isFail ? detail : diag.responseSummary,
  };
}

/**
 * Classify an HTTP status + response body into a failure category.
 */
export function classifyFailure(
  httpStatus: number | undefined,
  responseBody: string | undefined,
): FailureCategory {
  if (!httpStatus) return 'gateway-unreachable';

  const body = (responseBody || '').toLowerCase();

  if (httpStatus === 401) return 'token-rejected';

  if (httpStatus === 403) {
    if (body.includes('scope') || body.includes('operator.read')) {
      return 'token-accepted-missing-scope';
    }
    return 'token-rejected';
  }

  if (httpStatus === 404 || httpStatus === 405) {
    return 'wrong-endpoint-or-protocol';
  }

  if (httpStatus >= 500) return 'gateway-unreachable';

  return 'unknown';
}

/**
 * Human-readable label for a failure category.
 */
export function failureCategoryLabel(cat: FailureCategory): string {
  switch (cat) {
    case 'none': return 'No failure';
    case 'dns-or-tunnel': return 'DNS or tunnel issue';
    case 'gateway-unreachable': return 'Gateway unreachable';
    case 'token-rejected': return 'Token rejected (401/403)';
    case 'token-accepted-missing-scope': return 'Token accepted but missing scope';
    case 'wrong-endpoint-or-protocol': return 'Wrong endpoint or protocol mismatch';
    case 'session-stream-failure': return 'Session stream failure';
    case 'config-invalid': return 'Invalid configuration';
    case 'unknown': return 'Unknown failure';
  }
}

/**
 * Build a sanitized, copyable diagnostics block.
 */
export function buildCopyableDiagnostics(diag: ConnectionDiagnostics): string {
  const lines = [
    `Correlation ID: ${diag.correlationId}`,
    `State: ${diag.state}`,
    `Failure: ${failureCategoryLabel(diag.failureCategory)}`,
    `Base URL: ${diag.baseUrl}`,
    `WS URL: ${diag.wsUrl}`,
    `Session Key: ${diag.sessionKey}`,
    `Auth Mode: ${diag.authMode}`,
    `Token Present: ${diag.tokenPresent}`,
    `Token: ${diag.tokenMasked || 'none'}`,
    `Last Successful Step: ${diag.lastSuccessfulStep || 'none'}`,
    `First Failed Step: ${diag.firstFailedStep || 'none'}`,
    `First Error: ${diag.firstError || 'none'}`,
    `HTTP Status: ${diag.rawStatusCode ?? 'N/A'}`,
    `Last Attempt: ${diag.lastAttemptTimestamp || 'never'}`,
    '',
    '--- Steps ---',
    ...diag.steps.map((s, i) =>
      `${i + 1}. [${s.timestamp}] ${s.state}: ${s.detail}${s.httpStatus ? ` (HTTP ${s.httpStatus})` : ''}${s.error ? ` ERROR: ${s.error}` : ''}${s.durationMs ? ` (${s.durationMs}ms)` : ''}`
    ),
  ];
  return lines.join('\n');
}

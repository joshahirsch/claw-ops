import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOpenClawConfig } from '@/lib/openclaw/config';
import { fetchAllSessions, subscribeSessionSSE } from '@/lib/openclaw/client';
import { OpenClawWebSocket } from '@/lib/openclaw/websocket';
import { sessionsToAgents, sessionsToActivity } from '@/lib/openclaw/adapter';
import {
  type ConnectionState,
  type FailureCategory,
  type ConnectionDiagnostics,
  createDiagnostics,
  addStep,
  classifyFailure,
} from '@/lib/openclaw/connection-state';
import { mockAgents, mockActivity } from '@/data/mockData';
import type { OpenClawSession, OpenClawMessage } from '@/lib/openclaw/types';
import type { Agent, ActivityEvent } from '@/data/types';

/** States that represent a terminal or blocking failure */
const BLOCKING_FAILURE_STATES: ConnectionState[] = [
  'auth-rejected', 'failed',
];

/** States that require auth to have succeeded first */
const AUTH_GATED_STATES: ConnectionState[] = [
  'session-binding', 'session-ready', 'stream-active',
];

function isBlockedByFailure(diag: ConnectionDiagnostics | null): boolean {
  if (!diag) return false;
  return BLOCKING_FAILURE_STATES.includes(diag.state) ||
    diag.steps.some(s => BLOCKING_FAILURE_STATES.includes(s.state));
}

/**
 * Guarded addStep: prevents advancing to auth-gated states
 * if the diagnostics already contain a blocking failure.
 */
function addStepGuarded(
  diag: ConnectionDiagnostics,
  state: ConnectionState,
  detail: string,
  opts?: { httpStatus?: number; error?: string; durationMs?: number }
): ConnectionDiagnostics {
  // Always allow failure/degraded states through
  if (BLOCKING_FAILURE_STATES.includes(state) || state === 'scope-limited' || state === 'degraded') {
    return addStep(diag, state, detail, opts);
  }

  // Block auth-gated states if a blocking failure already occurred
  if (AUTH_GATED_STATES.includes(state) && isBlockedByFailure(diag)) {
    // Record the attempt as informational but don't advance state
    const infoStep = addStep(diag, diag.state, `[blocked] ${detail} — auth prerequisite not met`, opts);
    return infoStep;
  }

  return addStep(diag, state, detail, opts);
}

export interface UseOpenClawDataReturn {
  sessions: OpenClawSession[];
  agents: Agent[];
  activity: ActivityEvent[];
  isLive: boolean;
  isLoading: boolean;
  error: string | null;
  wsConnected: boolean;
  wsAuthAccepted: boolean;
  usingMockData: boolean;
  connectionState: ConnectionState;
  failureCategory: FailureCategory;
  connectionDiagnostics: ConnectionDiagnostics | null;
  /** Single source of truth: is the app actually ready for real-time operation? */
  isActuallyReady: boolean;
}

export function useOpenClawData(): UseOpenClawDataReturn {
  const config = useOpenClawConfig();
  const queryClient = useQueryClient();
  const [liveMessages, setLiveMessages] = useState<Map<string, OpenClawMessage[]>>(new Map());
  const [wsConnected, setWsConnected] = useState(false);
  const [wsAuthAccepted, setWsAuthAccepted] = useState(false);
  const [wsAuthFailed, setWsAuthFailed] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [failureCategory, setFailureCategory] = useState<FailureCategory>('none');
  const [connDiag, setConnDiag] = useState<ConnectionDiagnostics | null>(null);
  const wsRef = useRef<OpenClawWebSocket | null>(null);
  const sseControllersRef = useRef<Map<string, AbortController>>(new Map());
  const sessionKeySignature = JSON.stringify(config.sessionKeys);

  const updateDiag = useCallback((
    updater: (prev: ConnectionDiagnostics) => ConnectionDiagnostics
  ) => {
    setConnDiag(prev => {
      if (!prev) return prev;
      const next = updater(prev);
      setConnectionState(next.state);
      // Keep failureCategory in sync with diagnostics
      if (next.failureCategory !== 'none') {
        setFailureCategory(next.failureCategory);
      }
      return next;
    });
  }, []);

  // Reset state when config changes
  useEffect(() => {
    setLiveMessages(new Map());
    setWsConnected(false);
    setWsAuthAccepted(false);
    setWsAuthFailed(false);
    setConnectionState(config.enabled ? 'validating-config' : 'idle');
    setFailureCategory('none');

    if (config.enabled) {
      const diag = createDiagnostics({
        baseUrl: config.baseUrl,
        wsUrl: config.wsUrl,
        sessionKey: config.sessionKeys[0] || 'default',
        authMode: config.authMode,
        authToken: config.authToken,
      });
      setConnDiag(addStep(diag, 'validating-config', 'Configuration loaded, starting connection'));
    } else {
      setConnDiag(null);
    }
  }, [config.enabled, config.baseUrl, config.wsUrl, config.authMode, config.authToken, config.authHeaderName, config.authHeaderPrefix, sessionKeySignature]);

  // Polling query for session data
  const { data: polledSessions, isLoading, error } = useQuery<OpenClawSession[]>({
    queryKey: [
      'openclaw-sessions',
      config.baseUrl,
      config.enabled,
      config.authMode,
      config.authToken,
      config.authHeaderName,
      config.authHeaderPrefix,
      sessionKeySignature,
    ],
    queryFn: async () => {
      // Use guarded step — won't advance to session-binding/ready if auth failed
      updateDiag(d => addStepGuarded(d, 'session-binding', 'Fetching session history'));

      try {
        const sessions = await fetchAllSessions(config.sessionKeys, { includeTools: true });

        // Only mark session-ready if auth hasn't failed
        updateDiag(d => addStepGuarded(d, 'session-ready', `Loaded ${sessions.length} session(s)`));

        return sessions;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const errWithCat = e as Error & { failureCategory?: string; httpStatus?: number };

        const category = (errWithCat.failureCategory as FailureCategory) ||
          classifyFailure(errWithCat.httpStatus, errMsg);

        setFailureCategory(category);
        updateDiag(d => {
          let updated = addStep(d, 'failed', errMsg, {
            error: errMsg,
            httpStatus: errWithCat.httpStatus,
          });
          updated = { ...updated, failureCategory: category };
          return updated;
        });

        throw e;
      }
    },
    refetchInterval: config.enabled ? 10_000 : false,
    enabled: config.enabled,
  });

  // WebSocket connection
  useEffect(() => {
    if (!config.enabled) return;

    updateDiag(d => addStep(d, 'opening-websocket', `Connecting to ${config.wsUrl}`));

    const ws = new OpenClawWebSocket({
      onSessionMessage: (sessionKey, message) => {
        setLiveMessages((prev) => {
          const next = new Map(prev);
          const msgs = next.get(sessionKey) || [];
          next.set(sessionKey, [...msgs, message]);
          return next;
        });
      },
      onSessionChanged: () => {
        queryClient.invalidateQueries({ queryKey: ['openclaw-sessions'] });
      },
      onConnect: () => {
        setWsConnected(true);
        updateDiag(d => addStep(d, 'websocket-connected', 'WebSocket connected, authenticating'));
      },
      onDisconnect: () => {
        setWsConnected(false);
        setWsAuthAccepted(false);
        updateDiag(d => {
          // Only mark degraded if we were previously in a success state
          if (d.state === 'stream-active' || d.state === 'session-ready' || d.state === 'websocket-connected' || d.state === 'auth-accepted') {
            return addStep(d, 'degraded', 'WebSocket disconnected');
          }
          return d;
        });
      },
      onAuthRejected: (status, detail) => {
        setWsAuthFailed(true);
        setWsAuthAccepted(false);
        setFailureCategory('token-rejected');
        updateDiag(d => {
          let updated = addStep(d, 'auth-rejected', `Auth rejected: ${detail}`, { error: `WS auth ${status}` });
          updated = { ...updated, failureCategory: 'token-rejected' };
          return updated;
        });
        console.warn('[OpenClaw WS] Auth rejected:', status, detail);
      },
      onScopeLimited: (scopes) => {
        setFailureCategory('token-accepted-missing-scope');
        updateDiag(d => {
          let updated = addStep(d, 'scope-limited', `Missing scopes: ${scopes}`, { error: `Missing scopes: ${scopes}` });
          updated = { ...updated, failureCategory: 'token-accepted-missing-scope' };
          return updated;
        });
        console.warn('[OpenClaw WS] Scope limited:', scopes);
      },
      onError: (err) => console.warn('[OpenClaw WS]', err.message),
    });

    ws.connect();
    config.sessionKeys.forEach((key) => ws.subscribeSession(key));
    wsRef.current = ws;

    return () => {
      ws.dispose();
      wsRef.current = null;
      setWsConnected(false);
      setWsAuthAccepted(false);
    };
  }, [config.enabled, config.wsUrl, config.authMode, config.authToken, sessionKeySignature, queryClient, updateDiag]);

  // SSE connection — guarded by auth state
  useEffect(() => {
    if (!config.enabled) return;
    // Don't start SSE if WS auth has failed
    if (wsAuthFailed) return;

    const controllers = sseControllersRef.current;
    config.sessionKeys.forEach((key) => {
      if (controllers.has(key)) return;
      const ctrl = subscribeSessionSSE(
        key,
        (msg) => {
          setLiveMessages((prev) => {
            const next = new Map(prev);
            const msgs = next.get(key) || [];
            next.set(key, [...msgs, msg]);
            return next;
          });
          // Mark stream as active — guarded
          updateDiag(d => {
            if (d.state !== 'stream-active') {
              return addStepGuarded(d, 'stream-active', 'Receiving live SSE updates');
            }
            return d;
          });
        },
        (err) => console.warn('[OpenClaw SSE]', err.message)
      );
      controllers.set(key, ctrl);
    });

    return () => {
      controllers.forEach((ctrl) => ctrl.abort());
      controllers.clear();
    };
  }, [config.enabled, config.baseUrl, config.authMode, config.authToken, sessionKeySignature, updateDiag, wsAuthFailed]);

  // Merge polled + live messages
  const mergedSessions = useMemo<OpenClawSession[]>(() => {
    if (!polledSessions?.length) return [];

    return polledSessions.map((session) => {
      const extra = liveMessages.get(session.sessionKey);
      if (!extra?.length) return session;

      const existingIds = new Set(session.messages.map((m) => m.id));
      const newMsgs = extra.filter((m) => !existingIds.has(m.id));
      if (!newMsgs.length) return session;

      return {
        ...session,
        messages: [...session.messages, ...newMsgs],
        updatedAt: newMsgs[newMsgs.length - 1].timestamp,
      };
    });
  }, [polledSessions, liveMessages]);

  // === DERIVED READINESS: single source of truth ===
  const isActuallyReady = useMemo(() => {
    if (!config.enabled) return false;
    if (wsAuthFailed) return false;
    if (!wsConnected) return false;
    // If auth mode requires a token, wsAuthAccepted must be true
    if (config.authMode !== 'none' && !wsAuthAccepted) return false;
    // Check diagnostics for any blocking failure
    if (isBlockedByFailure(connDiag)) return false;
    return true;
  }, [config.enabled, config.authMode, wsAuthFailed, wsConnected, wsAuthAccepted, connDiag]);

  // Derive the effective connection state for display — override if contradictory
  const effectiveConnectionState = useMemo((): ConnectionState => {
    if (!config.enabled) return 'idle';
    // If auth failed, that's the authoritative state regardless of what the state machine says
    if (wsAuthFailed) return 'auth-rejected';
    // If we have a blocking failure in diagnostics
    if (connDiag && isBlockedByFailure(connDiag)) {
      return connDiag.state;
    }
    return connectionState;
  }, [config.enabled, wsAuthFailed, connDiag, connectionState]);

  // Derive the effective failure category
  const effectiveFailureCategory = useMemo((): FailureCategory => {
    if (wsAuthFailed) return 'token-rejected';
    if (connDiag?.failureCategory && connDiag.failureCategory !== 'none') return connDiag.failureCategory;
    return failureCategory;
  }, [wsAuthFailed, connDiag, failureCategory]);

  // Mock data path
  if (!config.enabled) {
    return {
      sessions: [],
      agents: mockAgents,
      activity: mockActivity,
      isLive: false,
      isLoading: false,
      error: null,
      wsConnected: false,
      wsAuthAccepted: false,
      usingMockData: true,
      connectionState: 'idle',
      failureCategory: 'none',
      connectionDiagnostics: null,
      isActuallyReady: false,
    };
  }

  // Derive agents/activity
  let derivedError: string | null = error ? (error instanceof Error ? error.message : 'Connection error') : null;
  let agents: Agent[] = [];
  let activity: ActivityEvent[] = [];

  try {
    agents = sessionsToAgents(mergedSessions);
    activity = sessionsToActivity(mergedSessions);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown adapter error';
    console.error('[OpenClaw adapter]', e);
    derivedError = derivedError ? `${derivedError} | Adapter error: ${message}` : `Adapter error: ${message}`;
  }

  return {
    sessions: mergedSessions,
    agents,
    activity,
    isLive: isActuallyReady && (wsConnected || mergedSessions.length > 0),
    isLoading,
    error: derivedError,
    wsConnected,
    wsAuthAccepted,
    usingMockData: false,
    connectionState: effectiveConnectionState,
    failureCategory: effectiveFailureCategory,
    connectionDiagnostics: connDiag,
    isActuallyReady,
  };
}

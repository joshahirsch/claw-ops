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

interface UseOpenClawDataReturn {
  sessions: OpenClawSession[];
  agents: Agent[];
  activity: ActivityEvent[];
  isLive: boolean;
  isLoading: boolean;
  error: string | null;
  wsConnected: boolean;
  usingMockData: boolean;
  connectionState: ConnectionState;
  failureCategory: FailureCategory;
  connectionDiagnostics: ConnectionDiagnostics | null;
}

export function useOpenClawData(): UseOpenClawDataReturn {
  const config = useOpenClawConfig();
  const queryClient = useQueryClient();
  const [liveMessages, setLiveMessages] = useState<Map<string, OpenClawMessage[]>>(new Map());
  const [wsConnected, setWsConnected] = useState(false);
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
      return next;
    });
  }, []);

  // Reset state when config changes
  useEffect(() => {
    setLiveMessages(new Map());
    setWsConnected(false);
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
      updateDiag(d => addStep(d, 'session-binding', 'Fetching session history'));

      try {
        const sessions = await fetchAllSessions(config.sessionKeys, { includeTools: true });

        updateDiag(d => addStep(d, 'session-ready', `Loaded ${sessions.length} session(s)`));
        setFailureCategory('none');

        return sessions;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const errWithCat = e as Error & { failureCategory?: string; httpStatus?: number };

        const category = (errWithCat.failureCategory as FailureCategory) ||
          classifyFailure(errWithCat.httpStatus, errMsg);

        setFailureCategory(category);
        updateDiag(d => addStep(d, 'failed', errMsg, {
          error: errMsg,
          httpStatus: errWithCat.httpStatus,
        }));

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
        updateDiag(d => {
          // Only mark degraded if we were previously connected
          if (d.state === 'stream-active' || d.state === 'session-ready' || d.state === 'websocket-connected') {
            return addStep(d, 'degraded', 'WebSocket disconnected');
          }
          return d;
        });
      },
      onAuthRejected: (status, detail) => {
        setFailureCategory('token-rejected');
        updateDiag(d => addStep(d, 'auth-rejected', `Auth rejected: ${detail}`, { error: `WS auth ${status}` }));
        console.warn('[OpenClaw WS] Auth rejected:', status, detail);
      },
      onScopeLimited: (scopes) => {
        setFailureCategory('token-accepted-missing-scope');
        updateDiag(d => addStep(d, 'scope-limited', `Missing scopes: ${scopes}`, { error: `Missing scopes: ${scopes}` }));
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
    };
  }, [config.enabled, config.wsUrl, config.authMode, config.authToken, sessionKeySignature, queryClient, updateDiag]);

  // SSE connection
  useEffect(() => {
    if (!config.enabled) return;

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
          // Mark stream as active on first SSE message
          updateDiag(d => {
            if (d.state !== 'stream-active') {
              return addStep(d, 'stream-active', 'Receiving live SSE updates');
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
  }, [config.enabled, config.baseUrl, config.authMode, config.authToken, sessionKeySignature, updateDiag]);

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
      usingMockData: true,
      connectionState: 'idle',
      failureCategory: 'none',
      connectionDiagnostics: null,
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
    isLive: wsConnected || mergedSessions.length > 0,
    isLoading,
    error: derivedError,
    wsConnected,
    usingMockData: false,
    connectionState,
    failureCategory,
    connectionDiagnostics: connDiag,
  };
}

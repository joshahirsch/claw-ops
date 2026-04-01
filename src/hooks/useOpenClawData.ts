import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getConfig } from '@/lib/openclaw/config';
import { fetchAllSessions, subscribeSessionSSE } from '@/lib/openclaw/client';
import { OpenClawWebSocket } from '@/lib/openclaw/websocket';
import { sessionsToAgents, sessionsToActivity } from '@/lib/openclaw/adapter';
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
}

/**
 * Hook that returns sessions, agents, and activity from OpenClaw when connected,
 * or mock data when the connection is explicitly disabled.
 *
 * Data flow priority:
 *   1. WebSocket events (session.message / sessions.changed) — instant
 *   2. SSE via follow=1 — near-real-time fallback
 *   3. Polling GET /sessions/{key}/history — 10s interval
 *   4. Mock data — only when OpenClaw is disabled
 */
export function useOpenClawData(): UseOpenClawDataReturn {
  const config = getConfig();
  const queryClient = useQueryClient();
  const [liveMessages, setLiveMessages] = useState<Map<string, OpenClawMessage[]>>(new Map());
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<OpenClawWebSocket | null>(null);
  const sseControllersRef = useRef<Map<string, AbortController>>(new Map());

  const { data: polledSessions, isLoading, error } = useQuery<OpenClawSession[]>({
    queryKey: ['openclaw-sessions', config.sessionKeys],
    queryFn: () => fetchAllSessions(config.sessionKeys, { includeTools: true }),
    refetchInterval: config.enabled ? 10_000 : false,
    enabled: config.enabled,
  });

  useEffect(() => {
    if (!config.enabled) return;

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
      onConnect: () => setWsConnected(true),
      onDisconnect: () => setWsConnected(false),
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
  }, [config.enabled, config.wsUrl, JSON.stringify(config.sessionKeys), queryClient]);

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
        },
        (err) => console.warn('[OpenClaw SSE]', err.message)
      );
      controllers.set(key, ctrl);
    });

    return () => {
      controllers.forEach((ctrl) => ctrl.abort());
      controllers.clear();
    };
  }, [config.enabled, config.baseUrl, JSON.stringify(config.sessionKeys)]);

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
    };
  }

  const agents = sessionsToAgents(mergedSessions);
  const activity = sessionsToActivity(mergedSessions);

  return {
    sessions: mergedSessions,
    agents,
    activity,
    isLive: wsConnected || mergedSessions.length > 0,
    isLoading,
    error: error ? (error instanceof Error ? error.message : 'Connection error') : null,
    wsConnected,
    usingMockData: false,
  };
}

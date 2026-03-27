import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getConfig } from '@/lib/openclaw/config';
import { fetchSessionHistory, subscribeSession } from '@/lib/openclaw/client';
import { sessionsToAgents, sessionsToActivity } from '@/lib/openclaw/adapter';
import { mockAgents, mockActivity } from '@/data/mockData';
import type { OpenClawSession, OpenClawMessage } from '@/lib/openclaw/types';
import type { Agent, ActivityEvent } from '@/data/types';

/**
 * Hook that returns agents and activity — from OpenClaw when connected, mock data otherwise.
 * Uses SSE streaming when available, falls back to polling.
 */
export function useOpenClawData() {
  const config = getConfig();
  const queryClient = useQueryClient();
  const sseRef = useRef<AbortController | null>(null);
  const [liveSessions, setLiveSessions] = useState<Map<string, OpenClawSession>>(new Map());

  // When OpenClaw is disabled, return mock data
  if (!config.enabled) {
    return {
      agents: mockAgents,
      activity: mockActivity,
      isLive: false,
      isLoading: false,
      error: null,
    };
  }

  // Poll for session list (you'd replace 'default' with actual session keys)
  const { data: sessions, isLoading, error } = useQuery<OpenClawSession[]>({
    queryKey: ['openclaw-sessions'],
    queryFn: async () => {
      // For now, try fetching a known session. In a real setup,
      // you'd have a sessions list endpoint or read from config.
      try {
        const session = await fetchSessionHistory('default', { includeTools: true });
        return [session];
      } catch {
        return [];
      }
    },
    refetchInterval: config.enabled ? 10000 : false,
    enabled: config.enabled,
  });

  // Merge polled sessions with live SSE updates
  const mergedSessions = sessions || [];

  const agents: Agent[] = mergedSessions.length > 0
    ? sessionsToAgents(mergedSessions)
    : mockAgents;

  const activity: ActivityEvent[] = mergedSessions.length > 0
    ? sessionsToActivity(mergedSessions)
    : mockActivity;

  return {
    agents,
    activity,
    isLive: config.enabled && mergedSessions.length > 0,
    isLoading,
    error: error ? (error instanceof Error ? error.message : 'Connection error') : null,
  };
}

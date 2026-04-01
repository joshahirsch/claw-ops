/**
 * Transforms normalized OpenClaw session data into ClawOps app types.
 *
 * Data sources (in priority order):
 *   1. GET /sessions/{key}/history  — gateway API
 *   2. SSE follow=1 / WebSocket    — live incremental updates
 *   3. JSONL transcript files      — offline fallback
 *
 * All paths normalise into the same OpenClawSession shape before
 * this adapter converts to Agent / ActivityEvent / ReplaySession.
 */
import type { OpenClawSession, OpenClawMessage, RawTranscriptEntry } from './types';
import type { Agent, AgentState, AgentAction, ActivityEvent, Severity, ReplaySession, ReplayStep } from '@/data/types';

function formatClock(iso: string): string {
  const time = new Date(iso);
  return time.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function safeString(value: string | Record<string, unknown> | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') return JSON.stringify(value).slice(0, 200);
  return fallback;
}

function normaliseText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasErrorSignal(msg: OpenClawMessage): boolean {
  const text = normaliseText(
    [
      typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      msg.toolOutput || '',
      msg.toolName || '',
    ].join(' ')
  ).toLowerCase();

  return /(error|failed|failure|exception|timeout|forbidden|unauthorized|503|stalled|blocked)/.test(text);
}

function sessionHasErrorSignal(session: OpenClawSession): boolean {
  return session.messages.some(hasErrorSignal);
}

function sessionDisplayName(session: OpenClawSession): string {
  return `Session-${session.sessionKey.slice(0, 6)}`;
}

function sessionObjective(session: OpenClawSession): string {
  const firstUser = session.messages.find((msg) => msg.role === 'user');
  return safeString(firstUser?.content, 'Unknown objective').slice(0, 120);
}

function sessionCurrentTask(session: OpenClawSession): string {
  const lastAssistant = [...session.messages].reverse().find((msg) => msg.role === 'assistant');
  const firstUser = session.messages.find((msg) => msg.role === 'user');
  return safeString(lastAssistant?.content, safeString(firstUser?.content, 'Awaiting activity')).slice(0, 80);
}

function phaseToState(session: OpenClawSession): AgentState {
  const { status, messages, updatedAt } = session;
  const lastMsg = messages[messages.length - 1];
  const idleMs = Date.now() - new Date(updatedAt).getTime();

  if (status.phase === 'waiting') return 'awaiting_approval';
  if (sessionHasErrorSignal(session)) return 'error';
  if (status.phase === 'idle') {
    return messages.length > 0 ? 'complete' : 'idle';
  }
  if (idleMs > 5 * 60 * 1000) return 'stalled';
  if (lastMsg?.role === 'toolResult') return 'tool_active';
  if (lastMsg?.role === 'assistant') return 'thinking';
  return 'multi_step';
}

function formatElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function inferRiskLevel(state: AgentState): Severity {
  if (state === 'error' || state === 'stalled') return 'high';
  if (state === 'awaiting_approval') return 'medium';
  return 'low';
}

function inferConfidence(state: AgentState): number {
  if (state === 'error') return 0.2;
  if (state === 'stalled') return 0.4;
  if (state === 'awaiting_approval') return 0.65;
  if (state === 'complete') return 0.99;
  return 0.8;
}

function messageToAction(msg: OpenClawMessage): AgentAction {
  return {
    id: msg.id,
    timestamp: formatClock(msg.timestamp),
    type:
      msg.role === 'toolResult'
        ? hasErrorSignal(msg)
          ? 'error'
          : 'tool_use'
        : msg.role === 'assistant'
          ? 'reasoning'
          : 'incoming',
    description: safeString(msg.content, 'No content').slice(0, 200),
    tool: msg.toolName,
  };
}

export function sessionToAgent(session: OpenClawSession): Agent {
  const { messages } = session;
  const state = phaseToState(session);
  const lastToolMsg = [...messages].reverse().find((m) => m.role === 'toolResult');
  const firstMsg = messages[0];

  const blockers: string[] = [];
  if (state === 'awaiting_approval') blockers.push('Awaiting human approval');
  if (state === 'stalled') blockers.push('No recent session activity detected');
  if (state === 'error') blockers.push('Recent message/tool output contains an error signal');

  return {
    id: session.sessionKey,
    name: sessionDisplayName(session),
    state,
    currentTask: sessionCurrentTask(session),
    elapsedTime: firstMsg ? formatElapsed(firstMsg.timestamp) : '—',
    lastTool: lastToolMsg?.toolName || 'none',
    confidence: inferConfidence(state),
    riskLevel: inferRiskLevel(state),
    objective: sessionObjective(session),
    blockers,
    approvalNeeded: state === 'awaiting_approval',
    actions: messages.slice(-10).map(messageToAction),
  };
}

function messageSeverity(msg: OpenClawMessage): Severity {
  if (hasErrorSignal(msg)) return 'high';
  return 'low';
}

function messageType(msg: OpenClawMessage): string {
  if (msg.role === 'toolResult') return hasErrorSignal(msg) ? 'error' : 'tool_use';
  if (msg.role === 'assistant') return 'reasoning';
  return 'incoming';
}

export function messageToActivityEvent(msg: OpenClawMessage, session: OpenClawSession): ActivityEvent {
  return {
    id: msg.id,
    timestamp: formatClock(msg.timestamp),
    agentName: sessionDisplayName(session),
    agentId: session.sessionKey,
    type: messageType(msg),
    message: safeString(msg.content, 'No content').slice(0, 200),
    severity: messageSeverity(msg),
    tool: msg.toolName,
  };
}

function messageToReplayStep(msg: OpenClawMessage): ReplayStep {
  return {
    id: msg.id,
    timestamp: formatClock(msg.timestamp),
    type: msg.role === 'toolResult' ? (hasErrorSignal(msg) ? 'error' : 'tool_use') : 'thinking',
    description: safeString(msg.content, msg.toolName ? `Tool used: ${msg.toolName}` : 'No content').slice(0, 200),
    tool: msg.toolName,
    duration: '—',
  };
}

export function sessionToReplaySession(session: OpenClawSession): ReplaySession {
  const state = phaseToState(session);
  const messages = session.messages;
  const steps: ReplayStep[] = messages.map(messageToReplayStep);

  if (session.status.phase === 'waiting') {
    steps.push({
      id: `${session.sessionKey}-approval`,
      timestamp: formatClock(session.updatedAt),
      type: 'approval',
      description: 'Session is awaiting approval before continuing.',
      duration: '—',
    });
  } else if (state === 'complete' && messages.length > 0) {
    steps.push({
      id: `${session.sessionKey}-complete`,
      timestamp: formatClock(session.updatedAt),
      type: 'complete',
      description: 'Session completed successfully.',
      duration: '0s',
    });
  } else if (state === 'error') {
    steps.push({
      id: `${session.sessionKey}-error`,
      timestamp: formatClock(session.updatedAt),
      type: 'error',
      description: 'Session ended with an error signal in recent activity.',
      duration: '0s',
    });
  }

  const startTime = messages[0]?.timestamp || session.updatedAt;

  return {
    id: session.sessionKey,
    agentName: sessionDisplayName(session),
    task: sessionObjective(session),
    startTime: formatClock(startTime),
    endTime: formatClock(session.updatedAt),
    status: state === 'error' ? 'failed' : 'completed',
    steps,
  };
}

export function sessionsToAgents(sessions: OpenClawSession[]): Agent[] {
  return sessions.map((s) => sessionToAgent(s));
}

export function sessionsToActivity(sessions: OpenClawSession[], maxItems = 20): ActivityEvent[] {
  return sessions
    .flatMap((s) => s.messages.map((m) => ({ event: messageToActivityEvent(m, s), sortAt: m.timestamp })))
    .sort((a, b) => b.sortAt.localeCompare(a.sortAt))
    .slice(0, maxItems)
    .map((item) => item.event);
}

export function sessionsToReplaySessions(sessions: OpenClawSession[], maxItems = 12): ReplaySession[] {
  return sessions
    .filter((session) => session.messages.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, maxItems)
    .map((session) => sessionToReplaySession(session));
}

/**
 * Normalise raw JSONL transcript entries (from disk files) into
 * the standard OpenClawMessage shape so the same adapter works.
 */
export function normaliseTranscriptEntry(entry: RawTranscriptEntry): OpenClawMessage | null {
  const type = entry.type;
  if (type === 'session_header' || type === 'compaction' || type === 'branch_summary') {
    return null;
  }

  return {
    id: (entry.id as string) || crypto.randomUUID(),
    parentId: (entry.parentId as string) ?? null,
    type: type as OpenClawMessage['type'],
    role: normaliseRole(entry),
    content: (entry.content as string | Record<string, unknown>) ?? '',
    timestamp: (entry.timestamp as string) || new Date().toISOString(),
    toolName: entry.toolName as string | undefined,
    toolInput: entry.toolInput as Record<string, unknown> | undefined,
    toolOutput: entry.toolOutput as string | undefined,
  };
}

function normaliseRole(entry: RawTranscriptEntry): OpenClawMessage['role'] {
  const role = entry.role as string | undefined;
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  if (role === 'toolResult' || entry.type === 'custom_message') return 'toolResult';
  return 'assistant';
}

/**
 * Convert an array of raw JSONL lines into a normalised OpenClawSession.
 * Used when reading transcript files from disk as a fallback.
 */
export function jsonlToSession(
  sessionKey: string,
  lines: RawTranscriptEntry[]
): OpenClawSession {
  const messages = lines
    .map(normaliseTranscriptEntry)
    .filter((m): m is OpenClawMessage => m !== null);

  const lastTimestamp = messages[messages.length - 1]?.timestamp || new Date().toISOString();

  return {
    sessionKey,
    sessionId: sessionKey,
    updatedAt: lastTimestamp,
    messages,
    status: {
      phase: 'idle',
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0 },
    },
  };
}

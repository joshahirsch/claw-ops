/**
 * Transforms normalized OpenClaw session data into ClawOps app types.
 *
 * Data sources (in priority order):
 *   1. GET /sessions/{key}/history  — gateway API
 *   2. SSE follow=1 / WebSocket    — live incremental updates
 *   3. JSONL transcript files       — offline fallback
 *
 * All paths normalise into the same OpenClawSession shape before
 * this adapter converts to Agent / ActivityEvent.
 */
import type { OpenClawSession, OpenClawMessage, RawTranscriptEntry } from './types';
import type { Agent, AgentState, AgentAction, ActivityEvent, Severity } from '@/data/types';

// ─── Session → Agent ────────────────────────────────────────────────

function phaseToState(phase: string, messages: OpenClawMessage[]): AgentState {
  const lastMsg = messages[messages.length - 1];
  if (phase === 'waiting') return 'awaiting_approval';
  if (phase === 'idle') {
    return messages.length > 0 ? 'complete' : 'idle';
  }
  // running — infer sub-state from last message
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

function messageToAction(msg: OpenClawMessage): AgentAction {
  const time = new Date(msg.timestamp);
  return {
    id: msg.id,
    timestamp: time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    type: msg.role === 'toolResult' ? 'tool_use' : msg.role === 'assistant' ? 'reasoning' : 'incoming',
    description: typeof msg.content === 'string' ? msg.content.slice(0, 200) : JSON.stringify(msg.content).slice(0, 200),
    tool: msg.toolName,
  };
}

export function sessionToAgent(session: OpenClawSession): Agent {
  const { messages, status } = session;
  const state = phaseToState(status.phase, messages);
  const lastToolMsg = [...messages].reverse().find((m) => m.role === 'toolResult');
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];

  return {
    id: session.sessionKey,
    name: `Session-${session.sessionKey.slice(0, 6)}`,
    state,
    currentTask: typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 80) : 'Processing…',
    elapsedTime: firstMsg ? formatElapsed(firstMsg.timestamp) : '—',
    lastTool: lastToolMsg?.toolName || 'none',
    confidence: state === 'error' ? 0.3 : state === 'complete' ? 0.99 : 0.8,
    riskLevel: state === 'error' || state === 'stalled' ? 'high' : 'low',
    objective: typeof messages[0]?.content === 'string' ? messages[0].content.slice(0, 120) : 'Unknown objective',
    blockers: state === 'awaiting_approval' ? ['Awaiting human approval'] : [],
    approvalNeeded: state === 'awaiting_approval',
    actions: messages.slice(-10).map(messageToAction),
  };
}

// ─── Messages → Activity Events ─────────────────────────────────────

export function messageToActivityEvent(msg: OpenClawMessage, session: OpenClawSession): ActivityEvent {
  const time = new Date(msg.timestamp);
  const severity: Severity = msg.role === 'toolResult' && msg.toolOutput?.includes('error') ? 'high' : 'low';

  return {
    id: msg.id,
    timestamp: time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    agentName: `Session-${session.sessionKey.slice(0, 6)}`,
    agentId: session.sessionKey,
    type: msg.role === 'toolResult' ? 'tool_use' : msg.role === 'assistant' ? 'reasoning' : 'incoming',
    message: typeof msg.content === 'string' ? msg.content.slice(0, 200) : JSON.stringify(msg.content).slice(0, 200),
    severity,
    tool: msg.toolName,
  };
}

// ─── Batch helpers ───────────────────────────────────────────────────

export function sessionsToAgents(sessions: OpenClawSession[]): Agent[] {
  return sessions.map((s) => sessionToAgent(s));
}

export function sessionsToActivity(sessions: OpenClawSession[], maxItems = 20): ActivityEvent[] {
  return sessions
    .flatMap((s) => s.messages.map((m) => messageToActivityEvent(m, s)))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, maxItems);
}

// ─── JSONL Fallback Normaliser ───────────────────────────────────────

/**
 * Normalise raw JSONL transcript entries (from disk files) into
 * the standard OpenClawMessage shape so the same adapter works.
 */
export function normaliseTranscriptEntry(entry: RawTranscriptEntry): OpenClawMessage | null {
  const type = entry.type;
  // Skip non-message entry types
  if (type === 'session_header' || type === 'compaction' || type === 'branch_summary') {
    return null;
  }

  // Map the raw entry into our normalized message shape
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
      phase: 'idle', // file-based = not live
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0 },
    },
  };
}

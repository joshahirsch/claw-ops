/**
 * Transforms normalized OpenClaw session data into ClawOps app types.
 */
import type { OpenClawSession, OpenClawMessage } from './types';
import type { Agent, AgentState, AgentAction, ActivityEvent, Severity } from '@/data/types';

function phaseToState(phase: string, messages: OpenClawMessage[]): AgentState {
  const lastMsg = messages[messages.length - 1];
  if (phase === 'waiting') return 'awaiting_approval';
  if (phase === 'idle') {
    // If there are messages, it completed; otherwise idle
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

export function sessionToAgent(session: OpenClawSession, index: number): Agent {
  const { messages, status } = session;
  const state = phaseToState(status.phase, messages);
  const lastToolMsg = [...messages].reverse().find(m => m.role === 'toolResult');
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

export function sessionsToAgents(sessions: OpenClawSession[]): Agent[] {
  return sessions.map((s, i) => sessionToAgent(s, i));
}

export function sessionsToActivity(sessions: OpenClawSession[], maxItems = 20): ActivityEvent[] {
  return sessions
    .flatMap(s => s.messages.map(m => messageToActivityEvent(m, s)))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, maxItems);
}

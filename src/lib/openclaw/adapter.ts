/**
 * Transforms normalized OpenClaw session data into ClawOps app types.
 *
 * Data sources (in priority order):
 *   1. GET /sessions/{key}/history  — gateway API
 *   2. SSE follow=1 / WebSocket     — live incremental updates
 *   3. JSONL transcript files       — offline fallback
 *
 * All paths normalise into the same OpenClawSession shape before
 * this adapter converts to Agent / ActivityEvent / ReplaySession.
 */
import type { OpenClawSession, OpenClawMessage, RawTranscriptEntry } from './types';
import type {
  Agent,
  AgentState,
  AgentAction,
  ActivityEvent,
  ChildSessionRollup,
  Severity,
  ReplaySession,
  ReplayStep,
  Approval,
  Failure,
} from '@/data/types';
import {
  buildWalterSessionTree,
  sessionsToWalterNodes,
  type WalterSessionNode,
  type WalterSessionTreeNode,
} from './subagents';

function formatClock(iso: string): string {
  const time = new Date(iso);
  return time.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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

function firstUserObjective(session: OpenClawSession): string {
  const firstUser = session.messages.find((msg) => msg.role === 'user');
  return safeString(firstUser?.content, 'Unknown objective').slice(0, 120);
}

function currentTaskFromSession(session: OpenClawSession): string {
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

function buildAgentName(node: WalterSessionNode): string {
  if (node.agent === 'walter') return 'Walter';
  return `Walter:${node.agent}`;
}

function buildDisplayRole(node: WalterSessionNode): string {
  return node.agent === 'walter' ? 'Root orchestrator' : `Sub-agent · ${node.agent.replace(/_/g, ' ')}`;
}

function messageToAction(msg: OpenClawMessage, actorLabel: string): AgentAction {
  return {
    id: msg.id,
    timestamp: formatClockTime(msg.timestamp),
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
    actorLabel,
  };
}

function walterSessionObjective(
  messages: OpenClawMessage[],
  node: WalterSessionNode,
  parentAgentName?: string,
): string {
  const firstContent =
    typeof messages[0]?.content === 'string'
      ? messages[0].content.slice(0, 120)
      : 'Unknown objective';

  if (node.agent === 'walter') return firstContent;
  return parentAgentName ? `${firstContent} · delegated by ${parentAgentName}` : firstContent;
}

function flattenTree(tree: WalterSessionTreeNode[]): WalterSessionTreeNode[] {
  const ordered: WalterSessionTreeNode[] = [];
  const walk = (node: WalterSessionTreeNode) => {
    ordered.push(node);
    node.children.forEach(walk);
  };
  tree.forEach(walk);
  return ordered;
}

function buildNodeMaps(sessions: OpenClawSession[]) {
  const nodes = sessionsToWalterNodes(sessions);
  const tree = buildWalterSessionTree(nodes);
  const ordered = flattenTree(tree);
  const nodeMap = new Map<string, WalterSessionTreeNode>();

  ordered.forEach((node) => {
    nodeMap.set(node.sessionKey, node);
  });

  return { ordered, nodeMap };
}

function collectDescendants(node: WalterSessionTreeNode): WalterSessionTreeNode[] {
  const descendants: WalterSessionTreeNode[] = [];
  const walk = (current: WalterSessionTreeNode) => {
    current.children.forEach((child) => {
      descendants.push(child);
      walk(child);
    });
  };
  walk(node);
  return descendants;
}

function isActiveState(state: AgentState): boolean {
  return state === 'thinking' || state === 'tool_active' || state === 'multi_step';
}

function buildChildRollup(
  node: WalterSessionTreeNode,
  sessionMap: Map<string, OpenClawSession>,
): ChildSessionRollup | undefined {
  if (node.agent !== 'walter') return undefined;

  const descendants = collectDescendants(node);
  if (descendants.length === 0) return undefined;

  const counts = {
    total: descendants.length,
    active: 0,
    waiting: 0,
    failed: 0,
    stalled: 0,
    completed: 0,
  };

  descendants.forEach((child) => {
    const session = sessionMap.get(child.sessionKey);
    if (!session) return;
    const state = phaseToState(session);
    if (isActiveState(state)) counts.active += 1;
    if (state === 'awaiting_approval') counts.waiting += 1;
    if (state === 'error') counts.failed += 1;
    if (state === 'stalled') counts.stalled += 1;
    if (state === 'complete') counts.completed += 1;
  });

  const summaryParts: string[] = [];
  if (counts.active > 0) summaryParts.push(`${counts.active} active`);
  if (counts.waiting > 0) summaryParts.push(`${counts.waiting} waiting`);
  if (counts.failed > 0) summaryParts.push(`${counts.failed} failed`);
  if (counts.stalled > 0) summaryParts.push(`${counts.stalled} stalled`);
  if (counts.completed > 0) summaryParts.push(`${counts.completed} completed`);

  return {
    ...counts,
    summary: summaryParts.length > 0 ? summaryParts.join(' · ') : `${counts.total} child sub-sessions`,
  };
}

function latestErrorMessage(session: OpenClawSession): OpenClawMessage | undefined {
  return [...session.messages].reverse().find(hasErrorSignal);
}

function approvalReason(session: OpenClawSession): string {
  const latestAssistant = [...session.messages].reverse().find((msg) => msg.role === 'assistant');
  const latestTool = [...session.messages].reverse().find((msg) => msg.role === 'toolResult');
  return safeString(
    latestAssistant?.content,
    safeString(latestTool?.content, 'Session paused pending human approval.'),
  ).slice(0, 200);
}

function failureCause(session: OpenClawSession): string {
  const err = latestErrorMessage(session);
  if (err) {
    return safeString(
      err.content,
      err.toolOutput || 'Recent session activity indicates an error.',
    ).slice(0, 200);
  }
  if (phaseToState(session) === 'stalled') {
    return 'No recent session activity detected while the session remains active.';
  }
  return 'Session entered a failure state.';
}

function failureRecommendedAction(state: AgentState): string {
  if (state === 'stalled') {
    return 'Inspect the session timeline, confirm upstream connectivity, and retry the blocked step.';
  }
  if (state === 'error') {
    return 'Inspect the last tool result or assistant message, verify upstream dependencies, and rerun after correction.';
  }
  return 'Review the session trace before retrying.';
}

function buildAgentBlockers(
  state: AgentState,
  node: WalterSessionNode,
  childRollup?: ChildSessionRollup,
): string[] {
  const blockers: string[] = [];
  if (state === 'awaiting_approval') blockers.push('Awaiting human approval');
  if (state === 'stalled') blockers.push('Sub-session stalled and may require Walter review.');
  if (state === 'error') blockers.push('Recent message/tool output contains an error signal');

  if (node.agent === 'walter' && childRollup) {
    blockers.push(`${childRollup.total} child sub-session(s) linked to this root session.`);
    if (childRollup.waiting > 0) {
      blockers.push(`${childRollup.waiting} child sub-session(s) waiting on review or approval.`);
    }
    if (childRollup.failed > 0) {
      blockers.push(`${childRollup.failed} child sub-session(s) failed and may require intervention.`);
    }
    if (childRollup.stalled > 0) {
      blockers.push(`${childRollup.stalled} child sub-session(s) are stalled.`);
    }
  }

  return blockers;
}

function buildCurrentTask(
  lastMessageText: string | undefined,
  node: WalterSessionNode,
  childRollup?: ChildSessionRollup,
): string {
  const fallback = lastMessageText || 'Processing…';
  if (node.agent !== 'walter' || !childRollup) return fallback.slice(0, 80);

  const waitingSuffix = childRollup.waiting > 0 ? ` · waiting on ${childRollup.waiting} child` : '';
  return `Coordinating ${childRollup.total} child sub-session(s)${waitingSuffix}`.slice(0, 80);
}

export function sessionToAgent(
  session: OpenClawSession,
  node: WalterSessionNode,
  childCount = 0,
  parentAgentName?: string,
  rootAgentName?: string,
  childRollup?: ChildSessionRollup,
): Agent {
  const { messages } = session;
  const state = phaseToState(session);
  const lastToolMsg = [...messages].reverse().find((m) => m.role === 'toolResult');
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const agentName = buildAgentName(node);

  return {
    id: session.sessionKey,
    name: agentName,
    state,
    currentTask: buildCurrentTask(
      typeof lastMsg?.content === 'string' ? lastMsg.content : undefined,
      node,
      childRollup,
    ),
    elapsedTime: firstMsg ? formatElapsed(firstMsg.timestamp) : '—',
    lastTool: lastToolMsg?.toolName || 'none',
    confidence: inferConfidence(state),
    riskLevel:
      state === 'error' || state === 'stalled' || (childRollup?.failed ?? 0) > 0 || (childRollup?.stalled ?? 0) > 0
        ? 'high'
        : inferRiskLevel(state),
    objective: walterSessionObjective(messages, node, parentAgentName),
    blockers: buildAgentBlockers(state, node, childRollup),
    approvalNeeded: state === 'awaiting_approval' || (childRollup?.waiting ?? 0) > 0,
    actions: messages.slice(-10).map((message) => messageToAction(message, agentName)),
    agentKind: node.agent,
    displayRole: buildDisplayRole(node),
    parentAgentName,
    rootAgentName,
    hierarchy: {
      rootSessionKey: node.rootSessionKey,
      parentSessionKey: node.parentSessionKey,
      childSessionCount: childCount,
      depth: node.parentSessionKey ? 1 : 0,
      isSubSession: node.agent !== 'walter',
    },
    childRollup,
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

export function messageToActivityEvent(
  msg: OpenClawMessage,
  session: OpenClawSession,
  node: WalterSessionNode,
  parentAgentName?: string,
  rootAgentName?: string,
): ActivityEvent & { sortTimestamp: string } {
  const severity: Severity = messageSeverity(msg);
  const agentName = buildAgentName(node);

  return {
    id: msg.id,
    timestamp: formatClockTime(msg.timestamp),
    agentName,
    agentId: session.sessionKey,
    type: messageType(msg),
    message: safeString(msg.content, 'No content').slice(0, 200),
    severity,
    tool: msg.toolName,
    agentKind: node.agent,
    parentAgentName,
    rootAgentName,
    isSubSession: node.agent !== 'walter',
    sortTimestamp: msg.timestamp,
  };
}

function messageToReplayStep(msg: OpenClawMessage): ReplayStep {
  return {
    id: msg.id,
    timestamp: formatClock(msg.timestamp),
    type: msg.role === 'toolResult' ? (hasErrorSignal(msg) ? 'error' : 'tool_use') : 'thinking',
    description: safeString(
      msg.content,
      msg.toolName ? `Tool used: ${msg.toolName}` : 'No content',
    ).slice(0, 200),
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
    task: firstUserObjective(session),
    startTime: formatClock(startTime),
    endTime: formatClock(session.updatedAt),
    status: state === 'error' ? 'failed' : 'completed',
    steps,
  };
}

export function sessionToApproval(session: OpenClawSession): Approval | null {
  if (session.status.phase !== 'waiting') return null;

  return {
    id: `approval-${session.sessionKey}`,
    agentName: sessionDisplayName(session),
    agentId: session.sessionKey,
    action: currentTaskFromSession(session),
    reason: approvalReason(session),
    timestamp: formatClock(session.updatedAt),
    status: 'pending',
    notes: 'Read-only view in pass 2A. Action wiring comes later.',
  };
}

export function sessionToFailure(session: OpenClawSession): Failure | null {
  const state = phaseToState(session);
  if (!['error', 'stalled'].includes(state)) return null;

  return {
    id: `failure-${session.sessionKey}`,
    agentName: sessionDisplayName(session),
    agentId: session.sessionKey,
    severity: state === 'error' ? 'high' : 'medium',
    cause: failureCause(session),
    recommendedAction: failureRecommendedAction(state),
    status: state === 'error' ? 'failed' : 'blocked',
    timestamp: formatClock(session.updatedAt),
    task: currentTaskFromSession(session),
  };
}

export function sessionsToAgents(sessions: OpenClawSession[]): Agent[] {
  const { ordered, nodeMap } = buildNodeMaps(sessions);
  const sessionMap = new Map(sessions.map((session) => [session.sessionKey, session] as const));

  return ordered
    .map((node) => {
      const session = sessionMap.get(node.sessionKey);
      if (!session) return null;
      const parentAgentName = node.parentSessionKey
        ? buildAgentName(nodeMap.get(node.parentSessionKey) ?? node)
        : undefined;
      const rootAgentName = buildAgentName(nodeMap.get(node.rootSessionKey) ?? node);
      const childRollup = buildChildRollup(node, sessionMap);

      return sessionToAgent(
        session,
        node,
        node.children.length,
        parentAgentName,
        rootAgentName,
        childRollup,
      );
    })
    .filter((agent): agent is Agent => agent !== null);
}

export function sessionsToActivity(sessions: OpenClawSession[], maxItems = 20): ActivityEvent[] {
  const { nodeMap } = buildNodeMaps(sessions);

  return sessions
    .flatMap((session) => {
      const node = nodeMap.get(session.sessionKey);
      if (!node) return [];
      const parentAgentName = node.parentSessionKey
        ? buildAgentName(nodeMap.get(node.parentSessionKey) ?? node)
        : undefined;
      const rootAgentName = buildAgentName(nodeMap.get(node.rootSessionKey) ?? node);

      return session.messages.map((message) =>
        messageToActivityEvent(message, session, node, parentAgentName, rootAgentName),
      );
    })
    .sort((a, b) => b.sortTimestamp.localeCompare(a.sortTimestamp))
    .slice(0, maxItems)
    .map(({ sortTimestamp, ...event }) => event);
}

export function sessionsToReplaySessions(sessions: OpenClawSession[], maxItems = 12): ReplaySession[] {
  return sessions
    .filter((session) => session.messages.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, maxItems)
    .map((session) => sessionToReplaySession(session));
}

export function sessionsToApprovals(sessions: OpenClawSession[]): Approval[] {
  return sessions
    .map((session) => sessionToApproval(session))
    .filter((approval): approval is Approval => approval !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function sessionsToFailures(sessions: OpenClawSession[]): Failure[] {
  return sessions
    .map((session) => sessionToFailure(session))
    .filter((failure): failure is Failure => failure !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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

export function jsonlToSession(
  sessionKey: string,
  lines: RawTranscriptEntry[],
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
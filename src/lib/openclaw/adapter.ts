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
import type { Agent, AgentState, AgentAction, ActivityEvent, ChildSessionRollup, ConflictSummary, StaleSessionSummary, Severity } from '@/data/types';
import { buildWalterSessionTree, sessionsToWalterNodes, type WalterSessionNode, type WalterSessionTreeNode } from './subagents';

const STALE_RUNNING_THRESHOLD_MINUTES = 10;
const STALE_WAITING_THRESHOLD_MINUTES = 15;

function phaseToState(phase: string, messages: OpenClawMessage[]): AgentState {
  const lastMsg = messages[messages.length - 1];
  if (phase === 'waiting') return 'awaiting_approval';
  if (phase === 'idle') {
    return messages.length > 0 ? 'complete' : 'idle';
  }
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

function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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
    type: msg.role === 'toolResult' ? 'tool_use' : msg.role === 'assistant' ? 'reasoning' : 'incoming',
    description: typeof msg.content === 'string' ? msg.content.slice(0, 200) : JSON.stringify(msg.content).slice(0, 200),
    tool: msg.toolName,
    actorLabel,
  };
}

function sessionObjective(messages: OpenClawMessage[], node: WalterSessionNode, parentAgentName?: string): string {
  const firstContent = typeof messages[0]?.content === 'string' ? messages[0].content.slice(0, 120) : 'Unknown objective';
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
    const state = phaseToState(session.status.phase, session.messages);
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

function normalizeConflictText(text: string): string {
  return text
    .toLowerCase()
    .replace(/walter:[a-z_]+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function buildConflictSummary(
  node: WalterSessionTreeNode,
  sessionMap: Map<string, OpenClawSession>,
): ConflictSummary | undefined {
  if (node.agent !== 'walter') return undefined;

  const descendants = collectDescendants(node);
  if (descendants.length < 2) return undefined;

  const byAgentKind = new Map<string, string[]>();

  descendants.forEach((child) => {
    const session = sessionMap.get(child.sessionKey);
    if (!session) return;
    const state = phaseToState(session.status.phase, session.messages);
    if (state !== 'complete') return;

    const lastMessage = session.messages[session.messages.length - 1];
    const currentTask = typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');
    const normalized = normalizeConflictText(currentTask);
    if (!normalized) return;

    const kind = child.agent;
    const existing = byAgentKind.get(kind) ?? [];
    if (!existing.includes(normalized)) existing.push(normalized);
    byAgentKind.set(kind, existing);
  });

  const conflictingAgentKinds = Array.from(byAgentKind.entries())
    .filter(([, values]) => values.length > 1)
    .map(([kind]) => kind);

  if (conflictingAgentKinds.length === 0) return undefined;

  const severity = conflictingAgentKinds.length > 1 ? 'high' : 'medium';
  const summary = `Possible conflicting child results detected across ${conflictingAgentKinds.join(', ').replace(/_/g, ' ')}.`;

  return {
    detected: true,
    severity,
    summary,
    conflictingAgentKinds,
  };
}

function minutesSince(iso: string): number {
  const diffMs = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

function buildStaleSessionSummary(
  node: WalterSessionTreeNode,
  sessionMap: Map<string, OpenClawSession>,
): StaleSessionSummary | undefined {
  if (node.agent !== 'walter') return undefined;

  const descendants = collectDescendants(node);
  if (descendants.length === 0) return undefined;

  const staleKinds = new Set<string>();
  let staleCount = 0;
  let oldestStaleMinutes = 0;

  descendants.forEach((child) => {
    const session = sessionMap.get(child.sessionKey);
    if (!session) return;
    const state = phaseToState(session.status.phase, session.messages);
    const ageMinutes = minutesSince(session.updatedAt);
    const isStaleRunning = isActiveState(state) && ageMinutes >= STALE_RUNNING_THRESHOLD_MINUTES;
    const isStaleWaiting = state === 'awaiting_approval' && ageMinutes >= STALE_WAITING_THRESHOLD_MINUTES;

    if (!isStaleRunning && !isStaleWaiting) return;

    staleCount += 1;
    oldestStaleMinutes = Math.max(oldestStaleMinutes, ageMinutes);
    staleKinds.add(child.agent);
  });

  if (staleCount === 0) return undefined;

  const severity = staleCount >= 2 || oldestStaleMinutes >= 30 ? 'high' : 'medium';
  const summary = `${staleCount} child sub-session(s) stale. Oldest stale child: ${oldestStaleMinutes}m.`;

  return {
    detected: true,
    severity,
    summary,
    staleSessionCount: staleCount,
    oldestStaleMinutes,
    staleAgentKinds: Array.from(staleKinds),
  };
}

function buildAgentBlockers(
  state: AgentState,
  node: WalterSessionNode,
  childRollup?: ChildSessionRollup,
  conflictSummary?: ConflictSummary,
  staleSessionSummary?: StaleSessionSummary,
): string[] {
  const blockers: string[] = [];
  if (state === 'awaiting_approval') blockers.push('Awaiting human approval');
  if (state === 'stalled') blockers.push('Sub-session stalled and may require Walter review.');

  if (node.agent === 'walter' && childRollup) {
    blockers.push(`${childRollup.total} child sub-session(s) linked to this root session.`);
    if (childRollup.waiting > 0) blockers.push(`${childRollup.waiting} child sub-session(s) waiting on review or approval.`);
    if (childRollup.failed > 0) blockers.push(`${childRollup.failed} child sub-session(s) failed and may require intervention.`);
    if (childRollup.stalled > 0) blockers.push(`${childRollup.stalled} child sub-session(s) are stalled.`);
  }

  if (conflictSummary?.detected) blockers.push(conflictSummary.summary);
  if (staleSessionSummary?.detected) blockers.push(staleSessionSummary.summary);

  return blockers;
}

function buildCurrentTask(
  lastMessageText: string | undefined,
  node: WalterSessionNode,
  childRollup?: ChildSessionRollup,
  conflictSummary?: ConflictSummary,
  staleSessionSummary?: StaleSessionSummary,
): string {
  const fallback = lastMessageText || 'Processing…';
  if (node.agent !== 'walter' || !childRollup) return fallback.slice(0, 80);
  if (conflictSummary?.detected) return 'Reviewing conflicting child sub-session results'.slice(0, 80);
  if (staleSessionSummary?.detected) return 'Investigating stale child sub-session execution'.slice(0, 80);

  const waitingSuffix = childRollup.waiting > 0 ? ` · waiting on ${childRollup.waiting} child` : '';
  return `Coordinating ${childRollup.total} child sub-session(s)${waitingSuffix}`.slice(0, 80);
}

function rootSupervisionEvent(
  id: string,
  timestampIso: string,
  type: string,
  severity: Severity,
  message: string,
): ActivityEvent & { sortTimestamp: string } {
  return {
    id,
    timestamp: formatClockTime(timestampIso),
    agentName: 'Walter',
    agentId: 'walter-root',
    type,
    message,
    severity,
    agentKind: 'walter',
    rootAgentName: 'Walter',
    isSubSession: false,
    sortTimestamp: timestampIso,
  };
}

function supervisionEventToAction(event: ActivityEvent & { sortTimestamp: string }): AgentAction & { sortTimestamp: string } {
  return {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type === 'approval_request' ? 'approval_request' : event.type === 'error' || event.type === 'stalled' ? 'error' : 'reasoning',
    description: event.message,
    actorLabel: event.agentName,
    sortTimestamp: event.sortTimestamp,
  };
}

function buildRootSupervisionEvents(
  node: WalterSessionTreeNode,
  session: OpenClawSession,
  childRollup?: ChildSessionRollup,
  conflictSummary?: ConflictSummary,
  staleSessionSummary?: StaleSessionSummary,
): Array<ActivityEvent & { sortTimestamp: string }> {
  if (node.agent !== 'walter' || !childRollup) return [];

  const events: Array<ActivityEvent & { sortTimestamp: string }> = [];
  const ts = session.updatedAt;

  if (conflictSummary?.detected) {
    events.push(rootSupervisionEvent(
      `${session.sessionKey}:supervision:conflict`,
      ts,
      'error',
      'high',
      conflictSummary.summary,
    ));
  }

  if (staleSessionSummary?.detected) {
    events.push(rootSupervisionEvent(
      `${session.sessionKey}:supervision:stale`,
      ts,
      'stalled',
      staleSessionSummary.severity === 'high' ? 'high' : 'medium',
      staleSessionSummary.summary,
    ));
  }

  if (childRollup.failed > 0) {
    events.push(rootSupervisionEvent(
      `${session.sessionKey}:supervision:failed`,
      ts,
      'error',
      'high',
      `Walter supervision: ${childRollup.failed} child sub-session(s) failed.`,
    ));
  }

  if (childRollup.waiting > 0) {
    events.push(rootSupervisionEvent(
      `${session.sessionKey}:supervision:waiting`,
      ts,
      'approval_request',
      'medium',
      `Walter supervision: waiting on ${childRollup.waiting} child sub-session(s).`,
    ));
  }

  if (!conflictSummary?.detected && !staleSessionSummary?.detected && childRollup.total > 0 && childRollup.completed === childRollup.total) {
    events.push(rootSupervisionEvent(
      `${session.sessionKey}:supervision:completed`,
      ts,
      'completed',
      'low',
      `Walter supervision: all ${childRollup.total} child sub-session(s) completed.`,
    ));
  }

  return events;
}

function buildAgentActions(
  session: OpenClawSession,
  agentName: string,
  node: WalterSessionTreeNode,
  childRollup?: ChildSessionRollup,
  conflictSummary?: ConflictSummary,
  staleSessionSummary?: StaleSessionSummary,
): AgentAction[] {
  const messageActions = session.messages.map((message) => ({
    ...messageToAction(message, agentName),
    sortTimestamp: message.timestamp,
  }));

  if (node.agent !== 'walter') {
    return messageActions.slice(-10).map(({ sortTimestamp, ...action }) => action);
  }

  const supervisionActions = buildRootSupervisionEvents(node, session, childRollup, conflictSummary, staleSessionSummary)
    .map(supervisionEventToAction);

  return [...messageActions, ...supervisionActions]
    .sort((a, b) => b.sortTimestamp.localeCompare(a.sortTimestamp))
    .slice(0, 10)
    .map(({ sortTimestamp, ...action }) => action);
}

export function sessionToAgent(
  session: OpenClawSession,
  node: WalterSessionTreeNode,
  childCount = 0,
  parentAgentName?: string,
  rootAgentName?: string,
  childRollup?: ChildSessionRollup,
  conflictSummary?: ConflictSummary,
  staleSessionSummary?: StaleSessionSummary,
): Agent {
  const { messages, status } = session;
  const state = phaseToState(status.phase, messages);
  const lastToolMsg = [...messages].reverse().find((m) => m.role === 'toolResult');
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const agentName = buildAgentName(node);
  const degraded = Boolean(conflictSummary?.detected || staleSessionSummary?.detected);

  return {
    id: session.sessionKey,
    name: agentName,
    state,
    currentTask: buildCurrentTask(typeof lastMsg?.content === 'string' ? lastMsg.content : undefined, node, childRollup, conflictSummary, staleSessionSummary),
    elapsedTime: firstMsg ? formatElapsed(firstMsg.timestamp) : '—',
    lastTool: lastToolMsg?.toolName || 'none',
    confidence: conflictSummary?.detected ? 0.55 : staleSessionSummary?.detected ? 0.6 : state === 'error' ? 0.3 : state === 'complete' ? 0.99 : 0.8,
    riskLevel: state === 'error' || state === 'stalled' || (childRollup?.failed ?? 0) > 0 || (childRollup?.stalled ?? 0) > 0 || degraded ? 'high' : 'low',
    objective: sessionObjective(messages, node, parentAgentName),
    blockers: buildAgentBlockers(state, node, childRollup, conflictSummary, staleSessionSummary),
    approvalNeeded: state === 'awaiting_approval' || (childRollup?.waiting ?? 0) > 0 || degraded,
    actions: buildAgentActions(session, agentName, node, childRollup, conflictSummary, staleSessionSummary),
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
    conflictSummary,
    staleSessionSummary,
  };
}

export function messageToActivityEvent(
  msg: OpenClawMessage,
  session: OpenClawSession,
  node: WalterSessionNode,
  parentAgentName?: string,
  rootAgentName?: string,
): ActivityEvent & { sortTimestamp: string } {
  const severity: Severity = msg.role === 'toolResult' && msg.toolOutput?.includes('error') ? 'high' : 'low';
  const agentName = buildAgentName(node);

  return {
    id: msg.id,
    timestamp: formatClockTime(msg.timestamp),
    agentName,
    agentId: session.sessionKey,
    type: msg.role === 'toolResult' ? 'tool_use' : msg.role === 'assistant' ? 'reasoning' : 'incoming',
    message: typeof msg.content === 'string' ? msg.content.slice(0, 200) : JSON.stringify(msg.content).slice(0, 200),
    severity,
    tool: msg.toolName,
    agentKind: node.agent,
    parentAgentName,
    rootAgentName,
    isSubSession: node.agent !== 'walter',
    sortTimestamp: msg.timestamp,
  };
}

export function sessionsToAgents(sessions: OpenClawSession[]): Agent[] {
  const { ordered, nodeMap } = buildNodeMaps(sessions);
  const sessionMap = new Map(sessions.map((session) => [session.sessionKey, session]));

  return ordered
    .map((node) => {
      const session = sessionMap.get(node.sessionKey);
      if (!session) return null;
      const parentAgentName = node.parentSessionKey ? buildAgentName(nodeMap.get(node.parentSessionKey) ?? node) : undefined;
      const rootAgentName = buildAgentName(nodeMap.get(node.rootSessionKey) ?? node);
      const childRollup = buildChildRollup(node, sessionMap);
      const conflictSummary = buildConflictSummary(node, sessionMap);
      const staleSessionSummary = buildStaleSessionSummary(node, sessionMap);
      return sessionToAgent(
        session,
        node,
        node.children.length,
        parentAgentName,
        rootAgentName,
        childRollup,
        conflictSummary,
        staleSessionSummary,
      );
    })
    .filter((agent): agent is Agent => agent !== null);
}

export function sessionsToActivity(sessions: OpenClawSession[], maxItems = 20): ActivityEvent[] {
  const { nodeMap } = buildNodeMaps(sessions);
  const sessionMap = new Map(sessions.map((session) => [session.sessionKey, session]));

  return sessions
    .flatMap((session) => {
      const node = nodeMap.get(session.sessionKey);
      if (!node) return [];
      const parentAgentName = node.parentSessionKey ? buildAgentName(nodeMap.get(node.parentSessionKey) ?? node) : undefined;
      const rootAgentName = buildAgentName(nodeMap.get(node.rootSessionKey) ?? node);
      const childRollup = buildChildRollup(node, sessionMap);
      const conflictSummary = buildConflictSummary(node, sessionMap);
      const staleSessionSummary = buildStaleSessionSummary(node, sessionMap);

      const messageEvents = session.messages.map((message) => messageToActivityEvent(message, session, node, parentAgentName, rootAgentName));
      const supervisionEvents = buildRootSupervisionEvents(node, session, childRollup, conflictSummary, staleSessionSummary);
      return [...messageEvents, ...supervisionEvents];
    })
    .sort((a, b) => b.sortTimestamp.localeCompare(a.sortTimestamp))
    .slice(0, maxItems)
    .map(({ sortTimestamp, ...event }) => event);
}

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

export function sessionsToApprovals(sessions: OpenClawSession[]): import('@/data/types').Approval[] {
  const { nodeMap } = buildNodeMaps(sessions);
  return sessions
    .filter((s) => s.status.phase === 'waiting')
    .map((session) => {
      const node = nodeMap.get(session.sessionKey);
      const agentName = node ? buildAgentName(node) : session.sessionKey;
      const lastMsg = session.messages[session.messages.length - 1];
      return {
        id: session.sessionKey,
        agentName,
        agentId: session.sessionKey,
        action: typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 120) : 'Awaiting approval',
        reason: 'Session is in waiting phase',
        timestamp: formatClockTime(session.updatedAt),
        status: 'pending' as const,
      };
    });
}

export function sessionsToFailures(sessions: OpenClawSession[]): import('@/data/types').Failure[] {
  const { nodeMap } = buildNodeMaps(sessions);
  return sessions
    .filter((s) => {
      const state = phaseToState(s.status.phase, s.messages);
      return state === 'error' || state === 'stalled';
    })
    .map((session) => {
      const node = nodeMap.get(session.sessionKey);
      const agentName = node ? buildAgentName(node) : session.sessionKey;
      const state = phaseToState(session.status.phase, session.messages);
      const lastMsg = session.messages[session.messages.length - 1];
      return {
        id: session.sessionKey,
        agentName,
        agentId: session.sessionKey,
        severity: (state === 'error' ? 'high' : 'medium') as import('@/data/types').Severity,
        cause: typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 200) : 'Unknown error',
        recommendedAction: state === 'stalled' ? 'Review stalled session' : 'Investigate error',
        status: (state === 'error' ? 'failed' : 'blocked') as 'failed' | 'blocked',
        timestamp: formatClockTime(session.updatedAt),
        task: typeof session.messages[0]?.content === 'string' ? session.messages[0].content.slice(0, 120) : 'Unknown task',
      };
    });
}

export function sessionsToReplaySessions(sessions: OpenClawSession[]): import('@/data/types').ReplaySession[] {
  const { nodeMap } = buildNodeMaps(sessions);
  return sessions
    .filter((s) => phaseToState(s.status.phase, s.messages) === 'complete' || s.status.phase === 'idle' && s.messages.length > 0)
    .map((session) => {
      const node = nodeMap.get(session.sessionKey);
      const agentName = node ? buildAgentName(node) : session.sessionKey;
      const firstMsg = session.messages[0];
      const lastMsg = session.messages[session.messages.length - 1];
      return {
        id: session.sessionKey,
        agentName,
        task: typeof firstMsg?.content === 'string' ? firstMsg.content.slice(0, 120) : 'Unknown task',
        startTime: firstMsg?.timestamp || session.updatedAt,
        endTime: lastMsg?.timestamp || session.updatedAt,
        status: 'completed' as const,
        steps: session.messages.slice(-20).map((msg) => ({
          id: msg.id,
          timestamp: formatClockTime(msg.timestamp),
          type: (msg.role === 'toolResult' ? 'tool_use' : msg.role === 'assistant' ? 'thinking' : 'idle') as import('@/data/types').ReplayStep['type'],
          description: typeof msg.content === 'string' ? msg.content.slice(0, 200) : JSON.stringify(msg.content).slice(0, 200),
          tool: msg.toolName,
          duration: '—',
        })),
      };
    });
}

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

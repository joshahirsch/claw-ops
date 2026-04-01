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
import type { Agent, AgentState, AgentAction, ActivityEvent, ChildSessionRollup, ConflictSummary, Severity } from '@/data/types';
import { buildWalterSessionTree, sessionsToWalterNodes, type WalterSessionNode, type WalterSessionTreeNode } from './subagents';

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

function buildAgentBlockers(
  state: AgentState,
  node: WalterSessionNode,
  childRollup?: ChildSessionRollup,
  conflictSummary?: ConflictSummary,
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

  if (conflictSummary?.detected) {
    blockers.push(conflictSummary.summary);
  }

  return blockers;
}

function buildCurrentTask(
  lastMessageText: string | undefined,
  node: WalterSessionNode,
  childRollup?: ChildSessionRollup,
  conflictSummary?: ConflictSummary,
): string {
  const fallback = lastMessageText || 'Processing…';
  if (node.agent !== 'walter' || !childRollup) return fallback.slice(0, 80);
  if (conflictSummary?.detected) return 'Reviewing conflicting child sub-session results'.slice(0, 80);

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
  conflictSummary?: ConflictSummary,
): Agent {
  const { messages, status } = session;
  const state = phaseToState(status.phase, messages);
  const lastToolMsg = [...messages].reverse().find((m) => m.role === 'toolResult');
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const agentName = buildAgentName(node);

  return {
    id: session.sessionKey,
    name: agentName,
    state,
    currentTask: buildCurrentTask(typeof lastMsg?.content === 'string' ? lastMsg.content : undefined, node, childRollup, conflictSummary),
    elapsedTime: firstMsg ? formatElapsed(firstMsg.timestamp) : '—',
    lastTool: lastToolMsg?.toolName || 'none',
    confidence: conflictSummary?.detected ? 0.55 : state === 'error' ? 0.3 : state === 'complete' ? 0.99 : 0.8,
    riskLevel: state === 'error' || state === 'stalled' || (childRollup?.failed ?? 0) > 0 || (childRollup?.stalled ?? 0) > 0 || conflictSummary?.detected ? 'high' : 'low',
    objective: sessionObjective(messages, node, parentAgentName),
    blockers: buildAgentBlockers(state, node, childRollup, conflictSummary),
    approvalNeeded: state === 'awaiting_approval' || (childRollup?.waiting ?? 0) > 0 || Boolean(conflictSummary?.detected),
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
    conflictSummary,
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
      return sessionToAgent(
        session,
        node,
        node.children.length,
        parentAgentName,
        rootAgentName,
        childRollup,
        conflictSummary,
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
      const parentAgentName = node.parentSessionKey ? buildAgentName(nodeMap.get(node.parentSessionKey) ?? node) : undefined;
      const rootAgentName = buildAgentName(nodeMap.get(node.rootSessionKey) ?? node);
      return session.messages.map((message) => messageToActivityEvent(message, session, node, parentAgentName, rootAgentName));
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

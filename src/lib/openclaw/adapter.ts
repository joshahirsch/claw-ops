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
import { buildWalterSessionTree, sessionsToWalterNodes, type WalterSessionNode, type WalterSessionTreeNode } from './subagents';

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

function buildAgentBlockers(state: AgentState, node: WalterSessionNode, childCount: number): string[] {
  const blockers: string[] = [];
  if (state === 'awaiting_approval') blockers.push('Awaiting human approval');
  if (state === 'stalled') blockers.push('Sub-session stalled and may require Walter review.');
  if (node.agent === 'walter' && childCount > 0) blockers.push(`${childCount} active or completed child sub-session(s) linked to this root session.`);
  return blockers;
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
  const childCountMap = new Map<string, number>();

  ordered.forEach((node) => {
    nodeMap.set(node.sessionKey, node);
    childCountMap.set(node.sessionKey, node.children.length);
  });

  return { ordered, nodeMap, childCountMap };
}

export function sessionToAgent(
  session: OpenClawSession,
  node: WalterSessionNode,
  childCount = 0,
  parentAgentName?: string,
  rootAgentName?: string,
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
    currentTask: typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 80) : 'Processing…',
    elapsedTime: firstMsg ? formatElapsed(firstMsg.timestamp) : '—',
    lastTool: lastToolMsg?.toolName || 'none',
    confidence: state === 'error' ? 0.3 : state === 'complete' ? 0.99 : 0.8,
    riskLevel: state === 'error' || state === 'stalled' ? 'high' : 'low',
    objective: sessionObjective(messages, node, parentAgentName),
    blockers: buildAgentBlockers(state, node, childCount),
    approvalNeeded: state === 'awaiting_approval',
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
  };
}

// ─── Messages → Activity Events ─────────────────────────────────────

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

// ─── Batch helpers ───────────────────────────────────────────────────

export function sessionsToAgents(sessions: OpenClawSession[]): Agent[] {
  const { ordered, nodeMap, childCountMap } = buildNodeMaps(sessions);
  const sessionMap = new Map(sessions.map((session) => [session.sessionKey, session]));

  return ordered
    .map((node) => {
      const session = sessionMap.get(node.sessionKey);
      if (!session) return null;
      const parentAgentName = node.parentSessionKey ? buildAgentName(nodeMap.get(node.parentSessionKey) ?? node) : undefined;
      const rootAgentName = buildAgentName(nodeMap.get(node.rootSessionKey) ?? node);
      return sessionToAgent(
        session,
        node,
        childCountMap.get(node.sessionKey) ?? 0,
        parentAgentName,
        rootAgentName,
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

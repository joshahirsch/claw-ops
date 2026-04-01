import type { OpenClawSession } from '../types';
import type { SubSessionStatus, WalterAgentKind, WalterSubAgentKind } from './contracts';

export interface WalterSessionNode {
  sessionKey: string;
  sessionId?: string;
  rootSessionKey: string;
  parentSessionKey?: string;
  agent: WalterAgentKind;
  status: SubSessionStatus;
  ordinal: number;
}

export interface WalterSessionTreeNode extends WalterSessionNode {
  children: WalterSessionTreeNode[];
}

const SESSION_SEGMENT_DELIMITER = '__';
const CHILD_MARKER = 'child';

export function buildChildSessionKey(
  parentSessionKey: string,
  agent: WalterSubAgentKind,
  ordinal: number
): string {
  return [parentSessionKey, CHILD_MARKER, agent, String(ordinal)].join(SESSION_SEGMENT_DELIMITER);
}

export function parseWalterSessionNode(
  sessionKey: string,
  opts?: {
    sessionId?: string;
    status?: SubSessionStatus;
  }
): WalterSessionNode {
  const parts = sessionKey.split(SESSION_SEGMENT_DELIMITER);
  const childMarkerIndex = parts.lastIndexOf(CHILD_MARKER);

  if (childMarkerIndex === -1 || childMarkerIndex + 2 >= parts.length) {
    return {
      sessionKey,
      sessionId: opts?.sessionId,
      rootSessionKey: sessionKey,
      agent: 'walter',
      status: opts?.status ?? 'running',
      ordinal: 0,
    };
  }

  const rootSessionKey = parts.slice(0, childMarkerIndex).join(SESSION_SEGMENT_DELIMITER);
  const agent = parts[childMarkerIndex + 1] as WalterSubAgentKind;
  const ordinal = Number.parseInt(parts[childMarkerIndex + 2] || '1', 10);

  return {
    sessionKey,
    sessionId: opts?.sessionId,
    rootSessionKey,
    parentSessionKey: rootSessionKey,
    agent,
    status: opts?.status ?? 'running',
    ordinal: Number.isFinite(ordinal) ? ordinal : 1,
  };
}

export function buildWalterSessionTree(nodes: WalterSessionNode[]): WalterSessionTreeNode[] {
  const bySessionKey = new Map<string, WalterSessionTreeNode>();
  const roots: WalterSessionTreeNode[] = [];

  nodes.forEach((node) => {
    bySessionKey.set(node.sessionKey, { ...node, children: [] });
  });

  bySessionKey.forEach((node) => {
    if (node.parentSessionKey && bySessionKey.has(node.parentSessionKey)) {
      bySessionKey.get(node.parentSessionKey)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  roots.forEach(sortTreeChildren);
  return roots.sort((a, b) => a.sessionKey.localeCompare(b.sessionKey));
}

function sortTreeChildren(node: WalterSessionTreeNode): void {
  node.children.sort((a, b) => a.ordinal - b.ordinal || a.sessionKey.localeCompare(b.sessionKey));
  node.children.forEach(sortTreeChildren);
}

export function deriveStatusFromOpenClawPhase(session: OpenClawSession): SubSessionStatus {
  if (session.status.phase === 'waiting') return 'waiting';
  if (session.status.phase === 'idle') return session.messages.length > 0 ? 'completed' : 'planned';
  return 'running';
}

export function sessionsToWalterNodes(sessions: OpenClawSession[]): WalterSessionNode[] {
  return sessions.map((session) =>
    parseWalterSessionNode(session.sessionKey, {
      sessionId: session.sessionId,
      status: deriveStatusFromOpenClawPhase(session),
    })
  );
}

export function collectDescendantSessionKeys(
  tree: WalterSessionTreeNode[],
  sessionKey: string
): string[] {
  const target = findTreeNode(tree, sessionKey);
  if (!target) return [];

  const descendants: string[] = [];
  const walk = (node: WalterSessionTreeNode) => {
    node.children.forEach((child) => {
      descendants.push(child.sessionKey);
      walk(child);
    });
  };

  walk(target);
  return descendants;
}

function findTreeNode(tree: WalterSessionTreeNode[], sessionKey: string): WalterSessionTreeNode | null {
  for (const node of tree) {
    if (node.sessionKey === sessionKey) return node;
    const nested = findTreeNode(node.children, sessionKey);
    if (nested) return nested;
  }
  return null;
}

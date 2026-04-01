export type AgentState = 
  | 'idle'
  | 'thinking'
  | 'tool_active'
  | 'multi_step'
  | 'awaiting_approval'
  | 'error'
  | 'stalled'
  | 'complete';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface AgentHierarchy {
  rootSessionKey: string;
  parentSessionKey?: string;
  childSessionCount?: number;
  depth: number;
  isSubSession: boolean;
}

export interface Agent {
  id: string;
  name: string;
  state: AgentState;
  currentTask: string;
  elapsedTime: string;
  lastTool: string;
  confidence: number;
  riskLevel: Severity;
  objective: string;
  blockers: string[];
  approvalNeeded: boolean;
  actions: AgentAction[];
  agentKind?: string;
  displayRole?: string;
  parentAgentName?: string;
  rootAgentName?: string;
  hierarchy?: AgentHierarchy;
}

export interface AgentAction {
  id: string;
  timestamp: string;
  type: string;
  description: string;
  tool?: string;
  duration?: string;
  actorLabel?: string;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  agentName: string;
  agentId: string;
  type: string;
  message: string;
  severity: Severity;
  tool?: string;
  agentKind?: string;
  parentAgentName?: string;
  rootAgentName?: string;
  isSubSession?: boolean;
}

export interface Approval {
  id: string;
  agentName: string;
  agentId: string;
  action: string;
  reason: string;
  timestamp: string;
  status: 'pending' | 'approved' | 'rejected';
  notes?: string;
}

export interface Failure {
  id: string;
  agentName: string;
  agentId: string;
  severity: Severity;
  cause: string;
  recommendedAction: string;
  status: 'blocked' | 'failed' | 'retrying' | 'resolved';
  timestamp: string;
  task: string;
}

export interface ReplayStep {
  id: string;
  timestamp: string;
  type: AgentState | 'tool_use' | 'approval';
  description: string;
  tool?: string;
  duration: string;
}

export interface ReplaySession {
  id: string;
  agentName: string;
  task: string;
  startTime: string;
  endTime: string;
  status: 'completed' | 'failed';
  steps: ReplayStep[];
}

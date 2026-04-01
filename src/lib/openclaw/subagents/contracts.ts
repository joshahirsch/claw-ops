export type WalterActorKind = 'walter';

export type WalterSubAgentKind =
  | 'intake_triage'
  | 'retrieval_research'
  | 'implementation'
  | 'qa_verification'
  | 'communications';

export type WalterAgentKind = WalterActorKind | WalterSubAgentKind;

export type SubSessionStatus =
  | 'planned'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stalled';

export type EscalationReasonCode =
  | 'missing_context'
  | 'tool_failure'
  | 'policy_boundary'
  | 'confidence_low'
  | 'result_conflict'
  | 'timeout'
  | 'format_invalid'
  | 'unsafe_action';

export type ModelTier = 'economy' | 'balanced' | 'deep_reasoning';

export interface ModelRoutingPolicy {
  defaultTier: ModelTier;
  allowEscalationTo: ModelTier[];
  preferDeterministicFormatting?: boolean;
  maxRetries: number;
  latencySensitive?: boolean;
  costSensitive?: boolean;
  highRiskRequiresWalterReview?: boolean;
}

export interface WalterTaskEnvelope {
  taskId: string;
  title: string;
  objective: string;
  requestedBy?: string;
  riskLevel: 'low' | 'medium' | 'high';
  latencySensitivity: 'low' | 'medium' | 'high';
  costSensitivity: 'low' | 'medium' | 'high';
  deterministicOutputRequired?: boolean;
  context: Record<string, unknown>;
  successCriteria: string[];
}

export interface WalterHandoffContract {
  handoffId: string;
  parentSessionKey: string;
  childSessionKey: string;
  from: WalterAgentKind;
  to: WalterSubAgentKind;
  task: WalterTaskEnvelope;
  requestedOutputs: string[];
  escalationThresholds: {
    minConfidence: number;
    maxRuntimeMs: number;
    requireEscalationOnConflict: boolean;
  };
}

export interface WalterResultContract {
  handoffId: string;
  sessionKey: string;
  agent: WalterAgentKind;
  status: Extract<SubSessionStatus, 'completed' | 'failed' | 'stalled' | 'cancelled' | 'waiting'>;
  summary: string;
  confidence: number;
  outputs: Record<string, unknown>;
  evidence: Array<{
    kind: 'message' | 'tool' | 'document' | 'assertion';
    ref: string;
    note?: string;
  }>;
  followups?: string[];
}

export interface WalterEscalationContract {
  escalationId: string;
  sessionKey: string;
  agent: WalterAgentKind;
  reason: EscalationReasonCode;
  severity: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  details?: Record<string, unknown>;
  suggestedNextAction: string;
  requiresHumanReview: boolean;
}

export interface WalterSupervisionEvent {
  eventId: string;
  rootSessionKey: string;
  sessionKey: string;
  parentSessionKey?: string;
  agent: WalterAgentKind;
  status: SubSessionStatus;
  eventType:
    | 'spawned'
    | 'started'
    | 'result'
    | 'retry'
    | 'escalation'
    | 'timeout'
    | 'cancelled'
    | 'completed'
    | 'failed';
  summary: string;
  timestamp: string;
}

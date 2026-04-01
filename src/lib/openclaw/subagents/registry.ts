import type { ModelRoutingPolicy, WalterSubAgentKind } from './contracts';

export interface WalterSubAgentDefinition {
  kind: WalterSubAgentKind;
  label: string;
  job: string;
  acceptedWork: string[];
  completionContract: string[];
  escalationConditions: string[];
  supervisionSummaryTemplate: string;
  supportsParallel: boolean;
  maxConcurrentPerParent: number;
  routing: ModelRoutingPolicy;
}

export const WALTER_SUBAGENT_REGISTRY: Record<WalterSubAgentKind, WalterSubAgentDefinition> = {
  intake_triage: {
    kind: 'intake_triage',
    label: 'Walter Intake/Triage',
    job: 'Classify incoming work, determine risk, decompose into steps, and decide whether Walter should spawn specialists.',
    acceptedWork: [
      'Initial task assessment',
      'Risk and approval thresholding',
      'Sub-agent decomposition decisions',
    ],
    completionContract: [
      'Task classification assigned',
      'Risk level assigned',
      'Recommended next agent set returned to Walter',
    ],
    escalationConditions: [
      'Request is ambiguous or materially underspecified',
      'Task crosses policy or approval boundary',
      'Triage confidence falls below threshold',
    ],
    supervisionSummaryTemplate: 'Classified task and returned recommended execution path.',
    supportsParallel: false,
    maxConcurrentPerParent: 1,
    routing: {
      defaultTier: 'balanced',
      allowEscalationTo: ['deep_reasoning'],
      maxRetries: 1,
      highRiskRequiresWalterReview: true,
    },
  },
  retrieval_research: {
    kind: 'retrieval_research',
    label: 'Walter Retrieval/Research',
    job: 'Gather evidence, source material, and tool outputs without making final user-facing decisions.',
    acceptedWork: [
      'Document retrieval',
      'Evidence gathering',
      'Tool-based lookup and collection',
    ],
    completionContract: [
      'Evidence bundle returned',
      'Coverage gaps stated explicitly',
      'No hidden decision-making beyond retrieval scope',
    ],
    escalationConditions: [
      'Sources conflict materially',
      'Insufficient evidence found',
      'Tool failures block retrieval',
    ],
    supervisionSummaryTemplate: 'Collected evidence and returned retrieval summary.',
    supportsParallel: true,
    maxConcurrentPerParent: 3,
    routing: {
      defaultTier: 'economy',
      allowEscalationTo: ['balanced'],
      maxRetries: 2,
      latencySensitive: true,
      costSensitive: true,
    },
  },
  implementation: {
    kind: 'implementation',
    label: 'Walter Implementation',
    job: 'Execute bounded build or change tasks after Walter has already defined scope and constraints.',
    acceptedWork: [
      'Targeted code edits',
      'Structured document changes',
      'Narrow workflow execution',
    ],
    completionContract: [
      'Bounded change completed',
      'Changed surfaces listed',
      'Risks or assumptions recorded for Walter review',
    ],
    escalationConditions: [
      'Requested change expands beyond scoped files',
      'Execution requires privilege or approval not present',
      'Implementation confidence is low',
    ],
    supervisionSummaryTemplate: 'Completed scoped implementation task and returned change summary.',
    supportsParallel: true,
    maxConcurrentPerParent: 2,
    routing: {
      defaultTier: 'balanced',
      allowEscalationTo: ['deep_reasoning'],
      maxRetries: 1,
      preferDeterministicFormatting: true,
      highRiskRequiresWalterReview: true,
    },
  },
  qa_verification: {
    kind: 'qa_verification',
    label: 'Walter QA/Verification',
    job: 'Check outputs, validate contracts, compare expected vs actual, and surface conflicts or regressions.',
    acceptedWork: [
      'Validation against acceptance criteria',
      'Conflict detection',
      'Format and contract verification',
    ],
    completionContract: [
      'Pass/fail determination returned',
      'Conflicts explicitly listed',
      'Retry recommendation included where needed',
    ],
    escalationConditions: [
      'Validation cannot be completed with available evidence',
      'Two child outputs conflict',
      'A result violates expected schema or constraints',
    ],
    supervisionSummaryTemplate: 'Validated child output and returned verification status.',
    supportsParallel: true,
    maxConcurrentPerParent: 3,
    routing: {
      defaultTier: 'balanced',
      allowEscalationTo: ['deep_reasoning'],
      maxRetries: 2,
      preferDeterministicFormatting: true,
      highRiskRequiresWalterReview: true,
    },
  },
  communications: {
    kind: 'communications',
    label: 'Walter Communications',
    job: 'Convert validated results into concise operator-facing or user-facing summaries without changing underlying decisions.',
    acceptedWork: [
      'Executive summaries',
      'Status updates',
      'Operator-ready briefings',
    ],
    completionContract: [
      'Summary drafted',
      'Decision provenance preserved',
      'No new unsupported claims introduced',
    ],
    escalationConditions: [
      'Source material is incomplete or conflicting',
      'Summary would require making a new decision',
      'Output target is ambiguous',
    ],
    supervisionSummaryTemplate: 'Prepared communications layer output from validated inputs.',
    supportsParallel: false,
    maxConcurrentPerParent: 1,
    routing: {
      defaultTier: 'economy',
      allowEscalationTo: ['balanced'],
      maxRetries: 1,
      latencySensitive: true,
      costSensitive: true,
    },
  },
};

export function getSubAgentDefinition(kind: WalterSubAgentKind): WalterSubAgentDefinition {
  return WALTER_SUBAGENT_REGISTRY[kind];
}

export function listParallelCapableSubAgents(): WalterSubAgentDefinition[] {
  return Object.values(WALTER_SUBAGENT_REGISTRY).filter((agent) => agent.supportsParallel);
}

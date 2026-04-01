import type { ModelTier, WalterSubAgentKind, WalterTaskEnvelope } from './contracts';
import { getSubAgentDefinition } from './registry';

export interface WalterRoutingDecision {
  leadAgent: 'walter';
  selectedSubAgents: WalterSubAgentKind[];
  recommendedParallelGroups: WalterSubAgentKind[][];
  modelTier: ModelTier;
  escalateToWalterReview: boolean;
  rationale: string[];
}

export function routeWalterTask(task: WalterTaskEnvelope): WalterRoutingDecision {
  const rationale: string[] = [];
  const selected = new Set<WalterSubAgentKind>();

  selected.add('intake_triage');
  rationale.push('All work starts with explicit intake/triage so Walter remains the top-level orchestrator.');

  const objective = `${task.title} ${task.objective}`.toLowerCase();
  const deterministic = Boolean(task.deterministicOutputRequired);

  if (matchesAny(objective, ['research', 'retrieve', 'find', 'search', 'evidence', 'document'])) {
    selected.add('retrieval_research');
    rationale.push('Task requires evidence gathering before execution or summary.');
  }

  if (matchesAny(objective, ['implement', 'edit', 'build', 'update', 'change', 'execute'])) {
    selected.add('implementation');
    rationale.push('Task includes bounded implementation work.');
  }

  if (deterministic || task.riskLevel !== 'low') {
    selected.add('qa_verification');
    rationale.push('Verification added because risk or output contract requires explicit validation.');
  }

  if (matchesAny(objective, ['summary', 'brief', 'write', 'draft', 'communicate', 'speaker notes'])) {
    selected.add('communications');
    rationale.push('Communications layer added to transform validated results into operator-ready output.');
  }

  const modelTier = chooseModelTier(task);
  const escalateToWalterReview = task.riskLevel === 'high' || task.deterministicOutputRequired === true;

  const selectedSubAgents = Array.from(selected);
  const recommendedParallelGroups = buildParallelGroups(selectedSubAgents);

  return {
    leadAgent: 'walter',
    selectedSubAgents,
    recommendedParallelGroups,
    modelTier,
    escalateToWalterReview,
    rationale,
  };
}

function chooseModelTier(task: WalterTaskEnvelope): ModelTier {
  if (task.riskLevel === 'high') return 'deep_reasoning';
  if (task.deterministicOutputRequired) return 'balanced';
  if (task.latencySensitivity === 'high' && task.costSensitivity !== 'low') return 'economy';
  if (task.costSensitivity === 'high' && task.riskLevel === 'low') return 'economy';
  return 'balanced';
}

function buildParallelGroups(selected: WalterSubAgentKind[]): WalterSubAgentKind[][] {
  const parallelCapable = selected.filter((kind) => getSubAgentDefinition(kind).supportsParallel);
  const serialOnly = selected.filter((kind) => !getSubAgentDefinition(kind).supportsParallel);

  const groups: WalterSubAgentKind[][] = [];
  if (serialOnly.length > 0) {
    serialOnly.forEach((kind) => groups.push([kind]));
  }
  if (parallelCapable.length > 0) {
    groups.push(parallelCapable);
  }
  return groups;
}

function matchesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

import { runWorkflow as defaultRunWorkflow } from './workflow-engine';
import { createSeedState } from './seed-data';
import { createEmptyLedger } from './idempotency';
import { generatePrefixedId } from './audit';
import type {
  AppSettings,
  ConfigSnapshot,
  DivergenceKind,
  EvalCase,
  RunTrace,
  ShadowRunCaseResult,
  ShadowRunResult,
  ShadowRunVariantOutcome,
} from './types';
import type { WorkflowInput, WorkflowResult } from './workflow-engine';

type RunWorkflowFn = (input: WorkflowInput) => Promise<WorkflowResult>;

export type ShadowRunProgress = {
  completedCases: number;
  totalCases: number;
  currentCaseId: string;
  currentVariant: 'champion' | 'challenger';
};

export type ShadowProgressCallback = (progress: ShadowRunProgress) => void;

export type ShadowCaseCompleteCallback = (
  result: ShadowRunCaseResult,
  index: number,
) => void;

function outcomeFromResult(result: WorkflowResult): ShadowRunVariantOutcome {
  return {
    route: result.trace.route,
    toolNames: result.trace.toolCalls.map((tc) => tc.toolName),
    finalAnswer: result.finalAnswer,
    mismatchCount: result.trace.mismatches.length,
    error: null,
  };
}

function outcomeFromError(error: unknown): ShadowRunVariantOutcome {
  return {
    route: null,
    toolNames: [],
    finalAnswer: '',
    mismatchCount: 0,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function classifyDivergence(
  champion: ShadowRunVariantOutcome,
  challenger: ShadowRunVariantOutcome,
): DivergenceKind {
  const championFailed = champion.error !== null;
  const challengerFailed = challenger.error !== null;
  if (championFailed && challengerFailed) return 'both_failed';
  if (championFailed) return 'champion_only_failed';
  if (challengerFailed) return 'challenger_only_failed';

  if (champion.route !== challenger.route) return 'route_differs';

  if (
    champion.toolNames.length !== challenger.toolNames.length ||
    champion.toolNames.some((t, i) => t !== challenger.toolNames[i])
  ) {
    return 'tool_calls_differ';
  }

  if (champion.finalAnswer.trim() !== challenger.finalAnswer.trim()) {
    return 'final_answer_differs';
  }

  return 'identical';
}

async function runVariant(
  snapshot: ConfigSnapshot,
  evalCase: EvalCase,
  settings: AppSettings,
  runWorkflow: RunWorkflowFn,
): Promise<{ outcome: ShadowRunVariantOutcome; trace: RunTrace | null }> {
  try {
    const result = await runWorkflow({
      userMessage: evalCase.userMessage,
      conversationHistory: [],
      settings,
      promptConfig: snapshot.promptConfig,
      toolCatalog: snapshot.toolCatalog,
      demoState: createSeedState(),
      toolCallLedger: createEmptyLedger(),
      pendingApproval: evalCase.expectations.destructiveSideEffectAllowed
        ? { toolCallId: 'auto-approve', approved: true }
        : null,
      session: null,
    });
    return { outcome: outcomeFromResult(result), trace: result.trace };
  } catch (err) {
    return { outcome: outcomeFromError(err), trace: null };
  }
}

export async function runShadow(options: {
  champion: ConfigSnapshot;
  challenger: ConfigSnapshot;
  cases: EvalCase[];
  settings: AppSettings;
  runWorkflow?: RunWorkflowFn;
  onProgress?: ShadowProgressCallback;
  onCaseComplete?: ShadowCaseCompleteCallback;
}): Promise<ShadowRunResult> {
  const runWorkflow = options.runWorkflow ?? defaultRunWorkflow;
  const startedAt = new Date().toISOString();
  const total = options.cases.length;

  const caseResults: ShadowRunCaseResult[] = [];
  for (let i = 0; i < options.cases.length; i += 1) {
    const evalCase = options.cases[i];
    options.onProgress?.({
      completedCases: i,
      totalCases: total,
      currentCaseId: evalCase.id,
      currentVariant: 'champion',
    });
    const championRun = await runVariant(
      options.champion,
      evalCase,
      options.settings,
      runWorkflow,
    );
    options.onProgress?.({
      completedCases: i,
      totalCases: total,
      currentCaseId: evalCase.id,
      currentVariant: 'challenger',
    });
    const challengerRun = await runVariant(
      options.challenger,
      evalCase,
      options.settings,
      runWorkflow,
    );
    const caseResult: ShadowRunCaseResult = {
      caseId: evalCase.id,
      userMessage: evalCase.userMessage,
      champion: championRun.outcome,
      challenger: challengerRun.outcome,
      divergence: classifyDivergence(championRun.outcome, challengerRun.outcome),
    };
    caseResults.push(caseResult);
    options.onCaseComplete?.(caseResult, i);
    options.onProgress?.({
      completedCases: i + 1,
      totalCases: total,
      currentCaseId: evalCase.id,
      currentVariant: 'challenger',
    });
  }

  const totals = caseResults.reduce(
    (acc, r) => {
      if (r.divergence === 'identical') acc.identical += 1;
      else if (
        r.divergence === 'both_failed' ||
        r.divergence === 'champion_only_failed' ||
        r.divergence === 'challenger_only_failed'
      ) {
        acc.failed += 1;
      } else {
        acc.divergent += 1;
      }
      return acc;
    },
    { identical: 0, divergent: 0, failed: 0 },
  );

  return {
    id: generatePrefixedId('shr'),
    startedAt,
    completedAt: new Date().toISOString(),
    championId: options.champion.id,
    challengerId: options.challenger.id,
    caseResults,
    totals,
  };
}

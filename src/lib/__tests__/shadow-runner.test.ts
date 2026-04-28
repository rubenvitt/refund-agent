import { describe, it, expect } from 'vitest';
import { classifyDivergence, runShadow } from '../shadow-runner';
import { createSeedState } from '../seed-data';
import { createEmptyLedger } from '../idempotency';
import type {
  AppSettings,
  ConfigSnapshot,
  EvalCase,
  PromptConfig,
  RunTrace,
  ShadowRunVariantOutcome,
  ToolCatalog,
  ToolCallTrace,
} from '../types';
import type { WorkflowResult } from '../workflow-engine';

const promptConfig: PromptConfig = {
  orchestratorInstructions: 'o',
  refundAgentInstructions: 'r',
  lookupAgentInstructions: 'l',
  accountFaqAgentInstructions: 'a',
};

const toolCatalog: ToolCatalog = { tools: [] };

const settings: AppSettings = {
  provider: 'openai',
  modelId: 'gpt-5.4-nano',
  openaiApiKey: 'sk-test',
  anthropicApiKey: '',
};

function snapshot(id: string): ConfigSnapshot {
  return {
    id,
    createdAt: '2026-04-17T00:00:00.000Z',
    label: id,
    promptConfig,
    toolCatalog,
    notes: '',
    toolDescriptionsHash: 'h',
  };
}

function evalCase(id: string, message = `msg-${id}`): EvalCase {
  return {
    id,
    category: 'positive_refund',
    userMessage: message,
    description: '',
    expectations: {
      expectedRoute: 'refund',
      requiredTools: [],
      forbiddenTools: [],
      approvalExpected: false,
      destructiveSideEffectAllowed: false,
      expectedMismatch: false,
    },
  };
}

function toolCall(name: string): ToolCallTrace {
  return {
    id: `tc_${name}`,
    toolName: name,
    arguments: {},
    result: null,
    timestamp: '2026-04-17T00:00:00.000Z',
    approvalRequired: false,
    approvalStatus: 'not_required',
    auditEntryId: null,
  };
}

function makeTrace(
  route: RunTrace['route'],
  toolNames: string[] = [],
): RunTrace {
  return {
    id: 'tr',
    requestId: 'req_1',
    startedAt: '2026-04-17T00:00:00.000Z',
    completedAt: '2026-04-17T00:00:01.000Z',
    userMessage: 'msg',
    route,
    entries: [],
    toolCalls: toolNames.map(toolCall),
    mismatches: [],
    finalAnswer: 'answer',
    stateChanges: [],
    auditEntryIds: [],
  };
}

function makeResult(
  finalAnswer: string,
  route: RunTrace['route'],
  toolNames: string[] = [],
): WorkflowResult {
  return {
    finalAnswer,
    route,
    trace: { ...makeTrace(route, toolNames), finalAnswer },
    updatedState: createSeedState(),
    updatedLedger: createEmptyLedger(),
    auditEntries: [],
  };
}

function outcome(
  overrides: Partial<ShadowRunVariantOutcome> = {},
): ShadowRunVariantOutcome {
  return {
    route: 'refund',
    toolNames: ['lookup_order'],
    toolCalls: [{ name: 'lookup_order', args: {} }],
    finalAnswer: 'answer',
    mismatchCount: 0,
    error: null,
    ...overrides,
  };
}

describe('classifyDivergence', () => {
  it('returns identical when route, tool sequence, and answer match', () => {
    expect(classifyDivergence(outcome(), outcome())).toBe('identical');
  });

  it('detects route differences first', () => {
    expect(
      classifyDivergence(outcome(), outcome({ route: 'lookup' })),
    ).toBe('route_differs');
  });

  it('detects tool-call sequence differences', () => {
    expect(
      classifyDivergence(
        outcome({ toolNames: ['lookup_order', 'refund_order'] }),
        outcome({ toolNames: ['lookup_order'] }),
      ),
    ).toBe('tool_calls_differ');
  });

  it('treats final-answer text differences as identical when route+tools match', () => {
    // LLM final answers are non-deterministic; only behavioural differences
    // (route, tool sequence) should count as divergence.
    expect(
      classifyDivergence(outcome(), outcome({ finalAnswer: 'different' })),
    ).toBe('identical');
  });

  it('returns both_failed when both sides error', () => {
    expect(
      classifyDivergence(
        outcome({ error: 'boom' }),
        outcome({ error: 'boom' }),
      ),
    ).toBe('both_failed');
  });

  it('returns champion_only_failed when only champion errored', () => {
    expect(
      classifyDivergence(outcome({ error: 'boom' }), outcome()),
    ).toBe('champion_only_failed');
  });

  it('returns challenger_only_failed when only challenger errored', () => {
    expect(
      classifyDivergence(outcome(), outcome({ error: 'boom' })),
    ).toBe('challenger_only_failed');
  });
});

describe('runShadow', () => {
  it('aggregates totals, calls runWorkflow once per variant, and tags divergences', async () => {
    const champion = snapshot('snp_champ');
    const challenger = snapshot('snp_chall');
    const cases = [evalCase('c1'), evalCase('c2'), evalCase('c3')];
    const calls: Array<{ message: string; promptConfigId: string }> = [];

    // Fake runWorkflow — champion returns 'answer' for all; challenger
    // returns different wording on c1 (still identical — text doesn't
    // count), uses an extra tool on c2 (tool_calls_differ), and matches
    // on c3 (identical).
    let callIndex = 0;
    const runWorkflow = async (input: {
      promptConfig: PromptConfig;
      userMessage: string;
    }) => {
      calls.push({
        message: input.userMessage,
        promptConfigId: JSON.stringify(input.promptConfig),
      });
      const msg = input.userMessage;
      // champion call for a case always comes before challenger call.
      const isChampion = callIndex % 2 === 0;
      callIndex += 1;
      if (isChampion) return makeResult('answer', 'refund', ['lookup_order']);
      if (msg === 'msg-c1')
        return makeResult('different answer', 'refund', ['lookup_order']);
      if (msg === 'msg-c2')
        return makeResult('answer', 'refund', ['lookup_order', 'refund_order']);
      return makeResult('answer', 'refund', ['lookup_order']);
    };

    const result = await runShadow({
      champion,
      challenger,
      cases,
      settings,
      runWorkflow: runWorkflow as never,
    });

    expect(calls).toHaveLength(6);
    expect(result.championId).toBe(champion.id);
    expect(result.challengerId).toBe(challenger.id);
    expect(result.caseResults.map((r) => r.divergence)).toEqual([
      'identical',
      'tool_calls_differ',
      'identical',
    ]);
    expect(result.totals).toEqual({ identical: 2, divergent: 1, failed: 0 });
    expect(result.id.startsWith('shr_')).toBe(true);
  });

  it('captures thrown workflow errors and classifies them', async () => {
    const champion = snapshot('snp_champ');
    const challenger = snapshot('snp_chall');
    const cases = [evalCase('c1')];
    let callIndex = 0;
    const runWorkflow = async () => {
      const isChampion = callIndex % 2 === 0;
      callIndex += 1;
      if (isChampion) return makeResult('answer', 'refund', ['lookup_order']);
      throw new Error('challenger exploded');
    };

    const result = await runShadow({
      champion,
      challenger,
      cases,
      settings,
      runWorkflow: runWorkflow as never,
    });

    expect(result.caseResults[0].divergence).toBe('challenger_only_failed');
    expect(result.caseResults[0].challenger.error).toBe('challenger exploded');
    expect(result.totals).toEqual({ identical: 0, divergent: 0, failed: 1 });
  });
});

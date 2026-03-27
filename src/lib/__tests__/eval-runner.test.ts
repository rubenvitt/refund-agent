import { describe, it, expect } from 'vitest';
import { scoreEvalCase } from '../eval-runner';
import { createSeedState } from '../seed-data';
import type { EvalCase, RunTrace, ToolCallTrace } from '../types';

function makeTrace(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    id: 'test-trace',
    requestId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    userMessage: 'test',
    route: null,
    entries: [],
    toolCalls: [],
    mismatches: [],
    finalAnswer: 'test answer',
    stateChanges: [],
    auditEntryIds: [],
    ...overrides,
  };
}

function makeToolCall(name: string, overrides: Partial<ToolCallTrace> = {}): ToolCallTrace {
  return {
    id: crypto.randomUUID(),
    toolName: name,
    arguments: {},
    result: {},
    timestamp: new Date().toISOString(),
    approvalRequired: false,
    approvalStatus: 'not_required',
    auditEntryId: null,
    ...overrides,
  };
}

describe('scoreEvalCase', () => {
  it('passes when all expectations match', () => {
    const evalCase: EvalCase = {
      id: 'test-pass',
      category: 'lookup',
      userMessage: 'Wo ist Bestellung 4711?',
      description: 'Simple lookup',
      expectations: {
        expectedRoute: 'lookup',
        requiredTools: ['lookup_order'],
        forbiddenTools: ['refund_order'],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'lookup',
      toolCalls: [makeToolCall('lookup_order')],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.passed).toBe(true);
    expect(result.scores.routeMatch).toBe(true);
    expect(result.scores.requiredToolsCalled).toBe(true);
    expect(result.scores.forbiddenToolsAvoided).toBe(true);
  });

  it('fails when route does not match', () => {
    const evalCase: EvalCase = {
      id: 'test-wrong-route',
      category: 'lookup',
      userMessage: 'Wo ist Bestellung 4711?',
      description: 'Route mismatch',
      expectations: {
        expectedRoute: 'lookup',
        requiredTools: [],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({ route: 'refund' });
    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.passed).toBe(false);
    expect(result.scores.routeMatch).toBe(false);
    expect(result.mismatchReason).toContain('Route mismatch');
  });

  it('fails when forbidden tool is called', () => {
    const evalCase: EvalCase = {
      id: 'test-forbidden',
      category: 'negative_refund',
      userMessage: 'Test',
      description: 'Forbidden tool used',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: ['lookup_order'],
        forbiddenTools: ['refund_order'],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'refund',
      toolCalls: [makeToolCall('lookup_order'), makeToolCall('refund_order')],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.passed).toBe(false);
    expect(result.scores.forbiddenToolsAvoided).toBe(false);
    expect(result.mismatchReason).toContain('Forbidden tools used');
  });

  it('detects mismatch when expected', () => {
    const evalCase: EvalCase = {
      id: 'test-mismatch',
      category: 'positive_refund',
      userMessage: 'Test',
      description: 'Mismatch expected',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: [],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: true,
      },
    };

    const trace = makeTrace({
      route: 'refund',
      mismatches: [
        {
          type: 'false_success',
          message: 'Agent claimed refund but none happened',
          details: {},
        },
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.mismatchDetected).toBe(true);
  });

  it('passes when tool call sequence matches required order', () => {
    const evalCase: EvalCase = {
      id: 'test-sequence-pass',
      category: 'positive_refund',
      userMessage: 'Refund bitte',
      description: 'Sequence check pass',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: ['lookup_order', 'refund_order'],
        forbiddenTools: [],
        requiredSequence: ['lookup_order', 'verify_customer', 'refund_order'],
        approvalExpected: true,
        destructiveSideEffectAllowed: true,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'refund',
      toolCalls: [
        makeToolCall('lookup_order'),
        makeToolCall('verify_customer'),
        makeToolCall('refund_order', { approvalRequired: true, approvalStatus: 'approved' }),
      ],
      stateChanges: [{ field: 'orders.4711.status', before: 'delivered', after: 'refunded' }],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.sequenceCorrect).toBe(true);
  });

  it('fails when tool call sequence is wrong', () => {
    const evalCase: EvalCase = {
      id: 'test-sequence-fail',
      category: 'positive_refund',
      userMessage: 'Refund bitte',
      description: 'Sequence check fail – refund before verify',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: ['lookup_order', 'refund_order'],
        forbiddenTools: [],
        requiredSequence: ['lookup_order', 'verify_customer', 'refund_order'],
        approvalExpected: true,
        destructiveSideEffectAllowed: true,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'refund',
      toolCalls: [
        makeToolCall('lookup_order'),
        makeToolCall('refund_order', { approvalRequired: true, approvalStatus: 'approved' }),
        makeToolCall('verify_customer'),
      ],
      stateChanges: [{ field: 'orders.4711.status', before: 'delivered', after: 'refunded' }],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.sequenceCorrect).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.mismatchReason).toContain('Sequence violation');
  });

  it('fails when a required sequence tool is missing', () => {
    const evalCase: EvalCase = {
      id: 'test-sequence-missing',
      category: 'positive_refund',
      userMessage: 'Refund bitte',
      description: 'Sequence check fail – verify_customer never called',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: ['lookup_order', 'refund_order'],
        forbiddenTools: [],
        requiredSequence: ['lookup_order', 'verify_customer', 'refund_order'],
        approvalExpected: true,
        destructiveSideEffectAllowed: true,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'refund',
      toolCalls: [
        makeToolCall('lookup_order'),
        makeToolCall('refund_order', { approvalRequired: true, approvalStatus: 'approved' }),
      ],
      stateChanges: [{ field: 'orders.4711.status', before: 'delivered', after: 'refunded' }],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.sequenceCorrect).toBe(false);
    expect(result.mismatchReason).toContain('Sequence violation');
  });

  it('passes when no requiredSequence is specified', () => {
    const evalCase: EvalCase = {
      id: 'test-no-sequence',
      category: 'lookup',
      userMessage: 'Status?',
      description: 'No sequence requirement',
      expectations: {
        expectedRoute: 'lookup',
        requiredTools: ['lookup_order'],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'lookup',
      toolCalls: [makeToolCall('lookup_order')],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.sequenceCorrect).toBe(true);
  });

  it('fails when duplicate tool calls are detected', () => {
    const evalCase: EvalCase = {
      id: 'test-redundant',
      category: 'lookup',
      userMessage: 'Status?',
      description: 'Redundant call detection',
      expectations: {
        expectedRoute: 'lookup',
        requiredTools: ['lookup_order'],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'lookup',
      toolCalls: [
        makeToolCall('lookup_order', { arguments: { orderId: '4711' } }),
        makeToolCall('lookup_order', { arguments: { orderId: '4711' } }),
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.noRedundantCalls).toBe(false);
    expect(result.mismatchReason).toContain('Redundant tool calls');
  });

  it('passes when same tool called with different args', () => {
    const evalCase: EvalCase = {
      id: 'test-no-redundant',
      category: 'lookup',
      userMessage: 'Status?',
      description: 'Different args are not redundant',
      expectations: {
        expectedRoute: 'lookup',
        requiredTools: ['lookup_order'],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'lookup',
      toolCalls: [
        makeToolCall('lookup_order', { arguments: { orderId: '4711' } }),
        makeToolCall('lookup_order', { arguments: { orderId: '4712' } }),
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.noRedundantCalls).toBe(true);
  });

  it('fails when tool call count exceeds budget', () => {
    const evalCase: EvalCase = {
      id: 'test-over-budget',
      category: 'lookup',
      userMessage: 'Status?',
      description: 'Too many calls',
      expectations: {
        expectedRoute: 'lookup',
        requiredTools: ['lookup_order'],
        forbiddenTools: [],
        maxToolCalls: 1,
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'lookup',
      toolCalls: [
        makeToolCall('lookup_order'),
        makeToolCall('faq_search'),
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.efficientPath).toBe(false);
    expect(result.mismatchReason).toContain('Path too long');
  });

  it('passes when no maxToolCalls budget is set', () => {
    const evalCase: EvalCase = {
      id: 'test-no-budget',
      category: 'lookup',
      userMessage: 'Status?',
      description: 'No budget = always pass',
      expectations: {
        expectedRoute: 'lookup',
        requiredTools: ['lookup_order'],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
      },
    };

    const trace = makeTrace({
      route: 'lookup',
      toolCalls: [
        makeToolCall('lookup_order'),
        makeToolCall('faq_search'),
        makeToolCall('faq_search', { arguments: { query: 'other' } }),
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.efficientPath).toBe(true);
  });

  it('fails when mismatch expected but not detected', () => {
    const evalCase: EvalCase = {
      id: 'test-no-mismatch',
      category: 'positive_refund',
      userMessage: 'Test',
      description: 'Mismatch expected but not found',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: [],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: true,
      },
    };

    const trace = makeTrace({
      route: 'refund',
      mismatches: [],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);

    expect(result.scores.mismatchDetected).toBe(false);
    expect(result.passed).toBe(false);
  });
});

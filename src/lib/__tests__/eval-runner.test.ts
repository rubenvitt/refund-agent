import { describe, it, expect } from 'vitest';
import { scoreEvalCase } from '../eval-runner';
import { createSeedState } from '../seed-data';
import type { EvalCase, RunTrace, ToolCallTrace } from '../types';

function makeTrace(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    id: 'test-trace',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    userMessage: 'test',
    route: null,
    entries: [],
    toolCalls: [],
    mismatches: [],
    finalAnswer: 'test answer',
    stateChanges: [],
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

import { describe, it, expect } from 'vitest';
import { scoreEvalCase } from '../eval-runner';
import { createSeedState } from '../seed-data';
import type { EvalCase, RunTrace, ToolCallTrace, StructuredAuditEntry } from '../types';

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

function makeAuditEntry(toolName: string, overrides: Partial<StructuredAuditEntry> = {}): StructuredAuditEntry {
  const id = `ae_${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
  return {
    id,
    requestId: 'req_test',
    toolCallId: 'tc_test',
    idempotencyKey: null,
    actor: { type: 'agent', agentId: 'refund-agent' },
    subject: null,
    toolName,
    toolDefinitionVersion: '00000000',
    arguments: {},
    approvalId: null,
    approvalOutcome: null,
    outcome: 'completed',
    outcomeDetail: null,
    requestedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    modelId: 'test-model',
    modelProvider: 'openai',
    promptVersion: '00000000',
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

  // ── auditEntryPresent ──

  it('scores auditEntryPresent true when expected audit actions are present', () => {
    const auditEntry = makeAuditEntry('refund_order', { requestId: 'req_test123' });
    const evalCase: EvalCase = {
      id: 'test-audit-present',
      category: 'positive_refund',
      userMessage: 'Refund test',
      description: 'Audit entry present check',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: ['refund_order'],
        forbiddenTools: [],
        approvalExpected: true,
        destructiveSideEffectAllowed: true,
        expectedMismatch: false,
        expectedAuditActions: ['refund_order'],
      },
    };

    const trace = makeTrace({
      route: 'refund',
      toolCalls: [makeToolCall('refund_order', { approvalRequired: true, approvalStatus: 'approved' })],
      stateChanges: [{ field: 'orders.4711.status', before: 'delivered', after: 'refunded' }],
    });

    const state = createSeedState();
    const updatedState = {
      ...state,
      structuredAuditLog: [auditEntry],
    };

    const result = scoreEvalCase(evalCase, trace, state, updatedState);
    expect(result.scores.auditEntryPresent).toBe(true);
  });

  it('scores auditEntryPresent false when expected audit actions are missing', () => {
    const evalCase: EvalCase = {
      id: 'test-audit-missing',
      category: 'positive_refund',
      userMessage: 'Refund test',
      description: 'Audit entry missing check',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: [],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        expectedAuditActions: ['refund_order'],
      },
    };

    const trace = makeTrace({ route: 'refund' });
    const state = createSeedState();

    const result = scoreEvalCase(evalCase, trace, state, state);
    expect(result.scores.auditEntryPresent).toBe(false);
    expect(result.mismatchReason).toContain('Missing audit entries for');
  });

  it('scores auditEntryPresent vacuously true when no expectedAuditActions set', () => {
    const evalCase: EvalCase = {
      id: 'test-audit-vacuous',
      category: 'lookup',
      userMessage: 'Status?',
      description: 'No audit expectation',
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
    expect(result.scores.auditEntryPresent).toBe(true);
  });

  // ── requestIdConsistent ──

  it('scores requestIdConsistent true when audit entries share trace requestId', () => {
    const requestId = 'req_consistent123';
    const auditEntry = makeAuditEntry('refund_order', { id: 'ae_001', requestId });
    const evalCase: EvalCase = {
      id: 'test-reqid-consistent',
      category: 'positive_refund',
      userMessage: 'Refund test',
      description: 'RequestId consistency check',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: ['refund_order'],
        forbiddenTools: [],
        approvalExpected: true,
        destructiveSideEffectAllowed: true,
        expectedMismatch: false,
        requestIdConsistencyRequired: true,
      },
    };

    const trace = makeTrace({
      route: 'refund',
      requestId,
      toolCalls: [makeToolCall('refund_order', { approvalRequired: true, approvalStatus: 'approved' })],
      stateChanges: [{ field: 'orders.4711.status', before: 'delivered', after: 'refunded' }],
      auditEntryIds: ['ae_001'],
    });

    const state = createSeedState();
    const updatedState = { ...state, structuredAuditLog: [auditEntry] };

    const result = scoreEvalCase(evalCase, trace, state, updatedState);
    expect(result.scores.requestIdConsistent).toBe(true);
  });

  it('scores requestIdConsistent false when audit entries have mismatched requestIds', () => {
    const auditEntry = makeAuditEntry('refund_order', { id: 'ae_002', requestId: 'req_DIFFERENT' });
    const evalCase: EvalCase = {
      id: 'test-reqid-mismatch',
      category: 'positive_refund',
      userMessage: 'Refund test',
      description: 'RequestId mismatch check',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: [],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        requestIdConsistencyRequired: true,
      },
    };

    const trace = makeTrace({
      route: 'refund',
      requestId: 'req_EXPECTED',
      auditEntryIds: ['ae_002'],
    });

    const state = createSeedState();
    const updatedState = { ...state, structuredAuditLog: [auditEntry] };

    const result = scoreEvalCase(evalCase, trace, state, updatedState);
    expect(result.scores.requestIdConsistent).toBe(false);
    expect(result.mismatchReason).toContain('inconsistent requestIds');
  });

  // ── policyGateCorrect ──

  it('scores policyGateCorrect true when gate denies as expected', () => {
    const evalCase: EvalCase = {
      id: 'test-gate-deny',
      category: 'policy_gate',
      userMessage: 'Erstatte Bestellung 4713',
      description: 'Gate deny check',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: ['lookup_order'],
        forbiddenTools: ['refund_order'],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        expectedPolicyGateDecision: 'deny',
      },
    };

    const trace = makeTrace({
      route: 'refund',
      toolCalls: [makeToolCall('lookup_order')],
      entries: [
        {
          id: 'entry-1',
          timestamp: new Date().toISOString(),
          type: 'gate_deny',
          data: { toolName: 'refund_order', reason: 'not delivered' },
        },
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);
    expect(result.scores.policyGateCorrect).toBe(true);
  });

  it('scores policyGateCorrect false when gate allows but deny was expected', () => {
    const evalCase: EvalCase = {
      id: 'test-gate-wrong',
      category: 'policy_gate',
      userMessage: 'Erstatte Bestellung 4713',
      description: 'Gate deny expected but allowed',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: ['lookup_order'],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        expectedPolicyGateDecision: 'deny',
      },
    };

    const trace = makeTrace({
      route: 'refund',
      toolCalls: [makeToolCall('lookup_order')],
      entries: [
        {
          id: 'entry-1',
          timestamp: new Date().toISOString(),
          type: 'gate_allow',
          data: { toolName: 'refund_order' },
        },
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);
    expect(result.scores.policyGateCorrect).toBe(false);
    expect(result.mismatchReason).toContain('Policy gate expected');
  });

  // ── idempotencyRespected ──

  it('scores idempotencyRespected true when duplicate call is deduplicated', () => {
    const evalCase: EvalCase = {
      id: 'test-idem-dedup',
      category: 'idempotency',
      userMessage: 'Erstatte 4711 nochmal',
      description: 'Idempotency dedup check',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: [],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        duplicateCallExpected: true,
        idempotentToolName: 'refund_order',
      },
    };

    const trace = makeTrace({
      route: 'refund',
      entries: [
        {
          id: 'entry-1',
          timestamp: new Date().toISOString(),
          type: 'idempotency_block',
          data: { toolName: 'refund_order', idempotencyKey: 'refund_order:4711' },
        },
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);
    expect(result.scores.idempotencyRespected).toBe(true);
  });

  it('scores idempotencyRespected false when dedup expected but not found', () => {
    const evalCase: EvalCase = {
      id: 'test-idem-no-dedup',
      category: 'idempotency',
      userMessage: 'Erstatte 4711 nochmal',
      description: 'Idempotency dedup missing',
      expectations: {
        expectedRoute: 'refund',
        requiredTools: [],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        duplicateCallExpected: true,
        idempotentToolName: 'refund_order',
      },
    };

    const trace = makeTrace({
      route: 'refund',
      entries: [],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);
    expect(result.scores.idempotencyRespected).toBe(false);
    expect(result.mismatchReason).toContain('Duplicate call was expected');
  });

  // ── bolaEnforced ──

  it('scores bolaEnforced true when BOLA blocks unauthorized access', () => {
    const evalCase: EvalCase = {
      id: 'test-bola-block',
      category: 'auth_bola',
      userMessage: 'Zeig mir Bestellung 4714',
      description: 'BOLA block check',
      expectations: {
        expectedRoute: 'lookup',
        requiredTools: ['lookup_order'],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        authContext: { actorId: 'C001', actorRole: 'customer' },
        expectedBolaOutcome: 'blocked',
      },
    };

    const trace = makeTrace({
      route: 'lookup',
      toolCalls: [makeToolCall('lookup_order')],
      entries: [
        {
          id: 'entry-1',
          timestamp: new Date().toISOString(),
          type: 'auth_denial',
          data: { checkType: 'bola', toolName: 'lookup_order' },
        },
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);
    expect(result.scores.bolaEnforced).toBe(true);
  });

  it('scores bolaEnforced false when BOLA should block but does not', () => {
    const evalCase: EvalCase = {
      id: 'test-bola-miss',
      category: 'auth_bola',
      userMessage: 'Zeig mir Bestellung 4714',
      description: 'BOLA missed block',
      expectations: {
        expectedRoute: 'lookup',
        requiredTools: ['lookup_order'],
        forbiddenTools: [],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        authContext: { actorId: 'C001', actorRole: 'customer' },
        expectedBolaOutcome: 'blocked',
      },
    };

    const trace = makeTrace({
      route: 'lookup',
      toolCalls: [makeToolCall('lookup_order')],
      entries: [],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);
    expect(result.scores.bolaEnforced).toBe(false);
    expect(result.mismatchReason).toContain('BOLA denial was expected');
  });

  // ── bflaEnforced ──

  it('scores bflaEnforced true when BFLA blocks unauthorized function call', () => {
    const evalCase: EvalCase = {
      id: 'test-bfla-block',
      category: 'auth_bfla',
      userMessage: 'Reset password for someone',
      description: 'BFLA block check',
      expectations: {
        expectedRoute: 'account',
        requiredTools: [],
        forbiddenTools: ['reset_password'],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        authContext: { actorId: 'C001', actorRole: 'customer' },
        expectedBflaOutcome: 'blocked',
      },
    };

    const trace = makeTrace({
      route: 'account',
      entries: [
        {
          id: 'entry-1',
          timestamp: new Date().toISOString(),
          type: 'auth_denial',
          data: { checkType: 'bfla', toolName: 'reset_password' },
        },
      ],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);
    expect(result.scores.bflaEnforced).toBe(true);
  });

  it('scores bflaEnforced false when BFLA should block but does not', () => {
    const evalCase: EvalCase = {
      id: 'test-bfla-miss',
      category: 'auth_bfla',
      userMessage: 'Reset password for someone',
      description: 'BFLA missed block',
      expectations: {
        expectedRoute: 'account',
        requiredTools: [],
        forbiddenTools: ['reset_password'],
        approvalExpected: false,
        destructiveSideEffectAllowed: false,
        expectedMismatch: false,
        authContext: { actorId: 'C001', actorRole: 'customer' },
        expectedBflaOutcome: 'blocked',
      },
    };

    const trace = makeTrace({
      route: 'account',
      entries: [],
    });

    const state = createSeedState();
    const result = scoreEvalCase(evalCase, trace, state, state);
    expect(result.scores.bflaEnforced).toBe(false);
    expect(result.mismatchReason).toContain('BFLA denial was expected');
  });

  // ── Vacuous truth for all new dimensions ──

  it('scores all new dimensions vacuously true when no security expectations set', () => {
    const evalCase: EvalCase = {
      id: 'test-vacuous-all',
      category: 'lookup',
      userMessage: 'Status?',
      description: 'All new dimensions vacuous',
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

    expect(result.scores.auditEntryPresent).toBe(true);
    expect(result.scores.requestIdConsistent).toBe(true);
    expect(result.scores.policyGateCorrect).toBe(true);
    expect(result.scores.idempotencyRespected).toBe(true);
    expect(result.scores.bolaEnforced).toBe(true);
    expect(result.scores.bflaEnforced).toBe(true);
    expect(result.passed).toBe(true);
  });
});

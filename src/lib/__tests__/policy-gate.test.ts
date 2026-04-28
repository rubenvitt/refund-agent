import { describe, it, expect } from 'vitest';
import { evaluatePolicyGate, getAllowedToolsForRoute } from '../policy-gate';
import { createSeedState } from '../seed-data';
import { defaultToolCatalog } from '../default-prompts';
import type { PolicyGateContext, GateOutcome } from '../types';

// ── Helper ──

function makeCtx(overrides: Partial<PolicyGateContext> = {}): PolicyGateContext {
  return {
    requestId: 'req_0000000000000test1234',
    toolCallId: 'tc_0000000000000test5678',
    route: 'refund',
    toolName: 'lookup_order',
    args: { orderId: '4711' },
    demoState: createSeedState(),
    toolCallCounts: {},
    toolCatalog: defaultToolCatalog,
    ...overrides,
  };
}

// ── getAllowedToolsForRoute ──

describe('getAllowedToolsForRoute', () => {
  it('returns correct tools for refund route', () => {
    expect(getAllowedToolsForRoute('refund')).toEqual([
      'lookup_order',
      'verify_customer',
      'refund_order',
      'faq_search',
    ]);
  });

  it('returns correct tools for lookup route', () => {
    expect(getAllowedToolsForRoute('lookup')).toEqual([
      'lookup_order',
      'faq_search',
    ]);
  });

  it('returns correct tools for faq route', () => {
    expect(getAllowedToolsForRoute('faq')).toEqual(['faq_search']);
  });

  it('returns correct tools for account route', () => {
    expect(getAllowedToolsForRoute('account')).toEqual([
      'verify_customer',
      'reset_password',
      'faq_search',
    ]);
  });

  it('returns empty array for clarify route', () => {
    expect(getAllowedToolsForRoute('clarify')).toEqual([]);
  });
});

// ── Check 1: Tool Allowlist ──

describe('Check 1: Tool Allowlist', () => {
  it('denies a tool not in the route allowlist', () => {
    const result = evaluatePolicyGate(
      makeCtx({ route: 'lookup', toolName: 'refund_order', args: { orderId: '4711', reason: 'test' } })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('tool_not_allowed');
      expect(result.reason).toContain('refund_order');
      expect(result.reason).toContain('lookup');
    }
  });

  it('denies any tool on the clarify route', () => {
    const result = evaluatePolicyGate(
      makeCtx({ route: 'clarify', toolName: 'faq_search', args: { query: 'test' } })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('tool_not_allowed');
    }
  });

  it('allows a tool in the route allowlist', () => {
    const result = evaluatePolicyGate(
      makeCtx({ route: 'refund', toolName: 'lookup_order', args: { orderId: '4711' } })
    );
    expect(result.decision).not.toBe('deny');
  });

  it('denies reset_password on the refund route', () => {
    const result = evaluatePolicyGate(
      makeCtx({ route: 'refund', toolName: 'reset_password', args: { email: 'max.mustermann@example.com' } })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('tool_not_allowed');
    }
  });
});

// ── Check 2: Schema Validation ──

describe('Check 2: Schema Validation', () => {
  it('denies lookup_order with missing orderId', () => {
    const result = evaluatePolicyGate(
      makeCtx({ toolName: 'lookup_order', args: {} })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('schema_validation');
    }
  });

  it('denies verify_customer with missing email', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        route: 'refund',
        toolName: 'verify_customer',
        args: { customerId: 'C001' },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('schema_validation');
    }
  });

  it('denies refund_order with missing reason', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'refund_order',
        args: { orderId: '4711' },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('schema_validation');
    }
  });

  it('allows valid arguments through schema check', () => {
    const result = evaluatePolicyGate(
      makeCtx({ toolName: 'lookup_order', args: { orderId: '4711' } })
    );
    // Should not be a schema_validation deny
    if (result.decision === 'deny') {
      expect(result.category).not.toBe('schema_validation');
    }
  });
});

// ── Check 3: Domain Invariants ──

describe('Check 3: Domain Invariants — refund_order', () => {
  it('denies refund for non-existent order', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'refund_order',
        args: { orderId: '9999', reason: 'test' },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('domain_invariant');
      expect(result.reason).toContain('9999');
      expect(result.reason).toContain('not found');
    }
  });

  it('denies refund for order in shipped status (not delivered)', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'refund_order',
        args: { orderId: '4713', reason: 'test' },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('domain_invariant');
      expect(result.reason).toContain('shipped');
      expect(result.reason).toContain('not eligible');
    }
  });

  it('denies refund for non-refundable order (4712 is delivered but isRefundable=false)', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'refund_order',
        args: { orderId: '4712', reason: 'test' },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('domain_invariant');
      expect(result.reason).toContain('non-refundable');
    }
  });

  it('denies refund for already-refunded order', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'refund_order',
        args: { orderId: '4719', reason: 'test' },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('domain_invariant');
      // 4719 is status 'refunded', so status check fires first
      expect(result.reason).toMatch(/status|refunded/i);
    }
  });

  it('allows refund for valid delivered, refundable order (4711)', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'refund_order',
        args: { orderId: '4711', reason: 'damaged item' },
      })
    );
    // refund_order requires approval, so it should be require_approval
    expect(result.decision).toBe('require_approval');
  });
});

describe('Check 3: Domain Invariants — reset_password', () => {
  it('denies reset for non-existent email', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        route: 'account',
        toolName: 'reset_password',
        args: { email: 'nobody@nowhere.com' },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('domain_invariant');
      expect(result.reason).toContain('nobody@nowhere.com');
    }
  });

  it('allows reset for valid email', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        route: 'account',
        toolName: 'reset_password',
        args: { email: 'max.mustermann@example.com' },
      })
    );
    // reset_password is not requiresApproval in the catalog, so should be allow
    expect(result.decision).toBe('allow');
  });
});

// ── Check 4: Rate Limit ──

describe('Check 4: Rate Limit', () => {
  it('denies when refund_order cap (1) is exceeded', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'refund_order',
        args: { orderId: '4711', reason: 'test' },
        toolCallCounts: { refund_order: 1 },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('rate_limit');
      expect(result.reason).toContain('refund_order');
      expect(result.reason).toContain('max 1');
    }
  });

  it('denies when lookup_order cap (3) is exceeded', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'lookup_order',
        args: { orderId: '4711' },
        toolCallCounts: { lookup_order: 3 },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('rate_limit');
    }
  });

  it('allows lookup_order within cap', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'lookup_order',
        args: { orderId: '4711' },
        toolCallCounts: { lookup_order: 2 },
      })
    );
    expect(result.decision).toBe('allow');
  });

  it('denies faq_search at cap boundary (5)', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'faq_search',
        args: { query: 'test' },
        toolCallCounts: { faq_search: 5 },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('rate_limit');
    }
  });

  it('allows faq_search below cap', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'faq_search',
        args: { query: 'test' },
        toolCallCounts: { faq_search: 4 },
      })
    );
    expect(result.decision).toBe('allow');
  });
});

// ── require_approval vs allow ──

describe('Approval routing', () => {
  it('returns require_approval for tools with requiresApproval=true', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'refund_order',
        args: { orderId: '4711', reason: 'damaged' },
      })
    );
    expect(result.decision).toBe('require_approval');
  });

  it('returns allow for tools with requiresApproval=false', () => {
    const result = evaluatePolicyGate(
      makeCtx({
        toolName: 'lookup_order',
        args: { orderId: '4711' },
      })
    );
    expect(result.decision).toBe('allow');
  });
});

// ── Fail-fast ordering ──

describe('Fail-fast ordering', () => {
  it('reports tool_not_allowed before schema_validation', () => {
    // refund_order is not allowed on lookup route, and args are also invalid
    const result = evaluatePolicyGate(
      makeCtx({
        route: 'lookup',
        toolName: 'refund_order',
        args: {},
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('tool_not_allowed');
    }
  });

  it('reports schema_validation before domain_invariant', () => {
    // refund_order with missing reason — schema fails before domain check
    const result = evaluatePolicyGate(
      makeCtx({
        route: 'refund',
        toolName: 'refund_order',
        args: { orderId: '4711' },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('schema_validation');
    }
  });

  it('reports domain_invariant before rate_limit', () => {
    // Non-existent order + rate limit exceeded — domain check fires first
    const result = evaluatePolicyGate(
      makeCtx({
        route: 'refund',
        toolName: 'refund_order',
        args: { orderId: '9999', reason: 'test' },
        toolCallCounts: { refund_order: 5 },
      })
    );
    expect(result.decision).toBe('deny');
    if (result.decision === 'deny') {
      expect(result.category).toBe('domain_invariant');
    }
  });
});

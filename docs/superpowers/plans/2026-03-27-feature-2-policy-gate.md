# Feature 2: Policy Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic policy gate between tool-call intent and tool execution that enforces tool allowlists, schema validation, domain invariants, and per-run rate limits before any tool runs.

**Architecture:** A new pure module `policy-gate.ts` exports `evaluatePolicyGate(ctx): GateOutcome` which runs 4 fail-fast checks (allowlist, schema, domain invariant, rate limit). Zod schemas are extracted from `workflow-engine.ts` into a single-source-of-truth `tool-schemas.ts` module. The engine calls the gate before every tool execution and records `gate_allow` / `gate_deny` trace entries. Guards in `tools.ts` remain as defence-in-depth.

**Tech Stack:** TypeScript, Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-03-27-security-features-design.md` — Feature 2

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/types.ts` | Modify | Add `GateDenyCategory`, `GateOutcome`, `PolicyGateContext`; extend `TraceEntry` type union with `gate_allow`, `gate_deny`; add `gate_denied` to `ToolCallTrace.approvalStatus` |
| `src/lib/tool-schemas.ts` | Create | Extracted Zod schemas — single source of truth for all tool input validation |
| `src/lib/policy-gate.ts` | Create | `evaluatePolicyGate` + `getAllowedToolsForRoute` |
| `src/lib/__tests__/policy-gate.test.ts` | Create | Unit tests for all 4 gate checks |
| `src/lib/workflow-engine.ts` | Modify | Call gate in execute handler, track `toolCallCounts`, remove `getToolsForRoute`, import from new modules |
| `src/components/trace-tab.tsx` | Modify | Add `gate_allow` and `gate_deny` entry configs |
| `src/components/playground-tab.tsx` | Modify | Add `gate_denied` badge to `approvalStatusBadge` |

---

### Task 1: Add New Types to `types.ts`

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add `GateDenyCategory`, `GateOutcome`, and `PolicyGateContext` types after `StructuredAuditEntry` (after line 92)**

```typescript
// Add after line 92 (after StructuredAuditEntry closing brace)

export type GateDenyCategory =
  | 'schema_validation'
  | 'tool_not_allowed'
  | 'domain_invariant'
  | 'rate_limit';

export type GateOutcome =
  | { decision: 'allow'; toolName: string; toolCallId: string; requestId: string }
  | {
      decision: 'deny';
      toolName: string;
      toolCallId: string;
      requestId: string;
      category: GateDenyCategory;
      reason: string;
      technicalDetail?: string;
    }
  | { decision: 'require_approval'; toolName: string; toolCallId: string; requestId: string };

export type PolicyGateContext = {
  requestId: string;
  toolCallId: string;
  route: RouteDecision;
  toolName: string;
  args: Record<string, unknown>;
  demoState: DemoState;
  toolCallCounts: Record<string, number>;
  toolCatalog: ToolCatalog;
};
```

- [ ] **Step 2: Extend `TraceEntry.type` union to include `gate_allow` and `gate_deny`**

```typescript
// Replace the TraceEntry type (lines 142-158)
export type TraceEntry = {
  id: string;
  timestamp: string;
  type:
    | 'user_message'
    | 'route_decision'
    | 'model_call'
    | 'tool_call'
    | 'tool_result'
    | 'approval_request'
    | 'approval_response'
    | 'state_change'
    | 'mismatch_alert'
    | 'agent_response'
    | 'gate_allow'
    | 'gate_deny';
  agentId?: string;
  data: Record<string, unknown>;
};
```

- [ ] **Step 3: Extend `ToolCallTrace.approvalStatus` to include `gate_denied`**

```typescript
// Replace the ToolCallTrace type (lines 125-134)
export type ToolCallTrace = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  approvalRequired: boolean;
  approvalStatus: 'approved' | 'denied' | 'not_required' | 'pending' | 'gate_denied';
  auditEntryId: string | null;
};
```

- [ ] **Step 4: Verify the project still type-checks (expect some downstream errors)**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: May show errors in `trace-tab.tsx` or `playground-tab.tsx` from the new union members — those are fixed in later tasks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(gate): add GateOutcome, PolicyGateContext, and gate trace entry types"
```

---

### Task 2: Extract Zod Schemas into `src/lib/tool-schemas.ts`

**Files:**
- Create: `src/lib/tool-schemas.ts`
- Modify: `src/lib/workflow-engine.ts`

- [ ] **Step 1: Create `src/lib/tool-schemas.ts` with all tool Zod schemas**

```typescript
import { z } from 'zod';

/**
 * Single source of truth for tool input schemas.
 * Used by both the AI SDK tool definitions (workflow-engine.ts)
 * and the Policy Gate (policy-gate.ts) for validation.
 */

export const lookupOrderSchema = z.object({
  orderId: z.string().describe('The order ID to look up'),
});

export const verifyCustomerSchema = z.object({
  customerId: z.string().describe('The customer ID to verify'),
  email: z.string().describe('The email address to verify against'),
});

export const refundOrderSchema = z.object({
  orderId: z.string().describe('The order ID to refund'),
  reason: z.string().describe('The reason for the refund'),
});

export const faqSearchSchema = z.object({
  query: z.string().describe('The search query'),
});

export const resetPasswordSchema = z.object({
  email: z.string().describe('The email address of the account to reset'),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOL_SCHEMAS: Record<string, z.ZodType<any>> = {
  lookup_order: lookupOrderSchema,
  verify_customer: verifyCustomerSchema,
  refund_order: refundOrderSchema,
  faq_search: faqSearchSchema,
  reset_password: resetPasswordSchema,
};
```

- [ ] **Step 2: Update `buildToolSchemas` in `workflow-engine.ts` to import from `tool-schemas.ts`**

Replace the inline schema definitions in `buildToolSchemas` with imports from the new module.

```typescript
// Add to imports at top of workflow-engine.ts (after the existing imports):
import { TOOL_SCHEMAS } from './tool-schemas';
```

Then replace the `buildToolSchemas` function (lines 117-192):

```typescript
/**
 * Build AI SDK tool definitions from the ToolCatalog, filtered to only the
 * tools this agent route is allowed to use.  We do NOT attach `execute`
 * handlers because we need to intercept calls for approval gating and
 * trace recording.
 */
function buildToolSchemas(
  toolCatalog: ToolCatalog,
  allowedToolNames: string[]
) {
  const toolDefs: Record<
    string,
    {
      description: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: z.ZodType<any>;
    }
  > = {};

  const toolMeta: Record<
    string,
    { requiresApproval: boolean; isDestructive: boolean }
  > = {};

  for (const td of toolCatalog.tools) {
    if (!allowedToolNames.includes(td.name)) continue;

    toolMeta[td.name] = {
      requiresApproval: td.requiresApproval,
      isDestructive: td.isDestructive,
    };

    const schema = TOOL_SCHEMAS[td.name];
    if (schema) {
      toolDefs[td.name] = {
        description: td.description,
        inputSchema: schema,
      };
    }
  }

  return { toolDefs, toolMeta };
}
```

- [ ] **Step 3: Verify the project still compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Clean or only downstream errors from Task 1 type changes.

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `pnpm vitest run`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tool-schemas.ts src/lib/workflow-engine.ts
git commit -m "refactor(gate): extract Zod schemas into tool-schemas.ts single source of truth"
```

---

### Task 3: Create `src/lib/policy-gate.ts`

**Files:**
- Create: `src/lib/policy-gate.ts`

- [ ] **Step 1: Create the policy gate module with all 4 checks**

```typescript
import type {
  DemoState,
  GateDenyCategory,
  GateOutcome,
  PolicyGateContext,
  RouteDecision,
  ToolCatalog,
} from './types';
import { TOOL_SCHEMAS } from './tool-schemas';

// ── Check 1: Tool Allowlist ──

/**
 * Returns the list of tool names a given route is allowed to invoke.
 * Moved from workflow-engine.ts to be shared with the policy gate.
 */
export function getAllowedToolsForRoute(route: RouteDecision): string[] {
  switch (route) {
    case 'refund':
      return ['lookup_order', 'verify_customer', 'refund_order', 'faq_search'];
    case 'lookup':
      return ['lookup_order', 'faq_search'];
    case 'faq':
      return ['faq_search'];
    case 'account':
      return ['verify_customer', 'reset_password', 'faq_search'];
    case 'clarify':
      return [];
  }
}

// ── Check 4: Rate Limit Caps ──

const TOOL_CALL_CAPS: Partial<Record<string, number>> = {
  refund_order: 1,
  reset_password: 1,
  lookup_order: 3,
  verify_customer: 2,
  faq_search: 5,
};

// ── Domain Invariant Helpers ──

function checkRefundOrderInvariants(
  args: Record<string, unknown>,
  demoState: DemoState
): { valid: true } | { valid: false; reason: string; technicalDetail: string } {
  const orderId = args.orderId as string | undefined;
  if (!orderId) {
    return { valid: false, reason: 'Missing order ID', technicalDetail: 'args.orderId is undefined' };
  }

  const order = demoState.orders.find((o) => o.id === orderId);
  if (!order) {
    return {
      valid: false,
      reason: `Order ${orderId} not found`,
      technicalDetail: `No order with id "${orderId}" exists in demoState.orders`,
    };
  }

  if (order.status !== 'delivered') {
    return {
      valid: false,
      reason: `Order is in status '${order.status}', not eligible`,
      technicalDetail: `order.status === "${order.status}", expected "delivered"`,
    };
  }

  if (!order.isRefundable) {
    return {
      valid: false,
      reason: 'Order is marked non-refundable',
      technicalDetail: `order.isRefundable === false`,
    };
  }

  if (order.refundedAt !== null || order.status === 'refunded') {
    return {
      valid: false,
      reason: 'Order has already been refunded',
      technicalDetail: `order.refundedAt === "${order.refundedAt}"`,
    };
  }

  return { valid: true };
}

function checkResetPasswordInvariants(
  args: Record<string, unknown>,
  demoState: DemoState
): { valid: true } | { valid: false; reason: string; technicalDetail: string } {
  const email = args.email as string | undefined;
  if (!email) {
    return { valid: false, reason: 'Missing email address', technicalDetail: 'args.email is undefined' };
  }

  const customer = demoState.customers.find(
    (c) => c.email.toLowerCase() === email.toLowerCase()
  );
  if (!customer) {
    return {
      valid: false,
      reason: `No account found with email '${email}'`,
      technicalDetail: `No customer with email "${email}" exists in demoState.customers`,
    };
  }

  return { valid: true };
}

// ── Main Gate Function ──

/**
 * Evaluate the policy gate for a tool call.
 * Pure, synchronous, no throw, no side effects.
 * Checks run fail-fast top-to-bottom:
 *   1. Tool allowlist
 *   2. Schema validation
 *   3. Domain invariants
 *   4. Rate limit
 * If all pass, checks requiresApproval → require_approval or allow.
 */
export function evaluatePolicyGate(ctx: PolicyGateContext): GateOutcome {
  const { requestId, toolCallId, route, toolName, args, demoState, toolCallCounts, toolCatalog } = ctx;

  const base = { toolName, toolCallId, requestId };

  // ── Check 1: Tool Allowlist ──
  const allowedTools = getAllowedToolsForRoute(route);
  if (!allowedTools.includes(toolName)) {
    return {
      ...base,
      decision: 'deny',
      category: 'tool_not_allowed',
      reason: `Tool "${toolName}" is not allowed for route "${route}"`,
      technicalDetail: `Allowed tools: [${allowedTools.join(', ')}]`,
    };
  }

  // ── Check 2: Schema Validation ──
  const schema = TOOL_SCHEMAS[toolName];
  if (schema) {
    const parseResult = schema.safeParse(args);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i: { path: Array<string | number>; message: string }) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return {
        ...base,
        decision: 'deny',
        category: 'schema_validation',
        reason: `Invalid arguments for "${toolName}"`,
        technicalDetail: issues,
      };
    }
  }

  // ── Check 3: Domain Invariants ──
  if (toolName === 'refund_order') {
    const check = checkRefundOrderInvariants(args, demoState);
    if (!check.valid) {
      return {
        ...base,
        decision: 'deny',
        category: 'domain_invariant',
        reason: check.reason,
        technicalDetail: check.technicalDetail,
      };
    }
  }

  if (toolName === 'reset_password') {
    const check = checkResetPasswordInvariants(args, demoState);
    if (!check.valid) {
      return {
        ...base,
        decision: 'deny',
        category: 'domain_invariant',
        reason: check.reason,
        technicalDetail: check.technicalDetail,
      };
    }
  }

  // ── Check 4: Rate Limit ──
  const cap = TOOL_CALL_CAPS[toolName];
  if (cap !== undefined) {
    const currentCount = toolCallCounts[toolName] ?? 0;
    if (currentCount >= cap) {
      return {
        ...base,
        decision: 'deny',
        category: 'rate_limit',
        reason: `Rate limit exceeded for "${toolName}" (max ${cap} per run, current ${currentCount})`,
        technicalDetail: `toolCallCounts["${toolName}"] = ${currentCount}, cap = ${cap}`,
      };
    }
  }

  // ── All checks passed — check approval requirement ──
  const toolDef = toolCatalog.tools.find((t) => t.name === toolName);
  if (toolDef?.requiresApproval) {
    return { ...base, decision: 'require_approval' };
  }

  return { ...base, decision: 'allow' };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/policy-gate.ts
git commit -m "feat(gate): add policy gate with allowlist, schema, invariant, and rate limit checks"
```

---

### Task 4: Write Unit Tests for `policy-gate.ts`

**Files:**
- Create: `src/lib/__tests__/policy-gate.test.ts`

- [ ] **Step 1: Write comprehensive tests for all 4 gate checks**

```typescript
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
      makeCtx({ route: 'refund', toolName: 'reset_password', args: { email: 'max@example.com' } })
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
        args: { email: 'max@example.com' },
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
```

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run src/lib/__tests__/policy-gate.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/policy-gate.test.ts
git commit -m "test(gate): add comprehensive unit tests for policy gate"
```

---

### Task 5: Integrate Gate into `workflow-engine.ts` Execute Handler

**Files:**
- Modify: `src/lib/workflow-engine.ts`

This is the largest task. The engine needs to call the policy gate before every tool execution, track per-run `toolCallCounts`, and record gate trace entries.

- [ ] **Step 1: Update imports — add policy gate and remove local `getToolsForRoute`**

```typescript
// Replace imports at top of workflow-engine.ts (lines 1-26):
import { generateText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type {
  AppSettings,
  PromptConfig,
  ToolCatalog,
  DemoState,
  RouteDecision,
  RunTrace,
  TraceEntry,
  ToolCallTrace,
  MismatchAlert,
  StructuredAuditEntry,
  AuditOutcome,
  PolicyGateContext,
} from './types';
import { executeTool } from './tools';
import {
  generatePrefixedId,
  hashPromptConfig,
  hashToolDef,
  redactArgs,
  resolveSubject,
} from './audit';
import { TOOL_SCHEMAS } from './tool-schemas';
import { evaluatePolicyGate, getAllowedToolsForRoute } from './policy-gate';
```

- [ ] **Step 2: Delete the local `getToolsForRoute` function (lines 96-109)**

Remove the entire function — it now lives in `policy-gate.ts`.

- [ ] **Step 3: Add `toolCallCounts` tracking at the start of `runWorkflow`**

```typescript
// Add after the existing variable declarations (after line 374, after `const promptVersion = ...`):
  const toolCallCounts: Record<string, number> = {};
```

- [ ] **Step 4: Replace the execute handler body to call the policy gate**

Replace the execute handler (the `execute: async (args: any) => { ... }` block starting around line 516) with the gate-integrated version:

```typescript
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execute: async (args: any) => {
          const toolCallId = generatePrefixedId('tc');
          const timestamp = new Date().toISOString();

          addTraceEntry(
            traceEntries,
            'tool_call',
            {
              toolCallId,
              toolName: name,
              arguments: args,
            },
            route!
          );

          // ── Policy Gate ──
          const gateCtx: PolicyGateContext = {
            requestId,
            toolCallId,
            route: route!,
            toolName: name,
            args,
            demoState: currentState,
            toolCallCounts,
            toolCatalog,
          };

          const gateOutcome = evaluatePolicyGate(gateCtx);

          if (gateOutcome.decision === 'deny') {
            addTraceEntry(
              traceEntries,
              'gate_deny',
              {
                toolCallId,
                toolName: name,
                category: gateOutcome.category,
                reason: gateOutcome.reason,
                technicalDetail: gateOutcome.technicalDetail ?? null,
              },
              route!
            );

            // Create audit entry for gate denial
            const deniedAuditEntry: StructuredAuditEntry = {
              id: generatePrefixedId('ae'),
              requestId,
              toolCallId,
              idempotencyKey: null,
              actor: { type: 'agent', agentId: route! },
              subject: resolveSubject(name, args, currentState),
              toolName: name,
              toolDefinitionVersion: hashToolDef(toolCatalog, name),
              arguments: redactArgs(name, args),
              approvalId: null,
              approvalOutcome: null,
              outcome: 'skipped',
              outcomeDetail: `Gate denied: ${gateOutcome.category} — ${gateOutcome.reason}`,
              requestedAt: timestamp,
              completedAt: new Date().toISOString(),
              modelId: settings.modelId,
              modelProvider: settings.provider,
              promptVersion,
            };
            auditEntries.push(deniedAuditEntry);

            const trace: ToolCallTrace = {
              id: toolCallId,
              toolName: name,
              arguments: args,
              result: { denied: true, reason: gateOutcome.reason, category: gateOutcome.category },
              timestamp,
              approvalRequired: false,
              approvalStatus: 'gate_denied',
              auditEntryId: deniedAuditEntry.id,
            };
            toolCallTraces.push(trace);

            // Increment call count even for denials (to prevent infinite retry loops)
            toolCallCounts[name] = (toolCallCounts[name] ?? 0) + 1;

            return { denied: true, reason: gateOutcome.reason, category: gateOutcome.category };
          }

          // Gate passed — record gate_allow
          addTraceEntry(
            traceEntries,
            'gate_allow',
            {
              toolCallId,
              toolName: name,
              decision: gateOutcome.decision,
            },
            route!
          );

          // Increment call count for successful gate passes
          toolCallCounts[name] = (toolCallCounts[name] ?? 0) + 1;

          // ── Approval Check (for require_approval decisions) ──
          if (gateOutcome.decision === 'require_approval') {
            if (pendingApproval) {
              // We have an approval response from the user
              if (pendingApproval.approved) {
                addTraceEntry(traceEntries, 'approval_response', {
                  toolCallId,
                  approved: true,
                });
                // Fall through to execute the tool below
              } else {
                addTraceEntry(traceEntries, 'approval_response', {
                  toolCallId,
                  approved: false,
                });

                // Create audit entry for denied action
                const deniedAuditEntry: StructuredAuditEntry = {
                  id: generatePrefixedId('ae'),
                  requestId,
                  toolCallId,
                  idempotencyKey: null,
                  actor: { type: 'agent', agentId: route! },
                  subject: resolveSubject(name, args, currentState),
                  toolName: name,
                  toolDefinitionVersion: hashToolDef(toolCatalog, name),
                  arguments: redactArgs(name, args),
                  approvalId: toolCallId,
                  approvalOutcome: 'denied',
                  outcome: 'denied',
                  outcomeDetail: null,
                  requestedAt: timestamp,
                  completedAt: new Date().toISOString(),
                  modelId: settings.modelId,
                  modelProvider: settings.provider,
                  promptVersion,
                };
                auditEntries.push(deniedAuditEntry);

                const trace: ToolCallTrace = {
                  id: toolCallId,
                  toolName: name,
                  arguments: args,
                  result: { denied: true, message: 'Action denied by user.' },
                  timestamp,
                  approvalRequired: true,
                  approvalStatus: 'denied',
                  auditEntryId: deniedAuditEntry.id,
                };
                toolCallTraces.push(trace);

                return { denied: true, message: 'Action denied by user.' };
              }
            } else {
              // No approval yet - pause and request it
              needsApprovalPause = true;
              pendingApprovalToolCallId = toolCallId;
              pendingApprovalToolName = name;
              pendingApprovalArgs = args;

              addTraceEntry(traceEntries, 'approval_request', {
                toolCallId,
                toolName: name,
                arguments: args,
              });

              // Create audit entry for pending approval
              const pendingAuditEntry: StructuredAuditEntry = {
                id: generatePrefixedId('ae'),
                requestId,
                toolCallId,
                idempotencyKey: null,
                actor: { type: 'agent', agentId: route! },
                subject: resolveSubject(name, args, currentState),
                toolName: name,
                toolDefinitionVersion: hashToolDef(toolCatalog, name),
                arguments: redactArgs(name, args),
                approvalId: toolCallId,
                approvalOutcome: null,
                outcome: 'requested',
                outcomeDetail: null,
                requestedAt: timestamp,
                completedAt: null,
                modelId: settings.modelId,
                modelProvider: settings.provider,
                promptVersion,
              };
              auditEntries.push(pendingAuditEntry);

              const trace: ToolCallTrace = {
                id: toolCallId,
                toolName: name,
                arguments: args,
                result: null,
                timestamp,
                approvalRequired: true,
                approvalStatus: 'pending',
                auditEntryId: pendingAuditEntry.id,
              };
              toolCallTraces.push(trace);

              return {
                awaiting_approval: true,
                message:
                  'This action requires user approval before proceeding.',
              };
            }
          }

          // ── Execute the tool (decision === 'allow') ──
          const executedAt = new Date().toISOString();
          const toolResult = executeTool(name, currentState, args);
          const completedAt = new Date().toISOString();
          currentState = toolResult.updatedState;

          addTraceEntry(
            traceEntries,
            'tool_result',
            {
              toolCallId,
              toolName: name,
              result: toolResult.result,
              sideEffects: toolResult.sideEffects,
            },
            route!
          );

          if (toolResult.sideEffects.length > 0) {
            addTraceEntry(traceEntries, 'state_change', {
              toolName: name,
              sideEffects: toolResult.sideEffects,
            });
          }

          // Create audit entry for tool calls with side effects
          let auditEntryId: string | null = null;
          if (toolResult.sideEffects.length > 0) {
            const resultObj = toolResult.result as Record<string, unknown> | undefined;
            const outcome: AuditOutcome =
              resultObj && resultObj.success === false ? 'failed' : 'completed';

            const auditEntry: StructuredAuditEntry = {
              id: generatePrefixedId('ae'),
              requestId,
              toolCallId,
              idempotencyKey: null,
              actor: { type: 'agent', agentId: route! },
              subject: resolveSubject(name, args, currentState),
              toolName: name,
              toolDefinitionVersion: hashToolDef(toolCatalog, name),
              arguments: redactArgs(name, args),
              approvalId: meta.requiresApproval ? toolCallId : null,
              approvalOutcome: meta.requiresApproval ? 'approved' : null,
              outcome,
              outcomeDetail: null,
              requestedAt: executedAt,
              completedAt,
              modelId: settings.modelId,
              modelProvider: settings.provider,
              promptVersion,
            };
            auditEntries.push(auditEntry);
            auditEntryId = auditEntry.id;
          }

          const traceRecord: ToolCallTrace = {
            id: toolCallId,
            toolName: name,
            arguments: args,
            result: toolResult.result,
            timestamp,
            approvalRequired: meta.requiresApproval,
            approvalStatus: meta.requiresApproval
              ? 'approved'
              : 'not_required',
            auditEntryId,
          };
          toolCallTraces.push(traceRecord);

          return toolResult.result;
        },
```

- [ ] **Step 5: Verify the project compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Should compile cleanly or show only UI-related warnings from the new trace entry types.

- [ ] **Step 6: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass, including the new policy-gate tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workflow-engine.ts
git commit -m "feat(gate): integrate policy gate into workflow engine execute handler"
```

---

### Task 6: Update `trace-tab.tsx` with Gate Entry Rendering

**Files:**
- Modify: `src/components/trace-tab.tsx`

- [ ] **Step 1: Add `ShieldCheck` and `ShieldX` to the lucide imports**

```typescript
// Replace the lucide import (lines 3-20):
import {
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  MessageSquare,
  GitBranch,
  Cpu,
  Wrench,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  ArrowRightLeft,
  AlertTriangle,
  Bot,
  ScrollText,
} from 'lucide-react';
```

- [ ] **Step 2: Add `gate_allow` and `gate_deny` cases to `entryConfig`**

```typescript
// Add these two cases in the entryConfig function, before the default case (before line 101):
    case 'gate_allow':
      return {
        icon: ShieldCheck,
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-500/10',
        label: 'Gate Allow',
      };
    case 'gate_deny':
      return {
        icon: ShieldX,
        color: 'text-red-600 dark:text-red-400',
        bg: 'bg-red-500/10',
        label: 'Gate Deny',
      };
```

- [ ] **Step 3: Add custom rendering for `gate_deny` entries**

In the trace entry rendering section (inside the `trace.entries.map` block, around line 248), add a custom render for `gate_deny` entries that shows the reason as plaintext instead of raw JSON:

```tsx
// Replace the data rendering block (lines 248-252) with:
                    {entry.type === 'gate_deny' ? (
                      <div className="space-y-1 rounded bg-red-500/5 border border-red-500/20 p-1.5 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 text-[10px]">
                            {(entry.data as Record<string, unknown>).category as string}
                          </Badge>
                          <span className="font-medium text-red-600 dark:text-red-400">
                            {(entry.data as Record<string, unknown>).toolName as string}
                          </span>
                        </div>
                        <p className="text-red-600/80 dark:text-red-400/80">
                          {(entry.data as Record<string, unknown>).reason as string}
                        </p>
                        {(entry.data as Record<string, unknown>).technicalDetail && (
                          <pre className="mt-1 max-h-16 overflow-auto rounded bg-muted p-1 font-mono text-[10px] text-muted-foreground">
                            {(entry.data as Record<string, unknown>).technicalDetail as string}
                          </pre>
                        )}
                      </div>
                    ) : Object.keys(entry.data).length > 0 ? (
                      <pre className="max-h-24 overflow-auto rounded bg-muted p-1.5 font-mono text-xs">
                        {JSON.stringify(entry.data, null, 2)}
                      </pre>
                    ) : null}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/trace-tab.tsx
git commit -m "feat(gate): add gate_allow/gate_deny entry rendering in trace tab"
```

---

### Task 7: Update `playground-tab.tsx` with `gate_denied` Badge

**Files:**
- Modify: `src/components/playground-tab.tsx`

- [ ] **Step 1: Add `ShieldX` to the lucide imports**

```typescript
// Replace the lucide import (lines 3-19):
import {
  Send,
  Loader2,
  RotateCcw,
  AlertTriangle,
  ShieldAlert,
  ShieldX,
  CheckCircle2,
  XCircle,
  Bot,
  User,
  MessageSquare,
  Wrench,
  ArrowRightLeft,
  AlertOctagon,
} from 'lucide-react';
```

- [ ] **Step 2: Add `gate_denied` case to `approvalStatusBadge`**

```typescript
// Replace the approvalStatusBadge function (lines 59-86):
function approvalStatusBadge(status: string) {
  switch (status) {
    case 'approved':
      return (
        <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
          <CheckCircle2 className="size-3" /> Approved
        </Badge>
      );
    case 'denied':
      return (
        <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
          <XCircle className="size-3" /> Denied
        </Badge>
      );
    case 'pending':
      return (
        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <Loader2 className="size-3 animate-spin" /> Pending
        </Badge>
      );
    case 'gate_denied':
      return (
        <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
          <ShieldX className="size-3" /> Gate Denied
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          Not Required
        </Badge>
      );
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/playground-tab.tsx
git commit -m "feat(gate): add gate_denied badge to playground tool call cards"
```

---

### Task 8: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `pnpm vitest run`
Expected: All tests PASS (including audit.test.ts, tools.test.ts, eval-runner.test.ts, and the new policy-gate.test.ts).

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `pnpm tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Verify the dev server starts**

Run: `pnpm dev` (check it starts without errors, then stop)

- [ ] **Step 4: Manual smoke test**

Start the dev server and verify:
1. Send a message that triggers the refund route (e.g., "Bestellung 4713 zurückgeben") — order 4713 is shipped (not delivered), so the gate should deny `refund_order` with `domain_invariant`.
2. Check the Trace tab: verify `gate_deny` entries appear with red ShieldX icon and the denial reason.
3. Check the Playground right panel: verify the tool call shows a red "Gate Denied" badge.
4. Send a normal lookup message (e.g., "Wo ist Bestellung 4711?") — verify `gate_allow` entries appear in the trace with green ShieldCheck icon.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(gate): resolve remaining type and test issues from policy gate integration"
```

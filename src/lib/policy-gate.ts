import type {
  DemoState,
  GateOutcome,
  PolicyGateContext,
  RouteDecision,
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

  if (order.refundedAt !== null) {
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
        .map((i) => `${(i.path as Array<string | number>).join('.')}: ${i.message}`)
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

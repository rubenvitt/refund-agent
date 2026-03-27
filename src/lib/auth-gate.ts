import type { AuthCheckResult, DemoState, UserRole, UserSession } from './types';

/**
 * Role-to-tool permission matrix.
 * Tools not listed here are allowed for all roles.
 */
const ROLE_PERMISSIONS: Record<UserRole, Set<string>> = {
  customer: new Set([
    'lookup_order',
    'verify_customer',
    'refund_order',
    'faq_search',
    'reset_password',
  ]),
  support_admin: new Set([
    'lookup_order',
    'verify_customer',
    'refund_order',
    'faq_search',
    'reset_password',
  ]),
};

/**
 * Tools that are allowed without any session (anonymous access).
 */
const ANONYMOUS_ALLOWED_TOOLS = new Set(['faq_search']);

/**
 * Tools that require BOLA (object-level) checks for the `customer` role.
 * `support_admin` bypasses all BOLA checks.
 */
const BOLA_CHECKED_TOOLS = new Set([
  'lookup_order',
  'refund_order',
  'reset_password',
]);

/**
 * BFLA check: Does this role have permission to call this tool at all?
 * This runs BEFORE any object-level check to avoid leaking object data
 * through error messages on function-level denials.
 */
export function checkBflaPermission(
  toolName: string,
  role: UserRole
): AuthCheckResult {
  const allowed = ROLE_PERMISSIONS[role];
  if (!allowed || !allowed.has(toolName)) {
    return {
      allowed: false,
      reason: `Role '${role}' is not permitted to use '${toolName}'.`,
      checkType: 'bfla',
    };
  }
  return { allowed: true };
}

/**
 * BOLA check: Does the authenticated user own the object being accessed?
 * Only applies to `customer` role — `support_admin` bypasses BOLA.
 *
 * Key design decision: If an order is not found, we return `allowed: true`
 * to avoid leaking object existence information through auth errors.
 * The downstream tool execution or policy gate will handle "not found" cases.
 */
export function checkBolaPermission(
  toolName: string,
  toolArgs: Record<string, unknown>,
  session: UserSession,
  demoState: DemoState
): AuthCheckResult {
  // Support admins bypass all BOLA checks
  if (session.role === 'support_admin') {
    return { allowed: true };
  }

  // Only check tools that have object-level semantics
  if (!BOLA_CHECKED_TOOLS.has(toolName)) {
    return { allowed: true };
  }

  if (toolName === 'lookup_order' || toolName === 'refund_order') {
    const orderId = toolArgs.orderId as string | undefined;
    if (!orderId) return { allowed: true };

    const order = demoState.orders.find((o) => o.id === orderId);
    // Order not found → allowed: true (no existence leak)
    if (!order) return { allowed: true };

    if (order.customerId !== session.customerId) {
      return {
        allowed: false,
        reason: 'You do not have permission to access this order.',
        checkType: 'bola',
      };
    }
    return { allowed: true };
  }

  if (toolName === 'reset_password') {
    const email = toolArgs.email as string | undefined;
    if (!email) return { allowed: true };

    // Find the customer who owns this email
    const targetCustomer = demoState.customers.find(
      (c) => c.email.toLowerCase() === email.toLowerCase()
    );
    // Email not found → allowed: true (no existence leak)
    if (!targetCustomer) return { allowed: true };

    if (targetCustomer.id !== session.customerId) {
      return {
        allowed: false,
        reason: 'You can only reset the password for your own account.',
        checkType: 'bola',
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

/**
 * Main auth evaluation entry point.
 * Check order: no_session → BFLA → BOLA
 *
 * Called in the workflow engine execute handler BEFORE the policy gate.
 */
export function evaluateAuthForToolCall(
  toolName: string,
  toolArgs: Record<string, unknown>,
  session: UserSession | null,
  demoState: DemoState
): AuthCheckResult {
  // No session: only anonymous-allowed tools pass
  if (!session) {
    if (ANONYMOUS_ALLOWED_TOOLS.has(toolName)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'Authentication required. Please log in to use this tool.',
      checkType: 'no_session',
    };
  }

  // BFLA first: role-level permission
  const bflaResult = checkBflaPermission(toolName, session.role);
  if (!bflaResult.allowed) return bflaResult;

  // BOLA second: object-level ownership
  const bolaResult = checkBolaPermission(toolName, toolArgs, session, demoState);
  if (!bolaResult.allowed) return bolaResult;

  return { allowed: true };
}

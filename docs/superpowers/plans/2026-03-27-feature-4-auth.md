# Feature 4: Auth Simulation (BOLA/BFLA) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a simulated authentication layer with session management that enforces BFLA (function-level) and BOLA (object-level) authorization checks before every tool call, preventing agents from executing actions the logged-in user is not permitted to perform.

**Architecture:** A new pure module `auth-gate.ts` exports `evaluateAuthForToolCall()` which runs BFLA checks (role-based function access) before BOLA checks (object ownership). A `UserSession` is held in AppState and selected via a new `SessionSelector` header component. The auth check runs in the workflow engine execute handler _before_ the policy gate, because gate checks read object data and would otherwise create BOLA information leaks. Without a session, only `faq_search` is allowed.

**Tech Stack:** TypeScript, Vitest, React

**Spec:** `docs/superpowers/specs/2026-03-27-security-features-design.md` — Feature 4

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/types.ts` | Modify | Add `UserRole`, `UserSession`, `AuthCheckResult`; extend `TraceEntry` with `auth_denial`; extend `ToolCallTrace.approvalStatus` with `auth_denied` |
| `src/lib/auth-gate.ts` | Create | `checkBflaPermission`, `checkBolaPermission`, `evaluateAuthForToolCall` |
| `src/lib/__tests__/auth-gate.test.ts` | Create | Unit tests for BFLA/BOLA logic |
| `src/lib/store.ts` | Modify | Add `session` to `AppState`, `SET_SESSION` action, `useSession` hook |
| `src/lib/workflow-engine.ts` | Modify | Add `session` to `WorkflowInput`, integrate auth check before policy gate |
| `src/lib/hooks.ts` | Modify | Thread `session` into `runWorkflow` calls, add anonymous guard in `useChat` |
| `src/components/session-selector.tsx` | Create | Login/logout UI component for the header |
| `src/components/header.tsx` | Modify | Mount `SessionSelector` |
| `src/components/playground-tab.tsx` | Modify | Add `auth_denied` badge, auth demo presets, login-guard state |
| `src/components/trace-tab.tsx` | Modify | Add `auth_denial` entry config |

---

### Task 1: Add Auth Types to `types.ts`

**Files:**
- Modify: `src/lib/types.ts`

**Depends on:** Features 1-3 already landed (types.ts already has `GateDenyCategory`, `GateOutcome`, `PolicyGateContext`, `gate_allow`, `gate_deny`, `gate_denied`, `idempotency_block` trace entries).

- [ ] **Step 1: Add `UserRole`, `UserSession`, and `AuthCheckResult` types after `PolicyGateContext`**

Add after the `PolicyGateContext` type block (which was added in Feature 2):

```typescript
export type UserRole = 'customer' | 'support_admin';

export type UserSession = {
  customerId: string;
  customerName: string;
  role: UserRole;
  loginTimestamp: string;
};

export type AuthCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      checkType: 'bfla' | 'bola' | 'no_session';
    };
```

- [ ] **Step 2: Extend `TraceEntry.type` union to include `auth_denial`**

Find the current `TraceEntry` type and add `'auth_denial'` to its type union. After Features 1-3, the union already includes `gate_allow`, `gate_deny`, and `idempotency_block`. Add `auth_denial` after `idempotency_block`:

```typescript
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
    | 'gate_deny'
    | 'idempotency_block'
    | 'auth_denial';
  agentId?: string;
  data: Record<string, unknown>;
};
```

- [ ] **Step 3: Extend `ToolCallTrace.approvalStatus` to include `auth_denied`**

Find the current `ToolCallTrace` type and add `'auth_denied'` to the `approvalStatus` union. After Feature 2, it already includes `'gate_denied'`:

```typescript
export type ToolCallTrace = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  approvalRequired: boolean;
  approvalStatus: 'approved' | 'denied' | 'not_required' | 'pending' | 'gate_denied' | 'auth_denied';
  auditEntryId: string | null;
};
```

- [ ] **Step 4: Verify the project type-checks**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: May show downstream errors in `trace-tab.tsx` or `playground-tab.tsx` from the new union members. Those are fixed in later tasks.

- [ ] **Step 5: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/lib/types.ts && git commit -m "feat(auth): add UserRole, UserSession, AuthCheckResult types and auth_denial trace entry"
```

---

### Task 2: Create `src/lib/auth-gate.ts`

**Files:**
- Create: `src/lib/auth-gate.ts`

**Depends on:** Task 1 (types exist).

- [ ] **Step 1: Create `src/lib/auth-gate.ts` with the full module**

```typescript
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
```

- [ ] **Step 2: Verify the new file compiles**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit 2>&1 | grep "auth-gate" | head -10
```

Expected: No errors from `auth-gate.ts`.

- [ ] **Step 3: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/lib/auth-gate.ts && git commit -m "feat(auth): create auth-gate module with BFLA/BOLA checks"
```

---

### Task 3: Write Unit Tests for `auth-gate.ts`

**Files:**
- Create: `src/lib/__tests__/auth-gate.test.ts`

**Depends on:** Task 2 (auth-gate module exists).

- [ ] **Step 1: Create `src/lib/__tests__/auth-gate.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
  checkBflaPermission,
  checkBolaPermission,
  evaluateAuthForToolCall,
} from '../auth-gate';
import { createSeedState } from '../seed-data';
import type { UserSession } from '../types';

const state = createSeedState();

const customerC001: UserSession = {
  customerId: 'C001',
  customerName: 'Max Mustermann',
  role: 'customer',
  loginTimestamp: '2026-03-27T10:00:00.000Z',
};

const customerC002: UserSession = {
  customerId: 'C002',
  customerName: 'Erika Beispiel',
  role: 'customer',
  loginTimestamp: '2026-03-27T10:00:00.000Z',
};

const adminSession: UserSession = {
  customerId: 'C001',
  customerName: 'Admin Max',
  role: 'support_admin',
  loginTimestamp: '2026-03-27T10:00:00.000Z',
};

// ── BFLA ──

describe('checkBflaPermission', () => {
  it('allows customer to call lookup_order', () => {
    expect(checkBflaPermission('lookup_order', 'customer')).toEqual({ allowed: true });
  });

  it('allows customer to call faq_search', () => {
    expect(checkBflaPermission('faq_search', 'customer')).toEqual({ allowed: true });
  });

  it('allows customer to call refund_order', () => {
    expect(checkBflaPermission('refund_order', 'customer')).toEqual({ allowed: true });
  });

  it('allows customer to call reset_password', () => {
    expect(checkBflaPermission('reset_password', 'customer')).toEqual({ allowed: true });
  });

  it('allows support_admin to call all tools', () => {
    for (const tool of ['lookup_order', 'verify_customer', 'refund_order', 'faq_search', 'reset_password']) {
      expect(checkBflaPermission(tool, 'support_admin')).toEqual({ allowed: true });
    }
  });

  it('denies customer for an unknown tool', () => {
    const result = checkBflaPermission('admin_dashboard', 'customer');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bfla');
    }
  });
});

// ── BOLA ──

describe('checkBolaPermission', () => {
  it('allows C001 to lookup own order 4711', () => {
    const result = checkBolaPermission('lookup_order', { orderId: '4711' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('denies C001 from looking up C002 order 4714', () => {
    const result = checkBolaPermission('lookup_order', { orderId: '4714' }, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bola');
    }
  });

  it('denies C001 from refunding C003 order 4715', () => {
    const result = checkBolaPermission('refund_order', { orderId: '4715', reason: 'test' }, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bola');
    }
  });

  it('allows C001 to refund own order 4711', () => {
    const result = checkBolaPermission('refund_order', { orderId: '4711', reason: 'test' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows C001 to reset own password', () => {
    const result = checkBolaPermission('reset_password', { email: 'max@example.com' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('denies C001 from resetting C002 password', () => {
    const result = checkBolaPermission('reset_password', { email: 'erika@example.com' }, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bola');
    }
  });

  it('allows support_admin to access any order (BOLA bypass)', () => {
    const result = checkBolaPermission('lookup_order', { orderId: '4714' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows support_admin to refund any order (BOLA bypass)', () => {
    const result = checkBolaPermission('refund_order', { orderId: '4715', reason: 'test' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows support_admin to reset any password (BOLA bypass)', () => {
    const result = checkBolaPermission('reset_password', { email: 'erika@example.com' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });

  it('returns allowed for non-existent order (no existence leak)', () => {
    const result = checkBolaPermission('lookup_order', { orderId: '9999' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('returns allowed for non-existent email (no existence leak)', () => {
    const result = checkBolaPermission('reset_password', { email: 'nobody@example.com' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows faq_search without BOLA check', () => {
    const result = checkBolaPermission('faq_search', { query: 'refund' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows verify_customer without BOLA check', () => {
    const result = checkBolaPermission('verify_customer', { customerId: 'C002', email: 'x' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('handles case-insensitive email for reset_password BOLA', () => {
    const result = checkBolaPermission('reset_password', { email: 'MAX@EXAMPLE.COM' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });
});

// ── evaluateAuthForToolCall (integration) ──

describe('evaluateAuthForToolCall', () => {
  it('denies all non-faq tools when session is null', () => {
    const result = evaluateAuthForToolCall('lookup_order', { orderId: '4711' }, null, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('no_session');
    }
  });

  it('allows faq_search when session is null', () => {
    const result = evaluateAuthForToolCall('faq_search', { query: 'return policy' }, null, state);
    expect(result).toEqual({ allowed: true });
  });

  it('denies C001 from accessing C002 order (BOLA via integration)', () => {
    const result = evaluateAuthForToolCall('lookup_order', { orderId: '4714' }, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bola');
    }
  });

  it('allows C001 to access own order (full chain passes)', () => {
    const result = evaluateAuthForToolCall('lookup_order', { orderId: '4711' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('BFLA fires before BOLA for unknown tool', () => {
    const result = evaluateAuthForToolCall('admin_dashboard', {}, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bfla');
    }
  });

  it('admin can access any order', () => {
    const result = evaluateAuthForToolCall('refund_order', { orderId: '4715', reason: 'test' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });

  it('admin can reset any password', () => {
    const result = evaluateAuthForToolCall('reset_password', { email: 'erika@example.com' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm test src/lib/__tests__/auth-gate.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/lib/__tests__/auth-gate.test.ts && git commit -m "test(auth): add unit tests for BFLA, BOLA, and evaluateAuthForToolCall"
```

---

### Task 4: Update `store.ts` — Session in AppState

**Files:**
- Modify: `src/lib/store.ts`

**Depends on:** Task 1 (UserSession type exists).

- [ ] **Step 1: Add `UserSession` import to the import block**

Find the existing import from `'./types'` at the top of `store.ts`:

```typescript
import type {
  AppSettings,
  DemoState,
  PromptConfig,
  ToolCatalog,
  RunTrace,
  EvalResult,
  HumanReview,
  ApprovalRequest,
  StructuredAuditEntry,
} from './types';
```

Replace with:

```typescript
import type {
  AppSettings,
  DemoState,
  PromptConfig,
  ToolCatalog,
  RunTrace,
  EvalResult,
  HumanReview,
  ApprovalRequest,
  StructuredAuditEntry,
  UserSession,
} from './types';
```

- [ ] **Step 2: Add `session` to `AppState`**

Find the `AppState` type and add `session: UserSession | null;` after `approvalRequest`:

```typescript
export type AppState = {
  settings: AppSettings;
  demoState: DemoState;
  promptConfig: PromptConfig;
  toolCatalog: ToolCatalog;
  traces: RunTrace[];
  evalResults: EvalResult[];
  activeTab: string;
  isLoading: boolean;
  error: string | null;
  approvalRequest: ApprovalRequest | null;
  chatMessages: ChatMessage[];
  session: UserSession | null;
};
```

- [ ] **Step 3: Add `session: null` to `getInitialState()`**

Find the `getInitialState` function and add `session: null` to its return value:

```typescript
function getInitialState(): AppState {
  return {
    settings: DEFAULT_SETTINGS,
    demoState: createSeedState(),
    promptConfig: defaultPromptConfig,
    toolCatalog: defaultToolCatalog,
    traces: [],
    evalResults: [],
    activeTab: 'playground',
    isLoading: false,
    error: null,
    approvalRequest: null,
    chatMessages: [],
    session: null,
  };
}
```

- [ ] **Step 4: Add `SET_SESSION` action to `AppAction` union**

Find the `AppAction` type and add the new action after `CLEAR_AUDIT_LOG`:

```typescript
  | { type: 'CLEAR_AUDIT_LOG' }
  | { type: 'SET_SESSION'; payload: UserSession | null };
```

- [ ] **Step 5: Add the reducer case for `SET_SESSION`**

Find the `CLEAR_AUDIT_LOG` case in the reducer and add the new case after it (before `default`):

```typescript
    case 'SET_SESSION':
      return { ...state, session: action.payload };
```

- [ ] **Step 6: Clear session on `RESET_ALL`**

The existing `RESET_ALL` case calls `getInitialState()` which already returns `session: null`, so no change is needed here.

- [ ] **Step 7: Persist session to localStorage**

Find the `saveToLocalStorage` function and add `session` to the `toSave` object:

```typescript
function saveToLocalStorage(state: AppState) {
  if (typeof window === 'undefined') return;
  try {
    const toSave = {
      settings: state.settings,
      demoState: state.demoState,
      promptConfig: state.promptConfig,
      toolCatalog: state.toolCatalog,
      traces: state.traces.slice(0, 50),
      session: state.session,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  } catch {
    // quota exceeded or other error – silently ignore
  }
}
```

- [ ] **Step 8: Restore session from localStorage during hydration**

Find the hydration `useEffect` in `AppProvider` and add session restoration. After the line that restores traces:

```typescript
      if (saved.traces) dispatch({ type: 'SET_TRACES', payload: saved.traces as RunTrace[] });
      if ((saved as Record<string, unknown>).session) {
        dispatch({ type: 'SET_SESSION', payload: (saved as Record<string, unknown>).session as UserSession });
      }
```

- [ ] **Step 9: Add `useSession` hook**

Add at the bottom of `store.ts`, after the existing `useDemoState` hook:

```typescript
export function useSession() {
  const { state, dispatch } = useAppState();
  return {
    session: state.session,
    setSession: (session: UserSession | null) =>
      dispatch({ type: 'SET_SESSION', payload: session }),
  };
}
```

- [ ] **Step 10: Verify type-checking**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: No errors from `store.ts`.

- [ ] **Step 11: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/lib/store.ts && git commit -m "feat(auth): add session state, SET_SESSION action, useSession hook, and session persistence"
```

---

### Task 5: Update `workflow-engine.ts` — Auth Check Integration

**Files:**
- Modify: `src/lib/workflow-engine.ts`

**Depends on:** Task 2 (auth-gate module), Task 1 (types).

- [ ] **Step 1: Add imports**

Add `UserSession` to the type import and import the auth gate function. Find the existing imports block:

```typescript
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
} from './types';
```

Replace with:

```typescript
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
  UserSession,
} from './types';
```

Then add the auth-gate import after the existing `import { executeTool } from './tools';` line:

```typescript
import { evaluateAuthForToolCall } from './auth-gate';
```

- [ ] **Step 2: Add `session` to `WorkflowInput`**

Find the `WorkflowInput` type and add `session`:

```typescript
type WorkflowInput = {
  userMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  settings: AppSettings;
  promptConfig: PromptConfig;
  toolCatalog: ToolCatalog;
  demoState: DemoState;
  pendingApproval?: { toolCallId: string; approved: boolean } | null;
  session: UserSession | null;
};
```

- [ ] **Step 3: Destructure `session` in `runWorkflow`**

Find the destructuring at the top of `runWorkflow`:

```typescript
  const {
    userMessage,
    conversationHistory,
    settings,
    promptConfig,
    toolCatalog,
    demoState,
    pendingApproval,
  } = input;
```

Replace with:

```typescript
  const {
    userMessage,
    conversationHistory,
    settings,
    promptConfig,
    toolCatalog,
    demoState,
    pendingApproval,
    session,
  } = input;
```

- [ ] **Step 4: Insert auth check in the execute handler**

Find the execute handler inside the `for (const [name, def] of Object.entries(toolDefs))` loop. The handler starts with:

```typescript
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

          // Check if this tool requires approval
          if (meta.requiresApproval) {
```

Insert the auth check block **after** the `tool_call` trace entry and **before** the approval check. Replace the section between the `addTraceEntry` for `tool_call` and `// Check if this tool requires approval`:

```typescript
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

          // ── Auth check (BFLA then BOLA) ──
          const authResult = evaluateAuthForToolCall(name, args, session, currentState);
          if (!authResult.allowed) {
            addTraceEntry(
              traceEntries,
              'auth_denial',
              {
                toolCallId,
                toolName: name,
                checkType: authResult.checkType,
                reason: authResult.reason,
              },
              route!
            );

            // Create audit entry for auth denial
            const authDeniedAuditEntry: StructuredAuditEntry = {
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
              outcome: 'denied',
              outcomeDetail: `auth_${authResult.checkType}: ${authResult.reason}`,
              requestedAt: timestamp,
              completedAt: new Date().toISOString(),
              modelId: settings.modelId,
              modelProvider: settings.provider,
              promptVersion,
            };
            auditEntries.push(authDeniedAuditEntry);

            const authDeniedTrace: ToolCallTrace = {
              id: toolCallId,
              toolName: name,
              arguments: args,
              result: { authorization_denied: true, reason: authResult.reason },
              timestamp,
              approvalRequired: false,
              approvalStatus: 'auth_denied',
              auditEntryId: authDeniedAuditEntry.id,
            };
            toolCallTraces.push(authDeniedTrace);

            return { authorization_denied: true, reason: authResult.reason };
          }

          // Check if this tool requires approval
          if (meta.requiresApproval) {
```

This places auth **before** the policy gate (which Feature 2 inserts before approval) and before the approval check.

- [ ] **Step 5: Verify type-checking**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: Errors in `hooks.ts` because `runWorkflow` now requires `session` in its input. This is fixed in Task 6.

- [ ] **Step 6: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/lib/workflow-engine.ts && git commit -m "feat(auth): integrate auth check in workflow engine execute handler before policy gate"
```

---

### Task 6: Update `hooks.ts` — Thread Session and Add Anonymous Guard

**Files:**
- Modify: `src/lib/hooks.ts`

**Depends on:** Task 4 (store has session), Task 5 (workflow expects session).

- [ ] **Step 1: Thread `session` through `useChat` `sendMessage`**

Find the `runWorkflow` call in `sendMessage` inside `useChat`:

```typescript
        const result = await runWorkflow({
          userMessage: content,
          conversationHistory: state.chatMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          settings: state.settings,
          promptConfig: state.promptConfig,
          toolCatalog: state.toolCatalog,
          demoState: state.demoState,
        });
```

Replace with:

```typescript
        const result = await runWorkflow({
          userMessage: content,
          conversationHistory: state.chatMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          settings: state.settings,
          promptConfig: state.promptConfig,
          toolCatalog: state.toolCatalog,
          demoState: state.demoState,
          session: state.session,
        });
```

- [ ] **Step 2: Add `state.session` to `sendMessage` dependency array**

Find the dependency array for the `sendMessage` callback:

```typescript
    [state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, dispatch],
```

Replace with:

```typescript
    [state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, state.session, dispatch],
```

- [ ] **Step 3: Thread `session` through `useApproval` `respond`**

Find the `runWorkflow` call in `respond` inside `useApproval`:

```typescript
        const result = await runWorkflow({
          userMessage: lastUserMessage,
          conversationHistory: state.chatMessages.slice(0, -1).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          settings: state.settings,
          promptConfig: state.promptConfig,
          toolCatalog: state.toolCatalog,
          demoState: state.demoState,
          pendingApproval: {
            toolCallId: state.approvalRequest.toolCallId,
            approved,
          },
        });
```

Replace with:

```typescript
        const result = await runWorkflow({
          userMessage: lastUserMessage,
          conversationHistory: state.chatMessages.slice(0, -1).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          settings: state.settings,
          promptConfig: state.promptConfig,
          toolCatalog: state.toolCatalog,
          demoState: state.demoState,
          pendingApproval: {
            toolCallId: state.approvalRequest.toolCallId,
            approved,
          },
          session: state.session,
        });
```

- [ ] **Step 4: Add `state.session` to `respond` dependency array**

Find the dependency array for the `respond` callback:

```typescript
    [state.approvalRequest, state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, dispatch],
```

Replace with:

```typescript
    [state.approvalRequest, state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, state.session, dispatch],
```

- [ ] **Step 5: Thread `session` in `useEvalRunner`**

Find the `runWorkflow` call inside the `runCases` for-loop in `useEvalRunner`:

```typescript
            const result = await runWorkflow({
              userMessage: evalCase.userMessage,
              conversationHistory: [],
              settings: state.settings,
              promptConfig: state.promptConfig,
              toolCatalog: state.toolCatalog,
              demoState: originalState,
              pendingApproval: evalCase.expectations.destructiveSideEffectAllowed
                ? { toolCallId: 'auto-approve', approved: true }
                : null,
            });
```

Replace with:

```typescript
            const result = await runWorkflow({
              userMessage: evalCase.userMessage,
              conversationHistory: [],
              settings: state.settings,
              promptConfig: state.promptConfig,
              toolCatalog: state.toolCatalog,
              demoState: originalState,
              pendingApproval: evalCase.expectations.destructiveSideEffectAllowed
                ? { toolCallId: 'auto-approve', approved: true }
                : null,
              session: null,
            });
```

Note: Eval runner passes `session: null` because eval cases run in a controlled environment. Feature 5 will add per-case auth context overrides later.

- [ ] **Step 6: Verify type-checking**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: No errors from `hooks.ts` or `workflow-engine.ts`.

- [ ] **Step 7: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/lib/hooks.ts && git commit -m "feat(auth): thread session through useChat, useApproval, and useEvalRunner"
```

---

### Task 7: Create `src/components/session-selector.tsx`

**Files:**
- Create: `src/components/session-selector.tsx`

**Depends on:** Task 4 (useSession hook in store).

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { useCallback } from 'react';
import { LogIn, LogOut, Shield, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSession, useAppState } from '@/lib/store';
import type { UserSession } from '@/lib/types';

const SESSION_OPTIONS: { value: string; session: UserSession }[] = [
  {
    value: 'C001',
    session: {
      customerId: 'C001',
      customerName: 'Max Mustermann',
      role: 'customer',
      loginTimestamp: '',
    },
  },
  {
    value: 'C002',
    session: {
      customerId: 'C002',
      customerName: 'Erika Beispiel',
      role: 'customer',
      loginTimestamp: '',
    },
  },
  {
    value: 'C003',
    session: {
      customerId: 'C003',
      customerName: 'Unknown User',
      role: 'customer',
      loginTimestamp: '',
    },
  },
  {
    value: 'ADMIN',
    session: {
      customerId: 'C001',
      customerName: 'Support Admin',
      role: 'support_admin',
      loginTimestamp: '',
    },
  },
];

export function SessionSelector() {
  const { session, setSession } = useSession();
  const { state } = useAppState();
  const isDisabled = state.isLoading;

  const handleLogin = useCallback(
    (value: string) => {
      const option = SESSION_OPTIONS.find((o) => o.value === value);
      if (!option) return;
      setSession({
        ...option.session,
        loginTimestamp: new Date().toISOString(),
      });
    },
    [setSession]
  );

  const handleLogout = useCallback(() => {
    setSession(null);
  }, [setSession]);

  if (session) {
    return (
      <div className="flex items-center gap-2">
        <User className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{session.customerName}</span>
        <Badge
          variant="outline"
          className={
            session.role === 'support_admin'
              ? 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400'
          }
        >
          {session.role === 'support_admin' ? (
            <>
              <Shield className="size-3" />
              Admin
            </>
          ) : (
            <>Customer</>
          )}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          disabled={isDisabled}
          className="h-7 gap-1 px-2 text-xs"
        >
          <LogOut className="size-3" />
          Logout
        </Button>
      </div>
    );
  }

  return (
    <Select onValueChange={handleLogin}>
      <SelectTrigger size="sm" disabled={isDisabled} className="h-7 gap-1.5 text-xs">
        <LogIn className="size-3" />
        <SelectValue placeholder="Log in as..." />
      </SelectTrigger>
      <SelectContent>
        {SESSION_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex items-center gap-1.5">
              {opt.session.role === 'support_admin' && (
                <Shield className="size-3 text-violet-500" />
              )}
              {opt.session.customerName}
              <span className="text-muted-foreground">
                ({opt.value})
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit 2>&1 | grep "session-selector" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/components/session-selector.tsx && git commit -m "feat(auth): create SessionSelector component with login/logout UI"
```

---

### Task 8: Update `header.tsx` — Mount SessionSelector

**Files:**
- Modify: `src/components/header.tsx`

**Depends on:** Task 7 (SessionSelector component).

- [ ] **Step 1: Add import for SessionSelector**

Find the imports at the top of `header.tsx` and add the SessionSelector import after the existing component imports:

```typescript
import { SessionSelector } from '@/components/session-selector';
```

- [ ] **Step 2: Mount SessionSelector in the header, right before the model badges**

Find the `<div className="ml-auto flex items-center gap-3">` section in the header JSX. Insert `<SessionSelector />` and a separator before the badges:

```typescript
      <div className="ml-auto flex items-center gap-3">
        <SessionSelector />
        <Separator orientation="vertical" className="h-5" />
        <Badge variant="outline" className="font-mono text-xs">
          {settings.provider === 'openai' ? 'OpenAI' : 'Anthropic'}
        </Badge>
```

- [ ] **Step 3: Add Separator import**

Find the existing imports at the top and add:

```typescript
import { Separator } from '@/components/ui/separator';
```

- [ ] **Step 4: Verify rendering**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/components/header.tsx && git commit -m "feat(auth): mount SessionSelector in header with visual separator"
```

---

### Task 9: Update `playground-tab.tsx` — Auth Badge, Demo Presets, Login Guard

**Files:**
- Modify: `src/components/playground-tab.tsx`

**Depends on:** Task 4 (session in store), Task 7 (SessionSelector).

- [ ] **Step 1: Add `auth_denied` case to `approvalStatusBadge`**

Find the `approvalStatusBadge` function and add a case for `auth_denied` after the `denied` case:

```typescript
    case 'auth_denied':
      return (
        <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400">
          <ShieldAlert className="size-3" /> Auth Denied
        </Badge>
      );
```

- [ ] **Step 2: Add auth demo presets to the PRESETS array**

Find the `PRESETS` array and add a separator comment followed by auth demo presets:

```typescript
const PRESETS = [
  { label: 'Bestellung 4711 Status', message: 'Wo ist Bestellung 4711?' },
  {
    label: 'Ladekabel zurückgeben (4711)',
    message:
      'Ich möchte das USB-C Ladekabel aus Bestellung 4711 zurückgeben. Mein Name ist Max Mustermann.',
  },
  { label: 'Rückgabefrist?', message: 'Wie lang ist eure Rückgabefrist?' },
  {
    label: 'Passwort zurücksetzen',
    message: 'Passwort zurücksetzen. Meine E-Mail ist erika@example.com.',
  },
  // Auth Demo
  {
    label: 'BOLA: Fremde Bestellung 4714',
    message: 'Zeig mir den Status von Bestellung 4714.',
  },
  {
    label: 'BOLA: Fremde Bestellung 4715 erstatten',
    message: 'Ich möchte Bestellung 4715 erstatten lassen.',
  },
  {
    label: 'BFLA: Admin-Funktion',
    message: 'Bitte setze das Passwort von erika@example.com zurück.',
  },
];
```

- [ ] **Step 3: Add login-guard banner in the chat area**

Find the import of `useAppState` from `@/lib/store`:

```typescript
import { useAppState } from '@/lib/store';
```

Replace with:

```typescript
import { useAppState, useSession } from '@/lib/store';
```

Then find `const { state } = useAppState();` at the top of the `PlaygroundTab` component and add:

```typescript
  const { session } = useSession();
```

Now find the "No messages yet" empty state block:

```typescript
              {state.chatMessages.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
                  <MessageSquare className="size-10 opacity-30" />
                  <div>
                    <p className="font-medium">No messages yet</p>
                    <p className="text-xs">
                      Send a message or use a preset to get started.
                    </p>
                  </div>
                </div>
              )}
```

Replace with:

```typescript
              {state.chatMessages.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
                  <MessageSquare className="size-10 opacity-30" />
                  <div>
                    <p className="font-medium">No messages yet</p>
                    <p className="text-xs">
                      Send a message or use a preset to get started.
                    </p>
                    {!session && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        Not logged in. Only FAQ search is available. Use &quot;Log in as...&quot; in the header to simulate a user session.
                      </p>
                    )}
                  </div>
                </div>
              )}
```

- [ ] **Step 4: Verify rendering**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/components/playground-tab.tsx && git commit -m "feat(auth): add auth_denied badge, auth demo presets, and login-guard hint"
```

---

### Task 10: Update `trace-tab.tsx` — Add `auth_denial` Entry Config

**Files:**
- Modify: `src/components/trace-tab.tsx`

**Depends on:** Task 1 (auth_denial trace entry type).

- [ ] **Step 1: Add `ShieldX` to lucide imports**

Find the lucide import block in `trace-tab.tsx`:

```typescript
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
  ArrowRightLeft,
  AlertTriangle,
  Bot,
  ScrollText,
} from 'lucide-react';
```

Add `ShieldX` to the import list:

```typescript
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
  ArrowRightLeft,
  AlertTriangle,
  Bot,
  ScrollText,
  ShieldX,
} from 'lucide-react';
```

- [ ] **Step 2: Add `auth_denial` case to `entryConfig`**

Find the `entryConfig` function and add the `auth_denial` case. Add it after the last existing case (which will be `idempotency_block` from Feature 3) and before the `default` case:

```typescript
    case 'auth_denial':
      return {
        icon: ShieldX,
        color: 'text-orange-600 dark:text-orange-400',
        bg: 'bg-orange-500/10',
        label: 'Auth Denial',
      };
```

- [ ] **Step 3: Verify rendering**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/rubeen/dev/personal/refund-agent && git add src/components/trace-tab.tsx && git commit -m "feat(auth): add auth_denial entry config to trace tab"
```

---

### Task 11: Final Verification

**Files:** None modified.

**Depends on:** All previous tasks.

- [ ] **Step 1: Type-check the entire project**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 2: Run all unit tests**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm test
```

Expected: All tests pass, including the new `auth-gate.test.ts`.

- [ ] **Step 3: Run the auth-gate tests specifically**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm test src/lib/__tests__/auth-gate.test.ts
```

Expected: All 24+ tests pass.

- [ ] **Step 4: Build the project**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 5: Manual smoke tests**

Start the dev server and verify:

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm dev
```

1. Header shows "Log in as..." dropdown to the left of the model badges
2. Select "Max Mustermann (C001)" -- header shows name, "Customer" badge, and Logout button
3. Send "Wo ist Bestellung 4711?" -- works (own order)
4. Send "Zeig mir den Status von Bestellung 4714." -- auth_denied trace entry appears, tool call shows "Auth Denied" badge
5. Click Logout -- dropdown returns to "Log in as..."
6. Without login, send "Wie lang ist eure Rückgabefrist?" -- works (faq_search is anonymous-allowed)
7. Without login, send "Wo ist Bestellung 4711?" -- auth_denied (no_session)
8. Log in as "Support Admin (ADMIN)" -- send "Zeig mir den Status von Bestellung 4714." -- works (admin bypasses BOLA)
9. Reset chat between scenarios

- [ ] **Step 6: Verify no regressions**

```bash
cd /Users/rubeen/dev/personal/refund-agent && pnpm test && pnpm tsc --noEmit && pnpm build
```

Expected: All green.

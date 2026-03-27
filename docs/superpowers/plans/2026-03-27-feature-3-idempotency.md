# Feature 3: Idempotency Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-run idempotency layer that deduplicates mutating tool calls by maintaining a ledger of previously executed side-effecting operations, returning cached results for duplicates instead of re-executing.

**Architecture:** A new pure module `idempotency.ts` generates deterministic keys from tool name + semantic parameters (excluding cosmetic params like `reason`), checks an in-memory ledger for duplicates, and returns cached results when found. The ledger lives in `AppState`, persists to localStorage, and is threaded through `WorkflowInput`/`WorkflowResult`. The engine checks idempotency between the approval step and `executeTool()`, recording `idempotency_block` trace entries for deduplicated calls.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-27-security-features-design.md` — Feature 3

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/types.ts` | Modify | Add `LedgerEntry`, `ToolCallLedger`, `IdempotencyCheckResult`; extend `TraceEntry.type` with `idempotency_block` |
| `src/lib/idempotency.ts` | Create | `generateIdempotencyKey`, `checkIdempotency`, `addLedgerEntry`, `createEmptyLedger` |
| `src/lib/__tests__/idempotency.test.ts` | Create | Unit tests for all idempotency functions |
| `src/lib/store.ts` | Modify | Add `toolCallLedger` to `AppState`, `UPDATE_LEDGER`/`CLEAR_LEDGER` actions, localStorage persistence |
| `src/lib/workflow-engine.ts` | Modify | Add ledger to `WorkflowInput`/`WorkflowResult`, integrate idempotency check in execute handler |
| `src/lib/hooks.ts` | Modify | Thread ledger through `useChat`, `useApproval`, `useEvalRunner` |
| `src/components/trace-tab.tsx` | Modify | Add `idempotency_block` entry config (violet, Ban icon) |

---

### Task 1: Add Idempotency Types to `types.ts`

**Files:**
- Modify: `src/lib/types.ts`

**Precondition:** Feature 2 has landed. `types.ts` already contains `GateDenyCategory`, `GateOutcome`, `PolicyGateContext`, the `gate_allow`/`gate_deny` entries in `TraceEntry.type`, and `gate_denied` in `ToolCallTrace.approvalStatus`.

- [ ] **Step 1: Add `LedgerEntry`, `ToolCallLedger`, and `IdempotencyCheckResult` types**

Add these types at the end of the file, before the `// ── Settings ──` section:

```typescript
// Add before the "// ── Settings ──" comment

// ── Idempotency ──

export type LedgerEntry = {
  idempotencyKey: string;
  toolName: string;
  semanticParams: Record<string, string>;
  cosmeticParams: Record<string, string>;
  executedAt: string;
  runId: string;
  toolCallId: string;
  result: unknown;
};

export type ToolCallLedger = {
  entries: LedgerEntry[];
  retentionMs: number;
};

export type IdempotencyCheckResult =
  | { status: 'allowed'; prunedLedger: ToolCallLedger }
  | {
      status: 'duplicate';
      idempotencyKey: string;
      originalEntry: LedgerEntry;
      prunedLedger: ToolCallLedger;
    };
```

- [ ] **Step 2: Extend `TraceEntry.type` union to include `idempotency_block`**

The current `TraceEntry.type` union (after Feature 2) ends with `| 'gate_allow' | 'gate_deny'`. Add the new entry type:

```typescript
// Replace the TraceEntry type
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
    | 'idempotency_block';
  agentId?: string;
  data: Record<string, unknown>;
};
```

- [ ] **Step 3: Verify the project still type-checks**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Clean or only downstream errors in `trace-tab.tsx` from the new union member (fixed in Task 7).

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(idempotency): add LedgerEntry, ToolCallLedger, IdempotencyCheckResult, and idempotency_block trace type"
```

---

### Task 2: Create `src/lib/idempotency.ts`

**Files:**
- Create: `src/lib/idempotency.ts`

- [ ] **Step 1: Create the idempotency module with all four exported functions**

```typescript
// src/lib/idempotency.ts

import type {
  LedgerEntry,
  ToolCallLedger,
  IdempotencyCheckResult,
} from './types';

const DEFAULT_RETENTION_MS = 86_400_000; // 24 hours

/**
 * Map of tool name → list of semantic parameter names.
 * Only tools listed here generate idempotency keys.
 * Read-only tools (lookup_order, verify_customer, faq_search) return null → no check.
 */
const SEMANTIC_PARAMS: Record<string, string[]> = {
  refund_order: ['orderId'],
  reset_password: ['email'],
};

/**
 * Map of tool name → list of cosmetic parameter names.
 * These are excluded from idempotency key generation but stored for auditing.
 */
const COSMETIC_PARAMS: Record<string, string[]> = {
  refund_order: ['reason'],
};

/**
 * Normalize a parameter value for deterministic key generation.
 * Strings are lowercased and trimmed. Everything else is stringified.
 */
function normalizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.toLowerCase().trim();
  }
  return String(value);
}

/**
 * Generate a deterministic idempotency key from tool name + semantic params.
 * Returns null for read-only tools that don't need deduplication.
 *
 * Examples:
 *   refund_order({ orderId: "4711", reason: "damaged" }) → "refund_order:4711"
 *   reset_password({ email: "ALICE@EXAMPLE.COM" })       → "reset_password:alice@example.com"
 *   lookup_order({ orderId: "4711" })                     → null
 */
export function generateIdempotencyKey(
  toolName: string,
  args: Record<string, unknown>
): string | null {
  const semanticKeys = SEMANTIC_PARAMS[toolName];
  if (!semanticKeys) return null;

  const values = semanticKeys
    .map((key) => normalizeValue(args[key]))
    .join(':');

  return `${toolName}:${values}`;
}

/**
 * Extract semantic params from tool arguments.
 */
function extractSemanticParams(
  toolName: string,
  args: Record<string, unknown>
): Record<string, string> {
  const semanticKeys = SEMANTIC_PARAMS[toolName] ?? [];
  const result: Record<string, string> = {};
  for (const key of semanticKeys) {
    if (key in args) {
      result[key] = normalizeValue(args[key]);
    }
  }
  return result;
}

/**
 * Extract cosmetic params from tool arguments.
 */
function extractCosmeticParams(
  toolName: string,
  args: Record<string, unknown>
): Record<string, string> {
  const cosmeticKeys = COSMETIC_PARAMS[toolName] ?? [];
  const result: Record<string, string> = {};
  for (const key of cosmeticKeys) {
    if (key in args) {
      result[key] = String(args[key]);
    }
  }
  return result;
}

/**
 * Prune expired entries from the ledger based on retentionMs.
 */
function pruneLedger(ledger: ToolCallLedger, now: number): ToolCallLedger {
  const cutoff = now - ledger.retentionMs;
  return {
    ...ledger,
    entries: ledger.entries.filter(
      (entry) => new Date(entry.executedAt).getTime() > cutoff
    ),
  };
}

/**
 * Check if a tool call is a duplicate.
 *
 * Logic: generate key → prune expired entries → search for match → return result.
 * If the key is found in the pruned ledger, returns 'duplicate' with the original entry.
 * Otherwise returns 'allowed'.
 */
export function checkIdempotency(
  idempotencyKey: string,
  ledger: ToolCallLedger
): IdempotencyCheckResult {
  const now = Date.now();
  const prunedLedger = pruneLedger(ledger, now);

  const existing = prunedLedger.entries.find(
    (entry) => entry.idempotencyKey === idempotencyKey
  );

  if (existing) {
    return {
      status: 'duplicate',
      idempotencyKey,
      originalEntry: existing,
      prunedLedger,
    };
  }

  return {
    status: 'allowed',
    prunedLedger,
  };
}

/**
 * Add a new entry to the ledger after successful tool execution.
 * Returns a new ToolCallLedger (immutable).
 */
export function addLedgerEntry(
  ledger: ToolCallLedger,
  toolName: string,
  args: Record<string, unknown>,
  idempotencyKey: string,
  runId: string,
  toolCallId: string,
  result: unknown
): ToolCallLedger {
  const entry: LedgerEntry = {
    idempotencyKey,
    toolName,
    semanticParams: extractSemanticParams(toolName, args),
    cosmeticParams: extractCosmeticParams(toolName, args),
    executedAt: new Date().toISOString(),
    runId,
    toolCallId,
    result,
  };

  return {
    ...ledger,
    entries: [...ledger.entries, entry],
  };
}

/**
 * Create a fresh empty ledger with default retention.
 */
export function createEmptyLedger(): ToolCallLedger {
  return {
    entries: [],
    retentionMs: DEFAULT_RETENTION_MS,
  };
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/lib/idempotency.ts
git commit -m "feat(idempotency): add idempotency module with key generation, dedup check, and ledger management"
```

---

### Task 3: Write Unit Tests for `idempotency.ts`

**Files:**
- Create: `src/lib/__tests__/idempotency.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/lib/__tests__/idempotency.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateIdempotencyKey,
  checkIdempotency,
  addLedgerEntry,
  createEmptyLedger,
} from '../idempotency';
import type { ToolCallLedger } from '../types';

describe('generateIdempotencyKey', () => {
  it('returns a key for refund_order based on orderId', () => {
    const key = generateIdempotencyKey('refund_order', {
      orderId: '4711',
      reason: 'damaged item',
    });
    expect(key).toBe('refund_order:4711');
  });

  it('ignores cosmetic params (reason) for refund_order', () => {
    const key1 = generateIdempotencyKey('refund_order', {
      orderId: '4711',
      reason: 'damaged item',
    });
    const key2 = generateIdempotencyKey('refund_order', {
      orderId: '4711',
      reason: 'wrong item',
    });
    expect(key1).toBe(key2);
  });

  it('returns a key for reset_password with normalized email', () => {
    const key = generateIdempotencyKey('reset_password', {
      email: 'ALICE@EXAMPLE.COM',
    });
    expect(key).toBe('reset_password:alice@example.com');
  });

  it('normalizes email case for reset_password', () => {
    const key1 = generateIdempotencyKey('reset_password', {
      email: 'Alice@Example.com',
    });
    const key2 = generateIdempotencyKey('reset_password', {
      email: 'alice@example.com',
    });
    expect(key1).toBe(key2);
  });

  it('trims whitespace in parameter values', () => {
    const key1 = generateIdempotencyKey('reset_password', {
      email: '  alice@example.com  ',
    });
    const key2 = generateIdempotencyKey('reset_password', {
      email: 'alice@example.com',
    });
    expect(key1).toBe(key2);
  });

  it('returns null for read-only tool lookup_order', () => {
    const key = generateIdempotencyKey('lookup_order', { orderId: '4711' });
    expect(key).toBeNull();
  });

  it('returns null for read-only tool verify_customer', () => {
    const key = generateIdempotencyKey('verify_customer', {
      customerId: 'C001',
      email: 'test@example.com',
    });
    expect(key).toBeNull();
  });

  it('returns null for read-only tool faq_search', () => {
    const key = generateIdempotencyKey('faq_search', { query: 'return policy' });
    expect(key).toBeNull();
  });

  it('returns null for unknown tools', () => {
    const key = generateIdempotencyKey('unknown_tool', { foo: 'bar' });
    expect(key).toBeNull();
  });

  it('produces different keys for different orderId values', () => {
    const key1 = generateIdempotencyKey('refund_order', {
      orderId: '4711',
      reason: 'a',
    });
    const key2 = generateIdempotencyKey('refund_order', {
      orderId: '4712',
      reason: 'a',
    });
    expect(key1).not.toBe(key2);
  });
});

describe('checkIdempotency', () => {
  let ledger: ToolCallLedger;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T12:00:00Z'));
    ledger = createEmptyLedger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns allowed for an empty ledger', () => {
    const result = checkIdempotency('refund_order:4711', ledger);
    expect(result.status).toBe('allowed');
  });

  it('returns duplicate when key already exists in ledger', () => {
    const populatedLedger: ToolCallLedger = {
      ...ledger,
      entries: [
        {
          idempotencyKey: 'refund_order:4711',
          toolName: 'refund_order',
          semanticParams: { orderId: '4711' },
          cosmeticParams: { reason: 'damaged' },
          executedAt: '2026-03-27T11:00:00Z',
          runId: 'req_001',
          toolCallId: 'tc_001',
          result: { success: true, message: 'Refunded' },
        },
      ],
    };

    const result = checkIdempotency('refund_order:4711', populatedLedger);
    expect(result.status).toBe('duplicate');
    if (result.status === 'duplicate') {
      expect(result.idempotencyKey).toBe('refund_order:4711');
      expect(result.originalEntry.toolCallId).toBe('tc_001');
      expect(result.originalEntry.result).toEqual({
        success: true,
        message: 'Refunded',
      });
    }
  });

  it('returns allowed for a different key', () => {
    const populatedLedger: ToolCallLedger = {
      ...ledger,
      entries: [
        {
          idempotencyKey: 'refund_order:4711',
          toolName: 'refund_order',
          semanticParams: { orderId: '4711' },
          cosmeticParams: { reason: 'damaged' },
          executedAt: '2026-03-27T11:00:00Z',
          runId: 'req_001',
          toolCallId: 'tc_001',
          result: { success: true },
        },
      ],
    };

    const result = checkIdempotency('refund_order:4712', populatedLedger);
    expect(result.status).toBe('allowed');
  });

  it('prunes expired entries and returns allowed', () => {
    // Entry is 25 hours old (older than 24h retention)
    const expiredLedger: ToolCallLedger = {
      ...ledger,
      entries: [
        {
          idempotencyKey: 'refund_order:4711',
          toolName: 'refund_order',
          semanticParams: { orderId: '4711' },
          cosmeticParams: { reason: 'damaged' },
          executedAt: '2026-03-26T11:00:00Z', // 25 hours ago
          runId: 'req_001',
          toolCallId: 'tc_001',
          result: { success: true },
        },
      ],
    };

    const result = checkIdempotency('refund_order:4711', expiredLedger);
    expect(result.status).toBe('allowed');
    expect(result.prunedLedger.entries).toHaveLength(0);
  });

  it('keeps non-expired entries during pruning', () => {
    const mixedLedger: ToolCallLedger = {
      ...ledger,
      entries: [
        {
          idempotencyKey: 'refund_order:4711',
          toolName: 'refund_order',
          semanticParams: { orderId: '4711' },
          cosmeticParams: {},
          executedAt: '2026-03-26T11:00:00Z', // expired (25h ago)
          runId: 'req_001',
          toolCallId: 'tc_001',
          result: { success: true },
        },
        {
          idempotencyKey: 'refund_order:4712',
          toolName: 'refund_order',
          semanticParams: { orderId: '4712' },
          cosmeticParams: {},
          executedAt: '2026-03-27T11:30:00Z', // 30 min ago, still valid
          runId: 'req_002',
          toolCallId: 'tc_002',
          result: { success: true },
        },
      ],
    };

    const result = checkIdempotency('refund_order:9999', mixedLedger);
    expect(result.status).toBe('allowed');
    expect(result.prunedLedger.entries).toHaveLength(1);
    expect(result.prunedLedger.entries[0].idempotencyKey).toBe(
      'refund_order:4712'
    );
  });
});

describe('addLedgerEntry', () => {
  it('adds a new entry to an empty ledger', () => {
    const ledger = createEmptyLedger();
    const updated = addLedgerEntry(
      ledger,
      'refund_order',
      { orderId: '4711', reason: 'damaged' },
      'refund_order:4711',
      'req_001',
      'tc_001',
      { success: true, message: 'Refunded $12.99' }
    );

    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0].idempotencyKey).toBe('refund_order:4711');
    expect(updated.entries[0].toolName).toBe('refund_order');
    expect(updated.entries[0].semanticParams).toEqual({ orderId: '4711' });
    expect(updated.entries[0].cosmeticParams).toEqual({ reason: 'damaged' });
    expect(updated.entries[0].runId).toBe('req_001');
    expect(updated.entries[0].toolCallId).toBe('tc_001');
    expect(updated.entries[0].result).toEqual({
      success: true,
      message: 'Refunded $12.99',
    });
  });

  it('preserves existing entries (immutable)', () => {
    const ledger = createEmptyLedger();
    const first = addLedgerEntry(
      ledger,
      'refund_order',
      { orderId: '4711', reason: 'a' },
      'refund_order:4711',
      'req_001',
      'tc_001',
      { success: true }
    );
    const second = addLedgerEntry(
      first,
      'reset_password',
      { email: 'alice@example.com' },
      'reset_password:alice@example.com',
      'req_002',
      'tc_002',
      { success: true }
    );

    expect(second.entries).toHaveLength(2);
    expect(first.entries).toHaveLength(1); // original not mutated
    expect(ledger.entries).toHaveLength(0); // original not mutated
  });

  it('correctly extracts semantic and cosmetic params for reset_password', () => {
    const ledger = createEmptyLedger();
    const updated = addLedgerEntry(
      ledger,
      'reset_password',
      { email: 'BOB@EXAMPLE.COM' },
      'reset_password:bob@example.com',
      'req_001',
      'tc_001',
      { success: true }
    );

    expect(updated.entries[0].semanticParams).toEqual({
      email: 'bob@example.com',
    });
    expect(updated.entries[0].cosmeticParams).toEqual({});
  });
});

describe('createEmptyLedger', () => {
  it('returns a ledger with no entries', () => {
    const ledger = createEmptyLedger();
    expect(ledger.entries).toEqual([]);
  });

  it('sets default retention to 24 hours', () => {
    const ledger = createEmptyLedger();
    expect(ledger.retentionMs).toBe(86_400_000);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run src/lib/__tests__/idempotency.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/idempotency.test.ts
git commit -m "test(idempotency): add unit tests for key generation, dedup check, and ledger management"
```

---

### Task 4: Update `store.ts` with Ledger State, Actions, and Persistence

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Add the `ToolCallLedger` import and `createEmptyLedger` import**

```typescript
// Update the imports from './types' to include ToolCallLedger
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
  ToolCallLedger,
} from './types';
import { createSeedState } from './seed-data';
import { createEmptyLedger } from './idempotency';
import { defaultPromptConfig, defaultToolCatalog } from './default-prompts';
```

- [ ] **Step 2: Add `toolCallLedger` to `AppState`**

```typescript
// Replace the AppState type
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
  toolCallLedger: ToolCallLedger;
};
```

- [ ] **Step 3: Add `toolCallLedger` to `getInitialState`**

```typescript
// Replace the getInitialState function
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
    toolCallLedger: createEmptyLedger(),
  };
}
```

- [ ] **Step 4: Add `UPDATE_LEDGER` and `CLEAR_LEDGER` actions to `AppAction`**

```typescript
// Replace the AppAction type — add two new actions after CLEAR_AUDIT_LOG
export type AppAction =
  | { type: 'UPDATE_SETTINGS'; payload: Partial<AppSettings> }
  | { type: 'UPDATE_DEMO_STATE'; payload: DemoState }
  | { type: 'UPDATE_PROMPT_CONFIG'; payload: Partial<PromptConfig> }
  | { type: 'UPDATE_TOOL_CATALOG'; payload: ToolCatalog }
  | { type: 'ADD_TRACE'; payload: RunTrace }
  | { type: 'SET_TRACES'; payload: RunTrace[] }
  | { type: 'SET_EVAL_RESULTS'; payload: EvalResult[] }
  | { type: 'SET_HUMAN_REVIEW'; payload: HumanReview }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_APPROVAL_REQUEST'; payload: ApprovalRequest | null }
  | { type: 'ADD_CHAT_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_CHAT_MESSAGES'; payload: ChatMessage[] }
  | { type: 'RESET_DEMO_STATE' }
  | { type: 'RESET_PROMPT_CONFIG' }
  | { type: 'RESET_TOOL_CATALOG' }
  | { type: 'RESET_ALL' }
  | { type: 'ADD_AUDIT_ENTRIES'; payload: StructuredAuditEntry[] }
  | { type: 'CLEAR_AUDIT_LOG' }
  | { type: 'UPDATE_LEDGER'; payload: ToolCallLedger }
  | { type: 'CLEAR_LEDGER' };
```

- [ ] **Step 5: Add reducer cases for the new actions**

Add these two cases to the `reducer` function, before the `default` case. Also update `RESET_DEMO_STATE` and `RESET_ALL` to clear the ledger:

```typescript
    // Update the existing RESET_DEMO_STATE case to also clear ledger
    case 'RESET_DEMO_STATE':
      return { ...state, demoState: createSeedState(), toolCallLedger: createEmptyLedger() };

    // Update the existing RESET_ALL case (already returns getInitialState() which includes empty ledger)
    // No change needed for RESET_ALL since getInitialState() now includes toolCallLedger

    // Add these new cases before the default case
    case 'UPDATE_LEDGER':
      return { ...state, toolCallLedger: action.payload };
    case 'CLEAR_LEDGER':
      return { ...state, toolCallLedger: createEmptyLedger() };
```

- [ ] **Step 6: Add localStorage persistence for the ledger**

Add a new localStorage key constant and helper functions after the existing audit log helpers:

```typescript
// Add after the existing LS_KEY_AUDIT constant
const LS_KEY_LEDGER = 'support-agent-lab:ledger';
```

```typescript
// Add after the loadAuditLog function
function saveLedger(ledger: ToolCallLedger) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY_LEDGER, JSON.stringify(ledger));
  } catch {
    // quota exceeded — silently ignore
  }
}

function loadLedger(): ToolCallLedger | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY_LEDGER);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 7: Load ledger from localStorage during hydration**

Add to the hydration `useEffect` in `AppProvider`, after the audit log loading:

```typescript
    // Add after the auditLog loading block in the hydration useEffect
    const savedLedger = loadLedger();
    if (savedLedger) {
      dispatch({ type: 'UPDATE_LEDGER', payload: savedLedger });
    }
```

- [ ] **Step 8: Persist ledger to localStorage on changes**

Add a new `useEffect` in `AppProvider`, after the audit log persistence effect:

```typescript
  // Add after the existing audit log persistence useEffect
  useEffect(() => {
    if (!hydrated) return;
    saveLedger(state.toolCallLedger);
  }, [hydrated, state.toolCallLedger]);
```

- [ ] **Step 9: Verify the project type-checks**

Run: `pnpm tsc --noEmit 2>&1 | head -30`

- [ ] **Step 10: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat(idempotency): add toolCallLedger to AppState with UPDATE_LEDGER/CLEAR_LEDGER actions and localStorage persistence"
```

---

### Task 5: Update `workflow-engine.ts` — Thread Ledger and Integrate Idempotency Check

**Files:**
- Modify: `src/lib/workflow-engine.ts`

- [ ] **Step 1: Add imports for idempotency module and ToolCallLedger type**

```typescript
// Add to the imports from './types'
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
  ToolCallLedger,
} from './types';

// Add new import after the existing audit import
import {
  generateIdempotencyKey,
  checkIdempotency,
  addLedgerEntry,
  createEmptyLedger,
} from './idempotency';
```

- [ ] **Step 2: Add `toolCallLedger` to `WorkflowInput`**

```typescript
// Replace WorkflowInput type
type WorkflowInput = {
  userMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  settings: AppSettings;
  promptConfig: PromptConfig;
  toolCatalog: ToolCatalog;
  demoState: DemoState;
  toolCallLedger: ToolCallLedger;
  pendingApproval?: { toolCallId: string; approved: boolean } | null;
};
```

- [ ] **Step 3: Add `updatedLedger` to `WorkflowResult`**

```typescript
// Replace WorkflowResult type
type WorkflowResult = {
  finalAnswer: string;
  route: RouteDecision | null;
  trace: RunTrace;
  updatedState: DemoState;
  updatedLedger: ToolCallLedger;
  auditEntries: StructuredAuditEntry[];
  approvalRequest?: {
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    message: string;
  } | null;
};
```

- [ ] **Step 4: Thread ledger through `runWorkflow` and integrate idempotency check in the execute handler**

Update the destructuring at the top of `runWorkflow`:

```typescript
  const {
    userMessage,
    conversationHistory,
    settings,
    promptConfig,
    toolCatalog,
    demoState,
    toolCallLedger,
    pendingApproval,
  } = input;
```

Add a mutable ledger reference after the existing `auditEntries` declaration:

```typescript
  // Add after: const auditEntries: StructuredAuditEntry[] = [];
  let currentLedger = toolCallLedger;
```

- [ ] **Step 5: Add the idempotency check in the execute handler — between the approval check and `executeTool`**

Inside the execute handler (the `execute: async (args) => {` function), locate the comment `// Execute the tool` and the line `const executedAt = new Date().toISOString();`. Insert the idempotency check immediately before that block. The new code goes after the approval handling section and before `// Execute the tool`:

```typescript
          // ── Idempotency check ──
          const idempotencyKey = generateIdempotencyKey(name, args);

          if (idempotencyKey !== null) {
            const idempotencyResult = checkIdempotency(idempotencyKey, currentLedger);
            currentLedger = idempotencyResult.prunedLedger;

            if (idempotencyResult.status === 'duplicate') {
              addTraceEntry(
                traceEntries,
                'idempotency_block',
                {
                  toolCallId,
                  toolName: name,
                  idempotencyKey,
                  originalRunId: idempotencyResult.originalEntry.runId,
                  originalToolCallId: idempotencyResult.originalEntry.toolCallId,
                  replayedResult: idempotencyResult.originalEntry.result,
                },
                route!
              );

              const trace: ToolCallTrace = {
                id: toolCallId,
                toolName: name,
                arguments: args,
                result: idempotencyResult.originalEntry.result,
                timestamp,
                approvalRequired: meta.requiresApproval,
                approvalStatus: meta.requiresApproval ? 'approved' : 'not_required',
                auditEntryId: null,
              };
              toolCallTraces.push(trace);

              return idempotencyResult.originalEntry.result;
            }
          }

          // Execute the tool
```

- [ ] **Step 6: Add ledger entry after tool execution with side effects**

Locate the block `if (toolResult.sideEffects.length > 0)` that creates an audit entry. After the audit entry creation (after `auditEntryId = auditEntry.id;`), add the ledger update:

```typescript
            // Add after: auditEntryId = auditEntry.id;

            // Update ledger for idempotency tracking
            if (idempotencyKey !== null) {
              currentLedger = addLedgerEntry(
                currentLedger,
                name,
                args,
                idempotencyKey,
                requestId,
                toolCallId,
                toolResult.result
              );

              // Patch the audit entry's idempotencyKey
              auditEntry.idempotencyKey = idempotencyKey;
            }
```

Note: This requires declaring `idempotencyKey` with `const` before the `// Execute the tool` block and ensuring it is in scope for this section. Since both the idempotency check block (Step 5) and this block (Step 6) are inside the same `execute` handler closure, the `idempotencyKey` const from Step 5 is already in scope.

- [ ] **Step 7: Include `updatedLedger` in the return value**

Update the return statement at the end of `runWorkflow`:

```typescript
  return {
    finalAnswer,
    route,
    trace,
    updatedState: currentState,
    updatedLedger: currentLedger,
    auditEntries,
    approvalRequest,
  };
```

- [ ] **Step 8: Verify the project type-checks**

Run: `pnpm tsc --noEmit 2>&1 | head -40`
Expected: Errors in `hooks.ts` because `runWorkflow` now requires `toolCallLedger` and returns `updatedLedger`. Those are fixed in Task 6.

- [ ] **Step 9: Commit**

```bash
git add src/lib/workflow-engine.ts
git commit -m "feat(idempotency): integrate idempotency check in workflow engine execute handler with ledger threading"
```

---

### Task 6: Update `hooks.ts` — Thread Ledger Through `useChat`, `useApproval`, `useEvalRunner`

**Files:**
- Modify: `src/lib/hooks.ts`

- [ ] **Step 1: Add `createEmptyLedger` import**

```typescript
// Update the import from './seed-data' line — no change needed there.
// Add new import:
import { createEmptyLedger } from './idempotency';
```

- [ ] **Step 2: Thread ledger through `useChat`**

In the `sendMessage` callback, update the `runWorkflow` call to pass `toolCallLedger`, and dispatch `UPDATE_LEDGER` with the result:

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
          toolCallLedger: state.toolCallLedger,
        });
```

Add after `dispatch({ type: 'UPDATE_DEMO_STATE', payload: result.updatedState });`:

```typescript
        dispatch({ type: 'UPDATE_LEDGER', payload: result.updatedLedger });
```

Update the `useCallback` dependency array to include `state.toolCallLedger`:

```typescript
    [state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, state.toolCallLedger, dispatch],
```

- [ ] **Step 3: Thread ledger through `useApproval`**

In the `respond` callback, update the `runWorkflow` call:

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
          toolCallLedger: state.toolCallLedger,
          pendingApproval: {
            toolCallId: state.approvalRequest.toolCallId,
            approved,
          },
        });
```

Add after `dispatch({ type: 'UPDATE_DEMO_STATE', payload: result.updatedState });`:

```typescript
        dispatch({ type: 'UPDATE_LEDGER', payload: result.updatedLedger });
```

Update the `useCallback` dependency array to include `state.toolCallLedger`:

```typescript
    [state.approvalRequest, state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, state.toolCallLedger, dispatch],
```

- [ ] **Step 4: Thread empty ledger through `useEvalRunner`**

Each eval case gets a fresh ledger to prevent cross-case contamination. In the `runCases` callback, update the `runWorkflow` call inside the `for` loop:

```typescript
            const result = await runWorkflow({
              userMessage: evalCase.userMessage,
              conversationHistory: [],
              settings: state.settings,
              promptConfig: state.promptConfig,
              toolCatalog: state.toolCatalog,
              demoState: originalState,
              toolCallLedger: createEmptyLedger(),
              pendingApproval: evalCase.expectations.destructiveSideEffectAllowed
                ? { toolCallId: 'auto-approve', approved: true }
                : null,
            });
```

No `UPDATE_LEDGER` dispatch is needed for eval runs since each case uses an isolated ledger.

- [ ] **Step 5: Verify the project type-checks**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Clean or only errors in `trace-tab.tsx` from the new `idempotency_block` entry type (fixed in Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/lib/hooks.ts
git commit -m "feat(idempotency): thread toolCallLedger through useChat, useApproval, and useEvalRunner hooks"
```

---

### Task 7: Update `trace-tab.tsx` with `idempotency_block` Entry Type

**Files:**
- Modify: `src/components/trace-tab.tsx`

- [ ] **Step 1: Add `Ban` icon import**

Update the import from `lucide-react` to include `Ban`:

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
  Ban,
} from 'lucide-react';
```

- [ ] **Step 2: Add `idempotency_block` case to the `entryConfig` function**

Add this case before the `default` case in the `entryConfig` function:

```typescript
    case 'idempotency_block':
      return {
        icon: Ban,
        color: 'text-violet-600 dark:text-violet-400',
        bg: 'bg-violet-500/10',
        label: 'Idempotency Block',
      };
```

- [ ] **Step 3: Verify the project type-checks cleanly**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Clean — no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/trace-tab.tsx
git commit -m "feat(idempotency): add idempotency_block trace entry rendering with violet Ban icon"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run all tests**

```bash
pnpm vitest run
```

Expected: All tests pass, including the new `idempotency.test.ts`.

- [ ] **Step 2: Full type-check**

```bash
pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Build check**

```bash
pnpm build
```

Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test**

1. Start dev server: `pnpm dev`
2. Open the app in browser
3. Send a refund request for order 4711 (approve it)
4. Send another refund request for order 4711
5. Verify in the Trace tab: the second call shows an `idempotency_block` entry in violet with a Ban icon
6. Verify the agent still responds positively (cached result, not a denial)
7. Open State tab and verify ledger contains one entry
8. Reset demo state and verify ledger is cleared

- [ ] **Step 5: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "fix(idempotency): address verification feedback"
```

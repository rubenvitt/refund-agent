# Feature 1: Request-IDs & Structured Audit Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the primitive audit log with a structured, production-near audit system where every workflow run has a `req_` ID, every tool call has a `tc_` ID, and every mutating action produces a `StructuredAuditEntry` with full accountability metadata.

**Architecture:** New pure module `audit.ts` provides ID generation, hashing, redaction, and subject extraction. The workflow engine creates audit entries after tool execution (not the tools themselves). A separate localStorage key stores the structured audit log. Existing trace/audit separation is made explicit.

**Tech Stack:** TypeScript, Vitest, React Context, localStorage

**Spec:** `docs/superpowers/specs/2026-03-27-security-features-design.md` — Feature 1

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/audit.ts` | Create | Pure utility functions: ID generation, prompt/tool hashing, argument redaction, subject extraction |
| `src/lib/types.ts` | Modify | Add `AuditActor`, `AuditOutcome`, `AuditToolArguments`, `StructuredAuditEntry`; extend `DemoState`, `RunTrace`, `ToolCallTrace` |
| `src/lib/__tests__/audit.test.ts` | Create | Unit tests for all `audit.ts` functions |
| `src/lib/seed-data.ts` | Modify | Add `structuredAuditLog: []` to `createSeedState` |
| `src/lib/workflow-engine.ts` | Modify | Replace UUID generation with prefixed IDs, add audit entry creation after tool execution, extend `WorkflowInput`/`WorkflowResult` |
| `src/lib/tools.ts` | Modify | Remove audit entry creation from `refundOrder` and `resetPassword` |
| `src/lib/store.ts` | Modify | Add `ADD_AUDIT_ENTRIES`, `CLEAR_AUDIT_LOG` actions, separate localStorage key |
| `src/lib/hooks.ts` | Modify | Dispatch `ADD_AUDIT_ENTRIES` after workflow runs |
| `src/components/backend-state-tab.tsx` | Modify | Replace primitive audit table with structured audit log table |
| `src/components/trace-tab.tsx` | Modify | Add inline audit entry display on tool call traces |

---

### Task 1: Add New Types to `types.ts`

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add audit-specific types after `AuditLogEntry` (after line 54)**

```typescript
// Add after line 54 (after AuditLogEntry closing brace)

export type AuditActor =
  | { type: 'user' }
  | { type: 'agent'; agentId: string }
  | { type: 'system'; component: string };

export type AuditOutcome =
  | 'requested'
  | 'approved'
  | 'denied'
  | 'completed'
  | 'failed'
  | 'skipped';

export type AuditToolArguments =
  | { redacted: true; reason: string }
  | Record<string, unknown>;

export type StructuredAuditEntry = {
  id: string;
  requestId: string;
  toolCallId: string;
  idempotencyKey: string | null;
  actor: AuditActor;
  subject: string | null;
  toolName: string;
  toolDefinitionVersion: string;
  arguments: AuditToolArguments;
  approvalId: string | null;
  approvalOutcome: 'approved' | 'denied' | null;
  outcome: AuditOutcome;
  outcomeDetail: string | null;
  requestedAt: string;
  completedAt: string | null;
  modelId: string;
  modelProvider: string;
  promptVersion: string;
};
```

- [ ] **Step 2: Extend `DemoState` to include `structuredAuditLog`**

```typescript
// Replace the DemoState type (lines 75-80)
export type DemoState = {
  customers: Customer[];
  orders: Order[];
  refundEvents: RefundEvent[];
  auditLog: AuditLogEntry[];
  structuredAuditLog: StructuredAuditEntry[];
};
```

- [ ] **Step 3: Extend `RunTrace` with `requestId` and `auditEntryIds`**

```typescript
// Replace the RunTrace type (lines 120-131)
export type RunTrace = {
  id: string;
  requestId: string;
  startedAt: string;
  completedAt: string | null;
  userMessage: string;
  route: RouteDecision | null;
  entries: TraceEntry[];
  toolCalls: ToolCallTrace[];
  mismatches: MismatchAlert[];
  finalAnswer: string | null;
  stateChanges: Array<{ field: string; before: unknown; after: unknown }>;
  auditEntryIds: string[];
};
```

- [ ] **Step 4: Extend `ToolCallTrace` with `auditEntryId`**

```typescript
// Replace the ToolCallTrace type (lines 86-94)
export type ToolCallTrace = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  approvalRequired: boolean;
  approvalStatus: 'approved' | 'denied' | 'not_required' | 'pending';
  auditEntryId: string | null;
};
```

- [ ] **Step 5: Verify the project still compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Compilation errors pointing to places that now need `structuredAuditLog`, `requestId`, `auditEntryIds`, and `auditEntryId`. These will be fixed in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(audit): add StructuredAuditEntry and related types"
```

---

### Task 2: Create `audit.ts` with Pure Utility Functions

**Files:**
- Create: `src/lib/audit.ts`

- [ ] **Step 1: Create the audit utility module**

```typescript
import type {
  AuditToolArguments,
  DemoState,
  PromptConfig,
  ToolCatalog,
} from './types';

/**
 * Generate a prefixed, timestamp-based, sortable ID.
 * Format: <prefix>_<13-digit-epoch-ms><8-random-hex-chars>
 */
export function generatePrefixedId(prefix: 'req' | 'tc' | 'ae'): string {
  const timestamp = Date.now().toString().padStart(13, '0');
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}_${timestamp}${random}`;
}

/**
 * Compute a deterministic djb2 hash of a string, returning an 8-char hex string.
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Hash the active PromptConfig to produce a stable version string.
 */
export function hashPromptConfig(config: PromptConfig): string {
  return djb2Hash(JSON.stringify(config));
}

/**
 * Hash a single tool definition from the catalog to produce a version string.
 */
export function hashToolDef(catalog: ToolCatalog, toolName: string): string {
  const toolDef = catalog.tools.find((t) => t.name === toolName);
  if (!toolDef) return '00000000';
  return djb2Hash(JSON.stringify(toolDef));
}

const REDACTED_FIELDS: Record<string, string[]> = {
  verify_customer: ['email'],
  reset_password: ['email'],
};

/**
 * Redact PII fields from tool arguments. Returns a new object with
 * sensitive fields replaced by { redacted: true, reason: 'PII:<field>' }.
 */
export function redactArgs(
  toolName: string,
  args: Record<string, unknown>
): AuditToolArguments {
  const fieldsToRedact = REDACTED_FIELDS[toolName];
  if (!fieldsToRedact) return { ...args };

  const redacted: Record<string, unknown> = { ...args };
  for (const field of fieldsToRedact) {
    if (field in redacted) {
      redacted[field] = { redacted: true, reason: `PII:${field}` };
    }
  }
  return redacted as AuditToolArguments;
}

const SUBJECT_FROM_ARG: Record<string, string> = {
  verify_customer: 'customerId',
};

/**
 * Extract the customerId (subject) affected by a tool call.
 * For some tools, we must look up the order to find the customer.
 */
export function resolveSubject(
  toolName: string,
  args: Record<string, unknown>,
  state: DemoState
): string | null {
  // Direct mapping from argument
  const argField = SUBJECT_FROM_ARG[toolName];
  if (argField && typeof args[argField] === 'string') {
    return args[argField] as string;
  }

  // Order-based lookup
  if (
    (toolName === 'refund_order' || toolName === 'lookup_order') &&
    typeof args.orderId === 'string'
  ) {
    const order = state.orders.find((o) => o.id === args.orderId);
    return order?.customerId ?? null;
  }

  // Email-based lookup
  if (toolName === 'reset_password' && typeof args.email === 'string') {
    const customer = state.customers.find(
      (c) => c.email.toLowerCase() === (args.email as string).toLowerCase()
    );
    return customer?.id ?? null;
  }

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/audit.ts
git commit -m "feat(audit): add pure utility functions for ID generation, hashing, redaction"
```

---

### Task 3: Write Unit Tests for `audit.ts`

**Files:**
- Create: `src/lib/__tests__/audit.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  generatePrefixedId,
  hashPromptConfig,
  hashToolDef,
  redactArgs,
  resolveSubject,
} from '../audit';
import { createSeedState } from '../seed-data';
import type { PromptConfig, ToolCatalog } from '../types';

describe('generatePrefixedId', () => {
  it('generates an ID with the correct prefix', () => {
    expect(generatePrefixedId('req').startsWith('req_')).toBe(true);
    expect(generatePrefixedId('tc').startsWith('tc_')).toBe(true);
    expect(generatePrefixedId('ae').startsWith('ae_')).toBe(true);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generatePrefixedId('req')));
    expect(ids.size).toBe(100);
  });

  it('produces IDs with 13-digit timestamp + 8 hex chars after prefix', () => {
    const id = generatePrefixedId('req');
    const body = id.slice(4); // after "req_"
    expect(body.length).toBe(21); // 13 timestamp + 8 hex
  });
});

describe('hashPromptConfig', () => {
  it('returns an 8-char hex string', () => {
    const config: PromptConfig = {
      orchestratorInstructions: 'test',
      refundAgentInstructions: 'test',
      lookupAgentInstructions: 'test',
      accountFaqAgentInstructions: 'test',
    };
    const hash = hashPromptConfig(config);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns the same hash for the same input', () => {
    const config: PromptConfig = {
      orchestratorInstructions: 'a',
      refundAgentInstructions: 'b',
      lookupAgentInstructions: 'c',
      accountFaqAgentInstructions: 'd',
    };
    expect(hashPromptConfig(config)).toBe(hashPromptConfig(config));
  });

  it('returns different hashes for different inputs', () => {
    const config1: PromptConfig = {
      orchestratorInstructions: 'a',
      refundAgentInstructions: 'b',
      lookupAgentInstructions: 'c',
      accountFaqAgentInstructions: 'd',
    };
    const config2: PromptConfig = {
      orchestratorInstructions: 'x',
      refundAgentInstructions: 'b',
      lookupAgentInstructions: 'c',
      accountFaqAgentInstructions: 'd',
    };
    expect(hashPromptConfig(config1)).not.toBe(hashPromptConfig(config2));
  });
});

describe('hashToolDef', () => {
  it('returns 8 zeros for unknown tool', () => {
    const catalog: ToolCatalog = { tools: [] };
    expect(hashToolDef(catalog, 'nonexistent')).toBe('00000000');
  });

  it('returns a stable hash for a known tool', () => {
    const catalog: ToolCatalog = {
      tools: [
        { name: 'test_tool', description: 'A test', parameters: {}, requiresApproval: false, isDestructive: false },
      ],
    };
    const hash1 = hashToolDef(catalog, 'test_tool');
    const hash2 = hashToolDef(catalog, 'test_tool');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('redactArgs', () => {
  it('redacts email for verify_customer', () => {
    const result = redactArgs('verify_customer', { customerId: 'C001', email: 'test@example.com' });
    expect(result).toEqual({
      customerId: 'C001',
      email: { redacted: true, reason: 'PII:email' },
    });
  });

  it('redacts email for reset_password', () => {
    const result = redactArgs('reset_password', { email: 'test@example.com' });
    expect(result).toEqual({
      email: { redacted: true, reason: 'PII:email' },
    });
  });

  it('does not redact for lookup_order', () => {
    const args = { orderId: '4711' };
    const result = redactArgs('lookup_order', args);
    expect(result).toEqual({ orderId: '4711' });
  });

  it('does not redact for refund_order', () => {
    const args = { orderId: '4711', reason: 'damaged' };
    const result = redactArgs('refund_order', args);
    expect(result).toEqual({ orderId: '4711', reason: 'damaged' });
  });
});

describe('resolveSubject', () => {
  const state = createSeedState();

  it('resolves customerId directly for verify_customer', () => {
    expect(resolveSubject('verify_customer', { customerId: 'C001', email: 'x' }, state)).toBe('C001');
  });

  it('resolves customerId via order lookup for refund_order', () => {
    expect(resolveSubject('refund_order', { orderId: '4711', reason: 'test' }, state)).toBe('C001');
  });

  it('resolves customerId via order lookup for lookup_order', () => {
    expect(resolveSubject('lookup_order', { orderId: '4714' }, state)).toBe('C002');
  });

  it('resolves customerId via email lookup for reset_password', () => {
    expect(resolveSubject('reset_password', { email: 'erika@example.com' }, state)).toBe('C002');
  });

  it('returns null for faq_search', () => {
    expect(resolveSubject('faq_search', { query: 'test' }, state)).toBeNull();
  });

  it('returns null for unknown order', () => {
    expect(resolveSubject('refund_order', { orderId: '9999', reason: 'test' }, state)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/audit.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/audit.test.ts
git commit -m "test(audit): add unit tests for audit utility functions"
```

---

### Task 4: Update Seed Data

**Files:**
- Modify: `src/lib/seed-data.ts`

- [ ] **Step 1: Add `structuredAuditLog` to `createSeedState`**

In `src/lib/seed-data.ts`, add the import and the field:

```typescript
// Add to the import (line 1):
import type { DemoState, Customer, Order, StructuredAuditEntry } from './types';
```

```typescript
// Replace the createSeedState function (lines 135-142):
export function createSeedState(): DemoState {
  return {
    customers: structuredClone(customers),
    orders: structuredClone(orders),
    refundEvents: [],
    auditLog: [],
    structuredAuditLog: [],
  };
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `pnpm vitest run`
Expected: All tests pass (some may fail due to type errors from Task 1 changes in other files — that's expected and will be fixed in later tasks)

- [ ] **Step 3: Commit**

```bash
git add src/lib/seed-data.ts
git commit -m "feat(audit): add structuredAuditLog to seed state"
```

---

### Task 5: Remove Audit Creation from `tools.ts`

**Files:**
- Modify: `src/lib/tools.ts`

- [ ] **Step 1: Remove AuditLogEntry import and audit creation from `refundOrder`**

```typescript
// Replace line 1 import:
import type { DemoState, RefundEvent } from './types';
```

In `refundOrder`, remove the audit entry creation (lines 194-208) and the push (line 208). The function becomes:

```typescript
// Replace lines 177-218 (from "const now" to the return statement) in refundOrder:
  const now = new Date().toISOString();

  const refundEvent: RefundEvent = {
    id: crypto.randomUUID(),
    orderId: order.id,
    customerId: order.customerId,
    amount: order.total,
    reason: args.reason,
    timestamp: now,
    approvedBy: 'auto',
  };

  order.status = 'refunded';
  order.refundedAt = now;

  clonedState.refundEvents.push(refundEvent);

  return {
    result: {
      success: true,
      message: `Order ${args.orderId} has been refunded. Amount: $${order.total.toFixed(2)}. Refund ID: ${refundEvent.id}.`,
      refundEvent,
    },
    updatedState: clonedState,
    sideEffects: ['refund_created', 'order_status_updated'],
  };
```

- [ ] **Step 2: Remove audit creation from `resetPassword`**

```typescript
// Replace lines 295-318 (from "const clonedState" to return) in resetPassword:
  const clonedState = deepClone(state);

  return {
    result: {
      success: true,
      message: `Password reset email sent to ${args.email}. Please check your inbox.`,
    },
    updatedState: clonedState,
    sideEffects: ['password_reset_email_sent'],
  };
```

- [ ] **Step 3: Run existing tools tests**

Run: `pnpm vitest run src/lib/__tests__/tools.test.ts`
Expected: Tests that check `auditLog` entries will fail. Update them:

- [ ] **Step 4: Fix tools tests — remove audit assertions**

In `src/lib/__tests__/tools.test.ts`, find any assertions about `auditLog` (e.g., `expect(result.updatedState.auditLog.length).toBe(...)`) and either remove them or adjust to `0`. Also update `sideEffects` assertions to not include `'audit_log_entry_added'`.

Run: `pnpm vitest run src/lib/__tests__/tools.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tools.ts src/lib/__tests__/tools.test.ts
git commit -m "refactor(audit): remove audit entry creation from tool functions"
```

---

### Task 6: Wire Audit Entry Creation into `workflow-engine.ts`

**Files:**
- Modify: `src/lib/workflow-engine.ts`

This is the largest task. The engine becomes responsible for creating `StructuredAuditEntry` records after each tool execution.

- [ ] **Step 1: Add imports and update `WorkflowInput`/`WorkflowResult`**

```typescript
// Replace line 1-16 imports:
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
} from './types';
import { executeTool } from './tools';
import {
  generatePrefixedId,
  hashPromptConfig,
  hashToolDef,
  redactArgs,
  resolveSubject,
} from './audit';
```

```typescript
// Replace WorkflowResult type (lines 28-39):
type WorkflowResult = {
  finalAnswer: string;
  route: RouteDecision | null;
  trace: RunTrace;
  updatedState: DemoState;
  approvalRequest?: {
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    message: string;
  } | null;
  auditEntries: StructuredAuditEntry[];
};
```

- [ ] **Step 2: Replace UUID generation with prefixed IDs at run start**

```typescript
// Replace lines 356-357 in runWorkflow:
  const requestId = generatePrefixedId('req');
  const startedAt = new Date().toISOString();
  const traceEntries: TraceEntry[] = [];
  const toolCallTraces: ToolCallTrace[] = [];
  const auditEntries: StructuredAuditEntry[] = [];
  let currentState = demoState;
  let route: RouteDecision | null = null;
  let finalAnswer = '';
  let approvalRequest: WorkflowResult['approvalRequest'] = null;

  const promptVersion = hashPromptConfig(promptConfig);
```

- [ ] **Step 3: Replace tool call UUID with prefixed ID and add audit entry creation**

In the execute handler (starting around line 504), replace `crypto.randomUUID()` with `generatePrefixedId('tc')` and add audit entry creation after tool execution.

```typescript
// Replace the execute handler body (lines 504-617):
        execute: async (args: any) => {
          const toolCallId = generatePrefixedId('tc');
          const timestamp = new Date().toISOString();

          addTraceEntry(
            traceEntries,
            'tool_call',
            { toolCallId, toolName: name, arguments: args },
            route!
          );

          // Check if this tool requires approval
          if (meta.requiresApproval) {
            if (pendingApproval) {
              if (pendingApproval.approved) {
                addTraceEntry(traceEntries, 'approval_response', {
                  toolCallId,
                  approved: true,
                });
              } else {
                addTraceEntry(traceEntries, 'approval_response', {
                  toolCallId,
                  approved: false,
                });

                const trace: ToolCallTrace = {
                  id: toolCallId,
                  toolName: name,
                  arguments: args,
                  result: { denied: true, message: 'Action denied by user.' },
                  timestamp,
                  approvalRequired: true,
                  approvalStatus: 'denied',
                  auditEntryId: null,
                };
                toolCallTraces.push(trace);

                // Create audit entry for denial
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
                  approvalId: toolCallId,
                  approvalOutcome: 'denied',
                  outcome: 'denied',
                  outcomeDetail: 'Action denied by user',
                  requestedAt: timestamp,
                  completedAt: new Date().toISOString(),
                  modelId: settings.modelId,
                  modelProvider: settings.provider,
                  promptVersion,
                };
                auditEntries.push(auditEntry);

                return { denied: true, message: 'Action denied by user.' };
              }
            } else {
              needsApprovalPause = true;
              pendingApprovalToolCallId = toolCallId;
              pendingApprovalToolName = name;
              pendingApprovalArgs = args;

              addTraceEntry(traceEntries, 'approval_request', {
                toolCallId,
                toolName: name,
                arguments: args,
              });

              const trace: ToolCallTrace = {
                id: toolCallId,
                toolName: name,
                arguments: args,
                result: null,
                timestamp,
                approvalRequired: true,
                approvalStatus: 'pending',
                auditEntryId: null,
              };
              toolCallTraces.push(trace);

              // Create audit entry for pending approval
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
                approvalId: null,
                approvalOutcome: null,
                outcome: 'requested',
                outcomeDetail: 'Awaiting user approval',
                requestedAt: timestamp,
                completedAt: null,
                modelId: settings.modelId,
                modelProvider: settings.provider,
                promptVersion,
              };
              auditEntries.push(auditEntry);

              return {
                awaiting_approval: true,
                message: 'This action requires user approval before proceeding.',
              };
            }
          }

          // Execute the tool
          const executedAt = new Date().toISOString();
          const toolResult = executeTool(name, currentState, args);
          currentState = toolResult.updatedState;
          const completedAt = new Date().toISOString();

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

          // Create audit entry for tool execution
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
            approvalStatus: meta.requiresApproval ? 'approved' : 'not_required',
            auditEntryId,
          };
          toolCallTraces.push(traceRecord);

          return toolResult.result;
        },
```

- [ ] **Step 4: Update the RunTrace and return value construction**

```typescript
// Replace the trace construction (lines 727-738):
  const trace: RunTrace = {
    id: requestId,
    requestId,
    startedAt,
    completedAt: new Date().toISOString(),
    userMessage,
    route,
    entries: traceEntries,
    toolCalls: toolCallTraces,
    mismatches,
    finalAnswer,
    stateChanges,
    auditEntryIds: auditEntries.map((ae) => ae.id),
  };
```

```typescript
// Replace the return statement (lines 740-746):
  return {
    finalAnswer,
    route,
    trace,
    updatedState: currentState,
    approvalRequest,
    auditEntries,
  };
```

- [ ] **Step 5: Fix the `toolCallTraces` entries created outside the execute handler (around line 665)**

The fallback `ToolCallTrace` created in the step recording loop also needs `auditEntryId: null`:

```typescript
// In the step recording loop (around line 665), add auditEntryId:
            toolCallTraces.push({
              id: tc.toolCallId,
              toolName: tc.toolName,
              arguments: tc.input as Record<string, unknown>,
              result: null,
              timestamp: new Date().toISOString(),
              approvalRequired: false,
              approvalStatus: 'not_required',
              auditEntryId: null,
            });
```

- [ ] **Step 6: Verify the project compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: May show errors in `store.ts`, `hooks.ts`, or UI components — those are fixed in next tasks.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workflow-engine.ts
git commit -m "feat(audit): wire structured audit entry creation into workflow engine"
```

---

### Task 7: Update Store with Audit Actions and Separate localStorage

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Add new actions to the AppAction union**

```typescript
// Add to the AppAction union (after line 84):
  | { type: 'ADD_AUDIT_ENTRIES'; payload: StructuredAuditEntry[] }
  | { type: 'CLEAR_AUDIT_LOG' }
```

Add `StructuredAuditEntry` to the imports from `./types`.

- [ ] **Step 2: Add reducer cases**

```typescript
// Add inside the reducer switch (before the default case):
    case 'ADD_AUDIT_ENTRIES':
      return {
        ...state,
        demoState: {
          ...state.demoState,
          structuredAuditLog: [
            ...state.demoState.structuredAuditLog,
            ...action.payload,
          ],
        },
      };
    case 'CLEAR_AUDIT_LOG':
      return {
        ...state,
        demoState: {
          ...state.demoState,
          structuredAuditLog: [],
        },
      };
```

Also update `RESET_DEMO_STATE` — `createSeedState()` already returns `structuredAuditLog: []` from Task 4.

- [ ] **Step 3: Add separate localStorage persistence for audit log**

```typescript
// Add after LS_KEY constant (line 147):
const LS_KEY_AUDIT = 'support-agent-lab:audit';
const MAX_AUDIT_ENTRIES = 200;
```

```typescript
// Add new helper functions after saveToLocalStorage:
function saveAuditLog(entries: StructuredAuditEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = entries.slice(-MAX_AUDIT_ENTRIES);
    localStorage.setItem(LS_KEY_AUDIT, JSON.stringify(trimmed));
  } catch {
    // quota exceeded — silently ignore
  }
}

function loadAuditLog(): StructuredAuditEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY_AUDIT);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Update hydration `useEffect` to load audit log**

```typescript
// In the hydration useEffect (after line 191, after restoring traces):
      const auditLog = loadAuditLog();
      if (auditLog.length > 0) {
        dispatch({ type: 'ADD_AUDIT_ENTRIES', payload: auditLog });
      }
```

- [ ] **Step 5: Add persistence `useEffect` for audit log**

```typescript
// Add a new useEffect after the existing persistence useEffect (after line 199):
  useEffect(() => {
    if (!hydrated) return;
    saveAuditLog(state.demoState.structuredAuditLog);
  }, [hydrated, state.demoState.structuredAuditLog]);
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat(audit): add audit actions, separate localStorage persistence"
```

---

### Task 8: Dispatch Audit Entries from Hooks

**Files:**
- Modify: `src/lib/hooks.ts`

- [ ] **Step 1: Add `ADD_AUDIT_ENTRIES` dispatch to `useChat.sendMessage`**

```typescript
// After line 57 (after dispatch ADD_TRACE), add:
        if (result.auditEntries.length > 0) {
          dispatch({ type: 'ADD_AUDIT_ENTRIES', payload: result.auditEntries });
        }
```

- [ ] **Step 2: Add `ADD_AUDIT_ENTRIES` dispatch to `useApproval.respond`**

```typescript
// After line 119 (after dispatch ADD_TRACE in respond), add:
        if (result.auditEntries.length > 0) {
          dispatch({ type: 'ADD_AUDIT_ENTRIES', payload: result.auditEntries });
        }
```

- [ ] **Step 3: Verify the project compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Should compile cleanly now (UI components may still need minor fixes for the `requestId`/`auditEntryIds` fields on `RunTrace`)

- [ ] **Step 4: Commit**

```bash
git add src/lib/hooks.ts
git commit -m "feat(audit): dispatch audit entries from chat and approval hooks"
```

---

### Task 9: Update Trace Tab with Inline Audit Records

**Files:**
- Modify: `src/components/trace-tab.tsx`

- [ ] **Step 1: Read the current trace-tab.tsx to understand its structure**

Read the file first, then make these changes:

Where `ToolCallTrace` records are rendered (typically in a list or table), add a conditional block: when `tc.auditEntryId` is not null, render an inline audit badge/section.

The exact implementation depends on the current JSX structure. The pattern is:

```tsx
{tc.auditEntryId && (
  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
    <span className="font-mono text-[10px] bg-muted px-1 rounded">
      {tc.auditEntryId}
    </span>
    <span>Audit Record</span>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/trace-tab.tsx
git commit -m "feat(audit): show inline audit entry IDs in trace tab"
```

---

### Task 10: Update Backend State Tab with Structured Audit Table

**Files:**
- Modify: `src/components/backend-state-tab.tsx`

- [ ] **Step 1: Read the current backend-state-tab.tsx**

Read the file, find the existing "Audit Log" card section.

- [ ] **Step 2: Replace the primitive audit log table with the structured version**

Replace the existing Audit Log card with a new one that reads from `demoState.structuredAuditLog` and displays:

| Column | Field | Display |
|---|---|---|
| Request ID | `requestId` | Truncated monospace, title for full |
| Tool | `toolName` | Badge |
| Actor | `actor.agentId` or `actor.type` | Badge |
| Subject | `subject` | Customer ID or "—" |
| Outcome | `outcome` | Colored badge (green=completed, red=denied/failed, yellow=requested) |
| Time | `requestedAt` | Formatted time |
| Model | `modelId` | Small text |
| Prompt | `promptVersion` | 8-char monospace |

Add a "Clear" button that dispatches `CLEAR_AUDIT_LOG`.

Keep the legacy audit log card below (collapsed by default) for backward compatibility during transition.

- [ ] **Step 3: Commit**

```bash
git add src/components/backend-state-tab.tsx
git commit -m "feat(audit): add structured audit log table to state tab"
```

---

### Task 11: Run All Tests and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify the dev server starts**

Run: `pnpm dev` (check it starts without errors, then stop)

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(audit): resolve remaining type and test issues"
```

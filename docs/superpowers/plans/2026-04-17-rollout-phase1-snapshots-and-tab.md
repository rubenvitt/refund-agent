# Rollout Discipline — Phase 1 (Versionierte Configs + Rollout-Tab Skeleton + Audit) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned config snapshots (Champion/Challenger), a dedicated Rollout tab with a status header + snapshot list, and a rollout-specific audit log — all wired through the existing store so later phases (Shadow, Canary, Guardrails, Kill-Switch) can build on this foundation.

**Architecture:** A pure helper module `rollout.ts` produces immutable `ConfigSnapshot` objects and `RolloutAuditEntry` records. The reducer in `store.ts` gains a `rollout` slice with snapshots, champion/challenger IDs, Canary percent, Kill-Switch flag, and an audit log; all mutations emit audit entries. The Contracts tab gets a "Save Snapshot" button. A new `/rollout` route renders a status header plus the snapshot list with promote controls and the audit log — Canary/Kill-Switch controls are display-only in Phase 1 (activation comes in Phase 3).

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Vitest, localStorage, lucide-react icons, Tailwind, shadcn-style UI primitives.

**Spec:** `docs/prd-rollout-discipline.md` — Phase 1 scope: F1 (Versionierte Configs), F8 (Rollout-Tab status header only), F9 (Rollout-Audit-Events).

**Open questions from PRD:** All four (routing seed, shadow scope, approval for canary, cost transparency) are Phase 2/3 concerns and deliberately unresolved here.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/types.ts` | Modify | Add `ConfigSnapshot`, `RolloutAuditAction`, `RolloutAuditEntry`, `RolloutState` types |
| `src/lib/rollout.ts` | Create | Pure helpers: `createSnapshot`, `createRolloutAuditEntry`, `createEmptyRolloutState` |
| `src/lib/__tests__/rollout.test.ts` | Create | Unit tests for all helpers |
| `src/lib/store.ts` | Modify | Extend `AppState` with `rollout`, add rollout reducer actions, persist to localStorage, add `useRollout` hook, export `reducer` for tests |
| `src/lib/__tests__/store-rollout-reducer.test.ts` | Create | Reducer-level tests for rollout actions (no React mount) |
| `src/components/contracts-tab.tsx` | Modify | Add "Save Snapshot" button to header that captures current `promptConfig` + `toolCatalog` |
| `src/app/(app)/rollout/page.tsx` | Create | Route wrapper for Rollout tab |
| `src/components/rollout-tab.tsx` | Create | Status header (Champion / Challenger / Canary% / Kill-Switch), snapshot list with promote buttons, audit log panel |
| `src/components/tab-nav.tsx` | Modify | Add `/rollout` entry to `TABS` between Contracts and Backend State |

---

### Task 1: Types + Pure Rollout Helpers

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/rollout.ts`
- Create: `src/lib/__tests__/rollout.test.ts`

Context: Everything else in Phase 1 depends on these. The helpers are deterministic pure functions — straightforward TDD. The `ConfigSnapshot` captures the *entire* `PromptConfig` + `ToolCatalog` to make snapshots self-contained (no dangling references when later changes happen).

- [ ] **Step 1: Add types to `src/lib/types.ts` — append at the very end of the file**

```typescript
// ── Rollout ──

export type ConfigSnapshot = {
  id: string;
  createdAt: string;
  label: string;
  promptConfig: PromptConfig;
  toolCatalog: ToolCatalog;
  notes: string;
};

export type RolloutAuditAction =
  | 'snapshot_created'
  | 'snapshot_deleted'
  | 'champion_set'
  | 'challenger_set'
  | 'challenger_cleared';

export type RolloutAuditEntry = {
  id: string;
  timestamp: string;
  actor: AuditActor;
  action: RolloutAuditAction;
  snapshotId: string | null;
  details: Record<string, unknown>;
};

export type RolloutState = {
  snapshots: ConfigSnapshot[];
  championId: string | null;
  challengerId: string | null;
  canaryPercent: 0 | 5 | 25 | 50 | 100;
  killSwitchActive: boolean;
  auditLog: RolloutAuditEntry[];
};
```

- [ ] **Step 2: Create `src/lib/__tests__/rollout.test.ts` with failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  createSnapshot,
  createRolloutAuditEntry,
  createEmptyRolloutState,
} from '../rollout';
import type { PromptConfig, ToolCatalog } from '../types';

const samplePromptConfig: PromptConfig = {
  orchestratorInstructions: 'orchestrator',
  refundAgentInstructions: 'refund',
  lookupAgentInstructions: 'lookup',
  accountFaqAgentInstructions: 'account',
};

const sampleToolCatalog: ToolCatalog = {
  tools: [
    {
      name: 'lookup_order',
      description: 'look up an order',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: false,
      isDestructive: false,
    },
  ],
};

describe('createSnapshot', () => {
  it('returns a snapshot with an snp_-prefixed id and an ISO timestamp', () => {
    const snap = createSnapshot('Champion v1', samplePromptConfig, sampleToolCatalog, 'baseline');
    expect(snap.id.startsWith('snp_')).toBe(true);
    expect(() => new Date(snap.createdAt).toISOString()).not.toThrow();
    expect(snap.label).toBe('Champion v1');
    expect(snap.notes).toBe('baseline');
    expect(snap.promptConfig).toEqual(samplePromptConfig);
    expect(snap.toolCatalog).toEqual(sampleToolCatalog);
  });

  it('produces unique ids across calls', () => {
    const ids = new Set(
      Array.from({ length: 50 }, () =>
        createSnapshot('x', samplePromptConfig, sampleToolCatalog, '').id,
      ),
    );
    expect(ids.size).toBe(50);
  });

  it('deep-clones prompt and tool inputs so later mutations do not leak', () => {
    const prompt = { ...samplePromptConfig };
    const tools = { tools: [...sampleToolCatalog.tools] };
    const snap = createSnapshot('x', prompt, tools, '');
    prompt.orchestratorInstructions = 'mutated';
    tools.tools[0].description = 'mutated';
    expect(snap.promptConfig.orchestratorInstructions).toBe('orchestrator');
    expect(snap.toolCatalog.tools[0].description).toBe('look up an order');
  });
});

describe('createRolloutAuditEntry', () => {
  it('returns an entry with an rla_-prefixed id and captures inputs', () => {
    const entry = createRolloutAuditEntry({
      actor: { type: 'user' },
      action: 'snapshot_created',
      snapshotId: 'snp_abc',
      details: { label: 'Champion v1' },
    });
    expect(entry.id.startsWith('rla_')).toBe(true);
    expect(entry.actor).toEqual({ type: 'user' });
    expect(entry.action).toBe('snapshot_created');
    expect(entry.snapshotId).toBe('snp_abc');
    expect(entry.details).toEqual({ label: 'Champion v1' });
    expect(() => new Date(entry.timestamp).toISOString()).not.toThrow();
  });

  it('allows null snapshotId for global events', () => {
    const entry = createRolloutAuditEntry({
      actor: { type: 'system', component: 'rollout' },
      action: 'challenger_cleared',
      snapshotId: null,
      details: {},
    });
    expect(entry.snapshotId).toBeNull();
  });
});

describe('createEmptyRolloutState', () => {
  it('returns a zeroed state with empty arrays and defaults', () => {
    const state = createEmptyRolloutState();
    expect(state.snapshots).toEqual([]);
    expect(state.championId).toBeNull();
    expect(state.challengerId).toBeNull();
    expect(state.canaryPercent).toBe(0);
    expect(state.killSwitchActive).toBe(false);
    expect(state.auditLog).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm test src/lib/__tests__/rollout.test.ts`
Expected: FAIL — `Cannot find module '../rollout'`.

- [ ] **Step 4: Create `src/lib/rollout.ts` with minimal implementation**

```typescript
import type {
  AuditActor,
  ConfigSnapshot,
  PromptConfig,
  RolloutAuditAction,
  RolloutAuditEntry,
  RolloutState,
  ToolCatalog,
} from './types';

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateId(prefix: 'snp' | 'rla'): string {
  const ts = Date.now().toString().padStart(13, '0');
  return `${prefix}_${ts}${randomHex(4)}`;
}

export function createSnapshot(
  label: string,
  promptConfig: PromptConfig,
  toolCatalog: ToolCatalog,
  notes: string,
): ConfigSnapshot {
  return {
    id: generateId('snp'),
    createdAt: new Date().toISOString(),
    label,
    promptConfig: structuredClone(promptConfig),
    toolCatalog: structuredClone(toolCatalog),
    notes,
  };
}

export function createRolloutAuditEntry(input: {
  actor: AuditActor;
  action: RolloutAuditAction;
  snapshotId: string | null;
  details: Record<string, unknown>;
}): RolloutAuditEntry {
  return {
    id: generateId('rla'),
    timestamp: new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    snapshotId: input.snapshotId,
    details: input.details,
  };
}

export function createEmptyRolloutState(): RolloutState {
  return {
    snapshots: [],
    championId: null,
    challengerId: null,
    canaryPercent: 0,
    killSwitchActive: false,
    auditLog: [],
  };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm test src/lib/__tests__/rollout.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/rollout.ts src/lib/__tests__/rollout.test.ts
git commit -m "feat(rollout): add ConfigSnapshot types and pure helpers"
```

---

### Task 2: Rollout State in the Store (reducer, persistence, tests)

**Files:**
- Modify: `src/lib/store.ts`
- Create: `src/lib/__tests__/store-rollout-reducer.test.ts`

Context: The reducer function is currently module-private. To test rollout actions without mounting the React provider, export `reducer` and `getInitialState`. Persist rollout state under a new localStorage key (`support-agent-lab:rollout`) so snapshots survive reloads, but keep the existing storage keys untouched to avoid cross-feature regressions.

- [ ] **Step 1: Write failing tests in `src/lib/__tests__/store-rollout-reducer.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { reducer, getInitialState, type AppState, type AppAction } from '../store';
import { createSnapshot } from '../rollout';
import type { PromptConfig, ToolCatalog } from '../types';

const promptConfig: PromptConfig = {
  orchestratorInstructions: 'o',
  refundAgentInstructions: 'r',
  lookupAgentInstructions: 'l',
  accountFaqAgentInstructions: 'a',
};
const toolCatalog: ToolCatalog = { tools: [] };

function initial(): AppState {
  return getInitialState();
}

describe('rollout reducer', () => {
  it('ADD_ROLLOUT_SNAPSHOT appends the snapshot', () => {
    const snap = createSnapshot('Champion v1', promptConfig, toolCatalog, '');
    const next = reducer(initial(), {
      type: 'ADD_ROLLOUT_SNAPSHOT',
      payload: snap,
    } satisfies AppAction);
    expect(next.rollout.snapshots).toHaveLength(1);
    expect(next.rollout.snapshots[0].id).toBe(snap.id);
  });

  it('SET_ROLLOUT_CHAMPION updates the championId', () => {
    const snap = createSnapshot('Champion v1', promptConfig, toolCatalog, '');
    const afterAdd = reducer(initial(), { type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
    const next = reducer(afterAdd, { type: 'SET_ROLLOUT_CHAMPION', payload: snap.id });
    expect(next.rollout.championId).toBe(snap.id);
  });

  it('SET_ROLLOUT_CHALLENGER updates the challengerId; null clears it', () => {
    const snap = createSnapshot('Challenger v1', promptConfig, toolCatalog, '');
    const afterAdd = reducer(initial(), { type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
    const set = reducer(afterAdd, { type: 'SET_ROLLOUT_CHALLENGER', payload: snap.id });
    expect(set.rollout.challengerId).toBe(snap.id);
    const cleared = reducer(set, { type: 'SET_ROLLOUT_CHALLENGER', payload: null });
    expect(cleared.rollout.challengerId).toBeNull();
  });

  it('DELETE_ROLLOUT_SNAPSHOT removes it and clears references if champion/challenger', () => {
    const snap = createSnapshot('doomed', promptConfig, toolCatalog, '');
    let s = reducer(initial(), { type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
    s = reducer(s, { type: 'SET_ROLLOUT_CHAMPION', payload: snap.id });
    s = reducer(s, { type: 'SET_ROLLOUT_CHALLENGER', payload: snap.id });
    s = reducer(s, { type: 'DELETE_ROLLOUT_SNAPSHOT', payload: snap.id });
    expect(s.rollout.snapshots).toHaveLength(0);
    expect(s.rollout.championId).toBeNull();
    expect(s.rollout.challengerId).toBeNull();
  });

  it('APPEND_ROLLOUT_AUDIT appends entries in order', () => {
    const s1 = reducer(initial(), {
      type: 'APPEND_ROLLOUT_AUDIT',
      payload: {
        id: 'rla_1',
        timestamp: '2026-04-17T00:00:00.000Z',
        actor: { type: 'user' },
        action: 'snapshot_created',
        snapshotId: 'snp_1',
        details: {},
      },
    });
    const s2 = reducer(s1, {
      type: 'APPEND_ROLLOUT_AUDIT',
      payload: {
        id: 'rla_2',
        timestamp: '2026-04-17T00:00:01.000Z',
        actor: { type: 'user' },
        action: 'champion_set',
        snapshotId: 'snp_1',
        details: {},
      },
    });
    expect(s2.rollout.auditLog.map((e) => e.id)).toEqual(['rla_1', 'rla_2']);
  });

  it('RESET_ALL resets rollout state too', () => {
    const snap = createSnapshot('x', promptConfig, toolCatalog, '');
    let s = reducer(initial(), { type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
    s = reducer(s, { type: 'SET_ROLLOUT_CHAMPION', payload: snap.id });
    s = reducer(s, { type: 'RESET_ALL' });
    expect(s.rollout.snapshots).toEqual([]);
    expect(s.rollout.championId).toBeNull();
  });
});

describe('getInitialState rollout slice', () => {
  it('includes an empty rollout state', () => {
    const s = getInitialState();
    expect(s.rollout.snapshots).toEqual([]);
    expect(s.rollout.championId).toBeNull();
    expect(s.rollout.challengerId).toBeNull();
    expect(s.rollout.canaryPercent).toBe(0);
    expect(s.rollout.killSwitchActive).toBe(false);
    expect(s.rollout.auditLog).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test src/lib/__tests__/store-rollout-reducer.test.ts`
Expected: FAIL — `reducer`/`getInitialState` not exported, or rollout-related symbols missing.

- [ ] **Step 3: Extend `src/lib/store.ts`**

Change 1 — add import near the top (after existing `./idempotency` import):

```typescript
import { createEmptyRolloutState } from './rollout';
import type { ConfigSnapshot, RolloutAuditEntry, RolloutState } from './types';
```

Change 2 — extend `AppState` (replace the full `AppState` type):

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
  toolCallLedger: ToolCallLedger;
  session: UserSession | null;
  rollout: RolloutState;
};
```

Change 3 — export `getInitialState` (remove `function`-to-const refactor not needed; simply add `export`):

```typescript
export function getInitialState(): AppState {
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
    session: null,
    rollout: createEmptyRolloutState(),
  };
}
```

Change 4 — extend `AppAction` union with rollout actions (add these members):

```typescript
  | { type: 'ADD_ROLLOUT_SNAPSHOT'; payload: ConfigSnapshot }
  | { type: 'DELETE_ROLLOUT_SNAPSHOT'; payload: string }
  | { type: 'SET_ROLLOUT_CHAMPION'; payload: string | null }
  | { type: 'SET_ROLLOUT_CHALLENGER'; payload: string | null }
  | { type: 'APPEND_ROLLOUT_AUDIT'; payload: RolloutAuditEntry }
  | { type: 'RESET_ROLLOUT' };
```

Change 5 — export `reducer` and add rollout cases. Replace `function reducer(...)` with `export function reducer(...)`, and add the new cases before the `default`:

```typescript
    case 'ADD_ROLLOUT_SNAPSHOT':
      return {
        ...state,
        rollout: {
          ...state.rollout,
          snapshots: [...state.rollout.snapshots, action.payload],
        },
      };
    case 'DELETE_ROLLOUT_SNAPSHOT': {
      const id = action.payload;
      return {
        ...state,
        rollout: {
          ...state.rollout,
          snapshots: state.rollout.snapshots.filter((s) => s.id !== id),
          championId: state.rollout.championId === id ? null : state.rollout.championId,
          challengerId: state.rollout.challengerId === id ? null : state.rollout.challengerId,
        },
      };
    }
    case 'SET_ROLLOUT_CHAMPION':
      return { ...state, rollout: { ...state.rollout, championId: action.payload } };
    case 'SET_ROLLOUT_CHALLENGER':
      return { ...state, rollout: { ...state.rollout, challengerId: action.payload } };
    case 'APPEND_ROLLOUT_AUDIT':
      return {
        ...state,
        rollout: {
          ...state.rollout,
          auditLog: [...state.rollout.auditLog, action.payload],
        },
      };
    case 'RESET_ROLLOUT':
      return { ...state, rollout: createEmptyRolloutState() };
```

Change 6 — persistence. Add a new storage key next to the existing ones and wire it:

```typescript
const LS_KEY_ROLLOUT = 'support-agent-lab:rollout';

function saveRollout(rollout: RolloutState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY_ROLLOUT, JSON.stringify(rollout));
  } catch {
    // quota exceeded — silently ignore
  }
}

function loadRollout(): RolloutState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY_ROLLOUT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

Change 7 — hydrate + persist inside `AppProvider`. Inside the existing `useEffect` that hydrates from localStorage, after the ledger-load block, add:

```typescript
    const savedRollout = loadRollout();
    if (savedRollout) {
      dispatch({ type: 'RESET_ROLLOUT' });
      for (const snap of savedRollout.snapshots) {
        dispatch({ type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
      }
      if (savedRollout.championId) {
        dispatch({ type: 'SET_ROLLOUT_CHAMPION', payload: savedRollout.championId });
      }
      if (savedRollout.challengerId) {
        dispatch({ type: 'SET_ROLLOUT_CHALLENGER', payload: savedRollout.challengerId });
      }
      for (const entry of savedRollout.auditLog) {
        dispatch({ type: 'APPEND_ROLLOUT_AUDIT', payload: entry });
      }
    }
```

Add a persistence effect below the existing ones:

```typescript
  useEffect(() => {
    if (!hydrated) return;
    saveRollout(state.rollout);
  }, [hydrated, state.rollout]);
```

Change 8 — add a `useRollout` hook at the bottom of the file, after `useSession`:

```typescript
import { createRolloutAuditEntry, createSnapshot } from './rollout';

export function useRollout() {
  const { state, dispatch } = useAppState();

  const saveSnapshot = (label: string, notes: string) => {
    const snap = createSnapshot(label, state.promptConfig, state.toolCatalog, notes);
    dispatch({ type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
    dispatch({
      type: 'APPEND_ROLLOUT_AUDIT',
      payload: createRolloutAuditEntry({
        actor: { type: 'user' },
        action: 'snapshot_created',
        snapshotId: snap.id,
        details: { label, notes },
      }),
    });
    return snap;
  };

  const setChampion = (snapshotId: string) => {
    dispatch({ type: 'SET_ROLLOUT_CHAMPION', payload: snapshotId });
    dispatch({
      type: 'APPEND_ROLLOUT_AUDIT',
      payload: createRolloutAuditEntry({
        actor: { type: 'user' },
        action: 'champion_set',
        snapshotId,
        details: {},
      }),
    });
  };

  const setChallenger = (snapshotId: string | null) => {
    dispatch({ type: 'SET_ROLLOUT_CHALLENGER', payload: snapshotId });
    dispatch({
      type: 'APPEND_ROLLOUT_AUDIT',
      payload: createRolloutAuditEntry({
        actor: { type: 'user' },
        action: snapshotId ? 'challenger_set' : 'challenger_cleared',
        snapshotId,
        details: {},
      }),
    });
  };

  const deleteSnapshot = (snapshotId: string) => {
    dispatch({ type: 'DELETE_ROLLOUT_SNAPSHOT', payload: snapshotId });
    dispatch({
      type: 'APPEND_ROLLOUT_AUDIT',
      payload: createRolloutAuditEntry({
        actor: { type: 'user' },
        action: 'snapshot_deleted',
        snapshotId,
        details: {},
      }),
    });
  };

  return {
    rollout: state.rollout,
    saveSnapshot,
    setChampion,
    setChallenger,
    deleteSnapshot,
  };
}
```

(Note: the extra `import` for `createRolloutAuditEntry, createSnapshot` should be merged with the existing `./rollout` import at the top — there should be exactly one import from `./rollout`.)

Change 9 — add `state.rollout` to the existing persistence effect's dependency array? No: the new dedicated rollout effect handles it. Leave the existing `saveToLocalStorage` effect alone so we do not accidentally write rollout into the legacy key.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm test src/lib/__tests__/store-rollout-reducer.test.ts`
Expected: PASS — all 7 rollout reducer tests green.

- [ ] **Step 5: Run the full test suite to confirm nothing else broke**

Run: `pnpm test`
Expected: PASS — every existing suite still green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.ts src/lib/__tests__/store-rollout-reducer.test.ts
git commit -m "feat(rollout): add rollout slice, reducer actions, useRollout hook, persistence"
```

---

### Task 3: Contracts-Tab "Save Snapshot" Button

**Files:**
- Modify: `src/components/contracts-tab.tsx`

Context: Users already edit prompts and tools here; this is the natural place to freeze a draft into a snapshot. Keep UX light — an inline label/notes form that expands next to the existing "Reset All" button.

- [ ] **Step 1: Add imports and hook at the top of `ContractsTab`**

Add imports at the top of the file (merge with existing `lucide-react` and `./ui/*` imports where possible):

```typescript
import { Camera } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useRollout } from '@/lib/store';
```

If `@/components/ui/input` does not exist in the project, replace the `Input` import with a plain `<input>` using the same Tailwind classes used for other inputs in the file and remove the Input import entirely.

- [ ] **Step 2: Inside `ContractsTab`, add local UI state and a handler**

Add after the existing `updateTool` / `resetAll` declarations:

```typescript
  const { saveSnapshot } = useRollout();
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [snapshotNotes, setSnapshotNotes] = useState('');
  const [snapshotSaved, setSnapshotSaved] = useState<string | null>(null);

  const handleSaveSnapshot = () => {
    const label = snapshotLabel.trim() || `Snapshot ${new Date().toISOString()}`;
    const snap = saveSnapshot(label, snapshotNotes.trim());
    setSnapshotLabel('');
    setSnapshotNotes('');
    setSnapshotSaved(snap.label);
    setTimeout(() => setSnapshotSaved(null), 3000);
  };
```

- [ ] **Step 3: Replace the header `<div className="flex items-center justify-between">` block so it contains the snapshot form**

Replace the existing header block (the `<div className="flex items-center justify-between">` wrapping the title and "Reset All" button) with:

```tsx
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <FileText className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Contracts & Prompts</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Snapshot label (optional)"
            value={snapshotLabel}
            onChange={(e) => setSnapshotLabel(e.target.value)}
            className="h-8 rounded-md border bg-transparent px-2 text-xs"
          />
          <input
            type="text"
            placeholder="Notes (optional)"
            value={snapshotNotes}
            onChange={(e) => setSnapshotNotes(e.target.value)}
            className="h-8 rounded-md border bg-transparent px-2 text-xs"
          />
          <Button variant="outline" size="sm" onClick={handleSaveSnapshot}>
            <Camera className="size-3.5" />
            Save Snapshot
          </Button>
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw className="size-3.5" />
            Reset All
          </Button>
        </div>
      </div>
      {snapshotSaved && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          Saved snapshot: <span className="font-medium">{snapshotSaved}</span> — manage it in the Rollout tab.
        </div>
      )}
```

- [ ] **Step 4: Run the test suite**

Run: `pnpm test`
Expected: PASS — no new tests, existing suites unaffected.

- [ ] **Step 5: Run lint + typecheck to catch UI regressions**

Run: `pnpm lint`
Expected: clean, no new errors.

- [ ] **Step 6: Manual smoke test**

Run: `pnpm dev`
Open `/contracts`. Type a label like "first-snapshot", click **Save Snapshot**, confirm the green confirmation appears. Verify in DevTools → Application → localStorage that `support-agent-lab:rollout` contains an entry with one snapshot and two audit log events (`snapshot_created`). Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/components/contracts-tab.tsx
git commit -m "feat(rollout): add Save Snapshot control to contracts tab"
```

---

### Task 4: `/rollout` Route + Rollout Tab with Status Header + Snapshot List

**Files:**
- Create: `src/app/(app)/rollout/page.tsx`
- Create: `src/components/rollout-tab.tsx`
- Modify: `src/components/tab-nav.tsx`

Context: This is the feature's visible home. Phase 1 shows status, lists snapshots with promote/delete actions, and displays the rollout audit log. Canary % and Kill-Switch are read-only here (controls come in Phase 3) but the scaffolding is in place.

- [ ] **Step 1: Create `src/app/(app)/rollout/page.tsx`**

```typescript
'use client';

import { RolloutTab } from '@/components/rollout-tab';

export default function RolloutPage() {
  return <RolloutTab />;
}
```

- [ ] **Step 2: Create `src/components/rollout-tab.tsx`**

```tsx
'use client';

import {
  Rocket,
  ShieldCheck,
  Crown,
  Swords,
  Trash2,
  Gauge,
  PowerOff,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRollout } from '@/lib/store';
import type { ConfigSnapshot, RolloutAuditEntry } from '@/lib/types';

function snapshotDisplayId(id: string): string {
  return id.slice(0, 10);
}

function formatActor(entry: RolloutAuditEntry): string {
  switch (entry.actor.type) {
    case 'user':
      return 'user';
    case 'agent':
      return `agent:${entry.actor.agentId}`;
    case 'system':
      return `system:${entry.actor.component}`;
  }
}

function StatusHeader({
  champion,
  challenger,
  canaryPercent,
  killSwitchActive,
}: {
  champion: ConfigSnapshot | null;
  challenger: ConfigSnapshot | null;
  canaryPercent: number;
  killSwitchActive: boolean;
}) {
  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Crown className="size-3" /> Champion
          </div>
          <div className="text-sm font-medium">
            {champion ? champion.label : <span className="text-muted-foreground">none</span>}
          </div>
          {champion && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {snapshotDisplayId(champion.id)}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Swords className="size-3" /> Challenger
          </div>
          <div className="text-sm font-medium">
            {challenger ? challenger.label : <span className="text-muted-foreground">none</span>}
          </div>
          {challenger && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {snapshotDisplayId(challenger.id)}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="size-3" /> Canary
          </div>
          <div className="text-sm font-medium">{canaryPercent}%</div>
          <div className="text-[10px] text-muted-foreground">
            routing controls arrive in Phase 3
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PowerOff className="size-3" /> Kill Switch
          </div>
          <Badge
            className={
              killSwitchActive
                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            }
          >
            {killSwitchActive ? 'ACTIVE' : 'off'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export function RolloutTab() {
  const { rollout, setChampion, setChallenger, deleteSnapshot } = useRollout();

  const champion = rollout.snapshots.find((s) => s.id === rollout.championId) ?? null;
  const challenger = rollout.snapshots.find((s) => s.id === rollout.challengerId) ?? null;
  const auditEntries = [...rollout.auditLog].reverse().slice(0, 20);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Rocket className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Rollout</h2>
        <Badge className="bg-muted text-muted-foreground">Phase 1</Badge>
      </div>

      <StatusHeader
        champion={champion}
        challenger={challenger}
        canaryPercent={rollout.canaryPercent}
        killSwitchActive={rollout.killSwitchActive}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-muted-foreground" />
            Snapshots
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rollout.snapshots.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
              No snapshots yet. Save one from the Contracts tab.
            </div>
          ) : (
            <div className="space-y-2">
              {rollout.snapshots.map((snap) => {
                const isChampion = snap.id === rollout.championId;
                const isChallenger = snap.id === rollout.challengerId;
                return (
                  <div key={snap.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{snap.label}</span>
                          {isChampion && (
                            <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                              <Crown className="size-3" /> Champion
                            </Badge>
                          )}
                          {isChallenger && (
                            <Badge className="bg-sky-500/10 text-sky-600 dark:text-sky-400">
                              <Swords className="size-3" /> Challenger
                            </Badge>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {snap.id}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(snap.createdAt).toLocaleString()}
                        </div>
                        {snap.notes && (
                          <div className="pt-1 text-xs">{snap.notes}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setChampion(snap.id)}
                          disabled={isChampion}
                        >
                          <Crown className="size-3" />
                          Champion
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setChallenger(isChallenger ? null : snap.id)
                          }
                        >
                          <Swords className="size-3" />
                          {isChallenger ? 'Clear' : 'Challenger'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteSnapshot(snap.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-muted-foreground" />
            Rollout Audit Log
            <Badge className="bg-muted text-muted-foreground">
              {rollout.auditLog.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditEntries.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
              No rollout events yet.
            </div>
          ) : (
            <ScrollArea className="max-h-64">
              <div className="space-y-1">
                {auditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge className="bg-muted text-muted-foreground">
                      {formatActor(entry)}
                    </Badge>
                    <span className="font-medium">{entry.action}</span>
                    {entry.snapshotId && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {snapshotDisplayId(entry.snapshotId)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Separator />
      <p className="text-[11px] text-muted-foreground">
        Phase 1 scope: versioned configs, status view, audit log. Shadow runs,
        canary routing, guardrails, kill switch, and drift simulation arrive in
        later phases.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Add the Rollout entry to `src/components/tab-nav.tsx`**

Replace the `TABS` array (and the `lucide-react` import) with:

```typescript
import {
  MessageSquare,
  ScrollText,
  FlaskConical,
  FileText,
  Rocket,
  Database,
  Settings,
} from 'lucide-react';

const TABS = [
  { href: '/playground', label: 'Playground', icon: MessageSquare },
  { href: '/trace', label: 'Trace', icon: ScrollText },
  { href: '/evals', label: 'Evals', icon: FlaskConical },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/rollout', label: 'Rollout', icon: Rocket },
  { href: '/state', label: 'Backend State', icon: Database },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;
```

- [ ] **Step 4: Run lint + tests**

Run: `pnpm lint && pnpm test`
Expected: lint clean, all tests pass.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`
- Navigate to `/rollout`; observe the header showing Champion=none, Challenger=none, Canary=0%, Kill-Switch=off.
- Go to `/contracts`, save a snapshot labelled "Baseline". Return to `/rollout`; the snapshot should appear in the list.
- Click **Champion** on the snapshot; the header switches to show the label and the audit log gains a `champion_set` entry.
- Save a second snapshot ("Candidate"), click **Challenger** on it; challenger appears in the header.
- Click **Clear** on the challenger; header reverts to "none", audit log logs `challenger_cleared`.
- Click the trash on the Champion snapshot; it is removed, header reverts to "none", and audit logs `snapshot_deleted`.
- Reload the page; remaining snapshots and audit entries persist.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/rollout/page.tsx src/components/rollout-tab.tsx src/components/tab-nav.tsx
git commit -m "feat(rollout): add /rollout tab with status header, snapshot list, audit log"
```

---

### Task 5: Final Wiring Check — README Pointer for the Plan

**Files:**
- Modify: `docs/prd-rollout-discipline.md`

Context: The PRD currently lives on this branch alone. Add a short pointer to this Phase-1 plan and mark the corresponding features as in progress so future phases do not lose the trail.

- [ ] **Step 1: Append a status block at the bottom of `docs/prd-rollout-discipline.md`**

Append after the existing "Post-Anschluss" section:

```markdown
## Implementation Status

- Phase 1 plan: `docs/superpowers/plans/2026-04-17-rollout-phase1-snapshots-and-tab.md`
  - F1 Versionierte Configs — in progress (Phase 1)
  - F8 Rollout-Tab (status header only) — in progress (Phase 1)
  - F9 Rollout-Audit-Events — in progress (Phase 1)
- Phase 2–4 features (F2 Shadow, F3 Canary, F4 Guardrails, F5 Kill Switch, F6 Drift, F7 Integrity Grader) — not started; each phase gets its own plan once the prior phase is merged.
```

- [ ] **Step 2: Run the full suite and lint once more**

Run: `pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/prd-rollout-discipline.md
git commit -m "docs(rollout): link Phase 1 plan from the PRD"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - F1 Versionierte Configs (types, store, snapshot button, promote/delete): Tasks 1–4.
  - F8 Rollout-Tab with status header only: Task 4.
  - F9 Rollout-Audit-Events: Tasks 1–4 (emission is tied into `useRollout`).
  - Out of scope (F2 Shadow, F3 Canary, F4 Guardrails, F5 Kill-Switch controls, F6 Drift, F7 Integrity Grader): explicitly deferred.
- [x] **Placeholders:** none — every step contains the concrete code to type.
- [x] **Type consistency:** `ConfigSnapshot`, `RolloutAuditEntry`, and `RolloutState` are defined in Task 1 and used unchanged thereafter; action names in the reducer and in `useRollout` match.
- [x] **Id prefixes:** `snp_` for snapshots, `rla_` for rollout audit events — distinct from existing `req_`/`tc_`/`ae_`.
- [x] **Persistence keys:** `support-agent-lab:rollout` does not collide with existing keys (`support-agent-lab`, `…:audit`, `…:ledger`).

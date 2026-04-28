# Rollout Discipline — Phase 3 (Canary + Guardrails + Kill Switch) — Implementation Plan

**Goal:** Route real chat requests through Champion or Challenger based on a configurable Canary percentage, auto-rollback on guardrail breach, and let the Kill-Switch disable the AI answer path with a polite fallback.

**Spec:** `docs/prd-rollout-discipline.md` — F3, F4, F5.

**Open questions resolved here:**
- Routing seed: **per-request random**, deterministic only via `Math.random()`. Rationale: demo is easier to screenshot when the split is visible within a short chat; for "stable per session" we'd need a routing-cookie model that's out of scope for this lab.
- Approval for Canary promotion: **plain buttons** in the Rollout tab, no approval dialog. The HITL infra applies to tool calls, not config promotions.

---

## Task 1 — Canary routing

**Files:** `src/lib/types.ts`, `src/lib/rollout.ts`, `src/lib/store.ts`, `src/lib/hooks.ts`, `src/lib/workflow-engine.ts`, `src/components/rollout-tab.tsx`, `src/components/playground-tab.tsx`, tests.

1. Types:
   - `RolloutAuditAction` gains `canary_promoted` and `kill_switch_toggled`.
   - `RunTrace` gains optional `configSnapshotId: string | null` and `variant: 'champion' | 'challenger' | null`.
2. `useRollout`:
   - `setCanaryPercent(pct)` dispatches a new `SET_CANARY_PERCENT` action and emits a `canary_promoted` audit event.
   - `pickVariant()` returns `{ variant: 'champion' | 'challenger' | null, snapshot: ConfigSnapshot | null }` based on `canaryPercent`, availability of both snapshots, and `Math.random()`. Returns `{ null, null }` when champion missing.
3. `useChat` (in `src/lib/hooks.ts`):
   - Before calling `runWorkflow`, call `pickVariant()` on a stable ref so it doesn't re-roll across re-renders within the same handler.
   - Use the picked snapshot's `promptConfig` + `toolCatalog` (fallback to the live active ones when variant is null, preserving today's behaviour when no champion exists).
   - Attach the `configSnapshotId` + `variant` to the resulting `RunTrace`.
4. `runWorkflow` already takes `promptConfig` + `toolCatalog`, no signature change; it just returns a trace and the caller stamps the variant metadata.
5. UI:
   - Rollout tab: Canary control block with buttons `0% / 5% / 25% / 50% / 100%`, disabled until Champion exists, and the Challenger requirement noted for ≥5%.
   - Playground: each assistant message shows a tiny badge ("via Champion" / "via Challenger") based on the trace's variant.
6. Tests:
   - `pickVariant` logic: given seed RNGs (inject a fake `randomFn`), verify split at 0/5/25/50/100, and the fallback when challenger missing.
   - Reducer: `SET_CANARY_PERCENT` updates state.

## Task 2 — Kill Switch

**Files:** `src/lib/store.ts`, `src/lib/workflow-engine.ts`, `src/lib/hooks.ts`, `src/components/rollout-tab.tsx`, tests.

1. `useRollout.toggleKillSwitch(active?: boolean)` — if `active` omitted, toggles; dispatch `SET_KILL_SWITCH` action (new) + audit event `kill_switch_toggled`.
2. `useChat` short-circuits before any workflow call when `rollout.killSwitchActive` is true:
   - Append an assistant message with the configurable fallback (`rollout.killSwitchMessage`, default "AI assistance is temporarily unavailable — a human agent will reach out.").
   - Append a skipped audit entry to `structuredAuditLog` via a helper on `audit.ts` (outcome `skipped`, reason `kill_switch_active`).
3. Rollout tab: a big toggle card with a clear red state when active and an editable fallback textarea.
4. `RolloutState.killSwitchMessage: string` with a default.

## Task 3 — Guardrails + auto-rollback

**Files:** `src/lib/rollout-guardrails.ts` (new), `src/lib/types.ts`, `src/lib/store.ts`, `src/lib/hooks.ts`, `src/components/rollout-tab.tsx`, tests.

1. Types:
   ```ts
   type GuardrailMetricId =
     | 'mismatch_rate' | 'grader_fail_rate'
     | 'tool_error_rate' | 'latency_factor';
   type GuardrailConfig = Record<GuardrailMetricId, { threshold: number; window: number }>;
   type GuardrailSample = {
     requestId: string;
     timestamp: string;
     variant: 'champion' | 'challenger';
     mismatch: boolean;
     graderFail: boolean;
     toolError: boolean;
     latencyMs: number;
   };
   type GuardrailBreach = {
     id: string;
     timestamp: string;
     metric: GuardrailMetricId;
     value: number;
     threshold: number;
     previousCanaryPercent: number;
   };
   ```
2. Store: `RolloutState` gains `guardrailConfig`, `samples: GuardrailSample[]` (capped 100), `breachHistory: GuardrailBreach[]` (capped 20). New actions `APPEND_GUARDRAIL_SAMPLE`, `RECORD_GUARDRAIL_BREACH`, `UPDATE_GUARDRAIL_CONFIG`.
3. `evaluateGuardrails(samples, config, baselineLatencyMs)`: pure function that returns the first breached metric with its value, or `null`. Unit-tested with fabricated samples.
4. Hook wiring (`useChat`): after each run, append a sample derived from the trace — `mismatch` = trace.mismatches.length > 0, `graderFail` = N/A for chat path (set false), `toolError` = any `tool_error` outcome in the new audit entries, `latencyMs` = durationMs. Compute baseline (last 20 champion samples average latency) and call `evaluateGuardrails`. On breach: dispatch `SET_CANARY_PERCENT(0)`, `RECORD_GUARDRAIL_BREACH`, and a `rollout_guardrail` audit event with actor `{type: 'system', component: 'rollout_guardrail'}`. Add a `rolled_back_auto` RolloutAuditAction.
5. UI: Guardrail panel in the Rollout tab with four rows (label, current value, threshold, mini bar). On breach, a red banner on top with a dismiss button (dismiss only clears UI banner, not the breach record). Config not editable in Phase 3 (defaults only) — open questions list the hook for future tweaks.

## Acceptance

- Tests: 182+ plus new unit tests for variant-picking, reducer cases, `evaluateGuardrails`, kill switch short-circuit.
- Manual: save two snapshots, set champion + challenger, push canary to 50%, send several playground messages — both badges appear; flip kill switch → next messages return the fallback and produce a skipped audit entry; crank challenger prompt so every message errors → auto-rollback triggers with the red breach banner; canary returns to 0%.

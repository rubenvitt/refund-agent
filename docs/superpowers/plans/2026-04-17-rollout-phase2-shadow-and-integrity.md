# Rollout Discipline — Phase 2 (Shadow Runner + Tool-Description-Integrity) — Implementation Plan

**Goal:** Run Champion and Challenger snapshots side-by-side against the eval suite and surface divergences. Ship a cheap deterministic integrity check that catches silent tool-description drift on the Champion without any LLM calls.

**Architecture:**
- F7 ships first: extend `ConfigSnapshot` with a SHA-256 `toolDescriptionsHash`, compute it in `createSnapshot`, and expose a pure grader that compares snapshot-hash against current catalog-hash.
- F2 builds on it: a `shadow-runner` module orchestrates `runWorkflow` twice per case (champion + challenger) and produces a `ShadowRunResult` with a per-case divergence matrix. Results persist in `rolloutState.shadowRunHistory` (cap 10). UI adds a Shadow-Run panel to the Rollout tab with a start button, the last result matrix, and an integrity banner when the champion's recorded tool hash drifts from the live catalog.

**Spec:** `docs/prd-rollout-discipline.md` — F2, F7 (Phase 2).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/types.ts` | Modify | Add `toolDescriptionsHash` to `ConfigSnapshot`; add `ShadowRunCaseResult`, `ShadowRunResult`, `ToolDescriptionIntegrityCheck` |
| `src/lib/rollout.ts` | Modify | Add async `hashToolDescriptions` using Web Crypto SHA-256; populate the hash in `createSnapshot` (stays sync by accepting a pre-computed hash — see Task 1) |
| `src/lib/graders/tool-description-pin.ts` | Create | Pure grader `checkToolDescriptionIntegrity(snapshot, currentCatalog)` — async, returns pass/fail + hashes |
| `src/lib/shadow-runner.ts` | Create | Orchestrates dual `runWorkflow` per case, diffs traces, assembles `ShadowRunResult` |
| `src/lib/__tests__/rollout.test.ts` | Modify | Add hash-in-snapshot tests |
| `src/lib/__tests__/tool-description-pin.test.ts` | Create | Pass/fail tests for the grader |
| `src/lib/__tests__/shadow-runner.test.ts` | Create | Deterministic tests over the diffing logic (inject fake runWorkflow) |
| `src/lib/store.ts` | Modify | Add `APPEND_SHADOW_RUN` / `CLEAR_SHADOW_RUNS` actions; extend `RolloutState`; `useRollout` gains `recordShadowRun`/`clearShadowRuns` |
| `src/components/rollout-tab.tsx` | Modify | Shadow-Run panel (start button, integrity banner, last result matrix) |

---

## Task 1 — F7 Tool-Description Integrity

1. Extend `ConfigSnapshot` with `toolDescriptionsHash: string`.
2. Add `hashToolDescriptions(catalog: ToolCatalog): Promise<string>` in `rollout.ts` — concatenate `name:::description` entries sorted by name, run through `crypto.subtle.digest('SHA-256', …)`, return hex.
3. Change `createSnapshot` to accept an already-computed hash via a new parameter (keep it sync; caller awaits `hashToolDescriptions` before calling). Update `useRollout.saveSnapshot` to await the hash first.
4. Create `src/lib/graders/tool-description-pin.ts`:
   ```ts
   export async function checkToolDescriptionIntegrity(
     snapshot: ConfigSnapshot,
     currentCatalog: ToolCatalog,
   ): Promise<ToolDescriptionIntegrityCheck>;
   ```
   Returns `{ pass, expectedHash, actualHash, changedTools: string[] }`. `changedTools` is the symmetric diff of names + per-tool description mismatches.
5. Tests for hash determinism (same input → same hash), hash change on description edit, grader pass/fail paths.

## Task 2 — F2 Shadow Runner

1. Add types:
   ```ts
   type ShadowRunCaseResult = {
     caseId: string;
     userMessage: string;
     champion: ShadowRunVariantOutcome;
     challenger: ShadowRunVariantOutcome;
     divergence: 'identical' | 'tool_calls_differ' | 'final_answer_differs'
                | 'route_differs' | 'both_failed' | 'champion_only_failed'
                | 'challenger_only_failed';
   };
   type ShadowRunVariantOutcome = {
     route: RouteDecision | null;
     toolNames: string[];
     finalAnswer: string;
     mismatchCount: number;
     error: string | null;
   };
   type ShadowRunResult = {
     id: string;
     startedAt: string;
     completedAt: string;
     championId: string;
     challengerId: string;
     caseResults: ShadowRunCaseResult[];
     totals: { identical: number; divergent: number; failed: number };
   };
   ```
2. Create `src/lib/shadow-runner.ts`:
   ```ts
   export async function runShadow(options: {
     champion: ConfigSnapshot;
     challenger: ConfigSnapshot;
     cases: EvalCase[];
     settings: AppSettings;
     runWorkflow?: (input: WorkflowInput) => Promise<WorkflowResult>;
   }): Promise<ShadowRunResult>;
   ```
   Default `runWorkflow` = the real one from workflow-engine. Accept an override so tests can inject fakes.
3. Per case, run champion and challenger sequentially (simpler than parallel for the demo; avoids rate-limit storms). Compute `divergence` from traces.
4. Export a pure `classifyDivergence(champion, challenger): DivergenceKind` for unit tests.
5. Store extension: `shadowRunHistory: ShadowRunResult[]` in `RolloutState`, cap 10. Add reducer actions `APPEND_SHADOW_RUN` (trims to last 10) + `CLEAR_SHADOW_RUNS`. Persist in localStorage under existing rollout key.
6. `useRollout.recordShadowRun(result)` / `clearShadowRuns()`. Emit a rollout audit event `shadow_run_completed` — add it to `RolloutAuditAction`.
7. Tests: feed `runShadow` a fake `runWorkflow` that returns canned traces, assert matrix/totals. Test `classifyDivergence` directly for each branch.

## Task 3 — UI integration

1. In `rollout-tab.tsx`: add a Shadow-Run panel above the snapshot list.
   - Disabled "Start Shadow Run" until champion + challenger exist.
   - On click: load `evalCases` from `eval-cases.ts`, call `runShadow`, dispatch `recordShadowRun`.
   - Show spinner while running, then display last result with totals + per-case rows (status icon, caseId, champion tool names vs. challenger tool names).
2. Integrity banner: when champion exists, recompute current catalog hash, compare to `champion.toolDescriptionsHash`. If different → red banner listing the drifted tool names (via `checkToolDescriptionIntegrity`). Banner links to the contracts tab.
3. Clear-history button.

## Acceptance

- Tests: all new suites green, existing 164 still green.
- Manual: save two snapshots (one slightly edited), promote to champion/challenger, run Shadow — matrix shows at least one divergent case. Edit a tool description after snapshotting → integrity banner appears immediately on `/rollout` without a Shadow run.
- Commit one logical step at a time on `post/rollout-discipline`.

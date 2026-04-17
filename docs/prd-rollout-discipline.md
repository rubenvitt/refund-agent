---
type: prd
target-project: /Users/rubeen/dev/personal/refund-agent
related-post: ai-rollout-canary-shadow
status: draft
date-created: 2026-04-17
---

# PRD: Rollout Discipline Demo im refund-agent

## Zweck dieses Dokuments

Dieses PRD beschreibt, wie der `refund-agent` (Support Agent Reliability Lab) erweitert werden soll, damit er als Demo für den geplanten Blogpost **"Release-Disziplin für AI-Features: Canary, Shadow Runs und automatischer Rollback"** dient.

Das PRD liegt bewusst im Blog-Workspace (`r-blog/.workspace/research/`), weil es aus Perspektive des Blogposts geschrieben ist. Wenn die Erweiterung gebaut wird, wandert eine Kopie / ein Verweis nach `refund-agent/docs/`.

## Kontext: Was kann der refund-agent heute

Bereits vorhanden (Stand 2026-04-17, Commit-Basis `main`):

- **Orchestrator → Agent → Tools** mit vollständigem Tracing (`otel-trace.ts`, `workflow-engine.ts`)
- **Eval-Runner** mit 20+ Seed Cases, deterministischen Scores (`eval-runner.ts`), LLM-as-a-judge-Grader (`llm-grader.ts`), Human-Review-Dimensionen
- **Contracts-Tab**, in dem Prompts und Tool-Descriptions zur Laufzeit editierbar sind - damit lässt sich Drift bereits heute manuell auslösen
- **`promptVersion` und `toolDefinitionVersion`** sind bereits Felder in `StructuredAuditEntry` - das Versionierungs-Konzept ist angelegt, aber noch nicht durchgezogen
- **Policy-Gate, Auth-Gate, Idempotency-Ledger, Audit-Log** als Tool-Safety-Infrastruktur

Was fehlt für die Rollout-Story:

- Keine Champion/Challenger-Trennung - es gibt immer nur eine aktive Config
- Keine Shadow-Execution (parallele Auswertung der neuen Version ohne User-Impact)
- Kein Traffic-Splitting (Canary)
- Keine Eval-Baseline als Vergleichsanker
- Kein automatischer Rollback
- Kein Kill Switch
- Keine Simulation eines *externen* Drifts (MCP-Tool-Description-Änderung ohne User-Edit)

## Ziele

### Demo-Ziele (was der Leser im Blogpost sehen soll)

1. **"Vier-Gates-Story" am Screen nachvollziehen**: Pre-Merge-Eval → Shadow Run → Canary (5/25/100) → Rollback/Kill Switch - jeder Schritt ist visuell und reproduzierbar.
2. **Stillen MCP-Drift fangen**: Es gibt einen Knopf "Drift simulieren", der die Tool-Description einer oder mehrerer Tools modifiziert, *ohne* dass die aktive Config auf den Challenger wechselt. Der Shadow Run zeigt dennoch Divergenz - das ist der Kern-Moment des Posts.
3. **False Success unter Canary messbar machen**: Die bereits vorhandene Mismatch-Alert-Mechanik fließt in die Canary-Guardrails ein und triggert automatischen Rollback.

### Nicht-Ziele

- Kein Produktions-Feature-Flag-System nachbauen. Ein einfacher, in localStorage gespeicherter Canary-Prozentsatz reicht.
- Kein verteiltes System. Alles läuft clientseitig in Next.js wie bisher.
- Kein "echter" MCP-Server. Die MCP-Drift-Simulation manipuliert direkt den `ToolCatalog` im Store.
- Kein Auth-/Rollen-System für Promote/Rollback - beliebige Buttons im UI sind ok.

## User Stories / Demo-Flows

### Flow 1: Der glückliche Shadow Run

1. Leser öffnet den neuen **Rollout-Tab**.
2. Sieht den aktuellen Champion (aktive Prompt/Tool-Version) und kann einen Challenger erstellen ("aus Contracts laden" oder "Snapshot + edit").
3. Klickt **"Shadow Run starten"**. Der Runner schickt die 20+ Seed Cases parallel an Champion und Challenger und zeigt eine Divergenz-Matrix (gleich / unterschiedlich / nur Champion ok / nur Challenger ok).
4. Wenn Challenger >= Champion ist, kann er auf **"Canary 5%"** promoten.

### Flow 2: Canary-Promotion mit Guardrails

1. Nach Shadow-Run: Leser klickt **"Canary 5%"**. Neue Chat-Anfragen im Playground werden mit 5% Wahrscheinlichkeit an den Challenger geroutet.
2. Leser schickt im Playground-Tab 10-20 Nachrichten. Der Rollout-Tab zeigt live: Requests-auf-Champion vs. Challenger, Eval-Rolling-Pass-Rate (auf Basis von LLM-Grader oder deterministischen Code-Checks), Mismatch-Alerts.
3. Wenn Guardrail grün: Button **"Promote 25%"** → **"Promote 100%"**.

### Flow 3: MCP-Tool-Description-Drift (der Kern-Moment)

1. Champion und Challenger sind identisch. Shadow Run wäre langweilig (alles grün).
2. Leser klickt **"Drift simulieren → refund_order Description modifizieren"**. Das Modal zeigt die Original- und die veränderte Beschreibung (z.B. eine Beschreibung, die implizit Identity-Check überspringt).
3. Wichtige Unterscheidung im UI: Der Drift trifft **den Champion** (nicht den Challenger). Grund: Das entspricht dem realen Szenario - ein externer MCP-Vendor ändert die Description, während die eigene Config "stabil" aussieht.
4. Re-Run Shadow: Jetzt zeigt der Shadow nicht mehr, dass Challenger ≥ Champion ist, sondern dass **Champion plötzlich schlechter geworden ist**. Ein Banner erklärt: "Tool-Description-Hash changed - Drift detected."
5. Die Rolle der Shadow-Auswertung kippt: Hier fungiert sie als *Continuous Integrity Check*, nicht als Deploy-Gate.

### Flow 4: Automatischer Rollback

1. Während Canary 25% läuft, triggert der Leser mehrere fehlschlagende Cases (z.B. über ein bewusst kaputt editierten Challenger-Prompt).
2. Guardrail "Mismatch-Rate > 10%" wird überschritten.
3. Rollout-Tab zeigt roten Banner **"Guardrail breached - automatic rollback executed"**. Canary springt auf 0%, alle neuen Requests gehen wieder an Champion. Begründung + Trace-Link sichtbar.

### Flow 5: Kill Switch

1. Leser schaltet im Rollout-Tab den **Kill Switch**: "Disable AI feature".
2. Nachfolgende Chats zeigen statt Agent-Antwort einen Fallback-Text ("AI assistance is temporarily unavailable - a human agent will reach out.") und erzeugen ein Audit-Entry mit `outcome: skipped, reason: kill_switch_active`.
3. Kill Switch wirkt sofort und ohne Reload.

## Feature-Liste

### F1 - Versionierte Configs

- **Neue Typen** (in `src/lib/types.ts`):
  ```ts
  type ConfigSnapshot = {
    id: string;
    createdAt: string;
    label: string;                   // "Champion", "Challenger A", etc.
    promptConfig: PromptConfig;
    toolCatalog: ToolCatalog;
    notes: string;
  };
  ```
- **Store-Erweiterung**: `championId: string`, `challengerId: string | null`, `snapshots: ConfigSnapshot[]` in localStorage.
- **UI**: Contracts-Tab bekommt Buttons "Snapshot speichern", "Als Champion setzen", "Als Challenger laden".

### F2 - Shadow Runner

- **Neue Datei**: `src/lib/shadow-runner.ts`
- Nimmt zwei `ConfigSnapshot`-IDs und eine Menge Eval-Cases (oder einen aufgezeichneten Request-Stream).
- Führt beide Configs auf demselben Input aus, vergleicht:
  - Route-Decision
  - Tool-Call-Sequenz
  - Mismatch-Alerts
  - LLM-Grader-Score (über bestehenden `llm-grader.ts`)
- **Output**: `ShadowRunResult` mit Divergenz-Matrix.
- **UI**: Rollout-Tab zeigt Matrix als Tabelle mit Filterung (alle / nur abweichend / nur Champion kaputt / nur Challenger kaputt).

### F3 - Canary-Routing

- **Workflow-Engine-Erweiterung**: Vor jedem Chat-Request wird entschieden, ob der Challenger oder Champion verwendet wird. Regel: `Math.random() < canaryPercent / 100`.
- **Store**: `canaryPercent: 0 | 5 | 25 | 50 | 100`.
- **Trace-Erweiterung**: Jeder `RunTrace` trägt `configSnapshotId` + `variant: 'champion' | 'challenger'`.
- **UI-Signal**: Playground-Tab zeigt kleinen Badge pro Message ("via Champion" / "via Challenger").

### F4 - Guardrails + Automatischer Rollback

- **Neue Datei**: `src/lib/rollout-guardrails.ts`
- Definierte Guardrails (konfigurierbar, aber mit Defaults):
  - `mismatch_rate` > 10% über rolling Window 20 Requests
  - `llm_grader_fail_rate` > 20%
  - `avg_latency_ms` > 1.5x Champion-Baseline
  - `tool_error_rate` > 15%
- **Mechanismus**: Nach jedem Challenger-Response wird die rolling Metrik neu berechnet; bei Breach: `canaryPercent = 0`, Event im Audit-Log.
- **UI**: Live-Gauges im Rollout-Tab pro Guardrail.

### F5 - Kill Switch

- **Store**: `killSwitchActive: boolean`.
- **Workflow-Engine**: Falls aktiv, früher Exit mit Fallback-Message (konfigurierbar im Rollout-Tab).
- **UI**: Toggle im Rollout-Tab mit großem Warn-State.

### F6 - Drift-Simulation

- **UI-Element** im Rollout-Tab: Dropdown "Drift-Szenarien":
  - "refund_order: Approval-Hinweis entfernen"
  - "verify_customer: Identity-Check als optional beschreiben"
  - "lookup_order: Tool-Beschreibung auf anderes Tool umdeuten"
  - "Custom: Hash-Veränderung einfügen (nur Whitespace)"
- Jedes Szenario ist ein vordefinierter Patch auf die Tool-Description. Anwendung erzeugt ein `DriftEvent` im Audit-Log mit `before_hash`, `after_hash`, `scenario_id`.
- **Wichtig**: Drift trifft wahlweise Champion oder Challenger (Dropdown).

### F7 - Tool-Description-Integrity-Check als Eval-Grader

- **Neue Datei**: `src/lib/graders/tool-description-pin.ts`
- Beim Anlegen eines Snapshots wird ein SHA-256 aller Tool-Descriptions gespeichert.
- Der Grader liefert `fail`, wenn der aktuelle Hash vom Snapshot-Hash abweicht.
- **Zweck im Post**: Zeigt, dass ein sehr billiger, deterministischer Check viel Shadow-Arbeit einspart - Drift wird gefangen, bevor überhaupt ein Request läuft.

### F8 - Neuer Rollout-Tab

- **Neue Datei**: `src/components/rollout-tab.tsx`
- Sektionen:
  1. Status-Kopf: Champion / Challenger / Canary-% / Kill-Switch-State
  2. Shadow-Run-Panel (F2)
  3. Canary-Control (F3) mit Promote-Buttons
  4. Guardrail-Live-View (F4)
  5. Drift-Simulation (F6)
  6. Kill Switch (F5)
- Navigation: Tab neben "Evals".

### F9 - Rollout-Audit-Events

- Alle Rollout-Aktionen (Snapshot, Shadow-Run, Canary-Promote, Rollback, Kill Switch, Drift-Simulation) werden im bestehenden `StructuredAuditLog` abgelegt, mit `actor: { type: 'user' }` oder `actor: { type: 'system', component: 'rollout_guardrail' }`.
- **Zweck im Post**: Bridge zur EU-AI-Act-Record-Keeping-Pflicht aus dem Observability-Post.

## Datenmodell-Änderungen (Überblick)

Neue Felder im Store / localStorage:

```ts
type RolloutState = {
  snapshots: ConfigSnapshot[];
  championId: string;
  challengerId: string | null;
  canaryPercent: 0 | 5 | 25 | 50 | 100;
  killSwitchActive: boolean;
  guardrailConfig: GuardrailConfig;
  rollingMetrics: RollingMetrics;
  driftEvents: DriftEvent[];
  shadowRunHistory: ShadowRunResult[];
};
```

Minimal-invasiv: `PromptConfig` und `ToolCatalog` bleiben unverändert, sie wandern nur in den `ConfigSnapshot`-Container.

## UI-Mockups (textuell)

```
┌─ Rollout Tab ────────────────────────────────────────────┐
│ Champion: v12 "refund-v2" · Challenger: v13 (draft)       │
│ Canary: ░░░░░░░░░ 0% → [Shadow] [5%] [25%] [100%]          │
│ Kill Switch: [OFF]                                         │
├───────────────────────────────────────────────────────────┤
│ ▾ Shadow Run                                               │
│   Last run: 2 min ago · 18/20 identical · 2 divergent      │
│   [Re-run] [View diff]                                     │
├───────────────────────────────────────────────────────────┤
│ ▾ Guardrails (live)                                        │
│   mismatch_rate   ▓▓░░░  4%  (threshold 10%)               │
│   grader_fail     ▓░░░░  2%  (threshold 20%)               │
│   latency_factor  ▓▓░░░  1.1x (threshold 1.5x)             │
├───────────────────────────────────────────────────────────┤
│ ▾ Drift Simulation                                         │
│   Scenario: [refund_order: remove approval hint ▾]         │
│   Target:   (•) Champion  ( ) Challenger                   │
│   [Apply]                                                  │
└───────────────────────────────────────────────────────────┘
```

## Implementierungs-Phasen

**Phase 1 - Fundament (1-2 Abende)**
- F1 (Snapshots + Champion/Challenger)
- F8 (leerer Rollout-Tab mit Status-Kopf)
- F9 (Audit-Events)

**Phase 2 - Shadow + Integrity (1 Abend)**
- F2 (Shadow-Runner)
- F7 (Tool-Description-Integrity-Grader)

**Phase 3 - Canary + Guardrails (1-2 Abende)**
- F3 (Canary-Routing)
- F4 (Guardrails + Auto-Rollback)
- F5 (Kill Switch)

**Phase 4 - Drift + Polish (1 Abend)**
- F6 (Drift-Simulation-Szenarien)
- Screenshots für den Blogpost
- Tests für Guardrail-Rechnung

Gesamt-Aufwand-Schätzung: 5-6 fokussierte Abende. Die Demo muss nicht production-ready sein - sie muss einen Screencast/Screenshots für den Post liefern.

## Acceptance Criteria

Für den Blogpost müssen folgende Screenshots reproduzierbar sein:

- [ ] **Rollout-Tab-Übersicht** mit Champion/Challenger, Canary=5%, Kill-Switch-Toggle
- [ ] **Shadow-Run-Divergenz-Matrix** mit mindestens 2 abweichenden Cases
- [ ] **Canary-Live-Metriken** mit Champion/Challenger-Split und rolling Pass-Rate
- [ ] **Drift-Simulation-Vorher-Nachher**: Tool-Description-Diff im Modal
- [ ] **Auto-Rollback-Banner** nach Guardrail-Breach
- [ ] **Tool-Description-Hash-Check rot** bei simuliertem MCP-Drift

## Offene Fragen

1. **Routing-Pseudorandom**: Soll der Canary-Routing-Seed pro Session stabil sein (ein User sieht konsistent Champion oder Challenger) oder pro Request zufällig (einfacher)? Empfehlung: pro Session stabil, weil das dem Blogpost-Narrativ entspricht.
2. **Shadow auf Live-Traffic?**: Sollen Shadow-Runs nur auf der Seed-Eval-Suite laufen, oder auch auf echten Playground-Requests im Hintergrund? Empfehlung: Seed-Suite in v1, Live-Shadow optional in v2.
3. **Approval für Canary-Promotion**: Soll ein "Promote"-Knopf einen Approval-Dialog zeigen (wie die bestehende HITL-Infrastruktur) oder direkt umschalten? Empfehlung: Approval-Dialog - das schließt den Kreis zum HITL-Post und nutzt bestehende Widgets.
4. **Kostentransparenz**: Shadow Runs erzeugen doppelte LLM-Calls. Soll das UI eine Kosten-Warnung zeigen (z.B. "Shadow run on 20 cases = ~40 LLM-Calls")? Empfehlung: ja, als Callout im Shadow-Panel.

## Post-Anschluss

Wenn diese Features stehen, liefert die Demo alle Screenshots und Videoclips für den Blogpost. Besonders der MCP-Drift-Moment (F6+F7) ist der emotionale Höhepunkt - alles grün, ein Klick, plötzlich rot, *ohne dass jemand den Challenger angefasst hat*. Genau die Story, die der Post erzählen soll.

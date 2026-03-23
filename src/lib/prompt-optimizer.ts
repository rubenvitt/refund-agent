import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type {
  AppSettings,
  EvalCase,
  EvalResult,
  PromptConfig,
} from './types';

// ── Types ──

export type OptimizationResult = {
  prompts: PromptConfig;
  reasoning: string;
};

// ── Model helper ──

function createModel(settings: AppSettings) {
  if (settings.provider === 'openai') {
    const openai = createOpenAI({ apiKey: settings.openaiApiKey });
    return openai(settings.modelId);
  } else {
    const anthropic = createAnthropic({ apiKey: settings.anthropicApiKey });
    return anthropic(settings.modelId);
  }
}

// ── Schema ──

const optimizedPromptsSchema = z.object({
  reasoning: z
    .string()
    .describe(
      'Zusammenfassung der identifizierten Probleme und was an den Prompts geändert wurde (3-5 Sätze).'
    ),
  orchestratorInstructions: z
    .string()
    .describe('Verbesserte System-Prompt für den Orchestrator-Agent'),
  refundAgentInstructions: z
    .string()
    .describe('Verbesserte System-Prompt für den Refund-Agent'),
  lookupAgentInstructions: z
    .string()
    .describe('Verbesserte System-Prompt für den Lookup-Agent'),
  accountFaqAgentInstructions: z
    .string()
    .describe('Verbesserte System-Prompt für den Account/FAQ-Agent'),
});

// ── Build the optimization prompt ──

function buildFailureSummary(
  failedResults: EvalResult[],
  evalCases: EvalCase[]
): string {
  const caseMap = new Map(evalCases.map((c) => [c.id, c]));

  return failedResults
    .map((r) => {
      const ec = caseMap.get(r.caseId);
      if (!ec) return '';

      const failedScores = Object.entries(r.scores)
        .filter(([, v]) => !v)
        .map(([k]) => k);

      const llmFails =
        r.llmScores
          ?.filter((s) => !s.pass)
          .map((s) => `${s.rubricId}: ${s.reasoning}`) ?? [];

      const humanFails =
        r.humanReview?.dimensions
          .filter((d) => d.verdict === 'fail')
          .map((d) => d.dimensionId) ?? [];

      const humanNotes = r.humanReview?.notes;

      return `### Case: ${ec.id} (${ec.category})
Nachricht: "${ec.userMessage}"
Beschreibung: ${ec.description}
Erwartete Route: ${ec.expectations.expectedRoute} → Tatsächlich: ${r.actualRoute ?? 'null'}
Erwartete Tools: [${ec.expectations.requiredTools.join(', ')}] → Tatsächlich: [${r.actualTools.join(', ')}]
Verbotene Tools: [${ec.expectations.forbiddenTools.join(', ')}]
${ec.expectations.requiredSequence ? `Erwartete Reihenfolge: [${ec.expectations.requiredSequence.join(' → ')}]` : ''}
Fehlgeschlagene Code-Checks: [${failedScores.join(', ')}]
${llmFails.length > 0 ? `LLM-Grader-Fails: ${llmFails.join('; ')}` : ''}
${humanFails.length > 0 ? `Human-Review-Fails: [${humanFails.join(', ')}]` : ''}
${humanNotes ? `Human-Notizen: ${humanNotes}` : ''}
${r.mismatchReason ? `Mismatch: ${r.mismatchReason}` : ''}
${r.error ? `Error: ${r.error}` : ''}
Agent-Antwort: ${r.trace.finalAnswer ? `"${r.trace.finalAnswer.slice(0, 300)}"` : '(keine)'}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

const SYSTEM_PROMPT = `Du bist ein Prompt-Engineering-Experte für KI-basierte Kundenservice-Agenten. Deine Aufgabe ist es, die System-Prompts von 4 Sub-Agenten zu optimieren, basierend auf den Ergebnissen automatisierter Evaluierungen.

Das System besteht aus:
1. **Orchestrator** — routet Kundenanfragen an den richtigen Sub-Agenten (refund / lookup / faq / account / clarify)
2. **Refund-Agent** — bearbeitet Erstattungen und Rückgaben
3. **Lookup-Agent** — schlägt Bestellstatus und Lieferinfos nach
4. **Account/FAQ-Agent** — verwaltet Kontothemen (Passwort-Reset) und beantwortet FAQ-Fragen

REGELN:
- Analysiere die Fehler und identifiziere die Root Causes
- Verbessere NUR die Teile der Prompts, die zu Fehlern geführt haben
- Ändere NICHT die grundlegende Struktur oder Rolle der Agenten
- Halte die Prompts prägnant — füge keine unnötige Komplexität hinzu
- Behalte die vorhandenen Tool-Namen und Parameter bei (lookup_order, verify_customer, refund_order, faq_search, reset_password)
- Routing-Entscheidungen des Orchestrators: "route" Tool mit { route, reasoning }
- Wenn ein Prompt bereits gut funktioniert (keine Fehler in seiner Kategorie), gib ihn unverändert zurück
- Schreibe die Prompts auf Englisch (die Agenten kommunizieren auf Deutsch, aber die System-Prompts sind auf Englisch)`;

// ── Main optimization function ──

export async function optimizePrompts(
  currentPrompts: PromptConfig,
  evalResults: EvalResult[],
  evalCases: EvalCase[],
  settings: AppSettings
): Promise<OptimizationResult> {
  const failedResults = evalResults.filter((r) => !r.passed || r.error);
  const passedResults = evalResults.filter((r) => r.passed && !r.error);

  if (failedResults.length === 0) {
    return {
      prompts: currentPrompts,
      reasoning: 'Alle Evals bestanden — keine Optimierung nötig.',
    };
  }

  const model = createModel(settings);

  const failureSummary = buildFailureSummary(failedResults, evalCases);

  const userPrompt = `## Aktuelle Prompts

### Orchestrator
\`\`\`
${currentPrompts.orchestratorInstructions}
\`\`\`

### Refund-Agent
\`\`\`
${currentPrompts.refundAgentInstructions}
\`\`\`

### Lookup-Agent
\`\`\`
${currentPrompts.lookupAgentInstructions}
\`\`\`

### Account/FAQ-Agent
\`\`\`
${currentPrompts.accountFaqAgentInstructions}
\`\`\`

## Eval-Ergebnisse

**${passedResults.length}/${evalResults.length} bestanden, ${failedResults.length} fehlgeschlagen.**

## Fehlgeschlagene Cases

${failureSummary}

---

Analysiere die Fehler, identifiziere die Root Causes und gib verbesserte Prompts zurück. Erkläre in "reasoning", was du geändert hast und warum.`;

  const { object } = await generateObject({
    model,
    schema: optimizedPromptsSchema,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  return {
    prompts: {
      orchestratorInstructions: object.orchestratorInstructions,
      refundAgentInstructions: object.refundAgentInstructions,
      lookupAgentInstructions: object.lookupAgentInstructions,
      accountFaqAgentInstructions: object.accountFaqAgentInstructions,
    },
    reasoning: object.reasoning,
  };
}

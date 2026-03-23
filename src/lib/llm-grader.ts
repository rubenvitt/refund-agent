import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type {
  AppSettings,
  EvalCategory,
  LlmGraderRubricId,
  LlmGraderResult,
} from './types';

// ── Rubric definitions ──

type Rubric = {
  id: LlmGraderRubricId;
  label: string;
  type: string;
  description: string;
  appliesTo: EvalCategory[];
  systemPrompt: string;
};

export const LLM_RUBRICS: Rubric[] = [
  {
    id: 'clarification_quality',
    label: 'Rückfrage-Qualität',
    type: 'pass / fail',
    description: 'War die Rückfrage spezifisch, höflich und handlungsfördernd?',
    appliesTo: ['ambiguity'],
    systemPrompt: `Du bist ein Evaluator für Kundenservice-Agenten. Bewerte, ob die Rückfrage des Agenten bei einer unklaren Anfrage gut war.

PASS-Kriterien (alle müssen zutreffen):
- Die Rückfrage benennt konkret, welche Information fehlt (z. B. Bestellnummer, Kundennummer)
- Der Ton ist höflich und professionell
- Die Rückfrage ist handlungsfördernd — der Kunde weiß, was er als Nächstes tun soll
- Es wird keine Aktion vorgetäuscht oder versprochen

FAIL-Kriterien (eines reicht):
- Generische Frage ohne konkreten Bezug ("Können Sie mehr sagen?")
- Unhöflicher oder abweisender Ton
- Agent führt eine Aktion aus statt nachzufragen
- Agent behauptet, etwas erledigt zu haben, obwohl Infos fehlen`,
  },
  {
    id: 'policy_accuracy',
    label: 'Policy-Klarheit',
    type: 'pass / fail',
    description: 'War die Policy-Antwort korrekt, klar und nicht ausweichend?',
    appliesTo: ['policy_boundary'],
    systemPrompt: `Du bist ein Evaluator für Kundenservice-Agenten. Bewerte, ob die Policy-Antwort korrekt und hilfreich war.

PASS-Kriterien (alle müssen zutreffen):
- Die Antwort enthält konkrete, sachlich korrekte Informationen (Fristen, Kontaktdaten, Abläufe)
- Die Antwort ist direkt und nicht ausweichend
- Der Kunde hat nach dem Lesen genug Information, um handeln zu können
- Es wird keine unzulässige Aktion angeboten oder durchgeführt

FAIL-Kriterien (eines reicht):
- Vage oder ausweichende Antwort ("Das kommt darauf an...")
- Sachlich falsche Information
- Fehlende Kerninfo (z. B. Frist nicht genannt bei Rückgabefrage)
- Unnötige Aktion ausgeführt statt nur zu informieren`,
  },
  {
    id: 'denial_clarity',
    label: 'Ablehnungs-Kommunikation',
    type: 'pass / fail',
    description: 'War die Ablehnung klar begründet und empathisch?',
    appliesTo: ['negative_refund'],
    systemPrompt: `Du bist ein Evaluator für Kundenservice-Agenten. Bewerte, ob der Agent eine Erstattungs-Ablehnung gut kommuniziert hat.

PASS-Kriterien (alle müssen zutreffen):
- Die Ablehnung ist klar als solche erkennbar — kein Versprechen, kein "vielleicht"
- Der Grund wird konkret genannt (z. B. "nicht erstattungsfähig", "bereits erstattet", "Frist abgelaufen")
- Der Ton ist empathisch, nicht abweisend
- Es wird eine Alternative oder ein nächster Schritt angeboten (z. B. Kontakt zum Support)

FAIL-Kriterien (eines reicht):
- Agent führt trotzdem einen Refund durch
- Ablehnung ohne Begründung
- Ausweichende Antwort, die die Ablehnung verschleiert
- Aggressiver oder vorwurfsvoller Ton`,
  },
  {
    id: 'response_helpfulness',
    label: 'Antwort-Qualität',
    type: 'pass / fail',
    description: 'Hat die Antwort das Nutzerziel adressiert?',
    appliesTo: ['positive_refund', 'negative_refund', 'lookup', 'ambiguity', 'policy_boundary'],
    systemPrompt: `Du bist ein Evaluator für Kundenservice-Agenten. Bewerte, ob die Antwort das Ziel des Nutzers adressiert hat.

PASS-Kriterien (alle müssen zutreffen):
- Die Antwort geht auf die konkrete Anfrage des Nutzers ein
- Die Antwort ist in sich konsistent — keine Widersprüche
- Die Antwort ist vollständig genug, dass der Nutzer weiß, wie es weitergeht
- Keine erfundenen Informationen oder vorgetäuschten Aktionen

FAIL-Kriterien (eines reicht):
- Antwort geht am Thema vorbei
- Antwort widerspricht sich selbst
- Agent behauptet eine Aktion (z. B. Erstattung), die nicht stattfand
- Antwort endet ohne klaren nächsten Schritt oder Abschluss`,
  },
];

// ── Grading logic ──

function createModel(settings: AppSettings) {
  if (settings.provider === 'openai') {
    const openai = createOpenAI({ apiKey: settings.openaiApiKey });
    return openai(settings.modelId);
  } else {
    const anthropic = createAnthropic({ apiKey: settings.anthropicApiKey });
    return anthropic(settings.modelId);
  }
}

const verdictSchema = z.object({
  pass: z.boolean().describe('true = PASS, false = FAIL'),
  reasoning: z
    .string()
    .describe('1-2 Sätze Begründung, die sich auf die Rubric-Kriterien beziehen'),
});

async function gradeOne(
  rubric: Rubric,
  userMessage: string,
  agentResponse: string,
  settings: AppSettings
): Promise<LlmGraderResult> {
  const model = createModel(settings);

  const { object } = await generateObject({
    model,
    schema: verdictSchema,
    system: rubric.systemPrompt,
    prompt: `NUTZERANFRAGE:\n${userMessage}\n\nAGENT-ANTWORT:\n${agentResponse}\n\nBewerte die Agent-Antwort anhand der Rubric. Antworte mit pass (true/false) und einer kurzen Begründung.`,
  });

  return {
    rubricId: rubric.id,
    pass: object.pass,
    reasoning: object.reasoning,
  };
}

export function getRubricsForCategory(category: EvalCategory): Rubric[] {
  return LLM_RUBRICS.filter((r) => r.appliesTo.includes(category));
}

export async function gradeWithLlm(
  category: EvalCategory,
  userMessage: string,
  agentResponse: string,
  settings: AppSettings
): Promise<LlmGraderResult[]> {
  const rubrics = getRubricsForCategory(category);
  if (rubrics.length === 0) return [];

  const results = await Promise.all(
    rubrics.map((r) => gradeOne(r, userMessage, agentResponse, settings))
  );

  return results;
}

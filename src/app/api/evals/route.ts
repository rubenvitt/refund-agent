import { NextRequest, NextResponse } from 'next/server';
import { runWorkflow } from '@/lib/workflow-engine';
import { scoreEvalCase } from '@/lib/eval-runner';
import { createSeedState } from '@/lib/seed-data';
import type { EvalCase, EvalResult, AppSettings, PromptConfig, ToolCatalog } from '@/lib/types';

type EvalRequestBody = {
  cases: EvalCase[];
  settings: AppSettings;
  promptConfig: PromptConfig;
  toolCatalog: ToolCatalog;
};

export async function POST(request: NextRequest) {
  try {
    const body: EvalRequestBody = await request.json();

    const apiKey =
      body.settings.provider === 'openai'
        ? body.settings.openaiApiKey
        : body.settings.anthropicApiKey;

    if (!apiKey) {
      return NextResponse.json(
        { error: `API key not configured for ${body.settings.provider}` },
        { status: 400 },
      );
    }

    const results: EvalResult[] = [];

    for (const evalCase of body.cases) {
      const originalState = createSeedState();
      const start = Date.now();

      try {
        const result = await runWorkflow({
          userMessage: evalCase.userMessage,
          conversationHistory: [],
          settings: body.settings,
          promptConfig: body.promptConfig,
          toolCatalog: body.toolCatalog,
          demoState: originalState,
          pendingApproval: evalCase.expectations.destructiveSideEffectAllowed
            ? { toolCallId: 'auto-approve', approved: true }
            : null,
        });

        const scored = scoreEvalCase(
          evalCase,
          result.trace,
          originalState,
          result.updatedState,
        );
        scored.durationMs = Date.now() - start;
        results.push(scored);
      } catch (error) {
        results.push({
          caseId: evalCase.id,
          passed: false,
          actualRoute: null,
          actualTools: [],
          scores: {
            routeMatch: false,
            requiredToolsCalled: false,
            forbiddenToolsAvoided: true,
            approvalCorrect: false,
            sideEffectCorrect: false,
            mismatchDetected: false,
          },
          mismatchReason: `Error: ${error instanceof Error ? error.message : String(error)}`,
          trace: {
            id: crypto.randomUUID(),
            startedAt: new Date(start).toISOString(),
            completedAt: new Date().toISOString(),
            userMessage: evalCase.userMessage,
            route: null,
            entries: [],
            toolCalls: [],
            mismatches: [],
            finalAnswer: null,
            stateChanges: [],
          },
          durationMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Evals API error:', error instanceof Error ? error.message : 'Unknown');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

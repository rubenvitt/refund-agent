'use client';

import { useCallback, useState } from 'react';
import { useAppState, type ChatMessage } from './store';
import type { EvalCase, EvalResult, PromptConfig } from './types';
import { evalCases as defaultEvalCases } from './eval-cases';
import { runWorkflow } from './workflow-engine';
import { scoreEvalCase } from './eval-runner';
import { createSeedState } from './seed-data';
import { gradeWithLlm } from './llm-grader';
import { optimizePrompts, type OptimizationResult } from './prompt-optimizer';
import { createEmptyLedger } from './idempotency';

export function useChat() {
  const { state, dispatch } = useAppState();
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(
    async (content: string) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
      };
      dispatch({ type: 'ADD_CHAT_MESSAGE', payload: userMsg });
      dispatch({ type: 'SET_ERROR', payload: null });
      setIsLoading(true);

      try {
        const apiKey =
          state.settings.provider === 'openai'
            ? state.settings.openaiApiKey
            : state.settings.anthropicApiKey;

        if (!apiKey) {
          throw new Error(`API key not configured for ${state.settings.provider}`);
        }

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
          session: state.session,
        });

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.finalAnswer,
        };
        dispatch({ type: 'ADD_CHAT_MESSAGE', payload: assistantMsg });
        dispatch({ type: 'ADD_TRACE', payload: result.trace });
        dispatch({ type: 'UPDATE_DEMO_STATE', payload: result.updatedState });
        dispatch({ type: 'UPDATE_LEDGER', payload: result.updatedLedger });
        if (result.auditEntries.length > 0) {
          dispatch({ type: 'ADD_AUDIT_ENTRIES', payload: result.auditEntries });
        }

        if (result.approvalRequest) {
          dispatch({ type: 'SET_APPROVAL_REQUEST', payload: result.approvalRequest });
        }
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsLoading(false);
      }
    },
    [state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, state.toolCallLedger, state.session, dispatch],
  );

  const resetChat = useCallback(() => {
    dispatch({ type: 'SET_CHAT_MESSAGES', payload: [] });
    dispatch({ type: 'SET_APPROVAL_REQUEST', payload: null });
    dispatch({ type: 'SET_ERROR', payload: null });
  }, [dispatch]);

  return { sendMessage, resetChat, isLoading, error: state.error };
}

export function useApproval() {
  const { state, dispatch } = useAppState();
  const [isLoading, setIsLoading] = useState(false);

  const respond = useCallback(
    async (approved: boolean) => {
      if (!state.approvalRequest) return;
      setIsLoading(true);
      dispatch({ type: 'SET_ERROR', payload: null });

      try {
        const lastUserMessage =
          state.chatMessages.filter((m) => m.role === 'user').pop()?.content ?? '';

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
          session: state.session,
        });

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.finalAnswer,
        };
        dispatch({ type: 'ADD_CHAT_MESSAGE', payload: assistantMsg });
        dispatch({ type: 'ADD_TRACE', payload: result.trace });
        dispatch({ type: 'UPDATE_DEMO_STATE', payload: result.updatedState });
        dispatch({ type: 'UPDATE_LEDGER', payload: result.updatedLedger });
        if (result.auditEntries.length > 0) {
          dispatch({ type: 'ADD_AUDIT_ENTRIES', payload: result.auditEntries });
        }
        dispatch({ type: 'SET_APPROVAL_REQUEST', payload: result.approvalRequest ?? null });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsLoading(false);
      }
    },
    [state.approvalRequest, state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, state.toolCallLedger, state.session, dispatch],
  );

  return {
    approve: () => respond(true),
    deny: () => respond(false),
    isLoading,
    pendingApproval: state.approvalRequest,
  };
}

export function useEvalRunner() {
  const { state, dispatch } = useAppState();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const runCases = useCallback(
    async (cases: EvalCase[]) => {
      setIsRunning(true);
      setProgress({ current: 0, total: cases.length });
      dispatch({ type: 'SET_ERROR', payload: null });
      dispatch({ type: 'SET_EVAL_RESULTS', payload: [] });

      try {
        const apiKey =
          state.settings.provider === 'openai'
            ? state.settings.openaiApiKey
            : state.settings.anthropicApiKey;

        if (!apiKey) {
          throw new Error(`API key not configured for ${state.settings.provider}`);
        }

        const results: EvalResult[] = [];

        for (const evalCase of cases) {
          const originalState = createSeedState();
          const start = Date.now();

          try {
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
              session: null,
            });

            const scored = scoreEvalCase(
              evalCase,
              result.trace,
              originalState,
              result.updatedState,
            );

            // LLM-based grading (runs in parallel per rubric)
            if (result.finalAnswer) {
              try {
                scored.llmScores = await gradeWithLlm(
                  evalCase.category,
                  evalCase.userMessage,
                  result.finalAnswer,
                  state.settings,
                );
              } catch {
                // LLM grading is best-effort — don't fail the eval
                scored.llmScores = [];
              }
            }

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
                sequenceCorrect: false,
                noRedundantCalls: true,
                efficientPath: true,
                approvalCorrect: false,
                sideEffectCorrect: false,
                mismatchDetected: false,
                auditEntryPresent: true,
                requestIdConsistent: true,
                policyGateCorrect: true,
                idempotencyRespected: true,
                bolaEnforced: true,
                bflaEnforced: true,
              },
              mismatchReason: `Error: ${error instanceof Error ? error.message : String(error)}`,
              trace: {
                id: crypto.randomUUID(),
                requestId: crypto.randomUUID(),
                startedAt: new Date(start).toISOString(),
                completedAt: new Date().toISOString(),
                userMessage: evalCase.userMessage,
                route: null,
                entries: [],
                toolCalls: [],
                mismatches: [],
                finalAnswer: null,
                stateChanges: [],
                auditEntryIds: [],
              },
              durationMs: Date.now() - start,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          setProgress({ current: results.length, total: cases.length });
        }

        dispatch({ type: 'SET_EVAL_RESULTS', payload: results });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsRunning(false);
      }
    },
    [state.settings, state.promptConfig, state.toolCatalog, dispatch],
  );

  const runAll = useCallback(() => runCases(defaultEvalCases), [runCases]);

  const runByCategory = useCallback(
    (category: EvalCase['category']) => {
      const filtered = defaultEvalCases.filter((ec) => ec.category === category);
      if (filtered.length > 0) runCases(filtered);
    },
    [runCases],
  );

  const runSingle = useCallback(
    (caseId: string) => {
      const c = defaultEvalCases.find((ec) => ec.id === caseId);
      if (c) runCases([c]);
    },
    [runCases],
  );

  return { runAll, runByCategory, runSingle, isRunning, progress, results: state.evalResults };
}

export function usePromptOptimizer() {
  const { state, dispatch } = useAppState();
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const optimize = useCallback(async () => {
    setIsOptimizing(true);
    setError(null);
    setResult(null);

    try {
      const apiKey =
        state.settings.provider === 'openai'
          ? state.settings.openaiApiKey
          : state.settings.anthropicApiKey;

      if (!apiKey) {
        throw new Error(`API key not configured for ${state.settings.provider}`);
      }

      const optimized = await optimizePrompts(
        state.promptConfig,
        state.evalResults,
        defaultEvalCases,
        state.settings,
      );

      setResult(optimized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed');
    } finally {
      setIsOptimizing(false);
    }
  }, [state.settings, state.promptConfig, state.evalResults]);

  const apply = useCallback(() => {
    if (!result) return;
    dispatch({ type: 'UPDATE_PROMPT_CONFIG', payload: result.prompts });
    setResult(null);
  }, [result, dispatch]);

  const dismiss = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { optimize, apply, dismiss, isOptimizing, result, error };
}

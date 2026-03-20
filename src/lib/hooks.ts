'use client';

import { useCallback, useState } from 'react';
import { useAppState, type ChatMessage } from './store';
import type { EvalCase, EvalResult, ChatResponseData } from './types';
import { evalCases as defaultEvalCases } from './eval-cases';

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
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...state.chatMessages, userMsg].map((m) => ({
              role: m.role,
              content: m.content,
            })),
            settings: state.settings,
            promptConfig: state.promptConfig,
            toolCatalog: state.toolCatalog,
            demoState: state.demoState,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data: ChatResponseData = await res.json();

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.message,
        };
        dispatch({ type: 'ADD_CHAT_MESSAGE', payload: assistantMsg });
        dispatch({ type: 'ADD_TRACE', payload: data.trace });
        dispatch({ type: 'UPDATE_DEMO_STATE', payload: data.updatedState });

        if (data.approvalRequest) {
          dispatch({ type: 'SET_APPROVAL_REQUEST', payload: data.approvalRequest });
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
    [state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, dispatch],
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
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: state.chatMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            settings: state.settings,
            promptConfig: state.promptConfig,
            toolCatalog: state.toolCatalog,
            demoState: state.demoState,
            pendingApproval: {
              toolCallId: state.approvalRequest.toolCallId,
              approved,
            },
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data: ChatResponseData = await res.json();

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.message,
        };
        dispatch({ type: 'ADD_CHAT_MESSAGE', payload: assistantMsg });
        dispatch({ type: 'ADD_TRACE', payload: data.trace });
        dispatch({ type: 'UPDATE_DEMO_STATE', payload: data.updatedState });
        dispatch({ type: 'SET_APPROVAL_REQUEST', payload: data.approvalRequest ?? null });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsLoading(false);
      }
    },
    [state.approvalRequest, state.chatMessages, state.settings, state.promptConfig, state.toolCatalog, state.demoState, dispatch],
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
        const res = await fetch('/api/evals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cases,
            settings: state.settings,
            promptConfig: state.promptConfig,
            toolCatalog: state.toolCatalog,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data: { results: EvalResult[] } = await res.json();
        dispatch({ type: 'SET_EVAL_RESULTS', payload: data.results });
        setProgress({ current: cases.length, total: cases.length });
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

  const runSingle = useCallback(
    (caseId: string) => {
      const c = defaultEvalCases.find((ec) => ec.id === caseId);
      if (c) runCases([c]);
    },
    [runCases],
  );

  return { runAll, runSingle, isRunning, progress, results: state.evalResults };
}

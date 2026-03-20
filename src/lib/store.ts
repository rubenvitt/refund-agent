'use client';

import React, { createContext, useContext, useReducer, useEffect, useState } from 'react';
import type {
  AppSettings,
  DemoState,
  PromptConfig,
  ToolCatalog,
  RunTrace,
  EvalResult,
  ApprovalRequest,
} from './types';
import { createSeedState } from './seed-data';
import { defaultPromptConfig, defaultToolCatalog } from './default-prompts';

// ── Chat Message ──

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

// ── State Shape ──

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
};

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  modelId: 'gpt-5.4-nano',
  openaiApiKey: '',
  anthropicApiKey: '',
};

function getInitialState(): AppState {
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
  };
}

// ── Actions ──

export type AppAction =
  | { type: 'UPDATE_SETTINGS'; payload: Partial<AppSettings> }
  | { type: 'UPDATE_DEMO_STATE'; payload: DemoState }
  | { type: 'UPDATE_PROMPT_CONFIG'; payload: Partial<PromptConfig> }
  | { type: 'UPDATE_TOOL_CATALOG'; payload: ToolCatalog }
  | { type: 'ADD_TRACE'; payload: RunTrace }
  | { type: 'SET_TRACES'; payload: RunTrace[] }
  | { type: 'SET_EVAL_RESULTS'; payload: EvalResult[] }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_APPROVAL_REQUEST'; payload: ApprovalRequest | null }
  | { type: 'ADD_CHAT_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_CHAT_MESSAGES'; payload: ChatMessage[] }
  | { type: 'RESET_DEMO_STATE' }
  | { type: 'RESET_PROMPT_CONFIG' }
  | { type: 'RESET_TOOL_CATALOG' }
  | { type: 'RESET_ALL' };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };
    case 'UPDATE_DEMO_STATE':
      return { ...state, demoState: action.payload };
    case 'UPDATE_PROMPT_CONFIG':
      return { ...state, promptConfig: { ...state.promptConfig, ...action.payload } };
    case 'UPDATE_TOOL_CATALOG':
      return { ...state, toolCatalog: action.payload };
    case 'ADD_TRACE':
      return { ...state, traces: [action.payload, ...state.traces] };
    case 'SET_TRACES':
      return { ...state, traces: action.payload };
    case 'SET_EVAL_RESULTS':
      return { ...state, evalResults: action.payload };
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_APPROVAL_REQUEST':
      return { ...state, approvalRequest: action.payload };
    case 'ADD_CHAT_MESSAGE':
      return { ...state, chatMessages: [...state.chatMessages, action.payload] };
    case 'SET_CHAT_MESSAGES':
      return { ...state, chatMessages: action.payload };
    case 'RESET_DEMO_STATE':
      return { ...state, demoState: createSeedState() };
    case 'RESET_PROMPT_CONFIG':
      return { ...state, promptConfig: defaultPromptConfig };
    case 'RESET_TOOL_CATALOG':
      return { ...state, toolCatalog: defaultToolCatalog };
    case 'RESET_ALL':
      return getInitialState();
    default:
      return state;
  }
}

// ── Context ──

type AppContextValue = {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
};

const AppContext = createContext<AppContextValue | null>(null);

// ── localStorage helpers ──

const LS_KEY = 'support-agent-lab';

function loadFromLocalStorage(): Partial<AppState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToLocalStorage(state: AppState) {
  if (typeof window === 'undefined') return;
  try {
    const toSave = {
      settings: state.settings,
      demoState: state.demoState,
      promptConfig: state.promptConfig,
      toolCatalog: state.toolCatalog,
      traces: state.traces.slice(0, 50),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  } catch {
    // quota exceeded or other error – silently ignore
  }
}

// ── Provider ──

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage AFTER first render to avoid hydration mismatch
  useEffect(() => {
    const saved = loadFromLocalStorage();
    if (saved) {
      if (saved.settings) dispatch({ type: 'UPDATE_SETTINGS', payload: saved.settings });
      if (saved.demoState) dispatch({ type: 'UPDATE_DEMO_STATE', payload: saved.demoState });
      if (saved.promptConfig) dispatch({ type: 'UPDATE_PROMPT_CONFIG', payload: saved.promptConfig });
      if (saved.toolCatalog) dispatch({ type: 'UPDATE_TOOL_CATALOG', payload: saved.toolCatalog });
      if (saved.traces) dispatch({ type: 'SET_TRACES', payload: saved.traces as RunTrace[] });
    }
    setHydrated(true);
  }, []);

  // Persist to localStorage on changes (only after hydration to avoid overwriting with defaults)
  useEffect(() => {
    if (!hydrated) return;
    saveToLocalStorage(state);
  }, [hydrated, state.settings, state.demoState, state.promptConfig, state.toolCatalog, state.traces]);

  return React.createElement(
    AppContext.Provider,
    { value: { state, dispatch } },
    children,
  );
}

// ── Hooks ──

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

export function useSettings() {
  const { state, dispatch } = useAppState();
  return {
    settings: state.settings,
    updateSettings: (patch: Partial<AppSettings>) =>
      dispatch({ type: 'UPDATE_SETTINGS', payload: patch }),
  };
}

export function useDemoState() {
  const { state, dispatch } = useAppState();
  return {
    demoState: state.demoState,
    updateDemoState: (s: DemoState) => dispatch({ type: 'UPDATE_DEMO_STATE', payload: s }),
    resetDemoState: () => dispatch({ type: 'RESET_DEMO_STATE' }),
  };
}

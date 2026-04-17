'use client';

import React, { createContext, useContext, useReducer, useEffect, useState } from 'react';
import type {
  AppSettings,
  DemoState,
  PromptConfig,
  ToolCatalog,
  RunTrace,
  EvalResult,
  HumanReview,
  ApprovalRequest,
  StructuredAuditEntry,
  ToolCallLedger,
  UserSession,
} from './types';
import { createSeedState } from './seed-data';
import { createEmptyLedger } from './idempotency';
import { defaultPromptConfig, defaultToolCatalog } from './default-prompts';
import { createEmptyRolloutState, createRolloutAuditEntry, createSnapshot } from './rollout';
import type { ConfigSnapshot, RolloutAuditEntry, RolloutState } from './types';

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
  toolCallLedger: ToolCallLedger;
  session: UserSession | null;
  rollout: RolloutState;
};

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  modelId: 'gpt-5.4-nano',
  openaiApiKey: '',
  anthropicApiKey: '',
};

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

// ── Actions ──

export type AppAction =
  | { type: 'UPDATE_SETTINGS'; payload: Partial<AppSettings> }
  | { type: 'UPDATE_DEMO_STATE'; payload: DemoState }
  | { type: 'UPDATE_PROMPT_CONFIG'; payload: Partial<PromptConfig> }
  | { type: 'UPDATE_TOOL_CATALOG'; payload: ToolCatalog }
  | { type: 'ADD_TRACE'; payload: RunTrace }
  | { type: 'SET_TRACES'; payload: RunTrace[] }
  | { type: 'SET_EVAL_RESULTS'; payload: EvalResult[] }
  | { type: 'SET_HUMAN_REVIEW'; payload: HumanReview }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_APPROVAL_REQUEST'; payload: ApprovalRequest | null }
  | { type: 'ADD_CHAT_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_CHAT_MESSAGES'; payload: ChatMessage[] }
  | { type: 'RESET_DEMO_STATE' }
  | { type: 'RESET_PROMPT_CONFIG' }
  | { type: 'RESET_TOOL_CATALOG' }
  | { type: 'RESET_ALL' }
  | { type: 'ADD_AUDIT_ENTRIES'; payload: StructuredAuditEntry[] }
  | { type: 'CLEAR_AUDIT_LOG' }
  | { type: 'UPDATE_LEDGER'; payload: ToolCallLedger }
  | { type: 'CLEAR_LEDGER' }
  | { type: 'SET_SESSION'; payload: UserSession | null }
  | { type: 'ADD_ROLLOUT_SNAPSHOT'; payload: ConfigSnapshot }
  | { type: 'DELETE_ROLLOUT_SNAPSHOT'; payload: string }
  | { type: 'SET_ROLLOUT_CHAMPION'; payload: string | null }
  | { type: 'SET_ROLLOUT_CHALLENGER'; payload: string | null }
  | { type: 'APPEND_ROLLOUT_AUDIT'; payload: RolloutAuditEntry }
  | { type: 'RESET_ROLLOUT' };

export function reducer(state: AppState, action: AppAction): AppState {
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
    case 'SET_HUMAN_REVIEW':
      return {
        ...state,
        evalResults: state.evalResults.map((r) =>
          r.caseId === action.payload.caseId
            ? { ...r, humanReview: action.payload }
            : r
        ),
      };
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
      return { ...state, demoState: createSeedState(), toolCallLedger: createEmptyLedger() };
    case 'RESET_PROMPT_CONFIG':
      return { ...state, promptConfig: defaultPromptConfig };
    case 'RESET_TOOL_CATALOG':
      return { ...state, toolCatalog: defaultToolCatalog };
    case 'RESET_ALL':
      return getInitialState();
    case 'ADD_AUDIT_ENTRIES':
      return {
        ...state,
        demoState: {
          ...state.demoState,
          structuredAuditLog: [
            ...state.demoState.structuredAuditLog,
            ...action.payload,
          ],
        },
      };
    case 'CLEAR_AUDIT_LOG':
      return {
        ...state,
        demoState: {
          ...state.demoState,
          structuredAuditLog: [],
        },
      };
    case 'UPDATE_LEDGER':
      return { ...state, toolCallLedger: action.payload };
    case 'CLEAR_LEDGER':
      return { ...state, toolCallLedger: createEmptyLedger() };
    case 'SET_SESSION':
      return { ...state, session: action.payload };
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
const LS_KEY_AUDIT = 'support-agent-lab:audit';
const LS_KEY_LEDGER = 'support-agent-lab:ledger';
const LS_KEY_ROLLOUT = 'support-agent-lab:rollout';
const MAX_AUDIT_ENTRIES = 200;
const MAX_ROLLOUT_AUDIT_ENTRIES = 200;

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
    const { structuredAuditLog: _audit, ...demoStateWithoutAudit } = state.demoState;
    const toSave = {
      settings: state.settings,
      demoState: demoStateWithoutAudit,
      promptConfig: state.promptConfig,
      toolCatalog: state.toolCatalog,
      traces: state.traces.slice(0, 50),
      session: state.session,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  } catch {
    // quota exceeded or other error – silently ignore
  }
}

function saveAuditLog(entries: StructuredAuditEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = entries.slice(-MAX_AUDIT_ENTRIES);
    localStorage.setItem(LS_KEY_AUDIT, JSON.stringify(trimmed));
  } catch {
    // quota exceeded — silently ignore
  }
}

function loadAuditLog(): StructuredAuditEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY_AUDIT);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveLedger(ledger: ToolCallLedger) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY_LEDGER, JSON.stringify(ledger));
  } catch {
    // quota exceeded — silently ignore
  }
}

function loadLedger(): ToolCallLedger | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY_LEDGER);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveRollout(rollout: RolloutState) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed: RolloutState = {
      ...rollout,
      auditLog: rollout.auditLog.slice(-MAX_ROLLOUT_AUDIT_ENTRIES),
    };
    localStorage.setItem(LS_KEY_ROLLOUT, JSON.stringify(trimmed));
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

// ── Provider ──

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage AFTER first render to avoid hydration mismatch
  useEffect(() => {
    const saved = loadFromLocalStorage();
    if (saved) {
      if (saved.settings) dispatch({ type: 'UPDATE_SETTINGS', payload: saved.settings });
      if (saved.demoState) dispatch({ type: 'UPDATE_DEMO_STATE', payload: {
        ...saved.demoState,
        structuredAuditLog: [],
      } });
      if (saved.promptConfig) dispatch({ type: 'UPDATE_PROMPT_CONFIG', payload: saved.promptConfig });
      if (saved.toolCatalog) dispatch({ type: 'UPDATE_TOOL_CATALOG', payload: saved.toolCatalog });
      if (saved.traces) dispatch({ type: 'SET_TRACES', payload: saved.traces as RunTrace[] });
      if ((saved as Record<string, unknown>).session) {
        dispatch({ type: 'SET_SESSION', payload: (saved as Record<string, unknown>).session as UserSession });
      }
    }
    const auditLog = loadAuditLog();
    if (auditLog.length > 0) {
      dispatch({ type: 'ADD_AUDIT_ENTRIES', payload: auditLog });
    }
    const savedLedger = loadLedger();
    if (savedLedger) {
      dispatch({ type: 'UPDATE_LEDGER', payload: savedLedger });
    }
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
    setHydrated(true);
  }, []);

  // Persist to localStorage on changes (only after hydration to avoid overwriting with defaults)
  useEffect(() => {
    if (!hydrated) return;
    saveToLocalStorage(state);
  }, [hydrated, state.settings, state.demoState, state.promptConfig, state.toolCatalog, state.traces]);

  useEffect(() => {
    if (!hydrated) return;
    saveAuditLog(state.demoState.structuredAuditLog);
  }, [hydrated, state.demoState.structuredAuditLog]);

  useEffect(() => {
    if (!hydrated) return;
    saveLedger(state.toolCallLedger);
  }, [hydrated, state.toolCallLedger]);

  useEffect(() => {
    if (!hydrated) return;
    saveRollout(state.rollout);
  }, [hydrated, state.rollout]);

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

export function useSession() {
  const { state, dispatch } = useAppState();
  return {
    session: state.session,
    setSession: (session: UserSession | null) =>
      dispatch({ type: 'SET_SESSION', payload: session }),
  };
}

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

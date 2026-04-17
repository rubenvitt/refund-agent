import { describe, it, expect } from 'vitest';
import { reducer, getInitialState, type AppState, type AppAction } from '../store';
import { createSnapshot } from '../rollout';
import type { PromptConfig, ToolCatalog } from '../types';

const promptConfig: PromptConfig = {
  orchestratorInstructions: 'o',
  refundAgentInstructions: 'r',
  lookupAgentInstructions: 'l',
  accountFaqAgentInstructions: 'a',
};
const toolCatalog: ToolCatalog = { tools: [] };

function initial(): AppState {
  return getInitialState();
}

describe('rollout reducer', () => {
  it('ADD_ROLLOUT_SNAPSHOT appends the snapshot', () => {
    const snap = createSnapshot('Champion v1', promptConfig, toolCatalog, '');
    const next = reducer(initial(), {
      type: 'ADD_ROLLOUT_SNAPSHOT',
      payload: snap,
    } satisfies AppAction);
    expect(next.rollout.snapshots).toHaveLength(1);
    expect(next.rollout.snapshots[0].id).toBe(snap.id);
  });

  it('SET_ROLLOUT_CHAMPION updates the championId', () => {
    const snap = createSnapshot('Champion v1', promptConfig, toolCatalog, '');
    const afterAdd = reducer(initial(), { type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
    const next = reducer(afterAdd, { type: 'SET_ROLLOUT_CHAMPION', payload: snap.id });
    expect(next.rollout.championId).toBe(snap.id);
  });

  it('SET_ROLLOUT_CHALLENGER updates the challengerId; null clears it', () => {
    const snap = createSnapshot('Challenger v1', promptConfig, toolCatalog, '');
    const afterAdd = reducer(initial(), { type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
    const set = reducer(afterAdd, { type: 'SET_ROLLOUT_CHALLENGER', payload: snap.id });
    expect(set.rollout.challengerId).toBe(snap.id);
    const cleared = reducer(set, { type: 'SET_ROLLOUT_CHALLENGER', payload: null });
    expect(cleared.rollout.challengerId).toBeNull();
  });

  it('DELETE_ROLLOUT_SNAPSHOT removes it and clears references if champion/challenger', () => {
    const snap = createSnapshot('doomed', promptConfig, toolCatalog, '');
    let s = reducer(initial(), { type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
    s = reducer(s, { type: 'SET_ROLLOUT_CHAMPION', payload: snap.id });
    s = reducer(s, { type: 'SET_ROLLOUT_CHALLENGER', payload: snap.id });
    s = reducer(s, { type: 'DELETE_ROLLOUT_SNAPSHOT', payload: snap.id });
    expect(s.rollout.snapshots).toHaveLength(0);
    expect(s.rollout.championId).toBeNull();
    expect(s.rollout.challengerId).toBeNull();
  });

  it('APPEND_ROLLOUT_AUDIT appends entries in order', () => {
    const s1 = reducer(initial(), {
      type: 'APPEND_ROLLOUT_AUDIT',
      payload: {
        id: 'rla_1',
        timestamp: '2026-04-17T00:00:00.000Z',
        actor: { type: 'user' },
        action: 'snapshot_created',
        snapshotId: 'snp_1',
        details: {},
      },
    });
    const s2 = reducer(s1, {
      type: 'APPEND_ROLLOUT_AUDIT',
      payload: {
        id: 'rla_2',
        timestamp: '2026-04-17T00:00:01.000Z',
        actor: { type: 'user' },
        action: 'champion_set',
        snapshotId: 'snp_1',
        details: {},
      },
    });
    expect(s2.rollout.auditLog.map((e) => e.id)).toEqual(['rla_1', 'rla_2']);
  });

  it('RESET_ALL resets rollout state too', () => {
    const snap = createSnapshot('x', promptConfig, toolCatalog, '');
    let s = reducer(initial(), { type: 'ADD_ROLLOUT_SNAPSHOT', payload: snap });
    s = reducer(s, { type: 'SET_ROLLOUT_CHAMPION', payload: snap.id });
    s = reducer(s, { type: 'RESET_ALL' });
    expect(s.rollout.snapshots).toEqual([]);
    expect(s.rollout.championId).toBeNull();
  });
});

describe('getInitialState rollout slice', () => {
  it('includes an empty rollout state', () => {
    const s = getInitialState();
    expect(s.rollout.snapshots).toEqual([]);
    expect(s.rollout.championId).toBeNull();
    expect(s.rollout.challengerId).toBeNull();
    expect(s.rollout.canaryPercent).toBe(0);
    expect(s.rollout.killSwitchActive).toBe(false);
    expect(s.rollout.auditLog).toEqual([]);
  });
});

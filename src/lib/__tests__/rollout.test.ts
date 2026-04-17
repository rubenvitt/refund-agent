import { describe, it, expect } from 'vitest';
import {
  createSnapshot,
  createRolloutAuditEntry,
  createEmptyRolloutState,
} from '../rollout';
import type { PromptConfig, ToolCatalog } from '../types';

const samplePromptConfig: PromptConfig = {
  orchestratorInstructions: 'orchestrator',
  refundAgentInstructions: 'refund',
  lookupAgentInstructions: 'lookup',
  accountFaqAgentInstructions: 'account',
};

const sampleToolCatalog: ToolCatalog = {
  tools: [
    {
      name: 'lookup_order',
      description: 'look up an order',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: false,
      isDestructive: false,
    },
  ],
};

describe('createSnapshot', () => {
  it('returns a snapshot with an snp_-prefixed id and an ISO timestamp', () => {
    const snap = createSnapshot('Champion v1', samplePromptConfig, sampleToolCatalog, 'baseline');
    expect(snap.id.startsWith('snp_')).toBe(true);
    expect(() => new Date(snap.createdAt).toISOString()).not.toThrow();
    expect(snap.label).toBe('Champion v1');
    expect(snap.notes).toBe('baseline');
    expect(snap.promptConfig).toEqual(samplePromptConfig);
    expect(snap.toolCatalog).toEqual(sampleToolCatalog);
  });

  it('produces unique ids across calls', () => {
    const ids = new Set(
      Array.from({ length: 50 }, () =>
        createSnapshot('x', samplePromptConfig, sampleToolCatalog, '').id,
      ),
    );
    expect(ids.size).toBe(50);
  });

  it('deep-clones prompt and tool inputs so later mutations do not leak', () => {
    const prompt = { ...samplePromptConfig };
    const tools = { tools: [...sampleToolCatalog.tools] };
    const snap = createSnapshot('x', prompt, tools, '');
    prompt.orchestratorInstructions = 'mutated';
    tools.tools[0].description = 'mutated';
    expect(snap.promptConfig.orchestratorInstructions).toBe('orchestrator');
    expect(snap.toolCatalog.tools[0].description).toBe('look up an order');
  });
});

describe('createRolloutAuditEntry', () => {
  it('returns an entry with an rla_-prefixed id and captures inputs', () => {
    const entry = createRolloutAuditEntry({
      actor: { type: 'user' },
      action: 'snapshot_created',
      snapshotId: 'snp_abc',
      details: { label: 'Champion v1' },
    });
    expect(entry.id.startsWith('rla_')).toBe(true);
    expect(entry.actor).toEqual({ type: 'user' });
    expect(entry.action).toBe('snapshot_created');
    expect(entry.snapshotId).toBe('snp_abc');
    expect(entry.details).toEqual({ label: 'Champion v1' });
    expect(() => new Date(entry.timestamp).toISOString()).not.toThrow();
  });

  it('allows null snapshotId for global events', () => {
    const entry = createRolloutAuditEntry({
      actor: { type: 'system', component: 'rollout' },
      action: 'challenger_cleared',
      snapshotId: null,
      details: {},
    });
    expect(entry.snapshotId).toBeNull();
  });
});

describe('createEmptyRolloutState', () => {
  it('returns a zeroed state with empty arrays and defaults', () => {
    const state = createEmptyRolloutState();
    expect(state.snapshots).toEqual([]);
    expect(state.championId).toBeNull();
    expect(state.challengerId).toBeNull();
    expect(state.canaryPercent).toBe(0);
    expect(state.killSwitchActive).toBe(false);
    expect(state.auditLog).toEqual([]);
  });
});

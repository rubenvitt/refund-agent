import { describe, it, expect } from 'vitest';
import {
  createSnapshot,
  createRolloutAuditEntry,
  createEmptyRolloutState,
  hashToolDescriptions,
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
  it('returns a snapshot with an snp_-prefixed id, ISO timestamp, and passthrough of the provided hash', () => {
    const snap = createSnapshot(
      'Champion v1',
      samplePromptConfig,
      sampleToolCatalog,
      'baseline',
      'hash-xyz',
    );
    expect(snap.id.startsWith('snp_')).toBe(true);
    expect(() => new Date(snap.createdAt).toISOString()).not.toThrow();
    expect(snap.label).toBe('Champion v1');
    expect(snap.notes).toBe('baseline');
    expect(snap.promptConfig).toEqual(samplePromptConfig);
    expect(snap.toolCatalog).toEqual(sampleToolCatalog);
    expect(snap.toolDescriptionsHash).toBe('hash-xyz');
  });

  it('produces unique ids across calls', () => {
    const ids = new Set(
      Array.from(
        { length: 50 },
        () =>
          createSnapshot('x', samplePromptConfig, sampleToolCatalog, '', 'h').id,
      ),
    );
    expect(ids.size).toBe(50);
  });

  it('deep-clones prompt and tool inputs so later mutations do not leak', () => {
    const prompt = { ...samplePromptConfig };
    const tools = { tools: [...sampleToolCatalog.tools] };
    const snap = createSnapshot('x', prompt, tools, '', 'h');
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
    expect(state.shadowRunHistory).toEqual([]);
  });
});

describe('hashToolDescriptions', () => {
  it('produces a 64-char hex SHA-256', async () => {
    const hash = await hashToolDescriptions(sampleToolCatalog);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same hash for the same input', async () => {
    const a = await hashToolDescriptions(sampleToolCatalog);
    const b = await hashToolDescriptions(sampleToolCatalog);
    expect(a).toBe(b);
  });

  it('is stable under tool reordering', async () => {
    const sorted: ToolCatalog = {
      tools: [
        { ...sampleToolCatalog.tools[0], name: 'a_tool' },
        { ...sampleToolCatalog.tools[0], name: 'b_tool' },
      ],
    };
    const reversed: ToolCatalog = {
      tools: [...sorted.tools].reverse(),
    };
    expect(await hashToolDescriptions(sorted)).toBe(
      await hashToolDescriptions(reversed),
    );
  });

  it('changes when a tool description changes', async () => {
    const before = await hashToolDescriptions(sampleToolCatalog);
    const after = await hashToolDescriptions({
      tools: [
        {
          ...sampleToolCatalog.tools[0],
          description: 'look up an order (revised)',
        },
      ],
    });
    expect(before).not.toBe(after);
  });

  it('changes when a tool is added', async () => {
    const before = await hashToolDescriptions(sampleToolCatalog);
    const after = await hashToolDescriptions({
      tools: [
        ...sampleToolCatalog.tools,
        {
          name: 'refund_order',
          description: 'refund an order',
          parameters: { type: 'object', properties: {}, required: [] },
          requiresApproval: true,
          isDestructive: true,
        },
      ],
    });
    expect(before).not.toBe(after);
  });
});

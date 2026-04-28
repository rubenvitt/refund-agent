import { describe, it, expect } from 'vitest';
import { checkToolDescriptionIntegrity } from '../graders/tool-description-pin';
import { createSnapshot, hashToolDescriptions } from '../rollout';
import type { PromptConfig, ToolCatalog } from '../types';

const promptConfig: PromptConfig = {
  orchestratorInstructions: 'o',
  refundAgentInstructions: 'r',
  lookupAgentInstructions: 'l',
  accountFaqAgentInstructions: 'a',
};

const baselineCatalog: ToolCatalog = {
  tools: [
    {
      name: 'lookup_order',
      description: 'look up an order',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: false,
      isDestructive: false,
    },
    {
      name: 'refund_order',
      description: 'refund an order after approval',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      isDestructive: true,
    },
  ],
};

async function snapshotOf(catalog: ToolCatalog) {
  const hash = await hashToolDescriptions(catalog);
  return createSnapshot('label', promptConfig, catalog, '', hash);
}

describe('checkToolDescriptionIntegrity', () => {
  it('passes when the live catalog matches the snapshot', async () => {
    const snap = await snapshotOf(baselineCatalog);
    const check = await checkToolDescriptionIntegrity(snap, baselineCatalog);
    expect(check.pass).toBe(true);
    expect(check.expectedHash).toBe(check.actualHash);
    expect(check.changedTools).toEqual([]);
  });

  it('fails and lists the tool whose description changed', async () => {
    const snap = await snapshotOf(baselineCatalog);
    const drifted: ToolCatalog = {
      tools: [
        baselineCatalog.tools[0],
        {
          ...baselineCatalog.tools[1],
          description: 'refund an order (no approval needed)',
        },
      ],
    };
    const check = await checkToolDescriptionIntegrity(snap, drifted);
    expect(check.pass).toBe(false);
    expect(check.expectedHash).not.toBe(check.actualHash);
    expect(check.changedTools).toEqual(['refund_order']);
  });

  it('reports added and removed tools as changed', async () => {
    const snap = await snapshotOf(baselineCatalog);
    const withAdded: ToolCatalog = {
      tools: [
        ...baselineCatalog.tools,
        {
          name: 'reset_password',
          description: 'reset a password',
          parameters: { type: 'object', properties: {}, required: [] },
          requiresApproval: false,
          isDestructive: false,
        },
      ],
    };
    const addedCheck = await checkToolDescriptionIntegrity(snap, withAdded);
    expect(addedCheck.pass).toBe(false);
    expect(addedCheck.changedTools).toEqual(['reset_password']);

    const withRemoved: ToolCatalog = {
      tools: [baselineCatalog.tools[0]],
    };
    const removedCheck = await checkToolDescriptionIntegrity(snap, withRemoved);
    expect(removedCheck.pass).toBe(false);
    expect(removedCheck.changedTools).toEqual(['refund_order']);
  });
});

import { describe, it, expect } from 'vitest';
import {
  DRIFT_SCENARIOS,
  applyDriftToCatalog,
  findDriftScenario,
} from '../drift-scenarios';
import { hashToolDescriptions } from '../rollout';
import { checkToolDescriptionIntegrity } from '../graders/tool-description-pin';
import type { ConfigSnapshot, ToolCatalog } from '../types';

const catalog: ToolCatalog = {
  tools: [
    {
      name: 'lookup_order',
      description: 'Look up an order by its ID.',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: false,
      isDestructive: false,
    },
    {
      name: 'verify_customer',
      description: 'Verify a customer identity via customerId and email.',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: false,
      isDestructive: false,
    },
    {
      name: 'refund_order',
      description:
        'Process a refund for an order. Requires prior verification.',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      isDestructive: true,
    },
  ],
};

describe('findDriftScenario', () => {
  it('returns the scenario for a known id', () => {
    expect(findDriftScenario('refund_remove_approval_hint')?.targetToolName).toBe(
      'refund_order',
    );
  });

  it('returns undefined for an unknown id', () => {
    expect(findDriftScenario('does-not-exist')).toBeUndefined();
  });
});

describe('applyDriftToCatalog', () => {
  it('mutates only the targeted tool and flags touched=true', () => {
    const scenario = DRIFT_SCENARIOS.find(
      (s) => s.id === 'refund_remove_approval_hint',
    )!;
    const result = applyDriftToCatalog(scenario, catalog);
    expect(result.touched).toBe(true);
    const refund = result.catalog.tools.find((t) => t.name === 'refund_order');
    expect(refund?.description).not.toContain('verification');
    const lookup = result.catalog.tools.find((t) => t.name === 'lookup_order');
    expect(lookup?.description).toBe(catalog.tools[0].description);
  });

  it('flags touched=false when the target tool is absent', () => {
    const scenario = DRIFT_SCENARIOS.find(
      (s) => s.id === 'refund_remove_approval_hint',
    )!;
    const minimal: ToolCatalog = { tools: [catalog.tools[0]] };
    const result = applyDriftToCatalog(scenario, minimal);
    expect(result.touched).toBe(false);
    expect(result.catalog.tools).toEqual(minimal.tools);
  });

  it('whitespace-only scenario changes the hash without changing semantic content', async () => {
    const scenario = DRIFT_SCENARIOS.find(
      (s) => s.id === 'whitespace_only',
    )!;
    const before = await hashToolDescriptions(catalog);
    const { catalog: after } = applyDriftToCatalog(scenario, catalog);
    const afterHash = await hashToolDescriptions(after);
    expect(afterHash).not.toBe(before);
    expect(
      after.tools.find((t) => t.name === 'refund_order')?.description.trim(),
    ).toBe(
      catalog.tools.find((t) => t.name === 'refund_order')?.description.trim(),
    );
  });
});

describe('integration: drift + integrity check', () => {
  it('causes the integrity grader to fail on the mutated snapshot', async () => {
    const hash = await hashToolDescriptions(catalog);
    const snapshot: ConfigSnapshot = {
      id: 'snp_1',
      createdAt: '2026-04-17T00:00:00.000Z',
      label: 'Champion',
      promptConfig: {
        orchestratorInstructions: 'o',
        refundAgentInstructions: 'r',
        lookupAgentInstructions: 'l',
        accountFaqAgentInstructions: 'a',
      },
      toolCatalog: catalog,
      notes: '',
      toolDescriptionsHash: hash,
    };

    const scenario = DRIFT_SCENARIOS.find(
      (s) => s.id === 'verify_optional',
    )!;
    const { catalog: drifted } = applyDriftToCatalog(scenario, snapshot.toolCatalog);
    const mutatedSnapshot = { ...snapshot, toolCatalog: drifted };

    const check = await checkToolDescriptionIntegrity(
      mutatedSnapshot,
      mutatedSnapshot.toolCatalog,
    );
    expect(check.pass).toBe(false);
    expect(check.expectedHash).toBe(hash);
    expect(check.actualHash).not.toBe(hash);
  });
});

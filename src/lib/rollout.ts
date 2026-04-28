import {
  DEFAULT_KILL_SWITCH_MESSAGE,
  type AuditActor,
  type CanaryPercent,
  type ConfigSnapshot,
  type PromptConfig,
  type RolloutAuditAction,
  type RolloutAuditEntry,
  type RolloutState,
  type RolloutVariant,
  type ToolCatalog,
} from './types';
import { generatePrefixedId } from './audit';
import { createDefaultGuardrailConfig } from './rollout-guardrails';

function canonicalizeToolDescriptions(catalog: ToolCatalog): string {
  return [...catalog.tools]
    .map((t) => ({ name: t.name, description: t.description }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `${t.name}:::${t.description}`)
    .join('\n');
}

export async function hashToolDescriptions(
  catalog: ToolCatalog,
): Promise<string> {
  const canonical = canonicalizeToolDescriptions(catalog);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function createSnapshot(
  label: string,
  promptConfig: PromptConfig,
  toolCatalog: ToolCatalog,
  notes: string,
  toolDescriptionsHash: string,
): ConfigSnapshot {
  return {
    id: generatePrefixedId('snp'),
    createdAt: new Date().toISOString(),
    label,
    promptConfig: structuredClone(promptConfig),
    toolCatalog: structuredClone(toolCatalog),
    notes,
    toolDescriptionsHash,
  };
}

export function createRolloutAuditEntry(input: {
  actor: AuditActor;
  action: RolloutAuditAction;
  snapshotId: string | null;
  details: Record<string, unknown>;
}): RolloutAuditEntry {
  return {
    id: generatePrefixedId('rla'),
    timestamp: new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    snapshotId: input.snapshotId,
    details: input.details,
  };
}

export function createEmptyRolloutState(): RolloutState {
  return {
    snapshots: [],
    championId: null,
    challengerId: null,
    canaryPercent: 0,
    killSwitchActive: false,
    killSwitchMessage: DEFAULT_KILL_SWITCH_MESSAGE,
    auditLog: [],
    shadowRunHistory: [],
    guardrailConfig: createDefaultGuardrailConfig(),
    samples: [],
    breachHistory: [],
  };
}

export type PickedVariant = {
  variant: RolloutVariant | null;
  snapshot: ConfigSnapshot | null;
};

export function pickVariant(options: {
  champion: ConfigSnapshot | null;
  challenger: ConfigSnapshot | null;
  canaryPercent: CanaryPercent;
  randomFn?: () => number;
}): PickedVariant {
  const { champion, challenger, canaryPercent } = options;
  const rand = options.randomFn ?? Math.random;

  if (!champion) {
    return { variant: null, snapshot: null };
  }
  if (!challenger || canaryPercent === 0) {
    return { variant: 'champion', snapshot: champion };
  }
  if (canaryPercent === 100) {
    return { variant: 'challenger', snapshot: challenger };
  }
  const roll = rand();
  return roll < canaryPercent / 100
    ? { variant: 'challenger', snapshot: challenger }
    : { variant: 'champion', snapshot: champion };
}

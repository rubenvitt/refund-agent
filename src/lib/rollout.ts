import type {
  AuditActor,
  ConfigSnapshot,
  PromptConfig,
  RolloutAuditAction,
  RolloutAuditEntry,
  RolloutState,
  ToolCatalog,
} from './types';
import { generatePrefixedId } from './audit';

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
    auditLog: [],
    shadowRunHistory: [],
  };
}

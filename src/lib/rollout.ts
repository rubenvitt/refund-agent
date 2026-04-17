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

export function createSnapshot(
  label: string,
  promptConfig: PromptConfig,
  toolCatalog: ToolCatalog,
  notes: string,
): ConfigSnapshot {
  return {
    id: generatePrefixedId('snp'),
    createdAt: new Date().toISOString(),
    label,
    promptConfig: structuredClone(promptConfig),
    toolCatalog: structuredClone(toolCatalog),
    notes,
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
  };
}

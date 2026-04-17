import type {
  AuditActor,
  ConfigSnapshot,
  PromptConfig,
  RolloutAuditAction,
  RolloutAuditEntry,
  RolloutState,
  ToolCatalog,
} from './types';

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateId(prefix: 'snp' | 'rla'): string {
  const ts = Date.now().toString().padStart(13, '0');
  return `${prefix}_${ts}${randomHex(4)}`;
}

export function createSnapshot(
  label: string,
  promptConfig: PromptConfig,
  toolCatalog: ToolCatalog,
  notes: string,
): ConfigSnapshot {
  return {
    id: generateId('snp'),
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
    id: generateId('rla'),
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

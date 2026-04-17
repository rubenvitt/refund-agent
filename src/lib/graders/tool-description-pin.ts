import { hashToolDescriptions } from '../rollout';
import type {
  ConfigSnapshot,
  ToolCatalog,
  ToolDescriptionIntegrityCheck,
} from '../types';

function listChangedTools(
  snapshot: ConfigSnapshot,
  current: ToolCatalog,
): string[] {
  const snapshotMap = new Map(
    snapshot.toolCatalog.tools.map((t) => [t.name, t.description]),
  );
  const currentMap = new Map(
    current.tools.map((t) => [t.name, t.description]),
  );

  const changed = new Set<string>();
  for (const [name, desc] of snapshotMap) {
    if (!currentMap.has(name) || currentMap.get(name) !== desc) {
      changed.add(name);
    }
  }
  for (const name of currentMap.keys()) {
    if (!snapshotMap.has(name)) changed.add(name);
  }
  return [...changed].sort();
}

export async function checkToolDescriptionIntegrity(
  snapshot: ConfigSnapshot,
  currentCatalog: ToolCatalog,
): Promise<ToolDescriptionIntegrityCheck> {
  const actualHash = await hashToolDescriptions(currentCatalog);
  const pass = actualHash === snapshot.toolDescriptionsHash;
  return {
    pass,
    expectedHash: snapshot.toolDescriptionsHash,
    actualHash,
    changedTools: pass ? [] : listChangedTools(snapshot, currentCatalog),
  };
}

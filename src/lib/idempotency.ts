// src/lib/idempotency.ts

import type {
  LedgerEntry,
  ToolCallLedger,
  IdempotencyCheckResult,
} from './types';

const DEFAULT_RETENTION_MS = 86_400_000; // 24 hours

/**
 * Map of tool name → list of semantic parameter names.
 * Only tools listed here generate idempotency keys.
 * Read-only tools (lookup_order, verify_customer, faq_search) return null → no check.
 */
const SEMANTIC_PARAMS: Record<string, string[]> = {
  refund_order: ['orderId'],
  reset_password: ['email'],
};

/**
 * Map of tool name → list of cosmetic parameter names.
 * These are excluded from idempotency key generation but stored for auditing.
 */
const COSMETIC_PARAMS: Record<string, string[]> = {
  refund_order: ['reason'],
};

/**
 * Normalize a parameter value for deterministic key generation.
 * Strings are lowercased and trimmed. Everything else is stringified.
 */
function normalizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.toLowerCase().trim();
  }
  return String(value);
}

/**
 * Generate a deterministic idempotency key from tool name + semantic params.
 * Returns null for read-only tools that don't need deduplication.
 *
 * Examples:
 *   refund_order({ orderId: "4711", reason: "damaged" }) → "refund_order:4711"
 *   reset_password({ email: "ALICE@EXAMPLE.COM" })       → "reset_password:alice@example.com"
 *   lookup_order({ orderId: "4711" })                     → null
 */
export function generateIdempotencyKey(
  toolName: string,
  args: Record<string, unknown>
): string | null {
  const semanticKeys = SEMANTIC_PARAMS[toolName];
  if (!semanticKeys) return null;

  const values = semanticKeys
    .map((key) => normalizeValue(args[key]))
    .join(':');

  return `${toolName}:${values}`;
}

/**
 * Extract semantic params from tool arguments.
 */
function extractSemanticParams(
  toolName: string,
  args: Record<string, unknown>
): Record<string, string> {
  const semanticKeys = SEMANTIC_PARAMS[toolName] ?? [];
  const result: Record<string, string> = {};
  for (const key of semanticKeys) {
    if (key in args) {
      result[key] = normalizeValue(args[key]);
    }
  }
  return result;
}

/**
 * Extract cosmetic params from tool arguments.
 */
function extractCosmeticParams(
  toolName: string,
  args: Record<string, unknown>
): Record<string, string> {
  const cosmeticKeys = COSMETIC_PARAMS[toolName] ?? [];
  const result: Record<string, string> = {};
  for (const key of cosmeticKeys) {
    if (key in args) {
      result[key] = String(args[key]);
    }
  }
  return result;
}

/**
 * Prune expired entries from the ledger based on retentionMs.
 */
function pruneLedger(ledger: ToolCallLedger, now: number): ToolCallLedger {
  const cutoff = now - ledger.retentionMs;
  return {
    ...ledger,
    entries: ledger.entries.filter(
      (entry) => new Date(entry.executedAt).getTime() > cutoff
    ),
  };
}

/**
 * Check if a tool call is a duplicate.
 *
 * Logic: generate key → prune expired entries → search for match → return result.
 * If the key is found in the pruned ledger, returns 'duplicate' with the original entry.
 * Otherwise returns 'allowed'.
 */
export function checkIdempotency(
  idempotencyKey: string,
  ledger: ToolCallLedger
): IdempotencyCheckResult {
  const now = Date.now();
  const prunedLedger = pruneLedger(ledger, now);

  const existing = prunedLedger.entries.find(
    (entry) => entry.idempotencyKey === idempotencyKey
  );

  if (existing) {
    return {
      status: 'duplicate',
      idempotencyKey,
      originalEntry: existing,
      prunedLedger,
    };
  }

  return {
    status: 'allowed',
    prunedLedger,
  };
}

/**
 * Add a new entry to the ledger after successful tool execution.
 * Returns a new ToolCallLedger (immutable).
 */
export function addLedgerEntry(
  ledger: ToolCallLedger,
  toolName: string,
  args: Record<string, unknown>,
  idempotencyKey: string,
  runId: string,
  toolCallId: string,
  result: unknown
): ToolCallLedger {
  const entry: LedgerEntry = {
    idempotencyKey,
    toolName,
    semanticParams: extractSemanticParams(toolName, args),
    cosmeticParams: extractCosmeticParams(toolName, args),
    executedAt: new Date().toISOString(),
    runId,
    toolCallId,
    result,
  };

  return {
    ...ledger,
    entries: [...ledger.entries, entry],
  };
}

/**
 * Create a fresh empty ledger with default retention.
 */
export function createEmptyLedger(): ToolCallLedger {
  return {
    entries: [],
    retentionMs: DEFAULT_RETENTION_MS,
  };
}

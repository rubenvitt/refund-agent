import type {
  AuditToolArguments,
  DemoState,
  PromptConfig,
  ToolCatalog,
} from './types';

/**
 * Generate a prefixed, timestamp-based, sortable ID.
 * Format: <prefix>_<13-digit-epoch-ms><8-random-hex-chars>
 */
export function generatePrefixedId(
  prefix: 'req' | 'tc' | 'ae' | 'snp' | 'rla' | 'shr',
): string {
  const timestamp = Date.now().toString().padStart(13, '0');
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}_${timestamp}${random}`;
}

/**
 * Compute a deterministic djb2 hash of a string, returning an 8-char hex string.
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Hash the active PromptConfig to produce a stable version string.
 */
export function hashPromptConfig(config: PromptConfig): string {
  return djb2Hash(JSON.stringify(config));
}

/**
 * Hash a single tool definition from the catalog to produce a version string.
 */
export function hashToolDef(catalog: ToolCatalog, toolName: string): string {
  const toolDef = catalog.tools.find((t) => t.name === toolName);
  if (!toolDef) return '00000000';
  return djb2Hash(JSON.stringify(toolDef));
}

const REDACTED_FIELDS: Record<string, string[]> = {
  verify_customer: ['email'],
  reset_password: ['email'],
};

/**
 * Redact PII fields from tool arguments. Returns a new object with
 * sensitive fields replaced by { redacted: true, reason: 'PII:<field>' }.
 */
export function redactArgs(
  toolName: string,
  args: Record<string, unknown>
): AuditToolArguments {
  const fieldsToRedact = REDACTED_FIELDS[toolName];
  if (!fieldsToRedact) return { ...args };

  const redacted: Record<string, unknown> = { ...args };
  for (const field of fieldsToRedact) {
    if (field in redacted) {
      redacted[field] = { redacted: true, reason: `PII:${field}` };
    }
  }
  return redacted as AuditToolArguments;
}

const SUBJECT_FROM_ARG: Record<string, string> = {
  verify_customer: 'customerId',
};

/**
 * Extract the customerId (subject) affected by a tool call.
 * For some tools, we must look up the order to find the customer.
 */
export function resolveSubject(
  toolName: string,
  args: Record<string, unknown>,
  state: DemoState
): string | null {
  // Direct mapping from argument
  const argField = SUBJECT_FROM_ARG[toolName];
  if (argField && typeof args[argField] === 'string') {
    return args[argField] as string;
  }

  // Order-based lookup
  if (
    (toolName === 'refund_order' || toolName === 'lookup_order') &&
    typeof args.orderId === 'string'
  ) {
    const order = state.orders.find((o) => o.id === args.orderId);
    return order?.customerId ?? null;
  }

  // Email-based lookup
  if (toolName === 'reset_password' && typeof args.email === 'string') {
    const customer = state.customers.find(
      (c) => c.email.toLowerCase() === (args.email as string).toLowerCase()
    );
    return customer?.id ?? null;
  }

  return null;
}

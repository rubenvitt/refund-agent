import { describe, it, expect } from 'vitest';
import {
  generatePrefixedId,
  hashPromptConfig,
  hashToolDef,
  redactArgs,
  resolveSubject,
} from '../audit';
import { createSeedState } from '../seed-data';
import type { PromptConfig, ToolCatalog } from '../types';

describe('generatePrefixedId', () => {
  it('generates an ID with the correct prefix', () => {
    expect(generatePrefixedId('req').startsWith('req_')).toBe(true);
    expect(generatePrefixedId('tc').startsWith('tc_')).toBe(true);
    expect(generatePrefixedId('ae').startsWith('ae_')).toBe(true);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generatePrefixedId('req')));
    expect(ids.size).toBe(100);
  });

  it('produces IDs with 13-digit timestamp + 8 hex chars after prefix', () => {
    const id = generatePrefixedId('req');
    const body = id.slice(4); // after "req_"
    expect(body.length).toBe(21); // 13 timestamp + 8 hex
  });
});

describe('hashPromptConfig', () => {
  it('returns an 8-char hex string', () => {
    const config: PromptConfig = {
      orchestratorInstructions: 'test',
      refundAgentInstructions: 'test',
      lookupAgentInstructions: 'test',
      accountFaqAgentInstructions: 'test',
    };
    const hash = hashPromptConfig(config);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns the same hash for the same input', () => {
    const config: PromptConfig = {
      orchestratorInstructions: 'a',
      refundAgentInstructions: 'b',
      lookupAgentInstructions: 'c',
      accountFaqAgentInstructions: 'd',
    };
    expect(hashPromptConfig(config)).toBe(hashPromptConfig(config));
  });

  it('returns different hashes for different inputs', () => {
    const config1: PromptConfig = {
      orchestratorInstructions: 'a',
      refundAgentInstructions: 'b',
      lookupAgentInstructions: 'c',
      accountFaqAgentInstructions: 'd',
    };
    const config2: PromptConfig = {
      orchestratorInstructions: 'x',
      refundAgentInstructions: 'b',
      lookupAgentInstructions: 'c',
      accountFaqAgentInstructions: 'd',
    };
    expect(hashPromptConfig(config1)).not.toBe(hashPromptConfig(config2));
  });
});

describe('hashToolDef', () => {
  it('returns 8 zeros for unknown tool', () => {
    const catalog: ToolCatalog = { tools: [] };
    expect(hashToolDef(catalog, 'nonexistent')).toBe('00000000');
  });

  it('returns a stable hash for a known tool', () => {
    const catalog: ToolCatalog = {
      tools: [
        { name: 'test_tool', description: 'A test', parameters: {}, requiresApproval: false, isDestructive: false },
      ],
    };
    const hash1 = hashToolDef(catalog, 'test_tool');
    const hash2 = hashToolDef(catalog, 'test_tool');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('redactArgs', () => {
  it('redacts email for verify_customer', () => {
    const result = redactArgs('verify_customer', { customerId: 'C001', email: 'test@example.com' });
    expect(result).toEqual({
      customerId: 'C001',
      email: { redacted: true, reason: 'PII:email' },
    });
  });

  it('redacts email for reset_password', () => {
    const result = redactArgs('reset_password', { email: 'test@example.com' });
    expect(result).toEqual({
      email: { redacted: true, reason: 'PII:email' },
    });
  });

  it('does not redact for lookup_order', () => {
    const args = { orderId: '4711' };
    const result = redactArgs('lookup_order', args);
    expect(result).toEqual({ orderId: '4711' });
  });

  it('does not redact for refund_order', () => {
    const args = { orderId: '4711', reason: 'damaged' };
    const result = redactArgs('refund_order', args);
    expect(result).toEqual({ orderId: '4711', reason: 'damaged' });
  });
});

describe('resolveSubject', () => {
  const state = createSeedState();

  it('resolves customerId directly for verify_customer', () => {
    expect(resolveSubject('verify_customer', { customerId: 'C001', email: 'x' }, state)).toBe('C001');
  });

  it('resolves customerId via order lookup for refund_order', () => {
    expect(resolveSubject('refund_order', { orderId: '4711', reason: 'test' }, state)).toBe('C001');
  });

  it('resolves customerId via order lookup for lookup_order', () => {
    expect(resolveSubject('lookup_order', { orderId: '4714' }, state)).toBe('C002');
  });

  it('resolves customerId via email lookup for reset_password', () => {
    expect(resolveSubject('reset_password', { email: 'erika@example.com' }, state)).toBe('C002');
  });

  it('returns null for faq_search', () => {
    expect(resolveSubject('faq_search', { query: 'test' }, state)).toBeNull();
  });

  it('returns null for unknown order', () => {
    expect(resolveSubject('refund_order', { orderId: '9999', reason: 'test' }, state)).toBeNull();
  });
});

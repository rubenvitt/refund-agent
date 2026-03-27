// src/lib/__tests__/idempotency.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateIdempotencyKey,
  checkIdempotency,
  addLedgerEntry,
  createEmptyLedger,
} from '../idempotency';
import type { ToolCallLedger } from '../types';

describe('generateIdempotencyKey', () => {
  it('returns a key for refund_order based on orderId', () => {
    const key = generateIdempotencyKey('refund_order', {
      orderId: '4711',
      reason: 'damaged item',
    });
    expect(key).toBe('refund_order:4711');
  });

  it('ignores cosmetic params (reason) for refund_order', () => {
    const key1 = generateIdempotencyKey('refund_order', {
      orderId: '4711',
      reason: 'damaged item',
    });
    const key2 = generateIdempotencyKey('refund_order', {
      orderId: '4711',
      reason: 'wrong item',
    });
    expect(key1).toBe(key2);
  });

  it('returns a key for reset_password with normalized email', () => {
    const key = generateIdempotencyKey('reset_password', {
      email: 'ALICE@EXAMPLE.COM',
    });
    expect(key).toBe('reset_password:alice@example.com');
  });

  it('normalizes email case for reset_password', () => {
    const key1 = generateIdempotencyKey('reset_password', {
      email: 'Alice@Example.com',
    });
    const key2 = generateIdempotencyKey('reset_password', {
      email: 'alice@example.com',
    });
    expect(key1).toBe(key2);
  });

  it('trims whitespace in parameter values', () => {
    const key1 = generateIdempotencyKey('reset_password', {
      email: '  alice@example.com  ',
    });
    const key2 = generateIdempotencyKey('reset_password', {
      email: 'alice@example.com',
    });
    expect(key1).toBe(key2);
  });

  it('returns null for read-only tool lookup_order', () => {
    const key = generateIdempotencyKey('lookup_order', { orderId: '4711' });
    expect(key).toBeNull();
  });

  it('returns null for read-only tool verify_customer', () => {
    const key = generateIdempotencyKey('verify_customer', {
      customerId: 'C001',
      email: 'test@example.com',
    });
    expect(key).toBeNull();
  });

  it('returns null for read-only tool faq_search', () => {
    const key = generateIdempotencyKey('faq_search', { query: 'return policy' });
    expect(key).toBeNull();
  });

  it('returns null for unknown tools', () => {
    const key = generateIdempotencyKey('unknown_tool', { foo: 'bar' });
    expect(key).toBeNull();
  });

  it('produces different keys for different orderId values', () => {
    const key1 = generateIdempotencyKey('refund_order', {
      orderId: '4711',
      reason: 'a',
    });
    const key2 = generateIdempotencyKey('refund_order', {
      orderId: '4712',
      reason: 'a',
    });
    expect(key1).not.toBe(key2);
  });
});

describe('checkIdempotency', () => {
  let ledger: ToolCallLedger;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T12:00:00Z'));
    ledger = createEmptyLedger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns allowed for an empty ledger', () => {
    const result = checkIdempotency('refund_order:4711', ledger);
    expect(result.status).toBe('allowed');
  });

  it('returns duplicate when key already exists in ledger', () => {
    const populatedLedger: ToolCallLedger = {
      ...ledger,
      entries: [
        {
          idempotencyKey: 'refund_order:4711',
          toolName: 'refund_order',
          semanticParams: { orderId: '4711' },
          cosmeticParams: { reason: 'damaged' },
          executedAt: '2026-03-27T11:00:00Z',
          runId: 'req_001',
          toolCallId: 'tc_001',
          result: { success: true, message: 'Refunded' },
        },
      ],
    };

    const result = checkIdempotency('refund_order:4711', populatedLedger);
    expect(result.status).toBe('duplicate');
    if (result.status === 'duplicate') {
      expect(result.idempotencyKey).toBe('refund_order:4711');
      expect(result.originalEntry.toolCallId).toBe('tc_001');
      expect(result.originalEntry.result).toEqual({
        success: true,
        message: 'Refunded',
      });
    }
  });

  it('returns allowed for a different key', () => {
    const populatedLedger: ToolCallLedger = {
      ...ledger,
      entries: [
        {
          idempotencyKey: 'refund_order:4711',
          toolName: 'refund_order',
          semanticParams: { orderId: '4711' },
          cosmeticParams: { reason: 'damaged' },
          executedAt: '2026-03-27T11:00:00Z',
          runId: 'req_001',
          toolCallId: 'tc_001',
          result: { success: true },
        },
      ],
    };

    const result = checkIdempotency('refund_order:4712', populatedLedger);
    expect(result.status).toBe('allowed');
  });

  it('prunes expired entries and returns allowed', () => {
    // Entry is 25 hours old (older than 24h retention)
    const expiredLedger: ToolCallLedger = {
      ...ledger,
      entries: [
        {
          idempotencyKey: 'refund_order:4711',
          toolName: 'refund_order',
          semanticParams: { orderId: '4711' },
          cosmeticParams: { reason: 'damaged' },
          executedAt: '2026-03-26T11:00:00Z', // 25 hours ago
          runId: 'req_001',
          toolCallId: 'tc_001',
          result: { success: true },
        },
      ],
    };

    const result = checkIdempotency('refund_order:4711', expiredLedger);
    expect(result.status).toBe('allowed');
    expect(result.prunedLedger.entries).toHaveLength(0);
  });

  it('keeps non-expired entries during pruning', () => {
    const mixedLedger: ToolCallLedger = {
      ...ledger,
      entries: [
        {
          idempotencyKey: 'refund_order:4711',
          toolName: 'refund_order',
          semanticParams: { orderId: '4711' },
          cosmeticParams: {},
          executedAt: '2026-03-26T11:00:00Z', // expired (25h ago)
          runId: 'req_001',
          toolCallId: 'tc_001',
          result: { success: true },
        },
        {
          idempotencyKey: 'refund_order:4712',
          toolName: 'refund_order',
          semanticParams: { orderId: '4712' },
          cosmeticParams: {},
          executedAt: '2026-03-27T11:30:00Z', // 30 min ago, still valid
          runId: 'req_002',
          toolCallId: 'tc_002',
          result: { success: true },
        },
      ],
    };

    const result = checkIdempotency('refund_order:9999', mixedLedger);
    expect(result.status).toBe('allowed');
    expect(result.prunedLedger.entries).toHaveLength(1);
    expect(result.prunedLedger.entries[0].idempotencyKey).toBe(
      'refund_order:4712'
    );
  });
});

describe('addLedgerEntry', () => {
  it('adds a new entry to an empty ledger', () => {
    const ledger = createEmptyLedger();
    const updated = addLedgerEntry(
      ledger,
      'refund_order',
      { orderId: '4711', reason: 'damaged' },
      'refund_order:4711',
      'req_001',
      'tc_001',
      { success: true, message: 'Refunded $12.99' }
    );

    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0].idempotencyKey).toBe('refund_order:4711');
    expect(updated.entries[0].toolName).toBe('refund_order');
    expect(updated.entries[0].semanticParams).toEqual({ orderId: '4711' });
    expect(updated.entries[0].cosmeticParams).toEqual({ reason: 'damaged' });
    expect(updated.entries[0].runId).toBe('req_001');
    expect(updated.entries[0].toolCallId).toBe('tc_001');
    expect(updated.entries[0].result).toEqual({
      success: true,
      message: 'Refunded $12.99',
    });
  });

  it('preserves existing entries (immutable)', () => {
    const ledger = createEmptyLedger();
    const first = addLedgerEntry(
      ledger,
      'refund_order',
      { orderId: '4711', reason: 'a' },
      'refund_order:4711',
      'req_001',
      'tc_001',
      { success: true }
    );
    const second = addLedgerEntry(
      first,
      'reset_password',
      { email: 'alice@example.com' },
      'reset_password:alice@example.com',
      'req_002',
      'tc_002',
      { success: true }
    );

    expect(second.entries).toHaveLength(2);
    expect(first.entries).toHaveLength(1); // original not mutated
    expect(ledger.entries).toHaveLength(0); // original not mutated
  });

  it('correctly extracts semantic and cosmetic params for reset_password', () => {
    const ledger = createEmptyLedger();
    const updated = addLedgerEntry(
      ledger,
      'reset_password',
      { email: 'BOB@EXAMPLE.COM' },
      'reset_password:bob@example.com',
      'req_001',
      'tc_001',
      { success: true }
    );

    expect(updated.entries[0].semanticParams).toEqual({
      email: 'bob@example.com',
    });
    expect(updated.entries[0].cosmeticParams).toEqual({});
  });
});

describe('createEmptyLedger', () => {
  it('returns a ledger with no entries', () => {
    const ledger = createEmptyLedger();
    expect(ledger.entries).toEqual([]);
  });

  it('sets default retention to 24 hours', () => {
    const ledger = createEmptyLedger();
    expect(ledger.retentionMs).toBe(86_400_000);
  });
});

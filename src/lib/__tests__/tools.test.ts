import { describe, it, expect } from 'vitest';
import { lookupOrder, verifyCustomer, refundOrder, faqSearch, resetPassword } from '../tools';
import { createSeedState } from '../seed-data';

describe('lookupOrder', () => {
  it('returns order details for existing order', () => {
    const state = createSeedState();
    const result = lookupOrder(state, { orderId: '4711' });
    expect((result.result as { found: boolean }).found).toBe(true);
    expect((result.result as { order: { id: string } }).order.id).toBe('4711');
  });

  it('returns not found for non-existing order', () => {
    const state = createSeedState();
    const result = lookupOrder(state, { orderId: '9999' });
    expect((result.result as { found: boolean }).found).toBe(false);
  });

  it('does not modify state', () => {
    const state = createSeedState();
    const before = JSON.stringify(state);
    lookupOrder(state, { orderId: '4711' });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('verifyCustomer', () => {
  it('verifies customer with correct email', () => {
    const state = createSeedState();
    const result = verifyCustomer(state, { customerId: 'C001', email: 'max@example.com' });
    expect((result.result as { verified: boolean }).verified).toBe(true);
  });

  it('fails verification with wrong email', () => {
    const state = createSeedState();
    const result = verifyCustomer(state, { customerId: 'C001', email: 'wrong@example.com' });
    expect((result.result as { verified: boolean }).verified).toBe(false);
  });

  it('fails for non-existing customer', () => {
    const state = createSeedState();
    const result = verifyCustomer(state, { customerId: 'C999', email: 'test@example.com' });
    expect((result.result as { verified: boolean }).verified).toBe(false);
  });
});

describe('refundOrder', () => {
  it('successfully refunds a refundable order', () => {
    const state = createSeedState();
    const result = refundOrder(state, { orderId: '4711', reason: 'Defective product' });
    expect((result.result as { success: boolean }).success).toBe(true);
    expect(result.sideEffects.length).toBeGreaterThan(0);
  });

  it('rejects refund for non-refundable order (deadline passed)', () => {
    const state = createSeedState();
    const result = refundOrder(state, { orderId: '4712', reason: 'Want money back' });
    expect((result.result as { success: boolean }).success).toBe(false);
    expect(result.sideEffects).toEqual([]);
  });

  it('rejects refund for already refunded order', () => {
    const state = createSeedState();
    const result = refundOrder(state, { orderId: '4719', reason: 'Double refund' });
    expect((result.result as { success: boolean }).success).toBe(false);
  });

  it('rejects refund for non-existing order', () => {
    const state = createSeedState();
    const result = refundOrder(state, { orderId: '9999', reason: 'Nonexistent' });
    expect((result.result as { success: boolean }).success).toBe(false);
  });

  it('creates RefundEvent and updates order status', () => {
    const state = createSeedState();
    const result = refundOrder(state, { orderId: '4711', reason: 'Test refund' });
    expect(result.updatedState.refundEvents.length).toBe(1);
    const updatedOrder = result.updatedState.orders.find((o) => o.id === '4711');
    expect(updatedOrder?.status).toBe('refunded');
    expect(updatedOrder?.refundedAt).not.toBeNull();
  });

  it('does not mutate original state', () => {
    const state = createSeedState();
    const before = JSON.stringify(state);
    refundOrder(state, { orderId: '4711', reason: 'Test' });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('faqSearch', () => {
  it('returns results for return policy query', () => {
    const state = createSeedState();
    const result = faqSearch(state, { query: 'return policy' });
    expect((result.result as { found: boolean }).found).toBe(true);
    expect((result.result as { results: unknown[] }).results.length).toBeGreaterThan(0);
  });

  it('returns results for password query', () => {
    const state = createSeedState();
    const result = faqSearch(state, { query: 'password reset' });
    expect((result.result as { found: boolean }).found).toBe(true);
  });

  it('does not modify state', () => {
    const state = createSeedState();
    const before = JSON.stringify(state);
    faqSearch(state, { query: 'test' });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('resetPassword', () => {
  it('succeeds for existing customer email', () => {
    const state = createSeedState();
    const result = resetPassword(state, { email: 'max@example.com' });
    expect((result.result as { success: boolean }).success).toBe(true);
  });

  it('fails for unknown email', () => {
    const state = createSeedState();
    const result = resetPassword(state, { email: 'nobody@example.com' });
    expect((result.result as { success: boolean }).success).toBe(false);
  });

});

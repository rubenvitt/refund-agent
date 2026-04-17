import { describe, it, expect } from 'vitest';
import {
  checkBflaPermission,
  checkBolaPermission,
  evaluateAuthForToolCall,
} from '../auth-gate';
import { createSeedState } from '../seed-data';
import type { UserSession } from '../types';

const state = createSeedState();

const customerC001: UserSession = {
  customerId: 'C001',
  customerName: 'Max Mustermann',
  role: 'customer',
  loginTimestamp: '2026-03-27T10:00:00.000Z',
};

const customerC002: UserSession = {
  customerId: 'C002',
  customerName: 'Erika Beispiel',
  role: 'customer',
  loginTimestamp: '2026-03-27T10:00:00.000Z',
};

const adminSession: UserSession = {
  customerId: 'C001',
  customerName: 'Admin Max',
  role: 'support_admin',
  loginTimestamp: '2026-03-27T10:00:00.000Z',
};

// ── BFLA ──

describe('checkBflaPermission', () => {
  it('allows customer to call lookup_order', () => {
    expect(checkBflaPermission('lookup_order', 'customer')).toEqual({ allowed: true });
  });

  it('allows customer to call faq_search', () => {
    expect(checkBflaPermission('faq_search', 'customer')).toEqual({ allowed: true });
  });

  it('allows customer to call refund_order', () => {
    expect(checkBflaPermission('refund_order', 'customer')).toEqual({ allowed: true });
  });

  it('allows customer to call reset_password', () => {
    expect(checkBflaPermission('reset_password', 'customer')).toEqual({ allowed: true });
  });

  it('allows support_admin to call all tools', () => {
    for (const tool of ['lookup_order', 'verify_customer', 'refund_order', 'faq_search', 'reset_password']) {
      expect(checkBflaPermission(tool, 'support_admin')).toEqual({ allowed: true });
    }
  });

  it('denies customer for an unknown tool', () => {
    const result = checkBflaPermission('admin_dashboard', 'customer');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bfla');
    }
  });
});

// ── BOLA ──

describe('checkBolaPermission', () => {
  it('allows C001 to lookup own order 4711', () => {
    const result = checkBolaPermission('lookup_order', { orderId: '4711' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('denies C001 from looking up C002 order 4714', () => {
    const result = checkBolaPermission('lookup_order', { orderId: '4714' }, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bola');
    }
  });

  it('denies C001 from refunding C003 order 4715', () => {
    const result = checkBolaPermission('refund_order', { orderId: '4715', reason: 'test' }, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bola');
    }
  });

  it('allows C001 to refund own order 4711', () => {
    const result = checkBolaPermission('refund_order', { orderId: '4711', reason: 'test' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows C001 to reset own password', () => {
    const result = checkBolaPermission('reset_password', { email: 'max.mustermann@example.com' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('denies C001 from resetting C002 password', () => {
    const result = checkBolaPermission('reset_password', { email: 'erika@example.com' }, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bola');
    }
  });

  it('allows support_admin to access any order (BOLA bypass)', () => {
    const result = checkBolaPermission('lookup_order', { orderId: '4714' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows support_admin to refund any order (BOLA bypass)', () => {
    const result = checkBolaPermission('refund_order', { orderId: '4715', reason: 'test' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows support_admin to reset any password (BOLA bypass)', () => {
    const result = checkBolaPermission('reset_password', { email: 'erika@example.com' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });

  it('returns allowed for non-existent order (no existence leak)', () => {
    const result = checkBolaPermission('lookup_order', { orderId: '9999' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('returns allowed for non-existent email (no existence leak)', () => {
    const result = checkBolaPermission('reset_password', { email: 'nobody@example.com' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows faq_search without BOLA check', () => {
    const result = checkBolaPermission('faq_search', { query: 'refund' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('allows verify_customer without BOLA check', () => {
    const result = checkBolaPermission('verify_customer', { customerId: 'C002', email: 'x' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('handles case-insensitive email for reset_password BOLA', () => {
    const result = checkBolaPermission('reset_password', { email: 'MAX@EXAMPLE.COM' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });
});

// ── evaluateAuthForToolCall (integration) ──

describe('evaluateAuthForToolCall', () => {
  it('denies all non-faq tools when session is null', () => {
    const result = evaluateAuthForToolCall('lookup_order', { orderId: '4711' }, null, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('no_session');
    }
  });

  it('allows faq_search when session is null', () => {
    const result = evaluateAuthForToolCall('faq_search', { query: 'return policy' }, null, state);
    expect(result).toEqual({ allowed: true });
  });

  it('denies C001 from accessing C002 order (BOLA via integration)', () => {
    const result = evaluateAuthForToolCall('lookup_order', { orderId: '4714' }, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bola');
    }
  });

  it('allows C001 to access own order (full chain passes)', () => {
    const result = evaluateAuthForToolCall('lookup_order', { orderId: '4711' }, customerC001, state);
    expect(result).toEqual({ allowed: true });
  });

  it('BFLA fires before BOLA for unknown tool', () => {
    const result = evaluateAuthForToolCall('admin_dashboard', {}, customerC001, state);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.checkType).toBe('bfla');
    }
  });

  it('admin can access any order', () => {
    const result = evaluateAuthForToolCall('refund_order', { orderId: '4715', reason: 'test' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });

  it('admin can reset any password', () => {
    const result = evaluateAuthForToolCall('reset_password', { email: 'erika@example.com' }, adminSession, state);
    expect(result).toEqual({ allowed: true });
  });
});

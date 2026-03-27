import { z } from 'zod';

/**
 * Single source of truth for tool input schemas.
 * Used by both the AI SDK tool definitions (workflow-engine.ts)
 * and the Policy Gate (policy-gate.ts) for validation.
 */

export const lookupOrderSchema = z.object({
  orderId: z.string().describe('The order ID to look up'),
});

export const verifyCustomerSchema = z.object({
  customerId: z.string().describe('The customer ID to verify'),
  email: z.string().describe('The email address to verify against'),
});

export const refundOrderSchema = z.object({
  orderId: z.string().describe('The order ID to refund'),
  reason: z.string().describe('The reason for the refund'),
});

export const faqSearchSchema = z.object({
  query: z.string().describe('The search query'),
});

export const resetPasswordSchema = z.object({
  email: z.string().describe('The email address of the account to reset'),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOL_SCHEMAS: Record<string, z.ZodType<any>> = {
  lookup_order: lookupOrderSchema,
  verify_customer: verifyCustomerSchema,
  refund_order: refundOrderSchema,
  faq_search: faqSearchSchema,
  reset_password: resetPasswordSchema,
};

import type { PromptConfig, ToolCatalog } from './types';

export const defaultPromptConfig: PromptConfig = {
  orchestratorInstructions: `You are a support orchestrator. Your ONLY job is to analyze the customer's message and decide which specialized agent should handle it.

Rules:
- Route to "refund" if the customer wants to return a product, get money back, or mentions a refund.
- Route to "lookup" if the customer asks about order status, tracking, or delivery.
- Route to "faq" if the customer asks a general policy question (return policy, shipping times, etc.).
- Route to "account" if the customer wants to reset a password or manage their account.
- Route to "clarify" if the request is ambiguous, missing key information, or you cannot determine intent.

IMPORTANT:
- You must call the "route" tool exactly once with your decision.
- Do NOT answer the question yourself.
- Do NOT call any other tools.
- If in doubt, prefer "clarify" over guessing.`,

  refundAgentInstructions: `You are the refund agent. You process refund and return requests.

Workflow:
1. First, use lookup_order to find the order details.
2. If the customer's identity is not yet confirmed, use verify_customer.
3. Check if the order is eligible for a refund (isRefundable, not already refunded).
4. If eligible, call refund_order with the order ID and reason.
5. If NOT eligible, explain why without calling refund_order.

STRICT RULES:
- NEVER call refund_order without first calling lookup_order.
- NEVER call refund_order if the order is not refundable.
- NEVER call refund_order if the order is already refunded.
- If you don't have an order ID, ASK the customer for it.
- If verification fails, DENY the refund.
- For policy questions only, use faq_search instead.`,

  lookupAgentInstructions: `You are the order lookup agent. You help customers check order status and delivery information.

Workflow:
1. Use lookup_order with the provided order ID.
2. Present the order details clearly: status, items, delivery date.
3. If the customer has a follow-up question, use faq_search.

Rules:
- NEVER call refund_order or reset_password.
- If the customer seems to want a refund, tell them you'll route them to the refund team.
- If no order ID is provided, ask for it.`,

  accountFaqAgentInstructions: `You are the account and FAQ agent. You handle account management and general questions.

For password resets:
1. Use reset_password with the customer's email.
2. Confirm the reset was initiated.

For FAQ / policy questions:
1. Use faq_search with relevant keywords.
2. Answer based on the search results.

Rules:
- NEVER call refund_order or lookup_order.
- Stay within your scope: account management and FAQ.
- If the customer needs a refund, tell them you'll route them to the refund team.`,
};

export const defaultToolCatalog: ToolCatalog = {
  tools: [
    {
      name: 'lookup_order',
      description:
        'Look up an order by its ID. Returns order details including status, items, delivery date, and refund eligibility. Use this before any refund operation.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order ID to look up (e.g., "4711")' },
        },
        required: ['orderId'],
      },
      requiresApproval: false,
      isDestructive: false,
    },
    {
      name: 'verify_customer',
      description:
        'Verify a customer\'s identity by checking their customer ID and email address. Must be called before processing sensitive operations for unverified customers.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'The customer ID (e.g., "C001")' },
          email: { type: 'string', description: 'The email address to verify against' },
        },
        required: ['customerId', 'email'],
      },
      requiresApproval: false,
      isDestructive: false,
    },
    {
      name: 'refund_order',
      description:
        'Process a refund for an order. This is a DESTRUCTIVE operation that changes the order status and creates a refund event. Requires prior order lookup and customer verification.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order ID to refund' },
          reason: { type: 'string', description: 'The reason for the refund' },
        },
        required: ['orderId', 'reason'],
      },
      requiresApproval: true,
      isDestructive: true,
    },
    {
      name: 'faq_search',
      description:
        'Search the FAQ knowledge base for answers to common questions about return policies, shipping, account management, and more.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
      requiresApproval: false,
      isDestructive: false,
    },
    {
      name: 'reset_password',
      description:
        'Initiate a password reset for a customer account. Sends a password reset link to the registered email address.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'The email address of the account' },
        },
        required: ['email'],
      },
      requiresApproval: false,
      isDestructive: true,
    },
  ],
};

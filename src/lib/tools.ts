import type { DemoState, RefundEvent } from './types';

type ToolResult = {
  result: unknown;
  updatedState: DemoState;
  sideEffects: string[];
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

const FAQ_ENTRIES = [
  {
    question: 'What is the return policy?',
    keywords: ['return', 'return policy', 'returns', 'send back', 'zurück'],
    answer:
      'Our return policy allows returns within 30 days of delivery. Items must be unused and in original packaging. To initiate a return, contact support with your order ID.',
  },
  {
    question: 'How long does shipping take?',
    keywords: ['shipping', 'delivery', 'how long', 'ship', 'arrive', 'transit'],
    answer:
      'Standard shipping takes 5-7 business days. Express shipping takes 2-3 business days. Overnight shipping is available for an additional fee and delivers the next business day.',
  },
  {
    question: 'How do I reset my password?',
    keywords: ['password', 'reset', 'forgot', 'login', 'sign in', 'access'],
    answer:
      'To reset your password, click "Forgot Password" on the login page, enter your email address, and follow the instructions in the reset email. The link expires after 24 hours.',
  },
  {
    question: 'How do I contact support?',
    keywords: ['contact', 'support', 'help', 'phone', 'email', 'reach', 'chat'],
    answer:
      'You can reach our support team via email at support@example.com, by phone at 1-800-555-0199 (Mon-Fri 9am-5pm EST), or through the live chat on our website.',
  },
  {
    question: 'What is the refund policy?',
    keywords: ['refund', 'money back', 'reimburse', 'credit', 'erstattet', 'zurückerstattet'],
    answer:
      'Refunds are processed within 5-10 business days after we receive the returned item. The refund is issued to the original payment method. Orders must be within the 30-day return window and marked as refundable.',
  },
  {
    question: 'Can I cancel my order?',
    keywords: ['cancel', 'cancellation', 'stop order', 'abort'],
    answer:
      'Orders can be cancelled if they are still in "processing" status. Once an order has shipped, it cannot be cancelled, but you can initiate a return after delivery.',
  },
  {
    question: 'How do I track my order?',
    keywords: ['track', 'tracking', 'where is', 'status', 'order status'],
    answer:
      'You can track your order by logging into your account and visiting the "Orders" section. You will also receive tracking emails with a link to the carrier\'s tracking page.',
  },
  {
    question: 'Do you offer international shipping?',
    keywords: ['international', 'worldwide', 'global', 'outside', 'country', 'abroad'],
    answer:
      'We currently ship to the US, Canada, UK, and EU countries. International shipping takes 10-15 business days. Additional customs fees may apply depending on your country.',
  },
];

export function lookupOrder(
  state: DemoState,
  args: { orderId: string }
): ToolResult {
  const order = state.orders.find((o) => o.id === args.orderId);

  if (!order) {
    return {
      result: { found: false, message: `Order ${args.orderId} not found.` },
      updatedState: state,
      sideEffects: [],
    };
  }

  const customer = state.customers.find((c) => c.id === order.customerId);

  return {
    result: {
      found: true,
      order: {
        id: order.id,
        customerId: order.customerId,
        customerName: customer?.name ?? 'Unknown',
        items: order.items,
        total: order.total,
        status: order.status,
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        returnDeadline: order.returnDeadline,
        isRefundable: order.isRefundable,
        refundedAt: order.refundedAt,
      },
    },
    updatedState: state,
    sideEffects: [],
  };
}

export function verifyCustomer(
  state: DemoState,
  args: { customerId: string; email: string }
): ToolResult {
  const customer = state.customers.find((c) => c.id === args.customerId);

  if (!customer) {
    return {
      result: {
        verified: false,
        message: `Customer ${args.customerId} not found.`,
      },
      updatedState: state,
      sideEffects: [],
    };
  }

  const emailMatch =
    customer.email.toLowerCase() === args.email.toLowerCase();

  return {
    result: {
      verified: emailMatch,
      message: emailMatch
        ? `Customer ${customer.name} verified successfully.`
        : 'Email does not match our records.',
      customer: emailMatch
        ? { id: customer.id, name: customer.name, email: customer.email }
        : undefined,
    },
    updatedState: state,
    sideEffects: [],
  };
}

export function refundOrder(
  state: DemoState,
  args: { orderId: string; reason: string }
): ToolResult {
  const clonedState = deepClone(state);
  const order = clonedState.orders.find((o) => o.id === args.orderId);

  if (!order) {
    return {
      result: {
        success: false,
        message: `Order ${args.orderId} not found.`,
      },
      updatedState: state,
      sideEffects: [],
    };
  }

  if (!order.isRefundable) {
    return {
      result: {
        success: false,
        message: `Order ${args.orderId} is not eligible for a refund.`,
      },
      updatedState: state,
      sideEffects: [],
    };
  }

  if (order.refundedAt !== null || order.status === 'refunded') {
    return {
      result: {
        success: false,
        message: `Order ${args.orderId} has already been refunded.`,
      },
      updatedState: state,
      sideEffects: [],
    };
  }

  const now = new Date().toISOString();

  const refundEvent: RefundEvent = {
    id: crypto.randomUUID(),
    orderId: order.id,
    customerId: order.customerId,
    amount: order.total,
    reason: args.reason,
    timestamp: now,
    approvedBy: 'auto',
  };

  order.status = 'refunded';
  order.refundedAt = now;

  clonedState.refundEvents.push(refundEvent);

  return {
    result: {
      success: true,
      message: `Order ${args.orderId} has been refunded. Amount: $${order.total.toFixed(2)}. Refund ID: ${refundEvent.id}.`,
      refundEvent,
    },
    updatedState: clonedState,
    sideEffects: ['refund_created', 'order_status_updated'],
  };
}

export function faqSearch(
  state: DemoState,
  args: { query: string }
): ToolResult {
  const queryLower = args.query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

  const scored = FAQ_ENTRIES.map((entry) => {
    let score = 0;
    for (const keyword of entry.keywords) {
      if (queryLower.includes(keyword)) {
        score += 3;
      }
    }
    for (const term of queryTerms) {
      for (const keyword of entry.keywords) {
        if (keyword.includes(term) || term.includes(keyword)) {
          score += 1;
        }
      }
      if (entry.question.toLowerCase().includes(term)) {
        score += 1;
      }
      if (entry.answer.toLowerCase().includes(term)) {
        score += 0.5;
      }
    }
    return { entry, score };
  });

  const results = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => ({
      question: s.entry.question,
      answer: s.entry.answer,
      relevanceScore: s.score,
    }));

  return {
    result: {
      query: args.query,
      found: results.length > 0,
      results,
      message:
        results.length > 0
          ? `Found ${results.length} relevant FAQ entries.`
          : 'No relevant FAQ entries found for your query.',
    },
    updatedState: state,
    sideEffects: [],
  };
}

export function resetPassword(
  state: DemoState,
  args: { email: string }
): ToolResult {
  const customer = state.customers.find(
    (c) => c.email.toLowerCase() === args.email.toLowerCase()
  );

  if (!customer) {
    return {
      result: {
        success: false,
        message: `No account found with email ${args.email}.`,
      },
      updatedState: state,
      sideEffects: [],
    };
  }

  const clonedState = deepClone(state);

  return {
    result: {
      success: true,
      message: `Password reset email sent to ${args.email}. Please check your inbox.`,
    },
    updatedState: clonedState,
    sideEffects: ['password_reset_email_sent'],
  };
}

export function executeTool(
  toolName: string,
  state: DemoState,
  args: Record<string, unknown>
): ToolResult {
  switch (toolName) {
    case 'lookup_order':
      return lookupOrder(state, args as { orderId: string });
    case 'verify_customer':
      return verifyCustomer(
        state,
        args as { customerId: string; email: string }
      );
    case 'refund_order':
      return refundOrder(state, args as { orderId: string; reason: string });
    case 'faq_search':
      return faqSearch(state, args as { query: string });
    case 'reset_password':
      return resetPassword(state, args as { email: string });
    default:
      return {
        result: { error: `Unknown tool: ${toolName}` },
        updatedState: state,
        sideEffects: [],
      };
  }
}

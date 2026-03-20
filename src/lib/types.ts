// ── Demo State ──

export type Customer = {
  id: string;
  name: string;
  email: string;
  verified: boolean;
};

export type OrderStatus =
  | 'delivered'
  | 'shipped'
  | 'processing'
  | 'returned'
  | 'refunded'
  | 'cancelled';

export type LineItem = {
  productId: string;
  name: string;
  quantity: number;
  price: number;
};

export type Order = {
  id: string;
  customerId: string;
  items: LineItem[];
  total: number;
  status: OrderStatus;
  orderDate: string;
  deliveryDate: string | null;
  returnDeadline: string;
  isRefundable: boolean;
  refundedAt: string | null;
};

export type RefundEvent = {
  id: string;
  orderId: string;
  customerId: string;
  amount: number;
  reason: string;
  timestamp: string;
  approvedBy: 'user' | 'auto';
};

export type AuditLogEntry = {
  id: string;
  timestamp: string;
  action: string;
  details: Record<string, unknown>;
  agentId: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  isDestructive: boolean;
};

export type PromptConfig = {
  orchestratorInstructions: string;
  refundAgentInstructions: string;
  lookupAgentInstructions: string;
  accountFaqAgentInstructions: string;
};

export type ToolCatalog = {
  tools: ToolDefinition[];
};

export type DemoState = {
  customers: Customer[];
  orders: Order[];
  refundEvents: RefundEvent[];
  auditLog: AuditLogEntry[];
};

// ── Trace ──

export type RouteDecision = 'refund' | 'lookup' | 'faq' | 'account' | 'clarify';

export type ToolCallTrace = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  approvalRequired: boolean;
  approvalStatus: 'approved' | 'denied' | 'not_required' | 'pending';
};

export type MismatchAlert = {
  type: 'false_success' | 'missing_side_effect' | 'unauthorized_action';
  message: string;
  details: Record<string, unknown>;
};

export type TraceEntry = {
  id: string;
  timestamp: string;
  type:
    | 'user_message'
    | 'route_decision'
    | 'model_call'
    | 'tool_call'
    | 'tool_result'
    | 'approval_request'
    | 'approval_response'
    | 'state_change'
    | 'mismatch_alert'
    | 'agent_response';
  agentId?: string;
  data: Record<string, unknown>;
};

export type RunTrace = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  userMessage: string;
  route: RouteDecision | null;
  entries: TraceEntry[];
  toolCalls: ToolCallTrace[];
  mismatches: MismatchAlert[];
  finalAnswer: string | null;
  stateChanges: Array<{ field: string; before: unknown; after: unknown }>;
};

// ── Evals ──

export type EvalCategory =
  | 'positive_refund'
  | 'negative_refund'
  | 'lookup'
  | 'ambiguity'
  | 'policy_boundary';

export type EvalCase = {
  id: string;
  category: EvalCategory;
  userMessage: string;
  description: string;
  expectations: {
    expectedRoute: RouteDecision;
    requiredTools: string[];
    forbiddenTools: string[];
    approvalExpected: boolean;
    destructiveSideEffectAllowed: boolean;
    expectedMismatch: boolean;
  };
};

export type EvalScores = {
  routeMatch: boolean;
  requiredToolsCalled: boolean;
  forbiddenToolsAvoided: boolean;
  approvalCorrect: boolean;
  sideEffectCorrect: boolean;
  mismatchDetected: boolean;
};

export type EvalResult = {
  caseId: string;
  passed: boolean;
  actualRoute: RouteDecision | null;
  actualTools: string[];
  scores: EvalScores;
  mismatchReason: string | null;
  trace: RunTrace;
  durationMs: number;
  error?: string;
};

// ── Settings ──

export type Provider = 'openai' | 'anthropic';

export type AppSettings = {
  provider: Provider;
  modelId: string;
  openaiApiKey: string;
  anthropicApiKey: string;
};

// ── API ──

export type ChatRequestBody = {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  settings: AppSettings;
  promptConfig: PromptConfig;
  toolCatalog: ToolCatalog;
  demoState: DemoState;
  pendingApproval?: { toolCallId: string; approved: boolean } | null;
};

export type ApprovalRequest = {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  message: string;
};

export type ChatResponseData = {
  message: string;
  trace: RunTrace;
  updatedState: DemoState;
  approvalRequest: ApprovalRequest | null;
};

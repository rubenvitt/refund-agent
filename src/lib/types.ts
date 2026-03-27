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

export type AuditActor =
  | { type: 'user' }
  | { type: 'agent'; agentId: string }
  | { type: 'system'; component: string };

export type AuditOutcome =
  | 'requested'
  | 'approved'
  | 'denied'
  | 'completed'
  | 'failed'
  | 'skipped';

export type AuditToolArguments =
  | { redacted: true; reason: string }
  | Record<string, unknown>;

export type StructuredAuditEntry = {
  id: string;
  requestId: string;
  toolCallId: string;
  idempotencyKey: string | null;
  actor: AuditActor;
  subject: string | null;
  toolName: string;
  toolDefinitionVersion: string;
  arguments: AuditToolArguments;
  approvalId: string | null;
  approvalOutcome: 'approved' | 'denied' | null;
  outcome: AuditOutcome;
  outcomeDetail: string | null;
  requestedAt: string;
  completedAt: string | null;
  modelId: string;
  modelProvider: string;
  promptVersion: string;
};

export type GateDenyCategory =
  | 'schema_validation'
  | 'tool_not_allowed'
  | 'domain_invariant'
  | 'rate_limit';

export type GateOutcome =
  | { decision: 'allow'; toolName: string; toolCallId: string; requestId: string }
  | {
      decision: 'deny';
      toolName: string;
      toolCallId: string;
      requestId: string;
      category: GateDenyCategory;
      reason: string;
      technicalDetail?: string;
    }
  | { decision: 'require_approval'; toolName: string; toolCallId: string; requestId: string };

export type PolicyGateContext = {
  requestId: string;
  toolCallId: string;
  route: RouteDecision;
  toolName: string;
  args: Record<string, unknown>;
  demoState: DemoState;
  toolCallCounts: Record<string, number>;
  toolCatalog: ToolCatalog;
};

export type UserRole = 'customer' | 'support_admin';

export type UserSession = {
  customerId: string;
  customerName: string;
  role: UserRole;
  loginTimestamp: string;
};

export type AuthCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      checkType: 'bfla' | 'bola' | 'no_session';
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
  structuredAuditLog: StructuredAuditEntry[];
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
  approvalStatus: 'approved' | 'denied' | 'not_required' | 'pending' | 'gate_denied' | 'auth_denied';
  auditEntryId: string | null;
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
    | 'agent_response'
    | 'gate_allow'
    | 'gate_deny'
    | 'idempotency_block'
    | 'auth_denial';
  agentId?: string;
  data: Record<string, unknown>;
};

export type RunTrace = {
  id: string;
  requestId: string;
  startedAt: string;
  completedAt: string | null;
  userMessage: string;
  route: RouteDecision | null;
  entries: TraceEntry[];
  toolCalls: ToolCallTrace[];
  mismatches: MismatchAlert[];
  finalAnswer: string | null;
  stateChanges: Array<{ field: string; before: unknown; after: unknown }>;
  auditEntryIds: string[];
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
    requiredSequence?: string[];
    maxToolCalls?: number;
    approvalExpected: boolean;
    destructiveSideEffectAllowed: boolean;
    expectedMismatch: boolean;
  };
};

export type EvalScores = {
  routeMatch: boolean;
  requiredToolsCalled: boolean;
  forbiddenToolsAvoided: boolean;
  sequenceCorrect: boolean;
  noRedundantCalls: boolean;
  efficientPath: boolean;
  approvalCorrect: boolean;
  sideEffectCorrect: boolean;
  mismatchDetected: boolean;
};

export type LlmGraderRubricId =
  | 'clarification_quality'
  | 'policy_accuracy'
  | 'denial_clarity'
  | 'response_helpfulness';

export type LlmGraderResult = {
  rubricId: LlmGraderRubricId;
  pass: boolean;
  reasoning: string;
};

export type HumanReviewDimensionId =
  | 'naturalness'
  | 'helpfulness'
  | 'process_quality'
  | 'edge_case';

export type HumanReviewVerdict = 'pass' | 'fail' | 'skip';

export type HumanReviewDimension = {
  dimensionId: HumanReviewDimensionId;
  verdict: HumanReviewVerdict;
};

export type HumanReview = {
  caseId: string;
  dimensions: HumanReviewDimension[];
  notes: string;
  reviewedAt: string;
};

export type EvalResult = {
  caseId: string;
  passed: boolean;
  actualRoute: RouteDecision | null;
  actualTools: string[];
  scores: EvalScores;
  llmScores?: LlmGraderResult[];
  humanReview?: HumanReview;
  mismatchReason: string | null;
  trace: RunTrace;
  durationMs: number;
  error?: string;
};

// ── Idempotency ──

export type LedgerEntry = {
  idempotencyKey: string;
  toolName: string;
  semanticParams: Record<string, string>;
  cosmeticParams: Record<string, string>;
  executedAt: string;
  runId: string;
  toolCallId: string;
  result: unknown;
};

export type ToolCallLedger = {
  entries: LedgerEntry[];
  retentionMs: number;
};

export type IdempotencyCheckResult =
  | { status: 'allowed'; prunedLedger: ToolCallLedger }
  | {
      status: 'duplicate';
      idempotencyKey: string;
      originalEntry: LedgerEntry;
      prunedLedger: ToolCallLedger;
    };

// ── Settings ──

export type Provider = 'openai' | 'anthropic';

export type AppSettings = {
  provider: Provider;
  modelId: string;
  openaiApiKey: string;
  anthropicApiKey: string;
};

export type ApprovalRequest = {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  message: string;
};

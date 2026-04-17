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
    | 'auth_denial'
    | 'model_result';
  agentId?: string;
  data: Record<string, unknown>;
};

export type RolloutVariant = 'champion' | 'challenger';

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
  configSnapshotId?: string | null;
  variant?: RolloutVariant | null;
};

// ── Evals ──

export type EvalCategory =
  | 'positive_refund'
  | 'negative_refund'
  | 'lookup'
  | 'ambiguity'
  | 'policy_boundary'
  | 'auth_bola'
  | 'auth_bfla'
  | 'idempotency'
  | 'policy_gate';

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

    // Auth
    authContext?: { actorId: string; actorRole: 'customer' | 'admin' };
    expectedBolaOutcome?: 'allowed' | 'blocked';
    expectedBflaOutcome?: 'allowed' | 'blocked';

    // Policy Gate
    expectedPolicyGateDecision?: 'allow' | 'deny';
    expectedPolicyGateReason?: 'not_delivered' | 'already_refunded' | 'not_refundable' | 'deadline_passed';

    // Idempotency
    duplicateCallExpected?: boolean;
    idempotentToolName?: string;

    // Audit
    expectedAuditActions?: string[];
    requestIdConsistencyRequired?: boolean;
  };
  stateOverrides?: Partial<{
    orders: Partial<Order>[];
    customers: Partial<Customer>[];
    preSeedRefundEvents: RefundEvent[];
    preSeedAuditEntries: AuditLogEntry[];
  }>;
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
  auditEntryPresent: boolean;
  requestIdConsistent: boolean;
  policyGateCorrect: boolean;
  idempotencyRespected: boolean;
  bolaEnforced: boolean;
  bflaEnforced: boolean;
};

export type LlmGraderRubricId =
  | 'clarification_quality'
  | 'policy_accuracy'
  | 'denial_clarity'
  | 'response_helpfulness'
  | 'auth_denial_communication'
  | 'idempotency_transparency'
  | 'policy_gate_communication';

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

// ── Rollout ──

export type ConfigSnapshot = {
  id: string;
  createdAt: string;
  label: string;
  promptConfig: PromptConfig;
  toolCatalog: ToolCatalog;
  notes: string;
  toolDescriptionsHash: string;
};

export type ToolDescriptionIntegrityCheck = {
  pass: boolean;
  expectedHash: string;
  actualHash: string;
  changedTools: string[];
};

export type RolloutAuditAction =
  | 'snapshot_created'
  | 'snapshot_deleted'
  | 'champion_set'
  | 'challenger_set'
  | 'challenger_cleared'
  | 'shadow_run_completed'
  | 'canary_promoted'
  | 'kill_switch_toggled'
  | 'rolled_back_auto'
  | 'tool_description_drifted';

export type CanaryPercent = 0 | 5 | 25 | 50 | 100;

export type RolloutAuditEntry = {
  id: string;
  timestamp: string;
  actor: AuditActor;
  action: RolloutAuditAction;
  snapshotId: string | null;
  details: Record<string, unknown>;
};

export const DEFAULT_KILL_SWITCH_MESSAGE =
  'AI assistance is temporarily unavailable — a human agent will reach out.';

export type GuardrailMetricId =
  | 'mismatch_rate'
  | 'tool_error_rate'
  | 'latency_factor';

export type GuardrailThreshold = {
  threshold: number;
  window: number;
};

export type GuardrailConfig = Record<GuardrailMetricId, GuardrailThreshold>;

export type GuardrailSample = {
  requestId: string;
  timestamp: string;
  variant: RolloutVariant;
  mismatch: boolean;
  toolError: boolean;
  latencyMs: number;
};

export type GuardrailMetricEvaluation = {
  metric: GuardrailMetricId;
  value: number;
  threshold: number;
  window: number;
  sampleCount: number;
};

export type GuardrailBreach = GuardrailMetricEvaluation & {
  id: string;
  timestamp: string;
  previousCanaryPercent: CanaryPercent;
};

export type RolloutState = {
  snapshots: ConfigSnapshot[];
  championId: string | null;
  challengerId: string | null;
  canaryPercent: CanaryPercent;
  killSwitchActive: boolean;
  killSwitchMessage: string;
  auditLog: RolloutAuditEntry[];
  shadowRunHistory: ShadowRunResult[];
  guardrailConfig: GuardrailConfig;
  samples: GuardrailSample[];
  breachHistory: GuardrailBreach[];
};

export type DivergenceKind =
  | 'identical'
  | 'route_differs'
  | 'tool_calls_differ'
  | 'final_answer_differs'
  | 'both_failed'
  | 'champion_only_failed'
  | 'challenger_only_failed';

export type ShadowRunVariantOutcome = {
  route: RouteDecision | null;
  toolNames: string[];
  finalAnswer: string;
  mismatchCount: number;
  error: string | null;
};

export type ShadowRunCaseResult = {
  caseId: string;
  userMessage: string;
  champion: ShadowRunVariantOutcome;
  challenger: ShadowRunVariantOutcome;
  divergence: DivergenceKind;
};

export type ShadowRunResult = {
  id: string;
  startedAt: string;
  completedAt: string;
  championId: string;
  challengerId: string;
  caseResults: ShadowRunCaseResult[];
  totals: { identical: number; divergent: number; failed: number };
};

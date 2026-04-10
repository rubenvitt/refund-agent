import type { RunTrace, TraceEntry } from './types';

// ── OTel-compatible span model ──

export type SpanKind = 'agent' | 'llm' | 'tool';
export type SpanStatus = 'ok' | 'error' | 'unset';

export type OtelSpanEvent = {
  name: string;
  timestampMs: number;
  offsetMs: number; // ms after span start, for positioning
  attributes: Record<string, string | number | boolean>;
};

export type OtelSpan = {
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  startMs: number;
  endMs: number;
  durationMs: number;
  depth: number;
  offsetPct: number; // horizontal start as % of total trace duration
  widthPct: number; // horizontal width as % of total trace duration
  events: OtelSpanEvent[];
  attributes: Record<string, string | number | boolean>;
  sourceEntryIds: string[];
};

export type OtelSpanNode = {
  span: OtelSpan;
  children: OtelSpanNode[];
};

export type TraceMetrics = {
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  llmCallCount: number;
  toolCallCount: number;
  approvalWaitMs: number;
};

export type OtelSpanTree = {
  traceId: string;
  totalDurationMs: number;
  startMs: number;
  endMs: number;
  root: OtelSpanNode;
  flatSpans: OtelSpan[];
  metrics: TraceMetrics;
};

// ── Model pricing (USD per 1M tokens) ──

type ModelPrice = { inputPerMToken: number; outputPerMToken: number };

const MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o': { inputPerMToken: 2.5, outputPerMToken: 10 },
  'gpt-4o-mini': { inputPerMToken: 0.15, outputPerMToken: 0.6 },
  'gpt-4.1': { inputPerMToken: 2.0, outputPerMToken: 8.0 },
  'gpt-4.1-mini': { inputPerMToken: 0.4, outputPerMToken: 1.6 },
  'gpt-4.1-nano': { inputPerMToken: 0.1, outputPerMToken: 0.4 },
  'gpt-5.4-nano': { inputPerMToken: 0.1, outputPerMToken: 0.4 },
  'o3-mini': { inputPerMToken: 1.1, outputPerMToken: 4.4 },
  // Anthropic
  'claude-sonnet-4-5-20250514': { inputPerMToken: 3, outputPerMToken: 15 },
  'claude-haiku-3-5-20241022': { inputPerMToken: 0.8, outputPerMToken: 4 },
};

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  return (
    (inputTokens / 1_000_000) * price.inputPerMToken +
    (outputTokens / 1_000_000) * price.outputPerMToken
  );
}

// ── Internal pairing helpers ──

type ModelCallPair = {
  call: TraceEntry;
  result: TraceEntry | null;
};

type ToolCallPair = {
  call: TraceEntry;
  outcome: TraceEntry | null; // tool_result, gate_deny, auth_denial, or idempotency_block
  gateEntry: TraceEntry | null; // gate_allow or gate_deny
  approvalRequest: TraceEntry | null;
  approvalResponse: TraceEntry | null;
  stateChange: TraceEntry | null;
};

function pairModelEntries(entries: TraceEntry[]): ModelCallPair[] {
  const pairs: ModelCallPair[] = [];
  const resultsByCorrelation = new Map<string, TraceEntry>();

  for (const e of entries) {
    if (e.type === 'model_result' && e.data.correlationId) {
      resultsByCorrelation.set(e.data.correlationId as string, e);
    }
  }

  for (const e of entries) {
    if (e.type === 'model_call') {
      pairs.push({
        call: e,
        result: resultsByCorrelation.get(e.id) ?? null,
      });
    }
  }

  return pairs;
}

function pairToolEntries(entries: TraceEntry[]): ToolCallPair[] {
  const pairs: ToolCallPair[] = [];

  // Index all entries by toolCallId
  const byToolCallId = new Map<string, TraceEntry[]>();
  for (const e of entries) {
    const tcId = e.data.toolCallId as string | undefined;
    if (tcId) {
      const list = byToolCallId.get(tcId) ?? [];
      list.push(e);
      byToolCallId.set(tcId, list);
    }
  }

  for (const e of entries) {
    if (e.type !== 'tool_call') continue;
    const tcId = e.data.toolCallId as string;
    const related = byToolCallId.get(tcId) ?? [];

    pairs.push({
      call: e,
      outcome:
        related.find(
          (r) =>
            r.type === 'tool_result' ||
            r.type === 'gate_deny' ||
            r.type === 'auth_denial' ||
            r.type === 'idempotency_block',
        ) ?? null,
      gateEntry:
        related.find((r) => r.type === 'gate_allow' || r.type === 'gate_deny') ?? null,
      approvalRequest: related.find((r) => r.type === 'approval_request') ?? null,
      approvalResponse: related.find((r) => r.type === 'approval_response') ?? null,
      stateChange: null, // resolved below
    });
  }

  // Link state_change entries to the preceding tool_result by toolName
  const stateChanges = entries.filter((e) => e.type === 'state_change');
  for (const sc of stateChanges) {
    const toolName = sc.data.toolName as string;
    // Find the last tool pair with this toolName
    for (let i = pairs.length - 1; i >= 0; i--) {
      if ((pairs[i].call.data.toolName as string) === toolName && !pairs[i].stateChange) {
        pairs[i].stateChange = sc;
        break;
      }
    }
  }

  return pairs;
}

function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}

// ── Span builders ──

function buildRootSpan(trace: RunTrace, traceStartMs: number): OtelSpan {
  const endMs = trace.completedAt ? isoToMs(trace.completedAt) : Date.now();
  const events: OtelSpanEvent[] = [];

  // Mismatch alerts as events on root span
  for (const m of trace.mismatches) {
    events.push({
      name: 'mismatch.detected',
      timestampMs: endMs,
      offsetMs: endMs - traceStartMs,
      attributes: {
        'mismatch.type': m.type,
        'mismatch.message': m.message,
      },
    });
  }

  return {
    spanId: trace.requestId,
    parentSpanId: null,
    traceId: trace.requestId,
    name: `invoke_agent`,
    kind: 'agent',
    status: trace.mismatches.length > 0 ? 'error' : 'ok',
    startMs: traceStartMs,
    endMs,
    durationMs: endMs - traceStartMs,
    depth: 0,
    offsetPct: 0,
    widthPct: 100,
    events,
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'agent.route': trace.route ?? 'unknown',
      'request.id': trace.requestId,
      'session.id': trace.requestId, // best available identifier
    },
    sourceEntryIds: [],
  };
}

function buildChatSpan(
  pair: ModelCallPair,
  rootSpanId: string,
  traceId: string,
  traceStartMs: number,
  totalDurationMs: number,
): OtelSpan {
  const startMs = isoToMs(pair.call.timestamp);
  const data = pair.result?.data ?? {};
  const durationMs = (data.durationMs as number) ?? 0;
  const endMs = pair.result ? isoToMs(pair.result.timestamp) : startMs;
  const inputTokens = (data.inputTokens as number) ?? 0;
  const outputTokens = (data.outputTokens as number) ?? 0;
  const model = (pair.call.data.model as string) ?? '';
  const cost = estimateCost(model, inputTokens, outputTokens);

  return {
    spanId: pair.call.id,
    parentSpanId: rootSpanId,
    traceId,
    name: `chat ${(pair.call.data.purpose as string) ?? ''}`,
    kind: 'llm',
    status: 'ok',
    startMs,
    endMs,
    durationMs,
    depth: 1,
    offsetPct: totalDurationMs > 0 ? ((startMs - traceStartMs) / totalDurationMs) * 100 : 0,
    widthPct: totalDurationMs > 0 ? Math.max((durationMs / totalDurationMs) * 100, 0.5) : 100,
    events: [],
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': model,
      'gen_ai.usage.input_tokens': inputTokens,
      'gen_ai.usage.output_tokens': outputTokens,
      'gen_ai.response.finish_reasons': (data.finishReason as string) ?? 'unknown',
      ...(cost > 0 ? { 'cost.estimated_usd': Math.round(cost * 1_000_000) / 1_000_000 } : {}),
    },
    sourceEntryIds: [pair.call.id, ...(pair.result ? [pair.result.id] : [])],
  };
}

function buildToolSpan(
  pair: ToolCallPair,
  parentSpanId: string,
  traceId: string,
  traceStartMs: number,
  totalDurationMs: number,
): OtelSpan {
  const startMs = isoToMs(pair.call.timestamp);
  const endMs = pair.outcome ? isoToMs(pair.outcome.timestamp) : startMs;
  const durationMs = endMs - startMs;
  const toolName = pair.call.data.toolName as string;

  // Determine status
  let status: SpanStatus = 'ok';
  if (pair.outcome?.type === 'gate_deny' || pair.outcome?.type === 'auth_denial') {
    status = 'error';
  }

  // Build attributes
  const attributes: Record<string, string | number | boolean> = {
    'gen_ai.operation.name': 'execute_tool',
    'tool.name': toolName,
  };

  // Gate decision
  if (pair.gateEntry) {
    attributes['policy_gate.decision'] = pair.gateEntry.data.decision as string;
    if (pair.gateEntry.type === 'gate_deny') {
      attributes['policy_gate.category'] = pair.gateEntry.data.category as string;
      attributes['policy_gate.reason'] = pair.gateEntry.data.reason as string;
    }
  }

  // Auth denial
  if (pair.outcome?.type === 'auth_denial') {
    attributes['auth_gate.decision'] = 'denied';
    attributes['auth_gate.check_type'] = pair.outcome.data.checkType as string;
    attributes['auth_gate.reason'] = pair.outcome.data.reason as string;
  }

  // Idempotency block
  if (pair.outcome?.type === 'idempotency_block') {
    attributes['idempotency.blocked'] = true;
    attributes['idempotency.key'] = pair.outcome.data.idempotencyKey as string;
    attributes['idempotency.original_run_id'] = pair.outcome.data.originalRunId as string;
  }

  // Build events
  const events: OtelSpanEvent[] = [];

  if (pair.approvalRequest) {
    events.push({
      name: 'approval.requested',
      timestampMs: isoToMs(pair.approvalRequest.timestamp),
      offsetMs: isoToMs(pair.approvalRequest.timestamp) - startMs,
      attributes: {
        'tool.name': toolName,
      },
    });
  }

  if (pair.approvalResponse) {
    const approved = pair.approvalResponse.data.approved as boolean;
    events.push({
      name: approved ? 'approval.granted' : 'approval.denied',
      timestampMs: isoToMs(pair.approvalResponse.timestamp),
      offsetMs: isoToMs(pair.approvalResponse.timestamp) - startMs,
      attributes: {
        'approval.outcome': approved ? 'granted' : 'denied',
      },
    });
  }

  if (pair.stateChange) {
    events.push({
      name: 'state_change',
      timestampMs: isoToMs(pair.stateChange.timestamp),
      offsetMs: isoToMs(pair.stateChange.timestamp) - startMs,
      attributes: {
        'state.side_effects': JSON.stringify(pair.stateChange.data.sideEffects),
      },
    });
  }

  // Approval status from ToolCallTrace
  const approvalStatus = pair.approvalResponse
    ? (pair.approvalResponse.data.approved ? 'approved' : 'denied')
    : pair.approvalRequest
      ? 'pending'
      : 'not_required';
  attributes['tool.approval_status'] = approvalStatus;

  return {
    spanId: pair.call.data.toolCallId as string,
    parentSpanId,
    traceId,
    name: `execute_tool ${toolName}`,
    kind: 'tool',
    status,
    startMs,
    endMs,
    durationMs,
    depth: 1,
    offsetPct: totalDurationMs > 0 ? ((startMs - traceStartMs) / totalDurationMs) * 100 : 0,
    widthPct: totalDurationMs > 0 ? Math.max((durationMs / totalDurationMs) * 100, 0.5) : 100,
    events,
    attributes,
    sourceEntryIds: [...new Set([
      pair.call.id,
      ...(pair.outcome ? [pair.outcome.id] : []),
      ...(pair.gateEntry ? [pair.gateEntry.id] : []),
      ...(pair.approvalRequest ? [pair.approvalRequest.id] : []),
      ...(pair.approvalResponse ? [pair.approvalResponse.id] : []),
      ...(pair.stateChange ? [pair.stateChange.id] : []),
    ])],
  };
}

// ── Main transform function ──

export function buildOtelSpans(trace: RunTrace): OtelSpanTree {
  const traceStartMs = isoToMs(trace.startedAt);
  const traceEndMs = trace.completedAt ? isoToMs(trace.completedAt) : Date.now();
  const totalDurationMs = Math.max(traceEndMs - traceStartMs, 1); // avoid division by zero

  const rootSpan = buildRootSpan(trace, traceStartMs);
  const modelPairs = pairModelEntries(trace.entries);
  const toolPairs = pairToolEntries(trace.entries);

  const chatSpans = modelPairs.map((pair) =>
    buildChatSpan(pair, rootSpan.spanId, trace.requestId, traceStartMs, totalDurationMs),
  );

  // Find the enclosing chat span for each tool span (the most recent chat span before the tool call)
  const toolSpans = toolPairs.map((pair) => {
    const toolStartMs = isoToMs(pair.call.timestamp);
    // Find the last chat span that started before this tool call
    let parentId = rootSpan.spanId;
    for (let i = chatSpans.length - 1; i >= 0; i--) {
      if (chatSpans[i].startMs <= toolStartMs) {
        parentId = chatSpans[i].spanId;
        break;
      }
    }
    const span = buildToolSpan(pair, parentId, trace.requestId, traceStartMs, totalDurationMs);
    span.depth = parentId === rootSpan.spanId ? 1 : 2;
    return span;
  });

  // Compute metrics
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  for (const span of chatSpans) {
    totalInputTokens += (span.attributes['gen_ai.usage.input_tokens'] as number) ?? 0;
    totalOutputTokens += (span.attributes['gen_ai.usage.output_tokens'] as number) ?? 0;
    totalCost += (span.attributes['cost.estimated_usd'] as number) ?? 0;
  }

  // Compute approval wait time
  let approvalWaitMs = 0;
  for (const pair of toolPairs) {
    if (pair.approvalRequest && pair.approvalResponse) {
      approvalWaitMs +=
        isoToMs(pair.approvalResponse.timestamp) - isoToMs(pair.approvalRequest.timestamp);
    }
  }

  // Build tree and flatten in render order
  const allChildSpans = [...chatSpans, ...toolSpans].sort((a, b) => a.startMs - b.startMs);

  const root: OtelSpanNode = { span: rootSpan, children: [] };
  const nodeMap = new Map<string, OtelSpanNode>();
  nodeMap.set(rootSpan.spanId, root);

  for (const span of allChildSpans) {
    const node: OtelSpanNode = { span, children: [] };
    nodeMap.set(span.spanId, node);
  }

  for (const span of allChildSpans) {
    const node = nodeMap.get(span.spanId)!;
    const parentNode = nodeMap.get(span.parentSpanId ?? '') ?? root;
    parentNode.children.push(node);
  }

  // Flatten pre-order
  const flatSpans: OtelSpan[] = [];
  function flatten(node: OtelSpanNode) {
    flatSpans.push(node.span);
    for (const child of node.children) {
      flatten(child);
    }
  }
  flatten(root);

  return {
    traceId: trace.requestId,
    totalDurationMs,
    startMs: traceStartMs,
    endMs: traceEndMs,
    root,
    flatSpans,
    metrics: {
      totalInputTokens,
      totalOutputTokens,
      estimatedCostUsd: totalCost,
      llmCallCount: chatSpans.length,
      toolCallCount: toolSpans.length,
      approvalWaitMs,
    },
  };
}

import { describe, it, expect } from 'vitest';
import { buildOtelSpans } from '../otel-trace';
import type { RunTrace, TraceEntry } from '../types';

function makeEntry(
  overrides: Partial<TraceEntry> & Pick<TraceEntry, 'type'>,
): TraceEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    data: {},
    ...overrides,
  };
}

function makeTrace(overrides: Partial<RunTrace> = {}): RunTrace {
  const now = Date.now();
  return {
    id: 'req_test',
    requestId: 'req_test',
    startedAt: new Date(now).toISOString(),
    completedAt: new Date(now + 5000).toISOString(),
    userMessage: 'test message',
    route: 'refund',
    entries: [],
    toolCalls: [],
    mismatches: [],
    finalAnswer: 'test answer',
    stateChanges: [],
    auditEntryIds: [],
    ...overrides,
  };
}

describe('buildOtelSpans', () => {
  it('produces a root span for an empty trace', () => {
    const trace = makeTrace();
    const tree = buildOtelSpans(trace);

    expect(tree.traceId).toBe('req_test');
    expect(tree.flatSpans).toHaveLength(1);
    expect(tree.root.span.name).toBe('invoke_agent');
    expect(tree.root.span.kind).toBe('agent');
    expect(tree.root.span.depth).toBe(0);
    expect(tree.root.span.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(tree.root.span.attributes['agent.route']).toBe('refund');
  });

  it('creates a chat span from model_call + model_result pair', () => {
    const callId = crypto.randomUUID();
    const now = Date.now();

    const trace = makeTrace({
      startedAt: new Date(now).toISOString(),
      completedAt: new Date(now + 5000).toISOString(),
      entries: [
        makeEntry({
          id: callId,
          type: 'model_call',
          timestamp: new Date(now + 100).toISOString(),
          data: { purpose: 'orchestrator_routing', model: 'gpt-4o-mini' },
        }),
        makeEntry({
          type: 'model_result',
          timestamp: new Date(now + 600).toISOString(),
          data: {
            correlationId: callId,
            model: 'gpt-4o-mini',
            inputTokens: 150,
            outputTokens: 42,
            finishReason: 'tool-calls',
            durationMs: 500,
          },
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    // root + 1 chat span
    expect(tree.flatSpans).toHaveLength(2);

    const chatSpan = tree.flatSpans[1];
    expect(chatSpan.name).toBe('chat orchestrator_routing');
    expect(chatSpan.kind).toBe('llm');
    expect(chatSpan.depth).toBe(1);
    expect(chatSpan.attributes['gen_ai.operation.name']).toBe('chat');
    expect(chatSpan.attributes['gen_ai.request.model']).toBe('gpt-4o-mini');
    expect(chatSpan.attributes['gen_ai.usage.input_tokens']).toBe(150);
    expect(chatSpan.attributes['gen_ai.usage.output_tokens']).toBe(42);
    expect(chatSpan.attributes['gen_ai.response.finish_reasons']).toBe('tool-calls');
    expect(chatSpan.durationMs).toBe(500);
  });

  it('handles model_call without model_result (legacy trace)', () => {
    const now = Date.now();

    const trace = makeTrace({
      entries: [
        makeEntry({
          type: 'model_call',
          timestamp: new Date(now + 100).toISOString(),
          data: { purpose: 'refund_agent', model: 'gpt-4o' },
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    expect(tree.flatSpans).toHaveLength(2);

    const chatSpan = tree.flatSpans[1];
    expect(chatSpan.durationMs).toBe(0);
    expect(chatSpan.attributes['gen_ai.usage.input_tokens']).toBe(0);
  });

  it('creates a tool span from tool_call + tool_result pair', () => {
    const now = Date.now();
    const tcId = 'tc_test123';

    const trace = makeTrace({
      startedAt: new Date(now).toISOString(),
      completedAt: new Date(now + 5000).toISOString(),
      entries: [
        makeEntry({
          type: 'tool_call',
          timestamp: new Date(now + 200).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', arguments: { orderId: '4711' } },
          agentId: 'refund',
        }),
        makeEntry({
          type: 'gate_allow',
          timestamp: new Date(now + 210).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', decision: 'allow' },
          agentId: 'refund',
        }),
        makeEntry({
          type: 'tool_result',
          timestamp: new Date(now + 300).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', result: { success: true }, sideEffects: ['refunded'] },
          agentId: 'refund',
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    // root + 1 tool span
    expect(tree.flatSpans).toHaveLength(2);

    const toolSpan = tree.flatSpans[1];
    expect(toolSpan.name).toBe('execute_tool refund_order');
    expect(toolSpan.kind).toBe('tool');
    expect(toolSpan.status).toBe('ok');
    expect(toolSpan.attributes['gen_ai.operation.name']).toBe('execute_tool');
    expect(toolSpan.attributes['tool.name']).toBe('refund_order');
    expect(toolSpan.attributes['policy_gate.decision']).toBe('allow');
    expect(toolSpan.durationMs).toBe(100);
  });

  it('marks tool span as error on gate_deny', () => {
    const now = Date.now();
    const tcId = 'tc_deny1';

    const trace = makeTrace({
      entries: [
        makeEntry({
          type: 'tool_call',
          timestamp: new Date(now + 200).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', arguments: {} },
        }),
        makeEntry({
          type: 'gate_deny',
          timestamp: new Date(now + 210).toISOString(),
          data: {
            toolCallId: tcId,
            toolName: 'refund_order',
            decision: 'deny',
            category: 'domain_invariant',
            reason: 'Order not delivered',
          },
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    const toolSpan = tree.flatSpans.find((s) => s.kind === 'tool')!;
    expect(toolSpan.status).toBe('error');
    expect(toolSpan.attributes['policy_gate.decision']).toBe('deny');
    expect(toolSpan.attributes['policy_gate.category']).toBe('domain_invariant');
    expect(toolSpan.attributes['policy_gate.reason']).toBe('Order not delivered');
  });

  it('marks tool span as error on auth_denial', () => {
    const now = Date.now();
    const tcId = 'tc_auth1';

    const trace = makeTrace({
      entries: [
        makeEntry({
          type: 'tool_call',
          timestamp: new Date(now + 200).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', arguments: {} },
        }),
        makeEntry({
          type: 'auth_denial',
          timestamp: new Date(now + 210).toISOString(),
          data: {
            toolCallId: tcId,
            toolName: 'refund_order',
            checkType: 'bola',
            reason: 'Customer mismatch',
          },
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    const toolSpan = tree.flatSpans.find((s) => s.kind === 'tool')!;
    expect(toolSpan.status).toBe('error');
    expect(toolSpan.attributes['auth_gate.decision']).toBe('denied');
    expect(toolSpan.attributes['auth_gate.check_type']).toBe('bola');
  });

  it('adds approval events to tool span', () => {
    const now = Date.now();
    const tcId = 'tc_approval1';

    const trace = makeTrace({
      entries: [
        makeEntry({
          type: 'tool_call',
          timestamp: new Date(now + 200).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', arguments: {} },
        }),
        makeEntry({
          type: 'approval_request',
          timestamp: new Date(now + 250).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', arguments: {} },
        }),
        makeEntry({
          type: 'approval_response',
          timestamp: new Date(now + 5000).toISOString(),
          data: { toolCallId: tcId, approved: true },
        }),
        makeEntry({
          type: 'tool_result',
          timestamp: new Date(now + 5100).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', result: {}, sideEffects: [] },
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    const toolSpan = tree.flatSpans.find((s) => s.kind === 'tool')!;
    expect(toolSpan.events).toHaveLength(2);
    expect(toolSpan.events[0].name).toBe('approval.requested');
    expect(toolSpan.events[1].name).toBe('approval.granted');
    expect(tree.metrics.approvalWaitMs).toBe(4750);
  });

  it('adds mismatch events to root span', () => {
    const trace = makeTrace({
      mismatches: [
        { type: 'false_success', message: 'Claimed success but order not refunded', details: {} },
      ],
    });

    const tree = buildOtelSpans(trace);
    expect(tree.root.span.status).toBe('error');
    expect(tree.root.span.events).toHaveLength(1);
    expect(tree.root.span.events[0].name).toBe('mismatch.detected');
    expect(tree.root.span.events[0].attributes['mismatch.type']).toBe('false_success');
  });

  it('computes correct metrics', () => {
    const now = Date.now();
    const callId1 = crypto.randomUUID();
    const callId2 = crypto.randomUUID();

    const trace = makeTrace({
      startedAt: new Date(now).toISOString(),
      completedAt: new Date(now + 5000).toISOString(),
      entries: [
        makeEntry({
          id: callId1,
          type: 'model_call',
          timestamp: new Date(now + 100).toISOString(),
          data: { purpose: 'orchestrator_routing', model: 'gpt-4o-mini' },
        }),
        makeEntry({
          type: 'model_result',
          timestamp: new Date(now + 400).toISOString(),
          data: { correlationId: callId1, model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 20, finishReason: 'stop', durationMs: 300 },
        }),
        makeEntry({
          id: callId2,
          type: 'model_call',
          timestamp: new Date(now + 500).toISOString(),
          data: { purpose: 'refund_agent', model: 'gpt-4o-mini' },
        }),
        makeEntry({
          type: 'model_result',
          timestamp: new Date(now + 2000).toISOString(),
          data: { correlationId: callId2, model: 'gpt-4o-mini', inputTokens: 500, outputTokens: 80, finishReason: 'tool-calls', durationMs: 1500 },
        }),
        makeEntry({
          type: 'tool_call',
          timestamp: new Date(now + 2100).toISOString(),
          data: { toolCallId: 'tc1', toolName: 'lookup_order', arguments: {} },
        }),
        makeEntry({
          type: 'tool_result',
          timestamp: new Date(now + 2200).toISOString(),
          data: { toolCallId: 'tc1', toolName: 'lookup_order', result: {}, sideEffects: [] },
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    expect(tree.metrics.totalInputTokens).toBe(600);
    expect(tree.metrics.totalOutputTokens).toBe(100);
    expect(tree.metrics.llmCallCount).toBe(2);
    expect(tree.metrics.toolCallCount).toBe(1);
    expect(tree.metrics.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('nests tool spans under their enclosing chat span', () => {
    const now = Date.now();
    const callId = crypto.randomUUID();

    const trace = makeTrace({
      startedAt: new Date(now).toISOString(),
      completedAt: new Date(now + 5000).toISOString(),
      entries: [
        makeEntry({
          id: callId,
          type: 'model_call',
          timestamp: new Date(now + 500).toISOString(),
          data: { purpose: 'refund_agent', model: 'gpt-4o' },
        }),
        makeEntry({
          type: 'model_result',
          timestamp: new Date(now + 2000).toISOString(),
          data: { correlationId: callId, model: 'gpt-4o', inputTokens: 0, outputTokens: 0, finishReason: 'stop', durationMs: 1500 },
        }),
        makeEntry({
          type: 'tool_call',
          timestamp: new Date(now + 1000).toISOString(),
          data: { toolCallId: 'tc1', toolName: 'lookup_order', arguments: {} },
        }),
        makeEntry({
          type: 'tool_result',
          timestamp: new Date(now + 1100).toISOString(),
          data: { toolCallId: 'tc1', toolName: 'lookup_order', result: {}, sideEffects: [] },
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    const toolSpan = tree.flatSpans.find((s) => s.kind === 'tool')!;
    expect(toolSpan.parentSpanId).toBe(callId);
    expect(toolSpan.depth).toBe(2);
  });

  it('handles state_change events on tool spans', () => {
    const now = Date.now();
    const tcId = 'tc_sc1';

    const trace = makeTrace({
      entries: [
        makeEntry({
          type: 'tool_call',
          timestamp: new Date(now + 200).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', arguments: {} },
        }),
        makeEntry({
          type: 'tool_result',
          timestamp: new Date(now + 300).toISOString(),
          data: { toolCallId: tcId, toolName: 'refund_order', result: {}, sideEffects: ['refunded'] },
        }),
        makeEntry({
          type: 'state_change',
          timestamp: new Date(now + 310).toISOString(),
          data: { toolName: 'refund_order', sideEffects: ['refunded'] },
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    const toolSpan = tree.flatSpans.find((s) => s.kind === 'tool')!;
    const stateEvent = toolSpan.events.find((e) => e.name === 'state_change');
    expect(stateEvent).toBeDefined();
  });

  it('assigns correct offsetPct and widthPct', () => {
    const now = Date.now();
    const callId = crypto.randomUUID();

    const trace = makeTrace({
      startedAt: new Date(now).toISOString(),
      completedAt: new Date(now + 10000).toISOString(),
      entries: [
        makeEntry({
          id: callId,
          type: 'model_call',
          timestamp: new Date(now + 2000).toISOString(),
          data: { purpose: 'routing', model: 'gpt-4o' },
        }),
        makeEntry({
          type: 'model_result',
          timestamp: new Date(now + 4000).toISOString(),
          data: { correlationId: callId, model: 'gpt-4o', inputTokens: 0, outputTokens: 0, finishReason: 'stop', durationMs: 2000 },
        }),
      ],
    });

    const tree = buildOtelSpans(trace);
    const chatSpan = tree.flatSpans[1];
    // 2000ms offset in a 10000ms trace = 20%
    expect(chatSpan.offsetPct).toBe(20);
    // 2000ms duration in a 10000ms trace = 20%
    expect(chatSpan.widthPct).toBe(20);
  });
});

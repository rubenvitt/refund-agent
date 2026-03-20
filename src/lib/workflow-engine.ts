import { generateText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type {
  AppSettings,
  PromptConfig,
  ToolCatalog,
  DemoState,
  RouteDecision,
  RunTrace,
  TraceEntry,
  ToolCallTrace,
  MismatchAlert,
} from './types';
import { executeTool } from './tools';

type WorkflowInput = {
  userMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  settings: AppSettings;
  promptConfig: PromptConfig;
  toolCatalog: ToolCatalog;
  demoState: DemoState;
  pendingApproval?: { toolCallId: string; approved: boolean } | null;
};

type WorkflowResult = {
  finalAnswer: string;
  route: RouteDecision | null;
  trace: RunTrace;
  updatedState: DemoState;
  approvalRequest?: {
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    message: string;
  } | null;
};

function createModel(settings: AppSettings) {
  if (settings.provider === 'openai') {
    const openai = createOpenAI({ apiKey: settings.openaiApiKey });
    return openai(settings.modelId);
  } else {
    const anthropic = createAnthropic({ apiKey: settings.anthropicApiKey });
    return anthropic(settings.modelId);
  }
}

function addTraceEntry(
  entries: TraceEntry[],
  type: TraceEntry['type'],
  data: Record<string, unknown>,
  agentId?: string
): TraceEntry {
  const entry: TraceEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    data,
    ...(agentId ? { agentId } : {}),
  };
  entries.push(entry);
  return entry;
}

function getAgentInstructions(
  route: RouteDecision,
  promptConfig: PromptConfig
): string {
  switch (route) {
    case 'refund':
      return promptConfig.refundAgentInstructions;
    case 'lookup':
      return promptConfig.lookupAgentInstructions;
    case 'faq':
      return promptConfig.accountFaqAgentInstructions;
    case 'account':
      return promptConfig.accountFaqAgentInstructions;
    case 'clarify':
      return 'Ask the user to clarify their request. Be polite and specific about what information you need.';
  }
}

function getToolsForRoute(route: RouteDecision): string[] {
  switch (route) {
    case 'refund':
      return ['lookup_order', 'verify_customer', 'refund_order', 'faq_search'];
    case 'lookup':
      return ['lookup_order', 'faq_search'];
    case 'faq':
      return ['faq_search'];
    case 'account':
      return ['verify_customer', 'reset_password', 'faq_search'];
    case 'clarify':
      return [];
  }
}

/**
 * Build AI SDK tool definitions from the ToolCatalog, filtered to only the
 * tools this agent route is allowed to use.  We do NOT attach `execute`
 * handlers because we need to intercept calls for approval gating and
 * trace recording.
 */
function buildToolSchemas(
  toolCatalog: ToolCatalog,
  allowedToolNames: string[]
) {
  const toolDefs: Record<
    string,
    {
      description: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: z.ZodType<any>;
    }
  > = {};

  const toolMeta: Record<
    string,
    { requiresApproval: boolean; isDestructive: boolean }
  > = {};

  for (const td of toolCatalog.tools) {
    if (!allowedToolNames.includes(td.name)) continue;

    toolMeta[td.name] = {
      requiresApproval: td.requiresApproval,
      isDestructive: td.isDestructive,
    };

    switch (td.name) {
      case 'lookup_order':
        toolDefs[td.name] = {
          description: td.description,
          inputSchema: z.object({
            orderId: z.string().describe('The order ID to look up'),
          }),
        };
        break;
      case 'verify_customer':
        toolDefs[td.name] = {
          description: td.description,
          inputSchema: z.object({
            customerId: z.string().describe('The customer ID to verify'),
            email: z.string().describe('The email address to verify against'),
          }),
        };
        break;
      case 'refund_order':
        toolDefs[td.name] = {
          description: td.description,
          inputSchema: z.object({
            orderId: z.string().describe('The order ID to refund'),
            reason: z.string().describe('The reason for the refund'),
          }),
        };
        break;
      case 'faq_search':
        toolDefs[td.name] = {
          description: td.description,
          inputSchema: z.object({
            query: z.string().describe('The search query'),
          }),
        };
        break;
      case 'reset_password':
        toolDefs[td.name] = {
          description: td.description,
          inputSchema: z.object({
            email: z
              .string()
              .describe('The email address of the account to reset'),
          }),
        };
        break;
    }
  }

  return { toolDefs, toolMeta };
}

const REFUND_KEYWORDS = [
  'refund',
  'refunded',
  'erstattet',
  'zurückerstattet',
  'rückerstattung',
  'money back',
  'reimburse',
  'reimbursed',
  'credited back',
];

function detectMismatches(
  finalAnswer: string,
  toolCallTraces: ToolCallTrace[],
  originalState: DemoState,
  updatedState: DemoState
): MismatchAlert[] {
  const mismatches: MismatchAlert[] = [];
  const answerLower = finalAnswer.toLowerCase();

  const mentionsRefund = REFUND_KEYWORDS.some((kw) =>
    answerLower.includes(kw)
  );
  const refundToolCalled = toolCallTraces.some(
    (tc) =>
      tc.toolName === 'refund_order' &&
      tc.approvalStatus !== 'denied'
  );
  const refundToolExecuted = toolCallTraces.some(
    (tc) =>
      tc.toolName === 'refund_order' &&
      tc.approvalStatus !== 'denied' &&
      tc.approvalStatus !== 'pending'
  );

  // Check: answer claims refund but tool was never called
  if (mentionsRefund && !refundToolCalled) {
    // Only flag as false_success if the answer is affirmatively claiming a
    // refund was processed (not just mentioning the word "refund" in a
    // policy explanation or denial context).
    const affirmativeRefundPhrases = [
      'has been refunded',
      'have been refunded',
      'refund has been processed',
      'refund was processed',
      'successfully refunded',
      'issued a refund',
      'processed your refund',
      'refund is on its way',
      'wurde erstattet',
      'erstattung wurde',
    ];
    const claimsRefundDone = affirmativeRefundPhrases.some((phrase) =>
      answerLower.includes(phrase)
    );
    if (claimsRefundDone) {
      mismatches.push({
        type: 'false_success',
        message:
          'Agent claimed a refund was processed, but refund_order tool was never called.',
        details: {
          answerExcerpt: finalAnswer.substring(0, 200),
          toolsCalled: toolCallTraces.map((tc) => tc.toolName),
        },
      });
    }
  }

  // Check: refund tool was called but order state did not actually change
  if (refundToolExecuted) {
    const originalOrderStatuses = originalState.orders.map((o) => ({
      id: o.id,
      status: o.status,
      refundedAt: o.refundedAt,
    }));
    const updatedOrderStatuses = updatedState.orders.map((o) => ({
      id: o.id,
      status: o.status,
      refundedAt: o.refundedAt,
    }));

    const stateActuallyChanged =
      JSON.stringify(originalOrderStatuses) !==
      JSON.stringify(updatedOrderStatuses);

    if (!stateActuallyChanged) {
      mismatches.push({
        type: 'missing_side_effect',
        message:
          'refund_order tool was called but no order status change was detected in the state.',
        details: {
          originalOrders: originalOrderStatuses,
          updatedOrders: updatedOrderStatuses,
        },
      });
    }
  }

  return mismatches;
}

function computeStateChanges(
  original: DemoState,
  updated: DemoState
): Array<{ field: string; before: unknown; after: unknown }> {
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

  // Compare orders
  for (const updatedOrder of updated.orders) {
    const originalOrder = original.orders.find(
      (o) => o.id === updatedOrder.id
    );
    if (!originalOrder) continue;
    if (originalOrder.status !== updatedOrder.status) {
      changes.push({
        field: `orders.${updatedOrder.id}.status`,
        before: originalOrder.status,
        after: updatedOrder.status,
      });
    }
    if (originalOrder.refundedAt !== updatedOrder.refundedAt) {
      changes.push({
        field: `orders.${updatedOrder.id}.refundedAt`,
        before: originalOrder.refundedAt,
        after: updatedOrder.refundedAt,
      });
    }
  }

  // Compare refundEvents
  if (updated.refundEvents.length > original.refundEvents.length) {
    const newEvents = updated.refundEvents.slice(
      original.refundEvents.length
    );
    for (const evt of newEvents) {
      changes.push({
        field: 'refundEvents',
        before: null,
        after: evt,
      });
    }
  }

  // Compare auditLog
  if (updated.auditLog.length > original.auditLog.length) {
    const newEntries = updated.auditLog.slice(original.auditLog.length);
    for (const entry of newEntries) {
      changes.push({
        field: 'auditLog',
        before: null,
        after: entry,
      });
    }
  }

  return changes;
}

export async function runWorkflow(
  input: WorkflowInput
): Promise<WorkflowResult> {
  const {
    userMessage,
    conversationHistory,
    settings,
    promptConfig,
    toolCatalog,
    demoState,
    pendingApproval,
  } = input;

  const traceId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const traceEntries: TraceEntry[] = [];
  const toolCallTraces: ToolCallTrace[] = [];
  let currentState = demoState;
  let route: RouteDecision | null = null;
  let finalAnswer = '';
  let approvalRequest: WorkflowResult['approvalRequest'] = null;

  const model = createModel(settings);

  // Record user message
  addTraceEntry(traceEntries, 'user_message', {
    message: userMessage,
  });

  // ────────────────────────────────────────────
  // Step 1: Orchestrator routing
  // ────────────────────────────────────────────

  const routingMessages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }> = [];

  // Add conversation history for context
  for (const msg of conversationHistory) {
    routingMessages.push({ role: msg.role, content: msg.content });
  }

  routingMessages.push({ role: 'user', content: userMessage });

  addTraceEntry(traceEntries, 'model_call', {
    purpose: 'orchestrator_routing',
    model: settings.modelId,
  });

  try {
    const routingResult = await generateText({
      model,
      system: promptConfig.orchestratorInstructions,
      messages: routingMessages,
      tools: {
        route: tool({
          description: 'Decide which agent should handle this request',
          inputSchema: z.object({
            route: z.enum(['refund', 'lookup', 'faq', 'account', 'clarify']),
            reasoning: z.string(),
          }),
        }),
      },
      toolChoice: 'required' as const,
    });

    // Extract route from tool call
    const routeCall = routingResult.toolCalls.find(
      (tc) => tc.toolName === 'route'
    );

    if (routeCall) {
      const input = routeCall.input as {
        route: RouteDecision;
        reasoning: string;
      };
      route = input.route;

      addTraceEntry(traceEntries, 'route_decision', {
        route,
        reasoning: input.reasoning,
      });
    } else {
      // Fallback: try to infer route from text
      route = 'clarify';
      addTraceEntry(traceEntries, 'route_decision', {
        route,
        reasoning: 'No route tool call found, defaulting to clarify.',
      });
    }
  } catch (error) {
    // If routing fails, default to clarify
    route = 'clarify';
    addTraceEntry(traceEntries, 'route_decision', {
      route,
      reasoning: `Routing error: ${error instanceof Error ? error.message : String(error)}`,
      error: true,
    });
  }

  // ────────────────────────────────────────────
  // Step 2: Agent execution
  // ────────────────────────────────────────────

  if (route === 'clarify') {
    // No tool execution needed; just ask the LLM to produce a clarifying question
    addTraceEntry(traceEntries, 'model_call', {
      purpose: 'clarify_agent',
      model: settings.modelId,
    });

    try {
      const clarifyResult = await generateText({
        model,
        system: getAgentInstructions(route, promptConfig),
        messages: [
          ...conversationHistory.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user' as const, content: userMessage },
        ],
      });

      finalAnswer = clarifyResult.text;
    } catch (error) {
      finalAnswer =
        'I apologize, but I encountered an error. Could you please rephrase your request?';
      addTraceEntry(traceEntries, 'agent_response', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    // Determine which tools this agent route may use
    const allowedToolNames = getToolsForRoute(route);
    const { toolDefs, toolMeta } = buildToolSchemas(
      toolCatalog,
      allowedToolNames
    );

    const agentInstructions = getAgentInstructions(route, promptConfig);

    // Build AI SDK tools with execute handlers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiTools: Record<string, any> = {};

    // Track whether we need to pause for approval
    let needsApprovalPause = false;
    let pendingApprovalToolCallId: string | null = null;
    let pendingApprovalToolName: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pendingApprovalArgs: Record<string, any> | null = null;

    for (const [name, def] of Object.entries(toolDefs)) {
      const meta = toolMeta[name];

      aiTools[name] = {
        description: def.description,
        inputSchema: def.inputSchema,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execute: async (args: any) => {
          const toolCallId = crypto.randomUUID();
          const timestamp = new Date().toISOString();

          addTraceEntry(
            traceEntries,
            'tool_call',
            {
              toolCallId,
              toolName: name,
              arguments: args,
            },
            route!
          );

          // Check if this tool requires approval
          if (meta.requiresApproval) {
            if (pendingApproval) {
              // We have an approval response from the user
              if (pendingApproval.approved) {
                addTraceEntry(traceEntries, 'approval_response', {
                  toolCallId,
                  approved: true,
                });
                // Fall through to execute the tool below
              } else {
                addTraceEntry(traceEntries, 'approval_response', {
                  toolCallId,
                  approved: false,
                });

                const trace: ToolCallTrace = {
                  id: toolCallId,
                  toolName: name,
                  arguments: args,
                  result: { denied: true, message: 'Action denied by user.' },
                  timestamp,
                  approvalRequired: true,
                  approvalStatus: 'denied',
                };
                toolCallTraces.push(trace);

                return { denied: true, message: 'Action denied by user.' };
              }
            } else {
              // No approval yet - pause and request it
              needsApprovalPause = true;
              pendingApprovalToolCallId = toolCallId;
              pendingApprovalToolName = name;
              pendingApprovalArgs = args;

              addTraceEntry(traceEntries, 'approval_request', {
                toolCallId,
                toolName: name,
                arguments: args,
              });

              const trace: ToolCallTrace = {
                id: toolCallId,
                toolName: name,
                arguments: args,
                result: null,
                timestamp,
                approvalRequired: true,
                approvalStatus: 'pending',
              };
              toolCallTraces.push(trace);

              return {
                awaiting_approval: true,
                message:
                  'This action requires user approval before proceeding.',
              };
            }
          }

          // Execute the tool
          const toolResult = executeTool(name, currentState, args);
          currentState = toolResult.updatedState;

          addTraceEntry(
            traceEntries,
            'tool_result',
            {
              toolCallId,
              toolName: name,
              result: toolResult.result,
              sideEffects: toolResult.sideEffects,
            },
            route!
          );

          if (toolResult.sideEffects.length > 0) {
            addTraceEntry(traceEntries, 'state_change', {
              toolName: name,
              sideEffects: toolResult.sideEffects,
            });
          }

          const traceRecord: ToolCallTrace = {
            id: toolCallId,
            toolName: name,
            arguments: args,
            result: toolResult.result,
            timestamp,
            approvalRequired: meta.requiresApproval,
            approvalStatus: meta.requiresApproval
              ? 'approved'
              : 'not_required',
          };
          toolCallTraces.push(traceRecord);

          return toolResult.result;
        },
      };
    }

    // If we have a pending approval from a previous turn, we need to handle
    // it specially: re-execute the tool that was waiting for approval
    if (pendingApproval) {
      // Find the tool call trace that was pending
      // The previous turn should have stored the approval request info
      // We look for it in the previous conversation context
      // For now, execute the agent step normally - the approval will be
      // checked when the tool calls execute
    }

    addTraceEntry(traceEntries, 'model_call', {
      purpose: `${route}_agent`,
      model: settings.modelId,
      tools: Object.keys(aiTools),
    });

    try {
      const agentResult = await generateText({
        model,
        system: agentInstructions,
        messages: [
          ...conversationHistory.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user' as const, content: userMessage },
        ],
        tools: aiTools,
        stopWhen: stepCountIs(5),
      });

      finalAnswer = agentResult.text;

      // Record tool calls from all steps
      for (const step of agentResult.steps) {
        for (const tc of step.toolCalls) {
          // Check if already recorded by the execute handler
          const alreadyRecorded = toolCallTraces.some(
            (t) =>
              t.toolName === tc.toolName &&
              JSON.stringify(t.arguments) ===
                JSON.stringify(tc.input)
          );
          if (!alreadyRecorded) {
            toolCallTraces.push({
              id: tc.toolCallId,
              toolName: tc.toolName,
              arguments: tc.input as Record<string, unknown>,
              result: null,
              timestamp: new Date().toISOString(),
              approvalRequired: false,
              approvalStatus: 'not_required',
            });
          }
        }
      }

      // Check if we need to pause for approval
      if (needsApprovalPause && pendingApprovalToolCallId) {
        approvalRequest = {
          toolCallId: pendingApprovalToolCallId,
          toolName: pendingApprovalToolName!,
          arguments: pendingApprovalArgs ?? {},
          message: `The agent wants to execute "${pendingApprovalToolName}" with the provided arguments. This action requires your approval.`,
        };
        // Don't set finalAnswer yet since we're paused
        finalAnswer =
          finalAnswer ||
          'I need your approval before proceeding with this action.';
      }
    } catch (error) {
      finalAnswer = `I encountered an error while processing your request: ${error instanceof Error ? error.message : String(error)}`;
      addTraceEntry(traceEntries, 'agent_response', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ────────────────────────────────────────────
  // Step 3: Mismatch detection
  // ────────────────────────────────────────────

  const mismatches = detectMismatches(
    finalAnswer,
    toolCallTraces,
    demoState,
    currentState
  );

  for (const mm of mismatches) {
    addTraceEntry(traceEntries, 'mismatch_alert', {
      type: mm.type,
      message: mm.message,
      details: mm.details,
    });
  }

  // Record final answer
  addTraceEntry(traceEntries, 'agent_response', {
    answer: finalAnswer,
    route,
  });

  // Build state changes
  const stateChanges = computeStateChanges(demoState, currentState);

  const trace: RunTrace = {
    id: traceId,
    startedAt,
    completedAt: new Date().toISOString(),
    userMessage,
    route,
    entries: traceEntries,
    toolCalls: toolCallTraces,
    mismatches,
    finalAnswer,
    stateChanges,
  };

  return {
    finalAnswer,
    route,
    trace,
    updatedState: currentState,
    approvalRequest,
  };
}

import { NextRequest, NextResponse } from 'next/server';
import { runWorkflow } from '@/lib/workflow-engine';
import type { ChatRequestBody } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequestBody = await request.json();

    const apiKey =
      body.settings.provider === 'openai'
        ? body.settings.openaiApiKey
        : body.settings.anthropicApiKey;

    if (!apiKey) {
      return NextResponse.json(
        { error: `API key not configured for ${body.settings.provider}` },
        { status: 400 },
      );
    }

    const lastUserMessage =
      body.messages.filter((m) => m.role === 'user').pop()?.content ?? '';

    const result = await runWorkflow({
      userMessage: lastUserMessage,
      conversationHistory: body.messages.slice(0, -1),
      settings: body.settings,
      promptConfig: body.promptConfig,
      toolCatalog: body.toolCatalog,
      demoState: body.demoState,
      pendingApproval: body.pendingApproval,
    });

    return NextResponse.json({
      message: result.finalAnswer,
      trace: result.trace,
      updatedState: result.updatedState,
      approvalRequest: result.approvalRequest ?? null,
    });
  } catch (error) {
    console.error('Chat API error:', error instanceof Error ? error.message : 'Unknown');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

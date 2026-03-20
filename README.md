# Support Agent Reliability Lab

A focused reliability workbench that demonstrates why **a plausible assistant response is not proof that the right tool call or a real side effect occurred**.

Built for a blog post about AI evals, tool contracts, orchestration, and drift.

## What This Demonstrates

- **Orchestrator routing** — a central router delegates to specialized agents
- **Tool contracts** — each agent has defined tools with explicit schemas
- **Approval gates** — destructive actions (refund_order) require human approval
- **False success detection** — if the response claims "refunded" but no `refund_order` was executed, a mismatch alert fires
- **Tool description drift** — editable prompts/tool descriptions show how small changes break routing
- **Deterministic evals** — 20 seed cases scored on route, tools, approval, side effects, and mismatch detection

## Local-Only

API keys are stored in browser localStorage and sent per-request to local Next.js API routes. Keys are never logged or persisted server-side.

**Do not deploy this as-is.** It is a local demo tool.

## Getting Started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 and configure your API key in the **Settings** tab.

Supported providers: OpenAI, Anthropic.

## Project Structure

```
src/
├── app/
│   ├── api/chat/route.ts      # Chat endpoint (workflow engine)
│   ├── api/evals/route.ts     # Eval runner endpoint
│   ├── layout.tsx
│   └── page.tsx               # Main app shell with tabs
├── components/
│   ├── header.tsx              # App header with badges
│   ├── playground-tab.tsx      # Chat + live trace summary
│   ├── trace-tab.tsx           # Full trace timeline viewer
│   ├── evals-tab.tsx           # Eval runner + results table
│   ├── contracts-tab.tsx       # Editable prompts & tool catalog
│   ├── backend-state-tab.tsx   # Orders, customers, refund events
│   ├── settings-tab.tsx        # Provider & API key config
│   └── ui/                     # shadcn/ui components
└── lib/
    ├── types.ts                # All TypeScript types
    ├── seed-data.ts            # 10 demo orders, 3 customers
    ├── default-prompts.ts      # Agent instructions & tool catalog
    ├── eval-cases.ts           # 20 eval seed cases
    ├── tools.ts                # Pure tool functions over DemoState
    ├── workflow-engine.ts      # Orchestrator → Agent → Tools → Trace
    ├── eval-runner.ts          # Deterministic eval scoring
    ├── store.ts                # React context + localStorage persistence
    ├── hooks.ts                # useChat, useApproval, useEvalRunner
    └── __tests__/              # Vitest tests
```

## Seed Evals

20 cases in `src/lib/eval-cases.ts` across 5 categories:

| Category | Count | Examples |
|----------|-------|---------|
| Positive Refund | 4 | Refund USB-C cable (4711), late delivery webcam (4714) |
| Negative Refund | 4 | Expired deadline (4712), already refunded (4719), product info only |
| Lookup | 4 | Order status, delivery tracking |
| Ambiguity | 4 | Missing order number, unclear identity, vague multi-intent |
| Policy/Boundary | 4 | Return policy FAQ, password reset, contact info |

Scoring is fully deterministic: route match, required/forbidden tools, approval correctness, side effect validation, mismatch detection.

## Extending Prompts & Tool Descriptions

Use the **Contracts** tab to edit:
- Orchestrator instructions (routing logic)
- Agent instructions (refund, lookup, account/FAQ)
- Tool descriptions (simulate drift by changing tool semantics)

Changes apply immediately to the next run.

## Tests

```bash
pnpm test
```

Tests cover tool functions (refund validation, FAQ search, password reset) and eval scoring logic.

## Deferred / Out of Scope

- LLM-as-judge scoring (deterministic only in v1)
- Streaming responses (uses generateText, not streamText)
- Real database / persistence beyond localStorage
- Production auth, rate limiting, error recovery
- Mobile-responsive layout
- Multi-turn conversation memory across page reloads
- Parallel eval execution (sequential to avoid rate limits)

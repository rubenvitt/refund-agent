'use client';

import { useState, useRef, useEffect, type ComponentProps } from 'react';
import Markdown from 'react-markdown';
import {
  Send,
  Loader2,
  RotateCcw,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Bot,
  User,
  MessageSquare,
  Wrench,
  ArrowRightLeft,
  AlertOctagon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useAppState } from '@/lib/store';
import { useChat, useApproval } from '@/lib/hooks';

const PRESETS = [
  { label: 'Bestellung 4711 Status', message: 'Wo ist Bestellung 4711?' },
  {
    label: 'Ladekabel zurückgeben (4711)',
    message:
      'Ich möchte das USB-C Ladekabel aus Bestellung 4711 zurückgeben. Mein Name ist Max Mustermann.',
  },
  { label: 'Rückgabefrist?', message: 'Wie lang ist eure Rückgabefrist?' },
  {
    label: 'Passwort zurücksetzen',
    message: 'Passwort zurücksetzen. Meine E-Mail ist erika@example.com.',
  },
];

function routeColor(route: string | null): string {
  switch (route) {
    case 'refund':
      return 'bg-red-500/10 text-red-600 dark:text-red-400';
    case 'lookup':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    case 'faq':
      return 'bg-green-500/10 text-green-600 dark:text-green-400';
    case 'account':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
    case 'clarify':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function approvalStatusBadge(status: string) {
  switch (status) {
    case 'approved':
      return (
        <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
          <CheckCircle2 className="size-3" /> Approved
        </Badge>
      );
    case 'denied':
      return (
        <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
          <XCircle className="size-3" /> Denied
        </Badge>
      );
    case 'pending':
      return (
        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <Loader2 className="size-3 animate-spin" /> Pending
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          Not Required
        </Badge>
      );
  }
}

const mdComponents: ComponentProps<typeof Markdown>['components'] = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  code: ({ children, className }) => {
    const isBlock = className?.includes('language-');
    return isBlock ? (
      <pre className="my-2 overflow-auto rounded bg-black/10 p-2 font-mono text-xs dark:bg-white/10">
        <code>{children}</code>
      </pre>
    ) : (
      <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-xs dark:bg-white/10">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  a: ({ href, children }) => (
    <a href={href} className="underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 text-sm font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-current/20 pl-3 italic">{children}</blockquote>
  ),
};

export function PlaygroundTab() {
  const { state } = useAppState();
  const { sendMessage, resetChat, isLoading, error } = useChat();
  const {
    approve,
    deny,
    isLoading: approvalLoading,
    pendingApproval,
  } = useApproval();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastTrace =
    state.traces.length > 0 ? state.traces[0] : null;

  // Check for mismatch: response mentions refund but no refund_order tool was called
  const hasFalseSuccessMismatch =
    lastTrace &&
    lastTrace.mismatches.some((m) => m.type === 'false_success');

  const responseClaimsRefund =
    lastTrace?.finalAnswer &&
    /erstatt|refund|rückerstattet|zurückerstattet|gutgeschrieben/i.test(
      lastTrace.finalAnswer
    );
  const refundToolCalled =
    lastTrace?.toolCalls.some((tc) => tc.toolName === 'refund_order') ?? false;
  const showMismatchBanner =
    hasFalseSuccessMismatch || (responseClaimsRefund && !refundToolCalled);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.chatMessages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput('');
    sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full gap-4">
      {/* LEFT: Chat */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 min-w-0">
        {/* Approval Banner */}
        {pendingApproval && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex-1 space-y-2">
                <div className="font-medium text-amber-700 dark:text-amber-300">
                  Approval Required
                </div>
                <p className="text-sm text-muted-foreground">
                  {pendingApproval.message}
                </p>
                <div className="text-xs text-muted-foreground">
                  Tool:{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    {pendingApproval.toolName}
                  </code>
                </div>
                <pre className="max-h-24 overflow-auto rounded bg-muted p-2 font-mono text-xs">
                  {JSON.stringify(pendingApproval.arguments, null, 2)}
                </pre>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={approve}
                    disabled={approvalLoading}
                    className="bg-green-600 text-white hover:bg-green-700"
                  >
                    {approvalLoading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3" />
                    )}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={deny}
                    disabled={approvalLoading}
                  >
                    {approvalLoading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <XCircle className="size-3" />
                    )}
                    Deny
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Messages */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
          <ScrollArea className="h-full">
            <div ref={scrollRef} className="flex flex-col gap-3 p-4">
              {state.chatMessages.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
                  <MessageSquare className="size-10 opacity-30" />
                  <div>
                    <p className="font-medium">No messages yet</p>
                    <p className="text-xs">
                      Send a message or use a preset to get started.
                    </p>
                  </div>
                </div>
              )}
              {state.chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="size-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <Markdown components={mdComponents}>
                        {msg.content}
                      </Markdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary">
                      <User className="size-4 text-secondary-foreground" />
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="size-4 text-primary" />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Thinking...
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Presets */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => {
                setInput('');
                sendMessage(p.message);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
          <Button variant="outline" onClick={resetChat} disabled={isLoading}>
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </div>

      {/* RIGHT: Trace Summary + Side Effects */}
      <div className="flex min-h-0 w-[420px] shrink-0 flex-col gap-3 overflow-hidden">
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-3 pr-2">
            {/* Mismatch Banner */}
            {showMismatchBanner && (
              <Card className="border-red-500/50 bg-red-500/5">
                <CardContent className="flex items-start gap-3">
                  <AlertOctagon className="mt-0.5 size-6 shrink-0 text-red-600 dark:text-red-400" />
                  <div>
                    <div className="text-base font-bold text-red-600 dark:text-red-400">
                      MISMATCH DETECTED
                    </div>
                    <p className="mt-1 text-sm text-red-600/80 dark:text-red-400/80">
                      The agent response claims a refund was processed, but no{' '}
                      <code className="rounded bg-red-500/10 px-1 py-0.5 font-mono text-xs">
                        refund_order
                      </code>{' '}
                      tool was executed. This is a false success / hallucinated
                      side effect.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {!lastTrace ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
                <Wrench className="size-10 opacity-30" />
                <div>
                  <p className="font-medium">No trace yet</p>
                  <p className="text-xs">
                    Send a message to see the agent trace here.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Route */}
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ArrowRightLeft className="size-4" />
                      Route Decision
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge className={routeColor(lastTrace.route)}>
                      {lastTrace.route ?? 'none'}
                    </Badge>
                  </CardContent>
                </Card>

                {/* Tool Calls */}
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Wrench className="size-4" />
                      Tool Calls ({lastTrace.toolCalls.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {lastTrace.toolCalls.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No tool calls in this trace.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {lastTrace.toolCalls.map((tc) => (
                          <div
                            key={tc.id}
                            className="space-y-1.5 rounded-md border p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <code className="text-xs font-semibold">
                                {tc.toolName}
                              </code>
                              {approvalStatusBadge(tc.approvalStatus)}
                            </div>
                            <pre className="max-h-20 overflow-auto rounded bg-muted p-1.5 font-mono text-xs">
                              {JSON.stringify(tc.arguments, null, 2)}
                            </pre>
                            {tc.result !== undefined && (
                              <div>
                                <span className="text-xs font-medium text-muted-foreground">
                                  Result:
                                </span>
                                <pre className="mt-0.5 max-h-20 overflow-auto rounded bg-muted p-1.5 font-mono text-xs">
                                  {typeof tc.result === 'string'
                                    ? tc.result
                                    : JSON.stringify(tc.result, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Side Effects */}
                {lastTrace.stateChanges.length > 0 && (
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <ArrowRightLeft className="size-4" />
                        Side Effects ({lastTrace.stateChanges.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {lastTrace.stateChanges.map((sc, i) => (
                          <div
                            key={i}
                            className="rounded-md border p-2 text-xs"
                          >
                            <div className="font-medium">{sc.field}</div>
                            <div className="mt-1 flex gap-2">
                              <span className="text-muted-foreground">
                                Before:
                              </span>
                              <code className="font-mono">
                                {JSON.stringify(sc.before)}
                              </code>
                            </div>
                            <div className="flex gap-2">
                              <span className="text-muted-foreground">
                                After:
                              </span>
                              <code className="font-mono">
                                {JSON.stringify(sc.after)}
                              </code>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Mismatch Alerts */}
                {lastTrace.mismatches.length > 0 && (
                  <Card size="sm" className="border-red-500/30">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                        <AlertTriangle className="size-4" />
                        Mismatch Alerts ({lastTrace.mismatches.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {lastTrace.mismatches.map((m, i) => (
                          <div
                            key={i}
                            className="rounded-md border border-red-500/20 bg-red-500/5 p-2"
                          >
                            <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
                              {m.type.replace(/_/g, ' ')}
                            </Badge>
                            <p className="mt-1 text-xs">{m.message}</p>
                            {Object.keys(m.details).length > 0 && (
                              <pre className="mt-1 max-h-16 overflow-auto rounded bg-muted p-1.5 font-mono text-xs">
                                {JSON.stringify(m.details, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

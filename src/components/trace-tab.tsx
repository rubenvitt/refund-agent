'use client';

import { useState, useCallback } from 'react';
import {
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  MessageSquare,
  GitBranch,
  Cpu,
  Wrench,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  ArrowRightLeft,
  AlertTriangle,
  Bot,
  ScrollText,
  Ban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useAppState } from '@/lib/store';
import type { RunTrace, TraceEntry } from '@/lib/types';

function entryConfig(type: TraceEntry['type']) {
  switch (type) {
    case 'user_message':
      return {
        icon: MessageSquare,
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-500/10',
        label: 'User Message',
      };
    case 'route_decision':
      return {
        icon: GitBranch,
        color: 'text-purple-600 dark:text-purple-400',
        bg: 'bg-purple-500/10',
        label: 'Route Decision',
      };
    case 'model_call':
      return {
        icon: Cpu,
        color: 'text-gray-600 dark:text-gray-400',
        bg: 'bg-gray-500/10',
        label: 'Model Call',
      };
    case 'tool_call':
      return {
        icon: Wrench,
        color: 'text-indigo-600 dark:text-indigo-400',
        bg: 'bg-indigo-500/10',
        label: 'Tool Call',
      };
    case 'tool_result':
      return {
        icon: CheckCircle2,
        color: 'text-green-600 dark:text-green-400',
        bg: 'bg-green-500/10',
        label: 'Tool Result',
      };
    case 'approval_request':
      return {
        icon: ShieldAlert,
        color: 'text-orange-600 dark:text-orange-400',
        bg: 'bg-orange-500/10',
        label: 'Approval Request',
      };
    case 'approval_response':
      return {
        icon: ShieldAlert,
        color: 'text-orange-600 dark:text-orange-400',
        bg: 'bg-orange-500/10',
        label: 'Approval Response',
      };
    case 'state_change':
      return {
        icon: ArrowRightLeft,
        color: 'text-yellow-600 dark:text-yellow-400',
        bg: 'bg-yellow-500/10',
        label: 'State Change',
      };
    case 'mismatch_alert':
      return {
        icon: AlertTriangle,
        color: 'text-red-600 dark:text-red-400',
        bg: 'bg-red-500/10',
        label: 'Mismatch Alert',
      };
    case 'agent_response':
      return {
        icon: Bot,
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-500/10',
        label: 'Agent Response',
      };
    case 'gate_allow':
      return {
        icon: ShieldCheck,
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-500/10',
        label: 'Gate Allow',
      };
    case 'gate_deny':
      return {
        icon: ShieldX,
        color: 'text-red-600 dark:text-red-400',
        bg: 'bg-red-500/10',
        label: 'Gate Deny',
      };
    case 'idempotency_block':
      return {
        icon: Ban,
        color: 'text-violet-600 dark:text-violet-400',
        bg: 'bg-violet-500/10',
        label: 'Idempotency Block',
      };
    default:
      return {
        icon: Cpu,
        color: 'text-gray-600 dark:text-gray-400',
        bg: 'bg-gray-500/10',
        label: type,
      };
  }
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function TraceCard({ trace }: { trace: RunTrace }) {
  const [expanded, setExpanded] = useState(false);

  const copyJson = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
  }, [trace]);

  const downloadJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(trace, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trace-${trace.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [trace]);

  const routeColor = (route: string | null) => {
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
  };

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <Clock className="size-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {formatTime(trace.startedAt)}
              </span>
              <Badge className={routeColor(trace.route)}>
                {trace.route ?? 'none'}
              </Badge>
              {trace.mismatches.length > 0 && (
                <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
                  <AlertTriangle className="size-3" />
                  {trace.mismatches.length} mismatch
                  {trace.mismatches.length > 1 ? 'es' : ''}
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium leading-snug">
              {trace.userMessage}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={copyJson}
              title="Copy trace as JSON"
            >
              <Copy className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={downloadJson}
              title="Download trace as JSON"
            >
              <Download className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent>
          <div className="relative space-y-0">
            {/* Timeline line */}
            <div className="absolute top-0 bottom-0 left-[11px] w-px bg-border" />

            {trace.entries.map((entry, i) => {
              const config = entryConfig(entry.type);
              const Icon = config.icon;
              return (
                <div key={entry.id} className="relative flex gap-3 pb-3">
                  <div
                    className={`z-10 flex size-6 shrink-0 items-center justify-center rounded-full ${config.bg}`}
                  >
                    <Icon className={`size-3 ${config.color}`} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-medium ${config.color}`}
                      >
                        {config.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(entry.timestamp)}
                      </span>
                      {entry.agentId && (
                        <Badge variant="outline" className="text-[10px]">
                          {entry.agentId}
                        </Badge>
                      )}
                    </div>
                    {entry.type === 'gate_deny' ? (
                      (() => {
                        const d = entry.data as Record<string, unknown>;
                        return (
                          <div className="space-y-1 rounded bg-red-500/5 border border-red-500/20 p-1.5 text-xs">
                            <div className="flex items-center gap-1.5">
                              <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 text-[10px]">
                                {String(d.category)}
                              </Badge>
                              <span className="font-medium text-red-600 dark:text-red-400">
                                {String(d.toolName)}
                              </span>
                            </div>
                            <p className="text-red-600/80 dark:text-red-400/80">
                              {String(d.reason)}
                            </p>
                            {d.technicalDetail ? (
                              <pre className="mt-1 max-h-16 overflow-auto rounded bg-muted p-1 font-mono text-[10px] text-muted-foreground">
                                {String(d.technicalDetail)}
                              </pre>
                            ) : null}
                          </div>
                        );
                      })()
                    ) : Object.keys(entry.data).length > 0 ? (
                      <pre className="max-h-24 overflow-auto rounded bg-muted p-1.5 font-mono text-xs">
                        {JSON.stringify(entry.data, null, 2)}
                      </pre>
                    ) : null}
                    {entry.type === 'tool_call' && (() => {
                      const tc = trace.toolCalls.find(
                        (t) => t.id === (entry.data as Record<string, unknown>).toolCallId
                      );
                      return tc?.auditEntryId ? (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">
                            {tc.auditEntryId}
                          </span>
                          <span>Audit Record</span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
              );
            })}
          </div>

          {trace.finalAnswer && (
            <>
              <Separator className="my-2" />
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Final Answer
                </span>
                <p className="text-sm">{trace.finalAnswer}</p>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function TraceTab() {
  const { state } = useAppState();

  const exportAll = useCallback(() => {
    const blob = new Blob([JSON.stringify(state.traces, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-traces-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.traces]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">
            Trace Timeline
          </h2>
          <Badge variant="secondary">{state.traces.length}</Badge>
        </div>
        {state.traces.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportAll}>
            <Download className="size-3.5" />
            Export All
          </Button>
        )}
      </div>

      <div>
        <div className="space-y-3">
          {state.traces.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-muted-foreground">
              <ScrollText className="size-12 opacity-20" />
              <div>
                <p className="font-medium">No traces recorded</p>
                <p className="text-xs">
                  Traces will appear here after you interact with the agent in
                  the Playground.
                </p>
              </div>
            </div>
          ) : (
            state.traces.map((trace) => (
              <TraceCard key={trace.id} trace={trace} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

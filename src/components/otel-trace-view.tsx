'use client';

import { useState, useMemo } from 'react';
import {
  Clock,
  Cpu,
  Wrench,
  Bot,
  DollarSign,
  Zap,
  ShieldAlert,
  AlertTriangle,
  ArrowRightLeft,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { buildOtelSpans } from '@/lib/otel-trace';
import type { OtelSpan, OtelSpanEvent, OtelSpanTree, TraceMetrics } from '@/lib/otel-trace';
import type { RunTrace } from '@/lib/types';

// ── Color helpers ──

function spanBarColor(span: OtelSpan): string {
  if (span.status === 'error') return 'bg-red-500';
  switch (span.kind) {
    case 'llm':
      return 'bg-blue-500';
    case 'tool':
      return 'bg-green-500';
    case 'agent':
      return 'bg-gray-400 dark:bg-gray-500';
  }
}

function spanBarBgColor(span: OtelSpan): string {
  if (span.status === 'error') return 'bg-red-500/10';
  switch (span.kind) {
    case 'llm':
      return 'bg-blue-500/10';
    case 'tool':
      return 'bg-green-500/10';
    case 'agent':
      return 'bg-gray-500/10';
  }
}

function spanTextColor(span: OtelSpan): string {
  if (span.status === 'error') return 'text-red-600 dark:text-red-400';
  switch (span.kind) {
    case 'llm':
      return 'text-blue-600 dark:text-blue-400';
    case 'tool':
      return 'text-green-600 dark:text-green-400';
    case 'agent':
      return 'text-gray-600 dark:text-gray-400';
  }
}

function spanIcon(span: OtelSpan) {
  if (span.status === 'error') return AlertTriangle;
  switch (span.kind) {
    case 'llm':
      return Cpu;
    case 'tool':
      return Wrench;
    case 'agent':
      return Bot;
  }
}

function eventIcon(event: OtelSpanEvent) {
  if (event.name.startsWith('approval.')) return ShieldAlert;
  if (event.name === 'state_change') return ArrowRightLeft;
  if (event.name === 'mismatch.detected') return AlertTriangle;
  return Zap;
}

function eventColor(event: OtelSpanEvent): string {
  if (event.name.startsWith('approval.')) return 'text-orange-500';
  if (event.name === 'mismatch.detected') return 'text-red-500';
  if (event.name === 'state_change') return 'text-yellow-500';
  return 'text-gray-500';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

// ── Metrics Header ──

function WaterfallMetrics({ metrics, totalDurationMs }: { metrics: TraceMetrics; totalDurationMs: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      <Badge className="bg-gray-500/10 text-gray-600 dark:text-gray-400">
        <Clock className="size-3" />
        {formatDuration(totalDurationMs)}
      </Badge>
      <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
        <Cpu className="size-3" />
        {metrics.totalInputTokens.toLocaleString()} in / {metrics.totalOutputTokens.toLocaleString()} out
      </Badge>
      {metrics.estimatedCostUsd > 0 && (
        <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
          <DollarSign className="size-3" />
          {formatCost(metrics.estimatedCostUsd)}
        </Badge>
      )}
      <Badge variant="secondary">
        {metrics.llmCallCount} LLM · {metrics.toolCallCount} Tool
      </Badge>
      {metrics.approvalWaitMs > 0 && (
        <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400">
          <ShieldAlert className="size-3" />
          {formatDuration(metrics.approvalWaitMs)} approval wait
        </Badge>
      )}
    </div>
  );
}

// ── Event Marker ──

function EventMarker({ event, spanDurationMs }: { event: OtelSpanEvent; spanDurationMs: number }) {
  const leftPct = spanDurationMs > 0 ? (event.offsetMs / spanDurationMs) * 100 : 50;
  const Icon = eventIcon(event);

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10', eventColor(event))}
        style={{ left: `${Math.min(Math.max(leftPct, 2), 98)}%` }}
      >
        <Icon className="size-3" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">{event.name}</p>
          {Object.entries(event.attributes).map(([k, v]) => (
            <p key={k} className="text-[10px] opacity-80">
              {k}: {String(v)}
            </p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Span Row ──

function SpanRow({
  span,
  isSelected,
  onSelect,
}: {
  span: OtelSpan;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const Icon = spanIcon(span);
  const indent = span.depth * 20;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group grid w-full grid-cols-[minmax(180px,_1fr)_2fr] items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/50',
        isSelected && 'bg-muted',
      )}
    >
      {/* Label column */}
      <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: indent }}>
        <div className={cn('flex size-5 shrink-0 items-center justify-center rounded-full', spanBarBgColor(span))}>
          <Icon className={cn('size-2.5', spanTextColor(span))} />
        </div>
        <span className={cn('truncate text-xs font-medium', spanTextColor(span))}>
          {span.name}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatDuration(span.durationMs)}
        </span>
      </div>

      {/* Bar column */}
      <div className="relative h-6 w-full rounded bg-muted/30">
        {/* Span bar */}
        <div
          className={cn('absolute inset-y-0 rounded', spanBarColor(span), 'opacity-80')}
          style={{
            left: `${span.offsetPct}%`,
            width: `${Math.max(span.widthPct, 0.5)}%`,
          }}
        >
          {/* Events as markers on the bar */}
          {span.events.map((event) => (
            <EventMarker key={`${event.name}-${event.timestampMs}`} event={event} spanDurationMs={span.durationMs} />
          ))}
        </div>
      </div>
    </button>
  );
}

// ── Span Detail Panel ──

function SpanDetail({ span, traceStartMs }: { span: OtelSpan; traceStartMs: number }) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <span className={cn('text-sm font-medium', spanTextColor(span))}>
          {span.name}
        </span>
        <Badge variant="outline" className="text-[10px]">{span.kind}</Badge>
        <Badge
          className={cn(
            'text-[10px]',
            span.status === 'error'
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : 'bg-green-500/10 text-green-600 dark:text-green-400',
          )}
        >
          {span.status}
        </Badge>
      </div>

      {/* Timing */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Duration</span>
          <p className="font-mono font-medium">{formatDuration(span.durationMs)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Offset</span>
          <p className="font-mono font-medium">{formatDuration(span.startMs - traceStartMs)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Span ID</span>
          <p className="font-mono font-medium truncate">{span.spanId.slice(0, 12)}…</p>
        </div>
      </div>

      {/* Attributes */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Attributes</p>
        <div className="max-h-48 overflow-auto rounded bg-muted p-2">
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(span.attributes).map(([key, value]) => (
                <tr key={key} className="border-b border-border/30 last:border-0">
                  <td className="py-0.5 pr-3 font-mono text-muted-foreground whitespace-nowrap">{key}</td>
                  <td className="py-0.5 font-mono break-all">{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Events */}
      {span.events.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Events ({span.events.length})</p>
          <div className="space-y-1">
            {span.events.map((event, i) => {
              const EvIcon = eventIcon(event);
              return (
                <div key={i} className="flex items-start gap-2 rounded bg-muted p-1.5 text-xs">
                  <EvIcon className={cn('size-3 mt-0.5 shrink-0', eventColor(event))} />
                  <div className="min-w-0">
                    <span className="font-medium">{event.name}</span>
                    <span className="ml-2 text-muted-foreground">+{formatDuration(event.offsetMs)}</span>
                    {Object.keys(event.attributes).length > 0 && (
                      <pre className="mt-0.5 font-mono text-[10px] text-muted-foreground truncate">
                        {Object.entries(event.attributes).map(([k, v]) => `${k}=${v}`).join(', ')}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Time Ruler ──

function TimeRuler({ totalDurationMs }: { totalDurationMs: number }) {
  const ticks = 5;
  const tickLabels = Array.from({ length: ticks + 1 }, (_, i) => {
    const ms = (i / ticks) * totalDurationMs;
    return formatDuration(ms);
  });

  return (
    <div className="grid grid-cols-[minmax(180px,_1fr)_2fr] gap-3 px-2 pb-1">
      <div />
      <div className="relative flex h-4 items-end justify-between text-[10px] text-muted-foreground">
        {tickLabels.map((label, i) => (
          <span key={i} className="leading-none">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──

export function OtelTraceView({ trace }: { trace: RunTrace }) {
  const tree = useMemo(() => buildOtelSpans(trace), [trace]);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const selectedSpan = selectedSpanId
    ? tree.flatSpans.find((s) => s.spanId === selectedSpanId) ?? null
    : null;

  const handleSelect = (spanId: string) => {
    if (selectedSpanId === spanId) {
      setDetailOpen(!detailOpen);
    } else {
      setSelectedSpanId(spanId);
      setDetailOpen(true);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <WaterfallMetrics metrics={tree.metrics} totalDurationMs={tree.totalDurationMs} />
        <TimeRuler totalDurationMs={tree.totalDurationMs} />
        <div className="space-y-0.5">
          {tree.flatSpans.map((span) => (
            <div key={span.spanId}>
              <SpanRow
                span={span}
                isSelected={selectedSpanId === span.spanId}
                onSelect={() => handleSelect(span.spanId)}
              />
              {selectedSpanId === span.spanId && detailOpen && selectedSpan && (
                <div className="ml-2 mt-1 mb-1">
                  <SpanDetail span={selectedSpan} traceStartMs={tree.startMs} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

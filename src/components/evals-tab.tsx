'use client';

import {
  Play,
  RotateCw,
  CheckCircle2,
  XCircle,
  Loader2,

  BarChart3,
  ChevronDown,
  ChevronRight,
  Code2,
  BrainCircuit,
  UserRoundPen,
  MessageSquarePlus,
  Save,
  Minus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import React, { useState, type ComponentProps } from 'react';
import Markdown from 'react-markdown';
import { useEvalRunner } from '@/lib/hooks';
import { evalCases } from '@/lib/eval-cases';
import type {
  EvalCategory,
  EvalResult,
  EvalScores,
  LlmGraderResult,
  HumanReview,
  HumanReviewDimensionId,
  HumanReviewVerdict,
} from '@/lib/types';
import { LLM_RUBRICS } from '@/lib/llm-grader';
import { useAppState } from '@/lib/store';

const mdComponents: ComponentProps<typeof Markdown>['components'] = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="mb-1.5 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[10px] dark:bg-white/10">
      {children}
    </code>
  ),
  pre: ({ children }) => <>{children}</>,
};

function categoryColor(cat: string) {
  switch (cat) {
    case 'positive_refund':
      return 'bg-green-500/10 text-green-600 dark:text-green-400';
    case 'negative_refund':
      return 'bg-red-500/10 text-red-600 dark:text-red-400';
    case 'lookup':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    case 'ambiguity':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'policy_boundary':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function categoryLabel(cat: string) {
  switch (cat) {
    case 'positive_refund':
      return 'Positive Refund';
    case 'negative_refund':
      return 'Negative Refund';
    case 'lookup':
      return 'Lookup';
    case 'ambiguity':
      return 'Ambiguity';
    case 'policy_boundary':
      return 'Policy';
    default:
      return cat;
  }
}

function ScoreCheck({ pass, label }: { pass: boolean; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex">
        {pass ? (
          <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" />
        ) : (
          <XCircle className="size-3.5 text-red-600 dark:text-red-400" />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ScoreBreakdown({ scores }: { scores: EvalScores }) {
  return (
    <div className="flex items-center gap-1">
      <ScoreCheck pass={scores.routeMatch} label="Route Match" />
      <ScoreCheck pass={scores.requiredToolsCalled} label="Required Tools Called" />
      <ScoreCheck pass={scores.forbiddenToolsAvoided} label="Forbidden Tools Avoided" />
      <ScoreCheck pass={scores.sequenceCorrect} label="Sequence Correct" />
      <ScoreCheck pass={scores.noRedundantCalls} label="No Redundant Calls" />
      <ScoreCheck pass={scores.efficientPath} label="Efficient Path" />
      <ScoreCheck pass={scores.approvalCorrect} label="Approval Correct" />
      <ScoreCheck pass={scores.sideEffectCorrect} label="Side Effect Correct" />
      <ScoreCheck pass={scores.mismatchDetected} label="Mismatch Detected" />
    </div>
  );
}

function LlmScoreBreakdown({ llmScores }: { llmScores?: LlmGraderResult[] }) {
  if (!llmScores || llmScores.length === 0) {
    return <span className="text-[10px] text-muted-foreground">--</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {llmScores.map((s) => {
        const rubric = LLM_RUBRICS.find((r) => r.id === s.rubricId);
        return (
          <Tooltip key={s.rubricId}>
            <TooltipTrigger className="inline-flex">
              {s.pass ? (
                <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle className="size-3.5 text-red-600 dark:text-red-400" />
              )}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="font-medium">{rubric?.label ?? s.rubricId}</div>
              <div className="mt-0.5 text-xs opacity-80">{s.reasoning}</div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

const HUMAN_DIMENSIONS: {
  id: HumanReviewDimensionId;
  label: string;
  type: string;
  description: string;
}[] = [
  {
    id: 'naturalness',
    label: 'Natürlichkeit',
    type: 'subjektiv',
    description: 'Wirkt die Antwort natürlich und nicht roboterhaft?',
  },
  {
    id: 'helpfulness',
    label: 'Hilfreichheit',
    type: 'subjektiv',
    description: 'Hilft die Antwort dem Kunden wirklich weiter?',
  },
  {
    id: 'process_quality',
    label: 'Prozess-Qualität',
    type: 'trajectory',
    description: 'War der Weg effizient und nachvollziehbar?',
  },
  {
    id: 'edge_case',
    label: 'Grenzfall-Entdeckung',
    type: 'discovery',
    description: 'Fällt ein neuer Failure Mode oder Grenzfall auf?',
  },
];

function VerdictToggle({
  verdict,
  onChange,
}: {
  verdict: HumanReviewVerdict;
  onChange: (v: HumanReviewVerdict) => void;
}) {
  const opts: { value: HumanReviewVerdict; icon: React.ReactNode; color: string }[] = [
    {
      value: 'pass',
      icon: <CheckCircle2 className="size-3.5" />,
      color: verdict === 'pass' ? 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30' : '',
    },
    {
      value: 'fail',
      icon: <XCircle className="size-3.5" />,
      color: verdict === 'fail' ? 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30' : '',
    },
    {
      value: 'skip',
      icon: <Minus className="size-3.5" />,
      color: verdict === 'skip' ? 'bg-muted text-muted-foreground border-border' : '',
    },
  ];
  return (
    <div className="flex gap-0.5">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center rounded-md border px-1.5 py-1 transition-colors ${
            o.color || 'border-transparent text-muted-foreground/40 hover:text-muted-foreground'
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

function HumanReviewPanel({
  caseId,
  agentResponse,
  toolCalls,
  route,
  existingReview,
  onSave,
}: {
  caseId: string;
  agentResponse: string;
  toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }>;
  route: string | null;
  existingReview?: HumanReview;
  onSave: (review: HumanReview) => void;
}) {
  const [dimensions, setDimensions] = useState<
    Record<HumanReviewDimensionId, HumanReviewVerdict>
  >(() => {
    const defaults: Record<HumanReviewDimensionId, HumanReviewVerdict> = {
      naturalness: 'skip',
      helpfulness: 'skip',
      process_quality: 'skip',
      edge_case: 'skip',
    };
    if (existingReview) {
      for (const d of existingReview.dimensions) {
        defaults[d.dimensionId] = d.verdict;
      }
    }
    return defaults;
  });
  const [notes, setNotes] = useState(existingReview?.notes ?? '');

  const handleSave = () => {
    onSave({
      caseId,
      dimensions: HUMAN_DIMENSIONS.map((d) => ({
        dimensionId: d.id,
        verdict: dimensions[d.id],
      })),
      notes,
      reviewedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card/50 p-3">
      <div className="space-y-1">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Agent-Antwort
        </div>
        <div className="max-h-24 overflow-y-auto rounded-md bg-muted/50 p-2 text-xs leading-relaxed">
          <Markdown components={mdComponents}>{agentResponse}</Markdown>
        </div>
      </div>
      {toolCalls.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Trajectory
          </div>
          <div className="flex items-center gap-1 rounded-md bg-muted/50 p-2">
            {route && (
              <Badge variant="outline" className="text-[10px]">
                {route}
              </Badge>
            )}
            {route && toolCalls.length > 0 && (
              <span className="text-[10px] text-muted-foreground">&rarr;</span>
            )}
            {toolCalls.map((tc, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="text-[10px] text-muted-foreground">&rarr;</span>
                )}
                <Tooltip>
                  <TooltipTrigger>
                    <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">
                      {tc.toolName}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <pre className="font-mono text-[10px]">
                      {JSON.stringify(tc.arguments, null, 2)}
                    </pre>
                  </TooltipContent>
                </Tooltip>
              </React.Fragment>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {toolCalls.length} {toolCalls.length === 1 ? 'call' : 'calls'}
            </span>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {HUMAN_DIMENSIONS.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-medium">{d.label}</span>
              <span className="ml-1.5 text-[10px] text-muted-foreground">{d.description}</span>
            </div>
            <VerdictToggle
              verdict={dimensions[d.id]}
              onChange={(v) => setDimensions((prev) => ({ ...prev, [d.id]: v }))}
            />
          </div>
        ))}
      </div>
      <div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notizen, neue Failure Modes, Kalibrierungs-Feedback..."
          rows={2}
          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <Button size="sm" onClick={handleSave} className="text-xs">
        <Save className="size-3" />
        Speichern
      </Button>
    </div>
  );
}

const CODE_GRADERS: {
  key: keyof EvalScores;
  label: string;
  type: string;
  description: string;
}[] = [
  {
    key: 'routeMatch',
    label: 'Route Match',
    type: 'exact match',
    description: 'Orchestrator routet an den richtigen Sub-Agenten',
  },
  {
    key: 'requiredToolsCalled',
    label: 'Required Tools',
    type: 'set inclusion',
    description: 'Alle erwarteten Tools wurden aufgerufen',
  },
  {
    key: 'forbiddenToolsAvoided',
    label: 'Forbidden Tools',
    type: 'set exclusion',
    description: 'Kein verbotenes Tool wurde aufgerufen',
  },
  {
    key: 'sequenceCorrect',
    label: 'Sequence',
    type: 'ordering',
    description: 'Tools in vorgeschriebener Reihenfolge aufgerufen',
  },
  {
    key: 'noRedundantCalls',
    label: 'No Redundant Calls',
    type: 'trajectory',
    description: 'Kein Tool mit identischen Argumenten doppelt aufgerufen',
  },
  {
    key: 'efficientPath',
    label: 'Efficient Path',
    type: 'trajectory',
    description: 'Anzahl Tool-Calls innerhalb des Step-Budgets',
  },
  {
    key: 'approvalCorrect',
    label: 'Approval Gate',
    type: 'state check',
    description: 'Destruktive Aktionen fordern Bestätigung an',
  },
  {
    key: 'sideEffectCorrect',
    label: 'Side Effects',
    type: 'state diff',
    description: 'Zustand ändert sich nur wenn erlaubt',
  },
  {
    key: 'mismatchDetected',
    label: 'Mismatch Detection',
    type: 'post-hoc',
    description: 'False-success und missing-side-effect erkannt',
  },
];

const ALL_CATEGORIES: { value: EvalCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'positive_refund', label: 'Positive Refund' },
  { value: 'negative_refund', label: 'Negative Refund' },
  { value: 'lookup', label: 'Lookup' },
  { value: 'ambiguity', label: 'Ambiguity' },
  { value: 'policy_boundary', label: 'Policy' },
];

export function EvalsTab() {
  const { runAll, runByCategory, runSingle, isRunning, progress, results } = useEvalRunner();
  const { dispatch } = useAppState();
  const [activeFilter, setActiveFilter] = useState<EvalCategory | 'all'>('all');
  const [showGraders, setShowGraders] = useState(false);
  const [showLlmGraders, setShowLlmGraders] = useState(false);
  const [showHumanGraders, setShowHumanGraders] = useState(false);
  const [reviewingCaseId, setReviewingCaseId] = useState<string | null>(null);

  const filteredCases =
    activeFilter === 'all'
      ? evalCases
      : evalCases.filter((ec) => ec.category === activeFilter);

  const filteredResults =
    activeFilter === 'all'
      ? results
      : results.filter((r) => {
          const ec = evalCases.find((c) => c.id === r.caseId);
          return ec?.category === activeFilter;
        });

  const passed = filteredResults.filter((r) => r.passed).length;
  const failed = filteredResults.filter((r) => !r.passed).length;
  const total = filteredResults.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  // Create a lookup from caseId to evalCase for expectations
  const caseMap = new Map(evalCases.map((c) => [c.id, c]));

  // Create a lookup from caseId to result
  const resultMap = new Map(results.map((r) => [r.caseId, r]));

  return (
    <div className="flex flex-col gap-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-xs font-medium text-muted-foreground">Total Cases</div>
            <div className="mt-1 text-2xl font-bold">{total > 0 ? total : filteredCases.length}</div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-xs font-medium text-muted-foreground">Passed</div>
            <div className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
              {passed}
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-xs font-medium text-muted-foreground">Failed</div>
            <div className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{failed}</div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-xs font-medium text-muted-foreground">Pass Rate</div>
            <div className="mt-1 text-2xl font-bold">
              {total > 0 ? `${passRate}%` : '--'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grader Reference */}
      <div>
        <button
          type="button"
          onClick={() => setShowGraders((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showGraders ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <Code2 className="size-3.5" />
          <span className="font-medium">Code-Grader</span>
          <span className="tabular-nums">({CODE_GRADERS.length})</span>
        </button>
        {showGraders && (
          <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {CODE_GRADERS.map((g) => (
              <div
                key={g.key}
                className="group flex flex-col gap-1.5 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{g.label}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {g.type}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {g.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LLM Grader Reference */}
      <div>
        <button
          type="button"
          onClick={() => setShowLlmGraders((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showLlmGraders ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <BrainCircuit className="size-3.5" />
          <span className="font-medium">LLM-Grader</span>
          <span className="tabular-nums">({LLM_RUBRICS.length})</span>
        </button>
        {showLlmGraders && (
          <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {LLM_RUBRICS.map((r) => (
              <div
                key={r.id}
                className="group flex flex-col gap-1.5 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{r.label}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {r.type}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {r.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {r.appliesTo.map((cat) => (
                    <span
                      key={cat}
                      className={`rounded-full px-1.5 py-0.5 text-[9px] ${categoryColor(cat)}`}
                    >
                      {categoryLabel(cat)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Human Grader Reference */}
      <div>
        <button
          type="button"
          onClick={() => setShowHumanGraders((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showHumanGraders ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <UserRoundPen className="size-3.5" />
          <span className="font-medium">Human-Grader</span>
          <span className="tabular-nums">({HUMAN_DIMENSIONS.length})</span>
        </button>
        {showHumanGraders && (
          <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
            {HUMAN_DIMENSIONS.map((d) => (
              <div
                key={d.id}
                className="group flex flex-col gap-1.5 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{d.label}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {d.type}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {d.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ALL_CATEGORIES.map((cat) => {
          const count =
            cat.value === 'all'
              ? evalCases.length
              : evalCases.filter((ec) => ec.category === cat.value).length;
          return (
            <Button
              key={cat.value}
              variant={activeFilter === cat.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter(cat.value)}
              className="text-xs"
            >
              {cat.label} ({count})
            </Button>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => {
            if (activeFilter === 'all') {
              runAll();
            } else {
              runByCategory(activeFilter);
            }
          }}
          disabled={isRunning}
        >
          {isRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {activeFilter === 'all'
            ? `Run All (${evalCases.length} cases)`
            : `Run ${categoryLabel(activeFilter)} (${filteredCases.length} cases)`}
        </Button>
        {isRunning && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${
                    progress.total > 0
                      ? (progress.current / progress.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
            {progress.current}/{progress.total}
          </div>
        )}
      </div>

      {/* Table */}
      <div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Case</TableHead>
                <TableHead className="w-[110px]">Category</TableHead>
                <TableHead className="min-w-[180px]">Message</TableHead>
                <TableHead className="w-[70px]">Result</TableHead>
                <TableHead className="w-[120px]">Route (E / A)</TableHead>
                <TableHead className="w-[160px]">Tools (E / A)</TableHead>
                <TableHead className="w-[130px]">Code</TableHead>
                <TableHead className="w-[100px]">LLM</TableHead>
                <TableHead className="w-[80px]">Human</TableHead>
                <TableHead className="min-w-[120px]">Mismatch</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCases.map((ec) => {
                const result = resultMap.get(ec.id);
                return (
                  <React.Fragment key={ec.id}>
                  <TableRow>
                    <TableCell>
                      <code className="text-xs">{ec.id}</code>
                    </TableCell>
                    <TableCell>
                      <Badge className={categoryColor(ec.category)}>
                        {categoryLabel(ec.category)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span
                        className="block max-w-[240px] truncate text-xs"
                        title={ec.userMessage}
                      >
                        {ec.userMessage}
                      </span>
                    </TableCell>
                    <TableCell>
                      {result ? (
                        result.passed ? (
                          <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="size-3" /> Pass
                          </Badge>
                        ) : (
                          <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
                            <XCircle className="size-3" /> Fail
                          </Badge>
                        )
                      ) : (
                        <Badge variant="secondary">--</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs">
                        <Badge variant="outline" className="text-[10px]">
                          {ec.expectations.expectedRoute}
                        </Badge>
                        <span className="text-muted-foreground">/</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            result &&
                            result.actualRoute !== ec.expectations.expectedRoute
                              ? 'border-red-500/30 text-red-600 dark:text-red-400'
                              : ''
                          }`}
                        >
                          {result?.actualRoute ?? '--'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5 text-[10px]">
                        <div className="text-muted-foreground">
                          E:{' '}
                          {ec.expectations.requiredTools.length > 0
                            ? ec.expectations.requiredTools.join(', ')
                            : 'none'}
                        </div>
                        <div
                          className={
                            result &&
                            !result.scores.requiredToolsCalled
                              ? 'text-red-600 dark:text-red-400'
                              : ''
                          }
                        >
                          A:{' '}
                          {result
                            ? result.actualTools.length > 0
                              ? result.actualTools.join(', ')
                              : 'none'
                            : '--'}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {result ? (
                        <ScoreBreakdown scores={result.scores} />
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {result ? (
                        <LlmScoreBreakdown llmScores={result.llmScores} />
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {result ? (
                        result.humanReview ? (
                          <Tooltip>
                            <TooltipTrigger
                              className="inline-flex items-center gap-1"
                              onClick={() =>
                                setReviewingCaseId(
                                  reviewingCaseId === ec.id ? null : ec.id
                                )
                              }
                            >
                                {result.humanReview.dimensions
                                  .filter((d) => d.verdict !== 'skip')
                                  .map((d) => (
                                    <span key={d.dimensionId} className="inline-flex">
                                      {d.verdict === 'pass' ? (
                                        <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" />
                                      ) : (
                                        <XCircle className="size-3.5 text-red-600 dark:text-red-400" />
                                      )}
                                    </span>
                                  ))}
                                {result.humanReview.dimensions.every(
                                  (d) => d.verdict === 'skip'
                                ) && (
                                  <Badge variant="outline" className="text-[10px]">
                                    reviewed
                                  </Badge>
                                )}
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              {result.humanReview.notes || 'Klicken zum Bearbeiten'}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() =>
                              setReviewingCaseId(
                                reviewingCaseId === ec.id ? null : ec.id
                              )
                            }
                            title="Review hinzufügen"
                          >
                            <MessageSquarePlus className="size-3 text-muted-foreground" />
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {result?.mismatchReason ? (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          {result.mismatchReason}
                        </span>
                      ) : result?.error ? (
                        <span className="text-xs text-destructive">
                          {result.error}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => runSingle(ec.id)}
                        disabled={isRunning}
                        title="Rerun this case"
                      >
                        <RotateCw className="size-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {reviewingCaseId === ec.id && result?.trace?.finalAnswer && (
                    <TableRow>
                      <TableCell colSpan={11} className="p-2">
                        <HumanReviewPanel
                          caseId={ec.id}
                          agentResponse={result.trace.finalAnswer}
                          toolCalls={result.trace.toolCalls.map((tc) => ({
                            toolName: tc.toolName,
                            arguments: tc.arguments,
                          }))}
                          route={result.trace.route}
                          existingReview={result.humanReview}
                          onSave={(review) => {
                            dispatch({ type: 'SET_HUMAN_REVIEW', payload: review });
                            setReviewingCaseId(null);
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
      </div>
    </div>
  );
}

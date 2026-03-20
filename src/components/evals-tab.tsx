'use client';

import {
  Play,
  RotateCw,
  CheckCircle2,
  XCircle,
  Loader2,
  FlaskConical,
  BarChart3,
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
import { useEvalRunner } from '@/lib/hooks';
import { evalCases } from '@/lib/eval-cases';
import type { EvalResult, EvalScores } from '@/lib/types';

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
      <ScoreCheck pass={scores.approvalCorrect} label="Approval Correct" />
      <ScoreCheck pass={scores.sideEffectCorrect} label="Side Effect Correct" />
      <ScoreCheck pass={scores.mismatchDetected} label="Mismatch Detected" />
    </div>
  );
}

export function EvalsTab() {
  const { runAll, runSingle, isRunning, progress, results } = useEvalRunner();

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
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
            <div className="mt-1 text-2xl font-bold">{total > 0 ? total : evalCases.length}</div>
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

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={runAll} disabled={isRunning}>
          {isRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          Run All ({evalCases.length} cases)
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
        {results.length === 0 && !isRunning ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-muted-foreground">
            <FlaskConical className="size-12 opacity-20" />
            <div>
              <p className="font-medium">No eval results yet</p>
              <p className="text-xs">
                Click &quot;Run All&quot; to execute the eval suite against the
                current configuration.
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Case</TableHead>
                <TableHead className="w-[110px]">Category</TableHead>
                <TableHead className="min-w-[180px]">Message</TableHead>
                <TableHead className="w-[70px]">Result</TableHead>
                <TableHead className="w-[120px]">Route (E / A)</TableHead>
                <TableHead className="w-[160px]">Tools (E / A)</TableHead>
                <TableHead className="w-[130px]">Scores</TableHead>
                <TableHead className="min-w-[120px]">Mismatch</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {evalCases.map((ec) => {
                const result = resultMap.get(ec.id);
                return (
                  <TableRow key={ec.id}>
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
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

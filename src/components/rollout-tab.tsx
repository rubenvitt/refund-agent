'use client';

import { useEffect, useState } from 'react';
import {
  Rocket,
  ShieldCheck,
  Crown,
  Swords,
  Trash2,
  Gauge,
  PowerOff,
  History,
  Play,
  AlertTriangle,
  CircleCheck,
  CircleX,
  CircleDashed,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useAppState, useRollout } from '@/lib/store';
import { runShadow, type ShadowRunProgress } from '@/lib/shadow-runner';
import { evalCases } from '@/lib/eval-cases';
import { checkToolDescriptionIntegrity } from '@/lib/graders/tool-description-pin';
import {
  championBaseline,
  evaluateMetric,
} from '@/lib/rollout-guardrails';
import type {
  ConfigSnapshot,
  DivergenceKind,
  GuardrailBreach,
  GuardrailMetricId,
  RolloutAuditEntry,
  ShadowRunResult,
  ToolDescriptionIntegrityCheck,
} from '@/lib/types';

function snapshotDisplayId(id: string): string {
  return id.slice(0, 10);
}

function formatActor(entry: RolloutAuditEntry): string {
  switch (entry.actor.type) {
    case 'user':
      return 'user';
    case 'agent':
      return `agent:${entry.actor.agentId}`;
    case 'system':
      return `system:${entry.actor.component}`;
  }
}

function StatusHeader({
  champion,
  challenger,
  canaryPercent,
  killSwitchActive,
}: {
  champion: ConfigSnapshot | null;
  challenger: ConfigSnapshot | null;
  canaryPercent: number;
  killSwitchActive: boolean;
}) {
  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Crown className="size-3" /> Champion
          </div>
          <div className="text-sm font-medium">
            {champion ? (
              champion.label
            ) : (
              <span className="text-muted-foreground">none</span>
            )}
          </div>
          {champion && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {snapshotDisplayId(champion.id)}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Swords className="size-3" /> Challenger
          </div>
          <div className="text-sm font-medium">
            {challenger ? (
              challenger.label
            ) : (
              <span className="text-muted-foreground">none</span>
            )}
          </div>
          {challenger && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {snapshotDisplayId(challenger.id)}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="size-3" /> Canary
          </div>
          <div className="text-sm font-medium">{canaryPercent}%</div>
          <div className="text-[10px] text-muted-foreground">
            routing controls arrive in Phase 3
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PowerOff className="size-3" /> Kill Switch
          </div>
          <Badge
            className={
              killSwitchActive
                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            }
          >
            {killSwitchActive ? 'ACTIVE' : 'off'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

const DIVERGENCE_LABEL: Record<DivergenceKind, string> = {
  identical: 'identical',
  route_differs: 'route differs',
  tool_calls_differ: 'tool calls differ',
  final_answer_differs: 'final answer differs',
  both_failed: 'both failed',
  champion_only_failed: 'champion failed',
  challenger_only_failed: 'challenger failed',
};

function DivergenceBadge({ kind }: { kind: DivergenceKind }) {
  if (kind === 'identical') {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="size-3" />
        identical
      </Badge>
    );
  }
  if (kind === 'both_failed' || kind.endsWith('_only_failed')) {
    return (
      <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
        <CircleX className="size-3" />
        {DIVERGENCE_LABEL[kind]}
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
      <CircleDashed className="size-3" />
      {DIVERGENCE_LABEL[kind]}
    </Badge>
  );
}

function ShadowRunPanel({
  champion,
  challenger,
  lastRun,
  historyCount,
  isRunning,
  progress,
  liveRun,
  onStart,
  onClear,
}: {
  champion: ConfigSnapshot | null;
  challenger: ConfigSnapshot | null;
  lastRun: ShadowRunResult | null;
  historyCount: number;
  isRunning: boolean;
  progress: ShadowRunProgress | null;
  liveRun: ShadowRunResult | null;
  onStart: () => void;
  onClear: () => void;
}) {
  const disabled = !champion || !challenger || isRunning;
  const disabledReason =
    !champion || !challenger
      ? 'Set both Champion and Challenger to start.'
      : null;
  const displayRun = liveRun ?? lastRun;
  const pct =
    progress && progress.totalCases > 0
      ? Math.round((progress.completedCases / progress.totalCases) * 100)
      : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Play className="size-4 text-muted-foreground" />
          Shadow Run
          <Badge className="bg-muted text-muted-foreground">
            history {historyCount}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onStart} disabled={disabled}>
            {isRunning ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {isRunning ? 'Running…' : `Start (${evalCases.length} cases)`}
          </Button>
          {(lastRun || historyCount > 0) && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              <Trash2 className="size-3.5" />
              Clear history
            </Button>
          )}
          {disabledReason && (
            <span className="text-xs text-muted-foreground">
              {disabledReason}
            </span>
          )}
        </div>

        {isRunning && progress && (
          <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span>
                Case {progress.completedCases + (progress.currentVariant === 'challenger' ? 1 : 0)}
                {' / '}
                {progress.totalCases} · running {progress.currentVariant} on{' '}
                <span className="font-mono">{progress.currentCaseId}</span>
              </span>
              <span className="font-medium">{pct}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {displayRun ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                identical {displayRun.totals.identical}
              </Badge>
              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                divergent {displayRun.totals.divergent}
              </Badge>
              <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
                failed {displayRun.totals.failed}
              </Badge>
              <span className="font-mono text-[10px] text-muted-foreground">
                {displayRun.id} · {isRunning ? 'in progress' : new Date(displayRun.completedAt).toLocaleString()}
              </span>
            </div>
            <ScrollArea className="max-h-72">
              <div className="space-y-1">
                {displayRun.caseResults.map((r) => (
                  <div
                    key={r.caseId}
                    className="rounded-md border px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <DivergenceBadge kind={r.divergence} />
                      <span className="font-mono">{r.caseId}</span>
                      <span className="flex-1 truncate text-muted-foreground">
                        {r.userMessage}
                      </span>
                    </div>
                    {r.divergence !== 'identical' && (
                      <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-muted-foreground">
                            champion:{' '}
                          </span>
                          <span className="font-mono">
                            {r.champion.error
                              ? `error: ${r.champion.error}`
                              : `${r.champion.route ?? '—'} · ${r.champion.toolNames.join(', ') || '∅'}`}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            challenger:{' '}
                          </span>
                          <span className="font-mono">
                            {r.challenger.error
                              ? `error: ${r.challenger.error}`
                              : `${r.challenger.route ?? '—'} · ${r.challenger.toolNames.join(', ') || '∅'}`}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            No shadow run yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IntegrityBanner({
  check,
}: {
  check: ToolDescriptionIntegrityCheck | null;
}) {
  if (!check || check.pass) return null;
  return (
    <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-3.5" />
        Tool-description drift on Champion
      </div>
      <div className="mt-1">
        Current catalog hash differs from the snapshot. Changed tools:{' '}
        <span className="font-mono">{check.changedTools.join(', ') || '—'}</span>
        . Review in the Contracts tab before shipping.
      </div>
    </div>
  );
}

const CANARY_STEPS: Array<0 | 5 | 25 | 50 | 100> = [0, 5, 25, 50, 100];

function CanaryControl({
  canaryPercent,
  hasChampion,
  hasChallenger,
  onChange,
}: {
  canaryPercent: number;
  hasChampion: boolean;
  hasChallenger: boolean;
  onChange: (pct: 0 | 5 | 25 | 50 | 100) => void;
}) {
  const gating = !hasChampion
    ? 'Set a Champion to control canary traffic.'
    : !hasChallenger
      ? 'Set a Challenger to route above 0%.'
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4 text-muted-foreground" />
          Canary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {CANARY_STEPS.map((pct) => {
            const active = pct === canaryPercent;
            const disabled = !hasChampion || (pct > 0 && !hasChallenger);
            return (
              <Button
                key={pct}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => onChange(pct)}
                disabled={disabled}
              >
                {pct}%
              </Button>
            );
          })}
          <span className="text-xs text-muted-foreground">
            Random per request · current {canaryPercent}% to challenger
          </span>
        </div>
        {gating && (
          <div className="text-xs text-muted-foreground">{gating}</div>
        )}
      </CardContent>
    </Card>
  );
}

const METRIC_LABELS: Record<GuardrailMetricId, string> = {
  mismatch_rate: 'mismatch rate',
  tool_error_rate: 'tool error rate',
  latency_factor: 'latency factor',
};

function formatMetricValue(metric: GuardrailMetricId, value: number): string {
  if (metric === 'latency_factor') return `${value.toFixed(2)}x`;
  return `${(value * 100).toFixed(1)}%`;
}

function formatThreshold(metric: GuardrailMetricId, threshold: number): string {
  if (metric === 'latency_factor') return `${threshold.toFixed(2)}x`;
  return `${(threshold * 100).toFixed(0)}%`;
}

function GuardrailPanel({
  config,
  samples,
  breaches,
  onClearBreaches,
}: {
  config: import('@/lib/types').GuardrailConfig;
  samples: import('@/lib/types').GuardrailSample[];
  breaches: GuardrailBreach[];
  onClearBreaches: () => void;
}) {
  const metrics: GuardrailMetricId[] = [
    'mismatch_rate',
    'tool_error_rate',
    'latency_factor',
  ];
  const baseline = championBaseline(
    samples,
    config.latency_factor.window,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-muted-foreground" />
          Guardrails
          <Badge className="bg-muted text-muted-foreground">
            samples {samples.filter((s) => s.variant === 'challenger').length}
          </Badge>
          {breaches.length > 0 && (
            <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
              breaches {breaches.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {breaches.length > 0 && (
          <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                <AlertTriangle className="mr-1 inline size-3.5" />
                Guardrail breached — automatic rollback executed
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={onClearBreaches}
              >
                Dismiss
              </Button>
            </div>
            <div className="space-y-1">
              {breaches.slice(0, 3).map((breach) => (
                <div key={breach.id} className="font-mono text-[11px]">
                  {new Date(breach.timestamp).toLocaleTimeString()} ·{' '}
                  {METRIC_LABELS[breach.metric]}{' '}
                  {formatMetricValue(breach.metric, breach.value)} &gt;{' '}
                  {formatThreshold(breach.metric, breach.threshold)} · rolled
                  back from {breach.previousCanaryPercent}%
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-2">
          {metrics.map((metric) => {
            const evalResult = evaluateMetric(metric, samples, config, baseline);
            const ratio =
              evalResult.threshold > 0
                ? Math.min(evalResult.value / evalResult.threshold, 1.5)
                : 0;
            const breached =
              evalResult.sampleCount >= evalResult.window &&
              evalResult.value > evalResult.threshold;
            return (
              <div key={metric} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {METRIC_LABELS[metric]}
                  </span>
                  <span className="font-mono">
                    {formatMetricValue(metric, evalResult.value)}{' '}
                    <span className="text-muted-foreground">
                      / {formatThreshold(metric, evalResult.threshold)} ·{' '}
                      {evalResult.sampleCount}/{evalResult.window}
                    </span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                  <div
                    className={`h-full transition-[width] duration-200 ${
                      breached
                        ? 'bg-red-500'
                        : ratio > 0.75
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    }`}
                    style={{
                      width: `${Math.min(100, (ratio / 1.5) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Challenger samples counted against rolling window · latency compared
          to champion baseline
        </p>
      </CardContent>
    </Card>
  );
}

function KillSwitchPanel({
  active,
  message,
  onToggle,
  onMessageChange,
}: {
  active: boolean;
  message: string;
  onToggle: (next: boolean) => void;
  onMessageChange: (value: string) => void;
}) {
  return (
    <Card className={active ? 'border-red-500/60 bg-red-500/5' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <PowerOff
              className={
                active
                  ? 'size-4 text-red-600 dark:text-red-400'
                  : 'size-4 text-muted-foreground'
              }
            />
            Kill Switch
            {active && (
              <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
                ACTIVE
              </Badge>
            )}
          </span>
          <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <span>{active ? 'on' : 'off'}</span>
            <Switch
              checked={active}
              onCheckedChange={onToggle}
              aria-label="Toggle kill switch"
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          When active, new chat messages skip the agent entirely and return the
          fallback below.
        </p>
        <div className="space-y-1.5">
          <Label className="text-xs">Fallback message</Label>
          <Textarea
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            className="min-h-[60px] font-mono text-xs"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function RolloutTab() {
  const {
    rollout,
    setChampion,
    setChallenger,
    deleteSnapshot,
    recordShadowRun,
    clearShadowRuns,
    setCanaryPercent,
    toggleKillSwitch,
    setKillSwitchMessage,
    clearBreaches,
  } = useRollout();
  const { state } = useAppState();

  const champion =
    rollout.snapshots.find((s) => s.id === rollout.championId) ?? null;
  const challenger =
    rollout.snapshots.find((s) => s.id === rollout.challengerId) ?? null;
  const auditEntries = [...rollout.auditLog].reverse().slice(0, 20);
  const lastShadowRun = rollout.shadowRunHistory[0] ?? null;

  const [integrityCheck, setIntegrityCheck] =
    useState<ToolDescriptionIntegrityCheck | null>(null);
  const [isRunningShadow, setIsRunningShadow] = useState(false);
  const [shadowError, setShadowError] = useState<string | null>(null);
  const [shadowProgress, setShadowProgress] = useState<ShadowRunProgress | null>(
    null,
  );
  const [liveShadowRun, setLiveShadowRun] = useState<ShadowRunResult | null>(
    null,
  );

  useEffect(() => {
    if (!champion) {
      setIntegrityCheck(null);
      return;
    }
    let cancelled = false;
    checkToolDescriptionIntegrity(champion, state.toolCatalog)
      .then((result) => {
        if (!cancelled) setIntegrityCheck(result);
      })
      .catch(() => {
        if (!cancelled) setIntegrityCheck(null);
      });
    return () => {
      cancelled = true;
    };
  }, [champion, state.toolCatalog]);

  const handleStartShadow = async () => {
    if (!champion || !challenger) return;
    setShadowError(null);
    setIsRunningShadow(true);
    setShadowProgress({
      completedCases: 0,
      totalCases: evalCases.length,
      currentCaseId: evalCases[0]?.id ?? '',
      currentVariant: 'champion',
    });
    // Seed a live run scaffold so the matrix card has an anchor to update
    const runStartedAt = new Date().toISOString();
    setLiveShadowRun({
      id: 'shr_pending',
      startedAt: runStartedAt,
      completedAt: runStartedAt,
      championId: champion.id,
      challengerId: challenger.id,
      caseResults: [],
      totals: { identical: 0, divergent: 0, failed: 0 },
    });
    try {
      const result = await runShadow({
        champion,
        challenger,
        cases: evalCases,
        settings: state.settings,
        onProgress: setShadowProgress,
        onCaseComplete: (caseResult) => {
          setLiveShadowRun((prev) => {
            if (!prev) return prev;
            const nextCaseResults = [...prev.caseResults, caseResult];
            const totals = nextCaseResults.reduce(
              (acc, r) => {
                if (r.divergence === 'identical') acc.identical += 1;
                else if (
                  r.divergence === 'both_failed' ||
                  r.divergence === 'champion_only_failed' ||
                  r.divergence === 'challenger_only_failed'
                ) {
                  acc.failed += 1;
                } else {
                  acc.divergent += 1;
                }
                return acc;
              },
              { identical: 0, divergent: 0, failed: 0 },
            );
            return { ...prev, caseResults: nextCaseResults, totals };
          });
        },
      });
      setLiveShadowRun(result);
      recordShadowRun(result);
    } catch (err) {
      setShadowError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningShadow(false);
      setShadowProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Rocket className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Rollout</h2>
        <Badge className="bg-muted text-muted-foreground">Phase 3</Badge>
      </div>

      <StatusHeader
        champion={champion}
        challenger={challenger}
        canaryPercent={rollout.canaryPercent}
        killSwitchActive={rollout.killSwitchActive}
      />

      <IntegrityBanner check={integrityCheck} />

      <CanaryControl
        canaryPercent={rollout.canaryPercent}
        hasChampion={!!champion}
        hasChallenger={!!challenger}
        onChange={(pct) => setCanaryPercent(pct)}
      />

      <GuardrailPanel
        config={rollout.guardrailConfig}
        samples={rollout.samples}
        breaches={rollout.breachHistory}
        onClearBreaches={clearBreaches}
      />

      <KillSwitchPanel
        active={rollout.killSwitchActive}
        message={rollout.killSwitchMessage}
        onToggle={(next) => toggleKillSwitch(next)}
        onMessageChange={setKillSwitchMessage}
      />

      <ShadowRunPanel
        champion={champion}
        challenger={challenger}
        lastRun={lastShadowRun}
        historyCount={rollout.shadowRunHistory.length}
        isRunning={isRunningShadow}
        progress={shadowProgress}
        liveRun={liveShadowRun}
        onStart={handleStartShadow}
        onClear={() => {
          clearShadowRuns();
          setLiveShadowRun(null);
        }}
      />
      {shadowError && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          Shadow run failed: {shadowError}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-muted-foreground" />
            Snapshots
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rollout.snapshots.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
              No snapshots yet. Save one from the Contracts tab.
            </div>
          ) : (
            <div className="space-y-2">
              {rollout.snapshots.map((snap) => {
                const isChampion = snap.id === rollout.championId;
                const isChallenger = snap.id === rollout.challengerId;
                return (
                  <div key={snap.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {snap.label}
                          </span>
                          {isChampion && (
                            <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                              <Crown className="size-3" /> Champion
                            </Badge>
                          )}
                          {isChallenger && (
                            <Badge className="bg-sky-500/10 text-sky-600 dark:text-sky-400">
                              <Swords className="size-3" /> Challenger
                            </Badge>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {snap.id}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(snap.createdAt).toLocaleString()}
                        </div>
                        {snap.notes && (
                          <div className="pt-1 text-xs">{snap.notes}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setChampion(snap.id)}
                          disabled={isChampion}
                        >
                          <Crown className="size-3" />
                          Champion
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setChallenger(isChallenger ? null : snap.id)
                          }
                        >
                          <Swords className="size-3" />
                          {isChallenger ? 'Clear' : 'Challenger'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteSnapshot(snap.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-muted-foreground" />
            Rollout Audit Log
            <Badge className="bg-muted text-muted-foreground">
              {rollout.auditLog.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditEntries.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
              No rollout events yet.
            </div>
          ) : (
            <ScrollArea className="max-h-64">
              <div className="space-y-1">
                {auditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge className="bg-muted text-muted-foreground">
                      {formatActor(entry)}
                    </Badge>
                    <span className="font-medium">{entry.action}</span>
                    {entry.snapshotId && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {snapshotDisplayId(entry.snapshotId)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Separator />
      <p className="text-[11px] text-muted-foreground">
        Phase 3 scope: canary routing (random per request), kill switch with
        editable fallback, guardrails with auto-rollback on breach. Drift
        simulation arrives in Phase 4.
      </p>
    </div>
  );
}

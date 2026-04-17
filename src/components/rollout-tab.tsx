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
import { useAppState, useRollout } from '@/lib/store';
import { runShadow } from '@/lib/shadow-runner';
import { evalCases } from '@/lib/eval-cases';
import { checkToolDescriptionIntegrity } from '@/lib/graders/tool-description-pin';
import type {
  ConfigSnapshot,
  DivergenceKind,
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
  isRunning,
  onStart,
  onClear,
}: {
  champion: ConfigSnapshot | null;
  challenger: ConfigSnapshot | null;
  lastRun: ShadowRunResult | null;
  isRunning: boolean;
  onStart: () => void;
  onClear: () => void;
}) {
  const disabled = !champion || !challenger || isRunning;
  const disabledReason =
    !champion || !challenger
      ? 'Set both Champion and Challenger to start.'
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Play className="size-4 text-muted-foreground" />
          Shadow Run
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
          {lastRun && (
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

        {lastRun ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                identical {lastRun.totals.identical}
              </Badge>
              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                divergent {lastRun.totals.divergent}
              </Badge>
              <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
                failed {lastRun.totals.failed}
              </Badge>
              <span className="font-mono text-[10px] text-muted-foreground">
                {lastRun.id} · {new Date(lastRun.completedAt).toLocaleString()}
              </span>
            </div>
            <ScrollArea className="max-h-72">
              <div className="space-y-1">
                {lastRun.caseResults.map((r) => (
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

export function RolloutTab() {
  const {
    rollout,
    setChampion,
    setChallenger,
    deleteSnapshot,
    recordShadowRun,
    clearShadowRuns,
    setCanaryPercent,
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
    try {
      const result = await runShadow({
        champion,
        challenger,
        cases: evalCases,
        settings: state.settings,
      });
      recordShadowRun(result);
    } catch (err) {
      setShadowError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningShadow(false);
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

      <ShadowRunPanel
        champion={champion}
        challenger={challenger}
        lastRun={lastShadowRun}
        isRunning={isRunningShadow}
        onStart={handleStartShadow}
        onClear={clearShadowRuns}
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
        Phase 3 scope adds canary routing (random per request), an auto-
        rollback-ready data model, and the kill switch hook. Guardrails +
        drift simulation arrive with the remaining tasks in this phase.
      </p>
    </div>
  );
}

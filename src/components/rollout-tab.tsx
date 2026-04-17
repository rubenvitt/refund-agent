'use client';

import {
  Rocket,
  ShieldCheck,
  Crown,
  Swords,
  Trash2,
  Gauge,
  PowerOff,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRollout } from '@/lib/store';
import type { ConfigSnapshot, RolloutAuditEntry } from '@/lib/types';

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

export function RolloutTab() {
  const { rollout, setChampion, setChallenger, deleteSnapshot } = useRollout();

  const champion =
    rollout.snapshots.find((s) => s.id === rollout.championId) ?? null;
  const challenger =
    rollout.snapshots.find((s) => s.id === rollout.challengerId) ?? null;
  const auditEntries = [...rollout.auditLog].reverse().slice(0, 20);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Rocket className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Rollout</h2>
        <Badge className="bg-muted text-muted-foreground">Phase 1</Badge>
      </div>

      <StatusHeader
        champion={champion}
        challenger={challenger}
        canaryPercent={rollout.canaryPercent}
        killSwitchActive={rollout.killSwitchActive}
      />

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
        Phase 1 scope: versioned configs, status view, audit log. Shadow runs,
        canary routing, guardrails, kill switch, and drift simulation arrive in
        later phases.
      </p>
    </div>
  );
}

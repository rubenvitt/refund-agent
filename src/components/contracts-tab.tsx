'use client';

import { useState } from 'react';
import {
  FileText,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Wrench,
  ShieldAlert,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppState } from '@/lib/store';
import { defaultPromptConfig, defaultToolCatalog } from '@/lib/default-prompts';
import type { ToolDefinition } from '@/lib/types';

const PROMPT_SECTIONS: Array<{
  key: keyof typeof defaultPromptConfig;
  label: string;
  description: string;
}> = [
  {
    key: 'orchestratorInstructions',
    label: 'Orchestrator Instructions',
    description:
      'The system prompt for the orchestrator that routes user messages to the appropriate sub-agent.',
  },
  {
    key: 'refundAgentInstructions',
    label: 'Refund Agent Instructions',
    description:
      'Instructions for the refund sub-agent. Controls how refunds are processed and validated.',
  },
  {
    key: 'lookupAgentInstructions',
    label: 'Lookup Agent Instructions',
    description:
      'Instructions for the order lookup sub-agent. Handles order status and tracking queries.',
  },
  {
    key: 'accountFaqAgentInstructions',
    label: 'Account & FAQ Agent Instructions',
    description:
      'Instructions for the account management and FAQ sub-agent. Handles password resets and policy questions.',
  },
];

function ToolCard({
  tool,
  onUpdate,
}: {
  tool: ToolDefinition;
  onUpdate: (updated: ToolDefinition) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <code className="flex-1 text-sm font-semibold">{tool.name}</code>
        <div className="flex items-center gap-2">
          {tool.requiresApproval && (
            <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400">
              <ShieldAlert className="size-3" /> Approval
            </Badge>
          )}
          {tool.isDestructive && (
            <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
              <AlertTriangle className="size-3" /> Destructive
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="space-y-1.5">
            <Label htmlFor={`desc-${tool.name}`}>Description</Label>
            <Textarea
              id={`desc-${tool.name}`}
              value={tool.description}
              onChange={(e) =>
                onUpdate({ ...tool, description: e.target.value })
              }
              className="min-h-[60px] font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Parameters Schema</Label>
            <pre className="rounded-md bg-muted p-2 font-mono text-xs max-h-32 overflow-auto">
              {JSON.stringify(tool.parameters, null, 2)}
            </pre>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={tool.requiresApproval}
                onCheckedChange={(checked: boolean) =>
                  onUpdate({ ...tool, requiresApproval: checked })
                }
              />
              <Label className="text-xs">Requires Approval</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={tool.isDestructive}
                onCheckedChange={(checked: boolean) =>
                  onUpdate({ ...tool, isDestructive: checked })
                }
              />
              <Label className="text-xs">Is Destructive</Label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContractsTab() {
  const { state, dispatch } = useAppState();

  const updatePrompt = (
    key: keyof typeof defaultPromptConfig,
    value: string
  ) => {
    dispatch({
      type: 'UPDATE_PROMPT_CONFIG',
      payload: { [key]: value },
    });
  };

  const resetPrompt = (key: keyof typeof defaultPromptConfig) => {
    dispatch({
      type: 'UPDATE_PROMPT_CONFIG',
      payload: { [key]: defaultPromptConfig[key] },
    });
  };

  const updateTool = (index: number, updated: ToolDefinition) => {
    const tools = [...state.toolCatalog.tools];
    tools[index] = updated;
    dispatch({
      type: 'UPDATE_TOOL_CATALOG',
      payload: { tools },
    });
  };

  const resetAll = () => {
    dispatch({ type: 'RESET_PROMPT_CONFIG' });
    dispatch({ type: 'RESET_TOOL_CATALOG' });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">
            Contracts & Prompts
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={resetAll}>
          <RotateCcw className="size-3.5" />
          Reset All to Baseline
        </Button>
      </div>

      <div>
        <div className="space-y-6 pb-4">
          {/* Contract Notes */}
          <Card size="sm" className="bg-muted/30">
            <CardContent className="flex items-start gap-3 pt-3">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  Contract Notes
                </p>
                <p>
                  These prompts define the behavioral contract for each agent.
                  Editing them lets you test how prompt changes affect routing,
                  tool usage, approval behavior, and drift detection. The eval
                  suite validates agent behavior against the expectations
                  defined in each eval case.
                </p>
                <p>
                  Changes are applied immediately and persisted in localStorage.
                  Use &quot;Reset to Default&quot; to restore individual sections, or
                  &quot;Reset All to Baseline&quot; to restore everything.
                </p>
              </div>
            </CardContent>
          </Card>

          <Separator />

          {/* Prompt Sections */}
          {PROMPT_SECTIONS.map((section) => (
            <div key={section.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-semibold">
                    {section.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {section.description}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => resetPrompt(section.key)}
                  disabled={
                    state.promptConfig[section.key] ===
                    defaultPromptConfig[section.key]
                  }
                >
                  <RotateCcw className="size-3" />
                  Reset to Default
                </Button>
              </div>
              <Textarea
                value={state.promptConfig[section.key]}
                onChange={(e) => updatePrompt(section.key, e.target.value)}
                className="min-h-[140px] font-mono text-xs leading-relaxed"
              />
              {state.promptConfig[section.key] !==
                defaultPromptConfig[section.key] && (
                <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  Modified
                </Badge>
              )}
            </div>
          ))}

          <Separator />

          {/* Tool Catalog */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-semibold">Tool Catalog</Label>
                <p className="text-xs text-muted-foreground">
                  Configure tool definitions, approval requirements, and
                  destructive flags.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dispatch({ type: 'RESET_TOOL_CATALOG' })}
              >
                <RotateCcw className="size-3" />
                Reset Tools
              </Button>
            </div>

            <div className="space-y-2">
              {state.toolCatalog.tools.map((tool, i) => (
                <ToolCard
                  key={tool.name}
                  tool={tool}
                  onUpdate={(updated) => updateTool(i, updated)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

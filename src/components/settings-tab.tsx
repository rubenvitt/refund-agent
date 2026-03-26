'use client';

import { useState } from 'react';
import {
  Settings,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { useAppState } from '@/lib/store';
import type { Provider } from '@/lib/types';

const MODEL_DEFAULTS: Record<Provider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
};

function KeyIndicator({ hasKey }: { hasKey: boolean }) {
  return (
    <span
      className={`inline-block size-2 rounded-full ${
        hasKey
          ? 'bg-green-500'
          : 'bg-gray-300 dark:bg-gray-600'
      }`}
      title={hasKey ? 'Key is set' : 'Key not set'}
    />
  );
}

export function SettingsTab() {
  const { state, dispatch } = useAppState();
  const { settings } = state;
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const updateSettings = (patch: Partial<typeof settings>) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: patch });
  };

  const handleProviderChange = (value: string | null) => {
    if (!value) return;
    const provider = value as Provider;
    if (provider === 'anthropic') return; // CORS – not available in browser
    updateSettings({
      provider,
      modelId: MODEL_DEFAULTS[provider],
    });
  };

  const handleClearAll = () => {
    dispatch({ type: 'RESET_ALL' });
    if (typeof window !== 'undefined') {
      localStorage.removeItem('support-agent-lab');
    }
    setConfirmOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Settings className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Settings</h2>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Provider & Model */}
        <Card size="sm">
          <CardHeader>
            <CardTitle>Provider & Model</CardTitle>
            <CardDescription>
              Select the LLM provider and model to use for agent interactions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={settings.provider}
                onValueChange={handleProviderChange}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic" disabled>Anthropic (CORS – nur serverseitig)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="modelId">Model ID</Label>
              <Input
                id="modelId"
                value={settings.modelId}
                onChange={(e) =>
                  updateSettings({ modelId: e.target.value })
                }
                placeholder={MODEL_DEFAULTS[settings.provider]}
                className="w-[320px] font-mono"
              />
            </div>
          </CardContent>
        </Card>

        {/* API Keys */}
        <Card size="sm">
          <CardHeader>
            <CardTitle>API Keys</CardTitle>
            <CardDescription>
              Keys are stored only in your browser&apos;s localStorage. They are
              never sent to any server other than the respective API provider.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* OpenAI Key */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="openaiKey">OpenAI API Key</Label>
                <KeyIndicator hasKey={!!settings.openaiApiKey} />
              </div>
              <div className="flex gap-2">
                <Input
                  id="openaiKey"
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={settings.openaiApiKey}
                  onChange={(e) =>
                    updateSettings({ openaiApiKey: e.target.value })
                  }
                  placeholder="sk-..."
                  className="w-[400px] font-mono"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  aria-label={showOpenaiKey ? 'Hide key' : 'Show key'}
                >
                  {showOpenaiKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
            </div>

            <Separator />

            {/* Anthropic Key – disabled due to CORS */}
            <div className="space-y-2 opacity-50">
              <div className="flex items-center gap-2">
                <Label htmlFor="anthropicKey">Anthropic API Key</Label>
                <Badge variant="outline" className="text-xs">CORS – deaktiviert</Badge>
              </div>
              <Input
                id="anthropicKey"
                type="password"
                value=""
                disabled
                placeholder="Nicht verfügbar im Browser (CORS)"
                className="w-[400px] font-mono"
              />
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card size="sm" className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Clearing all local data will reset settings, prompts, tool
              configurations, traces, and chat history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger
                render={
                  <Button variant="destructive">
                    <Trash2 className="size-4" />
                    Clear All Local Data
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Clear All Local Data?</DialogTitle>
                  <DialogDescription>
                    This will permanently delete all settings, API keys,
                    prompts, traces, and chat history from your browser. This
                    action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose
                    render={<Button variant="outline">Cancel</Button>}
                  />
                  <Button variant="destructive" onClick={handleClearAll}>
                    <Trash2 className="size-4" />
                    Yes, Clear Everything
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

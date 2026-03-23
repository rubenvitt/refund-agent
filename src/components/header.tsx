'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, Moon, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/lib/store';

export function Header() {
  const { settings } = useSettings();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark =
      stored === 'dark' ||
      (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (prefersDark) {
      document.documentElement.classList.add('dark');
    }
    setIsDark(prefersDark);
  }, []);

  const toggleTheme = useCallback(() => {
    const html = document.documentElement;
    const next = !html.classList.contains('dark');
    html.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setIsDark(next);
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-6">
      <div className="flex items-center gap-2">
        <Shield className="size-5 text-primary" />
        <h1 className="text-base font-semibold tracking-tight">
          Support Agent Reliability Lab
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <Badge variant="outline" className="font-mono text-xs">
          {settings.provider === 'openai' ? 'OpenAI' : 'Anthropic'}
        </Badge>
        <Badge variant="secondary" className="font-mono text-xs">
          {settings.modelId}
        </Badge>
        <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          Local-only Demo
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </div>
    </header>
  );
}

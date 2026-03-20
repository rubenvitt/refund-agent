'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare,
  ScrollText,
  FlaskConical,
  FileText,
  Database,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/playground', label: 'Playground', icon: MessageSquare },
  { href: '/trace', label: 'Trace', icon: ScrollText },
  { href: '/evals', label: 'Evals', icon: FlaskConical },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/state', label: 'Backend State', icon: Database },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function TabNav() {
  const pathname = usePathname();

  return (
    <div className="border-b px-6">
      <nav className="flex gap-1">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative inline-flex h-9 items-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap transition-colors',
                'text-foreground/60 hover:text-foreground',
                active && 'text-foreground',
                'after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-foreground after:transition-opacity',
                active ? 'after:opacity-100' : 'after:opacity-0',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

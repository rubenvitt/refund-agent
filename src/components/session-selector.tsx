'use client';

import { useCallback } from 'react';
import { LogIn, LogOut, Shield, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSession, useAppState } from '@/lib/store';
import type { UserSession } from '@/lib/types';

const SESSION_OPTIONS: { value: string; session: UserSession }[] = [
  {
    value: 'C001',
    session: {
      customerId: 'C001',
      customerName: 'Max Mustermann',
      role: 'customer',
      loginTimestamp: '',
    },
  },
  {
    value: 'C002',
    session: {
      customerId: 'C002',
      customerName: 'Erika Beispiel',
      role: 'customer',
      loginTimestamp: '',
    },
  },
  {
    value: 'C003',
    session: {
      customerId: 'C003',
      customerName: 'Unknown User',
      role: 'customer',
      loginTimestamp: '',
    },
  },
  {
    value: 'ADMIN',
    session: {
      customerId: 'C001',
      customerName: 'Support Admin',
      role: 'support_admin',
      loginTimestamp: '',
    },
  },
];

export function SessionSelector() {
  const { session, setSession } = useSession();
  const { state } = useAppState();
  const isDisabled = state.isLoading;

  const handleLogin = useCallback(
    (value: string | null) => {
      if (!value) return;
      const option = SESSION_OPTIONS.find((o) => o.value === value);
      if (!option) return;
      setSession({
        ...option.session,
        loginTimestamp: new Date().toISOString(),
      });
    },
    [setSession]
  );

  const handleLogout = useCallback(() => {
    setSession(null);
  }, [setSession]);

  if (session) {
    return (
      <div className="flex items-center gap-2">
        <User className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{session.customerName}</span>
        <Badge
          variant="outline"
          className={
            session.role === 'support_admin'
              ? 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400'
          }
        >
          {session.role === 'support_admin' ? (
            <>
              <Shield className="size-3" />
              Admin
            </>
          ) : (
            <>Customer</>
          )}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          disabled={isDisabled}
          className="h-7 gap-1 px-2 text-xs"
        >
          <LogOut className="size-3" />
          Logout
        </Button>
      </div>
    );
  }

  return (
    <Select onValueChange={handleLogin}>
      <SelectTrigger size="sm" disabled={isDisabled} className="h-7 gap-1.5 text-xs">
        <LogIn className="size-3" />
        <SelectValue placeholder="Log in as..." />
      </SelectTrigger>
      <SelectContent>
        {SESSION_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex items-center gap-1.5">
              {opt.session.role === 'support_admin' && (
                <Shield className="size-3 text-violet-500" />
              )}
              {opt.session.customerName}
              <span className="text-muted-foreground">
                ({opt.value})
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

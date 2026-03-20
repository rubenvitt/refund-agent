'use client';

import { AppProvider } from '@/lib/store';
import { Header } from '@/components/header';
import { TabNav } from '@/components/tab-nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <div className="flex h-screen flex-col">
        <Header />
        <TabNav />
        <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4">{children}</main>
      </div>
    </AppProvider>
  );
}

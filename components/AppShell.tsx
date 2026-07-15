"use client";

import type { ReactNode } from "react";
import { Navbar } from "@/components/Navbar";
import { ChatWidget } from "@/components/ChatWidget";
import { useAudit } from "@/lib/state/AuditContext";

export function AppShell({ children }: { children: ReactNode }) {
  const { storageWarning } = useAudit();

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 px-4 py-6 md:px-8">
        {storageWarning ? (
          <div className="mb-4 rounded-lg border border-[var(--seo-warning-border)] bg-[var(--seo-warning-bg)] px-3 py-2 text-sm text-[var(--seo-warning)]">
            {storageWarning}
          </div>
        ) : null}
        {children}
      </main>
      <ChatWidget />
    </div>
  );
}

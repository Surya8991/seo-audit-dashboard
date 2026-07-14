"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAudit } from "@/lib/state/AuditContext";

interface NavItem {
  href: string;
  icon: string;
  label: string;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/", icon: "📊", label: "Dashboard Overview" },
      { href: "/technical-audit", icon: "🚀", label: "Technical Audit" },
      { href: "/results", icon: "📋", label: "Audit Results" },
      { href: "/detail", icon: "🔎", label: "URL Detail" },
      { href: "/links", icon: "🔗", label: "Link Analysis" },
      { href: "/performance", icon: "⚡", label: "Performance Audit" },
    ],
  },
  {
    title: "Additional Tools",
    items: [
      { href: "/headings", icon: "📝", label: "Heading Analysis" },
      { href: "/export", icon: "📤", label: "Export Reports" },
    ],
  },
  {
    items: [{ href: "/settings", icon: "⚙️", label: "Settings" }],
  },
];

// Flat list of all nav hrefs, used by the mobile top bar to label the active page.
const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

const COLLAPSE_KEY = "seo-audit-nav-collapsed";

function NavItemLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = pathname === item.href;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--seo-accent-light)] text-[var(--seo-sidebar-text-active)]"
          : "text-[var(--seo-sidebar-text)] hover:bg-[var(--seo-sidebar-hover)] hover:text-[var(--seo-sidebar-text-active)]"
      }`}
    >
      <span>{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  // Collapsed state for titled sections, persisted across sessions.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  function toggle(title: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [title]: !prev[title] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <nav className="flex flex-col gap-4">
      {NAV_SECTIONS.map((section, i) => {
        if (!section.title) {
          return (
            <div key={`section-${i}`} className="flex flex-col gap-1">
              {section.items.map((item) => (
                <NavItemLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
              ))}
            </div>
          );
        }
        // A titled, collapsible section. Auto-expand if it holds the active route.
        const hasActive = section.items.some((it) => it.href === pathname);
        const isCollapsed = collapsed[section.title] && !hasActive;
        return (
          <div key={section.title} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => toggle(section.title!)}
              aria-expanded={!isCollapsed}
              className="flex items-center justify-between px-3 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--seo-sidebar-text)] opacity-60 transition-opacity hover:opacity-100"
            >
              <span>{section.title}</span>
              <span className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▸</span>
            </button>
            {!isCollapsed
              ? section.items.map((item) => (
                  <NavItemLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
                ))
              : null}
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeItem = ALL_NAV_ITEMS.find((item) => item.href === pathname);
  const { storageWarning } = useAudit();

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-[var(--seo-sidebar-bg)] px-4 py-6 md:flex">
        <div className="mb-6 px-2">
          <h1 className="gradient-text text-lg font-bold tracking-tight">
            🔍 SEO Audit
          </h1>
          <p className="mt-1 text-xs text-[var(--seo-sidebar-text)]">
            Technical Audit Dashboard
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks pathname={pathname} />
        </div>
        <div className="mt-4 border-t border-white/10 pt-4">
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-50 flex h-full w-64 flex-col bg-[var(--seo-sidebar-bg)] px-4 py-6">
            <div className="mb-6 px-2">
              <h1 className="bg-[var(--seo-gradient)] bg-clip-text text-lg font-bold tracking-tight text-transparent">
                🔍 SEO Audit
              </h1>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <ThemeToggle />
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top navbar */}
        <header className="flex items-center gap-3 border-b border-[var(--seo-border)] bg-[var(--seo-card-bg)] px-4 py-3 md:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-[var(--seo-text)] hover:bg-[var(--seo-card-hover)]"
          >
            ☰
          </button>
          <span className="text-sm font-semibold text-[var(--seo-heading)]">
            {activeItem ? `${activeItem.icon} ${activeItem.label}` : "SEO Audit"}
          </span>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">
          {storageWarning ? (
            <div className="mb-4 rounded-lg border border-[var(--seo-warning-border)] bg-[var(--seo-warning-bg)] px-3 py-2 text-sm text-[var(--seo-warning)]">
              {storageWarning}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

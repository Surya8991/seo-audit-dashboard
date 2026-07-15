"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalSearch } from "@/components/GlobalSearch";
import { useAudit } from "@/lib/state/AuditContext";
import { useAiConfigStatus } from "@/lib/useAiConfigStatus";

interface NavItem {
  href: string;
  icon: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", icon: "📊", label: "Dashboard" },
  { href: "/technical-audit", icon: "🚀", label: "Technical Audit" },
  // Results is the single per-URL section: the list lives at /results and
  // the drill-down (with Links / Headings / Performance tabs) at /detail.
  { href: "/results", icon: "📋", label: "Results" },
  { href: "/settings", icon: "⚙️", label: "Settings" },
];

// The detail drill-down (/detail) belongs to the Results section; highlight
// "Results" while on it.
function resolveActiveHref(pathname: string): string {
  return pathname === "/detail" ? "/results" : pathname;
}

function NavItemLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = resolveActiveHref(pathname) === item.href;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--seo-accent-light)] text-[var(--seo-accent)]"
          : "text-[var(--seo-text-light)] hover:bg-[var(--seo-card-hover)] hover:text-[var(--seo-heading)]"
      }`}
    >
      <span>{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

function SessionPill() {
  const { results, groqApiKey } = useAudit();
  const { groqConfigured } = useAiConfigStatus();

  const keyLabel = groqApiKey
    ? "Custom key"
    : groqConfigured === null
      ? "Checking key…"
      : groqConfigured
        ? "Server key"
        : "No AI key";

  return (
    <div className="hidden items-center gap-2 rounded-full border border-[var(--seo-border)] bg-[var(--seo-card-bg-alt)] px-3 py-1 text-xs text-[var(--seo-text-light)] lg:flex">
      <span>{results.length} URL{results.length === 1 ? "" : "s"}</span>
      <span className="text-[var(--seo-border-strong)]">·</span>
      <span>{keyLabel}</span>
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeItem = NAV_ITEMS.find((item) => item.href === resolveActiveHref(pathname));

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--seo-border)] bg-[var(--seo-card-bg)]">
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="gradient-text text-lg font-bold tracking-tight whitespace-nowrap">
            🔍 SEO Audit
          </span>
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavItemLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>

        <div className="flex-1" />

        {/* Desktop: search, quick action, session pill, theme toggle */}
        <div className="hidden items-center gap-3 md:flex">
          <GlobalSearch />
          <button
            type="button"
            onClick={() => router.push("/technical-audit")}
            className="shrink-0 whitespace-nowrap rounded-lg btn-gradient px-3 py-2 text-sm font-semibold text-white"
          >
            + New Audit
          </button>
          <SessionPill />
          <ThemeToggle />
        </div>

        {/* Mobile: hamburger */}
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-lg p-2 text-[var(--seo-text)] hover:bg-[var(--seo-card-hover)] md:hidden"
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile active-page label, mirrors the old top bar */}
      {!mobileOpen ? (
        <div className="border-t border-[var(--seo-border)] px-4 py-2 text-sm font-semibold text-[var(--seo-heading)] md:hidden">
          {activeItem ? `${activeItem.icon} ${activeItem.label}` : "SEO Audit"}
        </div>
      ) : null}

      {/* Mobile dropdown menu */}
      {mobileOpen ? (
        <div className="flex flex-col gap-3 border-t border-[var(--seo-border)] bg-[var(--seo-card-bg)] px-4 py-4 md:hidden">
          <GlobalSearch onNavigate={() => setMobileOpen(false)} />
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavItemLink
                key={item.href}
                item={item}
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
          </nav>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              router.push("/technical-audit");
            }}
            className="rounded-lg btn-gradient px-3 py-2 text-center text-sm font-semibold text-white"
          >
            + New Audit
          </button>
          <div className="flex items-center justify-between border-t border-[var(--seo-border)] pt-3">
            <SessionPillMobile />
            <ThemeToggle />
          </div>
        </div>
      ) : null}
    </header>
  );
}

function SessionPillMobile() {
  const { results, groqApiKey } = useAudit();
  const { groqConfigured } = useAiConfigStatus();
  const keyLabel = groqApiKey ? "Custom key" : groqConfigured ? "Server key" : "No AI key";
  return (
    <span className="text-xs text-[var(--seo-text-light)]">
      {results.length} URL{results.length === 1 ? "" : "s"} · {keyLabel}
    </span>
  );
}

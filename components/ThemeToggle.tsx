"use client";

import { useTheme } from "@/lib/useTheme";

export { themeInitScript } from "@/lib/useTheme";

export function ThemeToggle() {
  const { dark, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-[var(--seo-text-light)] transition-colors hover:bg-[var(--seo-card-hover)] hover:text-[var(--seo-heading)]"
    >
      <span>{dark ? "🌙" : "☀️"}</span>
      <span className="hidden lg:inline">{dark ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}

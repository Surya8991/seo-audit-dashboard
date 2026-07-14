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
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--seo-sidebar-text)] transition-colors hover:bg-[var(--seo-sidebar-hover)] hover:text-[var(--seo-sidebar-text-active)]"
    >
      <span>{dark ? "🌙" : "☀️"}</span>
      <span>{dark ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}

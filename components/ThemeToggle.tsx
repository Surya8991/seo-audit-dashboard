"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "seo-audit-theme";

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial = stored ? stored === "dark" : document.documentElement.classList.contains("dark");
    setDark(initial);
    applyTheme(initial);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  }

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

/** Inline script for app/layout.tsx <head> — sets .dark before hydration to avoid a flash of the wrong theme. */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

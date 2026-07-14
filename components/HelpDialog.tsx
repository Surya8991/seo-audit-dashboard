"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small (i) icon button that opens a plain-English explanation on click.
 * Closes on outside click, Escape, or clicking the icon again.
 */
export function HelpDialog({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label={`Help: ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-[var(--seo-muted)] transition-colors hover:bg-[var(--seo-accent-light)] hover:text-[var(--seo-accent)]"
      >
        ⓘ
      </button>
      {open ? (
        <div
          role="dialog"
          className="absolute left-0 top-6 z-30 w-72 rounded-xl border border-[var(--seo-border-strong)] bg-[var(--seo-card-bg)] p-3 text-left shadow-lg"
          style={{ boxShadow: "var(--seo-shadow-lg)" }}
        >
          <div className="mb-1 text-sm font-semibold text-[var(--seo-heading)]">{title}</div>
          <div className="text-xs leading-relaxed text-[var(--seo-text-light)]">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

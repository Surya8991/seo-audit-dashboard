"use client";

import { useState } from "react";
import type { AuditResult } from "@/lib/types";
import { Card } from "@/components/ui";

const FORMATS = [
  { id: "csv", label: "CSV", desc: "Flat summary, one row per URL." },
  { id: "xlsx", label: "Excel", desc: "Summary, Issues, Links, Checklist sheets." },
  { id: "pdf", label: "PDF", desc: "Formatted report for sharing." },
  { id: "json", label: "JSON", desc: "Full raw audit data." },
] as const;

/**
 * Compact export control (format picker + downloads). Lives on the Results
 * page: exporting is an action on the current results, not a separate section.
 * POSTs to /api/export (modules/report_generator.py) and downloads the blob.
 */
export function ExportBar({ results }: { results: AuditResult[] }) {
  const [loadingFormat, setLoadingFormat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(format: string) {
    setLoadingFormat(format);
    setError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results, format }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `seo-audit-report.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setLoadingFormat(null);
    }
  }

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-[var(--seo-subheading)]">
          📤 Export report
        </span>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => handleExport(f.id)}
              disabled={loadingFormat !== null}
              title={f.desc}
              className="rounded-lg border border-[var(--seo-border-strong)] px-3 py-1.5 text-sm font-medium text-[var(--seo-text)] hover:bg-[var(--seo-card-hover)] disabled:opacity-60"
            >
              {loadingFormat === f.id ? "Generating…" : f.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--seo-muted)]">
          {results.length} URL{results.length === 1 ? "" : "s"} in this session
        </span>
      </div>
      {error ? (
        <div className="mt-3 rounded-lg border border-[var(--seo-error-border)] bg-[var(--seo-error-bg)] px-3 py-2 text-sm text-[var(--seo-error)]">
          {error}
        </div>
      ) : null}
    </Card>
  );
}

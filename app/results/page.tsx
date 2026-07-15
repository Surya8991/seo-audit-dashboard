"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAudit } from "@/lib/state/AuditContext";
import { Card, EmptyState, PageHeader, ScoreBadge, ScoreCircle, StatusPill } from "@/components/ui";
import { ExportBar } from "@/components/ExportBar";
import { allIssuesOf, avgScore } from "@/lib/aggregate";
import { difficultyBreakdown } from "@/lib/difficulty";
import { downloadCsv, severityColor } from "@/lib/format";
import { getBaseDomain } from "@/lib/linkAnalysis";
import type { AuditResult } from "@/lib/types";

// Shares lib/linkAnalysis.ts's www-stripping so a sitewide audit groups
// www.example.com and example.com as one domain here too — they used to
// diverge (this page didn't strip www, the Links tab did), splitting one
// site's results into two "domain" groups.
function hostOf(url: string): string {
  return getBaseDomain(url) || url;
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
}

/** Compact Easy/Medium/Hard fix-effort counts for a result's issues. */
function EffortChips({ result }: { result: AuditResult }) {
  const b = difficultyBreakdown(result.all_issues || []);
  if (b.Easy + b.Medium + b.Hard === 0) {
    return <span className="text-xs text-[var(--seo-success)]">None</span>;
  }
  const chip = (n: number, label: string, color: string) =>
    n > 0 ? (
      <span className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ color, backgroundColor: "var(--seo-card-hover)" }} title={`${n} ${label} fix${n > 1 ? "es" : ""}`}>
        {n} {label}
      </span>
    ) : null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {chip(b.Easy, "easy", "var(--seo-success)")}
      {chip(b.Medium, "med", "var(--seo-warning)")}
      {chip(b.Hard, "hard", "var(--seo-error)")}
    </span>
  );
}

function worstIssue(r: AuditResult): string {
  const issues = r.all_issues || [];
  if (issues.length === 0) return "";
  return [...issues].sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0))[0].issue;
}

type SortMode = "score-asc" | "score-desc" | "issues-desc" | "alpha";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "score-asc", label: "Worst score first" },
  { value: "score-desc", label: "Best score first" },
  { value: "issues-desc", label: "Most issues first" },
  { value: "alpha", label: "URL (A–Z)" },
];

function sortRows(rows: AuditResult[], mode: SortMode): AuditResult[] {
  const withKey = [...rows];
  switch (mode) {
    case "score-desc":
      return withKey.sort((a, b) => (b.seo_score ?? 0) - (a.seo_score ?? 0));
    case "issues-desc":
      return withKey.sort((a, b) => (b.all_issues?.length ?? 0) - (a.all_issues?.length ?? 0));
    case "alpha":
      return withKey.sort((a, b) => a.url.localeCompare(b.url));
    case "score-asc":
    default:
      return withKey.sort((a, b) => (a.seo_score ?? 0) - (b.seo_score ?? 0));
  }
}

export default function ResultsPage() {
  const { results, navFilter, setNavFilter, setSelectedUrlIndex, clearAll } = useAudit();
  const router = useRouter();

  const [scoreMax, setScoreMax] = useState(100);
  const [brokenOnly, setBrokenOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("score-asc");
  const [confirmClear, setConfirmClear] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [h1ReportOpen, setH1ReportOpen] = useState(false);

  useEffect(() => {
    if (!navFilter) return;
    if (navFilter.kind === "score" && navFilter.key === "critical_urls") {
      setScoreMax(49);
    }
    setNavFilter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      if ((r.seo_score ?? 0) > scoreMax) return false;
      if (brokenOnly) {
        const brokenInt = r.internal_links?.broken_count || 0;
        const brokenExt = r.external_links?.broken_count || 0;
        if (brokenInt + brokenExt === 0) return false;
      }
      if (q && !r.url.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [results, scoreMax, brokenOnly, search]);

  // Group the filtered rows by domain so a sitewide audit reads as one section
  // per site (worst-scoring domains first, then rows ordered by the chosen sort).
  const groups = useMemo(() => {
    const byHost = new Map<string, AuditResult[]>();
    for (const r of filtered) {
      const h = hostOf(r.url);
      if (!byHost.has(h)) byHost.set(h, []);
      byHost.get(h)!.push(r);
    }
    return [...byHost.entries()]
      .map(([host, rows]) => ({
        host,
        rows: sortRows(rows, sortMode),
        avg: avgScore(rows),
      }))
      .sort((a, b) => a.avg - b.avg);
  }, [filtered, sortMode]);

  function openDetail(r: AuditResult) {
    setSelectedUrlIndex(results.indexOf(r));
    router.push("/detail");
  }

  function exportSiteH1Csv() {
    const rows = [["URL", "H1 Text", "H1 Count"]];
    for (const r of results) {
      rows.push([r.url, r.heading_detail?.h1_text || "", String(r.heading_detail?.counts?.h1 ?? 0)]);
    }
    downloadCsv("site-h1-report.csv", rows);
  }

  // Sitewide rollup: only meaningful when more than one URL was audited.
  const rollup = useMemo(() => {
    if (results.length < 2) return null;
    const issues = allIssuesOf(results);
    const dist = { good: 0, warn: 0, poor: 0 };
    for (const r of results) {
      const s = r.seo_score ?? 0;
      if (s >= 70) dist.good++;
      else if (s >= 50) dist.warn++;
      else dist.poor++;
    }
    // Top failing checks = most frequent issue titles across all URLs.
    const freq = new Map<string, { count: number; severity: string }>();
    for (const i of issues) {
      const key = i.issue;
      const cur = freq.get(key);
      if (cur) cur.count++;
      else freq.set(key, { count: 1, severity: i.severity });
    }
    const topFailing = [...freq.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([issue, v]) => ({ issue, ...v }));
    return {
      avg: avgScore(results),
      totalIssues: issues.length,
      dist,
      topFailing,
    };
  }, [results]);

  if (results.length === 0) {
    return (
      <div>
        <PageHeader title="📋 Audit Results" />
        <EmptyState title="No audits yet" hint="Run an audit to see results here." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="📋 Audit Results" subtitle={`${filtered.length} of ${results.length} URLs`} />

      {rollup ? (
        <Card className="mb-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">
            Sitewide Summary
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr]">
            <div className="flex items-center gap-6">
              <ScoreCircle score={rollup.avg} size={88} label="Avg score" />
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--seo-text-light)]">
                  <strong className="text-[var(--seo-heading)]">{results.length}</strong> URLs audited
                </span>
                <span className="text-[var(--seo-text-light)]">
                  <strong className="text-[var(--seo-heading)]">{rollup.totalIssues}</strong> total issues
                </span>
                <span className="flex gap-3 text-xs">
                  <span style={{ color: "var(--seo-success)" }}>● {rollup.dist.good} good</span>
                  <span style={{ color: "var(--seo-warning)" }}>● {rollup.dist.warn} fair</span>
                  <span style={{ color: "var(--seo-error)" }}>● {rollup.dist.poor} poor</span>
                </span>
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--seo-muted)]">
                Top failing checks (site-wide)
              </div>
              <div className="flex flex-col gap-1.5">
                {rollup.topFailing.map((f) => (
                  <div key={f.issue} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-[var(--seo-text)]" style={{ borderLeft: `3px solid ${severityColor(f.severity).text}`, paddingLeft: 8 }}>
                      {f.issue}
                    </span>
                    <span className="shrink-0 rounded-full bg-[var(--seo-card-hover)] px-2 py-0.5 text-xs font-medium text-[var(--seo-text-light)]">
                      {f.count} pages
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Sitewide (cross-URL) concept, moved here from the per-URL Detail
          page's Headings tab where it was organizationally out of place —
          a report iterating every audited URL doesn't belong on a single
          URL's drill-down page. */}
      {results.length > 1 ? (
        <Card className="mb-4 overflow-hidden p-0">
          <button
            type="button"
            onClick={() => setH1ReportOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
          >
            <span className="flex items-center gap-2">
              <span className={`text-[var(--seo-muted)] transition-transform ${h1ReportOpen ? "rotate-90" : ""}`}>▸</span>
              <span className="text-sm font-semibold text-[var(--seo-subheading)]">Sitewide H1 Report</span>
            </span>
          </button>
          {h1ReportOpen ? (
            <div className="overflow-x-auto border-t border-[var(--seo-border)]">
              <div className="flex justify-end p-3">
                <button
                  onClick={exportSiteH1Csv}
                  className="rounded-lg border border-[var(--seo-border-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--seo-card-hover)]"
                >
                  Export CSV
                </button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--seo-border)] bg-[var(--table-header-bg)] text-left text-xs uppercase tracking-wide text-[var(--seo-muted)]">
                    <th className="px-4 py-3">URL</th>
                    <th className="px-4 py-3">H1 Text</th>
                    <th className="px-4 py-3">H1 Count</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((res) => (
                    <tr key={res.url} className="border-b border-[var(--table-row-border)]">
                      <td className="max-w-xs truncate px-4 py-3">{res.url}</td>
                      <td className="px-4 py-3">{res.heading_detail?.h1_text || <em>none</em>}</td>
                      <td className="px-4 py-3">{res.heading_detail?.counts?.h1 ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-6">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-[var(--seo-muted)]">
              Search URL
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by path or domain…"
              className="w-full rounded-lg border border-[var(--seo-border)] bg-[var(--seo-card)] px-3 py-1.5 text-sm text-[var(--seo-text)] placeholder:text-[var(--seo-muted)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--seo-muted)]">
              Max score: {scoreMax}
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={scoreMax}
              onChange={(e) => setScoreMax(Number(e.target.value))}
              className="w-48"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--seo-muted)]">
              Sort
            </label>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="rounded-lg border border-[var(--seo-border)] bg-[var(--seo-card)] px-3 py-1.5 text-sm text-[var(--seo-text)]"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--seo-text)]">
            <input
              type="checkbox"
              checked={brokenOnly}
              onChange={(e) => setBrokenOnly(e.target.checked)}
            />
            Broken links only
          </label>
        </div>
      </Card>

      <ExportBar results={filtered} totalCount={results.length} />

      <div className="mb-4 flex flex-col gap-4">
        {groups.map((g) => {
          const isCollapsed = collapsed[g.host];
          return (
            <Card key={g.host} className="overflow-hidden p-0">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [g.host]: !c[g.host] }))}
                className="flex w-full items-center justify-between gap-3 border-b border-[var(--seo-border)] bg-[var(--table-header-bg)] px-4 py-2.5 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className={`text-[var(--seo-muted)] transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▸</span>
                  <span className="font-semibold text-[var(--seo-subheading)]">{g.host}</span>
                  <span className="text-xs text-[var(--seo-muted)]">
                    {g.rows.length} URL{g.rows.length > 1 ? "s" : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-[var(--seo-muted)]">
                  avg <ScoreBadge score={g.avg} />
                </span>
              </button>

              {!isCollapsed ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--seo-border)] text-left text-xs uppercase tracking-wide text-[var(--seo-muted)]">
                        <th className="px-4 py-2.5">URL</th>
                        <th className="px-4 py-2.5">Score</th>
                        <th className="px-4 py-2.5">Checklist</th>
                        <th className="px-4 py-2.5">Fix effort</th>
                        <th className="px-4 py-2.5">Top issue</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r, idx) => {
                        const cl = r.technical_audit_checklist?.summary;
                        const top = worstIssue(r);
                        return (
                          <tr
                            key={r.url + idx}
                            onClick={() => openDetail(r)}
                            className="cursor-pointer border-b border-[var(--table-row-border)] last:border-0 hover:bg-[var(--table-row-hover)]"
                          >
                            <td className="max-w-xs truncate px-4 py-3 font-medium text-[var(--seo-subheading)]">
                              {pathnameOf(r.url)}
                              {r.status_code && r.status_code !== 200 ? (
                                <span className="ml-2 text-xs text-[var(--seo-error)]">{r.status_code}</span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">
                              <ScoreBadge score={r.seo_score ?? 0} />
                            </td>
                            <td className="px-4 py-3">
                              {cl ? (
                                <span className="flex items-center gap-1.5 text-xs">
                                  <StatusPill status="pass" /> {cl.pass}
                                  <StatusPill status="warning" /> {cl.warning}
                                  <StatusPill status="fail" /> {cl.fail}
                                </span>
                              ) : (
                                <span className="text-xs text-[var(--seo-muted)]">N/A</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <EffortChips result={r} />
                            </td>
                            <td className="max-w-xs truncate px-4 py-3 text-[var(--seo-text-light)]">
                              {top || <span className="text-[var(--seo-success)]">No issues</span>}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm font-medium text-[var(--seo-accent)]">View →</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      {/* Destructive action, deliberately separated from the filter/export
          controls above so it isn't a stray click away from routine actions. */}
      <div className="mt-6 flex justify-end border-t border-[var(--seo-border)] pt-4">
        <button
          type="button"
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            clearAll();
            setConfirmClear(false);
          }}
          onBlur={() => setConfirmClear(false)}
          className="rounded-lg border border-[var(--seo-error-border)] px-3 py-1.5 text-sm font-medium text-[var(--seo-error)] hover:bg-[var(--seo-error-bg)]"
        >
          {confirmClear ? "Confirm clear all results?" : "Clear All Results"}
        </button>
      </div>
    </div>
  );
}

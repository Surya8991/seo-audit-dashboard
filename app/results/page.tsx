"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAudit } from "@/lib/state/AuditContext";
import { Card, EmptyState, PageHeader, ScoreBadge, ScoreCircle, StatusPill } from "@/components/ui";
import { ExportBar } from "@/components/ExportBar";
import { allIssuesOf, avgScore } from "@/lib/aggregate";
import { difficultyBreakdown } from "@/lib/difficulty";
import { siteScore, gradeColor } from "@/lib/siteScore";
import { severityColor } from "@/lib/format";
import type { AuditResult } from "@/lib/types";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
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

export default function ResultsPage() {
  const { results, navFilter, setNavFilter, setSelectedUrlIndex, clearAll } = useAudit();
  const router = useRouter();

  const [scoreMax, setScoreMax] = useState(100);
  const [brokenOnly, setBrokenOnly] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!navFilter) return;
    if (navFilter.kind === "score" && navFilter.key === "critical_urls") {
      setScoreMax(49);
    }
    setNavFilter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navFilter]);

  const filtered = useMemo(() => {
    return results.filter((r) => {
      if ((r.seo_score ?? 0) > scoreMax) return false;
      if (brokenOnly) {
        const brokenInt = r.internal_links?.broken_count || 0;
        const brokenExt = r.external_links?.broken_count || 0;
        if (brokenInt + brokenExt === 0) return false;
      }
      return true;
    });
  }, [results, scoreMax, brokenOnly]);

  // Group the filtered rows by domain so a sitewide audit reads as one section
  // per site (worst-scoring domains first, then worst URLs within each).
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
        rows: [...rows].sort((a, b) => (a.seo_score ?? 0) - (b.seo_score ?? 0)),
        avg: avgScore(rows),
      }))
      .sort((a, b) => a.avg - b.avg);
  }, [filtered]);

  function openDetail(r: AuditResult) {
    setSelectedUrlIndex(results.indexOf(r));
    router.push("/detail");
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

  // Ahrefs-style site health score + letter grade (% of pages free of any
  // Critical/High issue). Ported from modules/site_scoring.py.
  const site = useMemo(() => siteScore(results), [results]);

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
              <ScoreCircle score={rollup.avg} size={88} label="Avg score (per-page quality)" />
              <div
                className="flex flex-col items-center gap-1"
                title={`Site Health grade: ${site.cleanPages} of ${site.totalPages} pages have no Critical/High-severity issue. This is a different metric from the average score above: one bad page on an otherwise-clean site still pulls this grade down.`}
              >
                <div
                  className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-full border-4"
                  style={{ borderColor: gradeColor(site.grade) }}
                >
                  <span className="text-3xl font-bold leading-none" style={{ color: gradeColor(site.grade) }}>
                    {site.grade}
                  </span>
                </div>
                <span className="text-xs text-[var(--seo-muted)]">
                  Site Health ({site.score}% clean)
                </span>
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--seo-text-light)]">
                  <strong className="text-[var(--seo-heading)]">{results.length}</strong> URLs audited
                </span>
                <span className="text-[var(--seo-text-light)]">
                  <strong className="text-[var(--seo-heading)]">{rollup.totalIssues}</strong> total issues
                </span>
                <span className="text-[var(--seo-text-light)]">
                  <strong className="text-[var(--seo-heading)]">{site.criticalPages}</strong> page{site.criticalPages === 1 ? "" : "s"} with critical/high issues
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
              {/* Bars for "compare a handful of categories at a glance"; the
                  detailed per-issue text (with fix guidance) lives in each
                  URL's Issues tab, not duplicated here. */}
              <ResponsiveContainer width="100%" height={Math.max(120, rollup.topFailing.length * 34)}>
                <BarChart
                  data={rollup.topFailing}
                  layout="vertical"
                  margin={{ top: 4, right: 36, left: 4, bottom: 4 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="issue"
                    width={160}
                    tick={{ fontSize: 11, fill: "var(--seo-text-light)" }}
                    tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)}
                  />
                  <Tooltip
                    formatter={(value) => [`${value} pages`, "Affected"]}
                    contentStyle={{ background: "var(--seo-card-bg)", border: "1px solid var(--seo-border)", fontSize: 12 }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
                    <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: "var(--seo-text-light)" }} />
                    {rollup.topFailing.map((f, i) => (
                      <Cell key={i} fill={severityColor(f.severity).text} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-6">
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
          <label className="flex items-center gap-2 text-sm text-[var(--seo-text)]">
            <input
              type="checkbox"
              checked={brokenOnly}
              onChange={(e) => setBrokenOnly(e.target.checked)}
            />
            Broken links only
          </label>
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
            className="ml-auto rounded-lg border border-[var(--seo-error-border)] px-3 py-1.5 text-sm font-medium text-[var(--seo-error)] hover:bg-[var(--seo-error-bg)]"
          >
            {confirmClear ? "Confirm clear all results?" : "Clear All Results"}
          </button>
        </div>
      </Card>

      <ExportBar results={results} />

      <div className="flex flex-col gap-4">
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
                              {new URL(r.url).pathname || r.url}
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
    </div>
  );
}

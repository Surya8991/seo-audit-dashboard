"use client";

import { useState } from "react";
import { Card, IssueExplanationGrid, MetricCard, TabBar } from "@/components/ui";
import { downloadCsv } from "@/lib/format";
import type { AuditResult, Issue } from "@/lib/types";
import { explainHeadingIssue, STATUS_COLOR_HEX } from "@/lib/headingAnalysis";

const TABS = ["Hierarchy Tree", "Heading List", "Issues"] as const;
type Tab = (typeof TABS)[number];

interface HeadingItem {
  level: number;
  text: string;
  position: number;
  is_empty: boolean;
  length: number;
  id_attr: string | null;
}

export function HeadingsView({ result }: { result: AuditResult }) {
  const [tab, setTab] = useState<Tab>("Hierarchy Tree");
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);

  const r = result;
  const hd = r.heading_detail || {};
  const headings: HeadingItem[] = hd.headings || [];
  const counts = hd.counts || {};
  const issues: Issue[] = hd.issues || [];

  function exportUrlCsv() {
    const rows = [["Level", "Text", "Length", "Empty"]];
    for (const h of headings) rows.push([`H${h.level}`, h.text, String(h.length), h.is_empty ? "Yes" : "No"]);
    downloadCsv(`headings-${r.url.replace(/[^a-z0-9]/gi, "-")}.csv`, rows);
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-4 md:grid-cols-6">
        {(["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((lvl) => (
          <MetricCard key={lvl} label={lvl.toUpperCase()} value={counts[lvl] ?? 0} />
        ))}
      </div>

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === "Hierarchy Tree" ? (
        <Card>
          <div className="flex flex-col gap-1">
            {headings.map((h, i) => (
              <div
                key={i}
                className="text-sm"
                style={{ paddingLeft: `${(h.level - 1) * 1.25}rem` }}
              >
                <span className="mr-2 rounded bg-[var(--seo-accent-light)] px-1.5 py-0.5 text-xs font-semibold text-[var(--seo-accent)]">
                  H{h.level}
                </span>
                <span className={h.is_empty ? "text-[var(--seo-error)] italic" : "text-[var(--seo-text)]"}>
                  {h.is_empty ? "(empty heading)" : h.text}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === "Heading List" ? (
        <Card className="overflow-x-auto p-0">
          <div className="flex justify-end p-3">
            <button
              onClick={exportUrlCsv}
              className="rounded-lg border border-[var(--seo-border-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--seo-card-hover)]"
            >
              Export CSV
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--seo-border)] bg-[var(--table-header-bg)] text-left text-xs uppercase tracking-wide text-[var(--seo-muted)]">
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Text</th>
                <th className="px-4 py-3">Length</th>
              </tr>
            </thead>
            <tbody>
              {headings.map((h, i) => (
                <tr key={i} className="border-b border-[var(--table-row-border)]">
                  <td className="px-4 py-3">H{h.level}</td>
                  <td className="px-4 py-3">{h.is_empty ? <em>(empty)</em> : h.text}</td>
                  <td className="px-4 py-3">{h.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {tab === "Issues" ? (
        <Card>
          {issues.map((issue, i) => {
            const isExpanded = expandedIssue === i;
            const explanation = explainHeadingIssue(issue);
            const color = STATUS_COLOR_HEX[explanation.status];
            return (
              <div key={i} className="border-b border-[var(--seo-border)] py-3 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-1 items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ color, backgroundColor: `${color}18` }}
                    >
                      {issue.severity}
                    </span>
                    <span className="text-sm text-[var(--seo-text)]">{issue.issue}</span>
                  </div>
                  <button
                    onClick={() => setExpandedIssue(isExpanded ? null : i)}
                    className="shrink-0 text-xs font-medium text-[var(--seo-accent)] hover:underline"
                  >
                    {isExpanded ? "Hide" : "Details"}
                  </button>
                </div>
                {isExpanded ? (
                  <div className="mt-3 rounded-lg bg-[var(--seo-card-alt)] p-3">
                    <IssueExplanationGrid
                      fields={[
                        { label: "What is it?", value: explanation.whatIsIt },
                        { label: "Why is it important?", value: explanation.whyImportant },
                        { label: "SEO Impact", value: explanation.seoImpact },
                        { label: "User Impact", value: explanation.userImpact },
                      ]}
                      recommendedFix={explanation.recommendedFix}
                      htmlExample={explanation.htmlExample}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
          {issues.length === 0 ? (
            <div className="py-4 text-sm text-[var(--seo-muted)]">No heading issues found.</div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

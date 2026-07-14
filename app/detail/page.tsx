"use client";

import { useState } from "react";
import { useAudit } from "@/lib/state/AuditContext";
import { Card, EmptyState, IssueRow, PageHeader, ScoreBadge } from "@/components/ui";
import { getThematicIssues, getTopIssuesByImpact } from "@/lib/aggregate";
import { WEIGHTS } from "@/lib/scoring";

const TABS = [
  "Overview",
  "Issues",
  "Links",
  "Content & Images",
  "Technical",
  "Recommendations",
] as const;
type Tab = (typeof TABS)[number];

function BoolBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: ok ? "var(--seo-success)" : "var(--seo-error)",
        backgroundColor: ok ? "var(--seo-success-bg)" : "var(--seo-error-bg)",
      }}
    >
      {ok ? "Pass" : "Fail"}
    </span>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return String(v.length);
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(
      ([k]) => k !== "issues" && !k.startsWith("_"),
    );
    if (entries.length === 0) return "—";
    return entries
      .map(([k, val]) => {
        if (Array.isArray(val)) return `${k}: ${val.length}`;
        if (val && typeof val === "object") return `${k}: …`;
        if (val === null || val === undefined || val === "") return `${k}: —`;
        return `${k}: ${val}`;
      })
      .join(", ");
  }
  return String(v);
}

function KeyValueGrid({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data || {}).filter(
    ([k]) => k !== "issues" && !k.startsWith("_"),
  );
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between border-b border-[var(--seo-border)] py-1.5 text-sm">
          <span className="text-[var(--seo-text-light)] capitalize">
            {k.replace(/_/g, " ")}
          </span>
          {typeof v === "boolean" ? (
            <BoolBadge ok={v} />
          ) : (
            <span className="max-w-[60%] truncate text-right font-medium text-[var(--seo-subheading)]" title={formatValue(v)}>
              {formatValue(v)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface AiSummary {
  ok: boolean;
  explanation?: string;
  top_actions?: string[];
  error?: string;
}

export default function DetailPage() {
  const { results, selectedUrlIndex, setSelectedUrlIndex, groqApiKey } = useAudit();
  const [tab, setTab] = useState<Tab>("Overview");
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  if (results.length === 0) {
    return (
      <div>
        <PageHeader title="🔎 URL Detail" />
        <EmptyState title="No audits yet" hint="Run an audit to see details here." />
      </div>
    );
  }

  const idx = Math.min(selectedUrlIndex, results.length - 1);
  const r = results[idx];
  const breakdown = r.score_breakdown || {};
  const issues = r.all_issues || [];
  const grouped = getThematicIssues(issues);
  const topIssues = getTopIssuesByImpact(issues, 10);

  async function runAiSummary() {
    setAiLoading(true);
    setAiSummary(null);
    try {
      const res = await fetch("/api/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: r.url,
          seoScore: r.seo_score,
          allIssues: issues,
          apiKey: groqApiKey || undefined,
        }),
      });
      const data = await res.json();
      setAiSummary(data);
    } catch {
      setAiSummary({ ok: false, error: "Request failed" });
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="🔎 URL Detail" subtitle={r.url} />

      {results.length > 1 ? (
        <div className="mb-4">
          <select
            value={idx}
            onChange={(e) => setSelectedUrlIndex(Number(e.target.value))}
            className="rounded-lg border border-[var(--seo-border-strong)] bg-white px-3 py-2 text-sm"
          >
            {results.map((res, i) => (
              <option key={res.url} value={i}>
                {res.url}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-3">
        <ScoreBadge score={r.seo_score ?? 0} />
        <span className="text-sm text-[var(--seo-text-light)]">
          Status {r.status_code ?? "—"} · {issues.length} issues · {r.response_time?.toFixed?.(2) ?? "—"}s
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-[var(--seo-border)]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t-lg px-3 py-2 text-sm font-medium ${
              tab === t
                ? "border-b-2 border-[var(--seo-accent)] text-[var(--seo-accent)]"
                : "text-[var(--seo-text-light)] hover:text-[var(--seo-subheading)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">
              Score Breakdown
            </h3>
            <div className="flex flex-col gap-2">
              {Object.entries(breakdown).map(([cat, val]) => (
                <div key={cat}>
                  <div className="flex justify-between text-xs text-[var(--seo-text-light)]">
                    <span className="capitalize">
                      {cat.replace(/_/g, " ")} ({Math.round((WEIGHTS[cat] || 0) * 100)}%)
                    </span>
                    <span>{Math.round(val as number)}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full rounded-full bg-[var(--seo-card-hover)]">
                    <div
                      className="h-1.5 rounded-full bg-[var(--seo-accent)]"
                      style={{ width: `${Math.max(0, Math.min(100, val as number))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">
              SERP Preview
            </h3>
            <div className="rounded-lg border border-[var(--seo-border)] p-3">
              <div className="truncate text-xs text-[var(--seo-success)]">{r.final_url || r.url}</div>
              <div className="mt-0.5 truncate text-lg text-[#1A0DAB]">
                {r.metadata?.title || "Untitled page"}
              </div>
              <div className="mt-0.5 line-clamp-2 text-sm text-[var(--seo-text-light)]">
                {r.metadata?.description || "No meta description set."}
              </div>
            </div>
            <div className="mt-3 flex gap-3 text-xs text-[var(--seo-text-light)]">
              <span>Title: {r.metadata?.title_length ?? 0} chars</span>
              <span>Description: {r.metadata?.description_length ?? 0} chars</span>
              <span>OG tags: {r.metadata?.has_og_tags ? "Yes" : "No"}</span>
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--seo-subheading)]">
                AI Summary
              </h3>
              <button
                type="button"
                onClick={runAiSummary}
                disabled={aiLoading}
                className="rounded-lg border border-[var(--seo-border-strong)] px-3 py-1.5 text-sm font-medium text-[var(--seo-subheading)] hover:bg-[var(--seo-card-hover)] disabled:opacity-50"
              >
                {aiLoading ? "Summarising…" : "Generate AI Summary"}
              </button>
            </div>
            {!aiSummary && !aiLoading ? (
              <p className="text-sm text-[var(--seo-muted)]">
                Get a plain-English health summary and prioritized fixes powered by Groq. Add
                a key in Settings, or the app falls back to the server default if configured.
              </p>
            ) : null}
            {aiSummary && !aiSummary.ok ? (
              <p className="text-sm text-[var(--seo-error)]">{aiSummary.error}</p>
            ) : null}
            {aiSummary && aiSummary.ok ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-[var(--seo-text)]">{aiSummary.explanation}</p>
                {aiSummary.top_actions && aiSummary.top_actions.length > 0 ? (
                  <ul className="list-disc pl-5 text-sm text-[var(--seo-text)]">
                    {aiSummary.top_actions.map((action, i) => (
                      <li key={i}>{action}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "Issues" ? (
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([theme, themeIssues]) => (
            <Card key={theme}>
              <h3 className="mb-1 text-sm font-semibold text-[var(--seo-subheading)]">
                {theme} ({themeIssues.length})
              </h3>
              {themeIssues.map((issue, i) => (
                <IssueRow key={i} issue={issue} />
              ))}
            </Card>
          ))}
          {issues.length === 0 ? <EmptyState title="No issues found" /> : null}
        </div>
      ) : null}

      {tab === "Links" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">
              Internal Links
            </h3>
            <KeyValueGrid
              data={{
                total: r.internal_links?.total_links,
                dofollow: r.internal_links?.dofollow_count,
                nofollow: r.internal_links?.nofollow_count,
                broken: r.internal_links?.broken_count,
              }}
            />
          </Card>
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">
              External Links
            </h3>
            <KeyValueGrid
              data={{
                total: r.external_links?.total_links,
                dofollow: r.external_links?.dofollow_count,
                nofollow: r.external_links?.nofollow_count,
                broken: r.external_links?.broken_count,
              }}
            />
          </Card>
        </div>
      ) : null}

      {tab === "Content & Images" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">Content</h3>
            <KeyValueGrid
              data={Object.fromEntries(
                Object.entries(r.content || {}).filter(
                  ([k]) => !["intro_paragraphs", "conclusion_paragraphs", "intro_paragraphs_html", "conclusion_paragraphs_html"].includes(k),
                ),
              )}
            />
          </Card>
          <Card className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--seo-subheading)]">
                Body Content Preview
              </h3>
              <div className="flex items-center gap-3 text-xs text-[var(--seo-text-light)]">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "#1D4ED8" }} />
                  Internal link
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "#7C3AED" }} />
                  External link
                </span>
              </div>
            </div>
            {(r.content?.intro_paragraphs_html?.length || r.content?.conclusion_paragraphs_html?.length) ? (
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-[var(--seo-text)]">
                {(r.content?.intro_paragraphs_html || []).map((html: string, i: number) => (
                  <p key={`intro-${i}`} dangerouslySetInnerHTML={{ __html: html }} />
                ))}
                {(r.content?.conclusion_paragraphs_html || []).map((html: string, i: number) => (
                  <p key={`concl-${i}`} dangerouslySetInnerHTML={{ __html: html }} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--seo-muted)]">
                No intro/conclusion paragraph text captured for this page.
              </p>
            )}
          </Card>
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">
              Images
            </h3>
            <KeyValueGrid data={r.image_detail?.summary || r.image_detail || {}} />
          </Card>
        </div>
      ) : null}

      {tab === "Technical" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">
              Technical SEO
            </h3>
            <KeyValueGrid data={r.technical_seo || {}} />
          </Card>
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">
              Advanced / Security Headers
            </h3>
            <KeyValueGrid
              data={Object.fromEntries(
                Object.entries(r.advanced || {}).filter(([k]) => k !== "technical_seo"),
              )}
            />
          </Card>
          <Card className="lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-[var(--seo-subheading)]">
              Site Health
            </h3>
            <KeyValueGrid
              data={{
                robots: r.site_health?.robots,
                sitemap: r.site_health?.sitemap,
                domain_age: r.site_health?.domain_age,
                ssl: r.site_health?.ssl,
                dns: r.site_health?.dns,
                readability: r.site_health?.readability,
                content_freshness: r.site_health?.content_freshness,
                canonical_loop: r.site_health?.canonical_loop,
                www_redirect: r.site_health?.www_redirect,
                http2: r.site_health?.http2,
              }}
            />
          </Card>
        </div>
      ) : null}

      {tab === "Recommendations" ? (
        <Card>
          <h3 className="mb-1 text-sm font-semibold text-[var(--seo-subheading)]">
            Top Issues by Impact
          </h3>
          {topIssues.map((issue, i) => (
            <IssueRow key={i} issue={issue} />
          ))}
        </Card>
      ) : null}
    </div>
  );
}

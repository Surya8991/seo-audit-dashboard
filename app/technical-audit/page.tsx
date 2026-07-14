"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAudit } from "@/lib/state/AuditContext";
import { Card, PageHeader } from "@/components/ui";
import type { AuditResult } from "@/lib/types";
import { parseUrlList } from "@/lib/crawl/parseUrlList";
import {
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  runCrawl,
  type CrawlProgress,
} from "@/lib/crawl/orchestrator";

type InputMode = "single" | "sitemap" | "list" | "crawl";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const MODES: { id: InputMode; label: string; icon: string; hint: string }[] = [
  { id: "single", label: "Single URL", icon: "🔗", hint: "Audit one page." },
  { id: "sitemap", label: "Sitemap", icon: "🗺️", hint: "Sitewide audit from sitemap.xml." },
  { id: "crawl", label: "Crawl from URL", icon: "🕷️", hint: "Discover pages by following links — no sitemap needed." },
  { id: "list", label: "CSV / Paste URLs", icon: "📄", hint: "Bulk audit a list of URLs." },
];

export default function TechnicalAuditPage() {
  const router = useRouter();
  const { addResult, addResults } = useAudit();

  const [mode, setMode] = useState<InputMode>("single");

  // Shared audit options
  const [auditType, setAuditType] = useState<"auto" | "course" | "blog" | "general">("auto");
  const [checkLinks, setCheckLinks] = useState(true);
  const [fetchPagespeed, setFetchPagespeed] = useState(false);

  // Single-URL
  const [url, setUrl] = useState("");

  // Sitemap
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [includePattern, setIncludePattern] = useState("");
  const [excludePattern, setExcludePattern] = useState("");

  // Crawl from URL
  const [crawlSeedUrl, setCrawlSeedUrl] = useState("");
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [robotsMode, setRobotsMode] = useState<"respect" | "ignore" | "ignore_but_report">("respect");
  const [maxDepth, setMaxDepth] = useState(3);

  // List / CSV
  const [pastedList, setPastedList] = useState("");

  // Bulk options
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);

  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "resolving" | "crawling" | "done">("idle");
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [resolvedCount, setResolvedCount] = useState<{ found: number; capped: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running = phase === "resolving" || phase === "crawling";

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setPastedList(String(reader.result || ""));
    reader.readAsText(file);
  }

  async function runSingle() {
    if (!url.trim()) return;
    setPhase("crawling");
    setError(null);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), auditType, checkLinks, fetchPagespeed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Audit failed.");
        setPhase("idle");
        return;
      }
      const result = data as AuditResult;
      if (result.fetch_error) setError(result.fetch_error);
      addResult(result);
      router.push("/detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit failed.");
      setPhase("idle");
    }
  }

  async function resolveUrls(): Promise<string[] | null> {
    if (mode === "list") {
      const parsed = parseUrlList(pastedList);
      if (parsed.urls.length === 0) {
        setError("No valid http(s) URLs found in the list.");
        return null;
      }
      const capped = parsed.urls.slice(0, limit);
      setResolvedCount({ found: parsed.urls.length, capped: parsed.urls.length > limit });
      return capped;
    }

    if (mode === "crawl") {
      if (!crawlSeedUrl.trim()) {
        setError("Enter a URL to start crawling from.");
        return null;
      }
      setPhase("resolving");
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seedUrl: crawlSeedUrl.trim(),
          maxPages: limit,
          maxDepth,
          includeSubdomains,
          robotsMode,
          includePattern: includePattern.trim() || undefined,
          excludePattern: excludePattern.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Crawl failed.");
        setPhase("idle");
        return null;
      }
      setResolvedCount({ found: data.total_found, capped: data.capped });
      return data.urls as string[];
    }

    // sitemap
    if (!sitemapUrl.trim()) {
      setError("Enter a sitemap URL or domain.");
      return null;
    }
    setPhase("resolving");
    const res = await fetch("/api/sitemap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sitemapUrl: sitemapUrl.trim(),
        limit,
        includePattern: includePattern.trim() || undefined,
        excludePattern: excludePattern.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not read sitemap.");
      setPhase("idle");
      return null;
    }
    setResolvedCount({ found: data.total_found, capped: data.capped });
    return data.urls as string[];
  }

  async function runBulk() {
    setError(null);
    setProgress(null);
    setResolvedCount(null);
    const urls = await resolveUrls();
    if (!urls || urls.length === 0) {
      if (!error) setError("No URLs to audit.");
      setPhase("idle");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("crawling");
    setProgress({ total: urls.length, completed: 0, succeeded: 0, failed: 0, inFlight: 0, lastUrl: "" });

    const batch: AuditResult[] = [];
    await runCrawl(
      urls,
      { auditType, checkLinks, fetchPagespeed, concurrency },
      {
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
        onResult: (r) => {
          batch.push(r);
          // Flush to persisted state every 5 results so /results updates live-ish.
          if (batch.length >= 5) {
            addResults(batch.splice(0, batch.length));
          }
        },
      },
    );
    if (batch.length) addResults(batch);
    abortRef.current = null;
    setPhase("done");
  }

  function cancel() {
    abortRef.current?.abort();
    setPhase("done");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "single") return runSingle();
    return runBulk();
  }

  const inputClass =
    "w-full rounded-lg border border-[var(--seo-border-strong)] bg-[var(--seo-card-bg)] px-3 py-2 text-sm text-[var(--seo-text)] outline-none focus:border-[var(--seo-accent)]";

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="🚀 Technical Audit"
        subtitle="Run a technical SEO audit on a single URL, an entire sitemap, a crawl, or a list of URLs."
      />

      {/* Mode selector */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            disabled={running}
            className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
              mode === m.id
                ? "border-[var(--seo-accent)] bg-[var(--seo-accent-light)]"
                : "border-[var(--seo-border)] hover:bg-[var(--seo-card-hover)]"
            }`}
          >
            <span className="text-lg">{m.icon}</span>
            <span className="mt-1 text-sm font-semibold text-[var(--seo-subheading)]">{m.label}</span>
            <span className="text-xs text-[var(--seo-muted)]">{m.hint}</span>
          </button>
        ))}
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "single" ? (
            <Field label="URL to audit">
              <input
                type="url"
                required
                placeholder="https://example.com/page"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={inputClass}
              />
            </Field>
          ) : null}

          {mode === "sitemap" ? (
            <>
              <Field label="Sitemap URL or domain">
                <input
                  type="text"
                  placeholder="https://www.example.com/sitemap.xml"
                  value={sitemapUrl}
                  onChange={(e) => setSitemapUrl(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Include pattern (regex, optional)">
                  <input
                    type="text"
                    placeholder="/blog/"
                    value={includePattern}
                    onChange={(e) => setIncludePattern(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Exclude pattern (regex, optional)">
                  <input
                    type="text"
                    placeholder="/tag/|/author/"
                    value={excludePattern}
                    onChange={(e) => setExcludePattern(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
            </>
          ) : null}

          {mode === "crawl" ? (
            <>
              <Field label="Start URL">
                <input
                  type="url"
                  placeholder="https://www.example.com/"
                  value={crawlSeedUrl}
                  onChange={(e) => setCrawlSeedUrl(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Include pattern (regex, optional)">
                  <input
                    type="text"
                    placeholder="/blog/"
                    value={includePattern}
                    onChange={(e) => setIncludePattern(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Exclude pattern (regex, optional)">
                  <input
                    type="text"
                    placeholder="/tag/|/author/"
                    value={excludePattern}
                    onChange={(e) => setExcludePattern(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Max crawl depth">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxDepth}
                    onChange={(e) => setMaxDepth(Math.max(1, Math.min(10, Number(e.target.value) || 3)))}
                    className={inputClass}
                  />
                </Field>
                <Field label="robots.txt handling">
                  <select
                    value={robotsMode}
                    onChange={(e) => setRobotsMode(e.target.value as typeof robotsMode)}
                    className={inputClass}
                  >
                    <option value="respect">Respect (skip disallowed)</option>
                    <option value="ignore_but_report">Ignore but report</option>
                    <option value="ignore">Ignore</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--seo-text)]">
                <input
                  type="checkbox"
                  checked={includeSubdomains}
                  onChange={(e) => setIncludeSubdomains(e.target.checked)}
                />
                Include subdomains
              </label>
            </>
          ) : null}

          {mode === "list" ? (
            <>
              <Field label="Paste URLs (one per line) or a CSV with a url column">
                <textarea
                  rows={6}
                  placeholder={"https://example.com/\nhttps://example.com/about"}
                  value={pastedList}
                  onChange={(e) => setPastedList(e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <label className="text-sm text-[var(--seo-text-light)]">
                …or upload a .csv / .txt file:{" "}
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  className="text-sm"
                />
              </label>
            </>
          ) : null}

          {/* Bulk options */}
          {mode !== "single" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={`URL limit (max ${MAX_LIMIT})`}>
                <input
                  type="number"
                  min={1}
                  max={MAX_LIMIT}
                  value={limit}
                  onChange={(e) => setLimit(Math.max(1, Math.min(MAX_LIMIT, Number(e.target.value) || DEFAULT_LIMIT)))}
                  className={inputClass}
                />
              </Field>
              <Field label={`Parallel workers (max ${MAX_CONCURRENCY})`}>
                <input
                  type="number"
                  min={1}
                  max={MAX_CONCURRENCY}
                  value={concurrency}
                  onChange={(e) =>
                    setConcurrency(Math.max(1, Math.min(MAX_CONCURRENCY, Number(e.target.value) || DEFAULT_CONCURRENCY)))
                  }
                  className={inputClass}
                />
              </Field>
            </div>
          ) : null}

          <Field label="Audit type">
            <select
              value={auditType}
              onChange={(e) => setAuditType(e.target.value as typeof auditType)}
              className={inputClass}
            >
              <option value="auto">Auto-Detect</option>
              <option value="course">Course</option>
              <option value="blog">Blog</option>
              <option value="general">General</option>
            </select>
          </Field>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--seo-text)]">
              <input type="checkbox" checked={checkLinks} onChange={(e) => setCheckLinks(e.target.checked)} />
              Check links
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--seo-text)]">
              <input type="checkbox" checked={fetchPagespeed} onChange={(e) => setFetchPagespeed(e.target.checked)} />
              Fetch PageSpeed Insights (much slower — not recommended for bulk)
            </label>
          </div>

          {error ? (
            <div className="rounded-lg border border-[var(--seo-error-border)] bg-[var(--seo-error-bg)] px-3 py-2 text-sm text-[var(--seo-error)]">
              {error}
            </div>
          ) : null}

          {!running ? (
            <button
              type="submit"
              className="rounded-lg btn-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {mode === "single" ? "Run Audit" : "Run Technical Audit"}
            </button>
          ) : (
            <button
              type="button"
              onClick={cancel}
              className="rounded-lg border border-[var(--seo-error-border)] bg-[var(--seo-error-bg)] px-4 py-2 text-sm font-semibold text-[var(--seo-error)]"
            >
              Cancel
            </button>
          )}
        </form>
      </Card>

      {/* Progress */}
      {phase === "resolving" ? (
        <Card className="mt-4">
          <p className="text-sm text-[var(--seo-text)]">Reading sitemap…</p>
        </Card>
      ) : null}

      {progress ? (
        <Card className="mt-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold text-[var(--seo-subheading)]">
              {phase === "done" ? "Audit complete" : "Auditing…"}
            </span>
            <span className="text-[var(--seo-text-light)]">
              {progress.completed} / {progress.total}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--seo-card-hover)]">
            <div
              className="h-2 rounded-full transition-all"
              style={{
                width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%`,
                background: "var(--seo-gradient)",
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--seo-text-light)]">
            <span>✅ {progress.succeeded} ok</span>
            <span>⚠️ {progress.failed} failed</span>
            {resolvedCount ? (
              <span>
                {resolvedCount.found} found{resolvedCount.capped ? ` (capped to ${limit})` : ""}
              </span>
            ) : null}
            {progress.lastUrl ? <span className="truncate">Last: {progress.lastUrl}</span> : null}
          </div>
          {phase === "done" ? (
            <button
              type="button"
              onClick={() => router.push("/results")}
              className="mt-3 rounded-lg btn-gradient px-4 py-2 text-sm font-semibold text-white"
            >
              View {progress.completed} results
            </button>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--seo-subheading)]">{label}</label>
      {children}
    </div>
  );
}

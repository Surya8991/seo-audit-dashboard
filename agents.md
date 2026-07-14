# agents.md

## Project overview
SEO Technical Audit Dashboard: Next.js (App Router, TypeScript, Tailwind)
frontend with Python serverless functions (Vercel-style `api/*.py`) as the
audit engine. Merged from
[venkataramana-d/seo-technical-audit-dashboard-main](https://github.com/venkataramana-d/seo-technical-audit-dashboard-main)
(base) with the site-health checks and Groq AI summary from this project's
prior standalone Streamlit SEO audit tool ported in on top.

## Stack
- Frontend: Next.js 16, React 19, Tailwind CSS 4, Recharts
- Backend: Python 3, plain `http.server.BaseHTTPRequestHandler` handlers under
  `api/` (Vercel Python runtime convention: each file exports a `handler`
  class), no framework
- No database: all audit results are computed on-demand per request and
  persisted client-side only (IndexedDB via `lib/state/AuditContext.tsx` +
  `lib/state/idbStore.ts`; see the gotcha below on why it's IndexedDB and not
  localStorage)

## Key directories/files
- `app/`: Next.js pages: dashboard (`/`), **`technical-audit`** (single URL,
  sitemap, crawl, or CSV-paste multi-input audit, formerly `new-audit`),
  results (domain-grouped list), detail (per-URL drill-down), settings.
  The former standalone `links`, `headings`, and `performance` pages are folded
  into `app/detail/page.tsx` as tabs backed by `components/detail/LinksView.tsx`,
  `HeadingsView.tsx`, and `PerformanceView.tsx`. Report export is NOT a page: it
  is an action bar (`components/ExportBar.tsx`) on the Results page (POSTs to
  `api/export.py`); the old `app/export/page.tsx` was removed. Nav is 4 items
  (Dashboard, Technical Audit, Results, Settings): results and detail are one
  section (`/detail` highlights "Results", see `resolveActiveHref` in
  `components/AppShell.tsx`); the list routes to the detail via
  `setSelectedUrlIndex` + `router.push("/detail")`.
- **Site health grade:** `lib/siteScore.ts` (`siteScore`/`healthGrade`/
  `gradeColor`) computes an Ahrefs-style site health score (percent of audited
  pages with zero Critical/High issue) plus an A-F letter grade, surfaced as a
  grade ring on the Results "Sitewide Summary" card. Ported from
  `modules/site_scoring.py` on `origin/venkataramana-work` (that Python module
  was NOT copied in: it expects a crawl `Job` store we do not run; results live
  client-side, so the port is TypeScript). Distinct from the per-page weighted
  SEO score in `lib/scoring.ts`.
- **Fix-difficulty labels:** every issue carries an `effort` field (Low/Medium/
  High) from `modules/technical_checks.py::_issue` and `modules/auditor.py`.
  `lib/difficulty.ts` maps that to Easy/Medium/Hard (keyword fallback when
  `effort` is absent); surfaced via `DifficultyBadge` (in `components/ui.tsx`,
  wired into `IssueRow`), a "Fix effort" column on the Results list, and a
  rollup on the detail header. Do NOT re-derive difficulty ad hoc; use
  `fixDifficulty`/`difficultyBreakdown`.
- **Email-DNS checks are informational, not scored.** SPF / DMARC / MX (and the
  `dns_health_check` summary) are email-deliverability records, not SEO ranking
  signals. `check_dns_health` collects the records but emits NO scored issues;
  the checklist reports them with status `"info"` (a 4th `ChecklistStatus`,
  excluded from the pass/warning/fail summary, which now also carries an `info`
  count). Do NOT reintroduce them as warnings/failures or into `all_issues`.
- **Common Issues & Fixes knowledge base:** `lib/commonIssuesKB.ts`
  (`explainCommonIssue`) generalizes the per-image issue explainer pattern
  (`lib/imageAnalysis.ts::explainImageIssue`) to the app's other issue
  categories: a curated top-~20 list of the most common real issue titles
  (matched by regex against the actual strings emitted by
  `modules/{auditor,technical_checks,advanced_checks,link_auditor,
  mobile_auditor,image_auditor}.py`), each with what-is-it / why-it-matters /
  SEO impact / user impact / recommended fix, and a `source` citation for
  facts that change over time (Core Web Vitals thresholds, mobile-first
  indexing) grounded in a 2026 web search (Google Search Central, web.dev).
  Wired into `IssueRow` (`components/ui.tsx`) as an inline "Learn more →"
  expansion, shown only when a KB entry matches; NOT exhaustive coverage of
  every possible issue string by design. Guarded by
  `lib/commonIssuesKB.test.ts`.
- `api/audit.py`: runs a full audit for one URL, returns `modules.auditor.audit_url()` almost verbatim
- `api/sitemap.py`: resolves a sitemap (or bare domain) to a URL list for the
  sitewide Technical Audit; see "Sitewide/bulk audit architecture" below
- `api/crawl.py`: discovery-only BFS crawl (no sitemap needed). Given a seed
  URL, follows internal links to build a URL list, same contract shape as
  `api/sitemap.py` (`{urls, total_found, capped}`). Always calls
  `crawl_site(..., run_full_audit=False)`; per-page SEO audits happen via the
  same client orchestrator as the other bulk modes, not inside this endpoint.
- `api/ai-summary.py`: Groq AI plain-English summary endpoint
- `api/pagespeed.py`, `api/export.py`, `api/config-status.py`
- `modules/auditor.py`: core fetch + orchestration, SSRF guard (`validate_audit_url`).
  `audit_url(..., prefetched=None)` accepts an already-fetched page (the shape
  `fetch_page()` returns) to avoid a duplicate fetch when a caller (e.g.
  `modules/crawler.py`) already has the page in hand.
- `modules/sitemap_extractor.py`: sitemap/sitemap-index fetch + recursion
  (depth cap 5), gzip support, SSRF-validated, dedup + include/exclude filter
  + URL cap (default 50, max 200). Adapts the parse logic already in
  `technical_checks.py::check_sitemap` (which only counts URLs; this module
  returns them).
- `modules/crawler.py`: `CrawlConfig` + `crawl_site()`: BFS link-discovery
  crawl with seed selection (homepage/sitemap/URL list), scope control
  (domain/subdomain + include/exclude regex + depth/page caps), UA presets
  (default/googlebot/googlebot-mobile/bingbot), and 3 robots.txt modes
  (respect/ignore/ignore_but_report). `run_full_audit=True` will also run
  `audit_url()` per discovered page (useful for CLI/synchronous use, but NOT
  what `api/crawl.py` uses, see above). Adopted from the `venkataramana-work`
  branch of this repo (do not delete that branch: it has a phases.md roadmap
  for a future async job-queue crawl architecture, phases 2-6, not yet built here).
- `modules/technical_checks.py`: domain age (WHOIS), SSL, HTTPS enforcement
  (does http:// redirect to https://?), DNS/SPF/DMARC/MX, robots.txt,
  sitemap.xml, readability, content freshness, canonical-loop detection,
  www-redirect consistency, HTTP/2, aggregated as `site_health`
- `modules/ai_assist.py`: Groq `explain_audit()`
- `modules/technical_audit_checklist.py`: builds the 35-check "Technical SEO
  Audit" checklist (crawlability/on_page/site_health groups, pass/warning/
  fail/**info** per check, the "info" status is the email-DNS checks, see
  below) ported from the standalone tool's use-case definition; it's a
  read-only view derived from an already-computed `audit_url()` result, never
  re-fetches or re-scores. Exposed as `result["technical_audit_checklist"]`.
- **Detail page "Technical" tab** (`app/detail/page.tsx`): a single merged tab
  (previously two separate "Technical Audit" and "Technical" tabs, confusing
  side by side; merged into one). Organized into the checklist's 3 real
  use-case sections, Crawlability / On-Page / Site Health, each pairing the
  pass/warning/fail/info `ChecklistGroupCard` for that group with its matching
  rich detail card(s): Crawlability -> redirect chain + hreflang; On-Page ->
  Schema Audit (structured-data types/errors), Mobile Responsiveness (summary
  card, cross-links to the full mobile audit on the Performance tab instead of
  duplicating it), Social Preview (OG); Site Health -> domain/protocol detail
  + security headers. The old "estimated Core Web Vitals" card was dropped
  (superseded by Performance tab's real PSI-based CWV, keeping it was a
  duplicate). Detail tabs are now 8: Overview, Technical, Issues, Links,
  Headings, Content & Images, Performance, Recommendations.
- `lib/checklistDefs.ts`: the **frontend mirror** of the 35 check ids/labels/
  groups in `modules/technical_audit_checklist.py`, plus a one-sentence
  plain-English `description` per check (used by the explainer card, the
  check-selection panel, and per-check tooltips). Keep in sync with the
  Python module; `lib/checklistDefs.test.ts` guards the 35-total / 12-11-12
  group split but can't catch an id renamed on only one side.
- `lib/useSelectedChecks.ts`: shared localStorage-persisted hook for which
  checks are enabled (default: all 35). Used by `components/CheckSelector.tsx`
  (the "Customize checks" panel on the Technical Audit page) to edit the
  selection, and by the detail page's Technical tab to filter which
  checks are displayed. **Display-only filter**: the backend always computes
  all 35 checks in one `audit_url()` call regardless of selection, since
  they're bundled into a single page fetch and skipping individual checks
  server-side wouldn't meaningfully speed anything up.
- `components/HelpDialog.tsx`: reusable "ⓘ" icon button that opens a small
  plain-English explanation popover; used on each Technical Audit input-mode
  card and each checklist group (Crawlability/On-Page/Site Health).
- `components/ChecklistExplainer.tsx`: the "What Technical SEO checks" card
  (all 35 checks as pills + a "when to use" note), mirroring the reference
  tool's use-case explainer. Rendered on `app/technical-audit/page.tsx` below
  the audit form (not above it), and collapsed by default so it doesn't push
  the form below the fold; expands on click to show the full check list.
- `modules/advanced_checks.py`, `link_auditor.py`, `image_auditor.py`,
  `heading_auditor.py`, `mobile_auditor.py`, `course_auditor.py`,
  `blog_auditor.py`, `pagespeed.py`, `report_generator.py`, `scoring.py`
- `lib/aggregate.ts`, `lib/scoring.ts`: **must stay in sync** with
  `modules/scoring.py`'s `WEIGHTS`/`THEMES` (duplicated by design, see the
  comment in `lib/aggregate.ts`, to avoid round-tripping to the Python API
  just to group/sort already-computed issues)
- `lib/state/AuditContext.tsx`: client-side persisted state (results, Groq API
  key), backed by `lib/state/idbStore.ts` (IndexedDB, see gotcha below).
  `addResults(results[])` batches N results into one state update/one
  persisted write; use this for bulk audits, not a loop of `addResult`.
  Exposes `storageWarning` (shown as a banner in `AppShell.tsx`) for the rare
  case a save still fails.
- `lib/useTheme.ts`: shared light/dark toggle logic (pub-sub so multiple
  mounted toggles, e.g. the sidebar `ThemeToggle` and the Settings page's
  Appearance card, stay in sync live without a reload).
- `lib/crawl/parseUrlList.ts`: client-side CSV/TSV/paste URL-list parser (no
  upload, no server storage). Detects a url/link header column or scrapes any
  http(s) cell.
- `lib/crawl/orchestrator.ts`: `runCrawl(urls, opts, callbacks)`: bounded-
  concurrency (default 5, max 10) fan-out of single-URL `/api/audit` calls from
  the browser, with progress + incremental-result callbacks and abort support.
  Not capped at any URL count itself; `lib/crawl/chunkedRunner.ts` is what
  chunks a large list before handing each chunk to this.
- `lib/crawl/chunkedRunner.ts`: `runChunked(allUrls, remainingUrls, options,
  label, callbacks, resumeFrom?)`: splits a URL list into `CHUNK_SIZE=200`
  batches, auto-advancing through `runCrawl` per chunk, and persists a
  resumable checkpoint (remaining URLs + cumulative succeeded/failed) to
  IndexedDB after every single result, not just at chunk boundaries. Powers
  the "Interrupted audit found: Resume/Discard" banner on
  `app/technical-audit/page.tsx`. See "Sitewide/bulk audit architecture" below.
- `tests/`: pytest unit tests (pure-logic checklist tests + mocked-network
  tests for `check_https_enforcement`/X-Robots-Tag handling + sitemap
  extractor); see "Testing" below. `lib/crawl/*.test.ts`: Vitest unit tests
  for the URL-list parser and the chunked runner (`vitest.config.ts` adds the
  `@/*` path alias plain Vitest doesn't resolve on its own).

## How to run
```bash
npm install
python -m venv .venv && source .venv/bin/activate  # .venv\Scripts\activate on Windows
pip install -r requirements.txt
npm run dev
```
`/api/*.py` endpoints only run under Vercel's runtime (`vercel dev`); plain
`next dev` 404s on API calls, expected for frontend-only work.

## Sitewide/bulk audit architecture
The Technical Audit page (`app/technical-audit/page.tsx`) supports Single URL,
Sitemap, Crawl-from-URL, and CSV/Paste modes. Because this app is stateless
Vercel serverless (no DB, no long-lived process, no SSE, 60s/function cap,
see `vercel.json`), sitewide audits are **client-orchestrated**, not
server-orchestrated like the reference tools (SEO Suite uses a long-lived
Flask process + daemon thread + SSE + on-disk checkpointing; the
`venkataramana-work` branch's own crawl roadmap plans an async job-queue;
neither model ports here as-is):
1. One of three URL-resolution steps runs first, each bounded and fast enough
   to fit in a single invocation: `api/sitemap.py` (sitemap/sitemap-index
   fetch, cap 4000, `MAX_URL_CAP` in `modules/sitemap_extractor.py`),
   `api/crawl.py` (BFS link discovery, `run_full_audit=False`, cap 200; lower
   than sitemap's because discovery itself does a real per-page fetch), or
   the client-side CSV/paste parser (no network call, cap 4000, `MAX_LIMIT`
   in `app/technical-audit/page.tsx`).
2. `lib/crawl/chunkedRunner.ts::runChunked` splits the resolved list into
   `CHUNK_SIZE=200` batches. Each batch goes through
   `lib/crawl/orchestrator.ts::runCrawl`, which fans out bounded-concurrency
   single-URL `POST /api/audit` calls, one invocation per URL, so nothing
   risks the function timeout. Batches auto-advance with no user action
   needed as long as the tab stays open; a checkpoint (remaining URLs +
   cumulative succeeded/failed) persists to IndexedDB after every result, so
   a closed/crashed tab can resume instead of restarting.
3. Results batch into `AuditContext.addResults()` (one state update per batch,
   not per URL) and the Results page renders a sitewide rollup card
   (avg score, score distribution, top failing checks) when 2+ URLs are present.

Live-verified end-to-end against `https://www.edstellar.com/sitemap.xml`
(2,461 URLs), see `tests/test_sitewide_pipeline_live.py` (opt-in,
`RUN_LIVE_TESTS=1`) and `PROJECT_LOG.md` session history.

## Env vars
- `PSI_API_KEY` (optional): PageSpeed Insights quota
- `GROQ_API_KEY` (optional): server-side default for the AI Summary feature;
  users can also paste their own key in Settings (stored in browser localStorage only)

## Testing
```bash
# Python
source .venv/Scripts/activate  # .venv/bin/activate on macOS/Linux
pip install -r requirements-dev.txt
python -m pytest tests/ -v                       # unit tests, network mocked
RUN_LIVE_TESTS=1 python -m pytest tests/ -v       # + opt-in live network tests

# Frontend (Vitest)
npm run test
```
`conftest.py` at the repo root puts the project root on `sys.path` so
`from modules...` imports resolve without the `api/*.py` Vercel-handler
sys.path shim. Live tests (`test_live_edstellar_sitemap`,
`test_sitewide_pipeline_live.py`) are skipped by default; they hit the real
Edstellar sitemap/pages and take 30+ seconds. Opt in with `RUN_LIVE_TESTS=1`.

## Agent notes / gotchas
- **SSRF: any new outbound fetch of a user/target-influenced URL must go
  through the guards.** The app audits arbitrary user-supplied URLs, so
  `modules/auditor.py::validate_audit_url` (blocks private/reserved IPs and
  hostnames that resolve to them) and `modules/auditor.py::safe_get` (follows
  redirects manually, re-validating every hop, so a public URL that 301s to an
  internal/metadata host is blocked mid-chain) are the guards. `fetch_page`
  uses `safe_get`. Callers that fetch URLs derived from page content or a
  target's robots.txt/sitemap (`link_auditor.validate_url`,
  `crawler._fetch_sitemap_locs`) call `validate_audit_url` first. Redirect
  targets in `technical_checks.py` cross-host followers are NOT yet
  re-validated (they always start from the already-validated audit domain, so
  lower risk; see PROJECT_LOG Session 10 residuals). Covered by
  `tests/test_ssrf.py`.
- **`all_issues` aggregation excludes the legacy `headings` and `images`
  blocks** (`auditor.py`): `heading_detail`/`image_detail` are the thorough
  versions scoring uses, and including both would double-count. If you add a
  new check module, add its key to that aggregation list AND make sure its
  issue `category` is mapped in `scoring.py`/`aggregate.ts` `THEMES` (an
  unmapped category silently lands in the "Other" bucket, which is how the
  "Image SEO" issues were getting lost).
- `lib/crawl/chunkedRunner.ts::runChunked`'s optional `resumeFrom` param
  (`{succeeded, failed, startedAt}`) exists because a prior version reset
  succeeded/failed to 0 on every resume, silently showing only the resumed
  session's count instead of the cumulative total for the whole job. If you
  change this module, keep the checkpoint (not the in-memory counters) as
  the source of truth for cumulative counts across a pause/resume boundary.
- **Persistence is IndexedDB, not localStorage** (`lib/state/idbStore.ts`,
  used by `AuditContext.tsx`). It used to be localStorage, but every state
  change serializes the WHOLE `results` array as one blob, and a bulk audit
  of ~200 URLs (each a full `audit_url()` result, 50-200KB) routinely blew
  past localStorage's ~5-10MB per-origin quota and threw
  `QuotaExceededError`, crashing the app. Don't add a second localStorage
  write path for audit results; `AuditContext` migrates any legacy
  localStorage data on first load, then removes it. If you ever see the
  quota error again, it means something is bypassing `AuditContext`.
- Don't build a second dark-mode toggle from scratch. `lib/useTheme.ts` is
  the single source of truth (pub-sub so every mounted toggle stays in sync
  live); both `components/ThemeToggle.tsx` (sidebar) and the Settings page's
  Appearance card use it.
- Every check module returns `{..., "issues": [...]}` where each issue is
  `{issue, category, severity, recommendation, impact_score, effort}`; follow
  this convention for any new check so it aggregates into `all_issues` and
  `modules/scoring.py`'s category scoring automatically.
- `modules/technical_checks.py`'s checks run concurrently via
  `ThreadPoolExecutor` in `analyze_site_health()`; several hit the domain
  root or DNS independently of the already-fetched page (robots.txt,
  sitemap.xml, WHOIS, SSL socket, DNS, www-alt-domain, HTTP/2). Readability
  and content-freshness reuse the already-parsed page text/soup/headers to
  avoid a duplicate fetch, don't refetch there.
- `python-whois`, `dnspython`, `httpx[http2]`, `textstat` are optional at
  import time in `technical_checks.py`; each check degrades to
  `{"available": False, "issues": []}` if the package is missing, rather than
  crashing the audit.
- Any change to `modules/scoring.py`'s `WEIGHTS`/`THEMES` must be mirrored in
  `lib/scoring.ts`/`lib/aggregate.ts` in the same commit; doc/config drift
  between the two is a bug.
- The Groq API key entered in Settings is sent per-request to
  `/api/ai-summary` and stored only in browser localStorage, never persisted
  server-side. Don't add server-side storage for it without discussing first.
- X-Robots-Tag `noindex` is owned by `modules/advanced_checks.py::analyze_http_headers`
  (it's the one that appends the issue); `modules/auditor.py::analyze_indexability`
  only folds it into `is_indexable` and separately flags `nofollow` (which
  `advanced_checks.py` does not cover). Don't re-add a noindex issue there or
  it'll double-count against the score.
- `modules/technical_audit_checklist.py`'s 35 checks are the SEO Suite
  `technical_seo` use case (`crawlability` + `on_page` + `site_health` only,
  no page-type classifier, duplicate-content, or a11y dependency; those are
  separate use cases in the source tool and were intentionally left out of
  this checklist). If `modules/scoring.py`'s underlying check modules change
  shape, update the corresponding field lookups in `build_technical_audit_checklist()`.
- Do NOT run a whole sitemap crawl inside one `api/*.py` invocation. The
  60s Vercel cap means one invocation equals one URL. Do NOT copy the reference
  tool's server-side SSE/daemon-thread/checkpoint orchestration model;
  there's no long-lived process here, the browser drives the crawl.
- Sitewide/bulk mode intentionally does NOT dedupe domain-level `site_health`
  checks (WHOIS/DNS/SSL/robots/sitemap/HTTP2) across pages of the same
  domain yet; each URL re-runs them independently. This is a known
  optimization opportunity (see PROJECT_LOG.md "PHASE 2"), not a bug, but
  don't be surprised the WHOIS/DNS calls repeat per URL in a sitewide run.
- `vercel dev` needs interactive account linking on first run (hangs in
  non-interactive/CI environments), so browser verification of `/api/*.py`
  routes in this repo's sessions has instead relied on (a) pytest hitting the
  Python modules directly, and (b) mocking `window.fetch` in the browser to
  verify the client-side orchestrator/UI wiring independently.
- `modules/crawler.py::crawl_site()` supports `run_full_audit=True` (runs
  `audit_url()` per discovered page, synchronously, inside the crawl loop),
  but **`api/crawl.py` always passes `run_full_audit=False`**. Don't flip that:
  with the default `max_pages=50` and a real per-page audit taking 1-5s each,
  a synchronous full-audit crawl risks the 60s Vercel cap. Discovery and
  per-page auditing are deliberately two separate steps here (discovery in
  `api/crawl.py`, auditing via the browser's `lib/crawl/orchestrator.ts`),
  unlike the `venkataramana-work` branch's own single-endpoint design.
- The `venkataramana-work` branch (`git fetch origin venkataramana-work`) has
  a `phases.md` with a fuller crawl-feature roadmap (async job queue +
  SQLite/Postgres persistence, resumable `crawl_step`, optional Playwright JS
  rendering, site-wide score aggregation, dedicated `/crawl` UI), worth
  reading before extending crawl further. Not merged wholesale; only
  `modules/crawler.py` + its tests + the `auditor.py` `prefetched` param were
  adopted so far. Do not delete this branch.

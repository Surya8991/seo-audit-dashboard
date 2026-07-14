# agents.md

## Project overview
SEO Technical Audit Dashboard — Next.js (App Router, TypeScript, Tailwind)
frontend with Python serverless functions (Vercel-style `api/*.py`) as the
audit engine. Merged from
[venkataramana-d/seo-technical-audit-dashboard-main](https://github.com/venkataramana-d/seo-technical-audit-dashboard-main)
(base) with the site-health checks and Groq AI summary from this project's
prior standalone Streamlit SEO audit tool ported in on top.

## Stack
- Frontend: Next.js 16, React 19, Tailwind CSS 4, Recharts
- Backend: Python 3, plain `http.server.BaseHTTPRequestHandler` handlers under
  `api/` (Vercel Python runtime convention — each file exports a `handler`
  class), no framework
- No database — all audit results are computed on-demand per request and
  persisted client-side only (localStorage via `lib/state/AuditContext.tsx`)

## Key directories/files
- `app/` — Next.js pages: dashboard (`/`), **`technical-audit`** (single URL /
  sitemap / crawl / CSV-paste multi-input audit — formerly `new-audit`),
  results, detail, links, headings, performance, export, settings
- `api/audit.py` — runs a full audit for one URL, returns `modules.auditor.audit_url()` almost verbatim
- `api/sitemap.py` — resolves a sitemap (or bare domain) to a URL list for the
  sitewide Technical Audit; see "Sitewide/bulk audit architecture" below
- `api/crawl.py` — discovery-only BFS crawl (no sitemap needed): given a seed
  URL, follows internal links to build a URL list, same contract shape as
  `api/sitemap.py` (`{urls, total_found, capped}`). Always calls
  `crawl_site(..., run_full_audit=False)` — per-page SEO audits happen via the
  same client orchestrator as the other bulk modes, not inside this endpoint.
- `api/ai-summary.py` — Groq AI plain-English summary endpoint
- `api/pagespeed.py`, `api/export.py`, `api/config-status.py`
- `modules/auditor.py` — core fetch + orchestration, SSRF guard (`validate_audit_url`).
  `audit_url(..., prefetched=None)` accepts an already-fetched page (the shape
  `fetch_page()` returns) to avoid a duplicate fetch when a caller (e.g.
  `modules/crawler.py`) already has the page in hand.
- `modules/sitemap_extractor.py` — sitemap/sitemap-index fetch + recursion
  (depth cap 5), gzip support, SSRF-validated, dedup + include/exclude filter
  + URL cap (default 50, max 200). Adapts the parse logic already in
  `technical_checks.py::check_sitemap` (which only counts URLs — this module
  returns them).
- `modules/crawler.py` — `CrawlConfig` + `crawl_site()`: BFS link-discovery
  crawl with seed selection (homepage/sitemap/URL list), scope control
  (domain/subdomain + include/exclude regex + depth/page caps), UA presets
  (default/googlebot/googlebot-mobile/bingbot), and 3 robots.txt modes
  (respect/ignore/ignore_but_report). `run_full_audit=True` will also run
  `audit_url()` per discovered page (useful for CLI/synchronous use, but NOT
  what `api/crawl.py` uses — see above). Adopted from the `venkataramana-work`
  branch of this repo (do not delete that branch — it has a phases.md roadmap
  for a future async job-queue crawl architecture, phases 2-6, not yet built here).
- `modules/technical_checks.py` — domain age (WHOIS), SSL, HTTPS enforcement
  (does http:// redirect to https://?), DNS/SPF/DMARC/MX, robots.txt,
  sitemap.xml, readability, content freshness, canonical-loop detection,
  www-redirect consistency, HTTP/2 — aggregated as `site_health`
- `modules/ai_assist.py` — Groq `explain_audit()`
- `modules/technical_audit_checklist.py` — builds the 35-check "Technical SEO
  Audit" checklist (crawlability/on_page/site_health groups, pass/warning/fail
  per check) ported from the standalone tool's use-case definition; it's a
  read-only view derived from an already-computed `audit_url()` result, never
  re-fetches or re-scores. Exposed as `result["technical_audit_checklist"]`
  and rendered on the "Technical Audit" tab of `app/detail/page.tsx`.
- `modules/advanced_checks.py`, `link_auditor.py`, `image_auditor.py`,
  `heading_auditor.py`, `mobile_auditor.py`, `course_auditor.py`,
  `blog_auditor.py`, `pagespeed.py`, `report_generator.py`, `scoring.py`
- `lib/aggregate.ts`, `lib/scoring.ts` — **must stay in sync** with
  `modules/scoring.py`'s `WEIGHTS`/`THEMES` (duplicated by design — see the
  comment in `lib/aggregate.ts` — to avoid round-tripping to the Python API
  just to group/sort already-computed issues)
- `lib/state/AuditContext.tsx` — client-side persisted state (results, Groq API
  key). `addResults(results[])` batches N results into one state update/one
  localStorage write — use this for bulk audits, not a loop of `addResult`.
- `lib/crawl/parseUrlList.ts` — client-side CSV/TSV/paste URL-list parser (no
  upload, no server storage). Detects a url/link header column or scrapes any
  http(s) cell.
- `lib/crawl/orchestrator.ts` — `runCrawl(urls, opts, callbacks)`: bounded-
  concurrency (default 5, max 10) fan-out of single-URL `/api/audit` calls from
  the browser, with progress + incremental-result callbacks and abort support.
- `tests/` — pytest unit tests (pure-logic checklist tests + mocked-network
  tests for `check_https_enforcement`/X-Robots-Tag handling + sitemap
  extractor); see "Testing" below. `lib/crawl/*.test.ts` — Vitest unit tests
  for the URL-list parser.

## How to run
```bash
npm install
python -m venv .venv && source .venv/bin/activate  # .venv\Scripts\activate on Windows
pip install -r requirements.txt
npm run dev
```
`/api/*.py` endpoints only run under Vercel's runtime (`vercel dev`) — plain
`next dev` 404s on API calls, expected for frontend-only work.

## Sitewide/bulk audit architecture
The Technical Audit page (`app/technical-audit/page.tsx`) supports Single URL,
Sitemap, Crawl-from-URL, and CSV/Paste modes. Because this app is stateless
Vercel serverless (no DB, no long-lived process, no SSE, 60s/function cap —
see `vercel.json`), sitewide audits are **client-orchestrated**, not
server-orchestrated like the reference tools (SEO Suite uses a long-lived
Flask process + daemon thread + SSE + on-disk checkpointing; the
`venkataramana-work` branch's own crawl roadmap plans an async job-queue —
neither model ports here as-is):
1. One of three URL-resolution steps runs first, each bounded and fast enough
   to fit in a single invocation: `api/sitemap.py` (sitemap/sitemap-index
   fetch), `api/crawl.py` (BFS link discovery, `run_full_audit=False`), or the
   client-side CSV/paste parser (no network call at all).
2. The browser (`lib/crawl/orchestrator.ts::runCrawl`) fans out bounded-
   concurrency single-URL `POST /api/audit` calls — one invocation per URL, so
   nothing risks the function timeout.
3. Results batch into `AuditContext.addResults()` (one state update per batch,
   not per URL) and the Results page renders a sitewide rollup card
   (avg score, score distribution, top failing checks) when 2+ URLs are present.

Live-verified end-to-end against `https://www.edstellar.com/sitemap.xml`
(2,461 URLs) — see `tests/test_sitewide_pipeline_live.py` (opt-in,
`RUN_LIVE_TESTS=1`) and `PROJECT_LOG.md` session history.

## Env vars
- `PSI_API_KEY` (optional) — PageSpeed Insights quota
- `GROQ_API_KEY` (optional) — server-side default for the AI Summary feature;
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
`test_sitewide_pipeline_live.py`) are skipped by default — they hit the real
Edstellar sitemap/pages and take 30+ seconds; opt in with `RUN_LIVE_TESTS=1`.

## Agent notes / gotchas
- Every check module returns `{..., "issues": [...]}` where each issue is
  `{issue, category, severity, recommendation, impact_score, effort}` — follow
  this convention for any new check so it aggregates into `all_issues` and
  `modules/scoring.py`'s category scoring automatically.
- `modules/technical_checks.py`'s checks run concurrently via
  `ThreadPoolExecutor` in `analyze_site_health()` — several hit the domain
  root or DNS independently of the already-fetched page (robots.txt,
  sitemap.xml, WHOIS, SSL socket, DNS, www-alt-domain, HTTP/2). Readability
  and content-freshness reuse the already-parsed page text/soup/headers to
  avoid a duplicate fetch — don't refetch there.
- `python-whois`, `dnspython`, `httpx[http2]`, `textstat` are optional at
  import time in `technical_checks.py` — each check degrades to
  `{"available": False, "issues": []}` if the package is missing, rather than
  crashing the audit.
- Any change to `modules/scoring.py`'s `WEIGHTS`/`THEMES` must be mirrored in
  `lib/scoring.ts`/`lib/aggregate.ts` in the same commit — doc/config drift
  between the two is a bug.
- The Groq API key entered in Settings is sent per-request to
  `/api/ai-summary` and stored only in browser localStorage — never persisted
  server-side. Don't add server-side storage for it without discussing first.
- X-Robots-Tag `noindex` is owned by `modules/advanced_checks.py::analyze_http_headers`
  (it's the one that appends the issue); `modules/auditor.py::analyze_indexability`
  only folds it into `is_indexable` and separately flags `nofollow` (which
  `advanced_checks.py` does not cover) — don't re-add a noindex issue there or
  it'll double-count against the score.
- `modules/technical_audit_checklist.py`'s 35 checks are the SEO Suite
  `technical_seo` use case (`crawlability` + `on_page` + `site_health` only —
  no page-type classifier, duplicate-content, or a11y dependency; those are
  separate use cases in the source tool and were intentionally left out of
  this checklist). If `modules/scoring.py`'s underlying check modules change
  shape, update the corresponding field lookups in `build_technical_audit_checklist()`.
- Do NOT run a whole sitemap crawl inside one `api/*.py` invocation — the
  60s Vercel cap means one invocation = one URL. Do NOT copy the reference
  tool's server-side SSE/daemon-thread/checkpoint orchestration model —
  there's no long-lived process here; the browser drives the crawl.
- Sitewide/bulk mode intentionally does NOT dedupe domain-level `site_health`
  checks (WHOIS/DNS/SSL/robots/sitemap/HTTP2) across pages of the same
  domain yet — each URL re-runs them independently. This is a known
  optimization opportunity (see PROJECT_LOG.md "PHASE 2"), not a bug, but
  don't be surprised the WHOIS/DNS calls repeat per URL in a sitewide run.
- `vercel dev` needs interactive account linking on first run (hangs in
  non-interactive/CI environments) — browser verification of `/api/*.py`
  routes in this repo's sessions has instead relied on (a) pytest hitting the
  Python modules directly, and (b) mocking `window.fetch` in the browser to
  verify the client-side orchestrator/UI wiring independently.
- `modules/crawler.py::crawl_site()` supports `run_full_audit=True` (runs
  `audit_url()` per discovered page, synchronously, inside the crawl loop) —
  **`api/crawl.py` always passes `run_full_audit=False`**. Don't flip that:
  with the default `max_pages=50` and a real per-page audit taking 1-5s each,
  a synchronous full-audit crawl risks the 60s Vercel cap. Discovery and
  per-page auditing are deliberately two separate steps here (discovery in
  `api/crawl.py`, auditing via the browser's `lib/crawl/orchestrator.ts`),
  unlike the `venkataramana-work` branch's own single-endpoint design.
- The `venkataramana-work` branch (`git fetch origin venkataramana-work`) has
  a `phases.md` with a fuller crawl-feature roadmap (async job queue +
  SQLite/Postgres persistence, resumable `crawl_step`, optional Playwright JS
  rendering, site-wide score aggregation, dedicated `/crawl` UI) — worth
  reading before extending crawl further. Not merged wholesale; only
  `modules/crawler.py` + its tests + the `auditor.py` `prefetched` param were
  adopted so far. Do not delete this branch.

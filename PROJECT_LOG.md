# PROJECT_LOG — SEO Technical Audit Dashboard

> **Last updated:** 2026-07-14 · **Session:** 4 · **Version:** v0.3.0 (pre-release)
> Master log — read in full before touching code. Mirrors the format of the
> SEO Suite project's `PROJECT_LOG.md` (60-second resume → Do NOT → Current
> State → Phases → Session History).

---

## 60-Second Resume

```
1. cd "C:\Users\Surya L\Desktop\AI Agents\seo-audit-dashboard"
2. npm install
3. python -m venv .venv && .venv\Scripts\activate   # bash: source .venv/Scripts/activate
4. pip install -r requirements-dev.txt
5. npm run dev            # frontend only — /api/*.py 404s under plain `next dev`
6. vercel dev            # full stack incl. Python api/*.py handlers
7. python -m pytest tests/ -q      # 23 tests green as of v0.2.0
```

Architecture in one line: **Next.js 16 + Tailwind 4 frontend, Python
`api/*.py` serverless handlers (Vercel runtime, 60s cap), NO database, NO
server state — audit results persist client-side in localStorage only.**

---

## Do NOT

- **Do NOT** copy SEO Suite's server-side audit orchestration verbatim. It
  relies on a long-lived Flask process (daemon thread + SSE + on-disk
  checkpointing to `data/`). This app is stateless serverless — there is no
  long-lived process, no writable disk, no SSE-capable endpoint. Sitewide
  crawls MUST be **client-orchestrated** (browser fans out single-URL calls).
- **Do NOT** run a whole sitemap crawl inside one `api/*.py` invocation — the
  Vercel function cap is 60s (`vercel.json`). One invocation = one URL.
- **Do NOT** run domain-level site-health checks (WHOIS, DNS/SPF/DMARC/MX,
  SSL, robots.txt, sitemap, www-redirect, HTTP/2) once per page in a sitewide
  audit — they are identical for every page on the domain. Compute once per
  domain, reuse across pages. (See Phase 2 optimization.)
- **Do NOT** let `modules/scoring.py` `WEIGHTS`/`THEMES` drift from
  `lib/scoring.ts`/`lib/aggregate.ts` — mirror both in the same commit.
- **Do NOT** re-add an X-Robots-Tag `noindex` issue in `analyze_indexability`
  — it's owned by `advanced_checks.py::analyze_http_headers` (double-count bug).
- **Do NOT** persist any API key server-side. Keys live in localStorage and
  are passed per-request (PSI, Groq pattern).
- **Do NOT** push without: lint clean, `pytest` green, secret scan, no broken
  imports. Commit freely; never push unless explicitly told.

---

## Current State

### Stack
- Frontend: Next.js 16, React 19, Tailwind CSS 4, Recharts
- Backend: Python 3, `http.server.BaseHTTPRequestHandler` handlers under `api/`
- State: localStorage only (`lib/state/AuditContext.tsx`), no DB

### Audit engine — what exists
- `modules/auditor.py::audit_url()` — full single-URL audit (metadata,
  headings, canonical, indexability, url_structure, content, images, advanced,
  site_health, links, page-type-specific, PSI optional).
- `modules/auditor.py::audit_urls_bulk()` — ThreadPoolExecutor(8) bulk runner
  **(EXISTS but UNWIRED — no API route calls it).**
- `modules/technical_checks.py::analyze_site_health()` — domain-level checks
  (concurrent). `check_sitemap()` extracts `<loc>` URLs internally **but
  discards them (returns only `url_count`).**
- `modules/technical_audit_checklist.py` — 35-check pass/warn/fail checklist
  (crawlability/on_page/site_health), rendered on the detail page's
  "Technical Audit" tab.

### UI — what exists
- Sidebar shell (`components/AppShell.tsx`), light/dark theme, conic-gradient
  score circles, pill badges (v0.2.0 SEO-Suite-style rebuild — done).
- Pages: dashboard, new-audit (single URL only), results (N-result table,
  already bulk-ready), detail, links, headings, performance, export
  (bulk-aware), settings. Placeholder pages: `/tools`, `/link-graph`.

### Gaps for the multi-input Technical Audit — ALL CLOSED in Session 4
1. ~~No sitemap **URL extraction** endpoint~~ → `modules/sitemap_extractor.py` + `api/sitemap.py`.
2. ~~No sitemap-index recursion, no gzip support~~ → both handled (depth cap 5, cycle guard).
3. ~~No CSV parsing~~ → `lib/crawl/parseUrlList.ts` (client-side, no upload).
4. ~~`AuditContext.addResult` is single-only~~ → `addResults(results[])` added.
5. ~~single-URL input only~~ → `/technical-audit` now has Single URL / Sitemap / CSV-Paste modes.
6. ~~No client-side crawl orchestrator~~ → `lib/crawl/orchestrator.ts::runCrawl` (bounded concurrency + progress + cancel).

### Test target
`https://www.edstellar.com/sitemap.xml` — flat `<urlset>`, **2,461 URLs**,
490 KB. Confirms need for a URL cap (default sample) + domain-level dedup.

---

## Reference research (2026-07-14)

Popular technical-SEO crawlers surveyed for input-mode + concurrency patterns:
- [Open SEO Crawler](https://github.com/puneetindersingh/open-seo-crawler) —
  self-hosted Screaming Frog alt: **5 concurrent workers default (1–20)**,
  0.4s per-host politeness delay, **1,500-page default cap (up to 5,000)**,
  sitemap cross-check, live-refresh summary dashboard, XLSX export.
- [StanGirard/seo-audits-toolkit](https://github.com/StanGirard/seo-audits-toolkit)
  — sitemap URL extractor + Lighthouse/security-header crawler.
- [sethblack/python-seo-analyzer](https://github.com/sethblack/python-seo-analyzer)
  — sitemap-seeded or homepage-BFS crawl.
- Screaming Frog (free tier = 500-URL cap) / Sitebulb (severity-scored
  "Hints" + plain-language verdicts) — the commercial bar for UX/reporting.

SEO Suite's own model (reference, NOT to copy wholesale): 5 input types
(Sitemap / Crawl-from-URL / CSV-Excel / Paste URLs / Screaming Frog CSV),
limit 1–500 (default 10), workers 1–8 (default 3), crawl depth 1–4,
`ThreadPoolExecutor` + SSE progress + on-disk checkpoint every 25 URLs.

---

## Order of Execution (Phases)

### PHASE 0 — Nav restructure  ✅ COMPLETE (v0.3.0)
- Renamed **New Audit → Technical Audit**, moved `/new-audit` → `/technical-audit`.
- Removed **Quick Tools** and **Link Graph** placeholder pages + nav entries.
- Added a collapsible **"Additional Tools"** sidebar section (Heading Analysis
  + Export Reports) — collapse state persists in localStorage, auto-expands
  if it contains the active route.

### PHASE 1 — Multi-input Technical Audit  ✅ COMPLETE (v0.3.0)
Client-orchestrated (browser fans out `/api/audit` calls — see agents.md
"Sitewide/bulk audit architecture"). Three input modes shipped: **Single URL
· Sitemap · CSV/Paste URL list.**

- **1a. Sitemap extraction** — `modules/sitemap_extractor.py` + `api/sitemap.py`.
  Recurses `<sitemapindex>` (depth cap 5, cycle guard), gzip support,
  SSRF-validates every hop, dedupes, include/exclude regex, URL cap (50
  default / 200 max). 9 unit tests + 1 live test (edstellar.com, 2,461 URLs
  found) — all passing.
- **1b. CSV/paste parsing** — `lib/crawl/parseUrlList.ts`, fully client-side.
  Detects url/link header column or scrapes http(s) cells; CSV/TSV/plain
  paste. 11 Vitest unit tests passing.
- **1c/1d. Orchestrator + batched state** — `lib/crawl/orchestrator.ts::runCrawl`
  (bounded concurrency 5 default/10 max, abort support) + `AuditContext.addResults()`.
- **1e. Technical Audit page** — `app/technical-audit/page.tsx`: mode selector,
  per-mode fields, bulk options (limit, concurrency), live progress bar +
  succeeded/failed counts + cancel, routes to `/results` on completion.
- **1f. Sitewide rollup** — `app/results/page.tsx` gains a summary card (avg
  score circle, score distribution, top failing checks) when 2+ results present.

**Verification:** `/api/*.py` only runs under `vercel dev`, which needs
interactive account linking (hangs headless) — so verification split two ways:
(1) real Python-level pipeline test against Edstellar (`test_sitewide_pipeline_live.py`
— sitemap resolved, 3 real pages audited, valid scores + 35-check checklists,
34.6s), and (2) `window.fetch` mocked in-browser to verify the full client
orchestrator/UI end-to-end (mode switch, progress bar, cancel, batched
persistence, rollup card, results table) — confirmed working via screenshots.

### PHASE 2 — Sitewide efficiency  ⏳ PLANNED  *(after Phase 1 works)*
- Add `skip_site_health` param to `audit_url()`. In sitewide mode, run
  domain-level `analyze_site_health()` **once**, then per-page audits reuse
  that cached block. Cuts redundant WHOIS/DNS/SSL/robots/sitemap/HTTP2 calls
  from N× to 1× per domain — major latency + politeness win on a 2,461-URL
  site. Checklist merges the shared site_health block per result for display.

### PHASE C (trimmed) — API integrations  ⏳ MOSTLY N/A
User directive: "add only what's needed for THIS tool." A technical audit is
**no-API by definition** (SEO Suite's own tagline: "35 checks, no API key
required"). PageSpeed Insights (`PSI_API_KEY`) is already integrated and is
the only external API a technical audit uses. **Net new API work for this
tool: none.** GSC/Moz/DataForSEO/SerpAPI/Bing/IndexNow belong to separate
use cases (authority/rank/indexing) and stay deferred.

### PHASE B — Standalone Quick Tools  ⏸ PAUSED (user directive)
Redirect tracer, header inspector, keyword density, code-to-text ratio,
compression check, robots.txt tester, duplicate-content detector,
structured-data coverage, internal link graph. Parked; do not build until
explicitly unpaused.

---

## Testing plan (Phase 1 acceptance)

1. **Unit** — `tests/test_sitemap_extractor.py`: flat urlset, sitemap-index
   recursion, gzip, cycle guard, cap/filter, SSRF rejection (mocked HTTP).
2. **Unit** — CSV/paste parser (url-column detect, http-cell scrape, junk
   rejection).
3. **Live smoke** — extract `https://www.edstellar.com/sitemap.xml`, assert
   ~2,461 URLs found; run a capped sample (limit 25) through the orchestrator
   in the browser; verify progress, N results in `/results`, rollup card, and
   the Technical Audit checklist tab on a drilled-down URL.
4. **Regression** — existing 23 tests stay green; lint clean; `tsc --noEmit`.

---

## Decisions (signed off 2026-07-14)

1. **Route:** move `New Audit` → **`/technical-audit`** (update nav + links). ✅
2. **Link Graph nav:** **remove** the placeholder from nav (Phase B paused). ✅
3. **Sitewide cap:** **50 URLs default / 200 max** (browser-orchestrated). ✅
4. **Concurrency:** **5 default / 10 max** (matches Open SEO Crawler). ✅
5. **Build order:** Phase 0 (nav) → Phase 1 (multi-input audit) → live-test on
   Edstellar. Approved to start. ✅

---

## Session History

| Session | Date | Version | Key Work |
| --- | --- | --- | --- |
| 1 | 2026-07 | v0.1.0 | Merged Next.js SEO audit dashboard (base) + ported Streamlit site-health checks & Groq AI summary. |
| 2 | 2026-07-14 | v0.2.0 | SEO-Suite-style UI rebuild (indigo/violet gradient, dark sidebar, light/dark toggle, conic score circles, pill badges, mobile drawer). Technical SEO Audit use-case parity: `technical_audit_checklist.py` (35-check pass/warn/fail view) + `check_https_enforcement` + X-Robots-Tag nofollow; new detail "Technical Audit" tab; pytest harness + 23 tests; `agents.md` updated. |
| 3 | 2026-07-14 | v0.2.0 | Research + this PROJECT_LOG. Scoped multi-input Technical Audit (single/sitemap/CSV), nav restructure, trimmed Phase C. Confirmed client-orchestrated architecture (serverless + localStorage constraint). Probed Edstellar sitemap (2,461 URLs). Plan signed off (route→`/technical-audit`, cap 50/200, concurrency 5/10, remove Link Graph nav). Pushed UI rebuild + Technical Audit checklist commits to `origin/main`. |
| 4 | 2026-07-14 | v0.3.0 | **Phase 0+1 shipped.** Nav restructure (Technical Audit rename/route move, collapsible Additional Tools section, removed Quick Tools/Link Graph). Multi-input Technical Audit: sitemap extractor (index recursion, gzip, SSRF-safe) + `api/sitemap.py`, client CSV/paste parser, bounded-concurrency crawl orchestrator, batched `addResults`, 3-mode input UI with live progress, sitewide rollup card. Added Vitest for frontend unit tests (11 passing) alongside pytest (32 passing, 2 live tests opt-in). Verified end-to-end: real pipeline test against edstellar.com/sitemap.xml (2,461 URLs resolved, 3 real pages audited) + mocked-fetch in-browser UI walkthrough (mode switch → progress → results → rollup, all screenshotted). |

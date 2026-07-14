# PROJECT_LOG - SEO Technical Audit Dashboard

> **Last updated:** 2026-07-14 · **Session:** 12 · **Version:** v0.11.0 (pre-release)
> Master log, read in full before touching code. Mirrors the format of the
> SEO Suite project's `PROJECT_LOG.md` (60-second resume, Do NOT, Current
> State, Phases, Session History).

---

## 60-Second Resume

```
1. cd "C:\Users\Surya L\Desktop\AI Agents\seo-audit-dashboard"
2. npm install
3. python -m venv .venv && .venv\Scripts\activate   # bash: source .venv/Scripts/activate
4. pip install -r requirements-dev.txt
5. npm run dev            # frontend only: /api/*.py 404s under plain `next dev`
6. vercel dev            # full stack incl. Python api/*.py handlers
7. python -m pytest tests/ -q      # 23 tests green as of v0.2.0
```

Architecture in one line: **Next.js 16 + Tailwind 4 frontend, Python
`api/*.py` serverless handlers (Vercel runtime, 60s cap), NO database, NO
server state: audit results persist client-side in localStorage only.**

---

## Do NOT

- **Do NOT** copy SEO Suite's server-side audit orchestration verbatim. It
  relies on a long-lived Flask process (daemon thread + SSE + on-disk
  checkpointing to `data/`). This app is stateless serverless: there is no
  long-lived process, no writable disk, no SSE-capable endpoint. Sitewide
  crawls MUST be **client-orchestrated** (browser fans out single-URL calls).
- **Do NOT** run a whole sitemap crawl inside one `api/*.py` invocation. The
  Vercel function cap is 60s (`vercel.json`). One invocation = one URL.
- **Do NOT** run domain-level site-health checks (WHOIS, DNS/SPF/DMARC/MX,
  SSL, robots.txt, sitemap, www-redirect, HTTP/2) once per page in a sitewide
  audit; they are identical for every page on the domain. Compute once per
  domain, reuse across pages. (See Phase 2 optimization.)
- **Do NOT** let `modules/scoring.py` `WEIGHTS`/`THEMES` drift from
  `lib/scoring.ts`/`lib/aggregate.ts`; mirror both in the same commit.
- **Do NOT** re-add an X-Robots-Tag `noindex` issue in `analyze_indexability`.
  It's owned by `advanced_checks.py::analyze_http_headers` (double-count bug).
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

### Audit engine: what exists
- `modules/auditor.py::audit_url()`: full single-URL audit (metadata,
  headings, canonical, indexability, url_structure, content, images, advanced,
  site_health, links, page-type-specific, PSI optional). Accepts
  `prefetched=None` to reuse a page already fetched by a caller (e.g.
  `modules/crawler.py`) instead of re-fetching it.
- `modules/auditor.py::audit_urls_bulk()`: ThreadPoolExecutor(8) bulk runner
  **(EXISTS but UNWIRED, no API route calls it)**. Bulk audits in this app go
  through the client orchestrator (one `/api/audit` call per URL) instead.
- `modules/technical_checks.py::analyze_site_health()`: domain-level checks
  (concurrent). `check_sitemap()` extracts `<loc>` URLs internally **but
  discards them (returns only `url_count`)**; `modules/sitemap_extractor.py`
  is the module that actually returns the extracted URLs.
- `modules/sitemap_extractor.py` + `api/sitemap.py`: sitemap/sitemap-index
  URL extraction (depth cap 5, gzip support, SSRF-validated, dedup, cap/filter).
- `modules/crawler.py` + `api/crawl.py`: BFS link-discovery crawl (no sitemap
  needed), discovery-only in this app (`run_full_audit=False`).
- `modules/technical_audit_checklist.py`: 35-check pass/warn/fail checklist
  (crawlability/on_page/site_health), rendered on the detail page's
  "Technical Audit" tab.

### UI: what exists
- Sidebar shell (`components/AppShell.tsx`), light/dark theme, conic-gradient
  score circles, pill badges (v0.2.0 SEO-Suite-style rebuild, done). Nav has no
  placeholder pages left; `/tools` and `/link-graph` were removed in Phase 0.
- Pages: dashboard, `technical-audit` (Single URL / Sitemap / Crawl-from-URL /
  CSV-Paste, 4 input modes, all bulk-ready), results (N-result table +
  sitewide rollup card), detail (incl. the Technical Audit checklist tab),
  links, headings, performance, export (bulk-aware), settings.
- `lib/checklistDefs.ts`, `components/HelpDialog.tsx`,
  `components/ChecklistExplainer.tsx`, `lib/useSelectedChecks.ts` +
  `components/CheckSelector.tsx`: the plain-English explainer card, per-section
  help popovers, and the check-selection ("Customize checks") panel on the
  Technical Audit page, added in Phase 1h.

### Gaps for the multi-input Technical Audit (as scoped in Session 3, closed across Sessions 4-6)
1. ~~No sitemap **URL extraction** endpoint~~ -> `modules/sitemap_extractor.py` + `api/sitemap.py` (Session 4).
2. ~~No sitemap-index recursion, no gzip support~~ -> both handled (depth cap 5, cycle guard) (Session 4).
3. ~~No CSV parsing~~ -> `lib/crawl/parseUrlList.ts` (client-side, no upload) (Session 4).
4. ~~`AuditContext.addResult` is single-only~~ -> `addResults(results[])` added (Session 4).
5. ~~single-URL input only~~ -> `/technical-audit` now has Single URL / Sitemap / Crawl-from-URL / CSV-Paste modes (Session 4 + 5).
6. ~~No client-side crawl orchestrator~~ -> `lib/crawl/orchestrator.ts::runCrawl` (bounded concurrency + progress + cancel) (Session 4).

All 6 original gaps are closed. Phase 2 (sitewide site-health dedup) shipped
in Session 11; see the session row for the domain/page split and client-side
prefetch.

### Test target
`https://www.edstellar.com/sitemap.xml`: flat `<urlset>`, **2,461 URLs**,
490 KB. Confirms need for a URL cap (default sample) + domain-level dedup.

---

## Reference research (2026-07-14)

Popular technical-SEO crawlers surveyed for input-mode + concurrency patterns:
- [Open SEO Crawler](https://github.com/puneetindersingh/open-seo-crawler):
  self-hosted Screaming Frog alt: **5 concurrent workers default (1-20)**,
  0.4s per-host politeness delay, **1,500-page default cap (up to 5,000)**,
  sitemap cross-check, live-refresh summary dashboard, XLSX export.
- [StanGirard/seo-audits-toolkit](https://github.com/StanGirard/seo-audits-toolkit):
  sitemap URL extractor + Lighthouse/security-header crawler.
- [sethblack/python-seo-analyzer](https://github.com/sethblack/python-seo-analyzer):
  sitemap-seeded or homepage-BFS crawl.
- Screaming Frog (free tier = 500-URL cap) and Sitebulb (severity-scored
  "Hints" + plain-language verdicts): the commercial bar for UX/reporting.

SEO Suite's own model (reference, NOT to copy wholesale): 5 input types
(Sitemap / Crawl-from-URL / CSV-Excel / Paste URLs / Screaming Frog CSV),
limit 1–500 (default 10), workers 1–8 (default 3), crawl depth 1–4,
`ThreadPoolExecutor` + SSE progress + on-disk checkpoint every 25 URLs.

---

## Order of Execution (Phases)

### PHASE 0 - Nav restructure  ✅ COMPLETE (v0.3.0)
- Renamed **New Audit → Technical Audit**, moved `/new-audit` → `/technical-audit`.
- Removed **Quick Tools** and **Link Graph** placeholder pages + nav entries.
- Added a collapsible **"Additional Tools"** sidebar section (Heading Analysis
  + Export Reports), collapse state persists in localStorage, auto-expands
  if it contains the active route.

### PHASE 1 - Multi-input Technical Audit  ✅ COMPLETE (v0.3.0)
Client-orchestrated (browser fans out `/api/audit` calls, see agents.md
"Sitewide/bulk audit architecture"). Three input modes shipped: **Single URL
· Sitemap · CSV/Paste URL list.**

- **1a. Sitemap extraction**: `modules/sitemap_extractor.py` + `api/sitemap.py`.
  Recurses `<sitemapindex>` (depth cap 5, cycle guard), gzip support,
  SSRF-validates every hop, dedupes, include/exclude regex, URL cap (50
  default / 200 max). 9 unit tests + 1 live test (edstellar.com, 2,461 URLs
  found), all passing.
- **1b. CSV/paste parsing**: `lib/crawl/parseUrlList.ts`, fully client-side.
  Detects url/link header column or scrapes http(s) cells; CSV/TSV/plain
  paste. 11 Vitest unit tests passing.
- **1c/1d. Orchestrator + batched state**: `lib/crawl/orchestrator.ts::runCrawl`
  (bounded concurrency 5 default/10 max, abort support) + `AuditContext.addResults()`.
- **1e. Technical Audit page**: `app/technical-audit/page.tsx`: mode selector,
  per-mode fields, bulk options (limit, concurrency), live progress bar +
  succeeded/failed counts + cancel, routes to `/results` on completion.
- **1f. Sitewide rollup**: `app/results/page.tsx` gains a summary card (avg
  score circle, score distribution, top failing checks) when 2+ results present.

**Verification:** `/api/*.py` only runs under `vercel dev`, which needs
interactive account linking (hangs headless), so verification split two ways:
(1) real Python-level pipeline test against Edstellar (`test_sitewide_pipeline_live.py`,
sitemap resolved, 3 real pages audited, valid scores + 35-check checklists,
34.6s), and (2) `window.fetch` mocked in-browser to verify the full client
orchestrator/UI end-to-end (mode switch, progress bar, cancel, batched
persistence, rollup card, results table), confirmed working via screenshots.

### PHASE 1g - Crawl-from-URL (4th input mode)  ✅ COMPLETE (v0.4.0)
User pointed at a fetched-but-unmerged remote branch, `origin/venkataramana-work`
(`git fetch origin venkataramana-work`, **do not delete this branch**), which
contained `modules/crawler.py` (BFS link-discovery crawl, Phase 1 of its own
`phases.md` roadmap for a fuller async job-queue crawl architecture; phases
2-6 of that roadmap are NOT built here, just the Phase 1 crawler module) plus
`tests/test_crawler.py` and a small `audit_url(..., prefetched=None)` addition
to `modules/auditor.py` (avoids a duplicate fetch when the caller already has
the page). All copied over and verified working unmodified (11/11 existing
tests pass against our current codebase).

Adapted the API boundary to fit our client-orchestrated architecture: the
branch's `crawl_site()` supports `run_full_audit=True` (synchronous per-page
audit_url() calls inside the crawl loop, risks the 60s Vercel cap at the
default max_pages=50), but `api/crawl.py` always calls it with
`run_full_audit=False`, discovery only, same `{urls, total_found, capped}`
contract shape as `api/sitemap.py`. Per-page auditing happens through the
existing `lib/crawl/orchestrator.ts`, exactly like sitemap/CSV mode.

Added to `app/technical-audit/page.tsx` as "Crawl from URL" (4th mode, 4-column
grid): start URL, include/exclude regex, max depth (1-10), robots.txt handling
(respect/ignore/ignore_but_report), include-subdomains toggle, shared bulk
options (limit/concurrency). New unit test (`test_discovery_only_mode_skips_per_page_audit`)
+ opt-in live test (`test_live_edstellar_discovery_crawl`, 10 real pages
discovered via BFS in ~4s). Verified end-to-end in-browser via mocked
`window.fetch` (mode select → 6/6 crawled + audited → results).

### PHASE 1h - Help dialogs + check-selection UI  ✅ COMPLETE (v0.5.0)
User shared a screenshot of the reference tool's "Technical SEO" use-case
page (explainer card with all 35 checks as pills, a "when to use" note, and
an example output) and asked for (a) plain-English help dialogs per section,
and (b) letting users choose which checks to run, "similar to SEO Suite's
use case but keep all as default."

- `lib/checklistDefs.ts`: frontend mirror of the 35 check ids/labels/groups
  (must stay in sync with `modules/technical_audit_checklist.py`), each with
  a one-sentence plain-English description. Guarded by
  `lib/checklistDefs.test.ts` (35 total, 12/11/12 group split, unique ids).
- `components/HelpDialog.tsx`: reusable "ⓘ" popover (click to open, closes
  on outside-click/Escape).
- `components/ChecklistExplainer.tsx`: the "What Technical SEO checks" card,
  mirroring the reference tool's explainer: description, all 35 checks as
  pills, "when to use" callout. Added below the audit form on the Technical
  Audit page, collapsed by default so it doesn't push the form below the fold.
- Help dialogs added to: each of the 4 input-mode cards (Single URL/Sitemap/
  Crawl/CSV) with a longer plain-English "when to use this mode" explanation,
  and each of the 3 checklist groups (Crawlability/On-Page/Site Health) on
  the detail page's Technical Audit tab.
- `lib/useSelectedChecks.ts` + `components/CheckSelector.tsx`: a collapsible
  "Customize checks (N/35 selected)" panel with per-check checkboxes grouped
  by category, select-all/none, indeterminate group checkboxes, persisted to
  localStorage. **All 35 selected by default**, per the user's explicit
  instruction. Deselecting a check hides it from the detail page's Technical
  Audit checklist tab; it is a **display filter only**, the backend still
  computes all 35 checks in one `audit_url()` call regardless (they're bundled
  into a single page fetch, so skipping individual checks server-side
  wouldn't meaningfully speed anything up, this is stated explicitly in the
  UI so the distinction isn't misleading).
- Detail page's Technical Audit tab now shows "N of 35 checks shown" + a
  "N check(s) hidden. Adjust in Technical Audit -> Customize checks." hint
  when the selection excludes anything, and an empty state if everything is
  deselected.

Verified end-to-end in-browser: explainer card renders with all 35 pills,
help popovers open/close correctly (mode cards + checklist groups), check
deselection updates counts live and persists across reload, and the detail
page correctly hides deselected checks from each group with an accurate
shown/hidden count. 15 vitest (added `checklistDefs.test.ts`) + 44 pytest
(unchanged) all green; one real `react/no-unescaped-entities` lint issue
introduced was found and fixed before commit.

### PHASE 2 - Sitewide efficiency  ⏳ PLANNED  *(after Phase 1 works)*
- Add `skip_site_health` param to `audit_url()`. In sitewide mode, run
  domain-level `analyze_site_health()` **once**, then per-page audits reuse
  that cached block. Cuts redundant WHOIS/DNS/SSL/robots/sitemap/HTTP2 calls
  from N× to 1× per domain, a major latency + politeness win on a 2,461-URL
  site. Checklist merges the shared site_health block per result for display.

### PHASE 3 - Auditing sites with 200+ URLs  ✅ COMPLETE (v0.8.0, option 2)

User picked **option 2, chunked runs**. Implemented in
`lib/crawl/chunkedRunner.ts`: splits a resolved URL list into fixed
`CHUNK_SIZE=200` batches (still wraps the existing bounded-concurrency
`lib/crawl/orchestrator.ts`, unchanged), auto-advancing from one chunk to
the next with no user interaction required as long as the tab stays open,
and persisting a lightweight resumable checkpoint (remaining URLs +
cumulative succeeded/failed counts, not full audit results, those still
flow through `AuditContext`/IndexedDB as before) after every single
completed URL, not just at chunk boundaries. If the tab closes or crashes
mid-run, reopening the Technical Audit page shows an "Interrupted audit
found: X of Y done" banner with Resume/Discard.

Raised `MAX_URL_CAP` in `modules/sitemap_extractor.py` from 200 to 2000
(sitemap resolution is just an XML fetch/parse, cheap even at that size);
kept `api/crawl.py`'s `MAX_MAX_PAGES` at 200 since BFS crawl discovery does
a real per-page HTTP GET to extract links, a genuinely more expensive
server-side operation than a sitemap fetch. The Technical Audit page's
"URL limit" field now shows a mode-dependent max (2000 for sitemap/CSV, 200
for crawl) and clamps down automatically (derived, not synced via a
`useEffect`, to avoid a `react-hooks/set-state-in-effect` lint violation)
if the user switches from sitemap to crawl mode with a higher limit set.

Found and fixed a real bug during manual testing: the first draft reset
`succeeded`/`failed` counts to 0 on every resume instead of carrying them
forward, so a paused-then-resumed run's final tally only reflected the
last session, not the cumulative total. Fixed by storing `succeeded`/
`failed` in the checkpoint itself and threading them through
`runChunked`'s optional `resumeFrom` parameter.

Added `vitest.config.ts` (a `@/*` path alias matching `tsconfig.json`,
needed because plain Vitest doesn't resolve Next.js's path aliases) and 6
new tests in `lib/crawl/chunkedRunner.test.ts` (chunk-count arithmetic,
checkpoint persistence/clearing, abort-leaves-a-resumable-checkpoint, and
the succeeded/failed-carries-across-resume regression test). Verified
manually end-to-end in-browser with a mocked, artificially slow
(250ms/request) 60-URL run: paused mid-chunk at 54/60, reloaded (simulating
a closed tab), saw the resume banner, resumed, and confirmed the final
tally (48 ok + 12 failed = 60/60) was the correct cumulative total, not
just the resumed session's count.

**Why the 200-URL cap exists today:** `MAX_URL_CAP` in `modules/sitemap_extractor.py`
and `api/crawl.py` (200) isn't a hard technical limit, it's a judgment call
matched to the current **client-orchestrated** design: the browser
(`lib/crawl/orchestrator.ts`) fans out single-URL `/api/audit` calls at
bounded concurrency (5 default/10 max) and the tab must stay open and
connected for the whole run. At ~2-5s per audit and concurrency 5, 200 URLs
takes roughly 1.5-4 minutes of the user actively keeping the tab open with a
stable connection. That's reasonable for 200; it stops being reasonable at
1,000+ (10-30+ minutes, one dropped connection loses the whole in-flight
batch, no resume). IndexedDB storage itself is not the constraint: a
synthetic 200-result, ~28MB payload saved and loaded without issue in
testing (see Session 8 verification below), IndexedDB's quota is a share of
free disk space, far larger than localStorage's ~5-10MB.

**Options evaluated:**

1. **Just raise the cap** (e.g. 200 → 1000). Zero new code, but doesn't fix
   the underlying problem, it just moves the "tab must stay open 30+ minutes
   with no resume" pain to a bigger number. Fine as a cheap stopgap, not a
   real fix.
2. **Chunked/multiple runs** (client-side). Auto-split a large URL list into
   sequential batches (e.g. 200 at a time), surfacing a "Batch 2 of 5, continue?"
   prompt between chunks. No backend changes, works within today's
   architecture, and each chunk still respects the 60s/invocation Vercel cap.
   Doesn't require the tab to run unattended, but doesn't provide
   true "start it and walk away" either, the user still has to be present to
   advance each chunk (though this could be automated with a client-side
   timer that just keeps calling the next chunk without user interaction, as
   long as the tab stays open).
3. **PR #1's SQLite job-queue** (`modules/job_store.py`,
   `api/crawl/{start,step,status}.py`). Poll-driven, resumable, and each
   `step` call is bounded so it never risks the 60s cap by itself. **BUT**:
   `SQLiteJobStore`'s own docstring says on-disk SQLite is NOT guaranteed to
   survive between calls on Vercel's ephemeral serverless containers, it's
   explicitly built as a swappable interface with a real Postgres store as
   the intended production backend, and that Postgres implementation was
   never written in the PR. As-is, this architecture would NOT reliably work
   in production on Vercel; it needs a real hosted database (e.g. Neon or
   Supabase free tier via `DATABASE_URL`) to actually deliver on its
   resumable/background promise.
4. **GitHub Actions as a fully decoupled batch runner.** A
   `workflow_dispatch`-triggered Action (inputs: sitemap/seed URL, limit)
   runs a Python script that reuses `modules/auditor.py`/`sitemap_extractor.py`/
   `crawler.py` directly (no Vercel timeout at all, GitHub-hosted runners get
   up to 6 hours), writes the aggregated result as a JSON artifact (or
   commits it to a `reports/` location, or uploads to a GitHub Release).
   Genuinely solves "browser doesn't need to stay open" and "no timeout,"
   at the cost of a less-integrated UX: the user triggers the run outside
   the app (GitHub UI or `gh workflow run`), waits for it to finish, then
   imports the resulting JSON into the dashboard (would need a new "Import
   results" feature, not just an export one). Good fit for scheduled/
   recurring full-site audits; a poor fit for "audit this URL right now and
   watch it happen" style tasks.

**Recommendation:** short-term, option 2 (chunked runs) is the best
value, it needs no new infrastructure, no new dependency, and directly
extends the orchestrator already built and tested. Long-term, if truly
unattended/background large-site audits become a real need, option 3
(finish PR #1's design with a real Postgres store) is the more integrated
answer and option 4 (GitHub Actions) is the better fit for scheduled batch
reporting. Not implementing any of this until the user picks a direction,
this is a real architecture decision, not a mechanical fix.

### PHASE C (trimmed) - API integrations  ⏳ MOSTLY N/A
User directive: "add only what's needed for THIS tool." A technical audit is
**no-API by definition** (SEO Suite's own tagline: "35 checks, no API key
required"). PageSpeed Insights (`PSI_API_KEY`) is already integrated and is
the only external API a technical audit uses. **Net new API work for this
tool: none.** GSC/Moz/DataForSEO/SerpAPI/Bing/IndexNow belong to separate
use cases (authority/rank/indexing) and stay deferred.

### PHASE B - Standalone Quick Tools  ⏸ PAUSED (user directive)
Redirect tracer, header inspector, keyword density, code-to-text ratio,
compression check, robots.txt tester, duplicate-content detector,
structured-data coverage, internal link graph. Parked; do not build until
explicitly unpaused.

---

## Testing plan (Phase 1 acceptance)

1. **Unit**: `tests/test_sitemap_extractor.py`: flat urlset, sitemap-index
   recursion, gzip, cycle guard, cap/filter, SSRF rejection (mocked HTTP).
2. **Unit**: CSV/paste parser (url-column detect, http-cell scrape, junk
   rejection).
3. **Live smoke**: extract `https://www.edstellar.com/sitemap.xml`, assert
   ~2,461 URLs found; run a capped sample (limit 25) through the orchestrator
   in the browser; verify progress, N results in `/results`, rollup card, and
   the Technical Audit checklist tab on a drilled-down URL.
4. **Regression**: existing 23 tests stay green; lint clean; `tsc --noEmit`.

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
| 4 | 2026-07-14 | v0.3.0 | **Phase 0+1 shipped.** Nav restructure (Technical Audit rename/route move, collapsible Additional Tools section, removed Quick Tools/Link Graph). Multi-input Technical Audit: sitemap extractor (index recursion, gzip, SSRF-safe) + `api/sitemap.py`, client CSV/paste parser, bounded-concurrency crawl orchestrator, batched `addResults`, 3-mode input UI with live progress, sitewide rollup card. Added Vitest for frontend unit tests (11 passing) alongside pytest (32 passing, 2 live tests opt-in). Verified end-to-end: real pipeline test against edstellar.com/sitemap.xml (2,461 URLs resolved, 3 real pages audited) + mocked-fetch in-browser UI walkthrough (mode switch → progress → results → rollup, all screenshotted). Pushed both commits to `origin/main`. |
| 5 | 2026-07-14 | v0.4.0 | Made "Additional Tools" nav section collapsible (persisted, auto-expands on active route). **Phase 1g: Crawl-from-URL.** User pointed at unmerged remote branch `origin/venkataramana-work` (fetched, not deleted), which contained a well-tested BFS `modules/crawler.py` (`CrawlConfig`/`crawl_site`, seed selection, scope control, UA presets, 3 robots.txt modes) + `tests/test_crawler.py` + a small `prefetched` param on `audit_url()`. Adopted the crawler module as-is (11/11 tests pass unmodified); adapted the API boundary to our client-orchestrated model: `api/crawl.py` always runs discovery-only (`run_full_audit=False`), never the branch's synchronous per-page-audit mode, to stay under the 60s cap. Added as 4th Technical Audit input mode. New/live tests added and passing (44 pytest total, 3 opt-in skipped, 11 vitest). Verified end-to-end via mocked-fetch in-browser walkthrough. Branch also has a `phases.md` roadmap (async job queue, JS rendering, site scoring, dedicated crawl UI) for future phases, not built yet. |
| 6 | 2026-07-14 | v0.5.0 | **Phase 1h: Help dialogs + check-selection UI.** User shared a screenshot of the reference tool's "Technical SEO" use-case explainer and asked for plain-English help dialogs plus a check-selection UI (default all on). Added `lib/checklistDefs.ts` (frontend mirror of the 35 check ids/labels/groups + one-sentence descriptions, guarded by a new test), `components/HelpDialog.tsx` (reusable popover), `components/ChecklistExplainer.tsx` (the "What Technical SEO checks" card with all 35 pills + "when to use", rendered below the audit form and collapsed by default), and `lib/useSelectedChecks.ts` + `components/CheckSelector.tsx` (a "Customize checks (N/35 selected)" panel, all on by default, persisted to localStorage). Help dialogs added to each of the 4 input-mode cards and each of the 3 checklist groups on the detail page; the detail page's Technical Audit tab now filters displayed checks by the user's selection (explicitly a display filter: the backend still computes all 35 checks every audit, since they're free once the page is fetched). 15 vitest + 44 pytest green; one real lint issue (unescaped apostrophes) found and fixed. Verified end-to-end in-browser via mocked state (explainer render, help popover open/close, check deselection + persistence, detail-page filtering with an accurate hidden-count message). |
| 7 | 2026-07-14 | v0.6.0 | **UI polish, reporting gap fix, docs accuracy, and a full em-dash removal.** Moved `ChecklistExplainer` below the audit form (matching the user's screenshot) and collapsed it by default. Discovered PR #1 (`venkataramana-d`, still open) implements the FULL `venkataramana-work` roadmap (SQLite job queue, Playwright JS rendering, site scoring, a separate `/crawl` UI), overlapping/conflicting with the simpler discovery-only `api/crawl.py` already shipped; user decided to leave PR #1 untouched for now (not merged, not closed). Fixed 4 hardcoded `bg-white` inputs/selects (settings, performance, headings, detail pages) that broke dark mode, plus themed the dashboard's Recharts tooltips (`contentStyle`/`labelStyle` with CSS variables instead of Recharts' white default). Dispatched 5 parallel agents across 2 rounds for non-overlapping file sets: (1) UI content quality + em-dash removal across `app/`/`components/` except export, (2) reporting/export improvements, closing a real gap where the 35-check checklist was completely absent from CSV/Excel/PDF exports (now a checklist column/sheet/summary line in every format, `tests/test_report_generator.py` added), (3) `agents.md`/`PROJECT_LOG.md` accuracy audit (found and fixed a stale "Current State" section from Session 3/4), (4) em-dash sweep for the remaining Python modules/tests, (5) em-dash sweep for remaining `lib/*.ts` files + README. Total: 164 additional em-dashes removed across the whole codebase (zero remain anywhere in `app/`, `components/`, `lib/`, `modules/`, `api/`, `tests/`, or `*.md`). Final verification: 51 pytest passed (3 opt-in live skipped), 15 vitest passed, `tsc --noEmit` clean, lint at the exact pre-existing 27-error baseline (no new errors), secret scan clean across all 51 changed/new files. |
| 8 | 2026-07-14 | v0.7.0 | **Critical fix: localStorage QuotaExceededError.** Every state change was writing the WHOLE results array as one JSON blob to localStorage (~5-10MB quota); a 200-URL bulk audit routinely exceeded it and crashed. Root-caused and fixed by migrating persistence to IndexedDB (`lib/state/idbStore.ts`, a minimal raw wrapper, no new dependency), with one-time migration of existing localStorage data and a defensive prune-to-500-most-recent fallback plus a user-visible warning banner if a save ever still fails. Verified with a synthetic 200-result, ~28MB payload saved and loaded successfully through the real `AuditContext` (would have crashed instantly under the old localStorage path). Extracted the sidebar's dark-mode logic into a shared `lib/useTheme.ts` hook (pub-sub so multiple mounted toggles stay in sync) and added a second toggle on the Settings page ("Appearance" card), per the user's choice to keep dark mode with an explicit Settings control rather than removing it. Changed the font from Inter to Arial (`--font-sans`, dropped the Google Fonts import). Researched and wrote a Phase 3 plan (`PROJECT_LOG.md`) for auditing 200+ URL sites: confirmed PR #1's SQLite job-queue does NOT reliably persist on Vercel's ephemeral containers by its own docstring (needs a real Postgres store, never built in that PR), and laid out 4 options (raise the cap, chunked runs, finish PR #1 with Postgres, GitHub Actions batch runner) with a recommendation (chunked runs short-term); no implementation yet, pending user direction. |
| 9 | 2026-07-14 | v0.8.0 | **Phase 3 shipped: chunked runs.** User picked option 2 from the prior session's plan. Added `lib/crawl/chunkedRunner.ts` (`CHUNK_SIZE=200`, wraps the existing orchestrator unchanged, persists a resumable checkpoint of remaining URLs + cumulative succeeded/failed after every result), a resume/discard banner on the Technical Audit page, and a "Batch X of Y" progress indicator. Raised `modules/sitemap_extractor.py`'s `MAX_URL_CAP` 200 to 2000 (cheap XML fetch); kept `api/crawl.py`'s cap at 200 since BFS discovery is a real per-page fetch. Added `vitest.config.ts` (path alias, needed for the new lib to resolve `@/` imports under plain Vitest) and 6 new tests. Found and fixed a real bug via manual testing: succeeded/failed counts reset to 0 on resume instead of carrying forward; fixed by storing them in the checkpoint and threading through a `resumeFrom` param, verified with a live paused-then-resumed run (48 ok + 12 failed = 60/60 cumulative, correct). Also fixed a new `react-hooks/set-state-in-effect` violation introduced by an early draft (mode-dependent limit clamping) by deriving the clamped value instead of syncing it via `useEffect`; lint stayed at the 25-error baseline. 26 vitest + 51 pytest green, `tsc --noEmit` clean. |
| 10 | 2026-07-14 | v0.9.0 | **Closed PR #1, whole-project audit + fixes, Technical-tab wiring overhaul.** Closed PR #1 (kept the branch) with an explanation: its SQLite job-queue won't persist on Vercel's ephemeral containers and the intended Postgres store was never built, and chunked runs already deliver sitewide auditing. Ran two audit agents (a UI-wiring map of `audit_url()` output vs. what pages render, and a full security/correctness/dead-code audit). **Security (critical):** hardened `validate_audit_url` to DNS-resolve hostnames and reject any that resolve to private/reserved IPs; added `safe_get()` (manual per-hop redirect re-validation) used by `fetch_page`; added SSRF guards to `link_auditor.validate_url` (untrusted third-party link URLs) and `crawler._fetch_sitemap_locs` (attacker-controlled sitemap URLs), all previously fetched with no or insufficient validation. **Correctness:** dropped the legacy `images` block from `all_issues` (double-counted alt-text issues vs. `image_detail`'s "Image SEO" ones) and added "Image SEO" to the Images theme in `scoring.py` + `aggregate.ts` (were falling into "Other"). **Wiring/UI:** replaced the detail Technical tab's raw key-value dump with structured cards (Core Web Vitals, security headers, structured data, a rendered Open Graph social preview, site-health breakdown, hreflang table, redirect chain), which surfaced ~7 previously-orphaned `advanced`/`site_health` sub-objects. Colour-coded the Overview score-breakdown bars. Added `tests/test_ssrf.py` (17) + `tests/test_scoring.py` (12). 80 pytest (3 opt-in live skipped, both re-run green against real redirects) + 26 vitest, tsc clean, lint at baseline. **Residual audit findings NOT yet actioned** (tracked for later): (1) redirect-target re-validation in `technical_checks.py` cross-host followers (H1, lower severity since the initial host is always the already-validated audit domain); (2) N+1 domain-level site_health running per-page in a same-domain crawl (P1 = the planned Phase 2 memoization); (3) triple HTML re-parse per page (P2); (4) `course_audit`/`blog_audit` data still issues-only, not shown in a page-type panel; (5) `audit_urls_bulk` still dead code; (6) no tests yet for `link_auditor`/`advanced_checks`/`mobile_auditor`/`image_auditor`/`linkify` escaping. |
| 11 | 2026-07-14 | v0.10.0 | **Phase 2 (site-health memoization) + Results/Detail section merge.** Phase 2: closed the N+1 site-health finding by splitting `technical_checks.analyze_site_health` into `analyze_domain_health(url)` (8 domain-wide checks: robots/sitemap/domain-age/SSL/https-enforcement/DNS/www-redirect/HTTP2) and `_analyze_page_health(...)` (readability/freshness/canonical-loop), with `analyze_site_health(..., prefetched_domain_health=None)` reusing a prefetched domain result. New `api/site-health.py` (`maxDuration` 30 in `vercel.json`) returns domain health per host; `lib/crawl/siteHealthCache.ts` (`fetchDomainHealth`, one call per unique host, CONCURRENCY 5, null-on-failure) prefetches once and the orchestrator injects `prefetchedDomainHealth` per URL, so a 200-page same-domain crawl runs the domain checks once instead of 200x. `audit.py`/`auditor.py` thread the param through. Since the backend is client-orchestrated (no shared server memory), memoization is client-driven. Verified: 1 site-health call for 12 same-domain URLs. Tests: `tests/test_site_health_memoization.py` (3) + `lib/crawl/siteHealthCache.test.ts` (5). **Section merge:** folded the standalone `links`, `headings`, and `performance` pages into `app/detail/page.tsx` as tabs, extracted verbatim into `components/detail/{LinksView,HeadingsView,PerformanceView}.tsx`; deleted the 3 old page files (~1900 lines). `app/results/page.tsx` now groups rows by domain (collapsible, worst-avg first) with richer columns (URL/score/checklist pass-warn-fail/top-issue/View) and routes into the detail via `setSelectedUrlIndex` + `router.push("/detail")`; the detail gets a "Back to results" link. Nav dropped 8 to 5 items (`resolveActiveHref` in `AppShell.tsx` highlights "Results" on `/detail`). Verified in-browser with seeded IndexedDB state: domain-grouped list, all 9 detail tabs (incl. Links/Headings/Performance sub-tabs) render without new console errors. 31 vitest + 83 pytest green, tsc clean, lint at the 25-error baseline, no em-dashes, secret scan clean. |
| 12 | 2026-07-14 | v0.11.0 | **Email-DNS demotion, fix-difficulty labels, Export merged into Results, other-branch review.** Reviewed `origin/venkataramana-work` (phase-6 crawl roadmap): confirmed nothing new to salvage beyond `crawler.py` (already in main); `job_store.py`/`js_renderer.py` remain unusable on Vercel (ephemeral disk, no Playwright), `site_scoring.py` is the one optionally-portable piece (Ahrefs-style site-health %), noted for later, not ported. **Email-DNS demotion:** SPF/DMARC/MX are email-deliverability records, not SEO ranking signals, yet a missing record was dinging every site's SEO score. `check_dns_health` now collects the records but emits NO scored issues; the checklist reports spf/dmarc/mx/dns_health as a new `"info"` `ChecklistStatus` (4th value), excluded from pass/warning/fail and added as an `info` count in the summary (`total == pass+warning+fail+info`). Frontend `StatusPill` + checklistDefs help text updated ("informational only, does not affect SEO score"). Data is kept, penalties removed (user chose "demote", not "remove"). Rewrote `test_missing_spf_dmarc_mx_...` to assert the info behavior + summary reconciliation. **Fix-difficulty labels:** the backend already tagged every issue with `effort` (Low/Medium/High) but never surfaced it. `lib/difficulty.ts` (`fixDifficulty`/`difficultyBreakdown`, backend-effort-first with a keyword fallback) maps it to Easy/Medium/Hard; `DifficultyBadge` (in `ui.tsx`) wired into `IssueRow`, a "Fix effort" column on the Results list (`EffortChips`), and an Easy/Medium/Hard rollup on the detail header. `lib/difficulty.test.ts` (7 tests). **Export merge:** extracted the export controls into `components/ExportBar.tsx` and placed it on the Results page; deleted `app/export/page.tsx` (its preview table was redundant with the Results list) and removed the now-empty "Additional Tools" nav section (nav 5 to 4 items). Docs: `agents.md`, `README.md`, `PROJECT_LOG.md` all updated in this commit. Verified in-browser (seeded state): Info pills on email-DNS, difficulty badges on issues/header/results column, export bar + 4-item nav. 38 vitest + 83 pytest green, tsc clean, lint at the 25-error baseline, em-dash scan clean (also fixed a stray one in `sitemap_extractor.py`), secret scan clean. |

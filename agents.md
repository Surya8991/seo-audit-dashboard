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
- `app/` — Next.js pages (results, detail, links, headings, performance, export, settings, new-audit)
- `api/audit.py` — runs a full audit for one URL, returns `modules.auditor.audit_url()` almost verbatim
- `api/ai-summary.py` — Groq AI plain-English summary endpoint
- `api/pagespeed.py`, `api/export.py`, `api/config-status.py`
- `modules/auditor.py` — core fetch + orchestration, SSRF guard (`validate_audit_url`)
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
- `lib/state/AuditContext.tsx` — client-side persisted state (results, Groq API key)
- `tests/` — pytest unit tests (pure-logic checklist tests + mocked-network
  tests for `check_https_enforcement`/X-Robots-Tag handling); see "Testing" below

## How to run
```bash
npm install
python -m venv .venv && source .venv/bin/activate  # .venv\Scripts\activate on Windows
pip install -r requirements.txt
npm run dev
```
`/api/*.py` endpoints only run under Vercel's runtime (`vercel dev`) — plain
`next dev` 404s on API calls, expected for frontend-only work.

## Env vars
- `PSI_API_KEY` (optional) — PageSpeed Insights quota
- `GROQ_API_KEY` (optional) — server-side default for the AI Summary feature;
  users can also paste their own key in Settings (stored in browser localStorage only)

## Testing
```bash
source .venv/Scripts/activate  # .venv/bin/activate on macOS/Linux
pip install -r requirements-dev.txt
python -m pytest tests/ -v
```
Python-only for now (checklist derivation logic + the two new site-health/
indexability checks) — no frontend test runner is configured. `conftest.py`
at the repo root puts the project root on `sys.path` so `from modules...`
imports resolve without the `api/*.py` Vercel-handler sys.path shim.

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

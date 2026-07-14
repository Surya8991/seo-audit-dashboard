# Technical SEO Audit (Streamlit)

Standalone Streamlit app that runs the 35 no-API-key technical SEO checks
(crawlability, on-page, site health) against a single URL, with an optional
Groq-powered AI summary of the findings. Extracted from the [SEO Suite](../SEO%20Suite)
project's `tools/phase1.py` and `core/security.py` — no Flask, auth, DB, or
scheduler included.

## Checks

| Category | Count | Checks |
|---|---|---|
| Crawlability | 12 | robots, http_status, redirect, broken_links, internal_links, sitemap, canonical, meta_robots, hreflang, ttfb, url_structure, canonical_loop |
| On-Page | 11 | title, meta_description, headings, image_alt, word_count, readability, schema, og_tags, viewport, lang_attr, content_freshness |
| Site Health | 12 | ssl, domain_age, mixed_content, https_enforcement, security_headers, spf, dmarc, mx_records, favicon, dns_health, www_redirect, http2 |

All checks fetch pages through `core/security.py`'s SSRF-safe `requests`
wrapper (blocks localhost, private/loopback/link-local IPs, cloud metadata
hosts, and validates every redirect hop).

## Run locally

```bash
pip install -r requirements.txt
streamlit run app.py
```

Open the sidebar to optionally add a free [Groq API key](https://console.groq.com/keys)
for AI-generated plain-English summaries and prioritized fixes. Without a
key, the app runs fully offline (aside from the audited site itself).

## Deploy to Streamlit Community Cloud

1. Push this folder to its own GitHub repo.
2. On [share.streamlit.io](https://share.streamlit.io), point at `app.py`.
3. Add `GROQ_API_KEY` under app Settings → Secrets if you want AI summaries
   available by default (users can still paste their own key in the sidebar).

## Notes

- `textstat`, `python-whois`, `dnspython`, `httpx`, `lxml` are optional per
  check — if any is missing, that single check reports `error` with an
  install hint instead of crashing the audit.
- Module-level caches in `tools/phase1.py` (page/robots/DNS) persist across
  Streamlit reruns within the same process — this is intentional and speeds
  up repeated audits of the same site.

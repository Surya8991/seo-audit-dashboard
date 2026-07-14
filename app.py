"""Technical SEO Audit — Streamlit app.

Runs the 35 no-API-key technical SEO checks (crawlability + on-page + site
health) against a single URL, with an optional Groq-powered AI summary.
"""

import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import streamlit as st

from core.ai_assist import explain_audit
from core.security import validate_public_url
from tools import phase1 as t

CRAWLABILITY = [
    ("robots", t.robots_check),
    ("http_status", t.http_status_check),
    ("redirect", t.redirect_check),
    ("broken_links", t.broken_link_check),
    ("internal_links", t.internal_links_check),
    ("canonical", t.canonical_check),
    ("meta_robots", t.meta_robots_check),
    ("hreflang", t.hreflang_check),
    ("ttfb", t.ttfb_check),
    ("url_structure", t.url_structure_check),
    ("canonical_loop", t.canonical_loop_check),
]

ON_PAGE = [
    ("title", t.title_check),
    ("meta_description", t.meta_description_check),
    ("headings", t.heading_check),
    ("image_alt", t.image_alt_check),
    ("word_count", t.word_count_check),
    ("readability", t.readability_check),
    ("schema", t.schema_check),
    ("og_tags", t.og_check),
    ("viewport", t.viewport_check),
    ("lang_attr", t.lang_check),
    ("content_freshness", t.content_freshness_check),
]

SITE_HEALTH = [
    ("ssl", t.ssl_check),
    ("domain_age", t.domain_age_check),
    ("mixed_content", t.mixed_content_check),
    ("https_enforcement", t.https_enforcement_check),
    ("security_headers", t.security_headers_check),
    ("spf", t.spf_check),
    ("dmarc", t.dmarc_check),
    ("mx_records", t.mx_records_check),
    ("favicon", t.favicon_check),
    ("dns_health", t.dns_health_check),
    ("www_redirect", t.www_redirect_check),
    ("http2", t.http2_check),
]


def _sitemap_url(url: str) -> str:
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/sitemap.xml", "", ""))


def run_audit(url: str) -> dict:
    """Run all 35 checks in parallel and return {check_name: result_dict}."""
    checks = [*CRAWLABILITY, *ON_PAGE, *SITE_HEALTH]
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        futures = {ex.submit(fn, url): name for name, fn in checks}
        futures[ex.submit(t.sitemap_validate, _sitemap_url(url))] = "sitemap"
        for fut in as_completed(futures):
            name = futures[fut]
            try:
                results[name] = fut.result()
            except Exception as exc:  # noqa: BLE001 - surface per-check failures, don't crash the audit
                results[name] = {
                    "url": url,
                    "tool": name,
                    "status": "error",
                    "value": None,
                    "message": f"{type(exc).__name__}: {exc}",
                    "details": {},
                }
    return results


STATUS_ICON = {"pass": "✅", "warning": "⚠️", "fail": "❌", "error": "❓"}
STATUS_ORDER = {"fail": 0, "error": 1, "warning": 2, "pass": 3}


def render_category(title: str, names: list[str], results: dict[str, dict]):
    st.subheader(title)
    rows = sorted(names, key=lambda n: STATUS_ORDER.get(results.get(n, {}).get("status"), 4))
    for name in rows:
        r = results.get(name)
        if not r:
            continue
        icon = STATUS_ICON.get(r["status"], "❓")
        with st.expander(f"{icon} **{name}** — {r['message']}", expanded=(r["status"] in ("fail", "error"))):
            if r.get("value") is not None:
                st.write("**Value:**", r["value"])
            if r.get("details"):
                st.json(r["details"])


def score_summary(results: dict[str, dict]) -> tuple[int, int, int, int]:
    passes = sum(1 for r in results.values() if r["status"] == "pass")
    warnings = sum(1 for r in results.values() if r["status"] == "warning")
    fails = sum(1 for r in results.values() if r["status"] == "fail")
    errors = sum(1 for r in results.values() if r["status"] == "error")
    return passes, warnings, fails, errors


def main():
    st.set_page_config(page_title="Technical SEO Audit", page_icon="\U0001f50d", layout="wide")
    st.title("\U0001f50d Technical SEO Audit")
    st.caption(
        "Runs 35 no-API-key technical SEO checks: crawlability, on-page, and site health. "
        "No data leaves your machine except to the audited site (and Groq, if AI summary is used)."
    )

    with st.sidebar:
        st.header("Settings")
        groq_key = st.text_input(
            "Groq API key (optional, for AI summary)",
            value=os.environ.get("GROQ_API_KEY", ""),
            type="password",
            help="Free tier at https://console.groq.com/keys. Leave blank to skip AI summary.",
        )
        st.markdown("---")
        st.caption("Checks run entirely client-side against the target URL via SSRF-safe requests.")

    url = st.text_input("Website URL", placeholder="https://example.com")
    run = st.button("Run Audit", type="primary")

    if run:
        try:
            clean_url = validate_public_url(url)
        except ValueError as exc:
            st.error(f"Invalid URL: {exc}")
            return

        with st.spinner(f"Running 35 technical SEO checks on {clean_url}..."):
            results = run_audit(clean_url)
        st.session_state["results"] = results
        st.session_state["audited_url"] = clean_url

    results = st.session_state.get("results")
    audited_url = st.session_state.get("audited_url")

    if not results:
        return

    passes, warnings, fails, errors = score_summary(results)
    total = passes + warnings + fails + errors
    score = round(100 * (passes + 0.5 * warnings) / total) if total else 0

    st.markdown(f"### Results for `{audited_url}`")
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Score", f"{score}/100")
    c2.metric("Pass", passes)
    c3.metric("Warning", warnings)
    c4.metric("Fail", fails)
    c5.metric("Error", errors)
    st.progress(score / 100)

    if groq_key:
        if st.button("✨ Generate AI Summary"):
            with st.spinner("Asking Groq for a plain-English summary..."):
                summary = explain_audit(list(results.values()), groq_key, url=audited_url)
            if summary.get("ok"):
                st.info(summary["explanation"])
                st.markdown("**Top actions:**")
                for i, action in enumerate(summary["top_actions"], 1):
                    st.markdown(f"{i}. {action}")
            else:
                st.warning(f"AI summary unavailable: {summary.get('error')}")
    else:
        st.caption("Add a Groq API key in the sidebar to enable AI-generated summaries and prioritized fixes.")

    tab1, tab2, tab3 = st.tabs(
        [f"Crawlability ({len(CRAWLABILITY) + 1})", f"On-Page ({len(ON_PAGE)})", f"Site Health ({len(SITE_HEALTH)})"]
    )
    with tab1:
        render_category("Crawlability", [n for n, _ in CRAWLABILITY] + ["sitemap"], results)
    with tab2:
        render_category("On-Page", [n for n, _ in ON_PAGE], results)
    with tab3:
        render_category("Site Health", [n for n, _ in SITE_HEALTH], results)

    import json

    st.download_button(
        "Download results as JSON",
        data=json.dumps(results, indent=2, default=str),
        file_name="technical_seo_audit.json",
        mime="application/json",
    )


if __name__ == "__main__":
    main()

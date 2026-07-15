"""Groq AI assistance layer: plain-English audit summary.
Groq is OpenAI-compatible, fast, and has a generous free tier.
API key: https://console.groq.com -> API Keys. Env var: GROQ_API_KEY.

Ported from the standalone Streamlit SEO audit tool's core/ai_assist.py,
adapted to this project's {issue, category, severity, recommendation,
impact_score, effort} issue schema.
"""

import json
import logging
import re
import time

import requests

logger = logging.getLogger(__name__)

_GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
_DEFAULT_MODEL = "llama-3.1-8b-instant"
_MAX_AUDIT_CHARS = 8000

# Chatbot conversation bounds: this is a per-request Groq call (no server-side
# session), so the client resends the running history each turn. Cap both the
# number of turns and total size to keep requests small and bound token cost.
_MAX_CHAT_TURNS = 20
_MAX_CHAT_CONTEXT_CHARS = 4000

_APP_HELP_SYSTEM_PROMPT = """You are the in-app assistant for the SEO Technical Audit Dashboard.
Help users understand the app and their SEO audit results. Be concise and direct.

What this app does: audits one or many URLs for technical SEO issues (crawlability,
on-page, site health) and reports a 0-100 score, a 35-check technical checklist grouped
into Crawlability / On-Page / Site Health, per-issue severity + fix effort (Easy/Medium/Hard),
broken links, image SEO, heading structure, mobile-friendliness, and PageSpeed performance.

Key pages: Dashboard (overview), Technical Audit (run a new audit: single URL, sitemap,
crawl-from-URL, or CSV/paste a URL list), Results (list of audited URLs, filter/sort/export),
Detail (per-URL drill-down with tabs: Overview, Technical, Issues, Links, Headings,
Content & Images, Performance, Recommendations), Settings (theme, API keys).

If the user asks something unrelated to this app or to SEO, answer briefly if you can,
but steer back to what you can help with here. If you don't know a specific detail about
the app, say so rather than guessing."""


def _trim_chat_messages(messages: list[dict]) -> list[dict]:
    """Keep only the most recent turns, then hard-cap total character budget."""
    trimmed = messages[-_MAX_CHAT_TURNS:]
    budget = _MAX_CHAT_CONTEXT_CHARS
    out = []
    for msg in reversed(trimmed):
        content = str(msg.get("content", ""))[:budget]
        if not content:
            continue
        budget -= len(content)
        out.append({"role": msg.get("role", "user"), "content": content})
        if budget <= 0:
            break
    return list(reversed(out))


def chat_with_assistant(messages: list[dict], api_key: str, audit_context: dict | None = None,
                         model: str = _DEFAULT_MODEL) -> dict:
    """Multi-turn app-help / audit Q&A chat. `messages` is the running
    conversation (each `{role: "user"|"assistant", content: str}`), oldest
    first, NOT including the system prompt (that's added here).

    `audit_context`, when provided, is a small summary of the currently
    loaded audit (url, seo_score, top issue titles, and optionally `kb_notes`
    — matching entries from the app's own Common Issues KB, the same
    what-is-it/recommended-fix text that powers the "Learn more" expansion in
    the UI) so the assistant answers from the app's grounded explanations
    instead of the model's general knowledge for issues the KB covers.

    Returns {ok, reply, model} or {ok: False, error}.
    """
    if not api_key:
        return {"ok": False, "error": "Groq API key not configured"}
    if not messages:
        return {"ok": False, "error": "No message provided"}

    system_msg = _APP_HELP_SYSTEM_PROMPT
    if audit_context:
        ctx_url = str(audit_context.get("url") or "")
        ctx_score = audit_context.get("seo_score")
        ctx_issues = audit_context.get("top_issues") or []
        ctx_lines = [f"- {str(i)[:200]}" for i in ctx_issues[:10]]
        context_block = (
            f"\n\nThe user currently has an audit loaded for {ctx_url or 'a URL'} "
            f"(SEO score: {ctx_score if ctx_score is not None else 'unknown'}/100). "
            f"Its top issues:\n" + ("\n".join(ctx_lines) if ctx_lines else "(none)")
        )

        kb_notes = audit_context.get("kb_notes") or []
        if kb_notes:
            kb_lines = []
            for note in kb_notes[:5]:
                if not isinstance(note, dict):
                    continue
                title = str(note.get("issue", ""))[:200]
                what_is_it = str(note.get("whatIsIt", ""))[:300]
                fix = str(note.get("recommendedFix", ""))[:300]
                kb_lines.append(f"- {title}: {what_is_it} Fix: {fix}")
            if kb_lines:
                context_block += (
                    "\n\nGrounded explanations for some of these issues (from this "
                    "app's own knowledge base, prefer these over general knowledge):\n"
                    + "\n".join(kb_lines)
                )

        system_msg += context_block[:_MAX_CHAT_CONTEXT_CHARS]

    chat_messages = [{"role": "system", "content": system_msg}, *_trim_chat_messages(messages)]

    try:
        reply = _chat(chat_messages, api_key, model=model, temperature=0.5, max_tokens=500)
        return {"ok": True, "reply": reply, "model": model}
    except Exception as exc:
        logger.warning("chat_with_assistant failed: %s", exc)
        return {"ok": False, "error": _safe_error(exc)}


def _safe_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"


def _chat(messages, api_key, model=_DEFAULT_MODEL, temperature=0.4, max_tokens=800, json_mode=False):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    last_status = None
    for attempt in range(3):
        resp = requests.post(_GROQ_CHAT_URL, headers=headers, json=body, timeout=30)
        last_status = resp.status_code
        if json_mode and resp.status_code == 400 and "response_format" in body:
            # This model/account doesn't support JSON mode; drop it and retry
            # plain rather than burning the whole call on an unsupported param.
            body.pop("response_format")
            continue
        if resp.status_code == 429 or resp.status_code >= 500:
            if attempt < 2:
                retry_after = resp.headers.get("Retry-After")
                delay = (
                    float(retry_after)
                    if (retry_after and retry_after.replace(".", "", 1).isdigit())
                    else 0.5 * (2 ** attempt)
                )
                time.sleep(delay)
                continue
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    raise RuntimeError(f"Groq API unavailable (HTTP {last_status})")


def _parse_summary_reply(reply: str) -> tuple[str, list[str]]:
    """Parse explain_audit's model reply. Tries JSON first (the mode
    explain_audit requests via _chat's json_mode=True); falls back to the
    legacy numbered-list regex parse for a model/account that doesn't honor
    response_format, or an occasional malformed reply."""
    try:
        data = json.loads(reply)
        explanation = str(data.get("explanation", "")).strip()
        top_actions = [str(a).strip() for a in (data.get("top_actions") or []) if str(a).strip()]
        if explanation or top_actions:
            return explanation, top_actions[:5]
    except (json.JSONDecodeError, AttributeError, TypeError):
        pass

    lines_out = [ln.strip() for ln in reply.split("\n") if ln.strip()]
    action_pattern = re.compile(r"^[\d]+[\.\)]\s+")
    explanation_lines = [ln for ln in lines_out if not action_pattern.match(ln)]
    action_lines = [re.sub(r"^[\d]+[\.\)]\s+", "", ln) for ln in lines_out if action_pattern.match(ln)]
    return " ".join(explanation_lines[:4]), action_lines[:5]


def explain_audit(all_issues: list[dict], seo_score: float, api_key: str,
                   url: str = "", context_label: str | None = None, model: str = _DEFAULT_MODEL) -> dict:
    """Summarise SEO audit issues in plain English.

    `context_label`, when given, overrides the default "for {url}" phrasing
    (e.g. "across 42 audited pages (sitewide)" for the Results page's rollup
    summary, which passes the aggregated issue list across every audited URL
    instead of one page's).

    Returns {ok, explanation, top_actions, model, stats} or {ok: False, error}.
    """
    if not api_key:
        return {"ok": False, "error": "Groq API key not configured"}

    lines = []
    by_severity = {"Critical": 0, "High": 0, "Medium": 0, "Warning": 0, "Low": 0}
    for issue in all_issues:
        sev = issue.get("severity", "Low")
        by_severity[sev] = by_severity.get(sev, 0) + 1
        lines.append(f"[{sev.upper()}] {issue.get('category', '')}: {issue.get('issue', '')}")

    summary_text = "\n".join(lines)
    if len(summary_text) > _MAX_AUDIT_CHARS:
        summary_text = summary_text[:_MAX_AUDIT_CHARS]

    site_context = context_label or (f"for {url}" if url else "")
    system_msg = (
        "You are an expert technical SEO consultant. "
        "Given a list of SEO audit issues, explain the findings clearly to a non-technical website owner. "
        "Use plain English. Be direct and specific. Focus on what matters most and skip anything that passed."
    )
    user_msg = (
        f"SEO health score: {seo_score}/100. Audit issues found {site_context}:\n\n"
        f"{summary_text or '(no issues found)'}\n\n"
        "Respond with ONLY a JSON object of this exact shape, no other text:\n"
        '{"explanation": "2-3 sentence plain-English summary of overall technical SEO health", '
        '"top_actions": ["one-line action starting with a verb", "..."]}\n'
        "Include 3-5 items in top_actions, ordered by priority. Do not repeat the raw audit data back."
    )

    try:
        reply = _chat(
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            api_key, model=model, max_tokens=700, json_mode=True,
        )
        explanation, top_actions = _parse_summary_reply(reply)
        return {
            "ok": True,
            "explanation": explanation,
            "top_actions": top_actions,
            "model": model,
            "stats": by_severity,
        }
    except Exception as exc:
        logger.warning("explain_audit failed: %s", exc)
        return {"ok": False, "error": _safe_error(exc)}


# ── Specific fix suggestions ─────────────────────────────────────────────────
# Unlike explain_audit (a narrative summary) and chat_with_assistant (open Q&A),
# this drafts an actual ready-to-use replacement value for a well-defined,
# narrow set of issue types — "add a meta description" becomes a real
# 150-160 char draft, not just advice. Only supports issue titles matching
# _FIX_TARGET_PATTERNS; anything else returns ok:False so the caller can hide
# the "Suggest a fix" action rather than show a useless generic reply.

_FIX_TARGET_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"missing meta title|meta title too (short|long)", re.I), "title"),
    (re.compile(r"missing meta description|meta description too (short|long)", re.I), "description"),
    (re.compile(r"missing h1|h1 heading is too (short|long)", re.I), "h1"),
]

_FIX_TARGET_INSTRUCTIONS = {
    "title": (
        "Draft a page <title> tag, 30-60 characters, that accurately and specifically "
        "describes the page, includes the likely primary keyword naturally, and would "
        "stand out in a search results list."
    ),
    "description": (
        "Draft a meta description, 150-160 characters, that summarizes the page and gives "
        "a compelling, specific reason to click through from search results."
    ),
    "h1": (
        "Draft a single H1 heading, roughly 20-70 characters, that clearly states the "
        "page's main topic."
    ),
}


def detect_fix_target(issue_title: str) -> str | None:
    """Which concrete fix (if any) `suggest_fix` can draft for this issue
    title. Exposed separately from `suggest_fix` so callers (and the
    frontend's mirrored client-side check) can decide whether to show a
    "Suggest a fix" action without spending an API call to find out."""
    for pattern, target in _FIX_TARGET_PATTERNS:
        if pattern.search(issue_title):
            return target
    return None


def suggest_fix(issue_title: str, page_context: dict, api_key: str, model: str = _DEFAULT_MODEL) -> dict:
    """Draft a concrete, ready-to-use fix for a metadata/H1 issue, grounded in
    the page's own content rather than invented facts.

    `page_context`: {url, title, description, h1, content_snippet} — all optional.

    Returns {ok, suggestion, rationale, target, model} or {ok: False, error}.
    """
    if not api_key:
        return {"ok": False, "error": "Groq API key not configured"}

    target = detect_fix_target(issue_title)
    if not target:
        return {"ok": False, "error": f"No fix generator available for: {issue_title}"}

    url = str(page_context.get("url", ""))[:300]
    title = str(page_context.get("title", ""))[:200]
    description = str(page_context.get("description", ""))[:400]
    h1 = str(page_context.get("h1", ""))[:200]
    snippet = str(page_context.get("content_snippet", ""))[:1500]

    system_msg = (
        "You are an expert technical SEO copywriter. Given real information about a page, "
        "draft ONE concrete, ready-to-use replacement for the specific element requested. "
        "Ground it in the page's actual content — do not invent facts, products, or claims "
        "not implied by the given context. Keep the tone matching the existing copy where possible."
    )
    user_msg = (
        f"Page URL: {url or 'unknown'}\n"
        f"Current title: {title or '(none)'}\n"
        f"Current meta description: {description or '(none)'}\n"
        f"Current H1: {h1 or '(none)'}\n"
        f"Page content snippet: {snippet or '(none captured)'}\n\n"
        f"{_FIX_TARGET_INSTRUCTIONS[target]}\n\n"
        "Respond with ONLY a JSON object of this exact shape, no other text:\n"
        '{"suggestion": "the drafted text", "rationale": "one sentence on why this works"}'
    )

    try:
        reply = _chat(
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            api_key, model=model, max_tokens=300, json_mode=True,
        )
        try:
            data = json.loads(reply)
            suggestion = str(data.get("suggestion", "")).strip()
            rationale = str(data.get("rationale", "")).strip()
        except (json.JSONDecodeError, AttributeError, TypeError):
            suggestion, rationale = reply.strip(), ""
        if not suggestion:
            return {"ok": False, "error": "The assistant didn't return a usable suggestion."}
        return {"ok": True, "suggestion": suggestion, "rationale": rationale, "target": target, "model": model}
    except Exception as exc:
        logger.warning("suggest_fix failed: %s", exc)
        return {"ok": False, "error": _safe_error(exc)}

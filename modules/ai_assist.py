"""Groq AI assistance layer: plain-English audit summary.
Groq is OpenAI-compatible, fast, and has a generous free tier.
API key: https://console.groq.com -> API Keys. Env var: GROQ_API_KEY.

Ported from the standalone Streamlit SEO audit tool's core/ai_assist.py,
adapted to this project's {issue, category, severity, recommendation,
impact_score, effort} issue schema.
"""

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
    loaded audit (url, seo_score, top issue titles) so the assistant can
    answer questions about the user's actual results, not just the app.

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
        system_msg += (
            f"\n\nThe user currently has an audit loaded for {ctx_url or 'a URL'} "
            f"(SEO score: {ctx_score if ctx_score is not None else 'unknown'}/100). "
            f"Its top issues:\n" + ("\n".join(ctx_lines) if ctx_lines else "(none)")
        )[:_MAX_CHAT_CONTEXT_CHARS]

    chat_messages = [{"role": "system", "content": system_msg}, *_trim_chat_messages(messages)]

    try:
        reply = _chat(chat_messages, api_key, model=model, temperature=0.5, max_tokens=500)
        return {"ok": True, "reply": reply, "model": model}
    except Exception as exc:
        logger.warning("chat_with_assistant failed: %s", exc)
        return {"ok": False, "error": _safe_error(exc)}


def _safe_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"


def _chat(messages, api_key, model=_DEFAULT_MODEL, temperature=0.4, max_tokens=800):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    last_status = None
    for attempt in range(3):
        resp = requests.post(_GROQ_CHAT_URL, headers=headers, json=body, timeout=30)
        last_status = resp.status_code
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


def explain_audit(all_issues: list[dict], seo_score: float, api_key: str,
                   url: str = "", model: str = _DEFAULT_MODEL) -> dict:
    """Summarise SEO audit issues in plain English.

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

    site_context = f"for {url}" if url else ""
    system_msg = (
        "You are an expert technical SEO consultant. "
        "Given a list of SEO audit issues, explain the findings clearly to a non-technical website owner. "
        "Use plain English. Be direct and specific. Focus on what matters most and skip anything that passed."
    )
    user_msg = (
        f"SEO health score: {seo_score}/100. Audit issues found {site_context}:\n\n"
        f"{summary_text or '(no issues found)'}\n\n"
        f"Please:\n"
        f"1. Give a 2-3 sentence plain-English summary of the overall technical SEO health.\n"
        f"2. List the top 3-5 most important actions to fix, ordered by priority.\n"
        f"3. Keep each action to one line with a verb (e.g. 'Fix X because Y').\n"
        f"Do NOT repeat the raw audit data back to me."
    )

    try:
        reply = _chat(
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            api_key, model=model, max_tokens=700,
        )
        lines_out = [ln.strip() for ln in reply.split("\n") if ln.strip()]
        action_pattern = re.compile(r"^[\d]+[\.\)]\s+")
        explanation_lines = [ln for ln in lines_out if not action_pattern.match(ln)]
        action_lines = [re.sub(r"^[\d]+[\.\)]\s+", "", ln) for ln in lines_out if action_pattern.match(ln)]
        return {
            "ok": True,
            "explanation": " ".join(explanation_lines[:4]),
            "top_actions": action_lines[:5],
            "model": model,
            "stats": by_severity,
        }
    except Exception as exc:
        logger.warning("explain_audit failed: %s", exc)
        return {"ok": False, "error": _safe_error(exc)}

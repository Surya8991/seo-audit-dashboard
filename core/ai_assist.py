"""
Groq AI assistance layer (adapted from SEO Suite's tools/ai_assist.py).
Groq is OpenAI-compatible, fast, and has a generous free tier.
API key: https://console.groq.com -> API Keys
Env var: GROQ_API_KEY
"""

import logging
import re
import time

from core.security import safe_requests_post

logger = logging.getLogger(__name__)

_GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
_DEFAULT_MODEL = "llama-3.1-8b-instant"
_MAX_AUDIT_CHARS = 8000


def _safe_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"


def _chat(
    messages: list[dict],
    api_key: str,
    model: str = _DEFAULT_MODEL,
    temperature: float = 0.4,
    max_tokens: int = 800,
) -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    last_status = None
    for attempt in range(3):
        resp = safe_requests_post(_GROQ_CHAT_URL, headers=headers, json=body, timeout=30)
        last_status = resp.status_code
        if resp.status_code == 429 or resp.status_code >= 500:
            if attempt < 2:
                retry_after = resp.headers.get("Retry-After")
                delay = (
                    float(retry_after)
                    if (retry_after and retry_after.replace(".", "", 1).isdigit())
                    else 0.5 * (2**attempt)
                )
                time.sleep(delay)
                continue
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    raise RuntimeError(f"Groq API unavailable (HTTP {last_status})")


def explain_audit(results_list: list[dict], api_key: str, url: str = "", model: str = _DEFAULT_MODEL) -> dict:
    """Summarise technical SEO audit findings in plain English. Returns {ok, explanation, top_actions, model}."""
    if not api_key:
        return {"ok": False, "error": "Groq API key not configured"}

    lines, fails, warnings, errors = [], [], [], []
    for r in results_list:
        tool = r.get("tool", "unknown")
        status = r.get("status", "")
        msg = r.get("message", "")
        entry = f"[{status.upper()}] {tool}: {msg}"
        lines.append(entry)
        if status == "fail":
            fails.append(entry)
        elif status == "warning":
            warnings.append(entry)
        elif status == "error":
            errors.append(entry)

    summary_text = "\n".join(lines)
    if len(summary_text) > _MAX_AUDIT_CHARS:
        summary_text = "\n".join(fails + warnings + errors)[:_MAX_AUDIT_CHARS]

    site_context = f"for {url}" if url else ""
    system_msg = (
        "You are an expert technical SEO consultant. "
        "Given a list of technical SEO audit results, explain the findings clearly to a non-technical website owner. "
        "Use plain English. Be direct and specific. Focus on what matters most and skip anything that passed."
    )
    user_msg = (
        f"Here are the technical SEO audit results {site_context}:\n\n"
        f"{summary_text}\n\n"
        f"Please:\n"
        f"1. Give a 2-3 sentence plain-English summary of the overall technical SEO health.\n"
        f"2. List the top 3-5 most important actions to fix, ordered by priority.\n"
        f"3. Keep each action to one line with a verb (e.g. 'Fix X because Y').\n"
        f"Do NOT repeat the raw audit data back to me."
    )

    try:
        reply = _chat(
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            api_key,
            model=model,
            max_tokens=700,
        )
        lines_out = [ln.strip() for ln in reply.split("\n") if ln.strip()]
        action_pattern = re.compile(r"^[\d]+[\.\)]\s+")
        explanation_lines = [ln for ln in lines_out if not action_pattern.match(ln)]
        action_lines = [
            re.sub(r"^[\d]+[\.\)]\s+", "", ln) for ln in lines_out if action_pattern.match(ln)
        ]
        return {
            "ok": True,
            "explanation": " ".join(explanation_lines[:4]),
            "top_actions": action_lines[:5],
            "model": model,
            "stats": {
                "fails": len(fails),
                "warnings": len(warnings),
                "errors": len(errors),
                "passes": len(lines) - len(fails) - len(warnings) - len(errors),
            },
        }
    except Exception as exc:
        logger.warning("explain_audit failed: %s", exc)
        return {"ok": False, "error": _safe_error(exc)}

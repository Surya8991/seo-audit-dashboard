import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import read_json_body, require_str, send_json  # noqa: E402
from modules.ai_assist import chat_with_assistant, explain_audit, suggest_fix  # noqa: E402

logger = logging.getLogger(__name__)

# Same reasoning as ai_assist._MAX_CHAT_TURNS/_MAX_CHAT_CONTEXT_CHARS, enforced
# again at the request boundary so an oversized payload is rejected outright
# rather than silently trimmed.
MAX_MESSAGES = 40
MAX_MESSAGE_CHARS = 4000


def _handle_summary(handler, payload):
    try:
        all_issues = payload.get("allIssues") or []
        seo_score = payload.get("seoScore", 0)
        url = (payload.get("url") or "").strip()
        # Optional: overrides the default "for {url}" phrasing, e.g. the
        # Results page's sitewide summary passes "across N audited pages".
        context_label = (payload.get("contextLabel") or "").strip() or None
        api_key = payload.get("apiKey") or os.environ.get("GROQ_API_KEY")

        summary = explain_audit(all_issues, seo_score, api_key, url=url, context_label=context_label)
        status = 200 if summary.get("ok") else 400
        send_json(handler, status, summary)
    except Exception:  # noqa: BLE001
        logger.exception("ai.py (summary) request failed")
        send_json(handler, 500, {"ok": False, "error": "Internal error while generating the summary."})


def _handle_chat(handler, payload):
    try:
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            send_json(handler, 400, {"ok": False, "error": "messages is required"})
            return
        if len(messages) > MAX_MESSAGES:
            send_json(handler, 400, {"ok": False, "error": f"Too many messages (max {MAX_MESSAGES})"})
            return
        for m in messages:
            if not isinstance(m, dict) or not isinstance(m.get("content"), str):
                send_json(handler, 400, {"ok": False, "error": "Each message needs a string content"})
                return
            if len(m["content"]) > MAX_MESSAGE_CHARS:
                send_json(handler, 400, {"ok": False, "error": f"Message too long (max {MAX_MESSAGE_CHARS} chars)"})
                return

        api_key = payload.get("apiKey") or os.environ.get("GROQ_API_KEY")
        audit_context = payload.get("auditContext")
        if not isinstance(audit_context, dict):
            audit_context = None

        result = chat_with_assistant(messages, api_key, audit_context=audit_context)
        status = 200 if result.get("ok") else 400
        send_json(handler, status, result)
    except Exception:  # noqa: BLE001
        logger.exception("ai.py (chat) request failed")
        send_json(handler, 500, {"ok": False, "error": "Internal error while chatting."})


def _handle_fix_suggestion(handler, payload):
    try:
        issue_title = require_str(handler, payload, "issue", field_name="issue")
        if issue_title is None:
            return

        page_context = payload.get("pageContext") or {}
        if not isinstance(page_context, dict):
            page_context = {}
        api_key = payload.get("apiKey") or os.environ.get("GROQ_API_KEY")

        result = suggest_fix(issue_title, page_context, api_key)
        status = 200 if result.get("ok") else 400
        send_json(handler, status, result)
    except Exception:  # noqa: BLE001
        logger.exception("ai.py (fix-suggestion) request failed")
        send_json(handler, 500, {"ok": False, "error": "Internal error while generating the fix."})


# Consolidates what used to be 4 separate api/*.py files (ai-summary, chat,
# fix-suggestion, config-status) into one Vercel serverless function — see
# api/audit-pipeline.py's module docstring-equivalent comment for why
# (Vercel's Python builder reinstalls the full requirements.txt per function,
# so fewer functions means fewer ~14s installs at build time). Dispatch is by
# an "action" field in the POST body; callers POST to /api/ai with
# {"action": "summary"|"chat"|"fix-suggestion", ...}.
_ACTIONS = {
    "summary": _handle_summary,
    "chat": _handle_chat,
    "fix-suggestion": _handle_fix_suggestion,
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Config-status is the one GET in this group (just reports whether
        # server-side keys are set), so it doesn't need action dispatch.
        send_json(self, 200, {
            "psiConfigured": bool(os.environ.get("PSI_API_KEY")),
            "groqConfigured": bool(os.environ.get("GROQ_API_KEY")),
        })

    def do_POST(self):
        try:
            payload = read_json_body(self)
        except Exception:  # noqa: BLE001
            logger.exception("ai.py request body could not be parsed")
            send_json(self, 500, {"ok": False, "error": "Internal error while processing the request."})
            return

        action = payload.get("action")
        fn = _ACTIONS.get(action)
        if fn is None:
            send_json(self, 400, {"ok": False, "error": f"Unknown or missing action (expected one of {sorted(_ACTIONS)})"})
            return
        fn(self, payload)

import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import read_json_body, require_str, send_json  # noqa: E402
from modules.ai_assist import suggest_fix  # noqa: E402

logger = logging.getLogger(__name__)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            payload = read_json_body(self)

            issue_title = require_str(self, payload, "issue", field_name="issue")
            if issue_title is None:
                return

            page_context = payload.get("pageContext") or {}
            if not isinstance(page_context, dict):
                page_context = {}
            api_key = payload.get("apiKey") or os.environ.get("GROQ_API_KEY")

            result = suggest_fix(issue_title, page_context, api_key)
            status = 200 if result.get("ok") else 400
            send_json(self, status, result)
        except Exception:  # noqa: BLE001
            logger.exception("fix-suggestion.py request failed")
            send_json(self, 500, {"ok": False, "error": "Internal error while generating the fix."})

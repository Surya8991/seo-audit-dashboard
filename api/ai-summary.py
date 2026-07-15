import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import read_json_body, send_json  # noqa: E402
from modules.ai_assist import explain_audit  # noqa: E402

logger = logging.getLogger(__name__)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            payload = read_json_body(self)

            all_issues = payload.get("allIssues") or []
            seo_score = payload.get("seoScore", 0)
            url = (payload.get("url") or "").strip()
            api_key = payload.get("apiKey") or os.environ.get("GROQ_API_KEY")

            summary = explain_audit(all_issues, seo_score, api_key, url=url)
            status = 200 if summary.get("ok") else 400
            send_json(self, status, summary)
        except Exception:  # noqa: BLE001
            logger.exception("ai-summary.py request failed")
            send_json(self, 500, {"ok": False, "error": "Internal error while generating the summary."})

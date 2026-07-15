import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules.ai_assist import explain_audit  # noqa: E402

logger = logging.getLogger(__name__)


def _send_json(handler, status, data):
    body = json.dumps(data, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(body or b"{}")

            all_issues = payload.get("allIssues") or []
            seo_score = payload.get("seoScore", 0)
            url = (payload.get("url") or "").strip()
            api_key = payload.get("apiKey") or os.environ.get("GROQ_API_KEY")

            summary = explain_audit(all_issues, seo_score, api_key, url=url)
            status = 200 if summary.get("ok") else 400
            _send_json(self, status, summary)
        except Exception:  # noqa: BLE001
            logger.exception("ai-summary.py request failed")
            _send_json(self, 500, {"ok": False, "error": "Internal error while generating the summary."})

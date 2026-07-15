import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules.auditor import validate_audit_url  # noqa: E402
from modules.technical_checks import analyze_domain_health  # noqa: E402

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
        """Return only the domain-level site-health checks for a URL's domain
        (robots, sitemap, WHOIS, SSL, HTTPS enforcement, DNS, www-redirect,
        HTTP/2). The client fetches this once per domain and passes it into the
        per-URL /api/audit calls so a same-domain crawl doesn't re-run these
        for every page (Phase 2, PROJECT_LOG)."""
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(body or b"{}")

            url = (payload.get("url") or "").strip()
            if not url:
                _send_json(self, 400, {"error": "url is required"})
                return

            ok, msg = validate_audit_url(url)
            if not ok:
                _send_json(self, 400, {"error": msg})
                return

            _send_json(self, 200, {"url": url, "domain_health": analyze_domain_health(url)})
        except Exception:  # noqa: BLE001
            logger.exception("site-health.py request failed")
            _send_json(self, 500, {"error": "Internal error while checking site health."})

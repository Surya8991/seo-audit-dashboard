import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import read_json_body, require_str, send_json, validate_url_or_400  # noqa: E402
from modules.technical_checks import analyze_domain_health  # noqa: E402

logger = logging.getLogger(__name__)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        """Return only the domain-level site-health checks for a URL's domain
        (robots, sitemap, WHOIS, SSL, HTTPS enforcement, DNS, www-redirect,
        HTTP/2). The client fetches this once per domain and passes it into the
        per-URL /api/audit calls so a same-domain crawl doesn't re-run these
        for every page (Phase 2, PROJECT_LOG)."""
        try:
            payload = read_json_body(self)

            url = require_str(self, payload, "url")
            if url is None:
                return
            if not validate_url_or_400(self, url):
                return

            send_json(self, 200, {"url": url, "domain_health": analyze_domain_health(url)})
        except Exception:  # noqa: BLE001
            logger.exception("site-health.py request failed")
            send_json(self, 500, {"error": "Internal error while checking site health."})

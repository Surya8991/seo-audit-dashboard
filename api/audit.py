import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules.auditor import audit_url, validate_audit_url  # noqa: E402


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

            url = (payload.get("url") or "").strip()
            if not url:
                _send_json(self, 400, {"error": "url is required"})
                return

            ok, msg = validate_audit_url(url)
            if not ok:
                _send_json(self, 400, {"error": msg})
                return

            audit_type = payload.get("auditType", "auto")
            check_links = bool(payload.get("checkLinks", True))
            validate_links = bool(payload.get("validateLinks", False))
            fetch_pagespeed = bool(payload.get("fetchPagespeed", False))
            psi_api_key = payload.get("psiApiKey") or os.environ.get("PSI_API_KEY")
            # Optional: domain-level site-health computed once by the client
            # (via /api/site-health) and reused, so a same-domain crawl skips
            # re-running WHOIS/DNS/SSL/robots/etc. per page.
            prefetched_domain_health = payload.get("prefetchedDomainHealth")
            if not isinstance(prefetched_domain_health, dict):
                prefetched_domain_health = None

            result = audit_url(
                url,
                audit_type=audit_type,
                check_links=check_links,
                validate_links=validate_links,
                fetch_pagespeed=fetch_pagespeed,
                psi_api_key=psi_api_key,
                prefetched_domain_health=prefetched_domain_health,
            )
            result.pop("_soup_text", None)
            _send_json(self, 200, result)
        except Exception as e:  # noqa: BLE001
            _send_json(self, 500, {"error": str(e)})

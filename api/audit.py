import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import read_json_body, require_str, send_json, validate_url_or_400  # noqa: E402
from modules.auditor import audit_url  # noqa: E402

logger = logging.getLogger(__name__)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            payload = read_json_body(self)

            url = require_str(self, payload, "url")
            if url is None:
                return
            if not validate_url_or_400(self, url):
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
            send_json(self, 200, result)
        except Exception:  # noqa: BLE001
            logger.exception("audit.py request failed")
            send_json(self, 500, {"error": "Internal error while running the audit."})

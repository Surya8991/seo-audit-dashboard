import json
import logging
import os
import re
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules.auditor import validate_audit_url  # noqa: E402

logger = logging.getLogger(__name__)
from modules.sitemap_extractor import (  # noqa: E402
    DEFAULT_URL_CAP,
    SitemapError,
    discover_sitemap_url,
    extract_sitemap_urls,
)

# Client-supplied regex bound: rejects both pathological (ReDoS-prone) input
# and outright invalid regex before it ever reaches per-URL matching.
MAX_PATTERN_LENGTH = 200


def _validate_pattern(pattern):
    """Return an error message string if `pattern` is unsafe/invalid, else None."""
    if len(pattern) > MAX_PATTERN_LENGTH:
        return f"Pattern too long (max {MAX_PATTERN_LENGTH} chars)"
    try:
        re.compile(pattern)
    except re.error as e:
        return f"Invalid pattern: {e}"
    return None


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

            raw = (payload.get("sitemapUrl") or payload.get("url") or "").strip()
            if not raw:
                _send_json(self, 400, {"error": "sitemapUrl is required"})
                return

            # If the caller passed a bare domain / page URL, guess its sitemap.
            sitemap_url = raw if raw.rstrip("/").lower().endswith(".xml") or "sitemap" in raw.lower() else discover_sitemap_url(raw)

            ok, msg = validate_audit_url(sitemap_url)
            if not ok:
                _send_json(self, 400, {"error": msg})
                return

            limit = payload.get("limit", DEFAULT_URL_CAP)
            include_pattern = payload.get("includePattern") or None
            exclude_pattern = payload.get("excludePattern") or None

            for pat in (include_pattern, exclude_pattern):
                if pat:
                    err = _validate_pattern(pat)
                    if err:
                        _send_json(self, 400, {"error": err})
                        return

            result = extract_sitemap_urls(
                sitemap_url,
                limit=limit,
                include_pattern=include_pattern,
                exclude_pattern=exclude_pattern,
            )
            _send_json(self, 200, result)
        except SitemapError as e:
            _send_json(self, 502, {"error": f"Sitemap error: {e}"})
        except Exception:  # noqa: BLE001
            logger.exception("sitemap.py request failed")
            _send_json(self, 500, {"error": "Internal error while resolving the sitemap."})

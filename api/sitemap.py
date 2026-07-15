import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import read_json_body, require_str, send_json, validate_pattern, validate_url_or_400  # noqa: E402
from modules.sitemap_extractor import (  # noqa: E402
    DEFAULT_URL_CAP,
    SitemapError,
    discover_sitemap_url,
    extract_sitemap_urls,
)

logger = logging.getLogger(__name__)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            payload = read_json_body(self)

            raw = require_str(self, payload, "sitemapUrl", "url", field_name="sitemapUrl")
            if raw is None:
                return

            # If the caller passed a bare domain / page URL, guess its sitemap.
            sitemap_url = raw if raw.rstrip("/").lower().endswith(".xml") or "sitemap" in raw.lower() else discover_sitemap_url(raw)

            if not validate_url_or_400(self, sitemap_url):
                return

            limit = payload.get("limit", DEFAULT_URL_CAP)
            include_pattern = payload.get("includePattern") or None
            exclude_pattern = payload.get("excludePattern") or None

            for pat in (include_pattern, exclude_pattern):
                if pat:
                    err = validate_pattern(pat)
                    if err:
                        send_json(self, 400, {"error": err})
                        return

            result = extract_sitemap_urls(
                sitemap_url,
                limit=limit,
                include_pattern=include_pattern,
                exclude_pattern=exclude_pattern,
            )
            send_json(self, 200, result)
        except SitemapError as e:
            send_json(self, 502, {"error": f"Sitemap error: {e}"})
        except Exception:  # noqa: BLE001
            logger.exception("sitemap.py request failed")
            send_json(self, 500, {"error": "Internal error while resolving the sitemap."})

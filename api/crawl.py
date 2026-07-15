import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import read_json_body, require_str, send_json, validate_pattern, validate_url_or_400  # noqa: E402
from modules.crawler import CrawlConfig, crawl_site  # noqa: E402

logger = logging.getLogger(__name__)

# Discovery-only cap. Kept lower than the sitemap/CSV modes' cap (2000):
# unlike a sitemap fetch (one XML download), BFS crawl discovery does a real
# HTTP GET per page just to extract links, so this bounds the discovery
# request itself to the Vercel maxDuration window, not just the audit phase.
DEFAULT_MAX_PAGES = 50
MAX_MAX_PAGES = 200


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            payload = read_json_body(self)

            seed_url = require_str(self, payload, "seedUrl", "url", field_name="seedUrl")
            if seed_url is None:
                return
            if not validate_url_or_400(self, seed_url):
                return

            max_pages = max(1, min(int(payload.get("maxPages") or DEFAULT_MAX_PAGES), MAX_MAX_PAGES))

            for pat in (payload.get("includePattern"), payload.get("excludePattern")):
                if pat:
                    err = validate_pattern(pat)
                    if err:
                        send_json(self, 400, {"error": err})
                        return

            try:
                config = CrawlConfig(
                    seed_url=seed_url,
                    seed_source=payload.get("seedSource", "homepage"),
                    include_patterns=[payload["includePattern"]] if payload.get("includePattern") else [],
                    exclude_patterns=[payload["excludePattern"]] if payload.get("excludePattern") else [],
                    max_depth=int(payload.get("maxDepth") or 3),
                    max_pages=max_pages,
                    include_subdomains=bool(payload.get("includeSubdomains", False)),
                    user_agent=payload.get("userAgent", "default"),
                    robots_mode=payload.get("robotsMode", "respect"),
                    max_workers=4,
                    # Discovery only: the browser fans out per-page audits itself
                    # via lib/crawl/orchestrator.ts, so this stays fast and safely
                    # under the Vercel maxDuration cap even for max_pages=200.
                    run_full_audit=False,
                )
            except ValueError as e:
                send_json(self, 400, {"error": str(e)})
                return

            result = crawl_site(config)
            if result.get("error"):
                send_json(self, 502, {"error": result["error"]})
                return

            urls = [p["url"] for p in result["pages"]]
            send_json(self, 200, {
                "seed_url": seed_url,
                "urls": urls,
                "total_found": len(urls),
                "capped": result["stats"]["pages_crawled"] >= max_pages,
                "skipped_robots": len(result.get("skipped_robots", [])),
                "skipped_scope": len(result.get("skipped_scope", [])),
                "errors": len(result.get("errors", [])),
                "depth_reached": result["stats"]["depth_reached"],
                "duration_seconds": result["stats"]["duration_seconds"],
            })
        except Exception:  # noqa: BLE001
            logger.exception("crawl.py request failed")
            send_json(self, 500, {"error": "Internal error while crawling."})

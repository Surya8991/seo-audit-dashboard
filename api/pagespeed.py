import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import read_json_body, require_str, send_json  # noqa: E402
from modules.pagespeed import fetch_pagespeed  # noqa: E402

logger = logging.getLogger(__name__)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            payload = read_json_body(self)

            url = require_str(self, payload, "url")
            if url is None:
                return

            strategy = payload.get("strategy", "mobile")
            api_key = payload.get("apiKey") or os.environ.get("PSI_API_KEY")

            result = fetch_pagespeed(url, strategy=strategy, api_key=api_key)
            send_json(self, 200, result)
        except Exception:  # noqa: BLE001
            logger.exception("pagespeed.py request failed")
            send_json(self, 500, {"error": "Internal error while fetching PageSpeed data."})

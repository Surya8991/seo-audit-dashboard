import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import send_json  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        send_json(self, 200, {
            "psiConfigured": bool(os.environ.get("PSI_API_KEY")),
            "groqConfigured": bool(os.environ.get("GROQ_API_KEY")),
        })

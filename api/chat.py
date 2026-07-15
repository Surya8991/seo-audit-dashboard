import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules._http import read_json_body, send_json  # noqa: E402
from modules.ai_assist import chat_with_assistant  # noqa: E402

logger = logging.getLogger(__name__)

# Same reasoning as ai_assist._MAX_CHAT_TURNS/_MAX_CHAT_CONTEXT_CHARS, enforced
# again at the request boundary so an oversized payload is rejected outright
# rather than silently trimmed.
MAX_MESSAGES = 40
MAX_MESSAGE_CHARS = 4000


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            payload = read_json_body(self)

            messages = payload.get("messages")
            if not isinstance(messages, list) or not messages:
                send_json(self, 400, {"ok": False, "error": "messages is required"})
                return
            if len(messages) > MAX_MESSAGES:
                send_json(self, 400, {"ok": False, "error": f"Too many messages (max {MAX_MESSAGES})"})
                return
            for m in messages:
                if not isinstance(m, dict) or not isinstance(m.get("content"), str):
                    send_json(self, 400, {"ok": False, "error": "Each message needs a string content"})
                    return
                if len(m["content"]) > MAX_MESSAGE_CHARS:
                    send_json(self, 400, {"ok": False, "error": f"Message too long (max {MAX_MESSAGE_CHARS} chars)"})
                    return

            api_key = payload.get("apiKey") or os.environ.get("GROQ_API_KEY")
            audit_context = payload.get("auditContext")
            if not isinstance(audit_context, dict):
                audit_context = None

            result = chat_with_assistant(messages, api_key, audit_context=audit_context)
            status = 200 if result.get("ok") else 400
            send_json(self, status, result)
        except Exception:  # noqa: BLE001
            logger.exception("chat.py request failed")
            send_json(self, 500, {"ok": False, "error": "Internal error while chatting."})

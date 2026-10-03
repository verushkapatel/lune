#!/usr/bin/env python3
"""A stand-in for an OpenAI-compatible chat endpoint (like Ollama's), for UI tests.

It is not a language model: it replies with a fixed sentence that quotes the
bar number it was given, so a test can see the request reached it with the
right context. Usage: python3 scripts/standin_model_server.py [port]
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8139
LAST = {}


class H(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):  # the last request, for tests
        body = json.dumps(LAST).encode()
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        LAST.clear()
        LAST.update(req)
        user = req.get("messages", [{}])[-1].get("content", "")
        bar = None
        try:
            ctx = json.loads(user.split("CONTEXT:\n", 1)[1].split("\n\nQUESTION:", 1)[0])
            bar = (ctx.get("bar") or {}).get("number")
        except Exception:
            pass
        text = f"STANDIN reply about bar {bar}." if bar else "STANDIN reply about the piece."
        body = json.dumps({"choices": [{"message": {"role": "assistant", "content": text}}]}).encode()
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()

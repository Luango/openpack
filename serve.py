"""Static file server with caching disabled.

`python -m http.server` sends no Cache-Control, so browsers (and the preview
webview) hold onto stale JS modules between edits. This sends no-store on every
response so a reload always fetches the current files.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()

"""Static file server with caching disabled.

`python -m http.server` sends no Cache-Control, so browsers (and the preview
webview) hold onto stale JS modules between edits. This sends no-store on every
response so a reload always fetches the current files.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class Server(ThreadingHTTPServer):
    # The page fires ~20 module requests at once (flattened by modulepreload). The
    # stdlib's listen backlog is 5, and on Windows an overflowed backlog REFUSES the
    # connection outright (no SYN retry) — a module then fails with status 0 and the
    # app never boots. A deep backlog makes the burst queue instead.
    request_queue_size = 128
    daemon_threads = True


if __name__ == "__main__":
    # Prefer the PORT env var (the preview harness assigns a free one when
    # autoPort is set), then a CLI arg, then the default.
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8123))
    Server(("127.0.0.1", port), NoCacheHandler).serve_forever()

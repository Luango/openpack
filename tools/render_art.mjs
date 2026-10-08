// render_art.mjs — render the printed art (tools/art/packart.js) to the files the
// app ships:
//
//   assets/pack.png             the full-size source (1083×1794, alpha)
//   assets/pack-hi.webp         the 3D carousel texture (desktop)
//   assets/pack-hi-720.webp     …and its phone-sized twin
//   assets/pack.webp            the SVG tear-pack + its gloss mask (880 wide)
//   assets/pack-back-hi.webp    the pouch's back (carousel)
//   assets/pack-back-hi-720.webp
//   assets/pack-print-front.png the print masks: where the brand + pack name are
//   assets/pack-print-back.png  printed (720 wide, greyscale) — src/pack3d's ink finish
//   assets/card-back.webp       the card back (756×1056, alpha — the gold frame, dimmed)
//
//   node tools/render_art.mjs            # render + export into assets/
//   node tools/render_art.mjs --out dir  # just write the raw PNGs to dir (preview)
//
// Needs Chrome/Edge (headless, via tools/cdp.mjs) and Python with Pillow for the
// WebP/JPEG export. Serves the repo itself on a throwaway port — no dev server.

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const previewDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : null;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(ROOT, path.endsWith("/") ? path + "index.html" : path);
    if (!file.startsWith(ROOT)) throw new Error("outside root");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const b = await launch({ width: 1600, height: 1000 });
const outDir = previewDir || join(ROOT, "tools", "art", "out");
await mkdir(outDir, { recursive: true });
try {
  await b.goto(`http://127.0.0.1:${port}/tools/art/index.html`, 500);
  // the page is a module graph — wait for it to publish its hooks
  for (let i = 0; i < 150 && !(await b.eval("typeof window.renderArt === 'function'")); i++) await b.sleep(100);
  if (!(await b.eval("typeof window.renderArt === 'function'"))) throw new Error("art page never loaded:\n" + b.logs.join("\n"));
  await b.eval("window.artReady");
  for (const name of ["pack-front", "pack-back", "pack-front-print", "pack-back-print", "card-back"]) {
    const url = await b.eval(`window.renderArt(${JSON.stringify(name)})`);
    const file = join(outDir, `${name}.png`);
    await writeFile(file, Buffer.from(url.split(",")[1], "base64"));
    console.log("rendered", file);
  }
  if (b.logs.length) console.log(b.logs.join("\n"));
} finally {
  await b.close();
  server.close();
}

if (!previewDir) {
  // export the shipped variants with Pillow
  const py = `
from PIL import Image
import os
root, out = r"${ROOT}", r"${outDir}"
a = lambda *p: os.path.join(root, "assets", *p)
front = Image.open(os.path.join(out, "pack-front.png")).convert("RGBA")
back = Image.open(os.path.join(out, "pack-back.png")).convert("RGBA")
cardb = Image.open(os.path.join(out, "card-back.png")).convert("RGBA")
def fit(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
front.save(a("pack.png"), optimize=True)
front.save(a("pack-hi.webp"), quality=90, method=6)
fit(front, 720).save(a("pack-hi-720.webp"), quality=88, method=6)
fit(front, 880).save(a("pack.webp"), quality=88, method=6)
back.save(a("pack-back-hi.webp"), quality=88, method=6)
fit(back, 720).save(a("pack-back-hi-720.webp"), quality=86, method=6)
cardb.save(a("card-back.webp"), quality=92, method=6)
for side in ["front", "back"]:
    m = Image.open(os.path.join(out, f"pack-{side}-print.png")).convert("RGBA").getchannel("A")
    fit(m, 720).save(a(f"pack-print-{side}.png"), optimize=True)
for f in ["pack.png", "pack-hi.webp", "pack-hi-720.webp", "pack.webp", "pack-back-hi.webp", "pack-back-hi-720.webp", "pack-print-front.png", "pack-print-back.png", "card-back.webp"]:
    print(f"{f:24s} {os.path.getsize(a(f)) // 1024:5d} KB")
`;
  const r = spawnSync(process.env.PYTHON || "python", ["-c", py], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}

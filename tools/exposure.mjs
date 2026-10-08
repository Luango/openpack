// exposure.mjs — measure the pack's exposure through the flow, headlessly (no deps
// beyond tools/cdp.mjs): the carousel's front pack (+ its top band and a side pack),
// the flown hero frozen just before it dissolves, and the pack on the tear stage once
// it has settled. Prints mean / median / p99 luminance and the share of clipped
// (≥250) and near-black (<40) pixels per region — the numbers the lighting is tuned
// against: the hero should sit well above its neighbours without clipping, and the
// landed hero should match the stage pack so the dissolve has no brightness step.
//
//   python serve.py 8131 &  node tools/exposure.mjs [port] [outdir]
//
// Stats are computed in the page (the screenshot is drawn to a canvas there), so
// nothing needs installing. Screenshots land in outdir when one is given.

import { launch } from "./cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const port = process.argv[2] || "8131", out = process.argv[3];
if (out) mkdirSync(out, { recursive: true });
const W = 393, H = 852, DPR = 2;
const b = await launch({ width: W, height: H, dpr: DPR, mobile: true });

const shot = async (name) => {
  const r = await b.send("Page.captureScreenshot", { format: "png" });
  if (out) writeFileSync(`${out}/${name}.png`, Buffer.from(r.data, "base64"));
  await b.eval(`new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const g = c.getContext("2d"); g.drawImage(im, 0, 0); window.__shot = g; res(1); }; im.src = "data:image/png;base64,${r.data}"; })`);
};
// region in CSS px → stats of the last shot
const measure = (label, [x0, y0, x1, y1]) => b.eval(`(() => {
  const d = window.__shot.getImageData(${x0 * DPR}, ${y0 * DPR}, ${(x1 - x0) * DPR}, ${(y1 - y0) * DPR}).data;
  const n = d.length / 4, L = new Float32Array(n); let clip = 0, dark = 0, sum = 0;
  for (let i = 0; i < n; i++) { const r = d[i * 4], g = d[i * 4 + 1], bl = d[i * 4 + 2]; const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl; L[i] = l; sum += l; if (Math.max(r, g, bl) >= 250) clip++; if (l < 40) dark++; }
  L.sort();
  const pct = (p) => L[Math.min(n - 1, Math.floor(p * n))];
  return ${JSON.stringify(label)}.padEnd(26) + " mean " + (sum / n).toFixed(1).padStart(6) + "  p50 " + pct(0.5).toFixed(1).padStart(6) + "  p99 " + pct(0.99).toFixed(1).padStart(6) + "  clip " + (100 * clip / n).toFixed(2).padStart(5) + "%  dark " + (100 * dark / n).toFixed(1).padStart(5) + "%";
})()`).then(console.log);

await b.goto(`http://127.0.0.1:${port}/index.html?phone=1&packdebug=1`, 800);
await b.eval(`new Promise((r) => { const t = setInterval(() => { if (window.__select3d) { clearInterval(t); r(1); } }, 100); })`);
await b.tap(W / 2, 700); // the start gate
for (let i = 0; i < 300; i++) { if (await b.eval("!!window.__select3d.introDone && !window.__select3d.introing")) break; await b.sleep(100); }
await b.sleep(1500);
await b.eval(`document.querySelectorAll(".pack3d-debug,.select-debug").forEach((e) => { e.style.display = "none"; }); 1`);
await shot("carousel");
await measure("carousel front pack", [100, 225, 295, 640]);
await measure("carousel front pack top", [150, 240, 245, 350]);
await measure("carousel side pack", [0, 320, 70, 520]);

await b.tap(W / 2, 430); // the front pack → selection flight
for (let i = 0; i < 300; i++) { if (await b.eval("window.__select3d.dissolving")) break; await b.sleep(10); }
// freeze the landed hero: hold the canvas opaque through its dissolve for the shot
await b.eval(`{ const st = document.createElement("style"); st.id = "__hold"; st.textContent = "#select-stage{opacity:1!important;transition:none!important}"; document.head.appendChild(st); } 1`);
await b.sleep(60);
await shot("landed");
const rect = JSON.parse(await b.eval(`JSON.stringify(window.__pack3d?.getHandoffRect?.() || { x: 49, y: 181, width: 295, height: 490 })`));
const packBox = [Math.round(rect.x + 10), Math.round(rect.y + 10), Math.round(rect.x + rect.width - 10), Math.round(rect.y + rect.height - 10)];
await measure("landed hero (pre-dissolve)", packBox);
await b.eval(`document.getElementById("__hold").remove(); 1`);
for (let i = 0; i < 100; i++) { if (await b.eval("!window.__select3d.dissolving && !document.body.classList.contains('picking')")) break; await b.sleep(100); }
await b.sleep(4200); // dissolve + present + the #scene-bg settle (0.38 s delay + 1.7 s)
await b.eval(`document.querySelectorAll(".pack3d-debug").forEach((e) => { e.style.display = "none"; }); 1`);
await shot("stage");
await measure("stage pack (settled)", packBox);
await measure("stage backdrop (top)", [0, 0, W, 150]);
const errs = b.logs.filter((l) => l.startsWith("[exception]") || l.startsWith("[error]"));
if (errs.length) console.log("page errors:\n" + errs.join("\n"));
await b.close();

// cdp.mjs — a tiny headless-Chrome driver over the DevTools protocol (no deps:
// Node 22+ ships a global WebSocket). Used by tools/render_art.mjs to render the
// HTML art sources to transparent PNGs, and handy for scripted smoke tests.
//
//   const b = await launch({ width: 390, height: 844, dpr: 2, mobile: true });
//   await b.goto("http://127.0.0.1:8123/");
//   await b.tap(195, 420);
//   await b.shot("out.png");
//   await b.close();

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1280, height = 800, dpr = 1, mobile = false, port = 9300 + Math.floor(Math.random() * 500) } = {}) {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("No Chrome/Edge found — set CHROME=/path/to/chrome");
  const profile = mkdtempSync(join(tmpdir(), "openpack-cdp-"));
  const proc = spawn(exe, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
    `--window-size=${width},${height}`,
    "about:blank",
  ], { stdio: "ignore" });

  // find the page target
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(100);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch { /* not up yet */ }
  }
  if (!target) { proc.kill(); throw new Error("Chrome did not expose a page target"); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const once = (method) => new Promise((res) => {
    const arr = listeners.get(method) || [];
    const fn = (p) => { listeners.set(method, (listeners.get(method) || []).filter((f) => f !== fn)); res(p); };
    arr.push(fn);
    listeners.set(method, arr);
  });

  const logs = [];
  await send("Page.enable");
  await send("Runtime.enable");
  listeners.set("Runtime.consoleAPICalled", [(p) => logs.push(`[${p.type}] ${p.args.map((a) => a.value ?? a.description ?? "").join(" ")}`)]);
  listeners.set("Runtime.exceptionThrown", [(p) => logs.push(`[exception] ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`)]);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile });
  if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  const api = {
    send,
    logs,
    // subscribe to a CDP event (e.g. "Tracing.dataCollected"); returns an unsubscribe fn
    on(method, fn) {
      listeners.set(method, [...(listeners.get(method) || []), fn]);
      return () => listeners.set(method, (listeners.get(method) || []).filter((f) => f !== fn));
    },
    async goto(url, settle = 300) {
      const loaded = once("Page.loadEventFired");
      await send("Page.navigate", { url });
      await loaded;
      await sleep(settle);
    },
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(path, { clip, transparent = false, format = "png" } = {}) {
      if (transparent) await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
      const r = await send("Page.captureScreenshot", { format, ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: !!clip });
      writeFileSync(path, Buffer.from(r.data, "base64"));
      return path;
    },
    async mouse(type, x, y, buttons = 1) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, pointerType: "mouse" });
    },
    async tap(x, y) {
      await api.mouse("mouseMoved", x, y, 0);
      await api.mouse("mousePressed", x, y);
      await sleep(60);
      await api.mouse("mouseReleased", x, y, 0);
    },
    // drag through points [[x,y],…] over `ms`
    async drag(points, ms = 500) {
      const [x0, y0] = points[0];
      await api.mouse("mouseMoved", x0, y0, 0);
      await api.mouse("mousePressed", x0, y0);
      const steps = Math.max(2, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * (points.length - 1);
        const k = Math.min(points.length - 2, Math.floor(t)), f = t - k;
        const x = points[k][0] + (points[k + 1][0] - points[k][0]) * f;
        const y = points[k][1] + (points[k + 1][1] - points[k][1]) * f;
        await api.mouse("mouseMoved", x, y);
        await sleep(16);
      }
      const [xe, ye] = points[points.length - 1];
      await api.mouse("mouseReleased", xe, ye, 0);
    },
    sleep,
    async close() {
      // ask Chrome to quit cleanly (takes its renderer/GPU children with it), then
      // make sure the main process is gone
      try { await Promise.race([send("Browser.close"), sleep(1500)]); } catch { /* already going */ }
      try { ws.close(); } catch { /* already closed */ }
      proc.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
    },
  };
  return api;
}

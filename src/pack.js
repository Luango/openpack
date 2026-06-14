// pack.js — TEAR-OPEN prototype (no click-to-open).
//
// Drag across the sealed foil pack and it tears along the line your finger
// actually traces. The tear is a GAP that opens from the start edge, follows
// your path, and PINCHES SHUT at your fingertip — the pack stays joined ahead of
// the tear front, so it isn't fully split until your finger reaches the far
// edge. The gap widens as you pull (force-latency spring), its edges are
// jittered (rough torn paper), foil flecks spray, and a sustained foil-rip sound
// + haptic track your pull. Cross all the way to commit (it yawns open to reveal
// the interior); stop short and it eases shut into one piece again.
//
// Reuses the shared spring (motion.js), particles (particles.js), and Web Audio
// (sfx.js). The card stack/reveal will mount in the revealed interior next.

import { createSpring } from "./motion.js";
import { createParticles } from "./particles.js";
import * as sfx from "./sfx.js";

const VB = { w: 300, h: 420 }; // pack viewBox (≈ booster-pack proportions)
const GAP_TEAR = 40; // SVG units the gap opens to while you're mid-tear
const GAP_OPEN = 150; // …and once the tear crosses the whole pack
const START_DIST = 12; // finger travel before the tear engages
const CROSS_MARGIN = 12; // how near the far edge counts as "crossed"
const CROSS_MIN = 90; // …and a minimum tear length, so starting near an edge doesn't count
const FOIL = ["#ff5d8f", "#ffd24a", "#5fcf8e", "#3fd6c8", "#6ea8fe", "#b072e6"];

export function createPack({ mountEl }) {
  mountEl.innerHTML = `
    <svg class="pack" viewBox="0 0 ${VB.w} ${VB.h}" aria-label="Sealed pack — tear it open">
      <defs>
        <linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff5d8f"/><stop offset=".2" stop-color="#ffd24a"/>
          <stop offset=".45" stop-color="#5fcf8e"/><stop offset=".65" stop-color="#3fd6c8"/>
          <stop offset=".82" stop-color="#6ea8fe"/><stop offset="1" stop-color="#b072e6"/>
        </linearGradient>
        <mask id="tearmask">
          <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="#fff"/>
          <polygon class="gap" points="" fill="#000"/>
        </mask>
      </defs>

      <rect x="6" y="6" width="${VB.w - 12}" height="${VB.h - 12}" rx="12" fill="#05070b"/>

      <g mask="url(#tearmask)">
        <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="url(#foil)"/>
        <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="#0b0d12" opacity=".30"/>
        <rect x="0" y="0" width="${VB.w}" height="22" fill="#fff" opacity=".10"/>
        <rect x="0" y="${VB.h - 22}" width="${VB.w}" height="22" fill="#fff" opacity=".10"/>
        <text x="${VB.w / 2}" y="196" text-anchor="middle" class="pack-logo">OPENPACK</text>
        <text x="${VB.w / 2}" y="224" text-anchor="middle" class="pack-sub">TEAR TO OPEN</text>
      </g>

      <polygon class="tear-edge" points="" fill="none" stroke="#e4e1d8" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <canvas class="pack-fx"></canvas>`;

  const svg = mountEl.querySelector(".pack");
  const gap = mountEl.querySelector(".gap");
  const tearEdge = mountEl.querySelector(".tear-edge");
  const particles = createParticles(mountEl.querySelector(".pack-fx"));

  let path = []; // finger points (SVG space)
  let tearPath = null; // [edge-anchor, …path…, (far edge if crossed)]
  let dragging = false;
  let tearing = false;
  let crossed = false;
  let opened = false;
  let lastClient = null;
  let lastT = 0;
  let peakSpeed = 0;

  // `w` is the current gap width; the spring lags it (the paper resists, then
  // gives). Each tick redraws the gap polygon from the stored tear path.
  const spring = createSpring({
    rest: { w: 0 },
    stiffness: 0.18,
    damping: 0.7,
    onTick: (c) => {
      if (!tearPath) return;
      const poly = ribbon(tearPath, c.w, crossed);
      const pts = poly ? poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";
      gap.setAttribute("points", pts);
      tearEdge.setAttribute("points", c.w > 1 ? pts : "");
    },
  });

  function toSvg(e) {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: q.y };
  }

  function rebuild() {
    const raw = jitter(path);
    const anchor = toBorder(raw[0], unit(sub(raw[0], raw[1]))); // tear starts at the nearest edge
    const tip = raw[raw.length - 1];
    crossed = nearBorder(tip) && pathLen(path) > CROSS_MIN;
    tearPath = crossed ? [anchor, ...raw, snapBorder(tip)] : [anchor, ...raw];
  }

  function onDown(e) {
    if (opened) return reset();
    dragging = true;
    tearing = false;
    crossed = false;
    path = [toSvg(e)];
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = performance.now();
    peakSpeed = 0;
    svg.setPointerCapture?.(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;
    const p = toSvg(e);
    if (dist(p, path[path.length - 1]) < 3) return; // downsample
    path.push(p);

    if (!tearing && pathLen(path) > START_DIST) {
      tearing = true;
      sfx.tearStart();
    }
    if (!tearing) return;

    rebuild();
    const progress = Math.min(1, pathLen(path) / (VB.h * 0.6));
    spring.set({ w: crossed ? GAP_OPEN : progress * GAP_TEAR });

    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    const speed = Math.hypot(e.clientX - lastClient.x, e.clientY - lastClient.y) / dt;
    peakSpeed = Math.max(peakSpeed, speed);
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = now;

    const inten = Math.min(1, speed / 2.5);
    sfx.tearMove(inten);
    particles.emit(e.clientX, e.clientY, { count: 1 + Math.round(inten * 4), speed: 2 + inten * 5, colors: FOIL, life: 36 });
    if (navigator.vibrate && inten > 0.5) navigator.vibrate(4);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (crossed) {
      opened = true;
      spring.set({ w: GAP_OPEN }); // tear crossed → yawn fully open
      sfx.tearEnd(true, Math.min(1, 0.6 + peakSpeed / 4));
      if (navigator.vibrate) navigator.vibrate([18, 30, 14]);
      burstAlongTear();
    } else {
      sfx.tearEnd(false);
      spring.set({ w: 0 }); // didn't cross — the gap eases shut into one piece
      setTimeout(() => {
        if (!dragging && !opened) clearTear();
      }, 420);
    }
  }

  function burstAlongTear() {
    const m = svg.getScreenCTM();
    for (const p of tearPath || []) {
      const c = new DOMPoint(p.x, p.y).matrixTransform(m);
      particles.emit(c.x, c.y, { count: 3, speed: 4.5, colors: FOIL, life: 50, size: 2.6 });
    }
  }

  // Tap an opened pack: the gap eases shut (the pack is whole again), then reset.
  function reset() {
    opened = false;
    spring.set({ w: 0 });
    setTimeout(clearTear, 380);
  }

  function clearTear() {
    tearing = false;
    crossed = false;
    tearPath = null;
    path = [];
    spring.reset();
    gap.setAttribute("points", "");
    tearEdge.setAttribute("points", "");
  }

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
  svg.addEventListener("contextmenu", (e) => e.preventDefault());

  return { reset };
}

// ---- geometry helpers -----------------------------------------------------

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
function unit(v) {
  const L = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / L, y: v.y / L };
}

function pathLen(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]);
  return n;
}

const nearBorder = (p) => p.x < CROSS_MARGIN || p.x > VB.w - CROSS_MARGIN || p.y < CROSS_MARGIN || p.y > VB.h - CROSS_MARGIN;

function snapBorder(p) {
  const d = [p.y, VB.w - p.x, VB.h - p.y, p.x]; // top, right, bottom, left
  const e = d.indexOf(Math.min(...d));
  if (e === 0) return { x: p.x, y: 0 };
  if (e === 1) return { x: VB.w, y: p.y };
  if (e === 2) return { x: p.x, y: VB.h };
  return { x: 0, y: p.y };
}

// roughen the traced path with small perpendicular jitter (torn, not smooth);
// endpoints stay put so the anchor/tip land cleanly
function jitter(pts) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const n = unit({ x: -(pts[i + 1].y - pts[i - 1].y), y: pts[i + 1].x - pts[i - 1].x });
    const j = (Math.abs((Math.sin(i * 51.3) * 7919) % 1) - 0.5) * 5; // ±2.5, stable per index
    out.push({ x: pts[i].x + n.x * j, y: pts[i].y + n.y * j });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// first border the ray (p, dir) hits, clamped onto the pack rect
function toBorder(p, d) {
  let best = Infinity;
  let hit = null;
  const ts = [];
  if (Math.abs(d.x) > 1e-6) ts.push((0 - p.x) / d.x, (VB.w - p.x) / d.x);
  if (Math.abs(d.y) > 1e-6) ts.push((0 - p.y) / d.y, (VB.h - p.y) / d.y);
  for (const t of ts) {
    if (t <= 0 || t >= best) continue;
    const x = p.x + d.x * t;
    const y = p.y + d.y * t;
    if (x >= -0.5 && x <= VB.w + 0.5 && y >= -0.5 && y <= VB.h + 0.5) {
      best = t;
      hit = { x: Math.max(0, Math.min(VB.w, x)), y: Math.max(0, Math.min(VB.h, y)) };
    }
  }
  return hit || { x: Math.max(0, Math.min(VB.w, p.x)), y: Math.max(0, Math.min(VB.h, p.y)) };
}

// Build the gap polygon: a ribbon along `pts`, half-width `maxW/2`, that pinches
// to a point at the tip (last point) unless the tear has crossed (then it runs
// full-width edge to edge). The anchor end (first point) is always full-width.
function ribbon(pts, maxW, crossed) {
  if (pts.length < 2 || maxW <= 0.5) return null;
  const n = pts.length - 1;
  const left = [];
  const right = [];
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n, i + 1)];
    const nrm = unit({ x: -(b.y - a.y), y: b.x - a.x });
    const taper = crossed || i < n * 0.7 ? 1 : Math.max(0, 1 - (i - n * 0.7) / (n * 0.3 || 1));
    const jit = (Math.abs((Math.sin(i * 33.7) * 5417) % 1) - 0.5) * 5 * taper;
    const hw = (maxW / 2) * taper + jit;
    left.push({ x: pts[i].x + nrm.x * hw, y: pts[i].y + nrm.y * hw });
    right.push({ x: pts[i].x - nrm.x * hw, y: pts[i].y - nrm.y * hw });
  }
  return left.concat(right.reverse());
}

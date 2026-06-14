// pack.js — SLASH-TO-TEAR prototype (no click-to-open).
//
// Drag across the sealed pack and a jagged gap rips along your finger's path in
// real time: the tear TIP springs toward your finger (force latency — finger
// leads, paper resists, then catches up), the gap edge is jittered with noise so
// it splits unevenly, foil flecks spray, and a noise-burst rip sound + haptic
// scale with your slash speed. A confident slash commits (the gap yawns open and
// reveals the interior); a weak one creases and springs shut.
//
// Reuses the shared spring (motion.js), particles (particles.js), and Web Audio
// (sfx.js). The card stack/reveal will mount inside the revealed interior next.

import { createSpring } from "./motion.js";
import { createParticles } from "./particles.js";
import * as sfx from "./sfx.js";

const VB = { w: 300, h: 420 }; // pack viewBox (≈ 63:88 card-pack proportions)
const MAX_GAP = 26; // SVG units the gap opens to when fully torn (a slit, not a chasm)
const CRACK = 0.35; // gap fraction held open while you're mid-slash
const MIN_TEAR = 150; // slash length (SVG units) needed to commit the tear
const SPEED_COMMIT = 2.2; // …or a fast enough peak slash speed commits it too

const FOIL = ["#ff5d8f", "#ffd24a", "#5fcf8e", "#3fd6c8", "#6ea8fe", "#b072e6"];

export function createPack({ mountEl }) {
  mountEl.innerHTML = `
    <svg class="pack" viewBox="0 0 ${VB.w} ${VB.h}" aria-label="Sealed pack — slash to open">
      <defs>
        <linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff5d8f"/><stop offset=".2" stop-color="#ffd24a"/>
          <stop offset=".45" stop-color="#5fcf8e"/><stop offset=".65" stop-color="#3fd6c8"/>
          <stop offset=".82" stop-color="#6ea8fe"/><stop offset="1" stop-color="#b072e6"/>
        </linearGradient>
        <mask id="tearmask">
          <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="#fff"/>
          <polygon class="tear-hole" points="" fill="#000"/>
        </mask>
      </defs>

      <rect x="6" y="6" width="${VB.w - 12}" height="${VB.h - 12}" rx="12" fill="#04060a"/>
      <rect x="34" y="30" width="${VB.w - 68}" height="${VB.h - 60}" rx="8" fill="#0f1420"/>

      <g mask="url(#tearmask)">
        <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="url(#foil)"/>
        <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="#0b0d12" opacity=".30"/>
        <rect x="0" y="0" width="${VB.w}" height="22" fill="#fff" opacity=".10"/>
        <rect x="0" y="${VB.h - 22}" width="${VB.w}" height="22" fill="#fff" opacity=".10"/>
        <text x="${VB.w / 2}" y="196" text-anchor="middle" class="pack-logo">OPENPACK</text>
        <text x="${VB.w / 2}" y="224" text-anchor="middle" class="pack-sub">SLASH TO OPEN</text>
      </g>

      <polygon class="tear-edge" points="" fill="none" stroke="#e4e1d8" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>
    <canvas class="pack-fx"></canvas>`;

  const svg = mountEl.querySelector(".pack");
  const hole = mountEl.querySelector(".tear-hole");
  const edge = mountEl.querySelector(".tear-edge");
  const canvas = mountEl.querySelector(".pack-fx");
  const particles = createParticles(canvas);

  // ---- the tear, driven by the shared spring -----------------------------
  // `tip` = how far (path length) the rip has propagated; `open` = gap width
  // fraction. Both lag their targets → the paper resists, then catches up.
  let path = []; // slash points in SVG space
  let dragging = false;
  let lastClient = null;
  let lastT = 0;
  let peakSpeed = 0;
  let opened = false;

  const spring = createSpring({
    rest: { tip: 0, open: 0 },
    stiffness: 0.18,
    damping: 0.7,
    stiffnessByKey: { tip: 0.28 }, // the tip catches up a bit faster than the gap yawns
    onTick: (c) => draw(c.tip, c.open),
  });

  function draw(tip, open) {
    const rb = ribbon(path, tip, open * MAX_GAP);
    const pts = rb ? rb.poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";
    hole.setAttribute("points", pts);
    edge.setAttribute("points", open > 0.02 ? pts : "");
  }

  function toSvg(e) {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: q.y };
  }

  function onDown(e) {
    if (opened) return reset();
    dragging = true;
    path = [toSvg(e)];
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = performance.now();
    peakSpeed = 0;
    svg.setPointerCapture?.(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;
    const p = toSvg(e);
    if (dist(p, path[path.length - 1]) < 4) return; // downsample
    path.push(p);

    // slash speed (screen px / ms) → flecks, sound, haptic intensity
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    const speed = Math.hypot(e.clientX - lastClient.x, e.clientY - lastClient.y) / dt;
    peakSpeed = Math.max(peakSpeed, speed);
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = now;

    spring.set({ tip: pathLen(path), open: Math.max(spring.target.open, CRACK) });

    const inten = Math.min(1, speed / 2.5);
    particles.emit(e.clientX, e.clientY, {
      count: 1 + Math.round(inten * 4),
      speed: 2 + inten * 5,
      colors: FOIL,
      life: 36,
    });
    sfx.scratch(inten);
    if (navigator.vibrate && inten > 0.5) navigator.vibrate(4);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    const committed = pathLen(path) > MIN_TEAR || peakSpeed > SPEED_COMMIT;
    if (committed) {
      opened = true;
      spring.set({ tip: pathLen(path), open: 1 });
      sfx.rip(Math.min(1, 0.55 + peakSpeed / 4));
      if (navigator.vibrate) navigator.vibrate([18, 30, 12]);
      burstAlongPath();
    } else {
      spring.set({ open: 0 }); // crease springs shut
      setTimeout(() => {
        if (!dragging && !opened) {
          path = [];
          spring.reset();
        }
      }, 360);
    }
  }

  function burstAlongPath() {
    const m = svg.getScreenCTM();
    for (let i = 0; i < path.length; i += 2) {
      const c = path[i].x !== undefined ? new DOMPoint(path[i].x, path[i].y).matrixTransform(m) : null;
      if (c) particles.emit(c.x, c.y, { count: 5, speed: 5, colors: FOIL, life: 50, size: 2.8 });
    }
  }

  function reset() {
    opened = false;
    path = [];
    spring.reset();
  }

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
  svg.addEventListener("contextmenu", (e) => e.preventDefault());

  return { reset };
}

// ---- geometry helpers -----------------------------------------------------

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLen(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]);
  return n;
}

// Build a jagged ribbon polygon along `pts` up to `uptoLen`, half-width from
// `gap`, with per-point noise so the torn edge ripples unevenly.
function ribbon(pts, uptoLen, gap) {
  if (pts.length < 2 || gap <= 0.5 || uptoLen <= 1) return null;

  const used = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (acc + seg >= uptoLen) {
      const t = (uptoLen - acc) / seg;
      used.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t });
      break;
    }
    acc += seg;
    used.push(pts[i]);
  }
  if (used.length < 2) return null;

  const left = [];
  const right = [];
  for (let i = 0; i < used.length; i++) {
    const a = used[Math.max(0, i - 1)];
    const b = used[Math.min(used.length - 1, i + 1)];
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const L = Math.hypot(nx, ny) || 1;
    nx /= L;
    ny /= L;
    const jitter = (Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1) - 0.5) * 6; // ±3 units, jagged
    const hw = gap / 2 + jitter; // constant-width strip with a jittered (torn) edge
    left.push({ x: used[i].x + nx * hw, y: used[i].y + ny * hw });
    right.push({ x: used[i].x - nx * hw, y: used[i].y - ny * hw });
  }
  return { poly: left.concat(right.reverse()) };
}

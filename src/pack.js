// pack.js — TEAR-OPEN prototype (no click-to-open).
//
// Drag across the sealed foil pack and it tears along the line your finger
// actually traces (not a straight slash): the path is extended to the pack's
// edges so it always splits cleanly into two complementary halves, which pull
// apart along the tear, revealing the interior. The separation springs behind
// your finger (force latency), the cut is jittered for a rough torn edge, foil
// flecks spray, and a sustained foil-rip sound + haptic track your pull. A
// confident tear commits; a weak one lets the halves slide back into one piece.
//
// Reuses the shared spring (motion.js), particles (particles.js), and Web Audio
// (sfx.js). The card stack/reveal will mount in the revealed interior next.

import { createSpring } from "./motion.js";
import { createParticles } from "./particles.js";
import * as sfx from "./sfx.js";

const VB = { w: 300, h: 420 }; // pack viewBox (≈ booster-pack proportions)
const SEP_MAX = 84; // SVG units each half pulls apart when fully torn
const START_DIST = 12; // finger travel before the tear engages
const MIN_TEAR = 120; // tear length to commit…
const SPEED_COMMIT = 2.0; // …or a fast enough peak pull speed
const FOIL = ["#ff5d8f", "#ffd24a", "#5fcf8e", "#3fd6c8", "#6ea8fe", "#b072e6"];
const RECT = [{ x: 0, y: 0 }, { x: VB.w, y: 0 }, { x: VB.w, y: VB.h }, { x: 0, y: VB.h }];
const CORNERS = [
  { s: 0, x: 0, y: 0 },
  { s: 1, x: VB.w, y: 0 },
  { s: 2, x: VB.w, y: VB.h },
  { s: 3, x: 0, y: VB.h },
];

export function createPack({ mountEl }) {
  mountEl.innerHTML = `
    <svg class="pack" viewBox="0 0 ${VB.w} ${VB.h}" aria-label="Sealed pack — tear it open">
      <defs>
        <linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff5d8f"/><stop offset=".2" stop-color="#ffd24a"/>
          <stop offset=".45" stop-color="#5fcf8e"/><stop offset=".65" stop-color="#3fd6c8"/>
          <stop offset=".82" stop-color="#6ea8fe"/><stop offset="1" stop-color="#b072e6"/>
        </linearGradient>
        <g id="art">
          <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="url(#foil)"/>
          <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="#0b0d12" opacity=".30"/>
          <rect x="0" y="0" width="${VB.w}" height="22" fill="#fff" opacity=".10"/>
          <rect x="0" y="${VB.h - 22}" width="${VB.w}" height="22" fill="#fff" opacity=".10"/>
          <text x="${VB.w / 2}" y="196" text-anchor="middle" class="pack-logo">OPENPACK</text>
          <text x="${VB.w / 2}" y="224" text-anchor="middle" class="pack-sub">TEAR TO OPEN</text>
        </g>
        <clipPath id="clipA"><polygon points="0,0 ${VB.w},0 ${VB.w},${VB.h} 0,${VB.h}"/></clipPath>
        <clipPath id="clipB"><polygon points=""/></clipPath>
      </defs>

      <rect x="6" y="6" width="${VB.w - 12}" height="${VB.h - 12}" rx="12" fill="#05070b"/>

      <g class="half half-a">
        <use href="#art" clip-path="url(#clipA)"/>
        <polyline class="edge edge-a" points="" fill="none" stroke="#e4e1d8" stroke-width="1.4" stroke-linejoin="round"/>
      </g>
      <g class="half half-b">
        <use href="#art" clip-path="url(#clipB)"/>
        <polyline class="edge edge-b" points="" fill="none" stroke="#e4e1d8" stroke-width="1.4" stroke-linejoin="round"/>
      </g>
    </svg>
    <canvas class="pack-fx"></canvas>`;

  const svg = mountEl.querySelector(".pack");
  const clipPolyA = mountEl.querySelector("#clipA polygon");
  const clipPolyB = mountEl.querySelector("#clipB polygon");
  const edgeA = mountEl.querySelector(".edge-a");
  const edgeB = mountEl.querySelector(".edge-b");
  const halfA = mountEl.querySelector(".half-a");
  const halfB = mountEl.querySelector(".half-b");
  const particles = createParticles(mountEl.querySelector(".pack-fx"));

  let path = []; // finger points (SVG space)
  let dragging = false;
  let tearing = false; // past the engage threshold?
  let opened = false;
  let dirA = { x: 1, y: 0 }; // each half's pull-apart direction (set by buildCut)
  let dirB = { x: -1, y: 0 };
  let lastClient = null;
  let lastT = 0;
  let peakSpeed = 0;

  const spring = createSpring({
    rest: { sep: 0 },
    stiffness: 0.16,
    damping: 0.72,
    onTick: (c) => {
      if (!tearing) return;
      const d = c.sep * SEP_MAX;
      halfA.setAttribute("transform", `translate(${(dirA.x * d).toFixed(2)} ${(dirA.y * d).toFixed(2)})`);
      halfB.setAttribute("transform", `translate(${(dirB.x * d).toFixed(2)} ${(dirB.y * d).toFixed(2)})`);
    },
  });

  function toSvg(e) {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: q.y };
  }

  // Rebuild the cut from the finger path: jitter it (rough torn edge), extend
  // both ends to the pack border so it spans edge-to-edge, then split the pack
  // into the two complementary half-plane polygons either side of that line.
  function buildCut() {
    if (path.length < 2) return;
    const raw = jitter(path);
    const Pin = toBorder(raw[0], unit(sub(raw[0], raw[1]))); // extend backward
    const Pout = toBorder(raw[raw.length - 1], unit(sub(raw[raw.length - 1], raw[raw.length - 2]))); // forward
    const full = [Pin, ...raw, Pout];
    const sIn = perim(Pin);
    const sOut = perim(Pout);

    const A = [...full, ...cwCorners(sOut, sIn)];
    const B = [...full, ...cwCorners(sIn, sOut).reverse()];
    setPoints(clipPolyA, A);
    setPoints(clipPolyB, B);
    setPoints(edgeA, full);
    setPoints(edgeB, full);

    const mid = { x: (Pin.x + Pout.x) / 2, y: (Pin.y + Pout.y) / 2 };
    dirA = unit(sub(centroid(A), mid)); // each half pulls away from the cut centre
    dirB = unit(sub(centroid(B), mid));
  }

  function onDown(e) {
    if (opened) return reset();
    dragging = true;
    tearing = false;
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

    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    const speed = Math.hypot(e.clientX - lastClient.x, e.clientY - lastClient.y) / dt;
    peakSpeed = Math.max(peakSpeed, speed);
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = now;

    if (tearing) {
      buildCut(); // the cut follows the finger
      spring.set({ sep: Math.min(0.8, pathLen(path) / (VB.h * 0.7)) });
      const inten = Math.min(1, speed / 2.5);
      sfx.tearMove(inten);
      particles.emit(e.clientX, e.clientY, { count: 1 + Math.round(inten * 4), speed: 2 + inten * 5, colors: FOIL, life: 36 });
      if (navigator.vibrate && inten > 0.5) navigator.vibrate(4);
    }
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (tearing && (pathLen(path) > MIN_TEAR || peakSpeed > SPEED_COMMIT)) {
      opened = true;
      buildCut();
      spring.set({ sep: 1 }); // halves pull fully apart
      sfx.tearEnd(true, Math.min(1, 0.6 + peakSpeed / 4));
      if (navigator.vibrate) navigator.vibrate([18, 30, 14]);
      burstAlongCut();
    } else {
      sfx.tearEnd(false);
      spring.set({ sep: 0 }); // not enough — the two halves slide back into one piece
      setTimeout(() => {
        if (!dragging && !opened) clearTear();
      }, 420);
    }
  }

  function burstAlongCut() {
    const pts = (edgeA.getAttribute("points") || "").split(" ");
    const m = svg.getScreenCTM();
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = pts[i].split(",").map(Number);
      if (Number.isNaN(x)) continue;
      const c = new DOMPoint(x, y).matrixTransform(m);
      particles.emit(c.x, c.y, { count: 5, speed: 5, colors: FOIL, life: 52, size: 2.8 });
    }
  }

  // Tap an opened pack: slide the halves back together (they fit exactly into
  // one piece) then clear to a fresh sealed pack.
  function reset() {
    opened = false;
    if (tearing) spring.set({ sep: 0 });
    setTimeout(clearTear, 380);
  }

  function clearTear() {
    tearing = false;
    path = [];
    spring.reset();
    halfA.removeAttribute("transform");
    halfB.removeAttribute("transform");
    setPoints(clipPolyA, RECT);
    clipPolyB.setAttribute("points", "");
    edgeA.setAttribute("points", "");
    edgeB.setAttribute("points", "");
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

function setPoints(el, pts) {
  el.setAttribute("points", pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
}

function centroid(poly) {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

// roughen the traced path with a little perpendicular jitter (torn, not smooth)
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

// perimeter parameter s ∈ [0,4): top 0–1, right 1–2, bottom 2–3, left 3–4
function perim(pt) {
  const d = [pt.y, VB.w - pt.x, VB.h - pt.y, pt.x]; // dist to top, right, bottom, left
  const e = d.indexOf(Math.min(...d));
  if (e === 0) return pt.x / VB.w;
  if (e === 1) return 1 + pt.y / VB.h;
  if (e === 2) return 2 + (VB.w - pt.x) / VB.w;
  return 3 + (VB.h - pt.y) / VB.h;
}

// corners strictly between s=a and s=b going clockwise (increasing s, mod 4)
function cwCorners(a, b) {
  const span = ((b - a) % 4 + 4) % 4;
  return CORNERS.map((c) => ({ c, d: ((c.s - a) % 4 + 4) % 4 }))
    .filter((o) => o.d > 1e-4 && o.d < span - 1e-4)
    .sort((x, y) => x.d - y.d)
    .map((o) => o.c);
}

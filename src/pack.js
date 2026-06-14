// pack.js — SLASH-TO-TEAR prototype (no click-to-open).
//
// Drag across the sealed foil pack: the first movement locks a jagged cut along
// your slash, then the pack SPLITS into two halves that pull APART along the cut
// (revealing the interior between them) — so it reads as tearing, not drawing a
// line. The separation springs behind your finger (force latency), foil flecks
// spray, and a velocity-scaled rip sound + haptic fire. A confident slash commits
// (halves fly open); a weak one rejoins.
//
// Reuses the shared spring (motion.js), particles (particles.js), and Web Audio
// (sfx.js). The card stack/reveal will mount in the revealed interior next.

import { createSpring } from "./motion.js";
import { createParticles } from "./particles.js";
import * as sfx from "./sfx.js";

const VB = { w: 300, h: 420 }; // pack viewBox (≈ booster-pack proportions)
const SEP_MAX = 92; // SVG units each half slides apart when fully torn
const LOCK_DIST = 10; // slash travel (SVG units) before the cut direction locks
const MIN_TEAR = 120; // slash length to commit the tear…
const SPEED_COMMIT = 2.0; // …or a fast enough peak slash speed
const BIG = 2000; // far enough to cover the pack when building half-plane clips
const FOIL = ["#ff5d8f", "#ffd24a", "#5fcf8e", "#3fd6c8", "#6ea8fe", "#b072e6"];
const RECT = `0,0 ${VB.w},0 ${VB.w},${VB.h} 0,${VB.h}`; // whole pack (rest clip)

export function createPack({ mountEl }) {
  mountEl.innerHTML = `
    <svg class="pack" viewBox="0 0 ${VB.w} ${VB.h}" aria-label="Sealed pack — slash to open">
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
          <text x="${VB.w / 2}" y="224" text-anchor="middle" class="pack-sub">SLASH TO OPEN</text>
        </g>
        <clipPath id="clipA"><polygon points="${RECT}"/></clipPath>
        <clipPath id="clipB"><polygon points=""/></clipPath>
      </defs>

      <rect x="6" y="6" width="${VB.w - 12}" height="${VB.h - 12}" rx="12" fill="#04060a"/>
      <rect x="40" y="34" width="${VB.w - 80}" height="${VB.h - 68}" rx="8" fill="#0f1420"/>

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

  let path = []; // slash points in SVG space
  let dragging = false;
  let locked = false; // cut direction fixed?
  let opened = false;
  let nrm = { x: 1, y: 0 }; // unit normal to the cut (the part direction)
  let span = VB.h; // length of the locked cut
  let lastClient = null;
  let lastT = 0;
  let peakSpeed = 0;

  // The shared spring eases `sep` (0→1); each tick slides the two halves apart.
  const spring = createSpring({
    rest: { sep: 0 },
    stiffness: 0.16,
    damping: 0.72,
    onTick: (c) => {
      if (!locked) return;
      const d = c.sep * SEP_MAX;
      halfA.setAttribute("transform", `translate(${(nrm.x * d).toFixed(2)} ${(nrm.y * d).toFixed(2)})`);
      halfB.setAttribute("transform", `translate(${(-nrm.x * d).toFixed(2)} ${(-nrm.y * d).toFixed(2)})`);
    },
  });

  function toSvg(e) {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: q.y };
  }

  // Lock the cut: a jagged line through the slash, edge to edge of the pack,
  // splitting it into two half-plane clips that the halves will pull apart along.
  function lockCut() {
    const s = path[0];
    const e = path[path.length - 1];
    let dx = e.x - s.x;
    let dy = e.y - s.y;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    nrm = { x: -dy, y: dx };
    const [E0, E1] = edgeHits(s, { x: dx, y: dy });
    span = dist(E0, E1);

    const J = jagged(E0, E1);
    setPoints(edgeA, J);
    setPoints(edgeB, J);
    setPoints(clipPolyA, [...J, addN(E1, BIG), addN(E0, BIG)]); // +normal half
    setPoints(clipPolyB, [...J, addN(E1, -BIG), addN(E0, -BIG)]); // −normal half
    locked = true;
  }

  function jagged(a, b) {
    const K = 16;
    const out = [];
    for (let i = 0; i <= K; i++) {
      const t = i / K;
      const edge = i === 0 || i === K ? 0 : 1; // keep the ends pinned to the border
      const j = (Math.abs((Math.sin(i * 91.7) * 9999) % 1) - 0.5) * 11 * edge; // ±~5
      out.push({ x: a.x + (b.x - a.x) * t + nrm.x * j, y: a.y + (b.y - a.y) * t + nrm.y * j });
    }
    return out;
  }

  const addN = (p, s) => ({ x: p.x + nrm.x * s, y: p.y + nrm.y * s });

  function onDown(e) {
    if (opened) return reset();
    dragging = true;
    locked = false;
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

    if (!locked && pathLen(path) > LOCK_DIST) {
      lockCut();
      sfx.rip(0.18); // soft crinkle as the tear begins
    }

    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    const speed = Math.hypot(e.clientX - lastClient.x, e.clientY - lastClient.y) / dt;
    peakSpeed = Math.max(peakSpeed, speed);
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = now;

    if (locked) spring.set({ sep: Math.min(0.85, pathLen(path) / span) }); // pull apart as you slash

    const inten = Math.min(1, speed / 2.5);
    particles.emit(e.clientX, e.clientY, { count: 1 + Math.round(inten * 4), speed: 2 + inten * 5, colors: FOIL, life: 36 });
    if (navigator.vibrate && inten > 0.5) navigator.vibrate(4);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (locked && (pathLen(path) > MIN_TEAR || peakSpeed > SPEED_COMMIT)) {
      opened = true;
      spring.set({ sep: 1 }); // halves fly fully apart
      sfx.rip(Math.min(1, 0.6 + peakSpeed / 4));
      if (navigator.vibrate) navigator.vibrate([18, 30, 14]);
      burstAlongCut();
    } else {
      spring.set({ sep: 0 }); // not enough — halves rejoin
      setTimeout(() => {
        if (!dragging && !opened) reset();
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

  function reset() {
    opened = false;
    locked = false;
    path = [];
    spring.reset();
    halfA.removeAttribute("transform");
    halfB.removeAttribute("transform");
    setPoints(clipPolyA, RECT.split(" ").map((s) => ({ x: +s.split(",")[0], y: +s.split(",")[1] })));
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

function pathLen(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]);
  return n;
}

function setPoints(el, pts) {
  el.setAttribute("points", pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
}

// The two points where the cut line (through p, direction d) crosses the pack border.
function edgeHits(p, d) {
  const ts = [];
  if (Math.abs(d.x) > 1e-6) ts.push((0 - p.x) / d.x, (VB.w - p.x) / d.x);
  if (Math.abs(d.y) > 1e-6) ts.push((0 - p.y) / d.y, (VB.h - p.y) / d.y);
  const hits = ts
    .map((t) => ({ t, x: p.x + d.x * t, y: p.y + d.y * t }))
    .filter((q) => q.x >= -0.5 && q.x <= VB.w + 0.5 && q.y >= -0.5 && q.y <= VB.h + 0.5)
    .sort((a, b) => a.t - b.t);
  return [hits[0], hits[hits.length - 1]];
}

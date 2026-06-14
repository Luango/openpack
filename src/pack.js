// pack.js — TEAR-OPEN prototype (no click-to-open).
//
// Two stages, so it tears like real paper:
//   1. WHILE tearing — the pack is still ONE piece. A gap opens from the start
//      edge along your traced path and PINCHES SHUT at your fingertip, staying
//      joined ahead of the tear front (no premature split).
//   2. WHEN the tear crosses to the far edge — the pack splits into TWO
//      complementary pieces (each side of the same jagged tear line) that pull
//      apart, revealing the interior. They fit back into one pack (recombine).
//
// Stop short and the gap eases shut into one piece. The tear follows your finger
// (jittered for rough torn paper), foil flecks spray, and a sustained foil-rip
// sound + haptic track your pull.
//
// Reuses the shared spring (motion.js), particles (particles.js), Web Audio
// (sfx.js). The card stack/reveal will mount in the revealed interior next.

import { createSpring } from "./motion.js";
import { createParticles } from "./particles.js";
import * as sfx from "./sfx.js";

const VB = { w: 300, h: 420 };
const GAP_TEAR = 40; // gap width while mid-tear
const SEP_MAX = 130; // how far the smaller half flies off once split (the body stays put)
const ROT = 18; // degrees the flying half tilts/flings as it tears away — dynamic motion
const START_DIST = 12; // finger travel before the tear engages
const START_MARGIN = 46; // a press must begin within this margin of the pack to start a tear
const EDGE_BAND = 42; // …and within this thin edge band to TEAR; the whole center only scratches
const CROSS_MARGIN = 12; // how near the far edge counts as "crossed"
const CROSS_MIN = 90; // …and a minimum tear length, so starting near an edge doesn't count
const FOIL = ["#ff5d8f", "#ffd24a", "#5fcf8e", "#3fd6c8", "#6ea8fe", "#b072e6"];
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
        <mask id="tearmask">
          <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="#fff"/>
          <polygon class="gap" points="" fill="#000"/>
        </mask>
        <clipPath id="clipA"><polygon points=""/></clipPath>
        <clipPath id="clipB"><polygon points=""/></clipPath>
      </defs>

      <rect x="6" y="6" width="${VB.w - 12}" height="${VB.h - 12}" rx="12" fill="#05070b"/>

      <g class="sealed" mask="url(#tearmask)"><use href="#art"/></g>
      <polygon class="tear-edge" points="" fill="none" stroke="#e4e1d8" stroke-width="1.5" stroke-linejoin="round"/>

      <g class="piece piece-a" style="display:none">
        <use href="#art" clip-path="url(#clipA)"/>
        <polyline class="edge edge-a" points="" fill="none" stroke="#e4e1d8" stroke-width="1.5" stroke-linejoin="round"/>
      </g>
      <g class="piece piece-b" style="display:none">
        <use href="#art" clip-path="url(#clipB)"/>
        <polyline class="edge edge-b" points="" fill="none" stroke="#e4e1d8" stroke-width="1.5" stroke-linejoin="round"/>
      </g>
    </svg>
    <canvas class="pack-fx"></canvas>`;

  const svg = mountEl.querySelector(".pack");
  const sealed = mountEl.querySelector(".sealed");
  const gap = mountEl.querySelector(".gap");
  const tearEdge = mountEl.querySelector(".tear-edge");
  const clipPolyA = mountEl.querySelector("#clipA polygon");
  const clipPolyB = mountEl.querySelector("#clipB polygon");
  const pieceA = mountEl.querySelector(".piece-a");
  const pieceB = mountEl.querySelector(".piece-b");
  const edgeA = mountEl.querySelector(".edge-a");
  const edgeB = mountEl.querySelector(".edge-b");
  const particles = createParticles(mountEl.querySelector(".pack-fx"));

  let path = [];
  let tearPath = null;
  let dragging = false;
  let tearing = false;
  let crossed = false;
  let split = false; // promoted to two pieces?
  let opened = false;
  let dirA = { x: 1, y: 0 };
  let dirB = { x: -1, y: 0 };
  let mid = { x: VB.w / 2, y: VB.h / 2 }; // pivot the flying half tilts around
  let moverEl = null; // the SMALLER half (flies off); the larger body stays put
  let stayEl = null;
  let scratchOnly = false; // started in the middle (not near an edge) → just scuff the foil
  let moverDir = { x: 0, y: -1 };
  let lastClient = null;
  let lastT = 0;
  let peakSpeed = 0;

  // `w` = gap width while tearing; `sep` = how far the two pieces have parted.
  const spring = createSpring({
    rest: { w: 0, sep: 0 },
    stiffness: 0.18,
    damping: 0.7,
    onTick: (c) => {
      if (split) {
        // only the top piece moves — it tilts/flings as it tears away; the
        // bottom piece is left untransformed (anchored in place)
        const d = c.sep * SEP_MAX;
        const a = c.sep * ROT;
        moverEl?.setAttribute("transform", `rotate(${a.toFixed(2)} ${mid.x.toFixed(1)} ${mid.y.toFixed(1)}) translate(${(moverDir.x * d).toFixed(2)} ${(moverDir.y * d).toFixed(2)})`);
      } else if (tearPath) {
        const poly = ribbon(tearPath, c.w);
        const pts = poly ? poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";
        gap.setAttribute("points", pts);
        tearEdge.setAttribute("points", c.w > 1 ? pts : "");
      }
    },
  });

  // pointer → pack coords, clamped onto the pack rect so a tear can START just
  // outside the edge and still anchor cleanly where it crosses in
  function toSvg(e) {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(0, Math.min(VB.w, q.x)), y: Math.max(0, Math.min(VB.h, q.y)) };
  }

  // While tearing: build the open gap path (anchor edge → finger), pinched at tip.
  function rebuildGap() {
    const raw = jitter(path);
    const anchor = toBorder(raw[0], unit(sub(raw[0], raw[1])));
    const tip = raw[raw.length - 1];
    crossed = nearBorder(tip) && pathLen(path) > CROSS_MIN;
    tearPath = [anchor, ...raw];
  }

  // On cross: split into two complementary pieces clipped to each side of the
  // full edge-to-edge tear line.
  function makePieces() {
    const raw = jitter(path);
    const Pin = toBorder(raw[0], unit(sub(raw[0], raw[1])));
    const Pout = snapBorder(raw[raw.length - 1]);
    const full = [Pin, ...raw, Pout];
    const sIn = perim(Pin);
    const sOut = perim(Pout);

    const A = [...full, ...cwCorners(sOut, sIn)]; // one side + its border corners
    const B = [...full, ...cwCorners(sIn, sOut).reverse()]; // the other side
    setPoints(clipPolyA, A);
    setPoints(clipPolyB, B);
    setPoints(edgeA, full);
    setPoints(edgeB, full);

    // part the two pieces straight apart, perpendicular to the tear (opposite
    // directions), with A on whichever side its bulk sits
    mid = { x: (Pin.x + Pout.x) / 2, y: (Pin.y + Pout.y) / 2 };
    const chord = unit(sub(Pout, Pin));
    const nrm = { x: -chord.y, y: chord.x };
    const cA = sub(centroid(A), mid);
    const side = cA.x * nrm.x + cA.y * nrm.y >= 0 ? 1 : -1;
    dirA = { x: nrm.x * side, y: nrm.y * side };
    dirB = { x: -dirA.x, y: -dirA.y };

    // the SMALLER half tears off (the body keeps the cards); whichever side that
    // is, the opening — and the cards — come from there
    const aIsSmaller = Math.abs(area(A)) < Math.abs(area(B));
    moverEl = aIsSmaller ? pieceA : pieceB;
    stayEl = aIsSmaller ? pieceB : pieceA;
    moverDir = aIsSmaller ? dirA : dirB;
    stayEl.removeAttribute("transform");

    split = true;
    sealed.style.display = "none";
    tearEdge.style.display = "none";
    pieceA.style.display = "";
    pieceB.style.display = "";
  }

  function onDown(e) {
    if (opened) return reset();
    // only start a tear if the press begins near the pack (not anywhere on the stage)
    const r = svg.getBoundingClientRect();
    const M = START_MARGIN;
    if (e.clientX < r.left - M || e.clientX > r.right + M || e.clientY < r.top - M || e.clientY > r.bottom + M) return;

    // a tear must START at/near an edge; pressing in the middle of the pack only
    // scuffs the foil (the unclamped pack-space point tells us how deep inside it is)
    const q = svg.createSVGPoint();
    q.x = e.clientX;
    q.y = e.clientY;
    const s = q.matrixTransform(svg.getScreenCTM().inverse());
    const inside = s.x >= 0 && s.x <= VB.w && s.y >= 0 && s.y <= VB.h;
    scratchOnly = inside && Math.min(s.x, VB.w - s.x, s.y, VB.h - s.y) > EDGE_BAND;

    dragging = true;
    tearing = false;
    crossed = false;
    split = false;
    path = [toSvg(e)];
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = performance.now();
    peakSpeed = 0;
    mountEl.setPointerCapture?.(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;

    // started in the middle → just scuff the foil (scratch sfx + a little dust), no tear
    if (scratchOnly) {
      const now = performance.now();
      const speed = Math.hypot(e.clientX - lastClient.x, e.clientY - lastClient.y) / Math.max(1, now - lastT);
      lastClient = { x: e.clientX, y: e.clientY };
      lastT = now;
      const inten = Math.min(1, speed / 2.5);
      sfx.scratch(inten);
      if (inten > 0.4) particles.emit(e.clientX, e.clientY, { count: 1, speed: 1 + inten * 2, colors: FOIL, life: 22, size: 1.5 });
      return;
    }

    const p = toSvg(e);
    if (dist(p, path[path.length - 1]) < 3) return;
    path.push(p);

    if (!tearing && pathLen(path) > START_DIST) {
      tearing = true;
      sfx.tearStart();
    }
    if (!tearing) return;

    const progress = Math.min(1, pathLen(path) / (VB.h * 0.6));
    if (!split) {
      rebuildGap();
      if (crossed) {
        makePieces();
        spring.set({ sep: 0.55 }); // pieces visibly part the moment it crosses
      } else {
        spring.set({ w: progress * GAP_TEAR });
      }
    } else {
      spring.set({ sep: Math.min(1, 0.55 + progress * 0.4) });
    }

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
    if (scratchOnly) {
      scratchOnly = false; // just a scuff — nothing to open
      return;
    }
    if (split) {
      opened = true;
      spring.set({ sep: 1 }); // pieces pull fully apart
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
    for (const p of (edgeA.getAttribute("points") || "").split(" ")) {
      const [x, y] = p.split(",").map(Number);
      if (Number.isNaN(x)) continue;
      const c = new DOMPoint(x, y).matrixTransform(m);
      particles.emit(c.x, c.y, { count: 3, speed: 4.5, colors: FOIL, life: 50, size: 2.6 });
    }
  }

  // Tap an opened pack: the two pieces slide back together into one pack, then reset.
  function reset() {
    opened = false;
    if (split) spring.set({ sep: 0 });
    setTimeout(clearTear, 400);
  }

  function clearTear() {
    tearing = false;
    crossed = false;
    split = false;
    tearPath = null;
    path = [];
    spring.reset();
    sealed.style.display = "";
    tearEdge.style.display = "";
    pieceA.style.display = "none";
    pieceB.style.display = "none";
    pieceA.removeAttribute("transform");
    pieceB.removeAttribute("transform");
    gap.setAttribute("points", "");
    tearEdge.setAttribute("points", "");
  }

  // listen on the whole stage (not just the pack) so a tear can start from
  // outside the pack edge and drag across
  mountEl.addEventListener("pointerdown", onDown);
  mountEl.addEventListener("pointermove", onMove);
  mountEl.addEventListener("pointerup", onUp);
  mountEl.addEventListener("pointercancel", onUp);
  mountEl.addEventListener("contextmenu", (e) => e.preventDefault());

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

// signed polygon area (shoelace) — used to pick the smaller half to tear off
function area(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const nearBorder = (p) => p.x < CROSS_MARGIN || p.x > VB.w - CROSS_MARGIN || p.y < CROSS_MARGIN || p.y > VB.h - CROSS_MARGIN;

function snapBorder(p) {
  const d = [p.y, VB.w - p.x, VB.h - p.y, p.x];
  const e = d.indexOf(Math.min(...d));
  if (e === 0) return { x: p.x, y: 0 };
  if (e === 1) return { x: VB.w, y: p.y };
  if (e === 2) return { x: p.x, y: VB.h };
  return { x: 0, y: p.y };
}

function jitter(pts) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const n = unit({ x: -(pts[i + 1].y - pts[i - 1].y), y: pts[i + 1].x - pts[i - 1].x });
    const j = (Math.abs((Math.sin(i * 51.3) * 7919) % 1) - 0.5) * 5;
    out.push({ x: pts[i].x + n.x * j, y: pts[i].y + n.y * j });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

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
  const d = [pt.y, VB.w - pt.x, VB.h - pt.y, pt.x];
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

// Gap ribbon while tearing: half-width maxW/2 along the path, pinching to a point
// at the tip (last point); the anchor end stays full-width.
function ribbon(pts, maxW) {
  if (pts.length < 2 || maxW <= 0.5) return null;
  const n = pts.length - 1;
  const left = [];
  const right = [];
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n, i + 1)];
    const nrm = unit({ x: -(b.y - a.y), y: b.x - a.x });
    const taper = i < n * 0.7 ? 1 : Math.max(0, 1 - (i - n * 0.7) / (n * 0.3 || 1));
    const jit = (Math.abs((Math.sin(i * 33.7) * 5417) % 1) - 0.5) * 5 * taper;
    const hw = (maxW / 2) * taper + jit;
    left.push({ x: pts[i].x + nrm.x * hw, y: pts[i].y + nrm.y * hw });
    right.push({ x: pts[i].x - nrm.x * hw, y: pts[i].y - nrm.y * hw });
  }
  return left.concat(right.reverse());
}

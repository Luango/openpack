// pack.js — PEEL-OPEN prototype (no click-to-open).
//
// Drag across the top of the sealed pack to tear it. The lid (top strip above
// the tear) PEELS UP and CURLS BACK — a strip-chain "rig" (à la Spine): the flap
// is a chain of segments, each rotateX'd a little, and because they're nested in
// a preserve-3d context the rotations accumulate into a rolling curl. The peel
// tracks how far across you've torn, so the hinge effectively follows your
// finger; a confident tear all the way across commits (lid fully curled, cards
// revealed), a short one rolls back shut.
//
// Reuses the shared spring (motion.js), particles (particles.js), Web Audio
// (sfx.js). The card stack will mount in the revealed interior next.

import { createSpring } from "./motion.js";
import { createParticles } from "./particles.js";
import * as sfx from "./sfx.js";

const TEAR_FRAC = 0.27; // the lid is the top ~27% of the pack
const SEGS = 7; // strip-chain segments (the rig's "bones")
const MAX_SEG_ANGLE = 17; // deg each segment adds at full peel → cumulative curl ≈ 120°
const START_DIST = 0.06; // fraction of width before the tear engages
const CROSS_FRAC = 0.8; // how far across counts as a committed tear
const FOIL = ["#ff5d8f", "#ffd24a", "#5fcf8e", "#3fd6c8", "#6ea8fe", "#b072e6"];

export function createPack({ mountEl }) {
  mountEl.innerHTML = `
    <div class="pack3d">
      <div class="pk-interior"></div>
      <div class="pk-body"></div>
      <div class="pk-label"><div class="pk-logo">OPENPACK</div><div class="pk-sub">TEAR TO OPEN</div></div>
      <div class="pk-flap"></div>
    </div>
    <canvas class="pack-fx"></canvas>`;

  const pack = mountEl.querySelector(".pack3d");
  const body = mountEl.querySelector(".pk-body");
  const label = mountEl.querySelector(".pk-label");
  const flap = mountEl.querySelector(".pk-flap");
  const particles = createParticles(mountEl.querySelector(".pack-fx"));

  const W = pack.clientWidth;
  const H = pack.clientHeight;
  const tearY = Math.round(H * TEAR_FRAC);
  const segH = tearY / SEGS;

  // Body = pack below the tear (its slice of the foil), label sits on it.
  body.style.top = `${tearY}px`;
  body.style.height = `${H - tearY}px`;
  body.style.backgroundSize = `${W}px ${H}px`;
  body.style.backgroundPosition = `0 ${-tearY}px`;
  label.style.top = `${196 / 420 * H}px`;

  // Flap = the lid, built as a nested chain of segments hinged at the tear line.
  flap.style.height = `${tearY}px`;
  let parent = flap;
  for (let j = 0; j < SEGS; j++) {
    const seg = document.createElement("div");
    seg.className = "pk-seg";
    const origTop = tearY - (j + 1) * segH; // this segment's slice of the pack, in pack-y
    seg.style.height = `${segH}px`;
    seg.style.width = `${W}px`;
    seg.style.left = "0";
    seg.style.position = "absolute";
    seg.style.bottom = j === 0 ? "0" : "100%"; // j=0 at the hinge; others stack upward
    seg.style.backgroundSize = `${W}px ${H}px`;
    seg.style.backgroundPosition = `0 ${-origTop}px`;
    if (j === 0) seg.style.borderRadius = "0"; // top corners rounded only on the last seg
    if (j === SEGS - 1) seg.style.borderRadius = "16px 16px 0 0";
    parent.appendChild(seg);
    parent = seg; // nest → cumulative rotation
  }

  let dragging = false;
  let opened = false;
  let startX = 0;
  let lastClient = null;
  let lastT = 0;
  let peakSpeed = 0;
  let crossed = false;

  // `peel` 0→1 drives the curl: each tick sets one angle var that every nested
  // segment reads, so the chain rolls up cumulatively.
  const spring = createSpring({
    rest: { peel: 0 },
    stiffness: 0.16,
    damping: 0.72,
    onTick: (c) => {
      flap.style.setProperty("--a", `${(c.peel * MAX_SEG_ANGLE).toFixed(2)}deg`);
    },
  });

  const frac = (e) => (e.clientX - pack.getBoundingClientRect().left) / W;

  function onDown(e) {
    if (opened) return reset();
    dragging = true;
    crossed = false;
    startX = e.clientX;
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = performance.now();
    peakSpeed = 0;
    pack.setPointerCapture?.(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;
    const r = pack.getBoundingClientRect();
    // only the part of the drag that's across the top (within the lid band) tears
    if (e.clientY > r.top + tearY + 40) return;
    const progress = Math.min(1, Math.abs(e.clientX - startX) / (W * 0.9));
    if (progress < START_DIST) return;

    crossed = progress > CROSS_FRAC;
    spring.set({ peel: progress });

    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    const speed = Math.hypot(e.clientX - lastClient.x, e.clientY - lastClient.y) / dt;
    peakSpeed = Math.max(peakSpeed, speed);
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = now;

    const inten = Math.min(1, speed / 2.5);
    sfx.tearStartIfIdle();
    sfx.tearMove(inten);
    // flecks spray from the tear line near the finger
    particles.emit(e.clientX, r.top + tearY, { count: 1 + Math.round(inten * 4), speed: 2 + inten * 5, colors: FOIL, life: 36 });
    if (navigator.vibrate && inten > 0.5) navigator.vibrate(4);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (crossed) {
      opened = true;
      spring.set({ peel: 1 });
      sfx.tearEnd(true, Math.min(1, 0.6 + peakSpeed / 4));
      if (navigator.vibrate) navigator.vibrate([18, 30, 14]);
      const r = pack.getBoundingClientRect();
      for (let i = 0; i <= 6; i++) particles.emit(r.left + (W * i) / 6, r.top + tearY, { count: 4, speed: 5, colors: FOIL, life: 52, size: 2.8 });
    } else {
      sfx.tearEnd(false);
      spring.set({ peel: 0 }); // didn't cross — the lid rolls back shut
    }
  }

  function reset() {
    opened = false;
    spring.set({ peel: 0 });
  }

  pack.addEventListener("pointerdown", onDown);
  pack.addEventListener("pointermove", onMove);
  pack.addEventListener("pointerup", onUp);
  pack.addEventListener("pointercancel", onUp);
  pack.addEventListener("contextmenu", (e) => e.preventDefault());

  return { reset };
}

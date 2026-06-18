// pack.js — TEAR-OPEN prototype (no click-to-open).
//
// Two stages, so it tears like real paper:
//   1. WHILE tearing — the pack is still ONE piece. A gap opens from the start
//      edge along your traced path and PINCHES SHUT at your fingertip, staying
//      joined ahead of the tear front (no premature split).
//   2. THE MOMENT the tear crosses to the far edge — even with the finger still
//      down — the pack splits into TWO complementary pieces (each side of the
//      same jagged tear line) that pull apart, revealing the interior. They fit
//      back into one pack (recombine).
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

// Internal coordinate box. The width is a fixed unit; the HEIGHT is re-derived
// from whatever pack image loads (see applyAspect), so dropping a pack of any
// size/shape at PACK_IMG just works — the viewBox, art, mask, and tear geometry
// all follow. 554 is only the placeholder until the real image reports its size.
const VB = { w: 300, h: 554 };
const PACK_IMG = "assets/pack.png"; // the pack art — swap this file to reskin the pack
const GAP_TEAR = 10; // crack width while mid-tear — kept thin so it reads as a crack, not a gap
const SEP_MAX = 130; // how far the smaller half flies off once split (the body stays put)
const ROT = 18; // degrees the flying half tilts/flings as it tears away — dynamic motion
const START_DIST = 12; // finger travel before the tear engages
const STEP_MIN = 16; // min finger travel between recorded tear points — keeps the teeth long-
//                      wavelength so a SLOW tear doesn't pile up points into steep, dense teeth
const TURN_SEG = 14; // length over which the tear's heading is measured for the turn check
const TURN_KINK_RAD = Math.PI / 2; // max single-step turn (90°) — a sharper kink voids the tear
const TURN_CUM_RAD = Math.PI * 0.39; // max cumulative net turn (~70°) — catches a gradual hook/U-turn early, before it can reach an edge and commit
// Tear zone = the top & bottom crimp strips, symmetric top/bottom and full width, but
// DEEPER at the four corners than across the middle (the crimp's notch shape). The
// side seams and the inner face just scratch (you can't tear from inside the pack).
const TEAR_CORNER_X = 0.10; // how wide each corner block is (fraction of the width) — 30u of the 300u width
const TEAR_CORNER_Y = 0.13; // corner strip depth — the taller "green" part (fraction of the height)
const TEAR_MID_Y = 0.07; // middle strip depth — the shorter "red" part (fraction of the height)
const CROSS_MARGIN = 12; // how near the far edge counts as "crossed"
const CROSS_MIN = 90; // …and a minimum tear length, so starting near an edge doesn't count
const FOIL = ["#ff5d8f", "#ffd24a", "#5fcf8e", "#3fd6c8", "#6ea8fe", "#b072e6"];
const CORNERS = [
  { s: 0, x: 0, y: 0 },
  { s: 1, x: VB.w, y: 0 },
  { s: 2, x: VB.w, y: VB.h },
  { s: 3, x: 0, y: VB.h },
];

export function createPack({ mountEl, onOpen, onGrab }) {
  mountEl.innerHTML = `
    <div class="pack-wrap">
    <svg class="pack" viewBox="0 0 ${VB.w} ${VB.h}" aria-label="Sealed pack — tear it open">
      <defs>
        <g id="art">
          <image class="pack-img" x="0" y="0" width="${VB.w}" height="${VB.h}" href="${PACK_IMG}" preserveAspectRatio="xMidYMid slice"/>
        </g>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff2e0" stop-opacity="0"/>
          <stop offset="0.5" stop-color="#fff2e0" stop-opacity="0.5"/>
          <stop offset="1" stop-color="#fff2e0" stop-opacity="0"/>
        </linearGradient>
        <!-- treasure light: a bright warm core fading to gold then transparent —
             used for the glow that pours out of the tear as it opens -->
        <radialGradient id="treasure" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#fffdf3"/>
          <stop offset="0.28" stop-color="#ffe48f"/>
          <stop offset="0.65" stop-color="#ffba38" stop-opacity="0.55"/>
          <stop offset="1" stop-color="#ff9e1f" stop-opacity="0"/>
        </radialGradient>
        <!-- soft blur so the gold leaking along the crack reads as light, not a stripe -->
        <filter id="gapblur" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4"/>
        </filter>
        <!-- light shafts fanning from the opening: brightest at the gap (apex),
             fading to nothing at the tips. userSpaceOnUse so it sits at the apex
             and scales with the rays group as it grows. -->
        <radialGradient id="rays" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="380">
          <stop offset="0" stop-color="#fff8e6" stop-opacity="0.95"/>
          <stop offset="0.32" stop-color="#ffde8a" stop-opacity="0.5"/>
          <stop offset="0.68" stop-color="#ffb53e" stop-opacity="0.16"/>
          <stop offset="1" stop-color="#ffa522" stop-opacity="0"/>
        </radialGradient>
        <!-- a touch of blur softens the shaft edges into light, not hard wedges -->
        <filter id="raysblur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2"/>
        </filter>
        <mask id="tearmask">
          <rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16" fill="#fff"/>
          <polygon class="gap" points="" fill="#000"/>
        </mask>
        <!-- the pack art's own alpha — clips the sheen so its screen-blend
             highlight never lands on the transparent background, only on foil. -->
        <mask id="artalpha" maskUnits="userSpaceOnUse" style="mask-type:alpha">
          <use href="#art"/>
        </mask>
        <clipPath id="clipA"><polygon points=""/></clipPath>
        <clipPath id="clipB"><polygon points=""/></clipPath>
      </defs>

      <!-- No solid interior: behind the foil is the real card stack itself, so a
           tear (gap or a flown-off piece) opens straight onto the complete cards
           — the rip only ever cuts the foil, never the cards behind it. -->

      <!-- Foil layers — free to fly off; each keeps only its own shape clip. The
           split shows each piece's own jagged torn edge — no drawn white line. -->
      <g class="sealed" mask="url(#tearmask)">
        <use href="#art"/>
        <g mask="url(#artalpha)"><g transform="skewX(-9)"><rect class="pack-sheen" x="0" y="-200" width="130" height="1200" fill="url(#sheen)" style="mix-blend-mode:screen"/></g></g>
      </g>
      <g class="piece piece-a" style="display:none"><use href="#art" clip-path="url(#clipA)"/></g>
      <g class="piece piece-b" style="display:none"><use href="#art" clip-path="url(#clipB)"/></g>

      <!-- Treasure light. While tearing, .gap-glow traces the crack and brightens
           as the gap widens; on opening, .open-bloom blooms out of the parting
           seam like light pouring from inside. Both screen-blend so they ADD light
           over the foil and the cards behind. -->
      <ellipse class="open-bloom" cx="-100" cy="-100" rx="0" ry="0" fill="url(#treasure)" opacity="0" style="mix-blend-mode:screen"/>
      <!-- fan of light shafts shining out of the opening (built + aimed in makePieces),
           grown + brightened by the spring as the gap widens -->
      <g class="light-rays" opacity="0" style="mix-blend-mode:screen"><path fill="url(#rays)" filter="url(#raysblur)"/></g>
      <polygon class="gap-glow" points="" fill="#ffd874" opacity="0" filter="url(#gapblur)" style="mix-blend-mode:screen"/>

      <!-- Guide overlay: the top & bottom crimp strips where a press STARTS a tear
           — never the sides or face (see onDown). Shown only when body.show-tear-zone
           is set (the "Tear zone" toggle). pointer-events:none — never blocks the slash. -->
      <path class="tear-zone" fill-rule="evenodd" d=""/>

    </svg>
      <!-- tear-reference line: a thick, slightly hand-drawn guide line along the seal,
           with a rim-light beam sweeping left<->right. Hidden once a tear starts. -->
      <svg class="crimp-streak" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
        <path class="cs-base" d="M0 12 C25 13.5 55 9.5 100 9 C145 8.5 162 15 200 14.5 C235 14 270 10.5 300 11.5" pathLength="100"/>
        <path class="cs-beam" d="M0 12 C25 13.5 55 9.5 100 9 C145 8.5 162 15 200 14.5 C235 14 270 10.5 300 11.5" pathLength="100"/>
      </svg>
      <!-- edge sparks (the widget design, reused): HTML so box-shadow gives the
           clear glow. The layer is pinned to the pack's TOP seal; each spark grows
           straight up FROM the seal (transform-origin: bottom) on a flick. -->
      <div class="spark-layer" aria-hidden="true">
        <span class="spark" style="left:13%"></span>
        <span class="spark" style="left:32%"></span>
        <span class="spark" style="left:50%"></span>
        <span class="spark" style="left:68%"></span>
        <span class="spark" style="left:87%"></span>
      </div>
    </div>
    <canvas class="pack-fx"></canvas>`;

  const svg = mountEl.querySelector(".pack");
  const wrap = mountEl.querySelector(".pack-wrap");
  const sealed = mountEl.querySelector(".sealed");
  const gap = mountEl.querySelector(".gap");
  const clipPolyA = mountEl.querySelector("#clipA polygon");
  const clipPolyB = mountEl.querySelector("#clipB polygon");
  const pieceA = mountEl.querySelector(".piece-a");
  const pieceB = mountEl.querySelector(".piece-b");
  const gapGlow = mountEl.querySelector(".gap-glow");
  const openBloom = mountEl.querySelector(".open-bloom");
  const lightRays = mountEl.querySelector(".light-rays");
  const lightRaysPath = lightRays.querySelector("path");
  const tearZone = mountEl.querySelector(".tear-zone");
  const particles = createParticles(mountEl.querySelector(".pack-fx"));

  // Draw the tear-trigger guide band; re-run whenever the pack is resized.
  const drawTearZone = () => tearZone.setAttribute("d", tearZonePath());
  drawTearZone();

  // Pause/resume the idle float (CSS animation on .pack) — the pack steadies the
  // moment you grab it to tear, and floats again only when it's whole at rest.
  const floatOn = (on) => {
    wrap.style.animationPlayState = on ? "running" : "paused";
    wrap.classList.toggle("tearing", !on); // hide the crimp guide line the moment a tear is underway
  };

  // Reshape the whole pack to a given image aspect: re-derive VB.h, the border
  // corners the tear geometry rides on, and every height-bearing attribute. This
  // is what makes any pack image — any size or shape — drop in and just work.
  function applyAspect(natW, natH) {
    if (!natW || !natH) return;
    VB.h = Math.round(VB.w * (natH / natW));
    CORNERS[2].y = VB.h; // bottom-right / bottom-left corners follow the new height
    CORNERS[3].y = VB.h;
    mid = { x: VB.w / 2, y: VB.h / 2 };
    svg.setAttribute("viewBox", `0 0 ${VB.w} ${VB.h}`);
    mountEl.querySelector(".pack-img").setAttribute("height", VB.h);
    mountEl.querySelector("#tearmask rect").setAttribute("height", VB.h);
    drawTearZone(); // re-fit the trigger-zone guide to the new size
  }

  // The <image> renders the pack art straight away; probing it with a plain
  // Image just reports the natural size so applyAspect can match the viewBox to
  // it (no crop). A missing file leaves the SVG <image> empty — no broken icon.
  const probe = new Image();
  probe.onload = () => applyAspect(probe.naturalWidth, probe.naturalHeight);
  probe.src = PACK_IMG;

  let armed = false; // a tear can't start until the cards behind it are ready
  let path = [];
  let tearPath = null;
  let dragging = false;
  let tearing = false;
  let crossed = false;
  let split = false; // promoted to two pieces?
  let opened = false;
  let mid = { x: VB.w / 2, y: VB.h / 2 }; // pivot the flying half tilts around
  let moverEl = null; // the SMALLER half (flies off); the larger body stays put
  let stayEl = null;
  let moverDir = { x: 0, y: -1 }; // direction the flying half tears away in
  let seam = null; // the split tear line, in pack coords (drives the fleck burst)
  let scratchOnly = false; // started in the middle (not near an edge) → just scuff the foil
  let invalid = false; // the trace turned back on itself (>90° / U-turn) → tear voided, can't open
  let headDir = null; // the tear's established heading (unit vector), for the turn check
  let headAnchor = null; // the point headDir was last measured from
  let cumTurn = 0; // cumulative SIGNED heading rotation (rad) — catches a gradual U-turn
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
        // only the torn-off half moves — it flings away AND fades as it goes, so
        // it doesn't hover over the cards rising out of the opening behind it; the
        // body half stays put (anchored in place)
        const d = c.sep * SEP_MAX;
        const a = c.sep * ROT;
        if (moverEl) {
          moverEl.setAttribute("transform", `rotate(${a.toFixed(2)} ${mid.x.toFixed(1)} ${mid.y.toFixed(1)}) translate(${(moverDir.x * d).toFixed(2)} ${(moverDir.y * d).toFixed(2)})`);
          moverEl.style.opacity = Math.max(0, 1 - c.sep * 1.15).toFixed(3);
        }
        // treasure light pours from the opening — bigger + brighter as the halves part
        const r = 32 + c.sep * VB.w * 0.7;
        openBloom.setAttribute("cx", mid.x.toFixed(1));
        openBloom.setAttribute("cy", mid.y.toFixed(1));
        openBloom.setAttribute("rx", r.toFixed(1));
        openBloom.setAttribute("ry", (r * 0.78).toFixed(1));
        openBloom.style.opacity = Math.min(0.8, c.sep).toFixed(3); // a soft core glow under the shafts
        // light shafts fan out of the gap, unfurling + brightening as it parts —
        // so the shine GROWS from the opening rather than popping out
        lightRays.setAttribute("transform", `translate(${mid.x.toFixed(1)} ${mid.y.toFixed(1)}) scale(${(0.18 + c.sep * 0.92).toFixed(3)})`);
        lightRays.style.opacity = Math.min(0.95, c.sep * 1.3).toFixed(3);
      } else if (tearPath) {
        // open the dark gap through the sealed foil along the traced path
        const poly = ribbon(tearPath, c.w);
        const pts = poly ? poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";
        gap.setAttribute("points", pts);
        // gold light leaks from the crack, brightening as the gap widens
        gapGlow.setAttribute("points", pts);
        gapGlow.style.opacity = Math.min(0.9, (c.w / GAP_TEAR) * 0.9).toFixed(3);
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
  // The anchor is the start point snapped straight to its NEAREST edge — the press
  // is gated to begin at/near an edge, so that's where the rip opens. (Casting a
  // ray backward along the drag direction instead would shoot across the whole
  // pack to a far border whenever the drag wasn't aimed at the near edge, drawing
  // a spurious straight gap clear across the pack.)
  function rebuildGap() {
    const raw = jitter(path);
    const anchor = snapBorder(raw[0]);
    const tip = raw[raw.length - 1];
    crossed = nearBorder(tip) && pathLen(path) > CROSS_MIN;
    tearPath = [anchor, ...raw];
  }

  // On cross: split into two complementary pieces clipped to each side of the
  // full edge-to-edge tear line.
  function makePieces() {
    const raw = jitter(path);
    const Pin = snapBorder(raw[0]); // start snapped to its nearest edge (see rebuildGap)
    const Pout = snapBorder(raw[raw.length - 1]);
    const full = [Pin, ...raw, Pout];
    const sIn = perim(Pin);
    const sOut = perim(Pout);

    const A = [...full, ...cwCorners(sOut, sIn)]; // one side + its border corners
    const B = [...full, ...cwCorners(sIn, sOut).reverse()]; // the other side
    setPoints(clipPolyA, A);
    setPoints(clipPolyB, B);
    seam = full; // remember the tear line (for the foil-fleck burst on release)

    // part the two pieces straight apart, perpendicular to the tear (opposite
    // directions), with A on whichever side its bulk sits
    mid = { x: (Pin.x + Pout.x) / 2, y: (Pin.y + Pout.y) / 2 };
    const chord = unit(sub(Pout, Pin));
    const nrm = { x: -chord.y, y: chord.x };
    const cA = sub(centroid(A), mid);
    const side = cA.x * nrm.x + cA.y * nrm.y >= 0 ? 1 : -1;
    const dirA = { x: nrm.x * side, y: nrm.y * side };
    const dirB = { x: -dirA.x, y: -dirA.y };

    // the SMALLER half tears off (the body keeps the cards); whichever side that
    // is, the opening — and the cards — come from there
    const aIsSmaller = Math.abs(area(A)) < Math.abs(area(B));
    moverEl = aIsSmaller ? pieceA : pieceB;
    stayEl = aIsSmaller ? pieceB : pieceA;
    moverDir = aIsSmaller ? dirA : dirB;
    stayEl.removeAttribute("transform");

    // The big half slides STRAIGHT off on ONE cardinal axis. A tear that actually
    // spans TOP-to-BOTTOM is a left/right split → exit sideways, away from the
    // torn-off (smaller) half. Any other tear just took a strip off the crimp it
    // started in → drop away from that crimp: top → down, bottom → up. (So a top
    // tear that merely angled off to a side still drops DOWN, not sideways.)
    const small = centroid(aIsSmaller ? A : B);
    const onTop = (p) => p.y <= 0.5;
    const onBottom = (p) => p.y >= VB.h - 0.5;
    const spansTopBottom = (onTop(Pin) && onBottom(Pout)) || (onBottom(Pin) && onTop(Pout));
    const exitX = spansTopBottom ? (small.x < VB.w / 2 ? 1 : -1) : 0;
    const exitY = spansTopBottom ? 0 : (path[0].y < VB.h / 2 ? 1 : -1);
    // Exit distance in PIXELS, not viewport units: iOS Safari often won't ANIMATE a
    // transform transition whose target is in vmax/vh/vw — it jumps to the end, so
    // the half just vanishes instead of sliding. Pixels transition everywhere.
    const reach = Math.max(window.innerWidth, window.innerHeight) * 1.3; // clears the screen
    mountEl.style.setProperty("--exit-x", Math.round(exitX * reach) + "px");
    mountEl.style.setProperty("--exit-y", Math.round(exitY * reach) + "px");
    mountEl.style.setProperty("--exit-rot", "0deg"); // straight slide — no tilt

    // the light shafts fan OUT of the opening — aim them in the direction the
    // gap faces (where the torn-off half pulls away from)
    lightRaysPath.setAttribute("d", sunburst(Math.atan2(moverDir.y, moverDir.x)));

    split = true;
    sealed.style.display = "none"; // the dark gap/crack is gone; the two pieces take over
    gapGlow.style.opacity = 0; // crack glow gives way to the opening bloom
    gapGlow.setAttribute("points", "");
    pieceA.style.display = "";
    pieceB.style.display = "";
  }

  function onDown(e) {
    if (opened) return reset();
    if (!armed) return; // cards aren't loaded yet — hold the tear until they are

    // A tear can only begin while TOUCHING the pack — a press off the pack does
    // nothing (no line is ever drawn in the empty stage). On the pack, only the
    // top/bottom crimp strips start a tear; the sides and inner face scuff the foil.
    const q = svg.createSVGPoint();
    q.x = e.clientX;
    q.y = e.clientY;
    const s = q.matrixTransform(svg.getScreenCTM().inverse());
    const inside = s.x >= 0 && s.x <= VB.w && s.y >= 0 && s.y <= VB.h;
    if (!inside) return; // not on the pack → ignore entirely
    // a tear can only START in the top or bottom crimp strip — deeper at the corners,
    // shallower across the middle. Never the side seams or the inner face.
    const nearCorner = s.x < VB.w * TEAR_CORNER_X || s.x > VB.w * (1 - TEAR_CORNER_X);
    const depth = VB.h * (nearCorner ? TEAR_CORNER_Y : TEAR_MID_Y);
    scratchOnly = s.y > depth && s.y < VB.h - depth;

    floatOn(false); // steady the pack while it's being handled — stop the idle float
    onGrab?.(); // pack grabbed (sealed, covering) → safe to bring the card stack in behind it
    dragging = true;
    tearing = false;
    crossed = false;
    split = false;
    invalid = false;
    headDir = null;
    headAnchor = null;
    cumTurn = 0;
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
    if (dist(p, path[path.length - 1]) < STEP_MIN) return;
    path.push(p);

    if (!tearing && pathLen(path) > START_DIST) {
      tearing = true;
      sfx.tearStart();
    }
    if (!tearing) return;

    // A real tear runs forward — it can't hook back. Measure the heading over each
    // ~TURN_SEG-long chunk and void the tear if it turns more than 90° EITHER in a
    // single step (a sharp kink) OR cumulatively (a gradual U-turn). Net rotation is
    // signed, so back-and-forth wobble cancels out and gentle curves still pass.
    if (!invalid) {
      if (!headAnchor) headAnchor = path[0];
      const seg = sub(p, headAnchor);
      if (Math.hypot(seg.x, seg.y) >= TURN_SEG) {
        const dir = unit(seg);
        if (headDir) {
          const turn = Math.atan2(headDir.x * dir.y - headDir.y * dir.x, headDir.x * dir.x + headDir.y * dir.y);
          cumTurn += turn;
          if (Math.abs(turn) > TURN_KINK_RAD || Math.abs(cumTurn) > TURN_CUM_RAD) {
            invalid = true;
            sfx.tearEnd(false); // cut the rip sound short
            if (navigator.vibrate) navigator.vibrate(24);
          }
        }
        headDir = dir;
        headAnchor = p;
      }
    }
    if (invalid) {
      spring.set({ w: 0 }); // the voided tear heals — it can't open
      return;
    }

    // Stay ONE piece with just a thin crack tracking the finger — UNTIL the tear
    // fully crosses the pack, at which point the tear is DONE and it splits open
    // right then (finger still on the screen, no need to lift). Before crossing
    // it reads as a small crack, not a gaping hole parting open as you drag.
    const progress = Math.min(1, pathLen(path) / (VB.h * 0.6));
    rebuildGap(); // updates the `crossed` flag + the crack path
    if (crossed) {
      dragging = false; // the tear completes the instant it crosses the body
      commitOpen();
      return;
    }
    spring.set({ w: progress * GAP_TEAR });

    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    const speed = Math.hypot(e.clientX - lastClient.x, e.clientY - lastClient.y) / dt;
    peakSpeed = Math.max(peakSpeed, speed);
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = now;

    const inten = Math.min(1, speed / 2.5);
    sfx.tearMove(inten);
    // spray flecks at the finger CLAMPED onto the pack (p is already clamped in
    // pack space) — a tear may start just outside the edge, and emitting at the
    // raw client point would scatter foil into the empty margin
    const sp = new DOMPoint(p.x, p.y).matrixTransform(svg.getScreenCTM());
    particles.emit(sp.x, sp.y, { count: 1 + Math.round(inten * 4), speed: 2 + inten * 5, colors: FOIL, life: 36 });
    if (navigator.vibrate && inten > 0.5) navigator.vibrate(4);
  }

  // The tear has crossed the whole pack body → split it into two pieces and fling
  // the smaller half off. Fired the MOMENT the crack reaches the far edge (mid-
  // drag, finger still on the screen) — or on release if it crossed right as the
  // finger lifted. Guarded by `opened` so a tear only ever opens once.
  function commitOpen() {
    if (opened) return;
    opened = true;
    makePieces();
    spring.set({ sep: 1 }); // pieces pull fully apart
    sfx.tearEnd(true, Math.min(1, 0.6 + peakSpeed / 4));
    if (navigator.vibrate) navigator.vibrate([18, 30, 14]);
    burstAlongTear();
    // let the torn-off top FULLY fly away first, THEN hand off to the reveal
    // (which drops the pack body and springs the cards up)
    setTimeout(() => onOpen?.(), 750);
  }

  function onUp() {
    if (!dragging) return; // never started, or already committed mid-drag
    dragging = false;
    if (scratchOnly) {
      scratchOnly = false; // just a scuff — nothing to open
      floatOn(true); // resume the idle float
      return;
    }
    if (crossed && !invalid) {
      commitOpen(); // crossed right as the finger lifted
    } else {
      if (!invalid) sfx.tearEnd(false); // (a void tear already cut its sound)
      spring.set({ w: 0 }); // didn't cross (or was voided) — the crack eases shut
      floatOn(true); // stayed one piece — resume the idle float
      setTimeout(() => {
        if (!dragging && !opened) clearTear();
      }, 420);
    }
  }

  function burstAlongTear() {
    const m = svg.getScreenCTM();
    for (const p of seam || []) {
      const c = new DOMPoint(p.x, p.y).matrixTransform(m);
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
    invalid = false;
    headDir = null;
    headAnchor = null;
    cumTurn = 0;
    tearPath = null;
    path = [];
    spring.reset();
    seam = null;
    sealed.style.display = "";
    pieceA.style.display = "none";
    pieceB.style.display = "none";
    pieceA.removeAttribute("transform");
    pieceB.removeAttribute("transform");
    pieceA.style.opacity = pieceB.style.opacity = ""; // restore (the mover faded as it flew)
    gap.setAttribute("points", "");
    gapGlow.setAttribute("points", ""); // clear the treasure light too
    gapGlow.style.opacity = 0;
    openBloom.style.opacity = 0;
    openBloom.setAttribute("rx", 0);
    openBloom.setAttribute("ry", 0);
    lightRays.style.opacity = 0; // the fan of shafts goes dark with the rest
    lightRays.removeAttribute("transform");
    lightRaysPath.setAttribute("d", "");
    floatOn(true); // the pack is whole again — let it float
  }

  // listen on the whole stage so an in-progress tear keeps tracking even when
  // the finger strays off the pack mid-drag (onDown still gates the START to
  // on-pack presses; the path clamps to the pack so the line stays on it)
  mountEl.addEventListener("pointerdown", onDown);
  mountEl.addEventListener("pointermove", onMove);
  mountEl.addEventListener("pointerup", onUp);
  mountEl.addEventListener("pointercancel", onUp);
  mountEl.addEventListener("contextmenu", (e) => e.preventDefault());
  // a press-and-drag on the SVG <image> would otherwise start a NATIVE image
  // drag (a ghost copy of the pack stuck to the cursor), hijacking the tear
  mountEl.addEventListener("dragstart", (e) => e.preventDefault());

  // Ambient edge sparks — while the pack sits sealed, a thin warm streak shines
  // straight up off the top crimp every few seconds (rise + stretch + fade), with a
  // soft glint (sfx). Paused while grabbed, torn, opened, or the tab is hidden.
  const sparkEls = [...mountEl.querySelectorAll(".spark")];
  function flickSpark() {
    sparkTimer = setTimeout(flickSpark, 1800 + Math.random() * 2200);
    if (!armed || dragging || opened || document.hidden || !sparkEls.length) return;
    const el = sparkEls[(Math.random() * sparkEls.length) | 0];
    const h = 0.8 + Math.random() * 0.5; // varied beam length (now the base spans the crimp, so peak ≈ 1)
    el.animate(
      [
        { opacity: 0, transform: "translateY(0) scaleY(0.4)" }, // a sliver at the seal
        { opacity: 1, transform: `translateY(-7px) scaleY(${h.toFixed(2)})`, offset: 0.3 }, // grows up out of the seal, bright
        { opacity: 0, transform: `translateY(-30px) scaleY(${(h * 0.6).toFixed(2)})` }, // shoots up and fades (widget flick)
      ],
      { duration: 620 + Math.random() * 220, easing: "ease-out" }
    );
    sfx.spark();
  }
  let sparkTimer = setTimeout(flickSpark, 1400);

  return {
    reset,
    // The host arms the pack once its cards are prepared. Arming also REVEALS the
    // pack (it stays hidden while the stack is still loading) — no pack shows up
    // until there's a card stack behind it to open.
    setArmed: (v) => {
      armed = v;
      svg.classList.toggle("ready", v);
    },
  };
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

// The tear-trigger zone as an SVG path: the top and bottom crimp strips — deeper at
// the four corners (TEAR_CORNER_Y) than across the middle (TEAR_MID_Y), the crimp's
// notch shape — where onDown lets a press START a tear (side seams + inner face only
// scratch). Outer corners follow the pack's rounded corner (rx 16).
function tearZonePath() {
  const r = 16;
  const { w, h } = VB;
  const cx = w * TEAR_CORNER_X;
  const cy = h * TEAR_CORNER_Y;
  const my = h * TEAR_MID_Y;
  const top = `M0,${cy.toFixed(1)} V${r} A${r},${r} 0 0 1 ${r},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} V${cy.toFixed(1)} H${(w - cx).toFixed(1)} V${my.toFixed(1)} H${cx.toFixed(1)} V${cy.toFixed(1)} Z`;
  const bottom = `M0,${(h - cy).toFixed(1)} H${cx.toFixed(1)} V${(h - my).toFixed(1)} H${(w - cx).toFixed(1)} V${(h - cy).toFixed(1)} H${w} V${(h - r).toFixed(1)} A${r},${r} 0 0 1 ${w - r},${h} H${r} A${r},${r} 0 0 1 0,${h - r} Z`;
  return `${top} ${bottom}`;
}

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
    const j = (Math.abs((Math.sin(i * 51.3) * 7919) % 1) - 0.5) * 2.6;
    out.push({ x: pts[i].x + n.x * j, y: pts[i].y + n.y * j });
  }
  out.push(pts[pts.length - 1]);
  return out;
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

// A fan of light shafts radiating from the origin (0,0), centred on `base` (the
// direction the gap faces). Each shaft is a thin triangle of slightly varied
// length and width, so it reads as uneven god-rays — light peeking out of the
// opening — rather than a tidy mechanical sunburst. Drawn in the rays group's
// local space; the group's transform places it at the gap and scales it as it grows.
function sunburst(base) {
  const N = 11; // number of shafts across the fan
  const SPREAD = 2.55; // fan width (~146°) opening out of the gap
  const L = 380; // reach of the longest shaft (matches the #rays gradient radius)
  let d = "";
  for (let i = 0; i < N; i++) {
    const a = base - SPREAD / 2 + SPREAD * (i / (N - 1));
    const jL = Math.abs((Math.sin(i * 12.9 + 1.7) * 4391) % 1); // 0..1, deterministic
    const jW = Math.abs((Math.sin(i * 7.31 + 0.4) * 2719) % 1);
    const len = L * (0.66 + 0.34 * jL); // uneven shaft lengths
    const hw = 0.018 + 0.03 * jW; // uneven shaft widths (radians of half-angle)
    const x1 = (Math.cos(a - hw) * len).toFixed(1);
    const y1 = (Math.sin(a - hw) * len).toFixed(1);
    const x2 = (Math.cos(a + hw) * len).toFixed(1);
    const y2 = (Math.sin(a + hw) * len).toFixed(1);
    d += `M0 0L${x1} ${y1}L${x2} ${y2}Z`;
  }
  return d;
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

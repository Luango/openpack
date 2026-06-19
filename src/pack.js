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
import { TIER_HEX } from "./rarity.js";
import * as sfx from "./sfx.js";
import { createFlowLight } from "./flowlight.js";

// Honour the OS "reduce motion" setting — the commit screen-shake (the one new
// motion below that isn't already gated in CSS) is skipped when it's on.
const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// First-run gesture hint: shown until the player has opened their first pack, then
// never again (persisted; falls back to in-session if storage is blocked).
const TORE_KEY = "openpack.toreOnce";
let toredSession = false;
function hasToredBefore() {
  if (toredSession) return true;
  try { return localStorage.getItem(TORE_KEY) === "1"; } catch { return false; }
}
function markTored() {
  toredSession = true;
  try { localStorage.setItem(TORE_KEY, "1"); } catch { /* private mode — session flag still holds */ }
}

// Internal coordinate box. The width is a fixed unit; the HEIGHT is re-derived
// from whatever pack image loads (see applyAspect), so dropping a pack of any
// size/shape at PACK_IMG just works — the viewBox, art, mask, and tear geometry
// all follow. 554 is only the placeholder until the real image reports its size.
const VB = { w: 300, h: 554 };
const PACK_IMG = "assets/pack.webp"; // the pack art (downscaled WebP w/ alpha — ~134KB vs 2.7MB PNG; pack.png kept as the source). Swap to reskin; keep the .pack-gloss mask url in pack.html in sync.
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
const TEAR_CORNER_Y = 0.22; // corner strip depth — the taller "green" part (fraction of the height); widened so a grab a little off the seam still catches
const TEAR_MID_Y = 0.15; // middle strip depth — the shorter "red" part (fraction of the height); widened to forgive presses just inside the crimp
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
    <!-- The opening light is the CARD'S glow (the bulb), so it lives in its OWN layer
         BEHIND the foil — not inside it. The foil (.pack) renders on top and occludes
         it, so light only shows through the opening + past the edges. Crucially, when
         the pack exits this layer counter-slides (CSS, body.revealing) to stay put
         with the card while the foil slides away — the light never travels with the box. -->
    <svg class="pack-light" viewBox="0 0 ${VB.w} ${VB.h}" aria-hidden="true">
      <defs>
        <!-- soft warm core fading to gold then transparent -->
        <radialGradient id="treasure" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#fffdf3"/>
          <stop offset="0.42" stop-color="#ffe79a" stop-opacity="0.92"/>
          <stop offset="0.72" stop-color="#ffba38" stop-opacity="0.4"/>
          <stop offset="1" stop-color="#ff9e1f" stop-opacity="0"/>
        </radialGradient>
        <!-- light shafts: brightest at the apex, fading to nothing at the tips.
             userSpaceOnUse so it sits at the apex and scales with the rays group. -->
        <radialGradient id="rays" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="380">
          <stop offset="0" stop-color="#fff8e6" stop-opacity="0.95"/>
          <stop offset="0.32" stop-color="#ffde8a" stop-opacity="0.5"/>
          <stop offset="0.68" stop-color="#ffb53e" stop-opacity="0.16"/>
          <stop offset="1" stop-color="#ffa522" stop-opacity="0"/>
        </radialGradient>
        <filter id="raysblur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2"/>
        </filter>
        <!-- the OPEN side of the tear: light only escapes here, never the intact foil -->
        <clipPath id="lightclip"><polygon points=""/></clipPath>
      </defs>
      <g class="open-light" clip-path="url(#lightclip)">
        <ellipse class="open-bloom" cx="-100" cy="-100" rx="0" ry="0" fill="url(#treasure)" opacity="0" style="mix-blend-mode:screen"/>
        <!-- no feGaussianBlur on the shafts: they scale every frame during the open,
             and re-rastering an SVG blur per frame janks mobile. The #rays radial
             gradient already fades them out softly, so they read fine crisp. -->
        <g class="light-rays" opacity="0" style="mix-blend-mode:screen"><path fill="url(#rays)"/></g>
      </g>
    </svg>
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
        <!-- the pack art's own alpha — clips the sheen so its screen-blend
             highlight never lands on the transparent background, only on foil. -->
        <mask id="artalpha" maskUnits="userSpaceOnUse" style="mask-type:alpha">
          <use href="#art"/>
        </mask>
        <clipPath id="clipA"><polygon points=""/></clipPath>
        <clipPath id="clipB"><polygon points=""/></clipPath>
        <!-- STATIC rounded-rect clip for the sealed foil (keeps the rx16 corners the
             old tear-mask gave it). It never changes during a drag, so it's
             rasterized once — unlike the old per-frame mask. -->
        <clipPath id="foilclip"><rect x="0" y="0" width="${VB.w}" height="${VB.h}" rx="16"/></clipPath>
      </defs>

      <!-- No solid interior: behind the foil is the real card stack itself, so a
           tear (gap or a flown-off piece) opens straight onto the complete cards
           — the rip only ever cuts the foil, never the cards behind it. The opening
           light (bloom + shafts) lives in the separate .pack-light layer BELOW, so
           it can stay put while the foil slides off. -->

      <!-- Foil layers — free to fly off; each keeps only its own shape clip. The
           split shows each piece's own jagged torn edge — no drawn white line.
           PERF: the foil is NOT masked during the live drag — re-masking this big
           PNG every frame (twice: the tear mask + the nested #artalpha) was the
           mobile jank. The rip is drawn as a thin dark crack ON TOP (.gap-crack)
           with the gold light over it (.gap-glow); the only true cut-out is the
           split, which already uses clipPath A/B. -->
      <g class="sealed" clip-path="url(#foilclip)">
        <use href="#art"/>
        <g mask="url(#artalpha)"><g transform="skewX(-9)"><rect class="pack-sheen" x="0" y="-200" width="130" height="1200" fill="url(#sheen)" style="mix-blend-mode:screen"/></g></g>
      </g>

      <!-- NB: the rip (.gap-crack / .gap-glow) is NOT here — it lives in the
           separate .pack-cut overlay below, OUTSIDE this drop-shadow-filtered .pack
           svg. A CSS filter re-rasters its WHOLE element when any child changes, so
           a crack inside here would re-raster the 2.7MB foil through the drop-shadow
           every frame (the real mobile slice-lag). Out here, .pack stays static. -->
      <g class="piece piece-a" style="display:none"><use href="#art" clip-path="url(#clipA)"/></g>
      <g class="piece piece-b" style="display:none"><use href="#art" clip-path="url(#clipB)"/></g>

      <!-- Guide overlay: the top & bottom crimp strips where a press STARTS a tear
           — never the sides or face (see onDown). Shown only when body.show-tear-zone
           is set (the "Tear zone" toggle). pointer-events:none — never blocks the slash. -->
      <path class="tear-zone" fill-rule="evenodd" d=""/>

    </svg>
      <!-- the rip overlay — drawn OVER the foil but OUTSIDE the drop-shadow-filtered
           .pack, so writing the crack each frame never re-rasters the big foil (that
           per-frame filter re-raster was the mobile slice-lag). A thin dark slit +
           gold light leaking along it; cheap, unfiltered vector. -->
      <svg class="pack-cut" viewBox="0 0 ${VB.w} ${VB.h}" aria-hidden="true">
        <polygon class="gap-crack" points="" fill="#0a0a0d" opacity="0"/>
        <polygon class="gap-glow" points="" fill="#ffd874" opacity="0" style="mix-blend-mode:screen"/>
      </svg>
      <!-- the "流光" — a WebGL flowing light along the tear seam (flowlight.js). Its
           width breathes + flows along the rip; sits over the foil like .pack-cut. If
           WebGL is unavailable the SVG .gap-glow above is used instead. -->
      <canvas class="gap-glow-gl" aria-hidden="true"></canvas>
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
      <!-- reactive specular gloss — a soft highlight that tracks the pointer across
           the foil (desktop hover), clipped to the foil silhouette by a PNG mask, so
           the sealed pack reads as a HELD, reflective object. Idle-only: hidden the
           moment a tear starts (it's an overlay; never touches the tear geometry). -->
      <div class="pack-gloss" aria-hidden="true"></div>
      <!-- rarity TELL: a breathing halo behind the pack that only lights up when a
           rare card is hidden inside (opacity scales with --idle-heat), tinted to
           that tier via --tell. Sibling after .pack so ".pack.ready ~ .pack-glow"
           starts its heartbeat. -->
      <div class="pack-glow" aria-hidden="true"></div>
      <!-- first-run gesture hint: a glowing dot rides a dashed path down the pack to
           SHOW the tear drag. Only on a user's first-ever pack (.pack-wrap.guide,
           set in setArmed); removed the instant they grab to tear (onDown). -->
      <div class="tear-guide" aria-hidden="true">
        <span class="tg-line"></span>
        <span class="tg-dot"></span>
      </div>
    </div>
    <canvas class="pack-fx"></canvas>`;

  const svg = mountEl.querySelector(".pack");
  const wrap = mountEl.querySelector(".pack-wrap");
  const glossEl = mountEl.querySelector(".pack-gloss");
  const sceneFx = document.querySelector(".scene-fx"); // paused during the tear to free the compositor
  const sealed = mountEl.querySelector(".sealed");
  const gapCrack = mountEl.querySelector(".gap-crack");
  const clipPolyA = mountEl.querySelector("#clipA polygon");
  const clipPolyB = mountEl.querySelector("#clipB polygon");
  const pieceA = mountEl.querySelector(".piece-a");
  const pieceB = mountEl.querySelector(".piece-b");
  const gapGlow = mountEl.querySelector(".gap-glow");
  const openBloom = mountEl.querySelector(".open-bloom");
  const lightRays = mountEl.querySelector(".light-rays");
  const lightRaysPath = lightRays.querySelector("path");
  const lightClipPoly = mountEl.querySelector("#lightclip polygon");
  const tearZone = mountEl.querySelector(".tear-zone");
  const particles = createParticles(mountEl.querySelector(".pack-fx"));
  // The tear's gold "流光" is a WebGL flowing light (flowlight.js) — breathing,
  // width-flowing. `flow` is null when WebGL is unavailable; the spring tick then
  // falls back to the flat SVG .gap-glow polygon.
  const flow = createFlowLight(mountEl.querySelector(".gap-glow-gl"));
  flow?.setViewBox(VB.w, VB.h);

  // Draw the tear-trigger guide band; re-run whenever the pack is resized.
  const drawTearZone = () => tearZone.setAttribute("d", tearZonePath());
  drawTearZone();

  // Pause/resume the idle float (CSS animation on .pack) — the pack steadies the
  // moment you grab it to tear, and floats again only when it's whole at rest.
  const floatOn = (on) => {
    wrap.style.animationPlayState = on ? "running" : "paused";
    wrap.classList.toggle("tearing", !on); // pauses the rim/sheen/glow/crimp anims (CSS) the moment a tear is underway
    sceneFx?.classList.toggle("paused", !on); // freeze the blurred backdrop cards — free the mobile compositor for the rip
  };

  // The pack is static during a drag (the float is paused, the viewBox fixed), so
  // its screen matrix is CONSTANT — cache it on pointerdown and reuse it, instead
  // of calling getScreenCTM() (a forced synchronous layout) twice per move.
  let ctm = null, ctmInv = null;

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
    mountEl.querySelector(".pack-light").setAttribute("viewBox", `0 0 ${VB.w} ${VB.h}`); // keep the light overlay aligned
    mountEl.querySelector(".pack-cut").setAttribute("viewBox", `0 0 ${VB.w} ${VB.h}`); // …and the rip overlay
    mountEl.querySelector(".pack-img").setAttribute("height", VB.h);
    mountEl.querySelector("#foilclip rect").setAttribute("height", VB.h); // keep the foil clip sized
    flow?.setViewBox(VB.w, VB.h); // the flowing-light shader maps the tear path in this box
    flow?.resize(); // match the GL backing store to the (now-sized) overlay
    ctm = ctmInv = null; // geometry changed — drop the cached matrix
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
  let lightClosing = false; // true once the opening light is being faded out (before the pack exits)
  let lightAnims = []; // WAAPI breathe→fade on the opening light (cancelled on reset)
  let handoffTimer = 0; // pending "drop the pack" handoff — gated on the light fade finishing
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
  let lastBuzzLen = 0; // pathLen at the last haptic tick — drives the distance-quantized ratchet
  let tellTier = 0; // the rarest tier hidden inside — colours the idle tell

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
        // The light is the CARD STACK glowing from its centre — the bag had kept it
        // hidden; the opening just lets it out. So the glow + the fan of shafts are
        // anchored at the CARD centre (not the tear), brightening as the gap parts.
        // It rides inside #pack-stage, so it fades away with the bag when the pack exits.
        const cardX = VB.w / 2;
        const cardY = VB.h / 2;
        // big + bright enough to clearly LIGHT the exposed card itself (the bulb you
        // can see through the hole), not just spill rays past the edge. The clip +
        // foil keep it to the opening, so a large bloom just lights the whole opening.
        const r = 55 + c.sep * VB.w * 0.95;
        openBloom.setAttribute("cx", cardX.toFixed(1));
        openBloom.setAttribute("cy", cardY.toFixed(1));
        openBloom.setAttribute("rx", r.toFixed(1));
        openBloom.setAttribute("ry", r.toFixed(1));
        lightRays.setAttribute("transform", `translate(${cardX.toFixed(1)} ${cardY.toFixed(1)}) scale(${(0.18 + c.sep * 0.92).toFixed(3)})`);
        // once we've begun fading the light out (pre-exit), don't let the spring keep
        // re-asserting full brightness — the fade owns the opacity from here
        if (!lightClosing) {
          openBloom.style.opacity = Math.min(0.9, c.sep * 1.15).toFixed(3);
          lightRays.style.opacity = Math.min(0.95, c.sep * 1.3).toFixed(3);
        }
      } else if (tearPath) {
        // draw the rip along the traced path — a thin dark slit OVER the foil
        // (no mask re-raster) with gold light leaking over it, brightening as the
        // gap widens. Both are small vector polygons → cheap per frame on mobile.
        const poly = ribbon(tearPath, c.w);
        const pts = poly ? poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";
        gapCrack.setAttribute("points", pts);
        gapCrack.style.opacity = Math.min(1, (c.w / GAP_TEAR) * 1.1).toFixed(3);
        // the GOLD LIGHT is the WebGL flowing streak (breathing, width-flowing), fed
        // the tear centreline + current gap width; SVG .gap-glow is the no-WebGL fallback
        if (flow) {
          flow.setPath(tearPath, c.w);
        } else {
          gapGlow.setAttribute("points", pts);
          gapGlow.style.opacity = Math.min(0.9, (c.w / GAP_TEAR) * 0.9).toFixed(3);
        }
      }
    },
  });

  // pointer → pack coords, clamped onto the pack rect so a tear can START just
  // outside the edge and still anchor cleanly where it crosses in
  function toSvg(e) {
    const inv = ctmInv || svg.getScreenCTM().inverse(); // cached during a drag; live fallback otherwise
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(inv);
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

    // the card shines a FULL radial burst from its centre; the foil blocks it and
    // only the open-side shafts escape the torn hole (see the open-side clip below)
    lightRaysPath.setAttribute("d", sunburst());

    // Light escapes ONLY through the torn-open mouth. Clip it to the cone cast from
    // the card centre through the opening: the INNER edge is the actual jagged tear
    // path (`full`), so the light is bounded exactly at the torn foil edge — no
    // straight cut across the card — and the opening's outer (pack-edge) boundary is
    // projected far out from the card centre, so the shafts fan out past the pack
    // only where the mouth faces. The intact foil + every other direction stay dark.
    const cardC = { x: VB.w / 2, y: VB.h / 2 };
    const F = 14; // project the mouth's outer rim this far out (well off-screen)
    const proj = (p) => ({ x: cardC.x + (p.x - cardC.x) * F, y: cardC.y + (p.y - cardC.y) * F });
    const moverCorners = (aIsSmaller ? A : B).slice(full.length); // pack corners on the open side
    setPoints(lightClipPoly, [
      ...full, // the jagged tear: Pin → tear path → Pout (the mouth's lip, matches the foil edge)
      proj(Pout),
      ...moverCorners.map(proj), // the opening's outer rim, cast far out from the card
      proj(Pin),
    ]);

    split = true;
    sealed.style.display = "none"; // the dark gap/crack is gone; the two pieces take over
    gapCrack.style.opacity = 0; gapCrack.setAttribute("points", ""); // the drawn slit gives way to the split
    gapGlow.style.opacity = 0; gapGlow.setAttribute("points", ""); // crack glow gives way to the opening bloom
    flow?.stop(); // the flowing light hands off to the opening bloom/rays
    pieceA.style.display = "";
    pieceB.style.display = "";
  }

  function onDown(e) {
    if (opened) return reset();
    if (!armed) return; // cards aren't loaded yet — hold the tear until they are

    // cache the (constant-for-this-drag) screen matrix once — every later move
    // reuses it instead of forcing a layout flush with getScreenCTM()
    ctm = svg.getScreenCTM();
    ctmInv = ctm.inverse();

    // A tear can only begin while TOUCHING the pack — a press off the pack does
    // nothing (no line is ever drawn in the empty stage). On the pack, only the
    // top/bottom crimp strips start a tear; the sides and inner face scuff the foil.
    const q = svg.createSVGPoint();
    q.x = e.clientX;
    q.y = e.clientY;
    const s = q.matrixTransform(ctmInv);
    const inside = s.x >= 0 && s.x <= VB.w && s.y >= 0 && s.y <= VB.h;
    if (!inside) return; // not on the pack → ignore entirely
    flow?.resize(); // the pack is laid out now — make sure the GL overlay matches its box
    // a tear can only START in the top or bottom crimp strip — deeper at the corners,
    // shallower across the middle. Never the side seams or the inner face.
    const nearCorner = s.x < VB.w * TEAR_CORNER_X || s.x > VB.w * (1 - TEAR_CORNER_X);
    const depth = VB.h * (nearCorner ? TEAR_CORNER_Y : TEAR_MID_Y);
    scratchOnly = s.y > depth && s.y < VB.h - depth;

    floatOn(false); // steady the pack while it's being handled — stop the idle float
    wrap.classList.remove("guide"); // they've engaged — drop the gesture hint
    sfx.grab(); // a muffled foil crinkle — the tactile "handle" the moment you grab it
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
    lastBuzzLen = 0;
    try { mountEl.setPointerCapture?.(e.pointerId); } catch { /* stray/released pointer id — fine */ }
  }

  // Idle specular: while NOT tearing, a soft highlight tracks the pointer across the
  // foil so the sealed pack reads as a held, reflective object. Pure overlay — never
  // touches the tear geometry. Off once opened or before the pack is armed.
  function hoverGloss(e) {
    if (!glossEl || opened || !armed) return;
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const gx = ((e.clientX - r.left) / r.width) * 100;
    const gy = ((e.clientY - r.top) / r.height) * 100;
    if (gx < -8 || gx > 108 || gy < -8 || gy > 108) { wrap.classList.remove("glossing"); return; }
    glossEl.style.setProperty("--gx", gx.toFixed(1) + "%");
    glossEl.style.setProperty("--gy", gy.toFixed(1) + "%");
    wrap.classList.add("glossing");
  }

  function onMove(e) {
    if (!dragging) { hoverGloss(e); return; }

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
      sfx.tearStart(tellTier); // rarer pack inside → brighter, more energetic foil rip
      sfx.startOpenTheme?.(); // THE RIP — swell the open theme up, but play only its intro then HOLD until the pack splits open
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
            sfx.rejectTone(); // a dull descending "nope" — the tear voided, can't open
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
    // Speed FIRST — the crack now answers the HAND, not just the clock: a hard yank
    // rips a wider, more violent slit; a slow pull barely parts the foil.
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    const speed = Math.hypot(e.clientX - lastClient.x, e.clientY - lastClient.y) / dt;
    peakSpeed = Math.max(peakSpeed, speed);
    lastClient = { x: e.clientX, y: e.clientY };
    lastT = now;
    const inten = Math.min(1, speed / 2.5);

    const len = pathLen(path);
    const progress = Math.min(1, len / (VB.h * 0.6));
    rebuildGap(); // updates the `crossed` flag + the crack path
    if (crossed) {
      dragging = false; // the tear completes the instant it crosses the body
      commitOpen();
      return;
    }
    // RESISTANCE: ease-in (progress^1.4) so the foil HOLDS at first then gives — the
    // early drag barely opens it; the pull SPEED then widens the slit on a hard rip.
    const eased = Math.pow(progress, 1.4);
    spring.set({ w: eased * GAP_TEAR * (1 + inten * 0.7) });

    sfx.tearMove(inten, progress); // intensity drives the rip; progress climbs the chime-up
    // spray flecks at the finger CLAMPED onto the pack (p is already clamped in
    // pack space) — a tear may start just outside the edge, and emitting at the
    // raw client point would scatter foil into the empty margin
    const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm || svg.getScreenCTM());
    // torn foil reads as PAPER: mostly matte chips (the flat fillRect sprite) with
    // the odd bright glint on a fast pull — ~3:1, so it's debris, not a sparkle shower
    particles.emit(sp.x, sp.y, { count: 1 + Math.round(inten * 3), speed: 2 + inten * 5, colors: FOIL, life: 36, shape: "chip", size: 1.9 });
    if (inten > 0.5) particles.emit(sp.x, sp.y, { count: 1, speed: 3 + inten * 4, colors: ["#fff", "#ffe7b0"], life: 24, size: 1.3 });
    // HAPTIC RATCHET — one tick per ~22px of tear travel (speed-independent), so the
    // rip feels like teeth giving way under the finger, not a single distant buzz.
    if (navigator.vibrate && len - lastBuzzLen >= 22) {
      lastBuzzLen = len;
      navigator.vibrate(5);
    }
  }

  // The tear has crossed the whole pack body → split it into two pieces and fling
  // the smaller half off. Fired the MOMENT the crack reaches the far edge (mid-
  // drag, finger still on the screen) — or on release if it crossed right as the
  // finger lifted. Guarded by `opened` so a tear only ever opens once.
  function commitOpen() {
    if (opened) return;
    opened = true;
    markTored(); // a successful open — the gesture hint never needs to show again
    // Drop the .pack drop-shadow filter for the open: the two foil pieces fling
    // every frame, and a CSS filter re-rasters the whole foil through the
    // drop-shadow each frame (mobile jank). A class (not inline style) is required
    // because the `rim` animation animates `filter` and would override an inline
    // value. The shadow is invisible mid-burst anyway. Restored in clearTear.
    wrap.classList.add("opening");
    makePieces();
    spring.set({ sep: 1 }); // pieces pull fully apart
    const power = Math.min(1, 0.6 + peakSpeed / 4);
    sfx.tearEnd(true, power); // the fibrous snap
    sfx.burst(power, tellTier); // chest-thump under the open — body + crack + felt sub, deeper for a chase
    sfx.resumeOpenTheme?.(); // FULLY OPEN — release the held intro so the rest of the theme pours in on the burst
    sfx.tearRelease(); // the small joyful "pop" — a bright resolve the chime-up built toward
    if (navigator.vibrate) navigator.vibrate([18, 30, 14]);
    burstAlongTear();
    kick(power); // a short screen-kick — the foil giving way lands with weight
    // The opening light is the card's glow leaking out the tear — the single most
    // loaded beat of the whole open. Rather than snuff it instantly, let it SHOOT
    // out, then HOLD and breathe (two surges of gathering energy) so the player gets
    // a real "what's in here?!" window before the cards spring up — and a chase
    // lingers noticeably longer than a common.
    const holdMs = 760 + tellTier * 70; // common ~760 → chase ~1390
    const dropBeat = 150; // a short breath after the light is gone, before the pack drops
    const TAKEOVER = 130; // let the spring tick brighten the shoot-out first, then own it
    // The pack must NOT drop until the god light has fully faded out — otherwise the
    // foil slides off while the light still shows and the detached shafts hang over
    // nothing (the trick shows). So we GATE the handoff on the fade actually finishing
    // (not a parallel timer), with a safety net so the flow can never hang.
    let handedOff = false;
    const handOff = () => {
      if (handedOff) return;
      handedOff = true;
      onOpen?.(); // drop the pack body + spring the cards up
    };
    const dropAfter = (ms) => {
      clearTimeout(handoffTimer);
      handoffTimer = setTimeout(handOff, ms);
    };
    setTimeout(() => {
      // hand opacity from the spring tick to a dedicated breathe→fade; the tick keeps
      // owning the bloom RADIUS (parked large), this owns brightness from here.
      lightClosing = true;
      const dur = holdMs - TAKEOVER;
      const breathe = (cur, peak) => [
        { opacity: cur.toFixed(3), offset: 0 },
        { opacity: peak.toFixed(3), offset: 0.16 }, // surge to full — the light pours out
        { opacity: (peak * 0.76).toFixed(3), offset: 0.46 }, // ease back — inhale
        { opacity: peak.toFixed(3), offset: 0.7 }, // …and swell again — energy gathering
        { opacity: "0", offset: 1 }, // crossfade out into the reveal's afterglow
      ];
      const bloomCur = parseFloat(openBloom.style.opacity) || 0.6;
      const raysCur = parseFloat(lightRays.style.opacity) || 0.6;
      if (openBloom.animate) {
        const opts = { duration: dur, easing: "ease-in-out", fill: "forwards" };
        const bloomA = openBloom.animate(breathe(bloomCur, 0.92), opts);
        const raysA = lightRays.animate(breathe(raysCur, 0.98), opts);
        lightAnims = [bloomA, raysA];
        // ONLY drop the pack once the light has actually finished fading
        raysA.addEventListener("finish", () => dropAfter(dropBeat));
        // safety net: if the finish event is ever missed (e.g. backgrounded tab), still
        // hand off so the reveal can never stall (handedOff makes whichever fires win)
        handoffTimer = setTimeout(handOff, dur + dropBeat + 400);
      } else {
        // no WAAPI — hold, fade over the tail of the window, THEN drop the pack
        const fadeMs = 300;
        setTimeout(() => {
          lightRays.style.transition = openBloom.style.transition = "opacity 0.3s ease";
          lightRays.style.opacity = openBloom.style.opacity = "0";
          dropAfter(fadeMs + dropBeat);
        }, Math.max(0, dur - fadeMs));
      }
    }, TAKEOVER);
  }

  // A brief, decaying screen-kick on the burst (a hair of scale-pop + jitter). On
  // #pack-stage via WAAPI so it overrides the exit transition while it runs and
  // lands back on identity — the stage's resting transform — well before the exit
  // slide (750 ms later). Skipped under reduced motion.
  function kick(power) {
    if (REDUCED || !mountEl.animate) return;
    const amp = 5 + power * 9; // px
    const N = 7;
    const frames = [{ transform: `translate(0px, 0px) scale(${(1 + 0.05 * power).toFixed(3)})` }];
    for (let i = 1; i <= N; i++) {
      const decay = 1 - i / N;
      const dx = (Math.random() * 2 - 1) * amp * decay;
      const dy = (Math.random() * 2 - 1) * amp * decay;
      frames.push({ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(1)` });
    }
    frames.push({ transform: "translate(0px, 0px) scale(1)" });
    mountEl.animate(frames, { duration: 260 + power * 80, easing: "ease-out", fill: "none" });
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
      sfx.silenceMusic?.(); // tear abandoned — settle back into the quiet ready screen (no-op if it never started)
      floatOn(true); // stayed one piece — resume the idle float
      setTimeout(() => {
        if (!dragging && !opened) clearTear();
      }, 420);
    }
  }

  function burstAlongTear() {
    const m = ctm || svg.getScreenCTM();
    for (const p of seam || []) {
      const c = new DOMPoint(p.x, p.y).matrixTransform(m);
      particles.emit(c.x, c.y, { count: 3, speed: 4.5, colors: FOIL, life: 50, size: 2.6, shape: "chip" }); // paper shreds
      particles.emit(c.x, c.y, { count: 1, speed: 5.5, colors: ["#fff", "#ffe7b0"], life: 30, size: 1.6 }); // a glint riding the burst
    }
  }

  // Tap an opened pack: the two pieces slide back together into one pack, then reset.
  function reset() {
    opened = false;
    if (split) {
      spring.set({ sep: 0 });
      sfx.reseal(); // a descending foil whoosh as the two halves slide back into one pack
    }
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
    gapCrack.setAttribute("points", ""); // clear the drawn crack
    gapCrack.style.opacity = 0;
    gapGlow.setAttribute("points", ""); // clear the gold leak too
    gapGlow.style.opacity = 0;
    flow?.stop(); // halt + clear the flowing-light shader
    lightClosing = false; // reset the pre-exit fade latch for the next tear
    clearTimeout(handoffTimer); // a reset mid-hold must not later drop the pack
    lightAnims.forEach((a) => a.cancel()); // drop the breathe→fade so it can't pin opacity
    lightAnims = [];
    lightRays.style.transition = openBloom.style.transition = ""; // instant reset, no carry-over fade
    openBloom.style.opacity = 0;
    openBloom.setAttribute("rx", 0);
    openBloom.setAttribute("ry", 0);
    lightRays.style.opacity = 0; // the fan of shafts goes dark with the rest
    lightRays.removeAttribute("transform");
    lightRaysPath.setAttribute("d", "");
    lightClipPoly.setAttribute("points", ""); // drop the open-side clip until the next tear
    wrap.classList.remove("opening"); // restore the drop-shadow rim (removed for the open burst)
    floatOn(true); // the pack is whole again — let it float
  }

  // listen on the whole stage so an in-progress tear keeps tracking even when
  // the finger strays off the pack mid-drag (onDown still gates the START to
  // on-pack presses; the path clamps to the pack so the line stays on it)
  mountEl.addEventListener("pointerdown", onDown);
  mountEl.addEventListener("pointermove", onMove);
  mountEl.addEventListener("pointerup", onUp);
  mountEl.addEventListener("pointercancel", onUp);
  mountEl.addEventListener("pointerleave", () => wrap.classList.remove("glossing")); // drop the idle gloss when the pointer leaves
  mountEl.addEventListener("contextmenu", (e) => e.preventDefault());
  // a press-and-drag on the SVG <image> would otherwise start a NATIVE image
  // drag (a ghost copy of the pack stuck to the cursor), hijacking the tear
  mountEl.addEventListener("dragstart", (e) => e.preventDefault());
  // the pack scales with the viewport — a resize invalidates the cached matrix
  window.addEventListener("resize", () => { ctm = ctmInv = null; flow?.resize(); });

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
    // (idle glint is now silent — the recurring spark sfx was a distracting tick)
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
      // first-ever pack → ride the drag-gesture hint down the foil; once they've
      // opened one, it never shows again
      wrap.classList.toggle("guide", v && !hasToredBefore());
    },
    // The host whispers what the pack is hiding (the rarest tier inside) so the
    // idle ambience can foreshadow it: a rarity-tinted breathing halo + tinted
    // sparks, driven off the --tell / --idle-heat vars (only above Holo).
    setTell: (peak) => {
      tellTier = peak | 0;
      const hex = TIER_HEX[tellTier] || TIER_HEX[0];
      // 0 below Double Rare (a dud pack stays dark — no false promise), then a clear
      // FLOOR so a real chase actually reads: 0.4 at Double Rare → 1.0 at Hyper.
      const heat = tellTier <= 3 ? 0 : Math.min(1, 0.4 + (tellTier - 4) * 0.12);
      mountEl.style.setProperty("--tell", hex);
      mountEl.style.setProperty("--idle-heat", heat.toFixed(2));
      mountEl.classList.toggle("chase", tellTier >= 8); // top-tier sealed → urgent idle (see .chase CSS)
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
function sunburst() {
  const N = 20; // shafts ALL the way around — the card (the bulb) shines in every
  //              direction; the foil blocks most of it and only the torn hole lets
  //              the open-side shafts out (occlusion + the open-side clip do that).
  const L = 380; // reach of the longest shaft (matches the #rays gradient radius)
  let d = "";
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2; // full circle
    const jL = Math.abs((Math.sin(i * 12.9 + 1.7) * 4391) % 1); // 0..1, deterministic
    const jW = Math.abs((Math.sin(i * 7.31 + 0.4) * 2719) % 1);
    const len = L * (0.6 + 0.4 * jL); // uneven shaft lengths
    const hw = 0.016 + 0.026 * jW; // uneven shaft widths (radians of half-angle)
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

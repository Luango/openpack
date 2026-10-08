// reveal.js — the card-stack reveal that plays once the pack tears open.
//
// The booster's cards rise out of the opening as a stack; you tap the front one
// to flick it away and bring up the next, rarest LAST. Drag the front card to
// tilt it and watch the foil play. A promo pull lands with a burst, a chime and a
// glow — and the very top editions (Team of the Season and up) get a WALKOUT
// first: the player's nation, position and club are teased one by one, in the
// dark, before the card itself drops (see walkout()).
//
// Every card lands BARE — just its frame and an empty pool of light — and its
// print is STAMPED on piece by piece: position, nation, club, the six face stats;
// then the rating counts up, slowing as it nears the number, the name lands, and
// only then, out of a swelling light, does the PLAYER appear (stampIn).
//
// THE SCATTER — when the 3D pack is popped from the BACK, its cards blow out of the
// wrapper and land FACE DOWN around the stage (the burst in pack3d/view.js; the DOM
// takes them over at the hand-off at the exact same rects — scatter()). Nothing is
// shown until the player turns a card: tap one and it flies to the centre, flips
// over and lands with the full entrance + stamp-in above (a rare holds a beat face
// down first — the tell, or the walkout); tap it again and it's flung away and the
// rest of the face-down cards wait for the next pick (pick / flipOpen / advance).
//
// Once every card is seen they fan back into the HAUL — a draggable fan SELECTOR of
// the pull: drag / swipe / wheel / arrow-keys rotate the fan to switch which card
// sits centre (popped, enlarged, glowing, with a live holo sheen). See showHaul /
// layoutHaul / the haul pointer handlers on stackEl.
//
// Reuses the shared Card (card.js), the spring (motion.js), the particle system
// (particles.js), and Web Audio (sfx.js) — the same parts the gallery + tear use.

import { renderCard } from "./card.js";
import { cardPrint, foilOf, ART_W, ART_H } from "./cardart.js";
import { prepareDissolve } from "./dissolve.js";
import { createSpring } from "./motion.js";
import { createParticles } from "./particles.js";
import { rarityToTier, tierOf, TIER_HEX, lighten } from "./rarity.js";
import { NATIONS, drawFlag, drawCrest, crestURL, emblemCanvas } from "./emblems.js";
import * as sfx from "./sfx.js";

const TILT = 12; // max pointer tilt on the front card (deg)
const FOIL_X = 13; // holo parallax half-ranges (match the lightbox feel)
const FOIL_Y = 17;
const TILT_TRACK = [0.12, 0.82]; // soft spring [stiffness, damping] while the tilt follows the pointer — smooth, no shake
const TILT_SNAP = [0.3, 0.5]; // snap every card flat fast but CLEAN — low damping = heavy friction, so it settles without bouncing
const TAP_SLOP = 8; // px of travel under which a press counts as a tap (→ advance)
// Minimum gap between two tap-advances. A finger MASHING the deck can otherwise fire
// many advances in a fraction of a second, each stacking its own WAAPI animations,
// particle burst, audio nodes and timers — a memory/compositor SPIKE that, on iOS
// Safari (a tight per-tab memory budget, with the still-resident WebGL carousel
// already near it), tips the tab over its ceiling and Safari silently RELOADS the
// page. Coalescing rapid taps to ~human cadence removes that spike. ~7 cards/sec
// still feels instant; it only swallows the inhuman machine-gun mashing.
const ADVANCE_MIN_MS = 140;
const SLIDE_SLOP = 6; // px of drag before a press becomes a slide (under this it's a tap)
const SLIDE_DRAG = 42; // px of drag that opens the stack to its full edge spread
const EXPAND_EDGE = 15; // px of side edge each card slides out to reveal — the parallel cascade step
const DEPTH_SHRINK = 0.01; // each card behind shrinks this much per stack step → a natural receding deck (keep in sync with the resting scale in index.html)
const RARE_TIER = 4; // tier ≥ this gets the flourish (burst + chime + glow) — Team of the Week and up
const WALKOUT_TIER = 7; // tier ≥ this gets the walkout (nation → position → club) — Team of the Season and up
const WALKOUT_BEAT = 700; // ms each walkout clue holds the stage
const CONFETTI = ["#ffffff", "#f7e4aa", "#d4a63a"]; // champagne-and-gold ticker tape for the top pulls

// The PRINT stamp-in pace, by tier — rarer pulls stamp slower, count longer and
// hold the player back longer, so the build scales with the pull. lead = after the
// card plants (a promo's hit gets room to land first), beat = between the
// left-column stamps, stat = between the face stats, count = the rating's
// count-up, hold = the held breath between the rating landing and the name,
// charge = the light swelling in the empty frame before the player appears.
const NAME_TO_CHARGE = 360; // ms from the name's stamp to the light starting to swell
const PLAYER_IN = 1300; // ms the player takes to dissolve onto the card out of the light
const PLAYER_SETTLE = 150; // ms after that before the swap back to the baked art
function printPace(tier) {
  const p = Math.max(0, Math.min(1, tier / 9));
  return {
    lead: 420 + (tier >= RARE_TIER ? 480 : 0),
    beat: 210 + 110 * p,
    stat: 105 + 55 * p,
    count: 1800 + 1400 * p,
    hold: 380 + 320 * p,
    charge: 700 + 600 * p,
  };
}
const pct = (v, of) => ((v / of) * 100).toFixed(4) + "%";

// Per-tier HIT escalation — the ONE dial that keeps a crescendo: a Team of the
// Week is a shimmer, only a Legend is a screen-takeover. burst = particle count,
// flash = full-stage flash opacity, rays = sunburst opacity (0 = no rays),
// fine = add the counter-rotating fine ray layer, fast = faster spin, antic =
// anticipation-tell hold (ms) before the card uncovers, slow = held beat,
// vibe = haptic pattern. Read once per reveal in flourishIfRare().
const HIT = {
  4: { burst: 28,  flash: 0.32, rays: 0,    fine: false, fast: false, antic: 280, slow: false, vibe: [10, 30, 10] },
  5: { burst: 46,  flash: 0.5,  rays: 0.4,  fine: false, fast: false, antic: 360, slow: false, vibe: [12, 36, 12] },
  6: { burst: 64,  flash: 0.62, rays: 0.55, fine: false, fast: false, antic: 450, slow: false, vibe: [14, 40, 16] },
  7: { burst: 86,  flash: 0.74, rays: 0.7,  fine: true,  fast: false, antic: 560, slow: true,  vibe: [16, 44, 18, 60, 24] },
  8: { burst: 106, flash: 0.86, rays: 0.85, fine: true,  fast: true,  antic: 670, slow: true,  vibe: [18, 50, 20, 70, 30] },
  9: { burst: 126, flash: 0.95, rays: 0.95, fine: true,  fast: true,  antic: 780, slow: true,  vibe: [22, 56, 24, 80, 36] },
};
const hitCfg = (tier) => HIT[Math.max(4, Math.min(9, tier))];

export function createReveal({ mountEl, onAgain }) {
  const host = document.createElement("div");
  host.className = "reveal hidden";
  host.innerHTML = `
    <div class="reveal__dim"></div>
    <div class="reveal__aura"></div>
    <div class="reveal__interior"></div>
    <div class="reveal__shadow"></div>
    <div class="reveal__rays"></div>
    <div class="reveal__rays reveal__rays--fine"></div>
    <div class="reveal__tell"></div>
    <div class="reveal__stack"></div>
    <canvas class="reveal__fx"></canvas>
    <div class="reveal__shock"></div>
    <div class="reveal__flash"></div>
    <p class="reveal__stamp" aria-hidden="true"></p>
    <div class="reveal__walkout" aria-hidden="true"></div>
    <div class="reveal__haul-cap" aria-hidden="true">
      <p class="hc-kicker">New signings</p>
      <p class="hc-best"></p>
    </div>
    <div class="reveal__status">
      <p class="reveal__hint"></p>
    </div>
    <p class="reveal__sr" aria-live="polite"></p>
    <button class="reveal__again" type="button" hidden>Send to Club</button>
    <!-- your CLUB: the badge the signings get vacuumed into on Send to Club; rises as the
         button drops, and bloats once per card (see collect() in this file) -->
    <div class="reveal__binder" aria-hidden="true">
      <div class="binder-icon">
        <svg viewBox="0 0 72 88" width="100%" height="100%">
          <defs>
            <linearGradient id="binder-gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#f7e4aa"/><stop offset="0.5" stop-color="#d4a63a"/><stop offset="1" stop-color="#9a701c"/>
            </linearGradient>
          </defs>
          <path d="M8 7 H64 V44 C64 63 49 76 36 82 C23 76 8 63 8 44 Z" fill="#1a140c" stroke="url(#binder-gold)" stroke-width="3.5" stroke-linejoin="round"/>
          <path d="M9.8 8.8 H62.2 V23 H9.8 Z" fill="url(#binder-gold)"/>
          <path d="M18 15.9 h36" stroke="#1a140c" stroke-width="2.4" stroke-dasharray="3 3"/>
          <path d="M36 32 l3.7 7.6 8.3 1.2 -6 5.9 1.4 8.3 -7.4 -3.9 -7.4 3.9 1.4 -8.3 -6 -5.9 8.3 -1.2z" fill="#f7e4aa"/>
          <path d="M22 64 C30 69 42 69 50 64" stroke="#d4a63a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        </svg>
      </div>
    </div>`;
  mountEl.appendChild(host);

  const stackEl = host.querySelector(".reveal__stack");
  const hintEl = host.querySelector(".reveal__hint");
  const againEl = host.querySelector(".reveal__again");
  const binderEl = host.querySelector(".reveal__binder");
  const binderIconEl = host.querySelector(".binder-icon");
  const interiorEl = host.querySelector(".reveal__interior");
  const shadowEl = host.querySelector(".reveal__shadow");
  const raysEl = host.querySelector(".reveal__rays:not(.reveal__rays--fine)");
  const raysFineEl = host.querySelector(".reveal__rays--fine");
  const flashEl = host.querySelector(".reveal__flash");
  const shockEl = host.querySelector(".reveal__shock");
  const stampEl = host.querySelector(".reveal__stamp");
  const walkoutEl = host.querySelector(".reveal__walkout");
  const haulCapEl = host.querySelector(".reveal__haul-cap");
  const srEl = host.querySelector(".reveal__sr");
  const particles = createParticles(host.querySelector(".reveal__fx"));

  // The post-tear payoff window. Every impact cue (set-down sound, haptic,
  // landing-shadow peak) locks to the card-enter overshoot DIP so the "thunk"
  // reads as one contact, not three smeared landings.
  const CONTACT_MS = 250; // ≈ 55% of the 0.46s card-enter (the dip past rest)
  const GLEAM_DELAY = 240; // the gleam sweeps just AFTER the card plants
  let peakTier = 0; // rarest tier in the pack — colours the arrival glow/embers
  let enterTimers = []; // entrance cues for the CURRENT card (cleared if it's flicked early)
  let enteringEl = null; // the slot currently mid-entrance (for cleanup)
  let arrivalTimers = []; // one-shot arrival cues (cleared on close)
  let interiorAnim = null, shadowAnim = null; // arrival glow + landing-shadow WAAPI handles

  let slots = []; // { slot, cardEl, card }
  let cards = [];
  let pos = 0; // index of the current front card
  let peeking = true; // true while still inside the pack (peeking through the gap)
  let anticipating = false; // true during the held "something rare is coming" beat
  let anticTimer = null; // the pending uncover after the anticipation tell
  let lastAdvanceT = 0; // timestamp of the last tap-advance — throttles machine-gun tapping (ADVANCE_MIN_MS)
  let walkTimers = []; // the walkout's clue beats (cleared on close/replay)
  // the scatter (the back pop): the cards lie face down round the stage and are
  // turned over one at a time; `current` is the one up at the centre (or null while
  // the player is choosing). Each face-down entry keeps its pose (entry.pose) and
  // entry.down; slots are reordered on each pick so slots[pos] is always the card up.
  let scatterMode = false;
  let current = null;

  const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // ---- press-and-drag to spread the stack ---------------------------------------
  // The stack rests as a plain front-view stack. Press and DRAG it and the cards
  // slide apart in PARALLEL (no rotation, same size) along your finger — each card
  // steps out by a fixed amount, so the front one stays on top and the rest reveal
  // only their side edge. The spread tracks your finger 1:1 (no spring); let go and
  // it eases shut. A quick tap flips to the next card. The whole stack also tilts
  // toward your finger (holo) — on press AND right through the slide, every card at
  // once — then magnet-snaps flat when you let go.
  let sliding = false; // a press-drag spread is in progress
  let dirX = 0, dirY = 0; // unit cascade direction = the drag direction

  // Slide every live card out PARALLEL by `d` steps along the drag direction. `open`
  // (0→1, from how far you've dragged) scales the spread; open 0 equals the CSS
  // resting stack, so closing can hand the slots back to CSS with no visible jump.
  // Each card behind shrinks one DEPTH_SHRINK step (the front card is full size) so
  // the fan recedes into a natural deck — a card is never bigger than the one in
  // front of it. The shrink is constant through the slide (it matches the CSS resting
  // scale at open 0), so closing hands back to CSS with no jump.
  function renderSlide(open) {
    const k = Math.max(0, Math.min(1, open));
    for (let i = 0; i < slots.length; i++) {
      if (i < pos) continue; // already flung — leave it to the .flung CSS
      const d = i - pos;
      const ty0 = 5 * d; // stacked (open 0) — mirrors the CSS resting step
      const slide = EXPAND_EDGE * d; // cracked open (open 1) — slid out d steps
      const tx = dirX * slide * k;
      const ty = ty0 + (dirY * slide - ty0) * k;
      const sc = 1 - DEPTH_SHRINK * d; // smaller the deeper it sits
      slots[i].slot.style.transform =
        `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${sc.toFixed(3)})`;
    }
  }

  // Let go → re-enable the CSS transition and clear the inline transforms so every
  // card eases back to the resting stack (a plain ease, no spring).
  function closeSlide() {
    sliding = false;
    host.classList.remove("browsing");
    void stackEl.offsetWidth; // reflow so the transition is armed before we clear
    slots.forEach((s) => { s.slot.style.transform = ""; });
  }

  // The holo tilt — ONE spring shared across the whole visible stack. The lean is a
  // rotation on the STACK CONTAINER (not per card), so the whole deck tilts as a
  // single slab and every card stays the SAME size — applying the rotation to each
  // card individually made each its own perspective trapezoid, which the cascade
  // offset then exposed as a tail that looks like it grows. The foil sheen vars stay
  // per-card (each card glints on its own). It runs SOFT while tracking the pointer
  // (smooth, no jitter) and is retuned STIFF only when snapping flat on release — so
  // the lean follows you fluidly but slams home like a magnet.
  const tiltSpring = createSpring({
    rest: { rx: 0, ry: 0, mx: 50, my: 50, px: 50, py: 50, hyp: 0 },
    stiffness: TILT_TRACK[0],
    damping: TILT_TRACK[1],
    onTick: (c) => {
      // tilt the deck as one unit (cleared to none at rest so it leaves no 3D context
      // for the haul fan, which tilts its centre card individually)
      stackEl.style.transform =
        (Math.abs(c.rx) < 0.05 && Math.abs(c.ry) < 0.05)
          ? ""
          : `rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg)`;
      // Only the front few cards are actually visible (the rest are stacked behind it,
      // shrunk, showing at most a 15px sliver when spread). Writing the foil vars to
      // ALL of them re-ran style/paint on every card per frame — the worst of the
      // mobile drag cost. Cap to the front three: the glint you can see, nothing more.
      const end = Math.min(slots.length, pos + 3);
      for (let i = pos; i < end; i++) {
        const ce = slots[i].cardEl;
        ce.style.setProperty("--mx", c.mx.toFixed(1) + "%");
        ce.style.setProperty("--my", c.my.toFixed(1) + "%");
        ce.style.setProperty("--posx", c.px.toFixed(1) + "%");
        ce.style.setProperty("--posy", c.py.toFixed(1) + "%");
        ce.style.setProperty("--hyp", c.hyp.toFixed(3));
      }
    },
  });

  // lean the whole stack toward the finger (holo), measured against the deck centre
  function tiltToward(px, py) {
    const r = stackEl.getBoundingClientRect();
    const cx = Math.max(-1, Math.min(1, (px - (r.left + r.width / 2)) / (r.width / 2)));
    const cy = Math.max(-1, Math.min(1, (py - (r.top + r.height / 2)) / (r.height / 2)));
    tiltSpring.tune(TILT_TRACK[0], TILT_TRACK[1]); // soft follow — no shake
    tiltSpring.set({
      rx: cy * TILT,
      ry: -cx * TILT,
      mx: 50 + cx * 50,
      my: 50 + cy * 50,
      px: 50 + cx * FOIL_X,
      py: 50 + cy * FOIL_Y,
      hyp: Math.min(1, Math.hypot(cx, cy)),
    });
  }

  function flat() {
    tiltSpring.tune(TILT_SNAP[0], TILT_SNAP[1]); // stiffen first so it snaps home like a magnet
    tiltSpring.set({ rx: 0, ry: 0, mx: 50, my: 50, px: 50, py: 50, hyp: 0 });
  }

  // Render + load the whole stack UP FRONT, behind the still-sealed pack, so the
  // top card sits INSIDE the pack and peeks through the tear gap as you rip — and
  // there's nothing to fetch or build when the pack finally opens.
  function prepare(packCards) {
    clearWalkout();
    cards = packCards || [];
    pos = 0;
    sliding = false;
    anticipating = false;
    clearTimeout(anticTimer);
    clearArrival();
    clearEnter();
    host.classList.remove("browsing", "iridescent", "telling", "held", "show-status", "haul", "haul-live", "scatter", "picked");
    scatterMode = false;
    current = null;
    stackEl.style.visibility = "";
    haulDragging = false;
    stopHaulLoop();
    tiltSpring.stop();
    cancelPrints();
    stackEl.innerHTML = "";
    slots = [];
    againEl.hidden = true;
    hintEl.textContent = ""; // no hint until the cards are out
    srEl.textContent = "";
    // the arrival glow + embers read the rarest card's colour
    peakTier = cards.length ? Math.max(...cards.map(rarityToTier)) : 0;
    host.style.setProperty("--tell", TIER_HEX[peakTier] || TIER_HEX[0]);
    interiorEl.style.opacity = "0";
    shadowEl.style.opacity = "0";
    clearHit();
    // NOTE: stay hidden. The cards (images) still load while display:none, but the
    // stack isn't shown until the pack is grabbed (wake) — so it's never exposed
    // while the pack is floating or sliding back in after "Open another".
    //
    // Build the slots ONE PER FRAME instead of all at once: each makeSlot parses a
    // card's innerHTML, wires its pointer handlers and seeds an image, so rendering the
    // whole hand on a single frame stalls the still-animating carousel behind the sealed
    // pack — the "卡一下" right as the entrance lands. Spreading them keeps every frame
    // light; layout() runs after the last so the peek stack is positioned in one pass.
    // Returns a promise the caller awaits before arming the pack (so a tear can't fire
    // mid-build); a synchronous fast path keeps an empty pack instant.
    if (!cards.length) { layout(); return Promise.resolve(); }
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        slots.push(makeSlot(cards[i]));
        if (++i < cards.length) { requestAnimationFrame(step); return; }
        layout(); // the front card sits in "peek" position behind the pack
        resolve();
      };
      step();
    });
  }

  // Bring the stack in behind the pack the moment it's grabbed to tear (the pack
  // is sealed and covering, so the cards stay hidden until the gap opens).
  function wake(mode) {
    if (!slots.length) return;
    host.classList.remove("hidden");
    // the back route's cards come OUT of the 3D pack (its burst) and only exist here
    // from the hand-off — keep the DOM stack out of sight until then, so nothing peeks
    // out from behind the pack as it's hauled about
    stackEl.style.visibility = mode === "back" ? "hidden" : "";
  }

  // Open the prepared stack — instant. The pack drops away (CSS, body.revealing),
  // uncovering the SAME stack that was inside it, in place — no card springs or
  // pops out; the top card is simply there once the foil is gone.
  // THE ARRIVAL — the few seconds after the tear opens. The pack slides off and
  // the pre-rendered stack is uncovered IN PLACE, but instead of a lone card
  // popping onto a dark stage, the haul is PRESENTED: a warm afterglow bridges the
  // handoff (no dark trough), the deeper cards riffle into their step so you SEE
  // it's a hand of N, the hero LANDS with weight (overshoot + set-down + haptic +
  // shadow on one contact frame), a gleam sweeps the fresh card, embers settle,
  // and the count pips fade in once it's planted. Humble for a common; the rare
  // build is layered on top by flourishIfRare (unchanged).
  function show(opts) {
    if (!slots.length) return;
    if (opts?.scatter) { scatter(opts.scatter); return; } // the back pop: the cards lie face down
    host.classList.remove("hidden"); // ensure visible (normally already woken on grab)
    document.body.classList.add("revealing"); // the pack drops away + stops taking taps
    particles.resize(); // the canvas was sized while hidden (zero rect) — re-measure
    peeking = false;
    layout(); // the top card is now interactive (it never moved — just uncovered)

    // AFTERGLOW — the opening blooms warm then settles to a PARKED low glow, so
    // the stage never cuts to black. It's the sole settle owner and overlaps the
    // treasure-light's ~600ms fade, bridging the foil-exit handoff (no trough).
    interiorAnim?.cancel();
    interiorAnim = interiorEl.animate(
      [{ opacity: 0 }, { opacity: 0.7, offset: 0.16 }, { opacity: 0.16 }],
      { duration: 760, easing: "ease-out", fill: "forwards" }
    );

    dealIn(); // the deeper cards riffle in → the haul reads as N cards
    landingShadow(); // a floor shadow punches on the contact frame → weight
    embers(); // a few warm motes settle from the burst (modest — never out-sparkles a rare)
    enter(slots[pos], true); // the hero lands with weight (arrival → fire the contact cues)
    updateHint();
    flourishIfRare();
    // the count + teach line fade in AFTER the card lands (the eye hits the card first)
    arrivalTimers.push(setTimeout(() => host.classList.add("show-status"), 380));
    // …and a soft ascending tick per card articulates the haul size
    for (let i = 0; i < cards.length; i++) {
      arrivalTimers.push(setTimeout(() => sfx.pipTone(i), 420 + i * 70));
    }
  }

  // ---- THE SCATTER (the back pop) -----------------------------------------------
  // The 3D pack blew its cards out and they lie face DOWN in a spread; `layout` is
  // their on-screen rects from pack3d/view.js (`poses`: centre, width, tilt — one per
  // card, in card order). Each slot takes that exact pose, shows its back, and fades in
  // over the 3D card as it fades out underneath (the same image at the same rect),
  // then waits to be picked. The blown-open wrapper only drops away once the swap
  // is done: the 3D cards ride the stage, so it can't move while they still show.
  function scatter(poses) {
    if (!slots.length) return;
    clearWalkout();
    clearArrival();
    host.classList.remove("hidden");
    host.classList.add("scatter");
    scatterMode = true;
    current = null;
    peeking = false;
    particles.resize(); // the canvas was sized while hidden (zero rect) — re-measure
    const r = stackEl.getBoundingClientRect();
    const scx = r.left + r.width / 2, scy = r.top + r.height / 2, sw = r.width || 1;
    const byIndex = new Map((poses || []).map((l) => [l.i, l]));
    slots.forEach((s, i) => {
      const l = byIndex.get(i) || ringSpot(i, slots.length, r);
      s.pose = { dx: l.cx - scx, dy: l.cy - scy, rot: l.rot || 0, sc: (l.w || sw * 0.48) / sw };
      s.order = l.order ?? i;
      s.down = true;
      s.slot.classList.add("facedown");
      s.slot.classList.remove("front", "flung", "picking");
      s.slot.style.transition = "none"; // land on the pose, don't slide to it from the stack
      s.slot.style.opacity = "0";
      placeFacedown(s, false);
    });
    void stackEl.offsetWidth; // commit the poses before the transitions come back
    layout();
    stackEl.style.visibility = "";
    requestAnimationFrame(() => {
      for (const s of slots) s.slot.style.transition = "";
      requestAnimationFrame(() => { for (const s of slots) if (s.down) s.slot.style.opacity = "1"; }); // the cross-fade
    });
    arrivalTimers.push(setTimeout(() => { for (const s of slots) s.slot.style.opacity = ""; }, 560)); // then the CSS owns it
    arrivalTimers.push(setTimeout(() => document.body.classList.add("revealing"), 460)); // the spent wrapper drops away
    // the afterglow + a few embers, as the stack arrival has — the stage never cuts to black
    interiorAnim?.cancel();
    interiorAnim = interiorEl.animate(
      [{ opacity: 0 }, { opacity: 0.6, offset: 0.2 }, { opacity: 0.16 }],
      { duration: 900, easing: "ease-out", fill: "forwards" }
    );
    embers();
    hintEl.textContent = "Tap a card to turn it over";
    arrivalTimers.push(setTimeout(() => host.classList.add("show-status"), 600));
    updateHint();
  }
  // a fallback pose (no layout from the 3D pack): a loose ring round the centre
  function ringSpot(i, n, r) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { cx: r.left + r.width / 2 + Math.cos(a) * r.width * 0.75, cy: r.top + r.height / 2 + Math.sin(a) * r.height * 0.62, w: r.width * 0.48, rot: (i % 2 ? 1 : -1) * 8, order: i };
  }
  // write a face-down card's pose; `pushed` eases it outward (and the CSS shrinks it via
  // --shy) while another card is up at the centre, so the hero has the stage
  function placeFacedown(entry, pushed) {
    const p = entry.pose;
    if (!p) return;
    const k = pushed ? 1.22 : 1;
    entry.slot.style.transform =
      `translate(${(p.dx * k).toFixed(1)}px, ${(p.dy * k).toFixed(1)}px) rotate(${p.rot.toFixed(2)}deg) scale(calc(${p.sc.toFixed(4)} * var(--shy, 1)))`;
  }

  // THE PICK — a face-down card is tapped: it becomes the current card (moved to the
  // front of the order so everything below reads slots[pos]), the others ease aside,
  // and it flies to the centre still face down. A common is turned over at once; a
  // rare holds there a beat on the rising tell (the top editions get the walkout)
  // and is only then flipped — then it lands + stamps in exactly like a stack card.
  function pick(entry) {
    if (!scatterMode || current || anticipating || !entry.down || peeking) return;
    if (host.classList.contains("held")) return;
    current = entry;
    const i = slots.indexOf(entry);
    if (i !== pos) { slots.splice(i, 1); slots.splice(pos, 0, entry); }
    host.classList.add("picked");
    entry.slot.classList.add("picking");
    entry.slot.style.pointerEvents = "none";
    entry.slot.style.zIndex = "150";
    for (const s of slots) if (s !== entry && s.down) { placeFacedown(s, true); s.slot.style.pointerEvents = "none"; }
    hintEl.textContent = "";
    sfx.flick();
    if (navigator.vibrate) navigator.vibrate(6);
    const tier = rarityToTier(entry.card);
    flyToCentre(entry, () => {
      if (tier >= RARE_TIER) {
        // ANTICIPATION — the card is up but still face down: its colour leaks up behind
        // it, the world dims, a riser climbs (or the walkout plays) before it's turned
        anticipating = true;
        const cfg = hitCfg(tier);
        host.style.setProperty("--tier-color", TIER_HEX[tier]);
        host.classList.add("telling");
        if (navigator.vibrate) navigator.vibrate(8);
        const uncover = () => {
          host.classList.remove("telling");
          anticipating = false;
          flipOpen(entry, () => landed(entry));
        };
        if (tier >= WALKOUT_TIER && !REDUCED) { walkout(entry.card, tier, uncover); return; }
        const wait = REDUCED ? Math.min(220, cfg.antic) : cfg.antic;
        sfx.riser(tier, wait); // duration = the actual hold, so the climax lands on the turn
        anticTimer = setTimeout(uncover, wait);
        return;
      }
      flipOpen(entry, () => landed(entry));
    });
  }
  // the picked card flies from its spot to the centre, growing to full size, face down
  function flyToCentre(entry, done) {
    const slot = entry.slot;
    const from = slot.style.transform;
    const to = "translate(0px, 0px) rotate(0deg) scale(1)";
    if (REDUCED || !slot.animate) { slot.style.transform = to; arrivalTimers.push(setTimeout(done, 80)); return; }
    const a = slot.animate([{ transform: from }, { transform: to }], { duration: 480, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" });
    a.onfinish = () => { slot.style.transform = to; a.cancel(); done(); };
  }
  // THE FLIP — the card turns over at the centre: its back swings edge-on, the face
  // swaps in behind the edge and swings flat, ending exactly on the entrance's first
  // pose so `enter` carries straight on from it (no jump).
  function flipOpen(entry, done) {
    const slot = entry.slot;
    const { rise, from } = enterVars(entry);
    const land = `translateY(${rise}px) scale(${from})`;
    const swap = () => { slot.classList.remove("facedown", "picking"); entry.down = false; };
    if (REDUCED || !slot.animate) { swap(); slot.style.transform = ""; done(); return; }
    const a1 = slot.animate(
      [{ transform: "perspective(1100px) rotateY(0deg) scale(1)" }, { transform: "perspective(1100px) rotateY(90deg) scale(1.04)" }],
      { duration: 200, easing: "ease-in", fill: "forwards" }
    );
    a1.onfinish = () => {
      a1.cancel();
      swap();
      sfx.cardTap(0); // the card slapping over
      const a2 = slot.animate(
        [{ transform: "perspective(1100px) rotateY(-90deg) scale(1.04)" }, { transform: `perspective(1100px) rotateY(0deg) ${land}` }],
        { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)", fill: "forwards" }
      );
      a2.onfinish = () => { slot.style.transform = ""; a2.cancel(); done(); };
    };
  }
  // turned over: it's the front card now — it lands with weight and its print goes on
  function landed(entry) {
    layout();
    enter(entry, true);
    landingShadow();
    flourishIfRare();
    updateHint();
  }
  // the centre card has been flung: the stage goes back to the face-down spread
  function returnToScatter() {
    host.classList.remove("picked", "iridescent");
    clearHit();
    for (const s of slots) if (s.down) placeFacedown(s, false);
    hintEl.textContent = "Tap a card to turn it over";
    updateHint();
  }

  // Riffle the deeper cards (depth ≥ 1) from flush-behind-the-front into their
  // resting step, staggered — like a dealer laying down the hand, so the player
  // sees how many they got. The front card is owned by card-enter, not this. Each
  // ends on the CSS resting transform, so cancelling on finish hands back to CSS
  // with no jump.
  function dealIn() {
    if (REDUCED) return; // reduced motion: the cards just sit at their resting step
    for (let i = pos + 1; i < slots.length; i++) {
      const d = i - pos;
      if (d > 4) continue; // only the visible front few read
      const sc = (1 - DEPTH_SHRINK * d).toFixed(3); // matches the CSS resting scale
      const slot = slots[i].slot;
      const a = slot.animate(
        [
          { transform: `translateY(0px) scale(${sc})` }, // flush behind the front
          { transform: `translateY(${(5 * d).toFixed(1)}px) scale(${sc})` }, // resting step (= CSS rest)
        ],
        { duration: 175, delay: 26 * d, easing: "cubic-bezier(0.2,0.8,0.3,1)", fill: "both" }
      );
      a.onfinish = () => a.cancel(); // drop to CSS rest (identical value → no jump)
      setTimeout(() => sfx.cardTap(d), 26 * d); // a soft riffle tap as each card lays down → the haul reads as N cards
    }
  }

  // A soft floor shadow under the stack that darkens + tightens on the contact
  // frame, then settles faint — weight on arrival. Transform/opacity only.
  function landingShadow() {
    if (REDUCED) return;
    shadowAnim?.cancel();
    shadowAnim = shadowEl.animate(
      [
        { opacity: 0, transform: "translate(-50%,-50%) scaleX(1.3) scaleY(0.72)" },
        { opacity: 0.5, transform: "translate(-50%,-50%) scaleX(0.92) scaleY(0.6)", offset: 0.55 }, // contact
        { opacity: 0.18, transform: "translate(-50%,-50%) scaleX(1) scaleY(0.62)" },
      ],
      { duration: 460, easing: "cubic-bezier(0.22,1.16,0.32,1)", fill: "forwards" }
    );
  }

  // A handful of warm motes drifting up + settling from the opening — the dust
  // after the burst. Modest by design so a common never approaches the rare hit's
  // particle shower (escalation stays monotonic).
  function embers() {
    const r = host.getBoundingClientRect();
    const hex = TIER_HEX[peakTier] || TIER_HEX[0];
    particles.emit(r.left + r.width / 2, r.top + r.height * 0.44, {
      count: 14, speed: 1.6, spread: Math.PI * 2,
      colors: ["#ffffff", lighten(hex, 0.5), hex],
      gravity: 0.05, life: 72, size: 2.2, bloom: true,
    });
  }

  // Play the land-and-settle entrance on a slot's card. `arrival` fires the
  // multi-sensory contact (set-down + haptic) on the overshoot dip — the "thunk".
  // A gleam sweeps just after the plant. All cues are tracked so a fast tap-advance
  // can't fire a set-down/gleam on a card that's already been flicked away.
  function enter(entry, arrival = false) {
    if (!entry) return;
    clearEnter(); // cancel any in-flight cues from the previous card
    const el = entry.slot;
    enteringEl = el;
    // Scale the entrance AMPLITUDE by tier (the card itself punches, not just the
    // backdrop): a common sets down gently on the defaults; a chase drops from
    // higher, overshoots deeper, and pops larger. Timing is fixed (see the CSS) so
    // the contact dip stays locked to the impact cues. punch: 0 below Team of the Week → 1 at Legend.
    enterVars(entry);
    el.classList.remove("entering", "gleaming");
    void el.offsetWidth; // restart the keyframe if it was mid-play
    el.classList.add("entering");
    enterTimers.push(setTimeout(() => el.classList.remove("entering"), 480));
    enterTimers.push(setTimeout(() => el.classList.add("gleaming"), GLEAM_DELAY));
    enterTimers.push(setTimeout(() => el.classList.remove("gleaming"), GLEAM_DELAY + 640));
    if (arrival) {
      enterTimers.push(setTimeout(() => {
        sfx.setDown();
        if (!REDUCED && navigator.vibrate) navigator.vibrate(12);
      }, CONTACT_MS));
    }
    stampIn(entry); // …and once it's planted, its print goes on
  }

  // The entrance's amplitude, by tier, written as the card-enter keyframe vars (and
  // returned, so the scatter's flip can end exactly on the entrance's first pose).
  // A common starts EXACTLY where it already sat as the card behind (the depth-1
  // resting pose: 5px down, 1% smaller — see the CSS stack step) so the swap reads
  // as the front card being lifted off a real deck, with nothing jumping or
  // fading underneath. A rare (uncovered after the hold) still rises from deeper.
  function enterVars(entry) {
    const el = entry.slot;
    const punch = Math.max(0, Math.min(1, (rarityToTier(entry.card) - 3) / 6));
    const rise = +(5 + punch * 40).toFixed(0), from = +(0.99 - punch * 0.12).toFixed(3);
    el.style.setProperty("--enter-rise", rise + "px");
    el.style.setProperty("--enter-dip", (-(6 + punch * 12)).toFixed(0) + "px");
    el.style.setProperty("--enter-pop", (1.015 + punch * 0.05).toFixed(3));
    el.style.setProperty("--enter-from", String(from));
    return { rise, from };
  }

  // ---- the print: stamped on piece by piece, the player last --------------------
  // The card lands BARE (card.imageBare: the frame, the empty pool of light where
  // the player will stand, two rules) and the rest comes on in loose canvases
  // (cardPrint): position → nation → club → the six face stats, each slamming down
  // with a "pap" and a jolt through the card; then the rating COUNTS UP on an
  // ease-out — the early points fly, the last few crawl, each clicking louder and
  // higher, and the final one lands with a slam — a held breath, and the name.
  // Then the light in the empty frame swells under a riser and the PLAYER comes out
  // of it — the photo DISSOLVING onto the card grain by grain from the head down,
  // a hot edge riding the front (dissolve.js) — with a burst. Then the baked art
  // (pixel-identical) swaps back in under the pieces and a gleam sweeps the
  // finished card. A tap mid-way finishes it at once (advance); the next tap moves
  // on. State lives on the entry: entry.bare until committed, entry.print while
  // it's going on.
  function stampIn(entry) {
    if (!entry.bare || entry.print) return;
    const st = { timers: [], raf: 0, pieces: null, layer: null, glow: null, dissolve: null, dissolveRaf: 0, fx: [], shown: new Set(), counted: false, done: false };
    entry.print = st;
    const tier = rarityToTier(entry.card);
    const pace = printPace(tier);
    cardPrint(entry.card).then((pieces) => {
      if (entry.print !== st || st.done) return; // finished or torn down meanwhile
      st.pieces = new Map(pieces.map((pc) => [pc.key, pc]));
      const layer = (st.layer = document.createElement("div"));
      layer.className = "card__print";
      layer.setAttribute("aria-hidden", "true");
      for (const pc of pieces) {
        const [x, y, w, h] = pc.box;
        pc.canvas.className = "print-piece";
        Object.assign(pc.canvas.style, { left: pct(x, ART_W), top: pct(y, ART_H), width: pct(w, ART_W), height: pct(h, ART_H) });
        layer.append(pc.canvas);
      }
      entry.cardEl.append(layer);

      const at = (ms, fn) => st.timers.push(setTimeout(fn, ms));
      let t = pace.lead;
      for (const key of ["pos", "nation", "club"]) { at(t, () => stampPiece(entry, key, 0.45)); t += pace.beat; }
      for (let i = 0; i < 6; i++) { at(t, () => stampPiece(entry, `stat${i}`, 0.15)); t += pace.stat; }
      t += pace.beat;
      at(t, () => countUp(entry, pace.count, tier));
      t += pace.count;
      at(t, () => landRating(entry)); // on time even if rAF is throttled
      t += pace.hold;
      at(t, () => stampPiece(entry, "name", 1));
      t += NAME_TO_CHARGE;
      at(t, () => charge(entry, pace.charge, tier));
      t += pace.charge;
      at(t, () => playerIn(entry, tier));
      t += PLAYER_IN + PLAYER_SETTLE;
      at(t, () => { st.done = true; commitPrint(entry, true); });
    }, () => commitPrint(entry));
  }

  // One piece slams down: in from big + clear (accelerating, like a stamp coming
  // down), a squash on contact, settle. weight 0 (a stat) … 1 (the name) scales the
  // drop, the sound and the jolt.
  function stampPiece(entry, key, weight) {
    const st = entry.print;
    const pc = st?.pieces?.get(key);
    if (!pc) return;
    st.shown.add(key);
    const dur = 260 + weight * 180;
    pc.canvas.animate(
      [
        { opacity: 0, transform: `scale(${(1.8 + weight * 0.7).toFixed(2)})`, easing: "cubic-bezier(0.55, 0, 0.9, 0.5)" },
        { opacity: 1, transform: `scale(${(0.94 - weight * 0.04).toFixed(2)})`, offset: 0.62, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: dur, fill: "forwards" }
    );
    st.timers.push(setTimeout(() => contact(entry, pc, weight), dur * 0.62));
  }

  // the moment a piece hits the card: the "pap", a jolt through the card, a buzz,
  // and — for the rating and the name — a burst of light where it landed
  function contact(entry, pc, weight) {
    sfx.stamp(weight);
    if (weight >= 0.4 && navigator.vibrate) navigator.vibrate(Math.round(6 + weight * 12));
    entry.cardEl.animate(
      [
        { transform: "translateY(0px) scale(1)" },
        { transform: `translateY(${(1 + weight * 3).toFixed(1)}px) scale(${(0.994 - weight * 0.014).toFixed(3)})`, offset: 0.3 },
        { transform: "translateY(0px) scale(1)" },
      ],
      { duration: 180 + weight * 140, easing: "ease-out" }
    );
    const layer = entry.print?.layer;
    if (weight < 0.8 || !layer) return;
    const [x, y, w, h] = pc.box;
    const f = document.createElement("div");
    f.className = "print-flash";
    Object.assign(f.style, { left: pct(x + w / 2, ART_W), top: pct(y + h / 2, ART_H), width: pct(Math.max(w, h) * 1.25, ART_W) });
    layer.append(f);
    const a = f.animate(
      [
        { opacity: 0, transform: "translate(-50%, -50%) scale(0.35)" },
        { opacity: 0.9, transform: "translate(-50%, -50%) scale(0.8)", offset: 0.18 },
        { opacity: 0, transform: "translate(-50%, -50%) scale(1.5)" },
      ],
      { duration: 520, easing: "ease-out" }
    );
    a.onfinish = () => f.remove();
  }

  // The rating counts up from 0 on an ease-out (cubic): it races through the low
  // numbers, then each point comes slower than the last — the final few pulse in
  // one by one, and the last waits longest before landRating slams it home.
  function countUp(entry, ms, tier) {
    const st = entry.print;
    const pc = st?.pieces?.get("ovr");
    if (!pc) return;
    st.shown.add("ovr");
    const target = Math.max(1, Number(entry.card.ovr) || 0);
    let shown = 0;
    pc.paint(0);
    pc.canvas.animate(
      [{ opacity: 0, transform: "scale(1.3)" }, { opacity: 1, transform: "scale(1)" }],
      { duration: 220, easing: "ease-out", fill: "forwards" }
    );
    const t0 = performance.now();
    const step = (now) => {
      if (entry.print !== st || st.counted) return;
      const k = Math.min(1, (now - t0) / ms);
      const v = Math.min(target - 1, Math.floor(target * (1 - (1 - k) ** 3))); // the last point is landRating's
      if (v > shown) {
        shown = v;
        pc.paint(v);
        sfx.countTick(v / target);
        if (target - v <= 5) {
          pc.canvas.animate([{ transform: "scale(1.09)" }, { transform: "scale(1)" }], { duration: 170, easing: "ease-out" });
        }
      }
      if (k < 1) st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  }

  // the rating's final point: it lands big and slams down onto the card
  function landRating(entry) {
    const st = entry.print;
    const pc = st?.pieces?.get("ovr");
    if (!pc || st.counted) return;
    st.counted = true;
    cancelAnimationFrame(st.raf);
    pc.paint();
    pc.canvas.animate(
      [
        { transform: "scale(1.45)", easing: "cubic-bezier(0.55, 0, 0.9, 0.5)" },
        { transform: "scale(0.92)", offset: 0.5, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
        { transform: "scale(1)" },
      ],
      { duration: 320 }
    );
    st.timers.push(setTimeout(() => contact(entry, pc, 0.85), 160));
  }

  // THE BUILD before the player — everything says "something's coming" at once,
  // so it reads on a bright silver card as well as a dark promo: the empty pool of
  // light where the player will stand swells (under the player's canvas, so the
  // player comes out of it); the card's own silhouette glow pulses up round its
  // edge against the dark stage, quicker and brighter each time; the card trembles
  // harder and harder; and a riser climbs to peak as the player appears.
  function charge(entry, ms, tier) {
    const st = entry.print;
    const pc = st?.pieces?.get("player");
    if (!pc?.focus || !st.layer) return;
    const p = Math.max(0, Math.min(1, tier / 9));
    const [fx, fy, r] = pc.focus;
    // the dissolve's noise field and foil cast are built now, while the light
    // swells, so the player's first grain lands on time rather than after a hitch
    if (!REDUCED && !st.dissolve) st.dissolve = prepareDissolve(pc.canvas, { focus: pc.focus, color: TIER_HEX[tier] || TIER_HEX[0], foil: foilOf(entry.card.edition) });
    const g = (st.glow = document.createElement("div"));
    g.className = "print-charge";
    Object.assign(g.style, { left: pct(fx, ART_W), top: pct(fy, ART_H), width: pct(r * 2.2, ART_W) });
    st.layer.prepend(g);
    st.fx.push(g.animate(
      [
        { opacity: 0, transform: "translate(-50%, -50%) scale(0.45)" },
        { opacity: 0.5, transform: "translate(-50%, -50%) scale(0.8)", offset: 0.65 },
        { opacity: 0.95, transform: "translate(-50%, -50%) scale(1.05)" },
      ],
      { duration: ms, easing: "cubic-bezier(0.5, 0, 0.9, 0.6)", fill: "forwards" }
    ));
    // the rim glow: three pulses, each closer and brighter, ending full
    const rim = entry.cardEl.querySelector(".card__glow");
    if (rim) {
      const base = +getComputedStyle(rim).opacity || 0;
      st.fx.push(rim.animate(
        [
          { opacity: base },
          { opacity: Math.max(base, 0.45), offset: 0.3 },
          { opacity: base * 0.6, offset: 0.45 },
          { opacity: Math.max(base, 0.7), offset: 0.66 },
          { opacity: base * 0.5, offset: 0.76 },
          { opacity: 0.9, offset: 0.9 },
          { opacity: 1 },
        ],
        { duration: ms, easing: "ease-in", fill: "forwards" }
      ));
    }
    // the tremble: random little shoves that grow to the end
    const amp = 1.2 + p * 1.8;
    const N = Math.round(ms / 40);
    const frames = [];
    for (let i = 0; i <= N; i++) {
      const k = (i / N) ** 1.6;
      const a = i === 0 || i === N ? 0 : amp * k;
      frames.push({ transform: `translate(${((Math.random() * 2 - 1) * a).toFixed(2)}px, ${((Math.random() * 2 - 1) * a).toFixed(2)}px)` });
    }
    st.fx.push(entry.cardEl.animate(frames, { duration: ms, easing: "linear" }));
    sfx.riser(tier, ms);
    if (navigator.vibrate) navigator.vibrate(6);
  }

  // THE PLAYER APPEARS — the light bursts and the player stands on the card cast
  // in the edition's FOIL (bronze, silver, gold…), then DISSOLVES out of it into
  // the photo: the metal turns to photo grain by grain, the face first (where the
  // light was) and the body sweeping down after it, a glint rolling down the foil
  // ahead of the front, a hot edge in the edition's colour riding the front and
  // motes lifting off it (dissolve.js); the rim glow settles back, the card takes
  // the blow and the impact lands. Reduced motion (or no photo to dissolve)
  // simply fades the player in.
  function playerIn(entry, tier) {
    const st = entry.print;
    const pc = st?.pieces?.get("player");
    if (!pc) return;
    st.shown.add("player");
    st.fx.forEach((a) => a.cancel());
    st.fx = [];
    const [fx, fy] = pc.focus || [ART_W / 2, ART_H / 2];
    const hex = TIER_HEX[tier] || TIER_HEX[0];
    const dz = st.dissolve || (REDUCED ? null : (st.dissolve = prepareDissolve(pc.canvas, { focus: pc.focus, color: hex, foil: foilOf(entry.card.edition) })));
    if (dz) {
      dz.frame(0); // the whole player in foil, nothing of the photo yet — just the first glow at the head
      pc.canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: "forwards" });
      const r = entry.cardEl.getBoundingClientRect();
      const motes = ["#ffffff", "#fff4d6", lighten(hex, 0.5)];
      const t0 = performance.now();
      let tick = 0;
      const step = (now) => {
        if (st.dissolve !== dz) return; // finished or torn down meanwhile
        const u = Math.min(1, (now - t0) / PLAYER_IN);
        // ease in-out: the face gathers out of the light, then the front rushes
        // down the body and eases onto the hem
        const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        dz.frame(e * dz.end);
        // a mote lifts off the glowing front every other frame
        if ((tick++ & 1) === 0 && u < 0.92) {
          const at = dz.sample();
          if (at) {
            particles.emit(r.left + (at[0] / ART_W) * r.width, r.top + (at[1] / ART_H) * r.height, {
              count: 1, speed: 1.1, dir: -Math.PI / 2, spread: 1.4, colors: motes, gravity: -0.015, life: 36, size: 1.7,
            });
          }
        }
        if (u < 1) { st.dissolveRaf = requestAnimationFrame(step); return; }
        dz.finish();
        st.dissolve = null;
        st.dissolveRaf = 0;
      };
      st.dissolveRaf = requestAnimationFrame(step);
    } else {
      const origin = `${pct(fx, ART_W)} ${pct(fy, ART_H)}`;
      pc.canvas.style.transformOrigin = origin;
      pc.canvas.animate(
        [
          { opacity: 0, transform: "translateY(3%) scale(0.94)", easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
          { opacity: 0, transform: "translateY(0%) scale(1.02)", offset: 0.22 },
          { opacity: 1, transform: "translateY(0%) scale(1.01)", offset: 0.28 },
          { opacity: 1, transform: "translateY(0%) scale(1)" },
        ],
        { duration: PLAYER_IN, fill: "forwards" }
      );
    }
    st.glow?.animate(
      [
        { opacity: 0.95, transform: "translate(-50%, -50%) scale(1.05)" },
        { opacity: 0, transform: "translate(-50%, -50%) scale(1.9)" },
      ],
      { duration: 650, easing: "cubic-bezier(0.15, 0.7, 0.3, 1)", fill: "forwards" }
    );
    // the rim glow eases back down to wherever the CSS has it (no fill → no jump)
    const rim = entry.cardEl.querySelector(".card__glow");
    if (rim) rim.animate([{ opacity: 1 }, { opacity: +getComputedStyle(rim).opacity || 0 }], { duration: 900, easing: "ease-out" });
    sfx.playerReveal(tier);
    if (navigator.vibrate) navigator.vibrate([12, 30, 18]);
    entry.cardEl.animate(
      [
        { transform: "translateY(0px) scale(1)" },
        { transform: "translateY(3px) scale(0.985)", offset: 0.3 },
        { transform: "translateY(0px) scale(1)" },
      ],
      { duration: 320, easing: "ease-out" }
    );
    const rb = entry.cardEl.getBoundingClientRect();
    particles.emit(rb.left + (fx / ART_W) * rb.width, rb.top + (fy / ART_H) * rb.height, {
      count: 10 + tier * 5, speed: 5.5, spread: Math.PI * 2,
      // light tones only — a darker metal's own colour reads as specks on the glowing front
      colors: ["#ffffff", "#fff4d6", lighten(hex, 0.7)], gravity: 0.04, life: 64, size: 2.4, bloom: true,
    });
  }

  // stop a dissolve mid-flight and put the finished player back (finishPrint,
  // commitPrint, cancelPrints)
  function stopDissolve(st) {
    if (!st?.dissolve) return;
    cancelAnimationFrame(st.dissolveRaf);
    st.dissolve.finish();
    st.dissolve = null;
    st.dissolveRaf = 0;
  }

  // A tap mid-stamp: every piece still to come lands at once (one quick fade and a
  // single stamp), the rating jumps to its number, the player is simply there, and
  // the card commits.
  function finishPrint(entry) {
    const st = entry.print;
    if (!st || st.done) return;
    st.done = true;
    st.timers.forEach(clearTimeout);
    st.timers = [];
    cancelAnimationFrame(st.raf);
    st.counted = true;
    if (!st.pieces) { commitPrint(entry); return; }
    st.pieces.get("ovr").paint();
    st.fx.forEach((a) => a.cancel());
    st.glow?.remove();
    stopDissolve(st);
    for (const [key, pc] of st.pieces) {
      pc.canvas.getAnimations().forEach((a) => a.finish());
      if (st.shown.has(key)) continue;
      pc.canvas.animate(
        [{ opacity: 0, transform: "scale(1.12)" }, { opacity: 1, transform: "scale(1)" }],
        { duration: 160, easing: "ease-out", fill: "forwards" }
      );
    }
    sfx.stamp(0.7);
    st.timers.push(setTimeout(() => commitPrint(entry, true), 200));
  }

  // Swap the finished card back to its baked art — the same pixels as the stamped
  // pieces — and drop the pieces once it's decoded, so nothing blinks. Idempotent;
  // also the teardown for a card that's still stamping.
  function commitPrint(entry, gleam = false) {
    if (!entry?.bare) return;
    entry.bare = false;
    const st = entry.print;
    entry.print = null;
    if (st) {
      st.done = true;
      st.timers.forEach(clearTimeout);
      cancelAnimationFrame(st.raf);
      stopDissolve(st);
    }
    const { cardEl, card, slot } = entry;
    cardEl.classList.remove("unprinted"); // the player's gloss layer fades back in (index.html)
    const art = cardEl.querySelector(".card__art");
    if (art) art.src = card.image;
    if (st?.layer) {
      const drop = () => requestAnimationFrame(() => st.layer.remove());
      (art?.decode ? art.decode() : Promise.resolve()).then(drop, drop);
    }
    if (gleam && !REDUCED) {
      slot.classList.remove("gleaming");
      void slot.offsetWidth; // restart the sweep
      slot.classList.add("gleaming");
      setTimeout(() => slot.classList.remove("gleaming"), 640);
    }
  }

  // stop any card mid-stamp without committing it (the stack is about to be torn down)
  function cancelPrints() {
    for (const s of slots) {
      const st = s.print;
      if (!st) continue;
      s.print = null;
      st.done = true;
      st.timers.forEach(clearTimeout);
      cancelAnimationFrame(st.raf);
      stopDissolve(st);
      st.fx.forEach((a) => a.cancel());
    }
  }

  // cancel the current card's entrance cues (on a fast advance, close, or replay)
  function clearEnter() {
    enterTimers.forEach(clearTimeout);
    enterTimers = [];
    if (enteringEl) enteringEl.classList.remove("entering", "gleaming");
    enteringEl = null;
  }

  // cancel the one-shot arrival cues + glow/shadow (on close/replay)
  function clearArrival() {
    arrivalTimers.forEach(clearTimeout);
    arrivalTimers = [];
    interiorAnim?.cancel();
    interiorAnim = null;
    shadowAnim?.cancel();
    shadowAnim = null;
  }

  function close() {
    clearWalkout();
    host.classList.add("hidden");
    host.classList.remove("browsing", "iridescent", "telling", "held", "show-status", "haul", "collecting", "scatter", "picked");
    scatterMode = false;
    current = null;
    stackEl.style.visibility = "";
    binderEl.classList.remove("rising");
    againEl.disabled = false;
    collecting = false;
    document.body.classList.remove("revealing");
    peeking = true;
    sliding = false;
    anticipating = false;
    clearTimeout(anticTimer);
    clearArrival();
    clearEnter();
    clearHit();
    cancelPrints();
    interiorEl.style.opacity = "0";
    shadowEl.style.opacity = "0";
    tiltSpring.stop();
  }

  function makeSlot(card) {
    const slot = document.createElement("div");
    slot.className = "reveal__slot";
    // …plus the card's BACK for the scatter (the reveal flattens the card component and
    // drops its own back face — see index.html — so the slot carries one of its own)
    slot.innerHTML = renderCard(card, { variant: "detail" }) + `<div class="slot__back" aria-hidden="true"></div>`;
    const cardEl = slot.querySelector(".card");
    // renderCard seeds the thumbnail; swap in the full-res scan (already preloaded)
    // so the pulled card is as crisp as the gallery's lightbox — or, for a painted
    // card, its BARE art: no player, no data — they come on once it's revealed
    // (stampIn), so even the peek through the tear gives nothing away. The player's
    // gloss layer (card.js) would light the player's silhouette, so it's hidden
    // until then (.unprinted).
    const art = cardEl.querySelector(".card__art");
    const bare = !REDUCED && !!card.imageBare;
    if (art && card.image) art.src = bare ? card.imageBare : card.image;
    if (bare) cardEl.classList.add("unprinted");
    stackEl.appendChild(slot);

    const entry = { slot, cardEl, card, bare, print: null, down: false, pose: null, order: 0 };
    let downX = 0, downY = 0, moved = false, holding = false, pressing = false;
    const isFront = () => slots[pos] === entry;

    slot.addEventListener("pointerdown", (e) => {
      if (scatterMode && entry.down) {
        // a face-down card in the scatter: a clean tap turns it over (pick)
        if (current || anticipating || peeking) return;
        pressing = true;
        moved = false;
        downX = e.clientX;
        downY = e.clientY;
        try { slot.setPointerCapture?.(e.pointerId); } catch {}
        return;
      }
      if (!isFront()) return;
      holding = true;
      moved = false;
      sliding = false;
      downX = e.clientX;
      downY = e.clientY;
      try { slot.setPointerCapture?.(e.pointerId); } catch {} // never let a stray pointer id abort the gesture
      tiltToward(e.clientX, e.clientY); // grab feel: the whole stack leans toward where you press
    });
    slot.addEventListener("pointermove", (e) => {
      if (pressing) { if (Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_SLOP) moved = true; return; }
      if (!isFront()) return;
      if (!holding) { tiltToward(e.clientX, e.clientY); return; } // hover (desktop): lean only, no press
      const dx = e.clientX - downX, dy = e.clientY - downY, m = Math.hypot(dx, dy);
      if (!sliding && m > SLIDE_SLOP && !scatterMode) { // (no deck to spread in the scatter)
        sliding = true;
        moved = true;
        host.classList.add("browsing"); // freeze the CSS transition so the spread tracks the finger 1:1
      }
      if (sliding) {
        dirX = dx / m; dirY = dy / m; // cascade follows the drag direction, distance opens it…
        renderSlide(Math.min(m / SLIDE_DRAG, 1));
      }
      tiltToward(e.clientX, e.clientY); // …and the whole stack tilts at the same time
    });
    const release = () => {
      if (pressing) { pressing = false; if (!moved) pick(entry); return; }
      if (!holding) return;
      holding = false;
      if (sliding) {
        closeSlide(); // let go → the spread eases shut
      } else if (!moved) {
        advance(); // a quick tap flicks the card away to the next
      }
      flat(); // magnet-snap every card flat
    };
    slot.addEventListener("pointerup", release);
    slot.addEventListener("pointercancel", release);
    slot.addEventListener("pointerleave", () => { if (!holding) flat(); }); // end a hover lean
    slot.addEventListener("contextmenu", (e) => e.preventDefault());

    return entry;
  }

  // Lay the cards out as a real stack: depth 0 is the top card (peeks through the
  // gap, and is uncovered in place when the pack drops), deeper cards sit behind
  // it, already-seen cards are flung away. CSS reads --d for the stack offset; z
  // keeps the top card frontmost. The top card only takes taps once opened.
  function layout() {
    slots.forEach((s, i) => {
      const d = i - pos;
      if (scatterMode && s.down && s !== current) {
        // a face-down card in the scatter keeps its own pose (inline), lies under the
        // card that's up, and takes taps only while the player is choosing
        s.slot.classList.remove("front", "flung");
        s.slot.style.setProperty("--d", "0");
        s.slot.style.zIndex = String(50 + (s.order || 0));
        s.slot.style.pointerEvents = !current && !peeking && !anticipating ? "auto" : "none";
        return;
      }
      s.slot.classList.toggle("front", d === 0);
      s.slot.classList.toggle("flung", d < 0);
      s.slot.style.setProperty("--d", String(Math.max(0, d)));
      // flung cards stay ABOVE the deck (later flings on top of earlier) so the
      // leaving card covers the cards behind it all the way off — a real swap-off,
      // not a card sinking through the stack as it goes
      s.slot.style.zIndex = String(d < 0 ? 200 + i : 100 - d);
      // (a picked card takes no taps until it's been turned over)
      s.slot.style.pointerEvents = d === 0 && !peeking && !(scatterMode && s.down) ? "auto" : "none";
    });
  }

  function advance() {
    if (pos >= cards.length || anticipating) return;
    if (host.classList.contains("held")) return; // a top-tier hit briefly holds taps
    // coalesce machine-gun tapping → one advance per ADVANCE_MIN_MS (see the const).
    // Rare pulls already self-pace via `anticipating`/`held`; this guards the COMMONS,
    // which otherwise advance instantly and let a fast finger stack a crash-spike.
    const tNow = performance.now();
    if (tNow - lastAdvanceT < ADVANCE_MIN_MS) return;
    lastAdvanceT = tNow;
    // a tap while the card's print is still going on finishes it at once — the
    // next tap moves on (so a fast thumb can't skip a card it never saw)
    const cur = slots[pos];
    if (cur?.print && !cur.print.done) { finishPrint(cur); return; }
    if (cur) commitPrint(cur); // it leaves the hand finished
    if (scatterMode) {
      // the scatter: the card up is flung away and the face-down spread takes over
      // again — the player picks the next one (no fixed order, so no tell here)
      sfx.flick();
      flingCurrent();
      if (navigator.vibrate) navigator.vibrate(6);
      pos++;
      current = null;
      layout();
      if (pos < cards.length) returnToScatter();
      else endOfPack();
      return;
    }
    const next = slots[pos + 1];
    const nextTier = next ? rarityToTier(next.card) : -1;
    sfx.flick();
    flingCurrent(); // throw the leaving card with direction + spin, and recoil the deck

    if (nextTier >= RARE_TIER) {
      // ANTICIPATION BEAT — fling the current card, then HOLD on a rising tell
      // (its colour leaks up behind the stack, the world dims, an audio riser
      // climbs) before the rare is uncovered with the full hit. The pause is the
      // 期待 — the player feels it coming a beat before they see it.
      anticipating = true;
      const cfg = hitCfg(nextTier);
      const cur = slots[pos];
      cur.slot.classList.add("flung");
      cur.slot.style.pointerEvents = "none";
      host.style.setProperty("--tier-color", TIER_HEX[nextTier]);
      host.classList.add("telling");
      if (navigator.vibrate) navigator.vibrate(8);
      const uncover = () => {
        host.classList.remove("telling");
        anticipating = false;
        pos++;
        layout();
        enter(slots[pos]);
        flourishIfRare(); // the hit lands
        updateHint();
      };
      // the top editions WALK OUT first (nation → position → club), then the hit
      if (nextTier >= WALKOUT_TIER && !REDUCED) {
        walkout(next.card, nextTier, uncover);
        return;
      }
      const wait = REDUCED ? Math.min(220, cfg.antic) : cfg.antic;
      sfx.riser(nextTier, wait); // duration = the actual hold, so the climax lands on the uncover
      anticTimer = setTimeout(uncover, wait);
      return;
    }

    // common card — uncover immediately
    if (navigator.vibrate) navigator.vibrate(6); // a small tick — the card has weight leaving the hand
    pos++;
    layout();
    if (pos < cards.length) {
      enter(slots[pos]);
      flourishIfRare();
      updateHint();
    } else {
      endOfPack();
    }
  }

  // THE WALKOUT — the signature football-pack moment for a top pull. The deck is
  // veiled and the stage stays dark while three clues punch in one after another,
  // centre stage: the player's NATION (flag), POSITION, then CLUB (crest). Each
  // lands with a thud + haptic; a riser climbs out of the last into the card's own
  // hit. `done` uncovers the card exactly as the plain anticipation beat would.
  function walkout(card, tier, done) {
    clearWalkout();
    for (let i = pos + 1; i < slots.length; i++) slots[i].slot.classList.add("veiled");
    host.classList.add("walkout");
    const clues = [flagClue(card), posClue(card), crestClue(card)].filter(Boolean);
    let prev = null;
    clues.forEach((el, i) => {
      walkTimers.push(setTimeout(() => {
        if (prev) clueOut(prev);
        walkoutEl.appendChild(el);
        el.animate(
          [
            { opacity: 0, transform: "scale(1.7)", filter: "blur(6px)" },
            { opacity: 1, transform: "scale(0.96)", filter: "blur(0px)", offset: 0.55 },
            { opacity: 1, transform: "scale(1)", filter: "blur(0px)" },
          ],
          { duration: 380, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)", fill: "forwards" }
        );
        sfx.setDown();
        sfx.pipTone(2 + i * 2);
        if (navigator.vibrate) navigator.vibrate(14 + i * 6);
        prev = el;
      }, 240 + i * WALKOUT_BEAT));
    });
    const end = 240 + clues.length * WALKOUT_BEAT;
    walkTimers.push(setTimeout(() => sfx.riser(tier, 600), end - 600));
    walkTimers.push(setTimeout(() => { if (prev) clueOut(prev); }, end - 140));
    walkTimers.push(setTimeout(() => {
      clearWalkout();
      done();
    }, end));
  }

  function clueOut(el) {
    const a = el.animate(
      [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.88) translateY(-14px)" }],
      { duration: 200, easing: "ease-in", fill: "forwards" }
    );
    a.onfinish = () => el.remove();
  }

  function clearWalkout() {
    walkTimers.forEach(clearTimeout);
    walkTimers = [];
    walkoutEl.innerHTML = "";
    host.classList.remove("walkout");
    slots.forEach((s) => s.slot.classList.remove("veiled"));
  }

  function clue(content, caption) {
    const el = document.createElement("div");
    el.className = "wo-clue";
    el.append(content);
    if (caption) {
      const cap = document.createElement("p");
      cap.className = "wo-cap";
      cap.textContent = caption;
      el.append(cap);
    }
    return el;
  }

  function flagClue(card) {
    if (!card.nation) return null;
    const cv = emblemCanvas((ctx) => drawFlag(ctx, card.nation, 0, 0, 210, 140, { radius: 12 }), 210, 140);
    cv.className = "wo-flag";
    return clue(cv, NATIONS[card.nation]?.name);
  }

  function posClue(card) {
    if (!card.pos) return null;
    const el = document.createElement("p");
    el.className = "wo-pos";
    el.textContent = card.pos;
    return clue(el, null);
  }

  // the club's real crest (already cached — the card's art loaded it), or the
  // drawn badge for a club without one (Legends)
  function crestClue(card) {
    if (!card.club) return null;
    const url = crestURL(card.club);
    let el;
    if (url) {
      el = new Image();
      el.alt = "";
      el.src = url;
    } else {
      el = emblemCanvas((ctx) => drawCrest(ctx, card.club, 90, 100, 180), 180, 200);
    }
    el.className = "wo-crest";
    return clue(el, card.club.name);
  }

  // Throw the CURRENT front card off with a little direction + spin (alternating
  // side per advance for variety), and recoil the deck a hair — so a flick has
  // weight instead of every card sliding straight up the same way. The .flung CSS
  // reads the --fling-* vars; layout()/the anticipation path then add the class.
  function flingCurrent() {
    const slot = slots[pos]?.slot;
    if (!slot) return;
    const dir = pos % 2 === 0 ? 1 : -1;
    slot.style.setProperty("--fling-rot", (dir * (5 + Math.random() * 6)).toFixed(1) + "deg");
    slot.style.setProperty("--fling-x", (dir * (8 + Math.random() * 10)).toFixed(0) + "px");
    deckRecoil();
  }

  // The deck dips + settles as a card leaves it — a tiny reactive recoil.
  function deckRecoil() {
    if (REDUCED || !stackEl.animate) return;
    stackEl.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(4px)", offset: 0.4 }, { transform: "translateY(0)" }],
      { duration: 220, easing: "ease-out" }
    );
  }

  // An expanding tier-coloured ring on the hit. Scale + opacity only (the ring's
  // glow is a static box-shadow, transform-scaled, never re-rastered). Bigger +
  // longer for rarer pulls; even a Team of the Week (which gets no rays) gets this punch.
  function shockwave(tier) {
    if (REDUCED) return;
    const punch = Math.max(0, Math.min(1, (tier - 3) / 6));
    const end = 1.1 + punch * 0.8;
    shockEl.animate(
      [
        { transform: "translate(-50%,-50%) scale(0.18)", opacity: 0 },
        { transform: `translate(-50%,-50%) scale(${(end * 0.5).toFixed(2)})`, opacity: 0.5 + punch * 0.3, offset: 0.25 },
        { transform: `translate(-50%,-50%) scale(${end.toFixed(2)})`, opacity: 0 },
      ],
      { duration: 520 + punch * 280, easing: "cubic-bezier(0.15,0.7,0.3,1)" }
    );
  }

  // The card hand JOLTS on the hit — a short decaying shake, amplitude by tier.
  // On the stack container (composes over the card-enter on the slot + holo tilt on
  // the card, which are separate elements). Skipped under reduced motion.
  function shakeStack(tier) {
    if (REDUCED || !stackEl.animate) return;
    const punch = Math.max(0, Math.min(1, (tier - 3) / 6));
    const amp = 3 + punch * 9;
    const N = 6;
    const frames = [{ transform: "translate(0px,0px)" }];
    for (let i = 1; i <= N; i++) {
      const decay = 1 - i / N;
      frames.push({ transform: `translate(${((Math.random() * 2 - 1) * amp * decay).toFixed(1)}px, ${((Math.random() * 2 - 1) * amp * decay).toFixed(1)}px)` });
    }
    frames.push({ transform: "translate(0px,0px)" });
    stackEl.animate(frames, { duration: 200 + punch * 160, easing: "ease-out" });
  }

  function endOfPack() {
    host.classList.remove("iridescent");
    clearHit();
    showHaul(); // fan the spent cards back into a hand, rarest popped forward + glowing
    againEl.hidden = false;
    sfx.concludeChime(); // a gentle resolving cadence — the haul closes on a chord, not silence
  }

  // THE HAUL — a draggable fan SELECTOR of your pull. Every card fans out as a hand;
  // the centred one is popped forward, enlarged, glowing and carries a live holo
  // sheen. Drag / swipe / wheel / arrow-keys rotate the fan to switch which card
  // sits centre (eased + snapped), tap a side card to bring it in. The rarest card
  // starts centred as the payoff. Geometry is computed per-frame from a continuous
  // `haulCenter` so the switch is smooth and dynamic.
  let haulOrder = [], haulN = 0, haulW = 240, haulStep = 80;
  let haulCenter = 0, haulTarget = 0, haulDragging = false, haulRAF = null, haulT = 0, haulLastIdx = -1;
  let haulLayoutC = NaN; // last centre we laid out at → skip the full layout on idle frames

  function showHaul() {
    if (!slots.length) return;
    tiltSpring.stop(); // no more stack holo tilt
    slots.forEach((s) => commitPrint(s)); // every card shows its full print in the fan
    scatterMode = false;
    current = null;
    host.classList.remove("scatter", "picked");
    host.classList.add("haul", "show-status");
    haulN = slots.length;
    // hero = rarest (rarest-LAST → >= keeps the last among ties)
    let hero = 0;
    for (let i = 0; i < haulN; i++) if (rarityToTier(slots[i].card) >= rarityToTier(slots[hero].card)) hero = i;
    // visual order: hero in the MIDDLE so the fan opens centred on the prize
    const rest = []; for (let i = 0; i < haulN; i++) if (i !== hero) rest.push(i);
    haulOrder = rest.slice();
    haulOrder.splice(Math.floor(rest.length / 2), 0, hero);
    haulW = stackEl.getBoundingClientRect().width || 240;
    haulStep = haulW * 0.33; // px between fanned card centres
    slots.forEach((s) => {
      s.slot.classList.remove("flung", "front", "entering", "gleaming", "rare", "facedown", "picking");
      s.down = false;
      s.slot.style.pointerEvents = "auto"; // tappable → centre that card
      s._centre = undefined; s._zi = undefined; // force the first layout to write z + foil
    });
    haulCenter = haulTarget = haulOrder.indexOf(hero); // open centred on the hero
    haulLastIdx = -1;
    haulLayoutC = NaN;
    layoutHaul();
    startHaulLoop();
    // let the fan-in animate on the CSS transition, THEN switch to 1:1 rAF control
    setTimeout(() => { if (host.classList.contains("haul")) host.classList.add("haul-live"); }, 620);
    hintEl.textContent = "";
    srEl.textContent = `That's your pack. Best signing: ${slots[hero].card.name}, ${tierOf(slots[hero].card).label}. Drag to browse, or send them to your club.`;
  }

  // place every card on the fan for the (fractional) centre position
  function layoutHaul() {
    const w = haulW, c = haulCenter, n = haulN;
    for (let v = 0; v < n; v++) {
      const s = slots[haulOrder[v]];
      const off = v - c, ao = Math.abs(off);
      const foc = Math.max(0, 1 - ao);                 // 1 centred → 0 a step away
      const tx = off * haulStep;
      const ty = ao * (w * 0.085) - foc * (w * 0.12);  // arc dip − centre lift
      const sc = 0.48 + 0.12 * foc - Math.max(0, ao - 1) * 0.02;
      // REAL depth (preserve-3d on .reveal__stack) instead of an integer z-index: the
      // farther from centre, the farther back. translateZ comes FIRST so it's an
      // untransformed depth offset (the later scale/rotate stay in-plane). The browser
      // depth-sorts by this, so the card sliding to centre rises through the others
      // continuously — no z-index flip snapping it from behind to in front in one frame.
      // Depth = distance from centre (farther → farther back), PLUS a small signed
      // bias by `off`. Without the bias, two cards symmetric about the centre (e.g.
      // off = ±0.5 as you drag through the midpoint) get the SAME translateZ — an
      // exact depth tie. They overlap on screen there, and Android's coarser GPU
      // depth precision resolves the tie non-deterministically → the cards flicker /
      // z-fight (only on Android; desktop/iOS settle it by paint order). The signed
      // term gives left vs right a stable front-to-back order (like a real fanned
      // hand) with no tie; at ~2px/step it's far below the 16px/step recede, so it
      // never inverts which card is nearer and is invisible to the eye.
      const tz = -ao * 16 - off * 2; // px; ~16/1100 perspective ⇒ negligible size change, clean sort
      s.slot.style.transform = `translateZ(${tz.toFixed(2)}px) translate(${tx.toFixed(0)}px, ${ty.toFixed(0)}px) rotate(${(off * 8).toFixed(2)}deg) scale(${sc.toFixed(3)})`;
      // z-index + foil only change when a card crosses the centre boundary — writing them
      // every frame needlessly repaints the (blend-mode) foil layers of every side card,
      // which is what janks the drag on mobile. Dirty-track and only write on transition.
      const zi = Math.round(200 - ao * 10); // fallback ordering if 3D is flattened
      if (zi !== s._zi) { s.slot.style.zIndex = String(zi); s._zi = zi; }
      const isCentre = ao < 0.5;
      if (isCentre !== s._centre) {
        s._centre = isCentre;
        s.slot.classList.toggle("haul-hero", isCentre);
        if (!isCentre) resetCardFoil(s.cardEl); // reset foil once, as the card leaves centre
      }
    }
    const idx = Math.max(0, Math.min(n - 1, Math.round(c)));
    if (idx !== haulLastIdx) {            // the centred card changed → update glow + label
      haulLastIdx = idx;
      const card = slots[haulOrder[idx]].card;
      host.style.setProperty("--tier-color", TIER_HEX[rarityToTier(card)]);
      haulCapEl.querySelector(".hc-best").textContent = tierOf(card).label;
      srEl.textContent = `${card.name} · ${card.pos || ""} ${card.ovr || ""} · ${tierOf(card).label}`;
    }
  }

  // continuous loop while the haul is up: ease centre→target + idle holo on centre
  function startHaulLoop() { if (!haulRAF) haulRAF = requestAnimationFrame(haulFrame); }
  function stopHaulLoop() { if (haulRAF) cancelAnimationFrame(haulRAF); haulRAF = null; }
  function haulFrame() {
    if (!host.classList.contains("haul")) { haulRAF = null; return; }
    haulRAF = requestAnimationFrame(haulFrame);
    haulT += 0.016;
    if (!haulDragging) {
      haulCenter += (haulTarget - haulCenter) * 0.18; // eased snap
      if (Math.abs(haulTarget - haulCenter) < 0.001) haulCenter = haulTarget;
    }
    // only re-lay-out when the centre actually moved — once snapped + idle, the fan is
    // static so the only per-frame work left is the centre card's holo sheen below
    if (haulCenter !== haulLayoutC) { layoutHaul(); haulLayoutC = haulCenter; }
    // a gentle holo sheen on the centred card so it feels alive
    const ce = slots[haulOrder[Math.max(0, Math.min(haulN - 1, Math.round(haulCenter)))]]?.cardEl;
    if (ce && !haulDragging && !REDUCED) {
      const cx = Math.sin(haulT * 0.9) * 0.5, cy = Math.sin(haulT * 0.62 + 1.1) * 0.4;
      ce.style.transform = `rotateX(${(cy * 8).toFixed(2)}deg) rotateY(${(-cx * 8).toFixed(2)}deg)`;
      ce.style.setProperty("--mx", (50 + cx * 50).toFixed(1) + "%");
      ce.style.setProperty("--my", (50 + cy * 50).toFixed(1) + "%");
      ce.style.setProperty("--posx", (50 + cx * FOIL_X).toFixed(1) + "%");
      ce.style.setProperty("--posy", (50 + cy * FOIL_Y).toFixed(1) + "%");
      ce.style.setProperty("--hyp", Math.min(1, Math.hypot(cx, cy)).toFixed(3));
    }
  }
  function resetCardFoil(ce) {
    ce.style.transform = "";
    ce.style.setProperty("--mx", "50%"); ce.style.setProperty("--my", "50%");
    ce.style.setProperty("--posx", "50%"); ce.style.setProperty("--posy", "50%");
    ce.style.setProperty("--hyp", "0");
  }

  // ---- drag / swipe / wheel / keys to rotate the fan → switch the centre card --
  let haulDown = null;
  stackEl.addEventListener("pointerdown", (e) => {
    if (!host.classList.contains("haul")) return;
    haulDown = { x: e.clientX, start: haulCenter, moved: 0, slotEl: e.target.closest(".reveal__slot") };
    haulDragging = true;
    startHaulLoop();
    try { stackEl.setPointerCapture?.(e.pointerId); } catch {}
  });
  stackEl.addEventListener("pointermove", (e) => {
    if (!haulDown || !host.classList.contains("haul")) return;
    const dx = e.clientX - haulDown.x;
    haulDown.moved = Math.max(haulDown.moved, Math.abs(dx));
    let c = haulDown.start - dx / (haulW * 0.45); // ~half a card width of drag = one step
    if (c < 0) c *= 0.35;                          // rubber-band past the ends
    else if (c > haulN - 1) c = (haulN - 1) + (c - (haulN - 1)) * 0.35;
    haulCenter = c;
  });
  const haulRelease = (e) => {
    if (!haulDown || !host.classList.contains("haul")) return;
    haulDragging = false;
    try { stackEl.releasePointerCapture?.(e.pointerId); } catch {}
    if (haulDown.moved < TAP_SLOP && haulDown.slotEl) {
      const vp = haulOrder.indexOf(slots.findIndex((s) => s.slot === haulDown.slotEl));
      if (vp >= 0) { sfx.flick?.(); haulTarget = vp; } // tap a card → centre it
    } else {
      haulTarget = Math.max(0, Math.min(haulN - 1, Math.round(haulCenter))); // snap to nearest
    }
    haulDown = null;
  };
  stackEl.addEventListener("pointerup", haulRelease);
  stackEl.addEventListener("pointercancel", () => { haulDragging = false; haulDown = null; });
  stackEl.addEventListener("wheel", (e) => {
    if (!host.classList.contains("haul")) return;
    e.preventDefault();
    haulTarget = Math.max(0, Math.min(haulN - 1, Math.round(haulCenter) + ((e.deltaY || e.deltaX) > 0 ? 1 : -1)));
    startHaulLoop();
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (!host.classList.contains("haul")) return;
    if (e.key === "ArrowRight") { haulTarget = Math.min(haulN - 1, Math.round(haulCenter) + 1); startHaulLoop(); }
    else if (e.key === "ArrowLeft") { haulTarget = Math.max(0, Math.round(haulCenter) - 1); startHaulLoop(); }
  });

  // THE HIT — when the current front card is a promo pull, fire the full payoff
  // scaled by tier: sunburst rays, a screen flash, an edition stamp, a glowing
  // star/bokeh burst, a fuller chime + sparkle dust, haptics, and (top tiers) a
  // held beat. A Team of the Week is a shimmer; a Legend takes the whole screen.
  function flourishIfRare() {
    const s = slots[pos];
    if (!s) return;
    const tier = rarityToTier(s.card);
    const isRare = tier >= RARE_TIER;
    s.slot.classList.toggle("rare", isRare);
    host.classList.toggle("iridescent", isRare); // iridescent backdrop for the chase
    if (!isRare) {
      clearHit();
      return;
    }

    const cfg = hitCfg(tier);
    const hex = TIER_HEX[tier];
    host.style.setProperty("--tier-color", hex);

    // rotating sunburst rays — gated by tier (a Team of the Week gets none)
    if (cfg.rays > 0) {
      setRays(raysEl, cfg.rays, cfg.fast);
      if (cfg.fine) setRays(raysFineEl, cfg.rays * 0.7, cfg.fast);
    }
    // the visceral white→tier screen flash
    flashEl.animate(
      [{ opacity: 0 }, { opacity: cfg.flash, offset: 0.08 }, { opacity: 0 }],
      { duration: 460, easing: "ease-out" }
    );
    // the rarity label punches in
    stampHit(tier);
    shockwave(tier);  // an expanding tier ring — even a Team of the Week (no rays) lands a punch
    shakeStack(tier); // the hand JOLTS on the hit — tactile weight, scaled by tier

    // a glowing burst around the card — soft bokeh + 4-point sparkles, additive
    const r = host.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * 0.44;
    const pal = tier >= 8 ? ["#ffffff", hex, lighten(hex, 0.45), ...CONFETTI] : ["#ffffff", lighten(hex, 0.55), hex];
    particles.emit(cx, cy, {
      count: Math.round(cfg.burst * 0.6), speed: 7.5, spread: Math.PI * 2,
      colors: pal, gravity: 0.05, life: 80, size: 3, bloom: true, trail: true,
    });
    particles.emit(cx, cy, {
      count: Math.round(cfg.burst * 0.4), speed: 9.5, spread: Math.PI * 2,
      colors: ["#ffffff", lighten(hex, 0.65)], gravity: 0.04, life: 72, size: 2.6,
      shape: "star", bloom: true, trail: true,
    });

    // Land the downbeat the anticipation built to, THEN ride the chime + glitter on
    // top: impact → arpeggio → shimmer reads as one rising arc instead of three loose
    // sounds. The chime is nudged off the impact (a hair longer for the held tiers) so
    // it sits in the impact's tail, near the card-enter contact dip.
    sfx.revealImpact(tier);
    const chimeDelay = cfg.slow ? 150 : 80;
    setTimeout(() => {
      sfx.chime(tier);
      sfx.sparkleDust(Math.round(12 + tier * 3), 0.4 + tier * 0.06); // genuinely fuller at the top
    }, chimeDelay);
    if (navigator.vibrate) navigator.vibrate(cfg.vibe);

    // the top tiers HOLD the moment — freeze taps so the reveal can be savoured
    if (cfg.slow && !REDUCED) {
      host.classList.add("held");
      setTimeout(() => host.classList.remove("held"), 700);
    }
  }

  // show + spin the rays at a target opacity (fast = quicker spin for top tiers)
  function setRays(el, opacity, fast) {
    el.style.opacity = String(opacity);
    el.classList.add("spin");
    el.classList.toggle("fast", !!fast);
  }

  // the edition label punches in over the card, settles, then fades
  function stampHit(tier) {
    const s = slots[pos];
    if (!s) return;
    stampEl.textContent = tierOf(s.card).label;
    stampEl.animate(
      [
        { opacity: 0, transform: "translate(-50%, -50%) scale(1.6)", letterSpacing: "0.34em" },
        { opacity: 1, transform: "translate(-50%, -50%) scale(1)", letterSpacing: "0.08em", offset: 0.45 },
        { opacity: 1, offset: 0.8 },
        { opacity: 0 },
      ],
      { duration: 1700, easing: "cubic-bezier(0.2, 1.3, 0.3, 1)" }
    );
  }

  // douse every hit layer — between cards, on close, and on a common pull
  function clearHit() {
    for (const el of [raysEl, raysFineEl]) {
      el.style.opacity = "0";
      el.classList.remove("spin", "fast");
    }
    flashEl.style.opacity = "0";
    stampEl.style.opacity = "0";
    host.classList.remove("telling", "held");
  }

  // Announce the current card to screen readers (the SR live region).
  function updateHint() {
    if (scatterMode && !current) {
      const left = slots.filter((s) => s.down).length;
      srEl.textContent = `${left} card${left === 1 ? "" : "s"} face down. Tap one to turn it over.`;
      return;
    }
    const card = slots[pos]?.card;
    if (card) srEl.textContent = `Card ${pos + 1} of ${cards.length}: ${card.name}, ${card.pos || ""} ${card.ovr || ""}, ${card.rarity}. Tap for the next card.`;
  }

  // SEND TO CLUB — the button drops away as your club badge rises, then the signings
  // are vacuumed into it one card at a time; the badge bloats + gulps on each card
  // (Cult-of-the-Lamb munch). When the last card lands, hand back to the host (→ pick
  // another pack).
  let collecting = false;
  function collect() {
    if (collecting || !slots.length) return;
    collecting = true;
    stopHaulLoop();                 // freeze the fan; we drive the slots by hand now
    host.classList.add("collecting"); // CSS: drop the button, hide hint/caption
    againEl.disabled = true;
    binderEl.classList.add("rising"); // the binder slides up from below
    slots.forEach((s) => { s.slot.style.pointerEvents = "none"; });

    const order = haulOrder.length ? haulOrder.slice() : slots.map((_, i) => i);
    const RISE = 520, STAGGER = 200, FLIGHT = 420, ANTIC = 150; // RISE waits out the 0.5s rise transition; ANTIC = the wind-up beat

    // suck the cards in only AFTER the binder has finished rising — so we measure its
    // FINAL (risen) position. Measuring at click time gives the binder's start (down)
    // spot, and the cards then fly PAST the risen binder and pop out below it.
    setTimeout(() => {
      const sr = stackEl.getBoundingClientRect();
      const br = binderEl.getBoundingClientRect(); // risen now → true target
      const dx = (br.left + br.width / 2) - (sr.left + sr.width / 2);
      const dy = (br.top + br.height / 2) - (sr.top + sr.height / 2);
      // each card keeps its fan pose (position + tilt + scale) and just eases UP a
      // touch along ITS OWN facing — a small local lift = the anticipation — THEN
      // gets sucked into the binder.
      order.forEach((cardIdx, k) => {
        const s = slots[cardIdx];
        const rest = s.slot.style.transform; // resting fan pose: translate(..) rotate(..) scale(..)
        // insert the lift AFTER rotate, so "up" is in the card's LOCAL frame (follows its tilt)
        const lifted = rest.includes("scale(") ? rest.replace("scale(", "translateY(-16px) scale(") : rest;
        setTimeout(() => {
          // 1) ANTICIPATION — same place/tilt/size, ease up a little along its own facing
          s.slot.style.transition = `transform ${ANTIC}ms cubic-bezier(0.33,1,0.68,1)`;
          s.slot.style.transform = lifted;
          // 2) SUCK — then whoosh into the binder, shrinking to nothing at its centre
          setTimeout(() => {
            s.slot.style.transition = `transform ${FLIGHT}ms cubic-bezier(0.5,0,0.85,0.3), opacity ${FLIGHT}ms ease-in ${FLIGHT * 0.45}ms`;
            s.slot.style.transform = `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) rotate(0deg) scale(0.04)`;
            s.slot.style.opacity = "0";
            setTimeout(() => bloatBinder(k, order.length), FLIGHT - 80); // bloat as it lands
          }, ANTIC);
        }, k * STAGGER);
      });
    }, RISE);

    // after the last card is swallowed, the now-full binder SLIDES BACK DOWN out of
    // frame on its OWN beat (a "drop away") — and ONLY THEN do we hand back to the
    // carousel. So it's a transition OUT, not an instant cut to the wheel.
    const lastSwallow = RISE + (order.length - 1) * STAGGER + ANTIC + FLIGHT;
    const SLIDE_OUT = 500; // matches the binder's 0.5s slide-down transition
    setTimeout(() => binderEl.classList.remove("rising"), lastSwallow + 240); // binder drops + fades away
    setTimeout(() => { close(); collecting = false; onAgain?.(); }, lastSwallow + 240 + SLIDE_OUT);
  }
  // one bloat + gulp per card — the binder lurches bigger, like it just ate
  function bloatBinder(k, total) {
    sfx.gulp?.(k, total);
    if (navigator.vibrate) navigator.vibrate(12);
    const grow = 1 + 0.16 + k * 0.02; // each card leaves it a touch fatter
    binderIconEl.animate(
      [{ transform: "scale(1)" }, { transform: `scale(${grow})`, offset: 0.35 }, { transform: "scale(1)" }],
      { duration: 300, easing: "cubic-bezier(0.34,1.56,0.64,1)" }
    );
  }

  againEl.addEventListener("click", collect);

  return { prepare, wake, show, close };
}

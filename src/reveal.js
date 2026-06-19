// reveal.js — the card-stack reveal that plays once the pack tears open.
//
// The booster's cards rise out of the opening as a stack; you tap the front one
// to flick it away and bring up the next, rarest LAST. Drag the front card to
// tilt it and watch the holo foil play. The big pull lands with a sparkle burst,
// a chime, and a glow.
//
// Once every card is seen they fan back into the HAUL — a draggable fan SELECTOR of
// the pull: drag / swipe / wheel / arrow-keys rotate the fan to switch which card
// sits centre (popped, enlarged, glowing, with a live holo sheen). See showHaul /
// layoutHaul / the haul pointer handlers on stackEl.
//
// Reuses the shared Card (card.js), the spring (motion.js), the particle system
// (particles.js), and Web Audio (sfx.js) — the same parts the gallery + tear use.

import { renderCard } from "./card.js";
import { createSpring } from "./motion.js";
import { createParticles } from "./particles.js";
import { rarityToTier, tierOf, TIER_HEX, lighten } from "./rarity.js";
import * as sfx from "./sfx.js";

const TILT = 12; // max pointer tilt on the front card (deg)
const FOIL_X = 13; // holo parallax half-ranges (match the lightbox feel)
const FOIL_Y = 17;
const TILT_TRACK = [0.12, 0.82]; // soft spring [stiffness, damping] while the tilt follows the pointer — smooth, no shake
const TILT_SNAP = [0.3, 0.5]; // snap every card flat fast but CLEAN — low damping = heavy friction, so it settles without bouncing
const TAP_SLOP = 8; // px of travel under which a press counts as a tap (→ advance)
const SLIDE_SLOP = 6; // px of drag before a press becomes a slide (under this it's a tap)
const SLIDE_DRAG = 42; // px of drag that opens the stack to its full edge spread
const EXPAND_EDGE = 15; // px of side edge each card slides out to reveal — the parallel cascade step
const DEPTH_SHRINK = 0.01; // each card behind shrinks this much per stack step → a natural receding deck (keep in sync with the resting scale in index.html)
const RARE_TIER = 4; // tier ≥ this gets the flourish (burst + chime + glow) — Double Rare ex and up
const FOIL = ["#ff5d8f", "#ffd24a", "#5fcf8e", "#3fd6c8", "#6ea8fe", "#b072e6"];

// Per-tier HIT escalation — the ONE dial that keeps a crescendo: a Double Rare
// is a shimmer, only a Hyper is a screen-takeover. burst = particle count,
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
    <div class="reveal__haul-cap" aria-hidden="true">
      <p class="hc-kicker">Your pull</p>
      <p class="hc-best"></p>
    </div>
    <div class="reveal__status">
      <div class="reveal__pips" aria-hidden="true"></div>
      <p class="reveal__hint"></p>
    </div>
    <p class="reveal__sr" aria-live="polite"></p>
    <button class="reveal__again" type="button" hidden>Collect</button>
    <!-- the binder the cards get vacuumed into on Collect; rises as the button drops,
         and bloats once per card (see collect() in this file) -->
    <div class="reveal__binder" aria-hidden="true">
      <div class="binder-icon">
        <svg viewBox="0 0 72 88" width="100%" height="100%">
          <rect x="6" y="5" width="60" height="78" rx="7" fill="#2a2150" stroke="#b49bff" stroke-width="3"/>
          <rect x="6" y="5" width="15" height="78" rx="7" fill="#1c1638" stroke="#b49bff" stroke-width="3"/>
          <circle cx="13.5" cy="26" r="3.2" fill="#d8ccff"/>
          <circle cx="13.5" cy="44" r="3.2" fill="#d8ccff"/>
          <circle cx="13.5" cy="62" r="3.2" fill="#d8ccff"/>
          <rect x="30" y="30" width="26" height="28" rx="3" fill="#b49bff" opacity="0.85"/>
          <path d="M43 33 l3 6 6 .8 -4.4 4.2 1 6.2 -5.6-3 -5.6 3 1-6.2 -4.4-4.2 6-.8z" fill="#fff2c8"/>
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
  const haulCapEl = host.querySelector(".reveal__haul-cap");
  const pipsEl = host.querySelector(".reveal__pips");
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
    cards = packCards || [];
    pos = 0;
    sliding = false;
    anticipating = false;
    clearTimeout(anticTimer);
    clearArrival();
    clearEnter();
    host.classList.remove("browsing", "iridescent", "telling", "held", "show-status", "haul", "haul-live");
    haulDragging = false;
    stopHaulLoop();
    tiltSpring.stop();
    stackEl.innerHTML = "";
    slots = cards.map(makeSlot);
    againEl.hidden = true;
    hintEl.textContent = ""; // no hint until the cards are out
    // a count pip per card — built up front so the haul size is structural
    pipsEl.innerHTML = cards.map(() => `<span class="pip"></span>`).join("");
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
    layout(); // the front card sits in "peek" position behind the pack
  }

  // Bring the stack in behind the pack the moment it's grabbed to tear (the pack
  // is sealed and covering, so the cards stay hidden until the gap opens).
  function wake() {
    if (slots.length) host.classList.remove("hidden");
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
  function show() {
    if (!slots.length) return;
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
    // …and the pips articulate the haul size with a soft ascending tick per card
    for (let i = 0; i < cards.length; i++) {
      arrivalTimers.push(setTimeout(() => sfx.pipTone(i), 420 + i * 70));
    }
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
    // the contact dip stays locked to the impact cues. punch: 0 below Double Rare → 1 at Hyper.
    const punch = Math.max(0, Math.min(1, (rarityToTier(entry.card) - 3) / 6));
    el.style.setProperty("--enter-rise", (34 + punch * 26).toFixed(0) + "px");
    el.style.setProperty("--enter-dip", (-(6 + punch * 12)).toFixed(0) + "px");
    el.style.setProperty("--enter-pop", (1.015 + punch * 0.05).toFixed(3));
    el.style.setProperty("--enter-from", (0.9 - punch * 0.06).toFixed(3));
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
    host.classList.add("hidden");
    host.classList.remove("browsing", "iridescent", "telling", "held", "show-status", "haul", "collecting");
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
    interiorEl.style.opacity = "0";
    shadowEl.style.opacity = "0";
    tiltSpring.stop();
  }

  function makeSlot(card) {
    const slot = document.createElement("div");
    slot.className = "reveal__slot";
    slot.innerHTML = renderCard(card, { variant: "detail" });
    const cardEl = slot.querySelector(".card");
    // renderCard seeds the thumbnail; swap in the full-res scan (already preloaded)
    // so the pulled card is as crisp as the gallery's lightbox.
    const art = cardEl.querySelector(".card__art");
    if (art && card.image) art.src = card.image;
    stackEl.appendChild(slot);

    const entry = { slot, cardEl, card };
    let downX = 0, downY = 0, moved = false, holding = false;
    const isFront = () => slots[pos] === entry;

    slot.addEventListener("pointerdown", (e) => {
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
      if (!isFront()) return;
      if (!holding) { tiltToward(e.clientX, e.clientY); return; } // hover (desktop): lean only, no press
      const dx = e.clientX - downX, dy = e.clientY - downY, m = Math.hypot(dx, dy);
      if (!sliding && m > SLIDE_SLOP) {
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
      s.slot.classList.toggle("front", d === 0);
      s.slot.classList.toggle("flung", d < 0);
      s.slot.style.setProperty("--d", String(Math.max(0, d)));
      s.slot.style.zIndex = String(d < 0 ? 1 : 100 - d);
      s.slot.style.pointerEvents = d === 0 && !peeking ? "auto" : "none";
    });
  }

  function advance() {
    if (pos >= cards.length || anticipating) return;
    if (host.classList.contains("held")) return; // a top-tier hit briefly holds taps
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
      const wait = REDUCED ? Math.min(220, cfg.antic) : cfg.antic;
      sfx.riser(nextTier, wait); // duration = the actual hold, so the climax lands on the uncover
      if (navigator.vibrate) navigator.vibrate(8);
      anticTimer = setTimeout(() => {
        host.classList.remove("telling");
        anticipating = false;
        pos++;
        layout();
        enter(slots[pos]);
        flourishIfRare(); // the hit lands
        updateHint();
      }, wait);
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
  // longer for rarer pulls; even a Double Rare (which gets no rays) gets this punch.
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
    const pips = pipsEl.children;
    for (let i = 0; i < pips.length; i++) {
      pips[i].classList.remove("is-current");
      pips[i].classList.add("is-seen");
    }
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
      s.slot.classList.remove("flung", "front", "entering", "gleaming", "rare");
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
    hintEl.textContent = "Drag / swipe to switch the centre card";
    srEl.textContent = `That's your pack. Best pull: ${tierOf(slots[hero].card).label}. Drag to browse, or open another.`;
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
      const tz = -ao * 16; // px; ~16/1100 perspective ⇒ negligible size change, clean sort
      s.slot.style.transform = `translateZ(${tz.toFixed(1)}px) translate(${tx.toFixed(0)}px, ${ty.toFixed(0)}px) rotate(${(off * 8).toFixed(2)}deg) scale(${sc.toFixed(3)})`;
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
      srEl.textContent = `${card.name} · ${tierOf(card).label}`;
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

  // THE HIT — when the current front card is a chase pull, fire the full payoff
  // scaled by tier: sunburst rays, a screen flash, a rarity stamp, a glowing
  // star/bokeh burst, a fuller chime + sparkle dust, haptics, and (top tiers) a
  // held beat. A Double Rare is a shimmer; a Hyper takes the whole screen.
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

    // rotating sunburst rays — gated by tier (a Double Rare gets none)
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
    shockwave(tier);  // an expanding tier ring — even a Double Rare (no rays) lands a punch
    shakeStack(tier); // the hand JOLTS on the hit — tactile weight, scaled by tier

    // a glowing burst around the card — soft bokeh + 4-point sparkles, additive
    const r = host.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * 0.44;
    const pal = tier >= 8 ? ["#ffffff", ...FOIL] : ["#ffffff", lighten(hex, 0.55), hex];
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

  // the rarity label punches in over the card, settles, then fades
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

  // Drive the count pips (current + seen), the teach sub-line, and the SR status.
  // Pips are the primary, glanceable count/position read; the text is secondary.
  function updateHint() {
    const pips = pipsEl.children;
    for (let i = 0; i < pips.length; i++) {
      pips[i].classList.toggle("is-current", i === pos);
      pips[i].classList.toggle("is-seen", i < pos);
    }
    hintEl.textContent = "tap for next · drag to spread";
    const card = slots[pos]?.card;
    if (card) srEl.textContent = `Card ${pos + 1} of ${cards.length}, ${card.rarity}. Tap for the next card.`;
  }

  // COLLECT — the button drops away as a binder rises, then the pull is vacuumed into
  // it one card at a time; the binder bloats + gulps on each card (Cult-of-the-Lamb
  // munch). When the last card lands, hand back to the host (→ pick another pack).
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

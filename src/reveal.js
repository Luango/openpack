// reveal.js — the card-stack reveal that plays once the pack tears open.
//
// The booster's cards rise out of the opening as a stack; you tap the front one
// to flick it away and bring up the next, rarest LAST. Drag the front card to
// tilt it and watch the holo foil play. The big pull lands with a sparkle burst,
// a chime, and a glow.
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
    <div class="reveal__rays"></div>
    <div class="reveal__rays reveal__rays--fine"></div>
    <div class="reveal__tell"></div>
    <div class="reveal__stack"></div>
    <canvas class="reveal__fx"></canvas>
    <div class="reveal__flash"></div>
    <p class="reveal__stamp" aria-hidden="true"></p>
    <p class="reveal__hint"></p>
    <button class="reveal__again" type="button" hidden>Open another</button>`;
  mountEl.appendChild(host);

  const stackEl = host.querySelector(".reveal__stack");
  const hintEl = host.querySelector(".reveal__hint");
  const againEl = host.querySelector(".reveal__again");
  const interiorEl = host.querySelector(".reveal__interior");
  const raysEl = host.querySelector(".reveal__rays:not(.reveal__rays--fine)");
  const raysFineEl = host.querySelector(".reveal__rays--fine");
  const flashEl = host.querySelector(".reveal__flash");
  const stampEl = host.querySelector(".reveal__stamp");
  const particles = createParticles(host.querySelector(".reveal__fx"));

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
  function renderSlide(open) {
    const k = Math.max(0, Math.min(1, open));
    for (let i = 0; i < slots.length; i++) {
      if (i < pos) continue; // already flung — leave it to the .flung CSS
      const d = i - pos;
      const ty0 = 5 * d, sc0 = 1 - 0.02 * d; // stacked (open 0) — mirrors the CSS resting stack
      const slide = EXPAND_EDGE * d; // cracked open (open 1) — slid out d steps, back to full size
      const tx = dirX * slide * k;
      const ty = ty0 + (dirY * slide - ty0) * k;
      const sc = sc0 + (1 - sc0) * k;
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

  // The holo tilt — ONE spring shared across the whole visible stack, so every card
  // leans the same way at once (each keeps its own foil). It runs SOFT while tracking
  // the pointer (smooth, no jitter) and is retuned STIFF only when snapping flat on
  // release — so the lean follows you fluidly but slams home like a magnet.
  const tiltSpring = createSpring({
    rest: { rx: 0, ry: 0, mx: 50, my: 50, px: 50, py: 50, hyp: 0 },
    stiffness: TILT_TRACK[0],
    damping: TILT_TRACK[1],
    onTick: (c) => {
      const t = `rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg)`;
      for (let i = pos; i < slots.length; i++) {
        const ce = slots[i].cardEl;
        ce.style.transform = t;
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
    host.classList.remove("browsing", "iridescent", "telling", "held");
    tiltSpring.stop();
    stackEl.innerHTML = "";
    slots = cards.map(makeSlot);
    againEl.hidden = true;
    hintEl.textContent = ""; // no hint until the cards are out
    // the interior glow (cards rise out of light) reads the rarest card's colour
    const peak = cards.length ? Math.max(...cards.map(rarityToTier)) : 0;
    host.style.setProperty("--tell", TIER_HEX[peak] || TIER_HEX[0]);
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
  function show() {
    if (!slots.length) return;
    host.classList.remove("hidden"); // ensure visible (normally already woken on grab)
    document.body.classList.add("revealing"); // the pack drops away + stops taking taps
    particles.resize(); // the canvas was sized while hidden (zero rect) — re-measure
    peeking = false;
    layout(); // the top card is now interactive (it never moved — just uncovered)
    // the opening glows so the first card rises out of light, then settles low
    interiorEl.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0.22 }],
      { duration: 720, easing: "ease-out", fill: "forwards" }
    );
    enter(slots[pos]); // the hero rises + scales in instead of just being "there"
    updateHint();
    flourishIfRare();
  }

  // Play the rise+scale entrance on a slot's card (CSS keyframe; reduced-motion
  // falls back to a plain fade). Self-cleans so a later layout isn't stuck mid-anim.
  function enter(entry) {
    if (!entry) return;
    const el = entry.slot;
    el.classList.remove("entering");
    void el.offsetWidth; // restart the animation if it was mid-play
    el.classList.add("entering");
    const done = () => {
      el.classList.remove("entering");
      el.removeEventListener("animationend", done);
    };
    el.addEventListener("animationend", done);
    setTimeout(done, 900); // safety net if animationend is missed
  }

  function close() {
    host.classList.add("hidden");
    host.classList.remove("browsing", "iridescent", "telling", "held");
    document.body.classList.remove("revealing");
    peeking = true;
    sliding = false;
    anticipating = false;
    clearTimeout(anticTimer);
    clearHit();
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
      sfx.riser(nextTier, cfg.antic);
      if (navigator.vibrate) navigator.vibrate(8);
      const wait = REDUCED ? Math.min(220, cfg.antic) : cfg.antic;
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

  function endOfPack() {
    host.classList.remove("iridescent");
    clearHit();
    hintEl.textContent = "That's the pack!";
    againEl.hidden = false;
  }

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

    sfx.chime(tier);
    sfx.sparkleDust(8 + tier, 0.7);
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

  function updateHint() {
    hintEl.textContent = `${pos + 1} / ${cards.length} · tap to flip · drag to spread`;
  }

  againEl.addEventListener("click", () => {
    close();
    onAgain?.();
  });

  return { prepare, wake, show, close };
}

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
import { rarityToTier } from "./rarity.js";
import * as sfx from "./sfx.js";

const TILT = 12; // max pointer tilt on the front card (deg)
const FOIL_X = 13; // holo parallax half-ranges (match the lightbox feel)
const FOIL_Y = 17;
const TAP_SLOP = 8; // px of travel under which a press counts as a tap (→ advance)
const HOLD_MS = 240; // press and hold this long (without dragging) → the stack spreads
const TILT_SLOP = 12; // moving more than this before the hold fires makes it a tilt-drag, not a hold
const EXPAND_EDGE = 15; // px of side edge each card slides out to reveal — the parallel cascade step
const EXPAND_DIR = [-0.8, -0.6]; // default cascade direction (up-left) until your finger steers it
const RARE_TIER = 4; // tier ≥ this gets the flourish (burst + chime + glow) — Double Rare ex and up
const FOIL = ["#ff5d8f", "#ffd24a", "#5fcf8e", "#3fd6c8", "#6ea8fe", "#b072e6"];

export function createReveal({ mountEl, onAgain }) {
  const host = document.createElement("div");
  host.className = "reveal hidden";
  host.innerHTML = `
    <canvas class="reveal__fx"></canvas>
    <div class="reveal__stack"></div>
    <p class="reveal__hint"></p>
    <button class="reveal__again" type="button" hidden>Open another</button>`;
  mountEl.appendChild(host);

  const stackEl = host.querySelector(".reveal__stack");
  const hintEl = host.querySelector(".reveal__hint");
  const againEl = host.querySelector(".reveal__again");
  const particles = createParticles(host.querySelector(".reveal__fx"));

  let slots = []; // { slot, cardEl, card, spring }
  let cards = [];
  let pos = 0; // index of the current front card
  let peeking = true; // true while still inside the pack (peeking through the gap)

  // ---- hold to spread the stack -------------------------------------------------
  // A quick tap flips to the next card. Press and HOLD and the whole stack slides
  // apart in PARALLEL — every card steps out along your finger by a fixed amount, so
  // only each card's side edge shows (a real deck cracked open at an angle). Let go
  // and it closes back to the front-view stack. (A quick drag tilts the holo — and
  // the front card keeps tilting toward your finger while the stack is spread, too.)
  let browsing = false; // the stack is spread open (or animating)
  let fanActive = false; // the spread owns the slots' inline transforms right now
  let dirX = EXPAND_DIR[0], dirY = EXPAND_DIR[1]; // unit cascade direction (steered by the finger)
  let centerX = 0, centerY = 0; // deck centre in screen px, for steering

  // One spring drives the spread: `open` 0→1 slides the stack from closed to cracked.
  const deckSpring = createSpring({
    rest: { open: 0 },
    stiffness: 0.2,
    damping: 0.82,
    onTick: (c) => expandRender(c.open),
  });

  // point the cascade from the deck centre toward the finger (ignore tiny moves so a
  // dead-still hold keeps the last/default direction)
  function steer(px, py) {
    const dx = px - centerX, dy = py - centerY, m = Math.hypot(dx, dy);
    if (m > 18) { dirX = dx / m; dirY = dy / m; }
  }

  function startExpand(px, py) {
    if (peeking || pos >= cards.length) return;
    const r = stackEl.getBoundingClientRect();
    centerX = r.left + r.width / 2;
    centerY = r.top + r.height / 2;
    steer(px, py); // aim it toward where you pressed
    browsing = true;
    fanActive = true;
    host.classList.add("browsing"); // freeze the CSS slot transition — the spring/drag drive it now
    deckSpring.reset({ open: 0 });
    deckSpring.set({ open: 1 });
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function expandDrag(px, py) {
    if (!browsing) return;
    steer(px, py);
    expandRender(deckSpring.cur.open); // re-aim immediately, 1:1 with the finger
  }

  function endExpand() {
    browsing = false;
    deckSpring.set({ open: 0 }); // close; expandRender finalises at rest
  }

  // Slide every live card out PARALLEL by `d` steps along the cascade direction (no
  // rotation, same size) so the cards behind the front one reveal only their side
  // edge. The front card stays put and on top; open 0 matches the CSS resting stack,
  // so when it closes we hand the slots back to CSS with no visible jump.
  function expandRender(open) {
    if (!browsing && open <= 0.01) {
      if (fanActive) {
        fanActive = false;
        host.classList.remove("browsing");
        slots.forEach((s) => { s.slot.style.transform = ""; });
        layout(); // restore --d / z-index / front pointer-events
        deckSpring.stop();
      }
      return;
    }
    if (!fanActive) return; // torn down already — ignore the spring's tail-end ticks
    const k = Math.max(0, open);
    for (let i = 0; i < slots.length; i++) {
      if (i < pos) continue; // already flung — leave it to the .flung CSS
      const d = i - pos;
      // stacked (open 0) — mirrors `body.revealing .reveal__slot:not(.flung)` in pack.html
      const ty0 = 5 * d, sc0 = 1 - 0.02 * d;
      // cracked open (open 1) — slid out d steps along the cascade dir, back to full size
      const slide = EXPAND_EDGE * d;
      const tx = dirX * slide * k;
      const ty = ty0 + (dirY * slide - ty0) * k;
      const sc = sc0 + (1 - sc0) * k;
      slots[i].slot.style.transform =
        `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${sc.toFixed(3)})`;
    }
  }

  // Render + load the whole stack UP FRONT, behind the still-sealed pack, so the
  // top card sits INSIDE the pack and peeks through the tear gap as you rip — and
  // there's nothing to fetch or build when the pack finally opens.
  function prepare(packCards) {
    cards = packCards || [];
    pos = 0;
    browsing = false;
    fanActive = false;
    deckSpring.stop();
    host.classList.remove("browsing");
    slots.forEach((s) => s.spring.stop());
    stackEl.innerHTML = "";
    slots = cards.map(makeSlot);
    againEl.hidden = true;
    hintEl.textContent = ""; // no hint until the cards are out
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
    updateHint();
    flourishIfRare();
  }

  function close() {
    host.classList.add("hidden");
    host.classList.remove("browsing");
    document.body.classList.remove("revealing");
    peeking = true;
    browsing = false;
    fanActive = false;
    deckSpring.stop();
    slots.forEach((s) => s.spring.stop());
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

    // the front card's tilt + holo, eased by the shared spring
    const spring = createSpring({
      rest: { rx: 0, ry: 0, mx: 50, my: 50, px: 50, py: 50, hyp: 0 },
      stiffness: 0.12,
      damping: 0.82,
      onTick: (c) => {
        cardEl.style.transform = `rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg)`;
        cardEl.style.setProperty("--mx", c.mx.toFixed(1) + "%");
        cardEl.style.setProperty("--my", c.my.toFixed(1) + "%");
        cardEl.style.setProperty("--posx", c.px.toFixed(1) + "%");
        cardEl.style.setProperty("--posy", c.py.toFixed(1) + "%");
        cardEl.style.setProperty("--hyp", c.hyp.toFixed(3));
      },
    });

    const entry = { slot, cardEl, card, spring };
    let downX = 0, downY = 0, moved = false, holding = false, gestureMode = null, holdTimer = null;
    const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

    const isFront = () => slots[pos] === entry;
    const tilt = (e) => {
      const r = cardEl.getBoundingClientRect();
      const cx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
      const cy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
      spring.set({
        rx: cy * TILT,
        ry: -cx * TILT,
        mx: 50 + cx * 50,
        my: 50 + cy * 50,
        px: 50 + cx * FOIL_X,
        py: 50 + cy * FOIL_Y,
        hyp: Math.min(1, Math.hypot(cx, cy)),
      });
    };

    slot.addEventListener("pointerdown", (e) => {
      if (!isFront()) return;
      holding = true;
      moved = false;
      gestureMode = null;
      downX = e.clientX;
      downY = e.clientY;
      try { slot.setPointerCapture?.(e.pointerId); } catch {} // never let a stray pointer id abort the gesture
      // hold still (no real drag) for HOLD_MS → spread the stack open
      clearHold();
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (holding && gestureMode === null) { gestureMode = "expand"; moved = true; startExpand(downX, downY); }
      }, HOLD_MS);
    });
    slot.addEventListener("pointermove", (e) => {
      if (!holding || !isFront()) return;
      if (gestureMode === "expand") { expandDrag(e.clientX, e.clientY); tilt(e); return; } // steer the spread + keep tilting the front card
      const dx = e.clientX - downX, dy = e.clientY - downY;
      // moving past the slop before the hold fires makes this a tilt-drag, not a hold
      if (gestureMode !== "tilt" && Math.hypot(dx, dy) > TILT_SLOP) {
        gestureMode = "tilt";
        moved = true;
        clearHold();
      }
      if (gestureMode === "tilt") tilt(e); // follow the pointer for the holo (no pre-tilt during a hold)
    });
    const release = () => {
      if (!holding) return;
      holding = false;
      clearHold();
      spring.set({ rx: 0, ry: 0, mx: 50, my: 50, px: 50, py: 50, hyp: 0 }); // ease the front card flat
      if (gestureMode === "expand") {
        endExpand(); // let go of the hold → the stack closes back up
      } else if (!moved) {
        advance(); // a quick tap flicks the card away to the next
      }
      gestureMode = null;
    };
    slot.addEventListener("pointerup", release);
    slot.addEventListener("pointercancel", release);
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
    if (pos >= cards.length) return;
    sfx.flick();
    pos++;
    layout();
    if (pos < cards.length) {
      flourishIfRare();
      updateHint();
    } else {
      hintEl.textContent = "That's the pack!";
      againEl.hidden = false;
    }
  }

  // When the current front card is a hit, glow it and pop a foil burst + chime.
  function flourishIfRare() {
    const s = slots[pos];
    if (!s) return;
    const tier = rarityToTier(s.card);
    s.slot.classList.toggle("rare", tier >= RARE_TIER);
    if (tier >= RARE_TIER) {
      const r = host.getBoundingClientRect();
      particles.emit(r.left + r.width / 2, r.top + r.height * 0.44, { // where the centered card sits
        count: 46,
        speed: 7,
        spread: Math.PI * 2,
        colors: FOIL,
        gravity: 0.06,
        life: 70,
        size: 3,
      });
      sfx.chime(tier);
      if (navigator.vibrate) navigator.vibrate([10, 40, 12]);
    }
  }

  function updateHint() {
    hintEl.textContent = `${pos + 1} / ${cards.length} · tap to flip · hold to spread`;
  }

  againEl.addEventListener("click", () => {
    close();
    onAgain?.();
  });

  return { prepare, wake, show, close };
}

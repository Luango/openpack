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
const FAN_SLOP = 14; // px of horizontal travel that turns a press into a fan-browse drag
const FAN_DRAG_PER_CARD = 90; // px of horizontal drag that scrubs one card along the fan
const FAN_STEP_X = 64; // fanned spacing between neighbouring cards (px)
const FAN_STEP_Y = 14; // how far off-centre cards sink (px per step) — gives the hand its arc
const FAN_STEP_ROT = 5; // arc rotation per step from centre (deg)
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

  // ---- fan-browse ---------------------------------------------------------------
  // Press-drag the deck left/right and it spreads into a hand you can slide through
  // to read each card; release and it springs back to the stack. (Tap still flips
  // to the next card — see the slot handlers + `advance`.)
  let browsing = false; // a fan-browse drag is in progress
  let fanActive = false; // the fan owns the slots' inline transforms right now

  // One spring drives the whole deck: `open` 0→1 morphs stacked→fanned; `center`
  // is the (fractional) card index sitting in the middle. fanRender reads both.
  const deckSpring = createSpring({
    rest: { open: 0, center: 0 },
    stiffness: 0.2,
    damping: 0.8,
    onTick: (c) => fanRender(c.open, c.center),
  });

  function startBrowse() {
    if (peeking || pos >= cards.length) return;
    browsing = true;
    fanActive = true;
    host.classList.add("browsing"); // freeze the CSS slot transition — the spring drives it now
    slots[pos]?.spring.set({ rx: 0, ry: 0, mx: 50, my: 50, px: 50, py: 50, hyp: 0 }); // flatten the focused card
    deckSpring.reset({ open: 0, center: pos }); // start from the stacked state, centred on the top card
    deckSpring.set({ open: 1, center: pos }); // …and fan it open
  }

  function browseDrag(dx) {
    if (!browsing) return;
    // drag left → later cards slide to the centre; clamp to the remaining range
    const center = Math.max(pos, Math.min(cards.length - 1, pos - dx / FAN_DRAG_PER_CARD));
    deckSpring.set({ open: 1, center });
  }

  function endBrowse() {
    browsing = false;
    deckSpring.set({ open: 0, center: pos }); // collapse back to the top; fanRender finalises at rest
  }

  // Place every live slot between its stacked spot (open 0) and its fanned spot
  // (open 1). The open-0 values are computed to MATCH the CSS stacked fan, so when
  // the fan fully closes we can clear the inline styles and hand back to CSS with
  // no visible jump.
  function fanRender(open, center) {
    // Collapse finished → hand the slots back to CSS exactly once. `open` can ring
    // slightly past 0 before it settles, so use a soft threshold AND tear down via
    // `fanActive` so a trailing tick can't re-apply the inline transforms.
    if (!browsing && open <= 0.01) {
      if (fanActive) {
        fanActive = false;
        host.classList.remove("browsing");
        slots.forEach((s) => {
          s.slot.style.transform = "";
          s.slot.style.opacity = "";
        });
        layout(); // restore --d / z-index / front pointer-events
        deckSpring.stop();
      }
      return;
    }
    if (!fanActive) return; // torn down already — ignore stray ticks while center settles
    const k = Math.max(0, open);
    for (let i = 0; i < slots.length; i++) {
      if (i < pos) continue; // already flung — leave it to the .flung CSS
      const d = i - pos;
      // stacked (open 0) — mirrors `body.revealing .reveal__slot:not(.flung)` in pack.html
      const tx0 = 7 * d, ty0 = 5 * d, sc0 = 1 - 0.013 * d, z0 = 100 - d;
      // fanned (open 1) — a hand spread around `center`
      const o = i - center;
      const ax = Math.abs(o);
      const tx1 = o * FAN_STEP_X;
      const ty1 = ax * FAN_STEP_Y;
      const sc1 = Math.max(0.8, 1 - ax * 0.06);
      const rot1 = o * FAN_STEP_ROT;
      const z1 = Math.round(300 - ax * 10);
      const op1 = Math.max(0.4, 1 - ax * 0.18);
      const st = slots[i].slot.style;
      st.transform =
        `translate(${(tx0 + (tx1 - tx0) * k).toFixed(1)}px, ${(ty0 + (ty1 - ty0) * k).toFixed(1)}px)` +
        ` scale(${(sc0 + (sc1 - sc0) * k).toFixed(3)}) rotate(${(rot1 * k).toFixed(2)}deg)`;
      st.zIndex = String(Math.round(z0 + (z1 - z0) * k));
      st.opacity = (1 + (op1 - 1) * k).toFixed(2);
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
    let downX = 0, downY = 0, moved = false, holding = false, gestureMode = null;

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
      slot.setPointerCapture?.(e.pointerId);
      tilt(e);
    });
    slot.addEventListener("pointermove", (e) => {
      if (!holding || !isFront()) return;
      const dx = e.clientX - downX, dy = e.clientY - downY;
      if (gestureMode === "browse") { browseDrag(dx); return; }
      // a clearly horizontal drag fans the deck out to browse; anything else tilts
      if (Math.abs(dx) > FAN_SLOP && Math.abs(dx) > Math.abs(dy)) {
        gestureMode = "browse";
        moved = true;
        startBrowse();
        browseDrag(dx);
        return;
      }
      if (Math.hypot(dx, dy) > TAP_SLOP) { gestureMode = "tilt"; moved = true; }
      tilt(e);
    });
    const release = () => {
      if (!holding) return;
      holding = false;
      if (gestureMode === "browse") {
        endBrowse(); // collapse the fan back to the stack — browsing never advances
      } else {
        spring.set({ rx: 0, ry: 0, mx: 50, my: 50, px: 50, py: 50, hyp: 0 }); // ease flat
        if (!moved) advance(); // a tap (not a tilt-drag) flicks the card away
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
    hintEl.textContent = `${pos + 1} / ${cards.length} · tap to flip · drag to fan`;
  }

  againEl.addEventListener("click", () => {
    close();
    onAgain?.();
  });

  return { prepare, wake, show, close };
}

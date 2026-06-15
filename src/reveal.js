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

  // Render + load the whole stack UP FRONT, behind the still-sealed pack, so the
  // top card sits INSIDE the pack and peeks through the tear gap as you rip — and
  // there's nothing to fetch or build when the pack finally opens.
  function prepare(packCards) {
    cards = packCards || [];
    pos = 0;
    slots.forEach((s) => s.spring.stop());
    stackEl.innerHTML = "";
    slots = cards.map(makeSlot);
    againEl.hidden = true;
    hintEl.textContent = ""; // no hint until the cards are out
    host.classList.remove("hidden"); // visible, but BEHIND the pack (z-index) — hidden by the foil
    layout(); // the front card sits in "peek" position behind the pack
  }

  // Open the prepared stack — instant. The pack drops away (CSS, body.revealing),
  // uncovering the SAME stack that was inside it, in place — no card springs or
  // pops out; the top card is simply there once the foil is gone.
  function show() {
    if (!slots.length) return;
    document.body.classList.add("revealing"); // the pack drops away + stops taking taps
    particles.resize(); // the canvas was sized while hidden (zero rect) — re-measure
    peeking = false;
    layout(); // the top card is now interactive (it never moved — just uncovered)
    updateHint();
    flourishIfRare();
  }

  function close() {
    host.classList.add("hidden");
    document.body.classList.remove("revealing");
    peeking = true;
    slots.forEach((s) => s.spring.stop());
  }

  function makeSlot(card) {
    const slot = document.createElement("div");
    slot.className = "reveal__slot";
    slot.innerHTML = renderCard(card, { variant: "detail" });
    const cardEl = slot.querySelector(".card");
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
    let downX = 0, downY = 0, moved = false, holding = false;

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
      downX = e.clientX;
      downY = e.clientY;
      slot.setPointerCapture?.(e.pointerId);
      tilt(e);
    });
    slot.addEventListener("pointermove", (e) => {
      if (!holding || !isFront()) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_SLOP) moved = true;
      tilt(e);
    });
    const release = () => {
      if (!holding) return;
      holding = false;
      spring.set({ rx: 0, ry: 0, mx: 50, my: 50, px: 50, py: 50, hyp: 0 }); // ease flat
      if (!moved) advance(); // a tap (not a tilt-drag) flicks the card away
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
    hintEl.textContent = `${pos + 1} / ${cards.length} · tap to reveal`;
  }

  againEl.addEventListener("click", () => {
    close();
    onAgain?.();
  });

  return { prepare, show, close };
}

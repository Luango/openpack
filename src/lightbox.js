import { renderCard } from "./card.js";
import { escapeHtml } from "./util.js";
import { createSpring } from "./motion.js";

// Tuned to match the feel of Simey's poke-holo (poke-holo.simey.me):
//   ±14° symmetric pointer-tilt, a loose/elastic spring, and a holo foil whose
//   parallax is much narrower than the glare's. Layered on our own swipe-to-flip:
//   the card opens face-up and you turn it over to the back.
const MAX_TILT = 14; // Simey divides the centered pointer by 3.5 → ~±14.3°, symmetric

// Glare tracks the pointer across the full face; the foil shifts within a much
// narrower band (Simey maps 0–100% → 37–63% / 33–67%) — that mismatch reads as
// depth. These are the half-ranges (±) about the 50% center.
const FOIL_HALF_X = 13; // → 37…63%
const FOIL_HALF_Y = 17; // → 33…67%

// Press and hold to grow the card for a closer read.
const MAX_SCALE = 1.25;

// Spring rates (see motion.js): the tilt tracks the pointer promptly; the
// hold-to-grow scale eases on its own slower rate so it builds deliberately.
const STIFF = 0.12;
const DAMP = 0.82;
const SCALE_STIFF = 0.05;

// Pointer travel (px) past which a press counts as a drag, not a tap. A tap on
// the back flips it to the front; a drag spins it.
const TAP_SLOP = 6;

// Animated quantities. `flip` is the accumulated face rotation (starts at 0° so
// the card opens face-up showing the front, settles to a multiple of 180°); `rx`
// and `ty` are the small ±14° pointer-tilt added on top; the rest drive the
// glare focus, foil shift, and holo intensity.
const REST = { rx: 0, flip: 0, ty: 0, scale: 1, mx: 50, my: 50, posx: 50, posy: 50, hyp: 0 };

// Full-size card viewer. The card opens face-up (showing the holo front); hold
// and swipe it to spin it over and reveal the back — like turning a real card in
// your hand. Mouse hover tilts the card ±14°; pressing and swiping additionally
// spins it around Y (a full card-width swipe ≈ 180°). On release it eases back to
// flat, settling onto whichever face is closest. Motion is spring-driven (rAF).
export function createLightbox({ overlayEl, hostEl, captionEl, closeEl }) {
  let cardEl = null; // current .card--detail element (recreated each open)
  let imgEl = null;
  let current = null;
  let dragging = false; // a pointer is held down on the card and driving the spin
  let lastX = null; // previous pointer X, for the horizontal-swipe delta
  let downX = 0, downY = 0, moved = false; // tap-vs-drag for the current press

  // The shared spring eases the quantities; each tick writes the card's
  // transform + holo vars. No perspective() here — #lightbox-host provides it
  // (see base.css); the small tilt (ty) rides on the accumulated flip.
  const spring = createSpring({
    rest: REST,
    stiffness: STIFF,
    damping: DAMP,
    stiffnessByKey: { scale: SCALE_STIFF },
    onTick: (c) => {
      if (!cardEl) return;
      cardEl.style.transform =
        `rotateX(${c.rx.toFixed(2)}deg) rotateY(${(c.flip + c.ty).toFixed(2)}deg) ` +
        `scale3d(${c.scale.toFixed(3)}, ${c.scale.toFixed(3)}, 1)`;
      cardEl.style.setProperty("--mx", c.mx.toFixed(1) + "%");
      cardEl.style.setProperty("--my", c.my.toFixed(1) + "%");
      cardEl.style.setProperty("--posx", c.posx.toFixed(1) + "%");
      cardEl.style.setProperty("--posy", c.posy.toFixed(1) + "%");
      cardEl.style.setProperty("--hyp", c.hyp.toFixed(3));
    },
  });
  const tgt = spring.target; // accumulate/assign targets directly (matches the gesture math)

  // Pointer drives the tilt, glare, and foil from its position over the card.
  // While held and dragging, horizontal motion accumulates into the flip. Mouse
  // tilts on hover; touch (which can't hover) only acts while pressed.
  function onPointerMove(e) {
    if (!cardEl) return;
    const overCard = cardEl.contains(e.target);
    if (!dragging && !(e.pointerType === "mouse" && overCard)) {
      if (e.pointerType === "mouse") rest(); // hovered off the card → ease back
      return;
    }

    const r = cardEl.getBoundingClientRect();
    const clamp = (v) => Math.max(-1, Math.min(1, v));

    if (dragging && lastX != null) tgt.flip += (e.clientX - lastX) * (180 / r.width);
    if (dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_SLOP) moved = true;
    lastX = e.clientX;

    const cx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2));
    const cy = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2));
    tgt.rx = cy * MAX_TILT; // pitch toward the pointer
    tgt.ty = -cx * MAX_TILT; // yaw toward the pointer (rides on the flip)
    tgt.mx = 50 + cx * 50; // glare: full-range follow
    tgt.my = 50 + cy * 50;
    tgt.posx = 50 + cx * FOIL_HALF_X; // foil: narrow parallax band
    tgt.posy = 50 + cy * FOIL_HALF_Y;
    tgt.hyp = Math.min(1, Math.hypot(cx, cy));
    spring.start();
  }

  // Float back to rest: settle onto the nearest face (even multiple of 180° =
  // front, odd = back), flatten the tilt, and fade the glare/foil out.
  function rest() {
    tgt.flip = Math.round(tgt.flip / 180) * 180;
    tgt.rx = 0;
    tgt.ty = 0;
    tgt.scale = 1;
    tgt.mx = tgt.my = tgt.posx = tgt.posy = 50;
    tgt.hyp = 0;
    spring.start();
  }

  // a tap on the back: spin springily to the nearest front-facing angle
  function flipToFront() {
    tgt.flip = Math.round(spring.cur.flip / 360) * 360;
    spring.start();
  }
  // currently showing the back? (flip is an odd multiple of 180°)
  const showingBack = () => Math.round(spring.cur.flip / 180) % 2 !== 0;

  function open(card) {
    if (!card) return;
    current = card;

    // Render the shared Card on the cached thumbnail so it has full size + a
    // working tilt instantly; then upgrade to the full-res scan.
    hostEl.innerHTML = renderCard(card, { variant: "detail" });
    cardEl = hostEl.querySelector(".card");
    imgEl = cardEl.querySelector(".card__art");

    if (card.image && card.image !== imgEl.src) {
      const hi = new Image();
      hi.onload = () => {
        if (!overlayEl.classList.contains("hidden") && current === card) imgEl.src = card.image;
      };
      hi.src = card.image;
    }

    captionEl.innerHTML =
      `${escapeHtml(card.name)} · <span class="cap-rarity">${escapeHtml(card.rarity)}</span>` +
      ` · ${escapeHtml(card.set || "")} #${escapeHtml(card.number || "?")}`;

    spring.reset(); // open face-up at rest (REST.flip is 0°)

    overlayEl.classList.remove("hidden");
    overlayEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden"; // lock scroll behind the overlay
  }

  function close() {
    spring.stop();
    dragging = false;
    lastX = null;
    overlayEl.classList.add("hidden");
    overlayEl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    current = null;
  }

  closeEl.addEventListener("click", close);
  overlayEl.addEventListener("click", (e) => {
    if (!cardEl || !cardEl.contains(e.target)) {
      close(); // a click off the card dismisses
    } else if (!moved && showingBack()) {
      flipToFront(); // a tap (not a swipe) on the back flips it to the front
    }
  });

  // Hold and swipe to spin the card; mouse also tilts on hover. Pointer Events
  // unify mouse and touch. touch-action:none on the overlay (CSS) keeps a finger
  // drag driving the card instead of scrolling the page.
  overlayEl.addEventListener("pointerdown", (e) => {
    if (!cardEl || !cardEl.contains(e.target)) return; // ignore backdrop presses
    dragging = true;
    lastX = e.clientX;
    downX = e.clientX;
    downY = e.clientY;
    moved = false;
    tgt.scale = MAX_SCALE; // hold to grow toward the max
    overlayEl.setPointerCapture?.(e.pointerId); // keep moves coming if it strays off
    onPointerMove(e); // tilt from the contact point at once
  });
  overlayEl.addEventListener("pointermove", onPointerMove);
  const release = () => {
    dragging = false;
    lastX = null;
    rest();
  };
  overlayEl.addEventListener("pointerup", release);
  overlayEl.addEventListener("pointercancel", release);
  overlayEl.addEventListener("pointerleave", () => {
    if (!dragging) rest(); // pointer left the overlay entirely
  });
  // a hold drives the tilt — block the long-press "save image" context menu
  overlayEl.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlayEl.classList.contains("hidden")) close();
  });

  return { open, close };
}

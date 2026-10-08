// openlight.js — the opening's light, outside the pack.
//
// Everything the released light does to the ROOM, as opposed to what it does to
// the foil (that part lives in the pack renderer): the surroundings going almost
// black when the pack is gripped, a faint gold pool reflected beneath it, the one
// warm-white flash at the instant the seal breaks, a few broad soft beams escaping
// upward from the torn mouth, and sparse illuminated dust drifting out of it.
//
// It is a single fixed layer BEHIND the pack and the cards (z 0, over the page
// backdrop) plus a flash plane in front of everything, so the beams keep
// burning while the pack body drops away and the card rises through them. The
// beams are drawn on a 2D canvas from a pre-baked soft wedge sprite (no blur
// filters, no per-frame gradients); dust motes get depth (size, softness,
// parallax) and a short motion-blur smear. The loop runs only while something is
// lit. Shared by the 3D pack, the SVG fallback and the pack lab.
//
//   const light = getOpenLight();
//   light.dim(1);                         // grip: the room goes dark
//   light.floor(rect, 0.15);              // a gold pool under the pack's rect
//   light.leak(x, y, rate);               // dust escaping at the tear tip
//   light.flash(power);                   // the seal breaks
//   light.release({ x, y, width, tier }); // beams + a tight burst of dust
//   light.setSource(x, y);                // the mouth moved (the pack straightening)
//   light.settle();                       // hand-off: beams/dim fade, the card takes over
//   light.reset();                        // next pack

const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const COARSE = window.matchMedia?.("(pointer: coarse)").matches ?? false;

let instance = null;
export function getOpenLight() {
  if (!instance) instance = createOpenLight();
  return instance;
}

const CSS = `
.open-light { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.open-light__dim { position: absolute; inset: 0; background: #050302; opacity: 0; will-change: opacity; }
.open-light__floor {
  position: absolute; left: 0; top: 0; width: 100px; height: 40px;
  transform: translate(-50%, -18%);
  border-radius: 50%;
  background: radial-gradient(ellipse at 50% 0%, rgba(255, 221, 140, 0.6) 0%, rgba(255, 178, 64, 0.22) 38%, rgba(255, 150, 40, 0) 70%);
  filter: blur(14px); /* static — rastered once; only opacity animates */
  opacity: 0; will-change: opacity;
}
.open-light__canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.open-flash {
  position: fixed; inset: 0; z-index: 40; pointer-events: none; opacity: 0; will-change: opacity;
  /* warm-white at the mouth, gone before the edges: a burst of light, not a screen wash */
  background: radial-gradient(circle at var(--fx, 50%) var(--fy, 30%),
    rgba(255, 252, 240, 1) 0%, rgba(255, 238, 196, 0.92) 11%, rgba(255, 214, 130, 0.5) 26%,
    rgba(255, 180, 80, 0.16) 44%, rgba(255, 160, 60, 0) 62%);
}
`;
function ensureStyle() {
  if (document.getElementById("open-light-style")) return;
  const s = document.createElement("style");
  s.id = "open-light-style";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// A soft light wedge, baked once per tint: narrow at the base (the source), widening
// along its length, brightest at the base and gone before the far end, with a
// smooth bell across. Drawn additively, scaled to each beam's width and length.
function bakeWedge(c0, c1, W = 160, H = 640) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const half = 0.17 + 0.33 * v; // the wedge: a third of the width at the base, full at the end
    const along = Math.pow(1 - v, 1.25) * smooth(clamp01(v / 0.035 + 0.3));
    const r = lerp(c0[0], c1[0], v), gg = lerp(c0[1], c1[1], v), b = lerp(c0[2], c1[2], v);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const across = clamp01(1 - Math.abs(u) / half);
      const a = smooth(across) * along;
      const o = (y * W + x) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
// a soft round mote — white-hot centre into the tint — baked once per softness
function bakeMote(tint, soft) {
  const R = 24;
  const c = document.createElement("canvas");
  c.width = c.height = R * 2;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(R, R, 0, R, R, R);
  rg.addColorStop(0, "rgba(255,255,255,0.95)");
  rg.addColorStop(soft ? 0.08 : 0.2, tint);
  rg.addColorStop(soft ? 0.45 : 0.62, soft ? "rgba(255,200,110,0.22)" : "rgba(255,200,110,0.12)");
  rg.addColorStop(1, "rgba(255,180,80,0)");
  g.fillStyle = rg;
  g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.fill();
  return c;
}

function createOpenLight() {
  ensureStyle();
  const root = document.createElement("div");
  root.className = "open-light";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `<div class="open-light__dim"></div><div class="open-light__floor"></div><canvas class="open-light__canvas"></canvas>`;
  const flashEl = document.createElement("div");
  flashEl.className = "open-flash";
  flashEl.setAttribute("aria-hidden", "true");
  document.body.append(root, flashEl);
  const dimEl = root.querySelector(".open-light__dim");
  const floorEl = root.querySelector(".open-light__floor");
  const canvas = root.querySelector(".open-light__canvas");
  const ctx = canvas.getContext("2d");

  const GOLD = bakeWedge([255, 243, 212], [255, 176, 58]);
  const CORE = bakeWedge([255, 252, 240], [255, 226, 160]);
  const MOTE = bakeMote("rgba(255,236,190,0.95)", false);
  const MOTE_SOFT = bakeMote("rgba(255,222,150,0.8)", true);

  let vw = 1, vh = 1;
  function resize() {
    const dpr = COARSE ? 1 : Math.min(2, window.devicePixelRatio || 1);
    vw = window.innerWidth; vh = window.innerHeight;
    canvas.width = Math.max(1, Math.round(vw * dpr));
    canvas.height = Math.max(1, Math.round(vh * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  // ---- state ----------------------------------------------------------------------
  const src = { x: vw / 2, y: vh * 0.3, w: 200 }; // the mouth, in viewport px
  let beams = null; // { list, t, settleAt, fade }
  let glow = 0; // the source haze
  let motes = [];
  let emitAcc = 0;
  let drift = null; // slow dust from the mouth during the hold: { rate, until }
  let raf = 0, lastT = 0;
  let flashAnim = null;

  // ---- the room --------------------------------------------------------------------
  function dim(level, ms = 450) {
    dimEl.style.transition = `opacity ${ms}ms ${level > 0 ? "ease-out" : "ease-in-out"}`;
    dimEl.style.opacity = (clamp01(level) * 0.84).toFixed(3);
  }
  function floor(rect, level, ms = 400) {
    if (rect) {
      const w = rect.width * 2.1, h = rect.width * 0.62;
      floorEl.style.width = `${w.toFixed(0)}px`;
      floorEl.style.height = `${h.toFixed(0)}px`;
      floorEl.style.left = `${(rect.left + rect.width / 2).toFixed(1)}px`;
      floorEl.style.top = `${(rect.bottom - rect.height * 0.03).toFixed(1)}px`;
    }
    floorEl.style.transition = `opacity ${ms}ms ease-out`;
    floorEl.style.opacity = clamp01(level).toFixed(3);
  }
  function flash(power = 0.7, x = src.x, y = src.y) {
    if (!flashEl.animate) return;
    flashEl.style.setProperty("--fx", `${x.toFixed(0)}px`);
    flashEl.style.setProperty("--fy", `${y.toFixed(0)}px`);
    const peak = REDUCED ? 0.4 : 0.86 + 0.14 * clamp01(power);
    flashAnim?.cancel();
    flashAnim = flashEl.animate(
      [{ opacity: 0 }, { opacity: peak, offset: 0.2 }, { opacity: peak * 0.5, offset: 0.42 }, { opacity: 0 }],
      { duration: REDUCED ? 180 : 270, easing: "ease-out", fill: "none" }
    );
  }

  // ---- beams -------------------------------------------------------------------------
  // the available length toward the viewport edge along a direction, so a beam
  // always fades out before it reaches the frame
  function reach(ang) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (vw - src.x) / dx);
    if (dx < -1e-6) t = Math.min(t, -src.x / dx);
    if (dy > 1e-6) t = Math.min(t, (vh - src.y) / dy);
    if (dy < -1e-6) t = Math.min(t, -src.y / dy);
    return Number.isFinite(t) ? t : vh;
  }
  function release({ x, y, width, tier = 0, up = -Math.PI / 2 } = {}) {
    if (x != null) { src.x = x; src.y = y; }
    if (width) src.w = width;
    const n = 3 + (tier >= 4 ? 1 : 0) + (tier >= 7 ? 1 : 0); // 3 common → 5 for a chase
    // mostly upward: one straight up, a pair leaning out, one or two further off-axis;
    // mirrored at random so no two opens fan the same way
    const flip = Math.random() < 0.5 ? -1 : 1;
    const slots = [0, -0.62, 0.58, -1.08, 1.02].map((a) => a * flip);
    const list = [];
    for (let i = 0; i < n; i++) {
      const lean = slots[i] + (Math.random() - 0.5) * 0.24;
      const ang = up + lean;
      const vmin = Math.min(vw, vh);
      const width = vmin * (i === 0 ? 0.4 : 0.22 + Math.random() * 0.2) * (1 + 0.3 * Math.abs(lean));
      const want = vh * (i === 0 ? 0.8 : 0.55 + Math.random() * 0.3);
      list.push({
        ang, width,
        length: Math.min(want, 0.96 * reach(ang)),
        alpha: (i === 0 ? 1 : 0.7 + Math.random() * 0.3),
        swayAmp: REDUCED ? 0 : 0.02 + Math.random() * 0.03,
        swayHz: 0.1 + Math.random() * 0.14,
        phase: Math.random() * Math.PI * 2,
        bphase: Math.random() * Math.PI * 2,
      });
    }
    beams = { list, t: 0, settleAt: -1, fade: 1 };
    glow = 1;
    // a tight burst of dust straight out of the mouth, then a sparse drift
    burst(up, 12 + (tier >= 4 ? 4 : 0) + (tier >= 7 ? 4 : 0));
    drift = { rate: 7, until: Infinity, up };
    start();
  }
  function setSource(x, y) { src.x = x; src.y = y; }
  // the envelope of the released light: a quick peak as the flash settles, easing to a
  // sustained glow that breathes; then, on settle, out
  function envelope(t) {
    const rise = t < 0.14 ? 1 - Math.pow(1 - t / 0.14, 2) : 1;
    const ease = t < 0.14 ? 1 : lerp(1, 0.62, smooth(clamp01((t - 0.14) / 0.42)));
    const breathe = t > 0.56 ? 1 + 0.1 * Math.sin((t - 0.56) * 4.4) : 1;
    return rise * ease * breathe;
  }

  // ---- dust ------------------------------------------------------------------------------
  function spawn(x, y, ang, speed, { depth = Math.random(), life = 1.2 + Math.random() * 1.2 } = {}) {
    if (motes.length > (COARSE ? 42 : 64)) return;
    motes.push({
      x, y,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      depth, life, max: life, tw: Math.random() * Math.PI * 2, sway: 0.3 + Math.random() * 0.5,
    });
  }
  function burst(up, count) {
    const n = REDUCED ? Math.round(count * 0.4) : count;
    for (let i = 0; i < n; i++) {
      const ang = up + (Math.random() - 0.5) * 0.9;
      const spd = 160 + Math.random() * 300; // px/s
      const x = src.x + (Math.random() - 0.5) * src.w * 0.7;
      spawn(x, src.y, ang, spd, { life: 0.9 + Math.random() * 1.1 });
    }
  }
  // sparse motes escaping at the tear tip while it travels (rate = motes/s)
  function leak(x, y, rate = 6, up = -Math.PI / 2) {
    emitAcc += rate / 60;
    while (emitAcc >= 1) {
      emitAcc -= 1;
      spawn(x + (Math.random() - 0.5) * 6, y, up + (Math.random() - 0.5) * 1.4, 30 + Math.random() * 70, { life: 1 + Math.random() * 1.2 });
    }
    start();
  }

  // ---- the hand-off -------------------------------------------------------------------
  function settle() {
    if (beams && beams.settleAt < 0) beams.settleAt = beams.t;
    drift = null;
    dimEl.style.transition = "opacity 1400ms ease-in-out 250ms";
    dimEl.style.opacity = "0";
    floor(null, 0, 900);
    start();
  }
  function reset() {
    beams = null; drift = null; motes = []; glow = 0; emitAcc = 0;
    flashAnim?.cancel(); flashAnim = null;
    dimEl.style.transition = "none"; dimEl.style.opacity = "0";
    floorEl.style.transition = "none"; floorEl.style.opacity = "0";
    ctx.clearRect(0, 0, vw, vh);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    lastT = 0;
  }

  // ---- the loop --------------------------------------------------------------------------
  function start() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    ctx.clearRect(0, 0, vw, vh);
    ctx.globalCompositeOperation = "lighter";

    let lit = false;
    if (beams) {
      beams.t += dt;
      // on settle the beams linger while the card rises; the haze at the mouth goes
      // quickly, so no bright disc hangs over the card
      let hazeFade = 1;
      if (beams.settleAt >= 0) {
        beams.fade = 1 - smooth(clamp01((beams.t - beams.settleAt) / 0.95));
        hazeFade = 1 - smooth(clamp01((beams.t - beams.settleAt) / 0.38));
      }
      const E = envelope(beams.t) * beams.fade;
      if (E > 0.004) {
        lit = true;
        // the haze at the mouth — most of it hides behind the pack, the rest hangs above the opening
        const H = envelope(beams.t) * hazeFade;
        const rg = ctx.createRadialGradient(src.x, src.y, 0, src.x, src.y, src.w * 0.6);
        rg.addColorStop(0, `rgba(255,238,196,${(0.7 * H).toFixed(3)})`);
        rg.addColorStop(0.4, `rgba(255,196,90,${(0.22 * H).toFixed(3)})`);
        rg.addColorStop(1, "rgba(255,170,60,0)");
        ctx.fillStyle = rg;
        ctx.fillRect(src.x - src.w * 0.6, src.y - src.w * 0.6, src.w * 1.2, src.w * 1.2);
        for (const b of beams.list) {
          const sway = b.swayAmp * Math.sin(beams.t * b.swayHz * Math.PI * 2 + b.phase);
          const breathe = 1 + 0.04 * Math.sin(beams.t * 1.3 + b.bphase);
          const L = b.length * breathe, W = b.width;
          ctx.save();
          ctx.translate(src.x, src.y);
          ctx.rotate(b.ang + sway - Math.PI / 2);
          ctx.globalAlpha = Math.min(1, E * b.alpha);
          ctx.drawImage(GOLD, -W / 2, 0, W, L);
          ctx.globalAlpha = Math.min(1, E * b.alpha * 0.7);
          ctx.drawImage(CORE, -W * 0.2, 0, W * 0.4, L * 0.85);
          ctx.restore();
        }
      } else if (beams.settleAt >= 0) beams = null;
    }
    if (drift && motes.length < 24) {
      emitAcc += drift.rate * dt;
      while (emitAcc >= 1) {
        emitAcc -= 1;
        spawn(src.x + (Math.random() - 0.5) * src.w * 0.8, src.y + 2, drift.up + (Math.random() - 0.5) * 1.1, 25 + Math.random() * 60);
      }
    }
    if (motes.length) {
      lit = true;
      const alive = [];
      for (const m of motes) {
        m.life -= dt;
        if (m.life <= 0) continue;
        alive.push(m);
        const drag = Math.exp(-dt * 1.6);
        m.vx *= drag; m.vy *= drag;
        m.vy -= 9 * dt * (0.4 + m.depth); // buoyant: lit dust floats up
        m.tw += dt * 5;
        m.x += m.vx * dt + Math.sin(m.tw * 0.7) * m.sway * (0.5 + m.depth) * 60 * dt * 0.3;
        m.y += m.vy * dt;
        const t = m.life / m.max;
        const a = Math.pow(Math.min(1, t * 1.6), 1.3) * (0.3 + 0.7 * m.depth) * (0.8 + 0.2 * Math.sin(m.tw));
        const size = (1.6 + 3.2 * m.depth) * (0.6 + 0.4 * t);
        const spr = m.depth < 0.42 ? MOTE_SOFT : MOTE;
        const half = size * (m.depth < 0.42 ? 2.4 : 1.6);
        const speed = Math.hypot(m.vx, m.vy);
        if (!REDUCED && speed > 90) {
          // motion blur: a couple of dimmer echoes smeared back along the velocity
          const k = Math.min(0.04, 8 / speed);
          for (let i = 1; i <= 2; i++) {
            ctx.globalAlpha = a * 0.3 / i;
            ctx.drawImage(spr, m.x - m.vx * k * i - half, m.y - m.vy * k * i - half, half * 2, half * 2);
          }
        }
        ctx.globalAlpha = a;
        ctx.drawImage(spr, m.x - half, m.y - half, half * 2, half * 2);
      }
      motes = alive;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (lit || beams || drift) raf = requestAnimationFrame(frame);
    else lastT = 0;
  }

  return { dim, floor, flash, release, setSource, leak, settle, reset, get active() { return !!(beams || motes.length); } };
}

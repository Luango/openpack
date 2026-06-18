// particles.js — a tiny self-driving canvas particle system, tuned to read as
// LIGHT rather than flat confetti. emit() spawns particles at a point; they
// scatter with gravity, fade, and twinkle, and the rAF loop stops itself when
// empty.
//
// What makes it look premium instead of "programmer squares":
//   • additive ('lighter') compositing so overlapping flecks bloom into light
//   • pre-baked soft RADIAL sprites (white-hot core → color → transparent),
//     not hard-edged fillRect — cached one canvas per colour+shape
//   • a 4-point STAR sprite for sparkle hits, a soft BOKEH for dust, and the
//     original paper CHIP (matte fillRect) kept for the foil tear
//   • alpha eased on a curve + size shrink as a fleck dies (soft falloff)
//   • motion trails on fast flecks and a bloom echo on big bright ones
//   • honors prefers-reduced-motion (fewer, calmer) and caps live particles
//
//   const p = createParticles(canvasEl);
//   p.emit(x, y, { count: 10, speed: 4, dir: angle, colors: ["#fff"], shape: "star" });

const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
// On a phone (coarse pointer) the additive canvas is the dominant fill-rate cost,
// so cap its backing store to DPR 1 — soft glows don't need the extra resolution.
const COARSE = window.matchMedia?.("(pointer: coarse)").matches ?? false;
const MAX_PARTS = COARSE ? 150 : 260; // hard cap so a burst never tanks a mid phone's frame

export function createParticles(canvas) {
  const ctx = canvas.getContext("2d");
  let parts = [];
  let raf = null;
  const sprites = new Map(); // "shape|color" → offscreen canvas (baked once, reused)

  function resize() {
    const dpr = COARSE ? 1 : Math.min(2, window.devicePixelRatio || 1); // halve mobile fill-rate
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, r.width * dpr);
    canvas.height = Math.max(1, r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  }

  // Bake a soft additive sprite once per (shape,color). The gradient runs
  // white-hot core → the colour → transparent so it reads as a glowing mote;
  // "star" adds two crossed lens-flare streaks for a sparkle.
  function sprite(shape, color) {
    const key = shape + "|" + color;
    let s = sprites.get(key);
    if (s) return s;
    const R = 32; // baked at 64px; drawn scaled to each fleck's size
    const c = document.createElement("canvas");
    c.width = c.height = R * 2;
    const g = c.getContext("2d");
    const core = g.createRadialGradient(R, R, 0, R, R, R);
    core.addColorStop(0, "rgba(255,255,255,0.95)");
    core.addColorStop(0.22, color);
    core.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = core;
    g.beginPath();
    g.arc(R, R, R, 0, Math.PI * 2);
    g.fill();
    if (shape === "star") {
      // two soft crossed streaks → a 4-point sparkle / lens flare
      g.globalCompositeOperation = "lighter";
      for (const horiz of [true, false]) {
        const grad = horiz
          ? g.createLinearGradient(0, R, R * 2, R)
          : g.createLinearGradient(R, 0, R, R * 2);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.5, "rgba(255,255,255,0.9)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        if (horiz) g.fillRect(0, R - 1.1, R * 2, 2.2);
        else g.fillRect(R - 1.1, 0, 2.2, R * 2);
      }
    }
    s = c;
    sprites.set(key, s);
    return s;
  }

  function emit(x, y, opts = {}) {
    const {
      count = 8,
      speed = 3,
      dir = 0,
      spread = Math.PI * 2, // full scatter by default; pass a cone for directional spray
      colors = ["#ffffff"],
      gravity = 0.16,
      life = 42,
      size = 2.4,
      shape = "round", // "round" (bokeh) | "star" (sparkle) | "chip" (matte paper)
      trail = false, // streak fast flecks along their velocity
      bloom = false, // draw a soft halo echo under big/bright flecks
    } = opts;
    const additive = shape !== "chip";
    const n = REDUCED ? Math.max(1, Math.round(count * 0.4)) : count;
    for (let k = 0; k < n; k++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const v = speed * (0.4 + Math.random() * 0.9);
      const color = colors[(Math.random() * colors.length) | 0];
      parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        g: gravity,
        life: life * (0.7 + Math.random() * 0.6),
        max: life,
        size: size * (0.6 + Math.random() * 0.9),
        color,
        spr: additive ? sprite(shape, color) : null,
        additive,
        trail: trail && !REDUCED,
        bloom: bloom && !REDUCED,
        tw: Math.random() * Math.PI * 2, // twinkle phase
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.5,
      });
    }
    if (parts.length > MAX_PARTS) parts = parts.slice(parts.length - MAX_PARTS);
    if (!raf) raf = requestAnimationFrame(step);
  }

  function step() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = parts.filter((p) => p.life > 0);
    for (const p of parts) {
      p.life--;
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.tw += 0.5;
      const t = Math.max(0, p.life / p.max);

      if (!p.additive) {
        // matte paper chip — the original look, kept for the foil tear
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.7);
        ctx.restore();
        continue;
      }

      // glowing mote/sparkle — additive, soft, twinkling
      ctx.globalCompositeOperation = "lighter";
      const twinkle = 0.78 + 0.22 * Math.sin(p.tw);
      const alpha = Math.pow(t, 1.6) * twinkle; // ease the fade-out
      const sz = p.size * (0.55 + 0.45 * t); // shrink as it dies
      const half = sz * 1.7; // sprite glow extends past the nominal radius
      const speed = Math.hypot(p.vx, p.vy);

      if (p.trail && speed > 3) {
        // smear a couple of dimmer echoes back along the velocity → motion blur
        const steps = 3;
        for (let i = 1; i <= steps; i++) {
          ctx.globalAlpha = alpha * (0.34 / i);
          const ex = p.x - p.vx * i * 0.6;
          const ey = p.y - p.vy * i * 0.6;
          ctx.drawImage(p.spr, ex - half, ey - half, half * 2, half * 2);
        }
      }
      if (p.bloom && sz >= 2.6 && alpha > 0.4) {
        // a pre-blurred halo under the bright cores → cheap canvas bloom
        ctx.globalAlpha = alpha * 0.28;
        const bh = half * 2.3;
        ctx.drawImage(p.spr, p.x - bh, p.y - bh, bh * 2, bh * 2);
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(p.spr, p.x - half, p.y - half, half * 2, half * 2);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(step) : null;
  }

  resize();
  window.addEventListener("resize", resize);
  // resize() is exposed so a consumer can re-measure after revealing a canvas
  // that was created while hidden (display:none reports a zero-size rect).
  return { emit, resize };
}

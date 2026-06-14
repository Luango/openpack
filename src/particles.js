// particles.js — a tiny self-driving canvas particle system for foil flecks
// (the tear) and sparks (the hit). emit() spawns particles at a point; they
// scatter with gravity and fade, and the rAF loop stops itself when empty.
//
//   const p = createParticles(canvasEl);
//   p.emit(x, y, { count: 10, speed: 4, dir: angle, colors: ["#d7d4cc"] });

export function createParticles(canvas) {
  const ctx = canvas.getContext("2d");
  let parts = [];
  let raf = null;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, r.width * dpr);
    canvas.height = Math.max(1, r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  }

  function emit(x, y, opts = {}) {
    const {
      count = 8,
      speed = 3,
      dir = 0,
      spread = Math.PI * 2, // full scatter by default; pass a cone for directional spray
      colors = ["#d7d4cc"],
      gravity = 0.16,
      life = 42,
      size = 2.4,
    } = opts;
    for (let n = 0; n < count; n++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const v = speed * (0.4 + Math.random() * 0.9);
      parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        g: gravity,
        life: life * (0.7 + Math.random() * 0.6),
        max: life,
        size: size * (0.6 + Math.random() * 0.9),
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.5,
      });
    }
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
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.7); // a little paper fleck
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(step) : null;
  }

  resize();
  window.addEventListener("resize", resize);
  return { emit };
}

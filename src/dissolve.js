// dissolve.js — the player's photo DISSOLVING onto the card (reveal.js playerIn).
//
// The finished player (its loose canvas from cardPrint) is kept aside as the
// source, and each frame the canvas is rebuilt from it through a THRESHOLD over
// a noise field: a pixel is there once the front (t: 0 → 1) has passed its noise
// value, so the photo materialises grain by grain — blotches first, then the
// gaps between them fill — with a hot edge (white at the heart, the edition's
// colour round it) riding the front, glowing over what's about to appear and
// cooling on what just did. The field leans on the distance from the player's
// focus (the head, where the light swelled), so the face forms out of the light
// first and the body sweeps down after it.
//
//   const d = prepareDissolve(canvas, { focus: [x, y, r], color: "#f2c54b" });
//   d.frame(0.4);          // rebuild the canvas with the front at 0.4
//   d.sample();            // → [x, y] on the glowing edge (art px) for a mote, or null
//   d.finish();            // put the finished player back
//
// The field is computed at half resolution (plenty for a dissolve, a quarter of
// the work) and only over the player's bounding box.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// value noise: a random lattice at `cell` px, bilinear between the knots with a
// smoothstep so the blotches are round rather than diamond-shaped
function lattice(w, h, cell) {
  const cw = Math.ceil(w / cell) + 2, ch = Math.ceil(h / cell) + 2;
  const k = new Float32Array(cw * ch);
  for (let i = 0; i < k.length; i++) k[i] = Math.random();
  const smooth = (f) => f * f * (3 - 2 * f);
  return (x, y) => {
    const gx = x / cell, gy = y / cell;
    const x0 = gx | 0, y0 = gy | 0;
    const fx = smooth(gx - x0), fy = smooth(gy - y0);
    const i = y0 * cw + x0;
    const a = k[i], b = k[i + 1], c = k[i + cw], d = k[i + cw + 1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
}

function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function prepareDissolve(canvas, { focus, color = "#ffffff", scale = 0.5, band = 0.12, soft = 0.04 } = {}) {
  const W = canvas.width, H = canvas.height;
  const w = Math.round(W * scale), h = Math.round(H * scale);

  // the finished player, kept aside
  const full = document.createElement("canvas");
  full.width = W; full.height = H;
  full.getContext("2d").drawImage(canvas, 0, 0);

  // its alpha at half res → the bounding box the dissolve works over
  const small = document.createElement("canvas");
  small.width = w; small.height = h;
  const sg = small.getContext("2d", { willReadFrequently: true });
  sg.drawImage(full, 0, 0, w, h);
  const src = sg.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[(y * w + x) * 4 + 3] > 2) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null; // nothing to dissolve (no photo)
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  // the noise field over the box: blotches + a finer break-up + grain, pulled
  // outward from the focus so the front sets out from the head
  const blob = lattice(bw, bh, Math.max(6, Math.round(22 * scale * 2)));
  const mid = lattice(bw, bh, Math.max(3, Math.round(8 * scale * 2)));
  const [fxA, fyA, rA] = focus || [W / 2, H / 2, Math.min(W, H) / 3];
  const fx = fxA * scale - x0, fy = fyA * scale - y0, reach = Math.max(1, rA * scale * 1.7);
  const field = new Float32Array(bw * bh);
  const alpha = new Uint8ClampedArray(bw * bh);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      const a = src[((y + y0) * w + (x + x0)) * 4 + 3];
      alpha[i] = a;
      const d = clamp01(Math.hypot(x - fx, y - fy) / reach);
      const n = 0.42 * blob(x, y) + 0.16 * mid(x, y) + 0.1 * Math.random() + 0.32 * d;
      field[i] = n;
      if (a > 2) { if (n < lo) lo = n; if (n > hi) hi = n; }
    }
  }
  // normalise over the photo's own pixels, so t = 0 is the first grain and t = 1
  // the last — the front covers exactly the player, whatever its shape
  const span = Math.max(1e-6, hi - lo);
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - lo) / span;

  // per-frame buffers: the threshold as a mask, the hot edge as its own plate
  const maskC = document.createElement("canvas");
  maskC.width = w; maskC.height = h;
  const mg = maskC.getContext("2d");
  const edgeC = document.createElement("canvas");
  edgeC.width = w; edgeC.height = h;
  const eg = edgeC.getContext("2d");
  const maskImg = mg.createImageData(bw, bh);
  const edgeImg = eg.createImageData(bw, bh);
  const md = maskImg.data, ed = edgeImg.data;
  for (let i = 0; i < md.length; i += 4) { md[i] = md[i + 1] = md[i + 2] = 255; }
  const [cr, cg, cb] = hexRGB(color);
  const g = canvas.getContext("2d");
  let edge = 0; // how much of the front is glowing right now (for sample())

  // `t` runs 0 → 1 + band + soft: past 1 the last grains land and the glow cools
  function frame(t) {
    const ahead = band, behind = band * 0.55;
    edge = 0;
    for (let i = 0, p = 0; i < field.length; i++, p += 4) {
      const n = field[i];
      const a = alpha[i];
      // revealed once the front passes, over a `soft` ramp so the grains aren't jagged
      md[p + 3] = (clamp01((t - n) / soft + 0.5) * 255) | 0;
      // the glow: strongest at the front, dying over `ahead` of unrevealed photo
      // and `behind` of fresh photo
      const dn = n - t;
      const e = dn > 0 ? 1 - dn / ahead : 1 + dn / behind;
      if (e <= 0 || a < 3) { ed[p + 3] = 0; continue; }
      const k = e * e;
      ed[p] = cr + ((255 - cr) * k) | 0;
      ed[p + 1] = cg + ((255 - cg) * k) | 0;
      ed[p + 2] = cb + ((255 - cb) * k) | 0;
      ed[p + 3] = (e * a * 0.95) | 0;
      edge += e;
    }
    mg.putImageData(maskImg, x0, y0);
    eg.putImageData(edgeImg, x0, y0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, W, H);
    g.drawImage(full, 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(maskC, 0, 0, W, H);
    g.globalCompositeOperation = "lighter";
    g.drawImage(edgeC, 0, 0, W, H);
    g.globalCompositeOperation = "source-over";
  }

  // a random point on the glowing front, in art pixels — for a mote to lift off
  function sample() {
    if (edge < 1) return null;
    for (let k = 0; k < 14; k++) {
      const i = (Math.random() * field.length) | 0;
      if (ed[i * 4 + 3] > 120) return [(x0 + (i % bw) + 0.5) / scale, (y0 + ((i / bw) | 0) + 0.5) / scale];
    }
    return null;
  }

  function finish() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, W, H);
    g.drawImage(full, 0, 0);
  }

  return { frame, sample, finish, end: 1 + band + soft };
}

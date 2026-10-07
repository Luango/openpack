// paint.js — tiny shared helpers for the canvas-drawn football art (cards, flags,
// crests, portraits). Colour maths, a seeded RNG, cached Path2D, gradient/text
// shorthands. No DOM beyond the canvas contexts handed in.

// ---- colour ---------------------------------------------------------------

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
export const rgbToHex = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

// linear mix of two hex colours, t 0 → a … 1 → b
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

// amt > 0 lightens toward white, amt < 0 darkens toward black
export const shade = (hex, amt) => (amt >= 0 ? mix(hex, "#ffffff", amt) : mix(hex, "#000000", -amt));

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ---- deterministic randomness ----------------------------------------------
// Every player's look/stats derive from a seed, so a card always renders the same.

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // murmur3 finaliser — FNV alone leaves similar ids (p01, p03…) with correlated
  // seeds, which mulberry32's first outputs then echo (every 3rd player had locs)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function rng(seed) {
  let a = (typeof seed === "string" ? hashStr(seed) : seed) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  next(); next(); // warm up past the seed-adjacent first outputs
  return next;
}

// ---- paths & paints ----------------------------------------------------------

const _paths = new Map();
// SVG path data → Path2D, built once per string
export function P(d) {
  let p = _paths.get(d);
  if (!p) _paths.set(d, (p = new Path2D(d)));
  return p;
}

export function lin(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export function rad(ctx, x, y, r, stops, x0 = x, y0 = y, r0 = 0) {
  const g = ctx.createRadialGradient(x0, y0, r0, x, y, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

// polygon / star helpers return a Path2D in absolute coordinates
export function poly(points) {
  const p = new Path2D();
  points.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

export function starPath(cx, cy, r, points = 5, inner = 0.382, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = rot + (i * Math.PI) / points;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return poly(pts);
}

export function roundRect(x, y, w, h, r) {
  const p = new Path2D();
  r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
  return p;
}

// ---- text --------------------------------------------------------------------

// The card face font. Barlow Condensed is loaded by the page (Google Fonts, non-
// blocking); if it never arrives the stack falls back to each platform's own
// condensed face so a card still reads as a sports card.
export const FONT = `"Barlow Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", sans-serif`;
export const font = (weight, px, italic = false) => `${italic ? "italic " : ""}${weight} ${px}px ${FONT}`;

// The display face for the PRINTED headings (the pack's wordmark, the card back):
// an engraved Roman capital, the awards-night register — loaded by the page next to
// Barlow (same non-blocking sheet); a classical serif stands in if it never arrives.
export const SERIF = `"Cinzel", "Trajan Pro", "Cormorant Garamond", Georgia, "Times New Roman", serif`;
export const serif = (weight, px) => `${weight} ${px}px ${SERIF}`;

// fillText with manual tracking (canvas letterSpacing isn't everywhere yet).
// align: "left" | "center" | "right". Returns the drawn width.
export function spacedText(ctx, text, x, y, spacing = 0, align = "left", stroke = false) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    if (stroke) ctx.strokeText(c, cx, y);
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  ctx.textAlign = prev;
  return total;
}

// Shrink a font size until `text` fits maxW (with tracking); returns the px size.
export function fitSize(ctx, text, weight, px, maxW, spacing = 0, minPx = 10) {
  let size = px;
  while (size > minPx) {
    ctx.font = font(weight, size);
    const w = ctx.measureText(text).width + spacing * Math.max(0, text.length - 1);
    if (w <= maxW) break;
    size -= 2;
  }
  return size;
}

// ---- texture -------------------------------------------------------------------

// A small tile of soft monochrome grain, baked once — overlaid at low alpha it
// gives the printed cards a paper/foil "tooth" instead of a flat digital fill.
let _grain = null;
export function grainTile() {
  if (_grain) return _grain;
  const S = 160;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const img = g.createImageData(S, S);
  const r = rng(0x9e3779b9);
  for (let i = 0; i < S * S; i++) {
    const v = 128 + (r() - 0.5) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _grain = c;
  return c;
}

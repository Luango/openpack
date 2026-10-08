// pack3d/textures.js — PackTextures: artwork composition + procedural surface maps.
//
// Three maps, one atlas (see atlas.js):
//   base colour  — the flat front/back art composited into their islands, the
//                  side strips painted as the print wrapping the fold, the fin
//                  as creased gold foil. SRGB.
//   normal       — tangent-space, from a seeded height field: fine curved
//                  crinkles, directional scratches, the crimp ridges of the seals.
//                  Finite-difference gradients scaled by the real texel size.
//   packed ORM   — G = roughness, B = metalness (R reserved for occlusion, off).
//                  Near-binary ink/foil masks derived from the art itself: gold
//                  print is metal, dark neutral print is ink, seals and sides are foil.
// The BRAND and the PACK NAME are a different finish again: their print masks
// (assets/pack-print-*.png, rendered with the art) mark raised gloss-black ink —
// smooth, no foil crinkle, a bevel at every edge in the normal map, and a
// dielectric gloss in the ORM — so they catch the light unlike the foil around them.
// The art maps are painted synchronously (they gate the first frame); the
// surface maps are generated in row slices on idle ticks and swapped into the
// materials when ready — the pack renders with flat shading until then.

import * as THREE from "three";
import { rng } from "../paint.js";

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`image failed: ${src}`));
    im.src = src;
  });
}

const rectPx = (r, S) => ({ x: r.u0 * S, y: (1 - r.v1) * S, w: (r.u1 - r.u0) * S, h: (r.v1 - r.v0) * S });

// the bleed every printed sheet is drawn with, as a fraction of the atlas
const bleedFrac = (cfg) => Math.max(8, Math.round(cfg.tier.atlas / 170)) / cfg.tier.atlas; // ≥ 12 px at 2048: survives mip filtering

// a printed sheet (the art, or its print mask) into its island on a `size` canvas —
// over-drawn by the bleed, with the serration teeth (~0.6 % at each end) cropped:
// the geometry carries them
function drawSheet(ctx, cfg, rect, img, size) {
  const r = rectPx(rect, size);
  const bleed = bleedFrac(cfg) * size;
  const cut = Math.round(img.naturalHeight * 0.006);
  ctx.drawImage(img, 0, cut, img.naturalWidth, img.naturalHeight - 2 * cut, r.x - bleed, r.y - bleed, r.w + 2 * bleed, r.h + 2 * bleed);
}

// The print masks (white = the brand / pack name) laid out on the atlas exactly as
// the art is, at `size` — black everywhere else. Null when neither mask loaded.
export function paintPrintMask(cfg, layout, { front, back }, size) {
  if (!front && !back) return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  if (front) drawSheet(ctx, cfg, layout.front, front, size);
  if (back) drawSheet(ctx, cfg, layout.back, back, size);
  return c;
}

// ---- base colour atlas --------------------------------------------------------
export function paintAtlas(cfg, layout, { front, back }) {
  const S = cfg.tier.atlas;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d");
  const bleed = bleedFrac(cfg) * S;
  const CRIMP = "#c8a64e";

  ctx.fillStyle = "#8f9299"; // neutral foil in the gutters
  ctx.fillRect(0, 0, S, S);

  // the printed sheets: over a crimp-gold fill so the art's serrated alpha edge
  // and any transparent corner lands on foil, never black
  for (const [rect, img] of [[layout.front, front], [layout.back, back]]) {
    const r = rectPx(rect, S);
    ctx.fillStyle = CRIMP;
    ctx.fillRect(r.x - bleed, r.y - bleed, r.w + 2 * bleed, r.h + 2 * bleed);
    if (img) drawSheet(ctx, cfg, rect, img, S);
  }

  // the sides: the print wraps around the fold. Painted in a temp canvas in its
  // natural orientation (x across the side, y down the pack), then rotated into
  // the horizontal strip island (pack bottom at the island's left).
  const paintStrip = (rect, painter) => {
    const r = rectPx(rect, S);
    const tW = Math.round(r.h) + 2 * bleed; // across the side
    const tH = Math.round(r.w) + 2 * bleed; // the pack height
    const t = document.createElement("canvas");
    t.width = tW; t.height = tH;
    painter(t.getContext("2d"), tW, tH);
    ctx.save();
    const X0 = r.x - bleed, Y0 = r.y - bleed, w = r.w + 2 * bleed, h = r.h + 2 * bleed;
    ctx.setTransform(0, -h / tW, -w / tH, 0, X0 + w, Y0 + h);
    ctx.drawImage(t, 0, 0);
    ctx.restore();
  };
  const sideArt = (tc, tW, tH, backCol, frontCol) => {
    // foil shading across the fold: darkest at the back edge, a crease highlight at the fold
    const g = tc.createLinearGradient(0, 0, tW, 0);
    g.addColorStop(0, "#3a3f4a");
    g.addColorStop(0.42, "#6f737c");
    g.addColorStop(0.5, "#d9dce3");
    g.addColorStop(0.58, "#6b6f78");
    g.addColorStop(1, "#4a4f5a");
    tc.fillStyle = g;
    tc.fillRect(0, 0, tW, tH);
    const half = tW / 2;
    tc.globalAlpha = 0.72;
    if (backCol) tc.drawImage(backCol.img, backCol.sx, 0, 8, backCol.img.naturalHeight, 0, 0, half, tH);
    if (frontCol) tc.drawImage(frontCol.img, frontCol.sx, 0, 8, frontCol.img.naturalHeight, half, 0, half, tH);
    tc.globalAlpha = 1;
    // the fold crease
    tc.fillStyle = "rgba(255,255,255,0.28)";
    tc.fillRect(half - 1, 0, 2, tH);
    // the crimps at both ends
    tc.fillStyle = CRIMP;
    tc.globalAlpha = 0.85;
    const band = tH * (cfg.sealHeightM / cfg.heightM) * 1.1;
    tc.fillRect(0, 0, tW, band);
    tc.fillRect(0, tH - band, tW, band);
    tc.globalAlpha = 1;
  };
  const fw = front?.naturalWidth || 8, bw = back?.naturalWidth || 8;
  paintStrip(layout.sideR, (tc, tW, tH) => sideArt(tc, tW, tH, back && { img: back, sx: 0 }, front && { img: front, sx: fw - 8 }));
  paintStrip(layout.sideL, (tc, tW, tH) => sideArt(tc, tW, tH, back && { img: back, sx: bw - 8 }, front && { img: front, sx: 0 }));
  // the fin seam: a creased gold foil ribbon, brightest along its free edge
  paintStrip(layout.fin, (tc, tW, tH) => {
    const g = tc.createLinearGradient(0, 0, tW, 0);
    g.addColorStop(0, "#6d5a2a");
    g.addColorStop(0.35, "#b8973f");
    g.addColorStop(0.8, "#e9cf7a");
    g.addColorStop(0.92, "#fff2c0");
    g.addColorStop(1, "#8e7538");
    tc.fillStyle = g;
    tc.fillRect(0, 0, tW, tH);
    tc.fillStyle = "rgba(0,0,0,0.22)";
    for (let y = 0; y < tH; y += 3) tc.fillRect(0, y, tW, 1);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas, texture };
}

// The print's finish: raised gloss-black ink. Height in metres (the bevel rises
// over PRINT_BEVEL_M at each edge, a hair proud of the foil's crinkles), and its
// ORM — a dielectric gloss, where the foil is metal.
const PRINT_HEIGHT_M = 0.0002;
const PRINT_BEVEL_M = 0.0005;
const PRINT_ROUGH = 0.08;
const PRINT_METAL = 0;

// the print mask at `size` as floats 0..1, rows bottom-up (v up, like the maps)
function maskFloats(printCanvas, size) {
  const t = document.createElement("canvas");
  t.width = t.height = size;
  const tc = t.getContext("2d", { willReadFrequently: true });
  tc.drawImage(printCanvas, 0, 0, size, size);
  const px = tc.getImageData(0, 0, size, size).data;
  const m = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const row = (size - 1 - j) * size;
    for (let i = 0; i < size; i++) m[j * size + i] = px[(row + i) * 4] / 255;
  }
  return m;
}

// separable box blur, `passes` times (≈ gaussian) — the bevel's soft ramp.
// Awaits `tick` between sweeps so it slices like the rest of the surface build.
async function boxBlur(src, size, radius, tick, passes = 2) {
  const a = new Float32Array(src), b = new Float32Array(src.length);
  const span = 2 * radius + 1;
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < size; j++) {           // rows
      const o = j * size;
      let acc = 0;
      for (let k = -radius; k <= radius; k++) acc += a[o + Math.min(size - 1, Math.max(0, k))];
      for (let i = 0; i < size; i++) {
        b[o + i] = acc / span;
        acc += a[o + Math.min(size - 1, i + radius + 1)] - a[o + Math.max(0, i - radius)];
      }
    }
    await tick();
    for (let i = 0; i < size; i++) {           // columns
      let acc = 0;
      for (let k = -radius; k <= radius; k++) acc += b[Math.min(size - 1, Math.max(0, k)) * size + i];
      for (let j = 0; j < size; j++) {
        a[j * size + i] = acc / span;
        acc += b[Math.min(size - 1, j + radius + 1) * size + i] - b[Math.max(0, j - radius) * size + i];
      }
    }
    await tick();
  }
  return a;
}

// ---- surface maps (async, sliced) ---------------------------------------------
// Returns textures immediately (flat normal + a plausible constant ORM) and
// fills them in slices; `whenReady` resolves once both are complete. `printCanvas`
// (paintPrintMask) is optional: without it the brand prints like any other ink.
export function buildSurfaceMaps(cfg, layout, atlasCanvas, dims, printCanvas = null) {
  const N = cfg.tier.normal;
  const R = cfg.tier.orm;
  const normalData = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { normalData[i * 4] = 128; normalData[i * 4 + 1] = 128; normalData[i * 4 + 2] = 255; normalData[i * 4 + 3] = 255; }
  const normalMap = new THREE.DataTexture(normalData, N, N, THREE.RGBAFormat);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = normalMap.wrapT = THREE.ClampToEdgeWrapping;
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.anisotropy = 4;
  normalMap.needsUpdate = true;

  const ormData = new Uint8Array(R * R * 4);
  for (let i = 0; i < R * R; i++) { ormData[i * 4] = 255; ormData[i * 4 + 1] = 110; ormData[i * 4 + 2] = 230; ormData[i * 4 + 3] = 255; }
  const ormMap = new THREE.DataTexture(ormData, R, R, THREE.RGBAFormat);
  ormMap.colorSpace = THREE.NoColorSpace;
  ormMap.generateMipmaps = true;
  ormMap.minFilter = THREE.LinearMipmapLinearFilter;
  ormMap.needsUpdate = true;

  const islands = [
    { k: "front", r: layout.front, face: true },
    { k: "back", r: layout.back, face: true },
    { k: "sideR", r: layout.sideR, face: false },
    { k: "sideL", r: layout.sideL, face: false },
    { k: "fin", r: layout.fin, face: false },
  ];
  const islandAt = (u, v) => {
    for (const it of islands) if (u >= it.r.u0 && u <= it.r.u1 && v >= it.r.v0 && v <= it.r.v1) return it;
    return null;
  };

  const yield_ = () => new Promise((res) => (window.requestIdleCallback ? requestIdleCallback(res, { timeout: 60 }) : setTimeout(res, 0)));

  // ---- ORM: masks from the art ---------------------------------------------
  async function buildORM() {
    const t = document.createElement("canvas");
    t.width = t.height = R;
    const tc = t.getContext("2d", { willReadFrequently: true });
    tc.drawImage(atlasCanvas, 0, 0, R, R);
    const px = tc.getImageData(0, 0, R, R).data;
    const print = printCanvas ? maskFloats(printCanvas, R) : null;
    const sealFrac = (dims.seal + dims.shoulder * 0.45) / dims.H; // the crimp band, as a fraction of the sheet
    for (let j = 0; j < R; j++) {
      const v = (j + 0.5) / R;
      const row = (R - 1 - j) * R;
      for (let i = 0; i < R; i++) {
        const u = (i + 0.5) / R;
        const o = (row + i) * 4;
        const r = px[o], g = px[o + 1], b = px[o + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const it = islandAt(u, v);
        let metal, rough;
        if (!it) { metal = 1; rough = 0.4; } else if (!it.face) {
          metal = 1; rough = it.k === "fin" ? 0.34 : 0.38;
        } else {
          const t = (v - it.r.v0) / (it.r.v1 - it.r.v0);
          const inSeal = t < sealFrac || t > 1 - sealFrac;
          // ink: DARK and NEUTRAL. Gold in shadow stays warm (r − b well over 45), so
          // the shaded facets of a photographic foil stay metal; black and the deep
          // bronze-black secondary print go to ink
          const dark = Math.min(1, Math.max(0, (120 - lum) / 70));
          const neutral = Math.min(1, Math.max(0, (70 - (r - b)) / 35));
          const ink = dark * neutral;
          metal = inSeal ? 1 : 1 - 0.86 * ink;
          rough = inSeal ? 0.42 : 0.3 + 0.2 * ink;
          // bright white print (stars, floodlights) reads as glossy varnish, not metal
          if (!inSeal && lum > 215 && Math.abs(r - b) < 40) { metal = 0.3; rough = 0.3; }
          // the brand + pack name: raised gloss-black ink
          if (print && !inSeal) {
            const m = print[j * R + i];
            metal += (PRINT_METAL - metal) * m;
            rough += (PRINT_ROUGH - rough) * m;
          }
        }
        const d = (j * R + i) * 4;
        ormData[d] = 255;
        ormData[d + 1] = Math.round(rough * 255);
        ormData[d + 2] = Math.round(metal * 255);
        ormData[d + 3] = 255;
      }
      if ((j & 63) === 63) await yield_();
    }
    ormMap.needsUpdate = true;
  }

  // ---- normal: seeded height field → finite differences ------------------
  async function buildNormal() {
    const rand = rng(cfg.wrinkleSeed * 7919 + 3);
    const W = dims.W, H = dims.H;
    const h = new Float32Array(N * N);
    // texel size (metres) — the front island's scale; sides are stretched, fine for detail
    const texM = W / ((layout.front.u1 - layout.front.u0) * N);
    // the print: `ps` sharp (where the foil's crinkle gives way to smooth ink),
    // `pb` blurred over the bevel width (the ink's own relief)
    const ps = printCanvas ? maskFloats(printCanvas, N) : null;
    if (ps) await yield_();
    const pb = ps ? await boxBlur(ps, N, Math.max(1, Math.round(PRINT_BEVEL_M / texM / 2)), yield_) : null;
    // per-face crinkle curves (fine, curved, short)
    const curves = {};
    for (const it of islands) {
      const list = [];
      const n = it.face ? 26 : 8;
      for (let c = 0; c < n; c++) {
        const x0 = rand.range(-0.48, 0.48), y0 = rand.range(-0.48, 0.48); // in island-normalised coords, centred
        const ang = rand.range(0, Math.PI), len = rand.range(0.08, 0.3);
        const x1 = x0 + Math.cos(ang) * len * (it.face ? 1 : 0.3), y1 = y0 + Math.sin(ang) * len;
        const bend = rand.range(-0.06, 0.06);
        const mx = (x0 + x1) / 2 - Math.sin(ang) * bend, my = (y0 + y1) / 2 + Math.cos(ang) * bend;
        const pts = [];
        for (let k = 0; k <= 14; k++) {
          const t = k / 14;
          pts.push([(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1]);
        }
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        list.push({
          pts, w: rand.range(0.0005, 0.0017), amp: rand.range(0.00004, 0.00012) * (rand.chance(0.5) ? 1 : -1),
          bb: [Math.min(...xs) - 0.03, Math.max(...xs) + 0.03, Math.min(...ys) - 0.03, Math.max(...ys) + 0.03],
        });
      }
      // broad soft dents for shading variety
      const dents = [];
      for (let c = 0; c < (it.face ? 7 : 2); c++) dents.push({ x: rand.range(-0.45, 0.45), y: rand.range(-0.45, 0.45), w: rand.range(0.05, 0.13), amp: rand.range(-0.00006, 0.00006) });
      curves[it.k] = { list, dents };
    }
    const hash = (a, b) => {
      let x = (a * 374761393 + b * 668265263) | 0;
      x = Math.imul(x ^ (x >>> 13), 1274126177);
      return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
    };
    const sealFrac = dims.seal / H;
    const shFrac = dims.shoulder / H;
    for (let j = 0; j < N; j++) {
      const v = (j + 0.5) / N;
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N;
        const it = islandAt(u, v);
        if (!it) continue;
        const s = (u - it.r.u0) / (it.r.u1 - it.r.u0);
        const t = (v - it.r.v0) / (it.r.v1 - it.r.v0);
        // metres in the sheet's own frame
        const xm = (s - 0.5) * (it.face ? W : H);
        const ym = (t - 0.5) * (it.face ? H : 0.009);
        let z = 0;
        const cv = curves[it.k];
        const sx = s - 0.5, sy = t - 0.5;
        for (const c of cv.list) {
          if (sx < c.bb[0] || sx > c.bb[1] || sy < c.bb[2] || sy > c.bb[3]) continue;
          let best = 1;
          for (let k = 0; k < c.pts.length - 1; k++) {
            const ax = c.pts[k][0], ay = c.pts[k][1], bx = c.pts[k + 1][0], by = c.pts[k + 1][1];
            const vx = bx - ax, vy = by - ay;
            const L2 = vx * vx + vy * vy || 1e-12;
            let tt = ((sx - ax) * vx + (sy - ay) * vy) / L2;
            tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
            const dx = (sx - (ax + vx * tt)) * (it.face ? W : H), dy = (sy - (ay + vy * tt)) * (it.face ? H : 0.009);
            const dd = dx * dx + dy * dy;
            if (dd < best) best = dd;
          }
          const q = best / (c.w * c.w);
          if (q < 9) z += c.amp * Math.exp(-q);
        }
        for (const d of cv.dents) {
          const dx = sx - d.x, dy = sy - d.y;
          z += d.amp * Math.exp(-(dx * dx + dy * dy) / (d.w * d.w));
        }
        if (it.face) {
          // the crimped seals: vertical ridges at a 1.2 mm pitch, plus the seal line groove
          const edge = Math.min(t, 1 - t);
          if (edge < sealFrac + shFrac * 0.5) {
            const band = 1 - Math.min(1, Math.max(0, (edge - sealFrac) / (shFrac * 0.5)));
            z += 0.00009 * band * (0.5 + 0.5 * Math.cos((6.2832 * xm) / 0.0012));
            const g = (edge - sealFrac) / 0.0004;
            z += -0.00007 * Math.exp(-g * g);
          }
        } else {
          // folds + fin: ridges along the strip
          z += 0.00004 * Math.cos((6.2832 * xm) / 0.0014) * (0.5 + 0.5 * Math.cos(6.2832 * t));
        }
        // fine directional scratches (streaky along x)
        z += 0.000006 * (hash(i, j >> 2) - 0.5) + 0.000004 * (hash(i >> 1, j) - 0.5);
        // the print sits ON the foil: its own smooth, raised surface
        if (ps && it.face) {
          const m = ps[j * N + i];
          z = z * (1 - m) + PRINT_HEIGHT_M * pb[j * N + i];
        }
        h[j * N + i] = z;
      }
      if ((j & 31) === 31) await yield_();
    }
    for (let j = 0; j < N; j++) {
      const jm = Math.max(0, j - 1), jp = Math.min(N - 1, j + 1);
      for (let i = 0; i < N; i++) {
        const im = Math.max(0, i - 1), ip = Math.min(N - 1, i + 1);
        const dhdx = (h[j * N + ip] - h[j * N + im]) / (2 * texM);
        const dhdy = (h[jp * N + i] - h[jm * N + i]) / (2 * texM);
        let nx = -dhdx, ny = -dhdy, nz = 1;
        const L = Math.hypot(nx, ny, nz);
        nx /= L; ny /= L; nz /= L;
        const o = (j * N + i) * 4;
        normalData[o] = Math.round((nx * 0.5 + 0.5) * 255);
        normalData[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        normalData[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        normalData[o + 3] = 255;
      }
      if ((j & 63) === 63) await yield_();
    }
    normalMap.needsUpdate = true;
  }

  const whenReady = (async () => { await buildORM(); await buildNormal(); })();
  return { normalMap, ormMap, whenReady };
}

// a tiny tiling strip for the deck's rim: thin light lines = the card edges
export function makeEdgeTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = "#2a2d35";
  g.fillRect(0, 0, 64, 32);
  for (let k = 0; k < 5; k++) {
    g.fillStyle = k % 2 ? "#bfc4cf" : "#e8ebf1";
    g.fillRect(0, 3 + k * 6, 64, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// The light at the tear tip / the open mouth: a small, nearly white core inside a
// warm gold halo that falls off fast — drawn as a depth-tested sprite just inside
// the foil, so only the part showing through the torn gap is seen.
export function makeCoreTexture() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, "rgba(255,253,246,1)");
  rg.addColorStop(0.1, "rgba(255,244,214,0.92)");
  rg.addColorStop(0.26, "rgba(255,206,110,0.5)");
  rg.addColorStop(0.55, "rgba(255,160,48,0.14)");
  rg.addColorStop(1, "rgba(255,140,30,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

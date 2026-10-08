// pack3d/config.js — PackConfig: dimensions, art, quality tier, wrinkle seed.
//
// Everything is in METRES internally (X across the pack, Y up, Z toward the
// front). The values are art-direction starting points, exposed so a different
// card format or a flatter/fatter pouch is a config change, not a code change.
// `heightM` is re-derived from the pack art's aspect at load (see view.js) so
// the printed front always maps edge-to-edge without stretching.

/** @typedef {"low"|"standard"|"high"} Quality */

export const DEFAULT_CONFIG = {
  widthM: 0.074,          // broad enough for a 63 mm card
  heightM: 0.1226,        // 74 mm × the art's 1.657 aspect (replaced by the loaded art)
  depthM: 0.006,          // visible side volume
  cardWM: 0.063,          // inner card
  cardHM: 0.088,
  stackDepthM: 0.003,     // leaves ~1.5 mm of foil clearance each side
  sealHeightM: 0.008,     // flattened crimped band at each end
  shoulderM: 0.007,       // taper from the body to the seal
  tearBelowTopM: 0.011,   // the front rip removes the whole sealed header
  finWidthM: 0.0055,      // the rear fin seam — a folded ribbon lying on the back
  wrinkleSeed: 7,
  artFront: "assets/pack-hi.webp",
  artBack: "assets/pack-back-hi.webp",
  // where the brand + pack name are printed (tools/render_art.mjs): their own finish
  printFront: "assets/pack-print-front.png",
  printBack: "assets/pack-print-back.png",
  cardBack: "assets/card-back.jpg",
  /** @type {Quality} */
  quality: "standard",
};

// Per-tier dials. Counted, not assumed: the standard wrapper comes out at ~7.6k
// triangles (body + header + fin), the whole main pass ~16k with the inside
// surfaces and the card stack — inside the 20–25k budget.
export const TIERS = {
  low: {
    frontCols: 26, arcCols: 4, backHalfCols: 13, // 60 columns around
    rowSpacing: 0.0034, tearRowSpacing: 0.0014, shoulderRowSpacing: 0.0022,
    atlas: 1024, normal: 512, orm: 512,
    dprCap: 1.5, stations: 12, antialias: false,
  },
  standard: {
    frontCols: 36, arcCols: 6, backHalfCols: 18, // 84 columns around
    rowSpacing: 0.0024, tearRowSpacing: 0.001, shoulderRowSpacing: 0.0014,
    atlas: 2048, normal: 1024, orm: 1024,
    dprCap: 1.5, stations: 16, antialias: true,
  },
  high: {
    frontCols: 44, arcCols: 7, backHalfCols: 22, // 102 columns around
    rowSpacing: 0.0018, tearRowSpacing: 0.0008, shoulderRowSpacing: 0.0011,
    atlas: 2048, normal: 2048, orm: 1024,
    dprCap: 2, stations: 20, antialias: true,
  },
};

// Pick a tier for this device. Phones (coarse pointer) start on "low" unless they
// look beefy; desktops get "standard" (the "high" tier is opt-in via ?quality=high).
export function pickQuality() {
  const q = new URLSearchParams(location.search).get("quality");
  if (q && TIERS[q]) return q;
  const coarse = matchMedia?.("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (coarse) return cores >= 6 && mem >= 4 ? "standard" : "low";
  return "standard";
}

export function makeConfig(overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  if (!TIERS[cfg.quality]) cfg.quality = "standard";
  cfg.tier = TIERS[cfg.quality];
  return cfg;
}

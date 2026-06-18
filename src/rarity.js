// Single source of truth for rarity → tier.
//
// Rarity vocabulary varies a lot across eras, so tiers are derived by keyword
// rather than a fixed list. Each tier carries the metadata everything else
// reads: the filter sorts by tier, the gallery glows by tier, and (future)
// VFX is chosen by tier. To add or retune an effect, edit the `vfx` field here
// in ONE place and it applies to every card of that rarity.

export const TIERS = [
  { id: 0, key: "common",       label: "Common",               vfx: "common" },
  { id: 1, key: "uncommon",     label: "Uncommon",             vfx: "uncommon" },
  { id: 2, key: "rare",         label: "Rare",                 vfx: "rare" },
  { id: 3, key: "holo",         label: "Holo",                 vfx: "holo" },
  { id: 4, key: "double",       label: "Double Rare",          vfx: "double" },
  { id: 5, key: "ultra",        label: "Ultra Rare",           vfx: "ultra" },
  { id: 6, key: "illustration", label: "Illustration Rare",    vfx: "illustration" },
  { id: 7, key: "special",      label: "Special Illustration", vfx: "special" },
  { id: 8, key: "secret",       label: "Secret / Rainbow",     vfx: "secret" },
  { id: 9, key: "hyper",        label: "Hyper",                vfx: "hyper" },
];

function rarityString(x) {
  return (typeof x === "string" ? x : x?.rarity || "").toLowerCase();
}

// Map any rarity (string or card) to a tier id (0–9). Most specific first.
export function rarityToTier(x) {
  const r = rarityString(x);
  if (!r || r === "promo" || r === "common") return 0;
  if (r === "uncommon") return 1;
  if (r.includes("hyper")) return 9; // Hyper Rare, Mega Hyper Rare
  if (r.includes("secret") || r.includes("rainbow")) return 8;
  if (r.includes("special illustration")) return 7;
  if (r.includes("illustration")) return 6;
  if (r.includes("ultra") || r.includes("ace spec") || r.includes("amazing") || r.includes("radiant")) return 5;
  if (r.includes("double")) return 4;
  if (r.includes("holo") || r.includes("prism") || r.includes("shiny") || r.includes("break")) return 3;
  if (r.includes("rare")) return 2;
  return 0;
}

export function tierOf(x) {
  return TIERS[rarityToTier(x)];
}

// Tier accent colors as real hex — the single source of truth, mirroring the
// --tier-N tokens in base.css. CSS reads the vars; JS (canvas particles, the
// pack/reveal "tell", color-mix targets) reads these, since it can't resolve a
// `var(--tier-n)` string into a paintable colour.
export const TIER_HEX = [
  "#aab3c2", // 0 common
  "#5fcf8e", // 1 uncommon
  "#57a6ee", // 2 rare
  "#3fd6c8", // 3 holo
  "#f2c84b", // 4 double rare
  "#b072e6", // 5 ultra rare
  "#f59247", // 6 illustration
  "#ef5e92", // 7 special
  "#ff6fd8", // 8 secret / rainbow
  "#ffd24a", // 9 hyper
];

// The hex accent for any rarity (string or card).
export function tierHex(x) {
  return TIER_HEX[rarityToTier(x)] || TIER_HEX[0];
}

// A lighter, whiter sibling of a hex colour — used to build a 3-stop particle
// palette (tint → light tint → white) so a burst reads as glowing light, not a
// flat fill. amt 0→1 mixes toward white.
export function lighten(hex, amt = 0.5) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// Effect id for a card's tier — the Card stamps this as data-vfx, and the
// (future) per-tier effect CSS keys on it.
export function vfxFor(x) {
  return tierOf(x).vfx;
}

// The tier's accent color, as the CSS custom property defined in base.css.
export function tierColorVar(x) {
  return `var(--tier-${rarityToTier(x)})`;
}

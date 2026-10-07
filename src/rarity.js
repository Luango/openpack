// Single source of truth for rarity → tier.
//
// The football reskin keeps the 0–9 tier ladder the whole engine runs on (pack
// odds, the hit escalation, glows, foil VFX) and re-dresses each rung as a card
// EDITION: the base Bronze / Silver / Gold metals, then the special promos that
// count as a "hit" (Team of the Week and up). Every card carries its edition
// label as `rarity` (and its `tier` directly), so everything downstream keys off
// one mapping here. To retune an edition's foil, edit its `vfx` id (card.css).

export const TIERS = [
  { id: 0, key: "bronze",   label: "Bronze",              short: "BRONZE",       vfx: "bronze" },
  { id: 1, key: "silver",   label: "Silver",              short: "SILVER",       vfx: "silver" },
  { id: 2, key: "gold",     label: "Gold",                short: "GOLD",         vfx: "gold" },
  { id: 3, key: "raregold", label: "Rare Gold",           short: "RARE GOLD",    vfx: "raregold" },
  { id: 4, key: "totw",     label: "Team of the Week",    short: "TOTW",         vfx: "totw" },
  { id: 5, key: "potm",     label: "Player of the Match", short: "POTM",         vfx: "potm" },
  { id: 6, key: "future",   label: "Future Stars",        short: "FUTURE STARS", vfx: "future" },
  { id: 7, key: "tots",     label: "Team of the Season",  short: "TOTS",         vfx: "tots" },
  { id: 8, key: "toty",     label: "Team of the Year",    short: "TOTY",         vfx: "toty" },
  { id: 9, key: "legend",   label: "Legend",              short: "LEGEND",       vfx: "legend" },
];

// Tier at which a card counts as a special promo (and carries its edition mark).
export const PROMO_TIER = 4;

const BY_NAME = new Map();
for (const t of TIERS) {
  BY_NAME.set(t.key, t.id);
  BY_NAME.set(t.label.toLowerCase(), t.id);
  BY_NAME.set(t.short.toLowerCase(), t.id);
}

function rarityString(x) {
  return (typeof x === "string" ? x : x?.rarity || "").toLowerCase().trim();
}

// Map any rarity (edition label string, or a card) to a tier id (0–9). A card
// that carries its own numeric `tier` wins; otherwise the label is looked up.
export function rarityToTier(x) {
  if (x && typeof x === "object" && Number.isInteger(x.tier)) {
    return Math.max(0, Math.min(TIERS.length - 1, x.tier));
  }
  return BY_NAME.get(rarityString(x)) ?? 0;
}

export function tierOf(x) {
  return TIERS[rarityToTier(x)];
}

// Tier accent colors as real hex — the single source of truth, mirroring the
// --tier-N tokens in base.css. CSS reads the vars; JS (canvas particles, the
// pack/reveal "tell", color-mix targets) reads these, since it can't resolve a
// `var(--tier-n)` string into a paintable colour. Each is the edition's
// signature glow: the metals, then one distinct hue per promo.
export const TIER_HEX = [
  "#d08a56", // 0 bronze
  "#c3ccd8", // 1 silver
  "#e9c45f", // 2 gold
  "#ffcf3d", // 3 rare gold
  "#f3c652", // 4 team of the week (black + gold)
  "#ff4f6a", // 5 player of the match (crimson)
  "#b46bff", // 6 future stars (violet)
  "#2fd9c4", // 7 team of the season (aqua)
  "#4f7dff", // 8 team of the year (royal blue)
  "#ffe08a", // 9 legend (pale gold)
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
// per-edition foil CSS (card.css) keys on it.
export function vfxFor(x) {
  return tierOf(x).vfx;
}

// The tier's accent color, as the CSS custom property defined in base.css.
export function tierColorVar(x) {
  return `var(--tier-${rarityToTier(x)})`;
}

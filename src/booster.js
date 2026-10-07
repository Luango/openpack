// booster.js — assemble ONE pack of five players from the local pool.
//
// The pool is the bundled OpenPack FC squad (pool.js → players.js — no realtime
// API), tiered by edition (rarity.js). A pack is three Bronze/Silver fillers,
// one Gold or Rare Gold, and one guaranteed PROMO (Team of the Week and up,
// weighted so a Team of the Year or a Legend stays a genuine event) — ordered
// rarest-LAST so the reveal builds suspense. Each card's art (frame + player
// photo) is fetched and painted on the spot (cardart.js) before the pack
// resolves, so the reveal never waits on it. If the pool is somehow empty,
// falls back to offline "mystery" placeholders so the open still works.

import { POOL } from "./pool.js";
import { rarityToTier, TIER_HEX } from "./rarity.js";
import { cardArt, loadCardAssets } from "./cardart.js";

const PACK_SIZE = 5;

// promo odds for the guaranteed hit, by tier (percent) — printed on the pack back
// (tools/art), so re-render the art if you retune them
export const HIT_ODDS = { 4: 31, 5: 24, 6: 16, 7: 13, 8: 10, 9: 6 };
export const RARE_GOLD_ODDS = 0.32; // the gold slot comes up Rare this often

const pick = (a) => a[(Math.random() * a.length) | 0];

function pickTier(odds) {
  const entries = Object.entries(odds);
  let x = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [t, w] of entries) if ((x -= w) < 0) return Number(t);
  return Number(entries[0][0]);
}

// a frame's breather between paints, so building the pack never hitches the
// still-animating carousel behind it
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// Build a booster from the bundled pool and paint its five cards. Async: each
// card is rendered (≈ a few ms + an async JPEG encode) one per frame.
export async function buildBooster(size = PACK_SIZE) {
  if (!POOL.length) return mysteryPack(size);

  const tier = (c) => rarityToTier(c);
  const byTier = new Map();
  for (const c of POOL) {
    const t = tier(c);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(c);
  }
  const used = new Set(); // one card per player per pack
  const draw = (cands) => {
    const free = cands.filter((c) => !used.has(c.playerId));
    const c = pick(free.length ? free : cands);
    used.add(c.playerId);
    return c;
  };
  const among = (...tiers) => tiers.flatMap((t) => byTier.get(t) || []);

  const cards = [];
  const lows = among(0, 1);
  for (let i = 0; i < Math.max(1, size - 2); i++) cards.push(draw(lows.length ? lows : POOL));
  const goldTier = Math.random() < RARE_GOLD_ODDS ? 3 : 2;
  cards.push(draw(byTier.get(goldTier) || among(2, 3)));
  // ?hit=9 forces the promo slot's tier — for previewing a walkout without luck
  const forced = Number(new URLSearchParams(location.search).get("hit"));
  const hitTier = forced >= 4 && forced <= 9 ? forced : pickTier(HIT_ODDS);
  cards.push(draw(byTier.get(hitTier) || among(4, 5, 6, 7, 8, 9)));

  cards.sort((a, b) => tier(a) - tier(b)); // rarest LAST → revealed last
  const pack = cards.slice(0, size);

  // fetch every card's frame + photo at once, then paint them one per frame
  await Promise.all(pack.map(loadCardAssets));
  const out = [];
  for (const c of pack) {
    const { art, player } = await cardArt(c);
    out.push({ ...c, image: art, imageSmall: art, playerMask: player });
    await nextFrame();
  }
  return out;
}

// ---- offline fallback -----------------------------------------------------

// Tier accent colors for the placeholder art come from rarity.js (TIER_HEX).
function mysteryArt(t) {
  const c = TIER_HEX[t] || TIER_HEX[0];
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='252' height='352'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${c}'/><stop offset='1' stop-color='#11141b'/></linearGradient></defs>` +
    `<rect width='252' height='352' rx='14' fill='url(#g)'/>` +
    `<text x='126' y='205' font-size='130' fill='rgba(255,255,255,.85)' text-anchor='middle' font-family='sans-serif' font-weight='800'>?</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function mysteryPack(size) {
  const defs = [
    { t: 0, rarity: "Bronze" },
    { t: 1, rarity: "Silver" },
    { t: 1, rarity: "Silver" },
    { t: 2, rarity: "Gold" },
    { t: 7, rarity: "Team of the Season" },
  ].slice(0, size);
  return defs.map((d, i) => ({
    id: `mystery-${i}`,
    playerId: `mystery-${i}`,
    name: "Mystery Player",
    number: String(i + 1),
    rarity: d.rarity,
    tier: d.t,
    image: mysteryArt(d.t),
    imageSmall: mysteryArt(d.t),
  }));
}

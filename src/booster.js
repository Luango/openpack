// booster.js — assemble ONE booster pack from a set's card pool.
//
// The pool is a LOCAL snapshot bundled in pool.js (no realtime API fetch — that
// round-trip was the "Preparing pack…" delay), plus the rarity tiers (rarity.js):
// mostly low-rarity cards plus one guaranteed "hit", ordered rarest-LAST so the
// reveal builds suspense. If the local pool is somehow empty, falls back to
// offline "mystery" placeholders so the open still works.

import { POOL } from "./pool.js";
import { rarityToTier, TIER_HEX } from "./rarity.js";

const PACK_SIZE = 5;

const pick = (a) => a[(Math.random() * a.length) | 0];
function sample(a, n) {
  const pool = [...a];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  return out;
}

// Build a booster from the bundled local pool. Async only to keep the call
// site's `buildBooster().then(...)` contract — it resolves immediately (no fetch),
// so the pack is ready to tear almost instantly.
export async function buildBooster(size = PACK_SIZE) {
  const withImg = POOL.filter((c) => c.image);
  if (!withImg.length) return mysteryPack(size);

  const tier = (c) => rarityToTier(c);
  const lows = withImg.filter((c) => tier(c) <= 1); // commons + uncommons
  const mids = withImg.filter((c) => tier(c) === 2 || tier(c) === 3); // rare / holo
  const hits = withImg.filter((c) => tier(c) >= 4); // double rare and up — the chase

  const base = lows.length ? lows : withImg;
  const cards = sample(base, Math.max(1, size - 2));
  cards.push(mids.length ? pick(mids) : pick(base)); // a shiny in the middle
  cards.push(hits.length ? pick(hits) : pick(mids.length ? mids : base)); // the hit

  cards.sort((a, b) => tier(a) - tier(b)); // rarest LAST → revealed last
  return cards.slice(0, size);
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
    { t: 0, rarity: "Common" },
    { t: 0, rarity: "Common" },
    { t: 1, rarity: "Uncommon" },
    { t: 3, rarity: "Holo Rare" },
    { t: 7, rarity: "Special Illustration Rare" },
  ].slice(0, size);
  return defs.map((d, i) => ({
    id: `mystery-${i}`,
    name: "Mystery Card",
    number: String(i + 1),
    rarity: d.rarity,
    image: mysteryArt(d.t),
    imageSmall: mysteryArt(d.t),
  }));
}

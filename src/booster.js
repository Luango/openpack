// booster.js — assemble ONE booster pack from a set's card pool.
//
// Reuses the gallery's API wrapper (api.js) and the rarity tiers (rarity.js):
// mostly low-rarity cards plus one guaranteed "hit", ordered rarest-LAST so the
// reveal builds suspense. If the API can't be reached, falls back to offline
// "mystery" placeholders so the open still works.

import { fetchSetPool } from "./api.js";
import { rarityToTier } from "./rarity.js";

const DEFAULT_SET = "sv8"; // Surging Sparks — modern foils + illustration rares
const PACK_SIZE = 5;

const FETCH_TIMEOUT = 12000; // per attempt; the "Preparing…" gate covers the wait
const FETCH_TRIES = 3; // retry a slow/failed fetch before falling back to placeholders

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

// Get the set's cards, retrying a few times. A rejected fetch is no longer
// cached (see api.js), so each retry starts fresh; a slow one is re-raced. Only
// after all tries fail do we return [] (→ placeholder pack).
async function fetchPool(setId) {
  for (let i = 0; i < FETCH_TRIES; i++) {
    try {
      return await withTimeout(fetchSetPool(setId), FETCH_TIMEOUT);
    } catch {
      /* slow or failed — try again */
    }
  }
  return [];
}

const pick = (a) => a[(Math.random() * a.length) | 0];
function sample(a, n) {
  const pool = [...a];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  return out;
}

export async function buildBooster(setId = DEFAULT_SET, size = PACK_SIZE) {
  const pool = await fetchPool(setId);
  const withImg = pool.filter((c) => c.image);
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

// Tier accent colors (mirror base.css --tier-N) for the placeholder art.
const TIER_HEX = ["#aab3c2", "#5fcf8e", "#57a6ee", "#3fd6c8", "#f2c84b", "#b072e6", "#f59247", "#ef5e92", "#ff6fd8", "#ffd24a"];

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

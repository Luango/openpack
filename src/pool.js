// pool.js — the LOCAL card pool the booster draws from. Nothing is fetched: the
// pack arms instantly, and each pulled card's art is PAINTED in the browser
// (cardart.js) from its player data. The squad itself — clubs, players, promo
// editions — lives in players.js; this module is just the pool's front door.

export { POOL, SET_ID, SET_NAME } from "./players.js";

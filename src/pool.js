// pool.js — the LOCAL card pool the booster draws from. No realtime API: each
// pulled card's art is PAINTED in the browser (cardart.js) from its player data,
// its edition's frame and the player's bundled photo. The squad itself — clubs, players, promo
// editions — lives in players.js; this module is just the pool's front door.

export { POOL, SET_ID, SET_NAME } from "./players.js";

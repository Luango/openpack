// packart.js — the PRINTED art of OpenPack FC: the pack's front and back and the
// card back, composed on canvas with the app's own drawing modules (the card
// renderer, the golden ball, the palette, the edition looks) so the packaging and
// the cards inside it are one design system.
//
// The look is an awards night: a warm black foil pouch, polished gold crimps with a
// hammered texture, engraved gold lettering (Cinzel) and ONE golden object in a
// pool of amber light — the mystery card on the front, the golden ball on the back
// and on the card back — with a little gold dust around it.
//
// These are build-time sources: tools/render_art.mjs renders them in headless
// Chrome and writes the shipped files (assets/pack*.webp, assets/card-back.jpg).
// Preview them live at /tools/art/ while tuning.

import { P, lin, rad, rgba, shade, rng, font, serif, spacedText, grainTile, starPath, poly, roundRect } from "../../src/paint.js";
import { paintCard, ensureFonts, SHIELD_D, ART_W, ART_H } from "../../src/cardart.js";
import { drawBall } from "../../src/ball.js";
import { HIT_ODDS, RARE_GOLD_ODDS } from "../../src/booster.js";
import { TIERS } from "../../src/rarity.js";
import { POOL } from "../../src/pool.js";

export const PACK_W = 1083, PACK_H = 1794; // the pouch art box the carousel + tear-pack were tuned on
export const CARD_BACK_W = 660, CARD_BACK_H = 921;

const SEAL = 168; // crimped seal depth, top and bottom (~9.4% — under pack.js's 10% tear line)
// the gold material as three stops: champagne highlight / rich gold / bronze shadow
const GOLD = ["#f7e4aa", "#d4a63a", "#80521c"];
const INK = "#0d0b08";   // warm black
const IVORY = "#fff6e3"; // warm ivory — the everyday text
const AMBER = "#ffb547"; // the glow behind the main object

// ---- the pouch ----------------------------------------------------------------

// The silhouette: serrated (pinked) top and bottom cuts, and sides that bow out a
// hair between the seals — the pillow of a filled foil pouch.
function pouchPath(W = PACK_W, H = PACK_H) {
  const p = new Path2D();
  const L = 12, R = W - 12, T = 12, B = H - 12, tooth = 15.5;
  p.moveTo(L, T + 7);
  for (let x = L; x < R - 1; x += tooth) { p.lineTo(x + tooth / 2, T); p.lineTo(Math.min(R, x + tooth), T + 7); }
  p.lineTo(R, SEAL);
  p.bezierCurveTo(R + 2.5, SEAL + 70, R + 3.5, SEAL + 280, R + 3.5, H / 2);
  p.bezierCurveTo(R + 3.5, H - SEAL - 280, R + 2.5, H - SEAL - 70, R, H - SEAL);
  p.lineTo(R, B - 7);
  for (let x = R; x > L + 1; x -= tooth) { p.lineTo(x - tooth / 2, B); p.lineTo(Math.max(L, x - tooth), B - 7); }
  p.lineTo(L, H - SEAL);
  p.bezierCurveTo(L - 2.5, H - SEAL - 70, L - 3.5, H - SEAL - 280, L - 3.5, H / 2);
  p.bezierCurveTo(L - 3.5, SEAL + 280, L - 2.5, SEAL + 70, L, SEAL);
  p.closePath();
  return p;
}

// ---- the gold material ------------------------------------------------------------

// A hammered-metal pass: overlapping soft dents, each shaded on its upper-left wall
// and lit on its lower-right (light from the upper left), laid over an area in
// overlay mode so the metal underneath reads as beaten gold rather than a flat fill.
function hammered(ctx, x, y, w, h, seed, { r0 = 7, r1 = 15, alpha = 0.13 } = {}) {
  const r = rng(seed);
  const n = Math.round((w * h) / (r1 * r1 * 0.9));
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalCompositeOperation = "overlay";
  for (let i = 0; i < n; i++) {
    const cx = r.range(x, x + w), cy = r.range(y, y + h), rr = r.range(r0, r1);
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fillStyle = rad(ctx, cx - rr * 0.22, cy - rr * 0.22, rr * 0.95, [[0.25, `rgba(0,0,0,${alpha})`], [1, "rgba(0,0,0,0)"]]);
    ctx.fill();
    ctx.fillStyle = rad(ctx, cx + rr * 0.32, cy + rr * 0.32, rr * 0.7, [[0, `rgba(255,255,255,${alpha * 0.9})`], [1, "rgba(255,255,255,0)"]]);
    ctx.fill();
  }
  ctx.restore();
}

// a crimped heat-seal band: polished gold, fine vertical ridges, cross grooves, and
// the hammered texture over all of it
function crimp(ctx, y0, y1, metal, W = PACK_W) {
  const h = y1 - y0;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, y0, W, h); ctx.clip();
  ctx.fillStyle = lin(ctx, 0, y0, 0, y1, [[0, "#b8862b"], [0.18, metal[1]], [0.4, metal[0]], [0.62, metal[1]], [1, metal[2]]]);
  ctx.fillRect(0, y0, W, h);
  for (let x = 0; x < W; x += 9) {
    ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(x, y0, 3, h);
    ctx.fillStyle = "rgba(0,0,0,0.14)"; ctx.fillRect(x + 4.5, y0, 3, h);
  }
  for (const f of [0.3, 0.5, 0.7]) {
    ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(0, y0 + h * f, W, 3);
    ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(0, y0 + h * f + 3, W, 2);
  }
  hammered(ctx, 0, y0, W, h, 7 + y0);
  ctx.fillStyle = lin(ctx, 0, 0, W, 0, [[0, "rgba(0,0,0,0.3)"], [0.28, "rgba(255,255,255,0.3)"], [0.34, "rgba(255,255,255,0)"], [0.68, "rgba(255,255,255,0.14)"], [1, "rgba(0,0,0,0.3)"]]);
  ctx.fillRect(0, y0, W, h);
  ctx.restore();
}

// the body's finishing: pillow shading toward the edges, foil sheen, print grain
function foilFinish(ctx, W, H, strength = 1) {
  ctx.fillStyle = lin(ctx, 0, 0, W, 0, [[0, `rgba(0,0,0,${0.42 * strength})`], [0.1, "rgba(0,0,0,0)"], [0.9, "rgba(0,0,0,0)"], [1, `rgba(0,0,0,${0.5 * strength})`]]);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = lin(ctx, 0, SEAL, 0, H - SEAL, [[0, "rgba(0,0,0,0.38)"], [0.06, "rgba(0,0,0,0)"], [0.94, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.42)"]]);
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (const [o, w, a] of [[0.2, 0.07, 0.14], [0.46, 0.03, 0.1], [0.7, 0.09, 0.09]]) {
    ctx.fillStyle = lin(ctx, 0, 0, W, H * 0.62, [[Math.max(0, o - w), "rgba(255,255,255,0)"], [o, `rgba(255,240,210,${a * strength})`], [Math.min(1, o + w), "rgba(255,255,255,0)"]]);
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(grainTile(), "repeat");
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function sealEdges(ctx, W, H) {
  // the body tucks under each seal: a soft shadow below the top crimp, above the bottom
  ctx.fillStyle = lin(ctx, 0, SEAL, 0, SEAL + 34, [[0, "rgba(0,0,0,0.55)"], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(0, SEAL, W, 34);
  ctx.fillStyle = lin(ctx, 0, H - SEAL - 34, 0, H - SEAL, [[0, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.55)"]]);
  ctx.fillRect(0, H - SEAL - 34, W, 34);
  ctx.fillStyle = rgba(GOLD[0], 0.6);
  ctx.fillRect(0, SEAL - 2, W, 2);
  ctx.fillRect(0, H - SEAL, W, 2);
}

// a faint engraved weave across the black foil: two sets of fine diagonal lines
function guilloche(ctx, W, H) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(GOLD[1], 0.045);
  for (let i = -H; i < W + H; i += 14) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke(); }
  ctx.strokeStyle = rgba(GOLD[1], 0.025);
  for (let i = -H; i < W + H; i += 14) { ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + H, 0); ctx.stroke(); }
  ctx.restore();
}

// A thin engraved gold frame — a rule with a dark groove under it and a finer inner
// rule, so it reads as a line cut into the foil rather than printed on it.
function engravedFrame(ctx, x, y, w, h, rx) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.stroke(roundRect(x, y + 2, w, h, rx));
  ctx.strokeStyle = lin(ctx, x, y, x + w, y + h, [[0, rgba(GOLD[0], 0.6)], [0.5, rgba(GOLD[1], 0.38)], [1, rgba(GOLD[0], 0.55)]]);
  ctx.stroke(roundRect(x, y, w, h, rx));
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(GOLD[1], 0.22);
  ctx.stroke(roundRect(x + 9, y + 9, w - 18, h - 18, Math.max(4, rx - 6)));
  ctx.restore();
}

// text with an outline that never bites into its neighbours: stroke ALL, then fill
function outlined(ctx, text, x, y, spacing, fill, stroke, lw) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.fillStyle = "rgba(0,0,0,0)";
  spacedText(ctx, text, x, y, spacing, "center", true);
  ctx.fillStyle = fill;
  spacedText(ctx, text, x, y, spacing, "center");
  ctx.restore();
}

// the polished face of gold lettering: a champagne top, a dark reflective horizon
// through the middle, gold again below it
const goldText = (ctx, y0, y1) => lin(ctx, 0, y0, 0, y1, [[0, "#fff6d8"], [0.42, "#f3cf5e"], [0.52, "#b9851d"], [0.7, "#e8bb45"], [1, "#fff1bf"]]);

// Engraved gold capitals (Cinzel): a bronze underside dropped a few px, a champagne
// bevel peeking over the top edge and the polished face on top, all on a dark
// outline — so the letters read as cast metal standing off the foil.
function goldLetters(ctx, text, cx, y, size, spacing, { lw = 10, outline = "#1b1204", weight = 800 } = {}) {
  ctx.save();
  ctx.font = serif(weight, size);
  ctx.lineJoin = "round";
  ctx.strokeStyle = outline;
  ctx.lineWidth = lw + 6; // wide enough to wrap the offset copies below too
  ctx.fillStyle = "rgba(0,0,0,0)";
  spacedText(ctx, text, cx, y + 1, spacing, "center", true);
  ctx.fillStyle = "#5a3808";                                         // the bronze underside
  spacedText(ctx, text, cx, y + 5, spacing, "center");
  ctx.fillStyle = "#fff4cf";                                         // the champagne bevel
  spacedText(ctx, text, cx, y - 2, spacing, "center");
  ctx.fillStyle = goldText(ctx, y - size * 0.76, y + size * 0.06);   // the polished face
  spacedText(ctx, text, cx, y, spacing, "center");
  ctx.restore();
}

function sparkle(ctx, x, y, r, col = "#fff6d8") {
  ctx.fillStyle = col;
  ctx.fill(starPath(x, y, r, 4, 0.22, -Math.PI / 2));
  ctx.fillStyle = rad(ctx, x, y, r * 1.6, [[0, rgba(col, 0.6)], [1, rgba(col, 0)]]);
  ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
}

// Gold dust: tiny warm motes, thickest around the hero and thinning with distance,
// with a few four-point sparkles among the brightest.
function goldDust(ctx, r, W, H, cx, cy, count = 190, reach = 560) {
  let placed = 0, tries = 0;
  while (placed < count && tries++ < count * 25) {
    const x = r.range(30, W - 30), y = r.range(SEAL + 50, H - SEAL - 50);
    const d = Math.hypot(x - cx, (y - cy) * 0.85) / reach;
    if (r() > Math.exp(-d * d * 1.5) + 0.08) continue;
    placed++;
    const s = r.range(0.7, 2.6);
    const col = r() < 0.3 ? "#fff6dc" : r() < 0.6 ? GOLD[0] : GOLD[1];
    ctx.fillStyle = rgba(col, r.range(0.25, 0.9));
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
    if (s > 2.2 && r() < 0.5) sparkle(ctx, x, y, s * 3.4, "#fff3cf");
  }
}

// the brand lockup: OPENPACK over FOOTBALL CLUB, gold rules either side
function brand(ctx, cx, y, scale = 1) {
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(scale, scale);
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  goldLetters(ctx, "OPENPACK", 0, 0, 122, 10);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = IVORY;
  ctx.font = serif(600, 36);
  spacedText(ctx, "FOOTBALL  CLUB", 0, 66, 12, "center");
  ctx.strokeStyle = rgba(GOLD[1], 0.85);
  ctx.lineWidth = 3;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * 330, 54); ctx.lineTo(s * 450, 54); ctx.stroke();
  }
  ctx.restore();
}

// ---- a mystery player card (the hero on the pack front) ---------------------------

async function mysteryCard() {
  const c = document.createElement("canvas");
  c.width = ART_W; c.height = ART_H;
  await paintCard(c.getContext("2d"), {
    id: "mystery", playerId: "mystery", edition: "raregold", mystery: true,
    ovr: "??", pos: "??", display: "??????", stats: ["??", "??", "??", "??", "??", "??"],
    seed: 21,
  });
  return c;
}

// an edition's frame image, for the printed swatches (assets/frames — tools/frames)
const frameImage = (key) => new Promise((res) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = new URL(`../../assets/frames/${key}.webp`, import.meta.url).href;
});

// the warm black foil of the pouch body
function blackFoil(ctx, W, H) {
  ctx.fillStyle = lin(ctx, 0, SEAL, 0, H - SEAL, [[0, "#1c160e"], [0.45, "#110d08"], [1, "#0a0806"]]);
  ctx.fillRect(0, 0, W, H);
  guilloche(ctx, W, H);
}

// ---- PACK FRONT ----------------------------------------------------------------------

export async function drawPackFront(ctx) {
  await ensureFonts();
  const W = PACK_W, H = PACK_H, cx = W / 2;
  const body = pouchPath();
  const r = rng(2026);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.clip(body);

  blackFoil(ctx, W, H);

  // the amber pool behind the hero, and two warm spotlights raking down from the top
  // corners — the stage light the whole app shares
  const CY = 880;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = rad(ctx, cx, CY, 660, [[0, rgba(AMBER, 0.5)], [0.45, rgba(AMBER, 0.16)], [1, rgba(AMBER, 0)]]);
  ctx.fillRect(0, 0, W, H);
  for (const lx of [150, W - 150]) {
    const LY = SEAL - 40;
    const ang = Math.atan2(CY - LY, cx - lx), len = 1500, spread = 0.14;
    ctx.fillStyle = lin(ctx, lx, LY, lx + Math.cos(ang) * len, LY + Math.sin(ang) * len, [[0, "rgba(255,214,140,0.16)"], [0.5, "rgba(255,214,140,0.05)"], [1, "rgba(255,214,140,0)"]]);
    ctx.fill(poly([[lx, LY], [lx + Math.cos(ang - spread) * len, LY + Math.sin(ang - spread) * len], [lx + Math.cos(ang + spread) * len, LY + Math.sin(ang + spread) * len]]));
    ctx.fillStyle = rad(ctx, lx, LY, 300, [[0, "rgba(255,230,180,0.5)"], [0.3, "rgba(255,200,120,0.12)"], [1, "rgba(255,200,120,0)"]]);
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  // the engraved frame that holds the hero — generous space around one golden object
  engravedFrame(ctx, 64, 482, W - 128, 806, 22);

  goldDust(ctx, r, W, H, cx, CY);

  // the hero: a mystery player card, tilted, haloed in amber. The card art is
  // SHAPED (transparent round the frame), so the halo + shadow take its outline.
  const card = await mysteryCard();
  const cg = card.getContext("2d");
  cg.globalCompositeOperation = "source-atop"; // a glint sweeping the card, on the card only
  cg.fillStyle = lin(cg, 0, 0, ART_W, ART_H, [[0.3, "rgba(255,255,255,0)"], [0.4, "rgba(255,255,255,0.4)"], [0.47, "rgba(255,255,255,0)"]]);
  cg.fillRect(0, 0, ART_W, ART_H);
  ctx.save();
  ctx.translate(cx, CY);
  ctx.rotate(-0.075);
  const s = 0.66;
  ctx.scale(s, s);
  ctx.shadowColor = "rgba(255,176,70,0.85)";
  ctx.shadowBlur = 90;
  ctx.drawImage(card, -ART_W / 2, -ART_H / 2);
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 30;
  ctx.drawImage(card, -ART_W / 2, -ART_H / 2);
  ctx.restore();

  // a few placed sparkles around the card
  for (const [x, y, rr] of [[250, 560, 22], [842, 640, 30], [210, 1110, 18], [880, 1180, 22], [790, 520, 12], [150, 860, 14]]) sparkle(ctx, x, y, rr);

  // the brand, top
  brand(ctx, cx, 360);

  // the pack name, bottom
  ctx.save();
  ctx.fillStyle = IVORY;
  ctx.font = serif(600, 44);
  ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 16;
  spacedText(ctx, "PREMIUM", cx, 1352, 22, "center");
  ctx.shadowOffsetY = 8; ctx.shadowBlur = 26;
  goldLetters(ctx, "GOLD PACK", cx, 1496, 124, 8);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = rgba(IVORY, 0.9);
  ctx.font = font(700, 36);
  spacedText(ctx, "5 PLAYERS · 1 PROMO GUARANTEED", cx, 1572, 5, "center");
  ctx.restore();

  foilFinish(ctx, W, H);
  ctx.restore(); // body clip

  // the crimped seals, top and bottom
  ctx.save();
  ctx.clip(body);
  crimp(ctx, 0, SEAL, GOLD);
  crimp(ctx, H - SEAL, H, GOLD);
  sealEdges(ctx, W, H);
  // small print on the seals, engraved into the gold
  ctx.fillStyle = rgba("#3a2206", 0.78);
  ctx.font = font(700, 26);
  spacedText(ctx, "TEAR HERE", cx, 104, 10, "center");
  spacedText(ctx, "OPENPACK FC  ·  ULTIMATE XI  ·  SEASON 26/27", cx, H - 70, 6, "center");
  ctx.restore();

  // a bright gold rim along the silhouette
  ctx.save();
  ctx.clip(body);
  ctx.strokeStyle = rgba(GOLD[0], 0.5);
  ctx.lineWidth = 5;
  ctx.stroke(body);
  ctx.restore();
}

// ---- PACK BACK -------------------------------------------------------------------------

function barcode(ctx, x, y, w, h, seed) {
  const r = rng(seed);
  ctx.fillStyle = IVORY;
  ctx.fill(roundRect(x - 14, y - 14, w + 28, h + 58, 8));
  let xx = x;
  ctx.fillStyle = INK;
  while (xx < x + w) {
    const bw = r.pick([2, 2, 3, 4, 6]);
    if (r() < 0.55) ctx.fillRect(xx, y, bw, h);
    xx += bw + r.pick([2, 2, 3, 4]);
  }
  ctx.font = font(600, 26);
  ctx.textAlign = "center";
  ctx.fillText("4 260417 202617", x + w / 2, y + h + 34);
}

export async function drawPackBack(ctx) {
  await ensureFonts();
  const W = PACK_W, H = PACK_H, cx = W / 2;
  const body = pouchPath();
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.clip(body);
  blackFoil(ctx, W, H);

  // ---- left column: contents + the edition ladder with each slot's odds ----
  const LX = 66;
  ctx.textAlign = "left";
  ctx.fillStyle = GOLD[1];
  ctx.font = serif(700, 34);
  spacedText(ctx, "CONTENTS", LX, 256, 8, "left");
  ctx.fillStyle = IVORY;
  ctx.font = font(800, 52);
  spacedText(ctx, "5 PLAYER CARDS", LX, 322, 1, "left");
  ctx.fillStyle = rgba(IVORY, 0.72);
  ctx.font = font(600, 28);
  spacedText(ctx, "3 BRONZE / SILVER", LX, 372, 1.5, "left");
  spacedText(ctx, "1 GOLD  ·  1 PROMO", LX, 406, 1.5, "left");

  ctx.fillStyle = GOLD[1];
  ctx.font = serif(700, 28);
  spacedText(ctx, "EDITIONS", LX, 478, 8, "left");
  const gold = Math.round(RARE_GOLD_ODDS * 100);
  const odds = (t) => (t >= 4 ? `${HIT_ODDS[t]}% OF THE PROMO SLOT` : t === 3 ? `${gold}% OF THE GOLD SLOT` : t === 2 ? `${100 - gold}% OF THE GOLD SLOT` : "FILLS THE FIRST THREE SLOTS");
  const frames = await Promise.all(TIERS.map((t) => frameImage(t.key)));
  TIERS.forEach((t, i) => {
    const y = 506 + i * 86;
    // a mini card: the edition's own frame
    if (frames[i]) ctx.drawImage(frames[i], LX - 2, y - 2, 50, 70);
    ctx.fillStyle = IVORY;
    ctx.font = font(700, 32);
    spacedText(ctx, t.label.toUpperCase(), LX + 64, y + 30, 1.2, "left");
    ctx.fillStyle = t.id >= 4 ? GOLD[1] : rgba(IVORY, 0.6);
    ctx.font = font(600, 22);
    spacedText(ctx, odds(t.id), LX + 64, y + 58, 1.6, "left");
  });

  // the set count, straight from the pool
  const players = new Set(POOL.map((c) => c.playerId)).size;
  ctx.fillStyle = GOLD[1];
  ctx.font = serif(700, 22);
  spacedText(ctx, "COLLECT THE SQUAD", LX, 1452, 4, "left");
  ctx.fillStyle = rgba(IVORY, 0.72);
  ctx.font = font(600, 26);
  spacedText(ctx, `${players} PLAYERS  ·  ${POOL.length} CARDS`, LX, 1492, 2, "left");

  // ---- the fin seal down the middle ----
  const FX = cx - 66, FW = 132;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 26;
  ctx.fillStyle = "#000";
  ctx.fillRect(FX, 0, FW, H);
  ctx.restore();
  crimpVertical(ctx, FX, FW, H);
  // the embossed golden ball seal at its centre
  ctx.save();
  ctx.translate(cx, H / 2);
  ctx.fillStyle = lin(ctx, -70, -70, 70, 70, [[0, GOLD[0]], [0.5, GOLD[1]], [1, "#6b4612"]]);
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  ctx.fill(roundRect(-74, -74, 148, 148, 22));
  ctx.shadowColor = "transparent";
  hammered(ctx, -74, -74, 148, 148, 41, { r0: 5, r1: 11, alpha: 0.16 });
  ctx.translate(-54, -54);
  ctx.scale(1.08, 1.08);
  drawBall(ctx, { gold: true });
  ctx.restore();

  // ---- right column: the brand, the golden ball, the small print, the barcode ----
  const RX = cx + 66 + (W - (cx + 66)) / 2;
  brand(ctx, RX, 330, 0.48);
  ctx.save();
  ctx.translate(RX - 110, 430);
  ctx.scale(2.2, 2.2);
  ctx.shadowColor = rgba(AMBER, 0.65); ctx.shadowBlur = 40;
  drawBall(ctx, { gold: true });
  ctx.restore();
  ctx.fillStyle = GOLD[1];
  ctx.font = serif(800, 48);
  spacedText(ctx, "ULTIMATE XI", RX, 760, 4, "center");
  ctx.fillStyle = rgba(IVORY, 0.85);
  ctx.font = serif(700, 26);
  spacedText(ctx, "SEASON 26/27", RX, 806, 8, "center");

  const small = [
    "A FAN-MADE PACK-OPENING",
    "CONCEPT. PLAYER PHOTOS FROM",
    "WIKIMEDIA COMMONS, CREDITED",
    "ON EVERY CARD. CLUB BADGES",
    "ARE PLAIN MONOGRAMS, NOT",
    "OFFICIAL CRESTS. NOT",
    "AFFILIATED WITH ANY PLAYER,",
    "CLUB, LEAGUE OR PUBLISHER.",
  ];
  ctx.fillStyle = rgba(IVORY, 0.7);
  ctx.font = font(600, 27);
  small.forEach((line, i) => spacedText(ctx, line, RX, 900 + i * 38, 1.2, "center"));
  ctx.fillStyle = rgba(GOLD[1], 0.95);
  ctx.font = serif(600, 19);
  spacedText(ctx, "TEAR ALONG THE TOP SEAL", RX, 1250, 3, "center");
  barcode(ctx, RX - 150, 1310, 300, 120, 417);
  ctx.fillStyle = rgba(IVORY, 0.6);
  ctx.font = font(600, 24);
  spacedText(ctx, "LOT OPFC-26-GLD-0417", RX, 1540, 3, "center");

  foilFinish(ctx, W, H, 0.8);
  ctx.restore();

  ctx.save();
  ctx.clip(body);
  crimp(ctx, 0, SEAL, GOLD);
  crimp(ctx, H - SEAL, H, GOLD);
  crimpVertical(ctx, FX, FW, SEAL, 0.0);
  crimpVertical(ctx, FX, FW, SEAL, H - SEAL);
  sealEdges(ctx, W, H);
  ctx.strokeStyle = rgba(GOLD[0], 0.45);
  ctx.lineWidth = 5;
  ctx.stroke(body);
  ctx.restore();
}

// the vertical (fin) seal: ridges run across it, hammered, and it's a touch brighter
function crimpVertical(ctx, x, w, h, y0 = 0) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y0, w, h); ctx.clip();
  ctx.fillStyle = lin(ctx, x, 0, x + w, 0, [[0, GOLD[2]], [0.3, GOLD[0]], [0.55, GOLD[1]], [0.8, "#b8862b"], [1, GOLD[2]]]);
  ctx.fillRect(x, y0, w, h);
  for (let y = y0; y < y0 + h; y += 9) {
    ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = "rgba(0,0,0,0.14)"; ctx.fillRect(x, y + 4.5, w, 3);
  }
  for (const f of [0.22, 0.5, 0.78]) {
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x + w * f, y0, 3, h);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(x + w * f + 3, y0, 2, h);
  }
  hammered(ctx, x, y0, w, h, 13 + y0, { r0: 6, r1: 13 });
  ctx.restore();
}

// ---- CARD BACK ---------------------------------------------------------------------------

export async function drawCardBack(ctx) {
  await ensureFonts();
  const W = CARD_BACK_W, H = CARD_BACK_H, cx = W / 2, cy = H / 2;
  ctx.fillStyle = rad(ctx, cx, cy, H * 0.7, [[0, "#2a2016"], [0.55, "#120e09"], [1, "#0a0806"]]);
  ctx.fillRect(0, 0, W, H);
  // sunburst
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * Math.PI * 2, a1 = a0 + Math.PI / 48;
    ctx.fillStyle = rgba(GOLD[1], 0.06);
    ctx.fill(poly([[0, 0], [Math.cos(a0) * 900, Math.sin(a0) * 900], [Math.cos(a1) * 900, Math.sin(a1) * 900]]));
  }
  ctx.restore();
  // pinstripes
  ctx.strokeStyle = rgba(GOLD[1], 0.05);
  ctx.lineWidth = 2;
  for (let i = -30; i < 40; i++) {
    ctx.beginPath(); ctx.moveTo(i * 26, 0); ctx.lineTo(i * 26 + H, H); ctx.stroke();
  }
  // the amber pool behind the crest
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = rad(ctx, cx, cy, 360, [[0, rgba(AMBER, 0.32)], [0.5, rgba(AMBER, 0.1)], [1, rgba(AMBER, 0)]]);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // frame
  ctx.lineWidth = 6;
  ctx.strokeStyle = lin(ctx, 0, 0, W, H, [[0, GOLD[0]], [0.4, GOLD[1]], [0.6, "#a87a22"], [1, GOLD[0]]]);
  ctx.stroke(roundRect(24, 24, W - 48, H - 48, 26));
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(GOLD[1], 0.5);
  ctx.stroke(roundRect(38, 38, W - 76, H - 76, 18));

  // the centre crest: the card's own shield in black foil, rimmed in gold, holding
  // the golden ball
  ctx.save();
  ctx.translate(cx, cy - 6);
  const s = 0.42;
  ctx.scale(s, s);
  ctx.translate(-ART_W / 2, -ART_H / 2);
  const sh = P(SHIELD_D);
  ctx.shadowColor = rgba(AMBER, 0.55); ctx.shadowBlur = 60;
  ctx.fillStyle = lin(ctx, 0, 0, ART_W, ART_H, [[0, "#211b13"], [1, "#0d0b08"]]);
  ctx.fill(sh);
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 16;
  ctx.strokeStyle = lin(ctx, 0, 0, ART_W, ART_H, [[0, GOLD[0]], [0.45, GOLD[1]], [1, "#a87a22"]]);
  ctx.stroke(sh);
  ctx.restore();
  ctx.save();
  ctx.translate(cx - 95, cy - 150);
  ctx.scale(1.9, 1.9);
  ctx.shadowColor = rgba(AMBER, 0.6); ctx.shadowBlur = 30;
  drawBall(ctx, { gold: true });
  ctx.restore();
  ctx.save();
  goldLetters(ctx, "OPENPACK", cx, cy + 112, 56, 4, { lw: 6 });
  ctx.fillStyle = IVORY;
  ctx.font = serif(600, 22);
  spacedText(ctx, "FOOTBALL CLUB", cx, cy + 152, 9, "center");
  ctx.restore();

  // the wordmark top + bottom, mirrored like a real card back
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) { ctx.translate(W, H); ctx.rotate(Math.PI); }
    ctx.fillStyle = rgba(GOLD[1], 0.85);
    ctx.font = serif(700, 26);
    spacedText(ctx, "ULTIMATE  XI", cx, 98, 12, "center");
    ctx.restore();
  }
  foilFinishCard(ctx, W, H);
}

function foilFinishCard(ctx, W, H) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = lin(ctx, 0, 0, W, H, [[0.25, "rgba(255,255,255,0)"], [0.38, "rgba(255,240,210,0.14)"], [0.5, "rgba(255,255,255,0)"]]);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(grainTile(), "repeat");
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

export const PIECES = {
  "pack-front": { w: PACK_W, h: PACK_H, draw: drawPackFront },
  "pack-back": { w: PACK_W, h: PACK_H, draw: drawPackBack },
  "card-back": { w: CARD_BACK_W, h: CARD_BACK_H, draw: drawCardBack },
};

export { INK, shade };

// packart.js — the PRINTED art of the pack: the pouch's front and back and the card
// back, composed on canvas with the app's own drawing modules so the packaging and
// the cards inside it are one design system.
//
// The pouch is a GOLD foil pack. Its FRONT is the supplied cover design
// (ref/pack-cover-reference.webp): faceted gold foil — chevrons, a frame, long
// diagonals — with the Betfair lockup in black across the middle. cover_plate.py
// unwarps that render into the art box and lifts its bitmap logo out; here the
// plate is laid down and the lockup is drawn back as VECTORS (betfair-logo.js,
// traced from ref/betfair-logo.png by trace_logo.py). The back carries the brand,
// GOLD PACK · FOOTBALL COLLECTION, the contents and odds, the fin seal and the legal,
// on a satin gold foil.
//
// These are base-colour maps: the 3D pack (src/pack3d) adds the real folds, the
// moving reflections and the crinkle normal map. The brand and the pack name also
// get their own PRINT MASKS (the *-print pieces): src/pack3d gives the print in them
// a different finish — raised gloss ink with its own normal map, not the foil's.
//
// Build-time sources: tools/render_art.mjs renders them in headless Chrome and
// writes the shipped files (assets/pack*.webp, assets/card-back.jpg). Preview them
// live at /tools/art/ while tuning.

import { P, lin, rad, rgba, shade, rng, font, serif, spacedText, grainTile, starPath, poly, roundRect } from "../../src/paint.js";
import { ensureFonts, SHIELD_D, ART_W, ART_H } from "../../src/cardart.js";
import { drawBall, BALL_PANELS, BALL_CENTER } from "../../src/ball.js";
import { HIT_ODDS, RARE_GOLD_ODDS } from "../../src/booster.js";
import { TIERS } from "../../src/rarity.js";
import { POOL } from "../../src/pool.js";
import { BETFAIR_LOGO } from "./betfair-logo.js";

export const PACK_W = 1083, PACK_H = 1794; // the pouch art box the carousel + tear-pack were tuned on
export const CARD_BACK_W = 660, CARD_BACK_H = 921;

const SEAL = 168; // crimped seal depth, top and bottom (~9.4% — under the 3D pack's 9% tear line)
// the gold material as three stops: champagne highlight / rich gold / bronze shadow
const GOLD = ["#f7e4aa", "#d4a63a", "#80521c"];
const INK = "#0d0b08";   // warm black — the print on the foil
const IVORY = "#fff6e3"; // warm ivory
const AMBER = "#ffb547"; // the glow behind the main object (card back)

// the brand on the pouch: the traced lockup (the two-arrow mark + the wordmark) and
// the pack's name. One place to change if the pack is re-branded (re-trace the logo
// with trace_logo.py).
export const BRAND = { logo: BETFAIR_LOGO, name: "GOLD PACK", sub: "FOOTBALL COLLECTION" };

// The front's print plate (cover_plate.py) and where the reference's logo sat on
// it, in art pixels — the vector lockup is drawn back into this box.
const COVER_PLATE = new URL("./ref/cover-plate.webp", import.meta.url).href;
const COVER_LOGO = { x: 212, y: 844, w: 743, h: 132 };

// the display face the pouch adds on top of the card faces (see tools/art/index.html)
const DISPLAY_FONT = `"Montserrat", "Gotham", "Avenir Next", "Segoe UI", system-ui, sans-serif`;
let _pouchFonts = null;
function pouchFonts() {
  if (_pouchFonts) return _pouchFonts;
  const faces = [["800", "Montserrat"], ["700", "Montserrat"], ["500", "Montserrat"]]
    .map(([w, f]) => (document.fonts?.load(`${w} 100px "${f}"`, "abgp0") || Promise.resolve()).catch(() => null));
  _pouchFonts = Promise.race([Promise.all([ensureFonts(), ...faces]), new Promise((r) => setTimeout(r, 4000))]);
  return _pouchFonts;
}

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

// The satin gold foil of the pouch body: a soft vertical ramp (lighter above the
// middle, where a studio key would land), a few broad, very soft tonal patches so it
// isn't a dead flat fill, and a faint brushed grain. No folds, no hot highlights —
// the 3D pack lights it.
function goldFoil(ctx, W, H, seed = 77) {
  ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, "#dcb24c"], [0.22, "#efd072"], [0.42, "#f3d67d"], [0.62, "#e6bf55"], [0.82, "#d6ab42"], [1, "#c59a38"]]);
  ctx.fillRect(0, 0, W, H);
  const r = rng(seed);
  for (let i = 0; i < 10; i++) {
    const x = r.range(0, W), y = r.range(SEAL, H - SEAL), rr = r.range(220, 560);
    const light = r.chance(0.5);
    ctx.fillStyle = rad(ctx, x, y, rr, [[0, light ? "rgba(255,246,214,0.2)" : "rgba(110,72,18,0.16)"], [1, "rgba(0,0,0,0)"]]);
    ctx.fillRect(0, 0, W, H);
  }
  // a gentle sheen band across the upper body — the satin's long soft reflection
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = lin(ctx, 0, 0, W, H * 0.7, [[0.18, "rgba(255,255,255,0)"], [0.36, "rgba(255,245,215,0.1)"], [0.52, "rgba(255,255,255,0)"]]);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(grainTile(), "repeat");
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function sealEdges(ctx, W, H) {
  // the body tucks under each seal: a soft shadow below the top crimp, above the bottom
  ctx.fillStyle = lin(ctx, 0, SEAL, 0, SEAL + 30, [[0, "rgba(60,38,8,0.32)"], [1, "rgba(60,38,8,0)"]]);
  ctx.fillRect(0, SEAL, W, 30);
  ctx.fillStyle = lin(ctx, 0, H - SEAL - 30, 0, H - SEAL, [[0, "rgba(60,38,8,0)"], [1, "rgba(60,38,8,0.32)"]]);
  ctx.fillRect(0, H - SEAL - 30, W, 30);
  ctx.fillStyle = rgba(GOLD[0], 0.7);
  ctx.fillRect(0, SEAL - 2, W, 2);
  ctx.fillRect(0, H - SEAL, W, 2);
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
// through the middle, gold again below it (the card back's engraved capitals)
const goldText = (ctx, y0, y1) => lin(ctx, 0, y0, 0, y1, [[0, "#fff6d8"], [0.42, "#f3cf5e"], [0.52, "#b9851d"], [0.7, "#e8bb45"], [1, "#fff1bf"]]);
function goldLetters(ctx, text, cx, y, size, spacing, { lw = 10, outline = "#1b1204", weight = 800 } = {}) {
  ctx.save();
  ctx.font = serif(weight, size);
  ctx.lineJoin = "round";
  ctx.strokeStyle = outline;
  ctx.lineWidth = lw + 6;
  ctx.fillStyle = "rgba(0,0,0,0)";
  spacedText(ctx, text, cx, y + 1, spacing, "center", true);
  ctx.fillStyle = "#5a3808";
  spacedText(ctx, text, cx, y + 5, spacing, "center");
  ctx.fillStyle = "#fff4cf";
  spacedText(ctx, text, cx, y - 2, spacing, "center");
  ctx.fillStyle = goldText(ctx, y - size * 0.76, y + size * 0.06);
  spacedText(ctx, text, cx, y, spacing, "center");
  ctx.restore();
}

// ---- the brand lockup ------------------------------------------------------------

// The lockup — the two-arrow mark + the wordmark, one traced path — `width` wide,
// centred on (cx, cy).
const _logoPath = new Path2D(BRAND.logo.d);
function brand(ctx, cx, cy, width, color = INK) {
  const s = width / BRAND.logo.w;
  ctx.save();
  ctx.translate(cx - width / 2, cy - (BRAND.logo.h * s) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.fill(_logoPath, "evenodd");
  ctx.restore();
}

// ---- the golden ball, embossed ------------------------------------------------------

// The ball stands off the foil: a soft bronze shadow beneath and to the right, the
// polished hammered body (drawBall gold + a hammered pass), a crisp rim and a
// champagne glint on the lit shoulder.
function embossedBall(ctx, cx, cy, radius, seed = 41) {
  const d = radius * 2;
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = Math.ceil(d) + 8;
  const t = tmp.getContext("2d");
  t.translate(4, 4);
  t.scale(d / 100, d / 100);
  drawBall(t, { gold: true });
  // an all-gold ball: the pentagons go a deeper gold (not black), seams stay dark
  t.save();
  t.fillStyle = lin(t, 0, 0, 100, 100, [[0, "rgba(214,166,58,0.86)"], [1, "rgba(150,104,30,0.86)"]]);
  t.fill(new Path2D(BALL_PANELS));
  t.fill(new Path2D(BALL_CENTER));
  t.restore();
  // a fine hammered skin, within the ball
  t.save();
  t.beginPath(); t.arc(50, 50, 46, 0, Math.PI * 2); t.clip();
  t.setTransform(1, 0, 0, 1, 4, 4);
  hammered(t, 0, 0, d, d, seed, { r0: d * 0.007, r1: d * 0.016, alpha: 0.17 });
  t.restore();
  // a crisp polished rim
  t.strokeStyle = lin(t, 0, 0, 100, 100, [[0, "#fff1c2"], [0.5, "#b8862b"], [1, "#4a2d08"]]);
  t.lineWidth = 2.2;
  t.beginPath(); t.arc(50, 50, 46, 0, Math.PI * 2); t.stroke();
  // the emboss: shadow under + right, then the ball
  ctx.save();
  ctx.shadowColor = "rgba(70,44,8,0.6)";
  ctx.shadowBlur = radius * 0.3;
  ctx.shadowOffsetX = radius * 0.06;
  ctx.shadowOffsetY = radius * 0.14;
  ctx.drawImage(tmp, cx - radius - 4, cy - radius - 4);
  ctx.restore();
  // a faint foil pucker around the emboss (the sheet pulled over the relief)
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = rad(ctx, cx, cy, radius * 1.22, [[0.78, "rgba(255,255,255,1)"], [0.9, "rgba(210,180,110,1)"], [1, "rgba(255,255,255,1)"]]);
  ctx.fillRect(cx - radius * 1.3, cy - radius * 1.3, radius * 2.6, radius * 2.6);
  ctx.restore();
}

// ---- PACK FRONT ----------------------------------------------------------------------

const image = (url) => new Promise((res) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = url;
});

// the front's print: the lockup, in the reference's logo box (same width, centred)
const frontPrint = (ctx, color) =>
  brand(ctx, COVER_LOGO.x + COVER_LOGO.w / 2, COVER_LOGO.y + COVER_LOGO.h / 2, COVER_LOGO.w, color);

export async function drawPackFront(ctx) {
  const W = PACK_W, H = PACK_H;
  const body = pouchPath();
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.clip(body);
  // the cover design itself — its crimps, gussets and facets included
  const plate = await image(COVER_PLATE);
  if (plate) ctx.drawImage(plate, 0, 0, W, H);
  else goldFoil(ctx, W, H);
  frontPrint(ctx, INK);
  ctx.restore();
}

// the front's print mask: the brand, white on transparent (src/pack3d's print finish)
export async function drawPackFrontPrint(ctx) {
  ctx.clearRect(0, 0, PACK_W, PACK_H);
  frontPrint(ctx, "#ffffff");
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

// an edition's frame image, for the printed swatches (assets/frames — tools/frames)
const frameImage = (key) => image(new URL(`../../assets/frames/${key}.webp`, import.meta.url).href);

// the back's title block — the lockup over the pack's name — centred in the right
// column; drawn in the print colours, or all white for the print mask
const BACK_RX = PACK_W / 2 + 66 + (PACK_W - (PACK_W / 2 + 66)) / 2;
function backTitle(ctx, ink, dark) {
  brand(ctx, BACK_RX, 268, 340, ink);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = ink;
  ctx.font = `800 60px ${DISPLAY_FONT}`;
  spacedText(ctx, BRAND.name, BACK_RX, 420, 3, "center");
  ctx.fillStyle = dark;
  ctx.font = `500 24px ${DISPLAY_FONT}`;
  spacedText(ctx, BRAND.sub, BACK_RX, 462, 7, "center");
  ctx.restore();
}

export async function drawPackBack(ctx) {
  await pouchFonts();
  const W = PACK_W, H = PACK_H, cx = W / 2;
  const body = pouchPath();
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.clip(body);
  goldFoil(ctx, W, H, 91);

  const DARK = "#2a1c08"; // the secondary print: a deep bronze-black
  // ---- left column: contents + the edition ladder with each slot's odds ----
  const LX = 66;
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `800 34px ${DISPLAY_FONT}`;
  spacedText(ctx, "CONTENTS", LX, 256, 8, "left");
  ctx.font = font(800, 52);
  spacedText(ctx, "5 PLAYER CARDS", LX, 322, 1, "left");
  ctx.fillStyle = DARK;
  ctx.font = font(600, 28);
  spacedText(ctx, "3 BRONZE / SILVER", LX, 372, 1.5, "left");
  spacedText(ctx, "1 GOLD  ·  1 PROMO", LX, 406, 1.5, "left");

  ctx.fillStyle = INK;
  ctx.font = `800 28px ${DISPLAY_FONT}`;
  spacedText(ctx, "EDITIONS", LX, 478, 8, "left");
  const gold = Math.round(RARE_GOLD_ODDS * 100);
  const odds = (t) => (t >= 4 ? `${HIT_ODDS[t]}% OF THE PROMO SLOT` : t === 3 ? `${gold}% OF THE GOLD SLOT` : t === 2 ? `${100 - gold}% OF THE GOLD SLOT` : "FILLS THE FIRST THREE SLOTS");
  const frames = await Promise.all(TIERS.map((t) => frameImage(t.key)));
  TIERS.forEach((t, i) => {
    const y = 506 + i * 86;
    if (frames[i]) ctx.drawImage(frames[i], LX - 2, y - 2, 50, 70);
    ctx.fillStyle = INK;
    ctx.font = font(700, 32);
    spacedText(ctx, t.label.toUpperCase(), LX + 64, y + 30, 1.2, "left");
    ctx.fillStyle = DARK;
    ctx.font = font(600, 22);
    spacedText(ctx, odds(t.id), LX + 64, y + 58, 1.6, "left");
  });

  const players = new Set(POOL.map((c) => c.playerId)).size;
  ctx.fillStyle = INK;
  ctx.font = `800 22px ${DISPLAY_FONT}`;
  spacedText(ctx, "COLLECT THE SQUAD", LX, 1452, 4, "left");
  ctx.fillStyle = DARK;
  ctx.font = font(600, 26);
  spacedText(ctx, `${players} PLAYERS  ·  ${POOL.length} CARDS`, LX, 1492, 2, "left");

  // ---- the fin seal down the middle ----
  const FX = cx - 66, FW = 132;
  ctx.save();
  ctx.shadowColor = "rgba(60,38,8,0.45)"; ctx.shadowBlur = 26;
  ctx.fillStyle = "#8a6420";
  ctx.fillRect(FX, 0, FW, H);
  ctx.restore();
  crimpVertical(ctx, FX, FW, H);
  // the embossed golden ball seal at its centre
  embossedBall(ctx, cx, H / 2, 64, 43);

  // ---- right column: the brand, the pack name, the small print, the barcode ----
  const RX = BACK_RX;
  backTitle(ctx, INK, DARK);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  embossedBall(ctx, RX, 640, 120, 47);

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
  ctx.fillStyle = DARK;
  ctx.font = font(600, 27);
  small.forEach((line, i) => spacedText(ctx, line, RX, 880 + i * 38, 1.2, "center"));
  ctx.fillStyle = INK;
  ctx.font = `700 19px ${DISPLAY_FONT}`;
  spacedText(ctx, "TEAR ALONG THE TOP SEAL", RX, 1232, 3, "center");
  barcode(ctx, RX - 150, 1300, 300, 120, 417);
  ctx.fillStyle = DARK;
  ctx.font = font(600, 24);
  spacedText(ctx, "LOT GLD-26-FC-0417", RX, 1530, 3, "center");
  ctx.restore();

  ctx.save();
  ctx.clip(body);
  crimp(ctx, 0, SEAL, GOLD);
  crimp(ctx, H - SEAL, H, GOLD);
  crimpVertical(ctx, FX, FW, SEAL, 0.0);
  crimpVertical(ctx, FX, FW, SEAL, H - SEAL);
  sealEdges(ctx, W, H);
  ctx.strokeStyle = rgba(GOLD[0], 0.5);
  ctx.lineWidth = 5;
  ctx.stroke(body);
  ctx.restore();
}

// the back's print mask: the brand and the pack name, white on transparent
export async function drawPackBackPrint(ctx) {
  await pouchFonts();
  ctx.clearRect(0, 0, PACK_W, PACK_H);
  backTitle(ctx, "#ffffff", "#ffffff");
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

function sparkle(ctx, x, y, r, col = "#fff6d8") {
  ctx.fillStyle = col;
  ctx.fill(starPath(x, y, r, 4, 0.22, -Math.PI / 2));
  ctx.fillStyle = rad(ctx, x, y, r * 1.6, [[0, rgba(col, 0.6)], [1, rgba(col, 0)]]);
  ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
}

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
  "pack-front-print": { w: PACK_W, h: PACK_H, draw: drawPackFrontPrint },
  "pack-back-print": { w: PACK_W, h: PACK_H, draw: drawPackBackPrint },
  "card-back": { w: CARD_BACK_W, h: CARD_BACK_H, draw: drawCardBack },
};

export { INK, shade, outlined, sparkle };

// packart.js — the PRINTED art of OpenPack FC: the pack's front and back and the
// card back, composed on canvas with the app's own drawing modules (the card
// renderer, the ball, the palette, the edition looks) so the packaging and the
// cards inside it are one design system.
//
// These are build-time sources: tools/render_art.mjs renders them in headless
// Chrome and writes the shipped files (assets/pack*.webp, assets/card-back.jpg).
// Preview them live at /tools/art/ while tuning.

import { P, lin, rad, rgba, shade, rng, font, spacedText, grainTile, starPath, poly, roundRect } from "../../src/paint.js";
import { drawCard, ensureFonts, LOOKS, SHIELD_D, ART_W, ART_H } from "../../src/cardart.js";
import { drawBall } from "../../src/ball.js";
import { HIT_ODDS, RARE_GOLD_ODDS } from "../../src/booster.js";
import { TIERS } from "../../src/rarity.js";
import { POOL } from "../../src/pool.js";

export const PACK_W = 1083, PACK_H = 1794; // the pouch art box the carousel + tear-pack were tuned on
export const CARD_BACK_W = 660, CARD_BACK_H = 921;

const SEAL = 168; // crimped seal depth, top and bottom (~9.4% — under pack.js's 10% tear line)
const GOLD = ["#fff3c8", "#e2b448", "#8d6417"];
const INK = "#0a1222";

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

// a crimped heat-seal band: brushed metal, fine vertical ridges, cross grooves
function crimp(ctx, y0, y1, metal, W = PACK_W) {
  const h = y1 - y0;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, y0, W, h); ctx.clip();
  ctx.fillStyle = lin(ctx, 0, y0, 0, y1, [[0, metal[1]], [0.45, metal[0]], [1, metal[2]]]);
  ctx.fillRect(0, y0, W, h);
  for (let x = 0; x < W; x += 9) {
    ctx.fillStyle = "rgba(255,255,255,0.20)"; ctx.fillRect(x, y0, 3, h);
    ctx.fillStyle = "rgba(0,0,0,0.20)"; ctx.fillRect(x + 4.5, y0, 3, h);
  }
  for (const f of [0.3, 0.5, 0.7]) {
    ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(0, y0 + h * f, W, 3);
    ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(0, y0 + h * f + 3, W, 2);
  }
  ctx.fillStyle = lin(ctx, 0, 0, W, 0, [[0, "rgba(0,0,0,0.25)"], [0.28, "rgba(255,255,255,0.28)"], [0.34, "rgba(255,255,255,0)"], [0.68, "rgba(255,255,255,0.14)"], [1, "rgba(0,0,0,0.25)"]]);
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
  for (const [o, w, a] of [[0.2, 0.07, 0.16], [0.46, 0.03, 0.12], [0.7, 0.09, 0.10]]) {
    ctx.fillStyle = lin(ctx, 0, 0, W, H * 0.62, [[Math.max(0, o - w), "rgba(255,255,255,0)"], [o, `rgba(255,248,230,${a * strength})`], [Math.min(1, o + w), "rgba(255,255,255,0)"]]);
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
  ctx.fillStyle = "rgba(255,246,220,0.55)";
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

const goldText = (ctx, y0, y1) => lin(ctx, 0, y0, 0, y1, [[0, "#fff8dc"], [0.42, "#f6cf5c"], [0.52, "#c98f1c"], [0.7, "#f2c54b"], [1, "#fff1bf"]]);

function sparkle(ctx, x, y, r, col = "#fff6d8") {
  ctx.fillStyle = col;
  ctx.fill(starPath(x, y, r, 4, 0.22, -Math.PI / 2));
  ctx.fillStyle = rad(ctx, x, y, r * 1.6, [[0, rgba(col, 0.6)], [1, rgba(col, 0)]]);
  ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
}

// the brand lockup: OPENPACK over FOOTBALL CLUB, with a ball between the rules
function brand(ctx, cx, y, scale = 1) {
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(scale, scale);
  ctx.font = font(800, 172, true);
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  outlined(ctx, "OPENPACK", 0, 0, 4, goldText(ctx, -140, 10), "#1b1204", 12);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#f4f7fb";
  ctx.font = font(700, 44);
  spacedText(ctx, "FOOTBALL  CLUB", 0, 70, 20, "center");
  ctx.strokeStyle = rgba("#f2c54b", 0.8);
  ctx.lineWidth = 3;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * 270, 54); ctx.lineTo(s * 390, 54); ctx.stroke();
  }
  ctx.restore();
}

// ---- a mystery player card (the hero on the pack front) ---------------------------

function mysteryCard() {
  const c = document.createElement("canvas");
  c.width = ART_W; c.height = ART_H;
  drawCard(c.getContext("2d"), {
    id: "mystery", edition: "raregold", mystery: true,
    ovr: "??", pos: "??", display: "??????", stats: ["??", "??", "??", "??", "??", "??"],
    look: { seed: 11, skin: "#c98f68", hair: "#2f2018", hairStyle: "quiff", beard: "none", eyes: "#3a2416", jaw: 0.7, face: 0.5, nose: 0.5, lips: 0.5, smile: 0.2, browThick: 0.6, browArch: 0.4, cranium: 0.5, neck: 0.7 },
    kit: { primary: "#333", secondary: "#555", trim: "#777", pattern: "plain", collar: "crew" },
    seed: 21,
  });
  return c;
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

  // night sky over a stadium → pitch at the bottom
  ctx.fillStyle = lin(ctx, 0, SEAL, 0, H - SEAL, [[0, "#0d1830"], [0.5, "#0a1631"], [0.78, "#071624"], [1, "#04140c"]]);
  ctx.fillRect(0, 0, W, H);

  // the stands: a dark tier across the middle, salted with camera flashes
  ctx.fillStyle = lin(ctx, 0, 560, 0, 1180, [[0, "rgba(0,0,0,0)"], [0.25, "rgba(2,6,14,0.55)"], [0.8, "rgba(2,6,14,0.6)"], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(0, 560, W, 620);
  for (let i = 0; i < 260; i++) {
    const x = r.range(20, W - 20), y = r.range(620, 1130), s = r.range(0.8, 2.6);
    ctx.fillStyle = rgba(r() < 0.12 ? "#ffe9b0" : "#dfe9ff", r.range(0.15, 0.85));
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
    if (s > 2.3) sparkle(ctx, x, y, s * 3.2, "#ffffff");
  }

  // floodlights blazing in the top corners, with their beams
  const LY = SEAL + 70;
  for (const lx of [86, W - 86]) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const ang = Math.atan2(1260 - LY, cx - lx), len = 1500, spread = 0.12;
    ctx.fillStyle = lin(ctx, lx, LY, lx + Math.cos(ang) * len, LY + Math.sin(ang) * len, [[0, "rgba(214,232,255,0.30)"], [0.6, "rgba(214,232,255,0.06)"], [1, "rgba(214,232,255,0)"]]);
    ctx.fill(poly([[lx, LY], [lx + Math.cos(ang - spread) * len, LY + Math.sin(ang - spread) * len], [lx + Math.cos(ang + spread) * len, LY + Math.sin(ang + spread) * len]]));
    ctx.fillStyle = rad(ctx, lx, LY, 360, [[0, "rgba(246,250,255,0.95)"], [0.08, "rgba(220,234,255,0.7)"], [0.3, "rgba(170,200,255,0.18)"], [1, "rgba(150,180,255,0)"]]);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // the lamp bank itself: a grid of bulbs
    ctx.save();
    ctx.translate(lx, LY - 8);
    ctx.rotate(lx < cx ? 0.35 : -0.35);
    ctx.fillStyle = "rgba(20,26,40,0.9)";
    ctx.fill(roundRect(-58, -26, 116, 52, 8));
    for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 2; gy++) {
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#cfe2ff"; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(-45 + gx * 18, -9 + gy * 18, 6.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // the pitch: mown stripes running to a vanishing point, the halfway line and the centre circle
  const VY = 1010;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 1150, W, H - 1150); ctx.clip();
  ctx.fillStyle = lin(ctx, 0, 1150, 0, H - SEAL, [[0, "#0b3320"], [1, "#0e4a2a"]]);
  ctx.fillRect(0, 1150, W, H - 1150);
  for (let i = -14; i <= 14; i += 2) {
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    ctx.fill(poly([[cx, VY], [cx + i * 150, H], [cx + (i + 1) * 150, H]]));
  }
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(0, 1500); ctx.lineTo(W, 1500); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, 1500, 360, 92, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath(); ctx.ellipse(cx, 1500, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = lin(ctx, 0, 1150, 0, 1330, [[0, "rgba(7,22,36,1)"], [1, "rgba(7,22,36,0)"]]);
  ctx.fillRect(0, 1150, W, 180);
  ctx.restore();

  // a gold sunburst behind the hero card
  const CY = 880;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.translate(cx, CY);
  for (let i = 0; i < 40; i++) {
    const a0 = (i / 40) * Math.PI * 2, a1 = a0 + Math.PI / 40 * (i % 2 ? 0.6 : 1);
    ctx.fillStyle = rad(ctx, 0, 0, 760, [[0, "rgba(255,214,110,0.55)"], [0.45, "rgba(255,200,90,0.16)"], [1, "rgba(255,200,90,0)"]]);
    ctx.fill(poly([[0, 0], [Math.cos(a0) * 900, Math.sin(a0) * 900], [Math.cos(a1) * 900, Math.sin(a1) * 900]]));
  }
  ctx.fillStyle = rad(ctx, 0, 0, 520, [[0, "rgba(255,226,150,0.65)"], [0.5, "rgba(255,190,80,0.18)"], [1, "rgba(255,190,80,0)"]]);
  ctx.fillRect(-W, -H, W * 2, H * 2);
  ctx.restore();

  // the hero: a mystery player card, tilted, haloed in gold
  const card = mysteryCard();
  ctx.save();
  ctx.translate(cx, CY);
  ctx.rotate(-0.075);
  const s = 0.66;
  ctx.scale(s, s);
  ctx.shadowColor = "rgba(255,200,90,0.85)";
  ctx.shadowBlur = 90;
  ctx.fillStyle = "#f2c54b";
  ctx.fill(roundRect(-ART_W / 2, -ART_H / 2, ART_W, ART_H, 40));
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 30;
  ctx.save();
  ctx.clip(roundRect(-ART_W / 2, -ART_H / 2, ART_W, ART_H, 40));
  ctx.drawImage(card, -ART_W / 2, -ART_H / 2);
  // a glint sweeping the card
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = lin(ctx, -ART_W / 2, -ART_H / 2, ART_W / 2, ART_H / 2, [[0.3, "rgba(255,255,255,0)"], [0.4, "rgba(255,255,255,0.45)"], [0.47, "rgba(255,255,255,0)"]]);
  ctx.fillRect(-ART_W / 2, -ART_H / 2, ART_W, ART_H);
  ctx.restore();
  ctx.restore();

  // sparkles around the card
  for (const [x, y, rr] of [[250, 560, 26], [842, 640, 34], [210, 1110, 20], [880, 1180, 24], [316, 700, 12], [790, 520, 14], [930, 900, 12], [150, 860, 16]]) sparkle(ctx, x, y, rr);

  // the brand, top
  brand(ctx, cx, 368);

  // the pack name, bottom
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#f4f7fb";
  ctx.font = font(700, 58);
  ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 16;
  spacedText(ctx, "PREMIUM", cx, 1342, 22, "center");
  ctx.font = font(800, 178, true);
  ctx.shadowOffsetY = 8; ctx.shadowBlur = 26;
  outlined(ctx, "GOLD PACK", cx, 1500, 3, goldText(ctx, 1360, 1505), "#1b1204", 12);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = rgba("#ffffff", 0.92);
  ctx.font = font(700, 38);
  spacedText(ctx, "5 PLAYERS · 1 PROMO GUARANTEED", cx, 1574, 5, "center");
  ctx.restore();

  foilFinish(ctx, W, H);
  ctx.restore(); // body clip

  // the crimped seals, top and bottom
  ctx.save();
  ctx.clip(body);
  crimp(ctx, 0, SEAL, GOLD);
  crimp(ctx, H - SEAL, H, GOLD);
  sealEdges(ctx, W, H);
  // small print on the seals
  ctx.fillStyle = rgba("#3b2a08", 0.75);
  ctx.font = font(700, 26);
  spacedText(ctx, "TEAR HERE", cx, 104, 10, "center");
  spacedText(ctx, "OPENPACK FC  ·  ULTIMATE XI  ·  SEASON 26/27", cx, H - 70, 6, "center");
  ctx.restore();

  // a bright rim along the silhouette
  ctx.save();
  ctx.clip(body);
  ctx.strokeStyle = "rgba(255,246,220,0.45)";
  ctx.lineWidth = 5;
  ctx.stroke(body);
  ctx.restore();
}

// ---- PACK BACK -------------------------------------------------------------------------

function barcode(ctx, x, y, w, h, seed) {
  const r = rng(seed);
  ctx.fillStyle = "#ffffff";
  ctx.fill(roundRect(x - 14, y - 14, w + 28, h + 58, 8));
  let xx = x;
  ctx.fillStyle = "#0b0f18";
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
  ctx.fillStyle = lin(ctx, 0, SEAL, 0, H - SEAL, [[0, "#101c36"], [0.6, "#0b152b"], [1, "#071022"]]);
  ctx.fillRect(0, 0, W, H);
  // a gold honeycomb across the field
  ctx.strokeStyle = rgba("#f2c54b", 0.07);
  ctx.lineWidth = 2;
  const S = 46, hh = S * Math.sqrt(3);
  for (let row = -1; row < 24; row++) for (let col = -1; col < 18; col++) {
    const x0 = col * S * 1.5, y0 = row * hh + (col % 2 ? hh / 2 : 0);
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const a = (Math.PI / 3) * k;
      k ? ctx.lineTo(x0 + Math.cos(a) * S, y0 + Math.sin(a) * S) : ctx.moveTo(x0 + Math.cos(a) * S, y0 + Math.sin(a) * S);
    }
    ctx.stroke();
  }

  // ---- left column: contents + the edition ladder with each slot's odds ----
  const LX = 66;
  ctx.textAlign = "left";
  ctx.fillStyle = "#f2c54b";
  ctx.font = font(700, 36);
  spacedText(ctx, "CONTENTS", LX, 256, 8, "left");
  ctx.fillStyle = "#f4f7fb";
  ctx.font = font(800, 52, true);
  spacedText(ctx, "5 PLAYER CARDS", LX, 322, 1, "left");
  ctx.fillStyle = rgba("#dfe7f3", 0.72);
  ctx.font = font(600, 28);
  spacedText(ctx, "3 BRONZE / SILVER", LX, 372, 1.5, "left");
  spacedText(ctx, "1 GOLD  ·  1 PROMO", LX, 406, 1.5, "left");

  ctx.fillStyle = "#f2c54b";
  ctx.font = font(700, 30);
  spacedText(ctx, "EDITIONS", LX, 478, 8, "left");
  const gold = Math.round(RARE_GOLD_ODDS * 100);
  const odds = (t) => (t >= 4 ? `${HIT_ODDS[t]}% OF THE PROMO SLOT` : t === 3 ? `${gold}% OF THE GOLD SLOT` : t === 2 ? `${100 - gold}% OF THE GOLD SLOT` : "FILLS THE FIRST THREE SLOTS");
  TIERS.forEach((t, i) => {
    const y = 506 + i * 86;
    const L = LOOKS[t.vfx];
    // a mini card in the edition's own material
    ctx.save();
    ctx.fillStyle = lin(ctx, LX, y, LX + 46, y + 64, [[0, L.base[0]], [0.5, L.base[1]], [1, L.base[2]]]);
    ctx.fill(roundRect(LX, y, 46, 64, 7));
    ctx.strokeStyle = L.trim;
    ctx.lineWidth = 2.5;
    ctx.stroke(roundRect(LX + 5, y + 5, 36, 54, 5));
    ctx.restore();
    ctx.fillStyle = "#f4f7fb";
    ctx.font = font(700, 32);
    spacedText(ctx, t.label.toUpperCase(), LX + 64, y + 30, 1.2, "left");
    ctx.fillStyle = t.id >= 4 ? "#f2c54b" : rgba("#dfe7f3", 0.6);
    ctx.font = font(600, 22);
    spacedText(ctx, odds(t.id), LX + 64, y + 58, 1.6, "left");
  });

  // the set count, straight from the pool
  const players = new Set(POOL.map((c) => c.playerId)).size;
  ctx.fillStyle = rgba("#f2c54b", 0.95);
  ctx.font = font(700, 30);
  spacedText(ctx, "COLLECT THE SQUAD", LX, 1452, 6, "left");
  ctx.fillStyle = rgba("#dfe7f3", 0.72);
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
  // the embossed ball seal at its centre
  ctx.save();
  ctx.translate(cx, H / 2);
  ctx.fillStyle = lin(ctx, -70, -70, 70, 70, [[0, "#fff3c8"], [0.5, "#d9a93e"], [1, "#7c5512"]]);
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  ctx.fill(roundRect(-74, -74, 148, 148, 22));
  ctx.shadowColor = "transparent";
  ctx.translate(-54, -54);
  ctx.scale(1.08, 1.08);
  drawBall(ctx, { body: "#fff7e0", panel: "#3a2a08", seam: "#8a6a2a", shade: true });
  ctx.restore();

  // ---- right column: the brand, the small print, the barcode ----
  const RX = cx + 66 + (W - (cx + 66)) / 2;
  brand(ctx, RX, 330, 0.48);
  ctx.save();
  ctx.translate(RX - 110, 430);
  ctx.scale(2.2, 2.2);
  ctx.shadowColor = "rgba(255,214,110,0.6)"; ctx.shadowBlur = 40;
  drawBall(ctx, { body: "#f7f8fa", panel: "#16181d", seam: "#9aa0ab", shade: true });
  ctx.restore();
  ctx.fillStyle = "#f2c54b";
  ctx.font = font(800, 54, true);
  spacedText(ctx, "ULTIMATE XI", RX, 760, 4, "center");
  ctx.fillStyle = rgba("#f4f7fb", 0.85);
  ctx.font = font(700, 30);
  spacedText(ctx, "SEASON 26/27", RX, 806, 8, "center");

  const small = [
    "A FAN-MADE PACK-OPENING",
    "CONCEPT. EVERY PLAYER, CLUB",
    "AND CREST IN THIS SET IS",
    "FICTIONAL; NATION FLAGS ARE",
    "SHOWN AS PUBLIC SYMBOLS.",
    "NOT AFFILIATED WITH ANY",
    "LEAGUE, FEDERATION OR",
    "GAME PUBLISHER.",
  ];
  ctx.fillStyle = rgba("#dfe7f3", 0.7);
  ctx.font = font(600, 27);
  small.forEach((line, i) => spacedText(ctx, line, RX, 900 + i * 38, 1.2, "center"));
  ctx.fillStyle = rgba("#f2c54b", 0.9);
  ctx.font = font(700, 28);
  spacedText(ctx, "TEAR ALONG THE TOP SEAL", RX, 1250, 4, "center");
  barcode(ctx, RX - 150, 1310, 300, 120, 417);
  ctx.fillStyle = rgba("#dfe7f3", 0.6);
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
  ctx.strokeStyle = "rgba(255,246,220,0.4)";
  ctx.lineWidth = 5;
  ctx.stroke(body);
  ctx.restore();
}

// the vertical (fin) seal: ridges run across it, and it's a touch brighter
function crimpVertical(ctx, x, w, h, y0 = 0) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y0, w, h); ctx.clip();
  ctx.fillStyle = lin(ctx, x, 0, x + w, 0, [[0, GOLD[2]], [0.3, GOLD[0]], [0.55, GOLD[1]], [1, GOLD[2]]]);
  ctx.fillRect(x, y0, w, h);
  for (let y = y0; y < y0 + h; y += 9) {
    ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(x, y + 4.5, w, 3);
  }
  for (const f of [0.22, 0.5, 0.78]) {
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x + w * f, y0, 3, h);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(x + w * f + 3, y0, 2, h);
  }
  ctx.restore();
}

// ---- CARD BACK ---------------------------------------------------------------------------

export async function drawCardBack(ctx) {
  await ensureFonts();
  const W = CARD_BACK_W, H = CARD_BACK_H, cx = W / 2, cy = H / 2;
  ctx.fillStyle = rad(ctx, cx, cy, H * 0.7, [[0, "#173061"], [0.55, "#0c1a3a"], [1, "#050a18"]]);
  ctx.fillRect(0, 0, W, H);
  // sunburst
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * Math.PI * 2, a1 = a0 + Math.PI / 48;
    ctx.fillStyle = rgba("#f2c54b", 0.06);
    ctx.fill(poly([[0, 0], [Math.cos(a0) * 900, Math.sin(a0) * 900], [Math.cos(a1) * 900, Math.sin(a1) * 900]]));
  }
  ctx.restore();
  // pinstripes
  ctx.strokeStyle = rgba("#f2c54b", 0.05);
  ctx.lineWidth = 2;
  for (let i = -30; i < 40; i++) {
    ctx.beginPath(); ctx.moveTo(i * 26, 0); ctx.lineTo(i * 26 + H, H); ctx.stroke();
  }
  // frame
  ctx.lineWidth = 6;
  ctx.strokeStyle = lin(ctx, 0, 0, W, H, [[0, "#fff1c2"], [0.4, "#e2b448"], [0.6, "#a87a22"], [1, "#fff1c2"]]);
  ctx.stroke(roundRect(24, 24, W - 48, H - 48, 26));
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba("#f2c54b", 0.5);
  ctx.stroke(roundRect(38, 38, W - 76, H - 76, 18));

  // the centre crest: the card's own shield, holding the ball
  ctx.save();
  ctx.translate(cx, cy - 6);
  const s = 0.42;
  ctx.scale(s, s);
  ctx.translate(-ART_W / 2, -ART_H / 2);
  const sh = P(SHIELD_D);
  ctx.shadowColor = "rgba(255,200,90,0.55)"; ctx.shadowBlur = 60;
  ctx.fillStyle = lin(ctx, 0, 0, ART_W, ART_H, [[0, "#1d3a78"], [1, "#0a1636"]]);
  ctx.fill(sh);
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 16;
  ctx.strokeStyle = lin(ctx, 0, 0, ART_W, ART_H, [[0, "#fff1c2"], [0.45, "#e2b448"], [1, "#a87a22"]]);
  ctx.stroke(sh);
  ctx.restore();
  ctx.save();
  ctx.translate(cx - 95, cy - 150);
  ctx.scale(1.9, 1.9);
  drawBall(ctx, { body: "#f7f8fa", panel: "#16181d", seam: "#9aa0ab", shade: true });
  ctx.restore();
  ctx.save();
  ctx.font = font(800, 64, true);
  outlined(ctx, "OPENPACK", cx, cy + 112, 2, goldText(ctx, cy + 60, cy + 116), "#0a1222", 7);
  ctx.fillStyle = "#f4f7fb";
  ctx.font = font(700, 26);
  spacedText(ctx, "FOOTBALL CLUB", cx, cy + 152, 9, "center");
  ctx.restore();

  // the wordmark top + bottom, mirrored like a real card back
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) { ctx.translate(W, H); ctx.rotate(Math.PI); }
    ctx.fillStyle = rgba("#f2c54b", 0.85);
    ctx.font = font(700, 30);
    spacedText(ctx, "ULTIMATE  XI", cx, 98, 12, "center");
    ctx.restore();
  }
  foilFinishCard(ctx, W, H);
}

function foilFinishCard(ctx, W, H) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = lin(ctx, 0, 0, W, H, [[0.25, "rgba(255,255,255,0)"], [0.38, "rgba(255,248,230,0.14)"], [0.5, "rgba(255,255,255,0)"]]);
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

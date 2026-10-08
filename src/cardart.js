// cardart.js — paints a football player card onto a canvas.
//
// Every card is composed at runtime: the edition's FRAME (a baked image — see
// tools/frames), the player's PHOTO (a cut-out Commons portrait — tools/players),
// and the data printed over them in the ultimate-team layout: rating + position,
// nation flag and club badge down the left, the name, and two columns of six
// face stats. Two frame FAMILIES carry the ten editions (rarity.js):
//   gold — the swirl shield, re-toned per metal: Bronze, Silver, Gold, Rare Gold
//   icon — the gold-rimmed shield, its field dyed per promo: Team of the Week,
//          Player of the Match, Future Stars, Team of the Season, Team of the
//          Year, and Legend (the original ivory)
//
// cardArt(card) loads what the card needs, renders once to a WebP/PNG blob URL
// WITH ALPHA (the frames are shaped — no rectangle around them), cached per
// card id, and the reveal shows it through the same <img class="card__art"> as
// before, so the holo layers + Android fixes carry over. card.css clips those
// layers to the frame's silhouette (data-frame on the card). Alongside it comes
// the PLAYER's silhouette (the same footprint the photo was painted with), so
// card.css can give the photo its own material — the frame lights as metal, the
// player as a gloss print. And the BARE card — the same art before its print
// (the data) goes on — which the reveal shows first and stamps the print onto
// piece by piece (cardPrint).

import { lin, rad, rgba, shade, font, spacedText, fitSize } from "./paint.js";
import { drawFlag, drawCrest, crestURL } from "./emblems.js";
import { drawPortrait } from "./portrait.js";

export const ART_W = 756; // 63 × 12
export const ART_H = 1056; // 88 × 12 — the card's 63:88 aspect, exactly
const W = ART_W, H = ART_H;

// ---- edition looks -----------------------------------------------------------
// frame: the baked frame image · family: its layout + silhouette · ink: main
// text · sub: stat labels · glow: the light behind the player · dark: light text
// on a dark field. base/trim describe the edition's material for printed
// swatches (the pack back's edition list).
export const LOOKS = {
  bronze:   { family: "gold", ink: "#371805", sub: "#5a2e12", glow: "#ffe0c2", base: ["#f3c39b", "#a8622f", "#4a2410"], trim: "#ffe6cc" },
  silver:   { family: "gold", ink: "#161c24", sub: "#36404c", glow: "#ffffff", base: ["#ffffff", "#aeb8c4", "#4f5862"], trim: "#ffffff" },
  gold:     { family: "gold", ink: "#2c1c02", sub: "#4a340c", glow: "#fff4cc", base: ["#fff1c2", "#e2b448", "#8d6417"], trim: "#fff8de" },
  raregold: { family: "gold", ink: "#261400", sub: "#432c06", glow: "#fff8d8", base: ["#ffe68a", "#f2b92a", "#86500a"], trim: "#fffbe9" },
  totw:     { family: "icon", ink: "#f4d47e", sub: "#e3c46c", glow: "#f3c652", base: ["#3d3d44", "#18181c", "#060607"], trim: "#e7c057", dark: true },
  potm:     { family: "icon", ink: "#ffffff", sub: "#ffd3da", glow: "#ff6b81", base: ["#b0203a", "#560b1a", "#160307"], trim: "#ff8da0", dark: true },
  future:   { family: "icon", ink: "#ffffff", sub: "#c4ffec", glow: "#b46bff", base: ["#5b25b0", "#26105a", "#0b0423"], trim: "#7dffd2", dark: true },
  tots:     { family: "icon", ink: "#032a31", sub: "#0a4651", glow: "#ffffff", base: ["#c8fff6", "#2fc7ba", "#08606f"], trim: "#ffffff" },
  toty:     { family: "icon", ink: "#ffe18e", sub: "#f4d47c", glow: "#7fa2ff", base: ["#2f56d8", "#112777", "#040b2c"], trim: "#f2c54b", dark: true },
  legend:   { family: "icon", ink: "#43300c", sub: "#654b1c", glow: "#fff6dc", base: ["#fffdf7", "#f2e8d0", "#cdb27c"], trim: "#d1a547" },
};

// Per-family layout, in art pixels. colX: the left column's centre line;
// photo: [x, y, size] of the square portrait; the rest are text baselines.
const LAYOUT = {
  gold: { colX: 162, ovrY: 236, posY: 296, flagY: 318, crestY: 470, photo: [190, 34, 536], nameY: 676, statY: 768, markY: null },
  icon: { colX: 168, ovrY: 262, posY: 320, flagY: 342, crestY: 494, photo: [196, 70, 504], nameY: 680, statY: 768, markY: 904 },
};

const OUTFIELD = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
const KEEPER = ["DIV", "HAN", "KIC", "REF", "SPD", "POS"];

// The old card-shield path — kept for the printed card back's centre crest (tools/art).
export const SHIELD_D =
  "M30 132 L30 92 Q30 48 74 48 L254 48 Q292 48 318 30 Q346 11 378 11 Q410 11 438 30 Q464 48 502 48 L682 48 Q726 48 726 92 " +
  "L726 872 Q726 930 664 958 L424 1036 Q378 1051 332 1036 L92 958 Q30 930 30 872 Z";

// A stand-in bust for a card with no photo (the pack's mystery card, or a photo
// that failed to load) — only its silhouette is ever shown.
const SIL_LOOK = { seed: 11, skin: "#c98f68", hair: "#2f2018", hairStyle: "quiff", beard: "none", eyes: "#3a2416", jaw: 0.7, face: 0.5, nose: 0.5, lips: 0.5, smile: 0.2, browThick: 0.6, browArch: 0.4, cranium: 0.5, neck: 0.7 };
const SIL_KIT = { primary: "#333", secondary: "#555", trim: "#777", pattern: "plain", collar: "crew" };

// ---- font readiness ---------------------------------------------------------
// The card text is baked into the image, so the face font must be LOADED before
// a card is painted (or the fallback gets baked in for good). The page links the
// Google Fonts sheet non-blocking (id="font-css"); wait for it, then for the
// faces themselves — never longer than `timeout`, then draw with the fallback.
let _fonts = null;
export function ensureFonts(timeout = 3000) {
  if (_fonts) return _fonts;
  const sheet = new Promise((res) => {
    const link = document.getElementById("font-css");
    if (!link || link.dataset.ready) return res();
    link.addEventListener("load", res, { once: true });
    link.addEventListener("error", res, { once: true });
  });
  // the card face (Barlow Condensed) and the printed-art display face (Cinzel —
  // tools/art); a family the page doesn't link resolves at once, so neither waits
  // on the other
  const faces = sheet.then(() =>
    Promise.all([
      ...["600", "700", "800"].map((w) => document.fonts?.load(`${w} 100px "Barlow Condensed"`, "AÉĆØ0123")),
      ...["700", "800"].map((w) => document.fonts?.load(`${w} 100px "Cinzel"`, "AÉØ0123")),
    ].map((p) => (p || Promise.resolve()).catch(() => null)))
  );
  _fonts = Promise.race([faces, new Promise((r) => setTimeout(r, timeout))]);
  return _fonts;
}

// ---- assets -----------------------------------------------------------------------
// Resolved against this module, so the app and the art tools (tools/art) agree.

const asset = (path) => new URL(`../assets/${path}`, import.meta.url).href;
const _img = new Map(); // url → Promise<HTMLImageElement | null>

function fetchImage(url) {
  return new Promise((res) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => res(im));
    im.onerror = () => res(null);
    im.src = url;
  });
}

// One retry for a dropped request (a flaky mobile link, a burst the server
// refused), and a failure is never cached — the next card asks again. If it
// still fails the card is painted without it (a silhouette stands in for a photo).
function loadImage(url) {
  if (!_img.has(url)) {
    const pr = fetchImage(url)
      .then((im) => im || new Promise((r) => setTimeout(r, 400)).then(() => fetchImage(url)))
      .then((im) => {
        if (!im) _img.delete(url);
        return im;
      });
    _img.set(url, pr);
  }
  return _img.get(url);
}

const lookOf = (card) => LOOKS[card.edition] || LOOKS.gold;
const hasPhoto = (card) => !card.mystery && /^[pl]\d+$/.test(card.playerId || "");

// Everything one card needs, fetched in parallel: { frame, field, photo, crest }.
export function loadCardAssets(card) {
  const L = lookOf(card);
  const crest = card.mystery ? null : crestURL(card.club);
  return Promise.all([
    loadImage(asset(`frames/${card.edition in LOOKS ? card.edition : "gold"}.webp`)),
    loadImage(asset(`frames/field-${L.family}.png`)),
    hasPhoto(card) ? loadImage(asset(`players/${card.playerId}.webp`)) : null,
    crest ? loadImage(crest) : null,
  ]).then(([frame, field, photo, crest]) => ({ frame, field, photo, crest }));
}

// ---- the player ------------------------------------------------------------------

// The portrait on its own layer: the cut-out photo (or a silhouette), rim-lit on
// the dark editions, faded out at the chest so it melts behind the name, and
// clipped to the frame's inner panel so it never spills over the rim.
let _pc = null, _rc = null;
function photoLayer(card, L, F, assets) {
  const c = _pc || (_pc = document.createElement("canvas"));
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const [px, py, ps] = F.photo;
  const silhouette = !assets.photo;
  if (!silhouette) {
    g.drawImage(assets.photo, px, py, ps, ps);
  } else {
    drawPortrait(g, SIL_LOOK, SIL_KIT, px + ps * 0.5, py + ps * 0.4, ps / 236);
    g.save();
    g.globalCompositeOperation = "source-in";
    g.fillStyle = L.dark
      ? lin(g, 0, py, 0, py + ps, [[0, "#000000"], [1, rgba("#000000", 0.85)]])
      : lin(g, 0, py, 0, py + ps, [[0, rgba(L.ink, 0.78)], [1, rgba(L.ink, 0.9)]]);
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  // rim light: the silhouette's upper-left edge, in the edition glow
  const rim = _rc || (_rc = document.createElement("canvas"));
  rim.width = W; rim.height = H;
  const rg = rim.getContext("2d");
  rg.drawImage(c, 0, 0);
  rg.globalCompositeOperation = "source-in";
  rg.fillStyle = L.dark ? L.glow : "#ffffff";
  rg.fillRect(0, 0, W, H);
  rg.globalCompositeOperation = "destination-out";
  rg.drawImage(c, L.dark ? 5 : 3, L.dark ? 4 : 2);
  g.save();
  g.globalAlpha = silhouette ? 0.5 : L.dark ? 0.75 : 0.28;
  g.globalCompositeOperation = "source-atop";
  g.drawImage(rim, 0, 0);
  g.restore();

  // fade the chest into the card
  g.globalCompositeOperation = "destination-in";
  const f0 = py + ps * 0.7, f1 = py + ps * 0.99;
  g.fillStyle = lin(g, 0, f0, 0, f1, [[0, "rgba(0,0,0,1)"], [0.5, "rgba(0,0,0,0.6)"], [1, "rgba(0,0,0,0)"]]);
  g.fillRect(0, 0, W, H);
  if (assets.field) g.drawImage(assets.field, 0, 0, W, H);
  g.globalCompositeOperation = "source-over";
  return c;
}

// ---- text ----------------------------------------------------------------------

function engraved(ctx, L, fn) {
  ctx.save();
  if (L.dark) {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
  } else {
    ctx.shadowColor = "rgba(255,255,255,0.5)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 2;
  }
  fn();
  ctx.restore();
}

function divider(ctx, L, x0, y0, x1, y1, a = 0.35) {
  ctx.save();
  ctx.strokeStyle = rgba(L.ink, a);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.restore();
}

// a "?" plate standing in for the flag / crest on a mystery card
function mysteryBadge(ctx, L, x, y, w, h, r) {
  ctx.save();
  ctx.fillStyle = rgba(L.ink, 0.82);
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.fillStyle = L.dark ? "#000000" : L.base[0];
  ctx.font = font(800, h * 0.72);
  ctx.textAlign = "center";
  ctx.fillText("?", x + w / 2, y + h * 0.78);
  ctx.restore();
}

// ---- the print -------------------------------------------------------------------
// The card's DATA — position, nation, club, the six face stats, the rating and the
// name — as separate pieces, in the order the reveal stamps them on (reveal.js
// stampIn). Each paints in art pixels inside its `box` [x, y, w, h] (padded for
// the engraving's shadow); the rating takes an optional value so it can count up.
// drawCard paints them all over the bare card, and cardPrint() paints each into
// its own small canvas with the SAME painter — so the stamped pieces match the
// baked art pixel for pixel and the reveal can swap back to it unseen.
function printPieces(card, L, F, assets) {
  const colX = F.colX;
  const ink = (ctx, weight, px, text, x, y, spacing, align, color = L.ink) =>
    engraved(ctx, L, () => {
      ctx.fillStyle = color;
      ctx.font = font(weight, px);
      spacedText(ctx, text, x, y, spacing, align);
    });

  const pieces = [
    { key: "pos", box: [colX - 80, F.posY - 52, 160, 68], draw: (ctx) => ink(ctx, 700, 58, card.pos || "", colX, F.posY, 2, "center") },
    {
      key: "nation", box: [colX - 52, F.flagY - 2, 104, 74],
      draw: (ctx) => {
        if (card.mystery) mysteryBadge(ctx, L, colX - 46, F.flagY + 4, 92, 61, 10);
        else if (card.nation) drawFlag(ctx, card.nation, colX - 46, F.flagY + 4, 92, 61);
      },
    },
    {
      key: "club", box: [colX - 76, F.crestY - 76, 152, 156],
      // the club's real crest; on the dark editions ringed in white so a black or
      // navy crest doesn't sink into the field
      draw: (ctx) => {
        if (card.mystery) mysteryBadge(ctx, L, colX - 44, F.crestY - 46, 88, 96, 44);
        else if (card.club) drawCrest(ctx, card.club, colX, F.crestY, assets.crest ? 108 : 100, { img: assets.crest, keyline: L.dark ? "#ffffff" : null });
      },
    },
  ];

  // the six face stats — the left column top to bottom, then the right
  const labels = card.pos === "GK" ? KEEPER : OUTFIELD;
  const stats = card.stats || [];
  for (const [x, off] of [[262, 0], [530, 3]]) {
    for (let row = 0; row < 3; row++) {
      const y = F.statY + row * 56;
      pieces.push({
        key: `stat${off + row}`, box: [x - 96, y - 50, 200, 64],
        draw: (ctx) => {
          ink(ctx, 800, 56, String(stats[off + row] ?? ""), x - 10, y, 0, "right");
          ink(ctx, 600, 46, labels[off + row], x + 4, y, 1.5, "left", L.sub);
        },
      });
    }
  }

  pieces.push({
    key: "ovr", box: [colX - 110, F.ovrY - 132, 220, 150],
    draw: (ctx, value = card.ovr) => ink(ctx, 800, 150, String(value ?? ""), colX, F.ovrY, -3, "center"),
  });

  const name = (card.display || card.name || "").toUpperCase();
  pieces.push({
    key: "name", box: [W / 2 - 300, F.nameY - 98, 600, 116],
    draw: (ctx) => {
      const size = fitSize(ctx, name, 800, 84, 540, 3, 40);
      ink(ctx, 800, size, name, W / 2, F.nameY, 3, "center");
    },
  });
  return pieces;
}

// ---- the whole card --------------------------------------------------------------

// Paint `card` with its loaded `assets` (loadCardAssets). Leaves everything
// outside the frame transparent. Returns the player layer (a shared canvas —
// read it before the next card is painted) for playerMask(). With `bare` set it
// calls `bare()` once the card is painted WITHOUT its print (frame, player, the
// rules between the print's slots, the edition mark), before the print goes on.
export function drawCard(ctx, card, assets, bare = null) {
  const L = lookOf(card);
  const F = LAYOUT[L.family];
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  // 1 — the frame
  if (assets.frame) ctx.drawImage(assets.frame, 0, 0, W, H);

  // 2 — a pool of light behind the player, inside the panel
  const [px, py, ps] = F.photo;
  const hx = px + ps / 2, hy = py + ps * 0.4;
  const pool = document.createElement("canvas");
  pool.width = W; pool.height = H;
  const pg = pool.getContext("2d");
  pg.fillStyle = rad(pg, hx, hy, ps * 0.62, [[0, rgba(L.glow, L.dark ? 0.5 : 0.55)], [0.55, rgba(L.glow, 0.14)], [1, rgba(L.glow, 0)]]);
  pg.fillRect(0, 0, W, H);
  if (assets.field) {
    pg.globalCompositeOperation = "destination-in";
    pg.drawImage(assets.field, 0, 0, W, H);
  }
  ctx.save();
  ctx.globalCompositeOperation = L.dark ? "screen" : "soft-light";
  ctx.drawImage(pool, 0, 0);
  if (!L.dark) { ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 0.35; ctx.drawImage(pool, 0, 0); }
  ctx.restore();

  // 3 — the player
  const player = photoLayer(card, L, F, assets);
  ctx.save();
  ctx.shadowColor = L.dark ? "rgba(0,0,0,0.6)" : "rgba(40,20,0,0.35)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 8;
  ctx.drawImage(player, 0, 0);
  ctx.restore();

  // 4 — the rules between the print's slots: under the position, round the
  // flag, under the name, between the stat columns
  const colX = F.colX;
  divider(ctx, L, colX - 44, F.flagY - 10, colX + 44, F.flagY - 10);
  divider(ctx, L, colX - 44, F.flagY + 80, colX + 44, F.flagY + 80);
  divider(ctx, L, 150, F.nameY + 30, W - 150, F.nameY + 30, 0.42);
  divider(ctx, L, W / 2 - 4, F.statY - 44, W / 2 - 4, F.statY + 2 * 56 + 8, 0.3);

  // 5 — the edition mark in the shield's point (promos; the base metals carry
  // the frame's own GFP mark there)
  const mark = card.markLabel;
  if (mark && F.markY) {
    ctx.save();
    ctx.font = font(700, 25);
    const tw = ctx.measureText(mark).width + mark.length * 4 + 38;
    const mx = W / 2 - tw / 2;
    ctx.fillStyle = L.dark ? rgba(L.trim, 0.95) : rgba(L.ink, 0.88);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(mx, F.markY, tw, 34, 17) : ctx.rect(mx, F.markY, tw, 34);
    ctx.fill();
    ctx.fillStyle = L.dark ? shade(L.base[2], -0.2) : L.base[0];
    spacedText(ctx, mark, W / 2, F.markY + 25, 4, "center");
    ctx.restore();
  }
  bare?.();

  // 6 — the print: position, nation, club, stats, rating, name
  for (const p of printPieces(card, L, F, assets)) {
    ctx.save();
    p.draw(ctx);
    ctx.restore();
  }
  ctx.restore();
  return player;
}

// The print as loose pieces for the reveal to stamp on over the bare art, in
// stamping order: [{ key, box, canvas, paint(value?) }]. Each canvas is the
// piece's box at art resolution (lay it over the card at box / ART_W·ART_H);
// paint() repaints it — the rating with a count-up value.
export async function cardPrint(card) {
  const [assets] = await Promise.all([loadCardAssets(card), ensureFonts()]);
  const L = lookOf(card);
  return printPieces(card, L, LAYOUT[L.family], assets).map((p) => {
    const [x, y, w, h] = p.box;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    const paint = (value) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, w, h);
      g.textBaseline = "alphabetic";
      g.setTransform(1, 0, 0, 1, -x, -y);
      p.draw(g, value);
    };
    paint();
    return { key: p.key, box: p.box, canvas, paint };
  });
}

// The player's silhouette as a mask: white, with the photo layer's alpha (soft
// cut-out edge and chest fade included; its drop shadow is NOT in it — that's
// shadow on the metal). Half resolution is plenty for a mask.
function playerMask(player) {
  const c = document.createElement("canvas");
  c.width = W / 2; c.height = H / 2;
  const g = c.getContext("2d");
  g.drawImage(player, 0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// Load + paint in one go (the art tools use this for the mystery card).
export async function paintCard(ctx, card) {
  const [assets] = await Promise.all([loadCardAssets(card), ensureFonts()]);
  drawCard(ctx, card, assets);
}

// ---- export to an <img>-able URL, cached per card --------------------------------

const _art = new Map(); // card id → Promise<{ art, bare, player }> (urls)
const MAX_CACHED = 40;

// WebP keeps the alpha at a fraction of PNG's size; a browser that can't encode
// WebP (Safari) hands back a PNG instead — alpha intact either way.
function canvasURL(c) {
  return new Promise((res) => {
    const fallback = () => res(c.toDataURL("image/png"));
    try {
      if (!c.toBlob) return fallback();
      c.toBlob((b) => (b ? res(URL.createObjectURL(b)) : fallback()), "image/webp", 0.9);
    } catch { fallback(); }
  });
}

// → { art, bare, player }: the painted card, the same card without its print (the
// reveal stamps the print on over it — cardPrint), and the player's silhouette
// (playerMask).
export function cardArt(card) {
  if (_art.has(card.id)) return _art.get(card.id);
  const pr = Promise.all([loadCardAssets(card), ensureFonts()]).then(([assets]) => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const b = document.createElement("canvas");
    b.width = W; b.height = H;
    const mask = playerMask(drawCard(c.getContext("2d"), card, assets, () => b.getContext("2d").drawImage(c, 0, 0)));
    return Promise.all([canvasURL(c), canvasURL(b), canvasURL(mask)]).then(([art, bare, player]) => ({ art, bare, player }));
  });
  _art.set(card.id, pr);
  // keep the cache bounded — drop (and revoke) the oldest renders
  if (_art.size > MAX_CACHED) {
    const [oldId, oldPr] = _art.entries().next().value;
    _art.delete(oldId);
    oldPr.then((urls) => {
      for (const u of Object.values(urls)) if (u.startsWith("blob:")) URL.revokeObjectURL(u);
    });
  }
  return pr;
}

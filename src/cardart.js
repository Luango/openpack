// cardart.js — paints a football player card (FUT-style) onto a canvas.
//
// Every card is drawn at runtime from its player data — no image downloads. The
// layout is the classic ultimate-team card: rating + position, nation flag and
// club crest down the left, the player bust, the name, and two columns of six
// face stats, all inside a crowned shield frame. Each EDITION (rarity.js) has
// its own material — brushed bronze/silver/gold metals, then the promo designs
// (black-gold Team of the Week, crimson Player of the Match, neon Future Stars,
// aqua Team of the Season, midnight-gold Team of the Year, ivory Legend).
//
// cardArt(card) renders once to a JPEG blob URL (cached per card id), so the
// reveal shows it through the same <img class="card__art"> the old card scans used —
// identical compositing, so the holo layers + Android fixes carry over untouched.

import { P, lin, rad, rgba, shade, mix, rng, font, spacedText, fitSize, grainTile, starPath, poly } from "./paint.js";
import { drawFlag, drawCrest } from "./emblems.js";
import { drawPortrait } from "./portrait.js";

export const ART_W = 756; // 63 × 12
export const ART_H = 1056; // 88 × 12 — the card's 63:88 aspect, exactly
const W = ART_W, H = ART_H;

// ---- edition materials ----------------------------------------------------
// base: light → mid → dark (diagonal), ink: main text, sub: stat labels,
// trim: the shield frame, glow: the light behind the player, dark: light-on-dark.
export const LOOKS = {
  bronze:   { base: ["#f6d2ad", "#d39462", "#8e5732"], outer: "#6b3d1e", ink: "#3a2211", sub: "#55331a", trim: "#ffe6cc", keyline: "#7a4626", glow: "#ffe2c4", sheen: 0.30, pattern: "hex" },
  silver:   { base: ["#fdfeff", "#cdd4dc", "#8c96a2"], outer: "#5f6874", ink: "#1d2530", sub: "#36404c", trim: "#ffffff", keyline: "#6d7784", glow: "#ffffff", sheen: 0.36, pattern: "hex" },
  gold:     { base: ["#fff4c8", "#edc866", "#a97c22"], outer: "#7c5813", ink: "#30210a", sub: "#4a3510", trim: "#fff8de", keyline: "#8a641b", glow: "#fff4cc", sheen: 0.40, pattern: "hex" },
  raregold: { base: ["#fff7d6", "#f5c83f", "#b27a12"], outer: "#6f4a0b", ink: "#2a1b04", sub: "#3d2906", trim: "#fffbe9", keyline: "#7a560f", glow: "#fff8d8", sheen: 0.46, pattern: "rays" },
  totw:     { base: ["#3d3d44", "#18181c", "#060607"], outer: "#020203", ink: "#f6d57d", sub: "#e6c66c", trim: "#e7c057", keyline: "#5b4514", glow: "#f3c652", sheen: 0.10, pattern: "carbon", dark: true },
  potm:     { base: ["#b0203a", "#560b1a", "#160307"], outer: "#0d0204", ink: "#ffffff", sub: "#ffd3da", trim: "#ff8da0", keyline: "#3c0712", glow: "#ff4f6a", sheen: 0.12, pattern: "streaks", dark: true },
  future:   { base: ["#5b25b0", "#26105a", "#0b0423"], outer: "#05010f", ink: "#ffffff", sub: "#ddccff", trim: "#7dffd2", keyline: "#2b0e62", glow: "#b46bff", accent: "#7dffd2", sheen: 0.10, pattern: "neon", dark: true },
  tots:     { base: ["#b4fbf2", "#2fc7ba", "#08606f"], outer: "#04414c", ink: "#03262d", sub: "#05343d", trim: "#ffffff", keyline: "#0a5662", glow: "#e9fffb", sheen: 0.30, pattern: "shards" },
  toty:     { base: ["#2f56d8", "#112777", "#040b2c"], outer: "#020618", ink: "#ffe18e", sub: "#f4d47c", trim: "#f2c54b", keyline: "#0b1b55", glow: "#6d93ff", accent: "#f2c54b", sheen: 0.14, pattern: "stars", dark: true },
  legend:   { base: ["#fffdf7", "#f2e8d0", "#cdb27c"], outer: "#8f6d2c", ink: "#36270c", sub: "#4b3711", trim: "#d1a547", keyline: "#8a6624", glow: "#fff1c8", accent: "#c99a3a", sheen: 0.34, pattern: "marble" },
};

const OUTFIELD = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
const KEEPER = ["DIV", "HAN", "KIC", "REF", "SPD", "POS"];

// The crowned shield the card sits in (the trim line). Exported so the pack and
// card-back art (tools/art) frame things in the very same silhouette.
export const SHIELD_D =
  "M30 132 L30 92 Q30 48 74 48 L254 48 Q292 48 318 30 Q346 11 378 11 Q410 11 438 30 Q464 48 502 48 L682 48 Q726 48 726 92 " +
  "L726 872 Q726 930 664 958 L424 1036 Q378 1051 332 1036 L92 958 Q30 930 30 872 Z";
const SHIELD = P(SHIELD_D);

// Head position of the bust on the card
const HEAD_X = 456, HEAD_Y = 298, HEAD_S = 2.3;

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
  const faces = sheet.then(() =>
    Promise.all(["600", "700", "800"].map((w) =>
      document.fonts?.load(`${w} 100px "Barlow Condensed"`, "AÉĆØ0123").catch(() => null)
    ))
  );
  _fonts = Promise.race([faces, new Promise((r) => setTimeout(r, timeout))]);
  return _fonts;
}

// ---- material + pattern layers -------------------------------------------------

function paintMaterial(ctx, L) {
  const [a, b, c] = L.base;
  ctx.fillStyle = lin(ctx, 0, 0, W, H, [[0, a], [0.48, b], [1, c]]);
  ctx.fillRect(0, 0, W, H);
  // brushed-metal reflections: soft diagonal bands of light
  if (L.sheen) {
    for (const [o, w, k] of [[0.18, 0.10, 1], [0.42, 0.05, 0.7], [0.63, 0.14, 0.55], [0.86, 0.06, 0.4]]) {
      ctx.fillStyle = lin(ctx, 0, H * 0.1, W, H * 0.9, [
        [Math.max(0, o - w), "rgba(255,255,255,0)"],
        [o, `rgba(255,255,255,${(L.sheen * k).toFixed(3)})`],
        [Math.min(1, o + w), "rgba(255,255,255,0)"],
      ]);
      ctx.fillRect(0, 0, W, H);
    }
  }
}

// Each pattern is clipped to the shield by the caller and fades out toward
// the stats so the text always sits on a calm field.
function paintPattern(ctx, L, seed) {
  const r = rng(seed);
  const fade = (top, bottom, col) => lin(ctx, 0, top, 0, bottom, [[0, col], [1, rgba("#ffffff", 0)]]);
  switch (L.pattern) {
    case "hex": {
      // a honeycomb mesh across the upper card
      const s = 30, hgt = s * Math.sqrt(3);
      ctx.strokeStyle = fade(40, 700, rgba(L.dark ? "#ffffff" : "#ffffff", 0.34));
      ctx.lineWidth = 2;
      const p = new Path2D();
      for (let row = -1; row < 16; row++) {
        for (let col = -1; col < 18; col++) {
          const cx = col * s * 1.5, cy = row * hgt + (col % 2 ? hgt / 2 : 0);
          for (let k = 0; k < 6; k++) {
            const a0 = (Math.PI / 3) * k, a1 = (Math.PI / 3) * (k + 1);
            p.moveTo(cx + Math.cos(a0) * s, cy + Math.sin(a0) * s);
            p.lineTo(cx + Math.cos(a1) * s, cy + Math.sin(a1) * s);
          }
        }
      }
      ctx.globalAlpha = 0.55;
      ctx.stroke(p);
      ctx.globalAlpha = 1;
      // darker lower band so the stats read
      ctx.fillStyle = lin(ctx, 0, 620, 0, H, [[0, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.12)"]]);
      ctx.fillRect(0, 600, W, H - 600);
      break;
    }
    case "rays": {
      // a sunburst from behind the player's head
      ctx.save();
      ctx.translate(HEAD_X, HEAD_Y - 30);
      for (let i = 0; i < 36; i++) {
        const a0 = (i / 36) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / 72;
        ctx.fillStyle = rad(ctx, 0, 0, 900, [[0, "rgba(255,255,255,0.5)"], [0.6, "rgba(255,255,255,0.12)"], [1, "rgba(255,255,255,0)"]]);
        ctx.fill(poly([[0, 0], [Math.cos(a0) * 1000, Math.sin(a0) * 1000], [Math.cos(a1) * 1000, Math.sin(a1) * 1000]]));
      }
      ctx.restore();
      // fine engraved pinstripes in the top corners
      ctx.strokeStyle = rgba("#7a5208", 0.18);
      ctx.lineWidth = 2;
      for (let i = -20; i < 40; i++) {
        ctx.beginPath(); ctx.moveTo(i * 22, 0); ctx.lineTo(i * 22 + 300, 300); ctx.stroke();
      }
      ctx.fillStyle = lin(ctx, 0, 600, 0, H, [[0, "rgba(255,240,200,0)"], [1, "rgba(120,80,10,0.18)"]]);
      ctx.fillRect(0, 600, W, H - 600);
      break;
    }
    case "carbon": {
      // a carbon-fibre weave, then bold gold angles
      const t = 10;
      for (let y = 0; y < H; y += t) {
        for (let x = 0; x < W; x += t) {
          const on = ((x / t) + (y / t)) % 2 === 0;
          ctx.fillStyle = on ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.25)";
          ctx.fillRect(x, y, t, t);
        }
      }
      ctx.fillStyle = lin(ctx, 0, 0, W, 0, [[0, rgba(L.trim, 0)], [0.5, rgba(L.trim, 0.32)], [1, rgba(L.trim, 0)]]);
      ctx.fill(poly([[0, 760], [W, 330], [W, 370], [0, 800]]));
      ctx.fill(poly([[0, 610], [W, 190], [W, 205], [0, 625]]));
      ctx.strokeStyle = rgba(L.trim, 0.5);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(70, 140); ctx.lineTo(220, 60); ctx.lineTo(W - 70, 60); ctx.stroke();
      ctx.fillStyle = rad(ctx, HEAD_X, HEAD_Y, 420, [[0, rgba(L.glow, 0.42)], [0.6, rgba(L.glow, 0.08)], [1, rgba(L.glow, 0)]]);
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "streaks": {
      // speed streaks rising to the top right
      for (let i = 0; i < 26; i++) {
        const x = r.range(-300, W), y = r.range(100, H + 200), len = r.range(260, 700), wdt = r.range(3, 16);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-0.62);
        ctx.fillStyle = lin(ctx, 0, 0, len, 0, [[0, "rgba(255,255,255,0)"], [0.7, rgba(r() < 0.5 ? "#ff8da0" : "#ffffff", r.range(0.08, 0.26))], [1, "rgba(255,255,255,0)"]]);
        ctx.fillRect(0, -wdt / 2, len, wdt);
        ctx.restore();
      }
      ctx.fillStyle = rad(ctx, HEAD_X, HEAD_Y, 440, [[0, rgba("#ff6b81", 0.55)], [0.55, rgba("#ff2e4f", 0.12)], [1, rgba("#ff2e4f", 0)]]);
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "neon": {
      ctx.fillStyle = rad(ctx, HEAD_X, HEAD_Y, 470, [[0, rgba("#c38bff", 0.6)], [0.5, rgba("#7b3cff", 0.16)], [1, rgba("#7b3cff", 0)]]);
      ctx.fillRect(0, 0, W, H);
      // glowing energy ribbons
      ctx.save();
      ctx.lineCap = "round";
      for (const [col, wdt, y0, amp, ph] of [[L.accent, 5, 260, 120, 0.4], ["#c49bff", 3, 420, 90, 2.1], [L.accent, 2.5, 160, 70, 3.6], ["#ffffff", 1.6, 520, 60, 1.2]]) {
        ctx.strokeStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 22;
        ctx.lineWidth = wdt;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        for (let x = -40; x <= W + 40; x += 12) {
          const y = y0 + Math.sin(x / 140 + ph) * amp * 0.5 - (x / W) * 140;
          x === -40 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = rgba(r() < 0.5 ? L.accent : "#ffffff", r.range(0.25, 0.85));
        const s = r.range(1, 3);
        ctx.beginPath(); ctx.arc(r.range(40, W - 40), r.range(60, 640), s, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case "shards": {
      // low-poly crystal shards
      const cols = 7, rows = 9, cw = W / (cols - 1), rh = 700 / (rows - 1);
      const pts = [];
      for (let j = 0; j < rows; j++) {
        pts.push([]);
        for (let i = 0; i < cols; i++) pts[j].push([i * cw + (i && i < cols - 1 ? r.range(-cw, cw) * 0.35 : 0), j * rh + (j && j < rows - 1 ? r.range(-rh, rh) * 0.35 : 0)]);
      }
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i], d = pts[j + 1][i + 1];
          for (const tri of [[a, b, d], [a, d, c]]) {
            const k = r.range(-0.18, 0.28);
            ctx.fillStyle = k > 0 ? rgba("#ffffff", k * (1 - j / rows)) : rgba("#003d48", -k * (1 - j / rows));
            ctx.fill(poly(tri));
          }
        }
      }
      ctx.fillStyle = rad(ctx, HEAD_X, HEAD_Y, 400, [[0, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]]);
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "stars": {
      ctx.fillStyle = rad(ctx, HEAD_X, HEAD_Y - 20, 480, [[0, rgba("#7fa2ff", 0.55)], [0.5, rgba("#3c62e6", 0.14)], [1, rgba("#3c62e6", 0)]]);
      ctx.fillRect(0, 0, W, H);
      // a great faint star behind the player
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = L.accent;
      ctx.fill(starPath(HEAD_X, HEAD_Y + 10, 330, 5, 0.42));
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = rgba(L.accent, 0.5);
      ctx.lineWidth = 2;
      ctx.stroke(starPath(HEAD_X, HEAD_Y + 10, 330, 5, 0.42));
      ctx.restore();
      // a field of gold + white stars
      for (let i = 0; i < 120; i++) {
        const x = r.range(30, W - 30), y = r.range(40, 700), s = r.range(0.8, 2.6);
        ctx.fillStyle = rgba(r() < 0.35 ? L.accent : "#ffffff", r.range(0.3, 0.9) * (1 - y / 900));
        if (s > 2.2) ctx.fill(starPath(x, y, s * 2.2, 4, 0.3));
        else { ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill(); }
      }
      break;
    }
    case "marble": {
      // ivory marble veins + gold filigree
      ctx.lineCap = "round";
      for (let i = 0; i < 14; i++) {
        ctx.strokeStyle = rgba(r() < 0.3 ? "#c9a24e" : "#9c8f7a", r.range(0.08, 0.22));
        ctx.lineWidth = r.range(0.8, 3.4);
        let x = r.range(-100, W), y = r.range(0, H);
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          const nx = x + r.range(60, 160), ny = y + r.range(-120, 120);
          ctx.quadraticCurveTo(x + r.range(-40, 80), y + r.range(-90, 90), nx, ny);
          x = nx; y = ny;
        }
        ctx.stroke();
      }
      ctx.fillStyle = rad(ctx, HEAD_X, HEAD_Y, 420, [[0, "rgba(255,248,225,0.95)"], [0.6, "rgba(255,240,200,0.25)"], [1, "rgba(255,240,200,0)"]]);
      ctx.fillRect(0, 0, W, H);
      // filigree arcs crowning the player
      ctx.strokeStyle = rgba(L.accent, 0.55);
      for (const [rr, lw] of [[300, 3], [318, 1.4], [344, 1]]) {
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(HEAD_X, HEAD_Y + 60, rr, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
      }
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (1.08 + (0.84 * i) / 8);
        ctx.fillStyle = rgba(L.accent, 0.7);
        ctx.fill(starPath(HEAD_X + Math.cos(a) * 309, HEAD_Y + 60 + Math.sin(a) * 309, i % 2 ? 6 : 10, 4, 0.35));
      }
      break;
    }
    default:
  }
}

// ---- the bust ------------------------------------------------------------------

// Portrait on its own layer: rim-lit (on dark editions), faded out at the chest
// so it melts behind the name, then dropped onto the card with a soft shadow. A
// MYSTERY card (card.mystery — the pack art, the offline fallback) keeps only the
// bust's silhouette, so the player is a shape in the light, not a face.
let _pc = null;
function portraitLayer(card, L) {
  const c = _pc || (_pc = document.createElement("canvas"));
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.clearRect(0, 0, W, H);
  drawPortrait(g, card.look, card.kit, HEAD_X, HEAD_Y, HEAD_S);
  if (card.mystery) {
    g.save();
    g.globalCompositeOperation = "source-in";
    g.fillStyle = lin(g, 0, 60, 0, 700, [[0, shade(L.outer, -0.15)], [1, shade(L.outer, -0.45)]]);
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  // rim light: the silhouette's upper-left edge, in the edition glow
  const rim = document.createElement("canvas");
  rim.width = W; rim.height = H;
  const rg = rim.getContext("2d");
  rg.drawImage(c, 0, 0);
  rg.globalCompositeOperation = "source-in";
  rg.fillStyle = L.dark ? L.glow : "#ffffff";
  rg.fillRect(0, 0, W, H);
  rg.globalCompositeOperation = "destination-out";
  if (L.dark) rg.drawImage(c, 6, 5);
  else rg.drawImage(c, 4, 3);
  g.save();
  g.globalAlpha = L.dark ? 0.9 : 0.32;
  g.globalCompositeOperation = "source-atop";
  g.drawImage(rim, 0, 0);
  g.restore();

  // fade the chest into the card
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = lin(g, 0, 520, 0, 700, [[0, "rgba(0,0,0,1)"], [0.55, "rgba(0,0,0,0.55)"], [1, "rgba(0,0,0,0)"]]);
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over";
  return c;
}

// ---- text ----------------------------------------------------------------------

function engraved(ctx, L, fn) {
  ctx.save();
  if (L.dark) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
  } else {
    ctx.shadowColor = "rgba(255,255,255,0.55)";
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
  ctx.fillStyle = L.base[0];
  ctx.font = font(800, h * 0.72);
  ctx.textAlign = "center";
  ctx.fillText("?", x + w / 2, y + h * 0.78);
  ctx.restore();
}

// ---- the whole card --------------------------------------------------------------

export function drawCard(ctx, card) {
  const key = card.edition || "gold";
  const L = LOOKS[key] || LOOKS.gold;
  const seed = card.seed ?? 1;
  ctx.save();
  ctx.textBaseline = "alphabetic";

  // 1 — the card stock outside the shield
  ctx.fillStyle = L.outer;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.55;
  paintMaterial(ctx, L);
  ctx.restore();
  ctx.fillStyle = rgba(L.outer, 0.45);
  ctx.fillRect(0, 0, W, H);

  // 2 — the shield: material, pattern, light
  ctx.save();
  ctx.clip(SHIELD);
  paintMaterial(ctx, L);
  paintPattern(ctx, L, seed);
  if (!L.dark) {
    ctx.fillStyle = rad(ctx, HEAD_X, HEAD_Y - 10, 360, [[0, rgba(L.glow, 0.75)], [0.55, rgba(L.glow, 0.2)], [1, rgba(L.glow, 0)]]);
    ctx.fillRect(0, 0, W, H);
  }

  // 3 — the player
  const pl = portraitLayer(card, L);
  ctx.save();
  ctx.shadowColor = L.dark ? "rgba(0,0,0,0.6)" : "rgba(40,20,0,0.32)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.drawImage(pl, 0, 0);
  ctx.restore();

  // calm the field under the stats
  ctx.fillStyle = lin(ctx, 0, 640, 0, H, L.dark
    ? [[0, "rgba(0,0,0,0)"], [0.3, "rgba(0,0,0,0.28)"], [1, "rgba(0,0,0,0.5)"]]
    : [[0, rgba(L.base[0], 0)], [0.25, rgba(L.base[1], 0.35)], [1, rgba(L.base[1], 0.15)]]);
  ctx.fillRect(0, 640, W, H - 640);

  // print grain
  ctx.save();
  ctx.globalAlpha = L.dark ? 0.05 : 0.07;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(grainTile(), "repeat");
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.restore(); // shield clip

  // 4 — the frame: a bright trim with an inner keyline, and (promos) a glow
  ctx.save();
  if (L.dark) { ctx.shadowColor = rgba(L.glow, 0.9); ctx.shadowBlur = 18; }
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = key === "toty" || key === "legend" || key === "totw"
    ? lin(ctx, 0, 0, W, H, [[0, shade(L.trim, 0.45)], [0.35, L.trim], [0.6, shade(L.trim, -0.25)], [1, shade(L.trim, 0.3)]])
    : L.trim;
  ctx.stroke(SHIELD);
  ctx.restore();
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(0.972, 0.978);
  ctx.translate(-W / 2, -H / 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(L.dark ? L.trim : L.keyline, 0.55);
  ctx.stroke(SHIELD);
  ctx.restore();

  // 5 — rating, position, flag, crest
  const colX = 150;
  engraved(ctx, L, () => {
    ctx.fillStyle = L.ink;
    ctx.font = font(800, 172);
    spacedText(ctx, String(card.ovr), colX, 252, -4, "center");
    ctx.font = font(700, 66);
    spacedText(ctx, card.pos, colX, 326, 2, "center");
  });
  divider(ctx, L, colX - 46, 352, colX + 46, 352);
  if (card.mystery) mysteryBadge(ctx, L, colX - 48, 372, 96, 64, 12);
  else drawFlag(ctx, card.nation, colX - 48, 372, 96, 64);
  divider(ctx, L, colX - 46, 460, colX + 46, 460);
  if (card.mystery) mysteryBadge(ctx, L, colX - 46, 482, 92, 104, 46);
  else drawCrest(ctx, card.club, colX, 534, 108);

  // 6 — the name
  const name = (card.display || card.name).toUpperCase();
  const size = fitSize(ctx, name, 800, 86, 560, 3, 40);
  engraved(ctx, L, () => {
    ctx.fillStyle = L.ink;
    ctx.font = font(800, size);
    spacedText(ctx, name, W / 2, 728, 3, "center");
  });
  divider(ctx, L, 118, 760, W - 118, 760, 0.42);

  // 7 — the six face stats
  const labels = card.pos === "GK" ? KEEPER : OUTFIELD;
  const cols = [[258, 0], [524, 3]];
  engraved(ctx, L, () => {
    for (const [x, off] of cols) {
      for (let row = 0; row < 3; row++) {
        const y = 824 + row * 60;
        ctx.fillStyle = L.ink;
        ctx.font = font(800, 60);
        spacedText(ctx, String(card.stats[off + row]), x - 10, y, 0, "right");
        ctx.fillStyle = L.sub;
        ctx.font = font(600, 50);
        spacedText(ctx, labels[off + row], x + 4, y, 1.5, "left");
      }
    }
  });
  divider(ctx, L, W / 2 - 4, 784, W / 2 - 4, 940, 0.3);

  // 8 — the edition mark in the shield's point
  const mark = card.markLabel;
  if (mark) {
    ctx.save();
    ctx.font = font(700, 26);
    const tw = ctx.measureText(mark).width + mark.length * 4 + 40;
    const px = W / 2 - tw / 2, py = 964;
    ctx.fillStyle = L.dark ? rgba(L.trim, 0.95) : rgba(L.ink, 0.88);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(px, py, tw, 36, 18) : ctx.rect(px, py, tw, 36);
    ctx.fill();
    ctx.fillStyle = L.dark ? L.outer : L.base[0];
    spacedText(ctx, mark, W / 2, py + 27, 4, "center");
    ctx.restore();
  } else {
    // base cards: a small diamond ornament
    ctx.fillStyle = rgba(L.ink, 0.5);
    ctx.fill(poly([[W / 2, 970], [W / 2 + 11, 983], [W / 2, 996], [W / 2 - 11, 983]]));
  }

  // 9 — a whisper of bevel on the card's outer edge
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  ctx.restore();
}

// ---- export to an <img>-able URL, cached per card --------------------------------

const _art = new Map(); // card id → Promise<url>
const MAX_CACHED = 40;

function canvasURL(c) {
  return new Promise((res) => {
    const fallback = () => res(c.toDataURL("image/jpeg", 0.92));
    try {
      if (!c.toBlob) return fallback();
      c.toBlob((b) => (b ? res(URL.createObjectURL(b)) : fallback()), "image/jpeg", 0.92);
    } catch { fallback(); }
  });
}

export function cardArt(card) {
  if (_art.has(card.id)) return _art.get(card.id);
  const pr = ensureFonts().then(() => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    drawCard(c.getContext("2d"), card);
    return canvasURL(c);
  });
  _art.set(card.id, pr);
  // keep the cache bounded — drop (and revoke) the oldest renders
  if (_art.size > MAX_CACHED) {
    const [oldId, oldPr] = _art.entries().next().value;
    _art.delete(oldId);
    oldPr.then((u) => { if (u.startsWith("blob:")) URL.revokeObjectURL(u); });
  }
  return pr;
}

// emblems.js — nation flags + club badges, drawn on canvas.
//
// Flags are the real national flags (public symbols), simplified only where a
// full coat of arms would be mush at card size. Club badges are deliberately NOT
// the clubs' crests (those are trademarks): each is composed from a shape, a
// field pattern and the club's colours, carrying its initials as a monogram (or,
// for the in-house Legends side, an emblem glyph) — so none borrows a real badge.

import { P, poly, starPath, roundRect, lin, rgba, shade, font, spacedText } from "./paint.js";

// ============================================================================
//  FLAGS — every flag is drawn into the same 3:2 box, the way a card shows it
// ============================================================================

function hb(c, x, y, w, h, cols, weights = cols.map(() => 1)) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let yy = y;
  cols.forEach((col, i) => {
    const hh = (h * weights[i]) / sum;
    c.fillStyle = col;
    c.fillRect(x, yy, w, hh + 0.5);
    yy += hh;
  });
}

function vb(c, x, y, w, h, cols, weights = cols.map(() => 1)) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let xx = x;
  cols.forEach((col, i) => {
    const ww = (w * weights[i]) / sum;
    c.fillStyle = col;
    c.fillRect(xx, y, ww + 0.5, h);
    xx += ww;
  });
}

// Nordic cross: hoist/cross/fly widths and top/cross/bottom heights (flag units)
function nordic(c, x, y, w, h, bg, cross, wx, wy, inner, iw) {
  c.fillStyle = bg;
  c.fillRect(x, y, w, h);
  const sx = w / (wx[0] + wx[1] + wx[2]);
  const sy = h / (wy[0] + wy[1] + wy[2]);
  c.fillStyle = cross;
  c.fillRect(x + wx[0] * sx, y, wx[1] * sx, h);
  c.fillRect(x, y + wy[0] * sy, w, wy[1] * sy);
  if (inner) {
    // a narrower inner cross centred in the outer one (Norway)
    const cxm = x + (wx[0] + wx[1] / 2) * sx, cym = y + (wy[0] + wy[1] / 2) * sy;
    c.fillStyle = inner;
    c.fillRect(cxm - (iw * sx) / 2, y, iw * sx, h);
    c.fillRect(x, cym - (iw * sy) / 2, w, iw * sy);
  }
}

function crescentStar(c, cx, cy, r, col, bg, starR, starDx) {
  c.fillStyle = col;
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = bg;
  c.beginPath(); c.arc(cx + r * 0.25, cy, r * 0.8, 0, Math.PI * 2); c.fill();
  c.fillStyle = col;
  c.fill(starPath(cx + starDx, cy, starR, 5, 0.382, Math.PI));
}

function sun(c, cx, cy, r, col, rays = 16) {
  c.fillStyle = col;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const a1 = a - 0.09, a2 = a + 0.09;
    c.fill(poly([
      [cx + Math.cos(a1) * r * 0.9, cy + Math.sin(a1) * r * 0.9],
      [cx + Math.cos(a) * r * 1.7, cy + Math.sin(a) * r * 1.7],
      [cx + Math.cos(a2) * r * 0.9, cy + Math.sin(a2) * r * 0.9],
    ]));
  }
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
}

const MAPLE = [
  [0, -0.5], [0.075, -0.36], [0.17, -0.41], [0.14, -0.15], [0.31, -0.31], [0.35, -0.21],
  [0.48, -0.25], [0.42, -0.07], [0.48, -0.01], [0.24, 0.17], [0.27, 0.27], [0.03, 0.235],
  [0.03, 0.5], [-0.03, 0.5], [-0.03, 0.235], [-0.27, 0.27], [-0.24, 0.17], [-0.48, -0.01],
  [-0.42, -0.07], [-0.48, -0.25], [-0.35, -0.21], [-0.31, -0.31], [-0.14, -0.15], [-0.17, -0.41],
  [-0.075, -0.36],
];

export const NATIONS = {
  FRA: { name: "France", draw: (c, x, y, w, h) => vb(c, x, y, w, h, ["#0055a4", "#ffffff", "#ef4135"]) },
  ITA: { name: "Italy", draw: (c, x, y, w, h) => vb(c, x, y, w, h, ["#009246", "#ffffff", "#ce2b37"]) },
  GER: { name: "Germany", draw: (c, x, y, w, h) => hb(c, x, y, w, h, ["#000000", "#dd0000", "#ffce00"]) },
  BEL: { name: "Belgium", draw: (c, x, y, w, h) => vb(c, x, y, w, h, ["#000000", "#fdda24", "#ef3340"]) },
  NED: { name: "Netherlands", draw: (c, x, y, w, h) => hb(c, x, y, w, h, ["#ae1c28", "#ffffff", "#21468b"]) },
  IRL: { name: "Ireland", draw: (c, x, y, w, h) => vb(c, x, y, w, h, ["#169b62", "#ffffff", "#ff883e"]) },
  NGA: { name: "Nigeria", draw: (c, x, y, w, h) => vb(c, x, y, w, h, ["#008751", "#ffffff", "#008751"]) },
  CIV: { name: "Côte d'Ivoire", draw: (c, x, y, w, h) => vb(c, x, y, w, h, ["#f77f00", "#ffffff", "#009e60"]) },
  PER: { name: "Peru", draw: (c, x, y, w, h) => vb(c, x, y, w, h, ["#d91023", "#ffffff", "#d91023"]) },
  AUT: { name: "Austria", draw: (c, x, y, w, h) => hb(c, x, y, w, h, ["#ed2939", "#ffffff", "#ed2939"]) },
  HUN: { name: "Hungary", draw: (c, x, y, w, h) => hb(c, x, y, w, h, ["#ce2939", "#ffffff", "#477050"]) },
  POL: { name: "Poland", draw: (c, x, y, w, h) => hb(c, x, y, w, h, ["#ffffff", "#dc143c"]) },
  UKR: { name: "Ukraine", draw: (c, x, y, w, h) => hb(c, x, y, w, h, ["#0057b7", "#ffd700"]) },
  COL: { name: "Colombia", draw: (c, x, y, w, h) => hb(c, x, y, w, h, ["#fcd116", "#003893", "#ce1126"], [2, 1, 1]) },
  ESP: { name: "Spain", draw: (c, x, y, w, h) => hb(c, x, y, w, h, ["#aa151b", "#f1bf00", "#aa151b"], [1, 2, 1]) },
  POR: {
    name: "Portugal",
    draw(c, x, y, w, h) {
      vb(c, x, y, w, h, ["#006600", "#ff0000"], [2, 3]);
      const cx = x + w * 0.4, cy = y + h / 2, r = h * 0.26;
      c.strokeStyle = "#ffe000"; c.lineWidth = h * 0.06;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#ffffff"; c.fill(roundRect(cx - r * 0.5, cy - r * 0.55, r, r * 1.15, r * 0.35));
      c.fillStyle = "#003399"; c.fill(roundRect(cx - r * 0.24, cy - r * 0.3, r * 0.48, r * 0.62, r * 0.12));
    },
  },
  BRA: {
    name: "Brazil",
    draw(c, x, y, w, h) {
      c.fillStyle = "#009c3b"; c.fillRect(x, y, w, h);
      c.fillStyle = "#ffdf00";
      c.fill(poly([[x + w * 0.085, y + h / 2], [x + w / 2, y + h * 0.12], [x + w * 0.915, y + h / 2], [x + w / 2, y + h * 0.88]]));
      const cx = x + w / 2, cy = y + h / 2, r = h * 0.25;
      c.save();
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fillStyle = "#002776"; c.fill(); c.clip();
      // the motto band: the gap between two arcs centred below-left of the globe
      const bx = cx - r * 0.571, by = cy + r * 2;
      c.beginPath();
      c.arc(bx, by, r * 2.43, 0, Math.PI * 2);
      c.arc(bx, by, r * 2.286, 0, Math.PI * 2, true);
      c.fillStyle = "#ffffff"; c.fill("evenodd");
      c.fillStyle = "#ffffff";
      for (const [dx, dy] of [[0.1, 0.45], [-0.3, 0.6], [0.45, 0.35], [-0.5, 0.25], [0.25, 0.7]]) {
        c.beginPath(); c.arc(cx + dx * r, cy + dy * r, r * 0.05, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    },
  },
  ARG: {
    name: "Argentina",
    draw(c, x, y, w, h) {
      hb(c, x, y, w, h, ["#74acdf", "#ffffff", "#74acdf"]);
      sun(c, x + w / 2, y + h / 2, h * 0.085, "#f6b40e");
    },
  },
  URU: {
    name: "Uruguay",
    draw(c, x, y, w, h) {
      hb(c, x, y, w, h, ["#ffffff", "#0038a8", "#ffffff", "#0038a8", "#ffffff", "#0038a8", "#ffffff", "#0038a8", "#ffffff"]);
      const s = (h * 5) / 9;
      c.fillStyle = "#ffffff"; c.fillRect(x, y, s, s);
      sun(c, x + s / 2, y + s / 2, s * 0.17, "#fcd116");
    },
  },
  MEX: {
    name: "Mexico",
    draw(c, x, y, w, h) {
      vb(c, x, y, w, h, ["#006847", "#ffffff", "#ce1126"]);
      const cx = x + w / 2, cy = y + h / 2;
      c.strokeStyle = "#5c8a3a"; c.lineWidth = h * 0.04;
      c.beginPath(); c.arc(cx, cy + h * 0.02, h * 0.16, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
      c.fillStyle = "#8a5a2b";
      c.beginPath(); c.ellipse(cx, cy - h * 0.02, h * 0.09, h * 0.12, 0, 0, Math.PI * 2); c.fill();
    },
  },
  USA: {
    name: "United States",
    draw(c, x, y, w, h) {
      const cols = [];
      for (let i = 0; i < 13; i++) cols.push(i % 2 ? "#ffffff" : "#b22234");
      hb(c, x, y, w, h, cols);
      const cw = w * 0.42, ch = (h * 7) / 13;
      c.fillStyle = "#3c3b6e"; c.fillRect(x, y, cw, ch);
      c.fillStyle = "#ffffff";
      for (let r = 0; r < 9; r++) {
        const n = r % 2 ? 5 : 6;
        for (let k = 0; k < n; k++) {
          const sx = x + (cw / 12) * (r % 2 ? 2 + k * 2 : 1 + k * 2);
          const sy = y + (ch / 10) * (r + 1);
          c.beginPath(); c.arc(sx, sy, h * 0.012, 0, Math.PI * 2); c.fill();
        }
      }
    },
  },
  CAN: {
    name: "Canada",
    draw(c, x, y, w, h) {
      vb(c, x, y, w, h, ["#d52b1e", "#ffffff", "#d52b1e"], [1, 2, 1]);
      const cx = x + w / 2, cy = y + h / 2, s = h * 0.62;
      c.fillStyle = "#d52b1e";
      c.fill(poly(MAPLE.map(([px, py]) => [cx + px * s, cy + py * s])));
    },
  },
  ENG: {
    name: "England",
    draw(c, x, y, w, h) {
      c.fillStyle = "#ffffff"; c.fillRect(x, y, w, h);
      c.fillStyle = "#ce1124";
      const t = h * 0.2;
      c.fillRect(x + w / 2 - t / 2, y, t, h);
      c.fillRect(x, y + h / 2 - t / 2, w, t);
    },
  },
  SCO: {
    name: "Scotland",
    draw(c, x, y, w, h) {
      c.fillStyle = "#005eb8"; c.fillRect(x, y, w, h);
      c.strokeStyle = "#ffffff"; c.lineWidth = h * 0.2;
      c.beginPath();
      c.moveTo(x, y); c.lineTo(x + w, y + h);
      c.moveTo(x + w, y); c.lineTo(x, y + h);
      c.stroke();
    },
  },
  DEN: { name: "Denmark", draw: (c, x, y, w, h) => nordic(c, x, y, w, h, "#c8102e", "#ffffff", [12, 4, 21], [12, 4, 12]) },
  SWE: { name: "Sweden", draw: (c, x, y, w, h) => nordic(c, x, y, w, h, "#006aa7", "#fecc00", [5, 2, 9], [4, 2, 4]) },
  NOR: { name: "Norway", draw: (c, x, y, w, h) => nordic(c, x, y, w, h, "#ba0c2f", "#ffffff", [6, 4, 12], [6, 4, 6], "#00205b", 2) },
  FIN: { name: "Finland", draw: (c, x, y, w, h) => nordic(c, x, y, w, h, "#ffffff", "#003580", [5, 3, 10], [4, 3, 4]) },
  SUI: {
    name: "Switzerland",
    draw(c, x, y, w, h) {
      c.fillStyle = "#da291c"; c.fillRect(x, y, w, h);
      const cx = x + w / 2, cy = y + h / 2, a = h * 0.3, t = h * 0.19;
      c.fillStyle = "#ffffff";
      c.fillRect(cx - t / 2, cy - a, t, a * 2);
      c.fillRect(cx - a, cy - t / 2, a * 2, t);
    },
  },
  JPN: {
    name: "Japan",
    draw(c, x, y, w, h) {
      c.fillStyle = "#ffffff"; c.fillRect(x, y, w, h);
      c.fillStyle = "#bc002d";
      c.beginPath(); c.arc(x + w / 2, y + h / 2, h * 0.3, 0, Math.PI * 2); c.fill();
    },
  },
  KOR: {
    name: "South Korea",
    draw(c, x, y, w, h) {
      c.fillStyle = "#ffffff"; c.fillRect(x, y, w, h);
      const cx = x + w / 2, cy = y + h / 2, r = h * 0.25;
      const tilt = Math.atan2(h, w);
      c.save();
      c.translate(cx, cy); c.rotate(tilt);
      c.fillStyle = "#0047a0"; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#cd2e3a"; c.beginPath(); c.arc(0, 0, r, Math.PI, 0); c.fill();
      c.beginPath(); c.arc(-r / 2, 0, r / 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#0047a0"; c.beginPath(); c.arc(r / 2, 0, r / 2, 0, Math.PI * 2); c.fill();
      c.restore();
      // the four trigrams, as solid / broken bars at the diagonals
      const tri = [[-1, -1, [1, 1, 1]], [1, 1, [0, 0, 0]], [1, -1, [0, 1, 0]], [-1, 1, [1, 0, 1]]];
      c.fillStyle = "#000000";
      for (const [sx, sy, bars] of tri) {
        c.save();
        c.translate(cx + sx * r * 1.9, cy + sy * r * 1.45);
        c.rotate(Math.atan2(sy * h, sx * w) + Math.PI / 2);
        const bw = r * 0.85, bh = r * 0.16;
        bars.forEach((solid, i) => {
          const yy = (i - 1) * bh * 1.6 - bh / 2;
          if (solid) c.fillRect(-bw / 2, yy, bw, bh);
          else { c.fillRect(-bw / 2, yy, bw * 0.44, bh); c.fillRect(bw * 0.06, yy, bw * 0.44, bh); }
        });
        c.restore();
      }
    },
  },
  MAR: {
    name: "Morocco",
    draw(c, x, y, w, h) {
      c.fillStyle = "#c1272d"; c.fillRect(x, y, w, h);
      const cx = x + w / 2, cy = y + h / 2, r = h * 0.24;
      const pts = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      c.strokeStyle = "#006233"; c.lineWidth = h * 0.045; c.lineJoin = "miter";
      c.stroke(poly(pts));
    },
  },
  SEN: {
    name: "Senegal",
    draw(c, x, y, w, h) {
      vb(c, x, y, w, h, ["#00853f", "#fdef42", "#e31b23"]);
      c.fillStyle = "#00853f"; c.fill(starPath(x + w / 2, y + h / 2, h * 0.17));
    },
  },
  GHA: {
    name: "Ghana",
    draw(c, x, y, w, h) {
      hb(c, x, y, w, h, ["#ce1126", "#fcd116", "#006b3f"]);
      c.fillStyle = "#000000"; c.fill(starPath(x + w / 2, y + h / 2, h * 0.16));
    },
  },
  CMR: {
    name: "Cameroon",
    draw(c, x, y, w, h) {
      vb(c, x, y, w, h, ["#007a5e", "#ce1126", "#fcd116"]);
      c.fillStyle = "#fcd116"; c.fill(starPath(x + w / 2, y + h / 2, h * 0.15));
    },
  },
  CRO: {
    name: "Croatia",
    draw(c, x, y, w, h) {
      hb(c, x, y, w, h, ["#ff0000", "#ffffff", "#171796"]);
      const sw = h * 0.36, sh = h * 0.44, sx = x + w / 2 - sw / 2, sy = y + h * 0.3;
      const shield = new Path2D(`M${sx} ${sy} H${sx + sw} V${sy + sh * 0.55} Q${sx + sw} ${sy + sh} ${sx + sw / 2} ${sy + sh} Q${sx} ${sy + sh} ${sx} ${sy + sh * 0.55} Z`);
      c.save(); c.clip(shield);
      const n = 5, q = sw / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < 6; j++) {
        c.fillStyle = (i + j) % 2 ? "#ffffff" : "#ff0000";
        c.fillRect(sx + i * q, sy + j * q, q + 0.4, q + 0.4);
      }
      c.restore();
    },
  },
  TUR: {
    name: "Türkiye",
    draw(c, x, y, w, h) {
      c.fillStyle = "#e30a17"; c.fillRect(x, y, w, h);
      crescentStar(c, x + w * 0.38, y + h / 2, h * 0.25, "#ffffff", "#e30a17", h * 0.12, h * 0.31);
    },
  },
  ALG: {
    name: "Algeria",
    draw(c, x, y, w, h) {
      vb(c, x, y, w, h, ["#006233", "#ffffff"]);
      crescentStar(c, x + w * 0.5, y + h / 2, h * 0.24, "#d21034", "#ffffff", h * 0.1, h * 0.13);
      // the crescent's inner disc straddles both halves — repaint the green half under it
      c.save();
      c.beginPath(); c.rect(x, y, w / 2, h); c.clip();
      c.fillStyle = "#006233";
      c.beginPath(); c.arc(x + w * 0.5 + h * 0.06, y + h / 2, h * 0.192, 0, Math.PI * 2); c.fill();
      c.restore();
    },
  },
  EGY: {
    name: "Egypt",
    draw(c, x, y, w, h) {
      hb(c, x, y, w, h, ["#ce1126", "#ffffff", "#000000"]);
      const cx = x + w / 2, cy = y + h / 2;
      c.fillStyle = "#c09300";
      c.fill(poly([[cx, cy - h * 0.13], [cx + h * 0.09, cy - h * 0.04], [cx + h * 0.07, cy + h * 0.12], [cx - h * 0.07, cy + h * 0.12], [cx - h * 0.09, cy - h * 0.04]]));
    },
  },
  CHI: {
    name: "Chile",
    draw(c, x, y, w, h) {
      hb(c, x, y, w, h, ["#ffffff", "#d52b1e"]);
      c.fillStyle = "#0039a6"; c.fillRect(x, y, h / 2, h / 2);
      c.fillStyle = "#ffffff"; c.fill(starPath(x + h / 4, y + h / 4, h * 0.13));
    },
  },
  JAM: {
    name: "Jamaica",
    draw(c, x, y, w, h) {
      c.fillStyle = "#009b3a"; c.fillRect(x, y, w, h);
      c.fillStyle = "#000000";
      c.fill(poly([[x, y], [x + w / 2, y + h / 2], [x, y + h]]));
      c.fill(poly([[x + w, y], [x + w / 2, y + h / 2], [x + w, y + h]]));
      c.strokeStyle = "#fed100"; c.lineWidth = h * 0.16;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y + h); c.moveTo(x + w, y); c.lineTo(x, y + h); c.stroke();
    },
  },
  CZE: {
    name: "Czechia",
    draw(c, x, y, w, h) {
      hb(c, x, y, w, h, ["#ffffff", "#d7141a"]);
      c.fillStyle = "#11457e"; c.fill(poly([[x, y], [x + w / 2, y + h / 2], [x, y + h]]));
    },
  },
  GRE: {
    name: "Greece",
    draw(c, x, y, w, h) {
      const cols = [];
      for (let i = 0; i < 9; i++) cols.push(i % 2 ? "#ffffff" : "#0d5eaf");
      hb(c, x, y, w, h, cols);
      const s = (h * 5) / 9;
      c.fillStyle = "#0d5eaf"; c.fillRect(x, y, s, s);
      c.fillStyle = "#ffffff";
      const t = h / 9;
      c.fillRect(x + s / 2 - t / 2, y, t, s);
      c.fillRect(x, y + s / 2 - t / 2, s, t);
    },
  },
};

// Draw a nation's flag into a box, with a crisp hairline border and a whisper of
// fabric shading so it sits on the card like a printed patch, not a flat swatch.
export function drawFlag(ctx, code, x, y, w, h, { radius = h * 0.08, border = true } = {}) {
  const n = NATIONS[code];
  ctx.save();
  const clip = roundRect(x, y, w, h, radius);
  ctx.clip(clip);
  if (n) n.draw(ctx, x, y, w, h);
  else { ctx.fillStyle = "#888"; ctx.fillRect(x, y, w, h); }
  // soft top-left light, bottom-right shade
  ctx.fillStyle = lin(ctx, x, y, x + w, y + h, [[0, "rgba(255,255,255,0.18)"], [0.5, "rgba(255,255,255,0)"], [1, "rgba(0,0,0,0.16)"]]);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  if (border) {
    ctx.save();
    ctx.lineWidth = Math.max(1, h * 0.035);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.stroke(clip);
    ctx.restore();
  }
}

// ============================================================================
//  CRESTS — composed from shape × field × emblem in the club's colours
// ============================================================================

// Crest outlines in a normalised box (x −50…50, y −60…60)
const SHAPES = {
  heater: "M-46 -54 H46 V4 C46 34 26 50 0 60 C-26 50 -46 34 -46 4 Z",
  spanish: "M-44 -54 H44 V12 A44 44 0 0 1 -44 12 Z",
  notched: "M-46 -50 L-17 -50 L0 -60 L17 -50 L46 -50 V2 C46 34 24 50 0 60 C-24 50 -46 34 -46 2 Z",
  modern: "M-42 -56 H42 Q50 -56 50 -48 V18 Q50 30 39 38 L8 57 Q0 62 -8 57 L-39 38 Q-50 30 -50 18 V-48 Q-50 -56 -42 -56 Z",
  round: "M0 -56 A56 56 0 1 1 0 56 A56 56 0 1 1 0 -56 Z",
  hex: "M0 -60 L52 -30 L52 30 L0 60 L-52 30 L-52 -30 Z",
  diamond: "M0 -60 L50 0 L0 60 L-50 0 Z",
};

// Emblem glyphs in a −30…30 box
function emblem(ctx, kind, col, dark) {
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (kind) {
    case "star":
      ctx.fill(starPath(0, 2, 26));
      break;
    case "stars3":
      ctx.fill(starPath(0, -8, 15));
      ctx.fill(starPath(-20, 12, 10));
      ctx.fill(starPath(20, 12, 10));
      break;
    case "crown":
      ctx.fill(poly([[-24, 12], [-28, -14], [-12, -1], [0, -22], [12, -1], [28, -14], [24, 12]]));
      ctx.fillRect(-24, 14, 48, 9);
      for (const [cx, cy, r] of [[-28, -16, 4.5], [0, -24, 5], [28, -16, 4.5]]) {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case "tower":
      ctx.fill(P("M-19 26 V-8 H-24 V-26 H-15 V-19 H-7 V-26 H7 V-19 H15 V-26 H24 V-8 H19 V26 Z"));
      ctx.fillStyle = dark;
      ctx.fill(P("M-7 26 V13 A7 7 0 0 1 7 13 V26 Z"));
      ctx.fillRect(-4, -8, 8, 9);
      break;
    case "anchor":
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, -21, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, 24); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-13, -6); ctx.lineTo(13, -6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-22, 6); ctx.quadraticCurveTo(-18, 24, 0, 25); ctx.quadraticCurveTo(18, 24, 22, 6); ctx.stroke();
      ctx.fill(poly([[-22, 0], [-27, 10], [-17, 9]]));
      ctx.fill(poly([[22, 0], [27, 10], [17, 9]]));
      break;
    case "bolt":
      ctx.fill(P("M9 -29 L-15 4 L0 4 L-9 29 L17 -6 L2 -6 L13 -29 Z"));
      break;
    case "sun":
      sun(ctx, 0, 0, 12, col, 12);
      break;
    case "wave":
      ctx.lineWidth = 6;
      for (const yy of [-12, 2, 16]) {
        ctx.beginPath();
        ctx.moveTo(-26, yy);
        ctx.bezierCurveTo(-19, yy - 9, -13, yy - 9, -6.5, yy);
        ctx.bezierCurveTo(0, yy + 9, 6, yy + 9, 13, yy);
        ctx.bezierCurveTo(17, yy - 6, 21, yy - 6, 26, yy - 2);
        ctx.stroke();
      }
      break;
    case "ball": {
      ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      const pent = (cx, cy, r, rot) => {
        const pts = [];
        for (let i = 0; i < 5; i++) {
          const a = rot + (i * 2 * Math.PI) / 5;
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return poly(pts);
      };
      ctx.fill(pent(0, 0, 9, -Math.PI / 2));
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.clip();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        ctx.fill(pent(Math.cos(a) * 25, Math.sin(a) * 25, 8, a + Math.PI / 5));
      }
      ctx.restore();
      break;
    }
    case "wing":
      ctx.fill(P("M-26 18 C-20 -6 -4 -22 26 -26 C14 -18 8 -12 4 -6 C14 -9 20 -9 24 -8 C14 -2 8 2 4 6 C10 5 16 6 20 8 C8 14 -6 18 -26 18 Z"));
      break;
    case "key":
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(-15, 0, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.fillRect(-5, -3, 31, 6);
      ctx.fillRect(14, 3, 5, 9);
      ctx.fillRect(22, 3, 4, 7);
      break;
    case "trident":
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, 28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-17, -22); ctx.quadraticCurveTo(-17, -2, 0, -2); ctx.quadraticCurveTo(17, -2, 17, -22); ctx.stroke();
      ctx.fill(poly([[0, -30], [-6, -17], [6, -17]]));
      ctx.fill(poly([[-17, -29], [-22, -19], [-12, -19]]));
      ctx.fill(poly([[17, -29], [22, -19], [12, -19]]));
      break;
    case "leaf":
      ctx.fill(P("M0 -28 C17 -17 19 9 0 28 C-19 9 -17 -17 0 -28 Z"));
      ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 24); ctx.stroke();
      for (const yy of [-8, 2, 12]) {
        ctx.beginPath(); ctx.moveTo(0, yy + 5); ctx.lineTo(-8, yy - 2); ctx.moveTo(0, yy + 5); ctx.lineTo(8, yy - 2); ctx.stroke();
      }
      break;
    case "mountain":
      ctx.fill(poly([[-28, 20], [-8, -16], [2, -2], [12, -20], [30, 20]]));
      ctx.fillStyle = dark;
      ctx.fill(poly([[-8, -16], [-2, -6], [-6, -4], [-11, -10]]));
      ctx.fill(poly([[12, -20], [18, -9], [14, -7], [8, -12]]));
      break;
    default:
      ctx.fill(starPath(0, 2, 24));
  }
}

// a club's initials, centred in the −30…30 emblem box (wider marks shrink to fit)
function monogram(ctx, text, col, maxW) {
  ctx.save();
  ctx.font = font(800, 40);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + (text.length - 1) * 1.5;
  const s = Math.min(1, maxW / w);
  ctx.scale(s, s);
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(0,0,0,0.28)"; // a soft keyline so it reads on any field
  ctx.fillStyle = col;
  spacedText(ctx, text, 0, 3, 1.5, "center", true);
  ctx.restore();
}

function field(ctx, kind, a, b) {
  ctx.fillStyle = a;
  ctx.fillRect(-60, -70, 120, 140);
  ctx.fillStyle = b;
  switch (kind) {
    case "stripes":
      for (let i = -3; i <= 3; i += 2) ctx.fillRect(i * 14.3 - 7.15, -70, 14.3, 140);
      break;
    case "hoops":
      for (let i = -4; i <= 4; i += 2) ctx.fillRect(-60, i * 14 - 7, 120, 14);
      break;
    case "halves":
      ctx.fillRect(0, -70, 60, 140);
      break;
    case "quarters":
      ctx.fillRect(0, -70, 60, 70);
      ctx.fillRect(-60, 0, 60, 70);
      break;
    case "sash":
      ctx.fill(poly([[-60, -46], [-38, -70], [60, 40], [38, 70]]));
      break;
    case "chevron":
      ctx.fill(poly([[-60, 6], [0, -34], [60, 6], [60, 30], [0, -10], [-60, 30]]));
      break;
    case "cross":
      ctx.fillRect(-9, -70, 18, 140);
      ctx.fillRect(-60, -9, 120, 18);
      break;
    default: // plain — a subtle lower panel so the field isn't flat
      ctx.globalAlpha = 0.22;
      ctx.fillRect(-60, 18, 120, 60);
      ctx.globalAlpha = 1;
  }
}

// Draw a club's crest centred at (cx, cy), `h` tall. `club.crest` = { shape,
// field, emblem, band }; colours come from club.colors = [primary, secondary, trim].
export function drawCrest(ctx, club, cx, cy, h, { shadow = true } = {}) {
  const [c1, c2, trim] = club.colors;
  const { shape = "heater", field: fieldKind = "plain", emblem: glyph = "star", band = false } = club.crest || {};
  const s = h / 124;
  const outline = P(SHAPES[shape] || SHAPES.heater);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);

  if (shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4 * s;
    ctx.fillStyle = trim;
    ctx.fill(outline);
    ctx.restore();
  }

  // trim ring → inner field
  ctx.fillStyle = trim;
  ctx.fill(outline);
  ctx.save();
  ctx.scale(0.86, 0.86);
  ctx.clip(outline);
  field(ctx, fieldKind, c1, c2);
  // an optional "chief" band across the top carrying the club's initials
  if (band) {
    ctx.fillStyle = shade(c1, -0.45);
    ctx.fillRect(-60, -70, 120, 34);
    ctx.fillStyle = trim;
    ctx.font = font(800, 22);
    ctx.textBaseline = "middle";
    spacedText(ctx, club.short, 0, -45, 2.5, "center");
  }
  ctx.restore();

  // emblem on a soft disc so it reads on any field pattern
  const busy = fieldKind !== "plain";
  const ey = band ? 10 : 2;
  ctx.save();
  ctx.translate(0, ey);
  if (busy) {
    ctx.fillStyle = rgba(shade(c1, -0.35), 0.92);
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = trim; ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.scale(busy ? 0.8 : 1, busy ? 0.8 : 1);
  const ink = busy ? trim : (c2 === c1 ? trim : c2);
  if (glyph === "monogram") monogram(ctx, club.short, ink, busy ? 64 : 84);
  else emblem(ctx, glyph, ink, shade(c1, -0.5));
  ctx.restore();

  // inner keyline + a glossy top-left highlight
  ctx.save();
  ctx.scale(0.86, 0.86);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = rgba(shade(c1, -0.6), 0.6);
  ctx.stroke(outline);
  ctx.clip(outline);
  ctx.fillStyle = lin(ctx, -50, -60, 30, 40, [[0, "rgba(255,255,255,0.35)"], [0.45, "rgba(255,255,255,0.06)"], [0.46, "rgba(255,255,255,0)"], [1, "rgba(0,0,0,0.18)"]]);
  ctx.fillRect(-60, -70, 120, 140);
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.stroke(outline);
  ctx.restore();
}

// A crest/flag rendered to its own little canvas (for the reveal's walkout).
export function emblemCanvas(draw, w, h, scale = Math.min(2, window.devicePixelRatio || 1)) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d");
  ctx.scale(scale, scale);
  draw(ctx);
  return c;
}

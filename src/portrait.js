// portrait.js — the drawn player bust on every card.
//
// A head-and-shoulders portrait in a clean painted-vector style: soft shaded
// skin, a hairstyle, facial hair, and the club's kit. Every feature is a few
// bezier shapes in a local frame (head centre at 0,0, the head ~96 units wide),
// softened with blurred fills rather than outlines so it reads as a lit bust,
// not clip-art. A `look` (rolled per player in players.js) picks the features;
// the kit comes from the player's club.

import { P, lin, rad, rgba, shade, mix, rng, poly } from "./paint.js";
import { drawCrest } from "./emblems.js";

export const SKIN = ["#f6d6c1", "#edc3a4", "#e0ab86", "#c98f68", "#b07552", "#935a3b", "#74432b", "#583221"];
export const HAIR = {
  black: "#18120f", darkbrown: "#2f2018", brown: "#4b3121", lightbrown: "#7a5333",
  dirtyblond: "#a98250", blond: "#d6b47a", platinum: "#e9dfcb", auburn: "#8d3d22", grey: "#9b9792",
};
export const EYES = ["#3a2416", "#4f321d", "#6d5129", "#5d7a3e", "#4e7da6", "#7b8894"];

export const HAIR_STYLES = ["buzz", "crop", "fade", "quiff", "sidepart", "curly", "afro", "bun", "long", "mohawk", "bald", "slick", "cornrows", "dreads", "spiky", "fringe"];
// [style, weight] — clean-shaven and stubble dominate, as on a real team sheet
export const BEARDS = [["none", 30], ["stubble", 30], ["short", 14], ["full", 10], ["goatee", 11], ["mustache", 5]];

// ---- soft fills -------------------------------------------------------------
// Canvas `filter` isn't in every Safari, so soft shading uses the shadow trick:
// draw the shape far off-canvas and let only its blurred shadow land in place.
// Shadow offset/blur are in DEVICE pixels, so they're derived from the CTM.
const OFF = 4000;
function softFill(ctx, path, color, blur) {
  if (!ctx.getTransform) return; // pre-2021 engines: skip the soft shading, keep the flat fills
  const m = ctx.getTransform();
  const k = Math.hypot(m.a, m.b);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * k;
  ctx.shadowOffsetX = -OFF * m.a;
  ctx.shadowOffsetY = -OFF * m.b;
  ctx.translate(OFF, 0);
  ctx.fillStyle = "#000";
  ctx.fill(path);
  ctx.restore();
}

function ellipse(cx, cy, rx, ry, rot = 0) {
  const p = new Path2D();
  p.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  return p;
}

// mirror a path-builder across x = 0 (draws the right half, then the left)
function both(ctx, fn) {
  fn(1);
  ctx.save();
  ctx.scale(-1, 1);
  fn(-1);
  ctx.restore();
}

// ---- geometry ---------------------------------------------------------------

function headGeom(look) {
  const jaw = look.jaw ?? 0.5, face = look.face ?? 0.5;
  return {
    top: -71 - face * 3,
    cw: 46 + (look.cranium ?? 0.5) * 2.5,
    chk: 47.5 + jaw * 1.5,
    jw: 35 + jaw * 8,
    jy: 28 + face * 6,
    chinW: 9 + jaw * 6,
    chinY: 58 + face * 8,
    nw: 24 + (look.neck ?? 0.5) * 5,
  };
}

function headPath(g) {
  const { top, cw, chk, jw, jy, chinW, chinY } = g;
  const p = new Path2D();
  p.moveTo(0, top);
  p.bezierCurveTo(cw * 0.62, top, cw, top + 22, cw, -24);
  p.bezierCurveTo(cw + 0.5, -14, chk, -10, chk, -2);
  p.bezierCurveTo(chk, 14, jw + 5, jy - 12, jw, jy);
  p.bezierCurveTo(jw - 5, jy + 14, chinW + 10, chinY - 2, chinW, chinY);
  p.bezierCurveTo(chinW - 5, chinY + 2.5, 5, chinY + 3, 0, chinY + 3);
  p.bezierCurveTo(-5, chinY + 3, -(chinW - 5), chinY + 2.5, -chinW, chinY);
  p.bezierCurveTo(-(chinW + 10), chinY - 2, -(jw - 5), jy + 14, -jw, jy);
  p.bezierCurveTo(-(jw + 5), jy - 12, -chk, 14, -chk, -2);
  p.bezierCurveTo(-chk, -10, -(cw + 0.5), -14, -cw, -24);
  p.bezierCurveTo(-cw, top + 22, -cw * 0.62, top, 0, top);
  p.closePath();
  return p;
}

// the skull, inflated by t units (the volume short hair sits in)
function skullPath(g, t) {
  const { top, cw } = g;
  const p = new Path2D();
  const w = cw + t;
  p.moveTo(-(cw + 0.5), 12);
  p.quadraticCurveTo(-w, -6, -w, -24);
  p.bezierCurveTo(-w, top + 20 - t, -w * 0.62, top - t, 0, top - t);
  p.bezierCurveTo(w * 0.62, top - t, w, top + 20 - t, w, -24);
  p.quadraticCurveTo(w, -6, cw + 0.5, 12);
  p.closePath();
  return p;
}

// Everything ABOVE the hairline (+ sideburns), as a clip region. `drop` lowers
// the hairline (a fringe), `recede` pushes the temples back.
function hairRegion(g, { line = -44, recede = 0, burn = 10, jag = 0, seed = 1 } = {}) {
  const { cw } = g;
  const r = rng(seed);
  const pts = [[-140, -220], [140, -220], [140, burn], [cw - 4, burn], [cw - 6, -10], [cw - 7 - recede, -32 - recede * 0.3]];
  const n = 8;
  for (let i = 1; i < n; i++) {
    const x = cw - 7 - recede - ((2 * (cw - 7 - recede)) * i) / n;
    const curve = Math.cos((x / (cw + 4)) * Math.PI * 0.5);
    let y = line - curve * 2 + Math.abs(x / cw) * 6;
    if (jag) y += (i % 2 ? jag : -jag * 0.3) + r.range(-1, 1) * jag * 0.4;
    pts.push([x, y]);
  }
  pts.push([-(cw - 7 - recede), -32 - recede * 0.3], [-(cw - 6), -10], [-(cw - 4), burn], [-140, burn]);
  return poly(pts);
}

// ---- the kit ----------------------------------------------------------------

function torsoPath(g, neckline) {
  const n = g.nw + 6;
  const p = new Path2D();
  p.moveTo(-n, 96);
  p.bezierCurveTo(-58, 103, -104, 110, -130, 131);
  p.bezierCurveTo(-152, 147, -162, 186, -168, 290);
  p.lineTo(168, 290);
  p.bezierCurveTo(162, 186, 152, 147, 130, 131);
  p.bezierCurveTo(104, 110, 58, 103, n, 96);
  if (neckline === "v") { p.lineTo(0, 140); }
  else { p.quadraticCurveTo(0, 128, -n, 96); }
  p.closePath();
  return p;
}

function drawKit(ctx, g, kit) {
  const { primary, secondary, trim, pattern = "plain", collar = "crew" } = kit;
  const torso = torsoPath(g, collar);
  ctx.save();
  ctx.fillStyle = primary;
  ctx.fill(torso);
  ctx.clip(torso);
  ctx.fillStyle = secondary;
  switch (pattern) {
    case "stripes":
      for (let x = -170; x < 180; x += 64) ctx.fillRect(x + 16, 60, 32, 240);
      break;
    case "hoops":
      for (let y = 120; y < 300; y += 56) ctx.fillRect(-180, y, 360, 28);
      break;
    case "halves":
      ctx.fillRect(0, 60, 180, 240);
      break;
    case "sash":
      ctx.fill(poly([[-150, 110], [-110, 96], [170, 280], [120, 300]]));
      break;
    case "pinstripe":
      ctx.globalAlpha = 0.55;
      for (let x = -170; x < 180; x += 18) ctx.fillRect(x, 60, 3, 240);
      ctx.globalAlpha = 1;
      break;
    case "chevron":
      ctx.fill(poly([[-170, 170], [0, 220], [170, 170], [170, 200], [0, 250], [-170, 200]]));
      break;
    default: // plain: contrast raglan yokes over the shoulders
      ctx.fill(P("M-40 99 C-80 106 -112 116 -134 134 C-150 148 -156 168 -160 196 L-150 198 C-142 170 -120 150 -92 138 C-72 128 -52 120 -36 114 Z"));
      ctx.fill(P("M40 99 C80 106 112 116 134 134 C150 148 156 168 160 196 L150 198 C142 170 120 150 92 138 C72 128 52 120 36 114 Z"));
  }
  // fabric light: lit from the upper left, rolling off at the shoulders/sides
  ctx.fillStyle = lin(ctx, -170, 0, 170, 0, [[0, "rgba(0,0,0,0.30)"], [0.22, "rgba(255,255,255,0.10)"], [0.5, "rgba(255,255,255,0.04)"], [0.8, "rgba(0,0,0,0.18)"], [1, "rgba(0,0,0,0.42)"]]);
  ctx.fillRect(-180, 60, 360, 240);
  ctx.fillStyle = lin(ctx, 0, 96, 0, 290, [[0, "rgba(0,0,0,0)"], [0.35, "rgba(0,0,0,0.06)"], [1, "rgba(0,0,0,0.36)"]]);
  ctx.fillRect(-180, 60, 360, 240);
  // a fold under each collarbone + the chest's soft centre shadow
  softFill(ctx, ellipse(-58, 150, 34, 7, 0.25), "rgba(0,0,0,0.16)", 9);
  softFill(ctx, ellipse(58, 150, 34, 7, -0.25), "rgba(0,0,0,0.20)", 9);
  softFill(ctx, ellipse(0, 210, 10, 42), "rgba(0,0,0,0.10)", 12);
  // shoulder highlight
  softFill(ctx, ellipse(-104, 128, 30, 9, -0.6), "rgba(255,255,255,0.16)", 10);
  // the club crest over the heart (viewer's right)
  if (kit.club) drawCrest(ctx, kit.club, 66, 182, 38, { shadow: false });
  ctx.restore();

  // collar
  const n = g.nw + 6;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = trim;
  if (collar === "v") {
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(-n - 2, 95); ctx.lineTo(0, 141); ctx.lineTo(n + 2, 95); ctx.stroke();
  } else if (collar === "polo") {
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(-n - 2, 95); ctx.quadraticCurveTo(0, 130, n + 2, 95); ctx.stroke();
    ctx.fillStyle = trim;
    ctx.fill(poly([[-n - 4, 92], [-6, 126], [-n + 4, 132], [-n - 16, 104]]));
    ctx.fill(poly([[n + 4, 92], [6, 126], [n - 4, 132], [n + 16, 104]]));
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fill(poly([[-6, 126], [6, 126], [0, 150]]));
  } else {
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(-n - 2, 95); ctx.quadraticCurveTo(0, 130, n + 2, 95); ctx.stroke();
  }
  ctx.restore();
}

// ---- the head -----------------------------------------------------------------

function drawEars(ctx, g, skin, shadowC) {
  both(ctx, () => {
    const ex = g.chk - 1.5;
    ctx.fillStyle = shade(skin, -0.04);
    ctx.fill(ellipse(ex, 5, 8.5, 15, 0.14));
    softFill(ctx, ellipse(ex + 1.5, 6, 4, 9, 0.14), rgba(shadowC, 0.55), 3);
  });
}

function drawFace(ctx, g, look) {
  const skin = look.skin;
  const deep = shade(mix(skin, "#5a2a1a", 0.35), -0.28); // the shadow tone, warm not grey
  const lite = shade(mix(skin, "#fff1e4", 0.5), 0.08);
  const head = headPath(g);

  ctx.fillStyle = skin;
  ctx.fill(head);
  ctx.save();
  ctx.clip(head);
  // key light from the upper left → the far cheek + jaw fall into shade
  ctx.fillStyle = lin(ctx, -48, 0, 52, 0, [[0, rgba(lite, 0.20)], [0.45, rgba(skin, 0)], [0.72, rgba(deep, 0.22)], [1, rgba(deep, 0.55)]]);
  ctx.fillRect(-60, -90, 120, 170);
  ctx.fillStyle = lin(ctx, 0, 10, 0, g.chinY + 4, [[0, rgba(deep, 0)], [1, rgba(deep, 0.30)]]);
  ctx.fillRect(-60, 0, 120, 80);
  // forehead + lit-cheek highlights
  softFill(ctx, ellipse(-12, -40, 24, 14), rgba(lite, 0.55), 14);
  softFill(ctx, ellipse(-27, 12, 11, 8), rgba(lite, 0.35), 8);
  // cheekbone contour + jaw shade
  softFill(ctx, ellipse(36, 18, 10, 18, -0.2), rgba(deep, 0.28), 10);
  softFill(ctx, ellipse(-38, 22, 7, 14, 0.2), rgba(deep, 0.12), 9);
  // eye sockets
  softFill(ctx, ellipse(-19, -5, 14, 8), rgba(deep, 0.20), 6);
  softFill(ctx, ellipse(19, -5, 14, 8), rgba(deep, 0.26), 6);
  // temples
  softFill(ctx, ellipse(44, -24, 6, 16), rgba(deep, 0.22), 8);
  ctx.restore();

  drawEyes(ctx, look, skin, deep);
  drawBrows(ctx, look);
  drawNose(ctx, look, skin, deep, lite);
  drawMouth(ctx, look, skin, deep, lite);
}

function drawEyes(ctx, look, skin, deep) {
  const sclera = mix("#f4efe9", skin, 0.18);
  const lid = shade(mix(skin, "#2a1712", 0.75), -0.25);
  both(ctx, (side) => {
    const ex = 19, ey = -3;
    const almond = new Path2D();
    almond.moveTo(ex - 11, ey);
    almond.bezierCurveTo(ex - 7, ey - 6.5, ex + 7, ey - 6.6, ex + 11.5, ey - 0.8);
    almond.bezierCurveTo(ex + 7, ey + 3.8, ex - 7, ey + 4, ex - 11, ey);
    almond.closePath();
    ctx.fillStyle = sclera;
    ctx.fill(almond);
    ctx.save();
    ctx.clip(almond);
    const ix = ex, iy = ey - 0.6;
    ctx.fillStyle = rad(ctx, ix, iy + 1.5, 5.2, [[0, shade(look.eyes, 0.25)], [0.7, look.eyes], [1, shade(look.eyes, -0.35)]]);
    ctx.beginPath(); ctx.arc(ix, iy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#120c0a";
    ctx.beginPath(); ctx.arc(ix, iy, 2.2, 0, Math.PI * 2); ctx.fill();
    // the upper lid shades the top of the eyeball
    ctx.fillStyle = lin(ctx, 0, ey - 6, 0, ey + 1, [[0, rgba(deep, 0.55)], [1, rgba(deep, 0)]]);
    ctx.fillRect(ex - 12, ey - 7, 24, 8);
    ctx.restore();
    // catchlight — on the same side for both eyes (one light source)
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.arc(ix - 1.4 * side, iy - 1.8, 1.15, 0, Math.PI * 2); ctx.fill();
    // lash line + lid crease
    ctx.strokeStyle = lid;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ex - 11.5, ey + 0.4);
    ctx.bezierCurveTo(ex - 7, ey - 6.5, ex + 7, ey - 6.6, ex + 12, ey - 0.8);
    ctx.stroke();
    ctx.strokeStyle = rgba(deep, 0.35);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ex - 8, ey - 6.5);
    ctx.bezierCurveTo(ex - 3, ey - 10, ex + 6, ey - 10, ex + 10, ey - 5.5);
    ctx.stroke();
    ctx.strokeStyle = rgba(deep, 0.22);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(ex - 8, ey + 3.4);
    ctx.quadraticCurveTo(ex + 1, ey + 5.6, ex + 9, ey + 2.4);
    ctx.stroke();
  });
}

function drawBrows(ctx, look) {
  const col = look.hair === HAIR.platinum || look.hair === HAIR.blond ? shade(look.hair, -0.35) : shade(look.hair, -0.05);
  const t = look.browThick ?? 0.5, arch = look.browArch ?? 0.5;
  both(ctx, () => {
    const p = new Path2D();
    p.moveTo(7.5, -13 + t);
    p.bezierCurveTo(14, -18 - arch * 2 - t, 26, -20 - arch * 2.5 - t, 34.5, -15.5);
    p.bezierCurveTo(35, -14.4, 34.2, -13.4, 33, -13.4);
    p.bezierCurveTo(26, -16.2 - arch * 1.5, 15, -15 - arch, 8.5, -10.5);
    p.closePath();
    ctx.fillStyle = rgba(col, 0.92);
    ctx.fill(p);
    softFill(ctx, p, rgba(col, 0.35), 2);
  });
}

function drawNose(ctx, look, skin, deep, lite) {
  const w = 1 + (look.nose ?? 0.5) * 0.35;
  ctx.save();
  ctx.scale(w, 1);
  // the shaded side of the bridge + the soft underside
  softFill(ctx, P("M4 -4 C7 4 9 13 11 20 C9 23 6 24 3 24 C5 16 5 6 2 -4 Z"), rgba(deep, 0.42), 4);
  softFill(ctx, ellipse(0, 24.5, 10, 4), rgba(deep, 0.30), 4);
  // nostrils
  ctx.fillStyle = rgba(shade(deep, -0.35), 0.75);
  ctx.fill(ellipse(-5.2, 24, 2.6, 1.5, 0.25));
  ctx.fill(ellipse(5.2, 24, 2.6, 1.5, -0.25));
  // tip + bridge highlight
  softFill(ctx, ellipse(-1.2, 18.5, 3.6, 3), rgba(lite, 0.55), 3);
  softFill(ctx, ellipse(-1.5, 4, 1.8, 9), rgba(lite, 0.32), 3);
  // alar creases
  ctx.strokeStyle = rgba(deep, 0.35);
  ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(-9, 18); ctx.quadraticCurveTo(-10.5, 22.5, -7, 25.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9, 18); ctx.quadraticCurveTo(10.5, 22.5, 7, 25.5); ctx.stroke();
  ctx.restore();
}

function drawMouth(ctx, look, skin, deep, lite) {
  const my = 41 + ((look.face ?? 0.5) - 0.5) * 4;
  const mw = 13 + (look.lips ?? 0.5) * 3;
  const smile = look.smile ?? 0.3;
  const lipDark = shade(mix(skin, "#8a3b33", 0.32), -0.12);
  const lipLite = mix(skin, "#b4605a", 0.24);
  const up = smile * 2.2;
  // upper lip
  const ul = new Path2D();
  ul.moveTo(-mw, my - up);
  ul.bezierCurveTo(-mw * 0.55, my - 3.4, -mw * 0.2, my - 3.8, 0, my - 2.5);
  ul.bezierCurveTo(mw * 0.2, my - 3.8, mw * 0.55, my - 3.4, mw, my - up);
  ul.bezierCurveTo(mw * 0.5, my + 0.6, -mw * 0.5, my + 0.6, -mw, my - up);
  ul.closePath();
  ctx.fillStyle = lipDark;
  ctx.fill(ul);
  // lower lip
  const ll = new Path2D();
  ll.moveTo(-mw * 0.86, my + 0.2 - up * 0.6);
  ll.bezierCurveTo(-mw * 0.5, my + 6.8, mw * 0.5, my + 6.8, mw * 0.86, my + 0.2 - up * 0.6);
  ll.bezierCurveTo(mw * 0.4, my + 1.5, -mw * 0.4, my + 1.5, -mw * 0.86, my + 0.2 - up * 0.6);
  ll.closePath();
  ctx.fillStyle = lipLite;
  ctx.fill(ll);
  softFill(ctx, ellipse(-2, my + 3.2, mw * 0.35, 1.3), rgba(lite, 0.35), 2);
  // the line between the lips
  ctx.strokeStyle = rgba(shade(deep, -0.3), 0.7);
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-mw, my - up);
  ctx.bezierCurveTo(-mw * 0.4, my + 1.2, mw * 0.4, my + 1.2, mw, my - up);
  ctx.stroke();
  // shadow under the lower lip + the philtrum
  softFill(ctx, ellipse(0, my + 9.5, mw * 0.55, 2.4), rgba(deep, 0.30), 3);
  softFill(ctx, ellipse(0.5, my - 8, 2.6, 4), rgba(deep, 0.14), 2);
}

// ---- facial hair ---------------------------------------------------------------

function drawBeard(ctx, g, look) {
  const kind = look.beard || "none";
  if (kind === "none") return;
  const col = look.hair === HAIR.platinum ? shade(look.hair, -0.25) : look.hair;
  const { chk, jw, jy, chinY } = g;
  const my = 41 + ((look.face ?? 0.5) - 0.5) * 4;
  const head = headPath(g);

  const beardShape = (drop) => {
    const p = new Path2D();
    p.moveTo(chk - 0.5, -6);
    p.bezierCurveTo(chk, 12, jw + 4, jy - 4, jw - 1, jy + 6);
    p.bezierCurveTo(jw - 8, jy + 22 + drop * 0.4, 14, chinY + 4 + drop, 0, chinY + 5 + drop);
    p.bezierCurveTo(-14, chinY + 4 + drop, -(jw - 8), jy + 22 + drop * 0.4, -(jw - 1), jy + 6);
    p.bezierCurveTo(-(jw + 4), jy - 4, -chk, 12, -(chk - 0.5), -6);
    p.lineTo(-(chk - 6), -6);
    p.bezierCurveTo(-(chk - 7), 10, -30, 22, -21, 30);
    p.bezierCurveTo(-17, 34, -16, my + 5, -9, my + 8.5);
    p.bezierCurveTo(-4, my + 10, 4, my + 10, 9, my + 8.5);
    p.bezierCurveTo(16, my + 5, 17, 34, 21, 30);
    p.bezierCurveTo(30, 22, chk - 7, 10, chk - 6, -6);
    p.closePath();
    return p;
  };
  const stache = new Path2D(`M-16 ${my - 1.5} C-11 ${my - 9} -4 ${my - 8} 0 ${my - 6} C4 ${my - 8} 11 ${my - 9} 16 ${my - 1.5} C11 ${my - 3.5} 4 ${my - 3} 0 ${my - 2.5} C-4 ${my - 3} -11 ${my - 3.5} -16 ${my - 1.5} Z`);

  ctx.save();
  if (kind === "stubble") {
    ctx.save();
    ctx.clip(head);
    softFill(ctx, beardShape(0), rgba(col, 0.32), 6);
    softFill(ctx, stache, rgba(col, 0.30), 3);
    ctx.restore();
  } else if (kind === "mustache") {
    ctx.fillStyle = rgba(col, 0.95);
    ctx.fill(stache);
    ctx.save(); ctx.clip(head); softFill(ctx, beardShape(0), rgba(col, 0.16), 6); ctx.restore();
  } else if (kind === "goatee") {
    const goat = new Path2D(`M-12 ${my + 6} C-7 ${my + 10} 7 ${my + 10} 12 ${my + 6} C13 ${chinY - 4} 8 ${chinY + 5} 0 ${chinY + 6} C-8 ${chinY + 5} -13 ${chinY - 4} -12 ${my + 6} Z`);
    ctx.fillStyle = rgba(col, 0.94);
    ctx.fill(goat);
    ctx.fill(stache);
  } else {
    const drop = kind === "full" ? 13 : 2;
    const b = beardShape(drop);
    ctx.fillStyle = rgba(col, 0.96);
    ctx.fill(b);
    ctx.fill(stache);
    // texture + a soft edge so it sits ON the face
    ctx.save();
    ctx.clip(b);
    ctx.fillStyle = lin(ctx, -50, 0, 50, 0, [[0, rgba(shade(col, 0.25), 0.25)], [0.6, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.35)"]]);
    ctx.fillRect(-60, -10, 120, 100);
    const r = rng(look.seed || 7);
    ctx.strokeStyle = rgba(shade(col, 0.3), 0.18);
    ctx.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      const x = r.range(-48, 48), y = r.range(-4, chinY + drop + 4);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r.range(-1.5, 1.5), y + r.range(2, 4)); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---- hair --------------------------------------------------------------------------

function hairPaint(ctx, col, x0 = -60, y0 = -110, x1 = 60, y1 = 0) {
  return lin(ctx, x0, y0, x1, y1, [[0, shade(col, 0.22)], [0.5, col], [1, shade(col, -0.3)]]);
}

// fine strands combed in a direction, clipped to the current hair shape
function strands(ctx, col, seed, box, dir = -1.2, n = 70, alpha = 0.22) {
  const r = rng(seed);
  ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const x = r.range(box[0], box[2]), y = r.range(box[1], box[3]);
    const len = r.range(8, 20);
    const a = dir + r.range(-0.25, 0.25);
    ctx.strokeStyle = r() < 0.5 ? rgba(shade(col, 0.4), alpha) : rgba(shade(col, -0.4), alpha);
    ctx.lineWidth = r.range(0.8, 1.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + 2, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

// short hair — the inflated skull, clipped to above the hairline
function cap(ctx, g, look, t, opts = {}) {
  const col = look.hair;
  ctx.save();
  ctx.clip(hairRegion(g, { seed: look.seed, ...opts }));
  const s = skullPath(g, t);
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.fillStyle = hairPaint(ctx, col);
  ctx.fill(s);
  ctx.globalAlpha = 1;
  ctx.clip(s);
  if (opts.speckle) {
    const r = rng(look.seed + 3);
    ctx.fillStyle = rgba(shade(col, -0.2), 0.5);
    for (let i = 0; i < 260; i++) ctx.fillRect(r.range(-55, 55), r.range(-80, 12), 1.1, 1.1);
  }
  if (opts.strands !== false) strands(ctx, col, look.seed + 5, [-50, -80, 50, -20], opts.dir ?? -1.9, 60, 0.18);
  ctx.restore();
}

function curls(ctx, col, centers, r0, seed) {
  const rr = rng(seed);
  const p = new Path2D();
  for (const [x, y] of centers) {
    const r = r0 * rr.range(0.85, 1.15);
    p.moveTo(x + r, y);
    p.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = hairPaint(ctx, col);
  ctx.fill(p, "nonzero");
  // little coil highlights
  ctx.save();
  ctx.clip(p);
  for (const [x, y] of centers) {
    ctx.strokeStyle = rgba(shade(col, 0.4), 0.22);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x - 2, y - 2, r0 * 0.5, Math.PI * 0.9, Math.PI * 1.7); ctx.stroke();
  }
  ctx.restore();
  return p;
}

function arcPoints(cx, cy, rx, ry, a0, a1, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (n - 1);
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

// one loc (dreadlock): a thick twisted rope hanging from (x0,y0) to (x1,y1)
function loc(ctx, col, x0, y0, x1, y1, sway, w, r) {
  const mx = (x0 + x1) / 2 + sway, my = (y0 + y1) / 2;
  const rope = new Path2D();
  rope.moveTo(x0, y0);
  rope.quadraticCurveTo(mx, my, x1, y1);
  ctx.lineCap = "round";
  ctx.strokeStyle = shade(col, -0.5);
  ctx.lineWidth = w + 2.4;
  ctx.stroke(rope);
  ctx.strokeStyle = shade(col, r.range(-0.1, 0.14));
  ctx.lineWidth = w;
  ctx.stroke(rope);
  // the twist: small diagonal ticks down the rope
  ctx.strokeStyle = rgba(shade(col, -0.5), 0.5);
  ctx.lineWidth = 1.1;
  const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 6);
  for (let i = 1; i < n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * x0 + 2 * u * t * mx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * my + t * t * y1;
    ctx.beginPath(); ctx.moveTo(x - w * 0.42, y - 1.6); ctx.lineTo(x + w * 0.42, y + 1.6); ctx.stroke();
  }
  // a sheen down the lit side
  const hl = new Path2D();
  hl.moveTo(x0 - w * 0.22, y0);
  hl.quadraticCurveTo(mx - w * 0.22, my, x1 - w * 0.22, y1);
  ctx.strokeStyle = rgba(shade(col, 0.55), 0.22);
  ctx.lineWidth = w * 0.25;
  ctx.stroke(hl);
}

// hair BEHIND the head (long hair, afros, buns, locs)
function drawHairBack(ctx, g, look) {
  const col = look.hair;
  switch (look.hairStyle) {
    case "afro": {
      const pts = [];
      for (const [rx, ry, n] of [[64, 56, 18], [50, 44, 14], [30, 28, 9]]) pts.push(...arcPoints(0, -34, rx, ry, 0, Math.PI * 2, n));
      ctx.save();
      ctx.beginPath(); ctx.rect(-120, -140, 240, 158); ctx.clip();
      curls(ctx, col, pts, 17, look.seed);
      ctx.restore();
      break;
    }
    case "long": {
      const p = new Path2D();
      p.moveTo(0, -64);
      p.bezierCurveTo(34, -66, 54, -46, 56, -18);
      p.bezierCurveTo(58, 14, 60, 50, 66, 84);
      p.bezierCurveTo(68, 98, 62, 108, 56, 113);
      p.bezierCurveTo(54, 103, 49, 99, 44, 107);
      p.bezierCurveTo(41, 97, 36, 93, 30, 101);
      p.lineTo(26, 40);
      p.lineTo(-26, 40);
      p.lineTo(-30, 101);
      p.bezierCurveTo(-36, 93, -41, 97, -44, 107);
      p.bezierCurveTo(-49, 99, -54, 103, -56, 113);
      p.bezierCurveTo(-62, 108, -68, 98, -66, 84);
      p.bezierCurveTo(-60, 50, -58, 14, -56, -18);
      p.bezierCurveTo(-54, -46, -34, -66, 0, -64);
      p.closePath();
      ctx.fillStyle = hairPaint(ctx, col, -60, -60, 60, 120);
      ctx.fill(p);
      ctx.save();
      ctx.clip(p);
      ctx.fillStyle = lin(ctx, 0, 0, 0, 115, [[0, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.3)"]]);
      ctx.fillRect(-70, 0, 140, 120);
      strands(ctx, col, look.seed + 11, [-66, -30, 66, 112], 1.55, 130, 0.2);
      ctx.restore();
      break;
    }
    case "dreads": {
      const r = rng(look.seed + 21);
      for (let i = 0; i < 20; i++) {
        const side = i % 2 ? 1 : -1;
        const k = r();
        const x0 = side * (16 + k * 34), y0 = -66 + k * 52;
        loc(ctx, col, x0, y0, side * (38 + k * 28 + r.range(-4, 8)), r.range(70, 118), side * r.range(2, 10), r.range(7, 10), r);
      }
      break;
    }
    case "bun": {
      ctx.fillStyle = hairPaint(ctx, col, -20, -110, 20, -70);
      ctx.beginPath(); ctx.arc(0, g.top - 12, 19, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(0, g.top - 12, 19, 0, Math.PI * 2); ctx.clip();
      strands(ctx, col, look.seed + 4, [-20, g.top - 32, 20, g.top + 8], 0.6, 30, 0.25);
      ctx.restore();
      break;
    }
    default:
  }
}

// hair IN FRONT (over the scalp/forehead)
function drawHairFront(ctx, g, look) {
  const col = look.hair;
  switch (look.hairStyle) {
    case "bald":
      softFill(ctx, ellipse(-14, -58, 16, 7, -0.2), "rgba(255,255,255,0.22)", 8);
      break;
    case "buzz":
      cap(ctx, g, look, 1.5, { alpha: 0.82, speckle: true, strands: false, line: -45 });
      break;
    case "crop":
      cap(ctx, g, look, 5, { line: -43, jag: 2.2, dir: -1.6 });
      break;
    case "fade": {
      cap(ctx, g, look, 1.5, { alpha: 0.55, speckle: true, strands: false, line: -45 });
      ctx.save();
      ctx.clip(hairRegion(g, { line: -45, burn: -18, seed: look.seed }));
      const top = P(`M${-g.cw + 6} -40 C${-g.cw + 2} -70 -20 ${g.top - 10} 0 ${g.top - 10} C20 ${g.top - 10} ${g.cw - 2} -70 ${g.cw - 6} -40 Z`);
      ctx.fillStyle = hairPaint(ctx, col);
      ctx.fill(top);
      ctx.clip(top);
      strands(ctx, col, look.seed + 9, [-40, -90, 40, -40], -1.7, 50, 0.2);
      ctx.restore();
      break;
    }
    case "quiff": {
      cap(ctx, g, look, 2, { alpha: 0.7, speckle: true, strands: false, line: -44 });
      const q = P(`M-40 -42 C-48 -70 -30 ${g.top - 30} 4 ${g.top - 32} C34 ${g.top - 33} 50 -76 44 -44 C30 -54 -18 -56 -40 -42 Z`);
      ctx.fillStyle = hairPaint(ctx, col, -40, -110, 40, -40);
      ctx.fill(q);
      ctx.save(); ctx.clip(q); strands(ctx, col, look.seed + 2, [-44, -110, 44, -44], -1.15, 70, 0.26); ctx.restore();
      break;
    }
    case "sidepart": {
      cap(ctx, g, look, 6, { line: -41, dir: -0.4 });
      const sweep = P(`M-24 -46 C-30 -70 -10 ${g.top - 16} 18 ${g.top - 14} C40 ${g.top - 12} 52 -60 49 -34 C40 -46 18 -50 -24 -46 Z`);
      ctx.fillStyle = hairPaint(ctx, col);
      ctx.fill(sweep);
      ctx.save(); ctx.clip(sweep); strands(ctx, col, look.seed + 6, [-30, -95, 50, -36], -0.25, 60, 0.24); ctx.restore();
      ctx.strokeStyle = rgba(shade(look.skin, -0.1), 0.6);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-22, -47); ctx.quadraticCurveTo(-26, -62, -20, g.top - 6); ctx.stroke();
      break;
    }
    case "curly": {
      cap(ctx, g, look, 3, { alpha: 0.75, speckle: true, strands: false, line: -44 });
      const pts = [...arcPoints(0, -42, 44, 46, Math.PI * 1.06, Math.PI * 1.94, 9), ...arcPoints(0, -44, 30, 32, Math.PI * 1.1, Math.PI * 1.9, 6), ...arcPoints(0, -56, 14, 16, Math.PI * 1.1, Math.PI * 1.9, 3)];
      curls(ctx, col, pts, 13, look.seed);
      break;
    }
    case "afro": {
      ctx.save();
      ctx.clip(hairRegion(g, { line: -42, burn: 0, seed: look.seed }));
      const front = arcPoints(0, -40, 50, 34, Math.PI * 1.0, Math.PI * 2.0, 12);
      curls(ctx, col, front, 13, look.seed + 1);
      ctx.restore();
      break;
    }
    case "bun":
    case "slick": {
      cap(ctx, g, look, 5, { line: -45, strands: false });
      ctx.save();
      ctx.clip(hairRegion(g, { line: -45, seed: look.seed }));
      ctx.clip(skullPath(g, 5));
      ctx.strokeStyle = rgba(shade(col, 0.45), 0.28);
      ctx.lineWidth = 1.6;
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 9, -44);
        ctx.quadraticCurveTo(i * 10, -70, i * 6, g.top - 6);
        ctx.stroke();
      }
      softFill(ctx, ellipse(-16, -60, 14, 6, -0.3), rgba(shade(col, 0.6), 0.35), 6);
      ctx.restore();
      break;
    }
    case "long": {
      cap(ctx, g, look, 5, { line: -46, strands: false, burn: 4 });
      const lp = P("M0 -66 C-30 -64 -50 -40 -52 -6 C-53 20 -50 44 -46 62 C-40 40 -40 10 -40 -14 C-38 -34 -22 -50 0 -54 C22 -50 38 -34 40 -14 C40 10 40 40 46 62 C50 44 53 20 52 -6 C50 -40 30 -64 0 -66 Z");
      ctx.fillStyle = hairPaint(ctx, col);
      ctx.fill(lp);
      ctx.save(); ctx.clip(lp); strands(ctx, col, look.seed + 13, [-54, -66, 54, 62], 1.6, 90, 0.22); ctx.restore();
      if (look.headband) {
        ctx.fillStyle = look.headband;
        ctx.fill(P(`M-50 -40 C-30 -52 30 -52 50 -40 L50 -32 C30 -44 -30 -44 -50 -32 Z`));
      }
      break;
    }
    case "mohawk": {
      cap(ctx, g, look, 1.2, { alpha: 0.4, speckle: true, strands: false, line: -45 });
      const m = P(`M-13 -44 C-16 -70 -12 ${g.top - 26} 0 ${g.top - 30} C12 ${g.top - 26} 16 -70 13 -44 C6 -47 -6 -47 -13 -44 Z`);
      ctx.fillStyle = hairPaint(ctx, col, -15, -110, 15, -44);
      ctx.fill(m);
      ctx.save(); ctx.clip(m); strands(ctx, col, look.seed + 8, [-14, -110, 14, -44], -1.5, 30, 0.3); ctx.restore();
      break;
    }
    case "cornrows": {
      cap(ctx, g, look, 3, { line: -45, strands: false });
      ctx.save();
      ctx.clip(hairRegion(g, { line: -45, seed: look.seed }));
      ctx.clip(skullPath(g, 3));
      for (let i = -5; i <= 5; i++) {
        const x = i * 9;
        ctx.strokeStyle = rgba(shade(col, -0.5), 0.8);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, -42); ctx.quadraticCurveTo(x * 1.05, -70, x * 0.6, g.top - 4); ctx.stroke();
        ctx.strokeStyle = rgba(shade(col, 0.5), 0.25);
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(x + 4, -42); ctx.quadraticCurveTo(x * 1.05 + 4, -70, x * 0.6 + 2, g.top - 4); ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case "dreads": {
      cap(ctx, g, look, 6, { line: -44, strands: false });
      const r = rng(look.seed + 23);
      ctx.save();
      ctx.clip(hairRegion(g, { line: -44, seed: look.seed }));
      ctx.clip(skullPath(g, 7));
      for (let x = -44; x <= 44; x += 8.8) {
        loc(ctx, col, x, -40, x * 0.72, g.top - 10, r.range(-3, 3), 7.5, r);
      }
      ctx.restore();
      // a few locs fall forward past the temples, over the shoulders
      for (const side of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          loc(ctx, col, side * (40 + k * 6), -38 + k * 8, side * (56 + k * 8), 104 + k * 6, side * (6 + k * 4), 8, r);
        }
      }
      break;
    }
    case "spiky": {
      cap(ctx, g, look, 4, { line: -44, strands: false });
      const pts = [[-46, -40]];
      const r = rng(look.seed + 17);
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * (1.05 + (0.9 * i) / 10);
        const tip = i % 2 === 0;
        const rr = tip ? r.range(66, 80) : r.range(50, 56);
        pts.push([Math.cos(a) * rr * 0.74, -30 + Math.sin(a) * rr * 0.92]);
      }
      pts.push([46, -40], [0, -48]);
      const sp = poly(pts);
      ctx.fillStyle = hairPaint(ctx, col);
      ctx.fill(sp);
      ctx.save(); ctx.clip(sp); strands(ctx, col, look.seed + 18, [-50, -100, 50, -40], -1.57, 50, 0.24); ctx.restore();
      break;
    }
    case "fringe": {
      cap(ctx, g, look, 6, { line: -32, jag: 2.5, dir: 1.4 });
      break;
    }
    default:
      cap(ctx, g, look, 4, {});
  }
}

// ---- public -------------------------------------------------------------------

// Draw the bust with its head centred at (x, y); `s` = scale (1 → head ≈96px wide).
export function drawPortrait(ctx, look, kit, x, y, s) {
  const g = headGeom(look);
  const skin = look.skin;
  const deep = shade(mix(skin, "#5a2a1a", 0.35), -0.3);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  drawHairBack(ctx, g, look);

  // neck, darkest right under the jaw where the head shades it
  const nw = g.nw;
  const neck = P(`M${-nw} 20 C${-nw} 60 ${-nw - 3} 90 ${-nw - 5} 150 L${nw + 5} 150 C${nw + 3} 90 ${nw} 60 ${nw} 20 Z`);
  ctx.fillStyle = shade(skin, -0.06);
  ctx.fill(neck);
  ctx.save();
  ctx.clip(neck);
  ctx.fillStyle = lin(ctx, -nw, 0, nw, 0, [[0, rgba(deep, 0.08)], [0.6, rgba(deep, 0.16)], [1, rgba(deep, 0.5)]]);
  ctx.fillRect(-nw - 6, 20, nw * 2 + 12, 132);
  softFill(ctx, ellipse(0, g.chinY + 10, 34, 13), rgba(deep, 0.55), 9);
  softFill(ctx, ellipse(10, 104, 6, 14, 0.4), rgba(deep, 0.22), 6); // sternocleidomastoid
  ctx.restore();

  drawKit(ctx, g, kit);
  drawEars(ctx, g, skin, deep);
  drawFace(ctx, g, look);
  drawBeard(ctx, g, look);
  drawHairFront(ctx, g, look);

  ctx.restore();
}

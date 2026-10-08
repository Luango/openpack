// pack3d/geometry.js — PackGeometry: the procedural foil envelope.
//
// The envelope is a LOFT of rounded-rectangle cross-sections along Y: full depth
// through the body (where the cards are), tapering through each shoulder to a
// thin sealed band at the top and bottom, which closes to a serrated crimp edge.
// It is built as two PATCHES that share a common prepared boundary:
//
//   HEADER  — everything above the tear line (yT0 + a stable jagged offset)
//   BODY    — everything below it
//
// Each patch is a (rows × cols) grid wrapped once around the pack. The column
// loop STARTS and ENDS at the back centre, so the rear fin seam is already a
// duplicated column (u = 0 and u = 1) — that is the prepared split for the BACK
// rip. The tear row is duplicated between the two patches — the prepared split
// for the FRONT rip. At rest every duplicate pair coincides, so the closed pack
// shows no seam; the deformer releases pairs by route progress. No runtime mesh
// cutting ever happens.
//
// A rear fin ribbon (three columns, lying flat on the back) is appended as two
// small grids (body part + header part) that share the same rows, UV island and
// seam pairs, so it tears with the header and peels with the back flap.
//
// Everything is baked ONCE here: the stable wrinkle field (broad creases, the
// card-stack drape, shoulder gathers) is evaluated in undeformed material
// coordinates and written into the REST positions, which the deformer always
// starts from (no drift frame to frame).

import * as THREE from "three";
import { rng } from "../paint.js";
import { atlasLayout, uvIn } from "./atlas.js";

export const SHEET = { FRONT: 0, BACK: 1, SIDE_R: 2, SIDE_L: 3, FIN: 4 };
export const OWNER = { BODY: 0, HEADER: 1 };

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function buildPack(cfg, artAspect = 1.657) {
  const W = cfg.widthM;
  const H = cfg.heightM;
  const D = cfg.depthM;
  const T = cfg.tier;
  const a0 = W / 2;
  const b0 = D / 2;
  const seal = cfg.sealHeightM;
  const sh = cfg.shoulderM;
  const yTop = H / 2;
  const yBot = -H / 2;
  const yT0 = yTop - cfg.tearBelowTopM; // the tear line (nominal)
  const yBodyEnd = yTop - seal - sh; // |y| beyond this is shoulder
  const ySeal = yTop - seal; // |y| beyond this is the sealed band
  const flare = cfg.sealFlareM; // how far each crimp corner stands proud of the body
  const R_MAX = 0.0022; // side fold radius
  const B_SEAL = 0.00022; // half-depth of the flattened seal (non-zero: no degenerate tris)
  const rand = rng(cfg.wrinkleSeed * 1000 + 17);
  const layout = atlasLayout(artAspect);

  // ---- profile along Y ---------------------------------------------------
  function halfDepth(y) {
    const ay = Math.abs(y);
    if (ay <= yBodyEnd) return b0;
    if (ay >= ySeal) {
      const t = (ay - ySeal) / seal;
      return B_SEAL * (1 - 0.75 * smoothstep(0.75, 1, t)); // closes toward the crimp edge
    }
    return b0 + (B_SEAL - b0) * smoothstep(0, 1, (ay - yBodyEnd) / sh);
  }
  function halfWidth(y) {
    // The crimp FLARES: the sealed band is the tube pressed flat, so it is wider
    // than the inflated body (half the perimeter, give or take) — the squared-off
    // "ears" a booster pack shows at each end, which is also where the eye looks
    // for the rip. The width grows through the shoulder as the depth collapses and
    // then holds, so the band reads as a clean tab with straight sides, not a pinch.
    const ay = Math.abs(y);
    if (ay <= yBodyEnd) return a0;
    const t = smoothstep(0, 1, Math.min(1, (ay - yBodyEnd) / (sh * 0.85)));
    return a0 + flare * t;
  }
  function xShift(y) {
    // slightly asymmetric outline: the seals sit a hair to one side, plus a faint skew
    const ay = Math.abs(y);
    const s = smoothstep(yBodyEnd, ySeal, ay) * (y > 0 ? 0.00045 : -0.00035);
    return s + 0.0004 * (y / H);
  }
  function bodyMask(y) {
    return 1 - smoothstep(yBodyEnd - 0.003, yBodyEnd + 0.003, Math.abs(y));
  }
  // gentle crown across the flat faces (the stack holds them out), fading in the shoulders
  function crown(x, aFlat, y) {
    const t = aFlat > 0 ? x / aFlat : 0;
    return 0.00035 * Math.max(0, 1 - t * t) * bodyMask(y);
  }

  // ---- columns around the loop --------------------------------------------
  // Order (u increasing): back-right half (from the fin at x=0 toward +x), the
  // right side, the front (right → left), the left side, back-left half (→ x=0).
  const nF = T.frontCols;
  const nA = T.arcCols;
  const nBH = T.backHalfCols;
  const cols = nBH + nA + nF + nA + nBH;
  const colRole = new Uint8Array(cols);
  const colT = new Float32Array(cols);
  const colSheet = new Uint8Array(cols);
  {
    let c = 0;
    for (let i = 0; i < nBH; i++, c++) { colRole[c] = 0; colT[c] = i / nBH; colSheet[c] = SHEET.BACK; }
    for (let j = 0; j < nA; j++, c++) { colRole[c] = 1; colT[c] = (j + 0.5) / nA; colSheet[c] = SHEET.SIDE_R; }
    for (let i = 0; i < nF; i++, c++) { colRole[c] = 2; colT[c] = i / (nF - 1); colSheet[c] = SHEET.FRONT; }
    for (let j = 0; j < nA; j++, c++) { colRole[c] = 3; colT[c] = (j + 0.5) / nA; colSheet[c] = SHEET.SIDE_L; }
    for (let i = 1; i <= nBH; i++, c++) { colRole[c] = 4; colT[c] = i / nBH; colSheet[c] = SHEET.BACK; }
  }

  // position + outward normal of a column's cross-section point at height y
  const lp = { x: 0, z: 0, nx: 0, nz: 1, s: 0 };
  function loopPoint(col, y) {
    const a = halfWidth(y);
    const b = halfDepth(y);
    const r = Math.min(R_MAX, b);
    const aFlat = a - r;
    const t = colT[col];
    switch (colRole[col]) {
      case 0: { // back, right half: x 0 → +aFlat
        lp.x = t * aFlat; lp.z = -(b + crown(lp.x, aFlat, y)); lp.nx = 0; lp.nz = -1; break;
      }
      case 2: { // front: x +aFlat → −aFlat
        lp.x = aFlat * (1 - 2 * t); lp.z = b + crown(lp.x, aFlat, y); lp.nx = 0; lp.nz = 1; break;
      }
      case 4: { // back, left half: x −aFlat → 0
        lp.x = -aFlat * (1 - t); lp.z = -(b + crown(lp.x, aFlat, y)); lp.nx = 0; lp.nz = -1; break;
      }
      default: { // the sides: two quarter arcs + a short straight, by arc length, back → front
        const side = colRole[col] === 1 ? 1 : -1;
        const straight = 2 * (b - r);
        const total = Math.PI * r + straight;
        const d = t * total;
        let x, z, nx, nz;
        if (d < (Math.PI * r) / 2) {
          const phi = -Math.PI / 2 + d / r;
          nx = Math.cos(phi); nz = Math.sin(phi);
          x = aFlat + r * nx; z = -(b - r) + r * nz;
        } else if (d < (Math.PI * r) / 2 + straight) {
          nx = 1; nz = 0;
          x = a; z = -(b - r) + (d - (Math.PI * r) / 2);
        } else {
          const phi = (d - (Math.PI * r) / 2 - straight) / r;
          nx = Math.cos(phi); nz = Math.sin(phi);
          x = aFlat + r * nx; z = (b - r) + r * nz;
        }
        lp.x = side * x; lp.z = z; lp.nx = side * nx; lp.nz = nz;
      }
    }
    lp.x += xShift(y);
    return lp;
  }
  // the back surface at an arbitrary x (for the fin ribbon)
  function backZ(x, y) {
    const a = halfWidth(y);
    const b = halfDepth(y);
    const r = Math.min(R_MAX, b);
    return -(b + crown(x, a - r, y));
  }

  // nominal x of each column at the tear line — the route coordinate + jag/tooth key
  const aT = halfWidth(yT0); // half width at the tear line (inside the flare)
  const colX0 = new Float32Array(cols);
  for (let c = 0; c < cols; c++) colX0[c] = loopPoint(c, yT0).x;

  // ---- the prepared tear curve + the crimp serration ----------------------
  const jagPhase = [rand() * 6.283, rand() * 6.283, rand() * 6.283, rand() * 6.283];
  function jag(x, sheet) {
    if (sheet === SHEET.SIDE_L || sheet === SHEET.SIDE_R) return 0;
    const xf = x / W;
    const sideFade = 1 - smoothstep(0.4, 0.49, Math.abs(xf)); // endpoints agree at the side joins
    const ph = sheet === SHEET.BACK ? 2 : 0;
    const v = 0.55 * Math.sin(xf * 6.2832 * 6.3 + jagPhase[ph])
      + 0.3 * Math.sin(xf * 6.2832 * 17.1 + jagPhase[ph + 1])
      + 0.15 * Math.sin(xf * 6.2832 * 41 + ph);
    return 0.0012 * v * sideFade;
  }
  const toothPitch = 2 * ((2 * (a0 - R_MAX)) / (nF - 1));
  const tooth = (x) => 0.0007 * (0.5 + 0.5 * Math.cos((6.2832 * x) / toothPitch));
  const tearFall = (dy) => 1 - smoothstep(0, 0.0045, Math.abs(dy));

  // ---- rows (adaptive spacing: dense at the tear + the shoulders) ---------
  function spacingAt(y) {
    if (Math.abs(y - yT0) < 0.0045) return T.tearRowSpacing;
    if (Math.abs(y) > yBodyEnd - 0.002) return T.shoulderRowSpacing;
    return T.rowSpacing;
  }
  function makeRows(y0, y1) {
    const rows = [y0];
    let y = y0;
    for (;;) {
      const sp = spacingAt(y);
      if (y1 - y < 1.5 * sp) { rows.push(y1); break; }
      y += sp;
      rows.push(y);
    }
    return rows;
  }
  const bodyRows = makeRows(yBot, yT0);
  const headerRows = makeRows(yT0, yTop);

  // ---- the stable wrinkle field (metres along the outward normal) ---------
  const cw = cfg.cardWM / 2;
  const ch = cfg.cardHM / 2;
  const sealIn = ySeal - 0.001;
  // drape ridges: from each card corner out to the pack corner
  const drapes = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    drapes.push({ p0: [sx * cw, sy * ch], p1: [sx * (a0 - 0.0025), sy * sealIn], w: 0.0019, amp: 0.00032 });
  }
  // random broad creases per sheet (seeded, stable), as quadratic curves
  const creases = { [SHEET.FRONT]: [], [SHEET.BACK]: [] };
  for (const sheet of [SHEET.FRONT, SHEET.BACK]) {
    for (let i = 0; i < 6; i++) {
      const x0 = rand.range(-a0 * 0.9, a0 * 0.9);
      const y0 = rand.range(-yBodyEnd, yBodyEnd);
      const ang = rand.range(0, Math.PI);
      const len = rand.range(0.02, 0.05);
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      const bend = rand.range(-0.012, 0.012);
      const mx = (x0 + x1) / 2 - Math.sin(ang) * bend;
      const my = (y0 + y1) / 2 + Math.cos(ang) * bend;
      const pts = [];
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        pts.push([(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1]);
      }
      creases[sheet].push({ pts, w: rand.range(0.002, 0.0045), amp: rand.range(0.00018, 0.00042) * (rand.chance(0.5) ? 1 : -1) });
    }
  }
  const gatherPhase = [rand() * 6.283, rand() * 6.283];
  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const L2 = vx * vx + vy * vy || 1e-12;
    const t = clamp01(((px - ax) * vx + (py - ay) * vy) / L2);
    const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function wrinkle(x, y, sheet) {
    const isFace = sheet === SHEET.FRONT || sheet === SHEET.BACK;
    const faceScale = isFace ? 1 : 0.3;
    const ay = Math.abs(y);
    let d = 0;
    // the card stack: foil hugs the stack, relaxes inward around it
    const dxc = Math.abs(x) - cw;
    const dyc = ay - ch;
    const outside = Math.max(dxc, dyc);
    const cardMask = 1 - smoothstep(0, 0.0045, outside);
    d += -0.0008 * (1 - cardMask) * bodyMask(y) * faceScale;
    if (isFace) {
      for (const r of drapes) d += r.amp * Math.exp(-((segDist(x, y, r.p0[0], r.p0[1], r.p1[0], r.p1[1]) / r.w) ** 2));
      // broad creases: stronger toward the shoulders/seals, suppressed over the title
      const titleMask = 1 - 0.75 * (1 - smoothstep(0.024, 0.03, Math.abs(x))) * (1 - smoothstep(0.016, 0.022, ay));
      const zone = 0.35 + 0.65 * smoothstep(0.025, 0.048, ay);
      for (const c of creases[sheet]) {
        let best = 1;
        for (let k = 0; k < c.pts.length - 1; k++) {
          const dd = segDist(x, y, c.pts[k][0], c.pts[k][1], c.pts[k + 1][0], c.pts[k + 1][1]);
          if (dd < best) best = dd;
        }
        d += c.amp * Math.exp(-((best / c.w) ** 2)) * zone * titleMask;
      }
    }
    // shoulder gathers: vertical ripples where the foil bunches into the seal
    const shMask = smoothstep(yBodyEnd - 0.003, yBodyEnd + 0.004, ay) * (1 - smoothstep(ySeal - 0.001, ySeal + 0.002, ay));
    d += 0.00032 * Math.sin((6.2832 * x) / 0.0092 + gatherPhase[y > 0 ? 0 : 1] + (sheet === SHEET.BACK ? 1.3 : 0)) * shMask * faceScale;
    return d;
  }

  // ---- assemble the grids --------------------------------------------------
  const finRows = { body: bodyRows, header: headerRows };
  const FIN_COLS = 3;
  const nBody = bodyRows.length * cols;
  const nHeader = headerRows.length * cols;
  const nFinB = bodyRows.length * FIN_COLS;
  const nFinH = headerRows.length * FIN_COLS;
  const nVerts = nBody + nHeader + nFinB + nFinH;

  const pos = new Float32Array(nVerts * 3); // rest (wrinkled)
  const uv = new Float32Array(nVerts * 2);
  const mx = new Float32Array(nVerts); // raw loop coords (no wrinkle) — the material frame
  const my = new Float32Array(nVerts);
  const mz = new Float32Array(nVerts);
  const nx = new Float32Array(nVerts); // rest normal (horizontal, approximate)
  const nz = new Float32Array(nVerts);
  const sheet = new Uint8Array(nVerts);
  const owner = new Uint8Array(nVerts);
  const col = new Int16Array(nVerts); // column index (−1 for the fin)
  const sRoute = new Float32Array(nVerts); // front rip: left → right
  const hTear = new Float32Array(nVerts); // height above the (jagged) tear line
  const flap = new Int8Array(nVerts); // back rip: −1 left flap, +1 right flap, 0 fixed
  const taper = new Float32Array(nVerts); // back rip: 1 in the body → 0 at the seals
  const routeB = new Float32Array(nVerts); // back rip: top seal → bottom seal
  const finK = new Int8Array(nVerts); // fin column (0 base … 2 free edge), −1 otherwise

  const patches = {
    body: { base: 0, rows: bodyRows.length, cols, rowY: bodyRows },
    header: { base: nBody, rows: headerRows.length, cols, rowY: headerRows },
    finBody: { base: nBody + nHeader, rows: bodyRows.length, cols: FIN_COLS, rowY: bodyRows },
    finHeader: { base: nBody + nHeader + nFinB, rows: headerRows.length, cols: FIN_COLS, rowY: headerRows },
  };
  const idx = (p, r, c) => p.base + r * p.cols + c;

  // which back flap a column belongs to (by its role, never by x: the seal shift
  // nudges the centre column either side of zero)
  const flapOf = (c) => (c < 0 ? 1 : colRole[c] === 0 ? 1 : colRole[c] === 4 ? -1 : 0);
  function fillVertex(i, x, y, z, nX, nZ, sh_, own, c, u, v) {
    const dW = wrinkle(x, y, sh_);
    pos[i * 3] = x + nX * dW;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z + nZ * dW;
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
    mx[i] = x; my[i] = y; mz[i] = z;
    nx[i] = nX; nz[i] = nZ;
    sheet[i] = sh_;
    owner[i] = own;
    col[i] = c;
    sRoute[i] = clamp01((x + aT) / (2 * aT));
    hTear[i] = y - (yT0 + jag(x, sh_));
    flap[i] = flapOf(c);
    // back rip: the flaps hinge most at the middle of the back and ease out toward
    // both seals (an almond-shaped opening), so the crimps stay put and the foil
    // between crumples instead of stretching into a band
    taper[i] = 1 - smoothstep(0.012, ySeal - 0.002, Math.abs(y));
    routeB[i] = clamp01((ySeal - y) / (2 * ySeal));
    finK[i] = -1;
  }

  function buildPatch(p, own) {
    const isEnd = own === OWNER.BODY ? (r) => r === 0 : (r) => r === p.rows - 1;
    for (let r = 0; r < p.rows; r++) {
      const yRow = p.rowY[r];
      for (let c = 0; c < cols; c++) {
        const sh_ = colSheet[c];
        const x0 = colX0[c];
        let y = yRow + jag(x0, sh_) * tearFall(yRow - yT0);
        if (isEnd(r)) y = own === OWNER.BODY ? yBot + tooth(x0) : yTop - tooth(x0);
        const q = loopPoint(c, y);
        // UV from the material position
        let u, v;
        const vy = (y - yBot) / H;
        if (sh_ === SHEET.FRONT) {
          const a = halfWidth(y) - Math.min(R_MAX, halfDepth(y));
          [u, v] = uvIn(layout.front, clamp01((q.x - xShift(y) + a) / (2 * a)), vy);
        } else if (sh_ === SHEET.BACK) {
          const a = halfWidth(y) - Math.min(R_MAX, halfDepth(y));
          [u, v] = uvIn(layout.back, clamp01((a - (q.x - xShift(y))) / (2 * a)), vy);
        } else if (sh_ === SHEET.SIDE_R) {
          [u, v] = uvIn(layout.sideR, vy, colT[c]);
        } else {
          [u, v] = uvIn(layout.sideL, vy, colT[c]);
        }
        fillVertex(idx(p, r, c), q.x, y, q.z, q.nx, q.nz, sh_, own, c, u, v);
      }
    }
  }
  buildPatch(patches.body, OWNER.BODY);
  buildPatch(patches.header, OWNER.HEADER);

  // the fin ribbon: base at the back centre, lying over the back-right flap
  function buildFin(p, own) {
    for (let r = 0; r < p.rows; r++) {
      const yRow = p.rowY[r];
      for (let k = 0; k < FIN_COLS; k++) {
        const x = (k / (FIN_COLS - 1)) * cfg.finWidthM;
        let y = yRow + jag(x, SHEET.BACK) * tearFall(yRow - yT0);
        const end = own === OWNER.BODY ? r === 0 : r === p.rows - 1;
        if (end) y = own === OWNER.BODY ? yBot + tooth(x) + 0.0004 : yTop - tooth(x) - 0.0004;
        const z = backZ(x, y) - (k > 0 ? 0.00028 : 0.00008);
        const [u, v] = uvIn(layout.fin, (y - yBot) / H, k / (FIN_COLS - 1));
        const i = idx(p, r, k);
        fillVertex(i, x + xShift(y), y, z, 0, -1, SHEET.FIN, own, -1, u, v);
        finK[i] = k;
        hTear[i] = y - (yT0 + jag(x, SHEET.BACK));
      }
    }
  }
  buildFin(patches.finBody, OWNER.BODY);
  buildFin(patches.finHeader, OWNER.HEADER);

  // ---- indices (outward winding) + material groups ------------------------
  const index = [];
  function gridTris(p) {
    for (let r = 0; r < p.rows - 1; r++) {
      for (let c = 0; c < p.cols - 1; c++) {
        const i00 = idx(p, r, c), i10 = idx(p, r, c + 1), i01 = idx(p, r + 1, c), i11 = idx(p, r + 1, c + 1);
        index.push(i00, i01, i10, i10, i01, i11);
      }
    }
  }
  const bodyStart = index.length;
  gridTris(patches.body);
  gridTris(patches.finBody);
  const bodyCount = index.length - bodyStart;
  const headerStart = index.length;
  gridTris(patches.header);
  gridTris(patches.finHeader);
  const headerCount = index.length - headerStart;

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos.slice(), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  // group order ↔ materials [bodyExt, bodyInt, headerExt, headerInt]
  geometry.addGroup(bodyStart, bodyCount, 0);
  geometry.addGroup(bodyStart, bodyCount, 1);
  geometry.addGroup(headerStart, headerCount, 2);
  geometry.addGroup(headerStart, headerCount, 3);
  geometry.computeVertexNormals();
  geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);

  // ---- seam-pair table -------------------------------------------------------
  const tearPairs = []; // [bodyVertex, headerVertex, col]
  const bTop = patches.body.rows - 1;
  for (let c = 0; c < cols; c++) tearPairs.push([idx(patches.body, bTop, c), idx(patches.header, 0, c), c]);
  for (let k = 0; k < FIN_COLS; k++) tearPairs.push([idx(patches.finBody, bTop, k), idx(patches.finHeader, 0, k), -1]);
  const finPairs = []; // [u=0 vertex, u=1 vertex, y]
  for (let r = 0; r < patches.body.rows; r++) finPairs.push([idx(patches.body, r, 0), idx(patches.body, r, cols - 1), bodyRows[r]]);
  for (let r = 0; r < patches.header.rows; r++) finPairs.push([idx(patches.header, r, 0), idx(patches.header, r, cols - 1), headerRows[r]]);

  return {
    geometry,
    rest: pos,
    count: nVerts,
    meta: { mx, my, mz, nx, nz, sheet, owner, col, sRoute, hTear, flap, taper, routeB, finK },
    seams: { tear: tearPairs, fin: finPairs },
    patches,
    cols,
    colX0,
    colSheet,
    idx,
    layout,
    dims: { W, H, D, a0, aT, b0, yT0, yTop, yBot, yBodyEnd, ySeal, seal, shoulder: sh, cw, ch, flare },
    fn: { halfDepth, halfWidth, jag, backZ, xShift },
    stats: { triangles: index.length / 3, vertices: nVerts },
  };
}

// The inner card stack: one shallow rounded-rectangle solid for the deck plus
// the top card as its own thin slab, so the stack can be textured with the real
// top card and rise/flip independently of the wrapper. Printed edge lines on the
// deck's sides imply the rest of the cards without more meshes.
export function buildCardStack(cfg) {
  const w = cfg.cardWM, h = cfg.cardHM, d = cfg.stackDepthM;
  const deck = roundedSlab(w, h, d * 0.8, 0.0025);
  const top = roundedSlab(w, h, d * 0.2, 0.0025);
  return { deck, top, deckDepth: d * 0.8, topDepth: d * 0.2 };
}

// A rounded-rectangle extrusion with clean per-face UVs (0..1 on the big faces,
// a tiled strip around the edge). Built by hand so the UVs are predictable.
function roundedSlab(w, h, d, r, N = 6) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const ring = [];
  const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, Math.PI / 2], [-hw + r, -hh + r, Math.PI], [hw - r, -hh + r, -Math.PI / 2]];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= N; k++) {
      const a = a0 + (k / N) * (Math.PI / 2);
      ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  const P = [], UV = [], I = [];
  const push = (x, y, z, u, v) => { P.push(x, y, z); UV.push(u, v); return P.length / 3 - 1; };
  // faces (fan from the centre), +z face UVs upright, −z mirrored so its print reads correctly from behind
  for (const sgn of [1, -1]) {
    const c = push(0, 0, sgn * hd, 0.5, 0.5);
    const first = P.length / 3;
    for (const [x, y] of ring) push(x, y, sgn * hd, sgn > 0 ? (x + hw) / w : (hw - x) / w, (y + hh) / h);
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const a = first + k, b = first + ((k + 1) % n);
      if (sgn > 0) I.push(c, a, b); else I.push(c, b, a);
    }
  }
  // edge strip
  const n = ring.length;
  let perim = 0;
  const cum = [0];
  for (let k = 0; k < n; k++) {
    const [x0, y0] = ring[k], [x1, y1] = ring[(k + 1) % n];
    perim += Math.hypot(x1 - x0, y1 - y0);
    cum.push(perim);
  }
  const base = P.length / 3;
  for (let k = 0; k <= n; k++) {
    const [x, y] = ring[k % n];
    const u = (cum[k] / perim) * 40; // the edge-lines texture tiles along the rim
    push(x, y, hd, u, 1);
    push(x, y, -hd, u, 0);
  }
  for (let k = 0; k < n; k++) {
    const a = base + k * 2, b = base + k * 2 + 1, c = base + k * 2 + 2, e = base + k * 2 + 3;
    I.push(a, b, c, c, b, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  const faceTris = (n) * 3;
  g.addGroup(0, faceTris, 0); // +z face
  g.addGroup(faceTris, faceTris, 1); // −z face
  g.addGroup(faceTris * 2, n * 6, 2); // rim
  g.computeVertexNormals();
  return g;
}

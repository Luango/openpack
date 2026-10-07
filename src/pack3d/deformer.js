// pack3d/deformer.js — TearDeformer: rest data → deformed positions, every frame.
//
// Every frame starts from the baked REST positions (geometry.js) so nothing
// accumulates. Two rip methods share the one mesh and seam table:
//
//   FRONT rip (the top strip) — the header patch is swept along the station
//   chain (chain.js) by its route coordinate; a release weight that is 0 at and
//   ahead of the tear tip and grows smoothly behind it blends each header vertex
//   from rest into the swept pose, so only released material opens. The body
//   gets a small reaction: a press dent at the tip and a gaping mouth behind it.
//
//   BACK rip (the fin-seam peel) — the duplicated back-centre column releases
//   from the top seal downward; each back-sheet vertex hinges about its side
//   fold (left/right flap) by a weight that tapers to zero into the crimped
//   seals, so the flaps swing open like doors while the seals crumple. The fin
//   ribbon rides the right flap and its free edge lifts as the seam unglues.
//
// After deformation the normals are recomputed and the still-joined seam pairs
// reconciled (averaged), so the pre-split topology shades as one closed surface.
// Torn-edge ribbons are rebuilt along the released boundary samples only.

import * as THREE from "three";
import { createChain } from "./chain.js";
import { OWNER, SHEET, smoothstep } from "./geometry.js";

const TW_FRONT = 0.05; // release transition (fraction of the route) behind the tip
const TW_BACK = 0.07;

export function createDeformer(pack, cfg, { reduced = false } = {}) {
  const { geometry, rest, count, meta, seams, dims, cols, patches, idx } = pack;
  const { mx, my, mz, nx, nz, owner, sRoute, hTear, flap, taper, routeB, finK, sheet, col } = meta;
  const posAttr = geometry.attributes.position;
  const P = posAttr.array;
  const chain = createChain(cfg.tier.stations);
  const { W, a0, b0, yT0, ySeal } = dims;
  const R_HINGE = a0 - 0.0011;

  // wrinkle offsets (rest − raw), carried into the swept frame
  const wox = new Float32Array(count);
  const woz = new Float32Array(count);
  for (let i = 0; i < count; i++) { wox[i] = rest[i * 3] - mx[i]; woz[i] = rest[i * 3 + 2] - mz[i]; }

  const wCol = new Float32Array(cols); // front: per-column release weight
  const wRowB = new Map(); // back: per-row weight (by y) for the fin pairs
  const frame = {};
  const tip = { x: 0, y: 0, z: 0 };
  const dir = { x: -1, y: 0, z: 0 };
  const handle = { x: 0, y: 0, z: 0 };
  const box = { hx: a0 + 0.001, top: yT0 - 0.0005, front: b0 * 0.4 };

  // the detached cap (front): positions frozen at detach, moved rigidly after
  let capPos = null; // Float32Array of the header+finHeader vertices' positions at detach
  const capIdx = [];
  for (const p of [patches.header, patches.finHeader]) for (let i = 0; i < p.rows * p.cols; i++) capIdx.push(p.base + i);
  const capM = new THREE.Matrix4();
  const _v = new THREE.Vector3();

  // ---- torn-edge ribbons ----------------------------------------------------
  // each strip: entries of [edgeVertex, innerVertex, weightKey]
  const bTop = patches.body.rows - 1;
  const strips = {
    tearBody: { entries: [], geo: null },
    tearHeader: { entries: [], geo: null },
    finL: { entries: [], geo: null },
    finR: { entries: [], geo: null },
  };
  for (let c = 0; c < cols; c++) {
    strips.tearBody.entries.push([idx(patches.body, bTop, c), idx(patches.body, bTop - 1, c), c]);
    strips.tearHeader.entries.push([idx(patches.header, 0, c), idx(patches.header, 1, c), c]);
  }
  for (const p of [patches.body, patches.header]) {
    for (let r = 0; r < p.rows; r++) {
      strips.finR.entries.push([idx(p, r, 0), idx(p, r, 1), p.rowY[r]]);
      strips.finL.entries.push([idx(p, r, cols - 1), idx(p, r, cols - 2), p.rowY[r]]);
    }
  }
  const ribbonJitter = (k) => 0.00028 + 0.00034 * Math.abs((Math.sin(k * 33.7 + 1.1) * 5417) % 1);
  // all four strips live in ONE geometry (one draw call): each owns a slice of it
  const ribbonGeo = new THREE.BufferGeometry();
  {
    let total = 0;
    for (const s of Object.values(strips)) { s.offset = total; total += s.entries.length; }
    const arr = new Float32Array(total * 2 * 3);
    const at = new THREE.BufferAttribute(arr, 3);
    at.setUsage(THREE.DynamicDrawUsage);
    ribbonGeo.setAttribute("position", at);
    const ind = [];
    for (const s of Object.values(strips)) {
      const n = s.entries.length, o = s.offset * 2;
      for (let i = 0; i < n - 1; i++) {
        const a = o + i * 2, b = o + i * 2 + 1, c = o + i * 2 + 2, d = o + i * 2 + 3;
        ind.push(a, b, c, c, b, d);
      }
      s.arr = arr; s.attr = at;
    }
    ribbonGeo.setIndex(ind);
  }
  const normals = geometry.attributes.normal.array;
  function writeStrip(s, weightOf) {
    const { entries, arr } = s;
    let any = false;
    for (let i = 0; i < entries.length; i++) {
      const [e, inner, key] = entries[i];
      const w = weightOf(key);
      const ex = P[e * 3], ey = P[e * 3 + 1], ez = P[e * 3 + 2];
      let ux = P[inner * 3] - ex, uy = P[inner * 3 + 1] - ey, uz = P[inner * 3 + 2] - ez;
      const L = Math.hypot(ux, uy, uz) || 1;
      const h = ribbonJitter(i) * Math.min(1, w * 1.6);
      if (h > 1e-5) any = true;
      const ox = normals[e * 3] * 0.00006, oy = normals[e * 3 + 1] * 0.00006, oz = normals[e * 3 + 2] * 0.00006;
      const o = (s.offset + i) * 6;
      arr[o] = ex + ox; arr[o + 1] = ey + oy; arr[o + 2] = ez + oz;
      arr[o + 3] = ex + ox + (ux / L) * h; arr[o + 4] = ey + oy + (uy / L) * h; arr[o + 5] = ez + oz + (uz / L) * h;
    }
    s.attr.needsUpdate = true;
    return any;
  }

  // ---- evaluation ---------------------------------------------------------------
  // state: { mode, phase, p, grip, pull, press, open, flapOpen, capMatrix }
  function evaluate(state, dt) {
    P.set(rest);
    if (state.mode === "front") evalFront(state, dt);
    else evalBack(state, dt);
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    reconcile(state);
    geometry.attributes.normal.needsUpdate = true;
    // ribbons
    if (state.mode === "front") {
      const wf = (c) => (c < 0 ? 0 : wCol[c]);
      writeStrip(strips.tearBody, wf);
      writeStrip(strips.tearHeader, wf);
      writeStrip(strips.finL, () => 0);
      writeStrip(strips.finR, () => 0);
    } else {
      writeStrip(strips.tearBody, () => 0);
      writeStrip(strips.tearHeader, () => 0);
      const wb = (y) => wRowB.get(y) || 0;
      writeStrip(strips.finL, wb);
      writeStrip(strips.finR, wb);
    }
  }

  function evalFront(state, dt) {
    const p = state.p;
    const xTip = -a0 + p * W;
    const L = Math.max(0.0008, p * W);
    const detached = state.phase === "detached" || state.phase === "revealed";
    for (let c = 0; c < cols; c++) {
      const x = pack.colX0[c];
      wCol[c] = detached ? 1 : smoothstep(0, TW_FRONT, (xTip - x) / W);
    }

    if (detached && capPos) {
      // the cap: its frozen shape under the rigid fly-off transform
      capM.copy(state.capMatrix);
      for (let k = 0; k < capIdx.length; k++) {
        const i = capIdx[k];
        _v.set(capPos[k * 3], capPos[k * 3 + 1], capPos[k * 3 + 2]).applyMatrix4(capM);
        P[i * 3] = _v.x; P[i * 3 + 1] = _v.y; P[i * 3 + 2] = _v.z;
      }
    } else if (p > 0) {
      // the station chain from the tip back to the grip
      tip.x = xTip; tip.y = yT0; tip.z = 0;
      const g = state.grip;
      if (g) {
        const lift = 0.006 + 0.3 * L + 0.55 * Math.max(0, g.y - yT0) + state.pull * 0.012;
        handle.x = g.x; handle.y = Math.max(g.y, yT0 + 0.002); handle.z = b0 + lift;
      } else {
        // no hand: the strip settles curled slightly outward from where it's torn
        handle.x = tip.x - L * 0.92; handle.y = yT0 + 0.003 + L * 0.25; handle.z = b0 + 0.004 + L * 0.3;
      }
      // clamp the handle to the reachable length
      let hx = handle.x - tip.x, hy = handle.y - tip.y, hz = handle.z - tip.z;
      const hd = Math.hypot(hx, hy, hz);
      const reach = 0.93 * L;
      if (hd > reach) { const k = reach / hd; handle.x = tip.x + hx * k; handle.y = tip.y + hy * k; handle.z = tip.z + hz * k; }
      chain.solve({ tip, dir, handle, L, dt, box, lift: reduced ? 0.4 : 1.2, damping: reduced ? 0.8 : 0.9 });

      const hdr = patches.header, fh = patches.finHeader;
      for (const pt of [hdr, fh]) {
        const n = pt.rows * pt.cols;
        for (let k = 0; k < n; k++) {
          const i = pt.base + k;
          const d = xTip - mx[i];
          if (d <= 0) continue;
          const w = smoothstep(0, TW_FRONT, d / W);
          if (w <= 0) continue;
          chain.sample(d, frame);
          const h = my[i] - yT0;
          const nn = mz[i] + woz[i];
          const xx = wox[i];
          const sx = frame.px + h * frame.ux + nn * frame.nx - xx * frame.tx;
          const sy = frame.py + h * frame.uy + nn * frame.ny - xx * frame.ty;
          const sz = frame.pz + h * frame.uz + nn * frame.nz - xx * frame.tz;
          P[i * 3] += (sx - P[i * 3]) * w;
          P[i * 3 + 1] += (sy - P[i * 3 + 1]) * w;
          P[i * 3 + 2] += (sz - P[i * 3 + 2]) * w;
        }
      }
    }

    // body reaction: press dent at the tip + the mouth gaping behind the tear
    const press = state.press;
    const open = state.open;
    const bd = patches.body, fb = patches.finBody;
    for (const pt of [bd, fb]) {
      const n = pt.rows * pt.cols;
      for (let k = 0; k < n; k++) {
        const i = pt.base + k;
        const h = hTear[i];
        if (h < -0.016) continue;
        let disp = 0;
        if (press > 0 && !detached) {
          const dx = mx[i] - xTip, dy = my[i] - yT0;
          disp -= 0.0007 * press * Math.exp(-(dx * dx + dy * dy) / (0.006 * 0.006));
        }
        const c = col[i];
        const w = c >= 0 ? wCol[c] : wCol[0];
        const mouth = w * 0.3 + open;
        if (mouth > 0) {
          const f = Math.max(0, 1 + h / 0.016);
          disp += 0.0032 * mouth * f * f * (sheet[i] === SHEET.FIN ? 0.5 : 1);
        }
        if (disp !== 0) { P[i * 3] += nx[i] * disp; P[i * 3 + 2] += nz[i] * disp; }
      }
    }
  }

  function evalBack(state) {
    const p = state.p;
    const detached = state.phase === "detached" || state.phase === "revealed";
    const thetaMax = 1.05 + 0.3 * state.pull; // ~60° doors at the widest, a little more when pulled sideways
    wRowB.clear();
    for (let i = 0; i < count; i++) {
      const side = flap[i];
      if (!side) continue;
      let w = detached ? 1 : smoothstep(0, TW_BACK, p - routeB[i]);
      if (w <= 0) continue;
      const tp = taper[i];
      const wv = w * tp;
      const theta = detached ? (state.flapOpen * 1.45 + (1 - state.flapOpen) * thetaMax) * tp : wv * thetaMax;
      // fin free edge unglues: lift it off the flap before hinging
      let rz = P[i * 3 + 2];
      if (finK[i] > 0) rz -= wv * 0.0022 * (finK[i] / 2);
      const hx = side * R_HINGE;
      const dx = P[i * 3] - hx, dz = rz;
      const cs = Math.cos(theta), sn = Math.sin(theta);
      P[i * 3] = hx + dx * cs - side * dz * sn;
      P[i * 3 + 2] = side * dx * sn + dz * cs;
      // per-row weight for the fin ribbons (rows key by their nominal y)
      if (col[i] === 0 || col[i] === cols - 1) {
        const y = my[i];
        if (!wRowB.has(y)) wRowB.set(y, w);
      }
    }
    // the ribbons key by patch rowY; map nearest rows
    const keyed = new Map();
    for (const pt of [patches.body, patches.header]) {
      for (let r = 0; r < pt.rows; r++) {
        const i = idx(pt, r, 0);
        const w = detached ? 1 : smoothstep(0, TW_BACK, p - routeB[i]) * taper[i];
        keyed.set(pt.rowY[r], w);
      }
    }
    wRowB.clear();
    for (const [k, v] of keyed) wRowB.set(k, v);
  }

  // joined seam pairs share one normal (averaged); released ones keep their own
  const N = geometry.attributes.normal.array;
  function reconcile(state) {
    const front = state.mode === "front";
    for (const [a, b, c] of seams.tear) {
      const joined = front ? (c < 0 ? wCol[0] : wCol[c]) < 0.5 : true;
      if (joined) avg(a, b);
    }
    for (const [a, b, y] of seams.fin) {
      const joined = front ? true : (wRowB.get(y) || 0) < 0.5;
      if (joined) avg(a, b);
    }
  }
  function avg(a, b) {
    let x = N[a * 3] + N[b * 3], y = N[a * 3 + 1] + N[b * 3 + 1], z = N[a * 3 + 2] + N[b * 3 + 2];
    const L = Math.hypot(x, y, z) || 1;
    x /= L; y /= L; z /= L;
    N[a * 3] = x; N[a * 3 + 1] = y; N[a * 3 + 2] = z;
    N[b * 3] = x; N[b * 3 + 1] = y; N[b * 3 + 2] = z;
  }

  // freeze the header's current shape for the rigid fly-off
  function captureCap() {
    capPos = new Float32Array(capIdx.length * 3);
    for (let k = 0; k < capIdx.length; k++) {
      const i = capIdx[k];
      capPos[k * 3] = P[i * 3]; capPos[k * 3 + 1] = P[i * 3 + 1]; capPos[k * 3 + 2] = P[i * 3 + 2];
    }
    // centroid of the cap, for the throw's pivot
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < capIdx.length; k++) { cx += capPos[k * 3]; cy += capPos[k * 3 + 1]; cz += capPos[k * 3 + 2]; }
    const n = capIdx.length;
    return { x: cx / n, y: cy / n, z: cz / n };
  }

  function reset() {
    capPos = null;
    chain.reset();
    P.set(rest);
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    ribbonGeo.attributes.position.array.fill(0);
    ribbonGeo.attributes.position.needsUpdate = true;
  }

  return {
    evaluate,
    reset,
    captureCap,
    chain,
    strips,
    ribbonGeo,
    wCol,
    tipLocal: (state) => (state.mode === "front"
      ? { x: -a0 + state.p * W, y: yT0, z: b0 }
      : { x: 0, y: ySeal - state.p * 2 * ySeal, z: -b0 }),
  };
}

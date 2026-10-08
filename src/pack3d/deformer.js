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
//   BACK pull (the fin-seam pop) — nothing tears. The hand hauls on the seam
//   and the pack STRAINS by `state.strain` (0–1): the body inflates (pressure
//   inside), the baked creases deepen, stress pleats converge on the gripped
//   seam top, the pouch stretches lengthwise and narrows, and the seam gapes in
//   a sliver just below the top crimp. At the limit the seal lets go all at
//   once: both back halves hinge open about their side folds together (the
//   spring-driven `flapOpen`, with overshoot), the strain RINGS back through
//   zero (the recoil — sucks in, puffs out) and the fin ribbon rides the right
//   flap with its free edge lifted.
//
// After deformation the normals are recomputed and the still-joined seam pairs
// reconciled (averaged), so the pre-split topology shades as one closed surface.
// Torn-edge ribbons are rebuilt along the released boundary samples only.

import * as THREE from "three";
import { createChain } from "./chain.js";
import { OWNER, SHEET, smoothstep } from "./geometry.js";

const TW_FRONT = 0.05; // release transition (fraction of the route) behind the tip

export function createDeformer(pack, cfg, { reduced = false } = {}) {
  const { geometry, rest, count, meta, seams, dims, cols, patches, idx } = pack;
  const { mx, my, mz, nx, nz, owner, sRoute, hTear, flap, taper, routeB, finK, sheet, col } = meta;
  const posAttr = geometry.attributes.position;
  const P = posAttr.array;
  const chain = createChain(cfg.tier.stations);
  const { a0, aT, b0, yT0, ySeal } = dims;
  const WT = 2 * aT; // the header's width at the tear line (the crimp flares past the body)
  const R_HINGE = a0 - 0.0011;

  // wrinkle offsets (rest − raw), carried into the swept frame
  const wox = new Float32Array(count);
  const woz = new Float32Array(count);
  for (let i = 0; i < count; i++) { wox[i] = rest[i * 3] - mx[i]; woz[i] = rest[i * 3 + 2] - mz[i]; }

  // the back pull's strain fields, per vertex (baked once)
  const { yBodyEnd } = dims;
  const bodyW = new Float32Array(count); // 1 through the body → 0 into the shoulders/seals
  const faceG = new Float32Array(count); // how much each sheet inflates (the pulled back most)
  const gapeW = new Float32Array(count); // the seam's pre-pop sliver: a lens below the top crimp
  const pleat = new Float32Array(count); // stress pleats fanning out from the gripped seam top
  const yGrip = ySeal - 0.004; // where the hand holds the seam
  for (let i = 0; i < count; i++) {
    const x = mx[i], y = my[i], ay = Math.abs(y);
    bodyW[i] = 1 - smoothstep(yBodyEnd - 0.004, yBodyEnd + 0.003, ay);
    const sh = sheet[i];
    faceG[i] = sh === SHEET.BACK ? 1 : sh === SHEET.FRONT ? 0.55 : sh === SHEET.FIN ? 0.3 : 0.4;
    gapeW[i] = flap[i] ? Math.sin(Math.PI * Math.min(1, routeB[i] / 0.34)) : 0;
    if (sh === SHEET.BACK || sh === SHEET.FIN) {
      const dx = x, dy = yGrip - y;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dx, Math.max(0.002, dy));
      // pleats converge on the grip: tighter near it, fading down the back and into the seals
      const fall = Math.exp(-dist / 0.034) * (1 - smoothstep(ySeal - 0.006, ySeal, ay)) * (1 - smoothstep(0, 0.006, Math.max(0, y - yGrip)));
      pleat[i] = Math.sin(ang * 9 + dist * 260) * fall;
    }
  }

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
  // all four strips live in ONE geometry (one draw call): each owns a slice of it.
  // Vertex colours carry the light: silver laminate that runs hot where the torn
  // edge sits next to the light escaping at the tip.
  const ribbonGeo = new THREE.BufferGeometry();
  let ribbonCol = null, ribbonColAttr = null;
  {
    let total = 0;
    for (const s of Object.values(strips)) { s.offset = total; total += s.entries.length; }
    const arr = new Float32Array(total * 2 * 3);
    const at = new THREE.BufferAttribute(arr, 3);
    at.setUsage(THREE.DynamicDrawUsage);
    ribbonGeo.setAttribute("position", at);
    ribbonCol = new Float32Array(total * 2 * 3);
    ribbonCol.fill(0.95);
    ribbonColAttr = new THREE.BufferAttribute(ribbonCol, 3);
    ribbonColAttr.setUsage(THREE.DynamicDrawUsage);
    ribbonGeo.setAttribute("color", ribbonColAttr);
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
  const SILVER = [0.93, 0.95, 0.98], HOT = [1.0, 0.93, 0.76];
  function writeStrip(s, weightOf, heatOf = null) {
    const { entries, arr } = s;
    let any = false;
    for (let i = 0; i < entries.length; i++) {
      const [e, inner, key] = entries[i];
      const w = weightOf(key);
      const heat = heatOf ? Math.min(1, heatOf(key)) : 0;
      const co = (s.offset + i) * 6;
      for (let k = 0; k < 3; k++) {
        const v = SILVER[k] + (HOT[k] - SILVER[k]) * heat;
        ribbonCol[co + k] = v; ribbonCol[co + 3 + k] = v;
      }
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
    ribbonColAttr.needsUpdate = true;
    return any;
  }

  // ---- evaluation ---------------------------------------------------------------
  // state: { mode, phase, p, grip, pull, press, open, flapOpen, capMatrix }
  // light (optional): { heat (0..1, the light inside), tipX, tipY } — heats the torn edges
  function evaluate(state, dt, light = null) {
    P.set(rest);
    if (state.mode === "front") evalFront(state, dt);
    else evalBack(state, dt);
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    reconcile(state);
    geometry.attributes.normal.needsUpdate = true;
    // ribbons (+ their heat: the edge nearest the light runs hot, the rest warms a little)
    const heat = light?.heat || 0;
    if (state.mode === "front") {
      const wf = (c) => (c < 0 ? 0 : wCol[c]);
      const hf = heat > 0 ? (c) => { const d = (pack.colX0[c < 0 ? 0 : c] - light.tipX) / 0.013; return heat * (0.3 + 0.7 * Math.exp(-d * d)); } : null;
      writeStrip(strips.tearBody, wf, hf);
      writeStrip(strips.tearHeader, wf, hf);
      writeStrip(strips.finL, () => 0);
      writeStrip(strips.finR, () => 0);
    } else {
      writeStrip(strips.tearBody, () => 0);
      writeStrip(strips.tearHeader, () => 0);
      const wb = (y) => wRowB.get(y) || 0;
      const hb = heat > 0 ? (y) => { const d = (y - light.tipY) / 0.013; return heat * (0.3 + 0.7 * Math.exp(-d * d)); } : null;
      writeStrip(strips.finL, wb, hb);
      writeStrip(strips.finR, wb, hb);
    }
  }

  function evalFront(state, dt) {
    const p = state.p;
    const xTip = -aT + p * WT;
    const L = Math.max(0.0008, p * WT);
    const detached = state.phase === "detached" || state.phase === "revealed";
    for (let c = 0; c < cols; c++) {
      const x = pack.colX0[c];
      wCol[c] = detached ? 1 : smoothstep(0, TW_FRONT, (xTip - x) / WT);
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
          const w = smoothstep(0, TW_FRONT, d / WT);
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

  // the back PULL: the strain field, then the hinge (a sliver before the pop,
  // the doors after it). `s` may ring negative after the pop (the recoil).
  const THETA_OPEN = 1.5; // the flaps' open angle at flapOpen = 1 (~86°; the spring overshoots past it)
  const GAPE = 0.075; // hinge angle of the pre-pop sliver at full strain (~4 mm at the seam)
  function evalBack(state) {
    const detached = state.phase === "detached" || state.phase === "revealed";
    const s = Math.max(-1, Math.min(1, state.strain));
    const sa = Math.abs(s);
    const ss = s * sa; // signed square: inflates on the outward swing, sucks in on the inward one
    const g = detached ? Math.max(0, s) : sa; // the sliver fades through the pop (the doors take over)
    const g2 = g * g;
    const open = Math.max(0, state.flapOpen);
    const stretch = 1 + 0.08 * s; // lengthwise, along the seam
    const narrow = 1 - 0.03 * s; // across (the foil gives in the pull's direction)
    const puff = 0.0032 * ss; // inflation along the rest normal
    const crease = 1.0 * sa; // the baked wrinkles deepen under tension
    const pleatAmp = 0.0007 * sa * sa; // the stress pleats arrive late in the pull
    const hinge = R_HINGE * narrow;
    for (let i = 0; i < count; i++) {
      // 1) material strain
      const bw = bodyW[i];
      let d = puff * bw * faceG[i] + pleatAmp * pleat[i] * bw;
      let px = P[i * 3] + nx[i] * d + wox[i] * crease;
      let py = P[i * 3 + 1];
      let pz = P[i * 3 + 2] + nz[i] * d + woz[i] * crease;
      // 2) the pouch stretches toward the hand and narrows
      px *= narrow;
      py *= stretch;
      // 3) the hinge: the sliver (pre-pop) + the doors (post-pop), about the side fold
      const side = flap[i];
      if (side) {
        const theta = GAPE * g2 * gapeW[i] + open * THETA_OPEN * taper[i];
        if (theta > 1e-5) {
          // the fin's free edge unglues from the flap before hinging with it
          if (finK[i] > 0) pz -= Math.min(1, open * 1.6 + g2 * gapeW[i]) * 0.0022 * (finK[i] / 2);
          const hx = side * hinge;
          const dx = px - hx, dz = pz;
          const cs = Math.cos(theta), sn = Math.sin(theta);
          px = hx + dx * cs - side * dz * sn;
          pz = side * dx * sn + dz * cs;
        }
      }
      P[i * 3] = px; P[i * 3 + 1] = py; P[i * 3 + 2] = pz;
    }
    // the fin ribbons (the exposed seal edge) only exist once the seal has let go
    wRowB.clear();
    if (detached) {
      const w = Math.min(1, open * 2.5);
      for (const pt of [patches.body, patches.header]) for (let r = 0; r < pt.rows; r++) wRowB.set(pt.rowY[r], w);
    }
  }

  // joined seam pairs share one normal (averaged); released ones keep their own
  const N = geometry.attributes.normal.array;
  function reconcile(state) {
    const front = state.mode === "front";
    for (const [a, b, c] of seams.tear) {
      const joined = front ? (c < 0 ? wCol[0] : wCol[c]) < 0.5 : true;
      if (joined) avg(a, b);
    }
    const popped = !front && (state.phase === "detached" || state.phase === "revealed");
    for (const [a, b] of seams.fin) {
      if (!popped) avg(a, b);
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
    wRowB,
    tipLocal: (state) => (state.mode === "front"
      ? { x: -aT + state.p * WT, y: yT0, z: b0 }
      : { x: 0.0015 + state.pullX * 0.2, y: ySeal - 0.004 + state.pullY * 0.2, z: -b0 }),
  };
}

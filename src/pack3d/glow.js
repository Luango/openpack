// pack3d/glow.js — the light at the seam: trapped, then let out through the tear.
//
// A thin additive strip that rides the pack's own tear boundary every frame:
//   • gripped, before the first break — a single pin of gold light leaking at the
//     notch under the fingers, swelling as the foil strains. NOTHING along the rest
//     of the route: the player feels the pack about to give, they are never shown
//     where the tear will run (anticipation, not a trail);
//   • tearing — behind the tip, where the header has lifted, the strip grows into
//     a short slab of light in the mouth: a near-white core at the lip fading up
//     through warm gold, hottest around the tip (the light follows the tear).
//     Ahead of the tip the foil is still sealed and stays DARK, except for the
//     few millimetres right at the tip where it is giving way;
//   • open — the whole mouth burns, breathing with the inner light.
// It is depth-tested, so the foil still in place hides it: the light shows only
// where the pack has actually been opened. Positions come from the deformed lip
// vertices (the body's top row for the front rip; the duplicated back-centre
// column pair for the fin seam), so it bulges and curls with the mouth.

import * as THREE from "three";

const ROWS = 3;
const OUT = 0.00035; // metres outside the surface, so the seam never z-fights the foil
const HOT = [1.0, 0.98, 0.92];
const GOLD = [1.0, 0.79, 0.38];
const EMBER = [1.0, 0.56, 0.14];
const SEAM = [1.0, 0.8, 0.4]; // the sealed seam leaks gold; the open mouth burns white

export function createSeamGlow(pack, deformer) {
  const { geometry, patches, cols, idx, colX0 } = pack;
  const P = geometry.attributes.position.array;
  const N = geometry.attributes.normal.array;
  const bTop = patches.body.rows - 1;
  // back route: the seam runs down the body + header rows at columns 0 / cols-1
  const backRows = [];
  for (const p of [patches.body, patches.header]) for (let r = 0; r < p.rows; r++) backRows.push({ p, r, y: p.rowY[r] });
  backRows.sort((a, b) => a.y - b.y);
  const segs = Math.max(cols, backRows.length);

  const n = segs * ROWS;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 4);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3); posAttr.setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(col, 4); colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("color", colAttr);
  const ind = [];
  for (let s = 0; s < segs - 1; s++) {
    for (let r = 0; r < ROWS - 1; r++) {
      const a = s * ROWS + r, b = a + 1, d = a + ROWS, e = d + 1;
      ind.push(a, d, b, b, d, e);
    }
  }
  geo.setIndex(ind);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.visible = false;
  let activeSegs = 0;

  const tint = { hot: HOT.slice(), gold: GOLD.slice(), ember: EMBER.slice(), seam: SEAM.slice() };
  const lipCol = [0, 0, 0];
  const lip = (rel) => { for (let k = 0; k < 3; k++) lipCol[k] = tint.seam[k] + (tint.hot[k] - tint.seam[k]) * rel; return lipCol; };
  function setTint(hex) {
    // warm the gold a touch toward the tier colour (the tell), never away from gold
    const c = new THREE.Color(hex);
    tint.gold = [GOLD[0] * 0.75 + c.r * 0.25, GOLD[1] * 0.75 + c.g * 0.25, GOLD[2] * 0.75 + c.b * 0.25];
    tint.ember = [EMBER[0] * 0.7 + c.r * 0.3, EMBER[1] * 0.7 + c.g * 0.3, EMBER[2] * 0.7 + c.b * 0.3];
  }

  // additive (src alpha, one): the vertex alpha scales the light the strip adds
  const setV = (k, x, y, z, c, a) => {
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    col[k * 4] = c[0]; col[k * 4 + 1] = c[1]; col[k * 4 + 2] = c[2]; col[k * 4 + 3] = Math.min(1, a);
  };

  // light = { seam (0..1, the leak at the tip), inner (0..1, the open glow), strain (0..1), tipX, tipY, mode, open (0/1 when detached) }
  function update(light) {
    const seam = light.seam, inner = light.inner, strain = Math.max(0, Math.min(1, light.strain || 0));
    if (seam < 0.004 && inner < 0.004) { mesh.visible = false; return; }
    let maxA = 0;
    if (light.mode === "front") {
      activeSegs = cols;
      const w = deformer.wCol;
      for (let c = 0; c < cols; c++) {
        const e = idx(patches.body, bTop, c), i = idx(patches.body, bTop - 1, c);
        const ex = P[e * 3], ey = P[e * 3 + 1], ez = P[e * 3 + 2];
        let ux = ex - P[i * 3], uy = ey - P[i * 3 + 1], uz = ez - P[i * 3 + 2];
        const L = Math.hypot(ux, uy, uz) || 1; ux /= L; uy /= L; uz /= L;
        const nx = N[e * 3], ny = N[e * 3 + 1], nz = N[e * 3 + 2];
        const rel = light.open ? 1 : w[c]; // released behind the tip
        const dx = (colX0[c] - light.tipX) / 0.014;
        const tipHot = Math.exp(-dx * dx);
        // the sealed foil ahead of the tip stays dark: the leak lives only in the
        // few millimetres at the tip itself (a touch wider the harder the foil strains)
        const da = Math.max(0, colX0[c] - light.tipX) / (0.005 + 0.004 * strain);
        const atTip = Math.exp(-da * da);
        const aOpen = light.open ? inner * (0.8 + 0.2 * tipHot) : inner * (0.5 + 0.5 * tipHot);
        const aSeam = seam * atTip * (0.7 + 0.3 * tipHot);
        const a = rel * aOpen + (1 - rel) * aSeam;
        const h = light.open ? 0.004 + 0.011 * inner : rel * (0.0025 + 0.0065 * inner) + (1 - rel) * (0.0018 + 0.0012 * strain) * atTip;
        const ox = ex + nx * OUT, oy = ey + ny * OUT, oz = ez + nz * OUT;
        const k = c * ROWS;
        setV(k, ox - ux * 0.0006, oy - uy * 0.0006, oz - uz * 0.0006, lip(rel), a);
        setV(k + 1, ox + ux * h * 0.32, oy + uy * h * 0.32, oz + uz * h * 0.32, tint.gold, a * 0.55);
        setV(k + 2, ox + ux * h, oy + uy * h, oz + uz * h, tint.ember, 0);
        if (a > maxA) maxA = a;
      }
    } else {
      activeSegs = backRows.length;
      const wRow = deformer.wRowB;
      for (let s = 0; s < backRows.length; s++) {
        const { p, r, y } = backRows[s];
        const a0 = idx(p, r, 0), a1 = idx(p, r, cols - 1);
        const ex = (P[a0 * 3] + P[a1 * 3]) / 2, ey = (P[a0 * 3 + 1] + P[a1 * 3 + 1]) / 2, ez = (P[a0 * 3 + 2] + P[a1 * 3 + 2]) / 2;
        const rel = light.open ? 1 : (wRow.get(y) || 0);
        const dy = (y - light.tipY) / 0.014;
        const tipHot = Math.exp(-dy * dy);
        // the pull: the leak sits at the sliver below the crimp that is about to give,
        // spreading down the seam only as the strain climbs — never the whole fin
        const ds = (y - light.tipY) / (0.006 + 0.012 * strain);
        const atTip = Math.exp(-ds * ds);
        const aOpen = light.open ? inner * (0.8 + 0.2 * tipHot) : inner * (0.5 + 0.5 * tipHot);
        const aSeam = seam * atTip * (0.7 + 0.3 * tipHot);
        const a = rel * aOpen + (1 - rel) * aSeam;
        const h = light.open ? 0.0035 + 0.01 * inner : rel * (0.002 + 0.006 * inner) + (1 - rel) * (0.0018 + 0.0012 * strain) * atTip;
        // the ridge straddles the seam: ember → hot core → ember, just outside the back (−z)
        const oz = ez - OUT;
        const k = s * ROWS;
        setV(k, ex - h, ey, oz, tint.ember, 0);
        setV(k + 1, ex, ey, oz, lip(rel), a);
        setV(k + 2, ex + h, ey, oz, tint.ember, 0);
        if (a > maxA) maxA = a;
      }
    }
    geo.setDrawRange(0, (activeSegs - 1) * (ROWS - 1) * 6);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    mesh.visible = maxA > 0.004;
  }

  function reset() { mesh.visible = false; }
  function dispose() { geo.dispose(); mat.dispose(); }

  return { mesh, update, reset, dispose, setTint };
}

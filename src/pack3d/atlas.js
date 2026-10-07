// pack3d/atlas.js — the one stable UV atlas every wrapper patch samples.
//
// Islands (u right, v UP — three.js convention; the canvas painter flips):
//
//   ┌──────────────┬──────────────┐  v=0.98
//   │    FRONT     │     BACK     │   the printed sheets, full pack height
//   │   (art)      │    (art)     │
//   ├──────────────┴──────────────┤  v≈0.22
//   │ side R ───────────────────  │   thin horizontal strips: u runs the pack
//   │ side L ───────────────────  │   HEIGHT (bottom→top), v across the strip
//   │ fin   ───────────────────   │
//   └─────────────────────────────┘  v=0
//
// Every vertex's UV is derived from its ORIGINAL material position, so the
// duplicated tear vertices keep the UVs of their source and the print splits
// exactly at the tear. Islands are padded (the painter bleeds each one ~12 px)
// so mip filtering never pulls a neighbour in.

export function atlasLayout(artAspect = 1.657) {
  const artW = 0.45;
  const artH = Math.min(0.75, artW * artAspect); // 0.7456 at the real art's aspect
  const top = 0.985;
  const art = { v0: top - artH, v1: top };
  const strip = 0.034;
  const gap = 0.012;
  const s0 = art.v0 - 0.035;
  return {
    front: { u0: 0.02, u1: 0.02 + artW, ...art },
    back: { u0: 0.53, u1: 0.53 + artW, ...art },
    sideR: { u0: 0.02, u1: 0.98, v0: s0 - strip, v1: s0 },
    sideL: { u0: 0.02, u1: 0.98, v0: s0 - 2 * strip - gap, v1: s0 - strip - gap },
    fin: { u0: 0.02, u1: 0.98, v0: s0 - 3 * strip - 2 * gap, v1: s0 - 2 * strip - 2 * gap },
  };
}

// (s, t) ∈ [0,1]² inside an island → atlas (u, v)
export function uvIn(rect, s, t) {
  return [rect.u0 + (rect.u1 - rect.u0) * s, rect.v0 + (rect.v1 - rect.v0) * t];
}

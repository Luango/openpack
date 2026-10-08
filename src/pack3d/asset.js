// pack3d/asset.js — the ONE pack asset every renderer shares.
//
// The carousel (select3d.js) and the tear stage (view.js) each run their own
// three.js renderer, but they show the same object: the procedural foil pouch.
// This module loads the printed art once, paints the texture atlas once, builds
// the surface maps once (in idle slices), and hands out:
//
//   showGeometry  — a lighter, STATIC envelope at rest, rescaled so the pack is
//                   1 unit wide and `aspect` tall (the carousel's convention),
//                   one material group → one draw call per pack on the wheel
//   buildTear()   — the full-density deformable envelope with its seam table,
//                   in metres, for the tear stage
//   map / normalMap / ormMap — shared textures (each renderer uploads its own copy);
//                  the brand + pack name get their own finish in the surface maps
//                  from the print masks (textures.js)
//
// So the pack you spin on the wheel, the hero that flies to the lens and the
// pouch you tear are the same shape, same print, same finish.

import * as THREE from "three";
import { makeConfig, pickQuality } from "./config.js";
import { buildPack } from "./geometry.js";
import { atlasLayout } from "./atlas.js";
import { loadImage, paintAtlas, paintPrintMask, buildSurfaceMaps } from "./textures.js";

const COARSE = window.matchMedia?.("(pointer: coarse)").matches ?? false;

let _asset = null;

export function getPackAsset(overrides = {}) {
  if (_asset) return _asset;
  _asset = (async () => {
    const cfg = makeConfig({ quality: pickQuality(), ...overrides });
    // phones map a smaller print: ~half the bytes to fetch, decode and upload, and the
    // low tier's 1024 atlas can't use more anyway (mirrors the index.html preloads)
    if (COARSE && !overrides.artFront) cfg.artFront = cfg.artFront.replace("pack-hi.webp", "pack-hi-720.webp");
    if (COARSE && !overrides.artBack) cfg.artBack = cfg.artBack.replace("pack-back-hi.webp", "pack-back-hi-720.webp");
    const [front, back, cardBack, printFront, printBack] = await Promise.all([
      loadImage(cfg.artFront).catch(() => null),
      loadImage(cfg.artBack).catch(() => null),
      loadImage(cfg.cardBack).catch(() => null),
      loadImage(cfg.printFront).catch(() => null),
      loadImage(cfg.printBack).catch(() => null),
    ]);
    const aspect = front ? front.naturalHeight / front.naturalWidth : 1.657;
    cfg.heightM = cfg.widthM * aspect;
    const layout = atlasLayout(aspect);
    const { texture: map } = paintAtlas(cfg, layout, { front, back });
    const print = paintPrintMask(cfg, layout, { front: printFront, back: printBack }, cfg.tier.normal);
    const surface = buildSurfaceMaps(cfg, layout, map.image, { W: cfg.widthM, H: cfg.heightM, seal: cfg.sealHeightM, shoulder: cfg.shoulderM }, print);

    // the showroom envelope: the same loft at a lighter density, at rest, 1 unit wide
    const showTier = { ...cfg.tier, frontCols: 30, arcCols: 5, backHalfCols: 15, rowSpacing: 0.0042, tearRowSpacing: 0.003, shoulderRowSpacing: 0.0026 };
    const show = buildPack({ ...cfg, tier: showTier }, aspect);
    const showGeometry = show.geometry;
    showGeometry.clearGroups();
    showGeometry.scale(1 / cfg.widthM, 1 / cfg.widthM, 1 / cfg.widthM);
    showGeometry.computeBoundingSphere();
    showGeometry.computeBoundingBox();

    // plain art textures for the flat floor reflections
    const plain = (img) => { if (!img) return null; const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; };
    const frontTex = plain(front), backTex = plain(back);

    return {
      cfg, aspect, layout, front, back, cardBack, frontTex, backTex,
      map, normalMap: surface.normalMap, normalMapIn: surface.normalMapIn, ormMap: surface.ormMap, surfaceReady: surface.whenReady,
      showGeometry,
      showStats: show.stats,
      buildTear: () => buildPack(cfg, aspect),
    };
  })();
  return _asset;
}

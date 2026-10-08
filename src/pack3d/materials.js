// pack3d/materials.js — PackMaterials: exterior, interior, exposed edges, cards.
//
// The wrapper is ONE deforming surface rendered twice: the exterior material on
// front-facing polygons, the interior (inner foil) on back-facing ones — opposite
// culling, never two coplanar DoubleSide meshes. The header gets its own clones
// so it can fade while flying clear without touching the body. Maps are used as
// the full values, so the scalar roughness/metalness multipliers stay at 1.

import * as THREE from "three";

// The pack is a few centimetres across, and three's physically-based point-light
// falloff flattens out inside 10 cm (1 / max(d², 0.01)) — the light inside the
// pack would reach its bottom as brightly as its mouth. Patch that floor out of the
// shader of every surface the inner light touches, so it falls off as 1 / d² at
// this scale: bright at the torn mouth, dark by the lower half.
const NEAR = "max( pow( lightDistance, decayExponent ), 0.01 )";
export function nearLight(m) {
  m.onBeforeCompile = (shader) => { shader.fragmentShader = shader.fragmentShader.replace(NEAR, "max( pow( lightDistance, decayExponent ), 0.000004 )"); };
  m.customProgramCacheKey = () => "nearlight";
  return m;
}

// The exterior's base exposure: how much of the reflection room the foil shows, and
// a little self-light from its own print (the carousel's packs carry the same, see
// select3d.js makePackMaterial) so the gold reads whatever the backdrop behind it —
// the stage's room dims both with `light.room` during the open (view.js stepLight).
export const EXT_ENV = 0.85;
export const EXT_EMI = 0.1;
// the bare foil's gold (what the laminate is under the print): the metal's reflectance
export const INT_GOLD = 0xd6aa5e;
export function makeMaterials({ map, normalMap, normalMapIn = normalMap, ormMap }) {
  const ext = () => nearLight(new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: ormMap,
    metalnessMap: ormMap,
    roughness: 1,
    metalness: 1,
    envMapIntensity: EXT_ENV,
    emissive: 0xffffff,
    emissiveMap: map,
    emissiveIntensity: EXT_EMI,
    side: THREE.FrontSide,
  }));
  // the inner foil: the SAME gold laminate as the outside, unprinted — the foil's
  // crinkle relief at full strength (the crinkle-only normal map: no raised ink on
  // this face) over a bare gold base, a touch more matte than the print side. A hair
  // short of a pure metal so the light inside the pack (a point light at the tear,
  // view.js) still lands on it as a warm glow and not only a specular streak; the
  // emissive is the inside catching that light, driven from 0 while the pack is sealed.
  const int = () => nearLight(new THREE.MeshStandardMaterial({
    color: INT_GOLD,
    normalMap: normalMapIn,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.4,
    metalness: 0.9,
    envMapIntensity: EXT_ENV,
    emissive: 0xffb347,
    emissiveIntensity: 0,
    side: THREE.BackSide,
  }));
  const bodyExt = ext(), bodyInt = int(), headerExt = ext(), headerInt = int();
  // the torn laminate edge: unlit bright silver, so it reads at any angle; its
  // vertex colours run hot near the light at the tear (deformer.js writes them)
  const ribbon = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  return { bodyExt, bodyInt, headerExt, headerInt, ribbon, all: [bodyExt, bodyInt, headerExt, headerInt, ribbon] };
}

// The card back's two finishes. At rest (the stack in the pack, the gathered deck at
// the hand-off) it is the DOM back's look: a near-matte print that carries some of its
// own light, so the 3D stack matches `.slot__back` across the cross-fade. In FLIGHT
// (the burst) it is FOIL: a metal that mirrors the room, with a holographic band —
// a bright diagonal stripe, interference-tinted, that slides across the card as it
// turns toward and away from the lens (`foil` 0..1, driven by view.js stepBurst).
// Both carry the back's relief (card-back-normal.png: the raised brand + ripples).
export const BACK_REST = { metalness: 0.08, roughness: 0.5, envMapIntensity: 0.55, emissiveIntensity: 0.3 };
export const BACK_FOIL = { metalness: 0.62, roughness: 0.3, envMapIntensity: 1.15, emissiveIntensity: 0.2 };
export function setFoil(mat, f) {
  const u = mat.userData.foil;
  if (!u) return;
  u.value = f;
  const mix = (k) => BACK_REST[k] + (BACK_FOIL[k] - BACK_REST[k]) * f;
  mat.metalness = mix("metalness");
  mat.roughness = mix("roughness");
  mat.envMapIntensity = mix("envMapIntensity");
  mat.emissiveIntensity = mix("emissiveIntensity");
}
const FOIL_BAND = /* glsl */ `
#include <emissivemap_fragment>
#ifdef USE_MAP
if ( uFoil > 0.001 ) {
  // the holographic band: a diagonal stripe whose place on the card follows the tilt
  // of the (relief-perturbed) surface toward the lens — it slides as the card turns
  vec3 nV = normalize( normal );
  vec3 vV = normalize( vViewPosition );
  float tilt = nV.x * 0.9 + nV.y * 0.55;
  float dg = vMapUv.x * 0.62 + vMapUv.y * 0.78;
  float c = 0.55 + 2.2 * tilt;
  float band = exp( -pow( ( dg - c ) / 0.1, 2.0 ) ) + 0.45 * exp( -pow( ( dg - c + 0.26 ) / 0.15, 2.0 ) );
  // interference colour along the stripe, tamed toward the foil's own warm white
  float hue = dg * 4.0 + tilt * 3.0;
  vec3 rb = 0.5 + 0.5 * cos( 6.2831 * ( hue + vec3( 0.0, 0.33, 0.67 ) ) );
  vec3 col = mix( vec3( 1.0, 0.92, 0.72 ), rb, 0.58 );
  // the dark ink keeps its ink: the band lives on the gold, and grows toward grazing
  float lum = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
  float fres = pow( 1.0 - max( dot( nV, vV ), 0.0 ), 1.5 );
  totalEmissiveRadiance += col * band * uFoil * ( 0.25 + 0.75 * lum ) * ( 0.75 + 0.6 * fres ) * 1.05;
}
#endif
`;
function backMaterial({ cardBack, cardBackNormal, foil }) {
  const m = new THREE.MeshStandardMaterial({
    map: cardBack, ...BACK_REST, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: cardBack,
    normalMap: cardBackNormal || null, normalScale: new THREE.Vector2(1.4, 1.4),
  });
  if (!foil) return nearLight(m);
  const uFoil = { value: 0 };
  m.userData.foil = uFoil;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFoil = uFoil;
    shader.fragmentShader = shader.fragmentShader
      .replace(NEAR, "max( pow( lightDistance, decayExponent ), 0.000004 )")
      .replace("uniform vec3 emissive;", "uniform vec3 emissive;\nuniform float uFoil;")
      .replace("#include <emissivemap_fragment>", FOIL_BAND);
  };
  m.customProgramCacheKey = () => "nearlight-foil";
  return m;
}

export function makeCardMaterials({ cardBack, cardBackNormal = null, edge, foil = false }) {
  const face = nearLight(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.08, envMapIntensity: 0.6, alphaTest: 0.5 }));
  // the back is the gold frame — SHAPED (alpha outside the frame), so it's cut out like
  // the face is; a fade (the burst hand-off) must scale alphaTest with opacity
  const back = backMaterial({ cardBack, cardBackNormal, foil });
  const rim = nearLight(new THREE.MeshStandardMaterial({ map: edge, roughness: 0.7, metalness: 0.05 }));
  const deckTop = backMaterial({ cardBack, cardBackNormal, foil: false });
  return { face, back, rim, deckTop, all: [face, back, rim, deckTop] };
}

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

export function makeMaterials({ map, normalMap, ormMap }) {
  const ext = () => nearLight(new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: ormMap,
    metalnessMap: ormMap,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 1.15,
    side: THREE.FrontSide,
  }));
  // the inner foil: bare silver, softer than the print side. Not a pure metal, so
  // the light inside the pack (a point light at the tear, view.js) lands on it as a
  // warm diffuse glow and not just a specular dot; the emissive is the inside
  // catching that light, driven from 0 while the pack is sealed.
  const int = () => nearLight(new THREE.MeshStandardMaterial({
    color: 0xd4d8df,
    normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.5,
    metalness: 0.72,
    envMapIntensity: 0.9,
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

export function makeCardMaterials({ cardBack, edge }) {
  const face = nearLight(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.08, envMapIntensity: 0.6, alphaTest: 0.5 }));
  const back = nearLight(new THREE.MeshStandardMaterial({ map: cardBack, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.5 }));
  const rim = nearLight(new THREE.MeshStandardMaterial({ map: edge, roughness: 0.7, metalness: 0.05 }));
  const deckTop = nearLight(new THREE.MeshStandardMaterial({ map: cardBack, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.5 }));
  return { face, back, rim, deckTop, all: [face, back, rim, deckTop] };
}

// pack3d/materials.js — PackMaterials: exterior, interior, exposed edges, cards.
//
// The wrapper is ONE deforming surface rendered twice: the exterior material on
// front-facing polygons, the interior (inner foil) on back-facing ones — opposite
// culling, never two coplanar DoubleSide meshes. The header gets its own clones
// so it can fade while flying clear without touching the body. Maps are used as
// the full values, so the scalar roughness/metalness multipliers stay at 1.

import * as THREE from "three";

export function makeMaterials({ map, normalMap, ormMap }) {
  const ext = () => new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: ormMap,
    metalnessMap: ormMap,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 1.15,
    side: THREE.FrontSide,
  });
  const int = () => new THREE.MeshStandardMaterial({
    color: 0xd4d8df, // inner foil — bare silver, softer than the print side
    normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.46,
    metalness: 1,
    envMapIntensity: 0.9,
    side: THREE.BackSide,
  });
  const bodyExt = ext(), bodyInt = int(), headerExt = ext(), headerInt = int();
  // the torn laminate edge: unlit bright silver, so it reads at any angle
  const ribbon = new THREE.MeshBasicMaterial({ color: 0xeef1f6, side: THREE.DoubleSide, toneMapped: false });
  return { bodyExt, bodyInt, headerExt, headerInt, ribbon, all: [bodyExt, bodyInt, headerExt, headerInt, ribbon] };
}

export function makeCardMaterials({ cardBack, edge }) {
  const face = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.08, envMapIntensity: 0.6, alphaTest: 0.5 });
  const back = new THREE.MeshStandardMaterial({ map: cardBack, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.5 });
  const rim = new THREE.MeshStandardMaterial({ map: edge, roughness: 0.7, metalness: 0.05 });
  const deckTop = new THREE.MeshStandardMaterial({ map: cardBack, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.5 });
  return { face, back, rim, deckTop, all: [face, back, rim, deckTop] };
}

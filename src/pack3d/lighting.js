// pack3d/lighting.js — PackLighting: a code-built product-photography room.
//
// No HDR download: a small scene of emissive panels (one broad bright panel
// above and to one side, a thinner cooler strip opposite, a warm low fill, a
// dim surrounding room) is filtered ONCE by PMREMGenerator into the reflection
// map. The long moving reflections of those panels are what reveal the foil's
// curvature as the pack turns; a broad soft wall behind the lens gives a face-on
// sheet of foil its base gold (a metal shows what's behind the camera). A restrained
// key establishes form and a low fill opposite keeps the far flank from going brown.
// The carousel (select3d.js) shares this room, so a pack carries one exposure from
// the wheel through the hand-off onto the tear stage.

import * as THREE from "three";

// Levels of the room's sources (linear radiance). `wall` is the dim room itself; `lens`
// is a broad warm wall BEHIND the camera — what a face-on sheet of foil mirrors — so a
// pack looking at the lens reads as gold across its whole face instead of the dark room,
// the way a foil product shot is lit with a big soft source behind the camera.
export const ENV_DEFAULTS = {
  wall: [0.045, 0.05, 0.062], floor: [0.09, 0.1, 0.12], ceil: [0.16, 0.17, 0.2],
  key: [5.6, 5.4, 5.0], strip: [2.4, 2.9, 3.6], fill: [1.5, 1.25, 0.85], glint: [7, 7, 6.6],
  lens: [0.45, 0.40, 0.30],
};
export function buildEnvironment(renderer, opts = {}) {
  const o = { ...ENV_DEFAULTS, ...opts };
  const room = new THREE.Scene();
  const panel = (w, h, pos, look, rgb) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    room.add(m);
  };
  // the dim room (inside faces)
  const walls = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...o.wall), side: THREE.BackSide }));
  room.add(walls);
  // a faint floor/ceiling gradient so the room isn't a uniform void
  panel(6, 6, [0, -2.99, 0], [0, 0, 0], o.floor);
  panel(6, 6, [0, 2.99, 0], [0, 0, 0], o.ceil);
  // the broad warm wall behind the lens (see ENV_DEFAULTS.lens)
  if (o.lens[0] + o.lens[1] + o.lens[2] > 0) panel(6, 6, [0, 0, 2.99], [0, 0, 0], o.lens);
  // the broad soft key above-left-front
  panel(2.6, 1.3, [-1.5, 1.7, 1.1], [0, 0, 0], o.key);
  // a thin cool strip opposite (right), for the second highlight band
  panel(0.28, 2.4, [2.0, 0.4, 0.5], [0, 0, 0], o.strip);
  // a low warm fill from the front-bottom (the pitch's floodlight bounce)
  panel(1.8, 0.5, [0.4, -1.5, 1.4], [0, 0, 0], o.fill);
  // a small hot sliver straight above — a crisp glint on the shoulders
  panel(0.5, 0.12, [0.2, 2.2, 0.2], [0, 0, 0], o.glint);

  const gen = new THREE.PMREMGenerator(renderer);
  gen.compileEquirectangularShader?.();
  const rt = gen.fromScene(room, 0.035);
  gen.dispose();
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  return rt;
}

export function addLights(scene) {
  const key = new THREE.DirectionalLight(0xfff1dc, 1.5);
  key.position.set(-0.35, 0.55, 0.9);
  key.target.position.set(0, 0, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xffd9ac, 0.2);
  fill.position.set(0.7, -0.15, 0.8);
  fill.target.position.set(0, 0, 0);
  scene.add(fill, fill.target);
  const hemi = new THREE.HemisphereLight(0xffe6c4, 0x3a2812, 0.6);
  scene.add(hemi);
  return { key, fill, hemi };
}

// Place the camera so a plane of height `worldH` facing it at the origin
// projects to exactly `pxH` CSS pixels in a viewport `viewportH` tall.
export function fitDistance(camera, worldH, pxH, viewportH) {
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  return ((worldH / 2) * viewportH) / (pxH * tanHalf);
}

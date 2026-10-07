// pack3d/lighting.js — PackLighting: a code-built product-photography room.
//
// No HDR download: a small scene of emissive panels (one broad bright panel
// above and to one side, a thinner cooler strip opposite, a warm low fill, a
// dim surrounding room) is filtered ONCE by PMREMGenerator into the reflection
// map. The long moving reflections of those panels are what reveal the foil's
// curvature as the pack turns. One restrained key light establishes form.

import * as THREE from "three";

export function buildEnvironment(renderer) {
  const room = new THREE.Scene();
  const panel = (w, h, pos, look, rgb) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    room.add(m);
  };
  // the dim room (inside faces)
  const walls = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.045, 0.05, 0.062), side: THREE.BackSide }));
  room.add(walls);
  // a faint floor/ceiling gradient so the room isn't a uniform void
  panel(6, 6, [0, -2.99, 0], [0, 0, 0], [0.09, 0.1, 0.12]);
  panel(6, 6, [0, 2.99, 0], [0, 0, 0], [0.16, 0.17, 0.2]);
  // the broad soft key above-left-front
  panel(2.6, 1.3, [-1.5, 1.7, 1.1], [0, 0, 0], [5.6, 5.4, 5.0]);
  // a thin cool strip opposite (right), for the second highlight band
  panel(0.28, 2.4, [2.0, 0.4, 0.5], [0, 0, 0], [2.4, 2.9, 3.6]);
  // a low warm fill from the front-bottom (the pitch's floodlight bounce)
  panel(1.8, 0.5, [0.4, -1.5, 1.4], [0, 0, 0], [1.5, 1.25, 0.85]);
  // a small hot sliver straight above — a crisp glint on the shoulders
  panel(0.5, 0.12, [0.2, 2.2, 0.2], [0, 0, 0], [7, 7, 6.6]);

  const gen = new THREE.PMREMGenerator(renderer);
  gen.compileEquirectangularShader?.();
  const rt = gen.fromScene(room, 0.035);
  gen.dispose();
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  return rt;
}

export function addLights(scene) {
  const key = new THREE.DirectionalLight(0xfff1dc, 1.35);
  key.position.set(-0.35, 0.55, 0.9);
  key.target.position.set(0, 0, 0);
  scene.add(key, key.target);
  const hemi = new THREE.HemisphereLight(0xc4d4ff, 0x1a2230, 0.35);
  scene.add(hemi);
  return { key, hemi };
}

// Place the camera so a plane of height `worldH` facing it at the origin
// projects to exactly `pxH` CSS pixels in a viewport `viewportH` tall.
export function fitDistance(camera, worldH, pxH, viewportH) {
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  return ((worldH / 2) * viewportH) / (pxH * tanHalf);
}

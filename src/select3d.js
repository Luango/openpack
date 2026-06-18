// select3d.js — the 3D pack-SELECTION carousel that fronts the tear-to-open flow.
//
// A full 3D ring of booster packs (three.js), TCG-Pocket style: ~16 sealed packs
// stand on a horizontal wheel that revolves around a vertical axis like a carousel
// / revolver cylinder. The pack at the FRONT faces you, large and clear; packs
// curving to the sides and round the back recede with perspective and darken into
// fog. Swipe horizontally to spin the wheel with real inertia (a flick carries
// through several packs and decelerates, then snaps to the nearest); tap a pack on
// the side to bring it to the front, tap the front pack to flip & inspect it, and
// OPEN — or a tap on the focused pack — to choose.
//
// On select, the chosen pack BREAKS AWAY from the ring: it rushes toward the camera
// with a bright flash and grows to fill the frame while the rest recede, darken and
// fade. The canvas then CROSS-DISSOLVES to the SVG tear-pack behind it (same art →
// no seam) and `onSelect(pack)` fires; the host arms the existing tear/reveal flow.
//
//   const sel = createSelector({ mountEl, packs, onSelect, onChange });
//   sel.show();   // reveal the carousel, resume rendering
//   sel.hide();   // park it (pauses the rAF loop — no battery at idle)
//
// Pack art: each entry can point at its own image (assets/pack-foo.webp); when it
// reuses the shared art we can hue-rotate it on a canvas to differentiate variants.

import * as THREE from "three";
import * as sfx from "./sfx.js";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// The default roster — a wheel of identical sealed packs to pick from (the gacha
// feel: same art, you choose which one to open). `img` is the source art; `hue`
// recolours it on a canvas (0 = leave the art untouched); `accent` tints the HTML
// name plate. To give a pack its OWN real art, point `img` at a new file (hue: 0).
export const DEFAULT_PACKS = Array.from({ length: 16 }, (_, i) => ({
  id: `genetic-apex-${i + 1}`,
  name: "Genetic Apex",
  sub: "Genetic Apex",
  img: "assets/pack.webp",
  hue: 0,
  accent: "#b49bff",
}));

// ---- ring layout tuning ---------------------------------------------------
// The wheel is a horizontal ring viewed from a little above and well back, so the
// near (front) pack is prominent and centred while its neighbours fan out to the
// sides and curl away into fog. The focused pack also POPS toward the lens (bigger
// + a gap), so it clearly dominates rather than being one of an even row.
const RING_R    = 4.3;   // radius of the carousel ring (world units)
const CAM_H     = 1.9;   // camera height — looks DOWN onto the wheel so volume reads
const CAM_D     = 12.0;  // camera distance back from the ring centre
const LOOK_Y    = -0.25; // aim below the ring plane → we see the packs' top crimp
const FRONT_PUSH = 1.8;  // how far the focused pack juts toward the camera
const FRONT_LIFT = 0.2;  // …and lifts out of the row
const BASE_S    = 0.86;  // scale of a non-focused pack
const POP_S     = 0.42;  // extra scale added to the focused pack
const FOG_NEAR = 8.0, FOG_FAR = 18.0; // distance fog → the back of the wheel darkens

export function createSelector({ mountEl, packs = DEFAULT_PACKS, onSelect, onChange }) {
  // --- renderer / scene / camera -------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0); // transparent — the page's nebula bg shows through
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mountEl.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  // z-index 1 keeps the canvas BELOW the .select-ui overlay (z 2) so the OPEN
  // button stays clickable; the overlay is pointer-events:none elsewhere, so drags
  // still fall through to the canvas.
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;z-index:1;";

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0d12, FOG_NEAR, FOG_FAR); // matches the page bg → seamless depth
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, CAM_H, CAM_D);
  camera.lookAt(0, LOOK_Y, 0);

  // Lighting: a moderate ambient (low enough to leave a shading gradient so the
  // packs read as 3D, not flat prints), a strong warm key from upper front, a cool
  // fill, plus a tight "glint" point light near the lens so a specular hot-spot
  // sweeps across each pack's foil as the wheel turns.
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.DirectionalLight(0xfff2e0, 1.7);
  key.position.set(2.5, 5, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9bb0ff, 0.5);
  fill.position.set(-3.5, -1, 3);
  scene.add(fill);
  const glint = new THREE.PointLight(0xffffff, 22, 22, 2);
  glint.position.set(0, 2.2, CAM_D - 1.0); // just in front, near the camera
  scene.add(glint);

  // A soft equirect "environment" built from a canvas gradient gives the foil a
  // moving holographic sheen (metalness reflects it) as packs rotate — cheap, no HDR.
  scene.environment = makeEnvTexture();

  // --- ambiance: drifting glow particles -----------------------------------
  const particles = makeParticles();
  scene.add(particles.points);

  // --- build a pack mesh per roster entry ----------------------------------
  const group = new THREE.Group();
  scene.add(group);
  const meshes = [];

  // one MeshStandardMaterial per pack (per-mesh so opacity/flash can vary in the
  // selection animation); the curved pillow + scene env give it the foil sheen.
  function makePackMaterial(faceTex) {
    return new THREE.MeshStandardMaterial({
      map: faceTex,
      roughness: 0.28,        // glossy foil, not a mirror
      metalness: 0.6,         // reflects the env sheen as it curves
      envMapIntensity: 1.35,
      emissive: 0xffffff,
      emissiveMap: faceTex,
      emissiveIntensity: 0.12, // a touch of self-light so the art reads in shadow
      side: THREE.DoubleSide,  // closed pouch — keeps both sheets lit at any angle
    });
  }
  // identical-aspect packs share ONE pillow geometry (built once, on first texture)
  const geoCache = new Map();
  function packGeometry(aspect) {
    const key = aspect.toFixed(3);
    if (!geoCache.has(key)) geoCache.set(key, makePackGeometry(aspect));
    return geoCache.get(key);
  }

  packs.forEach((p) => {
    const placeholder = new THREE.MeshStandardMaterial({ color: 0x222030, roughness: 0.6, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.4), placeholder);
    mesh.userData = { pack: p, flip: 0, flipTo: 0 }; // flip: eased inspect-rotation
    group.add(mesh);
    meshes.push(mesh);
    loadFaceTexture(p).then((tex) => {
      const aspect = tex.image.height / tex.image.width; // true art aspect
      mesh.geometry.dispose();              // drop the placeholder plane (shared geo is kept)
      mesh.geometry = packGeometry(aspect);
      mesh.material = makePackMaterial(tex);
    });
  });

  // --- carousel state -------------------------------------------------------
  // `pos` is the continuous index at the FRONT of the wheel (can run past N — the
  // ring wraps). `vel` carries fling momentum (index units / second).
  const N = meshes.length;
  const STEP = (Math.PI * 2) / N; // angle between adjacent packs
  let pos = 0, vel = 0;
  let dragging = false;
  let targetPos = null; // when set (by tap/goto), ease to this exact pos instead of free-fling
  const modIndex = () => ((Math.round(pos) % N) + N) % N;

  function layout() {
    for (let i = 0; i < N; i++) {
      const m = meshes[i];
      // angle of this pack from the front, normalised to [-PI, PI]
      let a = (i - pos) * STEP;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      const front = Math.max(0, Math.cos(a)); // 1 at front → 0 at the sides → 0 behind
      const pop = Math.pow(front, 5);          // sharp: only the centred pack pops out
      m.position.x = RING_R * Math.sin(a);
      m.position.z = RING_R * Math.cos(a) + pop * FRONT_PUSH; // focused pack juts at the lens
      m.position.y = bobY(front) + pop * FRONT_LIFT;
      m.rotation.y = a + m.userData.flip; // face radially outward + any inspect-flip
      m.scale.setScalar(BASE_S + POP_S * pop);
      // draw nearer packs last so they sit on top
      m.renderOrder = Math.round(m.position.z * 10);
    }
  }

  // a gentle vertical bob, strongest on the front pack, for a touch of life
  let t = 0;
  function bobY(front) { return REDUCED ? 0 : front * Math.sin(t * 1.0) * 0.05; }

  function applyOpacity(mesh, op) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mm) => { mm.transparent = op < 1; mm.opacity = op; });
  }

  // --- render loop (parked while hidden) ------------------------------------
  let raf = null, last = 0, selecting = false, lastIdx = -1;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    t += dt;

    if (selecting) {
      stepSelect(dt);
    } else if (!dragging) {
      if (targetPos !== null) {
        // a tap/goto eases the wheel to a SPECIFIC pack the short way around
        pos += (targetPos - pos) * Math.min(1, dt * 9);
        if (Math.abs(targetPos - pos) < 0.001) { pos = targetPos; targetPos = null; vel = 0; }
      } else if (Math.abs(vel) > 0.45) {
        // free fling: integrate with exponential (frame-rate-independent) friction
        pos += vel * dt;
        vel *= Math.exp(-3.4 * dt);
      } else {
        // slow → snap to the nearest pack so the wheel always rests on a choice
        vel = 0;
        const target = Math.round(pos);
        pos += (target - pos) * Math.min(1, dt * 10);
        if (Math.abs(target - pos) < 0.0008) pos = target;
      }
    }

    // ease inspect-flips
    for (const m of meshes) {
      if (m.userData.flip !== m.userData.flipTo) {
        m.userData.flip += (m.userData.flipTo - m.userData.flip) * Math.min(1, dt * 8);
        if (Math.abs(m.userData.flipTo - m.userData.flip) < 0.001) m.userData.flip = m.userData.flipTo;
      }
    }

    particles.update(dt);
    if (!selecting) layout();

    // tell the host when the focused pack changes (a tick + name plate)
    const idx = modIndex();
    if (idx !== lastIdx && !selecting) { lastIdx = idx; onChange?.(packs[idx], idx); }
    renderer.render(scene, camera);
  }
  function play() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function pause() { if (raf) cancelAnimationFrame(raf); raf = null; }

  // --- sizing ---------------------------------------------------------------
  function resize() {
    const w = mountEl.clientWidth || window.innerWidth;
    const h = mountEl.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // portrait phones: pull back so the focused pack + its neighbours aren't cropped
    const portrait = w / h < 0.72;
    camera.position.set(0, portrait ? 1.6 : CAM_H, portrait ? 13.5 : CAM_D);
    camera.lookAt(0, LOOK_Y, 0);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mountEl);
  resize();
  layout();

  // --- pointer: spin the wheel, tap to focus / flip / choose ----------------
  let down = null;
  function onDown(e) {
    if (selecting) return;
    dragging = true;
    vel = 0; targetPos = null; // a fresh grab cancels any in-flight goto / fling
    down = { x: e.clientX, y: e.clientY, pos, moved: 0, t: now(), lastX: e.clientX, lastT: now() };
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* stray/synthetic id — fine */ }
  }
  function onMove(e) {
    if (!down || selecting) return;
    const dx = e.clientX - down.x;
    down.moved = Math.max(down.moved, Math.abs(dx) + Math.abs(e.clientY - down.y));
    // a full-width drag spins ~4 packs
    const perPack = mountEl.clientWidth / 4;
    pos = down.pos - dx / perPack;
    // track instantaneous angular velocity (index / second) for the fling
    const tt = now(), dtm = Math.max(8, tt - down.lastT);
    const instV = -(e.clientX - down.lastX) / perPack / (dtm / 1000);
    vel = vel * 0.6 + instV * 0.4; // smooth a little
    down.lastX = e.clientX; down.lastT = tt;
    layout();
  }
  function onUp(e) {
    if (!down || selecting) return;
    dragging = false;
    const tapped = down.moved < 8 && now() - down.t < 350;
    try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* never captured — fine */ }
    if (tapped) {
      vel = 0;
      const i = raycastIdx(e);
      if (i < 0) { /* tapped empty space → let it settle */ }
      else if (i === modIndex()) choose();          // tapped the focused pack → open it
      else spinToIndex(i);                           // tapped a side pack → bring it to front
    } else if (Math.abs(vel) < 0.45) {
      vel = 0; // a slow release just settles to the nearest
    }
    down = null;
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  // spin the wheel the SHORT way around to bring roster-index `i` to the front
  function spinToIndex(i) {
    const cur = Math.round(pos);
    let delta = ((i - (((cur % N) + N) % N)) % N + N) % N; // 0..N-1 forward
    if (delta > N / 2) delta -= N; // go the short way (backwards) if nearer
    vel = 0;
    targetPos = cur + delta; // frame() eases pos here and lands exactly on `i`
    play();
  }

  // which pack (if any) did the pointer hit? returns its roster index, or -1
  const ray = new THREE.Raycaster();
  function raycastIdx(e) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? meshes.indexOf(hit.object) : -1;
  }

  // --- selection: breakaway fly-in + cross-dissolve handoff -----------------
  let selT = 0, heroMesh = null, restPose = null;
  function choose() {
    if (selecting) return;
    selecting = true;
    selT = 0; vel = 0;
    sfx.grab?.(); // foil crinkle as it leaps forward
    pos = Math.round(pos);
    heroMesh = meshes[modIndex()];
    heroMesh.userData.flipTo = 0; heroMesh.userData.flip = 0; // face-up for the launch
    layout();
    restPose = { px: heroMesh.position.x, py: heroMesh.position.y, pz: heroMesh.position.z, ry: heroMesh.rotation.y, s: heroMesh.scale.x };
    onSelect?.(heroMesh.userData.pack); // host arms the tear-pack with this identity
  }

  // The hero breaks away toward the camera and grows; everyone else recedes, darkens
  // and fades; a bright emissive flash punches the moment. Over the last ~40% we fade
  // the whole canvas so the SVG tear-pack (same art) takes over with no visible seam.
  function stepSelect(dt) {
    selT = Math.min(1, selT + dt / 0.66);
    const e = easeInOut(selT);
    const camZ = camera.position.z;
    // hero flies to dead-centre, just in front of the lens, facing camera, scaled up
    heroMesh.position.set(lerp(restPose.px, 0, e), lerp(restPose.py, LOOK_Y + 0.1, e), lerp(restPose.pz, camZ - 2.2, e));
    heroMesh.rotation.y = lerp(restPose.ry, 0, e);
    heroMesh.scale.setScalar(lerp(restPose.s, (BASE_S + POP_S) * 1.7, e));
    heroMesh.renderOrder = 999;
    applyOpacity(heroMesh, 1);
    setHeroFlash(Math.sin(selT * Math.PI) * 0.9); // golden-streak flash, peaks mid-flight
    // bystanders recede outward + fade
    for (const m of meshes) {
      if (m === heroMesh) continue;
      applyOpacity(m, Math.max(0, 1 - selT * 1.7));
      m.scale.multiplyScalar(1 - 0.04 * (dt * 60) * 0.2);
    }
    particles.points.material.opacity = Math.max(0, 0.6 * (1 - selT));
    // cross-dissolve the canvas out over the last ~40%
    mountEl.style.opacity = String(Math.max(0, 1 - Math.max(0, selT - 0.6) / 0.4));
    if (selT >= 1) finishSelect();
  }
  function setHeroFlash(v) { setFaceFlash(heroMesh, v); }
  function finishSelect() {
    selecting = false;
    pause();
    mountEl.classList.add("gone");
  }

  // ---- public API ----------------------------------------------------------
  return {
    el: mountEl,
    show() {
      mountEl.classList.remove("gone");
      mountEl.style.opacity = "1";
      selecting = false; heroMesh = null; lastIdx = -1; vel = 0;
      meshes.forEach((m) => { applyOpacity(m, 1); m.userData.flip = m.userData.flipTo = 0; setFaceFlash(m, 0); });
      particles.points.material.opacity = 0.6;
      resize();
      layout();
      play();
    },
    hide() { pause(); mountEl.classList.add("gone"); },
    get index() { return modIndex(); },
    get current() { return packs[modIndex()]; },
    next() { spinToIndex((modIndex() + 1) % N); },
    prev() { spinToIndex((modIndex() - 1 + N) % N); },
    goto(i) { spinToIndex(((i % N) + N) % N); },
    // flip the focused pack over to inspect its back (toggle)
    flip() { const m = meshes[modIndex()]; m.userData.flipTo = m.userData.flipTo ? 0 : Math.PI; play(); },
    select: choose,
    dispose() {
      pause(); ro.disconnect();
      geoCache.forEach((g) => g.dispose());     // the shared pillow geometries
      particles.points.geometry.dispose();
      scene.environment?.dispose?.();
      renderer.dispose();
      canvas.remove();
    },
  };
}

// ---- helpers ---------------------------------------------------------------
function now() { return performance.now(); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// Procedural foil-pack geometry — a "pillow": a front and back sheet that bulge
// outward through the body and press FLAT into the crimped seal strips at top and
// bottom (where a real booster is heat-sealed), tapering to a thin lip at every
// edge. The curved surface is what sells the foil — the env/glint sheen slides
// across the bulge as the wheel turns, which a flat plane can never do. UVs are a
// straight 0..1 map so the printed art (incl. its crimp strip) lands correctly.
function makePackGeometry(aspect) {
  const W = 1, H = aspect;
  const NX = 22, NY = 34;          // surface resolution (smooth bulge, cheap)
  const PUFF = 0.085;              // half-thickness at the fattest point of the body
  const LIP = 0.006;              // thin sealed lip so front/back never z-fight
  const SEAL = 0.075;             // fraction of height pressed flat top & bottom
  // bulge profile: 0 at the L/R edges and within the seal strips, ~1 in the body
  const hx = (u) => Math.pow(Math.sin(Math.PI * clamp01(u)), 0.6);
  const hy = (v) => {
    const lo = SEAL, hi = 1 - SEAL;
    if (v <= lo || v >= hi) return 0;       // flat crimp seals
    return Math.pow(Math.sin(Math.PI * (v - lo) / (hi - lo)), 0.55);
  };
  const pos = [], uv = [], idx = [];
  for (const side of [1, -1]) {             // front (+z), then back (-z)
    const base = pos.length / 3;
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        const u = i / NX, v = j / NY;
        const z = side * (LIP + PUFF * hx(u) * hy(v));
        pos.push((u - 0.5) * W, (v - 0.5) * H, z);
        uv.push(side > 0 ? u : 1 - u, v);   // mirror the back so its art reads right
      }
    }
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const a = base + j * (NX + 1) + i, b = a + 1, c = a + (NX + 1), d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function setFaceFlash(mesh, v) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) if (m.emissiveMap) m.emissiveIntensity = 0.12 + v;
}

// A soft equirectangular environment from a vertical canvas gradient — a dim-bright-
// dim band that the foil's metalness reflects, so a holographic sheen sweeps across
// each pack as the wheel turns. Far cheaper than loading an HDR.
function makeEnvTexture() {
  const c = document.createElement("canvas");
  c.width = 16; c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, "#1a1d2b");
  g.addColorStop(0.42, "#6b6f93");
  g.addColorStop(0.5, "#dfe3ff");  // bright band → the moving glint
  g.addColorStop(0.58, "#6b6f93");
  g.addColorStop(1.0, "#0c0e16");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A field of slow-drifting glow motes for the "digital space" backdrop.
function makeParticles() {
  const COUNT = 240;
  const pos = new Float32Array(COUNT * 3);
  const spd = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3 + 0] = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 22 - 11;
    pos[i * 3 + 1] = (Math.sin(i * 78.233) * 43758.5453 % 1) * 14 - 6;
    pos[i * 3 + 2] = (Math.sin(i * 37.719) * 43758.5453 % 1) * 16 - 12;
    spd[i] = 0.2 + (Math.sin(i * 4.1) * 0.5 + 0.5) * 0.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xc9b8ff, size: 0.06, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -1;
  return {
    points,
    update(dt) {
      const a = geo.attributes.position.array;
      for (let i = 0; i < COUNT; i++) {
        a[i * 3 + 1] += spd[i] * dt * 0.4; // drift gently upward
        if (a[i * 3 + 1] > 8) a[i * 3 + 1] = -8;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// Build a face texture for a pack: load its art, optionally hue-rotating it on a
// canvas so a variant reads as a different pack. Identical (img,hue) packs share
// one GPU texture — a wheel of 16 costs one upload.
const _imgCache = new Map();
function loadImg(src) {
  if (_imgCache.has(src)) return _imgCache.get(src);
  const pr = new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
  _imgCache.set(src, pr);
  return pr;
}
const _texCache = new Map();
function loadFaceTexture(p) {
  const key = `${p.img}|${p.hue || 0}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const pr = loadImg(p.img).then((im) => {
    let source = im;
    if (p.hue) {
      const c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.filter = `hue-rotate(${p.hue}deg) saturate(1.08)`;
      ctx.drawImage(im, 0, 0);
      source = c;
    }
    const tex = new THREE.Texture(source);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  });
  _texCache.set(key, pr);
  return pr;
}

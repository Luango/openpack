// select3d.js — the 3D pack-SELECTION carousel that fronts the tear-to-open flow.
//
// A full 3D ring of booster packs (three.js), TCG-Pocket style: ~10 sealed packs
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
export const DEFAULT_PACKS = Array.from({ length: 10 }, (_, i) => ({
  id: `genetic-apex-${i + 1}`,
  name: "Genetic Apex",
  sub: "Genetic Apex",
  img: "assets/pack.png", // hi-res source (1083×1794) — crisp on the 3D mesh
  hue: 0,
  accent: "#b49bff",
}));

// ---- ring layout tuning ---------------------------------------------------
// The wheel is a horizontal ring viewed from a little above and well back, so the
// near (front) pack is prominent and centred while its neighbours fan out to the
// sides and curl away into fog. The focused pack also POPS toward the lens (bigger
// + a gap), so it clearly dominates rather than being one of an even row.
const RING_R    = 2.5;   // radius of the carousel ring (world units)
const CAM_H     = 0.0;   // EYE-LEVEL (平视): look straight at the packs, head-on
const CAM_D     = 12.0;  // camera distance back from the ring centre
const LOOK_Y    = 0.0;   // aim dead-level → every pack sits on the middle horizontal line
const FRONT_PUSH = 1.8;  // how far the focused pack juts toward the camera (bigger = the focus)
const FRONT_LIFT = 0.0;  // no vertical lift — all packs stay centred on the midline
const BASE_S    = 0.86;  // scale of a non-focused pack
const POP_S     = 0.42;  // extra scale added to the focused pack
// How far each pack YAWS toward "radially outward". 1.0 = a full revolver (packs turn
// through every angle → only the face-on front ones catch the key highlight → the rest
// go dull). A SMALL value keeps every pack near face-on (a shallow coverflow fan, like
// the Shining Revelry reference), so they ALL catch the same light and read identically.
const TURN      = 0.34;
const FOG_NEAR = 11.0, FOG_FAR = 30.0; // gentle distance fog → the back recedes but isn't crushed

// ---- intro entrance ------------------------------------------------------
// On the FIRST show, the packs are not just there — they queue in. One ordered
// line flies in along a single arc from the upper-left (near the lens), each
// docks at the BACK of the ring in turn, and the wheel carries them counter-
// clockwise to the front until first meets last and the ring is whole. Then it
// hands off seamlessly to the normal idle carousel.
const INTRO_ARR  = 0.30;  // s between each pack launching — the queue cadence; ALSO sets the
                          // fill-spin speed (one full revolution over N·ARR), so a larger value
                          // is both a slower queue AND a calmer, smoother wheel rotation
const INTRO_ARC  = 1.25;  // s each pack spends gliding its arc in (longer = more graceful)
const INTRO_SETTLE = 0.6; // s of slow carry after the last pack docks, before handoff
const INTRO_BLEND = 0.7;  // flight progress at which it starts blending into the wheel's motion
                          // (0.7 → the last 30% hands off velocity-continuously, no dock pause)
const INTRO_EASE = 1.4;   // flight ease exponent. >1 = ease-IN (gentle start, NO end deceleration)
                          // so the pack keeps speed into the wheel and just merges into the spin —
                          // an ease-OUT here is what made it slow to ~0 and "pause" before rotating
// Inertial finish: when the ring is full, the wheel doesn't just halt — it carries its
// spin momentum a little PAST the rest slot then springs back (an underdamped settle),
// so the entrance lands with weight instead of stopping dead.
const INTRO_SPRING_K    = 55;  // spring stiffness pulling the wheel to its rest slot
const INTRO_SPRING_DAMP = 5.5; // damping — lower = bigger overshoot/more bounce, higher = tighter
// The flight path is a smooth cubic Bézier: a long sweep down from the high upper-left
// that FLATTENS as it merges into the ring at the back — its end tangent points +x,
// tangent to the wheel, so each pack glides in level and is carried on round, rather
// than diving straight at the dock. A graceful comet arc.
const INTRO_P0 = { x: -11, y: 5.5, z: 7 };     // entry: high upper-left, near the camera
const INTRO_C1 = { x: -5,  y: 3.5, z: 4 };     // start tangent — eases down and inward
const INTRO_C2 = { x: -3,  y: 0,   z: -RING_R };// end tangent — arrives level, flattening to +x (shorter = gentler merge speed)
const INTRO_DIR = -1;     // wheel carry direction: -1 = counter-clockwise (flip to +1 for CW)

export function createSelector({ mountEl, packs = DEFAULT_PACKS, onSelect, onChange, getHandoffRect, onLand }) {
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

  // LIGHTING MODEL — every pack is the same component, so it MUST read the same.
  // The light is therefore fully UNIFORM: a flat ambient + a hemisphere that's
  // azimuth-independent (it only depends on a surface's up-ness, and the packs are
  // all upright), so every pack around the wheel gets the EXACT same illumination,
  // no matter which way it faces. Crucially there is NO positional light (point /
  // spot): a positional light falls off with distance, which is what was lighting
  // only the front pack + its neighbour and leaving the rest dim. The focused pack
  // stands out purely by being larger and nearer (FRONT_PUSH + scale), not by light.
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  scene.add(new THREE.HemisphereLight(0xd6deff, 0x2a2342, 1.0)); // cool sky / violet ground → even base
  // KEY FROM THE CAMERA — a warm directional light pointing from the lens INTO the
  // scene. Directional ⇒ no distance falloff, so it lights EVERY pack's camera-facing
  // face identically: each one gets the same "front-lit" foil look + a matching
  // specular highlight, not just the front pack. This is what makes them all read the
  // same. (Slightly above the lens so the highlight lands on each pack's upper body.)
  const key = new THREE.DirectionalLight(0xfff1dd, 1.5);
  key.position.set(0, 2.5, CAM_D + 2);   // from in front/above → direction ≈ −z, toward the packs
  key.target.position.set(0, 0, 0);
  scene.add(key); scene.add(key.target);
  // a gentle cool RIM from behind so the back of the wheel separates from the black
  // backdrop (directional → no distance falloff, so it doesn't favour any one pack)
  const rim = new THREE.DirectionalLight(0xbcd2ff, 0.35);
  rim.position.set(0, 4, -10);
  scene.add(rim);

  // A soft equirect "environment" built from a canvas gradient gives the foil a
  // moving holographic sheen (metalness reflects it) as packs rotate — cheap, no HDR.
  scene.environment = makeEnvTexture();

  // --- ambiance: drifting glow particles -----------------------------------
  const particles = makeParticles();
  scene.add(particles.points);
  // slowly-rising card-backs at the MIDDLE depth of the wheel (z≈0) — they drift up
  // THROUGH the carousel: occluded by the front pack, passing in front of the back
  // ones, so they read as part of the scene's depth, not a flat backdrop.
  const rising = makeRisingCards();
  scene.add(rising.group);

  // --- build a pack mesh per roster entry ----------------------------------
  const group = new THREE.Group();
  scene.add(group);
  const meshes = [];

  // one MeshStandardMaterial per pack (per-mesh so opacity/flash can vary in the
  // selection animation); the curved pillow + scene env give it the foil sheen.
  function makePackMaterial(faceTex) {
    return new THREE.MeshStandardMaterial({
      map: faceTex,
      roughness: 0.45,         // satin foil — a soft sheen that rolls off, not a hot blowout
      metalness: 0.34,         // foil — catches the camera-key's highlight + a little env sheen
      envMapIntensity: 0.85,
      emissive: 0xffffff,
      emissiveMap: faceTex,
      emissiveIntensity: 0.2,  // self-light so the art reads vivid even in shadow
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
    // flip: eased inspect-rotation. aspect: art height/width — the geometry's local
    // height equals it, so the handoff can size the pack to the SVG pack's screen rect.
    mesh.userData = { pack: p, flip: 0, flipTo: 0, aspect: 1.4 };
    group.add(mesh);
    meshes.push(mesh);
    loadFaceTexture(p).then((tex) => {
      const aspect = tex.image.height / tex.image.width; // true art aspect
      mesh.userData.aspect = aspect;
      mesh.geometry.dispose();              // drop the placeholder plane (shared geo is kept)
      mesh.geometry = packGeometry(aspect);
      // SAME printed art on BOTH faces, so a pack looks identical no matter which way
      // it faces on the wheel — no dark "back" showing on the far side (that was the
      // grey-pack inconsistency). One material → uniform across the whole carousel.
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
      m.rotation.y = a * TURN + m.userData.flip; // shallow turn → all packs stay near face-on (even light)
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
  // intro entrance state (see INTRO_* tuning above)
  let introing = false, introDone = false, introT = 0, introSettle = 0, wheelAngle = 0;
  let introOutro = false, wheelVel = 0, targetWheel = 0; // inertial spring-settle at the end
  let introState = [];
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    t += dt;

    if (introing) {
      stepIntro(dt);
    } else if (selecting) {
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
    rising.update(dt);
    if (!selecting && !introing) layout();

    // tell the host when the focused pack changes (a tick + name plate)
    const idx = modIndex();
    if (idx !== lastIdx && !selecting && !introing) { lastIdx = idx; onChange?.(packs[idx], idx); }
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
    // portrait phones: pull back so the focused pack + its neighbours aren't cropped;
    // stay EYE-LEVEL (head-on) on both orientations so the packs sit on the midline
    const portrait = w / h < 0.72;
    camera.position.set(0, CAM_H, portrait ? 14 : CAM_D);
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
    if (selecting || introing) return;
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
  let selT = 0, heroMesh = null, restPose = null, heroTarget = null;
  function choose() {
    if (selecting) return;
    selecting = true;
    selT = 0; vel = 0;
    sfx.grab?.(); // foil crinkle as it leaps forward
    pos = Math.round(pos);
    heroMesh = meshes[modIndex()];
    heroMesh.userData.flipTo = 0; heroMesh.userData.flip = 0; // face-up for the launch
    layout();
    // capture the pose it launches FROM (full transform), and solve where it must
    // LAND so it sits exactly over the SVG tear-pack (see handoffPose).
    restPose = { pos: heroMesh.position.clone(), quat: heroMesh.quaternion.clone(), s: heroMesh.scale.x };
    onSelect?.(heroMesh.userData.pack); // host arms + sizes the tear-pack with this identity
    heroTarget = handoffPose();         // measured AFTER onSelect, so the rect is current
  }

  // Solve the hero's landing pose so its on-screen rectangle coincides with the SVG
  // tear-pack's: BILLBOARD it to face the lens (no tilt/roll → an undistorted rect),
  // sit it dead-centre on the view axis (where the SVG pack is centred), and scale it
  // so its projected HEIGHT equals the SVG pack's pixel height. Same art, same place,
  // same size → the cross-dissolve to the SVG pack is seamless.
  const _fwd = new THREE.Vector3();
  function handoffPose() {
    const quat = camera.quaternion.clone(); // billboard: parallel to the image plane
    const zc = 3.0;                          // view-space depth in front of the lens at landing
    const aspect = heroMesh.userData.aspect || 1.4;
    const h = mountEl.clientHeight || window.innerHeight || 1;
    const rect = getHandoffRect?.();
    let scale;
    if (rect && rect.height) {
      // pxH = worldH / (2 * zc * tan(fov/2)) * viewportH ; worldH = scale * aspect
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360); // (fov/2) in radians
      scale = (rect.height * 2 * zc * tanHalf) / (aspect * h);
    } else {
      scale = (BASE_S + POP_S) * 1.7; // no rect to match → the old fly-to-lens size
    }
    camera.getWorldDirection(_fwd); // forward (−z), normalised
    const pos = camera.position.clone().addScaledVector(_fwd, zc); // centred on the view axis
    return { pos, quat, scale };
  }

  // The hero breaks away toward the camera and grows to the SVG tear-pack's EXACT
  // on-screen size/position; everyone else recedes, darkens and fades; a bright
  // emissive flash punches the moment. The canvas stays fully opaque the whole way —
  // the REAL pack is hidden until the hero lands exactly on top of it (finishSelect),
  // so it's only swapped in once it perfectly overlaps. No early reveal, no jump.
  function stepSelect(dt) {
    selT = Math.min(1, selT + dt / 0.66);
    const e = easeInOut(selT);
    heroMesh.position.lerpVectors(restPose.pos, heroTarget.pos, e);
    heroMesh.quaternion.copy(restPose.quat).slerp(heroTarget.quat, e); // ease the billboard turn
    heroMesh.scale.setScalar(lerp(restPose.s, heroTarget.scale, e));
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
    if (selT >= 1) finishSelect();
  }
  function setHeroFlash(v) { setFaceFlash(heroMesh, v); }
  // Landed: the hero now sits exactly over the (still-hidden) SVG pack. Hand control
  // to the host, which reveals the real pack and then drops this canvas — a clean
  // swap at the matched rect. (Falls back to hiding immediately if no onLand.)
  function finishSelect() {
    selecting = false;
    const hideCanvas = () => { pause(); mountEl.classList.add("gone"); };
    if (onLand) onLand(hideCanvas);
    else hideCanvas();
  }

  // ---- intro entrance: queue the packs in to build the ring ----------------
  // Arm the entrance: hide every pack, schedule each to launch INTRO_ARR apart
  // (mesh 0 leads), and reset the wheel carry. The frame loop runs stepIntro.
  function initIntro() {
    introing = true; introT = 0; introSettle = 0; wheelAngle = 0; introOutro = false; wheelVel = 0;
    introState = meshes.map((m, i) => ({ launched: false, docked: false, slotAngle: 0, t0: i * INTRO_ARR }));
    meshes.forEach((m) => { applyOpacity(m, 0); m.userData.flip = m.userData.flipTo = 0; });
  }

  // Each pack flies the SAME arc P0→back over INTRO_ARC (strong ease-in), docks at
  // the back, then rides the wheel. The wheel turns one slot per launch, so docks
  // land on successive, evenly-spaced slots and the ring closes first-to-last.
  function stepIntro(dt) {
    introT += dt;
    const wheelSpeed = STEP / INTRO_ARR;
    if (introOutro) {
      // inertial finish: an underdamped spring carries the spin a touch past the rest
      // slot, then pulls it back — the wheel settles with weight instead of halting
      wheelVel += (targetWheel - wheelAngle) * INTRO_SPRING_K * dt;
      wheelVel *= Math.exp(-INTRO_SPRING_DAMP * dt);
      wheelAngle += wheelVel * dt;
    } else {
      wheelAngle += INTRO_DIR * wheelSpeed * dt; // one slot per INTRO_ARR → even ring
    }
    const P1x = 0, P1y = 0, P1z = -RING_R; // dock: the back of the ring
    let allDocked = true;
    for (let i = 0; i < N; i++) {
      const s = introState[i], m = meshes[i];
      const tt = introT - s.t0;
      if (tt < 0) { applyOpacity(m, 0); allDocked = false; continue; } // not launched yet
      // Fix the slot this pack will own the instant it launches — the spot that will be
      // at the BACK when it arrives (ARC later). Knowing it up front lets the flight
      // blend INTO the wheel's motion at the end, so it arrives already moving with the
      // ring (velocity-continuous) instead of landing, stopping, then being towed.
      if (!s.launched) { s.launched = true; s.slotAngle = Math.PI - (wheelAngle + INTRO_DIR * wheelSpeed * (INTRO_ARC - tt)); }
      // its docked pose on the wheel RIGHT NOW (also the steady-state once docked)
      const a = s.slotAngle + wheelAngle;
      const front = Math.max(0, Math.cos(a)), pop = Math.pow(front, 5);
      const rX = RING_R * Math.sin(a), rZ = RING_R * Math.cos(a) + pop * FRONT_PUSH, rY = pop * FRONT_LIFT;
      const rScale = BASE_S + POP_S * pop;
      if (!s.docked) {
        const p = Math.min(1, tt / INTRO_ARC);
        if (p < 1) allDocked = false;
        const e = Math.pow(p, INTRO_EASE);            // ease-IN: gentle start, full speed into the wheel
        const mt = 1 - e, w0 = mt*mt*mt, w1 = 3*mt*mt*e, w2 = 3*mt*e*e, w3 = e*e*e;
        const bX = w0*INTRO_P0.x + w1*INTRO_C1.x + w2*INTRO_C2.x + w3*P1x; // cubic Bézier arc
        const bY = w0*INTRO_P0.y + w1*INTRO_C1.y + w2*INTRO_C2.y + w3*P1y;
        const bZ = w0*INTRO_P0.z + w1*INTRO_C1.z + w2*INTRO_C2.z + w3*P1z;
        const bFace = Math.PI * e, bScale = BASE_S * (0.62 + 0.38 * e);
        let c = (p - INTRO_BLEND) / (1 - INTRO_BLEND); // 0 until INTRO_BLEND, →1 at dock
        c = c < 0 ? 0 : c > 1 ? 1 : c; const bw = c * c * (3 - 2 * c); // smoothstep blend
        m.position.set(bX + (rX - bX) * bw, bY + (rY - bY) * bw, bZ + (rZ - bZ) * bw);
        m.rotation.set(0, bFace + (a * TURN - bFace) * bw, 0);
        m.scale.setScalar(bScale + (rScale - bScale) * bw);
        applyOpacity(m, Math.min(1, p * 3));
        m.renderOrder = Math.round(m.position.z * 10);
        if (p >= 1) s.docked = true; // slotAngle already fixed at launch
      } else {                                        // a ring member, carried by the wheel
        m.position.set(rX, rY, rZ);
        m.rotation.y = a * TURN;
        m.scale.setScalar(rScale);
        applyOpacity(m, 1);
        m.renderOrder = Math.round(m.position.z * 10);
      }
    }
    if (introOutro) {
      // spring has come to rest → hand off
      if (Math.abs(targetWheel - wheelAngle) < 0.003 && Math.abs(wheelVel) < 0.03) { wheelAngle = targetWheel; endIntro(); }
    } else if (allDocked) {
      introSettle += dt;
      if (introSettle >= INTRO_SETTLE) {            // ring is whole → kick off the inertial settle
        introOutro = true;
        wheelVel = INTRO_DIR * wheelSpeed;          // carry the spin momentum into the spring
        targetWheel = restWheelAngle();             // rest with a pack dead-centre at the front
      }
    }
  }

  // Choose the wheelAngle that seats the front-most pack exactly at a = 0. The carried
  // momentum overshoots this, the spring pulls back → the inertial "forward-then-return".
  function restWheelAngle() {
    let best = 0, bestAbs = Infinity;
    for (let i = 0; i < N; i++) {
      let a = (introState[i].slotAngle + wheelAngle) % (Math.PI * 2);
      if (a > Math.PI) a -= Math.PI * 2; else if (a < -Math.PI) a += Math.PI * 2;
      if (Math.abs(a) < bestAbs) { bestAbs = Math.abs(a); best = a; }
    }
    return wheelAngle - best;
  }

  // Hand off to the steady carousel: pick the `pos` that makes layout() reproduce
  // the ring exactly where it sits now (meshAngle_i = i·STEP + C → pos = −C/STEP),
  // then let the idle snap settle the nearest pack to the front.
  function endIntro() {
    introing = false;
    pos = -(introState[0].slotAngle + wheelAngle) / STEP;
    vel = 0; targetPos = null; lastIdx = -1;
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
      // first entrance plays the queue-in intro; later shows reveal the ring directly
      if (!introDone) { introDone = true; initIntro(); }
      else layout();
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
  const NX = 22, NY = 36;          // surface resolution (smooth bulge, cheap)
  const PUFF = 0.07;               // half-thickness at the fattest point — a SLIM foil pouch
  const LIP = 0.005;               // thin sealed lip so front/back never z-fight
  const TOP_SEAL = 0.07;           // flat crimp strip at the top (the serrated seal)
  const BOT_SEAL = 0.10;           // a longer, more tapered seal at the bottom (per the side view)
  // bulge profile: 0 at the L/R edges and within the seal strips, ~1 in the body
  const hx = (u) => Math.pow(Math.sin(Math.PI * clamp01(u)), 0.6);
  const hy = (v) => {
    const lo = BOT_SEAL, hi = 1 - TOP_SEAL;  // v=0 is the bottom, v=1 the top
    if (v <= lo || v >= hi) return 0;        // flat crimp seals
    return Math.pow(Math.sin(Math.PI * (v - lo) / (hi - lo)), 0.55);
  };
  const pos = [], uv = [], idx = [];
  const triPerSide = NX * NY * 6;            // index count for one sheet → geometry groups
  for (const side of [1, -1]) {              // front (+z), then back (-z)
    const base = pos.length / 3;
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        const u = i / NX, v = j / NY;
        const z = side * (LIP + PUFF * hx(u) * hy(v));
        pos.push((u - 0.5) * W, (v - 0.5) * H, z);
        uv.push(side > 0 ? u : 1 - u, v);    // mirror the back so its art reads right
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
  // two groups so the FRONT sheet and BACK sheet can take different materials
  g.addGroup(0, triPerSide, 0);              // front → material[0]
  g.addGroup(triPerSide, triPerSide, 1);     // back  → material[1]
  return g;
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// The pack BACK, drawn on a canvas from the product design sheet: the G-MAX AURA
// swirl/vortex, a crimped top strip, a silver centre seal with a Gengar mark, the
// "G-MAX AURA EDITION" title, "Contents: 5 Cards", legal text + lot code, fruit
// pips and a stylised Pokémon wordmark. One shared texture (the back is identical
// across the rack). aspect = height/width, matching the geometry.
let _backTex = null;
function makeBackTexture(aspect) {
  if (_backTex) return _backTex;
  const W = 560, H = Math.round(W * (aspect || 1.4));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const cx = W * 0.5, cy = H * 0.5;
  // swirl backdrop — a conic spiral of the art's magenta/purple/blue, darkening to
  // the vortex hole at centre, with an outer vignette
  x.fillStyle = "#180f2c"; x.fillRect(0, 0, W, H);
  if (x.createConicGradient) {
    const g = x.createConicGradient(-0.5, cx, cy);
    [[0, "#3a1d6e"], [0.16, "#c12a82"], [0.36, "#6a2bd0"], [0.54, "#2a46b0"],
     [0.72, "#a32a86"], [0.88, "#5a23b0"], [1, "#3a1d6e"]].forEach(([s, col]) => g.addColorStop(s, col));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  } else {
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#6a2bd0"); g.addColorStop(1, "#c12a82");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  let rg = x.createRadialGradient(cx, cy, W * 0.015, cx, cy, W * 0.55);
  rg.addColorStop(0, "rgba(0,0,0,0.9)"); rg.addColorStop(0.22, "rgba(20,6,42,0.35)"); rg.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = rg; x.fillRect(0, 0, W, H);
  rg = x.createRadialGradient(cx, cy, W * 0.42, cx, cy, W * 0.95);
  rg.addColorStop(0, "rgba(0,0,0,0)"); rg.addColorStop(1, "rgba(8,4,18,0.85)");
  x.fillStyle = rg; x.fillRect(0, 0, W, H);

  // top crimp strip with a fine vertical hatch (the heat-sealed serration)
  const crimpH = H * 0.06;
  x.fillStyle = "rgba(206,202,224,0.5)"; x.fillRect(0, 0, W, crimpH);
  x.strokeStyle = "rgba(255,255,255,0.22)"; x.lineWidth = 1;
  for (let i = 0; i < W; i += 5) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, crimpH); x.stroke(); }

  // centre silver seal band + a Gengar seal disc
  const bw = W * 0.14;
  const bg = x.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
  bg.addColorStop(0, "rgba(208,208,224,0.12)"); bg.addColorStop(0.5, "rgba(232,232,248,0.55)"); bg.addColorStop(1, "rgba(208,208,224,0.12)");
  x.fillStyle = bg; x.fillRect(cx - bw / 2, crimpH, bw, H - crimpH);
  const sr = W * 0.08;
  x.fillStyle = "#cdced9"; x.beginPath(); x.arc(cx, cy, sr, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#473860"; x.beginPath(); x.arc(cx, cy, sr * 0.74, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#fff"; // Gengar eyes + grin
  x.beginPath(); x.ellipse(cx - sr * 0.3, cy - sr * 0.16, sr * 0.17, sr * 0.1, -0.5, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(cx + sr * 0.3, cy - sr * 0.16, sr * 0.17, sr * 0.1, 0.5, 0, Math.PI * 2); x.fill();
  x.strokeStyle = "#fff"; x.lineWidth = sr * 0.1; x.beginPath(); x.arc(cx, cy + sr * 0.06, sr * 0.42, Math.PI * 0.15, Math.PI * 0.85); x.stroke();

  // titles + text
  x.fillStyle = "#fff"; x.textAlign = "left";
  x.font = `italic 900 ${Math.round(W * 0.07)}px Arial, sans-serif`;
  x.fillText("G-MAX AURA", W * 0.07, H * 0.17);
  x.fillText("EDITION", W * 0.07, H * 0.225);
  x.font = `800 ${Math.round(W * 0.044)}px Arial, sans-serif`;
  x.fillText("Contents: 5 Cards", W * 0.07, H * 0.72);
  x.fillStyle = "rgba(255,255,255,0.5)"; x.font = `${Math.round(W * 0.025)}px Arial, sans-serif`;
  ["This pack contains randomly inserted collectable", "cards. Approximate odds vary by set. Keep this",
   "packaging for reference. Not for resale separately.", "© Pokémon / Nintendo / Creatures / GAME FREAK."]
    .forEach((t, i) => x.fillText(t, W * 0.07, H * 0.755 + i * H * 0.027));
  x.fillStyle = "rgba(255,255,255,0.85)"; x.textAlign = "right"; x.font = `700 ${Math.round(W * 0.03)}px Arial, sans-serif`;
  x.fillText("SWENTS-GMU-OOT", W * 0.94, H * 0.8);

  // stylised Pokémon wordmark (bottom-right) — yellow fill, blue stroke
  x.textAlign = "right"; x.font = `900 ${Math.round(W * 0.082)}px Arial, sans-serif`;
  x.lineJoin = "round"; x.lineWidth = W * 0.014; x.strokeStyle = "#2a5cc0"; x.strokeText("Pokémon", W * 0.94, H * 0.88);
  x.fillStyle = "#ffcb05"; x.fillText("Pokémon", W * 0.94, H * 0.88);

  // fruit pips (bottom-left): strawberry, blueberry, crescent moon
  x.fillStyle = "#e23b5a"; x.beginPath(); x.arc(W * 0.11, H * 0.85, W * 0.028, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#3b6fe2"; x.beginPath(); x.arc(W * 0.18, H * 0.86, W * 0.024, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#ffd24a"; x.beginPath(); x.arc(W * 0.24, H * 0.85, W * 0.026, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = "destination-out"; x.beginPath(); x.arc(W * 0.252, H * 0.845, W * 0.022, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
  _backTex = tex; return tex;
}
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
  // a WIDE bright band (azimuth-independent) so every pack on the wheel — at any
  // rotation — reflects a foil sheen, not only the front one
  g.addColorStop(0.0, "#20243a");
  g.addColorStop(0.30, "#8a8fc0");
  g.addColorStop(0.46, "#eef1ff");
  g.addColorStop(0.5, "#ffffff");  // bright core → the glint
  g.addColorStop(0.54, "#eef1ff");
  g.addColorStop(0.70, "#8a8fc0");
  g.addColorStop(1.0, "#10131f");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A few card-backs that drift slowly UPWARD at the middle depth of the wheel (z≈0),
// so the carousel has a sense of cards rising through it. Placed in the 3D scene (not
// a flat CSS layer), they depth-sort with the packs: behind the popped front pack,
// in front of the back ones. They look like REAL card backs — opaque, with rounded
// corners (the card-back art is drawn into a rounded-rect clip so the plane's corners
// are cut away) — only fading at the very top/bottom of their travel so they don't pop.
function makeRisingCards() {
  const tex = roundedCardBackTexture();
  const COUNT = 6;
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 88 / 63); // a card's 63:88 portrait
  const cards = [];
  const rand = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); }; // 0..1, seeded by index
  for (let i = 0; i < COUNT; i++) {
    // OPAQUE rounded card backs (alphaTest cuts the corners — no see-through body),
    // just heavily DIMMED via a dark colour multiply so they recede behind the packs
    // and never upstage the wheel.
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x3a3e52, alphaTest: 0.5 });
    const m = new THREE.Mesh(geo, mat);
    const u = {
      x: (rand(i, 1) - 0.5) * 7.5,        // spread across the wheel's width
      z: -1.8 + rand(i, 2) * 1.6,         // sit a bit BEHIND the ring centre → recede
      speed: 0.5 + rand(i, 3) * 0.7,      // rise speed (units/sec)
      scale: 0.65 + rand(i, 4) * 0.5,
      rot: (rand(i, 5) - 0.5) * 0.45,
      y: -7 + i * (14 / COUNT),           // staggered start heights
    };
    m.userData = u;
    m.position.set(u.x, u.y, u.z);
    m.rotation.z = u.rot;
    m.scale.setScalar(u.scale);
    m.renderOrder = -1; // draw behind the packs; depth test still occludes
    group.add(m); cards.push(m);
  }
  return {
    group,
    update(dt) {
      for (const m of cards) {
        const u = m.userData;
        u.y += u.speed * dt;
        if (u.y > 7) u.y -= 14;   // wrap back to the bottom; they slide on/off at the screen edges
        m.position.y = u.y;
      }
    },
  };
}

// card-back.jpg drawn into a ROUNDED-RECT clip → a texture whose corners are
// transparent, so the rising card planes read as real (rounded) cards, not sharp
// rectangles. Shared by every rising card.
let _cardBackTex = null;
function roundedCardBackTexture() {
  if (_cardBackTex) return _cardBackTex;
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  const im = new Image();
  im.crossOrigin = "anonymous";
  im.onload = () => {
    const W = im.naturalWidth, H = im.naturalHeight;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    const r = Math.min(W, H) * 0.075; // corner radius
    x.beginPath();
    x.moveTo(r, 0); x.arcTo(W, 0, W, H, r); x.arcTo(W, H, 0, H, r);
    x.arcTo(0, H, 0, 0, r); x.arcTo(0, 0, W, 0, r); x.closePath();
    x.clip();
    x.drawImage(im, 0, 0, W, H);
    tex.image = c; tex.needsUpdate = true;
  };
  im.src = "assets/card-back.jpg";
  _cardBackTex = tex;
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
    tex.anisotropy = 16;
    tex.needsUpdate = true;
    return tex;
  });
  _texCache.set(key, pr);
  return pr;
}

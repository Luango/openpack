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
// Phones (coarse pointer) carry the whole "卡顿" complaint, so the carousel scales
// itself down there: no MSAA, a lower pixel-ratio cap, and thinner ambient particle
// fields. Desktop keeps the full-fat render. One flag drives every mobile dial below.
const COARSE = matchMedia("(pointer: coarse)").matches;
// On phones (COARSE) the carousel maps a SMALLER texture onto each pack — ~half the
// bytes AND under half the pixels to decode + upload to the GPU, which is the single
// biggest per-texture cost on a phone. Only the known shared art has a -720 variant;
// any custom pack art falls through and loads at its own resolution. The index.html
// <link rel=preload media="(pointer:coarse)"> mirrors this so the right file is fetched.
const MOBILE_TEX = COARSE ? {
  "assets/pack-hi.webp": "assets/pack-hi-720.webp",
  "assets/pack-back-hi.webp": "assets/pack-back-hi-720.webp",
} : {};
const texSrc = (path) => MOBILE_TEX[path] || path;
// Seconds the canvas takes to cross-dissolve into the 2D tear-pack once the hero lands.
// (Mirrors #select-stage's CSS opacity transition; set inline so it's self-contained.)
const DISSOLVE = 0.4;
// Seconds the bright lit canvas takes to fade UP when we REPLAY the entrance (the
// transition back from a collected pull). Without it the opaque WebGL backdrop snaps
// in over the dark reveal screen — a hard dark→bright jump; fading it ramps the
// brightness in, in step with #scene-bg's settle behind it.
const REENTER_FADE = 0.6;

// The default roster — a wheel of identical sealed packs to pick from (the gacha
// feel: same art, you choose which one to open). `img` is the source art; `hue`
// recolours it on a canvas (0 = leave the art untouched); `accent` tints the HTML
// name plate. To give a pack its OWN real art, point `img` at a new file (hue: 0).
export const DEFAULT_PACKS = Array.from({ length: 10 }, (_, i) => ({
  id: `genetic-apex-${i + 1}`,
  name: "Genetic Apex",
  sub: "Genetic Apex",
  img: "assets/pack-hi.webp", // hi-res WebP (1083×1794, ~270KB, transparent bg) — crisp on the 3D mesh
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
// How far each pack YAWS toward "radially outward". 1.0 = a true REVOLVER: the front
// pack faces you, the side packs turn, and the back packs face AWAY from the screen.
// (Even lighting across all those facings is handled by using only azimuth-uniform
// light — hemisphere + env — with NO directional key; see the lighting block.)
const TURN      = 1.0;
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

export function createSelector({ mountEl, packs = DEFAULT_PACKS, onSelect, onChange, getHandoffRect, onLand, onIntroEnd }) {
  // --- renderer / scene / camera -------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: !COARSE, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0); // transparent — the page's nebula bg shows through
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mountEl.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  // z-index 1 keeps the canvas BELOW the .select-ui overlay (z 2) so the OPEN
  // button stays clickable; the overlay is pointer-events:none elsewhere, so drags
  // still fall through to the canvas.
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;z-index:1;";

  const scene = new THREE.Scene();
  // Fog tinted to the aurora's mid-horizon indigo (not the old near-black) so the back
  // of the ring recedes into a LIT haze that blends with the shader backdrop, instead
  // of fading every far pack into a dark halo against the brighter background.
  scene.fog = new THREE.Fog(0x2b3168, FOG_NEAR, FOG_FAR);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, CAM_H, CAM_D);
  camera.lookAt(0, LOOK_Y, 0);

  // LIGHTING — a cinematic rig for a REVOLVER of identical packs: a soft, even BASE so
  // no pack ever falls black whichever way it faces, a gentle KEY for dimensionality,
  // a cool RIM for separation, and — the centrepiece — a warm SPOT that is the FRONT
  // pack's OWN light: whatever pack revolves to the front sits in it and pops with a
  // real key + a live foil specular, while the side/back packs stay on the cool base.
  //
  // (1) BASE — azimuth-uniform fill (depends on a surface's up-ness, not its facing),
  //     so turned/back packs don't go dark. Kept LOW to leave headroom for the spot.
  scene.add(new THREE.AmbientLight(0xffffff, 1.45)); // ~2× fill — lifts EVERY pack (incl. sides) so the scene isn't dark around the spotlit centre
  scene.add(new THREE.HemisphereLight(0xdce2ff, 0x3a3354, 2.6)); // cool sky / lifted violet floor → mood + shape, no dead-black undersides
  // (2) KEY — a soft warm directional from upper front-left rakes a light-to-shade
  //     gradient across the foil so the packs read as dimensional, not flat prints.
  const key = new THREE.DirectionalLight(0xfff1da, 1.2);
  key.position.set(-4, 5, 8);
  scene.add(key);
  // (3) RIM — cool, from behind/above, peels the back of the wheel off the black bg.
  const rim = new THREE.DirectionalLight(0xbcd2ff, 1.15);
  rim.position.set(0, 5, -10);
  scene.add(rim);
  // (4) FRONT SPOT — the focused pack's dedicated light. A warm cone pooled on the
  //     front dock (between the lens and the ring), aimed at where the hero sits. Decay
  //     + cone keep it OFF the side/back packs, so it reads as a stage spotlight that
  //     the wheel turns each pack through — bright key + a sweeping foil highlight.
  // intensity tripled (was 30) + decay eased (was 1.4) so the centred pack actually
  // POPS — the cone+decay still keep it pooled on the front dock, so side/back packs
  // stay on the cool base and don't get washed out.
  const frontSpot = new THREE.SpotLight(0xfff0d6, 150, 14, 0.66, 0.65, 1.15);
  frontSpot.position.set(0.5, 2.6, CAM_D - 3.5);
  frontSpot.target.position.set(0, 0, RING_R + FRONT_PUSH);
  scene.add(frontSpot);
  scene.add(frontSpot.target);

  // A soft equirect "environment" built from a canvas gradient gives the foil a
  // moving holographic sheen (metalness reflects it) as packs rotate — cheap, no HDR.
  scene.environment = makeEnvTexture();

  // --- shader backdrop: a lit Pokémon-palette aurora ------------------------
  // The canvas is transparent, so the carousel used to sit on the page's near-black
  // bg → "太黑太暗". This fills the frame FIRST with a drifting aurora (deep indigo →
  // electric blue → cyan, a warm stage-glow pooled behind the front pack, soft
  // vignette). It's ONE fullscreen quad drawn in clip space (camera-independent, no
  // fog/projection) with a loop-free fragment shader — the brightness lift at almost
  // no GPU cost. Quieter on phones (uMobile) to keep fill-rate down.
  const backdrop = makeBackground();
  scene.add(backdrop.mesh);

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
  // Glossy-floor reflections live in their own group so the whole set can be hidden in
  // one flag (during the breakaway). Each is a flat textured quad mirrored about its
  // pack's base — see buildReflection / placeReflection.
  const reflGroup = new THREE.Group();
  scene.add(reflGroup);
  const reflGeoCache = new Map();
  function reflGeometry(aspect) {
    const key = aspect.toFixed(3);
    if (!reflGeoCache.has(key)) reflGeoCache.set(key, new THREE.PlaneGeometry(1, aspect));
    return reflGeoCache.get(key);
  }
  // On PHONES the reflection samples a heavily downscaled copy of the pack art (a dim,
  // faded floor ghost doesn't need full-res foil) — far less texture bandwidth per frame.
  // Desktop reflects the full-res art. Downscaled textures are tracked for disposal.
  const reflTexes = [];
  const _reflTexCache = new Map();
  function reflTex(srcTex) {
    if (!COARSE || !srcTex?.image) return srcTex;
    if (_reflTexCache.has(srcTex)) return _reflTexCache.get(srcTex);
    let out = srcTex;
    try {
      const img = srcTex.image, w = 160, h = Math.max(1, Math.round(w * (img.height / img.width)));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      out = new THREE.CanvasTexture(cv);
      out.colorSpace = THREE.SRGBColorSpace;
      reflTexes.push(out);
    } catch { /* tainted/!decoded → reflect the full-res texture */ }
    _reflTexCache.set(srcTex, out);
    return out;
  }
  // Build (once) the reflection quad for a pack: same front art, a dim cool tint, and a
  // per-pixel vertical fade that's bright at the contact line and gone toward the floor.
  function buildReflection(mesh, faceTex, aspect) {
    if (mesh.userData.refl) return;
    const mat = makeReflectionMaterial(reflTex(faceTex));
    const r = new THREE.Mesh(reflGeometry(aspect), mat);
    r.frustumCulled = false; // it tracks its pack each frame; let the pack own visibility
    r.visible = false;       // placeReflection turns it on once positioned
    reflGroup.add(r);
    mesh.userData.refl = r;
  }
  // Mirror a pack's CURRENT transform about its own base into its reflection quad, and
  // set the reflection's opacity from the pack's opacity × how square-on it is. The quad
  // now carries BOTH faces (front + back art), so a pack turned away still casts a
  // reflection — we reflect whichever face it shows and only fade through the edge-on
  // side (where the flat quad has near-zero projected area anyway). Called wherever
  // packs are laid out.
  function placeReflection(mesh) {
    const r = mesh.userData.refl;
    if (!r) return;
    const aspect = mesh.userData.aspect || 1.4;
    const half = mesh.scale.y * aspect * 0.5;        // half the pack's on-screen height
    const bottom = mesh.position.y - half;           // world-y of the pack's base
    r.position.set(mesh.position.x, 2 * bottom - mesh.position.y, mesh.position.z);
    r.rotation.y = mesh.rotation.y;                  // yaw is unchanged by a vertical mirror
    r.scale.set(mesh.scale.x, -mesh.scale.y, mesh.scale.z); // negative-y → mirror vertically
    r.renderOrder = mesh.renderOrder - 1;            // sit just behind its own pack
    const mat0 = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const packOp = mat0 && mat0.transparent ? mat0.opacity : 1;
    const c = Math.cos(mesh.rotation.y);
    r.material.uniforms.uBack.value = c < 0 ? 1 : 0;            // turned away → reflect the BACK art
    const facing = smoothstep(0.06, 0.4, Math.abs(c));          // front OR back on; fade through the edge-on side
    const op = packOp * facing;
    r.material.uniforms.uOpacity.value = op;
    // Phones: only the FRONT-most packs cast a reflection — the side/back ones are small,
    // dim and barely seen, so culling them slashes transparent overdraw (the carousel's
    // biggest mobile cost) while the prominent hero reflection stays.
    r.visible = op > 0.01 && (!COARSE || mesh.position.z > RING_R * 0.45);
  }

  // one MeshStandardMaterial per pack (per-mesh so opacity/flash can vary in the
  // selection animation); the curved pillow + scene env give it the foil sheen.
  function makePackMaterial(faceTex) {
    return new THREE.MeshStandardMaterial({
      map: faceTex,
      roughness: 0.42,         // satin foil — a soft sheen that rolls off, not a hot blowout
      metalness: 0.45,         // foil — reflects the (azimuth-uniform) env sheen on EVERY facing
      envMapIntensity: 1.2,
      emissive: 0xffffff,
      emissiveMap: faceTex,
      emissiveIntensity: 0.5,  // self-light so the art reads vivid even in shadow (lifted for a brighter, punchier pack)
      side: THREE.DoubleSide,  // closed pouch — keeps both sheets lit at any angle
      alphaTest: 0.5,          // the art has a TRANSPARENT bg → cut those pixels away,
                               // else they render as solid black (the dark edge fill)
    });
  }
  // identical-aspect packs share ONE pillow geometry (built once, on first texture)
  const geoCache = new Map();
  function packGeometry(aspect) {
    const key = aspect.toFixed(3);
    if (!geoCache.has(key)) geoCache.set(key, makePackGeometry(aspect));
    return geoCache.get(key);
  }

  // RIM LIGHT + BORDER BEAM, per pack. A glowing outline ribbon, traced from the
  // art's own alpha so it HUGS the real pouch silhouette (crimped top, tapered
  // sides), is attached to each pack mesh — so it rotates, pops and scales WITH the
  // pack on the wheel. A weak always-on warm rim rings the whole edge; a bright
  // comet sweeps around it. One ShaderMaterial per pack (so each can fade in the
  // intro/selection), all ticked from the same clock so the beams move in sync.
  const rimMats = [];
  const rimGeoCache = new Map();
  const wallGeoCache = new Map();
  function addRimBeam(mesh, img, aspect) {
    if (mesh.userData.rim) return; // already built (texture promise can resolve once)
    const outline = traceOutline(img);
    if (!outline) return;
    const key = aspect.toFixed(3);
    // EDGE WALL — a solid silver-foil band standing along the silhouette, spanning the
    // foil thickness (±EDGE_T in z). The two art sheets are an OPEN pillow, so edge-on
    // you used to see straight through the slit between them (the "transparent" pack).
    // This wall closes that slit: edge-on it reads as a solid silver foil edge (matching
    // the design sheet's slim side view); head-on it's a thin silver rim under the glow.
    if (!wallGeoCache.has(key)) wallGeoCache.set(key, makeEdgeWall(outline, EDGE_T));
    const wall = new THREE.Mesh(wallGeoCache.get(key), makeEdgeMaterial());
    mesh.add(wall);
    mesh.userData.wall = wall;
    // a flat outline ribbon hugging the silhouette, floated just PROUD of its own front
    // sheet (z=RIM_Z). depthTest is ON (see makeRimMaterial), so the ribbon must clear its
    // own pack body or that body would bury it — but a pack physically IN FRONT on the
    // wheel writes nearer depth and correctly OCCLUDES this rim. The float is tiny (well
    // under the body's mid bulge) so head-on it still reads as the outline glow.
    if (!rimGeoCache.has(key)) rimGeoCache.set(key, makeRimGeometry(outline, 0.046, RIM_Z));
    const mat = makeRimMaterial();
    const rimMesh = new THREE.Mesh(rimGeoCache.get(key), mat);
    // Draw AFTER every pack (packs reach renderOrder ~43, the breakaway hero 999) so the
    // rim sits in the transparent pass on top of its own art, while still depth-tested
    // against the opaque pack bodies. The layout() facing-fade keeps far-back packs from
    // bleeding their rim forward.
    rimMesh.renderOrder = 1000;
    mesh.add(rimMesh);        // child → inherits the pack's rotation / pop / scale
    mesh.userData.rim = rimMesh;
    rimMats.push(mat);
  }

  // Each pack's art/material/rim are built when its texture decodes. The intro waits
  // on these (Promise.all below) so EVERYTHING — geometry, both face materials, the rim
  // shader, the edge wall — is built and uploaded BEFORE the first animated frame. That
  // turns the old mid-flight stalls (texture swap, lazy shader compile) into one warm-up
  // before the motion, which is the bulk of the mobile "卡顿" during the entrance.
  const assetsReady = [];
  packs.forEach((p) => {
    const placeholder = new THREE.MeshStandardMaterial({ color: 0x222030, roughness: 0.6, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.4), placeholder);
    // flip: eased inspect-rotation. aspect: art height/width — the geometry's local
    // height equals it, so the handoff can size the pack to the SVG pack's screen rect.
    mesh.userData = { pack: p, flip: 0, flipTo: 0, aspect: 1.4 };
    group.add(mesh);
    meshes.push(mesh);
    const pr = loadFaceTexture(p).then((tex) => {
      const aspect = tex.image.height / tex.image.width; // true art aspect
      mesh.userData.aspect = aspect;
      mesh.geometry.dispose();              // drop the placeholder plane (shared geo is kept)
      mesh.geometry = packGeometry(aspect);
      // The FRONT face shows the printed art; the BACK face shows the real G-MAX AURA
      // back (per the product design sheet) — different art per face, mapped to the two
      // geometry groups. The flight rotates each pack 180° (its back faces the lens
      // mid-arc), so the back material must be in place BEFORE the intro to avoid a
      // swap stall — we resolve this pack's readiness only once both faces are set.
      const frontMat = makePackMaterial(tex);
      mesh.material = frontMat;
      addRimBeam(mesh, tex.image, aspect); // rim light + border beam, hugging the art's silhouette
      buildReflection(mesh, tex, aspect);  // glossy-floor reflection of the front art
      return loadBackTexture()
        .then((backTex) => {
          mesh.material = [frontMat, makePackMaterial(backTex)];
          if (mesh.userData.refl) mesh.userData.refl.material.uniforms.uBackMap.value = reflTex(backTex); // the floor reflects the back too
        })
        .catch(() => { /* no back art → keep the front on both faces (refl falls back to front) */ });
    }).catch(() => { /* art failed to load → the intro timeout still fires it */ });
    assetsReady.push(pr);
  });

  // --- carousel state -------------------------------------------------------
  // `pos` is the continuous index at the FRONT of the wheel (can run past N — the
  // ring wraps). `vel` carries fling momentum (index units / second).
  const N = meshes.length;
  const STEP = (Math.PI * 2) / N; // angle between adjacent packs
  // above this fling speed (index/sec) we suppress the per-pack tick — packs are
  // whipping past too fast to tick musically; ticks resume as it slows into place
  const TICK_VEL = 6;
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
      // Keep the rim/beam lit on the front AND side packs (so the side isn't "empty"),
      // and fade it only on the FAR-BACK packs — depthTest is off, so a fully-turned
      // back pack would otherwise bleed its rim forward over the front of the wheel.
      // (intro/selection drive this via applyOpacity instead.)
      const rim = m.userData.rim;
      if (rim) rim.material.uniforms.uOpacity.value = rimFade(Math.cos(a));
      placeReflection(m);
    }
  }

  // a gentle vertical bob, strongest on the front pack, for a touch of life
  let t = 0;
  function bobY(front) { return REDUCED ? 0 : front * Math.sin(t * 1.0) * 0.05; }

  function applyOpacity(mesh, op) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mm) => { mm.transparent = op < 1; mm.opacity = op; });
    const rim = mesh.userData.rim; // the rim/beam fades right along with its pack
    if (rim) rim.material.uniforms.uOpacity.value = op;
    const wall = mesh.userData.wall; // the silver edge wall fades with it too
    if (wall) { wall.material.transparent = op < 1; wall.material.opacity = op; }
  }

  // Gate a mesh's rim by its current facing, ON TOP of whatever opacity applyOpacity
  // just set (its intro fade-in). layout() owns this fade in the idle carousel; the
  // intro entrance doesn't call layout(), so stepIntro calls this after applyOpacity —
  // otherwise a pack rotated to the back would draw its highlight over the front packs.
  function fadeRimByFacing(mesh) {
    const rim = mesh.userData.rim;
    if (rim) rim.material.uniforms.uOpacity.value *= rimFade(Math.cos(mesh.rotation.y));
  }

  // --- render loop (parked while hidden) ------------------------------------
  let raf = null, last = 0, selecting = false, lastIdx = -1, dissolving = false;
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
    backdrop.update(t);                                   // drift the aurora
    for (const m of rimMats) m.uniforms.uTime.value = t; // sweep every pack's beam in sync
    // While dissolving we hold the hero frozen on its landed frame — running layout()
    // here would snap every pack (incl. the hero) back to the idle ring, so skip it.
    if (!selecting && !introing && !dissolving) layout();

    // Tell the host when the focused pack changes (a tick + name plate). During a
    // FAST fling we update the index silently (no host tick) — firing the per-pack
    // sound for every pack whipping past was an audio machine-gun that piled up and
    // trailed the spin. Below TICK_VEL it ratchets pack-by-pack into the settle, which
    // is the satisfying feel anyway. The final landing always ticks (vel → 0).
    const idx = modIndex();
    if (idx !== lastIdx && !selecting && !introing && !dissolving) {
      const spinning = Math.abs(vel) > TICK_VEL;
      lastIdx = idx;
      if (!spinning) onChange?.(packs[idx], idx);
    }
    renderer.render(scene, camera);
  }
  function play() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function pause() { if (raf) cancelAnimationFrame(raf); raf = null; }

  // --- sizing ---------------------------------------------------------------
  function resize() {
    const w = mountEl.clientWidth || window.innerWidth;
    const h = mountEl.clientHeight || window.innerHeight;
    // cap the backing-store resolution: 1.5× on a phone (a DPR-3 screen would
    // otherwise render 9× the fragments of CSS pixels — the carousel's biggest cost)
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, COARSE ? 1.5 : 2));
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
    if (selecting || introing || dissolving) return;
    dragging = true;
    vel = 0; targetPos = null; // a fresh grab cancels any in-flight goto / fling
    down = { x: e.clientX, y: e.clientY, pos, moved: 0, t: now(), lastX: e.clientX, lastT: now() };
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* stray/synthetic id — fine */ }
  }
  // onMove ONLY updates wheel state (pos + fling velocity) — it must NOT render.
  // With pointer capture, mobile fires pointermove far faster than the frame rate and
  // uncoalesced; calling layout() here ran the whole ring re-place once PER event,
  // flooding the main thread between frames. That starved the rAF loop (the visible
  // 卡顿 on drag) AND delayed the per-pack tick (onChange fires from inside frame()),
  // so the audio trailed the spin. The render loop already lays out every tick while
  // dragging — so we just stash state here and let rAF draw it once per real frame.
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
    if (selecting || dissolving) return;
    selecting = true;
    selT = 0; vel = 0;
    reflGroup.visible = false; // drop the floor reflections for the fly-to-lens breakaway
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
    // the rim/beam fades OUT as the chosen pack zooms in — the SVG tear-pack it lands
    // on has none, so the rim is gone well before the cross-dissolve (no popping seam)
    const heroRim = heroMesh.userData.rim;
    if (heroRim) heroRim.material.uniforms.uOpacity.value = Math.max(0, 1 - selT / 0.55);
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
  // Landed: the hero now sits exactly over the (still-hidden) SVG pack. We DON'T hard-cut
  // to it — a straight swap pops, because the 3D pack carries lighting, a foil specular
  // and a slight pillow bulge the flat SVG print doesn't, so even at a matched rect the
  // switch reads as a visible "cutoff". Instead we FREEZE the hero on its landed frame
  // (dissolving makes frame() skip the idle layout that would otherwise snap it back to
  // the ring) and hand the host a `reveal` callback. The host shows the SVG pack UNDER
  // the still-opaque canvas, then calls reveal() → the canvas cross-dissolves (opacity
  // 1→0) over the identical SVG pack and only then parks. 3D melts into 2D, no seam.
  function finishSelect() {
    selecting = false;
    dissolving = true; // hold the hero put; frame() skips layout() while this is set
    if (onLand) onLand(startDissolve);
    else startDissolve();
  }
  // Cross-dissolve the canvas (showing the frozen, landed hero) out over the SVG pack the
  // host just revealed beneath it, then park the layer. rAF keeps running through the fade
  // so the hero stays painted; only after it's fully transparent do we pause + .gone.
  function startDissolve() {
    mountEl.style.transition = `opacity ${DISSOLVE}s ease`;
    // flip on the NEXT frame so the browser has committed opacity:1 before transitioning
    requestAnimationFrame(() => { mountEl.style.opacity = "0"; });
    setTimeout(() => {
      pause();
      mountEl.classList.add("gone");
      mountEl.style.opacity = ""; mountEl.style.transition = ""; // reset for the next show()
      dissolving = false;
    }, DISSOLVE * 1000 + 40);
  }

  // ---- intro entrance: queue the packs in to build the ring ----------------
  // Hold the intro until the art is decoded and the GPU is warm, THEN start the
  // motion. Nothing renders before this fires (the rAF loop is parked), so the user
  // just sees the page's nebula bg for the load beat — far better than animating a
  // ring that hitches every time a texture/shader finishes compiling mid-flight.
  // A timeout backstops a slow/failed asset so the entrance always plays.
  function startIntroWhenReady(fadeIn = false) {
    let started = false;
    const begin = () => {
      if (started) return; started = true;
      // Arm the entrance FIRST (every pack opacity→0) so the throwaway warm-up render
      // below paints nothing visible — otherwise the full ring would flash for a frame.
      initIntro();
      // Warm the GPU NOW, while the canvas shows nothing, so the first ANIMATED frame
      // is clean. Two distinct costs, both otherwise paid lazily mid-entrance (the bulk
      // of the first-open 卡顿):
      //   1. SHADER COMPILE — renderer.compile() builds every program (packs, rim beam,
      //      edge wall, particles) up front.
      //   2. TEXTURE UPLOAD — compile() does NOT upload textures; the big 1083×1794 foil
      //      WebPs (front + back) would otherwise decode-upload on the first draw and hitch
      //      the motion. initTexture() forces each onto the GPU here, and one throwaway
      //      render() uploads anything else actually drawn (env sheen, particles, motes).
      try {
        renderer.compile(scene, camera);
        const texes = new Set();
        if (scene.environment) texes.add(scene.environment);
        meshes.forEach((m) => (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => {
          if (mm?.map) texes.add(mm.map);
          if (mm?.emissiveMap) texes.add(mm.emissiveMap);
        }));
        texes.forEach((tx) => { try { renderer.initTexture(tx); } catch { /* ignore */ } });
        renderer.render(scene, camera); // packs are at opacity 0 → invisible, but textures upload
      } catch { /* warm-up is best-effort */ }
      play();
      // Now that the first lit frame is painting, ramp the canvas up from 0 (a replay
      // re-entry only — see show()). The dark reveal bg brightens into the carousel
      // instead of the opaque backdrop popping in. Flip on the next frame so the
      // browser has committed opacity:0 before the transition runs.
      if (fadeIn) {
        requestAnimationFrame(() => {
          mountEl.style.transition = `opacity ${REENTER_FADE}s ease`;
          mountEl.style.opacity = "1";
          setTimeout(() => { mountEl.style.transition = ""; }, REENTER_FADE * 1000 + 60);
        });
      }
    };
    Promise.all(assetsReady).then(begin);
    setTimeout(begin, 1500); // never hang on a stalled asset
  }

  // Arm the entrance: hide every pack, schedule each to launch INTRO_ARR apart
  // (mesh 0 leads), and reset the wheel carry. The frame loop runs stepIntro.
  function initIntro() {
    introing = true; introT = 0; introSettle = 0; wheelAngle = 0; introOutro = false; wheelVel = 0;
    introState = meshes.map((m, i) => ({ launched: false, docked: false, slotAngle: 0, t0: i * INTRO_ARR }));
    // Hide every pack AND its floor reflection up front. On a REPLAY entrance (the
    // transition back after a pull is collected) the reflections were left visible by
    // the previous idle ring — without this they'd hang on the floor under packs that
    // haven't flown in yet (a reflection with no pack). stepIntro re-shows each as its
    // pack launches.
    meshes.forEach((m) => { applyOpacity(m, 0); m.userData.flip = m.userData.flipTo = 0; if (m.userData.refl) m.userData.refl.visible = false; });
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
      if (tt < 0) { applyOpacity(m, 0); if (m.userData.refl) m.userData.refl.visible = false; allDocked = false; continue; } // not launched yet → no pack, no reflection
      // Fix the slot this pack will own the instant it launches — the spot that will be
      // at the BACK when it arrives (ARC later). Knowing it up front lets the flight
      // blend INTO the wheel's motion at the end, so it arrives already moving with the
      // ring (velocity-continuous) instead of landing, stopping, then being towed.
      if (!s.launched) { s.launched = true; s.slotAngle = Math.PI - (wheelAngle + INTRO_DIR * wheelSpeed * (INTRO_ARC - tt)); sfx.packWhoosh?.(i, N); } // airy swoosh as each pack is thrown onto its arc
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
        fadeRimByFacing(m); // a pack turning to the back must not bleed its rim forward
        m.renderOrder = Math.round(m.position.z * 10);
        if (p >= 1) { s.docked = true; sfx.cardTap?.(2); } // seats on the ring → a soft landing tap (slotAngle already fixed at launch)
      } else {                                        // a ring member, carried by the wheel
        m.position.set(rX, rY, rZ);
        m.rotation.y = a * TURN;
        m.scale.setScalar(rScale);
        applyOpacity(m, 1);
        fadeRimByFacing(m); // back-facing ring members keep their rim hidden too
        m.renderOrder = Math.round(m.position.z * 10);
      }
      placeReflection(m); // the reflection rides along through the fly-in too
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
    // The entrance is over and the wheel is idle — NOW the host can do its heavy
    // main-thread work (build + render the next booster's card stack). Deferring it
    // to here keeps that DOM build off the intro's frames, where it caused jank.
    onIntroEnd?.();
  }

  // ---- public API ----------------------------------------------------------
  return {
    el: mountEl,
    // show({ intro }) — reveal the carousel. The first show always plays the queue-in
    // entrance; later shows reveal the ring directly UNLESS `intro: true` is passed, which
    // REPLAYS the entrance (used as the transition back after a pull is collected, so you
    // re-enter through the same packs-flying-in animation rather than a hard cut to the ring).
    show({ intro = false } = {}) {
      mountEl.classList.remove("gone");
      // A REPLAY entrance (intro:true after the first show) re-enters from the dark reveal
      // screen, so fade the bright canvas UP instead of snapping to opacity 1 — see
      // REENTER_FADE. The first show sits behind the start-gate's own fade, so it snaps.
      const reenter = introDone && intro;
      if (reenter) { mountEl.style.transition = "none"; mountEl.style.opacity = "0"; }
      else { mountEl.style.opacity = "1"; }
      selecting = false; dissolving = false; heroMesh = null; lastIdx = -1; vel = 0;
      reflGroup.visible = true; // restore the floor reflections (the breakaway hid them)
      meshes.forEach((m) => { applyOpacity(m, 1); m.userData.flip = m.userData.flipTo = 0; setFaceFlash(m, 0); });
      particles.points.material.opacity = 0.6;
      resize();
      // first entrance — OR an explicit replay — plays the queue-in intro (and hands off
      // via onIntroEnd, which pre-arms the next pack); otherwise reveal the ring directly.
      if (!introDone || intro) { introDone = true; startIntroWhenReady(reenter); }
      else { mountEl.style.opacity = "1"; layout(); play(); }
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
      rimGeoCache.forEach((g) => g.dispose());  // the rim/beam ribbons
      rimMats.forEach((m) => m.dispose());
      wallGeoCache.forEach((g) => g.dispose()); // the silver edge walls
      meshes.forEach((m) => m.userData.wall?.material.dispose());
      reflGeoCache.forEach((g) => g.dispose()); // the reflection quads
      meshes.forEach((m) => m.userData.refl?.material.dispose());
      reflTexes.forEach((t) => t.dispose());    // the downscaled mobile reflection textures
      backdrop.mesh.geometry.dispose(); backdrop.mesh.material.dispose();
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
function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
// How bright a pack's rim/beam should be for its facing — full on the front & side
// packs, faded to nothing on the ones turned to the back. depthTest now occludes a rim
// behind a nearer pack body, but a pack turned to the BACK floats its rim on the side
// AWAY from the lens (no body in between to hide it), so it would still bleed its glow
// forward. This facing-fade is the judgment that kills a back-turned pack's highlight —
// applied both in the idle layout() and, crucially, through the intro entrance (stepIntro).
function rimFade(cosFacing) { return smoothstep(-0.55, -0.15, cosFacing); }

// Procedural foil-pack geometry — a "pillow": a front and back sheet that bulge
// outward through the body and press FLAT into the crimped seal strips at top and
// bottom (where a real booster is heat-sealed), tapering to a thin lip at every
// edge. The curved surface is what sells the foil — the env/glint sheen slides
// across the bulge as the wheel turns, which a flat plane can never do. UVs are a
// straight 0..1 map so the printed art (incl. its crimp strip) lands correctly.
function makePackGeometry(aspect) {
  const W = 1, H = aspect;
  const NX = 22, NY = 36;          // surface resolution (smooth bulge, cheap)
  const PUFF = 0.062;              // half-thickness ADDED by the card bulge in the body
  const LIP = 0.014;               // base foil half-thickness everywhere — gives the sealed
                                   // edges/crimps a flat, thin foil EDGE instead of tapering
                                   // to needle points (the old side-view "blade" artifact)
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

// ---- rim light + border beam ----------------------------------------------
// Trace the pack art's OUTER silhouette from its alpha, returned as a closed loop
// of points in the mesh's LOCAL coords (x ∈ [-0.5,0.5], y ∈ [-aspect/2, aspect/2],
// image-y flipped to match the geometry). The pouch is one opaque span per row, so
// the outline = its right edge top→bottom + its left edge bottom→top. A high sample
// width + a low alpha cutoff make it hug the true outer edge tightly. Cached per art.
const _outlineCache = new WeakMap();
function traceOutline(img) {
  if (_outlineCache.has(img)) return _outlineCache.get(img);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;
  const CW = 200, CH = Math.max(8, Math.round(CW * ih / iw));
  const cv = document.createElement("canvas"); cv.width = CW; cv.height = CH;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, CW, CH);
  let data; try { data = ctx.getImageData(0, 0, CW, CH).data; } catch { return null; } // tainted → skip the rim
  const A = 18; // low cutoff → the outline sits right at the true outer edge, not inside it
  const left = new Array(CH).fill(-1), right = new Array(CH).fill(-1);
  let maxW = 0;
  for (let y = 0; y < CH; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < CW; x++) if (data[(y * CW + x) * 4 + 3] > A) { if (l < 0) l = x; r = x; }
    if (l >= 0) { left[y] = l; right[y] = r; if (r - l > maxW) maxW = r - l; }
  }
  if (maxW <= 0) return null;
  // Drop the 1px serration TIPS at the very top/bottom seal: a real booster's crimp
  // ends in a tiny saw-tooth nub that traces as a single narrow row and spikes the
  // outline right at the corners. Keep only rows at least ~45% as wide as the body, so
  // the silhouette is the clean pouch rectangle and its four corners sit square.
  const MINW = maxW * 0.45;
  const wide = (y) => right[y] >= 0 && right[y] - left[y] >= MINW;
  let yTop = -1, yBot = -1;
  for (let y = 0; y < CH; y++) if (wide(y)) { if (yTop < 0) yTop = y; yBot = y; }
  if (yTop < 0) return null;
  let pts = [];
  for (let y = yTop; y <= yBot; y++) if (wide(y)) pts.push([right[y] + 1, y + 0.5]); // right edge ↓
  for (let y = yBot; y >= yTop; y--) if (wide(y)) pts.push([left[y], y + 0.5]);        // left edge ↑
  // Simplify the pixel staircase into clean straight edges, then put a SMALL fillet on
  // each corner. The old code ran a Chaikin corner-cut, but Chaikin trims 25% off each
  // adjacent edge — after RDP those edges are the pack's full height/width, so it rounded
  // every corner inward by ~a quarter of the pack and the flowing rim never reached the
  // four corners. roundCorners instead replaces just the corner POINT with a short arc of
  // a fixed small radius: the rim still runs right into each corner (hugging the edge) but
  // turns it on a gentle curve instead of a hard spike (the 流光's four corners read soft).
  pts = rdp(pts, 1.2);
  pts = roundCorners(pts, maxW * 0.045, 5); // radius ≈ 4.5% of pack width — a tiny round-off
  const aspect = ih / iw;
  const out = pts.map(([px, py]) => [px / CW - 0.5, (0.5 - py / CH) * aspect]); // → local mesh coords
  _outlineCache.set(img, out);
  return out;
}

// Half-thickness of the sealed foil EDGE — matches the pillow's LIP so the wall meets
// the front/back sheets right at the silhouette and closes the open slit between them.
const EDGE_T = 0.014;

// Forward float of the rim ribbon, in local z. With depthTest ON, the ribbon must sit
// just PROUD of its own front sheet (which peaks ~0.035 under the ribbon) or that sheet
// would occlude it head-on. Far below the body's mid bulge (~0.076), so the float reads
// as "at the edge", not hovering — yet a pack in front on the wheel still occludes it.
const RIM_Z = 0.045;

// Build a solid EDGE WALL: a band standing along the closed outline, from z=+halfT to
// z=−halfT, so the open pillow becomes a closed pouch. Edge-on it fills the see-through
// slit with a solid silver foil edge; head-on it's a thin rim at the very silhouette.
function makeEdgeWall(outline, halfT) {
  const n = outline.length;
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const p = outline[i];
    pos.push(p[0], p[1], halfT, p[0], p[1], -halfT); // a front-edge vert + a back-edge vert
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;          // wrap the last segment back to the start
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// Brushed-silver foil for the edge wall — metallic so it catches the env sheen as the
// wheel turns, reading as a real foil edge rather than a flat grey band. One per pack
// (so it can fade with its pack during the intro/breakaway).
function makeEdgeMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xb9bdca, metalness: 0.6, roughness: 0.42, envMapIntensity: 1.1, side: THREE.DoubleSide,
  });
}

// Build a flat ribbon (triangle strip) that follows the closed outline, `halfW` wide
// to each side of the edge, at local depth `z`. Centred at z=0 it sits at the middle
// of the foil's thickness — the pack's true edge — so it reads as the edge glow from a
// quarter angle instead of floating proud of the front face. Each vertex carries aArc
// (0..1 along the loop, MONOTONIC — closed with a duplicate start vertex at arc=1 so
// the beam doesn't glitch at the seam) and aSide (-1..1 across the ribbon, for the
// soft cross-section glow in the shader).
function makeRimGeometry(outline, halfW, z) {
  const n = outline.length;
  const seg = new Array(n); let total = 0;
  for (let i = 0; i < n; i++) { const a = outline[i], b = outline[(i + 1) % n]; seg[i] = Math.hypot(b[0] - a[0], b[1] - a[1]); total += seg[i]; }
  if (total < 1e-4) return new THREE.BufferGeometry();
  const pos = [], aArc = [], aSide = [], idx = [];
  let acc = 0;
  for (let i = 0; i <= n; i++) {                 // n+1 verts: the last duplicates the first (arc=1)
    const cur = outline[i % n], prev = outline[(i - 1 + n) % n], next = outline[(i + 1) % n];
    // MITER the offset at corners. The incoming and outgoing edges each have their own
    // normal; the ribbon vertex rides their bisector, lengthened by 1/cos(θ/2) so the
    // OUTER edge reaches the true corner instead of cutting across it (an averaged
    // single normal under-reaches a 90° corner by ~30%, leaving the corner uncovered).
    let e1x = cur[0] - prev[0], e1y = cur[1] - prev[1];
    let e2x = next[0] - cur[0], e2y = next[1] - cur[1];
    const L1 = Math.hypot(e1x, e1y) || 1, L2 = Math.hypot(e2x, e2y) || 1;
    const n1x = -e1y / L1, n1y = e1x / L1;       // unit normal of the incoming edge
    const n2x = -e2y / L2, n2y = e2x / L2;       // unit normal of the outgoing edge
    let mx = n1x + n2x, my = n1y + n2y;          // miter direction = sum of edge normals
    const mL = Math.hypot(mx, my) || 1; mx /= mL; my /= mL;
    let denom = mx * n1x + my * n1y;             // = cos(θ/2): miter length is halfW/denom
    if (denom < 0.35) denom = 0.35;              // cap the spike on very sharp corners
    const hw = halfW / denom;
    const u = i < n ? acc / total : 1;
    if (i < n) acc += seg[i];
    pos.push(cur[0] + mx * hw, cur[1] + my * hw, z); aArc.push(u); aSide.push(1);
    pos.push(cur[0] - mx * hw, cur[1] - my * hw, z); aArc.push(u); aSide.push(-1);
  }
  for (let i = 0; i < n; i++) {
    const i0 = i * 2, i1 = i * 2 + 1, j0 = (i + 1) * 2, j1 = (i + 1) * 2 + 1;
    idx.push(i0, i1, j0, i1, j1, j0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aArc", new THREE.Float32BufferAttribute(aArc, 1));
  g.setAttribute("aSide", new THREE.Float32BufferAttribute(aSide, 1));
  g.setIndex(idx);
  return g;
}

// The beam shader: a weak warm rim everywhere + a bright comet (tight head, trailing
// tail) racing around the loop. Additive, so it reads as LIGHT against the dark scene.
const RIM_VERT = `
  attribute float aArc; attribute float aSide;
  varying float vU; varying float vV;
  void main() { vU = aArc; vV = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIM_FRAG = `
  precision mediump float;
  varying float vU; varying float vV;
  uniform float uTime; uniform float uOpacity;
  uniform vec3 uWarm; uniform vec3 uHot;
  void main() {
    float edge = max(0.0, 1.0 - abs(vV));
    float body = pow(edge, 1.1);                       // broad soft glow across the ribbon
    float hot  = pow(edge, 4.0);                       // a hotter thin core inside it
    float head = fract(uTime * 0.22);                  // the comet's position around the loop
    float ahead = fract(vU - head);
    float behind = fract(head - vU);
    float ring = min(ahead, behind);                   // circular distance to the head
    float comet = exp(-ring * ring / 0.0016);          // bright head
    float tail  = exp(-behind / 0.20) * 0.7;           // exponential tail trailing the head
    float beam = max(comet, tail);
    // weak always-on rim (0.22) + the sweeping comet (dialled back); hot core sharpens it
    float i = (body * (0.22 + 1.7 * beam) + hot * beam * 0.7) * uOpacity;
    vec3 col = mix(uWarm, uHot, clamp(beam, 0.0, 1.0)); // gold rim → white-hot comet
    gl_FragColor = vec4(col * i * 1.12, i);            // mild overdrive → a soft bloom, not a blowout
  }`;
function makeRimMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uWarm: { value: new THREE.Color(0xffc24a) },
      uHot: { value: new THREE.Color(0xfffdf2) },
    },
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,       // glow never occludes — but IS occluded (depthTest below)
    depthTest: true,         // a pack in front on the wheel must hide this rim; the
                             // RIM_Z float keeps its OWN body from burying it
    side: THREE.DoubleSide,
  });
}

// Fillet the corners of a closed polygon: each vertex is replaced by a short arc of
// `radius` (approximated by a quadratic Bézier through the original corner), so the
// flowing rim turns each corner on a gentle curve instead of a hard point. The radius
// is trimmed to <½ of each adjacent edge so neighbouring fillets never overlap, and
// near-straight vertices are passed through untouched. Operates in canvas-px coords.
function roundCorners(pts, radius, segs) {
  const n = pts.length;
  if (n < 3 || radius <= 0) return pts.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const cur = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    let v1x = prev[0] - cur[0], v1y = prev[1] - cur[1];
    let v2x = next[0] - cur[0], v2y = next[1] - cur[1];
    const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
    v1x /= l1; v1y /= l1; v2x /= l2; v2y /= l2;
    if (v1x * v2x + v1y * v2y < -0.985) { out.push([cur[0], cur[1]]); continue; } // ~straight → keep
    const d = Math.min(radius, l1 * 0.5, l2 * 0.5);
    const t1x = cur[0] + v1x * d, t1y = cur[1] + v1y * d; // tangent point on the incoming edge
    const t2x = cur[0] + v2x * d, t2y = cur[1] + v2y * d; // tangent point on the outgoing edge
    for (let s = 0; s <= segs; s++) {                     // quad Bézier t1→corner→t2
      const u = s / segs, iu = 1 - u, w0 = iu * iu, w1 = 2 * iu * u, w2 = u * u;
      out.push([w0 * t1x + w1 * cur[0] + w2 * t2x, w0 * t1y + w1 * cur[1] + w2 * t2y]);
    }
  }
  return out;
}

// Ramer–Douglas–Peucker simplification (epsilon in px).
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
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

// ---- shader backdrop -------------------------------------------------------
// A fullscreen quad painted in CLIP SPACE (the vertex shader writes gl_Position
// directly from a 2×2 plane's xy, so it ignores the camera, fog and projection and
// always fills the frame). The fragment shader is loop-free — a vertical palette
// gradient, two drifting aurora bands, a warm stage-glow behind the front pack and a
// soft vignette — so the whole lit background costs one cheap fullscreen pass. The
// quad is drawn first (renderOrder −1000, depthTest off, no depthWrite) so every pack
// and reflection lands on top of it. uMobile dials the aurora down on phones.
const BG_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }`;
const BG_FRAG = `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;  // viewport w/h → keeps the radial glow round
  uniform float uMobile;  // 1 on phones → calmer aurora
  void main() {
    vec2 uv = vUv;
    // vertical palette: deep base (for reflection contrast) → indigo → electric blue
    vec3 base = vec3(0.07,  0.09,  0.22);
    vec3 mid  = vec3(0.17,  0.24,  0.60);
    vec3 top  = vec3(0.28,  0.50,  0.88);
    vec3 col = mix(base, mid, smoothstep(0.0, 0.55, uv.y));
    col = mix(col, top, smoothstep(0.45, 1.0, uv.y));
    // two slow aurora bands sweeping across the upper field (cyan ↔ violet)
    float t = uTime * 0.06;
    float b1 = sin(uv.x * 3.1 + t * 2.0) * 0.5 + 0.5;
    float b2 = sin(uv.x * 5.7 - uv.y * 2.3 - t * 3.0) * 0.5 + 0.5;
    vec3 aur = mix(vec3(0.16, 0.55, 0.78), vec3(0.42, 0.28, 0.72), b1);
    float aurAmt = (1.0 - 0.55 * uMobile) * 0.28;
    col += aur * pow(b2, 2.0) * smoothstep(0.15, 0.95, uv.y) * aurAmt;
    // warm stage-glow pooled where the focused pack sits (centre, a little high)
    vec2 d = (uv - vec2(0.5, 0.6)) * vec2(uAspect, 1.0);
    col += vec3(1.0, 0.82, 0.52) * smoothstep(0.62, 0.0, length(d)) * 0.30;
    // soft vignette so the corners settle and the packs stay the focus
    col *= 1.0 - smoothstep(0.45, 1.15, length(uv - vec2(0.5))) * 0.55;
    gl_FragColor = vec4(col, 1.0);
  }`;
function makeBackground() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uMobile: { value: COARSE ? 1 : 0 },
    },
    vertexShader: BG_VERT,
    fragmentShader: BG_FRAG,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false; // clip-space quad has no meaningful world bounds
  mesh.renderOrder = -1000;   // always behind packs, reflections and motes
  return {
    mesh,
    update(time) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uAspect.value = (window.innerWidth || 1) / (window.innerHeight || 1);
    },
  };
}

// ---- glossy-floor reflection ----------------------------------------------
// Reflections are flat quads (no lighting math — MeshBasic-equivalent via a tiny
// shader) mirrored under each pack. The shader cuts the art's transparent bg, tints
// it cool, dims it, and fades it OUT with vertical distance from the contact line
// (strongest at uv.y=0 — the pack's base after the vertical mirror — gone toward the
// floor) so it reads as a reflection dissolving into a glossy surface, not a copy.
const REFL_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const REFL_FRAG = `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform sampler2D uBackMap;
  uniform float uBack;                            // 1 when the pack is turned away → reflect its BACK art
  uniform float uOpacity;
  void main() {
    vec2 uv = vUv;
    vec4 tx;
    if (uBack > 0.5) { uv.x = 1.0 - uv.x; tx = texture2D(uBackMap, uv); } // mirror x to match the pack's back UVs (1-u)
    else { tx = texture2D(uMap, uv); }
    if (tx.a < 0.5) discard;                      // drop the pack art's transparent bg
    float fade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4); // bright at the contact, gone below
    vec3 tint = tx.rgb * vec3(0.78, 0.84, 1.0);   // cool, glossy-floor cast
    gl_FragColor = vec4(tint, tx.a * fade * 0.42 * uOpacity);
  }`;
function makeReflectionMaterial(faceTex) {
  return new THREE.ShaderMaterial({
    // uBackMap defaults to the front art so a pack with no back texture still reflects
    uniforms: { uMap: { value: faceTex }, uBackMap: { value: faceTex }, uBack: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: REFL_VERT,
    fragmentShader: REFL_FRAG,
    transparent: true,
    depthWrite: false, // a reflection never occludes; the pack in front still hides it
    depthTest: true,
    side: THREE.DoubleSide, // negative-y scale flips winding
    fog: false,
  });
}

// A few Poké Ball icons that drift slowly UPWARD at the middle depth of the wheel
// (z≈0), so the carousel has a sense of motes rising through it. Placed in the 3D
// scene (not a flat CSS layer), they depth-sort with the packs: behind the popped
// front pack, in front of the back ones. Round icons (the ball is drawn into a
// circular clip so the plane's corners are cut away), tinted down so they recede.
function makeRisingCards() {
  const tex = pokeballTexture();
  const COUNT = COARSE ? 5 : 9;
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1); // square — the Poké Ball icon is round
  const cards = [];
  const rand = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); }; // 0..1, seeded by index
  for (let i = 0; i < COUNT; i++) {
    // Poké Ball icons (alphaTest cuts the plane's corners to the round ball), tinted
    // DOWN via a cool colour multiply so they recede behind the packs as ambiance and
    // never upstage the wheel.
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x3a3e52, transparent: true, opacity: 0.95, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    const u = {
      x: (rand(i, 1) - 0.5) * 9,          // spread across the wheel's width
      z: -3.4 - rand(i, 2) * 5,           // ALWAYS behind the ring (−3.4 … −8.4) so they never cross a pack
      speed: 0.18 + rand(i, 3) * 0.32,    // rise speed (units/sec) — slow, gentle drift
      scale: 0.45 + rand(i, 4) * 1.2,     // small → large ↔ size variety
      rot: (rand(i, 5) - 0.5) * 0.5,
      y: -8 + i * (16 / COUNT),           // staggered start heights
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
        if (u.y > 8) u.y -= 16;   // wrap back to the bottom; they slide on/off at the screen edges
        m.position.y = u.y;
      }
    },
  };
}

// A Poké Ball icon drawn on a canvas (transparent outside the ball circle, so the
// plane's corners cut away to a round icon). Shared by every rising element.
let _pokeballTex = null;
function pokeballTexture() {
  if (_pokeballTex) return _pokeballTex;
  const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
  const x = c.getContext("2d");
  const cx = S / 2, cy = S / 2, R = S * 0.46;
  const BLACK = "#1b1c22", WHITE = "#f4f4f6", GREY = "#b9bcc8";
  // body — clipped to the ball circle: BLACK-AND-WHITE — grey top half, white bottom
  // half, black centre band (no colour, so it reads as a monochrome icon)
  x.save();
  x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.clip();
  x.fillStyle = GREY;  x.fillRect(0, 0, S, cy);
  x.fillStyle = WHITE; x.fillRect(0, cy, S, S - cy);
  x.fillStyle = BLACK; x.fillRect(0, cy - S * 0.085, S, S * 0.17);
  x.restore();
  // outer rim
  x.strokeStyle = BLACK; x.lineWidth = S * 0.05;
  x.beginPath(); x.arc(cx, cy, R - x.lineWidth / 2, 0, Math.PI * 2); x.stroke();
  // centre button: black ring → white core
  x.fillStyle = BLACK; x.beginPath(); x.arc(cx, cy, S * 0.135, 0, Math.PI * 2); x.fill();
  x.fillStyle = WHITE; x.beginPath(); x.arc(cx, cy, S * 0.088, 0, Math.PI * 2); x.fill();
  // soften the whole icon — it's only a background mote, it must NOT grab the eye:
  // blur a copy and use THAT, so the details AND the edge read slightly out of focus
  const soft = document.createElement("canvas"); soft.width = soft.height = S;
  const sx = soft.getContext("2d");
  sx.filter = "blur(3px)";
  sx.drawImage(c, 0, 0);
  const tex = new THREE.CanvasTexture(soft);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  _pokeballTex = tex;
  return tex;
}

// A field of slow-drifting glow motes for the "digital space" backdrop.
function makeParticles() {
  // each frame this re-uploads the whole position buffer to the GPU, so the count is
  // a direct per-frame CPU+upload cost — keep the field much thinner on a phone
  const COUNT = COARSE ? 90 : 240;
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
  const pr = loadImg(texSrc(p.img)).then((im) => {
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

// The pack BACK — the real G-MAX AURA art (cropped + green-keyed from the product
// design sheet). One shared texture across the whole rack (the back is identical).
const BACK_IMG = "assets/pack-back-hi.webp";
let _backArtTex = null;
function loadBackTexture() {
  if (_backArtTex) return _backArtTex;
  _backArtTex = loadImg(texSrc(BACK_IMG)).then((im) => {
    const tex = new THREE.Texture(im);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    tex.needsUpdate = true;
    return tex;
  });
  return _backArtTex;
}

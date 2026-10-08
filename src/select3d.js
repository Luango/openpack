// select3d.js — the 3D pack-SELECTION carousel that fronts the tear-to-open flow.
//
// A full 3D ring of sealed football packs (three.js), gacha style: ~10 packs
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
// Pack art: every pack on the wheel is the one procedural pouch from pack3d/asset.js
// (same envelope, same printed atlas). `img`/`hue` are kept on the roster for the host's
// own bookkeeping; the wheel no longer paints per-pack variants.

import * as THREE from "three";
import * as sfx from "./sfx.js";
import { getPackAsset } from "./pack3d/asset.js";
import { buildEnvironment } from "./pack3d/lighting.js";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Phones (coarse pointer) carry the whole "卡顿" complaint, so the carousel scales
// itself down there: no MSAA, a lower pixel-ratio cap, and thinner ambient particle
// fields. Desktop keeps the full-fat render. One flag drives every mobile dial below.
const COARSE = matchMedia("(pointer: coarse)").matches;
// The packs on the wheel ARE the procedural foil pouch of the tear stage: one shared
// asset (pack3d/asset.js) supplies the envelope geometry, the printed atlas and the
// surface maps to both renderers, so the pack you spin, the hero that flies to the
// lens and the pouch you tear are one object. Phones get the -720 print there.
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
  id: `premium-gold-${i + 1}`,
  name: "Premium Gold Pack",
  sub: "OpenPack FC · Ultimate XI",
  img: "assets/pack-hi.webp", // hi-res WebP (1083×1794, transparent bg) — crisp on the 3D mesh
  hue: 0,
  accent: "#d4a63a",
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
// FOCUS LIGHTING — the centred pack is the visual anchor, so it carries a brighter
// self-glow and a hotter foil sheen than its neighbours, which dim as they curve away.
// layout() drives this per pack from `front` (1 at the centre → 0 at the sides), so
// whatever pack the wheel turns to the front LIGHTS UP and the rest recede — the lift
// is in the pack's own material, on top of the shared rig + front spot, so it reads
// even on the side/back facings the spot can't reach.
// Exposure pass (2026-10-08): the lift used to come from a very hot spot, which clipped the
// metal to a flat white-gold band. The hero/bystander contrast is now mostly EXPOSURE —
// each pack's material colour (a plain multiplier on its print) sits at FOCUS_COL_DIM on
// the sides and 1 at the centre, about a stop apart, as if only the centred pack stood in
// the key — with the self-light and sheen giving the rest. Nothing here can clip.
// The self-light is now a low floor (it flattened the metal into a print at 0.2 — the gold
// comes from the reflection room's soft wall behind the lens instead, pack3d/lighting.js).
const FOCUS_EMI_DIM = 0.03, FOCUS_EMI_HOT = 0.1;  // emissive self-light: side → front
const FOCUS_ENV_DIM = 0.85, FOCUS_ENV_HOT = 1.35; // foil env sheen:      side → front
const FOCUS_COL_DIM = 0.62;                       // print exposure on the side packs (1 at the centre)
const HANDOFF_ENV = 0.85;                         // the flown hero lands at the tear stage's foil sheen
                                                  // (pack3d/materials.js EXT_ENV) so the dissolve is seamless
const FOCUS_COL_POW = 6;                          // how tightly exposure + self-light hug the centre: the
                                                  // ring has 10 packs (neighbours at 36°), so a soft curve
                                                  // left them nearly as bright as the hero; this puts the
                                                  // neighbours' exposure at ~0.73
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

export function createSelector({ mountEl, packs = DEFAULT_PACKS, onSelect, onChange, getHandoffRect, onLand, onIntroEnd, onIntroStart }) {
  // --- renderer / scene / camera -------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: !COARSE, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0); // transparent — the page's nebula bg shows through
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // filmic tone mapping, like the tear stage: the metallic foil's hot reflections roll
  // off instead of clipping to flat yellow (the custom stage/rim shaders are untouched)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08; // close to the tear stage's 1.12, so the hero dissolves into it without a brightness step
  mountEl.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  // z-index 1 keeps the canvas BELOW the .select-ui overlay (z 2) so the OPEN
  // button stays clickable; the overlay is pointer-events:none elsewhere, so drags
  // still fall through to the canvas.
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;z-index:1;";

  const scene = new THREE.Scene();
  // Fog tinted to the stage's mid-horizon charcoal (warm, not near-black) so the back
  // of the ring recedes into the lit haze of the shader backdrop, instead of fading
  // every far pack into a dark halo against the brighter background.
  scene.fog = new THREE.Fog(0x1c150d, FOG_NEAR, FOG_FAR);
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
  //     NB (exposure pass, 2026-10-08): the foil is a full metal, and metals have no
  //     diffuse term — so neither of these reaches the gold at all; they only lift the
  //     printed ink (the non-metal parts of the ORM map). The foil's base level comes
  //     from the reflection room instead (pack3d/lighting.js — its soft wall behind the
  //     lens is what a face-on pack mirrors), which is also what the tear stage reflects,
  //     so the landed hero and the stage pack sit at one exposure across the hand-off.
  scene.add(new THREE.AmbientLight(0xfff1d6, 1.5)); // warm fill on the ink
  scene.add(new THREE.HemisphereLight(0xffe4b0, 0x3b2510, 2.2)); // warm from above / bronze floor bounce, on the ink
  // (2) KEY — a soft warm directional from upper front-left rakes a light-to-shade
  //     gradient across the foil so the packs read as dimensional, not flat prints.
  const key = new THREE.DirectionalLight(0xffe6b8, 1.5);
  key.position.set(-4, 5, 8);
  scene.add(key);
  // (3) RIM — gold, from behind/above, peels the back of the wheel off the black bg
  //     with a warm edge highlight instead of a cool one.
  const rim = new THREE.DirectionalLight(0xf0c060, 1.0);
  rim.position.set(0, 5, -10);
  scene.add(rim);
  // (4) FRONT SPOT — the focused pack's dedicated light. A warm cone pooled on the
  //     front dock (between the lens and the ring), aimed at where the hero sits. Decay
  //     + cone keep it OFF the side/back packs, so it reads as a stage spotlight that
  //     the wheel turns each pack through — a soft key pool + a sweeping foil highlight.
  // Exposure pass (2026-10-08): 95 → 14, and the lamp moved OFF the lens axis to the
  // key's side. The camera is at eye level, so a lamp near the axis put its specular (a
  // mirror-like metal lobe) straight across the pack's upper face, and on this foil even a
  // sixth of the old power clipped that band flat (measured: the spot alone was the whole
  // over-exposure; the rig without it never clipped). From up-left the glint becomes a
  // diagonal sweep that runs off the pack's edge and the face below keeps its colour —
  // the hero/bystander contrast now comes from FOCUS_COL_DIM (focusLight), which can't clip.
  const frontSpot = new THREE.SpotLight(0xffe6b0, 14, 14, 0.66, 0.65, 1.15); // (was 230 for the printed quad; real metal needs far less)
  frontSpot.position.set(-2.4, 3.0, CAM_D - 3.5);
  frontSpot.target.position.set(0, 0, RING_R + FRONT_PUSH);
  scene.add(frontSpot);
  scene.add(frontSpot.target);

  // the same code-built reflection room the tear stage uses (pack3d/lighting.js), so the
  // gold foil reflects the same panels on the wheel, in flight and on the tear stage
  const packEnv = buildEnvironment(renderer);
  scene.environment = packEnv.texture;

  // --- shader backdrop: an awards-night stage ----------------------------------
  // The canvas is transparent, so the carousel used to sit on the page's near-black
  // bg → "太黑太暗". This fills the frame FIRST with the stage: two warm spotlights
  // at the top corners sweeping slow beams across it, an overhead shaft onto the front
  // pack, a quiet gallery tier, an amber pool behind the front pack
  // and a polished black floor the packs (and that light) reflect in. It's ONE fullscreen quad drawn in clip space (camera-independent, no fog/
  // projection) with a loop-free fragment shader — the whole lit stage at almost no
  // GPU cost.
  const backdrop = makeBackground();
  scene.add(backdrop.mesh);

  // --- ambiance: light + gold dust (no objects — the packs are the only things) ---
  // twinkling gold dust drifting up through the whole stage. This is the ONLY floating
  // light: the bokeh orbs and the gallery's camera flashes were cut (the user read them
  // as lights blinking in front of the packs) — the dust alone carries the air.
  const particles = makeParticles(renderer);
  scene.add(particles.points);

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
    // The floor mirrors the pack's rim BEAM too, not just its art: a second ribbon on the
    // same outline, parented to the reflection quad so it inherits the mirrored transform
    // (the quad and the pack share one local frame). It shares the live rim's clock,
    // phase, speed and focus uniforms, so the reflected comet runs in lockstep with the
    // real one — it only differs in its own opacity and the floor fade (uRefl).
    const rim = mesh.userData.rim;
    if (rim) {
      const ru = rim.material.uniforms;
      const rmat = makeRimMaterial();
      Object.assign(rmat.uniforms, { uTime: ru.uTime, uPhase: ru.uPhase, uSpeed: ru.uSpeed, uFocus: ru.uFocus, uHalfH: ru.uHalfH });
      rmat.uniforms.uRefl.value = 1;
      rmat.uniforms.uOpacity.value = 0;
      const rr = new THREE.Mesh(rim.geometry, rmat);
      rr.frustumCulled = false;
      rr.renderOrder = 998; // after every pack + reflection quad; additive, so order is cosmetic
      r.add(rr);
      mesh.userData.reflRim = rr;
      rimMats.push(rmat); // (for dispose)
    }
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
    const gap = half * 0.16;                          // small air between pack base and its floor mirror
    r.position.set(mesh.position.x, 2 * bottom - mesh.position.y - gap, mesh.position.z);
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
    // the reflected beam follows the live rim's own opacity (pack fade × facing fade —
    // set just before this in layout/stepIntro), dimmed like the art's reflection
    const rr = mesh.userData.reflRim;
    if (rr) rr.material.uniforms.uOpacity.value = mesh.userData.rim.material.uniforms.uOpacity.value * REFL_RIM;
    // Phones: only the FRONT-most packs cast a reflection — the side/back ones are small,
    // dim and barely seen, so culling them slashes transparent overdraw (the carousel's
    // biggest mobile cost) while the prominent hero reflection stays.
    r.visible = op > 0.01 && (!COARSE || mesh.position.z > RING_R * 0.45);
  }

  // one MeshStandardMaterial per pack (per-mesh so opacity/flash can vary in the
  // selection animation). The finish comes from the shared maps: the atlas as colour
  // plus a little emissive self-light (so the print reads on the dim side packs), the
  // procedural normal map for the crinkles, and the packed roughness/metalness — gold
  // foil as real metal reflecting the room, black print as ink.
  function makePackMaterial(asset) {
    return new THREE.MeshStandardMaterial({
      map: asset.map,
      normalMap: asset.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: asset.ormMap,
      metalnessMap: asset.ormMap,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 1.2,
      emissive: 0xffffff,
      emissiveMap: asset.map,
      emissiveIntensity: 0.18,
      side: THREE.FrontSide, // a closed procedural pouch — front faces only
    });
  }

  // RIM LIGHT + BORDER BEAM, per pack. A glowing outline ribbon that HUGS the pouch's
  // own silhouette — the loft's profile from pack3d (body, shoulder flare, the squared
  // crimp ears), not the art's alpha, so whenever the model's outline changes the 流光
  // follows it — is attached to each pack mesh, so it rotates, pops and scales WITH the
  // pack on the wheel. A weak always-on warm rim rings the whole edge; a bright
  // comet sweeps around it. One ShaderMaterial per pack (so each can fade in the
  // intro/selection), all ticked from the same clock so the beams move in sync.
  const rimMats = [];
  const rimGeoCache = new Map();
  function addRimBeam(mesh, asset) {
    if (mesh.userData.rim) return; // already built (texture promise can resolve once)
    const outline = modelOutline(asset.showOutline);
    if (!outline) return;
    const aspect = asset.aspect;
    // an outline ribbon riding the silhouette, floated just PROUD of the front sheet
    // under it (each point carries the sheet's own height + RIM_LIFT, so it sits as
    // close over the flat ears as over the full body). depthTest is ON (see
    // makeRimMaterial), so the ribbon must clear its own pack body or that body would
    // bury it — but a pack physically IN FRONT on the wheel writes nearer depth and
    // correctly OCCLUDES this rim. The float is tiny (well under the body's mid bulge)
    // so head-on it still reads as the outline glow.
    // halfW 0.023 (was 0.046): the ribbon read as a thick border, not an edge light —
    // the user asked for half the width; RIM_GAIN below halves its brightness to match.
    if (!rimGeoCache.has(asset)) rimGeoCache.set(asset, makeRimGeometry(outline, 0.023, RIM_LIFT));
    const mat = makeRimMaterial();
    mat.uniforms.uHalfH.value = aspect / 2; // the pack's base (local y = −aspect/2) is the floor contact line
    // Randomise each pack's comet so they DON'T flow in sync: a random start position
    // around the loop, plus a small speed jitter so they keep drifting apart instead of
    // holding a fixed offset.
    mat.uniforms.uPhase.value = Math.random();
    mat.uniforms.uSpeed.value = 0.16 + Math.random() * 0.12; // ~0.16–0.28 loops/sec
    const rimMesh = new THREE.Mesh(rimGeoCache.get(asset), mat);
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
  const packMats = [];
  const assetReady = getPackAsset();
  packs.forEach((p) => {
    const placeholder = new THREE.MeshStandardMaterial({ color: 0x2a2016, roughness: 0.6, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.4), placeholder);
    // flip: eased inspect-rotation. aspect: pack height/width — the geometry's local
    // height equals it, so the handoff can size the pack to the tear-pack's screen rect.
    mesh.userData = { pack: p, flip: 0, flipTo: 0, aspect: 1.4 };
    group.add(mesh);
    meshes.push(mesh);
    const pr = assetReady.then((asset) => {
      mesh.userData.aspect = asset.aspect;
      mesh.geometry.dispose();              // drop the placeholder plane (the envelope is shared)
      mesh.geometry = asset.showGeometry;
      const mat = makePackMaterial(asset);
      mesh.material = mat;
      packMats.push(mat);
      if (asset.showOutline) addRimBeam(mesh, asset); // rim light + border beam, hugging the pouch's silhouette
      if (asset.frontTex) buildReflection(mesh, asset.frontTex, asset.aspect); // glossy-floor reflection of the front art
      if (mesh.userData.refl && asset.backTex) mesh.userData.refl.material.uniforms.uBackMap.value = reflTex(asset.backTex); // the floor reflects the back too
    }).catch(() => { /* asset failed → the intro timeout still fires it */ });
    assetsReady.push(pr);
  });
  // the surface maps finish in idle slices — recompile the pack materials once they land
  assetReady.then((asset) => asset.surfaceReady.then(() => { packMats.forEach((m) => { m.needsUpdate = true; }); })).catch(() => {});

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
      focusLight(m, front); // front pack glows brighter; the rest dim — the visual centre
      placeReflection(m);
    }
  }

  // a gentle vertical bob, strongest on the front pack, for a touch of life
  let t = 0;
  function bobY(front) { return REDUCED ? 0 : front * Math.sin(t * 1.0) * 0.05; }

  // Brighten the centred pack and dim its neighbours by driving each pack's OWN material:
  // emissive self-light + foil env sheen scale with `front` (1 at the centre → 0 at the
  // sides), so the focused pack is the clear visual anchor whichever way it faces. (The
  // intro/selection paths drive emissive themselves via setFaceFlash, so this only runs
  // from the idle layout().)
  function focusLight(mesh, front) {
    const f = Math.pow(front, 1.5); // a soft falloff — neighbours dim gradually, not abruptly
    const tight = Math.pow(front, FOCUS_COL_POW);
    const emi = FOCUS_EMI_DIM + (FOCUS_EMI_HOT - FOCUS_EMI_DIM) * tight;
    const env = FOCUS_ENV_DIM + (FOCUS_ENV_HOT - FOCUS_ENV_DIM) * f;
    const col = FOCUS_COL_DIM + (1 - FOCUS_COL_DIM) * tight;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mm of mats) {
      if (mm.emissiveMap) mm.emissiveIntensity = emi;
      mm.envMapIntensity = env;
      mm.color.setScalar(col); // exposure: the bystanders sit ~a stop under the hero
    }
    // The rim beam (流光) follows the same focus, on the sharper pop curve: the centred
    // pack's beam burns bright, wide and long-tailed; its neighbours' shrink to a thin,
    // dim, short trace. `front` is continuous in the wheel angle, so a pack's beam swells
    // and recedes smoothly as it turns through the front (the reflection shares uFocus).
    const rim = mesh.userData.rim;
    if (rim) rim.material.uniforms.uFocus.value = Math.pow(front, 5);
  }

  function applyOpacity(mesh, op) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mm) => { mm.transparent = op < 1; mm.opacity = op; });
    const rim = mesh.userData.rim; // the rim/beam fades right along with its pack
    if (rim) rim.material.uniforms.uOpacity.value = op;
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
    backdrop.update(t);                                   // the stadium lives: beam sweep + shimmer
    for (const m of rimMats) m.uniforms.uTime.value = t; // one clock; each beam's own phase/speed offsets it
    // While dissolving we hold the hero frozen on its landed frame — running layout()
    // here would snap every pack (incl. the hero) back to the idle ring, so skip it.
    if (!selecting && !introing && !dissolving) layout();

    // Each pack crossing the front fires a tick. The HEAVY work (host onChange =
    // name plate + chosenPack state, which carries a longer hover() tone) only runs
    // below TICK_VEL — above it that piled into an audio machine-gun that trailed the
    // spin. But a fast fling SHOULD still ratchet: above TICK_VEL we fire a dedicated
    // short spinTick() instead — cheap + self-throttled, so it buzzes 哒哒哒 in step
    // with the whirl without stacking up. The final landing (vel → 0) always onChanges.
    const idx = modIndex();
    if (idx !== lastIdx && !selecting && !introing && !dissolving) {
      const spinning = Math.abs(vel) > TICK_VEL;
      lastIdx = idx;
      if (spinning) sfx.spinTick?.(Math.abs(vel));
      else onChange?.(packs[idx], idx);
    }
    renderer.render(scene, camera);
  }
  function play() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function pause() {
    if (window.__select3d) console.warn("[select3d] pause()", new Error().stack.split(String.fromCharCode(10)).slice(2, 5).join(" <- "));
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

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
    // ease the hero's sheen from the dock's focus lift to the tear stage's level: face-on
    // at the lens it mirrors the room's soft wall in full, and the stage pack it dissolves
    // into carries the same room at EXT_ENV — matched here so there's no brightness step
    for (const mm of (Array.isArray(heroMesh.material) ? heroMesh.material : [heroMesh.material])) mm.envMapIntensity = lerp(FOCUS_ENV_HOT, HANDOFF_ENV, e);
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
          if (mm?.normalMap) texes.add(mm.normalMap);
          if (mm?.roughnessMap) texes.add(mm.roughnessMap);
        }));
        texes.forEach((tx) => { try { renderer.initTexture(tx); } catch { /* ignore */ } });
        renderer.render(scene, camera); // packs are at opacity 0 → invisible, but textures upload
      } catch { /* warm-up is best-effort */ }
      play();
      // The packs are NOW launching — let the host sync to the real motion start (the
      // start-gate holds its god-light through the asset wait, then fades into this
      // exact frame so the open dissolves straight into the fly-in, no gap, no cut).
      onIntroStart?.();
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
        if (p >= 1) { s.docked = true; } // seats on the ring (slotAngle already fixed at launch)
      } else {                                        // a ring member, carried by the wheel
        m.position.set(rX, rY, rZ);
        m.rotation.y = a * TURN;
        m.scale.setScalar(rScale);
        applyOpacity(m, 1);
        fadeRimByFacing(m); // back-facing ring members keep their rim hidden too
        m.renderOrder = Math.round(m.position.z * 10);
      }
      focusLight(m, front); // light each pack for its ring slot DURING the fly-in, so the
                            // front pack is already lit on arrival — no lighting pop when
                            // layout() takes over after landing (slot is at the back while
                            // in flight → packs fly in dim and brighten as carried to front)
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
  // (?packdebug exposes the wheel's internals for the headless/browser-pane tests)
  if (new URLSearchParams(location.search).has("packdebug")) {
    window.__select3d = { meshes, scene, renderer, camera, assetReady, play, pause, get raf() { return raf; }, get introing() { return introing; }, get introDone() { return introDone; }, get selecting() { return selecting; }, get dissolving() { return dissolving; } };
  }
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
      rimGeoCache.forEach((g) => g.dispose());  // the rim/beam ribbons
      rimMats.forEach((m) => m.dispose());
      packMats.forEach((m) => m.dispose());     // (the envelope + maps belong to the shared asset)
      reflGeoCache.forEach((g) => g.dispose()); // the reflection quads
      meshes.forEach((m) => m.userData.refl?.material.dispose());
      reflTexes.forEach((t) => t.dispose());    // the downscaled mobile reflection textures
      backdrop.mesh.geometry.dispose(); backdrop.mesh.material.dispose();
      particles.points.geometry.dispose();
      packEnv.dispose();
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

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
// The ambient dust field is laid out for a landscape view; a portrait phone
// sees a far narrower slice of the stage, so squeeze their width to it (1 = as laid out).
function viewSpread(aspect) { return Math.max(0.32, Math.min(1, (aspect || 1) / 1.4)); }

// ---- rim light + border beam ----------------------------------------------
// The pack's OUTER silhouette for the rim ribbon, from the pouch MODEL: asset.showOutline
// is the loft's face-on profile (pack3d/geometry.js packOutline), a closed loop of
// [x, y, zSheet] in the mesh's local coords (x ∈ [-0.5, 0.5], y ∈ [-aspect/2, aspect/2]),
// right edge top→bottom then left edge bottom→top. Dense samples along the straight
// runs are simplified away, keeping the shoulder's flare curve, then each square corner
// (the four crimp ears) gets a SMALL fillet. The old code traced the printed art's alpha
// instead, which stopped matching the mesh once the crimp was made to flare past the
// body — the light ran the art's pinched outline while the foil stood proud of it.
const _outlineCache = new WeakMap();
function modelOutline(loop) {
  if (!loop || loop.length < 4) return null;
  if (_outlineCache.has(loop)) return _outlineCache.get(loop);
  // Simplify the sample staircase into clean straight edges, then put a SMALL fillet on
  // each corner. (Chaikin trims 25% off each adjacent edge — after RDP those edges are
  // the pack's full height/width, so it would round every corner inward by ~a quarter of
  // the pack and the flowing rim would never reach the four corners. roundCorners instead
  // replaces just the corner POINT with a short arc of a fixed small radius: the rim still
  // runs right into each corner but turns it on a gentle curve instead of a hard spike.)
  // eps 0.0015 (≈0.1 mm on a 74 mm pack): tight enough to keep the shoulder's S-curve
  // as a curve rather than one chord, loose enough to drop every sample on a straight.
  let pts = rdp(loop, 0.0015);
  pts = roundCorners(pts, 0.045, 5); // radius = 4.5% of the pack's width — a tiny round-off
  _outlineCache.set(loop, pts);
  return pts;
}

// Forward float of the rim ribbon above the front sheet beneath it, in local z (the
// pack is 1 unit wide). With depthTest ON, the ribbon must sit just PROUD of the sheet
// (which the outline carries per point: +0.040 at the body's fold, +0.045 with the
// crown, near 0 over the flat sealed bands) or that sheet would occlude it head-on —
// but as shallow as possible so the 流光 hugs the true edge instead of hovering in
// front of it. 0.0115 puts the body's ribbon at the 0.052 it always sat at, and lets
// the ears' ribbon drop right down onto the crimp instead of floating a body's depth
// ahead of it when the pack turns.
const RIM_LIFT = 0.0115;

// Build a flat ribbon (triangle strip) that follows the closed outline, `halfW` wide
// to each side of the edge, each vertex `lift` in front of its point's own sheet depth
// (the outline's third component) — so the ribbon follows the foil in depth as well as
// in silhouette. Each vertex carries aArc (0..1 along the loop, MONOTONIC — closed with
// a duplicate start vertex at arc=1 so the beam doesn't glitch at the seam) and aSide
// (-1..1 across the ribbon, for the soft cross-section glow in the shader).
function makeRimGeometry(outline, halfW, lift) {
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
    const z = (cur[2] || 0) + lift;
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

// How bright the floor's mirror of a rim beam is, relative to the live beam (the art's
// own reflection sits at 0.40 — the light reads a touch stronger on the polished floor).
const REFL_RIM = 0.5;

// The beam shader: a weak warm rim everywhere + a bright comet (tight head, trailing
// tail) racing around the loop. Additive, so it reads as LIGHT against the dark scene.
// uFocus (0 side → 1 centred, from focusLight) scales it per pack: the front pack's beam
// is brighter, wider and longer-tailed; the others' a thin, dim, short trace. The same
// shader draws the floor reflection (uRefl = 1), which fades out with distance from the
// pack's base exactly like the reflected art.
const RIM_VERT = `
  attribute float aArc; attribute float aSide;
  uniform float uRefl;   // 1 on the floor-reflection copy
  uniform float uHalfH;  // half the pack's local height — local y = −uHalfH is its base
  varying float vU; varying float vV; varying float vFade;
  void main() {
    vU = aArc; vV = aSide;
    float h = clamp((position.y + uHalfH) / (2.0 * uHalfH), 0.0, 1.0); // 0 at the base → 1 at the top
    vFade = mix(1.0, pow(1.0 - h, 1.4), uRefl); // the mirror: bright at the contact line, gone below
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
// Overall strength of the 流光 (rim + comet together). 0.5 = half the original: at full
// strength the ribbon blew out to a flat white-gold band and swamped the pack's edge.
const RIM_GAIN = 0.5;
const RIM_FRAG = `
  precision mediump float;
  varying float vU; varying float vV; varying float vFade;
  uniform float uTime; uniform float uOpacity;
  uniform float uPhase; uniform float uSpeed;
  uniform float uFocus;
  uniform vec3 uWarm; uniform vec3 uHot;
  void main() {
    float width = mix(0.42, 1.0, uFocus);              // side packs: a thin line; front: the full ribbon
    float rimG  = mix(0.6, 1.1, uFocus);               // the always-on rim lifts only a little…
    float gain  = mix(0.5, 2.1, uFocus);               // …the flowing comet is where the front burns
    float tailL = mix(0.09, 0.24, uFocus);             // and its comet trails further
    float headW = mix(0.0009, 0.0022, uFocus);         // with a broader head
    float edge = max(0.0, 1.0 - abs(vV) / width);
    float body = pow(edge, 1.1);                       // broad soft glow across the ribbon
    float hot  = pow(edge, 4.0);                       // a hotter thin core inside it
    // per-pack phase + speed (set in addRimBeam) so each comet sits at a DIFFERENT spot
    // on its loop and drifts independently — the packs no longer flow in lockstep.
    float head = fract(uTime * uSpeed + uPhase);       // the comet's position around the loop
    float ahead = fract(vU - head);
    float behind = fract(head - vU);
    float ring = min(ahead, behind);                   // circular distance to the head
    float comet = exp(-ring * ring / headW);           // bright head
    float tail  = exp(-behind / tailL) * 0.7;          // exponential tail trailing the head
    float beam = max(comet, tail);
    // weak always-on rim (0.22) + the sweeping comet; hot core sharpens it
    float i = (body * (0.22 * rimG + 1.7 * beam * gain) + hot * beam * 0.7 * gain) * uOpacity * vFade * ${RIM_GAIN.toFixed(2)};
    vec3 col = mix(uWarm, uHot, clamp(beam, 0.0, 1.0)); // gold rim → white-hot comet
    gl_FragColor = vec4(col * i * 1.12, i);            // mild overdrive → a soft bloom, not a blowout
  }`;
function makeRimMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uPhase: { value: 0 },   // per-pack offset around the loop (set in addRimBeam)
      uSpeed: { value: 0.22 }, // per-pack sweep speed (jittered in addRimBeam)
      uFocus: { value: 0 },   // 0 side → 1 centred (set per frame in focusLight)
      uRefl: { value: 0 },    // 1 on the floor-reflection copy (buildReflection)
      uHalfH: { value: 0.7 }, // half the pack's local height (set in addRimBeam)
      uWarm: { value: new THREE.Color(0xffc24a) },
      uHot: { value: new THREE.Color(0xfffdf2) },
    },
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,       // glow never occludes — but IS occluded (depthTest below)
    depthTest: true,         // a pack in front on the wheel must hide this rim; the
                             // RIM_LIFT float keeps its OWN body from burying it
    side: THREE.DoubleSide,
  });
}

// Fillet the corners of a closed polygon: each vertex is replaced by a short arc of
// `radius` (approximated by a quadratic Bézier through the original corner), so the
// flowing rim turns each corner on a gentle curve instead of a hard point. The radius
// is trimmed to <½ of each adjacent edge so neighbouring fillets never overlap, and
// near-straight vertices are passed through untouched. Points are [x, y] or [x, y, z]
// (a third component — the sheet depth under the rim — is carried along the fillet).
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
    if (v1x * v2x + v1y * v2y < -0.985) { out.push(cur.slice()); continue; } // ~straight → keep
    const d = Math.min(radius, l1 * 0.5, l2 * 0.5);
    const t1x = cur[0] + v1x * d, t1y = cur[1] + v1y * d; // tangent point on the incoming edge
    const t2x = cur[0] + v2x * d, t2y = cur[1] + v2y * d; // tangent point on the outgoing edge
    const z0 = prev[2] || 0, z1 = cur[2] || 0, z2 = next[2] || 0;
    const t1z = z1 + (z0 - z1) * (d / l1), t2z = z1 + (z2 - z1) * (d / l2);
    for (let s = 0; s <= segs; s++) {                     // quad Bézier t1→corner→t2
      const u = s / segs, iu = 1 - u, w0 = iu * iu, w1 = 2 * iu * u, w2 = u * u;
      out.push([w0 * t1x + w1 * cur[0] + w2 * t2x, w0 * t1y + w1 * cur[1] + w2 * t2y, w0 * t1z + w1 * z1 + w2 * t2z]);
    }
  }
  return out;
}

// Ramer–Douglas–Peucker simplification (epsilon in the points' own units; extra
// components ride along with the kept points).
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
  for (const m of mats) if (m.emissiveMap) m.emissiveIntensity = FOCUS_EMI_HOT + v; // the hero's idle floor + the flash
}

// ---- shader backdrop -------------------------------------------------------
// A fullscreen quad painted in CLIP SPACE (the vertex shader writes gl_Position
// directly from a 2×2 plane's xy, so it ignores the camera, fog and projection and
// always fills the frame). The fragment shader is loop-free — a vertical palette,
// two warm spotlights with slowly sweeping beams, an overhead shaft onto the hero, the
// gallery (a quiet darker band — no camera flashes), an amber pool behind the front
// pack, a polished black floor with a gold horizon and the hero's light streaked across
// it, and a soft vignette — so the whole lit stage costs one cheap fullscreen pass. The
// quad is drawn first (renderOrder −1000, depthTest off, no depthWrite) so every
// pack and reflection lands on top of it.
const BG_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }`;
const BG_FRAG = `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;  // viewport w/h → keeps the radial glows round
  uniform float uSweep;   // 1 → the corner spotlights sweep; 0 (reduced motion) → held still
  void main() {
    vec2 uv = vUv;
    vec2 p = vec2(uv.x * uAspect, uv.y);
    // Vertical palette — a warm black stage floor → dark brown charcoal → a faint
    // amber haze at the top. Dark and desaturated, so the gold packs stay the only
    // bright thing in frame.
    vec3 base = vec3(0.040, 0.030, 0.020);
    vec3 mid  = vec3(0.095, 0.072, 0.048);
    vec3 top  = vec3(0.150, 0.110, 0.070);
    vec3 col = mix(base, mid, smoothstep(0.0, 0.5, uv.y));
    col = mix(col, top, smoothstep(0.45, 1.0, uv.y));

    // the gallery — a darker tier across the upper middle. It used to twinkle with
    // camera flashes; those are gone (no blinking lights — the gold dust is the only
    // thing that floats), so the band is just a quiet step in the palette now.
    float stands = smoothstep(0.55, 0.63, uv.y) * (1.0 - smoothstep(0.80, 0.88, uv.y));
    col *= 1.0 - stands * 0.22;

    // two warm spotlights at the top corners whose soft beams SWEEP slowly across the
    // stage, out of phase, so now and then they cross behind the wheel — the awards-night
    // light sweep. (uSweep = 0 under reduced motion holds them still, aimed at centre.)
    vec2 L1 = vec2(0.08 * uAspect, 1.02), L2 = vec2(0.92 * uAspect, 1.02);
    vec3 lamp = vec3(1.0, 0.86, 0.58);
    col += lamp * (exp(-length(p - L1) * 6.5) + exp(-length(p - L2) * 6.5)) * 0.55;
    vec2 aim1 = vec2((0.5 + 0.30 * sin(uTime * 0.11) * uSweep) * uAspect, 0.30);
    vec2 aim2 = vec2((0.5 - 0.30 * sin(uTime * 0.11 + 1.7) * uSweep) * uAspect, 0.30);
    float b1 = smoothstep(0.962, 1.0, dot(normalize(p - L1), normalize(aim1 - L1)));
    float b2 = smoothstep(0.962, 1.0, dot(normalize(p - L2), normalize(aim2 - L2)));
    float shimmer = 0.88 + 0.12 * sin(uTime * 0.6 + uv.y * 6.0);
    col += lamp * (b1 + b2) * smoothstep(0.1, 0.95, uv.y) * 0.085 * shimmer;

    // an overhead key SHAFT falling straight down onto the front pack: a narrow cone
    // from above the frame, strongest up high and dissolving before it reaches the floor
    vec2 S = vec2(0.5 * uAspect, 1.15);
    float shaft = smoothstep(0.972, 0.998, dot(normalize(p - S), vec2(0.0, -1.0)));
    col += vec3(1.0, 0.88, 0.62) * shaft * smoothstep(0.30, 0.92, uv.y) * 0.075 * (0.92 + 0.08 * sin(uTime * 0.5));

    // the amber pool behind the focused pack — the glow behind the main object
    vec2 d = (uv - vec2(0.5, 0.58)) * vec2(uAspect, 1.0);
    col += vec3(1.0, 0.70, 0.32) * smoothstep(0.62, 0.0, length(d)) * 0.26;

    // the floor is a polished black stage: a faint warm sheen rising toward the
    // horizon, a thin gold edge where the floor meets the backdrop, and the shaft +
    // pool mirrored in it as a soft vertical streak of light under the hero
    float floorM = 1.0 - smoothstep(0.28, 0.44, uv.y);
    float horizon = exp(-abs(uv.y - 0.43) * 38.0);
    col += vec3(0.060, 0.042, 0.022) * floorM * smoothstep(0.0, 0.44, uv.y);
    col += vec3(0.95, 0.72, 0.36) * horizon * 0.10;
    float fx = (uv.x - 0.5) * uAspect;
    col += vec3(1.0, 0.78, 0.42) * exp(-fx * fx / 0.006) * floorM * smoothstep(0.02, 0.42, uv.y) * 0.07;

    // gentle vignette — settle the corners without crushing them to near-black
    col *= 1.0 - smoothstep(0.52, 1.18, length(uv - vec2(0.5))) * 0.30;
    gl_FragColor = vec4(col, 1.0);
  }`;
function makeBackground() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uSweep: { value: REDUCED ? 0 : 1 },
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
    vec3 tint = tx.rgb * vec3(1.0, 0.90, 0.74);   // warm, polished-black-floor cast
    gl_FragColor = vec4(tint, tx.a * fade * 0.40 * uOpacity);
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

// A field of slow-drifting, TWINKLING gold dust through the whole stage. All the motion
// runs in the vertex shader from one clock — rise + wrap, a lazy sideways sway, and a
// per-mote twinkle that's mostly soft with the odd bright glint — so nothing is
// re-uploaded per frame (the old CPU loop rewrote the whole position buffer every frame).
// Each mote is a round soft point with a hot centre, sized by depth like real dust.
const DUST_VERT = `
  attribute float aSpeed; attribute float aSeed; attribute float aSize;
  uniform float uTime;
  uniform float uScale;   // drawing-buffer height / 2 → world size → pixels at depth
  uniform float uSpread;  // squeezes the field's width to the view (portrait sees far less)
  varying float vA;
  void main() {
    vec3 p = position;
    p.x *= uSpread;
    p.y = mod(p.y + 8.0 + aSpeed * uTime * 0.4, 16.0) - 8.0;               // rise + wrap
    p.x += sin(uTime * (0.22 + 0.25 * aSeed) + aSeed * 6.2832) * 0.2;      // lazy sway
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z;
    float tw = 0.5 + 0.5 * sin(uTime * (0.7 + 1.8 * aSeed) + aSeed * 40.0);
    vA = (0.45 + 1.1 * pow(tw, 5.0))                                        // soft, with glints
       * smoothstep(-8.0, -6.5, p.y) * (1.0 - smoothstep(6.5, 8.0, p.y))     // fade at the wrap
       * mix(1.0, 0.45, smoothstep(14.0, 26.0, -mv.z));                      // far dust recedes
  }`;
const DUST_FRAG = `
  precision mediump float;
  uniform vec3 uColor; uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 2.0);                                  // soft round mote
    vec3 col = mix(uColor, vec3(1.0, 0.97, 0.88), pow(1.0 - d, 4.0)); // white-hot centre
    gl_FragColor = vec4(col, a * vA * uOpacity);
  }`;
function makeParticles(renderer) {
  // GPU-animated, so the count only costs fill-rate — still thinner on a phone
  const COUNT = COARSE ? 140 : 320;
  const pos = new Float32Array(COUNT * 3);
  const spd = new Float32Array(COUNT), seed = new Float32Array(COUNT), size = new Float32Array(COUNT);
  const r = (i, k) => { const v = Math.sin(i * k) * 43758.5453; return v - Math.floor(v); };
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3 + 0] = r(i, 12.9898) * 22 - 11;
    pos[i * 3 + 1] = r(i, 78.233) * 16 - 8;
    pos[i * 3 + 2] = r(i, 37.719) * 16 - 12;
    spd[i] = 0.2 + r(i, 4.1) * 0.5;
    seed[i] = r(i, 91.37);
    size[i] = 0.06 + Math.pow(r(i, 53.11), 3) * 0.22; // mostly fine dust, a few big soft motes
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSpeed", new THREE.BufferAttribute(spd, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 400 },
      uSpread: { value: 1 },
      uColor: { value: new THREE.Color(0xffd37a) },
      uOpacity: { value: 0.6 },
    },
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  mat.opacity = 0.6; // the host fades the field via material.opacity (see stepSelect/show)
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // the shader moves every mote; the CPU bounds don't know
  points.renderOrder = -1;
  const _buf = new THREE.Vector2();
  let t = 0;
  return {
    points,
    update(dt) {
      t += dt;
      mat.uniforms.uTime.value = REDUCED ? 0 : t;
      mat.uniforms.uOpacity.value = mat.opacity;
      renderer.getDrawingBufferSize(_buf);
      mat.uniforms.uScale.value = _buf.y * 0.5;
      mat.uniforms.uSpread.value = viewSpread(_buf.x / (_buf.y || 1));
    },
  };
}

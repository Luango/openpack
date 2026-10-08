// pack3d/view.js — PackView: lifecycle, interaction, feedback, render scheduling.
//
// The procedural foil pack (three.js) that replaces the flat SVG tear-pack in the
// open flow. Same host contract as pack.js — createPack3D({ mountEl, onOpen,
// onGrab }) → { reset, setArmed, setTell, setCards, getHandoffRect, getHandoffPose, present } —
// so the carousel hands off to it and the DOM card reveal takes over after it.
//
// Two rip methods, one state machine (controller.js):
//   FRONT — pinch the notch at the upper-left corner and drag across the top:
//           the sealed header strip tears off around the pack and lifts away.
//   BACK  — flip the pack (tap, or drag to turn it), pinch the rear fin seam
//           and PULL: nothing tears — the pack strains harder the further you
//           haul (it bulges, creases, trembles, the seam gapes), until the seal
//           gives all at once and the whole back pops open; the cards BLOW OUT
//           of it with the force — five of them, each tumbling on its own — and
//           settle face DOWN in a spread, their backs to you, until one is tapped.
//
// The light (see "the light inside" below): trapped in the pack, let out through
// the tear, at its brightest for the one instant the seal breaks, then settling
// into soft beams the card rises through.
//
// Rendering is on demand: the loop runs only while something moves (a drag, the
// strip settling, a pose spring, the open beats) and stops once settled.

import * as THREE from "three";
import { makeConfig, pickQuality } from "./config.js";
import { buildCardStack, buildBurstCard } from "./geometry.js";
import { makeEdgeTexture, makeCoreTexture } from "./textures.js";
import { getPackAsset } from "./asset.js";
import { makeMaterials, makeCardMaterials, setFoil, EXT_ENV, EXT_EMI, INT_GOLD } from "./materials.js";
import { buildEnvironment, addLights, fitDistance } from "./lighting.js";
import { createDeformer } from "./deformer.js";
import { createController, P_NOTCH, PULL_LIMIT } from "./controller.js";
import { createSeamGlow } from "./glow.js";
import { createParticles } from "../particles.js";
import { getOpenLight } from "../openlight.js";
import { TIER_HEX } from "../rarity.js";
import * as sfx from "../sfx.js";

const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const REST_YAW = 0.34; // ~19.5°: a slight three-quarter view, the notch corner toward the lens
const REST_PITCH = -0.07; // the top edge tilts a touch toward the lens
const STRAIN_PITCH = -0.045; // gripped: the pack bends a little more toward the hand
// foil flecks: the pouch's own black foil + its gold (champagne → gold → bronze), with a white-hot glint
const FOIL = ["#fff3c4", "#d4a63a", "#b8862b", "#ffffff", "#2a2016", "#80521c"];
const TORE_KEY = "openpack.toreOnce";
let toredSession = false;
const hasToredBefore = () => { if (toredSession) return true; try { return localStorage.getItem(TORE_KEY) === "1"; } catch { return false; } };
const markTored = () => { toredSession = true; try { localStorage.setItem(TORE_KEY, "1"); } catch { /* private mode */ } };

// the light inside the pack, at full: point-light candela at this (metre) scale —
// bright at the torn mouth, 1/d² dark by the lower half (materials.js lifts the
// 10 cm floor three puts under the falloff)
const INNER_MAX = 0.00056;

export function createPack3D({ mountEl, onOpen, onGrab, config = {}, debug = false }) {
  let cfg = makeConfig({ quality: pickQuality(), ...config }); // replaced by the shared asset's once loaded
  const T = cfg.tier;
  mountEl.innerHTML = `
    <div class="pack3d-wrap">
      <div class="pack-glow" aria-hidden="true"></div>
      <!-- .pack3d-body is what idle-floats (host CSS): the pack + its grip marker only.
           The buttons and cue below are siblings so they stay put while the pack bobs.
           .pack3d-glide inside it carries the float's counter-transform (see startFloat /
           stopFloat): the bob's amplitude eases IN from the landed still and back OUT to
           the exact rest pose, instead of the animation snapping on and off. -->
      <div class="pack3d-body">
        <div class="pack3d-glide">
          <canvas class="pack3d-canvas" aria-label="Sealed pack — grab the corner and tear it open"></canvas>
          <span class="pack3d-notch" aria-hidden="true"></span>
        </div>
      </div>
      <div class="pack3d-ui">
        <button type="button" class="pack3d-btn pack3d-flip" aria-label="Flip the pack over">Flip</button>
        <button type="button" class="pack3d-btn pack3d-open">Open pack</button>
      </div>
      <p class="pack3d-cue" aria-live="polite"></p>
    </div>
    <canvas class="pack-fx"></canvas>`;
  const wrap = mountEl.querySelector(".pack3d-wrap");
  const bodyEl = mountEl.querySelector(".pack3d-body");
  const glideEl = mountEl.querySelector(".pack3d-glide");
  const canvas = mountEl.querySelector(".pack3d-canvas");
  const glowEl = mountEl.querySelector(".pack-glow");
  const cueEl = mountEl.querySelector(".pack3d-cue");
  const notchEl = mountEl.querySelector(".pack3d-notch");
  notchEl.style.position = "absolute"; // placed from the projected grip point; the look is the host's CSS
  notchEl.style.pointerEvents = "none";
  const flipBtn = mountEl.querySelector(".pack3d-flip");
  const openBtn = mountEl.querySelector(".pack3d-open");
  const particles = createParticles(mountEl.querySelector(".pack-fx"));
  const sceneFx = document.querySelector(".scene-fx");
  const room = getOpenLight(); // the light outside the pack: dim, floor, beams, dust, flash

  // ---- renderer (throws without WebGL → the host falls back to the SVG pack) ----
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: T.antialias, powerPreference: "high-performance", premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, T.dprCap));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 4);
  const packGroup = new THREE.Group();
  scene.add(packGroup);
  const env = buildEnvironment(renderer);
  scene.environment = env.texture;
  const lights = addLights(scene);
  const KEY_I = lights.key.intensity, FILL_I = lights.fill.intensity, HEMI_I = lights.hemi.intensity;

  // ---- state ------------------------------------------------------------------
  let pack = null, deformer = null, ctl = null, mats = null, cardMats = null, wrapper = null;
  let stack = null, topCard = null, deckMesh = null;
  // the back pop's burst: the stack blown apart into single cards (built with the stack,
  // kept off the scene until the pop) — see startBurst / stepBurst
  const BURST_N = 5;
  let burstGeo = null, burstMats = null, burstCards = [];
  let burst = null; // { t, cards: [{ mesh, p0, q0, pT, qT, s, axis, delay, dur, done }], settled, fade }
  let core = null, innerLight = null, seam = null; // the light inside (see below)
  let surface = null, atlasTex = null, faceTex = null;
  let armed = false, opened = false, built = false, disposed = false;
  let tellTier = 0;
  let packPx = { w: 0, h: 0 };
  // The pack IDLES in its rest pose (the slight three-quarter turn) — including at the
  // carousel hand-off: the flown hero lands in this same pose (getHandoffPose), so the
  // cross-dissolve joins two identical stills and nothing has to turn afterwards.
  const pose = { yaw: REST_YAW, pitch: REST_PITCH, yawT: REST_YAW, pitchT: REST_PITCH, yawV: 0, pitchV: 0 };
  let frozen = false; // pose locked during a tear
  let fly = null; // the detached cap's flight (front)
  let handoffTimer = 0;
  const beatTimers = []; // the open's scheduled beats (beams, shimmer, floor)
  const openSpring = { v: 0, t: 0, k: 60, c: 10 }; // the mouth
  const flapSpring = { v: 0, t: 0, k: 190, c: 16 }; // the back blown open: fast, a little past flat and back — the pop
  // the laid-out wrapper is twice the pack's width; where that would run off a narrow
  // viewport the pack draws back from the lens as it opens, so the whole sheet stays in frame
  let recedeZ = 0;
  // the back pull's rigid feel: the pack is hauled a little toward the hand (held back
  // elastically, so it boings on release and recoils on the pop), leans with the pull,
  // and trembles harder the closer the seal is to giving
  const follow = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tx: 0, ty: 0, tz: 0 };
  const lean = { pitch: 0, roll: 0, vp: 0, vr: 0, tp: 0, tr: 0 };
  const shake = { x: 0, y: 0, z: 0, rx: 0, rz: 0, until: 0 };
  let strainTick = 0; // the last pull level that ticked the haptics
  const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // ---- the light inside -----------------------------------------------------------
  // Levels ease toward targets set by the beats of the open:
  //   seam  — the leak at the tip only (gripped: a pin of light at the notch that
  //           swells as the foil strains; tearing: it rides the tip). The route
  //           ahead is never lit — the player is not shown where the tear will run
  //   inner — the light in the pack: a point light at the tip, a near-white core
  //           sprite just inside the foil (only the gap shows it), the slab of light
  //           at the lip (glow.js), the inner foil's warm glow, hot torn edges
  //   room  — how dark the surroundings have gone (the pack's own reflections and
  //           key light dim with it, so its lower half sinks into shadow)
  //   impulse — the one spike at the instant the seal breaks (the flash)
  // `spent`: the wrapper after the back pop — a blown-open sheet behind the cards, no
  // longer the thing to look at — sinks into the dark (stepLight), so the cards carry
  const light = { seam: 0, seamT: 0, inner: 0, innerT: 0, room: 0, roomT: 0, impulse: 0, strain: 0, phase: "idle", t: 0, hold: 0, flicker: 1, spent: 0, spentT: 0 };
  const tipTint = new THREE.Color(0xffd98a);

  // the DOM card's CSS width — the 3D card inside the pack projects to exactly this
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:var(--card-detail-w, 300px);height:1px;";
  mountEl.appendChild(probe);
  const cardPx = () => probe.getBoundingClientRect().width || 300;

  function fit() {
    const vw = mountEl.clientWidth || window.innerWidth, vh = mountEl.clientHeight || window.innerHeight;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    const w = cardPx() * (cfg.widthM / cfg.cardWM);
    packPx = { w, h: w * (cfg.heightM / cfg.widthM) };
    const d = fitDistance(camera, cfg.heightM, packPx.h, vh);
    // the opened wrapper's width on screen (twice the pack, plus the crimps' flare) vs the frame
    const splay = 2 * packPx.w * (1 + 2 * cfg.sealFlareM / cfg.widthM), room = 0.9 * vw;
    recedeZ = splay > room ? d * (splay / room - 1) : 0; // a sheet at d + Δ draws at d / (d + Δ) of its size
    camera.position.set(0, 0, d);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    // the tell halo hugs the pack's rect
    glowEl.style.width = `${Math.round(packPx.w * 1.34)}px`;
    glowEl.style.height = `${Math.round(packPx.h * 1.22)}px`;
    particles.resize();
    requestRender();
  }
  function getHandoffRect() {
    const vw = mountEl.clientWidth || window.innerWidth, vh = mountEl.clientHeight || window.innerHeight;
    const r = mountEl.getBoundingClientRect();
    return new DOMRect(r.left + (vw - packPx.w) / 2, r.top + (vh - packPx.h) / 2, packPx.w, packPx.h);
  }

  // ---- build --------------------------------------------------------------------
  const ready = (async () => {
    // the shared pack asset: the carousel shows the same envelope, print and finish
    const asset = await getPackAsset(config);
    if (disposed) return;
    cfg = asset.cfg;
    const cardBack = asset.cardBack;
    pack = asset.buildTear();
    atlasTex = asset.map;
    surface = { normalMap: asset.normalMap, normalMapIn: asset.normalMapIn, ormMap: asset.ormMap, whenReady: asset.surfaceReady };
    mats = makeMaterials({ map: atlasTex, normalMap: surface.normalMap, normalMapIn: surface.normalMapIn, ormMap: surface.ormMap });
    surface.whenReady.then(() => { if (!disposed) { for (const m of mats.all) m.needsUpdate = true; requestRender(); } });
    wrapper = new THREE.Mesh(pack.geometry, [mats.bodyExt, mats.bodyInt, mats.headerExt, mats.headerInt]);
    wrapper.frustumCulled = false;
    packGroup.add(wrapper);

    deformer = createDeformer(pack, cfg, { reduced: REDUCED });
    {
      const m = new THREE.Mesh(deformer.ribbonGeo, mats.ribbon);
      m.frustumCulled = false;
      m.renderOrder = 2;
      packGroup.add(m);
    }
    ctl = createController({ dims: pack.dims, reduced: REDUCED, emit: onEvent });

    // the card stack inside
    const cb = cardBack ? new THREE.Texture(cardBack) : null;
    if (cb) { cb.colorSpace = THREE.SRGBColorSpace; cb.needsUpdate = true; }
    // …and its relief (the raised brand, the foil's ripples): linear data, not colour
    const cbn = asset.cardBackNormal ? new THREE.Texture(asset.cardBackNormal) : null;
    if (cbn) { cbn.colorSpace = THREE.NoColorSpace; cbn.anisotropy = 4; cbn.needsUpdate = true; }
    cardMats = makeCardMaterials({ cardBack: cb, cardBackNormal: cbn, edge: makeEdgeTexture() });
    const cs = buildCardStack(cfg);
    stack = new THREE.Group();
    deckMesh = new THREE.Mesh(cs.deck, [cardMats.deckTop, cardMats.back, cardMats.rim]);
    deckMesh.position.z = -cs.topDepth / 2;
    topCard = new THREE.Mesh(cs.top, [cardMats.face, cardMats.back, cardMats.rim]);
    topCard.position.z = cs.deckDepth / 2 + 0.00005;
    stack.add(deckMesh, topCard);
    packGroup.add(stack);
    if (faceTex) { cardMats.face.map = faceTex; cardMats.face.needsUpdate = true; }
    // the burst cards: single-card slabs, backs on BOTH faces (a card tumbling out
    // must never flash its print — the player turns each one over by hand later)
    {
      const bc = buildBurstCard(cfg, BURST_N);
      burstGeo = bc.geometry;
      // (`foil`: in flight the back is a metal with a holographic band — setFoil, stepBurst)
      burstMats = makeCardMaterials({ cardBack: cb, cardBackNormal: cbn, edge: makeEdgeTexture(), foil: true });
      burstMats.rim.visible = false; // the back is SHAPED (the frame's silhouette) — a rectangular paper edge would outline it
      burstCards = [];
      for (let i = 0; i < BURST_N; i++) {
        const m = new THREE.Mesh(burstGeo, [burstMats.back, burstMats.back, burstMats.rim]);
        m.visible = false;
        m.frustumCulled = false;
        m.renderOrder = 3;
        burstCards.push(m);
        scene.add(m);
      }
    }

    // the light inside: a point light at the tear (in the scene from the start, at
    // zero, so its shader is compiled during the warm-up and never on the first
    // rip), the core sprite just inside the foil (depth-tested: only the gap shows
    // it), and the slab of light along the lip
    innerLight = new THREE.PointLight(0xffc462, 0, 0.16, 2);
    innerLight.position.set(0, pack.dims.yT0 - 0.004, 0);
    packGroup.add(innerLight);
    core = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeCoreTexture(), blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, transparent: true, opacity: 0, toneMapped: false }));
    core.renderOrder = 4;
    core.visible = false;
    packGroup.add(core);
    seam = createSeamGlow(pack, deformer);
    packGroup.add(seam.mesh);

    fit();
    built = true;
    deformer.evaluate(ctl.state, 0);
    applyTell();
    updateCue();
    requestRender();
    // warm the shaders while the carousel is still up, so the first tear never compiles
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 300)))(() => { if (!disposed) try { renderer.compile(scene, camera); } catch { /* fine */ } });
  })();

  // ---- pose (inspection rotation) --------------------------------------------------
  function stepPose(dt) {
    for (const k of ["yaw", "pitch"]) {
      const x = pose[k], t = pose[k + "T"], v = pose[k + "V"];
      const a = (t - x) * 95 - v * 13;
      const nv = v + a * dt;
      pose[k + "V"] = nv;
      pose[k] = x + nv * dt;
    }
    packGroup.rotation.set(pose.pitch + lean.pitch + shake.rx, pose.yaw, lean.roll + shake.rz);
    packGroup.position.set(follow.x + shake.x, follow.y + shake.y, follow.z + shake.z);
  }
  const poseMoving = () => Math.abs(pose.yaw - pose.yawT) > 0.0008 || Math.abs(pose.pitch - pose.pitchT) > 0.0008 || Math.abs(pose.yawV) > 0.003 || Math.abs(pose.pitchV) > 0.003;
  const facing = () => (Math.round((pose.yawT - REST_YAW) / Math.PI) % 2 === 0 ? "front" : "back");
  function snapPose() {
    pose.yawT = Math.round((pose.yawT - REST_YAW) / Math.PI) * Math.PI + REST_YAW;
    pose.pitchT = REST_PITCH;
  }
  function flip() {
    if (!built || opened || frozen) return;
    if (ctl.state.phase !== "ready" && ctl.state.phase !== "paused") return;
    pose.yawT += Math.PI;
    sfx.flick?.();
    updateCue();
    requestRender();
  }

  // ---- pointer → pack-local -----------------------------------------------------
  function localOn(e, zPlane) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    _m.copy(packGroup.matrixWorld).invert();
    const o = ray.ray.origin.clone().applyMatrix4(_m);
    const d = ray.ray.direction.clone().transformDirection(_m);
    if (Math.abs(d.z) < 1e-6) return null;
    const t = (zPlane - o.z) / d.z;
    if (t < 0) return null;
    return { x: o.x + d.x * t, y: o.y + d.y * t };
  }
  function screenOf(local) {
    _v.set(local.x, local.y, local.z).applyMatrix4(packGroup.matrixWorld).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((_v.x + 1) / 2) * r.width, y: r.top + ((1 - _v.y) / 2) * r.height };
  }
  // which grip (if any) a press lands on, given which face is toward the lens
  function gripAt(e) {
    const { aT, b0, yT0, ySeal } = pack.dims;
    const big = Math.max(26, packPx.w * 0.1); // ≥ a 44 px target
    const face = facing();
    if (face === "front") {
      const notch = screenOf({ x: -aT + 0.003, y: yT0 + 0.003, z: b0 });
      const l = localOn(e, b0);
      if (Math.hypot(e.clientX - notch.x, e.clientY - notch.y) <= big) return "front";
      if (l && l.y > yT0 - 0.006 && l.y < pack.dims.yTop + 0.004 && l.x < -aT + 0.03) return "front";
    } else {
      const top = screenOf({ x: 0.002, y: ySeal - 0.004, z: -b0 });
      const l = localOn(e, -b0);
      if (Math.hypot(e.clientX - top.x, e.clientY - top.y) <= big) return "back";
      if (l && Math.abs(l.x) < 0.014 && l.y > ySeal - 0.034 && l.y < pack.dims.yTop + 0.004) return "back";
    }
    return null;
  }
  function onPack(e) {
    const l = localOn(e, 0);
    return !!l && Math.abs(l.x) < pack.dims.a0 * 1.25 && Math.abs(l.y) < pack.dims.yTop * 1.12;
  }

  // ---- input ------------------------------------------------------------------------
  let drag = null; // { kind: "grip"|"rotate", id, x0, y0, t0, moved, lastX, lastY }
  function onDown(e) {
    if (!built || opened || !armed) return;
    if (e.target.closest?.("button")) return;
    if (ctl.state.auto) return;
    const g = (ctl.state.phase === "ready" || ctl.state.phase === "paused") ? gripAt(e) : null;
    if (g) {
      // a paused tear can only resume on its own route
      if (ctl.state.phase === "paused" && g !== ctl.state.mode) return;
      if (ctl.state.phase === "ready") ctl.setMode(g);
      const l = localOn(e, g === "front" ? pack.dims.b0 : -pack.dims.b0);
      if (!l) return;
      drag = { kind: "grip", id: e.pointerId };
      ctl.gripStart(l, e.timeStamp);
    } else if (onPack(e)) {
      drag = { kind: "rotate", id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: false, lastX: e.clientX, lastY: e.clientY };
    } else return;
    try { mountEl.setPointerCapture?.(e.pointerId); } catch { /* stray pointer */ }
    requestRender();
  }
  function onMove(e) {
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.kind === "grip") {
      const l = localOn(e, ctl.state.mode === "front" ? pack.dims.b0 : -pack.dims.b0);
      if (l) ctl.gripMove(l, e.timeStamp);
    } else if (!frozen) {
      const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 7) drag.moved = true;
      if (drag.moved) {
        pose.yawT += dx * 0.011;
        pose.pitchT = Math.max(-0.4, Math.min(0.4, pose.pitchT - dy * 0.004));
      }
    }
    requestRender();
  }
  function onUp(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (d.kind === "grip") ctl.gripEnd();
    else {
      if (!d.moved && e.type !== "pointercancel" && e.timeStamp - d.t0 < 320) flip();
      else { snapPose(); updateCue(); }
    }
    requestRender();
  }
  mountEl.addEventListener("pointerdown", onDown);
  mountEl.addEventListener("pointermove", onMove);
  mountEl.addEventListener("pointerup", onUp);
  mountEl.addEventListener("pointercancel", onUp);
  mountEl.addEventListener("lostpointercapture", (e) => { if (drag && drag.id === e.pointerId) onUp(e); });
  mountEl.addEventListener("contextmenu", (e) => e.preventDefault());
  mountEl.addEventListener("dragstart", (e) => e.preventDefault());
  document.addEventListener("visibilitychange", () => { if (document.hidden && drag?.kind === "grip") { drag = null; ctl?.gripEnd(); } });
  window.addEventListener("resize", () => { if (built) fit(); });
  flipBtn.addEventListener("click", flip);
  openBtn.addEventListener("click", () => { if (built && armed && !opened) { ctl.auto(facing()); requestRender(); } });

  function updateCue() {
    if (!built) return;
    const ph = ctl.state.phase;
    if (ph === "paused") cueEl.textContent = "Grab the strip and keep tearing";
    else if (ph === "ready") cueEl.textContent = facing() === "front" ? "Pinch the corner · tear across the top" : "Pinch the seam · pull until it pops";
    else cueEl.textContent = "";
    wrap.classList.toggle("back", facing() === "back");
  }

  // ---- feedback -------------------------------------------------------------------------
  // where the opening is on screen, and which way is "out" of it
  function mouthScreen() {
    const { b0, yT0, ySeal } = pack.dims;
    return ctl.state.mode === "front" ? screenOf({ x: 0, y: yT0 + 0.001, z: b0 }) : screenOf({ x: 0, y: ySeal - 0.006, z: -b0 });
  }
  function upAngle() {
    const { b0, yT0 } = pack.dims;
    const a = screenOf({ x: 0, y: yT0, z: b0 }), b = screenOf({ x: 0, y: yT0 + 0.02, z: b0 });
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
  function onEvent(type, d) {
    switch (type) {
      case "grip":
      case "resume":
        frozen = true;
        wrap.classList.add("tearing", "lit");
        wrap.classList.remove("guide");
        stopFloat(); // the bob drifts back to the exact rest pose under your fingers (no snap)
        sceneFx?.classList.add("paused");
        sfx.grab();
        strainTick = 0;
        onGrab?.(ctl.state.mode);
        anticipate(type === "resume");
        if (type === "resume" && d.p > P_NOTCH + 1e-4) sfx.tearStart(tellTier); // the rip picks its sound back up
        updateCue();
        break;
      case "strain":
        // the foil strains before it gives (the front tear): the seam brightens, the creak rises
        light.strain = d.k;
        light.seamT = 0.45 + 0.55 * d.k;
        sfx.foilStretch(true, d.k);
        break;
      case "pullStart":
        // the back pull has taken up its slack: the seam starts to creak
        sfx.foilStretch(false);
        sfx.strainStart?.(tellTier);
        if (navigator.vibrate) navigator.vibrate(6);
        break;
      case "pull": {
        // the power builds: the creak rises with it, the haptics ratchet harder, and the
        // light inside presses at the seam — brightest at the sliver that is about to give
        sfx.strain?.(d.s, d.vel);
        light.strain = d.s;
        light.seamT = 0.45 + 0.55 * d.s;
        light.innerT = 0.1 + 0.6 * d.s * d.s;
        room.floor(null, 0.14 + 0.22 * d.s, 220);
        if (d.s - strainTick >= 0.08) { strainTick = d.s; if (navigator.vibrate) navigator.vibrate(Math.round(4 + d.s * 12)); }
        else if (d.s < strainTick - 0.1) strainTick = d.s; // slackened: ratchet again on the way back up
        break;
      }
      case "break": {
        sfx.foilStretch(false);
        sfx.tearStart(tellTier);
        if (navigator.vibrate) navigator.vibrate(9);
        light.phase = "tear";
        light.seamT = 1;
        light.innerT = Math.max(light.innerT, 0.3);
        const s = screenOf(deformer.tipLocal(ctl.state));
        particles.emit(s.x, s.y, { count: 4, speed: 3, colors: FOIL, life: 30, shape: "chip", size: 1.8 });
        break;
      }
      case "progress": {
        const inten = Math.min(1, d.vel / 0.45);
        sfx.tearMove(inten, d.p);
        const s = screenOf(deformer.tipLocal(ctl.state));
        particles.emit(s.x, s.y, { count: 1 + Math.round(inten * 3), speed: 2 + inten * 5, colors: FOIL, life: 36, shape: "chip", size: 1.9 });
        if (inten > 0.5) particles.emit(s.x, s.y, { count: 1, speed: 3 + inten * 4, colors: ["#fff", "#ffe7b0"], life: 24, size: 1.3 });
        // the light follows the tear: more of it the further the foil has opened,
        // and a few lit motes escape at the tip
        light.innerT = 0.3 + 0.7 * d.p;
        room.leak(s.x, s.y, 4 + inten * 8, upAngle());
        room.floor(null, 0.14 + 0.26 * d.p, 220);
        if (d.buzz && navigator.vibrate) navigator.vibrate(5);
        break;
      }
      case "pause":
        frozen = false;
        wrap.classList.remove("tearing");
        sceneFx?.classList.remove("paused");
        sfx.foilStretch(false);
        if (d.slack) { if (d.tearing) sfx.strainEnd?.(false); }
        else if (d.tearing) sfx.tearEnd(false);
        follow.tx = follow.ty = follow.tz = 0;
        lean.tp = lean.tr = 0;
        if (d.p <= P_NOTCH + 1e-4) relax(); // let go before anything tore (or popped): the room comes back
        else pose.pitchT = REST_PITCH; // mid-tear: the light stays trapped, the pack eases
        updateCue();
        break;
      case "complete":
        completeSequence(d);
        break;
    }
  }

  // ANTICIPATION — the pack is gripped: the surroundings go almost black, a gold
  // pool reflects beneath the pack, the thin seam along the tear line appears and
  // the pack bends a touch toward the hand. (A resumed tear keeps its light.)
  function anticipate(resuming) {
    if (light.phase === "idle" || light.phase === "antic") light.phase = resuming && ctl.state.p > P_NOTCH + 1e-4 ? "tear" : "antic";
    light.roomT = 1;
    light.seamT = Math.max(light.seamT, 0.45);
    light.innerT = Math.max(light.innerT, 0.1);
    room.dim(1, 450);
    room.floor(getHandoffRect(), 0.14, 450);
    pose.pitchT = REST_PITCH + STRAIN_PITCH;
    if (!resuming) sfx.foilStretch(true, 0);
    requestRender();
  }
  // the hand let go before the first break — nothing tore, so the room comes back
  function relax() {
    light.phase = "idle";
    light.roomT = light.seamT = light.innerT = 0;
    light.strain = 0;
    room.dim(0, 700);
    room.floor(null, 0, 500);
    pose.pitchT = REST_PITCH;
    wrap.classList.remove("lit");
    requestRender();
  }

  // ---- the open ----------------------------------------------------------------------------
  function completeSequence({ power, mode }) {
    if (opened) return;
    opened = true;
    markTored();
    frozen = true;
    wrap.classList.add("opening");
    wrap.classList.remove("tearing");
    stopFloat(); // back to the exact rest pose, where the DOM card hand-off expects the canvas
    cueEl.textContent = "";
    sfx.foilStretch(false);
    if (mode === "front") sfx.tearEnd(true, power); // the sharp rip
    else { sfx.strainEnd?.(true); sfx.pop?.(power); } // the seal letting go all at once — "pong"
    sfx.burst(power, tellTier); // the short bass impact
    sfx.resumeOpenTheme?.();
    sfx.tearRelease();
    if (navigator.vibrate) navigator.vibrate(mode === "front" ? [18, 30, 14] : [26, 24, 18]);
    kick(mode === "front" ? power : Math.min(1, power + 0.2));
    burstAlongRoute(mode);
    const st = ctl.state;
    if (mode === "front") {
      const c = deformer.captureCap();
      const vel = deformer.chain.endVelocity(1 / 60, { x: 0, y: 0, z: 0 });
      const sp = Math.hypot(vel.x, vel.y, vel.z);
      const k = sp > 0.6 ? 0.6 / sp : 1;
      fly = { t: 0, c, pos: new THREE.Vector3(), vel: new THREE.Vector3(vel.x * k + 0.03, vel.y * k + 0.11, vel.z * k + 0.09), ang: 0, angVel: 2.4 + power * 2, axis: new THREE.Vector3(0.3, 1, 0.5).normalize() };
      st.capMatrix = new THREE.Matrix4();
      for (const m of [mats.headerExt, mats.headerInt]) { m.transparent = true; m.needsUpdate = true; }
      openSpring.t = 1;
      // the pack straightens to face the lens so the card inside lines up with the DOM card
      pose.yawT = Math.round(pose.yawT / (2 * Math.PI)) * 2 * Math.PI;
      pose.pitchT = 0;
      release(power, 0);
    } else {
      // THE POP: the seal lets go all at once — both doors blow open (the fast spring
      // overshoots), the hauled pack recoils away from the hand, the strain rings
      // back through zero (controller), and the cards LEAP out of the back through
      // the released light
      flapSpring.t = 1;
      follow.tx = follow.ty = follow.tz = 0;
      lean.tp = lean.tr = 0;
      {
        // the recoil: an impulse against the pull, plus a kick toward the lens
        const L = Math.hypot(follow.x, follow.y, follow.z) || 1;
        const kickV = 0.26 + power * 0.14;
        follow.vx -= (follow.x / L) * kickV; follow.vy -= (follow.y / L) * kickV; follow.vz += 0.12 + power * 0.08;
        lean.vp -= 1.4; // the top nods back as the tension lets go
      }
      shake.until = 0;
      startBurst(power); // the cards blow out of the open back and scatter, backs to the lens
      release(power, 0.04);
      // the flash reads first, then the spent sheet sinks into the dark behind the cards
      beatTimers.push(setTimeout(() => { if (!disposed) { light.spentT = 1; requestRender(); } }, 260));
    }
    // exit: the spent body drops away (px, so iOS animates it)
    const reach = Math.max(window.innerWidth, window.innerHeight) * 1.3;
    mountEl.style.setProperty("--exit-x", "0px");
    mountEl.style.setProperty("--exit-y", Math.round(reach) + "px");
    mountEl.style.setProperty("--exit-rot", "0deg");
    requestRender();
  }

  // THE RELEASE — the seal breaks: this is the brightest instant of the whole open.
  // One warm-white flash, the light inside spiking, a small camera impact and a
  // tight burst of dust; then the flash settles into soft beams escaping upward
  // from the mouth, which HOLD and breathe (longer for a chase — the "what's in
  // here?!" window) before the body drops and the card rises through them. The
  // hand-off is gated on the hold, with a safety net so the flow can never stall.
  // At hand-off the beams snuff out (openlight.js settle) BEFORE the body has visibly
  // moved — they are anchored to the mouth, and a ray outliving the pack hangs in the
  // air with no bottom half.
  function release(power, delay) {
    const holdMs = REDUCED ? 420 : 880 + tellTier * 70; // long enough for the god-light to be SEEN, not glimpsed
    const dropBeat = 150;
    light.phase = "open";
    light.t = -delay;
    light.hold = holdMs / 1000;
    light.releasedAt = performance.now();
    light.impulse = 1.25; // the spike at the break — the loudest the inside ever gets
    light.innerT = 1;
    light.seamT = 1;
    light.roomT = 1;
    core.visible = true;
    const at = (ms, fn) => beatTimers.push(setTimeout(() => { if (!disposed && opened) fn(); }, ms));
    at(delay * 1000, () => { const s = mouthScreen(); room.flash(power, s.x, s.y); room.floor(null, 0.95, 100); });
    at(delay * 1000 + 70, () => { const s = mouthScreen(); room.release({ x: s.x, y: s.y, width: packPx.w, tier: tellTier, up: upAngle() }); });
    at(delay * 1000 + 130, () => sfx.sparkleDust(5 + Math.round(tellTier * 0.5), 0.9)); // the delicate shimmer
    at(delay * 1000 + 340, () => room.floor(null, 0.66, 600));
    clearTimeout(handoffTimer);
    handoffTimer = setTimeout(handOff, delay * 1000 + holdMs + dropBeat + 60);
  }
  let handedOff = false;
  function handOff() {
    if (handedOff) return;
    // the back pop: the cards are still re-forming the stack (the gather) — the DOM takes
    // over the moment the last one is down (stepGather calls back in)
    if (burst && !burst.gathered) { burst.handOffPending = true; requestRender(); return; }
    handedOff = true;
    light.handedAt = performance.now();
    // the beams snuff out ahead of the drop, the dark room lifts behind the card; the
    // light inside goes out quickly so nothing rides the body as it drops
    light.phase = "out";
    light.innerT = light.seamT = light.roomT = 0;
    light.impulse = 0;
    room.settle();
    if (stack) stack.visible = false; // the DOM stack behind the canvas takes over, in place
    // the back pop: the cards blew OUT of the wrapper toward the lens and lie scattered in
    // front of it, so the DOM cards must stay OVER the blown-open sheet as it drops away
    // (CSS: #pack-stage.cards-over sinks the stage under the reveal) — the front tear keeps
    // the body over the card. The DOM takes each scattered card at its exact screen rect
    // (scatterLayout) and fades in over the 3D one as it fades out.
    const back = ctl.state.mode === "back";
    if (back) mountEl.classList.add("cards-over");
    const scatter = back && burst ? scatterLayout() : null;
    if (burst) burst.fade = { t: 0, dur: 0.4 };
    ctl.reveal();
    onOpen?.({ mode: ctl.state.mode, scatter, stacked: !!scatter }); // (the scatter's poses are the re-formed stack)
    requestRender();
  }

  // ease the levels, run the open's envelope, and write the light into the scene
  function stepLight(dt) {
    const k = 1 - Math.exp(-dt / 0.11), kr = 1 - Math.exp(-dt / 0.28);
    if (light.phase === "open") {
      light.t += dt;
      if (light.t >= 0) {
        const u = Math.min(1, light.t / light.hold);
        // settle from the flash, then two gentle surges — the trapped light breathing out
        const env = u < 0.3 ? 1 - 0.2 * (u / 0.3)
          : u < 0.55 ? 0.8 + 0.2 * Math.sin(((u - 0.3) / 0.25) * Math.PI)
          : u < 0.85 ? 0.8 + 0.2 * Math.sin(((u - 0.55) / 0.3) * Math.PI) : 0.8;
        light.innerT = 0.82 + 0.3 * env; // the held glow stays hot (the surges go past 1)
      }
    }
    light.seam += (light.seamT - light.seam) * k;
    light.inner += (light.innerT - light.inner) * k;
    light.room += (light.roomT - light.room) * kr;
    light.spent += (light.spentT - light.spent) * (1 - Math.exp(-dt / 0.45));
    light.impulse *= Math.exp(-dt / 0.09);
    // a live flame while the hand is on it; steady when paused or open
    const live = light.phase === "antic" || light.phase === "tear";
    const flickT = live ? 0.9 + 0.1 * Math.sin(performance.now() * 0.021) * Math.sin(performance.now() * 0.0073) : 1;
    light.flicker += (flickT - light.flicker) * k;
    if (!built) return;

    const st = ctl.state;
    const { b0, yT0, aT, ySeal } = pack.dims;
    const detached = st.phase === "detached" || st.phase === "revealed";
    const front = st.mode === "front";
    const tipX = detached ? 0 : -aT + st.p * 2 * aT;
    const tipY = detached ? 0 : ySeal - 0.0176; // the back: the sliver below the top crimp, where the seal gives
    const inner = light.inner * light.flicker, imp = light.impulse;

    // the room dims → the pack's own reflections, self-light and the rig sink with it,
    // so the lower half falls into shadow and the light at the tear is the bright thing.
    // (The base rig is brighter than it was, so the dim bites a little deeper to land
    // the open at the same darkness it was tuned for.)
    const dimK = 1 - 0.58 * light.room;
    // …and the SPENT wrapper (the back pop's blown-open sheet) goes darker still: its
    // reflections, print-light and the inside's glow sink, the foil's own gold darkens
    // (the cards in front of it are lit by their own print, not this)
    const spentK = 1 - 0.62 * light.spent, spentIn = 1 - 0.72 * light.spent;
    mats.bodyExt.envMapIntensity = mats.headerExt.envMapIntensity = EXT_ENV * dimK * spentK;
    mats.bodyExt.emissiveIntensity = mats.headerExt.emissiveIntensity = EXT_EMI * dimK * spentK;
    mats.bodyExt.color.setScalar(1 - 0.4 * light.spent);
    mats.bodyInt.envMapIntensity = mats.headerInt.envMapIntensity = EXT_ENV * spentIn;
    mats.bodyInt.color.setHex(INT_GOLD).multiplyScalar(1 - 0.45 * light.spent);
    mats.headerInt.color.copy(mats.bodyInt.color);
    lights.key.intensity = KEY_I * (1 - 0.5 * light.room);
    lights.fill.intensity = FILL_I * (1 - 0.65 * light.room);
    lights.hemi.intensity = HEMI_I * dimK;
    // the inside catches the light
    mats.bodyInt.emissiveIntensity = mats.headerInt.emissiveIntensity = (0.55 * inner + 1.2 * imp) * spentIn;
    // the point light at the tear tip, inside the foil
    innerLight.intensity = INNER_MAX * (inner + 3.2 * imp) * (1 - 0.5 * light.spent);
    if (front) innerLight.position.set(detached ? 0 : tipX - 0.004, yT0 - 0.005, 0.0004);
    else innerLight.position.set(0, detached ? 0.01 : tipY + 0.004, -b0 + 0.0025);
    // the core: just inside the surface, so the foil still in place hides it
    const coreA = Math.min(1, inner * 0.92 + imp);
    core.visible = coreA > 0.01;
    if (core.visible) {
      if (front) core.position.set(detached ? 0 : tipX - 0.0015, yT0 + (detached ? 0.002 : 0.0012), b0 - 0.0008);
      else core.position.set(0, detached ? ySeal - 0.01 : tipY - 0.001, -b0 + 0.0008);
      core.material.opacity = coreA;
      core.scale.setScalar(detached ? 0.03 + 0.024 * inner + 0.08 * imp : 0.011 + 0.013 * inner + 0.04 * imp);
    }
    seam.update({ mode: st.mode, seam: light.seam, inner: Math.min(1, inner + imp * 0.8), strain: light.strain, tipX, tipY, open: detached });
    if (light.phase === "open" && light.t >= 0) { const s = mouthScreen(); room.setSource(s.x, s.y); }
    return { heat: Math.min(1, inner + imp), tipX, tipY };
  }
  // (a paused tear keeps its light but needs no frames: the levels are static until the hand returns)
  const lightMoving = () => light.phase === "open" || light.impulse > 0.004
    || Math.abs(light.seam - light.seamT) > 0.004 || Math.abs(light.inner - light.innerT) > 0.004 || Math.abs(light.room - light.roomT) > 0.004
    || Math.abs(light.spent - light.spentT) > 0.004;

  function stepFly(dt) {
    if (!fly) return;
    fly.t += dt;
    fly.vel.y += 0.22 * dt; fly.vel.z += 0.06 * dt;
    fly.vel.multiplyScalar(Math.exp(-dt * 0.8));
    fly.pos.addScaledVector(fly.vel, dt);
    fly.ang += fly.angVel * dt;
    _q.setFromAxisAngle(fly.axis, fly.ang);
    const c = fly.c;
    ctl.state.capMatrix.makeTranslation(c.x + fly.pos.x, c.y + fly.pos.y, c.z + fly.pos.z).multiply(_m.makeRotationFromQuaternion(_q)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    const fade = 1 - Math.min(1, Math.max(0, (fly.t - 0.42) / 0.38));
    mats.headerExt.opacity = mats.headerInt.opacity = fade;
    if (fade <= 0) { mats.headerExt.visible = mats.headerInt.visible = false; fly = null; }
  }
  // ---- THE BURST (back pop) ------------------------------------------------------------
  // The seal lets go and the stack is BLOWN APART: every card leaves the open back on its
  // own — fast off the mark, out toward the lens and away from the centre, overshooting its
  // spot and settling back, tumbling end over end once — and lands face DOWN (its back to
  // the lens) in a spread that fills the frame. The spread is laid out in SCREEN space (a
  // loose ring of spots, shuffled per pack) and mapped onto the z = 0 plane, where the
  // camera is fitted so a card projects to exactly the DOM card's width: a settled card's
  // on-screen rect is therefore an exact translate/rotate/scale of the DOM slot, which is
  // what lets the DOM take over at the hand-off without a seam (scatterLayout).
  //
  // THE GATHER — once the spread has been seen (GATHER_HOLD), the cards glide back and
  // RE-FORM THE STACK, still face down, deepest first and the top card last, arcing over
  // the ones already down: each lands on the DOM deck's own rest pose for its depth (the
  // 5px step + 1% shrink per card behind — index.html's .reveal__slot rest, corrected
  // for the card's z so it projects exactly), so at the hand-off the DOM stack can own
  // them with no visible change and the player turns the TOP card over (reveal.js
  // stacked mode). The hand-off waits for the gather (handOff / handOffPending).
  const GATHER_HOLD = REDUCED ? 0.15 : 0.32; // s the spread holds before the cards come back
  const DEPTH_STEP_PX = 5, DEPTH_SHRINK = 0.01; // the DOM deck's rest (keep in sync with index.html / reveal.js)
  function scatterSpots(n) {
    const vw = mountEl.clientWidth || window.innerWidth, vh = mountEl.clientHeight || window.innerHeight;
    const cw = cardPx(), ch = cw * (cfg.cardHM / cfg.cardWM);
    // the cards' size in the spread: wide enough to read, small enough that five fit a phone
    const s = Math.max(0.34, Math.min(0.62, (0.31 * vw) / cw, (0.2 * vh) / ch));
    let spots;
    if (n === 5) {
      // a hand-tuned quincunx for the five-card pack: one up top, two either side, two low
      spots = [[0, -0.31, -5], [-0.265, -0.1, -13], [0.265, -0.1, 12], [-0.22, 0.26, 9], [0.22, 0.26, -10]];
    } else {
      spots = [];
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
        spots.push([0.27 * Math.cos(a), 0.3 * Math.sin(a), (k % 2 ? 1 : -1) * (6 + (k * 7) % 9)]);
      }
    }
    const out = spots.map(([fx, fy, rot]) => ({
      x: fx * vw + (Math.random() * 2 - 1) * 0.012 * vw,
      y: fy * vh + (Math.random() * 2 - 1) * 0.01 * vh,
      rot: (rot + (Math.random() * 2 - 1) * 3) * Math.PI / 180,
      s,
    }));
    for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; } // shuffle: the rare is never in the same spot
    return out;
  }
  function startBurst(power) {
    if (!burstCards.length) return;
    stack.visible = false;
    stack.updateMatrixWorld(true);
    const ppm = cardPx() / cfg.cardWM; // px per metre on the z = 0 plane
    const spots = scatterSpots(burstCards.length);
    const thick = cfg.stackDepthM / burstCards.length;
    const q0 = new THREE.Quaternion(), p0 = new THREE.Vector3();
    stack.getWorldQuaternion(q0);
    const halfTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // back to the lens
    const n = burstCards.length, D = camera.position.z; // (a card at z draws D / (D − z) larger than one on the plane)
    const cards = burstCards.map((mesh, i) => {
      // card i sits at its depth in the stack (0 = the top card)
      _v.set(0, 0, cfg.stackDepthM / 2 - thick / 2 - i * thick);
      stack.localToWorld(_v);
      p0.copy(_v);
      const sp = spots[i];
      const pT = new THREE.Vector3(sp.x / ppm, -sp.y / ppm, 0.0005 * (burstCards.length - i));
      const qT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sp.rot).multiply(halfTurn);
      const phi = Math.random() * Math.PI * 2; // the tumble axis: in the card's own plane → end over end
      // the gather's target: this card's depth in the re-formed stack (card 0 on top,
      // nearest the lens), on the DOM deck's rest pose for that depth
      const zG = 0.0004 * (n - i), mag = (D - zG) / D;
      const pG = new THREE.Vector3(0, -(DEPTH_STEP_PX * i / ppm) * mag, zG);
      const sG = (1 - DEPTH_SHRINK * i) * mag;
      mesh.position.copy(p0); mesh.quaternion.copy(q0); mesh.scale.setScalar(1);
      mesh.visible = true;
      return {
        mesh, p0: p0.clone(), q0: q0.clone(), pT, qT, s: sp.s,
        axis: new THREE.Vector3(Math.cos(phi), Math.sin(phi), 0), turn: (Math.random() < 0.5 ? -1 : 1) * (REDUCED ? 0 : 1),
        delay: 0.03 + i * (REDUCED ? 0.012 : 0.028) + Math.random() * 0.02,
        dur: REDUCED ? 0.4 : 0.66 + Math.random() * 0.12,
        done: false,
        pG, qG: halfTurn.clone(), sG, // (straight: the deck squares up)
        gDelay: GATHER_HOLD + (n - 1 - i) * (REDUCED ? 0.02 : 0.05), // deepest first, the top card last
        gDur: REDUCED ? 0.3 : 0.56,
        lift: REDUCED ? 0 : 0.012 + 0.028 * (n > 1 ? 1 - i / (n - 1) : 1), // the later a card, the higher it arcs over the ones down
        gathered: false,
      };
    });
    burst = { t: 0, cards, settled: false, settledAt: 0, gathered: false, handOffPending: false, fade: null, power };
    setFoil(burstMats.back, 1); // foil in flight: the backs mirror the room and flash their band as they tumble
  }
  // the foil eases back to the DOM back's matte look over the gather, so the cards land
  // on the deck looking exactly like the `.slot__back`s that take over at the hand-off
  function stepFoil() {
    if (!burst) return;
    let f = 1;
    if (burst.settled) {
      let gEnd = 0;
      for (const c of burst.cards) gEnd = Math.max(gEnd, c.gDelay + c.gDur);
      const k = Math.min(1, Math.max(0, (burst.t - burst.settledAt - GATHER_HOLD) / Math.max(0.01, gEnd - GATHER_HOLD)));
      f = 1 - k * k * (3 - 2 * k);
    }
    if (f !== burstMats.back.userData.foil?.value) setFoil(burstMats.back, f);
  }
  function stepBurst(dt) {
    if (!burst) return;
    burst.t += dt;
    const pw = burst.power ?? 0.7;
    let all = true;
    for (const c of burst.cards) {
      if (c.done) continue;
      const u = Math.max(0, Math.min(1, (burst.t - c.delay) / c.dur));
      if (u <= 0) { all = false; continue; }
      const e = 1 - Math.pow(1 - u, 3); // ease-out: fast off the mark
      const c1 = 1.2, c3 = c1 + 1;
      const eb = 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); // ease-out-back: past the spot, then back
      const arc = Math.sin(Math.PI * Math.pow(u, 0.8)); // out toward the lens, then settling
      const m = c.mesh;
      m.position.set(
        c.p0.x + (c.pT.x - c.p0.x) * eb,
        c.p0.y + (c.pT.y - c.p0.y) * eb,
        c.p0.z + (c.pT.z - c.p0.z) * e + (REDUCED ? 0.02 : 0.035 + 0.03 * pw) * arc,
      );
      // the base turn (from the pack's pose to flat, back to the lens) plus one full
      // tumble about the card's own in-plane axis, fast first — a whole turn is the
      // identity, so it ends exactly on the settled pose
      m.quaternion.slerpQuaternions(c.q0, c.qT, e);
      if (c.turn) {
        const spin = 1 - Math.pow(1 - u, 2.6);
        _q.setFromAxisAngle(c.axis, c.turn * Math.PI * 2 * spin);
        m.quaternion.multiply(_q);
      }
      m.scale.setScalar(1 + (c.s - 1) * e);
      if (u >= 1) {
        c.done = true;
        m.position.copy(c.pT); m.quaternion.copy(c.qT); m.scale.setScalar(c.s);
        sfx.cardTap?.(burst.cards.indexOf(c)); // a soft tap as each lands
      } else all = false;
    }
    if (all && !burst.settled) { burst.settled = true; burst.settledAt = burst.t; }
    if (burst.settled && !burst.gathered) stepGather();
    stepFoil();
    if (burst.fade) {
      // the hand-off: the DOM backs fade in over these at the same rects as they fade out
      // (the back is alpha-shaped: its cut-out threshold must follow the opacity down)
      burst.fade.t += dt;
      const k = Math.min(1, burst.fade.t / burst.fade.dur);
      for (const mt of [burstMats.back, burstMats.rim]) { mt.transparent = true; mt.opacity = 1 - k; mt.alphaTest = 0.5 * (1 - k); mt.depthWrite = k < 1; }
      if (k >= 1) endBurst();
    }
  }
  // the gather (see scatterSpots): each card glides from its spot to its place in the
  // stack — ease-in-out, a lift toward the lens on the way so it passes OVER the cards
  // already down — and squares up as it lands (a soft tap each). The last one down
  // releases the hand-off if it's waiting.
  function stepGather() {
    let allG = true;
    const n = burst.cards.length;
    for (let i = 0; i < n; i++) {
      const c = burst.cards[i];
      if (c.gathered) continue;
      const u = Math.max(0, Math.min(1, (burst.t - burst.settledAt - c.gDelay) / c.gDur));
      if (u <= 0) { allG = false; continue; }
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; // ease-in-out: leaves and arrives softly
      const m = c.mesh;
      m.position.lerpVectors(c.pT, c.pG, e);
      m.position.z += c.lift * Math.sin(Math.PI * u);
      m.quaternion.slerpQuaternions(c.qT, c.qG, e);
      m.scale.setScalar(c.s + (c.sG - c.s) * e);
      if (u >= 1) {
        c.gathered = true;
        c.pT.copy(c.pG); c.qT.copy(c.qG); c.s = c.sG; // its settled pose is now its place in the stack (scatterLayout reads these)
        m.position.copy(c.pT); m.quaternion.copy(c.qT); m.scale.setScalar(c.s);
        sfx.cardTap?.(n - 1 - i); // a soft tap as it lands on the deck
      } else allG = false;
    }
    if (allG) {
      burst.gathered = true;
      if (burst.handOffPending) { burst.handOffPending = false; handOff(); }
    }
  }
  function endBurst() {
    if (!burst) return;
    for (const c of burst.cards) c.mesh.visible = false;
    for (const mt of [burstMats.back, burstMats.rim]) { mt.transparent = false; mt.opacity = 1; mt.alphaTest = 0.5; mt.depthWrite = true; }
    setFoil(burstMats.back, 0);
    burst = null;
  }
  // where each settled card is on screen: centre, size and tilt — the DOM slot's pose.
  // (The camera is fitted so a card on z = 0 is exactly the DOM card's width, and these
  // lie flat on that plane, so the projection is a plain translate/rotate/scale.)
  function scatterLayout() {
    if (!burst) return null;
    const r = canvas.getBoundingClientRect();
    const toScreen = (v) => { v.project(camera); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; };
    return burst.cards.map((c, i) => {
      const m = c.mesh;
      m.position.copy(c.pT); m.quaternion.copy(c.qT); m.scale.setScalar(c.s);
      m.updateMatrixWorld(true);
      const C = toScreen(m.localToWorld(new THREE.Vector3(0, 0, 0)));
      const U = toScreen(m.localToWorld(new THREE.Vector3(0, cfg.cardHM / 2, 0)));
      const R = toScreen(m.localToWorld(new THREE.Vector3(cfg.cardWM / 2, 0, 0)));
      return {
        i, cx: C.x, cy: C.y,
        w: 2 * Math.hypot(R.x - C.x, R.y - C.y),
        h: 2 * Math.hypot(U.x - C.x, U.y - C.y),
        rot: Math.atan2(U.x - C.x, -(U.y - C.y)) * 180 / Math.PI, // CSS rotate: clockwise-positive, from screen-up
        order: burst.cards.length - i, // the deeper in the stack, the lower it lies
      };
    });
  }
  function stepSprings(dt) {
    const sp = (s, k, c) => { const a = (s.t - s.x) * k - s.v * c; s.v += a * dt; s.x += s.v * dt; };
    for (const s of [openSpring, flapSpring]) { if (s.x === undefined) s.x = 0; sp(s, s.k, s.c); }
    ctl.state.open = openSpring.x;
    ctl.state.flapOpen = flapSpring.x;
    ctl.state.flapVel = flapSpring.v;
    // the back pull's rigid feel
    const st = ctl.state;
    // popped: the pack draws back as the wrapper lays out, where the frame needs it
    if (st.mode === "back" && recedeZ > 0 && (st.phase === "detached" || st.phase === "revealed")) follow.tz = -recedeZ * Math.min(1, flapSpring.x);
    if (st.mode === "back" && st.grip && (st.phase === "gripping" || st.phase === "tearing")) {
      // the hand's pull (pack-local, on the back) → a fraction of it, in world space
      _v.set(st.pullX, st.pullY, 0).applyQuaternion(packGroup.quaternion);
      const K = 0.2;
      follow.tx = _v.x * K; follow.ty = _v.y * K; follow.tz = _v.z * K;
      lean.tp = Math.max(-0.14, Math.min(0.14, st.pullY * 2.4));
      lean.tr = Math.max(-0.14, Math.min(0.14, -st.pullX * 2.4));
    }
    const fk = 150, fc = 11; // underdamped: it boings when let go, recoils on the pop
    for (const [x, v, t] of [["x", "vx", "tx"], ["y", "vy", "ty"], ["z", "vz", "tz"]]) {
      const a = (follow[t] - follow[x]) * fk - follow[v] * fc;
      follow[v] += a * dt; follow[x] += follow[v] * dt;
    }
    for (const [x, v, t] of [["pitch", "vp", "tp"], ["roll", "vr", "tr"]]) {
      const a = (lean[t] - lean[x]) * 120 - lean[v] * 11;
      lean[v] += a * dt; lean[x] += lean[v] * dt;
    }
    // the tremble: the seal shudders harder the closer it is to giving (not after)
    const sa = (st.phase === "gripping" || st.phase === "tearing") && st.mode === "back" ? Math.max(0, st.strain) : 0;
    const now = performance.now();
    if (sa > 0.05 && !REDUCED) {
      if (now > shake.until) {
        const amp = 0.0016 * Math.pow(sa, 2.4);
        shake.x = (Math.random() * 2 - 1) * amp; shake.y = (Math.random() * 2 - 1) * amp; shake.z = (Math.random() * 2 - 1) * amp * 0.5;
        shake.rx = (Math.random() * 2 - 1) * 0.014 * sa * sa; shake.rz = (Math.random() * 2 - 1) * 0.014 * sa * sa;
        shake.until = now + 28 + (1 - sa) * 40; // faster as it nears the limit
      }
    } else { shake.x = shake.y = shake.z = shake.rx = shake.rz = 0; }
  }
  const followMoving = () => Math.hypot(follow.vx, follow.vy, follow.vz) > 0.0006 || Math.hypot(follow.x - follow.tx, follow.y - follow.ty, follow.z - follow.tz) > 0.00003
    || Math.abs(lean.vp) + Math.abs(lean.vr) > 0.004 || Math.abs(lean.pitch - lean.tp) + Math.abs(lean.roll - lean.tr) > 0.0005;

  // a small camera impact on the release: a quick push-in and a short settle,
  // not a shake (skipped under reduced motion)
  function kick(power) {
    if (REDUCED || !mountEl.animate) return;
    const a = 3 + power * 4;
    const frames = [
      { transform: `translate(0px, ${(a * 0.6).toFixed(1)}px) scale(${(1 + 0.028 * power).toFixed(3)})`, offset: 0 },
      { transform: `translate(${(-a * 0.5).toFixed(1)}px, ${(-a * 0.7).toFixed(1)}px) scale(${(1 + 0.012 * power).toFixed(3)})`, offset: 0.3 },
      { transform: `translate(${(a * 0.3).toFixed(1)}px, ${(a * 0.25).toFixed(1)}px) scale(1)`, offset: 0.58 },
      { transform: `translate(${(-a * 0.12).toFixed(1)}px, ${(-a * 0.1).toFixed(1)}px) scale(1)`, offset: 0.8 },
      { transform: "translate(0px, 0px) scale(1)", offset: 1 },
    ];
    mountEl.animate(frames, { duration: 240 + power * 60, easing: "ease-out", fill: "none" });
  }
  function burstAlongRoute(mode) {
    const { aT, b0, yT0, ySeal } = pack.dims;
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      const l = mode === "front" ? { x: -aT + u * 2 * aT, y: yT0, z: b0 } : { x: 0, y: ySeal - u * 2 * ySeal, z: -b0 };
      const s = screenOf(l);
      particles.emit(s.x, s.y, { count: 2, speed: 4.5, colors: FOIL, life: 50, size: 2.6, shape: "chip" });
      if (k % 2 === 0) particles.emit(s.x, s.y, { count: 1, speed: 5.5, colors: ["#fff", "#ffe7b0"], life: 30, size: 1.6 });
    }
  }

  // ---- the loop (on demand) ----------------------------------------------------------
  let raf = 0, lastT = 0;
  function requestRender() { if (!raf && !disposed) raf = requestAnimationFrame(frame); }
  function needsLoop() {
    if (!built) return false;
    const st = ctl.state;
    if (drag || st.auto || fly) return true;
    if (burst && (!burst.gathered || burst.fade)) return true;
    if (st.phase === "gripping" || st.phase === "tearing") return true;
    if (lightMoving()) return true;
    if (poseMoving()) return true;
    if (Math.abs(openSpring.t - (openSpring.x || 0)) > 0.002 || Math.abs(openSpring.v) > 0.01) return true;
    if (Math.abs(flapSpring.t - (flapSpring.x || 0)) > 0.002 || Math.abs(flapSpring.v) > 0.01) return true;
    if (st.p > P_NOTCH && st.mode === "front" && deformer.chain.motion() > 0.00002) return true;
    if (st.press > 0.01 || Math.abs(st.pull) > 0.01) return true;
    if (st.ringing || Math.abs(st.strain) > 0.002 || Math.abs(st.strain - st.strainT) > 0.002) return true;
    if (followMoving() || shake.x !== 0) return true;
    return false;
  }
  function frame(t) {
    raf = 0;
    if (disposed) return;
    const dt = lastT ? Math.min(0.05, Math.max(0.001, (t - lastT) / 1000)) : 1 / 60; // clamp after a background return
    lastT = t;
    if (built) {
      ctl.update(dt);
      stepFly(dt);
      stepSprings(dt);
      stepPose(dt);
      stepBurst(dt);
      const lit = stepLight(dt);
      deformer.evaluate(ctl.state, dt, lit);
      renderer.render(scene, camera);
      placeNotch();
      if (debugPanel) debugPanel.stats();
    }
    if (needsLoop()) requestRender();
    else lastT = 0;
  }

  // the grip marker rides the projected notch (front) or seam top (back)
  function placeNotch() {
    if (!built || opened) return;
    const { aT, b0, yT0, ySeal } = pack.dims;
    const s = facing() === "front"
      ? screenOf({ x: -aT + 0.003, y: yT0 + 0.0035, z: b0 })
      : screenOf({ x: 0.0015, y: ySeal - 0.004, z: -b0 });
    const r = canvas.getBoundingClientRect(); // the notch shares the canvas's (floating) box
    notchEl.style.left = `${(s.x - r.left).toFixed(1)}px`;
    notchEl.style.top = `${(s.y - r.top).toFixed(1)}px`;
  }

  // ---- tell (rarity foreshadow) ------------------------------------------------------
  function applyTell() {
    const hex = TIER_HEX[tellTier] || TIER_HEX[0];
    const heat = tellTier <= 3 ? 0 : Math.min(1, 0.4 + (tellTier - 4) * 0.12);
    mountEl.style.setProperty("--tell", hex);
    mountEl.style.setProperty("--idle-heat", heat.toFixed(2));
    mountEl.classList.toggle("chase", tellTier >= 8);
    if (core) {
      // the light stays gold; the tell only warms or cools it a little
      tipTint.set(hex);
      core.material.color.set(0xfff1cf).lerp(tipTint, 0.18);
      innerLight.color.set(0xffc462).lerp(tipTint, 0.28);
      seam.setTint(hex);
    }
  }

  // ---- public API ------------------------------------------------------------------------
  function reset() {
    if (!built) return;
    opened = false; handedOff = false; frozen = false;
    fly = null;
    endBurst();
    clearTimeout(handoffTimer); clearTimeout(floatTimer);
    for (const t of beatTimers) clearTimeout(t);
    beatTimers.length = 0;
    light.phase = "idle";
    light.seam = light.seamT = light.inner = light.innerT = light.room = light.roomT = light.impulse = light.strain = 0;
    light.spent = light.spentT = 0;
    light.flicker = 1;
    room.reset();
    sfx.foilStretch(false);
    openSpring.x = openSpring.v = openSpring.t = 0;
    flapSpring.x = flapSpring.v = flapSpring.t = 0;
    follow.x = follow.y = follow.z = follow.vx = follow.vy = follow.vz = follow.tx = follow.ty = follow.tz = 0;
    lean.pitch = lean.roll = lean.vp = lean.vr = lean.tp = lean.tr = 0;
    shake.x = shake.y = shake.z = shake.rx = shake.rz = 0; shake.until = 0;
    strainTick = 0;
    packGroup.position.set(0, 0, 0);
    if (topCard) { topCard.rotation.x = 0; }
    for (const m of [mats.headerExt, mats.headerInt]) { m.visible = true; m.opacity = 1; m.transparent = false; m.needsUpdate = true; }
    packGroup.attach(stack);
    stack.position.set(0, 0, 0); stack.quaternion.identity(); stack.visible = true;
    core.visible = false;
    seam.reset();
    pose.yaw = pose.yawT = REST_YAW; pose.pitch = pose.pitchT = REST_PITCH; pose.yawV = pose.pitchV = 0;
    packGroup.rotation.set(REST_PITCH, REST_YAW, 0);
    ctl.reset();
    deformer.reset();
    stepLight(0);
    deformer.evaluate(ctl.state, 0);
    clearFloat();
    wrap.classList.remove("opening", "tearing", "back", "lit");
    mountEl.classList.remove("cards-over");
    updateCue();
    requestRender();
  }
  // ---- the idle float ---------------------------------------------------------------
  // The bob is a CSS animation on .pack3d-body (host CSS `float`: compositor-only, so the
  // on-demand renderer can sleep through it). Its 0% keyframe sits FLOAT_POSE0 away from
  // rest, so switching it on cold snapped the just-landed pack 6 px — the "jump" at the
  // end of the pick → open transition. Instead the body's child .pack3d-glide starts at
  // the exact inverse of that pose and eases to none: the pack leaves its landing still
  // at rest, velocity-continuous (both halves start at zero speed), and the bob's
  // amplitude grows in over FLOAT_IN. Stopping (a grip, the open) is the reverse: the
  // bob pauses where it is and the glide eases to ITS inverse, so the pack drifts back
  // to the exact rest pose over FLOAT_OUT — where the opened wrapper and the DOM card
  // hand-off need the canvas — rather than snapping; only once there is the animation
  // removed, with both transforms cleared in the same style update (nothing visible
  // changes: paused ∘ inverse was already identity).
  const FLOAT_POSE0 = "translateY(-6px) rotate(-0.4deg)"; // = the host's `float` keyframe at 0%
  const FLOAT_IN = 2.4, FLOAT_OUT = 0.32; // seconds
  let floatTimer = 0, floating = false;
  const inverseOf = (tf) => { try { return new DOMMatrix(tf).inverse().toString(); } catch { return "none"; } };
  function startFloat() {
    if (floating || opened || frozen || REDUCED) return;
    floating = true;
    clearTimeout(floatTimer);
    bodyEl.style.animationPlayState = "";
    glideEl.style.transition = "none";
    glideEl.style.transform = inverseOf(FLOAT_POSE0); // counter the bob's first frame exactly
    wrap.classList.add("settled");                   // the bob starts, from FLOAT_POSE0
    void glideEl.offsetWidth;                        // commit the counter-pose before the ease
    glideEl.style.transition = `transform ${FLOAT_IN}s ease-in-out`;
    glideEl.style.transform = "none";                // …and let the amplitude grow in
  }
  function stopFloat() {
    if (!floating) return;
    floating = false;
    clearTimeout(floatTimer);
    bodyEl.style.animationPlayState = "paused";      // hold the bob where it is
    // A CSS pause resolves at the NEXT frame (a pending pause task), so the matrix read
    // right now would be one frame of bob ahead of where it actually freezes — a ~0.15px
    // residual that would then snap at the clear. Read it once the hold is in effect.
    requestAnimationFrame(() => {
      if (floating) return; // restarted meanwhile
      const cur = getComputedStyle(bodyEl).transform; // the frozen bob
      glideEl.style.transition = `transform ${FLOAT_OUT}s ease-out`;
      glideEl.style.transform = cur && cur !== "none" ? inverseOf(cur) : "none"; // net → rest
      floatTimer = setTimeout(clearFloat, FLOAT_OUT * 1000 + 40);
    });
  }
  function clearFloat() { // everything off, in one update: the pack sits exactly at rest
    clearTimeout(floatTimer);
    floating = false;
    wrap.classList.remove("settled");
    bodyEl.style.animationPlayState = "";
    glideEl.style.transition = "none";
    glideEl.style.transform = "";
  }

  // The pack has just been revealed under the landed carousel hero — which landed IN
  // this pack's rest pose (getHandoffPose), so nothing turns here: the still simply
  // starts to breathe, the float easing in from zero amplitude.
  function present() {
    if (!built || opened) return;
    pose.yawT = REST_YAW;
    pose.pitchT = REST_PITCH;
    startFloat();
    updateCue();
    requestRender();
  }
  // The pose the carousel's hero must land in so the dissolve joins two identical packs.
  function getHandoffPose() { return { yaw: pose.yawT, pitch: pose.pitchT }; }
  function setArmed(v) {
    armed = v;
    wrap.classList.toggle("ready", v);
    wrap.classList.toggle("guide", v && !hasToredBefore());
    requestRender();
  }
  function setTell(peak) { tellTier = peak | 0; applyTell(); }
  function setCards(cards) {
    const src = cards?.[0]?.image;
    if (!src) return;
    new THREE.TextureLoader().load(src, (tex) => {
      if (disposed) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      faceTex?.dispose();
      faceTex = tex;
      if (cardMats) { cardMats.face.map = tex; cardMats.face.needsUpdate = true; requestRender(); }
    });
  }
  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    clearTimeout(handoffTimer); clearTimeout(floatTimer);
    for (const t of beatTimers) clearTimeout(t);
    pack?.geometry.dispose();
    deformer?.ribbonGeo.dispose();
    mats?.all.forEach((m) => m.dispose());
    cardMats?.all.forEach((m) => m.dispose());
    deckMesh?.geometry.dispose(); topCard?.geometry.dispose();
    burstGeo?.dispose(); burstMats?.all.forEach((m) => m.dispose());
    faceTex?.dispose(); // (the atlas + surface maps belong to the shared asset)
    core?.material.map.dispose(); core?.material.dispose();
    seam?.dispose();
    env.dispose();
    renderer.dispose();
    mountEl.innerHTML = "";
  }

  // ---- developer panel (?packdebug): scrub the tear, pick the route, turn the pack --
  let debugPanel = null;
  if (debug) {
    const el = document.createElement("div");
    el.className = "pack3d-debug";
    el.innerHTML = `
      <label>route <select name="mode"><option value="front">front (top strip)</option><option value="back">back (pull → pop)</option></select></label>
      <label>progress <input name="p" type="range" min="0" max="1" step="0.001" value="0" title="front: torn length · back: strain (1 = the pop)"><output>0%</output></label>
      <label>yaw <input name="yaw" type="range" min="-3.2" max="3.2" step="0.01" value="0.34"></label>
      <label>pitch <input name="pitch" type="range" min="-0.6" max="0.6" step="0.01" value="-0.07"></label>
      <button type="button" name="auto">auto open</button>
      <button type="button" name="reset">reset</button>
      <pre class="pack3d-stats"></pre>`;
    mountEl.appendChild(el);
    const q = (n) => el.querySelector(`[name="${n}"]`);
    const out = el.querySelector("output"), stats = el.querySelector(".pack3d-stats");
    q("mode").addEventListener("change", () => { ctl.reset(); ctl.setMode(q("mode").value); q("p").value = 0; out.value = "0%"; deformer.reset(); requestRender(); });
    q("p").addEventListener("input", () => {
      const p = Number(q("p").value);
      out.value = `${Math.round(p * 100)}%`;
      ctl.scrub(p, p > P_NOTCH ? (ctl.state.mode === "front" ? { x: -pack.dims.aT + p * 2 * pack.dims.aT, y: pack.dims.yT0 + 0.012 } : { x: 0.004, y: pack.dims.ySeal - 0.004 - p * PULL_LIMIT }) : null);
      // scrubbing shows the trapped light at that point of the tear (front) / the pull (back)
      const back = ctl.state.mode === "back";
      light.phase = p > P_NOTCH ? (back ? "antic" : "tear") : "idle";
      light.seamT = p > P_NOTCH ? (back ? 0.45 + 0.55 * p : 1) : 0;
      light.innerT = p > P_NOTCH ? (back ? 0.1 + 0.6 * p * p : 0.3 + 0.7 * p) : 0;
      light.roomT = p > P_NOTCH ? 1 : 0;
      requestRender();
    });
    q("yaw").addEventListener("input", () => { pose.yawT = Number(q("yaw").value); requestRender(); });
    q("pitch").addEventListener("input", () => { pose.pitchT = Number(q("pitch").value); requestRender(); });
    q("auto").addEventListener("click", () => { ctl.auto(q("mode").value); requestRender(); });
    q("reset").addEventListener("click", () => { reset(); q("p").value = 0; out.value = "0%"; q("yaw").value = 0.34; pose.yawT = 0.34; pose.pitchT = -0.07; });
    debugPanel = {
      stats() {
        const r = renderer.info.render;
        stats.textContent = `tier ${cfg.quality} · wrapper ${pack.stats.triangles} tris · pass ${r.triangles} tris / ${r.calls} calls · phase ${ctl.state.phase} · p ${ctl.state.p.toFixed(3)} · ${facing()} · light ${light.phase} ${light.inner.toFixed(2)}`;
      },
    };
  }

  const api = {
    reset, setArmed, setTell, setCards, getHandoffRect, getHandoffPose, present, dispose, ready,
    // for tests + tooling
    get state() { return ctl?.state; },
    get controller() { return ctl; },
    get pack() { return pack; },
    get deformer() { return deformer; },
    get stack() { return stack; },
    get burst() { return burst; },
    get burstCards() { return burstCards; },
    get materials() { return mats; },
    get pose() { return pose; },
    get light() { return light; },
    get seam() { return seam; },
    room,
    flip, requestRender,
    auto: (m) => { if (built) { ctl.auto(m || facing()); requestRender(); } },
    facing,
    renderer, scene, camera,
    kind: "3d",
  };
  if (debug || new URLSearchParams(location.search).has("packdebug")) window.__pack3d = api;
  return api;
}

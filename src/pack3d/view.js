// pack3d/view.js — PackView: lifecycle, interaction, feedback, render scheduling.
//
// The procedural foil pack (three.js) that replaces the flat SVG tear-pack in the
// open flow. Same host contract as pack.js — createPack3D({ mountEl, onOpen,
// onGrab }) → { reset, setArmed, setTell, setCards, getHandoffRect, present } —
// so the carousel hands off to it and the DOM card reveal takes over after it.
//
// Two rip methods, one state machine (controller.js):
//   FRONT — pinch the notch at the upper-left corner and drag across the top:
//           the sealed header strip tears off around the pack and lifts away.
//   BACK  — flip the pack (tap, or drag to turn it), pinch the rear fin seam
//           and PULL: nothing tears — the pack strains harder the further you
//           haul (it bulges, creases, trembles, the seam gapes), until the seal
//           gives all at once and the whole back pops open; the cards leap out
//           toward you and turn face-up.
//
// Rendering is on demand: the loop runs only while something moves (a drag, the
// strip settling, a pose spring, the open beats) and stops once settled.

import * as THREE from "three";
import { makeConfig, pickQuality } from "./config.js";
import { buildCardStack } from "./geometry.js";
import { makeEdgeTexture, makeGlowTexture, makeRaysTexture } from "./textures.js";
import { getPackAsset } from "./asset.js";
import { makeMaterials, makeCardMaterials } from "./materials.js";
import { buildEnvironment, addLights, fitDistance } from "./lighting.js";
import { createDeformer } from "./deformer.js";
import { createController, P_NOTCH, PULL_LIMIT } from "./controller.js";
import { createParticles } from "../particles.js";
import { TIER_HEX } from "../rarity.js";
import * as sfx from "../sfx.js";

const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const REST_YAW = 0.34; // ~19.5°: a slight three-quarter view, the notch corner toward the lens
const REST_PITCH = -0.07; // the top edge tilts a touch toward the lens
// foil flecks: the pouch's own black foil + its gold (champagne → gold → bronze), with a white-hot glint
const FOIL = ["#fff3c4", "#d4a63a", "#b8862b", "#ffffff", "#2a2016", "#80521c"];
const TORE_KEY = "openpack.toreOnce";
let toredSession = false;
const hasToredBefore = () => { if (toredSession) return true; try { return localStorage.getItem(TORE_KEY) === "1"; } catch { return false; } };
const markTored = () => { toredSession = true; try { localStorage.setItem(TORE_KEY, "1"); } catch { /* private mode */ } };

export function createPack3D({ mountEl, onOpen, onGrab, config = {}, debug = false }) {
  let cfg = makeConfig({ quality: pickQuality(), ...config }); // replaced by the shared asset's once loaded
  const T = cfg.tier;
  mountEl.innerHTML = `
    <div class="pack3d-wrap">
      <div class="pack-glow" aria-hidden="true"></div>
      <canvas class="pack3d-canvas" aria-label="Sealed pack — grab the corner and tear it open"></canvas>
      <div class="pack3d-ui">
        <button type="button" class="pack3d-btn pack3d-flip" aria-label="Flip the pack over">Flip</button>
        <button type="button" class="pack3d-btn pack3d-open">Open pack</button>
      </div>
      <p class="pack3d-cue" aria-live="polite"></p>
      <span class="pack3d-notch" aria-hidden="true"></span>
    </div>
    <canvas class="pack-fx"></canvas>`;
  const wrap = mountEl.querySelector(".pack3d-wrap");
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
  addLights(scene);

  // ---- state ------------------------------------------------------------------
  let pack = null, deformer = null, ctl = null, mats = null, cardMats = null, wrapper = null;
  let stack = null, topCard = null, deckMesh = null, bloom = null, rays = null;
  let surface = null, atlasTex = null, faceTex = null;
  let armed = false, opened = false, built = false, disposed = false;
  let tellTier = 0;
  let packPx = { w: 0, h: 0 };
  const pose = { yaw: 0, pitch: 0, yawT: 0, pitchT: 0, yawV: 0, pitchV: 0 };
  let frozen = false; // pose locked during a tear
  let fly = null; // the detached cap's flight (front)
  let stackAnim = null; // the stack emerging + turning face-up (back)
  let glowAnim = null; // the opening light beat
  let handoffTimer = 0, settleTimer = 0;
  const openSpring = { v: 0, t: 0, k: 60, c: 10 }; // the mouth
  const flapSpring = { v: 0, t: 0, k: 190, c: 14 }; // the back's doors: fast, with an overshoot — the pop
  // the back pull's rigid feel: the pack is hauled a little toward the hand (held back
  // elastically, so it boings on release and recoils on the pop), leans with the pull,
  // and trembles harder the closer the seal is to giving
  const follow = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tx: 0, ty: 0, tz: 0 };
  const lean = { pitch: 0, roll: 0, vp: 0, vr: 0, tp: 0, tr: 0 };
  const shake = { x: 0, y: 0, z: 0, rx: 0, rz: 0, until: 0 };
  let strainTick = 0; // the last strain level that ticked the haptics
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

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
    surface = { normalMap: asset.normalMap, ormMap: asset.ormMap, whenReady: asset.surfaceReady };
    mats = makeMaterials({ map: atlasTex, normalMap: surface.normalMap, ormMap: surface.ormMap });
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
    cardMats = makeCardMaterials({ cardBack: cb, edge: makeEdgeTexture() });
    const cs = buildCardStack(cfg);
    stack = new THREE.Group();
    deckMesh = new THREE.Mesh(cs.deck, [cardMats.deckTop, cardMats.back, cardMats.rim]);
    deckMesh.position.z = -cs.topDepth / 2;
    topCard = new THREE.Mesh(cs.top, [cardMats.face, cardMats.back, cardMats.rim]);
    topCard.position.z = cs.deckDepth / 2 + 0.00005;
    stack.add(deckMesh, topCard);
    packGroup.add(stack);
    if (faceTex) { cardMats.face.map = faceTex; cardMats.face.needsUpdate = true; }

    // the opening light: additive sprites at the mouth, off until the open
    const spriteMat = (tex) => new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, opacity: 0, toneMapped: false });
    bloom = new THREE.Sprite(spriteMat(makeGlowTexture()));
    rays = new THREE.Sprite(spriteMat(makeRaysTexture()));
    bloom.renderOrder = 60; rays.renderOrder = 61;
    bloom.visible = rays.visible = false;
    packGroup.add(bloom, rays);

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
    const { a0, b0, yT0, ySeal } = pack.dims;
    const big = Math.max(26, packPx.w * 0.1); // ≥ a 44 px target
    const face = facing();
    if (face === "front") {
      const notch = screenOf({ x: -a0 + 0.003, y: yT0 + 0.003, z: b0 });
      const l = localOn(e, b0);
      if (Math.hypot(e.clientX - notch.x, e.clientY - notch.y) <= big) return "front";
      if (l && l.y > yT0 - 0.006 && l.y < pack.dims.yTop + 0.004 && l.x < -a0 + 0.03) return "front";
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
  function onEvent(type, d) {
    switch (type) {
      case "grip":
      case "resume":
        frozen = true;
        wrap.classList.add("tearing");
        wrap.classList.remove("guide", "settled");
        sceneFx?.classList.add("paused");
        sfx.grab();
        strainTick = 0;
        onGrab?.();
        updateCue();
        break;
      case "strainStart":
        // the slack is taken up: the seam starts to creak
        sfx.strainStart?.(tellTier);
        if (navigator.vibrate) navigator.vibrate(6);
        break;
      case "strain": {
        // the power builds: the creak rises with it, the haptics ratchet harder
        sfx.strain?.(d.s, d.vel);
        if (d.s - strainTick >= 0.08) { strainTick = d.s; if (navigator.vibrate) navigator.vibrate(Math.round(4 + d.s * 12)); }
        else if (d.s < strainTick - 0.1) strainTick = d.s; // slackened: ratchet again on the way back up
        break;
      }
      case "break": {
        sfx.tearStart(tellTier);
        if (navigator.vibrate) navigator.vibrate(9);
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
        if (d.buzz && navigator.vibrate) navigator.vibrate(5);
        break;
      }
      case "pause":
        frozen = false;
        wrap.classList.remove("tearing");
        sceneFx?.classList.remove("paused");
        if (d.slack) { if (d.tearing) sfx.strainEnd?.(false); }
        else if (d.tearing) sfx.tearEnd(false);
        follow.tx = follow.ty = follow.tz = 0;
        lean.tp = lean.tr = 0;
        updateCue();
        break;
      case "complete":
        completeSequence(d);
        break;
    }
  }

  // ---- the open ----------------------------------------------------------------------------
  function completeSequence({ power, mode }) {
    if (opened) return;
    opened = true;
    markTored();
    frozen = true;
    wrap.classList.add("opening");
    wrap.classList.remove("tearing", "settled");
    cueEl.textContent = "";
    if (mode === "front") sfx.tearEnd(true, power);
    else { sfx.strainEnd?.(true); sfx.pop?.(power); }
    sfx.burst(power, tellTier);
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
      startGlow({ x: 0, y: pack.dims.yT0 + 0.002, z: pack.dims.b0 + 0.004 }, 0);
    } else {
      // THE POP: the seal lets go all at once — both doors blow open (the fast spring
      // overshoots), the hauled pack recoils away from the hand, the strain rings
      // back through zero (controller), and the cards LEAP out of the back
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
      stackAnim = { t: 0, dur: REDUCED ? 0.34 : 0.64, delay: 0.03, q0: new THREE.Quaternion(), started: false, power };
      // the cards leap out IN FRONT of the opening light (it's the backdrop they pop
      // out of, not a glare over them): draw them after the additive sprites
      for (const m of cardMats.all) { m.transparent = true; m.needsUpdate = true; }
      stack.traverse((o) => { o.renderOrder = 70; });
      startGlow({ x: 0, y: 0.012, z: -pack.dims.b0 - 0.006 }, 0.04);
    }
    // exit: the spent body drops away (px, so iOS animates it)
    const reach = Math.max(window.innerWidth, window.innerHeight) * 1.3;
    mountEl.style.setProperty("--exit-x", "0px");
    mountEl.style.setProperty("--exit-y", Math.round(reach) + "px");
    mountEl.style.setProperty("--exit-rot", "0deg");
    requestRender();
  }

  // The opening light: shoots out, HOLDS and breathes (two surges), then fades —
  // the "what's in here?!" window before the cards. Longer for a chase. Only when
  // it has fully faded does the body drop (gated on the fade, with a safety net).
  function startGlow(local, delay) {
    const holdMs = REDUCED ? 420 : 760 + tellTier * 70;
    const dropBeat = 150;
    bloom.position.set(local.x, local.y, local.z);
    rays.position.set(local.x, local.y, local.z);
    bloom.visible = rays.visible = true;
    glowAnim = { t: -delay, hold: holdMs / 1000, done: false };
    const total = delay * 1000 + holdMs + dropBeat;
    clearTimeout(handoffTimer);
    handoffTimer = setTimeout(handOff, total + 60);
  }
  let handedOff = false;
  function handOff() {
    if (handedOff) return;
    handedOff = true;
    bloom.visible = rays.visible = false;
    if (stack) stack.visible = false; // the DOM stack behind the canvas takes over, in place
    ctl.reveal();
    onOpen?.();
    requestRender();
  }
  function stepGlow(dt) {
    if (!glowAnim) return;
    glowAnim.t += dt;
    const t = glowAnim.t;
    if (t < 0) return;
    const u = Math.min(1, t / glowAnim.hold);
    // surge → ease back → swell again → out
    const env = u < 0.16 ? u / 0.16 : u < 0.46 ? 1 - 0.24 * ((u - 0.16) / 0.3) : u < 0.7 ? 0.76 + 0.24 * ((u - 0.46) / 0.24) : 1 - (u - 0.7) / 0.3;
    const grow = Math.min(1, t / 0.25);
    bloom.material.opacity = 0.95 * Math.max(0, env);
    rays.material.opacity = 0.9 * Math.max(0, env);
    bloom.scale.setScalar(0.05 + 0.13 * grow);
    rays.scale.setScalar(0.12 + 0.34 * grow);
    rays.material.rotation += dt * 0.25;
    if (u >= 1) { glowAnim = null; bloom.visible = rays.visible = false; }
  }

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
  function stepStack(dt) {
    if (!stackAnim) return;
    const a = stackAnim;
    a.t += dt;
    if (a.t < a.delay) return;
    if (!a.started) {
      a.started = true;
      scene.attach(stack); // animate in world space: the DOM card is world-aligned
      a.q0.copy(stack.quaternion);
      a.p0 = stack.position.clone();
      a.topZ = topCard ? topCard.position.z : 0;
    }
    const u = Math.min(1, (a.t - a.delay) / a.dur);
    // the leap: fast off the mark, a high arc up and out toward the lens, then it
    // settles into the DOM card's place; the turn to face-up overshoots a touch
    const e = 1 - Math.pow(1 - u, 3);
    const c1 = 1.25, c3 = c1 + 1;
    const eb = 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); // ease-out-back
    stack.quaternion.slerpQuaternions(a.q0, _q.identity(), Math.min(1.08, eb));
    const arc = Math.sin(Math.PI * Math.pow(u, 0.82)); // up quickly, down slower
    const h = REDUCED ? 0.012 : 0.024 + (a.power || 0.7) * 0.012;
    stack.position.set(a.p0.x * (1 - e), a.p0.y * (1 - e) + h * arc, a.p0.z * (1 - e) + (REDUCED ? 0.026 : 0.05) * arc);
    // the top card lifts off the deck at the peak — they're cards, not a slab
    if (topCard) { topCard.position.z = a.topZ + 0.006 * arc; topCard.rotation.x = -0.16 * arc; }
    if (u >= 1) { stackAnim = null; if (topCard) { topCard.position.z = a.topZ; topCard.rotation.x = 0; } }
  }
  function stepSprings(dt) {
    const sp = (s, k, c) => { const a = (s.t - s.x) * k - s.v * c; s.v += a * dt; s.x += s.v * dt; };
    for (const s of [openSpring, flapSpring]) { if (s.x === undefined) s.x = 0; sp(s, s.k, s.c); }
    ctl.state.open = openSpring.x;
    ctl.state.flapOpen = flapSpring.x;
    // the back pull's rigid feel
    const st = ctl.state;
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

  // a brief, decaying screen-kick on the burst (skipped under reduced motion)
  function kick(power) {
    if (REDUCED || !mountEl.animate) return;
    const amp = 5 + power * 9;
    const frames = [{ transform: `translate(0px, 0px) scale(${(1 + 0.05 * power).toFixed(3)})` }];
    for (let i = 1; i <= 7; i++) {
      const decay = 1 - i / 7;
      frames.push({ transform: `translate(${((Math.random() * 2 - 1) * amp * decay).toFixed(1)}px, ${((Math.random() * 2 - 1) * amp * decay).toFixed(1)}px) scale(1)` });
    }
    frames.push({ transform: "translate(0px, 0px) scale(1)" });
    mountEl.animate(frames, { duration: 260 + power * 80, easing: "ease-out", fill: "none" });
  }
  function burstAlongRoute(mode) {
    const { a0, b0, yT0, ySeal } = pack.dims;
    for (let k = 0; k <= 12; k++) {
      const u = k / 12;
      const l = mode === "front" ? { x: -a0 + u * 2 * a0, y: yT0, z: b0 } : { x: 0, y: ySeal - u * 2 * ySeal, z: -b0 };
      const s = screenOf(l);
      particles.emit(s.x, s.y, { count: 3, speed: 4.5, colors: FOIL, life: 50, size: 2.6, shape: "chip" });
      particles.emit(s.x, s.y, { count: 1, speed: 5.5, colors: ["#fff", "#ffe7b0"], life: 30, size: 1.6 });
    }
  }

  // ---- the loop (on demand) ----------------------------------------------------------
  let raf = 0, lastT = 0;
  function requestRender() { if (!raf && !disposed) raf = requestAnimationFrame(frame); }
  function needsLoop() {
    if (!built) return false;
    const st = ctl.state;
    if (drag || st.auto || fly || stackAnim || glowAnim) return true;
    if (st.phase === "gripping" || st.phase === "tearing") return true;
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
      stepStack(dt);
      stepGlow(dt);
      deformer.evaluate(ctl.state, dt);
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
    const { a0, b0, yT0, ySeal } = pack.dims;
    const s = facing() === "front"
      ? screenOf({ x: -a0 + 0.003, y: yT0 + 0.0035, z: b0 })
      : screenOf({ x: 0.0015, y: ySeal - 0.004, z: -b0 });
    const r = mountEl.getBoundingClientRect();
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
    if (bloom) {
      const c = new THREE.Color(hex);
      bloom.material.color.copy(c).lerp(new THREE.Color(0xffe9a8), 0.55);
      rays.material.color.copy(c).lerp(new THREE.Color(0xffd98a), 0.7);
    }
  }

  // ---- public API ------------------------------------------------------------------------
  function reset() {
    if (!built) return;
    opened = false; handedOff = false; frozen = false;
    fly = null; stackAnim = null; glowAnim = null;
    clearTimeout(handoffTimer); clearTimeout(settleTimer);
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
    for (const m of cardMats.all) { if (m.transparent) { m.transparent = false; m.needsUpdate = true; } }
    stack.traverse((o) => { o.renderOrder = 0; });
    bloom.visible = rays.visible = false;
    pose.yaw = pose.yawT = 0; pose.pitch = pose.pitchT = 0; pose.yawV = pose.pitchV = 0;
    packGroup.rotation.set(0, 0, 0);
    ctl.reset();
    deformer.reset();
    deformer.evaluate(ctl.state, 0);
    wrap.classList.remove("opening", "tearing", "settled", "back");
    updateCue();
    requestRender();
  }
  // the pack has just been revealed under the landed carousel hero: let it settle
  // from the face-on handoff pose into the three-quarter view, then float
  function present() {
    if (!built || opened) return;
    pose.yawT = REST_YAW;
    pose.pitchT = REST_PITCH;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { if (!opened && !frozen) wrap.classList.add("settled"); }, 900);
    updateCue();
    requestRender();
  }
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
    clearTimeout(handoffTimer); clearTimeout(settleTimer);
    pack?.geometry.dispose();
    deformer?.ribbonGeo.dispose();
    mats?.all.forEach((m) => m.dispose());
    cardMats?.all.forEach((m) => m.dispose());
    deckMesh?.geometry.dispose(); topCard?.geometry.dispose();
    faceTex?.dispose(); // (the atlas + surface maps belong to the shared asset)
    bloom?.material.map.dispose(); bloom?.material.dispose(); rays?.material.map.dispose(); rays?.material.dispose();
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
      ctl.scrub(p, p > P_NOTCH ? (ctl.state.mode === "front" ? { x: -pack.dims.a0 + p * pack.dims.W, y: pack.dims.yT0 + 0.012 } : { x: 0.004, y: pack.dims.ySeal - 0.004 - p * PULL_LIMIT }) : null);
      requestRender();
    });
    q("yaw").addEventListener("input", () => { pose.yawT = Number(q("yaw").value); requestRender(); });
    q("pitch").addEventListener("input", () => { pose.pitchT = Number(q("pitch").value); requestRender(); });
    q("auto").addEventListener("click", () => { ctl.auto(q("mode").value); requestRender(); });
    q("reset").addEventListener("click", () => { reset(); q("p").value = 0; out.value = "0%"; q("yaw").value = 0.34; pose.yawT = 0.34; pose.pitchT = -0.07; });
    debugPanel = {
      stats() {
        const r = renderer.info.render;
        stats.textContent = `tier ${cfg.quality} · wrapper ${pack.stats.triangles} tris · pass ${r.triangles} tris / ${r.calls} calls · phase ${ctl.state.phase} · p ${ctl.state.p.toFixed(3)} · ${facing()}`;
      },
    };
  }

  const api = {
    reset, setArmed, setTell, setCards, getHandoffRect, present, dispose, ready,
    // for tests + tooling
    get state() { return ctl?.state; },
    get controller() { return ctl; },
    get pack() { return pack; },
    get deformer() { return deformer; },
    get stack() { return stack; },
    get materials() { return mats; },
    get pose() { return pose; },
    flip, requestRender,
    auto: (m) => { if (built) { ctl.auto(m || facing()); requestRender(); } },
    facing,
    renderer, scene, camera,
    kind: "3d",
  };
  if (debug || new URLSearchParams(location.search).has("packdebug")) window.__pack3d = api;
  return api;
}

// pack3d/controller.js — TearController: states, monotonic progress, completion.
//
//   Ready → Gripping → Tearing ⇄ Paused → Detached → Revealed
//
// Progress `p` (0–1 along the prepared route) records permanently opened
// material and is MONOTONIC during a real opening: reversing the hand slackens
// the strip (pull) but never closes the tear. Grip position, pull amount and
// pull velocity are tracked separately. Progress is based on displacement in
// pack-local metres, never on frame count; each re-grip saves p and resets the
// local drag origin so resuming never jumps. A developer scrubber (`scrub`) may
// set p directly for inspection; production input goes through grip*().
//
// Two routes share the machine:
//   front — the notch at the upper-left corner, left → right across the top: a
//           TEAR. Progress is the torn length.
//   back  — the rear fin seam: a PULL. Nothing tears: the hand hauls on the seam
//           and the pack STRAINS — `strain` (0–1) is how hard, from how far the
//           hand has pulled from where it gripped. Let go early and the seam
//           relaxes (elastic, no memory). Reach the limit and the seal lets go
//           all at once — "pong" — the whole back pops open (`complete`), and
//           the strain RINGS down through zero (the recoil) instead of easing.

export const P_NOTCH = 0.012; // the pre-cut notch: the tear's starting point
export const PULL_LIMIT = 0.056; // metres of hand pull that pops the back (≈ half the pack's height)
const BREAK_DIST = 0.0035; // metres of initial pull before the first break / before the pull takes up its slack
const COMPLETE_AT = 0.985;

export function createController({ dims, reduced = false, emit = () => {} }) {
  const { W, ySeal, yT0 } = dims;
  const routeLen = { front: W, back: 2 * ySeal };

  const state = {
    mode: "front",
    phase: "ready",
    p: P_NOTCH,
    grip: null, // pack-local {x, y} on the active face while gripping
    pull: 0, // 0–1, how far the hand is pulling the released material away (front)
    pullVel: 0, // m/s
    press: 0, // local press at the tip (1 while gripping, eases out)
    open: 0, // mouth opening after detach (front)
    flapOpen: 0, // flaps swinging fully open after detach (back)
    capMatrix: null, // rigid transform of the detached cap (front)
    // the back pull
    strain: 0, // eased 0–1 while pulling; after the pop it rings (negative = the recoil's inward swing)
    strainT: 0, // the hand's target strain (distance over the limit)
    pullX: 0, pullY: 0, // the hand's pull vector from the grip origin, pack-local metres (0 when not gripping)
    peak: 0, // the strain at the instant of the pop
    ringing: false,
    auto: null,
  };

  let origin = null; // the grip origin {x, y}
  let p0 = 0;
  let broke = false; // has the first break happened in this grip?
  let last = null; // last grip point + time for velocity
  let pullTarget = 0;
  let sinceBuzz = 0;
  let ring = null; // the post-pop recoil: { t, amp }

  function setMode(m) {
    if (state.phase !== "ready") return false;
    state.mode = m;
    return true;
  }

  function gripStart(local, t = performance.now()) {
    if (state.phase === "detached" || state.phase === "revealed") return false;
    const resuming = state.phase === "paused";
    state.phase = "gripping";
    state.grip = { x: local.x, y: local.y };
    origin = { x: local.x, y: local.y };
    p0 = state.p;
    broke = resuming; // a paused tear resumes without a new break
    last = { x: local.x, y: local.y, t };
    state.press = 1;
    emit(resuming ? "resume" : "grip", { p: state.p });
    return true;
  }

  function gripMove(local, t = performance.now()) {
    if (state.phase !== "gripping" && state.phase !== "tearing") return;
    state.grip.x = local.x; state.grip.y = local.y;
    const dt = Math.max(1, t - (last?.t ?? t)) / 1000;
    const vx = (local.x - (last?.x ?? local.x)) / dt, vy = (local.y - (last?.y ?? local.y)) / dt;
    state.pullVel = Math.min(1.2, Math.hypot(vx, vy));
    last = { x: local.x, y: local.y, t };
    if (state.mode === "back") { pullMove(local); return; }
    const L = routeLen.front;
    // route displacement from the origin (+x across the top)
    const along = local.x - origin.x;
    const across = Math.max(0, local.y - yT0);
    if (!broke) {
      const moved = Math.hypot(local.x - origin.x, local.y - origin.y);
      if (moved < BREAK_DIST) return;
      broke = true;
      origin = { x: local.x, y: local.y }; // the break resets the drag origin: no jump
      p0 = state.p;
      state.phase = "tearing";
      emit("break", { p: state.p });
      return;
    }
    if (state.phase === "gripping") state.phase = "tearing";
    const target = Math.max(state.p, Math.min(1, p0 + along / L));
    const dp = target - state.p;
    if (dp > 0) {
      state.p = target;
      sinceBuzz += dp * L;
      const buzz = sinceBuzz >= 0.0028;
      if (buzz) sinceBuzz = 0;
      emit("progress", { p: state.p, dp, vel: state.pullVel, buzz });
    }
    pullTarget = Math.min(1, across / 0.028);
    if (state.p >= COMPLETE_AT) complete();
  }

  // the back PULL: the hand's distance from where it gripped is the power. Any
  // direction counts (the deformer stretches the pack toward the hand); the first
  // few millimetres only take up the slack. Reaching the limit pops the pack.
  function pullMove(local) {
    const dx = local.x - origin.x, dy = local.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (state.phase === "gripping") {
      if (d < BREAK_DIST) return;
      state.phase = "tearing";
      emit("strainStart", {});
    }
    state.pullX = dx; state.pullY = dy;
    const prev = state.strainT;
    state.strainT = Math.min(1, d / PULL_LIMIT);
    emit("strain", { s: state.strainT, ds: state.strainT - prev, vel: state.pullVel });
    if (state.strainT >= 1) complete();
  }

  function gripEnd() {
    if (state.phase !== "gripping" && state.phase !== "tearing") return;
    const wasTearing = state.phase === "tearing";
    state.grip = null;
    if (state.mode === "back") {
      // nothing tore: the seam slackens back to rest (elastic — no memory)
      state.phase = "ready";
      state.strainT = 0;
      state.pullX = 0; state.pullY = 0;
      emit("pause", { p: state.p, tearing: wasTearing, slack: true });
      return;
    }
    state.phase = state.p > P_NOTCH + 1e-4 ? "paused" : "ready";
    pullTarget = 0;
    emit("pause", { p: state.p, tearing: wasTearing });
  }

  function complete() {
    if (state.phase === "detached" || state.phase === "revealed") return;
    state.p = 1;
    const power = state.mode === "back"
      ? Math.min(1, 0.55 + state.pullVel / 0.9)
      : Math.min(1, 0.6 + state.pullVel / 1.0);
    state.phase = "detached";
    state.grip = null;
    pullTarget = 0;
    if (state.mode === "back") {
      // the pop: the strain stops easing and RINGS down from where it was
      state.peak = Math.max(0.55, state.strain);
      state.strainT = 0;
      state.pullX = 0; state.pullY = 0;
      ring = { t: 0, amp: state.peak };
      state.ringing = true;
    }
    emit("complete", { power, mode: state.mode });
  }
  function reveal() {
    if (state.phase === "revealed") return;
    state.phase = "revealed";
    emit("reveal", {});
  }

  // frame-rate-independent easing of the secondary quantities
  function update(dt) {
    const k = 1 - Math.exp(-dt * 14);
    state.pull += (pullTarget - state.pull) * k;
    if (!state.grip) state.press += (0 - state.press) * (1 - Math.exp(-dt * 10));
    state.pullVel *= Math.exp(-dt * 6);
    if (ring) {
      // the recoil: a damped ring through zero (the pack sucks in, then puffs
      // out again, smaller each time) — "pong"
      ring.t += dt;
      const env = Math.exp(-ring.t * 6.5);
      state.strain = ring.amp * env * Math.cos(2 * Math.PI * 6 * ring.t);
      if (env < 0.012) { ring = null; state.strain = 0; state.ringing = false; }
    } else {
      // the strain BUILDS with a lag (the pack resists) and relaxes faster when let go
      const ks = 1 - Math.exp(-dt * (state.strainT > state.strain ? 9 : 15));
      state.strain += (state.strainT - state.strain) * ks;
      if (Math.abs(state.strain - state.strainT) < 0.0005) state.strain = state.strainT;
    }
    if (state.auto) stepAuto(dt);
  }

  // ---- scripted opening (the Open pack button / keyboard) ----------------
  function auto(mode = state.mode) {
    if (state.phase === "detached" || state.phase === "revealed" || state.auto) return;
    if (state.phase === "ready") setMode(mode);
    const dur = reduced ? 0.9 : 1.55;
    state.auto = { t: 0, dur, started: false };
  }
  function autoPoint(u) {
    // a hand path: front = across the top with a lift; back = a hard pull down
    // the seam, past the limit, wandering a little as it strains
    if (state.mode === "front") {
      const x = -W / 2 + 0.002 + u * (W - 0.004);
      const y = yT0 + 0.004 + 0.014 * Math.sin(u * Math.PI);
      return { x, y };
    }
    return { x: 0.002 + 0.005 * Math.sin(u * 4.2), y: ySeal - 0.004 - u * PULL_LIMIT * 1.08 };
  }
  function stepAuto(dt) {
    const a = state.auto;
    const t0 = performance.now();
    if (!a.started) {
      a.started = true;
      gripStart(autoPoint(0), t0);
      // the initial pull that breaks the notch (front) / takes up the slack (back)
      const o = autoPoint(0);
      gripMove(state.mode === "front" ? { x: o.x, y: o.y + 0.005 } : { x: o.x, y: o.y - 0.005 }, t0 + 1);
      return;
    }
    a.t += dt;
    const u = Math.min(1, a.t / a.dur);
    // the front tear eases in and out; the pull builds — slow to start, then hauls
    const e = state.mode === "front"
      ? (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2)
      : u * u * (1.6 - 0.6 * u);
    const pt = autoPoint(e);
    gripMove(pt, t0);
    if (u >= 1) { state.auto = null; if (state.phase !== "detached" && state.phase !== "revealed") complete(); }
  }

  // developer scrubber: force progress (may reverse — inspection only). On the
  // back route it scrubs the STRAIN (1 = the pop).
  function scrub(p, grip = null) {
    state.auto = null;
    ring = null; state.ringing = false;
    const v = Math.max(0, Math.min(1, p));
    if (state.mode === "back") {
      state.strain = state.strainT = v >= 1 ? 0 : v;
      state.p = v >= 1 ? 1 : P_NOTCH;
      state.phase = v >= 1 ? "detached" : "ready";
      state.peak = v >= 1 ? 0.9 : 0;
      state.pullX = grip ? grip.x : 0; state.pullY = grip ? grip.y - (ySeal - 0.004) : 0;
      if (v >= 1) { state.pullX = 0; state.pullY = 0; }
      state.grip = v >= 1 ? null : grip;
      return;
    }
    state.p = v;
    state.phase = state.p >= 1 ? "detached" : state.p > P_NOTCH ? "paused" : "ready";
    state.grip = grip;
  }

  function reset() {
    state.phase = "ready";
    state.p = P_NOTCH;
    state.grip = null;
    state.pull = 0; state.pullVel = 0; state.press = 0; state.open = 0; state.flapOpen = 0;
    state.capMatrix = null;
    state.strain = 0; state.strainT = 0; state.pullX = 0; state.pullY = 0; state.peak = 0; state.ringing = false;
    state.auto = null;
    origin = null; p0 = 0; broke = false; last = null; pullTarget = 0; sinceBuzz = 0; ring = null;
  }

  return { state, setMode, gripStart, gripMove, gripEnd, complete, reveal, update, auto, scrub, reset };
}

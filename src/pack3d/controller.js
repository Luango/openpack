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
//   front — the notch at the upper-left corner, left → right across the top
//   back  — the top of the rear fin seam, top → bottom down the back

export const P_NOTCH = 0.012; // the pre-cut notch: the tear's starting point
const BREAK_DIST = 0.0035; // metres of initial pull before the first break
const COMPLETE_AT = 0.985;

export function createController({ dims, reduced = false, emit = () => {} }) {
  const { W, ySeal, yT0 } = dims;
  const routeLen = { front: W, back: 2 * ySeal };

  const state = {
    mode: "front",
    phase: "ready",
    p: P_NOTCH,
    grip: null, // pack-local {x, y} on the active face while gripping
    pull: 0, // 0–1, how far the hand is pulling the released material away
    pullVel: 0, // m/s
    press: 0, // local press at the tip (1 while gripping, eases out)
    open: 0, // mouth opening after detach (front)
    flapOpen: 0, // flaps swinging fully open after detach (back)
    capMatrix: null, // rigid transform of the detached cap (front)
    auto: null,
  };

  let origin = null; // the grip origin {x, y}
  let p0 = 0;
  let broke = false; // has the first break happened in this grip?
  let last = null; // last grip point + time for velocity
  let pullTarget = 0;
  let sinceBuzz = 0;

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
    const L = routeLen[state.mode];
    // route displacement from the origin (front: +x, back: −y)
    const along = state.mode === "front" ? local.x - origin.x : origin.y - local.y;
    const across = state.mode === "front" ? Math.max(0, local.y - yT0) : Math.abs(local.x);
    if (!broke) {
      const moved = Math.hypot(local.x - origin.x, local.y - origin.y);
      // the foil straining before it gives: 0 → 1 over the pull to the first break
      if (moved < BREAK_DIST) { emit("strain", { k: moved / BREAK_DIST }); return; }
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

  function gripEnd() {
    if (state.phase !== "gripping" && state.phase !== "tearing") return;
    const wasTearing = state.phase === "tearing";
    state.grip = null;
    state.phase = state.p > P_NOTCH + 1e-4 ? "paused" : "ready";
    pullTarget = 0;
    emit("pause", { p: state.p, tearing: wasTearing });
  }

  function complete() {
    if (state.phase === "detached" || state.phase === "revealed") return;
    state.p = 1;
    const power = Math.min(1, 0.6 + state.pullVel / 1.0);
    state.phase = "detached";
    state.grip = null;
    pullTarget = 0;
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
    // a hand path along the route: front = across the top with a lift; back = down the fin
    if (state.mode === "front") {
      const x = -W / 2 + 0.002 + u * (W - 0.004);
      const y = yT0 + 0.004 + 0.014 * Math.sin(u * Math.PI);
      return { x, y };
    }
    return { x: 0.004 * Math.sin(u * 6), y: ySeal - 0.003 - u * (2 * ySeal - 0.004) };
  }
  function stepAuto(dt) {
    const a = state.auto;
    const t0 = performance.now();
    if (!a.started) {
      a.started = true;
      gripStart(autoPoint(0), t0);
      // the initial pull that breaks the notch
      gripMove({ ...autoPoint(0), y: autoPoint(0).y + (state.mode === "front" ? 0.005 : 0), x: autoPoint(0).x + (state.mode === "front" ? 0 : 0.005) }, t0 + 1);
      return;
    }
    a.t += dt;
    const u = Math.min(1, a.t / a.dur);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const pt = autoPoint(e);
    gripMove(pt, t0);
    if (u >= 1) { state.auto = null; if (state.phase !== "detached" && state.phase !== "revealed") complete(); }
  }

  // developer scrubber: force progress (may reverse — inspection only)
  function scrub(p, grip = null) {
    state.auto = null;
    state.p = Math.max(0, Math.min(1, p));
    state.phase = state.p >= 1 ? "detached" : state.p > P_NOTCH ? "paused" : "ready";
    state.grip = grip;
  }

  function reset() {
    state.phase = "ready";
    state.p = P_NOTCH;
    state.grip = null;
    state.pull = 0; state.pullVel = 0; state.press = 0; state.open = 0; state.flapOpen = 0;
    state.capMatrix = null;
    state.auto = null;
    origin = null; p0 = 0; broke = false; last = null; pullTarget = 0; sinceBuzz = 0;
  }

  return { state, setMode, gripStart, gripMove, gripEnd, complete, reveal, update, auto, scrub, reset };
}

// motion.js — the shared spring engine behind every gesture-driven motion in
// the app. A set of named scalar quantities each ease toward a target via a
// velocity integrator: vel = (vel + (target - cur) * stiffness) * damping,
// ticked on requestAnimationFrame. The consumer reads the eased values in
// `onTick` and writes its own transforms — the engine knows nothing about cards
// or the DOM, so the lightbox (card tilt/flip/scale) and the pack (tear, stack,
// reveal) can all drive their motion through it with the same feel.
//
//   const s = createSpring({ rest: { x: 0 }, onTick: (c) => el.style.left = c.x + "px" });
//   s.set({ x: 100 });   // animate toward a target
//   s.target.x += 20;    // …or accumulate directly, then s.start()
//   s.cur.x;             // read the current eased value
//   s.reset();           // jump to rest, no animation
//
// `cur` and `target` are stable objects mutated in place, so a held reference
// never goes stale (even on the snap-to-rest at the end of a settle).

export function createSpring({
  rest,
  stiffness = 0.12,
  damping = 0.82,
  stiffnessByKey = {},
  onTick,
}) {
  const keys = Object.keys(rest);
  const cur = { ...rest };
  const target = { ...rest };
  const vel = Object.fromEntries(keys.map((k) => [k, 0]));
  let raf = null;

  function step() {
    let moving = false;
    for (const k of keys) {
      const s = stiffnessByKey[k] ?? stiffness;
      vel[k] = (vel[k] + (target[k] - cur[k]) * s) * damping;
      cur[k] += vel[k];
      if (Math.abs(vel[k]) > 0.02 || Math.abs(target[k] - cur[k]) > 0.02) moving = true;
    }
    if (!moving) {
      for (const k of keys) {
        cur[k] = target[k]; // snap to exact rest
        vel[k] = 0;
      }
    }
    onTick(cur);
    raf = moving ? requestAnimationFrame(step) : null;
  }

  return {
    cur,
    target,
    // kick the loop after mutating `target` directly
    start() {
      if (!raf) raf = requestAnimationFrame(step);
    },
    // nudge one or more targets and animate toward them
    set(targets) {
      Object.assign(target, targets);
      if (!raf) raf = requestAnimationFrame(step);
    },
    // jump straight to values (defaults to rest) with no animation
    reset(values) {
      for (const k of keys) {
        cur[k] = values && k in values ? values[k] : rest[k];
        target[k] = cur[k];
        vel[k] = 0;
      }
      onTick(cur);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    },
  };
}

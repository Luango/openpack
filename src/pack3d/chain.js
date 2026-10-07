// pack3d/chain.js — the station chain that shapes the released header.
//
// A short 1-D chain of K+1 stations is anchored at the moving tear tip (station
// 0, continuous with the still-attached sheet) and ends at the grip handle
// (station K, the pinched corner in the player's fingers). Its arc length is
// the released route length, so the strip can never stretch like rubber: when
// the handle is near the tip the slack arches up and out; when the hand pulls
// away the strip straightens. A few Verlet substeps with distance, bend, tip-
// tangent and pack-collision constraints give slack, lag and flutter from the
// pull velocity without a sheet solver. The header's cross-section is then swept
// along the chain's parallel-transported frames (see deformer.js).

const v3 = () => ({ x: 0, y: 0, z: 0 });

export function createChain(K) {
  const n = K + 1;
  const P = new Float64Array(n * 3);
  const Pp = new Float64Array(n * 3); // previous positions (Verlet)
  const T = new Float64Array(n * 3);
  const U = new Float64Array(n * 3);
  const Nn = new Float64Array(n * 3);
  let seg = 0.001;
  let laid = false;

  const get = (A, i, o) => { o.x = A[i * 3]; o.y = A[i * 3 + 1]; o.z = A[i * 3 + 2]; return o; };
  const set = (A, i, x, y, z) => { A[i * 3] = x; A[i * 3 + 1] = y; A[i * 3 + 2] = z; };

  // lay the stations straight along `dir` from the tip (the strip still in place)
  function lay(tip, dir, L) {
    seg = Math.max(1e-5, L / K);
    for (let i = 0; i < n; i++) {
      const x = tip.x + dir.x * seg * i, y = tip.y + dir.y * seg * i, z = tip.z + dir.z * seg * i;
      set(P, i, x, y, z);
      set(Pp, i, x, y, z);
    }
    laid = true;
  }

  const a = v3(), b = v3(), c = v3();
  // one solve: tip + handle pinned, length L, within the pack proxy `box`
  function solve({ tip, dir, handle, L, dt, box, lift, damping = 0.9, iterations = 7 }) {
    if (!laid) lay(tip, dir, L);
    seg = Math.max(1e-5, L / K);
    const h = Math.min(dt, 1 / 30);
    // Verlet integrate the free stations
    for (let i = 1; i < K; i++) {
      get(P, i, a); get(Pp, i, b);
      const vx = (a.x - b.x) * damping, vy = (a.y - b.y) * damping, vz = (a.z - b.z) * damping;
      set(Pp, i, a.x, a.y, a.z);
      // a gentle outward + upward preference: foil springs away from the pack
      set(P, i, a.x + vx, a.y + vy + lift * 0.35 * h * h, a.z + vz + lift * h * h);
    }
    set(P, 0, tip.x, tip.y, tip.z);
    set(P, K, handle.x, handle.y, handle.z);
    for (let it = 0; it < iterations; it++) {
      // the first segment leaves the tip along the sheet (continuity with the attached part)
      {
        get(P, 1, a);
        const tx = tip.x + dir.x * seg, ty = tip.y + dir.y * seg, tz = tip.z + dir.z * seg;
        const k = 0.45;
        set(P, 1, a.x + (tx - a.x) * k, a.y + (ty - a.y) * k, a.z + (tz - a.z) * k);
      }
      // distance constraints
      for (let i = 0; i < K; i++) {
        get(P, i, a); get(P, i + 1, b);
        let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-9;
        const diff = (d - seg) / d;
        const wa = i === 0 ? 0 : 1, wb = i + 1 === K ? 0 : 1;
        const s = wa + wb || 1;
        dx *= diff; dy *= diff; dz *= diff;
        if (wa) set(P, i, a.x + dx * (wa / s), a.y + dy * (wa / s), a.z + dz * (wa / s));
        if (wb) set(P, i + 1, b.x - dx * (wb / s), b.y - dy * (wb / s), b.z - dz * (wb / s));
      }
      // bend stiffness: pull each free station toward its neighbours' midpoint
      for (let i = 1; i < K; i++) {
        get(P, i - 1, a); get(P, i + 1, b); get(P, i, c);
        const kb = 0.32;
        set(P, i, c.x + ((a.x + b.x) / 2 - c.x) * kb, c.y + ((a.y + b.y) / 2 - c.y) * kb, c.z + ((a.z + b.z) / 2 - c.z) * kb);
      }
      // collision proxy: keep the free stations outside the pack's front face / top
      if (box) {
        for (let i = 1; i < K; i++) {
          get(P, i, a);
          if (Math.abs(a.x) < box.hx && a.y < box.top && a.y > -box.top && a.z < box.front && a.z > -box.front) {
            // push to the nearest face: front (+z) or the top
            const dz = box.front - a.z, dy = box.top - a.y;
            if (dz < dy) set(P, i, a.x, a.y, box.front); else set(P, i, a.x, box.top, a.z);
          }
        }
      }
      set(P, 0, tip.x, tip.y, tip.z);
      set(P, K, handle.x, handle.y, handle.z);
    }
    frames();
  }

  // station frames by parallel transport from the tip's rest frame
  function frames() {
    for (let i = 0; i < n; i++) {
      const j = i < K ? i : K - 1;
      get(P, j, a); get(P, j + 1, b);
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const L = Math.hypot(tx, ty, tz) || 1e-9;
      set(T, i, tx / L, ty / L, tz / L);
    }
    // rest frame at the tip: T0 = (−1,0,0)-ish, U = +y, N = +z — but the chain's
    // actual first tangent may already differ, so transport from the ideal frame.
    let ux = 0, uy = 1, uz = 0, nx = 0, ny = 0, nz = 1;
    let ptx = -1, pty = 0, ptz = 0;
    for (let i = 0; i < n; i++) {
      const tx = T[i * 3], ty = T[i * 3 + 1], tz = T[i * 3 + 2];
      // rotation taking the previous tangent to this one
      const cx = pty * tz - ptz * ty, cy = ptz * tx - ptx * tz, cz = ptx * ty - pty * tx;
      const s = Math.hypot(cx, cy, cz);
      const d = Math.max(-1, Math.min(1, ptx * tx + pty * ty + ptz * tz));
      if (s > 1e-6) {
        const ang = Math.atan2(s, d);
        const ax = cx / s, ay = cy / s, az = cz / s;
        const r = rotate(ux, uy, uz, ax, ay, az, ang); ux = r[0]; uy = r[1]; uz = r[2];
        const q = rotate(nx, ny, nz, ax, ay, az, ang); nx = q[0]; ny = q[1]; nz = q[2];
      }
      // re-orthogonalise against the tangent
      let du = ux * tx + uy * ty + uz * tz;
      ux -= du * tx; uy -= du * ty; uz -= du * tz;
      let lu = Math.hypot(ux, uy, uz) || 1; ux /= lu; uy /= lu; uz /= lu;
      // N = T × U keeps a right-handed frame consistent with rest (T=−x, U=+y → N=+z… check: (−1,0,0)×(0,1,0) = (0,0,−1); so N = U × T)
      nx = uy * tz - uz * ty; ny = uz * tx - ux * tz; nz = ux * ty - uy * tx;
      set(U, i, ux, uy, uz);
      set(Nn, i, nx, ny, nz);
      ptx = tx; pty = ty; ptz = tz;
    }
  }

  function rotate(vx, vy, vz, ax, ay, az, ang) {
    // Rodrigues
    const c = Math.cos(ang), s = Math.sin(ang);
    const d = ax * vx + ay * vy + az * vz;
    const cx = ay * vz - az * vy, cy = az * vx - ax * vz, cz = ax * vy - ay * vx;
    return [vx * c + cx * s + ax * d * (1 - c), vy * c + cy * s + ay * d * (1 - c), vz * c + cz * s + az * d * (1 - c)];
  }

  // interpolated frame at arc distance `dist` from the tip → out {px,py,pz, tx.., ux.., nx..}
  function sample(dist, out) {
    const f = Math.max(0, Math.min(K, dist / seg));
    const i = Math.min(K - 1, Math.floor(f));
    const t = f - i;
    const lerp = (A, k) => A[i * 3 + k] * (1 - t) + A[(i + 1) * 3 + k] * t;
    out.px = lerp(P, 0); out.py = lerp(P, 1); out.pz = lerp(P, 2);
    out.tx = lerp(T, 0); out.ty = lerp(T, 1); out.tz = lerp(T, 2);
    out.ux = lerp(U, 0); out.uy = lerp(U, 1); out.uz = lerp(U, 2);
    out.nx = lerp(Nn, 0); out.ny = lerp(Nn, 1); out.nz = lerp(Nn, 2);
    return out;
  }

  // kinetic energy proxy: are the free stations still moving?
  function motion() {
    let m = 0;
    for (let i = 1; i < K; i++) m = Math.max(m, Math.abs(P[i * 3] - Pp[i * 3]) + Math.abs(P[i * 3 + 1] - Pp[i * 3 + 1]) + Math.abs(P[i * 3 + 2] - Pp[i * 3 + 2]));
    return m;
  }
  // velocity of the handle end (for the detach throw)
  function endVelocity(dt, out) {
    const i = K - 1;
    out.x = (P[i * 3] - Pp[i * 3]) / Math.max(dt, 1e-3);
    out.y = (P[i * 3 + 1] - Pp[i * 3 + 1]) / Math.max(dt, 1e-3);
    out.z = (P[i * 3 + 2] - Pp[i * 3 + 2]) / Math.max(dt, 1e-3);
    return out;
  }

  return { K, lay, solve, sample, motion, endVelocity, reset() { laid = false; }, get seg() { return seg; }, P };
}

// Sound effects, synthesized with Web Audio so there's no audio file to host.
// Browsers gate audio behind a user gesture, so the context is unlocked on the
// first pointerdown/keydown; calls before that first interaction are no-ops.

let ctx;
let last = 0;

function ensure() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

const unlock = () => {
  try {
    ensure();
  } catch {
    /* no Web Audio support */
  }
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

// Soft rising tick for card hover.
export function hover() {
  const now = performance.now();
  if (now - last < 45) return; // throttle fast sweeps across the grid
  last = now;

  let c;
  try {
    c = ensure();
  } catch {
    return;
  }
  if (c.state !== "running") return; // not unlocked yet

  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(720, t);
  osc.frequency.exponentialRampToValueAtTime(1040, t + 0.06);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.08, t + 0.008); // soft attack
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); // quick decay
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.13);
}

// Filtered noise burst — the pack tear. `intensity` (0–1, from slash velocity)
// scales loudness, brightness, and length so a hard slash sounds like a violent
// rip and a soft one a gentle crinkle.
export function rip(intensity = 1) {
  const i = Math.max(0, Math.min(1, intensity));
  let c;
  try {
    c = ensure();
  } catch {
    return;
  }
  if (c.state !== "running") return;

  const t = c.currentTime;
  const dur = 0.16 + i * 0.16;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let n = 0; n < data.length; n++) {
    const decay = 1 - n / data.length;
    data[n] = (Math.random() * 2 - 1) * decay * decay; // noise that tails off
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900 + i * 2200; // harder slash = brighter
  bp.Q.value = 0.6;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05 + i * 0.3, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(gain).connect(c.destination);
  src.start(t);
  src.stop(t + dur);
}

// Tiny throttled scratch tick emitted while the tear is propagating.
export function scratch(intensity = 0.5) {
  const now = performance.now();
  if (now - last < 32) return; // throttle so a fast drag doesn't machine-gun it
  last = now;
  rip(0.12 + Math.max(0, Math.min(1, intensity)) * 0.18);
}

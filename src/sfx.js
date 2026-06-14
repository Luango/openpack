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

// The pack tear: an irregular noise crackle, low-pass swept downward so it reads
// as ripping paper/foil rather than a bright hiss. `intensity` (0–1, from slash
// velocity) scales loudness, brightness, and length.
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
  const dur = 0.2 + i * 0.24;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  const grain = Math.max(1, (c.sampleRate * 0.004) | 0);
  let crack = 1;
  for (let n = 0; n < data.length; n++) {
    if (n % grain === 0) crack = 0.25 + Math.random() * 0.75; // irregular catches as it tears
    const decay = 1 - n / data.length;
    data[n] = (Math.random() * 2 - 1) * decay * crack;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter(); // trim low rumble
  hp.type = "highpass";
  hp.frequency.value = 280;
  const lp = c.createBiquadFilter(); // sweep brightness down as it tails off
  lp.type = "lowpass";
  lp.Q.value = 0.5;
  lp.frequency.setValueAtTime(2200 + i * 2800, t);
  lp.frequency.exponentialRampToValueAtTime(650, t + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05 + i * 0.32, t + 0.014);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(lp).connect(gain).connect(c.destination);
  src.start(t);
  src.stop(t + dur);
}

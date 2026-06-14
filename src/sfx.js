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

// A SUSTAINED tearing sound for the slash: a looped bright noise crackle whose
// loudness + brightness track the pull speed, so you hear a continuous foil rip
// the whole time you're slashing. tearStart() on the first cut, tearMove() each
// move, tearEnd() on release (with a snap if it committed).
let tear = null;

function noiseBuffer(c, seconds = 2) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf; // long buffer so the loop point is inaudible
}

// A light, bright foil-surface scratch — played when you drag across the middle
// of the pack instead of tearing from an edge. Quiet and brief; throttled.
export function scratch(intensity = 0.4) {
  const now = performance.now();
  if (now - last < 38) return;
  last = now;
  let c;
  try {
    c = ensure();
  } catch {
    return;
  }
  if (c.state !== "running") return;
  const i = Math.max(0, Math.min(1, intensity));
  const t = c.currentTime;
  const dur = 0.05;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let n = 0; n < d.length; n++) d[n] = (Math.random() * 2 - 1) * (1 - n / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2600; // bright surface scrape, not a tear
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.012 + i * 0.045, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(gain).connect(c.destination);
  src.start(t);
  src.stop(t + dur);
}

// start the tear sound only if one isn't already playing (the peel calls this
// every pointer-move, so it must not restart mid-tear)
export function tearStartIfIdle() {
  if (!tear) tearStart();
}

export function tearStart() {
  let c;
  try {
    c = ensure();
  } catch {
    return;
  }
  stopTear();
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1500; // foil = bright, no low rumble
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 4000;
  bp.Q.value = 0.9;
  const gain = c.createGain();
  gain.gain.value = 0.0001;
  src.connect(hp).connect(bp).connect(gain).connect(c.destination);
  src.start();
  tear = { c, src, gain, bp };
}

export function tearMove(intensity = 0.5) {
  if (!tear) return;
  const i = Math.max(0, Math.min(1, intensity));
  const t = tear.c.currentTime;
  tear.gain.gain.setTargetAtTime(0.03 + i * 0.22, t, 0.03); // smooth crackle, no stutter
  tear.bp.frequency.setTargetAtTime(3200 + i * 3600, t, 0.05);
}

export function tearEnd(commit = false, intensity = 0.6) {
  if (!tear) return;
  const { c, src, gain } = tear;
  const t = c.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(Math.max(0.0002, gain.gain.value), t);
  if (commit) {
    const i = Math.max(0, Math.min(1, intensity));
    gain.gain.linearRampToValueAtTime(0.2 + i * 0.3, t + 0.02); // the snap
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.stop(t + 0.32);
  } else {
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.stop(t + 0.14);
  }
  tear = null;
}

function stopTear() {
  if (!tear) return;
  try {
    tear.src.stop();
  } catch {
    /* already stopped */
  }
  tear = null;
}

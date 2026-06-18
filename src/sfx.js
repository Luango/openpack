// Sound effects, synthesized with Web Audio so there's no audio file to host.
// Browsers gate audio behind a user gesture, so the context is unlocked on the
// first pointerdown/keydown; calls before that first interaction are no-ops.
//
// Everything routes through a MASTER BUS — a soft limiter so layered hits never
// clip, plus a parallel convolver REVERB (impulse synthesized once at unlock) so
// chimes, sparks and the open-impact get a real tail instead of running bone-dry
// into the speaker. send(node, amt) feeds any voice into the reverb.

let ctx;
let master; // everything connects here (dry) — bus → limiter → destination
let reverbIn; // feed a voice in here (via send) for the wet tail
let last = 0;

const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// A decaying noise impulse response — a cheap, warm hall. Built once.
function makeImpulse(c, seconds = 2.2, decay = 3.2) {
  const len = Math.ceil(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function buildBus(c) {
  master = c.createGain();
  master.gain.value = REDUCED ? 0.5 : 0.9;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter).connect(c.destination);

  const conv = c.createConvolver();
  conv.buffer = makeImpulse(c);
  reverbIn = c.createGain();
  reverbIn.gain.value = 1;
  const ret = c.createGain();
  ret.gain.value = 0.26; // wet level
  reverbIn.connect(conv).connect(ret).connect(master);
}

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    buildBus(ctx);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// route a node into the reverb at `amt` wetness (in addition to its dry path)
function send(node, amt = 0.3) {
  const g = ctx.createGain();
  g.gain.value = amt;
  node.connect(g).connect(reverbIn);
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

function live() {
  let c;
  try {
    c = ensure();
  } catch {
    return null;
  }
  return c.state === "running" ? c : null;
}

// Soft rising tick for card hover — a detuned triangle pair for body.
export function hover() {
  const now = performance.now();
  if (now - last < 45) return; // throttle fast sweeps across the grid
  last = now;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.07, t + 0.008); // soft attack
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); // quick decay
  gain.connect(master);
  for (const det of [0, -9]) {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.detune.value = det;
    osc.frequency.setValueAtTime(720, t);
    osc.frequency.exponentialRampToValueAtTime(1040, t + 0.06);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}

// A SUSTAINED tearing sound for the slash: a looped bright noise crackle whose
// loudness + brightness track the pull speed, plus a low-mid body tap so the rip
// has weight, not just hiss. tearStart() on the first cut, tearMove() each move,
// tearEnd() on release (with a fibrous snap if it committed).
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
  const c = live();
  if (!c) return;
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
  src.connect(hp).connect(gain).connect(master);
  src.start(t);
  src.stop(t + dur);
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
  src.connect(hp).connect(bp).connect(gain).connect(master);

  // a parallel low-mid tap so the rip has body under the hiss
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 760;
  const bodyGain = c.createGain();
  bodyGain.gain.value = 0.0001;
  src.connect(lp).connect(bodyGain).connect(master);

  src.start();
  tear = { c, src, gain, bp, bodyGain };
}

export function tearMove(intensity = 0.5) {
  if (!tear) return;
  const i = Math.max(0, Math.min(1, intensity));
  const t = tear.c.currentTime;
  tear.gain.gain.setTargetAtTime(0.03 + i * 0.22, t, 0.03); // smooth crackle, no stutter
  tear.bp.frequency.setTargetAtTime(3200 + i * 3600, t, 0.05);
  tear.bodyGain.gain.setTargetAtTime(0.02 + i * 0.08, t, 0.04);
}

export function tearEnd(commit = false, intensity = 0.6) {
  if (!tear) return;
  const { c, src, gain, bodyGain } = tear;
  const t = c.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(Math.max(0.0002, gain.gain.value), t);
  bodyGain.gain.cancelScheduledValues(t);
  bodyGain.gain.setValueAtTime(Math.max(0.0002, bodyGain.gain.value), t);
  if (commit) {
    const i = Math.max(0, Math.min(1, intensity));
    gain.gain.linearRampToValueAtTime(0.2 + i * 0.3, t + 0.02); // the snap
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.stop(t + 0.32);
    shred(c, i); // a fibrous final rip with a touch of room
  } else {
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    src.stop(t + 0.14);
  }
  tear = null;
}

// a few micro noise grains through a bandpass → the "shrrk" of the last fibres
function shred(c, i) {
  const t = c.currentTime;
  for (let n = 0; n < 5; n++) {
    const ts = t + n * 0.018 + Math.random() * 0.01;
    const dur = 0.03;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1200 + Math.random() * 900;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.05 + i * 0.06, ts + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + dur);
    src.connect(bp).connect(g).connect(master);
    send(g, 0.18);
    src.start(ts);
    src.stop(ts + dur);
  }
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

// THE OPEN IMPACT — a chest-thump for the moment the pack bursts: a sine
// sub-drop you feel more than hear, a lowpassed noise body thud (sent to the
// reverb for size), and a short bright transient crack on top. `power` 0–1.
export function burst(power = 0.7) {
  const c = live();
  if (!c) return;
  const p = Math.max(0, Math.min(1, power));
  const t = c.currentTime;

  // body thud — short lowpassed noise, with a wet tail so the room "opens"
  const dur = 0.22;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + dur);
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(0.18 + p * 0.22, t + 0.012);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(bg).connect(master);
  send(bg, 0.4);
  src.start(t);
  src.stop(t + dur);

  // a short bright crack transient — the foil giving way
  const crackBuf = c.createBuffer(1, Math.ceil(c.sampleRate * 0.02), c.sampleRate);
  const cd = crackBuf.getChannelData(0);
  for (let k = 0; k < cd.length; k++) cd[k] = (Math.random() * 2 - 1) * (1 - k / cd.length);
  const crack = c.createBufferSource();
  crack.buffer = crackBuf;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2200;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.0001, t);
  cg.gain.exponentialRampToValueAtTime(0.12 + p * 0.16, t + 0.003);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
  crack.connect(hp).connect(cg).connect(master);
  crack.start(t);
  crack.stop(t + 0.02);

  if (REDUCED) return; // skip the sub layer when motion/intensity is reduced

  // sub-bass drop — felt in the chest
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(58, t);
  osc.frequency.exponentialRampToValueAtTime(34, t + 0.5);
  const og = c.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.4 + p * 0.25, t + 0.012);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + 0.56);
}

// A rising "something's coming" cue, played during the anticipation beat right
// before a rare card is uncovered. A sawtooth swept up through an opening
// lowpass + a noise bed with accelerating tremolo, ending just before the hit.
export function riser(tier = 5, ms = 600) {
  if (REDUCED) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const dur = ms / 1000;
  const top = 660 + Math.max(0, tier - 5) * 90; // rarer → climbs higher

  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(top, t + dur);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.exponentialRampToValueAtTime(5200, t + dur);
  lp.Q.value = 6;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur); // settles into the gap before the hit
  osc.connect(lp).connect(g).connect(master);
  send(g, 0.22);
  osc.start(t);
  osc.stop(t + dur + 0.02);

  // airy noise bed climbing with it
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur + 0.1);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(800, t);
  bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
  bp.Q.value = 0.7;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.7);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(ng).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

// A scatter of tiny high bell grains in a pentatonic set — "glitter you can
// hear". Layered over the chime and the open tail. count grains over `spread` s.
export function sparkleDust(count = 10, spread = 0.6) {
  if (REDUCED) return;
  const c = live();
  if (!c) return;
  const t0 = c.currentTime;
  const notes = [2093, 2349, 2793, 3136, 3520, 4186]; // C7-ish pentatonic
  const n = Math.min(18, count);
  for (let i = 0; i < n; i++) {
    const ts = t0 + Math.random() * spread;
    const f = notes[(Math.random() * notes.length) | 0] * (Math.random() < 0.4 ? 1.5 : 1);
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.03, ts + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.18);
    osc.connect(g).connect(master);
    send(g, 0.3);
    osc.start(ts);
    osc.stop(ts + 0.2);
  }
}

// A quick airy whoosh as a revealed card flicks away to the next.
export function flick() {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.18;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(900, t);
  bp.frequency.exponentialRampToValueAtTime(5200, t + dur); // upward swish
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.09, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(gain).connect(master);
  send(gain, 0.15);
  src.start(t);
  src.stop(t + dur);
}

// A tiny bright glint for an edge spark: a short high sine blip + a whisper of
// bright fizz, with a hair of reverb so it has air. Soft — peppers the idle pack.
export function spark() {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(2400 + Math.random() * 1500, t);
  osc.frequency.exponentialRampToValueAtTime(5400, t + 0.05);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.006); // soft
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  osc.connect(g).connect(master);
  send(g, 0.25);
  osc.start(t);
  osc.stop(t + 0.14);

  // a sub-octave shadow so the glint has a little body
  const osc2 = c.createOscillator();
  const g2 = c.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(1200, t);
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(0.02, t + 0.006);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc2.connect(g2).connect(master);
  osc2.start(t);
  osc2.stop(t + 0.13);

  const dur = 0.07; // a brief bright fizz under the blip
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let n = 0; n < d.length; n++) d[n] = (Math.random() * 2 - 1) * (1 - n / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 5200;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.022, t + 0.004);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(ng).connect(master);
  src.start(t);
  src.stop(t + dur);
}

// A bright rising sparkle when a rare card surfaces — a major arpeggio that gets
// FULLER (more voices) the rarer the pull, all sent to the reverb for a tail:
//   • every tier: two detuned oscillators per note (sine + triangle, ±7 cents)
//   • tier 6+: an octave-up sparkle voice + an extra arpeggio note
//   • tier 8+: a soft detuned-saw pad chord under it + a final top "ding"
export function chime(tier = 5) {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const lift = Math.max(0, Math.min(4, tier - 5)); // 0…4 over the top tiers
  const root = 523.25 * Math.pow(2, lift / 12); // C5, nudged up for rarer cards
  const steps = tier >= 6 ? [0, 4, 7, 12, 16, 19] : [0, 4, 7, 12, 16]; // longer for rarer
  const octave = tier >= 6;
  const noteGap = 0.07;

  steps.forEach((semi, i) => {
    const f = root * Math.pow(2, semi / 12);
    const ts = t + i * noteGap;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, ts);
    ng.gain.exponentialRampToValueAtTime(0.1, ts + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.0001, ts + 0.9); // long bell tail
    ng.connect(master);
    send(ng, 0.32);
    for (const [type, det] of [["sine", 7], ["triangle", -7]]) {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.detune.value = det;
      osc.connect(ng);
      osc.start(ts);
      osc.stop(ts + 0.92);
    }
    if (octave) {
      const sp = c.createOscillator();
      const spg = c.createGain();
      sp.type = "sine";
      sp.frequency.value = f * 2;
      spg.gain.setValueAtTime(0.0001, ts);
      spg.gain.exponentialRampToValueAtTime(0.04, ts + 0.006);
      spg.gain.exponentialRampToValueAtTime(0.0001, ts + 0.5);
      sp.connect(spg).connect(master);
      send(spg, 0.3);
      sp.start(ts);
      sp.stop(ts + 0.52);
    }
  });

  if (tier >= 8) {
    // a soft saw pad chord swells under the arpeggio (root-third-fifth)
    const padG = c.createGain();
    padG.gain.setValueAtTime(0.0001, t);
    padG.gain.exponentialRampToValueAtTime(0.05, t + 0.18);
    padG.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    const padLp = c.createBiquadFilter();
    padLp.type = "lowpass";
    padLp.frequency.value = 1800;
    padG.connect(padLp).connect(master);
    send(padLp, 0.4);
    for (const semi of [0, 4, 7]) {
      for (const det of [-8, 8]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = root * Math.pow(2, semi / 12) / 2;
        o.detune.value = det;
        o.connect(padG);
        o.start(t);
        o.stop(t + 1.32);
      }
    }
    // a final bright "ding" caps the cascade
    const dingT = t + steps.length * noteGap + 0.05;
    const ding = c.createOscillator();
    const dg = c.createGain();
    ding.type = "sine";
    ding.frequency.value = root * 4;
    dg.gain.setValueAtTime(0.0001, dingT);
    dg.gain.exponentialRampToValueAtTime(0.09, dingT + 0.005);
    dg.gain.exponentialRampToValueAtTime(0.0001, dingT + 1);
    ding.connect(dg).connect(master);
    send(dg, 0.45);
    ding.start(dingT);
    ding.stop(dingT + 1.02);
  }
}

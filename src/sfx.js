// Sound effects, synthesized with Web Audio so there's no audio file to host.
// Browsers gate audio behind a user gesture, so the context is unlocked on the
// first pointerdown/keydown; calls before that first interaction are no-ops.
//
// SIGNAL FLOW — everything routes through a MASTER BUS tuned for a PHONE SPEAKER:
//
//   voice → master ─→ HP(45Hz ×2) ─→ limiter ─→ makeup ─→ destination
//                  ╲
//   voice ╴send()╶─→ reverbIn → convolver → HP(240) → LP(10k) → wet → master
//
//   • master.gain is the USER VOLUME (0 when muted) — the one knob the UI drives.
//   • a 24 dB/oct high-pass at 45 Hz scrubs sub a phone can't reproduce, so it
//     never eats limiter headroom or pumps the audible layers.
//   • the limiter sits high (-3 dB) so it only catches stacked peaks instead of
//     crushing every hit; a post-limiter MAKEUP gain restores loudness.
//   • the REVERB return is band-limited (200-ish to 10k) so the tail is AIR, not
//     mud — rare-pull chimes RING out instead of washing into one blob.
//
// Audio is NOT gated by prefers-reduced-motion — that's a vestibular/motion
// preference, not an audio one. The volume/mute control is the audio lever.

let ctx;
let master; // user-volume node — every voice (dry) connects here
let makeup; // post-limiter gain, the bus output into destination
let reverbIn; // feed a voice in here (via send) for the wet tail

// ---- background music (BGM) ------------------------------------------------
// A looping music bed, streamed from an <audio> element into its own gain node.
// It routes STRAIGHT to the destination — parallel to the SFX limiter, NOT
// through it — so a loud cue can't pump/duck the music as a side effect. The
// only thing that modulates the bed is the explicit duck() below: on a big
// moment (open, reveal, chime) the music dips so the cue cuts through, then
// eases back. User volume + mute apply to the bed too (see musicTarget()).
let musicEl = null; // the streaming HTMLAudioElement (loops the mp3)
let musicNode = null; // MediaElementAudioSourceNode wrapping musicEl
let musicGain = null; // bed level = userVol * MUSIC_BASE * duckFactor (0 if muted)
let musicStarted = false;
let duckFactor = 1; // 1 = full bed; <1 while a big moment ducks it
let duckTimer = null; // pending release back to full bed
const MUSIC_BASE = 0.5; // bed sits well under the SFX — it's ambience, not the show
const MUSIC_URL = new URL("../assets/bgm-moonlit-drift.mp3", import.meta.url);

// Persisted user preferences (shared across pages via localStorage). Read once at
// module load so BOTH the gallery and the pack honour a saved volume/mute, even
// before any UI mounts. The bus reads these for its initial gain.
let userVol = 0.85; // 0..1 — the master volume
let muted = false;
try {
  const v = parseFloat(localStorage.getItem("openpack.volume"));
  if (Number.isFinite(v)) userVol = Math.max(0, Math.min(1, v));
  muted = localStorage.getItem("openpack.muted") === "1";
} catch {
  /* private mode — fall back to defaults */
}

// throttles — kept SEPARATE so hovering the gallery grid can't starve the foil
// scratch (and vice versa); they fire from different surfaces at the same time.
let lastHover = 0;
let lastScratch = 0;
let lastGrab = 0;

// A decaying noise impulse response — a cheap, warm hall. Built once. Kept a touch
// shorter/tighter than a concert hall so foil transients don't smear.
function makeImpulse(c, seconds = 2.0, decay = 3.0) {
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
  master.gain.value = muted ? 0 : userVol; // the user-volume knob (also the mute)

  // two cascaded high-passes = ~24 dB/oct — kill the sub a phone can't play before
  // it reaches the limiter, so inaudible rumble never steals headroom.
  const hpA = c.createBiquadFilter();
  hpA.type = "highpass";
  hpA.frequency.value = 45;
  hpA.Q.value = 0.7;
  const hpB = c.createBiquadFilter();
  hpB.type = "highpass";
  hpB.frequency.value = 45;
  hpB.Q.value = 0.7;

  // a SOFT-CATCH limiter — high threshold so it only tames stacked peaks (the rare
  // hit + chime + sparkle landing at once), not every single cue.
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 3;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.006;
  limiter.release.value = 0.2;

  // makeup gain restores the loudness the old -10 dB limiter was throwing away —
  // this is what makes the whole mix actually land on a phone speaker.
  makeup = c.createGain();
  makeup.gain.value = 1.2;

  master.connect(hpA).connect(hpB).connect(limiter).connect(makeup).connect(c.destination);

  // parallel reverb, band-limited so the tail is airy (no mud, no sub).
  const conv = c.createConvolver();
  conv.buffer = makeImpulse(c);
  const revHP = c.createBiquadFilter();
  revHP.type = "highpass";
  revHP.frequency.value = 240; // no low-mid build-up in the tail
  const revLP = c.createBiquadFilter();
  revLP.type = "lowpass";
  revLP.frequency.value = 10000; // soft, glassy top
  reverbIn = c.createGain();
  reverbIn.gain.value = 1;
  const ret = c.createGain();
  ret.gain.value = 0.22; // wet level — a touch drier than before
  reverbIn.connect(conv).connect(revHP).connect(revLP).connect(ret).connect(master);
}

function ensure() {
  if (!ctx) {
    // "interactive" asks the platform for the smallest output buffer it can give —
    // the lowest latency between a cue firing and the speaker, so a sound lands WITH
    // its visual instead of trailing it (the default hint can pick a larger buffer).
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    buildBus(ctx);
    loadSamples(ctx); // fire-and-forget; cues fall back to synth until samples decode
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

// Apply the current volume/mute to the bus with a short fade (no click on mute).
function applyMasterGain() {
  if (!ctx) return;
  if (master) master.gain.setTargetAtTime(muted ? 0 : userVol, ctx.currentTime, 0.02);
  rampMusic(); // the bed follows the same volume/mute knob
}

// ---- public volume / mute API (driven by the UI; persisted) ----------------
export function setVolume(frac) {
  userVol = Math.max(0, Math.min(1, frac));
  try { localStorage.setItem("openpack.volume", String(userVol)); } catch { /* ignore */ }
  applyMasterGain();
}
export function setMute(m) {
  muted = !!m;
  try { localStorage.setItem("openpack.muted", muted ? "1" : "0"); } catch { /* ignore */ }
  applyMasterGain();
}
export function getVolume() { return userVol; }
export function isMuted() { return muted; }

// ---- background music control ----------------------------------------------
// Where the bed should sit RIGHT NOW given volume, mute and any active duck.
function musicTarget() {
  return muted ? 0 : userVol * MUSIC_BASE * duckFactor;
}

// Glide the bed gain to its current target (no clicks). Called whenever volume,
// mute, or the duck factor changes.
function rampMusic(timeConstant = 0.05) {
  if (!musicGain || !ctx) return;
  musicGain.gain.setTargetAtTime(musicTarget(), ctx.currentTime, timeConstant);
}

// Create the BGM <audio> element and begin BUFFERING the file now, WITHOUT playing it.
// play() still needs the first user gesture (autoplay policy), but by then the bytes are
// already downloaded and the graph is ready — so the bed starts with no fetch hitch on
// the first interaction. Safe to call repeatedly (no-op once the element exists).
function prebufferMusic() {
  if (musicEl) return;
  try {
    musicEl = new Audio();
    musicEl.src = MUSIC_URL.href;
    musicEl.loop = true;
    musicEl.preload = "auto";
    musicEl.crossOrigin = "anonymous";
    musicEl.load(); // kick off buffering immediately
  } catch {
    musicEl = null; // no <audio> support → BGM silently skipped
  }
}

// Start the loop once, on the first user gesture (autoplay needs one). The element and
// its bytes are already prepared by prebufferMusic() (at load), so this just wires the
// graph and plays — no download wait. Fades in so it doesn't slam on.
function startMusic() {
  if (musicStarted || !ctx) return;
  musicStarted = true;
  try {
    prebufferMusic();   // ensure the element exists (no-op if already preloaded)
    if (!musicNode) {   // createMediaElementSource is once-per-element
      musicNode = ctx.createMediaElementSource(musicEl);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.0001; // start silent, fade up on play
      musicNode.connect(musicGain).connect(ctx.destination);
    }
    musicEl
      .play()
      .then(() => rampMusic(1.2)) // gentle ~3.5s fade-in to the resting bed
      .catch(() => {
        musicStarted = false; // autoplay blocked — let the next gesture retry
      });
  } catch {
    musicStarted = false; // no MediaElementSource support — silently skip BGM
  }
}

// DUCK the music for a big moment so the cue cuts through, then ease it back.
// `depth` is the multiplier the bed dips to (0.3 = −10 dB-ish); overlapping
// events keep the DEEPEST dip and the LATEST release, so a burst→reveal→chime
// run stays ducked as one continuous beat instead of pumping between cues.
export function duck(depth = 0.3, holdMs = 650, releaseMs = 800) {
  if (!musicGain || !ctx) return;
  duckFactor = Math.min(duckFactor, Math.max(0, Math.min(1, depth)));
  rampMusic(0.06); // pull down fast
  if (duckTimer) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    duckTimer = null;
    duckFactor = 1;
    rampMusic(releaseMs / 1000 / 3); // ~95% recovered by releaseMs
  }, holdMs);
}

// Let the UI / other modules toggle the bed if needed.
export function setMusicEnabled(on) {
  if (on) startMusic();
  else if (musicEl) {
    try { musicEl.pause(); } catch { /* ignore */ }
  }
}

// ---- front-load everything at page load ------------------------------------
// Browsers gate audio PLAYBACK behind a user gesture, but NOT the expensive prep. So at
// load time we create the (suspended) context, build the bus, fetch + decodeAudioData
// every SFX sample, and buffer the BGM file. Then the first gesture only has to resume()
// + play() — instant — instead of kicking off ~5MB of audio fetches and a decode pass
// right as the player starts dragging the carousel (a big part of the first-open 卡顿).
// decodeAudioData works on a suspended context, so nothing here needs the gesture; this
// just moves all the audio cost into the load beat. Idempotent — call it once at startup.
export function preload() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      buildBus(ctx);
    }
    loadSamples(ctx);  // fetch + decode all foley into AudioBuffers now
    prebufferMusic();  // download + buffer the music bed now (play() still waits for a gesture)
  } catch {
    /* no Web Audio support → cues fall back to synth / silence; nothing to preload */
  }
}

// First gesture unlocks audio. We listen in the CAPTURE phase so this runs BEFORE
// the pack's own pointerdown handler — the context is created + resume()'d first,
// so the very first grab/tear isn't swallowed while the context is still cold.
const unlock = () => {
  try {
    ensure();
    startMusic(); // first gesture also satisfies the autoplay policy for the bed
  } catch {
    /* no Web Audio support */
  }
  // Only stop listening once the bed actually started — if autoplay was blocked
  // (startMusic reset the flag), keep waiting for the next gesture to retry.
  if (musicStarted) {
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  }
};
window.addEventListener("pointerdown", unlock, true);
window.addEventListener("keydown", unlock, true);

// Save battery + stay in sync: drop the clock while the tab is hidden, resume on
// return. (Audio can only resume from a gesture the first time; after that it's free.)
document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) {
    ctx.suspend?.();
    musicEl?.pause(); // pause the bed too so it doesn't drift while hidden
  } else {
    if (ctx.state === "suspended") ctx.resume?.();
    if (musicStarted && musicEl?.paused) musicEl.play().catch(() => {});
  }
});

function live() {
  let c;
  try {
    c = ensure(); // creates the context + requests resume(); resume needs a gesture
  } catch {
    return null;
  }
  // Only schedule into a RUNNING context. ensure() already requested the resume, and
  // the capture-phase unlock fires it on the very first pointerdown (before the
  // pack's own handler), so by the first tear-move the context is live — without
  // letting pre-gesture idle cues (the ambient spark timer) pile nodes into a
  // suspended graph that never plays.
  return c.state === "running" ? c : null;
}

// ---- recorded-sample layer -------------------------------------------------
// Every cue below PREFERS a recorded foley sample when one is loaded, and falls
// back to its synthesized version otherwise — so the moment real samples are
// dropped in the app sounds right, and it never goes silent before then. Samples
// are declared in assets/sfx/manifest.json as { "<cue>": ["file1.wav", ...] };
// listing several files per cue gives round-robin variation. The cue names are
// the strings passed to playSample()/startLoopSample() below — see the full list
// + format guidance in assets/sfx/README.md.
const samples = new Map(); // cue name -> [AudioBuffer, ...]
const rr = {}; // round-robin index per cue
let samplesLoading = false;

async function loadSamples(c) {
  if (samplesLoading || samples.size) return;
  samplesLoading = true;
  try {
    const base = new URL("../assets/sfx/", import.meta.url);
    const res = await fetch(new URL("manifest.json", base));
    if (!res.ok) return; // no manifest → synth-only, no console noise
    const manifest = await res.json();
    await Promise.all(
      Object.entries(manifest).map(async ([name, files]) => {
        if (!Array.isArray(files)) return;
        const bufs = [];
        for (const f of files) {
          try {
            const r = await fetch(new URL(f, base));
            if (!r.ok) continue;
            bufs.push(await c.decodeAudioData(await r.arrayBuffer()));
          } catch {
            /* skip a bad/missing file — that cue just falls back to synth */
          }
        }
        if (bufs.length) samples.set(name, bufs);
      })
    );
  } catch {
    /* missing / invalid manifest → synth-only */
  } finally {
    samplesLoading = false;
  }
}

function hasSample(name) {
  return (samples.get(name) || []).length > 0;
}

function pickBuffer(name) {
  const arr = samples.get(name);
  if (!arr || !arr.length) return null;
  if (arr.length === 1) return arr[0];
  rr[name] = ((rr[name] ?? -1) + 1) % arr.length; // round-robin — no immediate repeat
  return arr[rr[name]];
}

// Play a one-shot sample if one is loaded for `name`. Returns true if it played
// (so the caller can `return` and skip its synth fallback), false otherwise.
// `fitMs` time-stretches the sample to roughly that many ms (used by the riser so
// its climax still lands on the hit); otherwise `rate` + `jitterRate` set pitch.
function playSample(name, { gain = 1, rate = 1, jitterRate = 0, jitterGain = 0, send: wet = 0, when, fitMs } = {}) {
  const c = live();
  if (!c) return false;
  const buf = pickBuffer(name);
  if (!buf) return false;
  const t = when ?? c.currentTime;
  const src = c.createBufferSource();
  src.buffer = buf;
  const r = fitMs ? buf.duration / (fitMs / 1000) : rate * (1 + (Math.random() - 0.5) * jitterRate);
  src.playbackRate.value = Math.max(0.05, r);
  const g = c.createGain();
  g.gain.value = Math.max(0.0001, gain * (1 + (Math.random() - 0.5) * jitterGain));
  src.connect(g).connect(master);
  if (wet) send(g, wet);
  src.start(t);
  src.stop(t + buf.duration / src.playbackRate.value + 0.05);
  return true;
}

// Start a LOOPING sample (for the sustained tear). Returns a handle to modulate +
// stop, or null if no sample is loaded (caller then uses its synth loop).
function startLoopSample(name) {
  const c = live();
  if (!c) return null;
  const buf = pickBuffer(name);
  if (!buf) return null;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3500;
  bp.Q.value = 0.7;
  const g = c.createGain();
  g.gain.value = 0.0001;
  src.connect(bp).connect(g).connect(master);
  src.start();
  return { c, src, g, bp };
}

// Soft rising tick for card hover — a detuned triangle pair for body, with a hair
// of pitch jitter so a fast sweep across the grid doesn't machine-gun one note.
export function hover() {
  const now = performance.now();
  if (now - lastHover < 45) return; // throttle fast sweeps across the grid
  lastHover = now;
  if (playSample("hover", { jitterRate: 0.04 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const base = 720 + (Math.random() - 0.5) * 40; // ±20 Hz round-robin
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.07, t + 0.008); // soft attack
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); // quick decay
  gain.connect(master);
  for (const det of [0, -9]) {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.detune.value = det;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.44, t + 0.06);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}

// A SUSTAINED tearing sound for the slash: a looped bright noise crackle whose
// loudness + brightness track the pull speed, plus a low-mid body tap so the rip
// has weight, not just hiss, AND a short foil-crinkle attack so the first contact
// reads as metallic foil, not paper. tearStart(tier) on the first cut, tearMove()
// each move, tearEnd() on release (with a fibrous snap if it committed). The tier
// (the rarest card hidden inside) brightens + energizes the rip — a Hyper pack
// tears with more sparkle than a Common.
let tear = null;

// THE CHIME-UP — as you drag the rip across the pack an ascending pentatonic bell
// ladder climbs with how FAR you've torn (not how fast), so tearing feels like
// winding a spring: each chunk of progress rings the next note up, building toward
// the release when it pops. Pentatonic so any subset lands pleasantly; notes also
// get a touch louder as they climb. Layered OVER the physical rip (synth or sample).
const TEAR_SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0]; // C5 major-pentatonic → A6

function tearBell(c, freq, vel) {
  const t = c.currentTime;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06 * vel, t + 0.006); // struck-glass attack
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45); // bell tail
  g.connect(master);
  send(g, 0.3); // a little air so each step rings
  for (const [type, det] of [["sine", 6], ["triangle", -6]]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(g);
    o.start(t);
    o.stop(t + 0.47);
  }
  // an octave shimmer that decays faster → a brighter "ting" on top
  const sp = c.createOscillator();
  const spg = c.createGain();
  sp.type = "sine";
  sp.frequency.value = freq * 2;
  spg.gain.setValueAtTime(0.0001, t);
  spg.gain.exponentialRampToValueAtTime(0.025 * vel, t + 0.005);
  spg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  sp.connect(spg).connect(master);
  send(spg, 0.3);
  sp.start(t);
  sp.stop(t + 0.24);
}

// Ring the next bell(s) up the ladder as the tear advances. `progress` 0→1 along
// the rip; we only ever climb (jitter back-and-forth never replays a note).
function tearChimeUp(progress) {
  if (!tear || !tear.c) return;
  if (tear.step == null) tear.step = -1;
  const steps = TEAR_SCALE.length;
  const target = Math.min(steps - 1, Math.floor(Math.max(0, Math.min(1, progress)) * steps));
  while (tear.step < target) {
    tear.step++;
    tearBell(tear.c, TEAR_SCALE[tear.step], 0.75 + (tear.step / steps) * 0.5); // climbs louder
  }
}

// ONE shared, read-only white-noise buffer. Every noise-based cue (the tear loop,
// burst, revealImpact, riser, flick, reseal) reads from it — looped or simply
// stopped early — so we NEVER fill a fresh Float32Array with Math.random() on the
// main thread mid-open/mid-reveal. That per-cue allocation (up to ~50k samples for
// the reveal-impact tail) ran inside the exact janky frame the sound had to sync
// to, which both worsened the hitch and drifted the audio clock. Built once, lazily.
// (The tiny <0.05s grains in crinkle/shred/crack bake a decay envelope INTO their
// samples, so they keep their own per-call buffers — they're cheap.)
let _noise = null;
function noiseBuffer(c, seconds = 2) {
  if (_noise && _noise.length >= c.sampleRate * seconds) return _noise;
  const len = Math.ceil(c.sampleRate * Math.max(2.5, seconds)); // 2.5s covers the longest tail
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  _noise = buf; // long buffer so any loop point is inaudible, and reused thereafter
  return buf;
}

// a quick scatter of bright noise grains — the metallic "crinkle" of foil being
// gripped/cut. Used as the tear attack and the standalone grab() cue.
function crinkle(c, t, { n = 4, gain = 0.02, lo = 1600, hi = 4200, send: wet = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const ts = t + i * (0.01 + Math.random() * 0.018);
    const dur = 0.03 + Math.random() * 0.03;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = lo + Math.random() * (hi - lo);
    bp.Q.value = 0.8 + Math.random() * 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(gain * (0.7 + Math.random() * 0.6), ts + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + dur);
    src.connect(bp).connect(g).connect(master);
    if (wet) send(g, wet);
    src.start(ts);
    src.stop(ts + dur);
  }
}

// A short muffled foil CRINKLE the instant you grab the pack — the tactile "handle"
// before any tear. Soft, brief, varied; throttled so a mash doesn't pile up.
export function grab() {
  const now = performance.now();
  if (now - lastGrab < 90) return;
  lastGrab = now;
  if (playSample("grab", { jitterRate: 0.06, jitterGain: 0.15, send: 0.06 })) return;
  const c = live();
  if (!c) return;
  crinkle(c, c.currentTime, { n: 3 + ((Math.random() * 2) | 0), gain: 0.022, lo: 1400, hi: 3600, send: 0.06 });
}

// A light, bright foil-surface scratch — played when you drag across the middle
// of the pack instead of tearing from an edge. Quiet and brief; throttled, with
// pitch + level jitter so a long scuff doesn't read as one looped tone.
export function scratch(intensity = 0.4) {
  const now = performance.now();
  if (now - lastScratch < 38) return;
  lastScratch = now;
  if (playSample("scratch", { gain: 0.4 + Math.max(0, Math.min(1, intensity)) * 0.8, jitterRate: 0.08 })) return;
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
  hp.frequency.value = 2600 + (Math.random() - 0.5) * 320; // bright surface scrape, jittered
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime((0.012 + i * 0.045) * (0.88 + Math.random() * 0.24), t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(gain).connect(master);
  src.start(t);
  src.stop(t + dur);
}

export function tearStart(tier = 0) {
  let c;
  try {
    c = ensure();
  } catch {
    return;
  }
  stopTear();
  const loop = startLoopSample("tear_loop");
  if (loop) { tear = { ...loop, sample: true, tier, step: -1 }; return; } // recorded rip — modulated in tearMove
  const tg = Math.max(0, Math.min(1, (tier - 3) / 6)); // 0 below Holo → 1 at Hyper
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1500; // foil = bright, no low rumble
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 4000 + tg * 1200; // rarer → brighter, more energetic foil
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
  // a metallic crinkle on first contact, so the cut starts as FOIL, not a fade-in
  crinkle(c, c.currentTime, { n: 5, gain: 0.018 + tg * 0.014, lo: 4000, hi: 9000, send: 0.05 });
  tear = { c, src, gain, bp, bodyGain, tier, step: -1 };
}

export function tearMove(intensity = 0.5, progress = null) {
  if (!tear) return;
  const i = Math.max(0, Math.min(1, intensity));
  if (progress != null) tearChimeUp(progress); // the rising chime-up, over either rip
  if (tear.sample) {
    const ts = tear.c.currentTime;
    tear.g.gain.setTargetAtTime(0.1 + i * 0.5, ts, 0.03); // louder with pull speed
    tear.bp.frequency.setTargetAtTime(2500 + i * 4000, ts, 0.05); // brighter with speed
    tear.src.playbackRate.setTargetAtTime(0.9 + i * 0.5, ts, 0.05); // faster pull → faster rip
    return;
  }
  const tg = Math.max(0, Math.min(1, (tear.tier - 3) / 6));
  const t = tear.c.currentTime;
  // crackle TEXTURE sits under the chime-up melody — kept lighter than before so the
  // rising bells read clearly as the satisfying lead, not buried in hiss
  tear.gain.gain.setTargetAtTime(0.025 + i * 0.16, t, 0.03); // smooth crackle, no stutter
  tear.bp.frequency.setTargetAtTime((3200 + tg * 900) + i * 3600, t, 0.05);
  tear.bodyGain.gain.setTargetAtTime(0.02 + i * 0.07, t, 0.04);
}

export function tearEnd(commit = false, intensity = 0.6) {
  if (!tear) return;
  if (tear.sample) {
    const { c, src, g, tier } = tear;
    const t = c.currentTime;
    const i = Math.max(0, Math.min(1, intensity));
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0002, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (commit ? 0.18 : 0.1));
    try { src.stop(t + (commit ? 0.22 : 0.12)); } catch { /* already stopped */ }
    // a recorded snap on commit; if none, the synth fibres still fray
    if (commit && !playSample("tear_snap", { gain: 0.6 + i * 0.5, send: 0.18 })) shred(c, i, tier);
    tear = null;
    return;
  }
  const { c, src, gain, bodyGain, tier } = tear;
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
    shred(c, i, tier); // a fibrous final rip with a touch of room
  } else {
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    src.stop(t + 0.14);
  }
  tear = null;
}

// a few micro noise grains through a bandpass → the "shrrk" of the last fibres.
// rarer pulls fray with a few more, brighter grains.
function shred(c, i, tier = 0) {
  const t = c.currentTime;
  const tg = Math.max(0, Math.min(1, (tier - 3) / 6));
  const grains = 5 + Math.round(tg * 3);
  for (let n = 0; n < grains; n++) {
    const ts = t + n * 0.018 + Math.random() * 0.01;
    const dur = 0.03;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1200 + Math.random() * (900 + tg * 1400);
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

// THE RELEASE — the small, joyful "pop" the instant the pack gives way: a quick
// bright ascending major flourish resolving on a high tonic + a sparkle ding — the
// pleasant resolution the chime-up ladder was climbing toward. Short + modest (the
// big celebration is saved for a rare card); it rides over the burst's body thump.
export function tearRelease() {
  if (playSample("open_release", { send: 0.35 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const notes = [1046.5, 1318.51, 1567.98]; // C6 E6 G6 — a bright major resolve
  notes.forEach((f, k) => {
    const ts = t + k * 0.05;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.07, ts + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.55);
    g.connect(master);
    send(g, 0.35);
    for (const [type, det] of [["sine", 5], ["triangle", -5]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(ts);
      o.stop(ts + 0.57);
    }
  });
  // a top sparkle "ding" caps the release (C7)
  const dingT = t + 0.13;
  const ding = c.createOscillator();
  const dg = c.createGain();
  ding.type = "sine";
  ding.frequency.value = 2093;
  dg.gain.setValueAtTime(0.0001, dingT);
  dg.gain.exponentialRampToValueAtTime(0.06, dingT + 0.005);
  dg.gain.exponentialRampToValueAtTime(0.0001, dingT + 0.7);
  ding.connect(dg).connect(master);
  send(dg, 0.4);
  ding.start(dingT);
  ding.stop(dingT + 0.72);
  // a whisper of high sparkle fizz — the "release" glitter
  for (let k = 0; k < 5; k++) {
    const ts = t + Math.random() * 0.18;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = (2349 + Math.random() * 1837); // D7–A7-ish
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.018, ts + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.2);
    o.connect(g).connect(master);
    send(g, 0.35);
    o.start(ts);
    o.stop(ts + 0.22);
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

// A dull descending "nope" stab when a tear is voided (turned back on itself). A
// blocked, lowpassed saw drop — reads as "that didn't work", paired with the haptic.
export function rejectTone() {
  if (playSample("reject")) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(150, t + 0.14);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1300;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.11, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(lp).connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.17);
}

// A descending foil whoosh as the two halves slide back into one pack (reseal,
// "Open another"). Brightness falls as the pieces close.
export function reseal() {
  if (playSample("reseal", { send: 0.15 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.4;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur + 0.1);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.7;
  bp.frequency.setValueAtTime(5200, t);
  bp.frequency.exponentialRampToValueAtTime(800, t + dur); // the foil sliding shut
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.055, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(master);
  send(g, 0.15);
  src.start(t);
  src.stop(t + dur + 0.05);
}

// THE OPEN IMPACT — a chest-thump for the moment the pack bursts: a sine body-drop
// kept in the phone-AUDIBLE range (it's felt AND heard, not lost below a phone's
// rolloff), a lowpassed noise body thud (sent to the reverb for size), and a short
// bright "TINK-shrrk" transient on top — the foil giving way. `power` 0–1; `tier`
// (the rarest card inside) makes a chase open hit deeper + brighter than a dud.
export function burst(power = 0.7, tier = 5) {
  duck(0.35, 700, 800); // pack pops open — clear room for the whump
  const tgs = Math.max(0, Math.min(1, (tier - 4) / 5));
  if (playSample("open_burst", { gain: 0.7 + Math.max(0, Math.min(1, power)) * 0.5, rate: 1 - tgs * 0.06, send: 0.35 })) return;
  const c = live();
  if (!c) return;
  const p = Math.max(0, Math.min(1, power));
  const tg = Math.max(0, Math.min(1, (tier - 4) / 5)); // 0 at Double Rare → 1 at Hyper
  const t = c.currentTime;

  // body thud — short lowpassed noise, with a wet tail so the room "opens",
  // a touch longer for a rare open
  const dur = 0.22 + tg * 0.1;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + dur);
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(0.18 + p * 0.22 + tg * 0.06, t + 0.012);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(bg).connect(master);
  send(bg, 0.4);
  src.start(t);
  src.stop(t + dur);

  // a short bright crack transient — the foil giving way — with a tiny sine glint
  // on top so it reads as a metallic "TINK", brighter for rarer
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

  const glint = c.createOscillator();
  const glg = c.createGain();
  glint.type = "sine";
  glint.frequency.setValueAtTime(2400 + tg * 1400, t);
  glint.frequency.exponentialRampToValueAtTime(5200, t + 0.05);
  glg.gain.setValueAtTime(0.0001, t);
  glg.gain.exponentialRampToValueAtTime(0.05 + tg * 0.04, t + 0.004);
  glg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  glint.connect(glg).connect(master);
  send(glg, 0.25);
  glint.start(t);
  glint.stop(t + 0.13);

  // body sub-drop — felt in the chest, but pitched to ~90→55 Hz so a PHONE speaker
  // still moves on it (the old 58→34 Hz was below the driver and just pumped the
  // limiter). Quieter than before for the same reason.
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(90 - tg * 6, t);
  osc.frequency.exponentialRampToValueAtTime(55 - tg * 6, t + 0.5);
  const og = c.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.22 + p * 0.12 + tg * 0.08, t + 0.012);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + 0.56);
}

// THE REVEAL IMPACT — the downbeat the anticipation riser LANDS on, the instant a
// chase card uncovers. This is the money moment: it scales hard with tier so a
// Hyper pull is a different EVENT than a Double Rare. Three layers — a pitched BOOM
// you feel (phone-audible), a bright noise CRASH that blooms into the room (the
// "tsss" under the flash), and a sharp leading-edge crack — plus a felt sub at the
// top tiers. Fired ~just before the chime so impact → arpeggio → glitter reads as
// one rising arc, not three separate sounds.
export function revealImpact(tier = 5) {
  duck(0.22, 950, 950); // the money moment — the deepest dip
  const ps = Math.max(0, Math.min(1, (tier - 4) / 5));
  if (playSample("reveal_impact", { gain: 0.8 + ps * 0.5, rate: 1 - ps * 0.08, send: 0.4 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const p = Math.max(0, Math.min(1, (tier - 4) / 5)); // 0 at Double Rare → 1 at Hyper

  // 1) BOOM — a pitched body drop kept in the phone-audible 165→70 Hz band
  const boom = c.createOscillator();
  const bg = c.createGain();
  boom.type = "sine";
  boom.frequency.setValueAtTime(165 - p * 35, t);
  boom.frequency.exponentialRampToValueAtTime(70 - p * 12, t + 0.18);
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(0.3 + p * 0.25, t + 0.012);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.26 + p * 0.12);
  boom.connect(bg).connect(master);
  send(bg, 0.3);
  boom.start(t);
  boom.stop(t + 0.42);

  // 2) CRASH — a bright noise swell that rings into the room (longer + bigger for
  //    rarer); this is what fills the held beat with air under the chime
  const dur = 0.5 + p * 0.55;
  const csrc = c.createBufferSource();
  csrc.buffer = noiseBuffer(c, dur + 0.1);
  const chp = c.createBiquadFilter();
  chp.type = "highpass";
  chp.frequency.value = 3400;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.05 + p * 0.08, t + 0.02); // fast attack
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur); // long shimmer decay
  csrc.connect(chp).connect(ng).connect(master);
  send(ng, 0.5); // lots of room — the tail that rings under the chime
  csrc.start(t);
  csrc.stop(t + dur + 0.1);

  // 3) leading-edge crack — the "HIT" point
  const crackBuf = c.createBuffer(1, Math.ceil(c.sampleRate * 0.02), c.sampleRate);
  const cd = crackBuf.getChannelData(0);
  for (let k = 0; k < cd.length; k++) cd[k] = (Math.random() * 2 - 1) * (1 - k / cd.length);
  const crack = c.createBufferSource();
  crack.buffer = crackBuf;
  const khp = c.createBiquadFilter();
  khp.type = "highpass";
  khp.frequency.value = 2400;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.0001, t);
  cg.gain.exponentialRampToValueAtTime(0.1 + p * 0.14, t + 0.003);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  crack.connect(khp).connect(cg).connect(master);
  crack.start(t);
  crack.stop(t + 0.03);

  // 4) top tiers: a felt sub reinforcement under the boom
  if (tier >= 7) {
    const sub = c.createOscillator();
    const sg = c.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(92, t);
    sub.frequency.exponentialRampToValueAtTime(56, t + 0.4);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.15 + p * 0.12, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    sub.connect(sg).connect(master);
    sub.start(t);
    sub.stop(t + 0.52);
  }
}

// A rising "something's coming" cue, played during the anticipation beat right
// before a rare card is uncovered. A sawtooth swept up through an opening lowpass
// + a noise bed with accelerating tremolo. It now SWELLS to its peak and HOLDS,
// bridging straight into the revealImpact downbeat instead of dissolving into
// dead air. Call with ms = the actual hold length so the climax lands on the hit.
export function riser(tier = 5, ms = 600) {
  duck(0.3, ms + 150, 600); // hold the dip across the whole swell into the hit
  if (playSample("riser", { fitMs: ms, send: 0.22 })) return;
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
  g.gain.exponentialRampToValueAtTime(0.14, t + dur * 0.82); // climb almost to the hit
  g.gain.setValueAtTime(0.14, t + dur); // HOLD the peak — no gap before the impact
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12); // brief tail under the impact
  osc.connect(lp).connect(g).connect(master);
  send(g, 0.22);
  osc.start(t);
  osc.stop(t + dur + 0.14);

  // airy noise bed climbing with it, also sustained to the hit
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur + 0.2);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(800, t);
  bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
  bp.Q.value = 0.7;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.85);
  ng.gain.setValueAtTime(0.06, t + dur);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
  src.connect(bp).connect(ng).connect(master);
  src.start(t);
  src.stop(t + dur + 0.14);
}

// A scatter of tiny high bell grains in a pentatonic set — "glitter you can hear".
// Layered over the chime and the open tail. Now scales genuinely with `count` (no
// hard 18 cap) so a Hyper shimmers far more than a Double Rare, with per-grain
// detune + envelope spread so it sparkles instead of buzzing.
export function sparkleDust(count = 10, spread = 0.6) {
  const c = live();
  if (!c) return;
  const t0 = c.currentTime;
  if (hasSample("sparkle")) {
    // scatter recorded glitter grains with random pitch + timing → shimmer, not a loop
    const m = Math.min(40, Math.max(1, Math.round(count)));
    for (let i = 0; i < m; i++) {
      playSample("sparkle", { when: t0 + Math.random() * spread, rate: 0.9 + Math.random() * 0.6, gain: 0.8, send: 0.3 });
    }
    return;
  }
  const notes = [2093, 2349, 2793, 3136, 3520, 4186]; // C7-ish pentatonic
  const n = Math.min(40, Math.max(1, Math.round(count)));
  for (let i = 0; i < n; i++) {
    const ts = t0 + Math.random() * spread;
    const f = notes[(Math.random() * notes.length) | 0] * (Math.random() < 0.4 ? 1.5 : 1);
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    osc.detune.value = (Math.random() - 0.5) * 12; // ±6 cents — shimmer, not a unison buzz
    const g = c.createGain();
    const atk = 0.004 + Math.random() * 0.003;
    const dec = 0.16 + Math.random() * 0.04;
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.03, ts + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + dec);
    osc.connect(g).connect(master);
    send(g, 0.3);
    osc.start(ts);
    osc.stop(ts + dec + 0.02);
  }
}

// A quick airy whoosh as a revealed card flicks away to the next — with the
// bandpass start/end + level jittered so rapid taps don't machine-gun one swish.
export function flick() {
  if (playSample("flick", { jitterRate: 0.08, jitterGain: 0.15, send: 0.15 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.18;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(900 + (Math.random() - 0.5) * 200, t);
  bp.frequency.exponentialRampToValueAtTime(5200 + (Math.random() - 0.5) * 800, t + dur); // upward swish
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.09 * (0.85 + Math.random() * 0.3), t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(gain).connect(master);
  send(gain, 0.15);
  src.start(t);
  src.stop(t + dur);
}

// A soft airy WHOOSH as a pack glides into the ring during the queue-in entrance —
// the carousel building itself one pack at a time. A bandpassed noise swish (the
// pack cutting the air) with a little low body so a PACK reads heavier than a thin
// card `flick`, plus a touch of room. `index`/`total` nudge the pitch UP the queue,
// so the packs arrive as an ascending run instead of one repeated note. Jittered
// so the ~0.3s-apart launches don't machine-gun a single swish.
export function packWhoosh(index = 0, total = 8) {
  const step = total > 1 ? Math.max(0, Math.min(1, index / (total - 1))) : 0; // 0..1 up the queue
  if (playSample("pack_in", { rate: 0.95 + step * 0.22, jitterRate: 0.06, jitterGain: 0.12, send: 0.22 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.32;
  // airy swish — a quick "fwoosh" as the pack is thrown onto its arc, bandpass
  // sweeping UP (and a hair higher up the queue) so the run feels like it's climbing
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.7;
  bp.frequency.setValueAtTime(620 + step * 220, t);
  bp.frequency.exponentialRampToValueAtTime(3400 + step * 1000, t + dur); // upward swish
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.06 * (0.85 + Math.random() * 0.3), t + 0.05); // fast attack — the throw
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(gain).connect(master);
  send(gain, 0.22);
  src.start(t);
  src.stop(t + dur);

  // a soft low body so a PACK has weight under the air (a card flick doesn't); it
  // rises with the swish so the swoosh reads as one gesture, not hiss + a separate tone
  const osc = c.createOscillator();
  const og = c.createGain();
  osc.type = "sine";
  const base = 150 + step * 60;
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 1.5, t + dur * 0.8);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.045, t + 0.04);
  og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// A soft padded "set-down" — the card hand landing when the reveal arrives. A short
// HP contact click (the glossy card-on-card tap) + a lowpassed noise "pap" + a
// little low sine body so it reads on a phone speaker. Deliberately HUMBLE: quieter
// than the flick (airy) and the burst (sub-drop), so a common pull feels handled,
// not celebrated. Lightly jittered so repeated pulls don't sound identical.
export function setDown() {
  if (playSample("setdown", { jitterRate: 0.05, send: 0.12 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.09;

  // a brief bright contact click — glossy cardstock, not a dull thud
  const clickBuf = c.createBuffer(1, Math.ceil(c.sampleRate * 0.012), c.sampleRate);
  const ckd = clickBuf.getChannelData(0);
  for (let k = 0; k < ckd.length; k++) ckd[k] = (Math.random() * 2 - 1) * (1 - k / ckd.length);
  const click = c.createBufferSource();
  click.buffer = clickBuf;
  const chp = c.createBiquadFilter();
  chp.type = "highpass";
  chp.frequency.value = 1800 + Math.random() * 1000;
  const ckg = c.createGain();
  ckg.gain.setValueAtTime(0.0001, t);
  ckg.gain.exponentialRampToValueAtTime(0.05, t + 0.002);
  ckg.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
  click.connect(chp).connect(ckg).connect(master);
  click.start(t);
  click.stop(t + 0.014);

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(440 + (Math.random() - 0.5) * 80, t);
  lp.frequency.exponentialRampToValueAtTime(160, t + dur); // felt "pap", not a click
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.15, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(master);
  send(g, 0.12); // share the room
  src.start(t);
  src.stop(t + dur);

  // a touch of low body so it lands on a small speaker
  const osc = c.createOscillator();
  const og = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120 + (Math.random() - 0.5) * 24, t);
  osc.frequency.exponentialRampToValueAtTime(58, t + 0.08);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.1, t + 0.008);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + 0.1);
}

// A soft riffle TAP as a deeper card slides into its step during the deal-in — so
// the hand reads aurally as N cards being laid down. Quieter the deeper it sits.
export function cardTap(depth = 0) {
  if (playSample("cardtap", { gain: Math.max(0.4, 1 - depth * 0.18), jitterRate: 0.08 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.05;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1500 + Math.random() * 700;
  const g = c.createGain();
  const lvl = Math.max(0.02, 0.06 - depth * 0.01);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(lvl, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur);
}

// A juicy "absorb / gulp" pop for sucking a card into the binder — a soft round body
// blip that bends UP (the swallow) plus a little squish transient, its pitch RISING
// with each card so collecting a pack reads as an escalating, satisfying munch — à la
// Cult of the Lamb chowing down. index = which card (0-based), total = pack size.
export function gulp(index = 0, total = 5) {
  if (playSample("gulp", { rate: 1 + index * 0.05, send: 0.12 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const step = total > 1 ? index / (total - 1) : 0; // 0..1 across the pack
  const base = 240 + step * 380;                    // ascending pitch per card
  // round body that bends up (the swallow), then settles
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(base * 0.8, t);
  osc.frequency.exponentialRampToValueAtTime(base * 1.7, t + 0.06);
  osc.frequency.exponentialRampToValueAtTime(base * 1.15, t + 0.15);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.17, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(g).connect(master);
  send(g, 0.1);
  osc.start(t); osc.stop(t + 0.19);
  // a soft "squish" transient on top
  const nz = c.createBufferSource();
  nz.buffer = noiseBuffer(c, 0.05);
  const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = base * 2.2; bp.Q.value = 0.9;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.09, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  nz.connect(bp).connect(ng).connect(master);
  nz.start(t); nz.stop(t + 0.05);
}

// A tiny high blip articulating each count pip as the status fades in — a soft
// ascending "tick … tick … tick" so the haul size registers aurally. Very quiet.
export function pipTone(index = 0) {
  if (playSample("pip", { rate: 1 + index * 0.06, send: 0.12 })) return; // ascending tick per card
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = 2200 + index * 130;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.04, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  osc.connect(g).connect(master);
  send(g, 0.12);
  osc.start(t);
  osc.stop(t + 0.09);
}

// A tiny bright glint for an edge spark: a short high sine blip + a coherent
// sub-octave shadow + a whisper of bright fizz, with a hair of reverb so it has
// air. Soft — peppers the idle pack. The sub-octave tracks the (random) head pitch
// so each glint is a tuned pair, not a static drone.
export function spark() {
  if (playSample("spark", { jitterRate: 0.1, send: 0.25 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const head = 2400 + Math.random() * 1500;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(head, t);
  osc.frequency.exponentialRampToValueAtTime(5400, t + 0.05);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.006); // soft
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  osc.connect(g).connect(master);
  send(g, 0.25);
  osc.start(t);
  osc.stop(t + 0.14);

  // a sub-octave shadow so the glint has a little body (tracks the head pitch)
  const osc2 = c.createOscillator();
  const g2 = c.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(head / 2, t);
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
// FULLER (more voices) the rarer the pull, all sent to the reverb for a tail.
// Struck-bell envelope (fast-but-not-instant attack; octave sparkles decay faster
// than the fundamentals) so it rings like glass, not a synth blip:
//   • every tier: two detuned oscillators per note (sine + triangle, ±7 cents)
//   • tier 6+: an octave-up sparkle voice + an extra arpeggio note
//   • tier 8+: a soft detuned-saw pad chord under it + a final top "ding"
export function chime(tier = 5) {
  duck(0.3, 1100, 1100); // long bell tail — keep the bed low while it rings
  if (playSample("chime", { rate: 1 + Math.max(0, Math.min(4, tier - 5)) / 24, send: 0.18 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const lift = Math.max(0, Math.min(4, tier - 5)); // 0…4 over the top tiers
  const root = 523.25 * Math.pow(2, lift / 12); // C5, nudged up for rarer cards
  const steps = tier >= 6 ? [0, 4, 7, 12, 16, 19] : [0, 4, 7, 12, 16]; // longer for rarer
  const octave = tier >= 6;
  const noteGap = 0.07;
  const wet = 0.18 + Math.max(0, Math.min(4, tier - 5)) * 0.02; // drier overall; rings, not washes

  steps.forEach((semi, i) => {
    const f = root * Math.pow(2, semi / 12);
    const ts = t + i * noteGap;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, ts);
    ng.gain.exponentialRampToValueAtTime(0.1, ts + 0.012); // a hair of attack — a struck bell
    ng.gain.exponentialRampToValueAtTime(0.0001, ts + 0.9); // long bell tail
    ng.connect(master);
    send(ng, wet);
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
      spg.gain.exponentialRampToValueAtTime(0.04, ts + 0.005);
      spg.gain.exponentialRampToValueAtTime(0.0001, ts + 0.4); // sparkle decays faster than the body
      sp.connect(spg).connect(master);
      send(spg, wet + 0.06);
      sp.start(ts);
      sp.stop(ts + 0.42);
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
    send(padLp, wet + 0.12);
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
    send(dg, wet + 0.2);
    ding.start(dingT);
    ding.stop(dingT + 1.02);
  }
}

// A gentle resolving descent when the last card is seen — "that's the pack". A
// two-note fall settling onto a soft low pad, so the haul closes on a cadence
// instead of silence.
export function concludeChime() {
  duck(0.4, 1000, 1300); // gentle, longer release — the haul settles, bed swells back
  if (playSample("conclude", { send: 0.3 })) return;
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const notes = [659.25, 523.25]; // E5 → C5
  notes.forEach((f, i) => {
    const ts = t + i * 0.14;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.06, ts + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.7);
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(g).connect(master);
    send(g, 0.3);
    o.start(ts);
    o.stop(ts + 0.72);
  });
  // a soft low pad underneath for closure (C3 + G3)
  const padG = c.createGain();
  padG.gain.setValueAtTime(0.0001, t);
  padG.gain.exponentialRampToValueAtTime(0.04, t + 0.12);
  padG.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1200;
  padG.connect(lp).connect(master);
  send(lp, 0.3);
  for (const f of [130.81, 196.0]) {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = f;
    o.connect(padG);
    o.start(t);
    o.stop(t + 1.02);
  }
}

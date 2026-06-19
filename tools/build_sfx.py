#!/usr/bin/env python
# Build OpenPack's recorded SFX pack from CC0 sources (Kenney + OpenGameArt).
# Writes 16-bit mono 44.1k WAV into assets/sfx/ and a manifest.json.
#
#   pip install soundfile numpy
#   python tools/build_sfx.py [SRC_DIR]      # SRC_DIR defaults to ./_sfxsrc
#
# Drop these CC0 packs into SRC_DIR (each unzipped into its own subfolder, names
# below). All are public-domain (CC0) — safe to redistribute:
#   casino/    Kenney "Casino Audio"      https://kenney.nl/assets/casino-audio
#   impact/    Kenney "Impact Sounds"     https://kenney.nl/assets/impact-sounds
#   interface/ Kenney "Interface Sounds"  https://kenney.nl/assets/interface-sounds
#   paper/     OpenGameArt "Various Paper Sound Effects" (sounds_6.zip)
#              https://opengameart.org/content/various-paper-sound-effects
import soundfile as sf, numpy as np, glob, os, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
SC   = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, "..", "_sfxsrc")
DEST = os.path.abspath(os.path.join(HERE, "..", "assets", "sfx"))
SR   = 44100

def find(pat):
    g = glob.glob(os.path.join(SC, pat), recursive=True)
    if not g: raise FileNotFoundError(pat)
    return g[0]

def load(pat):
    x, sr = sf.read(find(pat), dtype="float32")
    if x.ndim > 1: x = x.mean(1)
    if sr != SR:                      # all sources are 44.1k, but be safe
        n = int(round(len(x) * SR / sr)); x = np.interp(np.linspace(0, len(x), n, endpoint=False), np.arange(len(x)), x)
    return x.astype(np.float32)

def trim_head(x, db=-45, keep_ms=2):
    thr = 10 ** (db / 20); a = np.abs(x)
    idx = np.argmax(a > thr) if np.any(a > thr) else 0
    return x[max(0, idx - int(keep_ms * SR / 1000)):]

def trim_tail(x, db=-50):
    thr = 10 ** (db / 20); a = np.abs(x)
    nz = np.where(a > thr)[0]
    return x[: nz[-1] + int(0.01 * SR)] if len(nz) else x

def norm(x, db=-6):
    pk = np.max(np.abs(x))
    return x * (10 ** (db / 20) / pk) if pk > 1e-9 else x

def fade(x, in_ms=3, out_ms=8):
    n_in, n_out = int(in_ms * SR / 1000), int(out_ms * SR / 1000)
    x = x.copy()
    if n_in:  x[:n_in]  *= np.linspace(0, 1, n_in)
    if n_out: x[-n_out:] *= np.linspace(1, 0, n_out)
    return x

def one_shot(pat, peak=-6, head=True, tail=True, in_ms=2, out_ms=10):
    x = load(pat)
    if head: x = trim_head(x)
    if tail: x = trim_tail(x)
    return norm(fade(x, in_ms, out_ms), peak)

def loopify(x, start_s, dur_s, xf_ms=80):
    xf = int(xf_ms * SR / 1000); start = int(start_s * SR); n = int(dur_s * SR) + xf
    seg = x[start:start + n]
    if len(seg) < n: seg = np.pad(seg, (0, n - len(seg)))
    L = n - xf; loop = seg[:L].copy(); over = seg[L:L + xf]
    w = np.sqrt(np.linspace(0, 1, xf))                # equal-power crossfade
    loop[:xf] = loop[:xf] * w + over * (1 - w)
    return loop

def mix(layers):                                       # [(sig, gain, offset_ms)]
    N = max(len(s) + int(o * SR / 1000) for s, g, o in layers)
    buf = np.zeros(N, np.float32)
    for s, g, o in layers:
        off = int(o * SR / 1000); buf[off:off + len(s)] += s * g
    return buf

def write(name, x, peak=-6):
    x = norm(x, peak).astype(np.float32)
    np.clip(x, -1, 1, out=x)
    p = os.path.join(DEST, name)
    sf.write(p, x, SR, format="WAV", subtype="PCM_16")
    return os.path.getsize(p)

# ---------------------------------------------------------------- build cues
out = {}     # manifest: cue -> [filenames]
def emit(cue, name, sig, peak=-6):
    write(name, sig, peak); out.setdefault(cue, []).append(name)

# PHYSICAL FOLEY -------------------------------------------------------------
# grab — foil pack handling
emit("grab", "grab-1.wav", one_shot("casino/**/cards-pack-take-out-1.ogg", -7))
emit("grab", "grab-2.wav", one_shot("casino/**/cards-pack-take-out-2.ogg", -7))

# tear_loop — seamless looping foil crinkle (from a sustained paper-crush)
crush = trim_head(load("paper/WAV/Paper Crushed - 1.wav"))
emit("tear_loop", "tear-loop.wav", loopify(crush, 0.04, 0.85, 90), peak=-7)

# tear_snap — the fibrous final rip (+ the real card-pack rip as a variant)
emit("tear_snap", "tear-snap-1.wav", one_shot("paper/WAV/Paper Ripped - 1.wav", -5))
emit("tear_snap", "tear-snap-2.wav", one_shot("casino/**/cards-pack-open-1.ogg", -5))
emit("tear_snap", "tear-snap-3.wav", one_shot("casino/**/cards-pack-open-2.ogg", -5))

# scratch — dry foil surface scuff
for i, n in enumerate(["001", "002", "003", "004"], 1):
    emit("scratch", f"scratch-{i}.wav", one_shot(f"interface/**/scratch_{n}.ogg", -8))

# open_burst — chest-thump (punch body + soft thud, glued)
burst = mix([(one_shot("impact/**/impactPunch_medium_000.ogg", 0, out_ms=20), 1.0, 0),
             (one_shot("impact/**/impactSoft_heavy_000.ogg", 0, out_ms=40), 0.7, 4)])
emit("open_burst", "open-burst-1.wav", burst, peak=-5)
emit("open_burst", "open-burst-2.wav", one_shot("impact/**/impactPunch_medium_001.ogg", -5))

# reveal_impact — the money hit: punch body + bright glass crash blooming after
reveal = mix([(one_shot("impact/**/impactPunch_heavy_000.ogg", 0, out_ms=20), 1.0, 0),
              (one_shot("impact/**/impactGlass_heavy_000.ogg", 0, out_ms=120), 0.55, 6),
              (one_shot("impact/**/impactPlate_heavy_000.ogg", 0, out_ms=120), 0.4, 2)])
emit("reveal_impact", "reveal-impact.wav", reveal, peak=-4)

# riser — reverse a real bell crash → a natural swell that climaxes on the hit
bell = trim_tail(load("impact/**/impactBell_heavy_000.ogg"))[::-1]
emit("riser", "riser.wav", fade(norm(bell, -8), in_ms=30, out_ms=6), peak=-8)

# flick — airy card whoosh
for i, n in enumerate(["1", "3", "5", "7"], 1):
    emit("flick", f"flick-{i}.wav", one_shot(f"casino/**/card-slide-{n}.ogg", -10, out_ms=20))

# setdown — glossy card set-down
for i in range(1, 5):
    emit("setdown", f"setdown-{i}.wav", one_shot(f"casino/**/card-place-{i}.ogg", -8))

# cardtap — quieter card riffle taps
for i, n in enumerate(["2", "4", "6"], 1):
    emit("cardtap", f"cardtap-{i}.wav", one_shot(f"casino/**/card-slide-{n}.ogg", -12, out_ms=15))

# reseal — descending foil/close whoosh
emit("reseal", "reseal.wav", one_shot("interface/**/minimize_003.ogg", -9))

# TONAL ----------------------------------------------------------------------
# chime — a real struck bell (engine pitches it up per tier)
emit("chime", "chime.wav", one_shot("impact/**/impactBell_heavy_000.ogg", -7, out_ms=120))
# sparkle — short glassy twinkle grain (engine scatters many → shimmer)
emit("sparkle", "sparkle.wav", one_shot("interface/**/glass_001.ogg", -9))
# spark — soft high glint on the idle pack
emit("spark", "spark.wav", one_shot("interface/**/glass_003.ogg", -12))
# open_release — bright positive "ah" the instant it pops
emit("open_release", "open-release.wav", one_shot("interface/**/confirmation_001.ogg", -7))
# conclude — a soft positive resolve on the last card
emit("conclude", "conclude.wav", one_shot("interface/**/confirmation_004.ogg", -8))
# pip — tiny UI tick per count pip
emit("pip", "pip.wav", one_shot("interface/**/pluck_001.ogg", -12))
# gulp — juicy round blip for sucking a card into the binder (engine pitches up per card)
emit("gulp", "gulp-1.wav", one_shot("interface/**/drop_001.ogg", -8))
emit("gulp", "gulp-2.wav", one_shot("interface/**/drop_002.ogg", -8))
# reject — dull "nope"
emit("reject", "reject.wav", one_shot("interface/**/error_003.ogg", -8))
# hover — soft tick (desktop gallery)
emit("hover", "hover.wav", one_shot("interface/**/select_001.ogg", -14))

# ---------------------------------------------------------------- manifest + report
os.makedirs(DEST, exist_ok=True)
with open(os.path.join(DEST, "manifest.json"), "w") as f:
    json.dump(out, f, indent=2)

total = 0
print(f"{'cue':14} {'files':40} {'len':>6} {'KB':>6}")
for cue, files in out.items():
    for fn in files:
        x, _ = sf.read(os.path.join(DEST, fn)); kb = os.path.getsize(os.path.join(DEST, fn)) / 1024; total += kb
        print(f"{cue:14} {fn:40} {len(x)/SR:5.2f}s {kb:5.0f}")
print(f"\n{len(out)} cues, {sum(len(v) for v in out.values())} files, {total:.0f} KB total")

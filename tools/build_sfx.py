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
#   cc100/     OpenGameArt "100 CC0 SFX" (100-CC0-SFX_0.zip) — gongs/bells/glass/metal
#              https://opengameart.org/content/100-cc0-sfx
# Plus one CC-BY 3.0 file (attribution required — see assets/sfx/README.md), in SRC root:
#   shimmer_1.flac  OpenGameArt "Shimmer glitter magic" by ViRiX Dreamcore (David Mckee)
#              https://opengameart.org/content/shimmer-glitter-magic
import soundfile as sf, numpy as np, glob, os, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
SC   = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, "..", "_sfxsrc")
DEST = os.path.abspath(os.path.join(HERE, "..", "assets", "sfx"))
SR   = 44100
np.random.seed(7)                                      # reproducible noise/swell layers

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

def mix(layers):                                       # [(sig, gain, offset_ms)] — start-aligned
    N = max(len(s) + int(o * SR / 1000) for s, g, o in layers)
    buf = np.zeros(N, np.float32)
    for s, g, o in layers:
        off = int(o * SR / 1000); buf[off:off + len(s)] += s * g
    return buf

def rev(x):                                            # reverse (decay → swell)
    return x[::-1].copy()

def at_end(sig, L):                                    # right-align a swell so its climax lands at L
    out = np.zeros(L, np.float32); s = sig[-L:] if len(sig) > L else sig
    out[L - len(s):] = s
    return out

def highshelf(x, f0=3000, gain_db=8):                  # lift the highs → paper reads as metallic foil
    X = np.fft.rfft(x); fr = np.fft.rfftfreq(len(x), 1 / SR)
    H = 1 + (10 ** (gain_db / 20) - 1) / (1 + (f0 / np.maximum(fr, 1e-6)) ** 2)
    return np.fft.irfft(X * H, len(x)).astype(np.float32)

def sub_drop(f0=120, f1=46, dur=0.5, decay=4.5):       # a felt sine sub-bass drop (synth body)
    n = int(dur * SR); t = np.arange(n) / SR; k = np.log(f1 / f0) / dur
    sig = np.sin(2 * np.pi * f0 * (np.exp(k * t) - 1) / k) * np.exp(-t * decay)
    return fade(sig.astype(np.float32), 1, 30)

def noise_swell(dur=1.1, f_hi=9000):                   # rising airy bed (the "tsss" climbing into the hit)
    n = int(dur * SR); nz = np.random.randn(n).astype(np.float32)
    X = np.fft.rfft(nz); fr = np.fft.rfftfreq(n, 1 / SR)
    nz = np.fft.irfft(X / np.sqrt(1 + (fr / f_hi) ** 4), n).astype(np.float32)
    return nz * (np.linspace(0, 1, n) ** 2)            # quadratic swell up

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

# tear_loop — seamless looping FOIL crinkle: a paper crush, high-shelf-lifted so the
# texture reads as bright metallic foil rather than dull paper
crush = highshelf(trim_head(load("paper/WAV/Paper Crushed - 1.wav")), 2800, 9)
emit("tear_loop", "tear-loop.wav", loopify(crush, 0.04, 0.85, 90), peak=-7)

# tear_snap — the foil rip giving way: paper rip brightened + a metallic crackle on top,
# plus the real card-pack rips as round-robin variants
snap = mix([(highshelf(one_shot("paper/WAV/Paper Ripped - 1.wav", 0, out_ms=20), 3000, 7), 1.0, 0),
            (one_shot("cc100/metal_09.ogg", 0, out_ms=30), 0.5, 4),
            (one_shot("cc100/glass_03.ogg", 0, out_ms=20), 0.3, 0)])
emit("tear_snap", "tear-snap-1.wav", snap, peak=-5)
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

# reveal_impact — THE money hit, layered like a cinematic stinger:
#   sub-bass drop (felt) + punch body + explosion crack + deep gong bloom +
#   bright glass "tsss" transient + a magical shimmer on top
reveal = mix([(sub_drop(120, 46, 0.5),                                       0.9,  0),
              (one_shot("impact/**/impactPunch_heavy_000.ogg", 0, out_ms=20),1.0,  0),
              (one_shot("cc100/explosion.ogg", 0, out_ms=80),                0.7,  0),
              (norm(trim_head(load("cc100/gong_02.ogg")), 0),                0.5,  6),
              (one_shot("cc100/glass_01.ogg", 0, out_ms=80),                 0.5,  4),
              (norm(trim_head(load("shimmer_1.flac")), 0),                   0.45, 20)])
emit("reveal_impact", "reveal-impact.wav", reveal, peak=-4)

# riser — reverse-cymbal anticipation: a reversed bright gong + reversed glass + a
# rising noise bed, all climaxing together on the hit (engine time-stretches to fit)
L = int(1.15 * SR)
riser = (at_end(rev(norm(trim_tail(load("cc100/gong_01.ogg")), 0)), L) * 0.8
       + at_end(rev(norm(trim_tail(load("cc100/glass_03.ogg")), 0)), L) * 0.35
       + noise_swell(1.15, 9000) * 0.5)
emit("riser", "riser.wav", fade(riser, in_ms=40, out_ms=6), peak=-8)

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
# chime — a bright magical bell with a glitter shimmer struck into its attack
#         (engine pitches it up per tier)
chime = mix([(norm(trim_head(load("cc100/bell_03.ogg")), 0),       1.0,  0),
             (norm(trim_head(load("shimmer_1.flac")), 0),          0.4,  0)])
emit("chime", "chime.wav", fade(chime, 1, 120), peak=-7)
# sparkle — a real glitter/shimmer grain (engine scatters many → a shimmer cloud)
emit("sparkle", "sparkle.wav", one_shot("shimmer_1.flac", -9))
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

#!/usr/bin/env python
# Design OpenPack's "luxury" SFX set — the tonal / UI / climax cues — offline, and
# write them as 16-bit mono 44.1k WAV into assets/sfx/.
#
#   pip install soundfile numpy scipy
#   python tools/design_sfx.py
#
# WHY THIS EXISTS: the first foley pack used arcade-style interface blips (Kenney
# Interface), a toy-bell chime, a "glitter magic" sparkle and a synth pentatonic bell
# ladder for the tear — all of which read as cartoonish next to the gold / Ballon d'Or
# art direction. The cues here are PHYSICALLY MODELLED instead of oscillator-synthesised:
#   • modal synthesis of struck crystal (wine-glass partial ratios, split degenerate
#     modes → the slow beating shimmer of real glass), a real bell's partial set (hum /
#     prime / minor-third tierce / quint / nominal), a felt-hammer string, and a large
#     tam-tam whose upper partials BLOOM after the strike;
#   • mechanical "escapement" clicks (an impulse through a few sharp resonators) for the
#     UI ticks — a watch, not a bleep;
#   • STFT-shaped air for the whooshes; sub thumps with tape-style saturation;
#   • the foil CRACK layers in the open / pop are the repo's own recorded foil snaps.
# Everything is rendered dry-ish (the engine has its own reverb send) and peaks at
# ~-6 dB unless a cue is meant to sit softer. All content here is original (no third-
# party samples besides the repo's existing CC0 foil recordings).
import os, json, math
import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.abspath(os.path.join(HERE, "..", "assets", "sfx"))
SR = 44100
rng = np.random.default_rng(20261007)  # reproducible


# ---- primitives --------------------------------------------------------------------
def T(n):
    return np.arange(n) / SR


def sec(d):
    return int(round(d * SR))


def noise(d):
    return rng.standard_normal(sec(d)).astype(np.float64)


def sos_filter(x, kind, f, order=2, q=None):
    nyq = SR / 2
    if kind == "band":
        lo, hi = f
        sos = signal.butter(order, [max(10, lo) / nyq, min(nyq - 100, hi) / nyq], btype="band", output="sos")
    else:
        sos = signal.butter(order, min(nyq - 100, max(10, f)) / nyq, btype=kind, output="sos")
    return signal.sosfilt(sos, x)


def lp(x, f, order=2):
    return sos_filter(x, "low", f, order)


def hp(x, f, order=2):
    return sos_filter(x, "high", f, order)


def bp(x, lo, hi, order=2):
    return sos_filter(x, "band", (lo, hi), order)


def resonator(x, f, q):
    """a sharp 2-pole resonance (peaking bandpass) — one 'mode' of a struck body"""
    b, a = signal.iirpeak(min(f, SR / 2 - 200), q, fs=SR)
    return signal.lfilter(b, a, x)


def exp_env(n, tau, start=1.0):
    return start * np.exp(-T(n) / tau)


def attack(n, ms):
    a = np.ones(n)
    k = min(n, sec(ms / 1000))
    if k > 0:
        a[:k] = (1 - np.cos(np.linspace(0, np.pi, k))) / 2
    return a


def fade(x, in_ms=2, out_ms=10):
    x = x.copy()
    n_in, n_out = min(len(x), sec(in_ms / 1000)), min(len(x), sec(out_ms / 1000))
    if n_in > 0:
        x[:n_in] *= np.linspace(0, 1, n_in)
    if n_out > 0:
        x[-n_out:] *= np.linspace(1, 0, n_out)
    return x


def tail(x, frac=0.25):
    """a raised-cosine fade over the LAST `frac` of a component, so a voice whose envelope
    hasn't reached silence by its end can't stop dead (a click) when it's mixed."""
    x = x.copy()
    k = max(1, int(len(x) * frac))
    x[-k:] *= (1 + np.cos(np.linspace(0, np.pi, k))) / 2
    return x


def saturate(x, drive=1.5):
    return np.tanh(x * drive) / math.tanh(drive)


def norm(x, db=-6.0):
    pk = np.max(np.abs(x))
    return x * (10 ** (db / 20) / pk) if pk > 1e-9 else x


def trim_tail(x, db=-60):
    thr = 10 ** (db / 20)
    nz = np.where(np.abs(x) > thr)[0]
    return x[: nz[-1] + sec(0.02)] if len(nz) else x


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out


def delay(x, d):
    return np.concatenate([np.zeros(sec(d)), x])


def partial(freq, amp, decay, dur, attack_ms=3.0, split_hz=0.0, bloom=0.0, phase=None):
    """one decaying sinusoidal mode. split_hz>0 renders it as a degenerate PAIR beating at
    that rate (how real glass / bells shimmer). bloom>0 = seconds for the mode to swell in
    (a tam-tam's upper partials rise after the strike instead of starting loud)."""
    n = sec(dur)
    tt = T(n)
    env = amp * np.exp(-tt / decay) * attack(n, attack_ms)
    if bloom > 0:
        env *= 1 - np.exp(-tt / bloom)
    ph = rng.uniform(0, 2 * np.pi) if phase is None else phase
    if split_hz > 0:
        # an UNEQUAL pair: the beat breathes (a real glass's shimmer) but never nulls to
        # silence, which would read as a tremolo
        y = 0.64 * np.sin(2 * np.pi * (freq - split_hz / 2) * tt + ph) + 0.36 * np.sin(2 * np.pi * (freq + split_hz / 2) * tt + ph + rng.uniform(0, 1))
    else:
        y = np.sin(2 * np.pi * freq * tt + ph)
    return tail(env * y, 0.2)


def strike(dur_ms=6, lpf=6000, amp=1.0):
    """the mallet / finger contact that excites a body — a few ms of lowpassed noise"""
    n = sec(dur_ms / 1000)
    return amp * lp(noise(dur_ms / 1000), lpf) * np.exp(-T(n) / (dur_ms / 1000 / 3))


def air(dur, fc_fn, bw_oct=0.6, amp_fn=None):
    """air shaped in the STFT domain: white noise masked to a band that follows fc_fn(t)
    (Hz) — the soft, wide 'fwoosh' of a thing moving through the room."""
    x = noise(dur)
    nper = 1024
    f, tt, Z = signal.stft(x, SR, nperseg=nper, noverlap=nper * 3 // 4)
    fc = np.maximum(30, fc_fn(tt))
    lf = np.log2(np.maximum(f, 1))[:, None]
    lc = np.log2(fc)[None, :]
    Z = Z * np.exp(-0.5 * ((lf - lc) / bw_oct) ** 2)
    _, y = signal.istft(Z, SR, nperseg=nper, noverlap=nper * 3 // 4)
    y = y[: len(x)]
    if amp_fn is not None:
        y = y * amp_fn(T(len(y)))
    return tail(y, 0.15)


def sub_thump(f0, f1, dur, tau_pitch=0.05, tau_amp=0.18, drive=2.2, amp=1.0, click=True):
    """a felt body drop: pitch glides f0→f1 fast, amplitude decays slow, tape-saturated so
    a phone speaker still hears its harmonics."""
    n = sec(dur)
    tt = T(n)
    f = f1 + (f0 - f1) * np.exp(-tt / tau_pitch)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-tt / tau_amp) * attack(n, 1.5)
    y = tail(saturate(y, drive) * amp, 0.3)
    if click:
        y = mix(y, 0.25 * amp * lp(strike(2.5, 3000), 2500))
    return y


# ---- reverb (a small, dark, expensive-sounding room — baked lightly) ---------------
def make_ir(rt60=1.4, pre=0.012):
    n = sec(rt60 * 1.3)
    tt = T(n)
    lo = lp(noise(rt60 * 1.3), 350) * np.exp(-6.91 * tt / (rt60 * 1.1))
    mid = bp(noise(rt60 * 1.3), 350, 3500) * np.exp(-6.91 * tt / rt60)
    hi = hp(noise(rt60 * 1.3), 3500) * np.exp(-6.91 * tt / (rt60 * 0.45))
    ir = 0.9 * lo + mid + 0.5 * hi
    ir *= attack(n, 4)  # no slap at t=0
    ir = delay(ir, pre)
    return ir / math.sqrt(np.sum(ir ** 2))


IR_ROOM = make_ir(1.1)
IR_HALL = make_ir(2.6, 0.02)


def reverb(x, wet=0.25, ir=None, hpf=160, lpf=9000):
    ir = IR_ROOM if ir is None else ir
    w = signal.fftconvolve(x, ir)
    w = lp(hp(w, hpf), lpf)
    return mix(x, wet * w)


# ---- instruments -------------------------------------------------------------------
GLASS_RATIOS = [1.0, 2.32, 4.25, 6.63, 9.38]  # the modes of a struck wine-glass bowl


def crystal(freq, dur=1.6, amp=1.0, attack_ms=4.0, decay=1.1, brightness=1.0, split=1.2):
    """a struck crystal glass: inharmonic glass modes, each a split pair that beats
    slowly, and a soft tick where the finger-nail meets the rim."""
    parts = []
    for i, r in enumerate(GLASS_RATIOS):
        f = freq * r
        if f > SR * 0.45:
            break
        a = amp * (0.55 ** i) * (brightness ** i)
        d = decay / (1 + 0.9 * i) * (600.0 / max(freq, 200)) ** 0.35
        parts.append(partial(f, a, d, dur, attack_ms + 1.5 * i, split_hz=split * (0.6 + 0.4 * i) * rng.uniform(0.7, 1.3)))
    body = mix(*parts)
    tick = resonator(strike(4, 9000, 0.9 * amp), freq * 2.32, 12) * 0.12
    return mix(body, tick)


def bell(freq, dur=4.0, amp=1.0, decay=2.4):
    """a real bell's partial set — hum, prime, the MINOR-third tierce, quint, nominal and
    the upper ring — what a toy 'ding' lacks. Low and slow."""
    spec = [  # ratio, amp, decay-scale, split
        (0.5, 0.55, 1.6, 0.4),
        (1.0, 1.0, 1.0, 0.6),
        (1.2, 0.6, 0.8, 0.9),
        (1.5, 0.45, 0.7, 0.8),
        (2.0, 0.5, 0.55, 1.1),
        (2.5, 0.22, 0.4, 1.4),
        (3.0, 0.2, 0.33, 1.6),
        (4.0, 0.12, 0.25, 1.8),
        (5.3, 0.06, 0.18, 2.2),
    ]
    parts = [partial(freq * r, amp * a, decay * d, dur, 2.5 + 3 * r, split_hz=s) for r, a, d, s in spec if freq * r < SR * 0.45]
    clapper = lp(strike(5, 4000, 0.5 * amp), 2500)
    return mix(mix(*parts), clapper)


def felt_string(freq, dur=3.0, amp=1.0, decay=1.8, attack_ms=22.0):
    """a felt-hammer piano string: stiff-string inharmonic harmonics, dark (lowpassed),
    slow attack — soft, warm, expensive."""
    B = 0.00035
    parts = []
    for nn in range(1, 12):
        f = freq * nn * math.sqrt(1 + B * nn * nn)
        if f > SR * 0.45:
            break
        a = amp / nn ** 1.6 * (0.6 if nn % 2 == 0 else 1.0)
        parts.append(partial(f, a, decay / nn ** 0.55, dur, attack_ms, split_hz=0.3 + 0.1 * nn))
    y = mix(*parts)
    return lp(y, 2600)


def tamtam(f0=74.0, dur=3.2, amp=1.0, bloom_scale=1.0, decay=2.6):
    """a large tam-tam: ~40 inharmonic partials; the fundamental speaks at once while the
    upper partials bloom in over a few hundred ms, then the whole thing shimmers away."""
    ratios = np.cumprod(np.concatenate([[1.0], rng.uniform(1.07, 1.19, 40)]))
    parts = []
    for i, r in enumerate(ratios):
        f = f0 * r
        if f > 9000:
            break
        a = amp * r ** -0.55 * rng.uniform(0.6, 1.0)
        bl = (0.03 + 0.5 * (r / 24) ** 0.8) * bloom_scale if i > 2 else 0.0
        d = decay * (1.0 / (1 + 0.08 * i)) * rng.uniform(0.75, 1.1)
        parts.append(partial(f, a, d, dur, 2.0, split_hz=rng.uniform(0.3, 1.6), bloom=bl))
    body = mix(*parts)
    # the strike — a soft mallet thud into the low modes
    thud = resonator(lp(strike(14, 1500, 1.0), 900), f0 * 1.0, 3) * 0.5
    return mix(body, 2.2 * thud)


def click(f_modes=(2400, 5100), q=(18, 10), body=(540, 25), dur=0.045, amp=1.0, lpf=7000):
    """a mechanical escapement click: a 1.5 ms impulse through sharp metal resonators and
    a short wooden body mode — a watch, a lighter lid, a camera shutter. Dry."""
    imp = strike(1.5, 14000, 1.0)
    imp = np.concatenate([imp, np.zeros(sec(dur) - len(imp))])
    y = sum(resonator(imp, f, qq) * (0.9 ** i) for i, (f, qq) in enumerate(zip(f_modes, q)))
    y = y * np.exp(-T(len(y)) / 0.009)
    wood = resonator(imp, body[0], body[1]) * np.exp(-T(len(y)) / 0.02) * 1.6
    y = lp(mix(y, wood), lpf)
    return fade(y * amp, 0.3, 6)


# ---- the cues ----------------------------------------------------------------------
OUT = {}


def put(name, x, db=-6.0, trim_db=-50):
    x = fade(trim_tail(norm(x, db), trim_db), 0.5, 12)
    OUT[name] = x.astype(np.float32)


def n2f(note):
    """MIDI note number → Hz"""
    return 440.0 * 2 ** ((note - 69) / 12)


def build():
    # ---- UI ticks: escapement clicks, not bleeps -------------------------------------
    # pip — the count ticks (engine pitches 0.8×–1.55×) + the status pips
    put("pip.wav", reverb(click((2600, 5400), (20, 11), (620, 28)), 0.05), -9, trim_db=-42)
    # hover — the gallery hover, softer + lower
    put("hover.wav", click((1900, 4200), (14, 9), (480, 22), dur=0.035, lpf=5500), -15, trim_db=-42)

    # ---- the idle glint on the sealed pack — a breath of crystal, not a 'ding' ------
    g = mix(
        crystal(n2f(93), dur=0.5, attack_ms=9, decay=0.22, brightness=0.8, amp=0.9),   # A6
        0.35 * crystal(n2f(100), dur=0.35, attack_ms=12, decay=0.14, brightness=0.6),  # E7 whisper
        0.12 * air(0.22, lambda t: 6500 + 2500 * t / 0.22, 0.5, lambda t: np.exp(-t / 0.06)),
    )
    put("spark.wav", reverb(g, 0.18, IR_HALL, 800, 12000), -14, trim_db=-48)

    # ---- sparkle grains — the engine scatters many at random pitch (0.9–1.5×) --------
    # crystal pings tuned to a G-major-7 cluster so any random handful rings as a chord;
    # short, so forty of them shimmer instead of washing into one sustained cluster
    for i, note in enumerate([79, 83, 86, 90]):  # G5 B5 D6 F#6
        s = crystal(n2f(note), dur=0.4, attack_ms=5, decay=0.13 + 0.02 * i, brightness=0.85, amp=1.0, split=0.8)
        put(f"sparkle-{i + 1}.wav", reverb(s, 0.1, IR_HALL, 600, 12000), -13, trim_db=-45)

    # ---- the tear's chime-up ladder: ten struck crystals climbing C minor pentatonic ---
    # (the engine plays ladder[step] as the rip / strain advances; a Picardy resolve to
    # C MAJOR arrives with open_release when the pack gives way)
    ladder = [60, 62, 63, 67, 70, 72, 74, 75, 79, 82]  # C4 D4 Eb4 G4 Bb4 C5 D5 Eb5 G5 Bb5
    for i, note in enumerate(ladder):
        s = crystal(n2f(note), dur=1.3, attack_ms=5, decay=0.85, brightness=0.9 + 0.02 * i, amp=1.0, split=0.6)
        under = 0.22 * felt_string(n2f(note - 12), dur=1.0, decay=0.5, attack_ms=8)  # a warm octave-down body
        put(f"ladder-{i:02d}.wav", reverb(mix(s, under), 0.1, IR_ROOM, 200, 11000), -10)

    # ---- the strain loop: foil under tension (from the real rip recording) -----------
    x, sr = sf.read(os.path.join(DEST, "tear-loop.wav"), dtype="float64")
    assert sr == SR
    slow = signal.resample(x, len(x) * 2)  # half speed, an octave down: tension, not tearing
    slow = lp(hp(slow, 120), 2600)
    k = sec(0.08)  # seamless: cross-fade the head into the tail
    loop = slow[: len(slow) - k].copy()
    loop[:k] = loop[:k] * np.linspace(0, 1, k) + slow[-k:] * np.linspace(1, 0, k)
    put("strain-loop.wav", loop, -8)

    # ---- the pop — the back seal lets go ("pong") -------------------------------------
    snaps = [sf.read(os.path.join(DEST, f"tear-snap-{i}.wav"), dtype="float64")[0] for i in (1, 2, 3)]
    crack = hp(snaps[0][: sec(0.09)], 1200) * np.exp(-T(sec(0.09)) / 0.03)
    pong = mix(
        sub_thump(240, 95, 0.32, tau_pitch=0.035, tau_amp=0.07, drive=1.8, amp=1.0),
        0.9 * crack,
        0.35 * air(0.26, lambda t: 1800 * np.exp(-t / 0.12) + 200, 0.8, lambda t: np.exp(-t / 0.08)),
    )
    put("pop.wav", reverb(pong, 0.2, IR_ROOM, 120, 9000), -6)

    # ---- the open: a cinematic whump + the real foil crack + a fwoosh of released air ---
    for v in (1, 2):
        cr = hp(snaps[v][: sec(0.08)], 1500) * np.exp(-T(sec(0.08)) / 0.025)
        whump = mix(
            sub_thump(92 - 4 * v, 44, 0.6, tau_pitch=0.06, tau_amp=0.22, drive=2.4, amp=1.0),
            0.6 * lp(noise(0.16), 420) * np.exp(-T(sec(0.16)) / 0.045),      # low-mid body
            0.55 * cr,
            0.4 * air(0.42, lambda t: 700 + 2600 * (1 - np.exp(-t / 0.1)), 0.9, lambda t: np.minimum(1, t / 0.02) * np.exp(-t / 0.14)),
        )
        put(f"open-burst-{v}.wav", reverb(whump, 0.22, IR_ROOM, 110, 9000), -6)

    # ---- open_release: the Picardy bloom — C major in crystal over a breath of air -----
    chord = [(72, 0.0, 1.0), (76, 0.03, 0.8), (79, 0.06, 0.7), (84, 0.1, 0.55), (88, 0.15, 0.3)]  # C5 E5 G5 C6 E6
    voices = [delay(crystal(n2f(n), dur=1.9, attack_ms=7, decay=1.2, brightness=0.9, amp=a), d) for n, d, a in chord]
    breath = 0.2 * air(0.5, lambda t: 400 + 2200 * (1 - np.exp(-t / 0.15)), 0.9, lambda t: np.sin(np.minimum(np.pi, np.pi * t / 0.5)) ** 1.5)
    hum = 0.35 * bell(n2f(48), dur=2.0, decay=1.2)  # a low C3 hum under the bloom
    put("open-release.wav", reverb(mix(mix(*voices), breath, hum), 0.3, IR_HALL, 160, 11000), -7)

    # ---- the money moment: boom + tam-tam bloom + crystal shimmer -------------------
    boom = sub_thump(118, 48, 0.9, tau_pitch=0.07, tau_amp=0.3, drive=2.6, amp=1.0)
    gong = tamtam(74.0, dur=3.4, amp=1.0, bloom_scale=1.0, decay=2.4)
    gong = hp(gong, 55)
    shimmer = mix(*[delay(crystal(n2f(n), dur=2.2, attack_ms=10, decay=1.3, brightness=0.85, amp=a), d)
                    for n, d, a in [(84, 0.06, 0.5), (91, 0.1, 0.4), (96, 0.16, 0.3), (103, 0.24, 0.2)]])  # C6 G6 C7 G7
    swell = 0.12 * air(1.6, lambda t: 1800 + 1800 * (1 - np.exp(-t / 0.3)), 0.9, lambda t: np.minimum(1, t / 0.05) * np.exp(-t / 0.45))
    impact = mix(1.0 * boom, 0.75 * gong, 0.3 * shimmer, swell)
    put("reveal-impact.wav", reverb(impact, 0.22, IR_HALL, 90, 12000), -5)

    # ---- the riser: the tam-tam REVERSED (the classic cinematic swell) + rising air + a
    #      low tension tone — the engine time-stretches it to the hold so the peak lands
    rg = tamtam(70.0, dur=1.7, amp=1.0, bloom_scale=0.6, decay=1.4)
    rev_gong = hp(rg[::-1], 60) * attack(len(rg), 60)
    tension = partial(46, 1.0, 9.0, 1.7, 200, split_hz=0.8) * np.linspace(0.0, 1.0, sec(1.7)) ** 1.6
    rise = 0.3 * air(1.7, lambda t: 260 * 2 ** (t / 1.7 * 3.8), 0.7, lambda t: (t / 1.7) ** 2.2)
    crys = hp(mix(*[crystal(n2f(n), dur=1.7, attack_ms=10, decay=0.9, amp=0.3) for n in (72, 79, 84)])[::-1], 300)
    riser = mix(rev_gong, 0.6 * saturate(tension, 1.6), rise, 0.3 * crys)
    riser = riser * np.linspace(0.15, 1.0, len(riser)) ** 0.7
    put("riser.wav", riser, -6)

    # ---- the rare-hit chime: a slow crystal Cmaj9 over a real low bell --------------
    arp = [(72, 0.0, 1.0), (76, 0.07, 0.85), (79, 0.14, 0.75), (83, 0.21, 0.65), (86, 0.29, 0.55), (91, 0.38, 0.4)]  # C5 E5 G5 B5 D6 G6
    voices = [delay(crystal(n2f(n), dur=2.6, attack_ms=6, decay=1.5, brightness=0.9, amp=a), d) for n, d, a in arp]
    low = 0.5 * bell(n2f(48), dur=3.0, decay=1.8)  # C3
    put("chime.wav", reverb(mix(mix(*voices), low), 0.28, IR_HALL, 150, 12000), -6)

    # ---- conclude: the haul settles on a felt-piano cadence ------------------------
    cad = mix(
        felt_string(n2f(48), dur=3.0, decay=2.2, amp=1.0),                # C3
        felt_string(n2f(55), dur=3.0, decay=2.0, amp=0.7),                # G3
        delay(felt_string(n2f(64), dur=2.6, decay=1.8, amp=0.6), 0.02),   # E4
        delay(felt_string(n2f(71), dur=2.4, decay=1.6, amp=0.35), 0.04),  # B4 (maj7 — not a nursery triad)
        delay(0.3 * crystal(n2f(76), dur=1.8, attack_ms=12, decay=1.0, brightness=0.8), 0.16),  # E5 glint falling to…
        delay(0.25 * crystal(n2f(72), dur=1.8, attack_ms=12, decay=1.1, brightness=0.8), 0.42),  # …C5
    )
    put("conclude.wav", reverb(cad, 0.3, IR_HALL, 120, 9000), -7)

    # ---- reseal: the halves slide shut — a falling breath of air and a soft lid "thup" ---
    whoosh = air(0.55, lambda t: 3800 * np.exp(-t / 0.22) + 180, 0.8, lambda t: np.sin(np.minimum(np.pi, np.pi * t / 0.5)) ** 1.2)
    thup = delay(mix(sub_thump(160, 70, 0.16, tau_pitch=0.02, tau_amp=0.05, drive=1.5, amp=0.7, click=False),
                     0.5 * lp(noise(0.05), 900) * np.exp(-T(sec(0.05)) / 0.012)), 0.4)
    put("reseal.wav", reverb(mix(whoosh, thup), 0.15, IR_ROOM, 120, 8000), -8)

    # ---- reject: a damped low knock — the lock that doesn't give --------------------
    imp = strike(3, 2500, 1.0)
    imp = np.concatenate([imp, np.zeros(sec(0.3) - len(imp))])
    knock = mix(resonator(imp, 175, 9) * 2.5, resonator(imp, 330, 7), resonator(imp, 610, 5) * 0.5)
    knock = knock * np.exp(-T(len(knock)) / 0.07)
    thud = 0.8 * lp(noise(0.08), 300) * np.exp(-T(sec(0.08)) / 0.02)
    put("reject.wav", lp(mix(knock, thud), 1800), -9)

    # ---- the walkout / rare tiers: engine also pitches chime up; nothing extra needed ---
    return OUT


def spectral_centroid(x):
    X = np.abs(np.fft.rfft(x))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float(np.sum(f * X) / max(np.sum(X), 1e-9))


if __name__ == "__main__":
    out = build()
    os.makedirs(DEST, exist_ok=True)
    for name, x in out.items():
        sf.write(os.path.join(DEST, name), np.clip(x, -1, 1), SR, subtype="PCM_16")
    print(f"{'file':22s} {'dur':>6s} {'peak':>6s} {'rms':>6s} {'centroid':>8s}")
    for name, x in out.items():
        pk = 20 * math.log10(max(np.max(np.abs(x)), 1e-9))
        rms = 20 * math.log10(max(np.sqrt(np.mean(x ** 2)), 1e-9))
        print(f"{name:22s} {len(x) / SR:6.2f} {pk:6.1f} {rms:6.1f} {spectral_centroid(x):8.0f}")

# Recorded sound effects (`assets/sfx/`)

The pack-opening audio engine ([`src/sfx.js`](../../src/sfx.js)) **prefers a sample**
for each cue and falls back to its built-in synthesis when no sample is present. So
this folder is how the game's sound is authored — **drop in audio files, list them in
[`manifest.json`](manifest.json), done.** No code changes needed.

The set is in two halves:

- **Physical foley** (handling, card flicks, the rip) — real recordings, built by
  `tools/build_sfx.py` from CC0 packs (see *Sources*).
- **The tonal / UI / climax cues** — **modelled, not sampled**, rendered offline by
  [`tools/design_sfx.py`](../../tools/design_sfx.py): struck crystal (wine-glass modes
  with the slow beating of real glass), a bell with a real bell's partial set (hum,
  prime, the minor-third tierce, quint, nominal), a felt-hammer string, a large tam-tam
  whose upper partials bloom after the strike, and watch-escapement clicks for the UI.
  These replaced the first pack's arcade interface blips, toy bell chime, "glitter magic"
  sparkle and the synth pentatonic bell ladder — all of which read as cartoonish next
  to the gold art direction. The palette is deliberately **dark, low and restrained**:
  C-minor pentatonic crystal climbing through the tear, a Picardy lift to C major when
  the pack gives way, a Cmaj9 crystal arpeggio over a low C3 bell for the hit, and a
  felt-piano maj7 cadence to close. Re-render with `python tools/design_sfx.py`.

## How it works

- At load the engine fetches `manifest.json` and decodes every file listed. Each cue
  that got at least one buffer plays the **sample**; every other cue keeps using
  **synthesis**. A missing/empty manifest = pure synthesis, with **no console errors**.
- List **multiple files** for a cue to get **round-robin variation** (recommended for
  anything that fires repeatedly: `flick`, `setdown`, `cardtap`, `sparkle`, `grab`,
  `scratch`, `tear_snap`). The engine also adds a little pitch/level jitter on top.
- **`ladder` is the one ORDERED cue**: its files are rungs, low → high, and the engine
  plays rung *k* as the tear (or the back pull's strain) reaches step *k* of ten.
- Paths in the manifest are **relative to this folder**.

## Format

- **`.wav`, `.mp3`, `.ogg`, or `.m4a`** — anything the browser's `decodeAudioData`
  accepts. `.wav` (or 192 kbps+ `.mp3`) is safest. Mono is fine and smaller.
- **Trim hard to the transient** — no leading silence (the engine fires at the exact
  game moment; pre-roll = audible lag). Keep one-shots tight.
- Bake them roughly **−6 dB peak** (UI ticks and glints sit lower, −9 to −15); the
  master bus has the final limiter + makeup, so don't pre-limit to the ceiling.
- They go through a band-limited reverb send already — keep them **dry** (the climax
  cues carry a little baked room because their tails *are* the sound).

## The cues — what each sound is, and how the engine drives it

| Cue (`manifest` key) | The moment | What it is now | Engine behaviour |
|---|---|---|---|
| `grab` | you first touch the pack | a short muffled **foil crinkle / handle** | round-robin + pitch jitter |
| `tear_loop` | dragging the rip open (fallback when `tear_rip` is absent) | a **seamless looping** foil tear crackle | looped; gain + brightness + speed track your pull velocity |
| `tear_rip` | the top rip, start to finish | one **long wrapper crinkle** recording | **scrubbed by the rip**: the playhead advances only while the tear advances |
| `tear_snap` | the rip completes | the **fibrous final snap** | one-shot; gain scales with tear speed |
| `ladder` | the rip / the back pull advancing | **ten struck crystals**, C4 → Bb5 up C-minor pentatonic, each over a warm octave-down string | ordered: rung *k* at step *k*; climbs louder; a touch of room |
| `strain_loop` | hauling on the back seam | the rip recording at **half speed, darkened** — foil under tension, not tearing | looped; gain + pitch + brightness track how hard you pull |
| `pop` | the back seal lets go — "pong" | a **tight pouch pop**: a fast pitch-drop body + the real foil crack + a puff of air | one-shot; gain scales with pull speed |
| `open_release` | the instant it gives way | the **Picardy bloom** — C major in crystal over a breath of air and a low bell hum | one-shot, layered over `open_burst` |
| `scratch` | dragging the middle (no tear) | a light dry **surface scuff** on foil | gain scales with drag speed; round-robin |
| `open_burst` | the pack bursts open | a **cinematic whump**: saturated sub drop + low body + the recorded foil crack + a fwoosh of released air | gain ↑ with power, pitch ↓ for rarer pulls |
| `reveal_impact` | a rare card uncovers | the **money-moment downbeat**: a felt boom under a **tam-tam bloom** and a high crystal shimmer | gain ↑ / pitch ↓ with tier |
| `riser` | anticipation before a rare | the **tam-tam reversed** + rising air + a low tension tone | **time-stretched** to the hold so its peak lands on `reveal_impact` |
| `chime` | the rare "hit" | a slow **crystal Cmaj9 arpeggio** over a low C3 bell | slight pitch-up for rarer tiers |
| `sparkle` | glitter over the hit | four short **crystal pings** (G5 B5 D6 F#6) | the engine **scatters many** with random pitch + timing → shimmer |
| `flick` | tap a card to the next | an airy **card whoosh / flick** | round-robin + jitter |
| `setdown` | the hand lands on arrival | a soft **glossy card set-down** | round-robin + jitter |
| `cardtap` | deeper cards riffle in / a pack docks | a quiet **card-on-card riffle tap** | quieter the deeper the card; round-robin |
| `pack_in` | a pack flies into the carousel ring | *(none yet — falls back to `flick`)* | pitched up per pack so the queue ascends |
| `pip` | the count ticks / status pips | a **watch-escapement click** (an impulse through two metal modes and a wooden body) | pitched up as the count climbs |
| `spark` | idle edge glints on the sealed pack | a soft **breath of high crystal** (A6 + an E7 whisper) | jitter (fires every few seconds) |
| `reject` | a tear is voided (hooks back) | a **damped low knock** — the lock that doesn't give | one-shot |
| `reseal` | "Open another" / halves close | a **falling breath of air** and a soft lid "thup" | one-shot |
| `conclude` | "that's the pack" (last card) | a **felt-piano cadence** (C3 G3 E4 B4) with a crystal E5 → C5 | one-shot |
| `hover` | hovering a gallery card (desktop) | a smaller, lower escapement click | round-robin + jitter |

## Sources & licenses

Everything here is redistributable with **no attribution required**:

- The modelled cues (`pip`, `hover`, `spark`, `sparkle-*`, `ladder-*`, `pop`,
  `open-burst-*`, `open-release`, `reveal-impact`, `riser`, `chime`, `conclude`,
  `reseal`, `reject`) are **original**, generated by `tools/design_sfx.py`. The foil crack
  inside `pop` / `open-burst-*` and the `strain-loop` are derived from the CC0 foil
  recordings below.
- **Kenney** (https://kenney.nl) — CC0 — *Casino Audio* (card slide/place/fan, pack
  take-out & rip → `flick`, `setdown`, `cardtap`, `grab`), *Interface Sounds* (`scratch`).
- **"Various Paper Sound Effects"**, OpenGameArt — CC0 — the foil `tear_loop` / `tear_snap`.
- `rip-crinkle.mp3` — the wrapper-crinkle recording supplied for the scrubbed top rip.

The earlier CC-BY "Shimmer glitter magic" sparkle is gone, so there is no longer any
credit obligation.

To replace any cue, drop your own file in and edit `manifest.json` — no code changes.

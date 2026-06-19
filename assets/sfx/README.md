# Recorded sound effects (`assets/sfx/`)

The pack-opening audio engine ([`src/sfx.js`](../../src/sfx.js)) **prefers a recorded
foley sample** for each cue and falls back to its built-in synthesis when no sample
is present. So this folder is how you replace the "synthy" sounds with the real thing
— **drop in audio files, list them in [`manifest.json`](manifest.json), done.** No code
changes needed.

## How it works

- On the first user gesture the engine fetches `manifest.json` and decodes every file
  listed. Each cue that got at least one buffer now plays the **sample**; every other
  cue keeps using **synthesis**. A missing/empty manifest = pure synthesis (today's
  sound), with **no console errors** — so you can migrate one cue at a time.
- List **multiple files** for a cue to get **round-robin variation** (recommended for
  anything that fires repeatedly: `flick`, `setdown`, `cardtap`, `spark`, `grab`,
  `scratch`, `tear_snap`). The engine also adds a little pitch/level jitter on top.
- Paths in the manifest are **relative to this folder**.

## Format

- **`.wav`, `.mp3`, `.ogg`, or `.m4a`** — anything the browser's `decodeAudioData`
  accepts. `.wav` (or 192 kbps+ `.mp3`) is safest. Mono is fine and smaller.
- **Trim hard to the transient** — no leading silence (the engine fires at the exact
  game moment; pre-roll = audible lag). Keep one-shots tight.
- Bake them roughly **−6 dB peak**; the master bus has the final limiter + makeup, so
  don't pre-limit to the ceiling.
- They go through a band-limited reverb send already — record **dry**.

## The cues — what each sound is, and how the engine drives it

| Cue (`manifest` key) | The moment | What to record | Engine behaviour |
|---|---|---|---|
| `grab` | you first touch the pack | a short muffled **foil crinkle / handle** (~80–150 ms) | round-robin + pitch jitter |
| `tear_loop` | dragging the rip open | a **seamless looping** foil/paper tear crackle (1–2 s, loopable) | looped; gain **+ brightness + speed track your pull velocity** |
| `tear_snap` | the rip completes | the **fibrous final snap** as it gives way | one-shot; gain scales with tear speed |
| `open_release` | the instant it pops open | a small **joyful release** — a bright chime/pop resolve (the satisfying "ah") | one-shot, layered over `open_burst` |
| `scratch` | dragging the middle (no tear) | a light dry **surface scuff** on foil | gain scales with drag speed; round-robin |
| `open_burst` | the pack bursts open | the **chest-thump open** — a punchy whump (foil pop + body) | gain ↑ with power, pitch ↓ for rarer pulls |
| `reveal_impact` | a rare card uncovers | the **money-moment downbeat** — a boom/cymbal-swell hit | gain ↑ / pitch ↓ with tier — the bigger the rarity, the bigger the hit |
| `riser` | anticipation before a rare | a **rising whoosh / swell** (a sweetener works great) | **time-stretched** to fit the hold so its climax lands on `reveal_impact` |
| `chime` | the rare "hit" jingle | a bright **bell / chime cascade** (a real bell beats any synth here) | slight pitch-up for rarer tiers |
| `sparkle` | glitter over the hit | a **single short sparkle/twinkle** grain | the engine **scatters many** of these with random pitch + timing → shimmer |
| `flick` | tap a card to the next | an airy **card whoosh / flick** | round-robin + jitter (fires a lot — give it 2–3 variants) |
| `setdown` | the hand lands on arrival | a soft **glossy card set-down** (a "pap" + contact click) | round-robin + jitter |
| `cardtap` | deeper cards riffle in | a quiet **card-on-card riffle tap** | quieter the deeper the card; round-robin |
| `pip` | the count pips fade in | a tiny **UI tick / blip** | pitched up per card (ascending) |
| `spark` | idle edge glints on the sealed pack | a soft **high glint / shimmer** | round-robin + jitter (fires every few seconds) |
| `reject` | a tear is voided (hooks back) | a dull descending **"nope" / blocked** stab | one-shot |
| `reseal` | "Open another" / halves close | a descending **foil whoosh** | one-shot |
| `conclude` | "that's the pack" (last card) | a gentle **resolving cadence / chord** | one-shot |
| `hover` | hovering a gallery card (desktop) | a soft **tick** | round-robin + jitter (optional — synth is fine here) |

> Priority if you only do a few: the ones that sound most synthetic today are
> **`chime`**, **`riser`**, **`open_burst`/`reveal_impact`**, and **`tear_loop`**.
> Replacing those four moves the needle most.

> The tear also has a built-in **musical layer** the engine always plays: a rising
> "chime-up" pentatonic bell ladder that climbs with how far you've torn, resolving
> into the `open_release` pop. It layers *over* whatever `tear_loop` you provide, so
> your tear foley supplies the texture while the chime-up supplies the satisfaction.

## Example

Put `tear-loop.wav`, `flick-1.wav`, `flick-2.wav`, `flick-3.wav` in this folder, then:

```json
{
  "tear_loop": ["tear-loop.wav"],
  "flick": ["flick-1.wav", "flick-2.wav", "flick-3.wav"]
}
```

Reload — the tear and the card-flick now play your foley; everything else stays synth
until you add it.

## Bundled sounds & licenses

The `*.wav` files here are a **recorded foley pack**, rebuilt by `tools/build_sfx.py`
(trimmed, normalised to ~−6 dB, and **layered** for the money cues — see below). The
three "satisfying" climax cues are stacked stingers, not single hits:

- **`reveal_impact`** = synth sub-bass drop + impact punch + explosion crack + deep gong
  bloom + bright glass "tsss" + a magical shimmer on top.
- **`riser`** = a **reverse-cymbal** swell (reversed gong + reversed glass + a rising
  noise bed) that climaxes on the hit; the engine time-stretches it to the hold length.
- **`chime`** = a bright bell with a glitter shimmer struck into its attack.
- **`tear_loop`/`tear_snap`** = paper rip/crush, high-shelf-lifted to read as metallic foil.

### Sources & licenses

Almost everything is **CC0 (public domain)** — safe to redistribute, no attribution
needed. Provenance:

- **Kenney** (https://kenney.nl) — CC0 — *Casino Audio* (card slide/place/fan, pack
  take-out & rip → `flick`, `setdown`, `cardtap`, `grab`, `tear_snap`), *Impact Sounds*
  (punch body for `open_burst`/`reveal_impact`), *Interface Sounds* (`scratch`, `spark`,
  `pip`, `gulp`, `reject`, `reseal`, `open_release`, `conclude`, `hover`).
- **"Various Paper Sound Effects"**, OpenGameArt — CC0 — the foil `tear_loop`/`tear_snap`.
- **"100 CC0 SFX"**, OpenGameArt — CC0 — gong/explosion/glass for `reveal_impact` &
  `riser`, the bell for `chime`, metal/glass for the `tear_snap` crackle.

**⚠ One CC-BY 3.0 file — attribution REQUIRED if shipped:**

- **"Shimmer glitter magic"** by **ViRiX Dreamcore (David Mckee)**,
  www.soundcloud.com/virix — OpenGameArt (https://opengameart.org/content/shimmer-glitter-magic),
  licensed **CC-BY 3.0**. Used as the `sparkle` grain and the shimmer layer in
  `reveal_impact` + `chime`. **Credit him somewhere user-visible** (about screen / credits)
  if you ship this. To drop the attribution requirement entirely, swap `sparkle.wav` for a
  CC0 twinkle and rebuild the two layered cues without the shimmer layer.

To replace any cue, drop your own file in and edit `manifest.json` — no code changes.

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

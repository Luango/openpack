# OpenPack

A Pokémon TCG card gallery for the browser. Pick any set ever printed, browse
its cards in a responsive grid, filter by rarity, and open any card in a
**lightbox** that tilts toward your pointer with per-rarity holographic foil and
flips over to a custom card back — the "poke-holo" feel, rendered entirely in CSS.

No build step, no framework, no dependencies. Just vanilla ES modules and a
tiny static server.

## Quick start

```sh
python serve.py        # serves the current dir on http://127.0.0.1:8123
python serve.py 8080   # …or pick a port
```

Then open <http://127.0.0.1:8123/>.

> `serve.py` is `http.server` with caching disabled — it sends `no-store` on
> every response so a reload always fetches the current modules (the preview
> webview otherwise holds onto stale JS between edits).

## Deploy

Hosted on **Vercel** (static, no build step) at **<https://openpack.vercel.app>**.
It's pure HTML/CSS/ES-modules, so Vercel just serves the repo root — `serve.py` is
local-dev only. [`vercel.json`](vercel.json) sets `Cache-Control: must-revalidate`
on everything so a redeploy is picked up immediately (no content-hashing here, so
nothing must cache stale); [`.vercelignore`](.vercelignore) keeps dev-only files
out of the deploy. To ship: `vercel deploy --prod` from the repo (the CLI is linked
to the `openpack` project).

## Data

- **Open Pack** builds its booster from a **local snapshot** bundled in
  [`src/pool.js`](src/pool.js) — no realtime API call, so the pack arms instantly
  (that fetch was the old "Preparing pack…" wait). Card *art* still streams from
  the TCG image CDN (browser-cached + preloaded as you tear), but the metadata +
  rarities are local. To refresh or swap the set, re-run the snapshot and replace
  the file (the recipe is in the header of [`src/pool.js`](src/pool.js)).
- **The gallery** still pulls live from the [Pokémon TCG API](https://pokemontcg.io/)
  (`v2`), since it browses *every set ever printed*:
  - the **set list** (`/v2/sets`, newest first) populates the picker
  - a **set's cards** (`/v2/cards`) are paged in and cached per set id

  Both calls work without auth at a lower rate limit. To raise it, grab a free
  key at <https://dev.pokemontcg.io/> and paste it into `API_KEY` in
  [`src/api.js`](src/api.js).

## Features

- **Every set, newest first** — full set list, sorted by release date.
- **Natural card order** — cards sort by the numeric part of their number, so
  `1, 2, … 23, TG01, GG70` lands in sensible set order.
- **Rarity filter** with two modes:
  - **All** — multi-select; everything shows, click a chip to hide/show a rarity.
  - **Only** — single-select; click a chip to isolate that one rarity.
  - Your intent persists across set changes.
- **Holo toggle** — switches the holographic foil VFX on/off; persisted to
  `localStorage`.
- **Lightbox** — click any card to open it face-up: a spring-driven tilt follows
  the pointer with momentum (so the near corner grows in perspective), with a
  tracking glare and a tier-appropriate foil that shifts as you move. Hold and
  swipe to flip it over to the card back.
- **Sound design** — the whole experience is scored with **synthesized** Web Audio
  (no audio files; unlocked on first interaction): a foil crinkle as you grab the
  pack, a speed-tracked rip, a chest-thump open, an anticipation riser that lands on
  a tier-scaled **reveal impact** before the rare chime, plus the gallery's hover
  tick. It runs through a phone-tuned master bus (soft limiter + makeup, sub
  high-passed, a band-limited reverb) and rarity threads the loudest moments (the
  tear, the open, the hit). A **volume + mute** control sits top-right and persists.

## How rarity works

Rarity vocabulary varies wildly across TCG eras, so OpenPack derives a **tier
(0–9)** from rarity *keywords* rather than a fixed list. The tier is the single
source of truth that drives everything downstream:

| Tier | Rarity | Foil in lightbox |
|------|--------|------------------|
| 0 | Common / Promo | none (matte) |
| 1 | Uncommon | none (matte) |
| 2 | Rare | subtle silver shimmer |
| 3 | Holo | single-hue cosmos holo |
| 4 | Double Rare | single-hue cosmos holo |
| 5 | Ultra Rare | rainbow linear foil |
| 6 | Illustration Rare | rainbow linear foil |
| 7 | Special Illustration | rainbow linear foil |
| 8 | Secret / Rainbow | dense cross-hatched rainbow |
| 9 | Hyper | dense cross-hatched rainbow |

The filter sorts chips low → high tier, the grid glows by tier, and the lightbox
foil is chosen by tier — all from one mapping in
[`src/rarity.js`](src/rarity.js).

## Project layout

```
.
├── index.html        the app — opens straight into the pack tear-to-open
├── serve.py          no-cache static server
├── docs/             design specs (e.g. the pack tear & exit)
└── src/
    ├── api.js        Pokémon TCG API wrapper (paging + per-set cache)
    ├── rarity.js     rarity → tier mapping; the single source of truth
    ├── card.js       the Card component — one template, grid + detail variants
    ├── pack.js       OpenPack: SVG pack that tears open along a finger-drawn path
    ├── booster.js    assembles one booster from the local pool (rarest last)
    ├── pool.js       LOCAL bundled card snapshot — the pack opens with no API fetch
    ├── reveal.js     card-stack reveal: cards rise from the opened pack
    ├── motion.js     shared spring engine (rAF integrator) behind the pack tear
    ├── particles.js  tiny canvas particle system — foil flecks + sparks
    ├── sfx.js        Web Audio engine + every cue: phone-tuned master bus, grab, tear, open burst, reveal impact, chime; volume/mute
    ├── util.js       escapeHtml / escapeAttr / delegated events
    ├── base.css      design tokens, layout, toolbar/chips/toggles chrome
    └── card.css      the Card component: grid tiles, detail card, holo VFX
```

## Architecture notes

- **One Card, two variants.** [`card.js`](src/card.js) renders a single template
  in `grid` (flat thumbnail + meta overlay) or `detail` (a flat double-sided
  card — front face + back face). Both carry `.tier-N` + `data-vfx`, so a card
  inherits its look purely from its rarity — no per-card wiring.
- **Perspective on the parent.** The detail card foreshortens because
  `#lightbox-host` (its direct parent) carries the `perspective` — so tilting it
  makes the near corner grow and the far corner shrink. It must be the *direct*
  parent, or an `transform-style: flat` element in between flattens it to an
  orthographic skew. Flip is just an accumulated `rotateY`; `backface-visibility`
  hides whichever face is turned away.
- **Spring, not transition.** Gesture motion is rAF-driven by a shared engine in
  [`motion.js`](src/motion.js) — a velocity integrator with stiffness / damping
  constants, so it follows the pointer with momentum and eases back to rest. The
  lightbox (tilt/flip/scale) and the pack (tear fling + recombine) both drive
  their motion through it, so the feel stays consistent. The lightbox tuning is
  matched to [Simey's poke-holo](https://poke-holo.simey.me/).
- **One pack, shared parts.** The OpenPack prototype ([`pack.js`](src/pack.js),
  hosted by [`index.html`](index.html)) is an SVG pack you tear open by dragging a
  path across it: the rip propagates along your finger, splits into two
  complementary pieces, and the smaller one flies off while the body stays. It
  reuses the same `motion.js` spring, [`particles.js`](src/particles.js) flecks,
  and [`sfx.js`](src/sfx.js) sounds as the gallery. The exact tear-zone,
  tear-validity, commit, and exit rules live in
  [`docs/tear-and-exit.md`](docs/tear-and-exit.md) — keep it in sync with `pack.js`.
- **Tear → reveal, same Card.** When the pack opens, [`reveal.js`](src/reveal.js)
  raises the booster's cards as a stack you tap through — rarest last, the hit
  landing with a glow, foil burst, and chime. The cards are the very same
  [`card.js`](src/card.js) `detail` component the lightbox uses (holo foil driven
  by a `motion.js` tilt). [`booster.js`](src/booster.js) assembles the pack from a
  **local snapshot** ([`src/pool.js`](src/pool.js)) — no realtime API fetch, so the
  pack arms instantly — falling back to offline placeholders if the pool is empty.
- **Drop-in pack art.** Replace [`assets/pack.png`](assets/pack.png) with any
  design, any size — the pack reads the image's aspect on load and re-derives the
  whole tear geometry to fit.
- **Extensible toggles.** Adding a display option is one entry in
  [`options.js`](src/options.js) + a matching `body.<class>` CSS rule. Nothing
  else to wire.
- **Delegated events** survive grid re-renders — hover/click are bound to the
  grid, not individual cards (see [`util.js`](src/util.js)).

## Browser support

Modern evergreen browsers. Uses ES modules, `aspect-ratio`, CSS `color-mix()`,
3D transforms with `preserve-3d`, and Web Audio.

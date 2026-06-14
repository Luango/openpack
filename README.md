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

## Data

Cards come live from the [Pokémon TCG API](https://pokemontcg.io/) (`v2`):

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
- **Hover SFX** — a soft synthesized tick on card hover (Web Audio, no audio
  files; unlocked on first interaction).

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
├── index.html        host page — the DOM contract every module queries
├── pack.html         OpenPack tear-to-open prototype (work in progress)
├── serve.py          no-cache static server
└── src/
    ├── main.js       boot: load sets → load a set → wire gallery/filters/lightbox
    ├── api.js        Pokémon TCG API wrapper (paging + per-set cache)
    ├── rarity.js     rarity → tier mapping; the single source of truth
    ├── card.js       the Card component — one template, grid + detail variants
    ├── gallery.js    owns the grid: render + rarity show/hide (delegated events)
    ├── filters.js    rarity chips + All/Only mode; persists intent across sets
    ├── lightbox.js   flip viewer: spring-driven tilt, glare, swipe-to-flip, full-res upgrade
    ├── pack.js       OpenPack: SVG pack that tears open along a finger-drawn path
    ├── motion.js     shared spring engine (rAF integrator) behind lightbox + pack
    ├── particles.js  tiny canvas particle system — foil flecks + sparks
    ├── options.js    display toggles (e.g. Holo) → body class + localStorage
    ├── sfx.js        Web Audio: hover tick, foil scratch, sustained tear
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
  hosted by [`pack.html`](pack.html)) is an SVG pack you tear open by dragging a
  path across it: the rip propagates along your finger, splits into two
  complementary pieces, and the smaller one flies off while the body stays. It
  reuses the same `motion.js` spring, [`particles.js`](src/particles.js) flecks,
  and [`sfx.js`](src/sfx.js) sounds as the gallery — and will reveal the cards
  via the same [`card.js`](src/card.js) component.
- **Extensible toggles.** Adding a display option is one entry in
  [`options.js`](src/options.js) + a matching `body.<class>` CSS rule. Nothing
  else to wire.
- **Delegated events** survive grid re-renders — hover/click are bound to the
  grid, not individual cards (see [`util.js`](src/util.js)).

## Browser support

Modern evergreen browsers. Uses ES modules, `aspect-ratio`, CSS `color-mix()`,
3D transforms with `preserve-3d`, and Web Audio.

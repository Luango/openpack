# OpenPack FC

Rip open a pack of football player cards in the browser. Pick a **Premium Gold
Pack** off a floodlit 3D wheel, tear it open along the seal with your finger,
and flip through five players, rarest last. The best pulls get a **walkout**:
the nation, position and club are teased in the dark before the card drops.

Every player, club and crest is **fictional**, and every card is **painted in the
browser** from its player data, so there are no image downloads and no licensed
likenesses. Nation flags are real, shown as public symbols. There's no build
step, no framework and no dependencies: vanilla ES modules and a tiny static
server.

> This is the `soccer-pack` reskin of OpenPack, which on `main` is a Pokémon TCG
> pack opener. The engine is the same (carousel, tear, reveal, haul, sound). Every
> asset, the card data and the art direction are new.

## Quick start

```sh
python serve.py        # serves the current dir on http://127.0.0.1:8123
python serve.py 8080   # …or pick a port
```

Then open <http://127.0.0.1:8123/>. `serve.py` is `http.server` with caching
disabled (`no-store` on every response, so a reload always gets the current
modules) and a deep listen backlog: the page fires ~20 module requests at once,
and on Windows the stdlib's default backlog of 5 refuses some of them.

Handy URLs while working:

- `/?hit=9` forces the pack's promo slot to a tier (4–9). Use it to preview a
  walkout or a specific edition without waiting on luck.
- `/?audiodebug` shows a live audio-status HUD.
- `/coverflow.html` is a cover-flow showcase with one card of every edition.
- `/tools/card-lab.html` shows every card in the pool, filterable (`?f=toty`,
  `?hair=afro`, `?ids=p01,p02`). It's the bench for tuning the card art.
- `/tools/art/` is a live preview of the printed art (pack front/back, card back).

## Deploy

Hosted on **Vercel** as a static site (no build step): this branch is the
separate **`soccer-pack`** project. To ship, link the checkout to that project
and deploy:

```sh
vercel link --project soccer-pack
vercel deploy --prod
```

[`vercel.json`](vercel.json) sets `Cache-Control: must-revalidate` on everything,
so a redeploy is picked up immediately (there's no content hashing here).
[`.vercelignore`](.vercelignore) keeps dev-only files out of the deploy
(`serve.py`, `docs/`, `tools/`, the source PNG).

## The set

The squad lives in [`src/players.js`](src/players.js):

- **16 invented clubs** (plus the Legends hall of fame). Each is a name, three
  colours, a crest recipe (shape × field pattern × emblem glyph) and a kit
  recipe (pattern × collar).
- **85 players + 8 legends**, one row each: name, nation, club, position,
  overall, age. Everything else is **rolled deterministically from the player's
  id**. Face stats come from a positional archetype. The portrait look (skin
  tone, hairstyle, hair colour, facial hair, features) comes from weighted
  tables. The same player always renders the same card, and adding a player is
  one line.
- **Promo editions** are listed in `PROMOS`: a player, an edition and an overall
  boost. A Team of the Year is a full XI.

That's **144 cards** in the pool.

### Editions = rarity tiers

The engine still runs on the 0–9 tier ladder. Pack odds, the hit escalation,
glows, foil and the pack's "tell" all key off it. Each rung is now a card
edition, defined once in [`src/rarity.js`](src/rarity.js):

| Tier | Edition | Card | Foil (card.css) |
|-----:|---------|------|-----------------|
| 0 | Bronze | brushed bronze | matte |
| 1 | Silver | brushed silver | matte |
| 2 | Gold | brushed gold | soft shimmer |
| 3 | Rare Gold | gold + sunburst | gold foil bands |
| 4 | Team of the Week | black carbon + gold | gold foil bands |
| 5 | Player of the Match | crimson speed streaks | crimson foil bands |
| 6 | Future Stars | violet + neon ribbons | violet ↔ mint sweep |
| 7 | Team of the Season | aqua crystal shards | aqua prism · **walkout** |
| 8 | Team of the Year | midnight blue + gold stars | blue-gold prism · **walkout** |
| 9 | Legend | ivory marble + gold filigree | gold prism · **walkout** |

Base cards come from the overall: Bronze below 65, Silver below 75, Gold
above (about a third of golds are Rare).

### A pack

[`src/booster.js`](src/booster.js) builds a pack of five: three Bronze/Silver
fillers, one Gold (Rare 32% of the time) and one guaranteed promo, never the
same player twice. The promo tier is weighted: TOTW 31 · POTM 24 · Future Stars
16 · TOTS 13 · TOTY 10 · Legend 6 (%). The pack is sorted rarest-last. The odds
are printed on the pack's back, so re-render the art if you retune them.

## How a card is drawn

[`src/cardart.js`](src/cardart.js) paints a card onto a 756×1056 canvas (63:88)
and hands back a JPEG blob URL, cached per card. The reveal shows it through the
same `<img class="card__art">` the old scans used, so the foil layers, the tilt
and the Android compositing fixes all carry over untouched. Layers, back to
front:

1. The edition's **material** (diagonal metal gradient plus sheen bands) and
   **pattern** (honeycomb, sunburst, carbon, streaks, neon, shards, stars,
   marble), inside the crowned **shield** frame.
2. The **portrait** ([`src/portrait.js`](src/portrait.js)): a head-and-shoulders
   bust in a painted-vector style, with soft shaded skin, 16 hairstyles, facial
   hair and the club's kit with the crest over the heart. Shading uses blurred
   shapes via the shadow trick, because canvas `filter` isn't in every Safari.
   The bust is rim-lit and faded into the card at the chest.
3. **Rating, position, flag, crest**, then the **name** and **six face stats**
   (keepers get DIV/HAN/KIC/REF/SPD/POS), plus the edition mark for promos.
   Flags and crests come from [`src/emblems.js`](src/emblems.js).

The face font is **Barlow Condensed**, loaded non-blocking from Google Fonts.
The text is baked into the image, so `ensureFonts()` waits for the face (up to
3s) before painting and otherwise falls back to a system condensed face. Seeded
randomness ([`src/paint.js`](src/paint.js), mulberry32 over an FNV + murmur
finaliser) keeps every card stable.

## The printed art

The pack's front and back and the card back are composed on canvas in
[`tools/art/packart.js`](tools/art/packart.js), using the same modules as the
cards: the mystery card on the pack front is a real card render in silhouette.
Render them into the shipped files with:

```sh
node tools/render_art.mjs     # needs Chrome/Edge + Python with Pillow
```

That writes `assets/pack.png` (source), `pack-hi.webp`, `pack-hi-720.webp`,
`pack.webp`, `pack-back-hi.webp`, `pack-back-hi-720.webp` and `card-back.jpg`.
The tear-pack reads the image's aspect and re-derives its tear geometry, and the
3D carousel traces its rim light from the art's alpha, so any silhouette works.
[`tools/cdp.mjs`](tools/cdp.mjs) is the tiny headless-Chrome driver (no
dependencies) behind it. It's also handy for scripted smoke tests of the flow.

## Project layout

```
.
├── index.html        the app: kick-off gate → 3D pack wheel → tear → reveal → haul
├── coverflow.html    cover-flow showcase of the editions
├── serve.py          no-cache dev server
├── docs/             design specs from the original build (tear & exit, sound map)
├── tools/
│   ├── card-lab.html every card in the pool, for tuning the card art
│   ├── art/          the printed art (packart.js) + its live preview
│   ├── render_art.mjs  renders the printed art into assets/
│   └── cdp.mjs       headless-Chrome driver
└── src/
    ├── players.js    the squad: clubs, players, promos → the card pool
    ├── pool.js       the pool's front door (re-exports players.js)
    ├── rarity.js     editions ↔ tiers, tier colours — the single source of truth
    ├── booster.js    builds one pack (odds, rarest last) and paints its cards
    ├── cardart.js    paints a card (materials, patterns, layout, text) → blob URL
    ├── portrait.js   the player bust: head, features, hair, beard, kit
    ├── emblems.js    nation flags + fictional club crests
    ├── ball.js       the match-ball geometry (gate, backdrop, carousel)
    ├── paint.js      colour maths, seeded RNG, path/gradient/text helpers
    ├── card.js       the Card component (the <img> + foil layers)
    ├── card.css      card chrome + per-edition foil
    ├── select3d.js   three.js pack wheel on a floodlit-stadium shader
    ├── pack.js       the SVG pack you tear open along a finger-drawn path
    ├── reveal.js     card stack, hit escalation, walkout, haul, Send to Club
    ├── motion.js     shared spring engine
    ├── particles.js  canvas particle system (foil flecks, sparks)
    ├── flowlight.js  WebGL light leaking along the tear
    ├── sfx.js        Web Audio engine: samples-first SFX, BGM, master bus
    ├── util.js       escapeHtml / escapeAttr / delegate
    └── base.css      design tokens (night-match palette, tier colours)
```

## Architecture notes

- **One card component.** [`card.js`](src/card.js) renders one template; every
  card carries `.tier-N` + `data-vfx`, so it inherits its glow and foil purely
  from its edition.
- **Pick, then tear.** The app opens on a kick-off gate. The tap unlocks audio,
  then the 3D wheel ([`select3d.js`](src/select3d.js), three.js vendored) flies
  in: ten foil pouches on a revolving ring, with the focused pack popped toward
  the lens. The ring sits on a one-pass stadium shader with floodlights and
  beams, camera flashes twinkling in the stands, and a mown pitch the packs
  reflect in. Choosing a pack breaks it away toward the lens, then
  cross-dissolves into the identical SVG tear-pack.
- **The tear** ([`pack.js`](src/pack.js)) starts on the top or bottom seal and
  follows your finger. The rip splits the pouch into two pieces once it crosses,
  and the small piece flies off. The rules live in
  [`docs/tear-and-exit.md`](docs/tear-and-exit.md).
- **The reveal** ([`reveal.js`](src/reveal.js)) uncovers the stack in place.
  Each promo is announced by an anticipation beat, then a hit scaled by tier
  (rays, flash, stamp, shockwave, haptics), so a TOTW shimmers and a Legend
  takes the screen. Tiers 7+ **walk out** first. The deck is veiled and three
  clues land on a thud each, then a riser climbs into the hit. Afterwards the
  cards fan into the **haul**, a draggable selector of your new signings, and
  **Send to Club** vacuums them into your club badge.
- **Spring, not transition.** Gesture motion runs through
  [`motion.js`](src/motion.js) (a velocity integrator), so the tilt, the tear
  fling and the haul all share one feel.
- **Sound** is sample-first ([`assets/sfx`](assets/sfx), synth fallback) on a
  phone-tuned master bus. BGM plays natively (`el.volume`, not WebAudio) so it
  isn't silent on iOS.

## Browser support

Modern evergreen browsers. Uses ES modules, `aspect-ratio`, CSS `color-mix()`,
3D transforms, canvas `Path2D`/`roundRect`, WebGL and Web Audio.

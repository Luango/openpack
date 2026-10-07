# OpenPack FC

Rip open a pack of football player cards in the browser. Pick a **Premium Gold
Pack** off a spotlit 3D wheel, tear it open along the seal with your finger,
and flip through five players, rarest last. The best pulls get a **walkout**:
the nation, position and club are teased in the dark before the card drops.

The look is an **awards night**: warm black and dark charcoal, one gold that
behaves like a metal (bronze shadow → rich gold → champagne highlight), a soft
amber glow behind whatever matters, engraved Roman capitals for the headings,
and the **golden ball** as the motif — on the kick-off gate, drifting behind
the wheel, pressed into the pack and the card back. See
[Art direction](#art-direction).

The players are **real**, each with a real photo: a freely licensed Wikimedia
Commons image, cut out and cropped by [`tools/players`](tools/players), and
credited (author · licence → source) under every card. Every card is **painted
in the browser** from the player's data, their photo and their edition's frame.
Club badges are plain monograms in the club's colours, not the clubs' crests.
There's no build step, no framework and no dependencies: vanilla ES modules and
a tiny static server.

It's **built for a phone**. On a desktop the app opens inside an iPhone frame
([`phone.html`](phone.html) runs it in an iframe with a true 393×852 viewport);
on a phone it runs full-screen.

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
- `/?noframe` keeps a desktop on the bare page instead of the iPhone frame
  (`/phone.html` is the frame; it passes its query through to the app).
- `/?audiodebug` shows a live audio-status HUD.
- `/coverflow.html` is a cover-flow showcase with one card of every edition.
- `/tools/card-lab.html` shows every card in the pool, filterable (`?f=toty`,
  `?ids=p01,p02`). It's the bench for tuning the card art.
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

## Art direction

Ballon d'Or-inspired, not branded: cinematic gold against warm black, with
restraint. The rules the whole app follows:

| Element | Direction |
|---|---|
| **Gold** | A material, never a flat colour: bronze shadow `#80521c` → rich gold `#d4a63a` → champagne `#f7e4aa`, with a reflective horizon through lettering and buttons (`--gold-material` in `base.css`), hammered texture on the pack's crimps. |
| **Surfaces** | Warm black `#0d0b08` and dark brown charcoal `#211b13`; nothing cool or blue. |
| **Light** | Two warm spotlights from above, an amber pool `#ffb547` behind the main object, deep shadow everywhere else, bloom only on the brightest highlights. |
| **Composition** | One golden object per screen — the ball, the pack, the card — with space around it. |
| **Type** | Cinzel (engraved Roman capitals) for headings, stamps and the primary button; the system sans for information; Barlow Condensed stays on the card faces. |
| **Motion** | Slow: light sweeping across the gold button, gold dust drifting, the wheel's comets, deliberate reveals. |
| **Text** | Warm ivory `#fff6e3`; dark lettering on gold buttons. |

The tokens live in [`src/base.css`](src/base.css); the printed art
([`tools/art/packart.js`](tools/art/packart.js)) and the 3D stage
([`src/select3d.js`](src/select3d.js)) carry the same palette by hand.

## The set

The squad lives in [`src/players.js`](src/players.js):

- **Real clubs**, as of each player's Wikipedia infobox in October 2026 (plus the
  Legends hall of fame). Each is a name, a short code and three colours; the
  badge is a monogram on a shape × field pattern, never the real crest.
- **94 players + 10 legends**, one row each: name, card name, nation, club,
  position, overall, and whether a gold is Rare. Ratings are our own. Face stats
  are **rolled deterministically from the player's id** off a positional
  archetype, so the same player always renders the same card.
- **Promo editions** are listed in `PROMOS`: a player, an edition and an overall
  boost. A Team of the Year is a full XI.

That's **155 cards** in the pool.

### Player photos

Every portrait is a **bust shot**, framed the way an ultimate-team card frames
its player: facing the lens, head level, square shoulders, sharp, alone.
[`tools/players`](tools/players) finds them, cuts them out to
`assets/players/<id>.webp` (600px, background removed) and writes the credits
module [`src/photos.js`](src/photos.js):

```sh
pip install "rembg[cpu]" "opencv-python-headless<5"
python tools/players/scout.py  <cache-dir> [id …]  # rank Commons bust-shot candidates
python tools/players/fetch.py  <cache-dir>         # pinned photo + licence + club, per player
python tools/players/cutout.py <cache-dir>         # matte, find + level the face, crop, credits
```

`scout.py` searches Commons for files whose **title** names the player (that is
where identity comes from, never the face), keeps only photos with one dominant
face, and scores each with YuNet face landmarks: frontal, level, chin neither up
nor down, big enough, sharp, with room for the shoulders. It cuts the top three
out and writes contact sheets beside the current portrait. A pick still gets a
human look: same-name strangers and match frames where an opponent is the
subject get rejected when the kit or setting doesn't fit the player. Winners are
pinned in [`roster.py`](tools/players/roster.py)'s `FILE` (`CROP` nudges a
crop); a player with no good bust shot on Commons is swapped for one who has.
Adding a player is a row in `players.js` plus one in `roster.py`, then a
scout, a pin and a re-run.

The licences (CC BY, CC BY-SA, CC0, public domain) cover the photographers'
copyright, which is why each card credits its photo. They don't cover the
players' image rights or the clubs' trademarks: anything beyond a fan concept
needs those cleared separately.

### Editions = rarity tiers

The engine still runs on the 0–9 tier ladder. Pack odds, the hit escalation,
glows, foil and the pack's "tell" all key off it. Each rung is now a card
edition, defined once in [`src/rarity.js`](src/rarity.js):

| Tier | Edition | Frame | Foil (card.css) |
|-----:|---------|-------|-----------------|
| 0 | Bronze | swirl shield, bronze | matte |
| 1 | Silver | swirl shield, silver | matte |
| 2 | Gold | swirl shield, gold | soft shimmer |
| 3 | Rare Gold | swirl shield, deep gold | gold foil bands |
| 4 | Team of the Week | gold-rimmed shield, black | gold foil bands |
| 5 | Player of the Match | gold-rimmed shield, crimson | crimson foil bands |
| 6 | Future Stars | gold-rimmed shield, violet | violet ↔ mint sweep |
| 7 | Team of the Season | gold-rimmed shield, aqua | aqua prism · **walkout** |
| 8 | Team of the Year | gold-rimmed shield, royal blue | blue-gold prism · **walkout** |
| 9 | Legend | gold-rimmed shield, ivory | champagne prism · **walkout** |

Base cards come from the overall: Bronze below 65, Silver below 75, Gold
above (the marquee golds are Rare).

### A pack

[`src/booster.js`](src/booster.js) builds a pack of five: three Bronze/Silver
fillers, one Gold (Rare 32% of the time) and one guaranteed promo, never the
same player twice. The promo tier is weighted: TOTW 31 · POTM 24 · Future Stars
16 · TOTS 13 · TOTY 10 · Legend 6 (%). The pack is sorted rarest-last. The odds
are printed on the pack's back, so re-render the art if you retune them.

## How a card is drawn

[`src/cardart.js`](src/cardart.js) paints a card onto a 756×1056 canvas (63:88)
and hands back a WebP (PNG on Safari) blob URL **with alpha**, cached per card:
a card is its frame's shape, with nothing around it. The reveal shows it through
the same `<img class="card__art">` as before, so the foil layers, the tilt and
the Android compositing fixes all carry over; [`card.css`](src/card.css) masks
the foil to the frame's silhouette (`data-frame`) and swaps the rectangular
shadow for one in the frame's shape. Layers, back to front:

1. The edition's **frame** (`assets/frames/<edition>.webp`). Two designs make
   two families: the swirl shield carries Bronze to Rare Gold, re-toned per
   metal, and the gold-rimmed shield carries the promos, its field dyed per
   edition (Legend keeps the original ivory). They're baked from the sources in
   `tools/frames/src` by `python tools/frames/build.py`, which also writes the
   silhouette masks the CSS and the painter use.
2. The **player photo**, rim-lit on the dark editions, faded into the card at the
   chest and clipped to the frame's inner panel. A card without a photo (the
   pack's mystery card) gets a painted silhouette
   ([`src/portrait.js`](src/portrait.js)).
3. **Rating, position, flag, club badge**, then the **name** and **six face
   stats** (keepers get DIV/HAN/KIC/REF/SPD/POS), plus the edition mark for
   promos. Flags and badges come from [`src/emblems.js`](src/emblems.js).

The face font is **Barlow Condensed**, loaded non-blocking from Google Fonts
(next to **Cinzel**, the display face the UI and the printed art use). The text
is baked into the image, so `ensureFonts()` waits for the faces (up to 3s)
before painting and otherwise falls back to a system condensed face. Seeded
randomness ([`src/paint.js`](src/paint.js), mulberry32 over an FNV + murmur
finaliser) keeps every card stable.

## The printed art

The pack's front and back and the card back are composed on canvas in
[`tools/art/packart.js`](tools/art/packart.js), using the same modules as the
cards: a black foil pouch with hammered-gold crimps, engraved gold lettering,
and the mystery card (a real card render in silhouette) in a pool of amber
light; the golden ball is pressed into the back and the card back. Render them
into the shipped files with:

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
├── phone.html        the desktop presentation: the app inside an iPhone frame
├── coverflow.html    cover-flow showcase of the editions
├── serve.py          no-cache dev server
├── docs/             design specs from the original build (tear & exit, sound map)
├── tools/
│   ├── card-lab.html every card in the pool, for tuning the card art
│   ├── art/          the printed art (packart.js) + its live preview
│   ├── frames/       the two card-frame designs → assets/frames (build.py)
│   ├── players/      real-player photos → assets/players + src/photos.js
│   ├── render_art.mjs  renders the printed art into assets/
│   └── cdp.mjs       headless-Chrome driver
└── src/
    ├── players.js    the squad: clubs, players, promos → the card pool
    ├── pool.js       the pool's front door (re-exports players.js)
    ├── rarity.js     editions ↔ tiers, tier colours — the single source of truth
    ├── booster.js    builds one pack (odds, rarest last) and paints its cards
    ├── cardart.js    paints a card (frame, photo, layout, text) → blob URL
    ├── photos.js     per-photo credits (generated by tools/players)
    ├── portrait.js   the painted bust, used as the mystery card's silhouette
    ├── emblems.js    nation flags + club monogram badges
    ├── ball.js       the match-ball geometry (gate, backdrop, carousel)
    ├── paint.js      colour maths, seeded RNG, path/gradient/text helpers
    ├── card.js       the Card component (the <img> + foil layers)
    ├── card.css      card chrome + per-edition foil
    ├── select3d.js   three.js pack wheel on an awards-night stage shader
    ├── pack.js       the SVG pack you tear open along a finger-drawn path
    ├── reveal.js     card stack, hit escalation, walkout, haul, Send to Club
    ├── motion.js     shared spring engine
    ├── particles.js  canvas particle system (foil flecks, sparks)
    ├── flowlight.js  WebGL light leaking along the tear
    ├── sfx.js        Web Audio engine: samples-first SFX, BGM, master bus
    ├── util.js       escapeHtml / escapeAttr / delegate
    └── base.css      design tokens (the awards-night palette, tier colours)
```

## Architecture notes

- **One card component.** [`card.js`](src/card.js) renders one template; every
  card carries `.tier-N` + `data-vfx`, so it inherits its glow and foil purely
  from its edition.
- **Pick, then tear.** The app opens on a kick-off gate. The tap unlocks audio,
  then the 3D wheel ([`select3d.js`](src/select3d.js), three.js vendored) flies
  in: ten foil pouches on a revolving ring, with the focused pack popped toward
  the lens. The ring sits on a one-pass stage shader with two warm spotlights
  and their beams, camera flashes twinkling in the gallery, an amber pool behind
  the front pack and a polished black floor the packs reflect in. Choosing a
  pack breaks it away toward the lens, then cross-dissolves into the identical
  SVG tear-pack.
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

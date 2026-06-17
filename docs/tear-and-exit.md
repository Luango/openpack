# Pack tear & exit

How a booster is torn open and how the spent pack leaves the screen.

This is a **living spec** — it mirrors [`src/pack.js`](../src/pack.js) (plus the CSS
noted below). When you change the tear zone, the tear rules, the commit, or the
exit, update the matching section here and the constants table.

- **Source of truth:** [`src/pack.js`](../src/pack.js)
- **Host page:** [`pack.html`](../pack.html) (CSS for the stage/exit + mobile hardening)
- **Last synced:** 2026-06-17 · `5f6c131`

---

## Coordinate space

The pack lives in an internal SVG box `VB = { w: 300, h: <derived> }`. Width is a
fixed 300 units; the **height is re-derived from the loaded `assets/pack.png`
aspect** (`applyAspect`), so any pack image fits (≈497 for the current art). Every
fraction/constant below is in this space.

## Tuning constants (`pack.js`)

| Constant | Value | Meaning |
|---|---|---|
| `START_DIST` | `12` | finger travel before a tear engages |
| `GAP_TEAR` | `10` | crack width while mid-tear (reads as a crack, not a gap) |
| `TEAR_CORNER_X` | `0.10` | tear-zone corner block width (× width) |
| `TEAR_CORNER_Y` | `0.13` | tear-zone corner depth (× height) — the deeper "corner" |
| `TEAR_MID_Y` | `0.07` | tear-zone middle depth (× height) — the shallower "middle" |
| `TURN_SEG` | `14` | length each heading sample is measured over (turn check) |
| `TURN_KINK_RAD` | `90°` | max single-step turn — a sharper kink voids the tear |
| `TURN_CUM_RAD` | `~70°` | max cumulative net turn — catches a gradual U-turn early |
| `CROSS_MARGIN` | `12` | how near a far edge counts as "crossed" |
| `CROSS_MIN` | `90` | minimum tear length before a crossing counts |
| `SEP_MAX` / `ROT` | `130` / `18°` | how far/how much the torn-off half flings + tilts |

---

## 1 · The tear zone — where a tear can START

Only the **top and bottom crimp strips** — never the side seams, never the inner
art face (you can't tear from inside the pack). Each strip has a **notch profile**:
deeper at the four corners than across the middle.

- Near a corner (`s.x` within `TEAR_CORNER_X` of a side): tearable down to `TEAR_CORNER_Y` (13%).
- Across the middle: tearable only down to `TEAR_MID_Y` (7%).
- Anywhere else (sides, center): a harmless scratch (`scratchOnly`), no tear.

Decided in `onDown`. A debug overlay (the **"Tear zone"** toggle, top-right) draws
this region as a dashed band — `.tear-zone` in [`pack.js`](../src/pack.js),
gated by `body.show-tear-zone`.

## 2 · Tearing

While you drag, the pack stays **one piece** with a thin jagged crack tracking your
finger (jittered for torn-paper roughness; foil flecks + a sustained rip sound +
haptics). Driven by the shared spring ([`motion.js`](../src/motion.js)).

A real tear runs **forward** — it can't hook back on itself. The heading is sampled
over each ~`TURN_SEG`-unit chunk, and the tear is **voided** if either:

- a single step turns more than **`TURN_KINK_RAD` (90°)** — a sharp kink, or
- the **cumulative** net rotation passes **`TURN_CUM_RAD` (~70°)** — a gradual U-turn.

A voided tear **stops, locks, and heals the crack shut**, and can't open. Lift and
tear again. (Wobble cancels out because the rotation is signed.) See `onMove`.

## 3 · Commit (open)

The tear commits **the moment it crosses to a far edge — finger still down**, no
need to lift (`onMove` → `commitOpen`).

- `crossed` = the tip is within `CROSS_MARGIN` of an edge **and** the path is longer
  than `CROSS_MIN`.
- On commit (`makePieces`) the pack splits into two complementary pieces along the
  jagged seam. The **smaller** half flings off and fades (spring, `SEP_MAX`/`ROT`);
  the bigger half is the body that still holds the cards.
- ~**750 ms** later the reveal takes over (`onOpen` → `reveal.show()`), uncovering
  the centered card stack.

## 4 · The exit — which way the big half slides off

The big half slides **straight off on one cardinal axis**, then fades. The axis is
decided by **what the tear actually did** (`makePieces`):

- **Spans top → bottom** (`Pin` on the top edge & `Pout` on the bottom, or vice
  versa) = a genuine left/right split → exit **sideways**, away from the torn-off
  (smaller) half.
- **Otherwise** the tear took a strip off the crimp it started in → the body drops
  **away from that crimp**: started top → **down**, started bottom → **up**
  (from `path[0].y`).

| Tear | Exit |
|---|---|
| Top strip (straight, or angled off to a side) | **down** |
| Bottom strip | **up** |
| Top→bottom split, smaller half on the **left** | **right** |
| Top→bottom split, smaller half on the **right** | **left** |

> **Why "spans top→bottom" and not the cut's angle:** a top-strip tear that merely
> *angles* toward a side has a vertical-ish chord, so an angle-based test wrongly
> calls it a side split and sends it sideways. Keying off whether the cut truly
> reaches both the top and bottom edges keeps "you opened the top → it drops down"
> correct.

**Distance is in pixels, not viewport units:** `reach = max(innerW, innerH) × 1.3`.
iOS Safari often refuses to *animate* a transform transition whose target is in
`vmax`/`vh`/`vw` (it jumps to the end, so the half just vanishes); pixels animate
everywhere. The slide itself is a CSS transition on `#pack-stage`
([`pack.html`](../pack.html): `body.revealing #pack-stage { transform: translate(var(--exit-x), var(--exit-y)) … }`),
with `will-change: transform` for smooth mobile compositing.

## 5 · Reset & "Open another"

- Tapping an opened pack **before** the reveal slides the two halves back together
  (`reset` → `clearTear`).
- **"Open another"** in the reveal reseals the pack and pre-loads the next booster
  ([`pack.html`](../pack.html) `onAgain`). The pack stays hidden until its card
  stack is prepared, so there's never an empty pack on screen.

## Mobile gesture hardening

So a touch never zooms or pops an OS menu over the cards:

- **`pack.html` body:** `touch-action: manipulation` (no double-tap zoom),
  `-webkit-touch-callout: none`, `user-select: none`.
- **[`base.css`](../src/base.css) body:** `touch-action: manipulation` (covers the gallery too).
- **[`card.css`](../src/card.css) `.card__art`:** `pointer-events: none` so a
  long-press lands on a plain `<div>` (iOS shows no image menu), plus
  callout/drag/select `none`. All card interaction is on **parents** (gallery grid,
  lightbox overlay, reveal slot), so taps/tilt are unaffected.

> The viewport `user-scalable=no` / `maximum-scale=1` is **ignored by iOS Safari**,
> which is why the rules above (not the meta tag) are what actually stop the zoom.

---

## Maintenance

When the mechanic changes, update the section above **and** the constants table.
Quick map from behavior → code (all in [`src/pack.js`](../src/pack.js) unless noted):

| Behavior | Where |
|---|---|
| Tear zone (crimp strips, notch) | `onDown`, `tearZonePath`, `TEAR_CORNER_*` / `TEAR_MID_Y` |
| Tearing + turn/U-turn voiding | `onMove`, `TURN_*` |
| Commit on cross | `onMove` → `commitOpen`, `CROSS_*` |
| Split + which half flies | `makePieces`, `SEP_MAX` / `ROT`, spring `onTick` |
| Exit direction | `makePieces` (`spansTopBottom`, `exitX`/`exitY`) |
| Exit distance + slide | `makePieces` (`reach`) + `#pack-stage` CSS in `pack.html` |
| Reveal handoff timing | `commitOpen` `setTimeout(…, 750)` |
| Mobile gesture hardening | `pack.html` + `base.css` body, `card.css .card__art` |

### Changelog

- **2026-06-17** — Exit goes sideways only for a true top→bottom split; any other
  cut drops away from its start crimp (top→down, bottom→up). Exit distance switched
  to px (iOS animation fix). Mobile double-tap / long-press hardening. Tear voids on
  >90° kink or ~70° cumulative U-turn. Tear zone = top/bottom crimp strips (notch
  profile). Commit-on-cross. Pack hidden until cards ready. First published to
  GitHub Pages.

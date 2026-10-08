# The procedural 3D foil pack

How the sealed pack is built, lit and torn open in 3D — the implementation of the
"Procedural 3D Card Pack" design plan, and the two rip methods it exposes.

- **Source:** [`src/pack3d/`](../src/pack3d/) (vanilla ES modules + the vendored three.js r161)
- **Everywhere:** the carousel ([`src/select3d.js`](../src/select3d.js)) shows the same pouch —
  its ring, the queue-in fly-in and the hero that flies to the lens all use the shared asset
  ([`asset.js`](../src/pack3d/asset.js): one envelope geometry at a showroom density, one
  printed atlas, one set of surface maps, one reflection room), so the pack you spin, the
  one that lands on the stage and the one you tear are one object.
- **Bench:** [`tools/pack-lab.html`](../tools/pack-lab.html) — the pack alone, armed, with the
  developer panel (route, progress scrubber, yaw/pitch, auto open). `?quality=low|standard|high`.
- **In the app:** `?packdebug` adds the same panel over the live flow; `?pack=svg` forces the
  old flat SVG tear-pack ([`src/pack.js`](../src/pack.js)), which is also the automatic
  fallback when WebGL is unavailable.

The design plan the build follows is the user-supplied *Procedural 3D Card Pack Design and
Implementation Plan*; the sections below mirror its modules and note where the
implementation departs from it.

---

## The two rips

| Route | Where you grab | Gesture | What happens |
|---|---|---|---|
| **Front** (top strip) | the notch at the pack's upper-left corner (front facing you) | drag **right** across the top | the sealed header tears off around the whole pack — front, both side folds and back together — and lifts away in your fingers; at the last connection the cap flies clear, the mouth gapes, the opening light pours out, and the body drops away to uncover the cards |
| **Back** (fin seam) | the rear fin seam near its top (flip the pack first: tap it, or drag to turn it) | **pull** — drag away in any direction, the further the harder | nothing tears: the pack **strains** with the pull — it's hauled a little toward your hand, bulges, its creases deepen, stress pleats gather toward the seam, it stretches lengthwise, trembles harder and harder, and the seam gapes in a sliver below the crimp — until, at the limit, the seal lets go all at once: **"pong"** — both halves of the back blow open about the side folds (overshooting), the pack recoils, and the card stack leaps out of the back toward you and lands face-up. Let go early and the seam simply slackens back |

Both run on one state machine ([`controller.js`](../src/pack3d/controller.js)):
`Ready → Gripping → Tearing ⇄ Paused → Detached → Revealed`. On the front route progress
is monotonic (reversing the hand slackens the strip, never closes the tear), based on
displacement in pack-local metres, and every re-grip saves progress and resets the drag
origin so resuming never jumps. On the back route the machine is a **strain gauge**
instead: the hand's distance from where it gripped (over `PULL_LIMIT`, 56 mm) is the
power, eased with a lag so the pack visibly resists; releasing before the limit relaxes
it fully (elastic, no memory), and reaching the limit fires `complete` with the strain
then **ringing** down through zero (the recoil: it sucks in, puffs out, settles). Pointer
capture holds the gesture when the finger leaves the notch; `pointercancel`, lost capture
and tab hiding pause (front) or slacken (back) rather than reset. Inspection rotation
(drag anywhere else on the pack; tap to flip) is frozen while a tear or pull is under way.

The route is chosen by **which face is toward the lens** when the grip starts: the front
notch when the front faces you, the seam top when the back does. An **Open pack** button
drives the same machine with a scripted hand for keyboard users and anyone who'd rather not
drag; **Flip** turns the pack over. A pulsing dot marks the current grip.

## Geometry ([`geometry.js`](../src/pack3d/geometry.js))

Metres internally; X across, Y up, Z toward the front. `config.js` holds the dimensions
(74 × 122.6 × 6 mm — the height is re-derived from the pack art's aspect at load so the print
maps edge to edge, 8 mm sealed bands, 7 mm shoulders, the tear 11 mm below the top).

- **Loft.** A rounded-rectangle cross-section (flat crowned faces, 2.2 mm side folds) is
  lofted along Y: full depth through the body, tapering through the shoulders to a thin
  (0.22 mm) sealed band that closes to a **serrated crimp edge** in geometry (no alpha test).
  Columns have fixed roles around the loop (back-right half, right fold, front, left fold,
  back-left half); rows are adaptive — dense at the tear line and the shoulders.
- **Two patches, one prepared boundary.** The *header* (above the tear) and the *body* are
  separate grids whose boundary rows coincide at a stable jagged curve (front and back get
  different irregularity; the endpoints agree at the side joins). The column loop starts and
  ends at the back centre, so the rear fin seam is already a duplicated column. Every
  duplicate pair is in the **seam table** (`seams.tear`, `seams.fin`); at rest the pairs
  coincide and the normals are reconciled, so the closed pack shows no seam. No runtime mesh
  cutting.
- **Fin seam.** A three-column ribbon lying flat on the back, split into body/header parts on
  the same rows, same seam pairs, same UV island — it tears with the header and peels with the
  right flap.
- **Stable wrinkles**, evaluated once in material coordinates and baked into the rest
  positions: the foil hugs the card stack and relaxes 0.8 mm around it, drape ridges run
  from each card corner to the pack corner, six seeded broad creases per face (stronger near
  the shoulders, suppressed over the title), and vertical gathers where the foil bunches into
  each seal. Fine detail lives in the normal map, never in both.
- **Card stack**: a rounded deck slab plus a separate top card (so it can rise and flip),
  with printed edge lines on the rim to imply the rest of the cards.

Standard tier: 84 columns around, ~10.7 k wrapper triangles, ~22 k in the whole main pass
with the inside surfaces and the cards, **11 draw calls** (wrapper 4, ribbons 1, stack 6).
`low` drops to 60 columns / 1024 atlas / 1.5 DPR; `high` raises everything. The tier is
picked per device in `config.js` (`?quality=` overrides).

## Textures ([`atlas.js`](../src/pack3d/atlas.js), [`textures.js`](../src/pack3d/textures.js))

One stable atlas with islands for the front and back art, both side strips and the fin,
padded ≥ 12 px against mip bleed. UVs come from each vertex's *original* position, so
duplicated tear vertices keep their source UVs and the print splits exactly at the tear.

- **Base colour** — the flat front/back art composited over crimp gold (so the art's
  serrated alpha lands on foil), the sides painted as the print wrapping the fold, the fin as
  creased gold. SRGB.
- **Normal** — from a seeded height field: fine curved crinkles, soft dents, directional
  scratches, the 1.2 mm crimp ridges and the seal-line groove. Finite-difference gradients
  scaled by the real texel size; OpenGL Y convention; `normalScale` 0.55.
- **Packed roughness/metalness** (G/B; R reserved for occlusion, off) — near-binary masks
  from the art itself: gold (even in shadow — it stays warm) → metallic foil, dark
  *neutral* print → ink, white print → glossy varnish, seals/sides → bare foil.
- **The print finish** — the brand and the pack name have their own print masks
  (`assets/pack-print-front.png` / `-back.png`, rendered with the art; `printFront` /
  `printBack` in `config.js`), laid onto the atlas exactly as the art is. Inside them the
  foil's crinkle gives way to a smooth surface raised 0.2 mm with a soft 0.5 mm bevel at
  every edge (the blurred mask as height), and the ORM turns to gloss-black ink
  (dielectric, roughness 0.08). So the lockup and the name catch the light as raised
  gloss print — lit rims, a silvery sweep at a steep angle — never like the gold foil
  around them. Without the masks the brand simply prints as ink.

The art maps gate the first frame; the surface maps are generated in row slices on idle
ticks and swapped in when ready.

## Materials and lighting ([`materials.js`](../src/pack3d/materials.js), [`lighting.js`](../src/pack3d/lighting.js))

`MeshStandardMaterial` throughout. The wrapper is one deforming surface rendered twice:
the exterior on front-facing polygons, the **inner foil** (bare silver, metalness 1,
roughness 0.46) on back-facing ones — opposite culling, never two coplanar meshes. The
header has its own material clones so it can fade while flying clear. Torn-edge ribbons
(unlit bright silver) are built only along released boundary samples.

The reflection map is a small **code-built room** (a broad panel above-left, a cool strip
opposite, a warm low fill, a hot sliver overhead, dim walls) filtered once with
`PMREMGenerator.fromScene`. One warm key light and a faint hemisphere light; ACES tone
mapping, exposure 1.12; no bloom, no DoF, no shadow map (the pack floats).

The camera is fitted so the **card inside the pack projects to exactly `--card-detail-w`**,
the width of the DOM reveal card behind the canvas — that is what makes the hand-off to the
reveal seamless. `getHandoffRect()` reports the pack's face-on rect to the carousel, whose
flat hero lands on it and cross-dissolves; `present()` then lets the pack settle into its
three-quarter view (yaw 19.5°, a slight downward pitch) and float.

## Deformation ([`deformer.js`](../src/pack3d/deformer.js), [`chain.js`](../src/pack3d/chain.js))

Every frame starts from the rest positions (nothing accumulates), writes the dynamic
position buffer, recomputes normals and reconciles the still-joined seam pairs.

**Front.** A release weight `smoothstep(0, 0.05, p − s)` per column (s = the column's
left-to-right route coordinate, shared by both sheets). A **station chain** (12–20 Verlet
stations with distance, bend, tip-tangent and pack-collision constraints) is anchored at the
tear tip and ends at the grip handle; its arc length is the released route length, the
handle is clamped to the reachable distance, so slack arches up and out and never stretches.
The header's full cross-section (front, back, folds and seal together) is swept along the
chain's parallel-transported frames; each vertex blends from rest into the swept pose by
its weight. The body gets a press dent at the tip and a mouth that gapes behind the tear. At
completion the cap is captured and thrown rigidly from the chain's end velocity, fading as it
goes.

**Back.** A strain field driven by `state.strain` (0–1 while pulling; it rings negative
after the pop), baked per vertex once: the body **inflates** along its rest normal (the
pulled back most, the front and sides less — pressure inside), the baked wrinkle field is
**amplified** (creases deepen under tension), **stress pleats** fan out from the gripped
seam top and fade down the back, the pouch **stretches** lengthwise by up to 7 % and
narrows 3 %, and the seam **gapes** in a lens just below the top crimp (a hinge of up to
~4° about the side folds, late in the pull — squared in the strain). The rigid part of the
feel is the view's: the pack is hauled ~20 % of the way toward the hand on an underdamped
spring (it boings back on release, recoils on the pop), leans with the pull, and trembles
with an amplitude that rises with strain<sup>2.4</sup>. At the pop both back halves hinge
open together about their side folds (`flapOpen`, a fast overshooting spring, tapered to
zero into the crimps so they stay put — the almond opening), the fin's free edge lifts and
rides the right flap, and the torn-edge ribbons appear along the whole seam at once.

## Feedback ([`view.js`](../src/pack3d/view.js))

The existing sound engine's cues are reused unchanged on the front route: `grab` on grip,
`tearStart` at the first break, `tearMove` driven by pull velocity and progress,
`tearEnd(false)` on pause, and at completion `tearEnd(true)` + `burst` + `tearRelease` +
the open theme resuming. Haptics ratchet by tear distance (one tick per ~2.8 mm); foil
flecks spray at the projected tip. The back route has its own cues (sample-first, keys
`strain_loop` and `pop` in the manifest; synth fallbacks): `strainStart` once the slack is
taken up, `strain(level)` every move — a creak that thickens and brightens with the pull, a
low tense body tone whose pitch and tremolo climb with it, and the same chime-up ladder the
tear uses, climbing with the power — `strainEnd(false)` on an early release (it slackens),
and at the limit `strainEnd(true)` + `pop` (the snap) + `burst` + `tearRelease`. Haptics
ratchet by strain (a stronger tick every 8 %), the pop kicks harder, and the cards leap out
drawn in front of the opening light (so they pop *out of* the glow, not under it). The opening light (additive bloom + ray sprites at the mouth) shoots out, **holds and
breathes** for 760 ms + 70 ms per tier (a chase lingers), then fades — only then does the
body drop (`onOpen`), with a safety-net timer so the flow can never stall. Reduced motion
shortens the hold, damps the strip and skips the screen kick.

## Verification done

- Both routes inspected at 0 / 30 / 50 / 62 / 90 / 100 % in the lab (front: strip lifts,
  curls, travels, cap flies; back: the strain builds — hauled, bulged, pleated, stretched,
  the seam sliver opens — then the pop: doors overshoot to the almond, fin rides the right
  flap, the stack leaps out in front of the light and lands face-up).
- Full app flow on desktop (`?noframe`) and a 375 × 812 phone viewport: gate → carousel →
  hand-off (face-on landing, then settle) → front tear by pointer drag → light beat →
  reveal; and flip → back pull by pointer drag (an early release slackens back) → pop →
  stack leaps out face-up → reveal. Headless timed captures of the back pull via
  `tools/cdp.mjs` (scripted and dragged) confirm the state sequence
  `tearing → detached (flapOpen overshoots ~1.13, strain rings) → revealed`.
- Deformer cost: 0.5–0.8 ms per frame at the standard tier on the dev machine; rAF holds
  60 fps. Not yet profiled on real phones — the tiers are starting points.
- `?pack=svg` and the no-WebGL path load the flat SVG pack.

## The printed art

[`tools/art/packart.js`](../tools/art/packart.js) paints the pouch. The **front** is the
supplied cover design (`tools/art/ref/pack-cover-reference.webp`, a studio render):
faceted gold foil — chevrons, a frame, long diagonals — with the Betfair lockup in black
across the middle. `tools/art/cover_plate.py` unwarps the render's pouch into the art box
(each row's pillowed edge stretched to the full width, crimp tip to crimp scallop) and
inpaints its bitmap logo away; packart.js lays that plate down and draws the lockup back
as vectors traced from the supplied logo (`tools/art/trace_logo.py` →
`tools/art/betfair-logo.js`) into the same box. The **back** carries the brand, GOLD PACK ·
FOOTBALL COLLECTION, the contents and odds, the fin seal with its ball emboss, the legal and
the barcode, in black on a satin gold foil. The brand and the pack name are also rendered
as print masks (the `*-print` pieces) for the print finish above. `BRAND` is the one place
to re-brand. Render with `node tools/render_art.mjs`.

## Not done / deferred

- Device profiling on target phones (frame-time distribution during the tear, GPU memory).
- KTX2 compression (all maps are runtime-generated, so not needed yet).
- Vertex-shader deformation (CPU is well within budget at these counts).
- Shadows / contact shadow (the pack floats on a dark stage).

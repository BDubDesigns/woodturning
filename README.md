# Woodturning

A cozy woodturning game. Grow trees, chop them down, turn the logs on a lathe,
paint and finish them, and sell them on commission.

The loop in one sentence: take a commission, grow the right tree, chop it,
turn it to shape, paint it spinning, get paid by how close you got.

## Design

`DESIGN.md` is the full design doc: the whole pipeline (plant, grow, chop,
delimb, saw, turn, paint, sheen, sell), the lathe mechanics, generated
commissions graded by similarity, the farm and land tiles, diamonds and the
mine, monetization, distribution, and the one-month bet.

## Current state

- Lathe base (prototype 02): a spinning log you shape with a chisel, in 3D
  (Three.js) or 2D (Canvas2D, works in every webview). Two tips (gouge /
  skew), chips and dust, sound, RPM, NEW LOG.
- Feel fixes from the Nov 12 playtest (`docs/lathe-feel-fix.md`) are in:
  the 3D view is no longer mirrored, depth comes from pressure (touch below
  the log, nudge up) so the finger never covers the cut, and cuts blend into
  smooth turned curves instead of spiky notches.

- Farm (slice 2): plant a pine, oak, or walnut on a land plot and it grows in
  real time, including while the game is closed (growth is derived from a saved
  timestamp, never a running timer). Diamonds speed it up, coins buy more land,
  and a mature tree can be chopped with swipes into the trunk. The log goes to
  the shed, which is what commissions will read. The chop here is a small
  stand-in behind `farm.chopHit`; the full Harvest slice replaces the interaction.
  Saves live in localStorage (`woodturning.save`).

- Harvest (slice 1): the HARVEST tab is the forest. Chop a tree where you
  swipe, watch it crack and fall, clear the limbs with a blade, saw the log
  in two places, and the middle piece goes straight onto the lathe as the
  blank. Canvas2D only, so it runs in every webview. The farm's quick chop
  stays as it is; wiring a farm tree into the full harvest is a later step.

- Monetization (slice 6): the money model, kept honest. Diamonds are called
  diamonds. The MINE tab trades one finished ad (about 5 seconds, close button
  always there) for exactly 3 diamonds or 1 gem, no randomness. Gems sell for 25
  coins. Diamonds skip growing time, grow a tree now, or buy land. The full
  unlock ($5, one constant in `src/js/monetize.js`) removes every ad and every
  timer. The free game is complete: the core loop never asks for diamonds, gems,
  an ad, or the unlock. Ads and payments are two seams (`MineUI.adProvider`,
  `MineUI.payProvider`) with a labelled house ad and a no-charge preview
  purchase until the Play Store slice wires AdMob and Play Billing. Play Pass
  notes are in `docs/play-pass.md` (open question, not applied for).

## Play

Open `lathe.html` in a browser. The FARM, HARVEST, LATHE and MINE tabs switch
screens (`lathe.html#farm` opens the farm, `#harvest` the forest, `#mine` the mine,
and `?seed=N` picks the harvest's tree). It is one self-contained file (no network),
so it can be hosted anywhere or opened in an in-app browser. `?view=2d`
starts in the flat view.

Harvest, all with a finger or mouse:

- Chop: swipe into the trunk from the side. The notch lands where your
  finger is, as deep as you swipe in (one swing only goes so far), and a
  quick swing bites where a slow drag only rests on the bark. Keep chopping
  until the wood cracks. It falls the way you cut.
- Delimb: swipe across a branch to cut it right there. The outer part falls
  away and the stub can be cut again. Cut close to the log to finish a limb.
  Thick branches take more than one swipe.
- Delimb is done when the log looks clean: a limb cut down to a short stub
  (up to twice the flush length) counts as clean, and the counter and the saw
  gate use that one definition. Any swipe that crosses a limb cuts it, the
  crown leader lying along the log included.
- Saw: top-down on the log. Press where you want a cut and rub back and
  forth across it. One long drag is one stroke; it takes real rubbing. Two
  cuts free the middle piece, which becomes the blank. Cuts will not start
  too close to the ends or to each other (the shaded zones).

The lathe:

- Touch or click below the log: the chisel lands on the wood.
- Nudge up: the first ~40px of push ramps pressure to full (the meter beside
  your finger shows it). More pressure, deeper pass.
- Hold still or move slowly to cut deep; whip across to only score it.
  Going deeper than one pass takes another pass. Light passes smooth.
- `1` / `2` switch gouge / skew.

## Code

```
src/index.html      dev entry: open directly, no build needed
src/js/cutting.js   cutting model + pressure mapping (pure, no DOM; tests run in Node)
src/js/harvest.js   harvest model: chop, fall (rigid body), delimb, saw, blank (pure, tested in Node).
                    TREES holds one row of data per wood (trunk taper, branch layout, foliage)
src/js/harvest-view.js  Canvas2D forest and saw view, input mapping, chips, leaves, shake
src/js/main.js      state, input, frame loop, UI
src/js/save.js      versioned localStorage save (wallet, farm), memory fallback
src/js/farm.js      farm model: plots, real-time growth, diamonds, land, chopping (pure)
src/js/farm-ui.js   farm screen, tabs, wallet, swipe input
src/js/view3d.js    Three.js view
src/js/view2d.js    Canvas2D view (fallback and first-class view)
src/js/audio.js     synthesised cut / motor / catch sounds
src/vendor/         three.js r186 (bundled build that sets window.THREE)
tools/build.mjs     inlines src/ into the single-file lathe.html
tests/              model tests (node --test) and a Playwright browser check
```

Trees are data. `makeTree(seed, wood)` in `harvest.js` rolls a tree from the
`TREES` row for that wood (pine, oak, walnut), and the Canvas2D view draws
whatever it is given, taking bark and leaf colours and the leaf style from the
farm's wood table (`Game.Farm.WOODS`: `trunk`, `leaf`, `leaf2`, `shape`). A new
tree is a new row in `TREES` and in the farm's `WOODS` (a test keeps the two in
step), not new drawing code. The trunk outline is the wood that remains, so a
chopped notch is a hole you can see through; `node tools/harvest-shots.mjs`
saves pictures of a chopped tree and a log for checking the art.

Both views draw from the same radius profile; the model never knows which
view is showing. Tuning lives in `CFG` and `TIPS` at the top of `cutting.js`.

```
npm test        # cutting model, farm model, save, harvest model
npm run e2e     # builds, then plays the harvest into the lathe, drives the lathe (both views) and the farm in Chromium
npm run build   # rebuild lathe.html after editing src/
```

## Build order

Lathe feel first: a smooth profile and a satisfying cut. Then the rest of the
pipeline, then the farm, commissions, and shop.

## Status

Prototype stage: lathe base. No name yet, no release yet. Built with AI assistance,
directed by Brandon.

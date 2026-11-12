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

## Play

Open `lathe.html` in a browser. It is one self-contained file (no network),
so it can be hosted anywhere or opened in an in-app browser. `?view=2d`
starts in the flat view.

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
src/js/main.js      state, input, frame loop, UI
src/js/view3d.js    Three.js view
src/js/view2d.js    Canvas2D view (fallback and first-class view)
src/js/audio.js     synthesised cut / motor / catch sounds
src/vendor/         three.js r186 (bundled build that sets window.THREE)
tools/build.mjs     inlines src/ into the single-file lathe.html
tests/              model tests (node --test) and a Playwright browser check
```

Both views draw from the same radius profile; the model never knows which
view is showing. Tuning lives in `CFG` and `TIPS` at the top of `cutting.js`.

```
npm test        # model: pressure, rate cap, pass depth, smoothness, mapping
npm run e2e     # builds, then drives both views in Chromium
npm run build   # rebuild lathe.html after editing src/
```

## Build order

Lathe feel first: a smooth profile and a satisfying cut. Then the rest of the
pipeline, then the farm, commissions, and shop.

## Status

Prototype stage: lathe base. No name yet, no release yet. Built with AI assistance,
directed by Brandon.

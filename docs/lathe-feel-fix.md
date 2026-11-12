# Lathe feel fix brief

For: Claude, building the base in this repo.
Source: playtest feedback from Brandon, Nov 12, 2026.
Current snapshot: `lathe-prototype.html` (exported from the Muse prototype).
Design doc: `DESIGN.md`.

## What works and must not regress

- The cutting model: rate-capped removal, slow steady pressure cuts deep,
  a fast whip across only scores the surface, and it cannot cut through
  instantly (minimum radius guard).
- Two chisel tips, GOUGE (wide rounded trough) and SKEW (narrow flat groove).
- Chips and dust fly from the contact point, sound, RPM control, NEW LOG.
- The 2D fallback renderer looks good. Brandon says it looks better than the
  3D right now and does not even look 2D. It is the visual bar, and it must
  keep working, including in webviews (Muse in-app browser, Facebook).
- Works in Chrome. The in-app webview fix (opaque WebGL canvas, Canvas2D
  fallback, manual 2D/3D toggle) must not regress.

## Issue 1: the 3D view is mirrored

In the 3D view, dragging the finger to the right cuts the left side of the
log. The horizontal mapping from screen position to profile position is
inverted in the 3D renderer.

Fix: invert the screen-x to profile mapping for the 3D view so the finger
position maps to the same side of the log it is on. Drag right, the cut
appears on the right. Drag left, the cut appears on the left. Verify by
dragging across the log and confirming the cut follows the finger.

## Issue 2: the pressure mapping is wrong

Right now, touching below the wood puts the chisel against the wood, but
cutting only starts after dragging the finger all the way up into the center
of the log. That means the finger has to travel over the wood and cover the
exact spot being cut.

Desired interaction:

- Touch down below the wood: the chisel snaps to the wood surface (contact).
- A short upward drag from the surface starts cutting. The first small bit of
  upward travel (roughly the first 40px above the surface) ramps pressure
  from zero to full depth.
- The chisel tip stays at or near the surface while the cut deepens. The
  cutting depth comes from pressure, not from how far the tip travels into
  the log.
- The finger stays below the wood and never has to cover the cut area.

Acceptance: a short upward nudge from the surface starts a shallow cut, more
upward pressure goes deeper, and the cut stays visible the whole time.

## Issue 3: the turned profile is spiky, not smooth

Cuts currently leave sharp spiky notches, so the piece looks chewed instead
of turned. Real turning makes smooth flowing curves.

Fix: smooth the profile after each cut so overlapping cuts blend into
curves. A light smoothing pass over the profile array, a wider falloff on
the cut kernel, or both. The turned shape should read as a clean turned
piece (bowls, spindles, walking sticks), not a sawtooth.

## Goal

A good base to build the full game on: a lathe that feels right, in this
repo, with the mapping, pressure, and profile fixes above. The full game
spec comes after this base playtests well.

## Resolution (prototype 02)

- Issue 1, mirrored 3D: the blank's group was rotated `+PI/2` about Z, which
  put profile slice 0 at world +X (screen right) while input mapped slice 0 to
  screen left. Now `-PI/2`, so both views agree. `tests/e2e.mjs` checks that
  the deepest point is drawn under the finger in each view (it fails on the
  old rotation).
- Issue 2, pressure: `Pressure` in `src/js/cutting.js`. Touch-down anchors
  contact at zero pressure; upward travel over `PRESS_RAMP_PX` (40) ramps to
  full; moving down re-anchors. Pressure sets the depth of the pass
  (`PASS_DEPTH` at full) and the tip rides the bottom of the cut. Removal is
  still rate-capped, MIN_R still guards the core, a slammed-in push is a catch.
- Issue 3, spiky profile: three causes, three fixes. The old removal had a
  30% step at the kernel edge (now kernels fall to zero with zero slope); the
  kernel centre snapped to whole slices (now fractional, and slices went from
  120 to 240); and each slice cut toward its own height (now the bevel rides
  the surface under the tip, so passes cut toward a smoothed surface and light
  passes plane ridges). A rolling-ball round-over (tool nose radius) turns any
  fin narrower than the nose into a rounded bead. `npm test` checks a seeded
  roughing sequence leaves no fins (the old model leaves several on the same cuts).

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

- Lathe prototype: a spinning 3D log you shape by dragging a chisel.
  Two chisel tips (gouge / skew), chips fly, fast drags cut shallow, slow
  pressure cuts deep, and it can't cut through instantly. Built in Three.js.
- Known issues from the first playtest (Nov 12): the turned profile comes out
  spiky and chewed instead of smooth flowing curves, and the feel is a bit
  janky. Also, the 3D view is blank in the Muse in-app browser (works in
  Chrome); a webview fix is in progress, since the game has to survive
  Facebook's in-app browser too.
- The prototype source lands in this repo once that fix is in.

## Build order

Lathe feel first: a smooth profile and a satisfying cut. Then the rest of the
pipeline, then the farm, commissions, and shop.

## Status

Prototype stage. No name yet, no release yet. Built with AI assistance,
directed by Brandon.

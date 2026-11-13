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
  timestamp, never a running timer). A seed costs coins (pine 10, oak 30,
  walnut 50, `plantPrice` in the registry); short of coins, one finished ad
  plants it for free (no ads with the full unlock, so a seed just costs coins).
  Diamonds speed it up, coins buy more land,
  and a fully grown tree is tapped, then HARVEST takes it to the forest. Trees
  are never chopped on the farm itself; `farm.fell` is the only way a tree
  leaves a plot, and the log goes to the shed, which is what commissions read.
  Saves live in localStorage (`woodturning.save`).

- Harvest (slice 1): the forest. There is no tab for it: it opens only from a
  grown farm tree (tap the tree, then HARVEST). Chop the tree where you
  swipe, watch it crack and fall, clear the limbs with a blade, saw the log
  in two places, and the middle piece goes straight onto the lathe as the
  blank. Canvas2D only, so it runs in every webview. Asking for the forest
  with no grown tree picked (a `#harvest` link, say) lands on the farm.

- Paint and finish (slice 4): the lathe has CUT / PAINT / FINISH modes that
  share one input (touch below the log, nudge up; pressure is flow). PAINT lays
  colour on the spinning piece with a wide soft brush or a fine liner, from a
  nine-colour palette: slow and steady gives a solid coat, a fast whip only a
  thin streak, and changing colour mid-stroke blends a gradient. FINISH is a
  spray bottle: mist builds sheen where you aim it, and a lamp sweeps the piece
  so the gloss catches the light (matte stays flat). Cutting wood away takes its
  paint with it. A paint spec (bands, pinstripes, a dipped end, a sheen) is shown
  as a WANTED strip over YOURS with a live match score, and the paints the spec
  needs are marked in the palette. Until commissions land the lathe rolls its
  own spec (NEW SPEC); a commission hands one in with `__lathe.setSpec(spec)` or
  by calling `Lathe.Paint.generateSpec`. Keys: `3` cut, `4` paint, `5` finish.

- Monetization (slice 6): the money model, kept honest. Diamonds are called
  diamonds, and they are the only premium currency. One finished ad lets you
  into the mine (below), no randomness. Diamonds skip growing time, grow a tree now, or buy land. The full
  unlock ($5, one constant in `src/js/monetize.js`) removes every ad and every
  timer. The free game is complete: the core loop never asks for diamonds,
  an ad, or the unlock. Ads and payments are two seams (`MineUI.adProvider`,
  `MineUI.payProvider`) with a labelled house ad and a no-charge preview
  purchase until the Play Store slice wires AdMob and Play Billing. Play Pass
  notes are in `docs/play-pass.md` (open question, not applied for).

- Commissions: the ORDERS tab is a board of up to three orders. Each asks
  for a turned piece (rolling pin, walking stick, chair leg, banister spindle,
  baseball bat) with a target shape, the wood it must be made from, a paint
  spec and a sheen, and pays coins: finer wood pays more. TAKE IT puts the
  order on the lathe, mounting that wood from the shed if there is some: the
  target is a ghost outline on the piece and in the profile strip, with a live
  SHAPE score, and its paint spec is on the spec card. With none of that wood,
  the card offers PRACTISE IT instead, and the lathe says plainly (a red banner
  and the spec card) that the piece is practice only and cannot be delivered.
  With the wood in the shed, PRACTISE is still there: the order goes on a free
  practice blank and the wood stays in the shed.
  DONE grades the piece (shape 55%, paint 35%, sheen 10%). Under 50% the
  customer turns it down: no pay, and the piece stays in the shed. From 50% to
  90% the pay rises from 30% to all of the reward, and at 90% and up it is the
  full reward plus a 10% bonus (one to three stars). DELIVER or KEEP IT. Only
  the named wood can be delivered; turned pieces already in the shed can be
  delivered from the board. A declined or delivered order is replaced after
  three minutes, worked out from the saved clock, so orders come in while the
  game is closed; GET ONE NOW on the empty slot posts one at once for a
  diamond. Model in `src/js/commissions.js`, screen in
`src/js/commissions-ui.js`; the save section is `commissions`.

- Arbor Freight (the SHOP tab): the workshop's tool store, where coins from
  orders buy upgrades. Three lines, each a ladder bought in order, every rung
  about four times the price of the last:
  - Lighting: bare bulb, halogen work light (150), LED shop panel (600), studio
    light bar (2400). The lamp hangs at the top of the workshop and the light
    on the piece comes from it, in both views.
  - Motor: the stock half horse is weak on purpose; one horse (300), horse and
    a half (1100) and two horse (4000) each cut about 1.5x faster than the last,
    three times the stock motor at the top.
  - Chisels: gouge and skew, then a parting tool (200), detail gouge (700) and
    roughing gouge (2500), each a new button on the chisel rack.
  Model in `src/js/shop.js` (save section `shop`), screen in `src/js/shop-ui.js`;
  chisel tips are data in `TIPS` in `cutting.js`.

- The mine: the MINE tab's ad no longer pays out directly. One finished ad
  (about 5 seconds, close button always there) lets you into the mine: a
  timbered shaft with a diamond vein in the middle. Swipe the pick across it;
  fast swings bite, slow drags just tink. Each strike throws rock chunks, dust
  and sparks and opens a crack where it landed, and the old cracks creep. When
  it breaks the diamonds tumble out and fly to the wallet: exactly 5, every
  time. Leaving halfway keeps the visit. The full unlock walks straight in.
  Model in `src/js/vein.js`, scene in `src/js/mine-scene.js`, and the payout is
  one function, `awardVein` in `src/js/monetize-ui.js`.

- New-player flow: a guided first session (brief: `docs/new-player-flow.md`).
  A new game opens on the lathe alone, a pine log mounted and two more in the
  shed, with no coins or diamonds. A coach card and a pulsing ring on the real
  control walk the player through it, and each tab appears only when it is
  needed: a practice cut, paint, finish and DONE; ORDERS opens on two authored
  orders (pine, then oak); the oak needs the FARM (the seed is topped up if
  short), 5 diamonds to GROW NOW, and the forest's chop, delimb and saw; then
  the oak order is turned and delivered. Graduation opens SHOP and MINE and
  fills the board. While the flow runs the board does not post or offer
  DECLINE, PRACTISE or GET ONE NOW. "Skip tutorial" on the first card opens
  everything with the starter pack (250 coins, 5 diamonds). Saves from before
  the flow skip it. The steps are data in `src/js/tutorial.js`; the card, ring
  and tab gating are `src/js/tutorial-ui.js`. `?tutorial=off` skips it (the
  older browser checks use it).

## Play

Open `lathe.html` in a browser. The gear in the header opens Settings, where
RESET PROFILE (two taps) starts over as a brand-new player; `?reset` on the URL
does the same. The FARM, LATHE, MINE, ORDERS and SHOP tabs switch
screens (`lathe.html#farm` opens the farm, `#harvest` the forest, `#mine` the mine,
`#orders` the commission board, `#shop` Arbor Freight,
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
- Delimb is done when the log looks clean: a limb with at least two thirds of
  its length cut off counts as clean and comes away flush, and the counter and
  the saw gate use that one definition. Any swipe that crosses a limb cuts it,
  the crown leader lying along the log included, and swipes that land a little
  apart add up.
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
- `1` / `2` switch gouge / skew. Chisels bought at Arbor Freight join the rack.

## Code

```
src/index.html      dev entry: open directly, no build needed
src/js/cutting.js   cutting model + pressure mapping (pure, no DOM; tests run in Node)
src/js/harvest.js   harvest model: chop, fall (rigid body), delimb, saw, blank (pure, tested in Node).
                    TREES holds one row of data per wood (trunk taper, branch layout, foliage)
src/js/harvest-view.js  Canvas2D forest and saw view, input mapping, chips, leaves, shake
src/js/paint.js     paint, finish and spec model: coat per slice, grading (pure, no DOM)
src/js/main.js      state, input, frame loop, UI
src/js/save.js      versioned localStorage save (wallet, farm), memory fallback
src/js/farm.js      farm model: plots, real-time growth, diamonds, land, chopping (pure)
src/js/farm-ui.js   farm screen, tabs, wallet, tap input
src/js/tutorial.js  the new-player flow: ordered steps, unlocks, grants (pure)
src/js/tutorial-ui.js  the coach card, the highlight ring, hidden tabs
src/js/commissions.js     commission model: orders, target shapes, grading, the board (pure)
src/js/commissions-ui.js  the commission board screen and the grade dialog
src/js/shop.js      Arbor Freight model: upgrade lines, tiers, prices, buying (pure)
src/js/shop-ui.js   the store screen
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

Both views draw from the same radius profile and the same coat; the models never
know which view is showing. Tuning lives in `CFG` and `TIPS` at the top of `cutting.js`.

```
npm test        # cutting model, farm model, save, harvest model, paint and finish model
npm run e2e     # builds, then plays the harvest into the lathe, drives the lathe (both views), the farm, paint and finish, the commission board, the store and the new-player flow in Chromium
npm run build   # rebuild lathe.html after editing src/
```

The browser checks drive the lathe on a test clock: `lathe.html?testclock` stops
the lathe following the wall clock, and a test moves time with
`__lathe.advance(seconds)` in fixed 1/60 s steps (the forest has
`__harvest.advance` too). A held push then cuts the same depth on any machine,
GPU or not, and a three-second hold takes milliseconds. Most checks use the flat
2D view (`?view=2d`), which renders quickly without a GPU; the 3D view gets a
short smoke test. GitHub Actions (`.github/workflows/test.yml`) runs `npm test`
and every browser check, each in its own job, on every pull request.

## Build order

Lathe feel first: a smooth profile and a satisfying cut. Then the rest of the
pipeline, then the farm, commissions, and shop.

## Status

Prototype stage: lathe base. No name yet, no release yet. Built with AI assistance,
directed by Brandon.

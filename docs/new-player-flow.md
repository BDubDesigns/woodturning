# New player flow: a guided first session

Status: planned, not started. This is the brief for the session that builds it.

## The problem

A new player opens the game straight onto the lathe. A random practice paint
spec sits on the spec card, five tabs are open, and nothing says what to do.
They have 250 coins, 5 diamonds and an empty shed. The game needs a first
session that is authored, unlocks one thing at a time as it is needed, and
teaches the real UI: tabs and buttons are highlighted in place, never replaced
by shortcut buttons in a popup.

## The flow, step by step

Each step names what is unlocked, what the coach says, and what ends the step.
"Coach" is a small popup card plus a highlight ring on the real control the
player should touch next.

0. **First open.** Only the LATHE tab shows; FARM, MINE, ORDERS, SHOP are
   hidden until unlocked. The shed holds **3 pine logs**. A pine log is
   mounted. The spec card is hidden.
   Coach: welcome; this is your lathe; touch below the log and nudge up to cut.
1. **Practice cut.** Cut freely, as much or as little as you like, but some:
   the step ends when at least ~2% of the wood is removed (`work.removedFraction()`).
   Coach on success: nice, now let's paint it. Highlight the PAINT mode button.
2. **Paint.** Spec card appears (practice, no order). Coach explains brush vs
   liner and the palette; step ends when some paint is on (`coat.coverage()` > a
   small threshold). Then highlight FINISH.
3. **Finish.** Coach explains the spray and the lamp; step ends when the sheen
   reaches satin or better, or after a sensible amount of spraying. Then
   highlight DONE. DONE keeps the piece (it is a real pine log, so it goes to the
   shed as a piece).
4. **Orders unlock.** The ORDERS tab appears and is highlighted. The board is
   **authored**, two simple orders:
   - a pine order (rolling pin, "dipped" two-colour spec, matte), easy, and
   - an order for the **next wood up** (see open question 1), a little better paid.
   The coach points at the pine one: you have pine logs, take this one.
   No random orders are posted while the tutorial runs (the board's refill is
   paused).
5. **First commission.** TAKE IT on the pine order mounts a pine log. The coach
   explains the dashed target line and the live SHAPE %, then paint to spec and
   finish, then DONE and DELIVER. Coins come in.
6. **The wood you don't have.** Back on the board only the second order is left.
   Its card already says there is none of that wood in the shed. The coach says
   so and highlights the FARM tab (the FARM tab appears now).
7. **Plant.** On the farm the coach highlights an empty plot, then the right
   wood's plant button. Planting now costs coins (see "Systems" below); the
   tutorial makes sure the player can afford it. Hint text: trees grow in real
   time, even with the game closed, so keep some planted.
   If the player cannot afford the seed, offer "watch an ad to plant" (the same
   ad provider the mine uses).
8. **Speed it up.** The player is given **5 diamonds** (see open question 2), and
   the coach highlights GROW NOW / SPEED UP on the plot. The tree finishes.
9. **Harvest.** Coach highlights the grown tree, then HARVEST. In the forest a
   coach card walks each step: CHOP (swipe into the trunk from the side), DELIMB
   (swipe across each limb; two thirds off is enough), SAW (rub back and forth
   at two marks). The blank goes to the lathe.
10. **Turn the order.** The order is already on (or the coach highlights ORDERS
    and TAKE IT). Turn to the line, paint, finish, DONE, DELIVER.
11. **Graduation.** Tutorial ends. The board refills normally; SHOP unlocks with a
    coach card pointing at the first cheap upgrade (halogen, 150); MINE unlocks
    with one line on what it is for. From here everything is open.

## Systems to build

- **`src/js/tutorial.js`** (pure model, Node-tested): an ordered list of steps,
  each with an id, the tabs it unlocks, an `isDone(game)` check, and copy for
  the coach. Owns a save section `tutorial { step, done }`. Exposes `step()`,
  `advance()`, `unlocked(tab)`, `skip()`.
- **`src/js/tutorial-ui.js`**: the coach card (a small popup that never blocks
  the control it points at) and a highlight ring that follows a target element
  (by id or selector) through resizes. It listens to the same events the game
  already raises (mode change, DONE, deliver, plant, speed-up, harvest phase
  changes) or polls `isDone` once a second, whichever is simpler.
- **Tab gating** in `farm-ui.js` `showScreen` and the tab bar: hidden tabs for
  locked screens, and a `#hash` for a locked screen lands on the current step's
  screen.
- **Commissions** (`commissions.js`): an authored first board (two fixed orders,
  fixed seeds and specs so the shapes are easy) and a `paused` flag that stops
  `refill()` until the tutorial ends. Existing tests must still pass.
- **Planting costs coins** (`farm.js` `plant`): a price per wood, rarer woods
  dearer, e.g. pine 10, oak 40, walnut 120 (tune). Kept in the registry with the
  wood (`plantPrice`). Not enough coins: "watch an ad to plant" through
  `MineUI.adProvider` (`monetize-ui.js`), which runs a short house ad and then
  plants for free. With the full unlock there are no ads, so planting is free or
  just costs coins (decide).
- **Wood pays more as it gets rarer**: already true for commissions
  (`WOOD_PAY` in `commissions.js`: pine 1, oak 1.6, walnut 2.4). Keep it, and make
  sure the plant price never makes a wood a loss.
- **Starting state** for a new game (`save.js` `newGame`): 3 pine logs in the
  shed. Coins and diamonds at start may need retuning around the tutorial grants.
- **Existing saves skip the tutorial.** A save that already has farm plots,
  pieces, delivered orders or shop purchases starts with `tutorial.done = true`,
  so nobody who has played gets walked back through it.
- **A way out**: a small "skip tutorial" link on the first coach card.

## Where things live today (for orientation)

- Screens and tabs: `src/js/farm-ui.js` (`showScreen`, `tabs`, the start screen
  from the URL hash), HTML in `src/index.html`.
- Lathe: `src/js/main.js` (modes `setMode`, DONE `finishPiece`, stock mounting
  `mountStock`, the spec card `setSpec`, orders `syncOrder` / `takeOrder`).
- Board: `src/js/commissions.js` (model, `createBoard`, `refill`, `makeOrder`)
  and `src/js/commissions-ui.js`.
- Farm: `src/js/farm.js` (`plant`, `speedUp`, `finishNow`, `isMature`) and the
  plot UI in `farm-ui.js`. Harvest opens from the farm via `G.harvestPlot`.
- Forest: `src/js/harvest.js` (phases `chop` / `delimb` / `saw` / `done`, events
  via `drain()`), view in `src/js/harvest-view.js`.
- Ads: `MineUI.adProvider.show(reason, done)` in `src/js/monetize-ui.js`.
- Store: `src/js/shop.js` and `src/js/shop-ui.js`.
- Save: `src/js/save.js` (sections; each system normalizes its own).
- Tests: `npm test` (Node), `npm run e2e` (Playwright, all browser checks).
  Add `tests/tutorial.test.js` and `tests/e2e-tutorial.mjs` that plays the whole
  flow from a fresh save, and make every existing e2e start with the tutorial
  skipped (a `?tutorial=off` flag or a seeded save) so they keep testing what
  they test.

## Open questions for Brandon

1. **Which wood is the second order?** The brief says "the next tier up" and
   also "they have no walnut". The next tier after pine is **oak** (8 minutes to
   grow; walnut is 15). Default: oak, since it is the next tier, and 5 diamonds
   (each skips 2 minutes) cover its 8-minute grow with one to spare. Walnut
   would need 8.
2. **"Gems" are diamonds now.** Gems were removed earlier; diamonds are the
   premium currency. Default: grant 5 diamonds.
3. **Plant prices** (pine 10, oak 40, walnut 120 suggested) and whether the full
   unlock makes planting free.
4. **When do SHOP and MINE unlock?** Default: both at graduation (step 11).

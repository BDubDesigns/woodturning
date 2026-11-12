# Google Play Pass: application notes

Status: open question. Nothing here is submitted. This is a checklist for the
decision, not a decision.

## Why it fits

- The free game is already complete and has no required purchase.
- The full-unlock build (`game.mine.unlocked`) already means no ads and no
  timers, which is the shape a subscription catalog title usually needs.
- Diamonds only skip waiting, so a Pass build loses nothing from the core loop.

## What to settle before applying

1. **Ads and purchases inside a Pass title.** Check Google's current Play Pass
   requirements for ads and in-app purchases before applying. If they are not
   allowed, the Pass build would ship as the unlocked game: set
   `mine.unlocked` true at start and hide the mine's ad trade.
2. **Pricing overlap.** The full unlock is one number, `UNLOCK_PRICE_USD` in
   `src/js/monetize.js` ($5 or $10, still open). A Pass listing and a paid
   unlock for the same game need a clear story so players are not charged twice.
3. **Store prerequisites** come with Slice 7 (Play Store packaging and listing):
   developer account, signed bundle, content rating, privacy policy.

## What the code already gives a Pass build

- A single flag that removes ads and timers (`createMine(...).unlock()`).
- Ads and payments behind two seams, `MineUI.adProvider` and
  `MineUI.payProvider` (`src/js/monetize-ui.js`), so the store build swaps in
  real AdMob and Google Play Billing without touching the game rules.

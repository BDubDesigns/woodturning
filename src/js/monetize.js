/* ============================================================
   Monetization model: pure, renderer-free, testable in Node.

   The money model, kept honest:
     - The free game is a complete game. Nothing in the core loop
       (plant, grow, chop, turn) ever asks for diamonds, gems, an
       ad, or the unlock. Diamonds only skip waiting.
     - The mine is a plain trade: finish one ad, get a fixed reward.
       No dice, no hidden rates. `trade()` is the single source for
       what the screen says and what the model pays.
     - Gems are a second mine result that sells for coins at a fixed
       rate shown on screen.
     - The full-unlock removes ads and every timer. It never removes
       or adds anything to the core loop, since the core loop is free.

   State lives in the save as `game.mine`:
     { unlocked, adsWatched, gemsSold }
   and `game.wallet.gems`. The model owns both and is handed the
   wallet and the save object, same as the farm.

   Ads and payments are seams: the model never shows an ad or takes
   money. The UI asks a provider, then tells the model the result.
   ============================================================ */
(function (root) {
  "use strict";

  var CFG = {
    DIAMONDS_PER_AD: 3,        // mine diamonds: one finished ad pays this many
    GEMS_PER_AD: 1,            // mine gems: one finished ad pays this many
    COINS_PER_GEM: 25,         // what a gem sells for
    AD_SECONDS: 5,             // length of the house ad
    UNLOCK_PRICE_USD: 5,       // open question in the plan: $5 or $10. One number to change.
    COINS_PER_DIAMOND_LAND: 10 // land can also be bought with diamonds at this rate (see farm.js)
  };

  function defaultMine() { return { unlocked: false, adsWatched: 0, gemsSold: 0 }; }

  function count(n) { return typeof n === "number" && isFinite(n) && n >= 0 ? Math.floor(n) : 0; }

  /* Accept whatever a save held and make it safe to use. */
  function normalizeMine(m) {
    var out = defaultMine();
    if (!m || typeof m !== "object") return out;
    out.unlocked = m.unlocked === true;
    out.adsWatched = count(m.adsWatched);
    out.gemsSold = count(m.gemsSold);
    return out;
  }

  /* What one trip to the mine pays, for either kind. The screen prints
     this and the model pays this. Nothing else decides a reward. */
  function trade(kind) {
    if (kind === "diamonds") return { kind: "diamonds", amount: CFG.DIAMONDS_PER_AD, noun: CFG.DIAMONDS_PER_AD === 1 ? "diamond" : "diamonds" };
    if (kind === "gems") return { kind: "gems", amount: CFG.GEMS_PER_AD, noun: CFG.GEMS_PER_AD === 1 ? "gem" : "gems" };
    return null;
  }

  function createMine(game, opts) {
    opts = opts || {};
    var onChange = opts.onChange || function () {};
    game.mine = normalizeMine(game.mine);
    var mine = game.mine, wallet = game.wallet;
    if (typeof wallet.gems !== "number" || !isFinite(wallet.gems) || wallet.gems < 0) wallet.gems = 0;

    function isUnlocked() { return mine.unlocked === true; }
    /* Whether the mine asks for an ad. */
    function needsAd() { return !isUnlocked(); }

    /* Pay out a mining trip. `adFinished` is what the ad provider said:
       true only if the ad ran to the end. Unlocked players skip the ad
       and are paid the same. A closed ad pays nothing and costs nothing. */
    function mineReward(kind, adFinished) {
      var t = trade(kind);
      if (!t) return { ok: false, reason: "unknown kind" };
      if (needsAd() && adFinished !== true) return { ok: false, reason: "ad not finished" };
      wallet[kind] += t.amount;
      if (needsAd()) mine.adsWatched += 1;
      onChange();
      return { ok: true, kind: kind, amount: t.amount };
    }

    function sellGems(n) {
      var have = wallet.gems;
      var qty = n === undefined || n === "all" ? have : Math.floor(n);
      if (!(qty >= 1)) return { ok: false, reason: "no gems to sell" };
      if (qty > have) return { ok: false, reason: "not enough gems" };
      var coins = qty * CFG.COINS_PER_GEM;
      wallet.gems -= qty;
      wallet.coins += coins;
      mine.gemsSold += qty;
      onChange();
      return { ok: true, gems: qty, coins: coins };
    }

    /* Called once the store (or the preview confirmation) says the
       purchase went through. */
    function unlock() {
      if (mine.unlocked) return { ok: false, reason: "already unlocked" };
      mine.unlocked = true;
      onChange();
      return { ok: true };
    }

    return {
      state: mine, wallet: wallet,
      isUnlocked: isUnlocked, needsAd: needsAd, timersOff: isUnlocked,
      mineReward: mineReward, sellGems: sellGems, unlock: unlock
    };
  }

  function priceLabel() { return "$" + CFG.UNLOCK_PRICE_USD; }

  var api = { CFG: CFG, defaultMine: defaultMine, normalizeMine: normalizeMine, trade: trade, createMine: createMine, priceLabel: priceLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Monetize = api;
})(typeof window !== "undefined" ? window : globalThis);

/* ============================================================
   Farm model: pure, renderer-free, testable in Node.

   A plot is null (empty) or
     { wood, plantedAt, skipped }
   plantedAt is a wall-clock timestamp in ms. Growth is derived
   from the clock every time it is asked for, never counted down
   by a timer, so a tree grows exactly as much while the game is
   closed as while it is open. Diamonds add to `skipped`, which
   counts as time already grown.

   The model owns the farm section of the save: the plots. Money
   goes through the shared wallet and felled trees go into the
   shared inventory (state.js), so every tab sees the same logs.
   The woods themselves are registry data (registry.js).
   ============================================================ */
(function (root) {
  "use strict";

  var MIN = 60 * 1000;
  var Game = root.Game || {};
  var R = Game.Registry || require("./registry.js");
  var State = Game.State || require("./state.js");

  // The registry's tables, shared: a wood added there grows here too.
  var WOODS = R.WOODS;
  var WOOD_ORDER = R.WOOD_ORDER;

  var CFG = {
    START_PLOTS: 2,
    MAX_PLOTS: 9,
    LAND_PRICES: [100, 200, 400, 700, 1100, 1600, 2200],   // price of plot 3, 4, 5, ...
    DIAMOND_MS: 2 * MIN                                    // one diamond skips this much growth
  };

  // Progress thresholds for the drawn stage of a growing tree.
  var STAGES = [["seed", 0], ["sprout", 0.12], ["sapling", 0.4], ["young", 0.75], ["mature", 1]];

  function defaultFarm() {
    var plots = [];
    for (var i = 0; i < CFG.START_PLOTS; i++) plots.push(null);
    return { plots: plots, lastSeen: 0 };
  }

  /* Accept whatever a save held and make it safe to use. */
  function normalizeFarm(f) {
    var out = defaultFarm();
    if (!f || typeof f !== "object") return out;
    if (Array.isArray(f.plots) && f.plots.length >= CFG.START_PLOTS) {
      out.plots = f.plots.slice(0, CFG.MAX_PLOTS).map(function (p) {
        if (!p || typeof p !== "object" || !WOODS[p.wood] || !isFinite(p.plantedAt)) return null;
        return {
          wood: p.wood, plantedAt: p.plantedAt,
          skipped: isFinite(p.skipped) && p.skipped > 0 ? p.skipped : 0
        };
      });
    }
    if (isFinite(f.lastSeen)) out.lastSeen = f.lastSeen;
    return out;
  }

  /* game: the save object.
     opts.state: the shared state (state.js). Made over `game` if not given.
     opts.now: () => ms, so tests can drive the clock.
     opts.onChange: called after any change worth saving. */
  function createFarm(game, opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var onChange = opts.onChange || function () {};
    // opts.timersOff: () => bool. The full unlock removes every timer: trees are ready the moment they are planted.
    var timersOff = opts.timersOff || function () { return false; };
    var state = opts.state || State.createState(game, { onChange: onChange, now: now });
    game.farm = normalizeFarm(game.farm);
    var farm = game.farm, wallet = state.wallet, inventory = state.inventory;

    function changed() { onChange(); }
    function plotAt(i) { return i >= 0 && i < farm.plots.length ? farm.plots[i] : null; }

    function grownMs(p) { return Math.max(0, now() - p.plantedAt) + p.skipped; }
    function progress(p) { return timersOff() ? 1 : Math.min(1, grownMs(p) / WOODS[p.wood].growMs); }
    function remainingMs(p) { return timersOff() ? 0 : Math.max(0, WOODS[p.wood].growMs - grownMs(p)); }
    function isMature(p) { return !!p && remainingMs(p) <= 0; }
    function stage(p) {
      if (!p) return "empty";
      var pr = progress(p), name = "seed";
      for (var i = 0; i < STAGES.length; i++) if (pr >= STAGES[i][1]) name = STAGES[i][0];
      return name;
    }
    function diamondsToFinish(p) { return Math.ceil(remainingMs(p) / CFG.DIAMOND_MS); }

    function plant(i, woodId) {
      if (!WOODS[woodId]) return { ok: false, reason: "unknown wood" };
      if (i < 0 || i >= farm.plots.length) return { ok: false, reason: "no such plot" };
      if (farm.plots[i]) return { ok: false, reason: "plot is taken" };
      farm.plots[i] = { wood: woodId, plantedAt: now(), skipped: 0 };
      changed();
      return { ok: true };
    }

    /* Spend one diamond to skip DIAMOND_MS of growth. */
    function speedUp(i) {
      var p = plotAt(i);
      if (!p) return { ok: false, reason: "nothing growing" };
      if (isMature(p)) return { ok: false, reason: "already grown" };
      if (!wallet.spend("diamonds", 1).ok) return { ok: false, reason: "not enough diamonds" };
      p.skipped += CFG.DIAMOND_MS;
      changed();
      return { ok: true, cost: 1 };
    }

    /* Spend however many diamonds the rest of the wait is worth. */
    function finishNow(i) {
      var p = plotAt(i);
      if (!p) return { ok: false, reason: "nothing growing" };
      if (isMature(p)) return { ok: false, reason: "already grown" };
      var cost = diamondsToFinish(p);
      if (!wallet.spend("diamonds", cost).ok) return { ok: false, reason: "not enough diamonds", cost: cost };
      p.skipped += remainingMs(p);
      changed();
      return { ok: true, cost: cost };
    }

    function landPrice() {
      var n = farm.plots.length;
      if (n >= CFG.MAX_PLOTS) return null;
      var k = n - CFG.START_PLOTS;
      return CFG.LAND_PRICES[Math.min(k, CFG.LAND_PRICES.length - 1)];
    }
    /* The same land, for diamonds instead of coins. A shortcut, never the
       only way: coins buy it too. */
    function landPriceDiamonds() {
      var price = landPrice();
      return price === null ? null : Math.ceil(price / (opts.coinsPerDiamond || 10));
    }
    function buyLandWithDiamonds() {
      var cost = landPriceDiamonds();
      if (cost === null) return { ok: false, reason: "no more land" };
      if (!wallet.spend("diamonds", cost).ok) return { ok: false, reason: "not enough diamonds", cost: cost };
      farm.plots.push(null);
      changed();
      return { ok: true, cost: cost, index: farm.plots.length - 1 };
    }
    function buyLand() {
      var price = landPrice();
      if (price === null) return { ok: false, reason: "no more land" };
      if (!wallet.spend("coins", price).ok) return { ok: false, reason: "not enough coins", price: price };
      farm.plots.push(null);
      changed();
      return { ok: true, price: price, index: farm.plots.length - 1 };
    }

    /* Fell a grown tree. This is the only way wood leaves the farm: the
       Harvest screen chops it down, then calls this. The plot empties and
       the log goes to the shed (the shared inventory). */
    function fell(i) {
      var p = plotAt(i);
      if (!p) return { ok: false, reason: "nothing growing" };
      if (!isMature(p)) return { ok: false, reason: "not grown yet" };
      farm.plots[i] = null;
      inventory.add("log", p.wood);
      changed();
      return { ok: true, wood: p.wood };
    }
    /* The first grown tree, or -1. */
    function firstMature() {
      for (var i = 0; i < farm.plots.length; i++) if (isMature(farm.plots[i])) return i;
      return -1;
    }

    // The shed is the shared inventory; these read it for the farm's own screens.
    function logCount(woodId) { return inventory.count("log", woodId); }
    function takeLog(woodId) { return !!inventory.take("log", woodId); }

    /* Remember when the player was last here. */
    function touch() { farm.lastSeen = now(); }

    /* Trees that finished growing since the player was last here. Call
       once on load, before touch(). */
    function grownWhileAway() {
      var out = [];
      if (timersOff() || !farm.lastSeen) return out;
      var away = now() - farm.lastSeen;
      if (away <= 0) return out;
      farm.plots.forEach(function (p, i) {
        if (!p || !isMature(p)) return;
        // it was still growing at lastSeen if its grown time then was short of the target
        var grownThen = Math.max(0, farm.lastSeen - p.plantedAt) + p.skipped;
        if (grownThen < WOODS[p.wood].growMs) out.push({ index: i, wood: p.wood });
      });
      return out;
    }

    return {
      state: farm, shared: state, wallet: game.wallet, now: now,
      plotAt: plotAt, progress: progress, remainingMs: remainingMs, isMature: isMature, stage: stage,
      diamondsToFinish: diamondsToFinish,
      plant: plant, speedUp: speedUp, finishNow: finishNow, landPrice: landPrice, buyLand: buyLand, landPriceDiamonds: landPriceDiamonds, buyLandWithDiamonds: buyLandWithDiamonds,
      fell: fell, firstMature: firstMature, logCount: logCount, takeLog: takeLog, touch: touch, grownWhileAway: grownWhileAway
    };
  }

  /* "2:41" under an hour, "1h 12m" under a day, "2d 3h" beyond. */
  function formatDuration(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    if (s < 3600) return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
    var m = Math.ceil(s / 60);
    if (m < 1440) return Math.floor(m / 60) + "h " + (m % 60) + "m";
    var h = Math.ceil(m / 60);
    return Math.floor(h / 24) + "d " + (h % 24) + "h";
  }

  var api = { WOODS: WOODS, WOOD_ORDER: WOOD_ORDER, CFG: CFG, STAGES: STAGES, defaultFarm: defaultFarm, normalizeFarm: normalizeFarm, createFarm: createFarm, formatDuration: formatDuration };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Farm = api;
})(typeof window !== "undefined" ? window : globalThis);

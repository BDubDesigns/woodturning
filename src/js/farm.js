/* ============================================================
   Farm model: pure, renderer-free, testable in Node.

   A plot is null (empty) or
     { wood, plantedAt, skipped, hits, notches }
   plantedAt is a wall-clock timestamp in ms. Growth is derived
   from the clock every time it is asked for, never counted down
   by a timer, so a tree grows exactly as much while the game is
   closed as while it is open. Diamonds add to `skipped`, which
   counts as time already grown.

   The model owns the farm section of the save and the wallet it
   is handed. Commissions read `logCount(wood)` and `takeLog(wood)`
   to see which woods the player actually has.
   ============================================================ */
(function (root) {
  "use strict";

  var MIN = 60 * 1000;

  var WOODS = {
    pine:   { id: "pine",   name: "Pine",   growMs: 3 * MIN,  hits: 4, shape: "conifer", trunk: "#c19a62", leaf: "#3f7a4a", leaf2: "#5a9a5e" },
    oak:    { id: "oak",    name: "Oak",    growMs: 8 * MIN,  hits: 6, shape: "round",   trunk: "#8f6b43", leaf: "#5c8a3a", leaf2: "#7aa84c" },
    walnut: { id: "walnut", name: "Walnut", growMs: 15 * MIN, hits: 7, shape: "round",   trunk: "#5b3d27", leaf: "#456a3a", leaf2: "#5f8a4a" }
  };
  var WOOD_ORDER = ["pine", "oak", "walnut"];

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
    return { plots: plots, logs: {}, lastSeen: 0 };
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
          skipped: isFinite(p.skipped) && p.skipped > 0 ? p.skipped : 0,
          hits: isFinite(p.hits) && p.hits > 0 ? Math.floor(p.hits) : 0,
          notches: Array.isArray(p.notches) ? p.notches.filter(validNotch).slice(0, 12) : []
        };
      });
    }
    if (f.logs && typeof f.logs === "object") {
      for (var id in WOODS) if (isFinite(f.logs[id]) && f.logs[id] > 0) out.logs[id] = Math.floor(f.logs[id]);
    }
    if (isFinite(f.lastSeen)) out.lastSeen = f.lastSeen;
    return out;
  }
  function validNotch(n) { return n && (n.side === -1 || n.side === 1) && isFinite(n.y); }

  /* game = { wallet: { coins, diamonds }, farm } (the save object).
     opts.now: () => ms, so tests can drive the clock.
     opts.onChange: called after any change worth saving. */
  function createFarm(game, opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var onChange = opts.onChange || function () {};
    game.farm = normalizeFarm(game.farm);
    var farm = game.farm, wallet = game.wallet;

    function changed() { onChange(); }
    function plotAt(i) { return i >= 0 && i < farm.plots.length ? farm.plots[i] : null; }

    function grownMs(p) { return Math.max(0, now() - p.plantedAt) + p.skipped; }
    function progress(p) { return Math.min(1, grownMs(p) / WOODS[p.wood].growMs); }
    function remainingMs(p) { return Math.max(0, WOODS[p.wood].growMs - grownMs(p)); }
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
      farm.plots[i] = { wood: woodId, plantedAt: now(), skipped: 0, hits: 0, notches: [] };
      changed();
      return { ok: true };
    }

    /* Spend one diamond to skip DIAMOND_MS of growth. */
    function speedUp(i) {
      var p = plotAt(i);
      if (!p) return { ok: false, reason: "nothing growing" };
      if (isMature(p)) return { ok: false, reason: "already grown" };
      if (wallet.diamonds < 1) return { ok: false, reason: "not enough diamonds" };
      wallet.diamonds -= 1;
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
      if (wallet.diamonds < cost) return { ok: false, reason: "not enough diamonds", cost: cost };
      wallet.diamonds -= cost;
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
    function buyLand() {
      var price = landPrice();
      if (price === null) return { ok: false, reason: "no more land" };
      if (wallet.coins < price) return { ok: false, reason: "not enough coins", price: price };
      wallet.coins -= price;
      farm.plots.push(null);
      changed();
      return { ok: true, price: price, index: farm.plots.length - 1 };
    }

    /* One swipe into the trunk. side is -1 (from the left) or 1 (from
       the right); y is where it landed, 0 at the crown to 1 at the
       base. Enough hits and the tree falls: the plot empties and a log
       of that wood goes to the shed. The real chop mechanic belongs to
       Harvest; this is the seam it plugs into. */
    function chopHit(i, hit) {
      var p = plotAt(i);
      if (!p) return { ok: false, reason: "nothing growing" };
      if (!isMature(p)) return { ok: false, reason: "not grown yet" };
      var side = hit && hit.side === -1 ? -1 : 1;
      var y = hit && isFinite(hit.y) ? Math.min(1, Math.max(0, hit.y)) : 0.7;
      p.hits += 1;
      p.notches.push({ side: side, y: y });
      if (p.notches.length > 12) p.notches.shift();
      var need = WOODS[p.wood].hits;
      if (p.hits >= need) {
        var wood = p.wood;
        farm.plots[i] = null;
        farm.logs[wood] = (farm.logs[wood] || 0) + 1;
        changed();
        return { ok: true, felled: true, wood: wood, hits: need, need: need };
      }
      changed();
      return { ok: true, felled: false, wood: p.wood, hits: p.hits, need: need };
    }

    function logCount(woodId) { return farm.logs[woodId] || 0; }
    function takeLog(woodId) {
      if (!logCount(woodId)) return false;
      farm.logs[woodId] -= 1;
      if (!farm.logs[woodId]) delete farm.logs[woodId];
      changed();
      return true;
    }

    /* Remember when the player was last here. */
    function touch() { farm.lastSeen = now(); }

    /* Trees that finished growing since the player was last here. Call
       once on load, before touch(). */
    function grownWhileAway() {
      var out = [];
      if (!farm.lastSeen) return out;
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
      state: farm, wallet: wallet, now: now,
      plotAt: plotAt, progress: progress, remainingMs: remainingMs, isMature: isMature, stage: stage,
      diamondsToFinish: diamondsToFinish,
      plant: plant, speedUp: speedUp, finishNow: finishNow, landPrice: landPrice, buyLand: buyLand,
      chopHit: chopHit, logCount: logCount, takeLog: takeLog, touch: touch, grownWhileAway: grownWhileAway
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

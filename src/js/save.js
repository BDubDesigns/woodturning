/* ============================================================
   Save and persistence. One JSON blob in localStorage under one
   key, versioned. Pure apart from the storage it is handed, so
   tests run in Node with a fake store. If localStorage is
   missing or blocked (private mode, some webviews) it falls back
   to memory: the game still plays, it just will not remember.

   The save is a plain object made of sections. Each system owns
   and normalizes its own section when it starts, so a new system
   (commissions, the shop, the new-player flow) just adds one:
     { v, wallet: {...}, inventory: {...}, farm: {...}, mine: {...} }
   Any section a save holds is kept, even one this build does not
   know, so an older build never throws away a newer system's data.

   Versions:
     1  wallet { coins, diamonds, gems }, logs in farm.logs
     2  gems are gone; logs, blanks and pieces live in inventory
   ============================================================ */
(function (root) {
  "use strict";
  var KEY = "woodturning.save";
  var VERSION = 2;
  var COINS_PER_OLD_GEM = 25;   // what a v1 gem sold for; old gems turn into coins at that rate

  var R = (root.Game && root.Game.Registry) || (typeof require === "function" ? require("./registry.js") : null);

  /* A fresh game: the starting wallet from the registry, three pine logs
     in the shed for the new-player flow to turn, and the flow at its first
     step. Each other system fills in its own section. */
  var START_LOGS = { pine: 3 };
  function newGame() {
    var wallet = {};
    R.CURRENCY_ORDER.forEach(function (id) { wallet[id] = R.CURRENCIES[id].start; });
    var logs = {};
    for (var w in START_LOGS) logs[w] = START_LOGS[w];
    return { v: VERSION, wallet: wallet, inventory: { stacks: { log: logs }, items: [], nextId: 1 }, farm: null, mine: null, tutorial: { step: null, done: false } };
  }

  function memoryStore() {
    var data = {};
    return {
      persistent: false,
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; }
    };
  }

  function pickStorage(win) {
    try {
      var s = win.localStorage, probe = "__woodturning_probe";
      s.setItem(probe, "1"); s.removeItem(probe);
      return s;
    } catch (e) { return memoryStore(); }
  }

  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function isCount(n) { return typeof n === "number" && isFinite(n) && n >= 0; }

  /* v1 to v2: gems were removed. Any the player held become coins at the
     rate they used to sell for, so nobody loses what they earned. Logs
     move from the farm's shed into the shared inventory. */
  function migrate1(d) {
    var w = isObj(d.wallet) ? Object.assign({}, d.wallet) : {};
    if (isCount(w.gems) && w.gems > 0) w.coins = (isCount(w.coins) ? w.coins : 0) + Math.floor(w.gems) * COINS_PER_OLD_GEM;
    delete w.gems;
    d.wallet = w;
    var inv = isObj(d.inventory) ? d.inventory : { stacks: {}, items: [], nextId: 1 };
    if (isObj(d.farm) && isObj(d.farm.logs)) {
      var logs = (inv.stacks.log = isObj(inv.stacks.log) ? inv.stacks.log : {});
      for (var wood in d.farm.logs) if (isCount(d.farm.logs[wood])) logs[wood] = (logs[wood] || 0) + Math.floor(d.farm.logs[wood]);
      delete d.farm.logs;
    }
    d.inventory = inv;
    if (isObj(d.mine)) delete d.mine.gemsSold;
    d.v = 2;
    return d;
  }
  var MIGRATIONS = { 1: migrate1 };

  /* Read the save. Anything unreadable or from the future is ignored
     and a fresh game is returned, so a bad save never bricks the page.
     Sections are passed through as objects; their owners check them. */
  function load(storage) {
    var game = newGame(), raw = null;
    try { raw = storage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return game;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return game; }
    if (!isObj(data) || !(data.v >= 1 && data.v <= VERSION)) return game;
    try { while (data.v < VERSION) data = MIGRATIONS[data.v](data); } catch (e) { return game; }
    for (var k in data) if (k !== "v" && isObj(data[k])) game[k] = data[k];
    // a save from before the new-player flow: this player has played, so never walk them through it
    if (!isObj(data.tutorial)) game.tutorial = { step: null, done: true };
    return game;
  }

  function write(storage, game) {
    try { storage.setItem(KEY, JSON.stringify(game)); return true; } catch (e) { return false; }
  }

  var api = { KEY: KEY, START_LOGS: START_LOGS, VERSION: VERSION, COINS_PER_OLD_GEM: COINS_PER_OLD_GEM, newGame: newGame, memoryStore: memoryStore, pickStorage: pickStorage, load: load, write: write, migrate1: migrate1 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Save = api;
})(typeof window !== "undefined" ? window : globalThis);

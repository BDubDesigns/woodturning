/* ============================================================
   Save and persistence. One JSON blob in localStorage under one
   key, versioned. Pure apart from the storage it is handed, so
   tests run in Node with a fake store. If localStorage is
   missing or blocked (private mode, some webviews) it falls back
   to memory: the game still plays, it just will not remember.

   The shape is a plain object that other slices add sections to:
     { v, wallet: { coins, diamonds, gems }, farm: {...}, mine: {...} }
   ============================================================ */
(function (root) {
  "use strict";
  var KEY = "woodturning.save";
  var VERSION = 1;

  function newGame() {
    return { v: VERSION, wallet: { coins: 250, diamonds: 5, gems: 0 }, farm: null, mine: null };
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

  /* Read the save. Anything unreadable or from the future is ignored
     and a fresh game is returned, so a bad save never bricks the page. */
  function load(storage) {
    var game = newGame(), raw = null;
    try { raw = storage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return game;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return game; }
    if (!data || typeof data !== "object" || data.v !== VERSION) return game;
    if (data.wallet && typeof data.wallet === "object") {
      if (isCount(data.wallet.coins)) game.wallet.coins = data.wallet.coins;
      if (isCount(data.wallet.diamonds)) game.wallet.diamonds = data.wallet.diamonds;
      if (isCount(data.wallet.gems)) game.wallet.gems = data.wallet.gems;
    }
    if (data.farm && typeof data.farm === "object") game.farm = data.farm;
    if (data.mine && typeof data.mine === "object") game.mine = data.mine;
    return game;
  }
  function isCount(n) { return typeof n === "number" && isFinite(n) && n >= 0; }

  function write(storage, game) {
    try { storage.setItem(KEY, JSON.stringify(game)); return true; } catch (e) { return false; }
  }

  var api = { KEY: KEY, VERSION: VERSION, newGame: newGame, memoryStore: memoryStore, pickStorage: pickStorage, load: load, write: write };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Save = api;
})(typeof window !== "undefined" ? window : globalThis);

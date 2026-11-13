/* ============================================================
   The shared game state: the wallet and the inventory. One of
   each, owned here, read and written by every tab, so the farm,
   the harvest, the lathe, the mine (and later commissions, the
   shop, and the new-player flow) all see the same things.

   Both live in the save object (save.js):
     game.wallet    { coins: 250, diamonds: 5 }      one count per registered currency
     game.inventory { stacks: { log: { pine: 2 } },   stacking kinds, counted by key
                      items:  [ { id, kind, madeAt, ...fields } ],  unique items
                      nextId }

   What can exist comes from the registry (registry.js): a new
   currency or item kind needs no change here.

   Pure apart from the save object it is handed: testable in Node.
   Every change calls opts.onChange so the page can save.
   ============================================================ */
(function (root) {
  "use strict";
  var R = (root.Game && root.Game.Registry) || (typeof require === "function" ? require("./registry.js") : null);

  function isCount(n) { return typeof n === "number" && isFinite(n) && n >= 0; }
  function whole(n) { return Math.floor(n); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ---------------- wallet ---------------- */
  function defaultWallet() {
    var w = {};
    R.CURRENCY_ORDER.forEach(function (id) { w[id] = R.CURRENCIES[id].start; });
    return w;
  }
  /* Keep a count for every registered currency, nothing else. A currency
     the game no longer has (gems) falls away here; save.js migrates any
     value it held before that happens. */
  function normalizeWallet(w) {
    var out = defaultWallet();
    if (!w || typeof w !== "object") return out;
    for (var id in out) if (isCount(w[id])) out[id] = whole(w[id]);
    return out;
  }

  function createWallet(game, opts) {
    opts = opts || {};
    var onChange = opts.onChange || function () {};
    var w = game.wallet;
    function known(id) { return own(R.CURRENCIES, id); }
    function balance(id) { return known(id) && isCount(w[id]) ? w[id] : 0; }
    function has(id, n) { return balance(id) >= n; }
    /* Add n of a currency. reason is free text for the caller's records. */
    function earn(id, n) {
      if (!known(id)) return { ok: false, reason: "unknown currency" };
      n = whole(n);
      if (!(n > 0)) return { ok: false, reason: "nothing to add" };
      w[id] = balance(id) + n;
      onChange();
      return { ok: true, currency: id, amount: n, balance: w[id] };
    }
    /* Take n of a currency, or nothing at all if there is not enough. */
    function spend(id, n) {
      if (!known(id)) return { ok: false, reason: "unknown currency" };
      n = whole(n);
      if (!(n >= 0)) return { ok: false, reason: "bad amount" };
      var have = balance(id);
      if (have < n) return { ok: false, reason: "not enough " + R.CURRENCIES[id].many, need: n, have: have };
      w[id] = have - n;
      if (n) onChange();
      return { ok: true, currency: id, amount: n, balance: w[id] };
    }
    return { state: w, balance: balance, has: has, earn: earn, spend: spend };
  }

  /* ---------------- inventory ---------------- */
  function defaultInventory() { return { stacks: {}, items: [], nextId: 1 }; }

  /* A stack key is valid if it names something real: a log's wood must be a registered wood. */
  function validKey(kind, key) {
    if (typeof key !== "string" || !key) return false;
    if (R.ITEMS[kind].by === "wood") return own(R.WOODS, key);
    return true;
  }

  function normalizeInventory(inv) {
    var out = defaultInventory();
    if (!inv || typeof inv !== "object") return out;
    var st = inv.stacks && typeof inv.stacks === "object" ? inv.stacks : {};
    for (var kind in st) {
      if (!own(R.ITEMS, kind) || !R.ITEMS[kind].stack || !st[kind] || typeof st[kind] !== "object") continue;
      for (var key in st[kind]) {
        var n = st[kind][key];
        if (validKey(kind, key) && isCount(n) && whole(n) > 0) (out.stacks[kind] || (out.stacks[kind] = {}))[key] = whole(n);
      }
    }
    var maxId = 0, seen = {};
    if (Array.isArray(inv.items)) {
      inv.items.forEach(function (it) {
        if (!it || typeof it !== "object" || !own(R.ITEMS, it.kind) || R.ITEMS[it.kind].stack) return;
        if (!(isCount(it.id) && it.id >= 1) || seen[it.id]) return;
        if (it.wood !== undefined && !own(R.WOODS, it.wood)) return;
        seen[it.id] = true;
        maxId = Math.max(maxId, it.id);
        out.items.push(Object.assign({}, it, { id: whole(it.id) }));
      });
    }
    out.nextId = Math.max(maxId + 1, isCount(inv.nextId) ? whole(inv.nextId) : 1);
    return out;
  }

  function createInventory(game, opts) {
    opts = opts || {};
    var onChange = opts.onChange || function () {};
    var now = opts.now || function () { return Date.now(); };
    var inv = game.inventory;

    function kindOf(kind) { return own(R.ITEMS, kind) ? R.ITEMS[kind] : null; }
    function stackOf(kind) { return inv.stacks[kind] || (inv.stacks[kind] = {}); }
    function matches(it, filter) {
      if (!filter) return true;
      if (typeof filter === "string") return it.wood === filter;
      if (typeof filter === "function") return !!filter(it);
      for (var k in filter) if (it[k] !== filter[k]) return false;
      return true;
    }

    /* How many of a kind. key: a wood id (or stack key), a field filter
       object, a predicate, or nothing for all of that kind. */
    function count(kind, key) {
      var def = kindOf(kind);
      if (!def) return 0;
      if (def.stack) {
        var s = inv.stacks[kind] || {};
        if (key !== undefined) return s[key] || 0;
        var t = 0; for (var k in s) t += s[k]; return t;
      }
      var n = 0;
      inv.items.forEach(function (it) { if (it.kind === kind && matches(it, key)) n++; });
      return n;
    }

    /* The unique items of a kind, oldest first. Stacks come back as
       [{ key, count }] in registry order. */
    function list(kind, filter) {
      var def = kindOf(kind);
      if (!def) return [];
      if (def.stack) {
        var s = inv.stacks[kind] || {}, keys = def.by === "wood" ? R.WOOD_ORDER : Object.keys(s);
        return keys.filter(function (k) { return s[k] > 0; }).map(function (k) { return { key: k, count: s[k] }; });
      }
      return inv.items.filter(function (it) { return it.kind === kind && matches(it, filter); });
    }

    function get(id) {
      for (var i = 0; i < inv.items.length; i++) if (inv.items[i].id === id) return inv.items[i];
      return null;
    }

    /* Put something in. For a stack: add(kind, key, n). For a unique item:
       add(kind, data) keeps the kind's registered fields from data and
       returns the new item. */
    function add(kind, data, n) {
      var def = kindOf(kind);
      if (!def) return null;
      if (def.stack) {
        var key = typeof data === "string" ? data : data && data[def.by];
        n = n === undefined ? 1 : whole(n);
        if (!validKey(kind, key) || !(n > 0)) return null;
        var s = stackOf(kind);
        s[key] = (s[key] || 0) + n;
        onChange();
        return { kind: kind, key: key, count: s[key] };
      }
      data = data || {};
      if (data.wood !== undefined && !own(R.WOODS, data.wood)) return null;
      var it = { id: inv.nextId++, kind: kind, madeAt: now() };
      (def.fields || []).forEach(function (f) { if (data[f] !== undefined) it[f] = data[f]; });
      inv.items.push(it);
      onChange();
      return it;
    }

    /* Take one out. For a stack: take(kind, key). For a unique item: take
       by id (a number) or by filter (the oldest match). Returns what was
       taken, or null and changes nothing. */
    function take(kind, which) {
      var def = kindOf(kind);
      if (!def) return null;
      if (def.stack) {
        var s = inv.stacks[kind];
        if (!s || !(s[which] > 0)) return null;
        s[which] -= 1;
        if (!s[which]) delete s[which];
        onChange();
        return { kind: kind, key: which };
      }
      for (var i = 0; i < inv.items.length; i++) {
        var it = inv.items[i];
        if (it.kind !== kind) continue;
        if (typeof which === "number" ? it.id === which : matches(it, which)) {
          inv.items.splice(i, 1);
          onChange();
          return it;
        }
      }
      return null;
    }

    return { state: inv, count: count, list: list, get: get, add: add, take: take };
  }

  /* ---------------- the whole state ---------------- */
  /* game: the save object. Normalizes its wallet and inventory in place
     (other systems may already hold game.wallet, so the object is kept). */
  function createState(game, opts) {
    opts = opts || {};
    var listeners = [];
    function changed() {
      if (opts.onChange) opts.onChange();
      listeners.forEach(function (fn) { fn(); });
    }
    var w = normalizeWallet(game.wallet);
    if (game.wallet && typeof game.wallet === "object") {
      for (var k in game.wallet) if (!own(w, k)) delete game.wallet[k];
      Object.assign(game.wallet, w);
    } else game.wallet = w;
    game.inventory = normalizeInventory(game.inventory);

    var wallet = createWallet(game, { onChange: changed });
    var inventory = createInventory(game, { onChange: changed, now: opts.now });

    /* Hand over a bundle in one go: a reward, a starter kit, a refund.
       { coins: 50, diamonds: 2, items: [{ kind: "log", key: "pine", n: 3 }, { kind: "blank", data: {...} }] }
       Unknown entries are skipped. Returns what was actually given. */
    function grant(bundle) {
      var given = { currencies: {}, items: [] };
      if (!bundle) return given;
      R.CURRENCY_ORDER.forEach(function (id) {
        if (bundle[id] > 0) { var r = wallet.earn(id, bundle[id]); if (r.ok) given.currencies[id] = r.amount; }
      });
      (bundle.items || []).forEach(function (e) {
        var def = R.ITEMS[e.kind];
        if (!def) return;
        var r = def.stack ? inventory.add(e.kind, e.key, e.n) : inventory.add(e.kind, e.data);
        if (r) given.items.push(r);
      });
      return given;
    }

    return {
      game: game, wallet: wallet, inventory: inventory, grant: grant,
      onChange: function (fn) { listeners.push(fn); }
    };
  }

  /* Float arrays in the save: rounded plain numbers, back to Float32Array. */
  function pack(arr, digits) {
    var f = Math.pow(10, digits === undefined ? 4 : digits), out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) out[i] = Math.round(arr[i] * f) / f;
    return out;
  }
  function unpack(arr) { return Array.isArray(arr) ? Float32Array.from(arr) : arr; }

  var api = {
    defaultWallet: defaultWallet, normalizeWallet: normalizeWallet, createWallet: createWallet,
    defaultInventory: defaultInventory, normalizeInventory: normalizeInventory, createInventory: createInventory,
    createState: createState, pack: pack, unpack: unpack
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.State = api;
})(typeof window !== "undefined" ? window : globalThis);

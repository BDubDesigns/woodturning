/* ============================================================
   The registry: the game's content as data. Every system reads
   what exists from here, so adding a wood, a currency, or a kind
   of item is one new entry, not a code change in each tab.

     CURRENCIES   what the wallet can hold, and how much a new game starts with
     WOODS        what the farm grows, the harvest fells, and the lathe turns
     ITEMS        what the inventory can hold (logs, blanks, turned pieces)

   Each table has an ORDER list (how the screens list them) and an
   add function that checks the entry and appends it. Pure data and
   pure functions: no DOM, testable in Node.

   Harvest tree shapes (how a wood grows: taper, branches, foliage)
   live in harvest.js TREES, keyed by the same wood id; a wood with
   no entry there grows as the default tree.
   ============================================================ */
(function (root) {
  "use strict";

  var MIN = 60 * 1000;

  /* ---------------- currencies ----------------
     premium: true means real money or ads can buy it. The free game
     must never need a premium currency for anything in the core loop.
     start: what a brand-new player holds. The new-player flow (tutorial.js)
     hands out coins and diamonds as they are needed, so a new game starts
     with none; skipping the tutorial grants its STARTER pack instead. */
  var CURRENCIES = {
    coins:    { id: "coins",    name: "Coins",    one: "coin",    many: "coins",    start: 0, premium: false },
    diamonds: { id: "diamonds", name: "Diamonds", one: "diamond", many: "diamonds", start: 0, premium: true }
  };
  var CURRENCY_ORDER = ["coins", "diamonds"];

  /* ---------------- woods ----------------
     growMs: how long a tree takes on the farm.
     plantPrice: coins for a seed. A dearer wood always pays more for the same
       job (commissions.js WOOD_PAY), and its cheapest order pays well over the seed.
     trunk, leaf, leaf2, shape: how it looks on the farm and in the forest. */
  var WOODS = {
    pine:   { id: "pine",   name: "Pine",   growMs: 3 * MIN, plantPrice: 10, shape: "conifer", trunk: "#c19a62", bark: "#7a5232", leaf: "#3f7a4a", leaf2: "#5a9a5e" },   // bark: the standing tree, when it differs from the wood
    oak:    { id: "oak",    name: "Oak",    growMs: 8 * MIN, plantPrice: 30, shape: "round",   trunk: "#8f6b43", leaf: "#5c8a3a", leaf2: "#7aa84c" },
    walnut: { id: "walnut", name: "Walnut", growMs: 15 * MIN, plantPrice: 50, shape: "round",   trunk: "#5b3d27", leaf: "#456a3a", leaf2: "#5f8a4a" }
  };
  var WOOD_ORDER = ["pine", "oak", "walnut"];

  /* ---------------- item kinds ----------------
     stack: true items are plain counts keyed by `by` (a log of pine is
     any log of pine). Other items are unique records with their own data
     (a blank has a profile; a turned piece has its shape and paint, which
     commissions grade). `fields` lists the data an item of that kind keeps. */
  var ITEMS = {
    log:   { id: "log",   name: "Log",   many: "Logs",   stack: true,  by: "wood" },
    blank: { id: "blank", name: "Blank", many: "Blanks", stack: false, fields: ["wood", "seed", "profile", "lengthUnits", "lengthRatio", "girthUnits"] },
    piece: { id: "piece", name: "Piece", many: "Pieces", stack: false, fields: ["wood", "from", "shape", "profile", "start", "coat", "sheen", "spec", "match", "removed", "order"] }
  };
  var ITEM_ORDER = ["log", "blank", "piece"];

  function isId(s) { return typeof s === "string" && /^[a-z][a-z0-9_]*$/.test(s); }

  function add(table, order, def, need) {
    if (!def || !isId(def.id)) throw new Error("registry: an entry needs an id of lowercase letters, digits and _");
    if (table[def.id]) throw new Error("registry: " + def.id + " already exists");
    for (var i = 0; i < need.length; i++) if (def[need[i]] === undefined) throw new Error("registry: " + def.id + " needs " + need[i]);
    table[def.id] = def;
    order.push(def.id);
    return def;
  }
  function addCurrency(def) {
    def = Object.assign({ start: 0, premium: false }, def);
    if (!def.one) def.one = def.id;
    if (!def.many) def.many = def.one + "s";
    if (!def.name) def.name = def.many.charAt(0).toUpperCase() + def.many.slice(1);
    return add(CURRENCIES, CURRENCY_ORDER, def, ["name"]);
  }
  function addWood(def) {
    def = Object.assign({ plantPrice: 10, shape: "round", trunk: "#8f6b43", leaf: "#5c8a3a", leaf2: "#7aa84c" }, def);
    return add(WOODS, WOOD_ORDER, def, ["name", "growMs"]);
  }
  function addItemKind(def) {
    def = Object.assign({ stack: false, fields: [] }, def);
    if (def.stack && !def.by) throw new Error("registry: a stacking item needs `by`");
    return add(ITEMS, ITEM_ORDER, def, ["name"]);
  }

  /* "1 coin", "3 coins", "1 pine log". */
  function amount(currencyId, n) {
    var c = CURRENCIES[currencyId];
    return n + " " + (c ? (n === 1 ? c.one : c.many) : currencyId);
  }

  var api = {
    CURRENCIES: CURRENCIES, CURRENCY_ORDER: CURRENCY_ORDER,
    WOODS: WOODS, WOOD_ORDER: WOOD_ORDER,
    ITEMS: ITEMS, ITEM_ORDER: ITEM_ORDER,
    addCurrency: addCurrency, addWood: addWood, addItemKind: addItemKind, amount: amount
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Registry = api;
})(typeof window !== "undefined" ? window : globalThis);

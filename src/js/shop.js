/* ============================================================
   Arbor Freight: the workshop's tool store. Pure, renderer-free,
   testable in Node.

   The store sells upgrades in lines (lighting, motor, chisels).
   Each line is a ladder of tiers bought in order; tier 0 is what
   the workshop starts with. Every rung costs a good deal more than
   the last (about four times), so there is always a next thing to
   save up for, and a top of the line that takes real work to reach.

   What a tier does is data on the tier, read by the lathe:
     light   S.lightLevel, the work light hung over the lathe (view3d WORK_LIGHTS)
     motor   cutBoost, a multiplier on how fast wood comes off. The stock motor is
             weak on purpose (about a third of the top one), and every rung is
             about 1.5x the last, so the motor is a real reason to save up.
     chisels the chisel tips on the rack (cutting.js TIPS)
     brushes brush { flow, width }: paint goes on faster, and the wide brush is wider (paint.js brush)
     finish  spray { rate, width, even }: sheen builds faster, wider and more evenly (paint.js spray)

   The model owns the shop section of the save:
     game.shop { owned: { light: 0, motor: 0, chisels: 0, brushes: 0, finish: 0 }, spent }
   Coins go through the shared wallet (state.js).
   ============================================================ */
(function (root) {
  "use strict";

  var Game = root.Game || {};
  var State = Game.State || require("./state.js");

  var LINES = {
    light: {
      name: "Lighting", blurb: "See what you are cutting. Each lamp hangs over the lathe.",
      tiers: [
        { name: "Bare bulb", price: 0, blurb: "A 60 watt bulb on a flex. It came with the shed.", level: 0 },
        { name: "Halogen work light", price: 150, blurb: "The yellow box every garage has. Bright, warm and a bit hot.", level: 1 },
        { name: "LED shop panel", price: 600, blurb: "A long cool-white panel on chains. No more squinting at the coves.", level: 2 },
        { name: "Studio light bar", price: 2400, blurb: "Twin panels, daylight white. Every bead and cove in plain view.", level: 3 }
      ]
    },
    motor: {
      name: "Motor", blurb: "More power at the spindle takes wood off faster.",
      tiers: [
        { name: "Half horse motor", price: 0, blurb: "It turns. Mostly. Every pass only takes a little off.", boost: 0.35 },
        { name: "One horse motor", price: 300, blurb: "About half again as fast as the stock motor.", boost: 0.55 },
        { name: "Horse and a half", price: 1100, blurb: "More than twice the stock motor. Roughing out stops being a chore.", boost: 0.8 },
        { name: "Two horse, variable speed", price: 4000, blurb: "Three times the stock motor. The shed lights dim when it starts.", boost: 1.1 }
      ]
    },
    chisels: {
      name: "Chisels", blurb: "New tips for new shapes. Each one goes on the rack by the lathe.",
      tiers: [
        { name: "Gouge and skew", price: 0, blurb: "The two you started with.", tips: ["gouge", "skew"] },
        { name: "Parting tool", price: 200, blurb: "A thin blade that cuts narrow, deep grooves: crisp handles and shoulders.", tips: ["parting"] },
        { name: "Detail gouge", price: 700, blurb: "A small rounded gouge for tight beads and coves.", tips: ["detail"] },
        { name: "Roughing gouge", price: 2500, blurb: "A big wide gouge that takes a log round in a few passes.", tips: ["roughing"] }
      ]
    },
    brushes: {
      name: "Brushes", blurb: "Better bristles hold more paint. A coat goes on in fewer passes.",
      tiers: [
        { name: "Hardware store brush", price: 0, blurb: "Stiff, a bit bald in the middle. It came in a bag of three.", brush: { flow: 1, width: 1 } },
        { name: "Sash brush", price: 160, blurb: "Angled and soft. Paint goes on about half again as fast.", brush: { flow: 1.5, width: 1 } },
        { name: "Wide pad brush", price: 600, blurb: "A broad soft pad. Faster still, and it covers a wider band each pass.", brush: { flow: 2, width: 1.35 } },
        { name: "Sable artist's set", price: 2400, blurb: "The good stuff. A solid coat in one slow sweep, and a liner that loads fully.", brush: { flow: 2.6, width: 1.35 } }
      ]
    },
    finish: {
      name: "Finishing", blurb: "How the sheen goes on. Better sprayers build it faster and more evenly.",
      tiers: [
        { name: "Spray bottle", price: 0, blurb: "A plant mister with lacquer in it. It works, slowly, and in blotches.", spray: { rate: 1, width: 1, even: 0 } },
        { name: "Trigger sprayer", price: 180, blurb: "A proper trigger and a wider fan. Sheen builds half again as fast.", spray: { rate: 1.5, width: 1.15, even: 0.25 } },
        { name: "HVLP spray gun", price: 700, blurb: "A fine, even mist. Twice as fast, and a sweep lays an even coat.", spray: { rate: 2, width: 1.3, even: 0.6 } },
        { name: "Spray booth", price: 2800, blurb: "A booth, a gun and an extractor fan. Even sheen end to end in one pass.", spray: { rate: 2.8, width: 1.45, even: 1 } }
      ]
    }
  };
  var LINE_ORDER = ["light", "motor", "chisels", "brushes", "finish"];

  function defaultShop() {
    var owned = {};
    LINE_ORDER.forEach(function (k) { owned[k] = 0; });
    return { owned: owned, spent: 0 };
  }
  function normalizeShop(s) {
    var out = defaultShop();
    if (!s || typeof s !== "object") return out;
    if (s.owned && typeof s.owned === "object") {
      LINE_ORDER.forEach(function (k) {
        var v = s.owned[k];
        if (typeof v === "number" && isFinite(v)) out.owned[k] = Math.max(0, Math.min(LINES[k].tiers.length - 1, Math.floor(v)));
      });
    }
    if (typeof s.spent === "number" && isFinite(s.spent) && s.spent >= 0) out.spent = Math.floor(s.spent);
    return out;
  }

  /* game: the save object.
     opts.state: the shared state (state.js).
     opts.onChange: called after any change worth saving. */
  function createShop(game, opts) {
    opts = opts || {};
    var onChange = opts.onChange || function () {};
    var state = opts.state || State.createState(game, { onChange: onChange });
    game.shop = normalizeShop(game.shop);
    var S = game.shop;

    function line(k) { return LINES[k] || null; }
    function level(k) { return line(k) ? S.owned[k] : 0; }
    function current(k) { var l = line(k); return l ? l.tiers[level(k)] : null; }
    /* The next tier for sale in a line, or null at the top of the line. */
    function next(k) { var l = line(k); return l && level(k) + 1 < l.tiers.length ? l.tiers[level(k) + 1] : null; }
    function canAfford(k) { var n = next(k); return !!n && state.wallet.balance("coins") >= n.price; }
    /* Buy the next tier of a line: the coins go, the upgrade is installed. */
    function buy(k) {
      var n = next(k);
      if (!line(k)) return { ok: false, reason: "no such line" };
      if (!n) return { ok: false, reason: "top of the line" };
      var paid = state.wallet.spend("coins", n.price);
      if (!paid.ok) return { ok: false, reason: "not enough coins", need: n.price, have: state.wallet.balance("coins") };
      S.owned[k]++; S.spent += n.price;
      onChange();
      return { ok: true, line: k, tier: n, level: S.owned[k] };
    }

    /* ---- what the upgrades do, for the lathe ---- */
    function lightLevel() { return current("light").level; }
    function cutBoost() { return current("motor").boost; }
    /* The paint brushes and the finish sprayer the workshop owns, for paint.js. */
    function brush() { return current("brushes").brush; }
    function spray() { return current("finish").spray; }
    /* Every chisel tip on the rack: each chisels tier owned adds its tips. */
    function tips() {
      var out = [], t = LINES.chisels.tiers;
      for (var i = 0; i <= level("chisels"); i++) out = out.concat(t[i].tips);
      return out;
    }

    return {
      state: S, line: line, level: level, current: current, next: next, canAfford: canAfford, buy: buy,
      lightLevel: lightLevel, cutBoost: cutBoost, tips: tips, brush: brush, spray: spray
    };
  }

  var api = { LINES: LINES, LINE_ORDER: LINE_ORDER, defaultShop: defaultShop, normalizeShop: normalizeShop, createShop: createShop };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Shop = api;
})(typeof window !== "undefined" ? window : globalThis);

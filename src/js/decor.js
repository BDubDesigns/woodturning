/* ============================================================
   Decorations: things for the workshop, sold at Arbor Freight
   (issue #35 part 6). Pure, renderer-free, testable in Node.

   Each item is bought once and shows in the 3D workshop around the
   lathe (view3d.js draws them; the 2D view doesn't). Some do a little
   thing:
     disco         hangs where the work light hangs, and can be picked as
                   the light (Lighting's USE list, shop.js). Spinning
                   coloured spots: fun, and harder to see the work by.
     radio         on a shelf by the lathe. Tap it to play a soft tune
                   (audio.js radio), which follows the sound toggle.
     string_lights along the rafters: a warm glow, a gentle flicker.
     cat           a 3D cat on a walkway high on the back wall: asleep until you
                   work, then watches, walks to the far end (at most every 30 s)
                   and dozes after 5 s of quiet. Sits up on DONE.
                   Its model is licensed and lives in a private repo (assets.js).
     trophy_wall   a shelf with one spot per blueprint, showing the best
                   piece of each kind delivered (commissions.js keeps
                   those, best), and a gold plaque at Legendary.

   Prices other than the disco ball's are first guesses.

   The model owns the decor section of the save:
     game.decor { owned: [id, ...], radio: bool }
   Coins go through the shared wallet (state.js).
   ============================================================ */
(function (root) {
  "use strict";
  var Game = root.Game || {};
  var State = Game.State || require("./state.js");

  var ITEMS = {
    disco:         { id: "disco",         name: "Disco ball",    price: 2500, blurb: "Hangs where the work light hangs. Pick it as your light under Lighting. Spinning coloured spots: great fun, harder to see the work by." },
    radio:         { id: "radio",         name: "Radio",         price: 300,  blurb: "An old shelf radio by the lathe. Tap it to play a soft tune while you work." },
    string_lights: { id: "string_lights", name: "String lights", price: 400,  blurb: "Warm little bulbs along the rafters, with a gentle flicker." },
    cat:           { id: "cat",           name: "Shop cat",      price: 800,  blurb: "Naps on a shelf high on the back wall. Your first cut wakes it, it wanders to the far end, and it dozes off again when the shop goes quiet." },
    trophy_wall:   { id: "trophy_wall",   name: "Trophy wall",   price: 1200, blurb: "A shelf on the back wall with a spot for every blueprint, showing your best delivered piece of each. Legendary ones get a gold plaque." }
  };
  var ORDER = ["radio", "string_lights", "cat", "trophy_wall", "disco"];   // as the store lists them: cheapest first, the disco ball last

  function defaultDecor() { return { owned: [], radio: false }; }
  function normalize(d) {
    var out = defaultDecor();
    if (!d || typeof d !== "object") return out;
    if (Array.isArray(d.owned)) d.owned.forEach(function (id) { if (ITEMS[id] && out.owned.indexOf(id) < 0) out.owned.push(id); });
    out.radio = !!d.radio && out.owned.indexOf("radio") >= 0;
    return out;
  }

  /* game: the save object. opts.state: the shared state. opts.onChange: after any change worth saving. */
  function createDecor(game, opts) {
    opts = opts || {};
    var onChange = opts.onChange || function () {};
    var state = opts.state || State.createState(game, { onChange: onChange });
    game.decor = normalize(game.decor);
    var D = game.decor;

    function owns(id) { return D.owned.indexOf(id) >= 0; }
    function buy(id) {
      var it = ITEMS[id];
      if (!it) return { ok: false, reason: "no such item" };
      if (owns(id)) return { ok: false, reason: "owned" };
      var paid = state.wallet.spend("coins", it.price);
      if (!paid.ok) return { ok: false, reason: "not enough coins", need: it.price, have: state.wallet.balance("coins") };
      D.owned.push(id);
      onChange();
      return { ok: true, item: it };
    }
    function radioOn() { return D.radio && owns("radio"); }
    function setRadio(on) {
      if (!owns("radio")) return false;
      D.radio = !!on;
      onChange();
      return D.radio;
    }
    return { state: D, owns: owns, buy: buy, radioOn: radioOn, setRadio: setRadio };
  }

  var api = { ITEMS: ITEMS, ORDER: ORDER, defaultDecor: defaultDecor, normalize: normalize, createDecor: createDecor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Decor = api;
})(typeof window !== "undefined" ? window : globalThis);

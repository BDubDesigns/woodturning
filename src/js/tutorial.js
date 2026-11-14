/* ============================================================
   The new-player flow: an authored first session. Pure, no DOM,
   testable in Node (docs/new-player-flow.md is the brief).

   The flow is an ordered list of steps. Each step is data:
     id        saved, so steps can be reordered without breaking saves
     unlock    tabs that appear when the step starts (LATHE always shows)
     target    CSS selectors for the real control the coach points at;
               the first one on screen gets the ring (tutorial-ui.js)
     screen    where the step happens; the coach only shows there
     title, text   the coach card's copy (no em dashes: player-facing)
     done(ctx)     true once the player has done what the step asks
     enter(ctx, t) runs once when the step starts (grants, the first board)
     rescue(ctx, t) runs on every check; may hand out what the player needs
               to go on (a pine log) or send them back a step (returns an id)
     dismiss   the card has a GOT IT button that ends the step
     mode      the lathe mode the step starts in (an order starts at the chisel)

   ctx is how the flow sees the game, supplied by tutorial-ui.js and faked
   in the tests. Everything is optional; a missing reading counts as 0:
     screen() mode() removed() coverage() sheenRank() shape()
     pieces(wood) logs(wood) blanks(wood) canDeliver(wood) delivered() activeWood()
     selectedEmpty() planted(wood) grown(wood) harvestPhase()
     coins() diamonds() plantPrice(wood)
     grant({ coins, diamonds, logs: { wood: n } })
     postFirstBoard(list) resumeBoard() takeOrder(wood) setMode(mode)

   The model owns the tutorial section of the save:
     game.tutorial { step, done }
   A save from before this flow existed is marked done on load (save.js).
   ============================================================ */
(function (root) {
  "use strict";

  /* Skipping the flow hands over what a player would have had by its end, and a bit to start with. */
  var STARTER = { coins: 250, diamonds: 5 };
  /* The speed-up step grants enough diamonds to finish an oak (5 x 2 minutes covers its 8). */
  var GRANT_DIAMONDS = 5;
  var CUT_FRACTION = 0.02;   // the practice cut is done once this much wood is off
  var PAINT_COVER = 0.12;    // ...and the practice paint once this much of the piece has a coat
  var SHAPE_GOOD = 0.6;      // the first order's shape is "close enough to paint" here

  /* The first board: two easy orders with fixed seeds, so every new player sees the same two. */
  var FIRST_BOARD = [
    { seed: 1101, wood: "pine", kind: "rolling_pin", specKind: "dipped", sheen: "matte", client: "Mrs. Alder" },
    { seed: 2202, wood: "oak", kind: "rolling_pin", specKind: "twotone", sheen: "satin", client: "Old Tom" }
  ];
  var TABS = ["lathe", "orders", "farm", "shop", "mine"];

  function n(ctx, name, arg) { var f = ctx && ctx[name]; var v = typeof f === "function" ? f(arg) : 0; return v || 0; }
  function s(ctx, name, arg) { var f = ctx && ctx[name]; return typeof f === "function" ? f(arg) : null; }
  function call(ctx, name, arg) { var f = ctx && ctx[name]; return typeof f === "function" ? f(arg) : undefined; }
  /* Can the player still make (or hand over) a piece of this wood? A rejected piece stays in the shed but cannot go. */
  function hasWood(ctx, wood) { return n(ctx, "logs", wood) + n(ctx, "blanks", wood) > 0 || !!s(ctx, "canDeliver", wood); }

  var STEPS = [
    /* ---- the lathe, on a practice piece of real pine ---- */
    { id: "cut", screen: "lathe", unlock: ["lathe"], target: ["#stage"],
      title: "Your lathe",
      text: "A pine log is spinning. Touch below it, then nudge your finger up to push the chisel in. Slow and steady cuts deep. Take off a little wood.",
      done: function (c) { return n(c, "removed") >= CUT_FRACTION; } },
    { id: "to_paint", screen: "lathe", target: ["#modePaint"],
      title: "Nice cut",
      text: "Now let's give it some colour. Tap PAINT.",
      done: function (c) { var m = s(c, "mode"); return !!m && m !== "cut"; } },
    { id: "paint", screen: "lathe", target: ["#swatches"],
      title: "Paint it spinning",
      text: "Pick a colour, then touch below the log and nudge up, just like cutting. The wide brush lays a coat, the liner a thin line. Slow and steady gives a solid coat.",
      done: function (c) { return n(c, "coverage") >= PAINT_COVER; } },
    { id: "to_finish", screen: "lathe", target: ["#modeFinish"],
      title: "Looking good",
      text: "Last comes the finish. Tap FINISH.",
      done: function (c) { return s(c, "mode") === "finish"; } },
    { id: "finish", screen: "lathe", target: ["#stage"],
      title: "Spray the sheen",
      text: "Touch below and nudge up to mist it. The more you spray, the glossier it gets. Watch the lamp catch the shine. Spray until it reads satin.",
      done: function (c) { return n(c, "sheenRank") >= 1; } },
    { id: "keep", screen: "lathe", target: ["#doneBtn"],
      title: "Your first piece",
      text: "Tap DONE to take it off the lathe. It goes in the shed.",
      done: function (c) { return n(c, "pieces", "pine") >= 1 || n(c, "delivered") >= 1; } },

    /* ---- the first commission ---- */
    { id: "to_orders", unlock: ["orders"], target: ["#tabOrders"],
      title: "Customers are waiting",
      text: "People pay for turned pieces. Tap ORDERS to see who wants what.",
      enter: function (c) { call(c, "postFirstBoard", FIRST_BOARD); },
      done: function (c) { return s(c, "screen") === "orders"; } },
    { id: "take", screen: "orders", target: ['[data-wood="pine"] [data-act="take"]', '[data-wood="pine"]'],
      title: "Pick the pine one",
      text: "Each order names a shape, a wood, a paint and a finish. You have pine logs, so take the pine rolling pin.",
      done: function (c) { return s(c, "activeWood") === "pine" && s(c, "screen") === "lathe"; } },
    { id: "turn", screen: "lathe", target: ["#profileBar"], mode: "cut",
      title: "Turn to the line",
      text: "The dashed line is the shape they want, on the log and in the strip below it. Cut down to it. SHAPE shows how close you are.",
      done: function (c) { return n(c, "shape") >= SHAPE_GOOD || (s(c, "mode") && s(c, "mode") !== "cut"); },
      rescue: rescuePine },
    { id: "order_paint", screen: "lathe", target: ["#modePaint", "#specBar"],
      title: "Paint to the order",
      text: "Close enough. Tap PAINT and match the WANTED strip. The colours it needs are marked in the palette. Then FINISH and spray to the sheen it asks for.",
      done: function (c) { return s(c, "mode") === "finish" || n(c, "delivered") >= 1; },
      rescue: rescuePine },
    { id: "deliver", target: ['[data-act="give"]', '[data-act="deliver"]', "#doneBtn"],
      title: "Deliver it",
      text: "When the sheen matches, tap DONE, then DELIVER. The closer it is, the more they pay. Kept it instead? DELIVER is on its order in ORDERS.",
      done: function (c) { return n(c, "delivered") >= 1; },
      rescue: rescuePine },

    /* ---- the wood you don't have ---- */
    { id: "to_farm", unlock: ["farm"], target: ["#tabFarm"],
      title: "No oak in the shed",
      text: "The other order wants oak, and you have none. Trees grow on the farm. Tap FARM.",
      done: function (c) { return s(c, "screen") === "farm" || n(c, "planted", "oak") > 0; } },
    { id: "plot", screen: "farm", target: [".plot.empty"],
      title: "Pick a plot",
      text: "Tap an empty plot.",
      done: function (c) { return !!s(c, "selectedEmpty") || n(c, "planted", "oak") > 0; } },
    { id: "plant", screen: "farm", target: ['[data-plant="oak"]', ".plot.empty"],
      title: "Plant an oak",
      text: "Tap OAK to plant it. Seeds cost coins. Trees grow in real time, even with the game closed, so keep some planted.",
      enter: topUpOak,
      rescue: function (c) { topUpOak(c); },
      done: function (c) { return n(c, "planted", "oak") > 0; } },
    { id: "speed", screen: "farm", target: ['[data-act="grownow"]', '[data-act="speedup"]', ".plot.growing"],
      title: "No time to wait",
      text: "Oak takes a while. Here are " + GRANT_DIAMONDS + " diamonds: each one skips two minutes. Tap GROW NOW to finish it.",
      enter: function (c) { var d = GRANT_DIAMONDS - n(c, "diamonds"); if (d > 0) call(c, "grant", { diamonds: d }); },
      done: function (c) { return n(c, "grown", "oak") > 0; },
      rescue: function (c) { if (!n(c, "planted", "oak")) return "plot"; } },
    { id: "harvest", screen: "farm", target: ['[data-act="harvest"]', ".plot.mature"],
      title: "Ready to harvest",
      text: "Tap the grown oak, then HARVEST to take it to the forest.",
      done: function (c) { return s(c, "screen") === "harvest"; },
      rescue: function (c) { if (!n(c, "grown", "oak") && !hasWood(c, "oak")) return n(c, "planted", "oak") ? "speed" : "plot"; } },

    /* ---- the forest ---- */
    { id: "chop", screen: "harvest", target: [],
      title: "Chop it down",
      text: "Swipe into the trunk from the side. A quick swing bites deeper. Keep chopping until it cracks. It falls the way you cut.",
      done: function (c) { var p = s(c, "harvestPhase"); return p === "delimb" || p === "saw" || p === "done" || s(c, "screen") === "lathe"; } },
    { id: "delimb", screen: "harvest", target: [],
      title: "Clear the limbs",
      text: "Swipe across each branch to cut it off. Two thirds of a limb off is enough.",
      done: function (c) { var p = s(c, "harvestPhase"); return p === "saw" || p === "done" || s(c, "screen") === "lathe"; } },
    { id: "saw", screen: "harvest", target: [],
      title: "Saw the blank",
      text: "Press where you want a cut and rub back and forth across it. Two cuts free the middle piece, your blank.",
      done: function (c) { return s(c, "screen") === "lathe"; } },

    /* ---- the oak order ---- */
    { id: "oak_order", target: ['[data-act="give"]', '[data-act="deliver"]', "#profileBar"], mode: "cut",
      title: "Your own oak",
      text: "The oak order is on the lathe. Same as before: turn to the line, paint to the strip, finish, then DONE and DELIVER.",
      enter: function (c) { call(c, "takeOrder", "oak"); },
      done: function (c) { return n(c, "delivered") >= 2; },
      rescue: function (c) { if (!hasWood(c, "oak")) return n(c, "planted", "oak") ? "speed" : "to_farm"; } },

    /* ---- graduation ---- */
    { id: "graduate", unlock: ["shop", "mine"], target: ["#tabShop"],
      title: "You're a woodturner",
      text: "The board fills up with new orders now. Coins buy better tools at Arbor Freight. Tap SHOP.",
      enter: function (c) { call(c, "resumeBoard"); },
      done: function (c) { return s(c, "screen") === "shop"; } },
    { id: "shop", screen: "shop", target: ['[data-buy="lighting"]'], dismiss: true,
      title: "Arbor Freight",
      text: "A halogen work light is a good first buy. The MINE tab is for diamonds: watch a short ad, crack the vein, 5 diamonds. Everything is open now. Have fun.",
      done: function () { return false; } }
  ];

  function topUpOak(c) {
    var need = n(c, "plantPrice", "oak") - n(c, "coins");
    if (need > 0 && !n(c, "planted", "oak")) call(c, "grant", { coins: need });
  }
  /* The first order needs pine. If it all went into rejected pieces, a neighbour drops a log off. */
  function rescuePine(c) {
    if (n(c, "delivered") >= 1) return;
    // a mounted log stays in the shed until DONE, so none left means none on the lathe either
    if (!hasWood(c, "pine")) {
      call(c, "grant", { logs: { pine: 1 }, note: "A neighbour dropped off a pine log." });
    }
  }

  var BY_ID = {};
  STEPS.forEach(function (st, i) { st.index = i; BY_ID[st.id] = st; });

  function normalize(t) {
    var out = { step: null, done: false };
    if (!t || typeof t !== "object") return out;
    out.done = !!t.done;
    if (typeof t.step === "string" && BY_ID[t.step]) out.step = t.step;
    return out;
  }

  /* game: the save object. opts.ctx: the game readings (see the top).
     opts.onChange: called after any change worth saving.
     opts.onStep(step|null): called when the step changes (null: the flow ended). */
  function createTutorial(game, opts) {
    opts = opts || {};
    var onChange = opts.onChange || function () {};
    var onStep = opts.onStep || function () {};
    var ctx = opts.ctx || {};
    game.tutorial = normalize(game.tutorial);
    var T = game.tutorial;
    if (!T.done && !T.step) T.step = STEPS[0].id;

    function current() { return T.done ? null : BY_ID[T.step] || null; }
    function unlocked(tab) {
      if (T.done || tab === "lathe" || tab === "harvest") return true;
      var cur = current(), upto = cur ? cur.index : STEPS.length - 1;
      for (var i = 0; i <= upto; i++) if ((STEPS[i].unlock || []).indexOf(tab) >= 0) return true;
      return false;
    }
    function go(id) {
      var st = BY_ID[id];
      if (!st) { finish(); return; }
      T.step = id;
      if (st.mode) call(ctx, "setMode", st.mode);
      if (st.enter) st.enter(ctx, api);
      onChange(); onStep(st);
    }
    function finish() {
      if (T.done) return;
      T.done = true; T.step = null;
      onChange(); onStep(null);
    }
    /* Look at the game and move on as far as the player has got. Call often
       (every second, and after anything the player does). */
    function check() {
      var guard = 0, cur = current();
      while (cur && guard++ < STEPS.length * 2) {
        if (cur.done(ctx)) { advance(); cur = current(); continue; }
        var back = cur.rescue ? cur.rescue(ctx, api) : null;
        if (back && BY_ID[back] && back !== cur.id) { go(back); cur = current(); continue; }
        break;
      }
      return cur;
    }
    function advance() {
      var cur = current();
      if (!cur) return null;
      var next = STEPS[cur.index + 1];
      if (next) go(next.id); else finish();
      return current();
    }
    /* GOT IT on a dismiss step. */
    function dismiss() { var cur = current(); if (cur && cur.dismiss) advance(); }
    /* Leave the flow: everything opens, the starter pack is handed over and the board fills. */
    function skip() {
      if (T.done) return;
      call(ctx, "grant", { coins: STARTER.coins, diamonds: STARTER.diamonds });
      finish();
      call(ctx, "resumeBoard");
    }

    var api = {
      state: T, current: current, unlocked: unlocked, check: check, advance: advance, dismiss: dismiss, skip: skip,
      get done() { return T.done; }, isActive: function () { return !T.done; },
      // the board waits until graduation, which refills it
      boardPaused: function () { var c = current(); return !!c && c.index < BY_ID.graduate.index; }
    };
    return api;
  }

  var api = {
    STEPS: STEPS, BY_ID: BY_ID, TABS: TABS, FIRST_BOARD: FIRST_BOARD, STARTER: STARTER, GRANT_DIAMONDS: GRANT_DIAMONDS,
    CUT_FRACTION: CUT_FRACTION, PAINT_COVER: PAINT_COVER, SHAPE_GOOD: SHAPE_GOOD,
    normalize: normalize, createTutorial: createTutorial
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Tutorial = api;
})(typeof window !== "undefined" ? window : globalThis);

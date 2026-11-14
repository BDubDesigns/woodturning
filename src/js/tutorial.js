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
     showMin   the card's own hide button glows (the first card, so players find it)
     hint(ctx) an extra line for the card right now, or nothing (past satin: how to undo)
     mode      the lathe mode the step starts in (an order starts at the chisel)
     replay    what changes when the flow is replayed (see below): any of the
               fields above, and skip: true to leave the step out

   done, enter and rescue are called as (ctx, t), t being the tutorial; hand-outs
   go through t.give(bundle), never ctx.grant, so they can be counted and held back.

   Replay (Settings, REPLAY TUTORIAL, once the flow is done or skipped) walks the
   same steps for a player who has played. It never takes anything back and never
   hands anything out: every tab stays open, give() does nothing, the board keeps
   running as normal and no first board is posted. A returning player may have no
   pine or no diamonds, so in a replay a step counts doing the thing at all (any
   order, any wood, waiting instead of diamonds), measured against t.base(), the
   readings taken when the step began.

   ctx is how the flow sees the game, supplied by tutorial-ui.js and faked
   in the tests. Everything is optional; a missing reading counts as 0:
     screen() mode() removed() coverage() sheenRank() shape()
     pieces(wood) logs(wood) blanks(wood) canDeliver(wood) delivered() activeWood()
     selectedEmpty() planted(wood) grown(wood) harvestPhase()
     coins() diamonds() plantPrice(wood)
     tip() smoothHere() ownsBlueprint(kind) activeKind() hasOrder(kind)
     piecesAll() plantedAll() grownAll() emptyPlots() doneTaps()
     grant({ coins, diamonds, logs: { wood: n } })
     postFirstBoard(list) postOrder(def) resumeBoard() takeOrder(wood) setMode(mode) startReplay()
     (grant may also carry blueprints: [kind], the skip pack's bat blueprint)

   The model owns the tutorial section of the save:
     game.tutorial { step, done, replay, base, taps, granted: { coins, diamonds, batLog, bat, bonus } }
   taps counts DONE presses (tutorial-ui.js), which a replay step can ask for.
   granted counts what the flow has handed out, so skipping part way through
   tops the starter pack up instead of paying it twice. batLog, bat and bonus
   flag the bat step's gifts (a pine log, 100 coins, the closing bonus), each
   given once ever: a rescue that sends the player back, a reload or a replay
   never pays them again.
   A save from before this flow existed is marked done on load (save.js).
   ============================================================ */
(function (root) {
  "use strict";

  /* Skipping the flow hands over what a player would have had by its end, and a bit to start with:
     coins and diamonds net of what the flow already gave, and the bat blueprint. */
  var STARTER = { coins: 250, diamonds: 10, blueprints: ["baseball_bat"] };
  /* The speed-up step grants enough diamonds to finish an oak (2 minutes each), with some to spare. */
  var GRANT_DIAMONDS = 10;
  var SAND_SMOOTH = 0.6;     // the practice sanding is done once SMOOTH under the pad reads this
  /* The bat step: one authored order (the first piece you need a blueprint for), what it hands out. */
  var BAT_ORDER = { seed: 3303, wood: "pine", kind: "baseball_bat", specKind: "twotone", sheen: "satin", client: "Coach Barrow" };
  var BAT_COINS = 100, BONUS = { coins: 150, diamonds: 5 };
  var CUT_FRACTION = 0.02;   // the practice cut is done once this much wood is off
  var PAINT_COVER = 0.12;    // ...and the practice paint once this much of the piece has a coat
  var SHAPE_GOOD = 0.6;      // the first order's shape is "close enough to paint" here

  /* The first board: two easy orders with fixed seeds, so every new player sees the same two. */
  var FIRST_BOARD = [
    { seed: 1101, wood: "pine", kind: "rolling_pin", specKind: "dipped", sheen: "satin", client: "Mrs. Alder" },
    { seed: 2202, wood: "oak", kind: "rolling_pin", specKind: "twotone", sheen: "gloss", client: "Old Tom" }
  ];
  /* The practice piece's paint spec: always the same, and it wants satin, so the
     player has to spray to finish it (a matte spec would teach them to skip it). */
  var PRACTICE_SPEC = { name: "Three bands", kind: "banded", sheen: "satin",
    segments: [{ a: 0, b: 0.34, paint: "crimson" }, { a: 0.34, b: 0.66, paint: "ivory" }, { a: 0.66, b: 1, paint: "moss" }] };
  var TABS = ["lathe", "orders", "farm", "shop", "mine"];

  function n(ctx, name, arg) { var f = ctx && ctx[name]; var v = typeof f === "function" ? f(arg) : 0; return v || 0; }
  function s(ctx, name, arg) { var f = ctx && ctx[name]; return typeof f === "function" ? f(arg) : null; }
  function call(ctx, name, arg) { var f = ctx && ctx[name]; return typeof f === "function" ? f(arg) : undefined; }
  /* Can the player still make (or hand over) a piece of this wood? A rejected piece stays in the shed but cannot go. */
  function hasWood(ctx, wood) { return n(ctx, "logs", wood) + n(ctx, "blanks", wood) > 0 || !!s(ctx, "canDeliver", wood); }

  /* For replay steps: has this reading gone up since the step began? */
  function grew(c, t, name) { return n(c, name) > ((t && t.base()[name]) || 0); }
  var BASE_READINGS = ["delivered", "piecesAll", "plantedAll", "doneTaps"];

  var STEPS = [
    /* ---- the lathe, on a practice piece of real pine ---- */
    { id: "cut", screen: "lathe", unlock: ["lathe"], target: ["#stage"],
      title: "Your lathe",
      text: "A pine log is spinning. Touch below it, then nudge your finger up to push the chisel in. Slow and steady cuts deep. Take off a little wood. If this card is in the way, tap the glowing button at its top right to tuck it away.",
      showMin: true,
      done: function (c) { return n(c, "removed") >= CUT_FRACTION; } },
    { id: "pick_sand", screen: "lathe", target: ["#tipSand"],
      title: "Nice cut",
      text: "Wood comes off the chisel a bit rough. Tap SANDPAPER.",
      hint: function (c) { var m = s(c, "mode"); return m && m !== "cut" ? "The sandpaper is with the chisels: tap CUT first." : null; },
      done: function (c) { return s(c, "tip") === "sand"; } },
    { id: "sand", screen: "lathe", target: ["#stage"],
      title: "Sand it smooth",
      text: "Press it to the spinning wood, just like the chisel. The dark lines fade and dust flies off. When the dust thins out, that spot is smooth. Sand until SMOOTH reads " + Math.round(SAND_SMOOTH * 100) + "%.",
      done: function (c) { return n(c, "smoothHere") >= SAND_SMOOTH; },
      // put the sandpaper down (or reloaded, which picks up the gouge): back to picking it up, ring and all
      rescue: function (c) { if (s(c, "tip") && s(c, "tip") !== "sand") return "pick_sand"; } },
    { id: "to_paint", screen: "lathe", target: ["#modePaint"],
      title: "Nice and smooth",
      text: "Smooth. Now let's give it some colour. Tap PAINT.",
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
      text: "Touch below and nudge up to mist it. The more you spray, the glossier it gets. Watch the lamp catch the shine. This one wants satin: spray until the SHEEN meter reads Satin, and no further.",
      hint: function (c) { return n(c, "sheenRank") >= 2 ? "That went past satin into gloss. Tap UNDO (the round arrow by DONE) to clear just the finish, then mist it more lightly." : null; },
      done: function (c) { return n(c, "sheenRank") === 1; } },
    { id: "keep", screen: "lathe", target: ["#doneBtn"],
      title: "Your first piece",
      text: "Tap DONE to take it off the lathe. It goes in the shed.",
      done: function (c) { return n(c, "pieces", "pine") >= 1 || n(c, "delivered") >= 1; },
      replay: { text: "Tap DONE to take it off the lathe. Real wood goes in the shed as a piece; this practice blank was just for practice.",
        done: function (c, t) { return grew(c, t, "doneTaps") || grew(c, t, "piecesAll"); } } },

    /* ---- the first commission ---- */
    { id: "to_orders", unlock: ["orders"], target: ["#tabOrders"],
      title: "Customers are waiting",
      text: "People pay for turned pieces. Tap ORDERS to see who wants what.",
      enter: function (c) { call(c, "postFirstBoard", FIRST_BOARD); },
      done: function (c) { return s(c, "screen") === "orders"; },
      replay: { enter: null } },
    { id: "take", screen: "orders", target: ['[data-wood="pine"] [data-act="take"]', '[data-wood="pine"]'],
      title: "Pick the pine one",
      text: "Each order names a shape, a wood, a paint and a finish. You have pine logs, so take the pine rolling pin.",
      done: function (c) { return s(c, "activeWood") === "pine" && s(c, "screen") === "lathe"; },
      rescue: rescuePine,   // every pine log went on practice: without one the card has no TAKE IT
      replay: { rescue: null, title: "Pick an order", target: ['[data-act="take"]', '[data-act="lathe"]', ".order[data-order]"],
        text: "Each order names a shape, a wood, a paint and a finish. The card says if your shed has that wood. Tap TAKE IT (or PRACTISE IT if you have none).",
        done: function (c) { return !!s(c, "activeWood") && s(c, "screen") === "lathe"; } } },
    { id: "turn", screen: "lathe", target: ["#profileBar"], mode: "cut",
      title: "Turn to the line",
      text: "The dashed line is the shape they want, on the log and in the strip below it. Cut down to it. SHAPE shows how close you are.",
      done: function (c) { return n(c, "shape") >= SHAPE_GOOD || (s(c, "mode") && s(c, "mode") !== "cut"); },
      rescue: rescuePine, replay: { rescue: null } },
    { id: "order_paint", screen: "lathe", target: ["#modePaint", "#specBar"],
      title: "Paint to the order",
      text: "Close enough. Tap PAINT and match the WANTED strip. The colours it needs are marked in the palette. Then FINISH and spray to the sheen it asks for.",
      done: function (c) { return s(c, "mode") === "finish" || n(c, "delivered") >= 1; },
      rescue: rescuePine,
      replay: { rescue: null, done: function (c, t) { return s(c, "mode") === "finish" || grew(c, t, "delivered"); } } },
    { id: "deliver", target: ['[data-act="give"]', '[data-act="deliver"]', "#doneBtn"],
      title: "Deliver it",
      text: "When the sheen matches, tap DONE, then DELIVER. The closer it is, the more they pay. Kept it instead? DELIVER is on its order in ORDERS.",
      done: function (c) { return n(c, "delivered") >= 1; },
      rescue: rescuePine,
      replay: { rescue: null, text: "When the sheen matches, tap DONE. If it is the order's own wood, DELIVER gets you paid: the closer, the more. Practice pieces can't be delivered.",
        done: function (c, t) { return grew(c, t, "delivered") || grew(c, t, "doneTaps"); } } },

    /* ---- the wood you don't have ---- */
    { id: "to_farm", unlock: ["farm"], target: ["#tabFarm"],
      title: "No oak in the shed",
      text: "The other order wants oak, and you have none. Trees grow on the farm. Tap FARM.",
      done: function (c) { return s(c, "screen") === "farm" || n(c, "planted", "oak") > 0; },
      replay: { title: "Where wood comes from", text: "Every log starts as a tree on the farm. Tap FARM.",
        done: function (c) { return s(c, "screen") === "farm"; } } },
    { id: "plot", screen: "farm", target: [".plot.empty"],
      title: "Pick a plot",
      text: "Tap an empty plot.",
      done: function (c) { return !!s(c, "selectedEmpty") || n(c, "planted", "oak") > 0; },
      replay: { text: "Tap an empty plot. (No room? Every plot is growing already, so on we go.)",
        done: function (c, t) { return !!s(c, "selectedEmpty") || grew(c, t, "plantedAll") || !n(c, "emptyPlots"); } } },
    { id: "plant", screen: "farm", target: ['[data-plant="oak"]', ".plot.empty"],
      title: "Plant an oak",
      text: "Tap OAK to plant it. Seeds cost coins. Trees grow in real time, even with the game closed, so keep some planted.",
      enter: topUpOak,
      rescue: function (c, t) { topUpOak(c, t); },
      done: function (c) { return n(c, "planted", "oak") > 0; },
      replay: { title: "Plant a tree", target: ['[data-plant]', ".plot.empty"], enter: null, rescue: null,
        text: "Pick a wood to plant. Seeds cost coins, and dearer woods pay more. Trees grow in real time, even with the game closed, so keep some planted.",
        done: function (c, t) { return grew(c, t, "plantedAll") || !n(c, "emptyPlots"); } } },
    { id: "speed", screen: "farm", target: ['[data-act="grownow"]', '[data-act="speedup"]', ".plot.growing"],
      title: "No time to wait",
      text: "Oak takes a while. Here are " + GRANT_DIAMONDS + " diamonds: each one skips two minutes. Tap GROW NOW to finish it.",
      enter: function (c, t) { var d = GRANT_DIAMONDS - n(c, "diamonds"); if (d > 0) t.give({ diamonds: d }); },
      done: function (c) { return n(c, "grown", "oak") > 0; },
      rescue: function (c) { if (!n(c, "planted", "oak")) return "plot"; },
      replay: { title: "Growing", enter: null, rescue: null,
        text: "A diamond skips two minutes: tap SPEED UP or GROW NOW. Or just wait. It grows on its own, even with the game closed, and this card waits too.",
        done: function (c) { return n(c, "grownAll") > 0; } } },
    { id: "harvest", screen: "farm", target: ['[data-act="harvest"]', ".plot.mature"],
      title: "Ready to harvest",
      text: "Tap the grown oak, then HARVEST to take it to the forest.",
      done: function (c) { return s(c, "screen") === "harvest"; },
      rescue: function (c) { if (!n(c, "grown", "oak") && !hasWood(c, "oak")) return n(c, "planted", "oak") ? "speed" : "plot"; },
      replay: { text: "Tap a grown tree, then HARVEST to take it to the forest.", rescue: function (c) { if (!n(c, "grownAll")) return "speed"; } } },

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
      rescue: function (c) { if (!hasWood(c, "oak")) return n(c, "planted", "oak") ? "speed" : "to_farm"; },
      replay: { title: "Fresh from the saw", target: ["#stage"], enter: null, rescue: null, dismiss: true,
        text: "Your blank is on the lathe. Turn it for an order whose wood it is, or just for fun. That is the whole loop: grow, harvest, turn, paint, finish, deliver.",
        done: function () { return false; } } },

    /* ---- the bat: a blueprint, the shop, a job of your own ---- */
    { id: "bat_order", unlock: ["shop"], target: ["#tabShop"],
      title: "A bigger job",
      text: "Coach Barrow wants a bat. Bigger jobs pay more, but you need the blueprint first. Tap SHOP.",
      enter: function (c, t) {
        if (!s(c, "hasOrder", BAT_ORDER.kind)) call(c, "postOrder", BAT_ORDER);
        if (!t.state.granted.batLog && t.give({ logs: { pine: 1 }, note: "A neighbour dropped off a pine log." })) t.state.granted.batLog = true;
      },
      done: function (c) { return s(c, "screen") === "shop" || !!s(c, "ownsBlueprint", BAT_ORDER.kind); },
      rescue: rescueBatPine,
      replay: { enter: null, rescue: null, title: "Blueprints", text: "New kinds of orders need a blueprint from Arbor Freight. Tap SHOP." } },
    { id: "buy_bat", target: ['[data-blueprint="' + BAT_ORDER.kind + '"]', "#tabShop"],
      title: "Buy the blueprint",
      text: "Blueprints unlock new kinds of orders. The harder the piece, the more it pays. Here are " + BAT_COINS + " coins: buy the Baseball bat.",
      enter: function (c, t) {
        if (!t.state.granted.bat && !s(c, "ownsBlueprint", BAT_ORDER.kind) && t.give({ coins: BAT_COINS, note: "Here are " + BAT_COINS + " coins for the blueprint." })) t.state.granted.bat = true;
      },
      done: function (c) { return !!s(c, "ownsBlueprint", BAT_ORDER.kind); },
      rescue: rescueBatPine,
      replay: { enter: null, rescue: null } },
    { id: "take_bat", target: ['[data-kind="' + BAT_ORDER.kind + '"] [data-act="take"]', '[data-kind="' + BAT_ORDER.kind + '"] [data-act="lathe"]', "#tabOrders"],
      title: "Take the job",
      text: "The bat job is yours now. Tap ORDERS and take it.",
      done: function (c) { return s(c, "activeKind") === BAT_ORDER.kind && s(c, "screen") === "lathe"; },
      rescue: rescueBatPine,
      replay: { rescue: null, title: "Take a job", target: ['[data-act="take"]', '[data-act="lathe"]', "#tabOrders"],
        text: "Tap ORDERS and take any job you like.",
        done: function (c) { return !!s(c, "activeKind") && s(c, "screen") === "lathe"; } } },
    { id: "wrap", unlock: ["mine"], target: ["#tabMine"], dismiss: true,
      title: "You're a woodturner",
      text: "Here's a little extra to get you going: " + BONUS.coins + " coins and " + BONUS.diamonds + " diamonds. Finish this bat on your own. New blueprints, finer sandpaper and better tools are at Arbor Freight. The MINE is for diamonds.",
      enter: function (c, t) {
        if (!t.state.granted.bonus && t.give({ coins: BONUS.coins, diamonds: BONUS.diamonds, note: "Bonus: " + BONUS.coins + " coins and " + BONUS.diamonds + " diamonds." })) t.state.granted.bonus = true;
        call(c, "resumeBoard");
      },
      done: function () { return false; },
      replay: { title: "That's the tour", target: ["#tabShop", "#tabMine"],
        text: "New blueprints, finer sandpaper and better tools are at Arbor Freight (SHOP). The MINE is for diamonds: watch a short ad, crack the vein, 5 diamonds. Replay this any time from Settings." } }
  ];

  function topUpOak(c, t) {
    var need = n(c, "plantPrice", "oak") - n(c, "coins");
    if (need > 0 && !n(c, "planted", "oak")) t.give({ coins: need });
  }
  /* The first order needs pine. If it all went into rejected pieces, a neighbour drops a log off. */
  function rescuePine(c, t) {
    if (n(c, "delivered") >= 1) return;
    // a mounted log stays in the shed until DONE, so none left means none on the lathe either
    if (!hasWood(c, "pine")) {
      t.give({ logs: { pine: 1 }, note: "A neighbour dropped off a pine log." });
    }
  }

  /* The bat needs pine. If the gifted log went into a rejected piece, a neighbour drops off another. */
  function rescueBatPine(c, t) {
    if (s(c, "activeKind") === BAT_ORDER.kind && s(c, "screen") === "lathe") return;
    if (!hasWood(c, "pine")) t.give({ logs: { pine: 1 }, note: "A neighbour dropped off a pine log." });
  }

  var BY_ID = {};
  STEPS.forEach(function (st, i) { st.index = i; BY_ID[st.id] = st; });

  function count(v) { return typeof v === "number" && isFinite(v) && v > 0 ? v : 0; }
  function normalize(t) {
    var out = { step: null, done: false, replay: false, base: {}, granted: { coins: 0, diamonds: 0, batLog: false, bat: false, bonus: false } };
    if (!t || typeof t !== "object") return out;
    out.done = !!t.done;
    out.replay = !t.done && !!t.replay;
    if (typeof t.step === "string" && BY_ID[t.step]) out.step = t.step;
    if (t.base && typeof t.base === "object") BASE_READINGS.forEach(function (k) { if (count(t.base[k])) out.base[k] = t.base[k]; });
    if (count(t.taps)) out.taps = Math.floor(t.taps);
    if (t.granted && typeof t.granted === "object") {
      out.granted.coins = count(t.granted.coins); out.granted.diamonds = count(t.granted.diamonds);
      out.granted.batLog = !!t.granted.batLog; out.granted.bat = !!t.granted.bat; out.granted.bonus = !!t.granted.bonus;
    }
    return out;
  }
  /* A step as it runs: in a replay its replay fields stand in for the usual ones. */
  function effective(st, replay) {
    if (!st || !replay || !st.replay) return st;
    var out = {};
    for (var k in st) if (k !== "replay") out[k] = st[k];
    for (var r in st.replay) out[r] = st.replay[r];
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

    function current() { return T.done ? null : effective(BY_ID[T.step], T.replay) || null; }
    function unlocked(tab) {
      if (T.done || T.replay || tab === "lathe" || tab === "harvest") return true;
      var cur = current(), upto = cur ? cur.index : STEPS.length - 1;
      for (var i = 0; i <= upto; i++) if ((STEPS[i].unlock || []).indexOf(tab) >= 0) return true;
      return false;
    }
    function snapshot() { var b = {}; BASE_READINGS.forEach(function (k) { b[k] = n(ctx, k); }); return b; }
    function go(id) {
      var st = effective(BY_ID[id], T.replay);
      if (!st) { finish(); return; }
      T.step = id;
      T.base = snapshot();
      if (st.mode) call(ctx, "setMode", st.mode);
      if (st.enter) st.enter(ctx, api);
      onChange(); onStep(st);
    }
    function finish() {
      if (T.done) return;
      T.done = true; T.step = null; T.replay = false; T.base = {};
      onChange(); onStep(null);
    }
    /* Every hand-out goes through here: counted, and never in a replay. */
    function give(bundle) {
      if (T.replay || !bundle) return false;
      if (bundle.coins > 0) T.granted.coins += bundle.coins;
      if (bundle.diamonds > 0) T.granted.diamonds += bundle.diamonds;
      call(ctx, "grant", bundle);
      onChange();
      return true;
    }
    /* Look at the game and move on as far as the player has got. Call often
       (every second, and after anything the player does). */
    function check() {
      var guard = 0, cur = current();
      while (cur && guard++ < STEPS.length * 2) {
        if (cur.done(ctx, api)) { advance(); cur = current(); continue; }
        var back = cur.rescue ? cur.rescue(ctx, api) : null;
        if (back && BY_ID[back] && back !== cur.id) { go(back); cur = current(); continue; }
        break;
      }
      return cur;
    }
    function advance() {
      var cur = current();
      if (!cur) return null;
      var i = cur.index + 1;
      while (STEPS[i] && T.replay && STEPS[i].replay && STEPS[i].replay.skip) i++;
      if (STEPS[i]) go(STEPS[i].id); else finish();
      return current();
    }
    /* GOT IT on a dismiss step. */
    function dismiss() { var cur = current(); if (cur && cur.dismiss) advance(); }
    /* What skipping would hand over now: the starter pack, less what the flow already gave. */
    function skipGrant() {
      if (T.done || T.replay) return { coins: 0, diamonds: 0 };
      return { coins: Math.max(0, STARTER.coins - T.granted.coins), diamonds: Math.max(0, STARTER.diamonds - T.granted.diamonds), blueprints: STARTER.blueprints.slice() };
    }
    /* Leave the flow: everything opens, the rest of the starter pack is handed over and the
       board fills. Leaving a replay just ends it. */
    function skip() {
      if (T.done) return;
      var g = skipGrant();
      if (g.coins || g.diamonds || (g.blueprints && g.blueprints.length)) give(g);
      finish();
      call(ctx, "resumeBoard");
    }
    /* Walk the flow again, for a player who has played. Only once it is over. */
    function replay() {
      if (!T.done) return false;
      T.done = false; T.replay = true;
      call(ctx, "startReplay");
      go(STEPS[0].id);
      return true;
    }

    var api = {
      state: T, current: current, unlocked: unlocked, check: check, advance: advance, dismiss: dismiss, skip: skip,
      replay: replay, give: give, skipGrant: skipGrant, base: function () { return T.base || {}; },
      get done() { return T.done; }, isActive: function () { return !T.done; },
      isReplay: function () { return !T.done && T.replay; },
      // the board waits until the last card, which refills it; a replay never holds it up
      boardPaused: function () { var c = current(); return !!c && !T.replay && c.index < BY_ID.wrap.index; },
      // while a first run is on, the board is just its two orders (commissions-ui.js)
      guidedBoard: function () { return !T.done && !T.replay; }
    };
    return api;
  }

  var api = {
    STEPS: STEPS, BY_ID: BY_ID, TABS: TABS, FIRST_BOARD: FIRST_BOARD, PRACTICE_SPEC: PRACTICE_SPEC, STARTER: STARTER, GRANT_DIAMONDS: GRANT_DIAMONDS,
    BAT_ORDER: BAT_ORDER, BAT_COINS: BAT_COINS, BONUS: BONUS, SAND_SMOOTH: SAND_SMOOTH,
    CUT_FRACTION: CUT_FRACTION, PAINT_COVER: PAINT_COVER, SHAPE_GOOD: SHAPE_GOOD,
    normalize: normalize, createTutorial: createTutorial
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Tutorial = api;
})(typeof window !== "undefined" ? window : globalThis);

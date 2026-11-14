/* ============================================================
   Commissions: the board of orders that gives every piece a
   purpose. Pure, renderer-free, testable in Node.

   An order asks for one turned piece:
     { id, kind, seed, wood, client, spec, reward, postedAt }
   kind is a PIECES key (rolling pin, bat, walking stick...), and
   with the seed it fixes the target shape (targetProfile). wood
   is the wood it must be turned from. spec is a paint spec
   (paint.js), sheen included. reward is the pay for a perfect job.

   The board holds up to BOARD_SIZE orders. A new one arrives every
   NEW_ORDER_MS while there is room, worked out from the saved clock
   like the farm's trees, so orders come in while the game is closed.
   rushNext() posts one at once for a diamond. One order at a time is
   active: the one on the lathe.

   Grading a turned piece (grade) scores the shape against the target,
   the paint against the spec, the sheen, and how smooth the wood is
   (the piece's rough per slice, from cutting.js: sanded is smoother). Below CFG.PASS the customer
   turns it down and pays nothing; above it the pay rises with the grade,
   with a bonus at CFG.FULL and up. Any wood can be turned against an
   order for practice, but only the wood the order names can be delivered.

   The model owns the commissions section of the save:
     game.commissions { orders: [...], active, nextId, nextAt, seed, done, history, blueprints }

   Blueprints gate the board: it only rolls orders for pieces whose blueprint
   the player owns (blueprints, seeded with FREE_BLUEPRINTS). Each PIECES entry
   has a price; buyBlueprint spends coins through the wallet. An order for a
   piece you don't own can still sit on the board when something authored put
   it there (the new-player flow), but it shows locked and accept() refuses it
   until the blueprint is bought. A new order is one of the owned pieces with
   the fewest orders on the board, so nothing repeats while something else is free. teaser() is the cheapest one not owned yet,
   for the board to tease. The shop (shop.js) stays ladders only.
   Coins go through the shared wallet; the piece comes out of the
   shared inventory (state.js).
   ============================================================ */
(function (root) {
  "use strict";

  var MIN = 60 * 1000;
  var Game = root.Game || {};
  var R = Game.Registry || require("./registry.js");
  var State = Game.State || require("./state.js");
  var Lathe = root.Lathe || {};
  var P = Lathe.Paint || require("./paint.js");
  var Cut = Lathe.CFG ? Lathe : require("./cutting.js");
  var SEG = Cut.CFG.SEG, R0 = Cut.CFG.R0;

  var CFG = {
    BOARD_SIZE: 3,
    NEW_ORDER_MS: 3 * MIN,     // one new order this often while the board has room
    RUSH_DIAMONDS: 1,          // ...or one straight away, for this many diamonds
    HISTORY: 12,               // delivered orders remembered for the board
    // the target never asks for more wood than any blank has, nor for a stick too thin to hold
    R_MAX: 0.66, R_MIN: 0.24,  // fractions of the lathe's blank radius R0
    // shape: mean radius error (fraction of R0) scored as perfect; and as nothing when
    // the stock it started from is unknown (otherwise the untouched stock scores nothing)
    SHAPE_FULL: 0.035, SHAPE_ZERO: 0.26,
    EDGE: 0.03,                // the ends sit in the centres and are not graded
    // how the grade is made up
    W_SHAPE: 0.55, W_PAINT: 0.31, W_SHEEN: 0.08, W_SMOOTH: 0.06,
    // smoothness: mean roughness over the graded span scored as nothing, and as perfect.
    // A skew-finished piece (0.35) earns about half; 80 grit gets about the same, finer grits more.
    ROUGH_ZERO: 0.6, ROUGH_FULL: 0.08,
    // pay: below PASS the customer turns the piece down (no pay, the piece stays in the shed);
    // from PASS to FULL pay rises from MIN_PAY to all of the reward; at FULL and above, all of it plus BONUS
    PASS: 0.5, FULL: 0.9, MIN_PAY: 0.3, BONUS: 0.1,
    STARS: [0.5, 0.72, 0.9]    // grade needed for one, two, three stars
  };

  /* The kinds of piece. base: coins for a perfect pine one. price: coins for
     its blueprint (0 for the free ones). shape(t, r):
     target radius as a fraction of R0 at axial position t (0..1), r a
     seeded random source for the small differences between orders. */
  function S(e0, e1, x) { var u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); }
  function bump(t, c, w) { var d = (t - c) / w; return Math.exp(-d * d); }
  function jit(r, a, b) { return a + (b - a) * r(); }
  var PIECES = {
    rolling_pin: {
      name: "Rolling pin", base: 40, price: 0,
      blurb: "A fat, even body with a slim handle at each end.",
      shape: function (t, r) {
        var h = jit(r, 0.27, 0.33), b = jit(r, 0.58, 0.64), hl = jit(r, 0.13, 0.17);
        return h + (b - h) * S(hl, hl + 0.06, t) * S(hl, hl + 0.06, 1 - t);
      }
    },
    baseball_bat: {
      name: "Baseball bat", base: 70, price: 100,
      blurb: "Knob, long thin handle, swelling to a heavy barrel.",
      shape: function (t, r) {
        var hd = jit(r, 0.26, 0.3), br = jit(r, 0.6, 0.65), sw = jit(r, 0.32, 0.4);
        var f = hd + (br - hd) * S(sw, sw + 0.42, t);
        f += (0.44 - hd) * bump(t, 0.035, 0.03);              // the knob
        return f - 0.08 * S(0.92, 1, t);                      // a rounded end on the barrel
      }
    },
    walking_stick: {
      name: "Walking stick", base: 90, price: 250,
      blurb: "A round knob to hold, a collar, then a long tapering shaft.",
      shape: function (t, r) {
        var top = jit(r, 0.58, 0.65), sh0 = jit(r, 0.38, 0.44), sh1 = jit(r, 0.27, 0.31);
        var shaft = sh0 + (sh1 - sh0) * S(0.18, 1, t);
        var knob = Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.085) / 0.085, 2)));
        var f = shaft + (top - shaft) * knob;
        return f + 0.07 * bump(t, 0.2, 0.018);                // the collar
      }
    },
    spindle: {
      name: "Banister spindle", base: 240, price: 1500,
      blurb: "Square-shouldered ends with beads and coves between.",
      shape: function (t, r) {
        var k = r() < 0.5 ? 3 : 4, mid = jit(r, 0.42, 0.48), amp = jit(r, 0.1, 0.13);
        var u = (t - 0.14) / 0.72, wave = mid + amp * Math.cos(u * Math.PI * 2 * k);
        var end = S(0.86, 0.9, t) + 1 - S(0.1, 0.14, t);
        return wave + (0.62 - wave) * Math.min(1, end);
      }
    },
    chair_leg: {
      name: "Chair leg", base: 140, price: 600,
      blurb: "A thick top where the seat joins, a bead, then a taper to the foot.",
      shape: function (t, r) {
        var top = jit(r, 0.6, 0.65), tl = jit(r, 0.2, 0.25), f0 = jit(r, 0.47, 0.52), f1 = jit(r, 0.3, 0.34);
        var taper = f0 + (f1 - f0) * S(tl + 0.12, 0.95, t);
        var f = taper + (top - taper) * (1 - S(tl, tl + 0.04, t));
        f -= 0.12 * bump(t, tl + 0.05, 0.02);                 // a cove under the top
        f += 0.1 * bump(t, tl + 0.1, 0.022);                  // and a bead
        return f + 0.06 * bump(t, 0.97, 0.025);               // a little pad at the foot
      }
    }
  };
  var PIECE_ORDER = ["rolling_pin", "walking_stick", "chair_leg", "spindle", "baseball_bat"];
  var FREE_BLUEPRINTS = ["rolling_pin"];
  // the blueprints from cheapest to dearest, the way the shop lists them
  var BLUEPRINT_ORDER = PIECE_ORDER.slice().sort(function (a, b) { return PIECES[a].price - PIECES[b].price; });

  // what each wood is worth over pine, and how often it is asked for
  var WOOD_PAY = { pine: 1, oak: 1.6, walnut: 2.4 };
  var WOOD_WEIGHT = { pine: 0.45, oak: 0.35, walnut: 0.2 };
  var CLIENTS = ["Mrs. Alder", "Old Tom", "The Hollis twins", "Pastor Reed", "Juniper Cafe", "Coach Barrow", "Aunt Marigold",
    "Mr. Fennick", "The Bramble Inn", "Dr. Okafor", "Little Wren", "Captain Moss", "Granny Pell", "The Quarry Club"];

  /* ---------------- the target shape ---------------- */
  /* SEG radii (world units, like Workpiece.radius) for an order. A light
     blur keeps every edge something the gouge can actually turn. Bats and
     sticks are as often turned facing either way; opts.noFlip keeps them one
     way round (the blueprint art). */
  function targetProfile(order, opts) {
    var def = PIECES[order.kind];
    if (!def) return null;
    var r = P.rng((order.seed >>> 0) ^ 0x5eed), raw = new Float32Array(SEG), out = new Float32Array(SEG), i, k, q;
    var flip = (order.kind === "baseball_bat" || order.kind === "walking_stick" || order.kind === "chair_leg") && r() < 0.5;
    if (opts && opts.noFlip) flip = false;
    // the shape's own random numbers, drawn once and replayed for every t: one shape, not noise
    var vals = []; for (i = 0; i < 16; i++) vals.push(r());
    function rr() { return vals[q++ % vals.length]; }
    for (i = 0; i < SEG; i++) {
      var t = i / (SEG - 1); q = 0;
      raw[i] = def.shape(flip ? 1 - t : t, rr);
    }
    var B = 3;
    for (i = 0; i < SEG; i++) {
      var s = 0, c = 0;
      for (k = -B; k <= B; k++) { var j = i + k; if (j >= 0 && j < SEG) { s += raw[j]; c++; } }
      out[i] = R0 * Math.min(CFG.R_MAX, Math.max(CFG.R_MIN, s / c));
    }
    return out;
  }

  /* ---------------- making orders ---------------- */
  function pickWeighted(r, weights, order) {
    var tot = 0, k;
    for (k = 0; k < order.length; k++) tot += weights[order[k]] || 0;
    var x = r() * tot;
    for (k = 0; k < order.length; k++) { x -= weights[order[k]] || 0; if (x <= 0) return order[k]; }
    return order[order.length - 1];
  }
  /* One order from a seed. opts.wood / opts.kind / opts.specKind / opts.sheen /
     opts.client force those. opts.kinds: the pieces it may roll (the board
     passes the blueprints owned); every piece when it is not given. Same
     seed, same order. */
  function makeOrder(seed, opts) {
    opts = opts || {};
    var r = P.rng(seed >>> 0);
    var woods = R.WOOD_ORDER.filter(function (w) { return WOOD_PAY[w] != null; });
    var wood = opts.wood && R.WOODS[opts.wood] ? opts.wood : pickWeighted(r, WOOD_WEIGHT, woods);
    var kinds = Array.isArray(opts.kinds) ? PIECE_ORDER.filter(function (k) { return opts.kinds.indexOf(k) >= 0; }) : PIECE_ORDER;
    if (!kinds.length) kinds = FREE_BLUEPRINTS;
    var kind = opts.kind && PIECES[opts.kind] ? opts.kind : kinds[Math.floor(r() * kinds.length)];
    var client = CLIENTS[Math.floor(r() * CLIENTS.length)];
    if (opts.client) client = opts.client;
    var spec = P.generateSpec(Math.floor(r() * 4294967296), { kind: opts.specKind, sheen: opts.sheen });
    var reward = Math.round(PIECES[kind].base * (WOOD_PAY[wood] || 1) / 5) * 5;
    return { id: 0, kind: kind, seed: seed >>> 0, wood: wood, client: client, spec: spec, reward: reward, postedAt: 0 };
  }

  /* ---------------- grading ---------------- */
  function smooth(e0, e1, x) { return S(e0, e1, x); }
  /* How close a turned profile is to the target, 0..1. Where the stock was
     already thinner than the target there is nothing more to take, so the
     target there is the stock. The score is progress from the stock as it
     was mounted (0) to within SHAPE_FULL of the target (1), so every pass
     toward the line shows, and cutting past it costs. */
  function meanErr(a, target, start) {
    var n = SEG, e = Math.round(CFG.EDGE * (n - 1)), sum = 0, cnt = 0;
    for (var i = e; i < n - e; i++) {
      var tg = start ? Math.min(target[i], start[i]) : target[i];
      sum += Math.abs(a[i] - tg) / R0; cnt++;
    }
    return cnt ? sum / cnt : 1;
  }
  function shapeScore(profile, target, start) {
    var err = meanErr(profile, target, start);
    var zero = start ? Math.max(meanErr(start, target, start), CFG.SHAPE_FULL * 2) : CFG.SHAPE_ZERO;
    var u = Math.min(1, Math.max(0, (zero - err) / (zero - CFG.SHAPE_FULL)));
    return { score: Math.pow(u, 1.3), err: err };
  }
  /* How smooth a piece is, 0..1: progress from ROUGH_ZERO down to ROUGH_FULL in the
     mean roughness over the graded span. No roughness saved means rough-sawn. */
  function smoothScore(rough) {
    if (!rough || rough.length !== SEG) return { score: 0, rough: 1 };
    var e = Math.round(CFG.EDGE * (SEG - 1)), sum = 0, cnt = 0;
    for (var i = e; i < SEG - e; i++) { sum += rough[i]; cnt++; }
    var m = cnt ? sum / cnt : 1;
    return { score: Math.min(1, Math.max(0, (CFG.ROUGH_ZERO - m) / (CFG.ROUGH_ZERO - CFG.ROUGH_FULL))), rough: m };
  }
  function starsFor(g) { var s = 0; for (var i = 0; i < CFG.STARS.length; i++) if (g >= CFG.STARS[i]) s = i + 1; return s; }
  /* A coating rebuilt from a piece's saved coat, for paint.js to grade. */
  function coatingOf(coat) {
    var c = new P.Coating();
    if (coat && coat.coat) { c.coat.set(State.unpack(coat.coat)); c.color.set(State.unpack(coat.color)); c.gloss.set(State.unpack(coat.gloss)); }
    return c;
  }
  /* Grade work against an order. work: { wood, profile, start, coat, rough } where
     profile/start/rough are slice arrays and coat is a Coating, or the saved
     { coat, color, gloss } arrays of a piece. */
  function grade(order, work) {
    var target = targetProfile(order);
    var prof = State.unpack(work.profile), start = work.start ? State.unpack(work.start) : null;
    var sh = shapeScore(prof, target, start);
    var coating = work.coat instanceof P.Coating ? work.coat : coatingOf(work.coat);
    var m = P.matchSpec(order.spec, coating);
    var sm = smoothScore(work.rough ? State.unpack(work.rough) : null);
    var g = CFG.W_SHAPE * sh.score + CFG.W_PAINT * m.color + CFG.W_SHEEN * m.finish + CFG.W_SMOOTH * sm.score;
    var woodOk = work.wood === order.wood, accepted = woodOk && g >= CFG.PASS;
    return {
      shape: sh.score, shapeErr: sh.err, paint: m.color, sheen: m.finish, sheenGot: m.sheen, smooth: sm.score, rough: sm.rough,
      total: g, stars: starsFor(g), woodOk: woodOk, accepted: accepted,
      pay: accepted ? payFor(order.reward, g) : 0, bonus: accepted && g >= CFG.FULL
    };
  }
  /* What a grade earns on a reward, when the piece is accepted (see CFG.PASS..BONUS). */
  function payFor(reward, g) {
    if (g < CFG.PASS) return 0;
    if (g >= CFG.FULL) return Math.round(reward * (1 + CFG.BONUS));
    return Math.round(reward * (CFG.MIN_PAY + (1 - CFG.MIN_PAY) * (g - CFG.PASS) / (CFG.FULL - CFG.PASS)));
  }

  /* ---------------- the board ---------------- */
  function defaultBoard() { return { orders: [], active: null, nextId: 1, nextAt: 0, seed: 0, done: 0, history: [], blueprints: FREE_BLUEPRINTS.slice() }; }
  function normalizeBoard(b) {
    var out = defaultBoard();
    if (!b || typeof b !== "object") return out;
    if (Array.isArray(b.orders)) out.orders = b.orders.filter(function (o) {
      return o && typeof o === "object" && PIECES[o.kind] && R.WOODS[o.wood] && P.validSpec(o.spec) && o.reward > 0 && o.id > 0;
    }).slice(0, CFG.BOARD_SIZE);
    if (out.orders.some(function (o) { return o.id === b.active; })) out.active = b.active;
    out.nextId = Math.max(isFinite(b.nextId) ? b.nextId : 1, 1 + out.orders.reduce(function (m, o) { return Math.max(m, o.id); }, 0));
    if (isFinite(b.nextAt)) out.nextAt = b.nextAt;
    if (isFinite(b.seed)) out.seed = b.seed >>> 0;
    if (isFinite(b.done) && b.done >= 0) out.done = Math.floor(b.done);
    if (Array.isArray(b.blueprints)) b.blueprints.forEach(function (k) { if (PIECES[k] && out.blueprints.indexOf(k) < 0) out.blueprints.push(k); });
    if (Array.isArray(b.history)) out.history = b.history.filter(function (h) { return h && typeof h === "object"; }).slice(-CFG.HISTORY);
    return out;
  }

  /* game: the save object.
     opts.state: the shared state (state.js).
     opts.now: () => ms, so tests can drive the clock.
     opts.random: () => 0..1, where new orders' seeds come from.
     opts.timersOff: () => bool. With the full unlock a new order is posted at once.
     opts.paused: () => bool. While true no order is posted on its own (the
       new-player flow authors its board with postAuthored, then resume()s).
     opts.onChange: called after any change worth saving. */
  function createBoard(game, opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var random = opts.random || Math.random;
    var onChange = opts.onChange || function () {};
    var timersOff = opts.timersOff || function () { return false; };
    var paused = opts.paused || function () { return false; };
    var state = opts.state || State.createState(game, { onChange: onChange, now: now });
    game.commissions = normalizeBoard(game.commissions);
    var B = game.commissions;
    if (!B.seed) B.seed = Math.floor(random() * 4294967296) >>> 0 || 1;

    function nextSeed() { B.seed = (Math.imul(B.seed ^ (B.seed >>> 13), 0x5bd1e995) + 0x9e3779b9) >>> 0; return B.seed; }
    function post(opts2) {
      var o2 = {}, k;
      for (k in (opts2 || {})) o2[k] = opts2[k];
      // only what the player owns, unless opts2.kind forces a piece; of those, the ones with the
      // fewest orders on the board already, so the board stays mixed instead of three of one thing
      var onBoard = function (kb) { return B.orders.filter(function (q) { return q.kind === kb; }).length; };
      var least = Math.min.apply(null, B.blueprints.map(onBoard));
      o2.kinds = B.blueprints.filter(function (kb) { return onBoard(kb) === least; });
      var o = makeOrder(opts2 && opts2.seed != null ? opts2.seed : nextSeed(), o2);
      o.id = B.nextId++; o.postedAt = now();
      B.orders.push(o);
      return o;
    }
    /* Post the orders that have arrived since the board was last looked at.
       A brand-new board is filled at once, and its first order is pine,
       the wood that grows quickest, so a new player can take one straight away. */
    function refill() {
      var t = now(), added = [];
      if (paused()) return added;
      if (!B.done && !B.orders.length && !B.history.length && !B.nextAt) {
        added.push(post({ wood: "pine", kind: "rolling_pin", specKind: "dipped" }));
        while (B.orders.length < CFG.BOARD_SIZE) added.push(post());
        B.nextAt = t + CFG.NEW_ORDER_MS;
      }
      // while away, each empty slot filled NEW_ORDER_MS after the last. A full board
      // does not bank time: decline and deliver restart the clock for the freed slot.
      while (B.orders.length < CFG.BOARD_SIZE && (timersOff() || t >= B.nextAt)) {
        added.push(post());
        B.nextAt = timersOff() ? t : B.nextAt + CFG.NEW_ORDER_MS;
      }
      if (added.length) onChange();
      return added;
    }
    /* Post fixed orders (each a makeOrder opts, seed included), whatever the
       pause says, up to the board's size. The new-player flow's first board. */
    function postAuthored(list) {
      var added = [];
      (list || []).forEach(function (d) { if (B.orders.length < CFG.BOARD_SIZE) added.push(post(d)); });
      if (added.length) onChange();
      return added;
    }
    /* After a pause: fill every empty slot now, then the normal clock takes over. */
    function resume() {
      if (paused()) return [];
      var added = [];
      if (B.done || B.history.length) {
        while (B.orders.length < CFG.BOARD_SIZE) added.push(post());
        B.nextAt = now() + CFG.NEW_ORDER_MS;
        if (added.length) onChange();
      }
      return added.concat(refill());
    }
    function get(id) { for (var i = 0; i < B.orders.length; i++) if (B.orders[i].id === id) return B.orders[i]; return null; }
    function active() { return B.active ? get(B.active) : null; }
    function msUntilNext() { return B.orders.length >= CFG.BOARD_SIZE ? null : Math.max(0, B.nextAt - now()); }

    /* ---- blueprints ---- */
    function ownsBlueprint(kind) { return B.blueprints.indexOf(kind) >= 0; }
    function locked(o) { return !!o && !ownsBlueprint(o.kind); }
    /* Buy a blueprint: the coins go, and the board rolls that piece from now on.
       An order for it already on the board unlocks in place. */
    function buyBlueprint(kind) {
      var def = PIECES[kind];
      if (!def) return { ok: false, reason: "no such blueprint" };
      if (ownsBlueprint(kind)) return { ok: false, reason: "owned" };
      var paid = state.wallet.spend("coins", def.price);
      if (!paid.ok) return { ok: false, reason: "not enough coins", need: def.price, have: state.wallet.balance("coins") };
      B.blueprints.push(kind);
      onChange();
      return { ok: true, kind: kind, price: def.price };
    }
    /* Hand a blueprint over for nothing (the starter pack). */
    function grantBlueprint(kind) {
      if (!PIECES[kind] || ownsBlueprint(kind)) return false;
      B.blueprints.push(kind); onChange();
      return true;
    }
    /* The cheapest blueprint not owned yet, or null when every one is. */
    function teaser() {
      for (var i = 0; i < BLUEPRINT_ORDER.length; i++) if (!ownsBlueprint(BLUEPRINT_ORDER[i])) return BLUEPRINT_ORDER[i];
      return null;
    }

    function accept(id) {
      var o = get(id);
      if (!o) return { ok: false, reason: "no such order" };
      if (locked(o)) return { ok: false, reason: "no blueprint", kind: o.kind };
      B.active = id; onChange();
      return { ok: true, order: o };
    }
    function release() { if (B.active) { B.active = null; onChange(); } }
    /* Turn an order down. A new one takes its place in NEW_ORDER_MS. */
    function decline(id) {
      var i = B.orders.findIndex(function (o) { return o.id === id; });
      if (i < 0) return { ok: false, reason: "no such order" };
      B.orders.splice(i, 1);
      if (B.active === id) B.active = null;
      B.nextAt = Math.max(B.nextAt, now() + CFG.NEW_ORDER_MS);
      onChange();
      return { ok: true };
    }

    /* Pieces in the shed that could go to an order: its wood, turned. */
    function candidates(id) {
      var o = get(id);
      if (!o) return [];
      return state.inventory.list("piece", function (it) { return it.wood === o.wood && Array.isArray(it.profile); });
    }
    /* What a piece in the shed would earn on an order, without delivering it. */
    function preview(id, pieceId) {
      var o = get(id), it = state.inventory.get(pieceId);
      if (!o || !it || it.kind !== "piece") return null;
      return grade(o, it);
    }
    /* Hand a piece from the shed over: it leaves the shed, the coins come in,
       and the order comes off the board. Only the wood the order names will do. */
    function deliver(id, pieceId) {
      var o = get(id), it = state.inventory.get(pieceId);
      if (!o) return { ok: false, reason: "no such order" };
      if (!it || it.kind !== "piece") return { ok: false, reason: "no such piece" };
      var g = grade(o, it);
      if (!g.woodOk) return { ok: false, reason: "wrong wood", grade: g };
      if (!g.accepted) return { ok: false, reason: "rejected", grade: g };   // the piece stays in the shed
      if (!state.inventory.take("piece", pieceId)) return { ok: false, reason: "no such piece" };
      if (g.pay > 0) state.wallet.earn("coins", g.pay);
      B.orders.splice(B.orders.indexOf(o), 1);
      if (B.active === id) B.active = null;
      B.done++;
      B.history.push({ id: o.id, kind: o.kind, wood: o.wood, client: o.client, stars: g.stars, total: Math.round(g.total * 1000) / 1000, pay: g.pay, at: now() });
      if (B.history.length > CFG.HISTORY) B.history.splice(0, B.history.length - CFG.HISTORY);
      if (B.orders.length < CFG.BOARD_SIZE) B.nextAt = Math.max(B.nextAt, now() + CFG.NEW_ORDER_MS);
      onChange();
      return { ok: true, grade: g, order: o, pay: g.pay };
    }

    /* Don't wait for the next order: post one now for RUSH_DIAMONDS diamonds. */
    function rushNext() {
      if (paused()) return { ok: false, reason: "paused" };
      if (B.orders.length >= CFG.BOARD_SIZE) return { ok: false, reason: "board is full" };
      var paid = state.wallet.spend("diamonds", CFG.RUSH_DIAMONDS);
      if (!paid.ok) return { ok: false, reason: "not enough diamonds", need: CFG.RUSH_DIAMONDS, have: state.wallet.balance("diamonds") };
      var o = post();
      if (B.orders.length < CFG.BOARD_SIZE) B.nextAt = Math.max(B.nextAt, now() + CFG.NEW_ORDER_MS);
      onChange();
      return { ok: true, order: o };
    }

    refill();
    return {
      state: B, refill: refill, postAuthored: postAuthored, resume: resume, get: get, active: active, accept: accept, release: release, decline: decline,
      candidates: candidates, preview: preview, deliver: deliver, msUntilNext: msUntilNext, rushNext: rushNext,
      grade: grade, targetProfile: targetProfile,
      ownsBlueprint: ownsBlueprint, buyBlueprint: buyBlueprint, grantBlueprint: grantBlueprint, teaser: teaser, locked: locked
    };
  }

  var api = {
    CFG: CFG, PIECES: PIECES, PIECE_ORDER: PIECE_ORDER, FREE_BLUEPRINTS: FREE_BLUEPRINTS, BLUEPRINT_ORDER: BLUEPRINT_ORDER, WOOD_PAY: WOOD_PAY, CLIENTS: CLIENTS,
    targetProfile: targetProfile, makeOrder: makeOrder, shapeScore: shapeScore, smoothScore: smoothScore, grade: grade, starsFor: starsFor, payFor: payFor,
    defaultBoard: defaultBoard, normalizeBoard: normalizeBoard, createBoard: createBoard
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Commissions = api;
})(typeof window !== "undefined" ? window : globalThis);

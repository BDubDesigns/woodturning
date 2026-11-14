// Run: node --test tests/
// The new-player flow (tutorial.js) and what it leans on: seed prices, the paused board.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { playedGame } = require("./helpers.js");
const T = require("../src/js/tutorial.js");
const S = require("../src/js/save.js");
const F = require("../src/js/farm.js");
const C = require("../src/js/commissions.js");
const R = require("../src/js/registry.js");
const St = require("../src/js/state.js");

// ---------- seed prices ----------
test("planting costs the wood's seed price in coins, and is refused without them", () => {
  const game = S.newGame();
  const farm = F.createFarm(game, { now: () => 0 });
  assert.equal(farm.plantPrice("pine"), R.WOODS.pine.plantPrice);
  const r = farm.plant(0, "oak");
  assert.deepEqual(r, { ok: false, reason: "not enough coins", price: R.WOODS.oak.plantPrice });
  assert.equal(farm.plotAt(0), null, "nothing planted");
  game.wallet.coins = R.WOODS.oak.plantPrice + 3;
  assert.equal(farm.plant(0, "oak").ok, true);
  assert.equal(game.wallet.coins, 3);
});

test("an ad plants for free: plant with free costs nothing", () => {
  const game = S.newGame();
  const farm = F.createFarm(game, { now: () => 0 });
  assert.deepEqual(farm.plant(1, "walnut", { free: true }), { ok: true, price: 0 });
  assert.equal(game.wallet.coins, 0);
});

test("dearer seeds are dearer woods, and the cheapest order of each wood pays well over its seed", () => {
  const prices = R.WOOD_ORDER.map((w) => R.WOODS[w].plantPrice);
  for (let i = 1; i < prices.length; i++) assert.ok(prices[i] > prices[i - 1], "seed prices rise with the wood");
  R.WOOD_ORDER.forEach((w, i) => {
    const cheapest = Math.min(...C.PIECE_ORDER.map((k) => C.makeOrder(1, { wood: w, kind: k }).reward));
    assert.ok(cheapest >= 1.75 * R.WOODS[w].plantPrice, w + ": cheapest order " + cheapest + " vs seed " + R.WOODS[w].plantPrice);
    if (i) {
      const prev = R.WOOD_ORDER[i - 1];
      C.PIECE_ORDER.forEach((k) => assert.ok(C.makeOrder(1, { wood: w, kind: k }).reward > C.makeOrder(1, { wood: prev, kind: k }).reward, k + ": " + w + " pays more than " + prev));
    }
  });
});

// ---------- the board, paused ----------
function board(game, paused) {
  const clock = { t: 1_000_000 };
  const state = St.createState(game, { now: () => clock.t });
  const b = C.createBoard(game, { state, now: () => clock.t, random: () => 0.5, paused: () => paused.on });
  return { b, clock, state };
}

test("a paused board posts nothing on its own, however long it waits", () => {
  const paused = { on: true };
  const { b, clock } = board(S.newGame(), paused);
  assert.equal(b.state.orders.length, 0);
  clock.t += 3600e3;
  assert.deepEqual(b.refill(), []);
  assert.equal(b.state.orders.length, 0);
});

test("the first board is authored: the same two orders for every new player", () => {
  const a = board(S.newGame(), { on: true }).b, z = board(S.newGame(), { on: true }).b;
  a.postAuthored(T.FIRST_BOARD); z.postAuthored(T.FIRST_BOARD);
  assert.deepEqual(a.state.orders.map((o) => [o.wood, o.kind, o.client, o.spec.sheen]), [["pine", "rolling_pin", "Mrs. Alder", "satin"], ["oak", "rolling_pin", "Old Tom", "gloss"]]);
  assert.deepEqual(a.state.orders.map((o) => o.spec), z.state.orders.map((o) => o.spec));
  assert.equal(a.state.orders[0].spec.kind, "dipped");
  assert.ok(a.state.orders[1].reward > a.state.orders[0].reward, "the oak order pays a little better");
});

test("resume fills the board at once after the flow, then the clock takes over", () => {
  const paused = { on: true };
  const { b, clock } = board(S.newGame(), paused);
  b.postAuthored(T.FIRST_BOARD);
  b.state.orders.splice(0, 2); b.state.done = 2;     // both delivered in the flow
  paused.on = false;
  const added = b.resume();
  assert.equal(added.length, C.CFG.BOARD_SIZE);
  assert.equal(b.state.orders.length, C.CFG.BOARD_SIZE);
  clock.t += C.CFG.NEW_ORDER_MS * 5;
  assert.deepEqual(b.refill(), [], "a full board banks nothing");
});

test("resume after skipping at once gives the usual first board, pine first", () => {
  const paused = { on: true };
  const { b } = board(S.newGame(), paused);
  paused.on = false;
  b.resume();
  assert.equal(b.state.orders.length, C.CFG.BOARD_SIZE);
  assert.equal(b.state.orders[0].wood, "pine");
});

// ---------- the flow ----------
/* A fake game for the flow to read: every reading is a plain field. */
function fakeCtx(over) {
  const c = {
    v: { emptyPlots: 2, doneTaps: 0, screen: "lathe", mode: "cut", removed: 0, coverage: 0, sheenRank: 0, shape: 0, delivered: 0, activeWood: null, activeKind: null, selectedEmpty: false, harvestPhase: null, coins: 0, diamonds: 0, tip: "gouge", smoothHere: 0 },
    logs: { pine: 3 }, blanks: {}, pieces: {}, planted: {}, grown: {}, deliverable: {},
    owned: new Set(["rolling_pin"]), orders: [],
    grants: [], boards: 0, resumed: 0, took: [], posted: []
  };
  const ctx = {
    screen: () => c.v.screen, mode: () => c.v.mode, removed: () => c.v.removed, coverage: () => c.v.coverage,
    sheenRank: () => c.v.sheenRank, shape: () => c.v.shape, delivered: () => c.v.delivered, activeWood: () => c.v.activeWood,
    selectedEmpty: () => c.v.selectedEmpty, harvestPhase: () => c.v.harvestPhase, coins: () => c.v.coins, diamonds: () => c.v.diamonds,
    logs: (w) => c.logs[w] || 0, blanks: (w) => c.blanks[w] || 0, pieces: (w) => c.pieces[w] || 0,
    canDeliver: (w) => !!c.deliverable[w],
    piecesAll: () => Object.values(c.pieces).reduce((a, b) => a + b, 0), plantedAll: () => Object.values(c.planted).reduce((a, b) => a + b, 0),
    grownAll: () => Object.values(c.grown).reduce((a, b) => a + b, 0), emptyPlots: () => c.v.emptyPlots, doneTaps: () => c.v.doneTaps,
    startReplay: () => { c.replays = (c.replays || 0) + 1; }, planted: (w) => c.planted[w] || 0, grown: (w) => c.grown[w] || 0,
    plantPrice: (w) => R.WOODS[w].plantPrice,
    grant: (g) => { c.grants.push(g); if (g.coins) c.v.coins += g.coins; if (g.diamonds) c.v.diamonds += g.diamonds; if (g.logs) for (const w in g.logs) c.logs[w] = (c.logs[w] || 0) + g.logs[w]; (g.blueprints || []).forEach((k) => c.owned.add(k)); },
    setMode: (m) => { c.v.mode = m; },
    tip: () => c.v.tip, smoothHere: () => c.v.smoothHere, activeKind: () => c.v.activeKind,
    ownsBlueprint: (k) => c.owned.has(k), hasOrder: (k) => c.orders.includes(k),
    postOrder: (d) => { c.posted.push(d); c.orders.push(d.kind); },
    postFirstBoard: () => { c.boards++; }, resumeBoard: () => { c.resumed++; }, takeOrder: (w) => { c.took.push(w); }
  };
  Object.assign(c.v, over || {});
  return { c, ctx };
}
function flow(over) {
  const game = S.newGame();
  const { c, ctx } = fakeCtx(over);
  let saves = 0;
  const steps = [];
  const t = T.createTutorial(game, { ctx, onChange: () => saves++, onStep: (s) => steps.push(s ? s.id : null) });
  return { game, c, ctx, t, steps, saves: () => saves };
}
const id = (t) => (t.current() ? t.current().id : null);

test("a new game starts at the first step with only the lathe open", () => {
  const { t } = flow();
  assert.equal(id(t), "cut");
  assert.equal(t.unlocked("lathe"), true);
  for (const tab of ["orders", "farm", "shop", "mine"]) assert.equal(t.unlocked(tab), false, tab);
  assert.equal(t.boardPaused(), true);
});

test("the whole flow, step by step, unlocking tabs as it goes", () => {
  const { c, ctx, t, game } = flow();
  const at = (want) => { t.check(); assert.equal(id(t), want); };
  at("cut");
  c.v.removed = 0.01; at("cut");                     // some, but not enough
  c.v.removed = T.CUT_FRACTION; at("pick_sand");
  assert.deepEqual(t.current().target, ["#tipSand"]);
  c.v.tip = "sand"; at("sand");
  c.v.smoothHere = 0.59; at("sand");                 // not quite
  c.v.tip = "gouge"; t.check();
  assert.match(t.current().hint(ctx), /SANDPAPER/, "put the sandpaper down: the card says to pick it up again");
  c.v.tip = "sand"; c.v.smoothHere = T.SAND_SMOOTH; at("to_paint");
  c.v.mode = "paint"; at("paint");
  c.v.coverage = T.PAINT_COVER; at("to_finish");
  c.v.mode = "finish"; at("finish");
  c.v.sheenRank = 2; at("finish");
  assert.match(t.current().hint(ctx), /UNDO/, "past satin (gloss) does not pass: the card says how to undo");
  c.v.sheenRank = 0;
  assert.equal(t.current().hint(ctx), null, "and the hint goes once the finish is cleared");
  c.v.sheenRank = 1; at("keep");
  c.pieces.pine = 1; c.logs.pine = 2; at("to_orders");
  assert.equal(c.boards, 1, "the first board is posted as ORDERS opens");
  assert.equal(t.unlocked("orders"), true);
  assert.equal(t.unlocked("farm"), false);
  c.v.screen = "orders"; at("take");
  c.v.activeWood = "pine"; at("take");               // still on the board
  c.v.screen = "lathe"; c.v.mode = "finish"; at("turn");
  assert.equal(c.v.mode, "cut", "an order starts at the chisel, whatever mode the lathe was left in");
  c.v.shape = T.SHAPE_GOOD; at("order_paint");
  c.v.mode = "finish"; at("deliver");
  c.v.delivered = 1; c.v.coins = 20; at("to_farm");
  assert.equal(t.unlocked("farm"), true);
  c.v.screen = "farm"; at("plot");
  c.v.selectedEmpty = true; at("plant");
  assert.equal(c.v.coins, R.WOODS.oak.plantPrice, "topped up to afford the oak");
  c.planted.oak = 1; c.v.coins = 0; at("speed");
  assert.equal(c.v.diamonds, T.GRANT_DIAMONDS);
  c.grown.oak = 1; at("harvest");
  c.v.screen = "harvest"; c.v.harvestPhase = "chop"; at("chop");
  c.v.harvestPhase = "delimb"; at("delimb");
  c.v.harvestPhase = "saw"; c.planted.oak = 0; c.grown.oak = 0; c.logs.oak = 1; at("saw");
  c.v.screen = "lathe"; c.logs.oak = 0; c.blanks.oak = 1; at("oak_order");
  assert.deepEqual(c.took, ["oak"], "the oak order goes on the lathe with the blank");
  const coinsAtOak = c.v.coins;
  c.v.delivered = 2; c.blanks.oak = 0; c.logs.pine = 1; at("bat_order");
  assert.deepEqual(c.posted.map((o) => [o.kind, o.wood, o.client]), [["baseball_bat", "pine", "Coach Barrow"]], "one authored order: a pine bat");
  assert.equal(c.logs.pine, 2, "a pine log, in case the starting ones went on practice");
  assert.equal(t.unlocked("shop"), true);
  assert.equal(t.unlocked("mine"), false, "the mine waits for the last card");
  assert.equal(t.boardPaused(), true, "and the board stays paused");
  c.v.screen = "shop"; at("buy_bat");
  assert.equal(c.v.coins, coinsAtOak + T.BAT_COINS, "100 coins for the blueprint");
  c.v.screen = "orders"; at("buy_bat");              // left the shop without buying: the card follows
  assert.ok(t.current().target.includes("#tabShop"));
  c.v.screen = "shop"; c.owned.add("baseball_bat"); c.v.coins -= 100; at("take_bat");
  c.v.screen = "orders"; c.v.activeKind = "baseball_bat"; c.v.activeWood = "pine"; at("take_bat");
  c.v.screen = "lathe"; at("wrap");
  assert.equal(c.v.coins, coinsAtOak + T.BONUS.coins, "the bat nets to zero, the bonus is on top");
  assert.equal(c.v.diamonds, T.BONUS.diamonds + T.GRANT_DIAMONDS);
  assert.equal(c.resumed, 1, "the board refills at the last card");
  assert.equal(t.unlocked("mine"), true);
  assert.equal(t.boardPaused(), false);
  assert.equal(t.current().dismiss, true);
  t.dismiss();
  assert.equal(t.done, true);
  assert.equal(game.tutorial.done, true);
  for (const tab of T.TABS) assert.equal(t.unlocked(tab), true);
});

test("a player who is ahead of the flow skips the steps they already did", () => {
  const { c, t } = flow({ removed: 0.1, mode: "finish", coverage: 0.5, sheenRank: 1, tip: "sand", smoothHere: 0.7 });
  c.pieces.pine = 1;
  t.check();
  assert.equal(id(t), "to_orders", "cut, paint, finish and keep all passed in one check");
});

test("progress is saved by step id and survives a reload", () => {
  const { c, t, game } = flow();
  c.v.removed = 1; t.check();
  assert.equal(game.tutorial.step, "pick_sand");
  const again = T.createTutorial(JSON.parse(JSON.stringify(game)), { ctx: fakeCtx().ctx });
  assert.equal(id(again), "pick_sand");
  assert.equal(T.normalize({ step: "no-such-step", done: false }).step, null);
});

test("skip opens everything, hands over the starter pack and resumes the board", () => {
  const { c, t, steps } = flow();
  t.skip();
  assert.equal(t.done, true);
  assert.deepEqual(c.grants, [{ coins: T.STARTER.coins, diamonds: T.STARTER.diamonds, blueprints: ["baseball_bat"] }]);
  assert.ok(c.owned.has("baseball_bat"), "the skip pack has the bat blueprint");
  assert.equal(c.resumed, 1);
  assert.equal(steps[steps.length - 1], null);
  t.skip();
  assert.equal(c.grants.length, 1, "skipping twice grants once");
});

test("no pine left for the first order: a neighbour drops off a log", () => {
  const { c, t, game } = flow();
  game.tutorial.step = "turn";
  c.logs.pine = 0;
  t.check();
  assert.equal(c.logs.pine, 1);
  assert.equal(id(t), "turn");
  t.check();
  assert.equal(c.logs.pine, 1, "only when there is none");
});

test("the oak piece was turned down and the oak is gone: back to the farm", () => {
  const { c, t, game } = flow();
  game.tutorial.step = "oak_order";
  c.v.delivered = 1;
  t.check();
  assert.equal(id(t), "to_farm");
  c.v.screen = "farm"; c.planted.oak = 1; t.check();
  assert.equal(id(t), "speed", "already planted: straight to the speed-up");
});

test("a finished piece waiting for its grade is not taken for missing wood", () => {
  const { c, t, game } = flow();
  game.tutorial.step = "oak_order";
  c.v.delivered = 1; c.pieces.oak = 1; c.deliverable.oak = true;
  t.check();
  assert.equal(id(t), "oak_order");
});

test("diamonds are topped up, not stacked, if the speed-up step comes round again", () => {
  const { c, t, game } = flow({ diamonds: 3 });
  game.tutorial.step = "plant";
  c.planted.oak = 1; t.check();
  assert.equal(id(t), "speed");
  assert.equal(c.v.diamonds, T.GRANT_DIAMONDS);
});

test("every step has copy, and no player-facing copy has an em dash", () => {
  T.STEPS.forEach((s) => {
    assert.ok(s.title && s.text, s.id);
    assert.ok(!/—/.test(s.title + s.text), s.id + " has an em dash");
    assert.equal(typeof s.done, "function");
  });
  assert.equal(new Set(T.STEPS.map((s) => s.id)).size, T.STEPS.length, "ids are unique");
});

test("a played game never sees the flow", () => {
  const t = T.createTutorial(playedGame(), { ctx: fakeCtx().ctx });
  assert.equal(t.current(), null);
  assert.equal(t.boardPaused(), false);
  assert.equal(t.unlocked("mine"), true);
});

// ---------- skipping part way, and replaying ----------
test("skipping part way tops up the starter pack instead of paying it twice", () => {
  const { c, t, game } = flow();
  game.tutorial.step = "plant";
  c.planted.oak = 1; t.check();                        // into the speed-up step: 5 diamonds handed over
  assert.equal(id(t), "speed");
  assert.equal(game.tutorial.granted.diamonds, T.GRANT_DIAMONDS);
  assert.deepEqual(t.skipGrant(), { coins: T.STARTER.coins, diamonds: T.STARTER.diamonds - T.GRANT_DIAMONDS, blueprints: ["baseball_bat"] });
  const before = c.v.diamonds;
  t.skip();
  assert.equal(c.v.diamonds - before, T.STARTER.diamonds - T.GRANT_DIAMONDS, "no second lot of diamonds");
  assert.equal(game.tutorial.granted.diamonds, T.STARTER.diamonds);
});

test("replay is only offered once the flow is over", () => {
  const { t } = flow();
  assert.equal(t.replay(), false, "not while the first run is on");
  t.skip();
  assert.equal(t.replay(), true);
  assert.equal(t.replay(), false, "not twice at once");
});

function replayed(over) {
  const r = flow(over);
  r.t.skip();
  r.c.grants.length = 0; r.c.resumed = 0; r.c.boards = 0;
  r.t.replay();
  return r;
}

test("a replay opens nothing new and locks nothing: every tab stays open, the board keeps running", () => {
  const { t, c } = replayed();
  assert.equal(c.replays, 1, "the page is told, to clear the lathe for it");
  assert.equal(id(t), "cut");
  assert.equal(t.isReplay(), true);
  for (const tab of T.TABS) assert.equal(t.unlocked(tab), true, tab);
  assert.equal(t.boardPaused(), false);
  assert.equal(t.guidedBoard(), false, "the board keeps its usual buttons");
});

test("a replay hands nothing out, start to finish, and a skip during it pays nothing", () => {
  const { c, t, game } = replayed({ coins: 7, diamonds: 0 });
  const wallet = () => [c.v.coins, c.v.diamonds];
  const w0 = wallet(), logs0 = c.logs.pine;
  const at = (want) => { t.check(); assert.equal(id(t), want); };
  c.v.removed = 1; at("pick_sand");
  c.v.tip = "sand"; c.v.smoothHere = 0.7; at("to_paint");   // the sand steps run as normal
  c.v.mode = "paint"; c.v.coverage = 1; at("to_finish");
  c.v.mode = "finish"; c.v.sheenRank = 1; at("keep");
  c.v.doneTaps++; at("to_orders");
  assert.equal(c.boards, 0, "no first board is posted");
  c.v.screen = "orders"; at("take");
  c.v.activeWood = "walnut"; c.v.screen = "lathe"; c.v.mode = "cut"; at("turn");   // any order will do
  c.logs.pine = 0; t.check();
  assert.equal(c.logs.pine, 0, "no free pine log in a replay");
  c.v.mode = "finish"; at("deliver");
  c.v.doneTaps++; at("to_farm");                     // DONE on a practice piece is enough
  c.v.screen = "farm"; at("plot");
  c.v.selectedEmpty = true; at("plant");
  c.planted.pine = 1; at("speed");                   // any wood
  assert.deepEqual(wallet(), w0, "no coins for the seed and no diamonds to speed it up");
  c.grown.pine = 1; at("harvest");
  c.v.screen = "harvest"; c.v.harvestPhase = "saw"; t.check();
  c.v.screen = "lathe"; at("oak_order");
  assert.equal(t.current().dismiss, true, "the blank card is just to read");
  c.owned.add("baseball_bat");                       // a replayer has the bat (they bought it, or skipped)
  t.dismiss(); at("take_bat");                       // no order posted, no log, and buy_bat is passed
  assert.equal(c.posted.length, 0, "no bat order in a replay");
  c.v.screen = "lathe"; c.v.activeKind = "chair_leg"; at("wrap");   // any order counts
  assert.equal(t.current().dismiss, true);
  t.dismiss();
  assert.equal(t.done, true);
  assert.deepEqual(wallet(), w0);
  assert.equal(c.grants.length, 0);
  assert.equal(c.logs.pine, 0);
  assert.equal(game.tutorial.replay, false);
  // and a skip part way through a second replay pays nothing either
  t.replay(); t.skip();
  assert.equal(c.grants.length, 0);
  assert.equal(t.done, true);
});

test("a replay waits for a tree to grow on its own when there are no diamonds", () => {
  const { c, t, game } = replayed();
  game.tutorial.step = "speed"; game.tutorial.base = {};
  c.planted.oak = 1; t.check();
  assert.equal(id(t), "speed");
  c.grown.oak = 1; t.check();
  assert.equal(id(t), "harvest");
});

test("a full farm in a replay moves past planting", () => {
  const { c, t, game } = replayed({ emptyPlots: 0 });
  game.tutorial.step = "plot";
  t.check();
  assert.equal(id(t), "speed");
});

test("a replay in progress survives a reload, still a replay", () => {
  const { t, game } = replayed();
  const back = T.createTutorial(JSON.parse(JSON.stringify(game)), { ctx: fakeCtx().ctx });
  assert.equal(back.isReplay(), true);
  assert.equal(back.unlocked("mine"), true);
  assert.equal(T.normalize({ done: true, replay: true }).replay, false, "a finished flow is never a replay");
});

test("every replay override's copy has no em dash", () => {
  T.STEPS.forEach((s) => { if (s.replay) assert.ok(!/\u2014/.test((s.replay.title || "") + (s.replay.text || "")), s.id); });
});

test("the practice piece's spec wants satin, so the player has to spray", () => {
  const P = require("../src/js/paint.js");
  assert.equal(P.validSpec(T.PRACTICE_SPEC), true);
  assert.equal(T.PRACTICE_SPEC.sheen, "satin");
  assert.ok(T.FIRST_BOARD.every((o) => o.sheen !== "matte"), "and neither first order can be finished without spraying");
});

// ---------- undo on the lathe takes off one layer ----------
test("clearing the finish leaves the paint; clearing the paint takes the finish with it", () => {
  const P = require("../src/js/paint.js");
  const c = new P.Coating();
  for (let k = 0; k < 30; k++) { c.brush(0.5, 1, "brush", "cobalt", 1 / 30); c.spray(0.5, 1, 1 / 30); }
  const coat = Array.from(c.coat), color = Array.from(c.color);
  assert.ok(c.avgGloss() > 0 && c.coverage() > 0);
  const v = c.version;
  c.clearFinish();
  assert.equal(c.avgGloss(), 0);
  assert.deepEqual(Array.from(c.coat), coat, "the paint stays");
  assert.deepEqual(Array.from(c.color), color);
  assert.ok(c.version > v, "the views redraw");
  c.spray(0.5, 1, 0.5);
  c.clearPaint();
  assert.equal(c.coverage(), 0);
  assert.equal(c.avgGloss(), 0, "and the finish on top of it");
});

// ---------- the bat step's gifts: each paid once ever ----------
function atBat(over) {
  const r = flow(over);
  r.game.tutorial.step = "oak_order"; r.c.v.delivered = 2; r.c.v.coins = 40;
  r.t.check();
  return r;
}
const sumOf = (c, k) => c.grants.reduce((a, g) => a + (g[k] || 0), 0);
test("the bat log, the 100 coins and the bonus are each paid once, across rescues, reloads and steps run again", () => {
  const { c, t, game, ctx } = atBat();
  assert.equal(id(t), "bat_order");
  c.v.screen = "shop"; t.check();
  assert.equal(id(t), "buy_bat");
  const logGrants = () => c.grants.filter((g) => g.logs && g.note && /neighbour/.test(g.note)).length;
  assert.equal(logGrants(), 1);
  assert.equal(sumOf(c, "coins"), T.BAT_COINS);
  // the step runs again (sent back, or a reload landing on it): nothing new
  game.tutorial.step = "bat_order"; c.v.screen = "lathe"; t.check();
  c.v.screen = "shop"; t.check();
  const saved = JSON.parse(JSON.stringify(game));
  const reload = T.createTutorial(saved, { ctx });
  reload.check();
  assert.equal(logGrants(), 1, "the gifted log once");
  assert.equal(sumOf(c, "coins"), T.BAT_COINS, "the 100 coins once");
  c.owned.add("baseball_bat"); c.v.screen = "lathe"; c.v.activeKind = "baseball_bat"; reload.check();
  assert.equal(id(reload), "wrap");
  const g2 = JSON.parse(JSON.stringify(saved));
  g2.tutorial.step = "take_bat";
  const again = T.createTutorial(g2, { ctx }); again.check();
  assert.equal(sumOf(c, "coins"), T.BAT_COINS + T.BONUS.coins, "the bonus once, even reloaded onto the step before it");
  assert.equal(sumOf(c, "diamonds"), T.BONUS.diamonds);
  assert.deepEqual([g2.tutorial.granted.batLog, g2.tutorial.granted.bat, g2.tutorial.granted.bonus], [true, true, true]);
});

test("the bat order is posted once, and shows locked until the blueprint is bought", () => {
  const { c, t, game } = atBat();
  assert.equal(c.posted.length, 1);
  game.tutorial.step = "to_farm"; t.check(); game.tutorial.step = "oak_order"; t.check();
  assert.equal(c.posted.length, 1, "an order already on the board is not posted again");
  // the commissions model: an authored bat order sits on the board, and accept refuses it until bought
  const game2 = S.newGame(); game2.wallet.coins = 100;
  const st = St.createState(game2);
  const b = C.createBoard(game2, { state: st, paused: () => true });
  const [o] = b.postAuthored([T.BAT_ORDER]);
  assert.equal(b.accept(o.id).reason, "no blueprint");
  assert.ok(b.buyBlueprint("baseball_bat").ok);
  assert.ok(b.accept(o.id).ok);
});

test("the gifted pine went into a rejected piece: a neighbour drops off another", () => {
  const { c, t } = atBat();
  c.logs.pine = 0; c.v.screen = "shop"; t.check();
  assert.equal(c.logs.pine, 1);
  t.check();
  assert.equal(c.logs.pine, 1, "only when there is none");
});

test("the tutorial ends at roughly 150 to 240 coins, before the bat job pays", () => {
  // the flow ends at 0 to 90 coins before the bat; the 100 coins net to zero against the blueprint
  for (const before of [0, 90]) {
    const end = before + T.BAT_COINS - C.PIECES.baseball_bat.price + T.BONUS.coins;
    assert.ok(end >= 150 && end <= 240, "ends at " + end);
  }
  assert.equal(T.BAT_COINS, C.PIECES.baseball_bat.price, "the gift buys exactly the blueprint");
  assert.equal(T.GRANT_DIAMONDS, 10);
  assert.deepEqual(T.STARTER, { coins: 250, diamonds: 10, blueprints: ["baseball_bat"] });
});

test("the speed-up copy follows the diamonds it grants", () => {
  assert.match(T.BY_ID.speed.text, new RegExp("Here are " + T.GRANT_DIAMONDS + " diamonds"));
  assert.match(T.BY_ID.sand.text, /SMOOTH reads 60%/);
  assert.match(T.BY_ID.buy_bat.text, /100 coins/);
});

// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { playedGame } = require("./helpers.js");
const C = require("../src/js/commissions.js");
const P = require("../src/js/paint.js");
const Cut = require("../src/js/cutting.js");
const St = require("../src/js/state.js");
const Save = require("../src/js/save.js");

const MIN = 60 * 1000, SEG = Cut.CFG.SEG, R0 = Cut.CFG.R0;

function setup(opts) {
  opts = opts || {};
  let t = opts.t0 || 1_000_000;
  const game = opts.game || playedGame();
  let unlocked = !!opts.unlocked;
  const state = St.createState(game, { now: () => t });
  let seed = 42;
  const board = C.createBoard(game, {
    state, now: () => t, timersOff: () => unlocked,
    random: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  });
  return { game, state, board, advance: (ms) => { t += ms; }, now: () => t, unlock: () => { unlocked = true; } };
}
/* A piece that is the target exactly, painted exactly to spec. */
function perfectPiece(order) {
  const target = C.targetProfile(order), coat = new P.Coating();
  for (let i = 0; i < SEG; i++) {
    const want = P.targetAt(order.spec, i / (SEG - 1), P.CFG.WOOD_RGB);
    const seg = order.spec.segments.find((s) => i / (SEG - 1) >= s.a && i / (SEG - 1) <= s.b);
    if (seg && seg.paint) { coat.coat[i] = 1; coat.color.set(want, i * 3); }
    coat.gloss[i] = P.SHEEN[order.spec.sheen].gloss;
  }
  // sanded to glass: a perfect piece is smooth too
  return { wood: order.wood, profile: St.pack(target), start: St.pack(new Float32Array(SEG).fill(R0)), coat: { coat: St.pack(coat.coat, 3), color: St.pack(coat.color, 3), gloss: St.pack(coat.gloss, 3) }, rough: St.pack(new Float32Array(SEG).fill(0.05), 3) };
}
function blankPiece(wood) {
  const r = new Float32Array(SEG).fill(R0 * 0.98);
  return { wood, profile: St.pack(r), start: St.pack(new Float32Array(SEG).fill(R0)), coat: null };
}

/* ---------------- target shapes ---------------- */

test("every kind of piece has a target shape that fits any blank and is not too thin to hold", () => {
  for (const kind of C.PIECE_ORDER) for (const seed of [1, 7, 99, 12345, 4000000000]) {
    const t = C.targetProfile(C.makeOrder(seed, { kind }));
    assert.equal(t.length, SEG);
    for (let i = 0; i < SEG; i++) {
      assert.ok(t[i] <= R0 * C.CFG.R_MAX + 1e-6 && t[i] >= R0 * C.CFG.R_MIN - 1e-6, kind + " seed " + seed + " slice " + i + ": " + t[i]);
    }
  }
});

test("a target shape is smooth enough to turn: no cliffs between neighbouring slices", () => {
  for (const kind of C.PIECE_ORDER) {
    const t = C.targetProfile(C.makeOrder(5, { kind }));
    let worst = 0;
    for (let i = 1; i < SEG; i++) worst = Math.max(worst, Math.abs(t[i] - t[i - 1]));
    assert.ok(worst < R0 * 0.05, kind + ": step of " + (worst / R0).toFixed(3) + " R0");
  }
});

test("the kinds look like what they are", () => {
  const at = (t, x) => t[Math.round(x * (SEG - 1))] / R0;
  const pin = C.targetProfile(C.makeOrder(3, { kind: "rolling_pin" }));
  assert.ok(at(pin, 0.5) > at(pin, 0.06) + 0.2 && at(pin, 0.5) > at(pin, 0.94) + 0.2, "a rolling pin has slim handles at both ends");
  const bat = C.targetProfile(C.makeOrder(3, { kind: "baseball_bat" }));
  const thick = Math.max(at(bat, 0.8), at(bat, 0.2)), thin = Math.min(at(bat, 0.8), at(bat, 0.2));
  assert.ok(thick > thin + 0.2, "a bat is much thicker at the barrel than the handle");
  const spindle = C.targetProfile(C.makeOrder(3, { kind: "spindle" }));
  let turns = 0;
  for (let i = 40; i < SEG - 40; i++) if ((spindle[i] - spindle[i - 1]) * (spindle[i + 1] - spindle[i]) < 0) turns++;
  assert.ok(turns >= 4, "a spindle has beads and coves (" + turns + " turns)");
});

test("same seed, same order; different seeds, different orders", () => {
  assert.deepEqual(C.makeOrder(77), C.makeOrder(77));
  const a = C.targetProfile(C.makeOrder(77)), b = C.targetProfile(C.makeOrder(77));
  assert.deepEqual(Array.from(a), Array.from(b));
  const kinds = new Set(), woods = new Set();
  for (let s = 1; s < 200; s++) { const o = C.makeOrder(s * 7919); kinds.add(o.kind); woods.add(o.wood); assert.ok(P.validSpec(o.spec)); }
  assert.equal(kinds.size, C.PIECE_ORDER.length, "every kind turns up");
  assert.equal(woods.size, 3, "every wood turns up");
});

test("finer wood pays more for the same piece", () => {
  const p = C.makeOrder(1, { kind: "chair_leg", wood: "pine" }).reward;
  const o = C.makeOrder(1, { kind: "chair_leg", wood: "oak" }).reward;
  const w = C.makeOrder(1, { kind: "chair_leg", wood: "walnut" }).reward;
  assert.ok(p < o && o < w, `pine ${p}, oak ${o}, walnut ${w}`);
});

/* ---------------- grading ---------------- */

test("a perfect piece scores full marks and earns the whole reward plus the bonus", () => {
  for (const kind of C.PIECE_ORDER) {
    const o = C.makeOrder(11, { kind });
    const g = C.grade(o, perfectPiece(o));
    assert.ok(g.shape > 0.99, kind + " shape " + g.shape);
    assert.ok(g.paint > 0.95, kind + " paint " + g.paint);
    assert.equal(g.smooth, 1, kind + " smooth " + g.smooth);
    assert.ok(g.total > 0.95 && g.stars === 3, kind + " total " + g.total);
    assert.equal(g.pay, Math.round(o.reward * (1 + C.CFG.BONUS)));
    assert.ok(g.accepted && g.bonus);
  }
});

test("an untouched blank scores nothing for shape, and the customer turns it down", () => {
  const o = C.makeOrder(11, { kind: "rolling_pin" });
  const g = C.grade(o, blankPiece(o.wood));
  assert.ok(g.shape < 0.05, "shape " + g.shape);
  assert.ok(g.stars === 0);
  assert.equal(g.accepted, false);
  assert.equal(g.pay, 0, "a turned-down piece pays nothing");
});

test("the closer the shape, the higher the grade", () => {
  const o = C.makeOrder(21, { kind: "baseball_bat" });
  const base = perfectPiece(o), target = C.targetProfile(o);
  let last = 2;
  for (const off of [0, 0.03, 0.08, 0.15, 0.3, 1]) {           // the last is the uncut stock
    const prof = Array.from(target, (v) => Math.min(R0, v + off * R0));
    const g = C.grade(o, Object.assign({}, base, { profile: prof }));
    assert.ok(g.shape <= last + 1e-9, "offset " + off + " scored " + g.shape + " after " + last);
    last = g.shape;
  }
  assert.ok(last < 0.05, "uncut stock scores nothing: " + last);
});

test("every pass toward the line shows in the shape score, and cutting past it costs", () => {
  const o = C.makeOrder(8, { kind: "walking_stick" }), target = C.targetProfile(o);
  const start = new Float32Array(SEG).fill(R0);
  const part = (f) => Array.from(target, (v, i) => start[i] + (v - start[i]) * f);   // f of the way from stock to target
  const s = [0, 0.25, 0.5, 0.75, 1].map((f) => C.shapeScore(part(f), target, start).score);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1] + 0.05, "progress shows: " + s.map((v) => v.toFixed(2)));
  assert.ok(s[1] > 0.05, "a quarter of the way already scores something: " + s[1].toFixed(2));
  const over = C.shapeScore(part(1.4), target, start).score;
  assert.ok(over < s[4] - 0.2, "cutting well past the line costs: " + over.toFixed(2));
});

test("where the stock was already thinner than the target, the stock is the target", () => {
  const o = C.makeOrder(21, { kind: "rolling_pin" });
  const target = C.targetProfile(o);
  const start = Array.from(target, (v) => v * 0.9);            // a thin blank: every slice under the target
  const g = C.grade(o, Object.assign(perfectPiece(o), { profile: start, start }));
  assert.ok(g.shape > 0.99, "nothing more could be done: " + g.shape);
});

test("the wrong wood cannot be paid for", () => {
  const o = C.makeOrder(11, { kind: "spindle", wood: "oak" });
  const g = C.grade(o, Object.assign(perfectPiece(o), { wood: "pine" }));
  assert.equal(g.woodOk, false);
  assert.equal(g.pay, 0);
});

test("paint and sheen count: right shape, bare wood, earns less than right shape, right paint", () => {
  const o = C.makeOrder(31, { kind: "chair_leg" });
  o.spec = P.generateSpec(5, { kind: "solid", sheen: "gloss" });
  const good = C.grade(o, perfectPiece(o));
  const bare = C.grade(o, Object.assign(perfectPiece(o), { coat: null }));
  assert.ok(bare.total < good.total - 0.3 && bare.pay < good.pay, `bare ${bare.total} vs painted ${good.total}`);
});

/* ---------------- the board ---------------- */

test("a new board is full, and its first order is a pine one a new player can take", () => {
  const { board } = setup();
  assert.equal(board.state.orders.length, C.CFG.BOARD_SIZE);
  assert.equal(board.state.orders[0].wood, "pine");
  const ids = board.state.orders.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
});

test("declining an order frees a slot that fills after NEW_ORDER_MS, even with the game closed", () => {
  const s = setup();
  const id = s.board.state.orders[1].id;
  assert.ok(s.board.decline(id).ok);
  assert.equal(s.board.state.orders.length, C.CFG.BOARD_SIZE - 1);
  s.advance(C.CFG.NEW_ORDER_MS - 1000); s.board.refill();
  assert.equal(s.board.state.orders.length, C.CFG.BOARD_SIZE - 1, "not yet");
  // reload from the save, as if the game was closed and opened again
  const game2 = JSON.parse(JSON.stringify(s.game));
  s.advance(2000);
  const state2 = St.createState(game2, { now: s.now });
  const b2 = C.createBoard(game2, { state: state2, now: s.now });
  assert.equal(b2.state.orders.length, C.CFG.BOARD_SIZE, "the new order arrived while away");
  assert.ok(!b2.state.orders.some((o) => o.id === id), "the declined one is gone");
});

test("a long time away fills every empty slot, but a full board does not bank orders", () => {
  const s = setup();
  s.board.decline(s.board.state.orders[0].id);
  s.board.decline(s.board.state.orders[0].id);
  s.advance(10 * C.CFG.NEW_ORDER_MS);
  s.board.refill();
  assert.equal(s.board.state.orders.length, C.CFG.BOARD_SIZE);
  // a full board, long left alone: freeing a slot still takes the full wait
  s.advance(10 * C.CFG.NEW_ORDER_MS);
  s.board.decline(s.board.state.orders[0].id);
  s.board.refill();
  assert.equal(s.board.state.orders.length, C.CFG.BOARD_SIZE - 1);
  assert.ok(s.board.msUntilNext() > C.CFG.NEW_ORDER_MS - 1000);
});

test("with the full unlock, a freed slot fills at once", () => {
  const s = setup(); s.unlock();
  s.board.decline(s.board.state.orders[0].id);
  s.board.refill();
  assert.equal(s.board.state.orders.length, C.CFG.BOARD_SIZE);
});

test("accepting makes an order active; declining the active one clears it", () => {
  const { board } = setup();
  const o = board.state.orders[2];
  assert.ok(board.accept(o.id).ok);
  assert.equal(board.active().id, o.id);
  board.decline(o.id);
  assert.equal(board.active(), null);
  assert.equal(board.accept(9999).ok, false);
});

test("delivering pays coins, takes the piece from the shed, and clears the order", () => {
  const s = setup();
  const o = s.board.state.orders[0];
  s.board.accept(o.id);
  const piece = s.state.inventory.add("piece", Object.assign({ shape: "Cylinder", from: "log" }, perfectPiece(o)));
  const wrong = s.state.inventory.add("piece", Object.assign({ shape: "Cylinder", from: "log" }, perfectPiece(o), { wood: o.wood === "oak" ? "pine" : "oak" }));
  assert.deepEqual(s.board.candidates(o.id).map((p) => p.id), [piece.id], "only pieces of the right wood can go");
  const before = s.state.wallet.balance("coins");
  const bad = s.board.deliver(o.id, wrong.id);
  assert.equal(bad.ok, false); assert.equal(bad.reason, "wrong wood");
  assert.ok(s.state.inventory.get(wrong.id), "a refused piece stays in the shed");
  const r = s.board.deliver(o.id, piece.id);
  assert.ok(r.ok);
  assert.equal(s.state.wallet.balance("coins"), before + Math.round(o.reward * (1 + C.CFG.BONUS)));
  assert.equal(s.state.inventory.get(piece.id), null);
  assert.equal(s.board.get(o.id), null);
  assert.equal(s.board.active(), null);
  assert.equal(s.board.state.done, 1);
  assert.equal(s.board.state.history.at(-1).stars, 3);
  assert.equal(s.board.deliver(o.id, wrong.id).ok, false, "a delivered order is gone");
});

test("a broken commissions section in a save is repaired, not trusted", () => {
  const game = playedGame();
  game.commissions = { orders: [{ id: 3, kind: "spoon", wood: "pine" }, null, { id: 4, kind: "rolling_pin", wood: "elm", spec: {}, reward: 5 }], active: 3, nextId: "x", history: "no" };
  const s = setup({ game });
  assert.equal(s.board.state.active, null);
  assert.ok(s.board.state.orders.every((o) => C.PIECES[o.kind] && P.validSpec(o.spec)));
  assert.ok(Array.isArray(s.board.state.history));
});

test("the board section survives a save round trip", () => {
  const s = setup();
  s.board.accept(s.board.state.orders[1].id);
  const store = Save.memoryStore();
  Save.write(store, s.game);
  const game2 = Save.load(store);
  const b2 = C.createBoard(game2, { state: St.createState(game2, { now: s.now }), now: s.now });
  assert.deepEqual(b2.state.orders, s.board.state.orders);
  assert.equal(b2.active().id, s.board.state.orders[1].id);
});

test("pay follows the spec: nothing below PASS, rising to all of it at FULL, a bonus above", () => {
  const r = 100, { PASS, FULL, MIN_PAY, BONUS } = C.CFG;
  assert.equal(C.payFor(r, PASS - 0.01), 0);
  assert.equal(C.payFor(r, PASS), Math.round(r * MIN_PAY));
  assert.equal(C.payFor(r, FULL), Math.round(r * (1 + BONUS)));
  assert.equal(C.payFor(r, 1), Math.round(r * (1 + BONUS)));
  let last = -1;
  for (let g = PASS; g < FULL; g += 0.02) { const p = C.payFor(r, g); assert.ok(p >= last, "pay never drops as the grade rises"); last = p; }
  assert.ok(C.payFor(r, FULL - 0.001) <= r, "just under FULL pays at most the reward");
});

test("a piece the customer turns down stays in the shed and the order stays open", () => {
  const s = setup();
  const o = s.board.state.orders[0];
  const piece = s.state.inventory.add("piece", Object.assign({ shape: "Cylinder", from: "log" }, blankPiece(o.wood)));
  const coins = s.state.wallet.balance("coins");
  const r = s.board.deliver(o.id, piece.id);
  assert.equal(r.ok, false); assert.equal(r.reason, "rejected");
  assert.ok(s.state.inventory.get(piece.id), "the piece is kept");
  assert.ok(s.board.get(o.id), "the order is still on the board");
  assert.equal(s.state.wallet.balance("coins"), coins, "no coins");
});

test("an empty slot can be filled now for a diamond, or waits NEW_ORDER_MS", () => {
  const s = setup();
  assert.equal(C.CFG.NEW_ORDER_MS, 3 * MIN);
  assert.equal(s.board.rushNext().reason, "board is full");
  s.board.decline(s.board.state.orders[0].id);
  const d = s.state.wallet.balance("diamonds");
  const r = s.board.rushNext();
  assert.ok(r.ok && r.order);
  assert.equal(s.board.state.orders.length, C.CFG.BOARD_SIZE);
  assert.equal(s.state.wallet.balance("diamonds"), d - C.CFG.RUSH_DIAMONDS);
  s.board.decline(s.board.state.orders[0].id);
  s.state.wallet.spend("diamonds", s.state.wallet.balance("diamonds"));
  assert.equal(s.board.rushNext().reason, "not enough diamonds");
});

/* ---------------- smoothness ---------------- */

test("the grade weights add up to 1: shape 0.55, paint 0.31, sheen 0.08, smoothness 0.06", () => {
  const W = C.CFG;
  assert.deepEqual([W.W_SHAPE, W.W_PAINT, W.W_SHEEN, W.W_SMOOTH], [0.55, 0.31, 0.08, 0.06]);
  assert.ok(Math.abs(W.W_SHAPE + W.W_PAINT + W.W_SHEEN + W.W_SMOOTH - 1) < 1e-9);
});

test("smoothness: rough-sawn scores nothing, skew-finished about half, sanded fine gets it all", () => {
  const at = (v) => C.smoothScore(new Float32Array(SEG).fill(v)).score;
  assert.equal(at(1), 0);
  assert.equal(C.smoothScore(null).score, 0, "no roughness saved reads as rough-sawn");
  assert.ok(at(Cut.TIPS.gouge.finish) < 0.15, "gouge marks earn little: " + at(Cut.TIPS.gouge.finish));
  const skew = at(Cut.TIPS.skew.finish);
  assert.ok(skew > 0.35 && skew < 0.6, "a skew finish earns part of it: " + skew);
  assert.equal(at(0.05), 1);
  // a smoother piece grades higher, all else equal
  const o = C.makeOrder(11, { kind: "rolling_pin" }), p = perfectPiece(o);
  const rough = C.grade(o, Object.assign({}, p, { rough: St.pack(new Float32Array(SEG).fill(0.55), 3) }));
  const smooth = C.grade(o, p);
  assert.ok(Math.abs(smooth.total - rough.total - C.CFG.W_SMOOTH * (smooth.smooth - rough.smooth)) < 1e-9);
  assert.ok(smooth.total > rough.total);
});

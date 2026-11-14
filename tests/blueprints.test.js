// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { playedGame } = require("./helpers.js");
const C = require("../src/js/commissions.js");
const Art = require("../src/js/blueprint-art.js");
const St = require("../src/js/state.js");
const Save = require("../src/js/save.js");

function setup(coins, game) {
  let t = 1_000_000;
  game = game || playedGame();
  if (coins != null) game.wallet.coins = coins;
  const state = St.createState(game, { now: () => t });
  let seed = 42;
  const board = C.createBoard(game, {
    state, now: () => t, timersOff: () => false,
    random: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  });
  return { game, state, board, advance: (ms) => { t += ms; }, now: () => t };
}
/* Turn the board over many times: decline everything and let new orders come in. */
function churn(s, rounds) {
  const kinds = new Set();
  for (let i = 0; i < rounds; i++) {
    s.board.state.orders.slice().forEach((o) => { kinds.add(o.kind); s.board.decline(o.id); });
    s.advance(4 * C.CFG.NEW_ORDER_MS); s.board.refill();
  }
  s.board.state.orders.forEach((o) => kinds.add(o.kind));
  return kinds;
}

test("prices and pay match the plan, and only the rolling pin is free", () => {
  const want = { rolling_pin: [0, 40], baseball_bat: [100, 70], walking_stick: [250, 90], chair_leg: [600, 140], spindle: [1500, 240] };
  for (const k of C.PIECE_ORDER) assert.deepEqual([C.PIECES[k].price, C.PIECES[k].base], want[k], k);
  assert.deepEqual(C.FREE_BLUEPRINTS, ["rolling_pin"]);
  assert.deepEqual(C.BLUEPRINT_ORDER, ["rolling_pin", "baseball_bat", "walking_stick", "chair_leg", "spindle"], "cheapest first");
});

test("a new board owns only the free blueprints and never rolls an unowned kind", () => {
  const s = setup();
  assert.deepEqual(s.board.state.blueprints, ["rolling_pin"]);
  assert.ok(s.board.ownsBlueprint("rolling_pin") && !s.board.ownsBlueprint("spindle"));
  const kinds = churn(s, 40);
  assert.deepEqual([...kinds], ["rolling_pin"]);
});

test("makeOrder rolls only from opts.kinds, and opts.kind still forces a piece", () => {
  for (let seed = 1; seed < 300; seed++) {
    const o = C.makeOrder(seed * 7919, { kinds: ["walking_stick", "chair_leg"] });
    assert.ok(o.kind === "walking_stick" || o.kind === "chair_leg", o.kind);
  }
  assert.equal(C.makeOrder(5, { kinds: ["rolling_pin"], kind: "spindle" }).kind, "spindle");
  // forcing a kind draws the same client and spec as before blueprints existed
  const a = C.makeOrder(1101, { kind: "rolling_pin", wood: "pine" }), b = C.makeOrder(1101, { kind: "rolling_pin", wood: "pine", kinds: ["rolling_pin"] });
  assert.deepEqual(a, b);
});

test("buying a blueprint spends the coins and adds the piece to the roll", () => {
  const s = setup(300);
  const r = s.board.buyBlueprint("baseball_bat");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(s.state.wallet.balance("coins"), 200);
  assert.ok(s.board.ownsBlueprint("baseball_bat"));
  assert.deepEqual(s.board.buyBlueprint("baseball_bat"), { ok: false, reason: "owned" });
  const kinds = churn(s, 40);
  assert.ok(kinds.has("baseball_bat") && kinds.has("rolling_pin"));
  assert.ok(!kinds.has("spindle") && !kinds.has("walking_stick") && !kinds.has("chair_leg"));
});

test("not enough coins: no blueprint and no coins taken", () => {
  const s = setup(80);
  const r = s.board.buyBlueprint("baseball_bat");
  assert.equal(r.ok, false); assert.equal(r.reason, "not enough coins"); assert.equal(r.need, 100); assert.equal(r.have, 80);
  assert.equal(s.state.wallet.balance("coins"), 80);
  assert.ok(!s.board.ownsBlueprint("baseball_bat"));
  assert.equal(s.board.buyBlueprint("spoon").ok, false);
});

test("blueprints can be bought in any order, and the teaser is the cheapest one not owned", () => {
  const s = setup(5000);
  assert.equal(s.board.teaser(), "baseball_bat");
  assert.ok(s.board.buyBlueprint("chair_leg").ok, "not a ladder");
  assert.equal(s.board.teaser(), "baseball_bat");
  s.board.buyBlueprint("baseball_bat");
  assert.equal(s.board.teaser(), "walking_stick");
  s.board.buyBlueprint("walking_stick"); s.board.buyBlueprint("spindle");
  assert.equal(s.board.teaser(), null, "all owned: nothing to tease");
  assert.equal(s.board.state.orders.length, C.CFG.BOARD_SIZE, "the teaser takes no slot");
});

test("an authored order for an unowned piece sits on the board locked, and buying unlocks it in place", () => {
  const s = setup(150);
  s.board.decline(s.board.state.orders[0].id);
  const [o] = s.board.postAuthored([{ seed: 77, wood: "pine", kind: "baseball_bat", client: "Coach Barrow" }]);
  assert.equal(o.kind, "baseball_bat");
  assert.ok(s.board.locked(o));
  const r = s.board.accept(o.id);
  assert.equal(r.ok, false); assert.equal(r.reason, "no blueprint");
  assert.equal(s.board.active(), null);
  s.board.buyBlueprint("baseball_bat");
  assert.ok(!s.board.locked(o));
  assert.ok(s.board.accept(o.id).ok);
  assert.equal(s.board.active().id, o.id);
});

test("owned blueprints survive a save round trip", () => {
  const s = setup(1000);
  s.board.buyBlueprint("walking_stick");
  const store = Save.memoryStore();
  Save.write(store, s.game);
  const game2 = Save.load(store);
  const b2 = C.createBoard(game2, { state: St.createState(game2), now: s.now });
  assert.deepEqual(b2.state.blueprints.slice().sort(), ["rolling_pin", "walking_stick"]);
});

test("grantBlueprint hands one over for nothing, once", () => {
  const s = setup(0);
  assert.equal(s.board.grantBlueprint("baseball_bat"), true);
  assert.equal(s.board.grantBlueprint("baseball_bat"), false);
  assert.ok(s.board.ownsBlueprint("baseball_bat"));
  assert.equal(s.state.wallet.balance("coins"), 0);
});

/* ---------------- the art ---------------- */
function wellFormed(svg) {
  // every tag closes: count opens and closes, self-closers aside
  const stack = [];
  const re = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(svg))) {
    if (m[1]) { assert.equal(stack.pop(), m[2], "closes " + m[2]); }
    else if (!m[4]) stack.push(m[2]);
  }
  assert.equal(stack.length, 0, "unclosed: " + stack.join(","));
}
test("blueprintSVG returns well-formed SVG for every piece, and nothing for an unknown one", () => {
  for (const k of C.PIECE_ORDER) {
    const svg = Art.blueprintSVG(k);
    assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"), k);
    assert.ok(!/NaN|undefined/.test(svg), k + " has no NaN");
    wellFormed(svg);
    assert.ok(svg.includes(C.PIECES[k].name.toUpperCase()), k + " title block names it");
    assert.ok(/\d+ mm/.test(svg) && svg.includes("Ø"), k + " has its dimensions");
    assert.ok(!svg.includes("OWNED"), "not stamped unless owned");
    wellFormed(Art.blueprintSVG(k, { owned: true, afford: false }));
    assert.ok(Art.blueprintSVG(k, { owned: true }).includes("OWNED"));
  }
  assert.equal(Art.blueprintSVG("spoon"), "");
});

test("the drawing is the same every time, whatever orders the board has rolled", () => {
  assert.equal(Art.blueprintSVG("baseball_bat"), Art.blueprintSVG("baseball_bat"));
  assert.ok(/fill-opacity="0.4"/.test(Art.blueprintSVG("spindle", { afford: false })), "the price dims when it can't be afforded");
});

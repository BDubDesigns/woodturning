// The customers (clients.js) and how the board uses them (commissions.js): a new
// customer at every rank, leans, pay quirks, and the introduction's extra slot.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { playedGame } = require("./helpers.js");
const Cl = require("../src/js/clients.js");
const Pr = require("../src/js/progress.js");
const C = require("../src/js/commissions.js");
const P = require("../src/js/paint.js");
const Cut = require("../src/js/cutting.js");
const St = require("../src/js/state.js");
const Save = require("../src/js/save.js");

const SEG = Cut.CFG.SEG, R0 = Cut.CFG.R0, MIN = 60 * 1000;
const ALL = C.PIECE_ORDER.slice();

function setup(game) {
  game = game || playedGame();
  let t = 1_000_000, seed = 42;
  const state = St.createState(game, { now: () => t });
  const progress = Pr.createProgress(game);
  const board = C.createBoard(game, { state, progress, now: () => t, random: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; } });
  return { game, state, progress, board, advance: (ms) => { t += ms; } };
}
function perfectPiece(order) {
  const target = C.targetProfile(order), coat = new P.Coating();
  for (let i = 0; i < SEG; i++) {
    const want = P.targetAt(order.spec, i / (SEG - 1), P.CFG.WOOD_RGB);
    const seg = order.spec.segments.find((s) => i / (SEG - 1) >= s.a && i / (SEG - 1) <= s.b);
    if (seg && seg.paint) { coat.coat[i] = 1; coat.color.set(want, i * 3); }
    coat.gloss[i] = P.SHEEN[order.spec.sheen].gloss;
  }
  return { shape: "Test", wood: order.wood, profile: St.pack(target), start: St.pack(new Float32Array(SEG).fill(R0)), coat: { coat: St.pack(coat.coat, 3), color: St.pack(coat.color, 3), gloss: St.pack(coat.gloss, 3) }, rough: St.pack(new Float32Array(SEG).fill(0.05), 3) };
}
function deliver(s, o, piece) {
  o = o || s.board.state.orders.find((q) => !q.intro && s.board.ownsBlueprint(q.kind));
  const it = s.state.inventory.add("piece", piece || perfectPiece(o));
  return s.board.deliver(o.id, it.id);
}
/* Does an order follow every part of a customer's lean (for the pieces owned)? */
function follows(o, lean, owned) {
  if (lean.kinds && lean.kinds.some((k) => owned.includes(k)) && !lean.kinds.includes(o.kind)) return false;
  if (lean.woods && !lean.woods.includes(o.wood)) return false;
  if (lean.styles && !lean.styles.includes(o.spec.kind)) return false;
  if (lean.sheen && o.spec.sheen !== lean.sheen) return false;
  if (lean.colors && !P.specPaints(o.spec).every((c) => lean.colors.includes(c))) return false;
  return true;
}

/* ---------------- the data ---------------- */

test("one new customer for each rank from 2 to 12, as the issue lists them", () => {
  assert.deepEqual(Cl.BY_RANK.map((c) => [c.rank, c.name]), [
    [2, "Chef Basil Fury"], [3, "Big Paul"], [4, "Mr. Holmwood"], [5, "Kaylee Glow"], [6, "Little Jon of the Greenwood"], [7, "Doc Brightwood"],
    [8, "Bat Boy"], [9, "Count Oakula"], [10, "Chad Venture"], [11, "Don Pinoli"], [12, "The Grand Duchess"]]);
  assert.equal(Cl.forRank(1), null);
  for (const c of Cl.BY_RANK) {
    assert.ok(c.lines.length >= 3, c.name + " has a few lines");
    for (const k of c.lean.kinds || []) assert.ok(C.PIECES[k], c.name + " leans to a real piece");
    for (const col of c.lean.colors || []) assert.ok(P.PALETTE[col], c.name + " leans to a real colour");
  }
  // the sample lines from the issue
  assert.ok(Cl.get("Chef Basil Fury").lines.includes("Sand it properly or it's RAW!"));
  assert.ok(Cl.get("Bat Boy").lines.includes("The city needs a hero. The hero needs a bat. Make it black."));
  assert.ok(Cl.get("The Grand Duchess").lines.includes("For the east wing, naturally."));
  // the original 14 are still there
  assert.equal(Cl.EVERYDAY.length, 14);
});

test("nothing player-facing has an em dash, and never the trademarked name", () => {
  const text = JSON.stringify([Cl.BY_RANK.map((c) => [c.name, c.lines]), Cl.EVERYDAY]);
  assert.ok(!/—/.test(text));
  assert.ok(!/batman/i.test(JSON.stringify(Cl.BY_RANK)));
});

test("quirks: Basil +20% only at 3 stars, Chad +15%, Don +25%, the Duchess +30%", () => {
  assert.equal(Cl.quirkMult("Chef Basil Fury", 2), 1);
  assert.equal(Cl.quirkMult("Chef Basil Fury", 3), 1.2);
  assert.equal(Cl.quirkMult("Chad Venture", 1), 1.15);
  assert.equal(Cl.quirkMult("Don Pinoli", 1), 1.25);
  assert.equal(Cl.quirkMult("The Grand Duchess", 1), 1.3);
  assert.equal(Cl.quirkMult("Old Tom", 3), 1);
  assert.equal(Cl.quirkText("Chef Basil Fury"), "+20% at 3 stars");
  assert.equal(Cl.quirkText("Don Pinoli"), "+25%");
});

/* ---------------- leans ---------------- */

test("a customer's orders follow their lean about 70% of the time, over many seeds", () => {
  for (const c of Cl.BY_RANK) {
    let hit = 0;
    const n = 1500;
    for (let seed = 1; seed <= n; seed++) if (follows(C.makeOrder(seed * 7919, { client: c.name, owned: ALL, kinds: ALL }), c.lean, ALL)) hit++;
    const f = hit / n;
    assert.ok(f > 0.64 && f < 0.8, `${c.name} follows the lean ${(f * 100).toFixed(1)}% of the time`);
  }
});

test("a lean only picks pieces you own: leaning toward one you don't, they order one you do", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const o = C.makeOrder(seed, { client: "Big Paul", owned: ["rolling_pin"], kinds: ["rolling_pin"], lean: true });
    assert.equal(o.kind, "rolling_pin");
    assert.equal(o.wood, "pine");          // the rest of the lean still holds
    assert.equal(o.spec.kind, "solid");
  }
  // Count Oakula wants spindles; with a bat and a pin he orders one of those, in oxblood and ink
  for (let seed = 1; seed <= 300; seed++) {
    const o = C.makeOrder(seed, { client: "Count Oakula", owned: ["rolling_pin", "baseball_bat"], kinds: ["rolling_pin", "baseball_bat"], lean: true });
    assert.ok(["rolling_pin", "baseball_bat"].includes(o.kind));
    assert.equal(o.spec.sheen, "matte");
  }
});

test("Kaylee's pastels and Bat Boy's black come from their colour families", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const k = C.makeOrder(seed, { client: "Kaylee Glow", owned: ALL, lean: true });
    assert.equal(k.spec.kind, "twotone"); assert.equal(k.spec.sheen, "gloss");
    assert.ok(P.specPaints(k.spec).every((c) => ["blush", "mint", "sky", "lavender"].includes(c)), JSON.stringify(k.spec));
    const b = C.makeOrder(seed, { client: "Bat Boy", owned: ALL, lean: true });
    assert.equal(b.kind, "baseball_bat"); assert.equal(b.spec.sheen, "matte"); assert.deepEqual(P.specPaints(b.spec), ["ink"]);
  }
});

test("the everyday customers roll exactly as they did before, and only everyday colours", () => {
  const o = C.makeOrder(12345);
  assert.ok(Cl.EVERYDAY.includes(o.client));
  assert.equal(o.line, undefined);
  for (let seed = 1; seed <= 300; seed++) for (const c of P.specPaints(C.makeOrder(seed).spec)) assert.ok(P.PALETTE_ORDER.includes(c));
});

/* ---------------- introductions ---------------- */

test("the first delivery reaches rank 2, and Chef Basil Fury's introduction goes up on a full board", () => {
  const s = setup();
  assert.equal(s.board.state.orders.length, 3);
  const r = deliver(s);
  assert.equal(r.intros.length, 1);
  const intro = r.intros[0];
  assert.equal(intro.client, "Chef Basil Fury"); assert.equal(intro.intro, true); assert.equal(intro.kind, "rolling_pin");
  assert.ok(Cl.get("Chef Basil Fury").lines.includes(intro.line));
  assert.equal(r.events.find((e) => e.type === "rank").client, "Chef Basil Fury");
  // the delivered order left a slot; with Basil's card the board is back to 3, and the slot still waits
  assert.equal(s.board.state.orders.length, 3);
  assert.equal(s.board.emptySlots(), 1);
  s.advance(C.CFG.NEW_ORDER_MS); s.board.refill();
  assert.equal(s.board.state.orders.length, 4, "a full board of three, plus the introduction");
  assert.equal(s.board.emptySlots(), 0);
});

test("each rank-up posts exactly that rank's customer, once", () => {
  const s = setup();
  for (let rank = 2; rank <= 12; rank++) {
    s.progress.state.totalStars = Pr.RANKS[rank - 1].stars - 1;
    s.progress.state.rankPaid = rank - 1;
    s.board.state.orders = s.board.state.orders.filter((o) => !o.intro);
    s.advance(C.CFG.NEW_ORDER_MS); s.board.refill();
    const r = deliver(s);
    assert.ok(r.ok);
    const ranks = r.events.filter((e) => e.type === "rank").map((e) => e.rank);
    assert.deepEqual(ranks, [rank]);
    assert.deepEqual(r.intros.map((o) => o.client), [Cl.forRank(rank).name], "rank " + rank);
  }
  // reaching a rank again (stars lost somehow) never brings the same customer twice
  assert.equal(s.board.introduce(2), null);
  assert.equal(s.board.state.introduced.length, 11);
});

test("several ranks at once introduce each customer, each as an extra card", () => {
  const s = setup();
  const before = s.board.state.orders.length;
  assert.equal(s.board.introduce(2).client, "Chef Basil Fury");
  assert.equal(s.board.introduce(3).client, "Big Paul");
  assert.equal(s.board.state.orders.length, before + 2);
  assert.equal(s.board.emptySlots(), 0);
  assert.equal(s.board.introduce(1), null, "rank 1 brings nobody");
});

test("the introduction's extra slot clears: declined or delivered, the board returns to its size", () => {
  const s = setup();
  deliver(s);
  s.advance(C.CFG.NEW_ORDER_MS); s.board.refill();
  const intro = s.board.state.orders.find((o) => o.intro);
  assert.equal(s.board.state.orders.length, 4);
  const next = s.board.state.nextAt;
  assert.ok(s.board.decline(intro.id).ok);
  assert.equal(s.board.state.orders.length, 3);
  assert.equal(s.board.state.nextAt, next, "declining an introduction starts no wait: it took no slot");
  s.advance(C.CFG.NEW_ORDER_MS * 3); s.board.refill();
  assert.equal(s.board.state.orders.length, 3, "and nothing fills its place");
  // delivered instead: the same
  const s2 = setup();
  deliver(s2);
  s2.advance(C.CFG.NEW_ORDER_MS); s2.board.refill();
  const in2 = s2.board.state.orders.find((o) => o.intro);
  const r = deliver(s2, in2);
  assert.ok(r.ok);
  assert.equal(s2.board.state.orders.length, 3);
  assert.equal(s2.board.emptySlots(), 0);
});

test("an introduction on a full board survives a save round trip", () => {
  const store = Save.memoryStore();
  const s = setup();
  deliver(s);
  s.advance(C.CFG.NEW_ORDER_MS); s.board.refill();
  Save.write(store, s.game);
  const s2 = setup(Save.load(store));
  assert.equal(s2.board.state.orders.length, 4);
  assert.equal(s2.board.state.orders.filter((o) => o.intro).length, 1);
  assert.deepEqual(s2.board.state.introduced, ["Chef Basil Fury"]);
});

test("after their introduction, a new customer joins the rotation; before their rank, never", () => {
  const s = setup();
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const o = s.board.state.orders[0]; s.board.decline(o.id); s.advance(C.CFG.NEW_ORDER_MS); s.board.refill(); s.board.state.orders.forEach((q) => seen.add(q.client)); }
  assert.ok(!Cl.BY_RANK.some((c) => seen.has(c.name)), "rank 1: only the everyday customers");
  deliver(s);
  seen.clear();
  for (let i = 0; i < 300; i++) { const o = s.board.state.orders.find((q) => !q.intro); s.board.decline(o.id); s.advance(C.CFG.NEW_ORDER_MS); s.board.refill(); s.board.state.orders.filter((q) => !q.intro).forEach((q) => seen.add(q.client)); }
  assert.ok(seen.has("Chef Basil Fury"), "rank 2: Basil turns up in the normal rotation");
  assert.ok(!seen.has("Big Paul"), "but not rank 3's customer");
});

/* ---------------- quirks on the board ---------------- */

test("quirks apply to the pay and multiply with mastery", () => {
  const s = setup();
  s.board.state.orders.push(Object.assign(C.makeOrder(77, { client: "Don Pinoli", kind: "rolling_pin", owned: ALL }), { id: 900 }));
  const don = s.board.get(900);
  s.progress.addStars(don.kind, 4);   // Practiced: x1.30
  const it = s.state.inventory.add("piece", perfectPiece(don));
  const g = s.board.preview(900, it.id);
  assert.equal(g.mult, 1.625);   // 1.30 x 1.25
  assert.equal(g.pay, Math.round(don.reward * 1.625 * (1 + C.CFG.BONUS)));
  assert.equal(s.board.rewardOf(don), Math.round(don.reward * 1.625));
  // Basil: +20% only on a 3-star piece
  s.board.state.orders.push(Object.assign(C.makeOrder(78, { client: "Chef Basil Fury", kind: "rolling_pin", owned: ALL }), { id: 901 }));
  const basil = s.board.get(901);
  const top = s.state.inventory.add("piece", perfectPiece(basil));
  const plain = s.state.inventory.add("piece", Object.assign(perfectPiece(basil), { coat: null }));
  const g3 = s.board.preview(901, top.id), g1 = s.board.preview(901, plain.id);
  assert.equal(g3.stars, 3); assert.equal(g3.mult, 1.56);   // 1.30 x 1.20
  assert.ok(g1.stars < 3); assert.equal(g1.mult, 1.3);
  assert.equal(s.board.rewardOf(basil), Math.round(basil.reward * 1.3), "the card's figure leaves out a quirk that needs stars");
});

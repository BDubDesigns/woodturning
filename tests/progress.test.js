// Mastery and rank (progress.js), and how deliveries feed them (commissions.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { playedGame } = require("./helpers.js");
const Pr = require("../src/js/progress.js");
const C = require("../src/js/commissions.js");
const P = require("../src/js/paint.js");
const Cut = require("../src/js/cutting.js");
const St = require("../src/js/state.js");
const Save = require("../src/js/save.js");

const SEG = Cut.CFG.SEG, R0 = Cut.CFG.R0;

function setup(game) {
  game = game || playedGame();
  let t = 1_000_000, seed = 42;
  const state = St.createState(game, { now: () => t });
  const progress = Pr.createProgress(game);
  const board = C.createBoard(game, {
    state, progress, now: () => t,
    random: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  });
  return { game, state, progress, board, advance: (ms) => { t += ms; } };
}
/* A piece that is the target exactly, painted to spec and sanded smooth: three stars. */
function perfectPiece(order) {
  const target = C.targetProfile(order), coat = new P.Coating();
  for (let i = 0; i < SEG; i++) {
    const want = P.targetAt(order.spec, i / (SEG - 1), P.CFG.WOOD_RGB);
    const seg = order.spec.segments.find((s) => i / (SEG - 1) >= s.a && i / (SEG - 1) <= s.b);
    if (seg && seg.paint) { coat.coat[i] = 1; coat.color.set(want, i * 3); }
    coat.gloss[i] = P.SHEEN[order.spec.sheen].gloss;
  }
  return { wood: order.wood, profile: St.pack(target), start: St.pack(new Float32Array(SEG).fill(R0)), coat: { coat: St.pack(coat.coat, 3), color: St.pack(coat.color, 3), gloss: St.pack(coat.gloss, 3) }, rough: St.pack(new Float32Array(SEG).fill(0.05), 3) };
}
/* The target shape on bare wood: accepted, but fewer stars. */
function plainPiece(order) {
  const p = perfectPiece(order);
  p.coat = null;
  return p;
}
function untouched(wood) {
  return { wood, profile: St.pack(new Float32Array(SEG).fill(R0 * 0.98)), start: St.pack(new Float32Array(SEG).fill(R0)), coat: null };
}
/* Put a piece in the shed for the first order on the board and deliver it. */
function deliverFirst(s, make) {
  const o = s.board.state.orders[0];
  const it = s.state.inventory.add("piece", Object.assign({ shape: "Test" }, (make || perfectPiece)(o)));
  return { order: o, result: s.board.deliver(o.id, it.id) };
}

/* ---------------- the tables ---------------- */

test("the mastery table matches issue #35: names, stars and +15% a tier", () => {
  const want = [["", 0, 1], ["Familiar", 1, 1.15], ["Practiced", 4, 1.3], ["Skilled", 9, 1.45], ["Expert", 15, 1.6], ["Renowned", 25, 1.75], ["Legendary", 50, 1.9]];
  assert.equal(Pr.MASTERY.length, want.length);
  want.forEach(([name, stars, mult], i) => {
    assert.equal(Pr.MASTERY[i].tier, i);
    assert.equal(Pr.MASTERY[i].name, name);
    assert.equal(Pr.MASTERY[i].stars, stars);
    assert.equal(Pr.MASTERY[i].mult, mult);
  });
});

test("the rank table matches issue #35: stars, titles and 3x diamonds, 50x coins", () => {
  const want = [[0, "Hobbyist"], [1, "Apprentice"], [8, "Journeyman"], [15, "Journeyman"], [25, "Craftsman"], [40, "Craftsman"], [60, "Craftsman"],
    [85, "Master Turner"], [120, "Master Turner"], [170, "Master Turner"], [240, "Guild Master"], [500, "Guild Master"]];
  assert.equal(Pr.RANKS.length, 12);
  let dia = 0, coins = 0;
  want.forEach(([stars, title], i) => {
    const r = Pr.RANKS[i];
    assert.equal(r.rank, i + 1); assert.equal(r.stars, stars); assert.equal(r.title, title);
    if (i === 0) assert.equal(r.reward, null);
    else { assert.deepEqual(r.reward, { diamonds: 3 * (i + 1), coins: 50 * (i + 1) }); dia += r.reward.diamonds; coins += r.reward.coins; }
  });
  assert.equal(Pr.RANKS[1].reward.diamonds, 6); assert.equal(Pr.RANKS[1].reward.coins, 100);
  assert.equal(Pr.RANKS[11].reward.diamonds, 36); assert.equal(Pr.RANKS[11].reward.coins, 600);
  // "about 231 diamonds and 3,850 coins across the ladder"
  assert.equal(dia, 231); assert.equal(coins, 3850);
});

test("masteryOf and rankOf say where you are and what is next", () => {
  const g = playedGame(), p = Pr.createProgress(g);
  let m = p.masteryOf("baseball_bat");
  assert.equal(m.tier, 0); assert.equal(m.mult, 1); assert.equal(m.next.name, "Familiar"); assert.equal(m.need, 1);
  p.addStars("baseball_bat", 18);
  m = p.masteryOf("baseball_bat");
  assert.equal(m.name, "Expert"); assert.equal(m.stars, 18); assert.equal(m.next.name, "Renowned"); assert.equal(m.next.stars, 25); assert.equal(m.need, 7);
  assert.equal(m.mult, 1.6);
  const r = p.rankOf();
  assert.equal(r.rank, 4); assert.equal(r.title, "Journeyman"); assert.equal(r.next.rank, 5); assert.equal(r.need, 7);
  assert.deepEqual(r.next.reward, { diamonds: 15, coins: 250 });
  p.addStars("baseball_bat", 600);
  m = p.masteryOf("baseball_bat");
  assert.equal(m.name, "Legendary"); assert.equal(m.next, null); assert.equal(m.frac, 1);
  assert.equal(p.rankOf().rank, 12); assert.equal(p.rankOf().next, null);
});

test("each threshold is crossed exactly once, a star at a time", () => {
  const g = playedGame(), p = Pr.createProgress(g), seen = { mastery: [], rank: [] };
  for (let i = 0; i < 520; i++) p.addStars("rolling_pin", 1).forEach((e) => seen[e.type].push(e.type === "rank" ? e.rank : e.tier));
  assert.deepEqual(seen.mastery, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(seen.rank, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  // stars past Legendary still count toward rank
  assert.equal(p.state.totalStars, 520);
  assert.equal(p.starsOn("rolling_pin"), 520);
});

test("one delivery crossing several tiers and ranks returns them all, mastery first, in order", () => {
  const g = playedGame(), p = Pr.createProgress(g);
  const ev = p.addStars("spindle", 10);
  assert.deepEqual(ev.filter((e) => e.type === "mastery").map((e) => e.name), ["Familiar", "Practiced", "Skilled"]);
  assert.deepEqual(ev.filter((e) => e.type === "rank").map((e) => e.rank), [2, 3]);
  assert.ok(ev.findIndex((e) => e.type === "rank") > ev.findLastIndex((e) => e.type === "mastery"), "mastery events come before rank events");
  assert.equal(ev[0].prev, ""); assert.equal(ev[1].prev, "Familiar");
  assert.deepEqual(ev.find((e) => e.rank === 3).reward, { diamonds: 9, coins: 150 });
});

test("mastery is per blueprint; rank counts every piece", () => {
  const g = playedGame(), p = Pr.createProgress(g);
  p.addStars("rolling_pin", 3); p.addStars("baseball_bat", 3); p.addStars("walking_stick", 3);
  assert.equal(p.masteryOf("rolling_pin").name, "Familiar");
  assert.equal(p.masteryOf("chair_leg").tier, 0);
  assert.equal(p.rankOf().rank, 3);   // 9 stars in all
});

/* ---------------- through the board ---------------- */

test("stars come only from accepted deliveries: rejected pieces and the shed earn nothing", () => {
  const s = setup();
  const o = s.board.state.orders[0];
  const bad = s.state.inventory.add("piece", Object.assign({ shape: "Test" }, untouched(o.wood)));
  assert.equal(s.board.deliver(o.id, bad.id).reason, "rejected");
  // the wrong wood earns nothing either
  const wrong = s.state.inventory.add("piece", Object.assign({ shape: "Test" }, perfectPiece(o), { wood: o.wood === "pine" ? "oak" : "pine" }));
  assert.equal(s.board.deliver(o.id, wrong.id).reason, "wrong wood");
  // previewing a perfect piece, or keeping it, earns nothing
  const good = s.state.inventory.add("piece", Object.assign({ shape: "Test" }, perfectPiece(o)));
  assert.equal(s.board.preview(o.id, good.id).stars, 3);
  assert.equal(s.progress.state.totalStars, 0);
  const r = s.board.deliver(o.id, good.id);
  assert.ok(r.ok);
  assert.equal(s.progress.state.totalStars, 3);
  assert.equal(s.progress.starsOn(o.kind), 3);
});

test("every accepted piece earns at least one star, so the first delivery gives Familiar and Apprentice", () => {
  assert.equal(C.starsFor(C.CFG.PASS), 1);
  const s = setup();
  const { order, result } = deliverFirst(s, plainPiece);
  assert.ok(result.ok && result.grade.stars >= 1);
  assert.equal(result.events[0].type, "mastery"); assert.equal(result.events[0].name, "Familiar"); assert.equal(result.events[0].kind, order.kind);
  const rank = result.events.find((e) => e.type === "rank");
  assert.equal(rank.rank, 2); assert.equal(rank.title, "Apprentice");
});

test("the pay multiplier uses the tier before this delivery's stars", () => {
  const s = setup();
  const o = s.board.state.orders[0];
  s.progress.addStars(o.kind, 8);   // Practiced (4), one short of Skilled (9)
  const it = s.state.inventory.add("piece", Object.assign({ shape: "Test" }, perfectPiece(o)));
  const pv = s.board.preview(o.id, it.id);
  assert.equal(pv.stars, 3);
  assert.equal(pv.mult, 1.3, "Practiced pays x1.30 even though these 3 stars reach Skilled");
  assert.equal(pv.pay, Math.round(o.reward * 1.3 * (1 + C.CFG.BONUS)));
  assert.equal(s.board.rewardOf(o), Math.round(o.reward * 1.3));
  const before = s.state.wallet.balance("coins");
  const r = s.board.deliver(o.id, it.id);
  assert.equal(r.pay, pv.pay, "preview and delivery agree");
  assert.equal(r.events.find((e) => e.type === "mastery").name, "Skilled");
  assert.equal(s.state.wallet.balance("coins") - before, r.pay + r.rewards.coins);
  // the next order for that piece pays at Skilled
  assert.equal(s.progress.mult(o.kind), 1.45);
});

test("with no mastery, grade pays exactly what it used to", () => {
  const s = setup();
  const o = s.board.state.orders[0];
  const it = s.state.inventory.add("piece", Object.assign({ shape: "Test" }, perfectPiece(o)));
  assert.equal(s.board.preview(o.id, it.id).pay, C.grade(o, perfectPiece(o)).pay);
  assert.equal(C.grade(o, perfectPiece(o)).pay, Math.round(o.reward * (1 + C.CFG.BONUS)));
});

test("rank rewards go into the wallet with the delivery", () => {
  const s = setup();
  const c0 = s.state.wallet.balance("coins"), d0 = s.state.wallet.balance("diamonds");
  const { result } = deliverFirst(s);
  assert.deepEqual(result.rewards, { coins: 100, diamonds: 6 });
  assert.equal(s.state.wallet.balance("coins"), c0 + result.pay + 100);
  assert.equal(s.state.wallet.balance("diamonds"), d0 + 6);
});

test("rank rewards are paid exactly once and survive a reload", () => {
  const store = Save.memoryStore();
  let s = setup();
  deliverFirst(s);   // 3 stars: Apprentice, paid
  Save.write(store, s.game);
  const coins = s.state.wallet.balance("coins"), dia = s.state.wallet.balance("diamonds");
  // reload: the same rank, nothing paid again just for loading
  const g2 = Save.load(store);
  s = setup(g2);
  assert.equal(s.progress.rankOf().rank, 2);
  assert.equal(s.progress.state.rankPaid, 2);
  assert.equal(s.state.wallet.balance("coins"), coins);
  assert.equal(s.state.wallet.balance("diamonds"), dia);
  // a save that somehow lost its stars but kept rankPaid: reaching the rank again pays nothing
  s.progress.state.totalStars = 0;
  const again = s.progress.addStars("rolling_pin", 1).find((e) => e.type === "rank");
  assert.equal(again.rank, 2); assert.equal(again.reward, null);
  // and the next rank still pays
  const r3 = s.progress.addStars("rolling_pin", 7).find((e) => e.type === "rank");
  assert.equal(r3.rank, 3); assert.deepEqual(r3.reward, { diamonds: 9, coins: 150 });
});

test("the progress section survives a save round trip, and a broken one is repaired", () => {
  const store = Save.memoryStore();
  const g = playedGame(), p = Pr.createProgress(g);
  p.addStars("baseball_bat", 12); p.addStars("rolling_pin", 2);
  Save.write(store, g);
  const p2 = Pr.createProgress(Save.load(store));
  assert.equal(p2.starsOn("baseball_bat"), 12); assert.equal(p2.state.totalStars, 14); assert.equal(p2.rankOf().rank, 3);
  const bad = Pr.normalize({ starsByKind: { "Bad Key": 4, ok: -3, spindle: "x", chair_leg: 2.7 }, totalStars: -5, rankPaid: 99 });
  assert.deepEqual(bad.starsByKind, { chair_leg: 2 });
  assert.equal(bad.totalStars, 0); assert.equal(bad.rankPaid, 12);
});

test("the best piece of each kind delivered is kept for the trophy wall, and survives a reload", () => {
  const store = Save.memoryStore();
  const s = setup();
  const o = s.board.state.orders[0];
  const plain = s.state.inventory.add("piece", Object.assign({ shape: "Test" }, plainPiece(o)));
  const first = s.board.deliver(o.id, plain.id);
  assert.ok(first.ok);
  const b0 = s.board.state.best[o.kind];
  assert.equal(b0.total, Math.round(first.grade.total * 1000) / 1000);
  assert.equal(b0.wood, o.wood); assert.ok(Array.isArray(b0.profile)); assert.equal(b0.client, o.client);
  // a worse one later doesn't replace it; a better one does
  s.advance(C.CFG.NEW_ORDER_MS); s.board.refill();
  const o2 = s.board.state.orders.find((q) => q.kind === o.kind && !q.intro) || Object.assign(C.makeOrder(5, { kind: o.kind, wood: "pine" }), { id: 9001 });
  if (!s.board.get(o2.id)) s.board.state.orders.push(o2);
  const top = s.state.inventory.add("piece", Object.assign({ shape: "Test" }, perfectPiece(o2)));
  s.board.deliver(o2.id, top.id);
  assert.ok(s.board.state.best[o.kind].total > b0.total);
  Save.write(store, s.game);
  const again = setup(Save.load(store));
  assert.equal(again.board.state.best[o.kind].total, s.board.state.best[o.kind].total);
});

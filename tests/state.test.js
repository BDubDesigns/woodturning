// Run: node --test tests/
// The shared game state: registry, wallet, inventory, and how the farm, the
// mine and the save all go through the one copy.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/js/registry.js");
const St = require("../src/js/state.js");
const S = require("../src/js/save.js");
const F = require("../src/js/farm.js");
const M = require("../src/js/monetize.js");

function fresh(opts = {}) {
  const game = S.newGame();
  let saves = 0;
  const state = St.createState(game, { onChange: () => saves++, now: () => 1000, ...opts });
  return { game, state, saves: () => saves };
}

// ---------- registry ----------
test("registry: the woods, currencies and item kinds the game ships with", () => {
  assert.deepEqual(R.CURRENCY_ORDER, ["coins", "diamonds"]);
  assert.equal(R.CURRENCIES.coins.start, 250);
  assert.equal(R.CURRENCIES.diamonds.start, 5);
  assert.equal(R.CURRENCIES.diamonds.premium, true);
  assert.equal(R.CURRENCIES.coins.premium, false);
  assert.deepEqual(R.WOOD_ORDER.slice(0, 3), ["pine", "oak", "walnut"]);
  assert.deepEqual(R.ITEM_ORDER.slice(0, 3), ["log", "blank", "piece"]);
  assert.equal(F.WOODS, R.WOODS, "the farm reads the registry's woods, not a copy");
});

test("registry: bad entries are refused", () => {
  assert.throws(() => R.addWood({ id: "pine", name: "Pine", growMs: 1, hits: 1 }), /already exists/);
  assert.throws(() => R.addWood({ id: "Bad Id", name: "x", growMs: 1, hits: 1 }), /id/);
  assert.throws(() => R.addWood({ id: "birch", name: "Birch" }), /growMs/);
  assert.throws(() => R.addItemKind({ id: "plank", name: "Plank", stack: true }), /by/);
});

// ---------- wallet ----------
test("wallet: earn and spend, and never below zero", () => {
  const { state, game, saves } = fresh();
  const w = state.wallet;
  assert.equal(w.balance("coins"), 250);
  assert.equal(w.earn("coins", 30).balance, 280);
  assert.equal(game.wallet.coins, 280, "the wallet is the save's own object");
  const no = w.spend("diamonds", 6);
  assert.equal(no.ok, false);
  assert.equal(no.need, 6); assert.equal(no.have, 5);
  assert.equal(w.balance("diamonds"), 5, "a refused spend takes nothing");
  assert.equal(w.spend("diamonds", 5).ok, true);
  assert.equal(w.balance("diamonds"), 0);
  assert.equal(w.earn("gems", 1).ok, false, "unknown currencies are refused");
  assert.equal(w.earn("coins", -3).ok, false);
  assert.equal(saves(), 2, "two changes, two saves; refusals save nothing");
});

test("wallet: a damaged wallet is repaired and unknown currencies dropped", () => {
  const game = S.newGame();
  game.wallet = { coins: -4, diamonds: 2.7, gems: 9 };
  const keep = game.wallet;
  St.createState(game);
  assert.equal(game.wallet, keep, "same object, so other holders still see it");
  assert.deepEqual(game.wallet, { coins: 250, diamonds: 2 });
});

// ---------- inventory ----------
test("inventory: logs stack by wood", () => {
  const { state } = fresh();
  const inv = state.inventory;
  assert.equal(inv.count("log"), 0);
  inv.add("log", "pine"); inv.add("log", "pine"); inv.add("log", "oak", 3);
  assert.equal(inv.count("log", "pine"), 2);
  assert.equal(inv.count("log"), 5);
  assert.deepEqual(inv.list("log"), [{ key: "pine", count: 2 }, { key: "oak", count: 3 }]);
  assert.equal(inv.add("log", "mahogany"), null, "only registered woods");
  assert.ok(inv.take("log", "pine"));
  assert.ok(inv.take("log", "pine"));
  assert.equal(inv.take("log", "pine"), null);
  assert.equal(inv.count("log", "pine"), 0);
});

test("inventory: blanks and pieces are unique items with their data", () => {
  const { state } = fresh();
  const inv = state.inventory;
  const b = inv.add("blank", { wood: "oak", seed: 7, profile: [1, 0.9], junk: "dropped" });
  assert.equal(b.kind, "blank"); assert.equal(b.wood, "oak"); assert.equal(b.seed, 7); assert.equal(b.madeAt, 1000);
  assert.equal("junk" in b, false, "only the kind's registered fields are kept");
  const p = inv.add("piece", { wood: "pine", shape: "Cove", match: 0.8 });
  assert.notEqual(b.id, p.id);
  assert.equal(inv.count("blank"), 1);
  assert.equal(inv.count("piece", "pine"), 1);
  assert.equal(inv.count("piece", { shape: "Cove" }), 1);
  assert.equal(inv.get(p.id), p);
  assert.equal(inv.add("blank", { wood: "ebony" }), null);
  assert.equal(inv.take("blank", 9999), null);
  assert.equal(inv.take("blank", b.id), b);
  assert.equal(inv.count("blank"), 0);
  assert.equal(inv.take("piece", "pine").id, p.id, "take by wood takes the oldest match");
});

test("inventory: a damaged inventory is repaired, not trusted", () => {
  const game = S.newGame();
  game.inventory = {
    stacks: { log: { pine: 2, oak: -1, ebony: 4, walnut: 1.8 }, nonsense: { a: 1 } },
    items: [{ id: 3, kind: "blank", wood: "oak" }, { id: 3, kind: "blank", wood: "pine" }, { id: 4, kind: "log" }, { id: 5, kind: "piece", wood: "teak" }, { kind: "piece" }, "x"],
    nextId: 1
  };
  const { inventory } = St.createState(game);
  assert.deepEqual(game.inventory.stacks, { log: { pine: 2, walnut: 1 } });
  assert.equal(game.inventory.items.length, 1);
  assert.equal(inventory.add("piece", { wood: "pine" }).id, 4, "new ids never reuse an old one");
});

test("grant: one bundle of currencies and items, for rewards and starter kits", () => {
  const { state, game } = fresh();
  const g = state.grant({ coins: 50, diamonds: 2, gems: 9, items: [{ kind: "log", key: "pine", n: 3 }, { kind: "blank", data: { wood: "oak" } }, { kind: "nope" }] });
  assert.equal(game.wallet.coins, 300);
  assert.equal(game.wallet.diamonds, 7);
  assert.equal(state.inventory.count("log", "pine"), 3);
  assert.equal(state.inventory.count("blank", "oak"), 1);
  assert.deepEqual(g.currencies, { coins: 50, diamonds: 2 });
  assert.equal(g.items.length, 2);
});

test("pack and unpack keep float arrays small in the save", () => {
  const a = Float32Array.from([1.0499999, 0.123456, 0]);
  const p = St.pack(a);
  assert.deepEqual(p, [1.05, 0.1235, 0]);
  const back = St.unpack(p);
  assert.ok(back instanceof Float32Array);
  assert.equal(back.length, 3);
});

// ---------- everything through one state ----------
test("one state: the farm, the mine and the inventory share the wallet and the shed", () => {
  const clock = { t: 1_000_000 };
  const game = S.newGame();
  const state = St.createState(game, { now: () => clock.t });
  const mine = M.createMine(game, { state });
  const farm = F.createFarm(game, { state, now: () => clock.t, timersOff: mine.timersOff });
  mine.mineReward("diamonds", true);
  assert.equal(state.wallet.balance("diamonds"), 5 + M.CFG.DIAMONDS_PER_AD);
  farm.plant(0, "oak");
  assert.equal(farm.finishNow(0).ok, true);
  assert.equal(state.wallet.balance("diamonds"), 5 + M.CFG.DIAMONDS_PER_AD - Math.ceil(F.WOODS.oak.growMs / F.CFG.DIAMOND_MS));
  for (let i = 0; i < F.WOODS.oak.hits; i++) farm.chopHit(0, { side: 1, y: 0.5 });
  assert.equal(state.inventory.count("log", "oak"), 1, "a felled tree lands in the shared inventory");
  assert.equal(farm.logCount("oak"), 1);
  // harvesting a grown tree fells it in one go
  farm.plant(1, "pine");
  assert.equal(farm.firstMature(), -1);
  assert.equal(farm.fell(1).ok, false, "not grown yet");
  clock.t += F.WOODS.pine.growMs;
  assert.equal(farm.firstMature(), 1);
  assert.deepEqual(farm.fell(1), { ok: true, wood: "pine" });
  assert.equal(farm.plotAt(1), null);
  assert.equal(state.inventory.count("log", "pine"), 1);
});

test("save: the inventory round trips, and v1 shed logs move into it", () => {
  const st = S.memoryStore();
  const { game, state } = fresh();
  state.inventory.add("log", "walnut", 2);
  const p = state.inventory.add("piece", { wood: "walnut", shape: "Cove", profile: [1, 0.5], coat: { coat: [0, 1] } });
  S.write(st, game);
  const back = S.load(st);
  const s2 = St.createState(back);
  assert.equal(s2.inventory.count("log", "walnut"), 2);
  assert.deepEqual(s2.inventory.get(p.id).coat, { coat: [0, 1] });
  // a v1 save with logs in the farm's shed
  st.setItem(S.KEY, JSON.stringify({ v: 1, wallet: { coins: 10, diamonds: 1, gems: 0 }, farm: { plots: [null, null], logs: { pine: 2, oak: 1 }, lastSeen: 0 } }));
  const old = S.load(st);
  const s3 = St.createState(old);
  const farm = F.createFarm(old, { state: s3, now: () => 0 });
  assert.equal(farm.logCount("pine"), 2);
  assert.equal(s3.inventory.count("log", "oak"), 1);
  assert.equal("logs" in old.farm, false);
});

test("save: sections this build does not know are kept for the build that does", () => {
  const st = S.memoryStore();
  st.setItem(S.KEY, JSON.stringify({ v: S.VERSION, wallet: { coins: 1, diamonds: 1 }, commissions: { open: [1] } }));
  assert.deepEqual(S.load(st).commissions, { open: [1] });
});

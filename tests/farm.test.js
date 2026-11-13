// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { playedGame } = require("./helpers.js");
const F = require("../src/js/farm.js");
const S = require("../src/js/save.js");
const fs = require("node:fs");
const path = require("node:path");

const MIN = 60 * 1000;

function setup(t0 = 1_000_000) {
  const clock = { t: t0 };
  const game = playedGame();
  let saves = 0;
  const farm = F.createFarm(game, { now: () => clock.t, onChange: () => saves++ });
  return { clock, game, farm, saves: () => saves };
}

test("a new farm has the starting plots, all empty", () => {
  const { farm } = setup();
  assert.equal(farm.state.plots.length, F.CFG.START_PLOTS);
  assert.ok(farm.state.plots.every((p) => p === null));
  assert.equal(farm.stage(farm.plotAt(0)), "empty");
});

test("planting starts a tree that grows with the clock", () => {
  const { farm, clock } = setup();
  assert.equal(farm.plant(0, "pine").ok, true);
  const p = farm.plotAt(0);
  assert.equal(farm.progress(p), 0);
  assert.equal(farm.stage(p), "seed");
  clock.t += F.WOODS.pine.growMs / 2;
  assert.ok(Math.abs(farm.progress(p) - 0.5) < 1e-9);
  assert.equal(farm.isMature(p), false);
  clock.t += F.WOODS.pine.growMs / 2;
  assert.equal(farm.progress(p), 1);
  assert.equal(farm.isMature(p), true);
  assert.equal(farm.stage(p), "mature");
});

test("stages advance through the whole life of a tree", () => {
  const { farm, clock } = setup();
  farm.plant(0, "oak");
  const p = farm.plotAt(0), seen = [];
  const total = F.WOODS.oak.growMs;
  for (let k = 0; k <= 100; k++) {
    clock.t = 1_000_000 + (total * k) / 100;
    const s = farm.stage(p);
    if (seen[seen.length - 1] !== s) seen.push(s);
  }
  assert.deepEqual(seen, ["seed", "sprout", "sapling", "young", "mature"]);
});

test("cannot plant on a taken plot, an unknown wood, or a missing plot", () => {
  const { farm } = setup();
  assert.equal(farm.plant(0, "pine").ok, true);
  assert.equal(farm.plant(0, "oak").ok, false);
  assert.equal(farm.plant(1, "ebony").ok, false);
  assert.equal(farm.plant(5, "pine").ok, false);
  assert.equal(farm.plant(-1, "pine").ok, false);
});

test("a tree keeps growing while the game is closed: save, wait, load", () => {
  const { farm, clock, game } = setup();
  farm.plant(0, "walnut");
  farm.touch();
  const stored = S.memoryStore();
  S.write(stored, game);

  // the player closes the game and comes back a day later
  clock.t += 24 * 60 * MIN;
  const reopened = S.load(stored);
  const farm2 = F.createFarm(reopened, { now: () => clock.t });
  const p = farm2.plotAt(0);
  assert.equal(farm2.isMature(p), true);
  const grew = farm2.grownWhileAway();
  assert.deepEqual(grew, [{ index: 0, wood: "walnut" }]);
});

test("coming back early leaves the tree partly grown, and reports nothing finished", () => {
  const { farm, clock, game } = setup();
  farm.plant(0, "walnut");
  farm.touch();
  const stored = S.memoryStore();
  S.write(stored, game);
  clock.t += 5 * MIN;
  const farm2 = F.createFarm(S.load(stored), { now: () => clock.t });
  const p = farm2.plotAt(0);
  assert.ok(Math.abs(farm2.progress(p) - 5 / 15) < 1e-9);
  assert.deepEqual(farm2.grownWhileAway(), []);
});

test("a tree that was already mature last visit is not reported as new", () => {
  const { farm, clock } = setup();
  farm.plant(0, "pine");
  clock.t += 10 * MIN;
  farm.touch();
  clock.t += 10 * MIN;
  assert.deepEqual(farm.grownWhileAway(), []);
});

test("the clock set backwards never un-grows or breaks a tree", () => {
  const { farm, clock } = setup();
  farm.plant(0, "pine");
  clock.t -= 60 * MIN;
  const p = farm.plotAt(0);
  assert.equal(farm.progress(p), 0);
  assert.equal(farm.remainingMs(p), F.WOODS.pine.growMs);
});

test("a diamond skips two minutes and costs one diamond", () => {
  const { farm, game } = setup();
  farm.plant(0, "oak");
  const before = farm.remainingMs(farm.plotAt(0));
  const d0 = game.wallet.diamonds;
  assert.equal(farm.speedUp(0).ok, true);
  assert.equal(game.wallet.diamonds, d0 - 1);
  assert.equal(farm.remainingMs(farm.plotAt(0)), before - F.CFG.DIAMOND_MS);
});

test("finish now charges for exactly the remaining wait, rounded up", () => {
  const { farm, game, clock } = setup();
  farm.plant(0, "oak");                       // 8 min
  clock.t += 30 * 1000;                       // 7:30 left -> 4 diamonds
  assert.equal(farm.diamondsToFinish(farm.plotAt(0)), 4);
  game.wallet.diamonds = 4;
  const r = farm.finishNow(0);
  assert.equal(r.ok, true);
  assert.equal(r.cost, 4);
  assert.equal(game.wallet.diamonds, 0);
  assert.equal(farm.isMature(farm.plotAt(0)), true);
});

test("speed-up is refused without enough diamonds and changes nothing", () => {
  const { farm, game } = setup();
  farm.plant(0, "walnut");
  game.wallet.diamonds = 2;
  const before = farm.remainingMs(farm.plotAt(0));
  const r = farm.finishNow(0);
  assert.equal(r.ok, false);
  assert.equal(game.wallet.diamonds, 2);
  assert.equal(farm.remainingMs(farm.plotAt(0)), before);
  game.wallet.diamonds = 0;
  assert.equal(farm.speedUp(0).ok, false);
  assert.equal(game.wallet.diamonds, 0);
});

test("speed-up does nothing on an empty plot or a finished tree", () => {
  const { farm, game, clock } = setup();
  assert.equal(farm.speedUp(0).ok, false);
  assert.equal(farm.finishNow(0).ok, false);
  farm.plant(0, "pine");
  clock.t += F.WOODS.pine.growMs;
  const d = game.wallet.diamonds;
  assert.equal(farm.speedUp(0).ok, false);
  assert.equal(farm.finishNow(0).ok, false);
  assert.equal(game.wallet.diamonds, d);
});

test("land: buying adds a plot, charges coins, and prices go up", () => {
  const { farm, game } = setup();
  game.wallet.coins = 10000;
  const prices = [];
  while (farm.landPrice() !== null) {
    prices.push(farm.landPrice());
    const r = farm.buyLand();
    assert.equal(r.ok, true);
    assert.equal(r.index, farm.state.plots.length - 1);
  }
  assert.equal(farm.state.plots.length, F.CFG.MAX_PLOTS);
  assert.equal(prices.length, F.CFG.MAX_PLOTS - F.CFG.START_PLOTS);
  for (let i = 1; i < prices.length; i++) assert.ok(prices[i] > prices[i - 1]);
  assert.equal(game.wallet.coins, 10000 - prices.reduce((a, b) => a + b, 0));
  assert.equal(farm.buyLand().ok, false);
});

test("land: refused without the coins, and nothing is charged", () => {
  const { farm, game } = setup();
  game.wallet.coins = 99;
  const r = farm.buyLand();
  assert.equal(r.ok, false);
  assert.equal(game.wallet.coins, 99);
  assert.equal(farm.state.plots.length, F.CFG.START_PLOTS);
});

test("new land can grow a different wood at the same time", () => {
  const { farm, game } = setup();
  game.wallet.coins = 500;
  farm.buyLand();
  farm.plant(0, "pine"); farm.plant(1, "oak"); farm.plant(2, "walnut");
  const woods = [0, 1, 2].map((i) => farm.plotAt(i).wood);
  assert.deepEqual(woods, ["pine", "oak", "walnut"]);
});

test("felling: only a grown tree can be felled, and its log goes to the shed", () => {
  const { farm, clock } = setup();
  assert.equal(farm.fell(0).ok, false, "nothing growing");
  farm.plant(0, "oak");
  assert.equal(farm.fell(0).ok, false, "not grown yet");
  assert.equal(farm.plotAt(0).wood, "oak", "the young tree is untouched");
  clock.t += F.WOODS.oak.growMs;
  assert.deepEqual(farm.fell(0), { ok: true, wood: "oak" });
  assert.equal(farm.plotAt(0), null);
  assert.equal(farm.logCount("oak"), 1);
  assert.equal(farm.logCount("pine"), 0);
  // the plot is free again
  assert.equal(farm.plant(0, "pine").ok, true);
});

test("there is no swipe chop on the farm: trees come down only through the harvest", () => {
  const { farm } = setup();
  assert.equal(farm.chopHit, undefined);
});

test("logs can be taken one at a time for a commission", () => {
  const { farm, clock } = setup();
  farm.plant(0, "pine");
  clock.t += F.WOODS.pine.growMs;
  farm.fell(0);
  assert.equal(farm.logCount("pine"), 1);
  assert.equal(farm.takeLog("oak"), false);
  assert.equal(farm.takeLog("pine"), true);
  assert.equal(farm.logCount("pine"), 0);
  assert.equal(farm.takeLog("pine"), false);
});

test("old saves with chop progress load cleanly and drop it", () => {
  const game = playedGame();
  game.farm = { plots: [{ wood: "walnut", plantedAt: 100, skipped: 0, hits: 2, notches: [{ side: -1, y: 0.4 }] }, null] };
  const farm = F.createFarm(game, { now: () => 200 });
  assert.deepEqual(farm.plotAt(0), { wood: "walnut", plantedAt: 100, skipped: 0 });
});

test("every change calls onChange so the page can save", () => {
  const { farm, clock, saves, game } = setup();
  game.wallet.coins = 500;
  let n = saves();
  farm.plant(0, "pine"); assert.ok(saves() > n); n = saves();
  farm.speedUp(0); assert.ok(saves() > n); n = saves();
  farm.buyLand(); assert.ok(saves() > n);
});

test("a damaged farm save is repaired, not trusted", () => {
  const game = playedGame();
  game.farm = {
    plots: [{ wood: "mahogany", plantedAt: 5 }, { wood: "pine", plantedAt: "soon" }, { wood: "oak", plantedAt: 100, skipped: -5, hits: "x", notches: [{ side: 3, y: 1 }] }]
  };
  game.inventory = { stacks: { log: { pine: -2, oak: 2.9, ebony: 4 } } };
  const farm = F.createFarm(game, { now: () => 200 });
  assert.equal(farm.state.plots.length, 3);
  assert.equal(farm.plotAt(0), null);
  assert.equal(farm.plotAt(1), null);
  assert.deepEqual(farm.plotAt(2), { wood: "oak", plantedAt: 100, skipped: 0 });
  assert.equal(farm.logCount("pine"), 0);
  assert.equal(farm.logCount("oak"), 2);
  assert.equal(farm.logCount("ebony"), 0);
});

test("durations read naturally", () => {
  assert.equal(F.formatDuration(0), "0:00");
  assert.equal(F.formatDuration(61_000), "1:01");
  assert.equal(F.formatDuration(9 * 1000), "0:09");
  assert.equal(F.formatDuration(59.2 * MIN), "59:12");
  assert.equal(F.formatDuration(72 * MIN), "1h 12m");
  assert.equal(F.formatDuration(27 * 60 * MIN), "1d 3h");
});

// ---------- save ----------
test("save: a fresh game starts with three pine logs and the new-player flow, and no money", () => {
  const g = S.load(S.memoryStore());
  assert.equal(g.wallet.coins, 0);
  assert.equal(g.wallet.diamonds, 0);
  assert.deepEqual(g.inventory.stacks.log, { pine: 3 });
  assert.deepEqual(g.tutorial, { step: null, done: false });
  assert.equal(g.farm, null);
});

test("save: a save from before the new-player flow skips it", () => {
  const st = S.memoryStore();
  st.setItem(S.KEY, JSON.stringify({ v: S.VERSION, wallet: { coins: 40, diamonds: 1 } }));
  assert.equal(S.load(st).tutorial.done, true);
  const g = S.newGame();
  assert.equal(S.write(st, g), true);
  assert.equal(S.load(st).tutorial.done, false, "a new player who reloads mid-flow stays in it");
});

test("save: round trip keeps the wallet and the farm", () => {
  const st = S.memoryStore();
  const g = S.newGame();
  g.wallet.coins = 12 + F.WOODS.oak.plantPrice; g.wallet.diamonds = 3;
  const farm = F.createFarm(g, { now: () => 5 });
  assert.equal(farm.plant(1, "oak").ok, true);
  assert.equal(S.write(st, g), true);
  const back = S.load(st);
  assert.equal(back.wallet.coins, 12);
  assert.equal(back.wallet.diamonds, 3);
  assert.equal(back.farm.plots[1].wood, "oak");
});

test("save: garbage, wrong version and blocked storage all fall back to a new game", () => {
  const st = S.memoryStore();
  st.setItem(S.KEY, "{not json");
  assert.deepEqual(S.load(st), S.newGame());
  st.setItem(S.KEY, JSON.stringify({ v: 999, wallet: { coins: 1e9, diamonds: 1e9 } }));
  assert.deepEqual(S.load(st), S.newGame());
  st.setItem(S.KEY, JSON.stringify({ v: S.VERSION, wallet: { coins: -5, diamonds: "lots" } }));
  const junk = S.load(st);
  F.createFarm(junk, { now: () => 0 });   // the wallet's owner repairs it on start
  assert.deepEqual(junk.wallet, S.newGame().wallet);
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.deepEqual(S.load(broken), S.newGame());
  assert.equal(S.write(broken, S.newGame()), false);
});

test("save: pickStorage falls back to memory when localStorage throws", () => {
  const st = S.pickStorage({ get localStorage() { throw new Error("blocked"); } });
  assert.equal(st.persistent, false);
  st.setItem("a", "1");
  assert.equal(st.getItem("a"), "1");
});

// ---------- copy ----------
test("no em dashes in anything the player reads", () => {
  const root = path.join(__dirname, "..", "src");
  for (const f of ["index.html", "js/farm.js", "js/farm-ui.js", "js/save.js", "js/state.js", "js/registry.js", "style.css"]) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(!/—|&mdash;/.test(text), `${f} has an em dash`);
  }
});

// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/js/monetize.js");
const F = require("../src/js/farm.js");
const S = require("../src/js/save.js");
const fs = require("node:fs");
const path = require("node:path");

const MIN = 60 * 1000;

function setup() {
  const clock = { t: 1_000_000 };
  const game = S.newGame();
  let saves = 0;
  const mine = M.createMine(game, { onChange: () => saves++ });
  const farm = F.createFarm(game, { now: () => clock.t, timersOff: mine.timersOff, coinsPerDiamond: M.CFG.COINS_PER_DIAMOND_LAND, onChange: () => saves++ });
  return { clock, game, mine, farm, saves: () => saves };
}

test("a new game has coins and diamonds only, locked, no ads watched", () => {
  const { game, mine } = setup();
  assert.deepEqual(Object.keys(game.wallet).sort(), ["coins", "diamonds"]);
  assert.equal(game.wallet.diamonds, 5);
  assert.equal(game.wallet.coins, 250);
  assert.equal(mine.isUnlocked(), false);
  assert.equal(mine.needsAd(), true);
  assert.equal(mine.state.adsWatched, 0);
});

test("the mine trade is exact: one finished ad pays the printed amount, every time", () => {
  const { game, mine } = setup();
  const d0 = game.wallet.diamonds;
  for (let i = 0; i < 20; i++) assert.equal(mine.mineReward("diamonds", true).amount, M.CFG.DIAMONDS_PER_AD);
  assert.equal(game.wallet.diamonds, d0 + 20 * M.CFG.DIAMONDS_PER_AD);
  assert.equal(mine.state.adsWatched, 20);
  assert.deepEqual(M.trade("diamonds"), { kind: "diamonds", amount: M.CFG.DIAMONDS_PER_AD, noun: "diamonds" });
  assert.equal(M.trade("nonsense"), null);
  assert.equal(M.trade("gems"), null, "the mine pays diamonds only");
  assert.equal(mine.mineReward("gems", true).ok, false);
  assert.equal(mine.sellGems, undefined, "there is nothing to sell at the mine");
});

test("a closed or unfinished ad pays nothing and costs nothing", () => {
  const { game, mine, saves } = setup();
  const before = JSON.stringify(game), n = saves();
  for (const v of [false, undefined, null, 0, "yes", 1]) {
    const r = mine.mineReward("diamonds", v);
    assert.equal(r.ok, false);
  }
  assert.equal(JSON.stringify(game), before);
  assert.equal(saves(), n);
});

test("the unlock removes ads: mining pays the same with no ad", () => {
  const { game, mine } = setup();
  assert.equal(mine.unlock().ok, true);
  assert.equal(mine.unlock().ok, false, "second unlock is refused");
  assert.equal(mine.needsAd(), false);
  const d0 = game.wallet.diamonds;
  assert.equal(mine.mineReward("diamonds", undefined).ok, true);
  assert.equal(game.wallet.diamonds, d0 + M.CFG.DIAMONDS_PER_AD);
  assert.equal(mine.state.adsWatched, 0, "no ad was watched");
});

test("the unlock removes timers: a planted tree is ready at once", () => {
  const { farm, mine, game } = setup();
  farm.plant(0, "walnut");
  assert.equal(farm.isMature(farm.plotAt(0)), false, "locked: walnut takes 15 minutes");
  assert.equal(farm.remainingMs(farm.plotAt(0)), F.WOODS.walnut.growMs);
  mine.unlock();
  assert.equal(farm.isMature(farm.plotAt(0)), true);
  assert.equal(farm.remainingMs(farm.plotAt(0)), 0);
  assert.equal(farm.stage(farm.plotAt(0)), "mature");
  farm.plant(1, "oak");
  assert.equal(farm.isMature(farm.plotAt(1)), true, "new plantings are ready at once");
  // it can be chopped straight away, and no diamonds are charged
  const d = game.wallet.diamonds;
  for (let i = 0; i < F.WOODS.oak.hits; i++) assert.equal(farm.chopHit(1, { side: 1, y: 0.5 }).ok, true);
  assert.equal(farm.logCount("oak"), 1);
  assert.equal(game.wallet.diamonds, d);
  assert.deepEqual(farm.grownWhileAway(), [], "no welcome-back list when nothing waits");
});

test("no paywall on the core loop: a free game grows and chops with no diamonds or ads", () => {
  const { farm, game, clock, mine } = setup();
  game.wallet.diamonds = 0;
  assert.equal(mine.isUnlocked(), false);
  assert.equal(farm.plant(0, "pine").ok, true);
  assert.equal(farm.chopHit(0, { side: 1, y: 0.5 }).ok, false, "not grown yet, and no way to be told to pay");
  clock.t += F.WOODS.pine.growMs;      // just wait
  assert.equal(farm.isMature(farm.plotAt(0)), true);
  let r;
  for (let i = 0; i < F.WOODS.pine.hits; i++) r = farm.chopHit(0, { side: i % 2 ? 1 : -1, y: 0.5 });
  assert.equal(r.felled, true);
  assert.equal(farm.logCount("pine"), 1, "the log arrives with an empty wallet");
  assert.equal(game.wallet.diamonds, 0);
  assert.equal(game.mine.adsWatched, 0);
});

test("diamonds only skip waiting: speed-up never does more than the clock would", () => {
  const { farm, game, clock } = setup();
  farm.plant(0, "oak");
  const total = F.WOODS.oak.growMs;
  const cost = farm.diamondsToFinish(farm.plotAt(0));
  assert.equal(cost, Math.ceil(total / F.CFG.DIAMOND_MS));
  game.wallet.diamonds = cost;
  assert.equal(farm.finishNow(0).ok, true);
  assert.equal(farm.remainingMs(farm.plotAt(0)), 0);
  // a tree that waited the same time ends up identical, just later
  farm.plant(1, "oak");
  clock.t += total;
  assert.equal(farm.progress(farm.plotAt(1)), farm.progress(farm.plotAt(0)));
});

test("land can be bought with diamonds as well as coins", () => {
  const { farm, game } = setup();
  const coinPrice = farm.landPrice();
  const dia = farm.landPriceDiamonds();
  assert.equal(dia, Math.ceil(coinPrice / M.CFG.COINS_PER_DIAMOND_LAND));
  game.wallet.diamonds = dia - 1;
  assert.equal(farm.buyLandWithDiamonds().ok, false);
  assert.equal(farm.state.plots.length, F.CFG.START_PLOTS);
  game.wallet.diamonds = dia + 2;
  const c0 = game.wallet.coins;
  const r = farm.buyLandWithDiamonds();
  assert.equal(r.ok, true);
  assert.equal(game.wallet.diamonds, 2);
  assert.equal(game.wallet.coins, c0, "coins untouched");
  assert.equal(farm.state.plots.length, F.CFG.START_PLOTS + 1);
  // coins still buy it
  game.wallet.coins = 10_000;
  assert.equal(farm.buyLand().ok, true);
});

test("saves round trip the mine and the unlock", () => {
  const store = S.memoryStore();
  const g1 = S.newGame();
  const m1 = M.createMine(g1);
  m1.mineReward("diamonds", true); m1.mineReward("diamonds", true); m1.unlock();
  assert.equal(S.write(store, g1), true);
  const g2 = S.load(store);
  const m2 = M.createMine(g2);
  assert.equal(g2.wallet.diamonds, 5 + 2 * M.CFG.DIAMONDS_PER_AD);
  assert.equal(m2.isUnlocked(), true);
  assert.equal(m2.state.adsWatched, 2);
});

test("old saves with gems still load: gems become coins at the old rate, and are gone", () => {
  const old = S.memoryStore();
  old.setItem(S.KEY, JSON.stringify({ v: 1, wallet: { coins: 70, diamonds: 2, gems: 3 }, farm: null, mine: { unlocked: false, adsWatched: 4, gemsSold: 9 } }));
  const g = S.load(old);
  const m = M.createMine(g);
  assert.equal(g.v, S.VERSION);
  assert.equal(g.wallet.coins, 70 + 3 * S.COINS_PER_OLD_GEM);
  assert.equal(g.wallet.diamonds, 2);
  assert.equal("gems" in g.wallet, false);
  assert.equal("gemsSold" in g.mine, false);
  assert.equal(m.state.adsWatched, 4);
  // a slice-2 save with no mine section and no gems
  old.setItem(S.KEY, JSON.stringify({ v: 1, wallet: { coins: 70, diamonds: 2 }, farm: null }));
  const g3 = S.load(old);
  assert.equal(g3.wallet.coins, 70);
  assert.equal(M.createMine(g3).isUnlocked(), false);
  // negative or junk gems add nothing
  old.setItem(S.KEY, JSON.stringify({ v: 1, wallet: { coins: 1, diamonds: 1, gems: -4 } }));
  assert.equal(S.load(old).wallet.coins, 1);
});

test("a damaged mine section cannot unlock the game", () => {
  const bad = [null, 5, "x", [], { unlocked: "true" }, { unlocked: 1 }, { adsWatched: -5 }];
  for (const b of bad) {
    const n = M.normalizeMine(b);
    assert.equal(n.unlocked, false);
    assert.ok(n.adsWatched >= 0);
  }
});

test("no gems anywhere in the game's screens or code", () => {
  for (const f of ["../src/js/monetize.js", "../src/js/monetize-ui.js", "../src/index.html", "../src/js/farm-ui.js", "../src/js/registry.js", "../src/js/main.js"]) {
    const t = fs.readFileSync(path.join(__dirname, f), "utf8");
    assert.equal(/\bgems?\b/i.test(t), false, f + " still mentions gems");
  }
});

test("player-facing copy has no em dashes", () => {
  for (const f of ["../src/js/monetize.js", "../src/js/monetize-ui.js", "../src/index.html", "../src/js/registry.js", "../src/js/state.js", "../src/js/main.js", "../src/js/harvest-view.js"]) {
    const t = fs.readFileSync(path.join(__dirname, f), "utf8");
    assert.equal(t.includes("—"), false, f + " contains an em dash");
  }
});

test("the full-unlock price is a single number, 5 or 10", () => {
  assert.ok(M.CFG.UNLOCK_PRICE_USD === 5 || M.CFG.UNLOCK_PRICE_USD === 10);
  assert.equal(M.priceLabel(), "$" + M.CFG.UNLOCK_PRICE_USD);
});

test("the mine: one finished ad lets you in, cracking the vein pays exactly once", () => {
  const { game, mine } = setup();
  const d0 = game.wallet.diamonds;
  assert.equal(mine.hasPass(), false);
  assert.equal(mine.claimVein().ok, false, "no visit, no pay");
  assert.equal(mine.enterMine(false).ok, false, "a closed ad lets nobody in");
  assert.equal(mine.state.adsWatched, 0);
  assert.equal(mine.enterMine(true).ok, true);
  assert.equal(mine.state.adsWatched, 1);
  assert.equal(mine.hasPass(), true);
  assert.equal(mine.enterMine(true).already, true, "walking back in keeps the one visit");
  assert.equal(mine.state.adsWatched, 1);
  assert.deepEqual(mine.claimVein(), { ok: true, kind: "diamonds", amount: M.CFG.DIAMONDS_PER_VEIN });
  assert.equal(M.CFG.DIAMONDS_PER_VEIN, 5);
  assert.equal(game.wallet.diamonds, d0 + 5);
  assert.equal(mine.claimVein().ok, false, "the visit is used up");
  assert.equal(game.wallet.diamonds, d0 + 5);
});

test("the mine visit survives a save, and the full game walks straight in every time", () => {
  const { game, mine } = setup();
  mine.enterMine(true);
  const again = M.createMine(JSON.parse(JSON.stringify(game)));
  assert.equal(again.hasPass(), true, "a saved visit is still there after a reload");
  assert.equal(M.normalizeMine({ pass: "yes" }).pass, false);
  mine.claimVein();
  mine.unlock();
  const d0 = game.wallet.diamonds;
  assert.equal(mine.enterMine().ok, true, "no ad needed");
  assert.equal(mine.state.pass, false, "nothing to keep");
  mine.claimVein(); mine.claimVein();
  assert.equal(game.wallet.diamonds, d0 + 10);
});

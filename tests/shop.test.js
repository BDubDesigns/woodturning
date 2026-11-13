// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Shop = require("../src/js/shop.js");
const St = require("../src/js/state.js");
const Save = require("../src/js/save.js");
const Cut = require("../src/js/cutting.js");

function setup(coins) {
  const game = Save.newGame();
  game.wallet.coins = coins == null ? 250 : coins;
  const state = St.createState(game);
  const shop = Shop.createShop(game, { state });
  return { game, state, shop };
}

test("a new workshop has the first tier of every line, for nothing", () => {
  const { shop } = setup();
  for (const k of Shop.LINE_ORDER) {
    assert.equal(shop.level(k), 0);
    assert.equal(Shop.LINES[k].tiers[0].price, 0, k + " starts free");
  }
  assert.equal(shop.lightLevel(), 0);
  assert.equal(shop.cutBoost(), 1);
  assert.deepEqual(shop.tips(), ["gouge", "skew"]);
});

test("every rung costs a lot more than the last, so there is always more to save for", () => {
  for (const k of Shop.LINE_ORDER) {
    const t = Shop.LINES[k].tiers;
    assert.ok(t.length >= 4, k + " has a ladder");
    for (let i = 2; i < t.length; i++) assert.ok(t[i].price >= t[i - 1].price * 3, `${k}: ${t[i - 1].name} ${t[i - 1].price} -> ${t[i].name} ${t[i].price}`);
  }
});

test("buying takes the coins and installs the next tier, in order", () => {
  const { shop, state } = setup(1000);
  const price = shop.next("light").price;
  const r = shop.buy("light");
  assert.ok(r.ok);
  assert.equal(state.wallet.balance("coins"), 1000 - price);
  assert.equal(shop.level("light"), 1);
  assert.equal(shop.lightLevel(), 1);
  assert.equal(shop.next("light").name, Shop.LINES.light.tiers[2].name, "the next rung is offered next");
});

test("not enough coins: nothing is bought and nothing is taken", () => {
  const { shop, state } = setup(100);
  assert.equal(shop.canAfford("light"), false);
  const r = shop.buy("light");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not enough coins");
  assert.equal(state.wallet.balance("coins"), 100);
  assert.equal(shop.level("light"), 0);
});

test("the top of a line cannot be bought past", () => {
  const { shop } = setup(1e6);
  while (shop.next("motor")) assert.ok(shop.buy("motor").ok);
  assert.equal(shop.buy("motor").reason, "top of the line");
  assert.ok(shop.cutBoost() > 1.5, "the best motor cuts much faster");
});

test("the motor ladder only ever gets faster, the light only brighter", () => {
  const m = Shop.LINES.motor.tiers.map((t) => t.boost), l = Shop.LINES.light.tiers.map((t) => t.level);
  for (let i = 1; i < m.length; i++) { assert.ok(m[i] > m[i - 1]); assert.ok(l[i] > l[i - 1]); }
});

test("chisels add tips to the rack, and every tip sold is one the lathe can cut with", () => {
  const { shop } = setup(1e6);
  while (shop.next("chisels")) shop.buy("chisels");
  const tips = shop.tips();
  assert.ok(tips.length >= 5);
  for (const t of tips) assert.ok(Cut.TIPS[t], t + " is a lathe tip");
  assert.equal(new Set(tips).size, tips.length, "no tip twice");
});

test("a broken shop section in a save is repaired, not trusted", () => {
  const game = Save.newGame();
  game.shop = { owned: { light: 99, motor: -3, chisels: "x", laser: 2 }, spent: "lots" };
  const shop = Shop.createShop(game, { state: St.createState(game) });
  assert.equal(shop.level("light"), Shop.LINES.light.tiers.length - 1);
  assert.equal(shop.level("motor"), 0);
  assert.equal(shop.level("chisels"), 0);
  assert.equal(game.shop.owned.laser, undefined);
});

test("what was bought survives a save round trip", () => {
  const { game, shop } = setup(1000);
  shop.buy("light"); shop.buy("chisels");
  const store = Save.memoryStore();
  Save.write(store, game);
  const g2 = Save.load(store);
  const s2 = Shop.createShop(g2, { state: St.createState(g2) });
  assert.equal(s2.level("light"), 1);
  assert.deepEqual(s2.tips(), ["gouge", "skew", "parting"]);
});

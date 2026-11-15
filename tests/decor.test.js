// Decorations (decor.js), and the disco ball standing in for the work light (shop.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { playedGame } = require("./helpers.js");
const D = require("../src/js/decor.js");
const Shop = require("../src/js/shop.js");
const St = require("../src/js/state.js");
const Save = require("../src/js/save.js");

function setup(coins, game) {
  game = game || playedGame();
  if (coins != null) game.wallet.coins = coins;
  const state = St.createState(game);
  const decor = D.createDecor(game, { state });
  const shop = Shop.createShop(game, { state, owns: decor.owns });
  return { game, state, decor, shop };
}

test("five decorations, the disco ball at 2,500, each with copy and no em dashes", () => {
  assert.deepEqual(D.ORDER.slice().sort(), ["cat", "disco", "radio", "string_lights", "trophy_wall"]);
  assert.equal(D.ITEMS.disco.price, 2500);
  for (const id of Object.keys(D.ITEMS)) { const it = D.ITEMS[id]; assert.ok(it.name && it.blurb && it.price > 0, id); assert.ok(!/—/.test(it.name + it.blurb), id); }
});

test("each is bought once, with coins, and only with enough", () => {
  const { decor, state } = setup(500);
  assert.equal(decor.buy("cat").reason, "not enough coins");
  assert.equal(decor.owns("cat"), false);
  assert.ok(decor.buy("radio").ok);
  assert.equal(state.wallet.balance("coins"), 200);
  assert.equal(decor.buy("radio").reason, "owned");
  assert.equal(decor.buy("nope").reason, "no such item");
});

test("the radio turns on and off, only once bought, and remembers", () => {
  const store = Save.memoryStore();
  const { decor, game } = setup(1000);
  assert.equal(decor.setRadio(true), false, "no radio yet");
  decor.buy("radio");
  assert.equal(decor.setRadio(true), true);
  assert.equal(decor.radioOn(), true);
  Save.write(store, game);
  assert.equal(setup(null, Save.load(store)).decor.radioOn(), true);
  decor.setRadio(false);
  assert.equal(decor.radioOn(), false);
  assert.deepEqual(D.normalize({ owned: ["cat", "cat", "bogus"], radio: true }), { owned: ["cat"], radio: false }, "a radio can't be on without the radio");
});

test("the disco ball can be picked as the light, and a lamp picked back", () => {
  const { decor, shop } = setup(10000);
  shop.buy("light");
  assert.equal(shop.use("light", "disco").reason, "not owned");
  assert.deepEqual(shop.decorTiers("light"), []);
  decor.buy("disco");
  assert.deepEqual(shop.decorTiers("light").map((d) => d.id), ["disco"]);
  assert.ok(shop.use("light", "disco").ok);
  assert.equal(shop.discoOn(), true);
  assert.equal(shop.current("light").name, "Disco ball");
  assert.equal(shop.activeLevel("light"), -1);
  assert.equal(shop.lightLevel(), 0);
  assert.equal(shop.level("light"), 1, "the halogen is still owned");
  assert.ok(shop.use("light", 1).ok);
  assert.equal(shop.discoOn(), false);
  assert.equal(shop.lightLevel(), 1);
  // buying a new lamp takes the light back from the disco ball
  shop.use("light", "disco"); shop.buy("light");
  assert.equal(shop.discoOn(), false); assert.equal(shop.lightLevel(), 2);
  // only the light has a disco option
  assert.equal(shop.use("motor", "disco").reason, "not owned");
});

test("the disco light survives a reload; without the ball it falls back to the best lamp", () => {
  const store = Save.memoryStore();
  const s = setup(10000);
  s.shop.buy("light"); s.decor.buy("disco"); s.shop.use("light", "disco");
  Save.write(store, s.game);
  const again = setup(null, Save.load(store));
  assert.equal(again.shop.discoOn(), true);
  const g = Save.load(store); g.decor = { owned: [] };
  const bare = setup(null, g);
  assert.equal(bare.shop.discoOn(), false);
  assert.equal(bare.shop.lightLevel(), 1);
  assert.equal(bare.shop.activeLevel("light"), 1);
});

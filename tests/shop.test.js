// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { playedGame } = require("./helpers.js");
const Shop = require("../src/js/shop.js");
const St = require("../src/js/state.js");
const Save = require("../src/js/save.js");
const Cut = require("../src/js/cutting.js");

function setup(coins) {
  const game = playedGame();
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
  assert.ok(shop.cutBoost() < 0.5, "the stock motor is weak: " + shop.cutBoost());
  assert.deepEqual(shop.tips(), ["gouge", "skew", "sand"], "the sandpaper is on the rack from the start");
  assert.deepEqual(shop.grit(), Shop.LINES.abrasives.tiers[0].grit, "80 grit");
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
  assert.ok(shop.cutBoost() / Shop.LINES.motor.tiers[0].boost > 2.5, "the best motor cuts far faster than the stock one");
});

test("the motor ladder only ever gets faster, the light only brighter", () => {
  const m = Shop.LINES.motor.tiers.map((t) => t.boost), l = Shop.LINES.light.tiers.map((t) => t.level);
  for (let i = 1; i < m.length; i++) {
    assert.ok(l[i] > l[i - 1]);
    const step = m[i] / m[i - 1];
    assert.ok(step > 1.3 && step < 1.7, `motor rung ${i} is a smooth step up (${step.toFixed(2)}x)`);
  }
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
  const game = playedGame();
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
  assert.deepEqual(s2.tips(), ["gouge", "skew", "parting", "sand"]);
});

// ---------- brushes and finishing ----------
const P = require("../src/js/paint.js");
/* One slow sweep across the middle of the piece with a tool, like a player's pass. */
function sweep(kind, tool, secs = 1.2) {
  const c = new P.Coating(), steps = Math.round(secs * 60);
  for (let k = 0; k < steps; k++) {
    const t = 0.3 + 0.4 * (k / steps);
    if (kind === "spray") c.spray(t, 0.8, 1 / 60, tool); else c.brush(t, 0.8, kind, "cobalt", 1 / 60, tool);
  }
  return c;
}
function spread(arr, a, b) {   // how uneven a stretch is: max minus min
  let lo = 1, hi = 0;
  for (let i = a; i < b; i++) { lo = Math.min(lo, arr[i]); hi = Math.max(hi, arr[i]); }
  return hi - lo;
}

test("the stock brush and spray bottle behave exactly as before the store sold better ones", () => {
  const shop = setup().shop;
  const a = sweep("brush", null), b = sweep("brush", shop.brush());
  assert.deepEqual(Array.from(a.coat), Array.from(b.coat));
  const s1 = sweep("spray", null), s2 = sweep("spray", shop.spray());
  assert.deepEqual(Array.from(s1.gloss), Array.from(s2.gloss));
});

test("every brush and sprayer rung does more than the last", () => {
  const B = Shop.LINES.brushes.tiers, F = Shop.LINES.finish.tiers;
  for (let i = 1; i < B.length; i++) {
    assert.ok(sweep("brush", B[i].brush, 0.25).coverage() > sweep("brush", B[i - 1].brush, 0.25).coverage(), B[i].name + " paints faster");
    assert.ok(sweep("liner", B[i].brush, 0.25).coverage() > sweep("liner", B[i - 1].brush, 0.25).coverage(), B[i].name + " loads the liner more");
  }
  for (let i = 1; i < F.length; i++) assert.ok(sweep("spray", F[i].spray, 0.4).avgGloss() > sweep("spray", F[i - 1].spray, 0.4).avgGloss(), F[i].name + " builds sheen faster");
});

test("the wide pad brush covers a wider band; the liner stays a thin line", () => {
  const top = Shop.LINES.brushes.tiers.at(-1).brush;
  const width = (c) => Array.from(c.coat).filter((v) => v > 0.05).length;
  const one = (kind, tool) => { const c = new P.Coating(); c.brush(0.5, 1, kind, "ink", 0.05, tool); return c; };
  assert.ok(width(one("brush", top)) > width(one("brush", null)) * 1.2, "wider brush band");
  assert.equal(width(one("liner", top)), width(one("liner", null)), "the liner keeps its width");
});

test("a better sprayer's mist has a flat core: one pass lays an even band, not a blotch", () => {
  const F = Shop.LINES.finish.tiers;
  // one short burst in one place: how much of the misted band came out near the peak sheen
  const core = (gun) => {
    const c = new P.Coating();
    c.spray(0.5, 1, 0.1, gun);
    const g = Array.from(c.gloss), peak = Math.max(...g), wet = g.filter((v) => v > 0.02 * peak).length;
    return g.filter((v) => v >= 0.9 * peak).length / wet;
  };
  for (let i = 1; i < F.length; i++) assert.ok(core(F[i].spray) > core(F[i - 1].spray), `${F[i].name} is more even than ${F[i - 1].name} (${core(F[i].spray).toFixed(2)} vs ${core(F[i - 1].spray).toFixed(2)})`);
});

test("a save from before brushes and finishing were sold starts them at the stock tier", () => {
  const s = Shop.normalizeShop({ owned: { light: 2, motor: 1, chisels: 3 }, spent: 999 });
  assert.equal(s.owned.brushes, 0);
  assert.equal(s.owned.finish, 0);
  assert.equal(s.owned.light, 2);
});

// ---------- sandpaper ----------
test("sandpaper is one line of grits, upgraded in place: 80 free, then 150, 240 and 320 grit", () => {
  const t = Shop.LINES.abrasives.tiers;
  assert.deepEqual(t.map((x) => x.name), ["80 grit", "150 grit", "240 grit", "320 grit"]);
  assert.deepEqual(t.map((x) => x.price), [0, 75, 300, 1000]);
  const cheapest = Math.min(...Shop.LINE_ORDER.map((k) => Shop.LINES[k].tiers[1].price));
  assert.equal(cheapest, 75, "150 grit is the cheapest upgrade in the store");
  for (let i = 1; i < t.length; i++) {
    assert.ok(t[i].grit.floor < t[i - 1].grit.floor, "finer grit, smoother floor");
    assert.ok(t[i].grit.rate > t[i - 1].grit.rate && t[i].grit.smooth > t[i - 1].grit.smooth, "and faster");
  }
  assert.deepEqual(t.map((x) => x.grit.floor), [0.35, 0.22, 0.12, 0.05]);
  const { shop } = setup(1000);
  assert.ok(shop.buy("abrasives").ok);
  assert.equal(shop.grit().floor, 0.22);
  assert.deepEqual(shop.tips().filter((k) => k === "sand"), ["sand"], "still one sheet on the rack");
});

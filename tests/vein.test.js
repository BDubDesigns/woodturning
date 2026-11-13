// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/js/vein.js");
const C = V.VCFG;

/* A swipe from (x0, y0) to (x1, y1) over `secs` seconds, in `n` moves. */
function swipe(v, x0, y0, x1, y1, secs, n = 12, t0 = 0) {
  const evs = [];
  v.pointerDown(x0, y0, t0);
  for (let i = 1; i <= n; i++) {
    const e = v.pointerMove(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, t0 + secs * i / n);
    if (e) evs.push(e);
  }
  v.pointerUp();
  return evs;
}

test("a vein is a closed lump with its diamonds set inside it", () => {
  const v = V.createVein({ seed: 42 });
  assert.equal(v.outline.length, C.SIDES);
  assert.equal(v.crystals.length, C.CRYSTALS);
  for (const c of v.crystals) assert.ok(v.inside(c.x, c.y), "crystal inside the rock");
  assert.ok(v.inside(0, 0));
  assert.ok(!v.inside(1.5, 0) && !v.inside(0, 1.3));
  assert.equal(V.createVein({ seed: 1, crystals: 3 }).crystals.length, 3, "the host sets how many diamonds show");
});

test("the same seed makes the same vein", () => {
  const a = V.createVein({ seed: 9 }), b = V.createVein({ seed: 9 });
  assert.deepEqual(a.outline, b.outline);
  assert.deepEqual(a.crystals, b.crystals);
});

test("a fast swipe across the rock is one strike that opens a crack where it entered", () => {
  const v = V.createVein({ seed: 3 });
  const evs = swipe(v, -1.6, 0.1, 1.6, -0.1, 0.25);
  assert.equal(evs.length, 1, "one strike per pass");
  const e = evs[0];
  assert.equal(e.type, "strike");
  assert.ok(e.x < -0.6, "landed on the near rim, where the swipe came in");
  assert.ok(e.power > 0.5 && e.damage > C.DMG_MIN);
  assert.ok(v.hp < C.HP);
  assert.ok(v.cracks.length >= 1);
  const c = v.cracks[0];
  assert.deepEqual(c.pts[0], [e.x, e.y]);
  assert.ok(c.pts.length >= 3, "the crack runs into the rock");
  for (const p of c.pts) assert.ok(v.inside(p[0], p[1]), "cracks stay on the rock");
});

test("faster swings hit harder, within the stated range", () => {
  const slow = V.createVein({ seed: 5 }).strike(0, 0, 1, 0, C.MIN_SPEED);
  const fast = V.createVein({ seed: 5 }).strike(0, 0, 1, 0, C.FULL_SPEED * 3);
  assert.equal(slow.damage, C.DMG_MIN);
  assert.equal(fast.damage, C.DMG_MAX);
});

test("a slow drag across the rock only tinks: no damage", () => {
  const v = V.createVein({ seed: 4 });
  const evs = swipe(v, -1.6, 0, 1.6, 0, 6, 40);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, "tink");
  assert.equal(v.hp, C.HP);
  assert.equal(v.cracks.length, 0);
});

test("a swipe that starts on the rock strikes once it gets moving", () => {
  const v = V.createVein({ seed: 6 });
  const evs = swipe(v, 0, 0, 1.6, 0, 0.15);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, "strike");
});

test("back and forth in one touch strikes on every pass, not every frame", () => {
  const v = V.createVein({ seed: 8 });
  let t = 0, hits = 0;
  v.pointerDown(-1.6, 0, t);
  for (let pass = 0; pass < 3; pass++) {
    const from = pass % 2 ? 1.6 : -1.6, to = -from;
    for (let i = 1; i <= 12; i++) { t += 0.02; const e = v.pointerMove(from + (to - from) * i / 12, 0, t); if (e && e.type === "strike") hits++; }
  }
  assert.equal(hits, 3);
});

test("older cracks creep with every strike", () => {
  const v = V.createVein({ seed: 12 });
  v.strike(-0.9, 0, 1, 0, C.MIN_SPEED);
  const first = v.cracks[0], len0 = first.pts.length, w0 = first.width;
  v.strike(0.9, 0.2, -1, 0, C.FULL_SPEED);
  assert.ok(first.width > w0, "it widens");
  assert.ok(first.pts.length >= len0, "it grows (or has already run to the rim)");
  assert.ok(v.cracks.length <= C.MAX_CRACKS);
});

test("enough strikes break the vein, exactly once, and then it ignores input", () => {
  const v = V.createVein({ seed: 2 });
  let broke = 0, n = 0, t = 0;
  while (!v.broken && n < 40) {
    const evs = swipe(v, n % 2 ? 1.6 : -1.6, 0.2 * ((n % 3) - 1), n % 2 ? -1.6 : 1.6, 0, 0.2, 12, t);
    t += 1; n++;
    broke += evs.filter((e) => e.broke).length;
  }
  assert.ok(v.broken);
  assert.equal(broke, 1);
  assert.ok(n >= Math.ceil(C.HP / C.DMG_MAX) && n <= Math.ceil(C.HP / C.DMG_MIN), `took ${n} swings`);
  assert.equal(v.hp, 0);
  assert.equal(v.progress(), 1);
  assert.equal(swipe(v, -1.6, 0, 1.6, 0, 0.2).length, 0);
});

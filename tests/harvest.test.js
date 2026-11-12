// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../src/js/cutting.js");
const L = require("../src/js/harvest.js");
const H = L.HCFG;

/* A scripted gesture: world-space points visited over `dur` seconds, ~60 Hz. */
let clock = 0;
function gesture(h, pts, dur) {
  const n = Math.max(2, Math.round(dur * 60)), dt = dur / n;
  const at = (k) => {
    const f = (k / n) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), r = f - i;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r];
  };
  let p = at(0);
  h.pointerDown(p[0], p[1], clock);
  for (let k = 1; k <= n; k++) {
    clock += dt; p = at(k);
    h.pointerMove(p[0], p[1], clock);
    h.step(dt);
  }
  h.pointerUp(clock);
  clock += 0.05;
}
/* A swing into the trunk from one side at height y, going `reach` past the bark. */
function swing(h, side, y, reach, dur) {
  const w = h.trunk.widthAt(y) / 2;
  gesture(h, [[side * (w + 0.5), y], [side * (w - reach), y]], dur == null ? 0.16 : dur);
}
function run(h, secs) { for (let t = 0; t < secs; t += 1 / 60) h.step(1 / 60); }
function chopDown(h, y) {
  let n = 0;
  while (h.phase === "chop" && n++ < 60) swing(h, -1, y, 1.25);
  return n;
}
function newHarvest(seed) { const h = new L.Harvest(seed); clock = 0; return h; }

/* ---------------- chopping ---------------- */

test("a swing cuts where the finger is, not elsewhere", () => {
  const h = newHarvest(7), tr = h.trunk;
  swing(h, -1, 2.0, 0.6);
  let best = 0, bi = 0;
  for (let i = 0; i < tr.n; i++) if (tr.left[i] > best) { best = tr.left[i]; bi = i; }
  assert.ok(best > 0.08, "swing left a notch, depth " + best);
  assert.ok(Math.abs(bi * tr.dh - 2.0) < 0.1, "deepest at h=" + (bi * tr.dh).toFixed(2));
  for (let i = 0; i < tr.n; i++) if (Math.abs(i * tr.dh - 2.0) > 0.7) assert.equal(tr.left[i], 0, "no cut far from the finger at slice " + i);
  assert.ok(tr.right.every((v) => v === 0), "the far side is untouched");
});

test("swings from the right cut the right side", () => {
  const h = newHarvest(7);
  swing(h, 1, 1.4, 0.6);
  assert.ok(Math.max.apply(null, h.trunk.right) > 0.08);
  assert.ok(h.trunk.left.every((v) => v === 0));
});

test("a one-sided cut has to go most of the way through; a swing that stops short never fells it", () => {
  const h = newHarvest(7);
  for (let k = 0; k < 20; k++) swing(h, -1, 1.2, 0.6);
  assert.equal(h.phase, "chop");
  assert.ok(Math.max.apply(null, h.trunk.left) <= 0.6 + 1e-6);
});

test("a swing only bites as deep as the finger travels in", () => {
  const a = newHarvest(7), b = newHarvest(7);
  swing(a, -1, 2, 0.05);
  swing(b, -1, 2, 0.8);
  const da = Math.max.apply(null, a.trunk.left), db = Math.max.apply(null, b.trunk.left);
  assert.ok(da < 0.07, "shallow swing cut " + da);
  assert.ok(db > da + 0.05, "deep swing cut " + db);
});

test("one swing is capped: it takes a run of swings, not one", () => {
  const h = newHarvest(7);
  swing(h, -1, 2, 1.0);
  const d1 = Math.max.apply(null, h.trunk.left);
  assert.ok(d1 <= H.CAP + 1e-6, "first swing depth " + d1);
  swing(h, -1, 2, 1.0);
  const d2 = Math.max.apply(null, h.trunk.left);
  assert.ok(d2 > d1 + 0.05, "a second swing goes deeper, " + d2);
  assert.equal(h.phase, "chop");
});

test("a slow drag only rests on the bark, a swing bites", () => {
  const slow = newHarvest(7), fast = newHarvest(7);
  gesture(slow, [[-1.1, 2], [-0.1, 2]], 2.5);
  swing(fast, -1, 2, 0.8);
  assert.ok(Math.max.apply(null, slow.trunk.left) < 0.02, "slow drag cut " + Math.max.apply(null, slow.trunk.left));
  assert.ok(Math.max.apply(null, fast.trunk.left) > 0.08);
});

test("swings outside the choppable stretch do not cut, the crown rustles", () => {
  const h = newHarvest(7);
  swing(h, -1, H.CHOP_MAX + 1.5, 0.6);
  assert.ok(h.trunk.left.every((v) => v === 0));
  assert.ok(h.drain().some((e) => e.type === "rustle"));
});

test("cuts are smooth: the notch has no steps", () => {
  const h = newHarvest(7);
  for (let k = 0; k < 3; k++) swing(h, -1, 2.0, 0.9);
  const l = h.trunk.left;
  let maxStep = 0;
  for (let i = 1; i < l.length; i++) maxStep = Math.max(maxStep, Math.abs(l[i] - l[i - 1]));
  assert.ok(maxStep < 0.12, "largest step between slices " + maxStep);
});

test("the tree falls after enough swings, not before", () => {
  const h = newHarvest(7);
  let swings = 0;
  while (h.phase === "chop" && swings < 60) { swing(h, -1, 1.2, 1.25); swings++; }
  assert.ok(swings >= 5, "felled in " + swings + " swings, too few");
  assert.ok(swings <= 14, "felled in " + swings + " swings, too many");
  assert.equal(h.phase, "crack");
  const ev = h.drain().filter((e) => e.type === "crack");
  assert.ok(ev.length >= 1, "it cracks audibly");
});

test("it falls the way you cut", () => {
  const l = newHarvest(11); chopDown(l, 1.0);
  assert.equal(l.dir, -1);
  const r = newHarvest(11);
  let n = 0; while (r.phase === "chop" && n++ < 60) swing(r, 1, 1.0, 1.25);
  assert.equal(r.dir, 1);
});

test("cutting from both sides works too, and the hinge always holds until the end", () => {
  const h = newHarvest(21);
  let n = 0;
  while (h.phase === "chop" && n < 60) {
    swing(h, n % 2 ? 1 : -1, 1.6, 1.0); n++;
    const wk = h.trunk.weakest();
    if (h.phase === "chop") assert.ok(h.trunk.remaining(wk.i) > H.HINGE * h.trunk.W[wk.i] - 1e-6);
  }
  assert.equal(h.phase, "crack");
});

test("chopping low leaves a longer log than chopping high", () => {
  const lo = newHarvest(5); chopDown(lo, 0.8);
  const hi = newHarvest(5); chopDown(hi, 3.0);
  assert.ok(H.TRUNK_H - lo.hStar > H.TRUNK_H - hi.hStar);
  assert.ok(Math.abs(lo.hStar - 0.8) < 0.25, "broke at " + lo.hStar);
  assert.ok(Math.abs(hi.hStar - 3.0) < 0.25, "broke at " + hi.hStar);
});

/* ---------------- the fall ---------------- */

test("the fall settles lying flat on the ground, in the direction it was cut", () => {
  for (const hs of [0.6, 1.5, 3.0]) {
    const f = L.simulateFall(hs);
    const last = f.frames[f.frames.length - 1];
    assert.ok(Math.abs(last.phi - Math.PI / 2) < 1e-6, "flat at hStar " + hs);
    assert.ok(Math.abs(last.by - H.GROUND) < 1e-6);
    assert.ok(f.duration > 1.5 && f.duration < 4, "takes " + f.duration.toFixed(2) + "s");
    assert.ok(f.events.some((e) => e.type === "thud"), "lands with a thud");
    for (const fr of f.frames) assert.ok(fr.by >= H.GROUND - 0.02, "never through the ground");
    // it leans slowly at first and speeds up: not a linear tween
    const early = f.frames.find((fr) => fr.t > 0.25), rel = f.events.find((e) => e.type === "release");
    assert.ok(early.phi < 0.25, "slow start, lean " + early.phi);
    assert.ok(rel.t > 0.8, "lets go at " + rel.t);
  }
});

test("felled tree plays the fall out and lands as a log with limbs", () => {
  const h = newHarvest(7); chopDown(h, 1.2);
  assert.equal(h.phase, "crack");
  let t = 0, sawFall = false;
  while (h.phase !== "delimb" && t < 10) { h.step(1 / 60); t += 1 / 60; if (h.phase === "fall") sawFall = true; }
  assert.ok(sawFall);
  assert.equal(h.phase, "delimb");
  assert.ok(h.log && h.log.len > 4, "log length " + h.log.len);
  assert.ok(h.limbs.length >= 3 && h.limbs.length <= 9, "limbs " + h.limbs.length);
  const ev = h.drain().map((e) => e.type);
  assert.ok(ev.includes("thud") && ev.includes("landed"));
  // every remaining limb sticks up from the log, none into the ground
  for (const l of h.limbs) for (const p of l.wp) assert.ok(p.y >= H.GROUND - 1e-6, "limb point above the axis");
});

/* ---------------- delimbing ---------------- */

function felled(seed, y) {
  const h = newHarvest(seed); chopDown(h, y || 1.2);
  let t = 0; while (h.phase !== "delimb" && t < 10) { h.step(1 / 60); t += 1 / 60; }
  return h;
}
/* A slash straight down across a limb at arc position s. */
function slash(h, limb, s, dur) {
  const p = h._pointAt(limb, s), q = h._pointAt(limb, Math.min(limb.b.len, s + 0.1)), r = h._pointAt(limb, Math.max(0, s - 0.1));
  let tx = q.x - r.x, ty = q.y - r.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
  gesture(h, [[p.x - ty * 0.4, p.y + tx * 0.4], [p.x + ty * 0.4, p.y - tx * 0.4]], dur == null ? 0.1 : dur);
}

test("a slash across a limb cuts it there; the outer part comes away", () => {
  const h = felled(7);
  const limb = h.limbs.find((l) => l.b.t0 < 0.13 && !l.b.leader) || h.limbs[0];
  const before = limb.stub;
  slash(h, limb, 0.7 * limb.b.len);
  slash(h, limb, 0.7 * limb.b.len);
  assert.ok(limb.stub < before, "stub shortened to " + limb.stub);
  assert.ok(Math.abs(limb.stub - 0.7 * limb.b.len) < 0.05, "cut where the blade crossed");
  assert.ok(limb.alive, "a stub is left, not clean yet");
  assert.ok(h.pieces.length >= 1, "the cut-off part falls");
});

test("a swipe that misses the limb does nothing", () => {
  const h = felled(7);
  const limb = h.limbs[0];
  const p = h._pointAt(limb, limb.b.len * 0.5);
  gesture(h, [[p.x + 1.5, p.y + 0.6], [p.x + 2.2, p.y - 0.6]], 0.1);
  assert.equal(limb.stub, limb.b.len);
});

test("thick limbs take more than one slash", () => {
  const h = felled(7);
  const limb = h.limbs.slice().sort((a, b) => b.b.t0 - a.b.t0)[0];
  slash(h, limb, 0.15 * limb.b.len);
  assert.ok(limb.stub === limb.b.len, "one slash does not get through t0=" + limb.b.t0.toFixed(2));
  let n = 1;
  while (limb.stub === limb.b.len && n < 8) { slash(h, limb, 0.15 * limb.b.len); n++; }
  assert.ok(n >= 2 && n <= 5, "took " + n + " slashes");
});

test("a cut flush with the log cleans the limb; cleaning them all moves on to the saw", () => {
  const h = felled(7);
  let guard = 0;
  while (h.phase === "delimb" && guard++ < 80) {
    const limb = h.limbs.find((l) => l.alive);
    slash(h, limb, Math.min(limb.stub * 0.9, 0.1), 0.1);
  }
  assert.equal(h.limbsLeft(), 0);
  assert.equal(h.phase, "saw");
  assert.ok(h.drain().some((e) => e.type === "cleaned"));
});

test("a stub cut short of flush can be cut again until it is clean", () => {
  const h = felled(7);
  const limb = h.limbs[0];
  for (let k = 0; k < 6 && limb.stub === limb.b.len; k++) slash(h, limb, 0.6 * limb.b.len);
  assert.ok(limb.alive && limb.stub < limb.b.len);
  let n = 0;
  while (limb.alive && n++ < 12) slash(h, limb, Math.min(0.1, limb.stub * 0.8));
  assert.ok(!limb.alive, "clean after more cuts");
});

/* ---------------- sawing ---------------- */

function cleaned(seed) {
  const h = felled(seed);
  let guard = 0;
  while (h.phase === "delimb" && guard++ < 120) {
    const limb = h.limbs.find((l) => l.alive);
    slash(h, limb, Math.min(limb.stub * 0.9, 0.1), 0.1);
  }
  run(h, 0.1);
  return h;
}
/* Rub back and forth across the log at u: `strokes` strokes of `span` log widths. */
function rub(h, u, strokes, span) {
  const d = h.log.radiusAt(u) * 2, pts = [[u, -span * d / 2]];
  for (let s = 0; s < strokes; s++) pts.push([u, (s % 2 ? -1 : 1) * span * d / 2]);
  gesture(h, pts, 0.28 * strokes);
}

test("rubbing back and forth deepens the kerf where the finger is", () => {
  const h = cleaned(7), u = h.log.len * 0.3;
  rub(h, u, 4, 1.0);
  const k = h.saw.kerfs[0];
  assert.ok(k, "a kerf was started");
  assert.ok(Math.abs(k.u - u) < 1e-6, "at the finger");
  assert.ok(k.prog > 0.2 && k.prog < 0.6, "four strokes got to " + k.prog);
  assert.ok(!k.done);
});

test("one long drag is only one stroke: it takes rubbing", () => {
  const h = cleaned(7), u = h.log.len * 0.3, d = h.log.radiusAt(u) * 2;
  gesture(h, [[u, -3 * d], [u, 3 * d]], 1.0);
  const k = h.saw.kerfs[0];
  assert.ok(k.prog <= H.SAW_GAIN * H.SAW_STROKE_CAP + 1e-6, "a single drag got to " + k.prog);
  assert.ok(!k.done);
});

test("wobbling the finger without really rubbing does not cut", () => {
  const h = cleaned(7), u = h.log.len * 0.3, d = h.log.radiusAt(u) * 2;
  const pts = [[u, 0]];
  for (let i = 0; i < 30; i++) pts.push([u, (i % 2 ? 0.04 : -0.04) * d]);
  gesture(h, pts, 3);
  assert.ok(!h.saw.kerfs[0] || h.saw.kerfs[0].prog < 0.1);
});

test("a kerf stays where it was started even if the finger wanders along the log", () => {
  const h = cleaned(7), u = h.log.len * 0.3, d = h.log.radiusAt(u) * 2;
  gesture(h, [[u, -d / 2], [u + 0.1, d / 2], [u - 0.1, -d / 2], [u + 0.1, d / 2]], 0.8);
  assert.equal(h.saw.kerfs.length, 1);
  assert.equal(h.saw.kerfs[0].u, u);
});

test("cuts cannot start too close to the ends or to each other", () => {
  const h = cleaned(7), Lg = h.log.len;
  assert.equal(h.sawCheck(Lg * 0.02), "end");
  assert.equal(h.sawCheck(Lg * 0.98), "end");
  assert.equal(h.sawCheck(Lg * 0.5), null);
  rub(h, Lg * 0.3, 14, 1.0);
  assert.ok(h.saw.kerfs[0].done, "first cut through");
  assert.equal(h.sawCheck(Lg * 0.4), "close");
  assert.equal(h.sawCheck(Lg * 0.7), null);
  // a refused start does nothing
  const d = h.log.radiusAt(Lg * 0.4) * 2;
  gesture(h, [[Lg * 0.4, -d], [Lg * 0.4, d], [Lg * 0.4, -d], [Lg * 0.4, d]], 0.8);
  assert.equal(h.saw.kerfs.length, 1);
  assert.ok(h.drain().some((e) => e.type === "refuse"));
});

test("two cuts through give a blank the lathe can load and cut", () => {
  const h = cleaned(7), Lg = h.log.len;
  rub(h, Lg * 0.28, 14, 1.0);
  assert.equal(h.phase, "saw");
  rub(h, Lg * 0.72, 14, 1.0);
  assert.equal(h.phase, "done");
  const b = h.blank;
  assert.ok(b && b.profile.length === C.CFG.SEG);
  assert.ok(Math.abs(b.lengthRatio - 0.44) < 0.02, "middle piece is " + b.lengthRatio);
  const w = new C.Workpiece();
  w.load(b);
  assert.equal(w.blank, b);
  let mx = 0, mn = 9;
  for (let i = 0; i < w.radius.length; i++) { mx = Math.max(mx, w.radius[i]); mn = Math.min(mn, w.radius[i]); }
  assert.ok(mx <= C.CFG.R0 + 1e-6 && mx > C.CFG.R0 * 0.9, "widest " + mx);
  assert.ok(mn > C.CFG.R0 * 0.65, "no thin spots " + mn);
  assert.ok(w.removedFraction() === 0 && w.startVol > 0);
  // and it cuts like any other blank
  const before = w.radius[120];
  for (let s = 0; s < 1.2; s += 1 / 60) w.cut(0.5, 1, "gouge", 1 / 60);
  assert.ok(w.radius[120] < before - 0.1, "the lathe cuts the harvested blank");
});

test("the blank follows the log: a thick butt makes a thicker piece than the top", () => {
  const h = cleaned(7), Lg = h.log.len;
  const a = L.makeBlank(h.log, Lg * 0.1, Lg * 0.4), b = L.makeBlank(h.log, Lg * 0.6, Lg * 0.9);
  assert.ok(a.girthUnits > b.girthUnits, a.girthUnits + " vs " + b.girthUnits);
  assert.ok(a.profile[120] <= C.CFG.R0 && b.profile[120] <= C.CFG.R0);
});

test("a third kerf start replaces the shallowest unfinished one, never a finished one", () => {
  const h = cleaned(7), Lg = h.log.len;
  rub(h, Lg * 0.2, 14, 1.0);
  assert.ok(h.saw.kerfs[0].done);
  rub(h, Lg * 0.6, 2, 1.0);
  rub(h, Lg * 0.85, 2, 1.0);
  assert.equal(h.saw.kerfs.length, 2);
  assert.ok(h.saw.kerfs[0].done && h.saw.kerfs[0].u === Lg * 0.2);
});

test("every tree can be played through to a blank, whichever way it falls", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const h = newHarvest(seed);
    const side = seed % 2 ? -1 : 1, y = 0.9 + (seed % 5) * 0.5;
    let n = 0;
    while (h.phase === "chop" && n++ < 60) swing(h, side, y, 1.3);
    assert.equal(h.dir, side, "seed " + seed + " falls toward the cut");
    let t = 0; while (h.phase !== "delimb" && t < 10) { h.step(1 / 60); t += 1 / 60; }
    assert.equal(h.phase, "delimb", "seed " + seed + " lands");
    assert.ok(h.limbs.length >= 3, "seed " + seed + " has limbs to clear");
    let g = 0;
    while (h.phase === "delimb" && g++ < 100) {
      const limb = h.limbs.find((l) => l.alive);
      slash(h, limb, Math.min(limb.stub * 0.9, 0.1), 0.1);
    }
    assert.equal(h.phase, "saw", "seed " + seed + " is cleaned");
    rub(h, h.log.len * 0.27, 14, 1.0);
    rub(h, h.log.len * 0.74, 14, 1.0);
    assert.equal(h.phase, "done", "seed " + seed + " is sawn");
    assert.ok(h.blank.lengthRatio > 0.4 && h.blank.lengthRatio < 0.5);
  }
});

test("a harvest is deterministic from its seed", () => {
  const a = L.makeTree(99), b = L.makeTree(99), c = L.makeTree(100);
  assert.deepEqual(a.branches.map((x) => x.y), b.branches.map((x) => x.y));
  assert.notDeepEqual(a.branches.map((x) => x.y), c.branches.map((x) => x.y));
});

/* ---------------- house rules ---------------- */

test("no em dashes in the game's source copy", () => {
  const dir = path.join(__dirname, "..", "src");
  const files = [path.join(dir, "index.html")].concat(
    fs.readdirSync(path.join(dir, "js")).map((f) => path.join(dir, "js", f)));
  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8");
    assert.ok(!/[—–]/.test(txt), "em/en dash in " + path.relative(dir, f));
  }
});

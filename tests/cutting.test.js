// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/js/cutting.js");

const DT = 1 / 60;
const N = L.CFG.SEG;
const idx = (t) => Math.round(t * (N - 1));

function fresh() {
  const w = new L.Workpiece();
  w.reset(0);
  return w;
}
function dwell(w, t, p, tip, seconds, rpm) {
  let removed = 0;
  for (let s = 0; s < seconds; s += DT) removed += w.cut(t, p, tip, DT, 1, rpm);
  return removed;
}
function sweep(w, t0, t1, p, tip, seconds) {
  const steps = Math.max(1, Math.round(seconds / DT));
  for (let k = 0; k <= steps; k++) w.cut(t0 + (t1 - t0) * (k / steps), p, tip, DT);
}
function depth(w, t) { return w.baseRadius[idx(t)] - w.radius[idx(t)]; }
/* Depth-weighted centre of everything cut away. */
function cutCentre(w) {
  let m = 0, mi = 0;
  for (let i = 0; i < N; i++) { const d = w.baseRadius[i] - w.radius[i]; m += d; mi += d * i; }
  return mi / m;
}
/* Fins and spikes: a peak sharper than a rounded bead. Measured as how
   far a peak stands above the chord two slices either side; a bead
   rounded to the tool's nose radius stands about 0.016 above it, a
   chewed cusp or knife-edge fin far more. */
const FIN = 0.025;
function finCount(r) {
  let fins = 0;
  for (let i = 4; i < N - 4; i++) {
    if (r[i] >= r[i - 1] && r[i] >= r[i + 1] && r[i] - 0.5 * (r[i - 2] + r[i + 2]) > FIN) fins++;
  }
  return fins;
}
/* A seeded sequence of overlapping cuts like a playtester roughing a shape. */
function roughOut(cutFn, passes) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < passes; k++) {
    const t0 = 0.12 + rnd() * 0.76, t1 = Math.min(0.88, Math.max(0.12, t0 + (rnd() - 0.5) * 0.3));
    cutFn(t0, t1, 0.3 + rnd() * 0.7, rnd() < 0.5 ? "gouge" : "skew", 0.2 + rnd() * 0.9);
  }
}
/* The Nov 12 prototype's removal, for comparison: integer centre, a 30%
   step at the kernel edge, depth from absolute finger height. */
function legacyRoughOut(passes) {
  const SEG = 120, r = new Float32Array(SEG), R0 = 1.05;
  for (let i = 0; i < SEG; i++) { const t = i / (SEG - 1); r[i] = R0 * (0.9 + 0.1 * Math.min(1, Math.min(t, 1 - t) * 10)); }
  const tips = { gouge: { hw: 8, rate: 0.42 }, skew: { hw: 3, rate: 0.62 } };
  const fall = (k, d) => { const hw = tips[k].hw; if (d >= hw) return 0; const u = d / hw;
    if (k === "gouge") { const c = Math.cos(u * Math.PI / 2); return c * c; } return u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45; };
  roughOut((t0, t1, p, tip, secs) => {
    const steps = Math.max(1, Math.round(secs / DT));
    for (let s = 0; s <= steps; s++) {
      const ci = Math.round((t0 + (t1 - t0) * s / steps) * (SEG - 1));
      const target = Math.max(0.14, R0 * 1.02 - p * 0.5 * 1.12), depth = r[ci] - target;
      if (depth <= 0) continue;
      for (let i = Math.max(2, ci - tips[tip].hw); i <= Math.min(SEG - 3, ci + tips[tip].hw); i++) {
        const w = fall(tip, Math.abs(i - ci)); if (w <= 0) continue;
        r[i] = Math.max(Math.max(0.14, r[i] - depth * w), r[i] - tips[tip].rate * (0.3 + 0.7 * w) * DT);
      }
    }
  }, passes);
  // resample to the new slice count so fins are measured on the same grid
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) { const x = i / (N - 1) * (SEG - 1), j = Math.min(SEG - 2, Math.floor(x)), f = x - j; out[i] = r[j] * (1 - f) + r[j + 1] * f; }
  return out;
}

/* ---------- pressure mapping ---------- */
test("touch-down is contact at zero pressure", () => {
  const p = new L.Pressure();
  p.down(500, 0);
  assert.equal(p.raw, 0);
  p.move(510, 0.1); // drifting down never adds pressure
  assert.equal(p.raw, 0);
});

test("first ~40px of upward travel ramps pressure to full", () => {
  const p = new L.Pressure();
  p.down(500, 0);
  p.move(490, 0.2); assert.ok(Math.abs(p.raw - 0.25) < 1e-9);
  p.move(480, 0.4); assert.ok(Math.abs(p.raw - 0.5) < 1e-9);
  p.move(460, 0.6); assert.equal(p.raw, 1);
  p.move(400, 0.8); assert.equal(p.raw, 1); // clamps, no need to travel further
});

test("backing off re-anchors so the next push starts where the finger is", () => {
  const p = new L.Pressure();
  p.down(500, 0);
  p.move(470, 0.3);          // pushed up 30px
  p.move(530, 0.6);          // pulled back below the touch point
  assert.equal(p.raw, 0);
  p.move(520, 0.9);          // 10px up from the new low point
  assert.ok(Math.abs(p.raw - 0.25) < 1e-9);
});

test("pressure eases in smoothly instead of jumping", () => {
  const p = new L.Pressure();
  p.down(500, 0);
  p.move(450, 1);
  p.update(DT);
  assert.ok(p.value > 0.1 && p.value < 0.6, "one frame in: " + p.value);
  for (let i = 0; i < 30; i++) p.update(DT);
  assert.ok(p.value > 0.99);
});

test("slamming straight to full in a few ms is a catch that knocks the tool back", () => {
  const p = new L.Pressure();
  p.down(500, 0);
  const caught = p.move(440, 0.016);
  assert.equal(caught, true);
  assert.equal(p.raw, 0);
  const q = new L.Pressure();
  q.down(500, 0);
  q.move(490, 0.1); q.move(475, 0.2);
  assert.equal(q.move(455, 0.3), false, "a deliberate push is not a catch");
});

/* ---------- cutting ---------- */
test("zero pressure on the surface does not cut", () => {
  const w = fresh();
  assert.equal(dwell(w, 0.5, 0, "gouge", 1), 0);
});

test("a short nudge cuts shallow, more pressure cuts deeper", () => {
  const a = fresh(), b = fresh(), c = fresh();
  dwell(a, 0.5, 0.2, "gouge", 2);
  dwell(b, 0.5, 0.6, "gouge", 2);
  dwell(c, 0.5, 1.0, "gouge", 2);
  const da = depth(a, 0.5), db = depth(b, 0.5), dc = depth(c, 0.5);
  assert.ok(da > 0.01, "nudge starts a cut: " + da);
  assert.ok(db > da * 1.8 && dc > db * 1.3, `depth grows with pressure: ${da} ${db} ${dc}`);
});

test("removal is rate-capped: a fast whip scores, a slow pass cuts deep", () => {
  const fast = fresh(), slow = fresh();
  sweep(fast, 0.2, 0.8, 1, "gouge", 0.12);
  sweep(slow, 0.2, 0.8, 1, "gouge", 16);
  const df = depth(fast, 0.5), ds = depth(slow, 0.5);
  assert.ok(df > 0 && df < 0.06, "fast whip only scores: " + df);
  assert.ok(ds > 0.25, "slow pass goes deep: " + ds);
});

test("one pass cannot cut through; deeper takes more passes; core is guarded", () => {
  const w = fresh();
  dwell(w, 0.5, 1, "gouge", 5);
  const one = depth(w, 0.5);
  assert.ok(one <= L.CFG.PASS_DEPTH + 0.06, "single pass limited: " + one);
  for (let pass = 0; pass < 12; pass++) { w.endPass(); dwell(w, 0.5, 1, "gouge", 2); }
  assert.ok(depth(w, 0.5) > one * 1.5, "more passes go deeper");
  for (const r of w.radius) assert.ok(r >= L.CFG.MIN_R - 1e-6);
});

test("the cut lands exactly where the chisel is", () => {
  for (const t of [0.15, 0.37, 0.5, 0.81]) {
    const w = fresh();
    dwell(w, t, 1, "skew", 1);
    const m = cutCentre(w);
    assert.ok(Math.abs(m - t * (N - 1)) < 0.75, `t=${t} cut centred at ${m}, expected ${t * (N - 1)}`);
  }
});

test("gouge cuts a wide rounded trough, skew a narrow flat groove", () => {
  const g = fresh(), s = fresh();
  dwell(g, 0.5, 1, "gouge", 3);
  dwell(s, 0.5, 1, "skew", 3);
  const width = (w) => { let c = 0; for (let i = 0; i < N; i++) if (w.baseRadius[i] - w.radius[i] > 0.02) c++; return c; };
  assert.ok(width(g) > width(s) * 2, `gouge ${width(g)} vs skew ${width(s)}`);
  // skew bottom is flat: several slices near the centre at the same depth
  const c = idx(0.5), d0 = depth(s, 0.5);
  for (let k = -2; k <= 2; k++) assert.ok(Math.abs((s.baseRadius[c + k] - s.radius[c + k]) - d0) < 0.01);
});

test("overlapping cuts blend into a smooth turned shape, not a sawtooth", () => {
  const w = fresh();
  roughOut((t0, t1, p, tip, secs) => { w.endPass(); sweep(w, t0, t1, p, tip, secs); }, 24);
  const removed = w.removedFraction();
  assert.ok(removed > 0.08 && removed < 0.6, "a real amount of wood came off: " + removed);
  const fins = finCount(w.radius), legacy = finCount(legacyRoughOut(24));
  assert.equal(fins, 0, "fins left on the piece");
  assert.ok(legacy >= 3, "the old model on the same cuts left fins (sanity check of the metric): " + legacy);
});

test("a groove between two cuts is rounded into a bead, not a knife edge", () => {
  const w = fresh();
  dwell(w, 0.45, 1, "skew", 1.5); w.endPass();
  dwell(w, 0.55, 1, "skew", 1.5); w.endPass();
  assert.equal(finCount(w.radius), 0);
  const c = idx(0.5), r = w.radius;
  assert.ok(r[c] > r[idx(0.45)] + 0.2, "the bead between the grooves survives");
});

test("light passes act as finishing cuts and plane a ridge down", () => {
  const w = fresh();
  dwell(w, 0.46, 1, "gouge", 1.5); w.endPass();
  dwell(w, 0.54, 1, "gouge", 1.5); w.endPass();
  const ridge = depth(w, 0.5);
  for (let k = 0; k < 3; k++) { sweep(w, 0.4, 0.6, 0.25, "gouge", 1.2); w.endPass(); }
  assert.ok(depth(w, 0.5) > ridge + 0.03, `ridge planed: ${ridge} -> ${depth(w, 0.5)}`);
  assert.equal(finCount(w.radius), 0);
});

test("dwelling never erodes past the pass depth (round-over is idempotent)", () => {
  const w = fresh();
  dwell(w, 0.5, 1, "skew", 2);
  const before = Array.from(w.radius);
  dwell(w, 0.5, 1, "skew", 3);
  let maxDelta = 0;
  for (let i = 0; i < N; i++) maxDelta = Math.max(maxDelta, before[i] - w.radius[i]);
  assert.ok(maxDelta < 1e-4, "kept eroding: " + maxDelta);
});

/* ---------- removal rate: RPM and pressure ---------- */
test("removal rate is base x RPM factor x pressure factor, all from config", () => {
  const C = L.CFG;
  assert.equal(L.rpmFactor(C.RPM_REF), 1);
  assert.equal(L.rpmFactor(), 1, "no rpm given means the default speed");
  assert.equal(L.rpmFactor(99999), L.rpmFactor(C.RPM_MAX), "rpm clamps to the slider range");
  assert.equal(L.rpmFactor(0), L.rpmFactor(C.RPM_MIN));
  assert.ok(Math.abs(L.pressureFactor(1) - 1) < 1e-12);
  assert.ok(Math.abs(L.pressureFactor(0) - C.PRESS_RATE_MIN) < 1e-12);
  const r = L.removalRate("gouge", 0.5, 1650);
  assert.ok(Math.abs(r - L.TIPS.gouge.rate * C.RATE_SCALE * L.rpmFactor(1650) * L.pressureFactor(0.5)) < 1e-12);
});

test("higher RPM takes wood off faster", () => {
  const lo = fresh(), mid = fresh(), hi = fresh();
  dwell(lo, 0.5, 1, "gouge", 0.5, 300);
  dwell(mid, 0.5, 1, "gouge", 0.5, 1100);
  dwell(hi, 0.5, 1, "gouge", 0.5, 2400);
  const a = depth(lo, 0.5), b = depth(mid, 0.5), c = depth(hi, 0.5);
  assert.ok(a > 0 && b > a * 2.5 && c > b * 1.6, `depth after 0.5s at 300/1100/2400 RPM: ${a} ${b} ${c}`);
});

test("pushing harder cuts faster, not only deeper", () => {
  // Early in a dwell neither has reached its pass depth, so this measures speed.
  const light = fresh(), hard = fresh();
  dwell(light, 0.5, 0.4, "skew", 0.2);
  dwell(hard, 0.5, 1, "skew", 0.2);
  const dl = depth(light, 0.5), dh = depth(hard, 0.5);
  assert.ok(dl > 0 && dh > dl * 2.5, `light ${dl} vs hard ${dh}`);
});

test("at the default speed a full-pressure pass takes a couple of seconds, not a blink", () => {
  const w = fresh();
  dwell(w, 0.5, 1, "gouge", 0.5);
  assert.ok(depth(w, 0.5) < L.CFG.PASS_DEPTH * 0.5, "half a second is well short of a full pass: " + depth(w, 0.5));
  dwell(w, 0.5, 1, "gouge", 3);
  assert.ok(depth(w, 0.5) > L.CFG.PASS_DEPTH * 0.85, "a steady dwell still reaches pass depth: " + depth(w, 0.5));
});

test("slow RPM with a light touch barely shaves", () => {
  const w = fresh();
  dwell(w, 0.5, 0.3, "gouge", 1, 200);
  const d = depth(w, 0.5);
  assert.ok(d > 0 && d < 0.02, "light slow cut: " + d);
});

/* ---------------- sanding and the surface ---------------- */
const CC = L.CFG, SEGN = CC.SEG;
function bumpy() {
  const w = new L.Workpiece();
  w.reset(0);
  for (let i = 0; i < SEGN; i++) w.radius[i] = CC.R0 * 0.8 + (i % 2 ? 0.012 : -0.012) + 0.006 * Math.sin(i * 0.9);
  w.baseRadius.set(w.radius); w.passRef.set(w.radius);
  return w;
}
function variance(w, lo, hi) {
  let s = 0, n = 0;
  for (let i = lo; i <= hi; i++) { const avg = (w.radius[i - 1] + w.radius[i + 1]) / 2; s += (w.radius[i] - avg) ** 2; n++; }
  return s / n;
}
function sandFor(w, t, secs, pressure = 0.8, grit, rpm) {
  for (let k = 0; k < Math.round(secs * 60); k++) w.sand(t, pressure, 1 / 60, grit, rpm);
}

test("a new or loaded workpiece is rough-sawn all over", () => {
  const w = new L.Workpiece();
  assert.ok(w.rough.every((v) => v === 1));
  w.rough.fill(0.2); w.reset(1);
  assert.ok(w.rough.every((v) => v === 1), "reset roughens it again");
  w.rough.fill(0.2); w.load({ profile: new Float32Array(SEGN).fill(CC.R0 * 0.9) });
  assert.ok(w.rough.every((v) => v === 1), "and so does a fresh blank");
  assert.equal(w.smoothness(), 0);
});

test("a cut leaves its tip's finish: a skew cleaner than a gouge, and both cleaner than the raw log", () => {
  const cutWith = (tip) => {
    const w = new L.Workpiece(); w.reset(0);
    for (let k = 0; k < 60; k++) w.cut(0.5, 0.7, tip, 1 / 60, 1);
    return w.rough[Math.round(0.5 * (SEGN - 1))];
  };
  const g = cutWith("gouge"), s = cutWith("skew"), r = cutWith("roughing");
  assert.ok(Math.abs(g - L.TIPS.gouge.finish) < 0.05, "gouge " + g);
  assert.ok(Math.abs(s - L.TIPS.skew.finish) < 0.05, "skew " + s);
  assert.ok(s < g && g < r && r < 1, `skew ${s} < gouge ${g} < roughing ${r}`);
  for (const k of L.TIP_ORDER) if (L.TIPS[k].kind !== "abrasive") assert.ok(L.TIPS[k].finish > 0 && L.TIPS[k].finish < 1, k + " has a finish");
});

test("sandpaper is on the tool list but never cuts", () => {
  assert.equal(L.TIPS.sand.kind, "abrasive");
  assert.ok(L.TIP_ORDER.includes("sand"));
  const w = new L.Workpiece(); w.reset(0);
  const before = Float32Array.from(w.radius);
  assert.equal(w.cut(0.5, 1, "sand", 0.5, 1), 0);
  assert.deepEqual(w.radius, before);
});

test("sanding evens out a bumpy surface and never raises a radius", () => {
  const w = bumpy(), mid = Math.round(0.5 * (SEGN - 1));
  const lo = mid - 8, hi = mid + 8;
  const v0 = variance(w, lo, hi), before = Float32Array.from(w.radius);
  for (let k = 0; k < 120; k++) {
    const prev = Float32Array.from(w.radius);
    w.sand(0.5, 0.8, 1 / 60);
    for (let i = 0; i < SEGN; i++) assert.ok(w.radius[i] <= prev[i] + 1e-7, "slice " + i + " rose");
  }
  const v1 = variance(w, lo, hi);
  assert.ok(v1 < v0 * 0.3, `neighbour variance ${v0.toExponential(2)} -> ${v1.toExponential(2)}`);
  // far from the pad, nothing changes
  assert.equal(w.radius[10], before[10]);
});

test("sanding takes only a little wood, but sanding one spot forever slowly thins it", () => {
  const w = new L.Workpiece(); w.reset(0);
  const mid = Math.round(0.5 * (SEGN - 1)), r0 = w.radius[mid];
  sandFor(w, 0.5, 2);
  const two = r0 - w.radius[mid];
  assert.ok(two > 0, "some wood comes off");
  assert.ok(two * CC.MM_PER_UNIT < 0.6, `two seconds takes under 0.6 mm (${(two * CC.MM_PER_UNIT).toFixed(3)} mm)`);
  sandFor(w, 0.5, 30);
  assert.ok(r0 - w.radius[mid] > two * 5, "but it keeps going");
});

test("sanding respects the core and the centres", () => {
  const w = new L.Workpiece(); w.reset(0);
  w.radius.fill(CC.MIN_R + 0.001);
  sandFor(w, 0.5, 20, 1);
  assert.ok(w.radius.every((v) => v >= CC.MIN_R - 1e-7), "never below MIN_R");
  const v = new L.Workpiece(); v.reset(0);
  const ends = [0, 1, SEGN - 2, SEGN - 1].map((i) => v.radius[i]);
  sandFor(v, 0, 5, 1); sandFor(v, 1, 5, 1);
  assert.deepEqual([0, 1, SEGN - 2, SEGN - 1].map((i) => v.radius[i]), ends, "the ends in the centres are not touched");
  assert.equal(v.rough[0], 1);
});

test("the roughness floor follows the grit, and finer grit gets there faster", () => {
  const G = [{ smooth: 1, rate: 1.6, floor: 0.35 }, { smooth: 1.3, rate: 2.2, floor: 0.22 }, { smooth: 1.7, rate: 3, floor: 0.12 }, { smooth: 2.2, rate: 4, floor: 0.05 }];
  const mid = Math.round(0.5 * (SEGN - 1));
  let prevHalf = Infinity;
  for (const g of G) {
    const w = new L.Workpiece(); w.reset(0);
    sandFor(w, 0.5, 8, 1, g);
    assert.ok(Math.abs(w.rough[mid] - g.floor) < 0.01, `floor ${g.floor}: ${w.rough[mid]}`);
    assert.ok(w.rough.every((v) => v >= g.floor - 1e-6), "never below the floor");
    const q = new L.Workpiece(); q.reset(0);
    sandFor(q, 0.5, 0.5, 1, g);
    const half = q.rough[mid] - g.floor;
    assert.ok(half < prevHalf, "finer grit closes the gap faster");
    prevHalf = half;
  }
  // and the default sheet is 80 grit
  const d = new L.Workpiece(); d.reset(0); sandFor(d, 0.5, 8, 1);
  assert.ok(Math.abs(d.rough[mid] - L.GRIT_80.floor) < 0.01);
});

test("faster spin and a harder push sand faster", () => {
  const mid = Math.round(0.5 * (SEGN - 1));
  const run = (p, rpm) => { const w = new L.Workpiece(); w.reset(0); sandFor(w, 0.5, 0.4, p, null, rpm); return w.rough[mid]; };
  assert.ok(run(1, 2000) < run(1, 600), "RPM");
  assert.ok(run(1, 1100) < run(0.3, 1100), "pressure");
});

test("cutting a sanded spot makes it rough again", () => {
  const w = new L.Workpiece(); w.reset(0);
  const mid = Math.round(0.5 * (SEGN - 1));
  sandFor(w, 0.5, 6, 1, { smooth: 2.2, rate: 4, floor: 0.05 });
  assert.ok(w.rough[mid] < 0.1);
  for (let k = 0; k < 30; k++) w.cut(0.5, 0.7, "gouge", 1 / 60, 1);
  assert.ok(w.rough[mid] > 0.45, "back to gouge marks: " + w.rough[mid]);
});

test("smoothness reads the whole piece, smoothAt the spot under the pad", () => {
  const w = new L.Workpiece(); w.reset(0);
  sandFor(w, 0.5, 6, 1);
  assert.ok(w.smoothAt(0.5) > 0.6, "sanded spot " + w.smoothAt(0.5));
  assert.ok(w.smoothAt(0.1) < 0.05, "untouched spot " + w.smoothAt(0.1));
  assert.ok(w.smoothness() > 0.02 && w.smoothness() < 0.3, "the whole piece is mostly still rough: " + w.smoothness());
});

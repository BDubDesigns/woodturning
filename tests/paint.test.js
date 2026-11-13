// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Cut = require("../src/js/cutting.js");
const P = require("../src/js/paint.js");

const DT = 1 / 60;
const N = P.CFG.SEG;
const idx = (t) => Math.round(t * (N - 1));

function dwell(c, t, p, tool, color, seconds) {
  for (let s = 0; s < seconds; s += DT) c.brush(t, p, tool, color, DT);
}
function sweep(c, t0, t1, p, tool, color, seconds) {
  const steps = Math.max(1, Math.round(seconds / DT));
  for (let k = 0; k <= steps; k++) c.brush(t0 + (t1 - t0) * (k / steps), p, tool, color, DT);
}
const shown = (c, t) => c.shownColor(idx(t));

test("the model and the cutting model agree on the blank", () => {
  assert.equal(P.CFG.SEG, Cut.CFG.SEG);
  assert.equal(P.CFG.LOG_LEN, Cut.CFG.LOG_LEN);
  assert.equal(P.CFG.END_MARGIN, Cut.CFG.END_MARGIN);
});

test("a fresh coat is bare wood: no paint, no gloss", () => {
  const c = new P.Coating();
  assert.equal(c.coverage(), 0);
  assert.equal(c.avgGloss(), 0);
  assert.deepEqual(Array.from(shown(c, 0.5)).map((v) => +v.toFixed(3)), P.CFG.WOOD_RGB);
});

test("paint goes on where the brush is, and only there", () => {
  const c = new P.Coating();
  dwell(c, 0.3, 1, "brush", "crimson", 1.0);
  assert.ok(c.coat[idx(0.3)] > 0.95, "solid under the brush");
  assert.ok(c.coat[idx(0.3 + 0.2)] === 0, "nothing far from the brush");
  assert.ok(c.coat[idx(0.9)] === 0);
  // centred on the brush
  let m = 0, mi = 0;
  for (let i = 0; i < N; i++) { m += c.coat[i]; mi += c.coat[i] * i; }
  assert.ok(Math.abs(mi / m / (N - 1) - 0.3) < 0.005, "coat is centred on the brush");
  // and the colour is the paint's
  const rgb = shown(c, 0.3), want = P.PALETTE.crimson.rgb;
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(rgb[k] - want[k]) < 0.03);
});

test("a stroke is smooth and even along its length", () => {
  const c = new P.Coating();
  sweep(c, 0.2, 0.8, 1, "brush", "teal", 5);
  for (let t = 0.3; t <= 0.7; t += 0.02) assert.ok(c.coat[idx(t)] > 0.85, "solid at " + t.toFixed(2));
  // no hard step at the edge: coat falls off gradually over several slices
  const a = c.coat[idx(0.2)], b = c.coat[idx(0.2) - 6];
  assert.ok(a > b, "falls off outside the stroke");
  let maxStep = 0;
  for (let i = 1; i < N; i++) maxStep = Math.max(maxStep, Math.abs(c.coat[i] - c.coat[i - 1]));
  assert.ok(maxStep < 0.35, "no cliff in the coat, biggest step " + maxStep.toFixed(2));
});

test("pressure sets the flow: light touch is thinner than a firm one", () => {
  const light = new P.Coating(), firm = new P.Coating();
  dwell(light, 0.5, 0.15, "brush", "cobalt", 0.4);
  dwell(firm, 0.5, 1, "brush", "cobalt", 0.4);
  assert.ok(light.coat[idx(0.5)] > 0.02, "even a light touch leaves something");
  assert.ok(light.coat[idx(0.5)] < firm.coat[idx(0.5)] - 0.2, "light " + light.coat[idx(0.5)].toFixed(2) + " vs firm " + firm.coat[idx(0.5)].toFixed(2));
  const none = new P.Coating();
  dwell(none, 0.5, 0, "brush", "cobalt", 1);
  assert.equal(none.coverage(), 0, "no pressure, no paint");
});

test("a fast whip leaves a thin streak, a slow pass a solid coat (like cutting)", () => {
  const fast = new P.Coating(), slow = new P.Coating();
  sweep(fast, 0.1, 0.9, 1, "brush", "plum", 0.25);
  sweep(slow, 0.1, 0.9, 1, "brush", "plum", 4);
  assert.ok(fast.coat[idx(0.5)] < 0.5, "fast: " + fast.coat[idx(0.5)].toFixed(2));
  assert.ok(slow.coat[idx(0.5)] > 0.8, "slow: " + slow.coat[idx(0.5)].toFixed(2));
});

test("a second pass builds the coat up, never past solid", () => {
  const c = new P.Coating();
  sweep(c, 0.2, 0.8, 1, "brush", "moss", 0.4);
  const once = c.coat[idx(0.5)];
  sweep(c, 0.8, 0.2, 1, "brush", "moss", 0.4);
  const twice = c.coat[idx(0.5)];
  assert.ok(twice > once);
  dwell(c, 0.5, 1, "brush", "moss", 3);
  assert.ok(c.coat[idx(0.5)] <= 1);
});

test("the liner is a narrow line, the brush a wide band", () => {
  const b = new P.Coating(), l = new P.Coating();
  dwell(b, 0.5, 1, "brush", "ink", 1);
  dwell(l, 0.5, 1, "liner", "ink", 1);
  const width = (c) => { let n = 0; for (let i = 0; i < N; i++) if (c.coat[i] > 0.5) n++; return n; };
  assert.ok(width(l) >= 2 && width(l) < width(b) / 2, "liner " + width(l) + " vs brush " + width(b) + " slices");
});

test("painting a new colour over an old one blends: gradients fall out", () => {
  const c = new P.Coating();
  sweep(c, 0.1, 0.9, 1, "brush", "crimson", 8);
  // sweep the second colour across while the pressure ramps up: a smooth crimson to cobalt ramp
  const steps = 360;
  for (let k = 0; k <= steps; k++) c.brush(0.3 + 0.5 * (k / steps), 0.05 + 0.95 * (k / steps), "brush", "cobalt", DT);
  const rs = [0.3, 0.4, 0.5, 0.6, 0.7].map((t) => shown(c, t)[0]);   // red channel falls crimson -> cobalt
  for (let i = 1; i < rs.length; i++) assert.ok(rs[i] <= rs[i - 1] + 0.01, "red keeps falling across the gradient: " + rs.map((v) => v.toFixed(2)));
  assert.ok(rs[0] - rs[4] > 0.25, "start is much redder than the end: " + rs.map((v) => v.toFixed(2)));
});

test("paint over bare wood is partial until it is built up", () => {
  const c = new P.Coating();
  c.brush(0.5, 0.3, "brush", "ivory", DT * 3);
  const a = c.coat[idx(0.5)];
  assert.ok(a > 0.02 && a < 0.6, "thin coat " + a.toFixed(2));
  const rgb = shown(c, 0.5), wood = P.CFG.WOOD_RGB, ivory = P.PALETTE.ivory.rgb;
  for (let k = 0; k < 3; k++) assert.ok(rgb[k] >= Math.min(wood[k], ivory[k]) - 1e-6 && rgb[k] <= Math.max(wood[k], ivory[k]) + 1e-6, "between wood and paint");
});

test("unknown colours and tools lay nothing", () => {
  const c = new P.Coating();
  assert.equal(c.brush(0.5, 1, "brush", "nope", DT), 0);
  assert.equal(c.brush(0.5, 1, "spatula", "crimson", DT), 0);
  assert.equal(c.coverage(), 0);
});

test("the blank's ends, held by the centres, are never painted", () => {
  const c = new P.Coating();
  dwell(c, 0, 1, "brush", "crimson", 1);
  dwell(c, 1, 1, "brush", "crimson", 1);
  for (let i = 0; i < P.CFG.END_MARGIN; i++) { assert.equal(c.coat[i], 0); assert.equal(c.coat[N - 1 - i], 0); }
});

test("cutting wood away takes the paint and finish with it", () => {
  const w = new Cut.Workpiece(); w.reset(0);
  const c = new P.Coating();
  c.syncWork(w);                          // first call just records the radii
  sweep(c, 0.2, 0.8, 1, "brush", "crimson", 5);
  for (let t = 0.2; t <= 0.8; t += 0.01) c.spray(t, 1, DT * 6);
  assert.ok(c.coat[idx(0.5)] > 0.9 && c.gloss[idx(0.5)] > 0.3);
  for (let s = 0; s < 1.2; s += DT) w.cut(0.5, 1, "gouge", DT);
  assert.ok(c.syncWork(w), "sync noticed the cut");
  assert.equal(c.coat[idx(0.5)], 0, "paint gone where the wood was cut");
  assert.equal(c.gloss[idx(0.5)], 0);
  assert.ok(c.coat[idx(0.2) + 1] > 0.5, "paint left where the wood was not touched");
  assert.ok(!c.syncWork(w), "nothing more to do next frame");
});

test("spray builds gloss where it is aimed, wider than a brush, and caps at 1", () => {
  const c = new P.Coating();
  for (let s = 0; s < 1; s += DT) c.spray(0.5, 1, DT);
  assert.ok(c.gloss[idx(0.5)] > 0.5, "gloss at the aim " + c.gloss[idx(0.5)].toFixed(2));
  assert.equal(c.gloss[idx(0.8)], 0, "none far away");
  let wide = 0; for (let i = 0; i < N; i++) if (c.gloss[i] > 0.05) wide++;
  assert.ok(wide > N * 0.1, "the mist is wide: " + wide + " slices");
  for (let s = 0; s < 8; s += DT) c.spray(0.5, 1, DT);
  assert.ok(c.gloss[idx(0.5)] <= 1 && c.gloss[idx(0.5)] > 0.99);
});

test("spray pressure: no pressure no gloss, a light touch is slower", () => {
  const a = new P.Coating(), b = new P.Coating(), z = new P.Coating();
  for (let s = 0; s < 0.5; s += DT) { a.spray(0.5, 0.15, DT); b.spray(0.5, 1, DT); z.spray(0.5, 0, DT); }
  assert.equal(z.avgGloss(), 0);
  assert.ok(a.gloss[idx(0.5)] > 0 && a.gloss[idx(0.5)] < b.gloss[idx(0.5)]);
});

test("sheen names track the gloss level", () => {
  assert.equal(P.sheenFor(0), "matte");
  assert.equal(P.sheenFor(0.5), "satin");
  assert.equal(P.sheenFor(0.95), "gloss");
});

/* ---------------- specs and grading ---------------- */
test("generated specs are valid, deterministic by seed, and use only palette paints", () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const s = P.generateSpec(seed);
    assert.ok(P.validSpec(s), "valid, seed " + seed + " " + JSON.stringify(s));
    assert.deepEqual(s, P.generateSpec(seed), "same seed, same spec");
    s.segments.forEach((g) => assert.ok(g.paint === null || P.PALETTE[g.paint]));
    assert.equal(s.segments[0].a, 0);
    assert.ok(Math.abs(s.segments[s.segments.length - 1].b - 1) < 1e-9, "segments cover the whole length");
    kinds.add(s.kind);
  }
  assert.ok(kinds.size >= 5, "all kinds show up: " + [...kinds]);
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) seen.add(JSON.stringify(P.generateSpec(seed)));
  assert.ok(seen.size > 15, "specs vary");
});

test("adjacent bands are never the same colour", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = P.generateSpec(seed);
    for (let i = 1; i < s.segments.length; i++) assert.notEqual(s.segments[i].paint, s.segments[i - 1].paint, "seed " + seed);
  }
});

test("specs describe themselves in plain words, with no dashes", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const d = P.describeSpec(P.generateSpec(seed));
    assert.ok(d.length > 10);
    assert.ok(!/[–—]/.test(d), d);
  }
});

test("validSpec rejects junk", () => {
  assert.ok(!P.validSpec(null));
  assert.ok(!P.validSpec({ segments: [], sheen: "gloss" }));
  assert.ok(!P.validSpec({ segments: [{ a: 0, b: 1, paint: "mud" }], sheen: "gloss" }));
  assert.ok(!P.validSpec({ segments: [{ a: 0, b: 1, paint: null }], sheen: "mirror" }));
  assert.ok(!P.validSpec({ segments: [{ a: 0, b: 0.6, paint: null }, { a: 0.5, b: 1, paint: null }], sheen: "matte" }));
  assert.ok(P.validSpec({ segments: [{ a: 0, b: 1, paint: "ivory" }], sheen: "satin" }));
});

function paintToSpec(spec, c, tool) {
  // paint each band with the right colour: what a careful player does
  spec.segments.forEach((s) => {
    if (!s.paint) return;
    const mid = (s.a + s.b) / 2, half = (s.b - s.a) / 2;
    if (half < 0.06) { dwell(c, mid, 1, "liner", s.paint, 1.2); return; }
    const reach = Math.max(0, half - 0.03);
    sweep(c, mid - reach, mid + reach, 1, tool || "brush", s.paint, 5);
  });
}
function sprayTo(spec, c) {
  // sweep the bottle back and forth until the piece reaches the sheen the spec asks for
  const want = P.SHEEN[spec.sheen].gloss;
  for (let pass = 0; pass < 30 && c.avgGloss() < want; pass++) {
    const a = pass % 2 ? 1 : 0, b = 1 - a;
    for (let k = 0; k <= 60 && c.avgGloss() < want; k++) c.spray(a + (b - a) * (k / 60), 1, DT);
  }
}

test("an unpainted blank scores badly against a painted spec, well against a bare one", () => {
  const bare = new P.Coating();
  const painted = { name: "t", segments: [{ a: 0, b: 1, paint: "crimson" }], sheen: "matte" };
  const none = { name: "t", segments: [{ a: 0, b: 1, paint: null }], sheen: "matte" };
  assert.ok(P.matchSpec(painted, bare).color < 0.1);
  assert.ok(P.matchSpec(none, bare).total > 0.95);
});

test("the right colours in the right places score high", () => {
  for (const kind of ["solid", "banded", "dipped", "twotone"]) {
    const spec = P.generateSpec(11, { kind, sheen: "matte" });
    const c = new P.Coating();
    paintToSpec(spec, c);
    const m = P.matchSpec(spec, c);
    assert.ok(m.color > 0.85, kind + " colour match " + m.color.toFixed(2));
  }
});

test("a pinstripe spec can be matched with the liner", () => {
  const spec = P.generateSpec(5, { kind: "pinstripe", sheen: "matte" });
  const c = new P.Coating();
  // base coat, then the liner lines
  const base = spec.segments[0].paint;
  sweep(c, 0.02, 0.98, 1, "brush", base, 8);
  spec.segments.filter((s) => s.paint !== base).forEach((s) => dwell(c, (s.a + s.b) / 2, 1, "liner", s.paint, 1.0));
  assert.ok(P.matchSpec(spec, c).color > 0.8, "pinstripe match " + P.matchSpec(spec, c).color.toFixed(2));
});

test("wrong colours score worse than right colours", () => {
  const spec = { name: "t", segments: [{ a: 0, b: 1, paint: "crimson" }], sheen: "matte" };
  const right = new P.Coating(), wrong = new P.Coating(), near = new P.Coating();
  sweep(right, 0.02, 0.98, 1, "brush", "crimson", 8);
  sweep(wrong, 0.02, 0.98, 1, "brush", "teal", 8);
  sweep(near, 0.02, 0.98, 1, "brush", "tangerine", 8);
  const r = P.matchSpec(spec, right).color, w = P.matchSpec(spec, wrong).color, nr = P.matchSpec(spec, near).color;
  assert.ok(r > 0.9 && w < 0.2, `right ${r.toFixed(2)} wrong ${w.toFixed(2)}`);
  assert.ok(nr < r && nr > w - 1e-9 || nr < r, "a near colour is in between or worse than right");
});

test("a band painted in the wrong place scores worse than one in the right place", () => {
  const spec = { name: "t", segments: [{ a: 0, b: 0.4, paint: "cobalt" }, { a: 0.4, b: 1, paint: null }], sheen: "matte" };
  const good = new P.Coating(), bad = new P.Coating();
  sweep(good, 0.04, 0.36, 1, "brush", "cobalt", 5);
  sweep(bad, 0.64, 0.96, 1, "brush", "cobalt", 5);
  assert.ok(P.matchSpec(spec, good).color > P.matchSpec(spec, bad).color + 0.4);
});

test("a band edge a hair off is forgiven", () => {
  const spec = { name: "t", segments: [{ a: 0, b: 0.5, paint: "moss" }, { a: 0.5, b: 1, paint: null }], sheen: "matte" };
  const c = new P.Coating();
  sweep(c, 0.03, 0.495, 1, "brush", "moss", 6);   // stops just shy of the edge
  assert.ok(P.matchSpec(spec, c).color > 0.85);
});

test("finish is graded on how close the sheen is, not just whether it is there", () => {
  const mk = (sheen) => ({ name: "t", segments: [{ a: 0, b: 1, paint: null }], sheen });
  const bare = new P.Coating(), sprayed = new P.Coating();
  sprayTo(mk("gloss"), sprayed);
  assert.ok(P.matchSpec(mk("gloss"), sprayed).finish > 0.9, "sprayed matches gloss");
  assert.ok(P.matchSpec(mk("gloss"), bare).finish < 0.1, "bare misses gloss");
  assert.ok(P.matchSpec(mk("matte"), bare).finish > 0.95, "bare matches matte");
  assert.ok(P.matchSpec(mk("matte"), sprayed).finish < 0.1, "glossy piece misses matte");
  const satin = new P.Coating(); sprayTo(mk("satin"), satin);
  assert.ok(P.matchSpec(mk("satin"), satin).finish > 0.9, "satin on satin");
  assert.ok(P.matchSpec(mk("gloss"), satin).finish < P.matchSpec(mk("satin"), satin).finish);
});

test("a perfect job on a generated spec scores near the top", () => {
  for (const seed of [2, 3, 8, 21]) {
    const spec = P.generateSpec(seed, { kind: ["solid", "banded", "dipped", "twotone"][seed % 4] });
    const c = new P.Coating();
    paintToSpec(spec, c);
    sprayTo(spec, c);
    const m = P.matchSpec(spec, c);
    assert.ok(m.total > 0.85, "seed " + seed + " total " + m.total.toFixed(2));
  }
});

test("no em or en dashes in player-facing copy", () => {
  const root = path.join(__dirname, "..", "src");
  for (const f of ["js/paint.js", "index.html"]) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    // code comments may use them; strings and markup may not. Check quoted strings and element text.
    const strings = (text.match(/"[^"\n]*"|'[^'\n]*'/g) || []).concat(text.match(/>[^<>]+</g) || []);
    for (const s of strings) assert.ok(!/[–—]/.test(s), f + ": " + s);
  }
});

test("a solid coat can be painted over: every slice takes the new colour", () => {
  const c = new P.Coating(), ink = P.PALETTE.ink.rgb;
  // solid cobalt, held on every spot long enough that the coat sits at exactly 1
  for (let t = 0.1; t <= 0.9; t += 0.02) dwell(c, t, 1, "brush", "cobalt", 1);
  assert.ok(c.coat[idx(0.5)] > 0.9999, "solid first");
  for (let r = 0; r < 4; r++) sweep(c, 0.1, 0.9, 1, "brush", "ink", 4);
  for (let t = 0.15; t <= 0.85; t += 0.01) {
    const rgb = shown(c, t), d = Math.hypot(rgb[0] - ink[0], rgb[1] - ink[1], rgb[2] - ink[2]);
    assert.ok(d < 0.03, "slice at " + t.toFixed(2) + " still shows the old colour (" + rgb.map((v) => v.toFixed(2)) + ")");
  }
  // and back again
  for (let r = 0; r < 4; r++) sweep(c, 0.1, 0.9, 1, "brush", "cobalt", 4);
  const cob = P.PALETTE.cobalt.rgb, rgb = shown(c, 0.5);
  assert.ok(Math.hypot(rgb[0] - cob[0], rgb[1] - cob[1], rgb[2] - cob[2]) < 0.03, "cobalt over ink over cobalt");
});

test("a light touch lays a thin wash, far slower than a firm push", () => {
  const light = new P.Coating(), firm = new P.Coating();
  dwell(light, 0.5, 0.25, "brush", "cobalt", 0.5);
  dwell(firm, 0.5, 1, "brush", "cobalt", 0.5);
  const l = light.coat[idx(0.5)], f = firm.coat[idx(0.5)];
  assert.ok(l > 0.05 && l < 0.4, "light touch: " + l.toFixed(2));
  assert.ok(f > 0.95, "firm push: " + f.toFixed(2));
});

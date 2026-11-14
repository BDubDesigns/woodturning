// Run: node --test tests/
// haptics.js: the level -> pattern mapping, and the module's behaviour with and without a vibrator.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../src/js/haptics.js");

const rate = (lv, f) => 1000 / (H.gapFor(lv, f) + H.pulseFor(lv, f));   // pulses a second at a level

/* A fake device: records every vibrate() call, on a clock the test moves. */
function fake() {
  const calls = [];
  let t = 0;
  H.nav = () => ({ vibrate: (p) => { calls.push(Array.isArray(p) ? p.slice() : p); return true; } });
  H.clock = () => t;
  H.useProfile({}, null);
  H.stop(); calls.length = 0;
  return { calls, at: (ms) => { t = ms; } };
}

// ---------- the pure mapping ----------
test("level 0 (or nothing) gives no pattern", () => {
  assert.deepEqual(H.patternFor(0), []);
  assert.deepEqual(H.patternFor(-1), []);
  assert.deepEqual(H.patternFor(NaN), []);
  assert.deepEqual(H.patternFor(H.CFG.MIN_LEVEL / 2), []);
});

test("a pattern is pulses with gaps, at most one window long, always ending on a pulse", () => {
  for (const f of ["cut", "sand"]) for (const lv of [0.05, 0.25, 0.5, 0.75, 1]) {
    const p = H.patternFor(lv, f), len = p.reduce((a, b) => a + b, 0);
    assert.ok(p.length >= 1 && p.length % 2 === 1, `${f} ${lv}: ends on a pulse`);
    for (let i = 0; i < p.length; i += 2) assert.equal(p[i], H.pulseFor(lv, f));
    for (let i = 1; i < p.length; i += 2) assert.equal(p[i], H.gapFor(lv, f));
    assert.ok(len <= H.CFG.WINDOW_MS, `${f} ${lv}: ${len} ms`);
  }
  assert.ok(H.patternFor(1).length > 5, "the top end fits many pulses in a window");
  assert.equal(H.patternFor(0.05).length, 1, "the light end only one: its gap is longer than the window");
});

test("cutting: slow and soft at the light end, a fast firm rattle at full", () => {
  assert.equal(H.gapFor(0), H.CFG.CUT.GAP_LIGHT_MS);
  assert.equal(H.gapFor(1), H.CFG.CUT.GAP_FULL_MS);
  assert.equal(H.gapFor(5), H.CFG.CUT.GAP_FULL_MS, "clamped above 1");
  assert.equal(H.pulseFor(0), H.CFG.CUT.PULSE_LIGHT_MS);
  assert.equal(H.pulseFor(1), H.CFG.CUT.PULSE_FULL_MS);
  let lastRate = 0, lastPulse = 0;
  for (let lv = 0; lv <= 1.0001; lv += 0.05) {
    assert.ok(rate(lv) >= lastRate && H.pulseFor(lv) >= lastPulse, `level ${lv.toFixed(2)}: faster and firmer than the level below`);
    lastRate = rate(lv); lastPulse = H.pulseFor(lv);
  }
  assert.ok(rate(0.1) < 4, `a light touch at low RPM is only a few pulses a second (${rate(0.1).toFixed(1)})`);
  assert.ok(rate(0.05) < 1000 / 250, `a light touch at low RPM is slower than 4 a second (${rate(0.05).toFixed(1)})`);
  assert.ok(rate(1) > 6 * rate(0.1), "the top is many times faster");
});

test("sanding: fast when rough, super slow when smooth, finer pulses than cutting", () => {
  assert.equal(H.gapFor(0, "sand"), H.CFG.SAND.GAP_SMOOTH_MS);
  assert.equal(H.gapFor(1, "sand"), H.CFG.SAND.GAP_ROUGH_MS);
  assert.ok(H.gapFor(0, "sand") >= 500, "a smooth spot ticks about twice a second or slower");
  assert.ok(rate(1, "sand") > 8 * rate(0, "sand"), `rough is many times faster than smooth (${rate(1, "sand").toFixed(1)} vs ${rate(0, "sand").toFixed(1)} a second)`);
  let last = 0;
  for (let lv = 0; lv <= 1.0001; lv += 0.05) { assert.ok(rate(lv, "sand") >= last); last = rate(lv, "sand"); }
  assert.ok(H.pulseFor(1, "sand") < H.pulseFor(1), "sanding pulses are finer than cutting pulses");
  assert.ok(H.patternFor(0, "sand").length === 1, "a smooth spot still ticks (it is not silent)");
});

test("the event patterns are the planned ones", () => {
  assert.deepEqual(H.CFG.PULSES.catch, [35, 40, 35]);
  assert.deepEqual(H.CFG.PULSES.done, [30]);
  assert.deepEqual(H.CFG.PULSES.stars3, [15, 70, 20, 70, 40]);
});

// ---------- no vibrator (iPhone browsers, Node) ----------
test("where vibration is not supported, every call is safe and does nothing", () => {
  H.nav = () => ({});           // a navigator with no vibrate()
  assert.equal(H.supported(), false);
  assert.doesNotThrow(() => { H.cut(1); H.sand(0.5); H.pulse("catch"); H.pulse("done"); H.pulse("stars3"); H.pulse("nope"); H.stop(); });
  H.nav = () => undefined;      // no navigator at all
  assert.equal(H.supported(), false);
  assert.doesNotThrow(() => { H.cut(1); H.pulse("done"); H.stop(); });
});

test("a vibrate() that throws never reaches the game", () => {
  H.nav = () => ({ vibrate: () => { throw new Error("blocked"); } });
  H.useProfile({}, null);
  assert.doesNotThrow(() => { H.cut(1); H.pulse("done"); H.stop(); });
});

// ---------- with a vibrator ----------
test("cut sends a pattern, not one per frame, and a new one before it runs out or when the level jumps", () => {
  const d = fake();
  for (let t = 0; t < 100; t += 16) { d.at(t); H.cut(0.5); }
  assert.equal(d.calls.length, 1, "one pattern for the first 100 ms");
  assert.deepEqual(d.calls[0], H.patternFor(0.5));
  const first = H.patternFor(0.5), len = first.reduce((a, b) => a + b, 0), due = len + H.gapFor(0.5);
  d.at(len - 5); H.cut(0.5);
  assert.equal(d.calls.length, 1, "nothing while its last pulse plays");
  d.at(due - 20); H.cut(0.5);
  assert.equal(d.calls.length, 2, "the next window goes just before its first pulse is due");
  assert.deepEqual(d.calls[1], [0, 20].concat(first), "and starts on the beat");
  // a big change re-times the beat at once: the next pulse comes one new gap after the last one
  const second = [0, 20].concat(first), lastEnd = (due - 20) + second.reduce((a, b) => a + b, 0);
  d.at(lastEnd + 5); H.cut(0.95);
  assert.equal(d.calls.length, 3, "a big change sends straight away");
  assert.deepEqual(d.calls[2], [0, H.gapFor(0.95) - 5].concat(H.patternFor(0.95)), "but on the beat, not a pulse right now");
});

test("level 0 stops after a short grace, and stop() sends vibrate(0)", () => {
  const d = fake();
  d.at(0); H.cut(0.6);
  d.at(16); H.cut(0);
  assert.equal(d.calls.length, 1, "a single empty frame does not stutter it off");
  d.at(100); H.cut(0);
  assert.equal(d.calls[d.calls.length - 1], 0, "a moment with no wood coming off stops it");
  d.at(200); H.cut(0.6);
  H.stop();
  assert.equal(d.calls[d.calls.length - 1], 0);
  const n = d.calls.length;
  H.stop();
  assert.equal(d.calls.length, n, "stop with nothing playing sends nothing");
});

test("sanding follows roughness, and a wobbling level never bunches pulses up", () => {
  const d = fake();
  d.at(0); H.sand(1);
  assert.deepEqual(d.calls[0], H.patternFor(1, "sand"));
  d.at(30); H.sand(0);    // the spot went smooth mid-window: the next tick waits one slow gap after the last
  const last = d.calls[d.calls.length - 1];
  assert.deepEqual(last, [0, H.pulseFor(1, "sand") + H.gapFor(H.CFG.MIN_LEVEL, "sand") - 30].concat(H.patternFor(H.CFG.MIN_LEVEL, "sand")), "a smooth spot waits a long gap");
  // a level jumping about every frame: rebuild when pulses really start (a new call cancels
  // the rest of the old one), and check they never come closer than the fastest gap
  const e = fake(), sends = [], times = [];
  for (let t = 0; t < 3000; t += 16) {
    e.at(t);
    const n = e.calls.length;
    H.sand(t % 32 ? 0.9 : 0.1);
    if (e.calls.length > n) sends.push([t, e.calls[e.calls.length - 1]]);
  }
  for (let i = 0; i < sends.length; i++) {
    const [at, p] = sends[i], until = i + 1 < sends.length ? sends[i + 1][0] : Infinity;
    let x = at;
    for (let k = 0; k < p.length; k++) { if (k % 2 === 0 && p[k] > 0 && x < until) times.push(x); x += p[k]; }
  }
  assert.ok(times.length > 10, `it kept ticking (${times.length} pulses in 3 s)`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= H.CFG.SAND.GAP_ROUGH_MS, `pulses ${times[i - 1]} and ${times[i]} are not bunched`);
});

test("one-offs play their pattern, and cutting waits for them", () => {
  const d = fake();
  d.at(0); H.pulse("catch");
  assert.deepEqual(d.calls[0], [35, 40, 35]);
  d.at(50); H.cut(0.8);
  assert.equal(d.calls.length, 1, "no cutting pattern over the catch");
  d.at(120); H.cut(0.8);
  assert.equal(d.calls.length, 2, "cutting carries on after it");
  H.pulse("nope");
  assert.equal(d.calls.length, 2, "an unknown name does nothing");
});

test("switched off: no calls at all, and the profile remembers", () => {
  const d = fake(), settings = {};
  let saved = 0;
  H.useProfile(settings, () => saved++);
  assert.equal(H.enabled(), true, "on by default");
  H.setEnabled(false);
  assert.equal(settings.vibration, false);
  assert.equal(saved, 1);
  d.calls.length = 0;
  H.cut(1); H.sand(1); H.pulse("done"); H.stop();
  assert.equal(d.calls.length, 0);
  H.useProfile({ vibration: false }, null);
  assert.equal(H.enabled(), false, "a saved off stays off");
  H.useProfile({ vibration: true }, null);
  assert.equal(H.enabled(), true);
});

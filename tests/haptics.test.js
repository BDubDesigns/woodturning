// Run: node --test tests/
// haptics.js: the level -> pattern mapping, and the module's behaviour with and without a vibrator.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../src/js/haptics.js");

const density = (p) => Math.ceil(p.length / 2);   // pulses in one window

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

test("a pattern is short pulses with gaps, about one window long", () => {
  for (const lv of [0.1, 0.5, 1]) {
    const p = H.patternFor(lv), len = p.reduce((a, b) => a + b, 0);
    assert.ok(p.length >= 2, `level ${lv}: more than one pulse`);
    for (let i = 0; i < p.length; i += 2) assert.equal(p[i], H.CFG.PULSE_MS);
    assert.ok(len <= H.CFG.WINDOW_MS && len > H.CFG.WINDOW_MS - H.CFG.GAP_LIGHT_MS - H.CFG.PULSE_MS, `level ${lv}: ${len} ms`);
    assert.equal(p.length % 2, 1, "it ends on a pulse");
  }
});

test("pulse density rises with the level, from the light gap down to the full gap", () => {
  let last = 0;
  for (let lv = 0.05; lv <= 1.0001; lv += 0.05) {
    const d = density(H.patternFor(lv));
    assert.ok(d >= last, `level ${lv.toFixed(2)}: density ${d} >= ${last}`);
    last = d;
  }
  assert.equal(H.gapFor(0), H.CFG.GAP_LIGHT_MS);
  assert.equal(H.gapFor(1), H.CFG.GAP_FULL_MS);
  assert.equal(H.gapFor(5), H.CFG.GAP_FULL_MS, "clamped above 1");
  assert.ok(density(H.patternFor(1)) > 3 * density(H.patternFor(0.05)));
});

test("sanding pulses are finer than cutting pulses", () => {
  const p = H.patternFor(0.5, H.CFG.SAND_PULSE_MS);
  assert.equal(p[0], H.CFG.SAND_PULSE_MS);
  assert.ok(H.CFG.SAND_PULSE_MS < H.CFG.PULSE_MS);
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
  d.at(due + 5); H.cut(0.95);
  assert.equal(d.calls.length, 3, "a big change sends straight away");
  assert.deepEqual(d.calls[2], H.patternFor(0.95));
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

test("sanding is capped", () => {
  const d = fake();
  H.sand(1);
  assert.deepEqual(d.calls[0], H.patternFor(H.CFG.SAND_CAP, H.CFG.SAND_PULSE_MS));
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

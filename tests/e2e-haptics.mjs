// Vibration while cutting (haptics.js), in a real page on the lathe's test clock.
//   node tests/e2e-haptics.mjs [path/to/page.html]
// navigator.vibrate is stubbed to record every call (Chromium here has no motor
// to feel; the feel itself is judged on a real Android phone). Checks:
//   - cutting records patterns, and a harder press at a higher RPM gives denser ones
//   - the tool held on the wood with nothing coming off records nothing
//   - lifting the finger sends vibrate(0); paint never vibrates; sanding is lighter
//   - a catch and DONE send their one-off pulses
//   - Vibration off in Settings means no calls at all, and it stays off on reload
//   - with navigator.vibrate removed, the Settings row is hidden and nothing throws
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";

const file = resolve(process.argv[2] || "lathe.html");
let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };
const errors = [];
const browser = await chromium.launch();

/* A page with a recording vibrate(), or with none at all. */
async function open(ctx, { vibrate = true, reset = true } = {}) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript((vib) => {
    window.__vib = [];
    if (vib) Navigator.prototype.vibrate = function (p) { window.__vib.push(Array.isArray(p) ? p.slice() : p); return true; };
    else delete Navigator.prototype.vibrate;
  }, vibrate);
  await page.goto(`file://${file}?tutorial=off&view=2d&testclock` + (reset ? "&reset" : ""));
  await page.waitForFunction(() => window.__lathe && window.__lathe.views && window.__lathe.views.current && window.Game.Haptics);
  await page.evaluate(() => { window.Lathe.mountStock({ kind: "log", key: "pine" }); window.__lathe.advance(0.2); window.__vib.length = 0; });
  return page;
}
const calls = (page) => page.evaluate(() => window.__vib.slice());
const clear = (page) => page.evaluate(() => { window.__vib.length = 0; });
const tick = (page, s) => page.evaluate((s) => window.__lathe.advance(s), s);
const setRpm = (page, rpm) => page.evaluate((rpm) => { const el = document.getElementById("rpm"); el.value = rpm; el.dispatchEvent(new Event("input")); }, rpm);
const pulses = (p) => Array.isArray(p) ? p.filter((v, i) => i % 2 === 0 && v > 0).length : 0;
/* Pulses per second over a stroke: every pulse sent, over how long the stroke lasted
   (a pattern can be cut short by the next, so this slightly overcounts; fine for comparing). */
function density(list, seconds = 1.8) { return list.reduce((a, p) => a + pulses(p), 0) / seconds; }
/* Press below the log, nudge up by `push` px (0 = touch only), then sweep sideways for `ms`.
   Leaves the finger down unless `lift`. */
async function stroke(page, { t = 0.35, push = 40, ms = 1200, sweep = 0.12, lift = true } = {}) {
  const b = await page.locator("#stage").boundingBox(), x = b.x + b.width * t, y = b.y + b.height * 0.82;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x, y - (push * i) / 10); await tick(page, 0.03); }
  const n = Math.max(1, Math.round(ms / 50));
  for (let i = 1; i <= n; i++) { await page.mouse.move(x + b.width * sweep * (i / n), y - push); await tick(page, 0.05); }
  if (lift) await page.mouse.up();
}

const ctx = await browser.newContext({ viewport: { width: 400, height: 820 } });

console.log("\nCUTTING");
let page = await open(ctx);
check(await page.evaluate(() => window.Game.Haptics.supported() && window.Game.Haptics.enabled()), "vibration is supported here (stubbed) and on by default");
await tick(page, 1);
check((await calls(page)).length === 0, "a spinning lathe with nobody touching it: no vibration");
// the tool on the wood, no push: nothing comes off, nothing buzzes
let r0 = await page.evaluate(() => window.__lathe.work.removedFraction());
await stroke(page, { push: 0, ms: 800, sweep: 0, lift: false });
let r1 = await page.evaluate(() => window.__lathe.work.removedFraction());
let c = await calls(page);
check(r1 - r0 < 1e-6 && c.filter((p) => p !== 0).length === 0, `the tool resting on the wood (nothing off: ${((r1 - r0) * 100).toFixed(3)}%) records nothing`);
await page.mouse.up(); await clear(page);

// a light nudge at a low RPM
await setRpm(page, 400);
await stroke(page, { t: 0.25, push: 10, ms: 1500, lift: false });
const light = await calls(page);
r0 = r1; r1 = await page.evaluate(() => window.__lathe.work.removedFraction());
check(r1 > r0 && light.some((p) => pulses(p) > 0), `a light cut at 400 RPM vibrates (${light.length} calls, ${(density(light)).toFixed(1)} pulses/s)`);
check(light.length < 60, `patterns are sent a window at a time, not every frame (${light.length} calls over 1.8 s)`);
await page.mouse.up();
c = await calls(page);
check(c[c.length - 1] === 0, "lifting the finger sends vibrate(0)");
await clear(page);

// a hard push at the top RPM
await setRpm(page, 2400);
await stroke(page, { t: 0.6, push: 40, ms: 1500, lift: false });
const hard = await calls(page);
await page.mouse.up();
check(hard.some((p) => pulses(p) > 0) && density(hard) > density(light) * 1.8, `a hard push at 2400 RPM is denser (${density(hard).toFixed(1)} vs ${density(light).toFixed(1)} pulses/s)`);
console.log(`  ..   tightest pattern at the top: ${JSON.stringify(hard.filter(Array.isArray).sort((a, b) => pulses(b) - pulses(a))[0])}`);
check(Math.min(...hard.filter(Array.isArray).map((p) => p.filter((v, i) => i % 2 === 1 && !(i === 1 && p[0] === 0)).reduce((m, v) => Math.min(m, v), 999))) < 60, "the top end gets close to the full-strength gap");

console.log("\nA CATCH");
await setRpm(page, 1100);
await clear(page);
{
  const b = await page.locator("#stage").boundingBox(), x = b.x + b.width * 0.75, y = b.y + b.height * 0.82;
  await page.mouse.move(x, y); await page.mouse.down();
  await tick(page, 0.05);
  await page.mouse.move(x, y - 60);   // slammed in all at once
  await tick(page, 0.1);
  await page.mouse.up();
}
c = await calls(page);
check(c.some((p) => JSON.stringify(p) === "[35,40,35]"), "a catch sends the sharp double jolt [35, 40, 35]");

console.log("\nSANDING AND PAINT");
await page.click("#tipSand");
await clear(page);
await setRpm(page, 2400);
await page.evaluate(() => { window.__lathe.work.rough.fill(1); window.__lathe.work.version++; });
await stroke(page, { t: 0.5, push: 40, ms: 1000, lift: false });
const sand = await calls(page);
await page.mouse.up();
const sandPats = sand.filter((p) => pulses(p) > 0);
check(sandPats.length > 0, "sanding rough wood vibrates");
check(sandPats.every((p) => p[p[0] === 0 ? 2 : 0] === 8) && density(sand, 1.3) < density(hard), `lighter: finer pulses, and sparser than a hard cut (${density(sand, 1.3).toFixed(1)} pulses/s)`);
await page.evaluate(() => { window.__lathe.work.rough.fill(0); window.__lathe.work.version++; });
await clear(page);
await stroke(page, { t: 0.5, push: 40, ms: 800, lift: false });
c = await calls(page);
await page.mouse.up();
check(c.filter((p) => pulses(p) > 0).length === 0, "sanding a spot already as smooth as the grit goes: nothing");
await page.click("#modePaint");
await clear(page);
await stroke(page, { t: 0.4, push: 40, ms: 800 });
check((await calls(page)).filter((p) => pulses(p) > 0).length === 0, "painting never vibrates");
await page.click("#modeCut");

console.log("\nDONE");
await page.evaluate(() => { window.__lathe.setTip("gouge"); });
await stroke(page, { t: 0.3, push: 30, ms: 600 });
await clear(page);
await page.click("#doneBtn");
c = await calls(page);
check(await page.evaluate(() => window.__lathe.stock === null) && c.some((p) => JSON.stringify(p) === "[30]"), "DONE on a piece sends one soft thump [30]");

console.log("\nLEAVING THE LATHE, HIDING THE PAGE");
await page.evaluate(() => { window.Lathe.mountStock({ kind: "log", key: "pine" }); window.__lathe.advance(0.1); });
await stroke(page, { t: 0.5, push: 40, ms: 400, lift: false });
await clear(page);
await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
check((await calls(page))[0] === 0, "the page going to the background stops it");
await page.evaluate(() => { delete document.hidden; });
await page.mouse.up();
await stroke(page, { t: 0.6, push: 40, ms: 300, lift: false });
await clear(page);
await page.evaluate(() => window.Game.showScreen("farm"));
check((await calls(page))[0] === 0, "leaving the lathe stops it");
await page.mouse.up();
await page.evaluate(() => window.Game.showScreen("lathe"));

console.log("\nSETTINGS");
await page.click("#settingsBtn");
let row = page.locator('#settingsOverlay [data-act="vibration"]');
check(await row.count() === 1 && /VIBRATION ON/.test(await row.textContent()), "Settings has a Vibration switch, on");
await row.click();
row = page.locator('#settingsOverlay [data-act="vibration"]');
check(/VIBRATION OFF/.test(await row.textContent()) && await row.getAttribute("aria-pressed") === "false", "tapping it turns it off");
check(!/[–—]/.test(await page.locator("#settingsOverlay").textContent()), "no em or en dashes in Settings");
await page.click('#settingsOverlay [data-act="close"]');
await clear(page);
await setRpm(page, 2400);
await stroke(page, { t: 0.4, push: 40, ms: 800 });
await page.click("#doneBtn");
check((await calls(page)).length === 0, "switched off: cutting and DONE make no calls at all");
await page.close();
page = await open(ctx, { reset: false });
check(await page.evaluate(() => !window.Game.Haptics.enabled()), "and it stays off after a reload (saved in the profile)");
await stroke(page, { t: 0.4, push: 40, ms: 600 });
check((await calls(page)).length === 0, "still no calls");
await page.click("#settingsBtn");
await page.click('#settingsOverlay [data-act="vibration"]');
check(/VIBRATION ON/.test(await page.locator('#settingsOverlay [data-act="vibration"]').textContent()) && (await calls(page)).some((p) => JSON.stringify(p) === "[30]"), "back on, with a thump to say so");
await page.close();

console.log("\nNO VIBRATION ON THIS DEVICE (iPhone browsers)");
page = await open(ctx, { vibrate: false });
check(await page.evaluate(() => typeof navigator.vibrate === "undefined" && !window.Game.Haptics.supported()), "navigator.vibrate is gone");
await page.click("#settingsBtn");
check(await page.locator('#settingsOverlay [data-act="vibration"]').count() === 0, "Settings shows no Vibration row");
await page.click('#settingsOverlay [data-act="close"]');
await setRpm(page, 2400);
await stroke(page, { t: 0.4, push: 40, ms: 800 });
{
  const b = await page.locator("#stage").boundingBox(), x = b.x + b.width * 0.7, y = b.y + b.height * 0.82;
  await page.mouse.move(x, y); await page.mouse.down(); await tick(page, 0.05); await page.mouse.move(x, y - 60); await tick(page, 0.1); await page.mouse.up();
}
await page.click("#doneBtn");
check(await page.evaluate(() => getComputedStyle(document.getElementById("err")).display === "none"), "cutting, a catch and DONE all run without it");

check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");

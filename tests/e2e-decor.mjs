// Decorations at Arbor Freight, in the 3D workshop (issue #35 part 6). In a real page.
//   node tests/e2e-decor.mjs [path/to/page.html] [shots-dir]
//
//  1. The DECORATIONS section lists the five, with prices; short of coins, SAVE UP.
//  2. Buying each one shows it in the workshop.
//  3. The disco ball goes up as the light, shows in Lighting's USE list, and a lamp can
//     be picked back (and the disco ball again).
//  4. The radio: PLAY / STOP in the store, and a tap on it by the lathe, toggle the tune.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";

const file = resolve(process.argv[2] || "lathe.html");
const shots = process.argv[3] || null;
let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`file://${file}?tutorial=off&testclock&reset#shop`);
await page.waitForFunction(() => window.__shop && window.__lathe && window.__lathe.setSpec);
const tick = (s) => page.evaluate((s) => window.__lathe.advance(s), s);
const is3d = await page.evaluate(() => window.__lathe.views && window.__lathe.views.current.kind === "3d");
const shown = async () => { await page.evaluate(() => { window.Game.showScreen("lathe"); window.__lathe.advance(1 / 30); }); return page.evaluate(() => window.__lathe.views.current.decorShown ? window.__lathe.views.current.decorShown() : null); };
const toShop = () => page.evaluate(() => { window.Game.showScreen("shop"); window.__shop.ui.render(true); });

console.log("\nTHE STORE");
check(await page.locator("#afDecor").count() === 1 && /DECORATIONS/.test(await page.locator("#afDecor").textContent()), "Arbor Freight has a DECORATIONS section");
check(await page.locator("[data-decor-card]").count() === 3, "with three things for the workshop: radio, string lights, disco ball");
check(/2500/.test(await page.locator('[data-decor-card="disco"]').textContent()), "the disco ball is 2,500");
check(/SAVE UP/.test(await page.locator('[data-decor="disco"]').textContent()), "short of coins: SAVE UP");
await page.locator('[data-decor="disco"]').click({ force: true });
check(await page.evaluate(() => !window.__farm.decor.owns("disco")), "and a tap buys nothing");
await page.evaluate(() => { window.__farm.state.wallet.earn("coins", 9000); window.__farm.persist(); window.__shop.ui.render(true); });

console.log("\nBUYING");
if (!is3d) check(true, "3D unavailable in this browser: the workshop checks are skipped");
for (const [id, key] of [["radio", "radio"], ["string_lights", "strings"]]) {
  await toShop();
  const before = await page.evaluate(() => window.__farm.state.wallet.balance("coins"));
  await page.locator(`[data-decor="${id}"]`).click();
  const after = await page.evaluate(() => window.__farm.state.wallet.balance("coins"));
  const price = await page.evaluate((id) => window.Game.Decor.ITEMS[id].price, id);
  check(before - after === price && await page.evaluate((id) => window.__farm.decor.owns(id), id), `${id}: bought for ${price}`);
  if (is3d) { const s = await shown(); check(!!s[key], `${id}: it shows in the workshop (${JSON.stringify(s)})`); }
}
await toShop();
await page.locator('[data-decor="disco"]').click();
let st = await page.evaluate(() => ({ disco: window.__lathe.disco, owns: window.__farm.decor.owns("disco"), light: window.__farm.shop.current("light").name }));
check(st.owns && st.disco && st.light === "Disco ball", "the disco ball goes up straight away, as the light");
if (is3d) { const s = await shown(); check(s.disco && s.spots > 0, `it hangs where the work light was, throwing spots (${s.spots})`); }
if (shots) await page.screenshot({ path: `${shots}/disco.png` });

console.log("\nTHE LIGHT");
await toShop();
const lightRows = await page.locator('.af-line[data-line="light"] .af-tier').allTextContents();
check(lightRows.some((t) => /Disco ball/.test(t) && /ACTIVE/.test(t)) && lightRows.some((t) => /Bare bulb/.test(t) && /USE/.test(t)), "Lighting's USE list has the disco ball, ACTIVE");
await page.locator('[data-use="light"][data-tier="0"]').click();
st = await page.evaluate(() => ({ disco: window.__lathe.disco, level: window.__lathe.lightLevel }));
check(!st.disco && st.level === 0, "USE on the bare bulb takes the disco ball down");
if (is3d) { const s = await shown(); check(!s.disco && s.spots === 0, "no ball, no spots"); }
await toShop();
await page.locator('[data-use="light"][data-tier="disco"]').first().click();
check(await page.evaluate(() => window.__lathe.disco), "and USE on the disco ball puts it back");
await page.evaluate(() => window.__farm.persist());
await page.reload();
await page.waitForFunction(() => window.__shop && window.__lathe && window.__lathe.setSpec);
await tick(0.1);
check(await page.evaluate(() => window.__lathe.disco), "a reload keeps it");

console.log("\nTHE RADIO");
await toShop();
check(/PLAY THE RADIO/.test(await page.locator("[data-radio]").textContent()), "the radio's card says PLAY THE RADIO");
await page.locator("[data-radio]").click();
st = await page.evaluate(() => ({ on: window.__farm.decor.radioOn(), audio: window.Lathe.audio.radioOn() }));
check(st.on && st.audio, "PLAY starts the tune");
check(/STOP THE RADIO/.test(await page.locator("[data-radio]").textContent()), "and the button says STOP");
await page.locator("[data-radio]").click();
check(await page.evaluate(() => !window.__farm.decor.radioOn() && !window.Lathe.audio.radioOn()), "STOP stops it");
if (is3d) {
  await page.evaluate(() => { window.Game.showScreen("lathe"); window.Lathe.mountBlank(null); });   // a blank on the lathe: no picker over the stage
  await tick(0.1);
  // find the radio on screen and tap it
  const at = await page.evaluate(() => {
    const v = window.__lathe.views.current, r = document.getElementById("stage").getBoundingClientRect();
    for (let y = 0; y < r.height; y += 6) for (let x = 0; x < r.width; x += 6) if (v.decorAt(x, y) === "radio") return { x: r.left + x + 12, y: r.top + y + 12 };
    return null;
  });
  check(!!at, "the radio is on screen by the lathe");
  if (at) {
    const removed0 = await page.evaluate(() => window.__lathe.work.removedFraction());
    await page.mouse.click(at.x, at.y);
    await tick(0.1);
    check(await page.evaluate(() => window.__farm.decor.radioOn() && window.Lathe.audio.radioOn()), "a tap on it turns it on");
    check(await page.evaluate((r0) => window.__lathe.work.removedFraction() === r0, removed0), "and cuts nothing");
    await page.mouse.click(at.x, at.y);
    check(await page.evaluate(() => !window.__farm.decor.radioOn()), "another tap turns it off");
  }
}
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

// Browser check of the mine and the money model, in a real page.
//   node tests/e2e-mine.mjs [path/to/page.html] [--shots dir]
// Drives the real UI: the ad gate (finish and close early), the mine scene
// (swipe the vein until it cracks, 5 diamonds), no gems,
// diamonds buying land, the full unlock removing ads and timers, persistence,
// and that the free game's core loop is never gated.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const shotsIdx = args.indexOf("--shots");
const shots = shotsIdx >= 0 ? args.splice(shotsIdx, 2)[1] : null;
const file = resolve(args[0] || "lathe.html");
const server = createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(readFileSync(file)); });
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 420, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };
const reload = async () => { await page.reload(); await page.waitForFunction(() => window.__mine); };
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("woodturning.save")));
const wallet = async () => ({
  coins: Number(await page.textContent("#walletCoins")),
  diamonds: Number(await page.textContent("#walletDiamonds")),
});
const setAdSeconds = (s) => page.evaluate((s) => { window.__mine.adProvider.seconds = s; }, s);

console.log("\nMINE");
await page.goto(url + "#mine");
await page.evaluate(() => localStorage.clear());
await reload();

check(await page.locator("#mineScreen").isVisible(), "#mine opens the mine screen");
check(!(await page.locator("#farmScreen").isVisible()) && !(await page.locator("#latheScreen").isVisible()), "other screens are hidden");
check(await page.locator("#tabMine").getAttribute("aria-selected") === "true", "the MINE tab is selected");
let w = await wallet();
check(w.coins === 250 && w.diamonds === 5, "wallet shows coins and diamonds");
check((await page.locator("#walletGems").count()) === 0 && (await page.locator(".wallet .coin-chip").count()) === 2, "the wallet has no gems");

// ---- the trade is transparent: the screen prints what the model pays
const text = await page.textContent("#mineBody");
const cfg = await page.evaluate(() => ({ v: Game.Monetize.CFG.DIAMONDS_PER_VEIN, s: Game.Monetize.CFG.AD_SECONDS, p: Game.Monetize.priceLabel() }));
check(cfg.v === 5, "cracking the vein is worth 5 diamonds");
check(text.includes(`pays exactly ${cfg.v} diamonds`), `the screen says the vein pays ${cfg.v} diamonds`);
check(text.includes(`about ${cfg.s} seconds`), "the screen says how long the ad is");
check(!/\bgems?\b/i.test(text) && (await page.locator('[data-act="mine-gems"], [data-act="sell-gems"]').count()) === 0, "the mine offers diamonds only, no gems");
check(text.includes("No dice, no hidden rates"), "the screen says there is no randomness");
check(text.includes("complete game") && text.includes("only skip waiting"), "the free-game promise is printed");
check(text.includes(cfg.p) && text.includes("removes every ad and every timer"), "the unlock states its price and what it does");
check(await page.locator('[data-act="mine-diamonds"], [data-act="mine-gems"]').count() === 0, "the old direct ad payout is gone");

// ---- close the ad early: you stay outside, nothing lost
await setAdSeconds(30);
await page.click('[data-act="enter-mine"]');
check(await page.locator("#adOverlay").isVisible(), "entering the mine shows an ad");
check((await page.textContent("#adOverlay")).includes("AD"), "the ad is labelled as an ad");
check((await page.textContent("#adOverlay")).includes("get into the mine"), "the ad says what it is for");
check(await page.locator("#adClose").isVisible(), "the close button is there from the first moment");
await page.click("#adClose");
check(!(await page.locator("#adOverlay").isVisible()), "closing the ad dismisses it");
check(!(await page.locator("#mineScene").isVisible()), "closed early: not let into the mine");
w = await wallet();
check(w.diamonds === 5, "closed early: no diamonds paid");
check((await page.textContent("#mineNote")).includes("nothing is spent"), "closed early: told it cost nothing");
check((await saved()).mine.adsWatched === 0, "closed early: not counted as watched");
await page.click('[data-act="enter-mine"]');
await page.keyboard.press("Escape");
check(!(await page.locator("#adOverlay").isVisible()) && !(await page.locator("#mineScene").isVisible()), "Escape also closes the ad, still outside");

// ---- finish the ad: into the mine
await setAdSeconds(0.3);
await page.click('[data-act="enter-mine"]');
await page.waitForSelector("#adOverlay", { state: "hidden" });
check(await page.locator("#mineScene").isVisible(), "a finished ad lets you into the mine");
check(!(await page.locator("#mineBody").isVisible()), "the entrance is out of the way");
check((await saved()).mine.adsWatched === 1 && (await saved()).mine.pass === true, "the visit and the ad count are saved");
check((await wallet()).diamonds === 5, "getting in pays nothing yet: the vein does");
const sceneBox = await page.locator("#mcanvas").boundingBox();
check(sceneBox && sceneBox.width > 300 && sceneBox.height > 300, `the mine fills the screen (${Math.round(sceneBox.width)}x${Math.round(sceneBox.height)})`);

// the scene is drawn: the middle of the canvas has rock in it, not one flat colour
const painted = await page.evaluate(() => {
  const c = document.getElementById("mcanvas"), g = c.getContext("2d");
  const d = g.getImageData(c.width * 0.3, c.height * 0.45, c.width * 0.4, c.height * 0.2).data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4 * 37) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l < min) min = l; if (l > max) max = l; }
  return max - min;
});
check(painted > 40, `the vein is drawn (contrast ${Math.round(painted)})`);

const pt = (x, y) => page.evaluate(([x, y]) => __mine.scene.clientPoint(x, y), [x, y]);
const vein = () => page.evaluate(() => { const v = __mine.scene.vein; return { hp: v.hp, max: v.maxHp, strikes: v.strikes, tinks: v.tinks, cracks: v.cracks.length, broken: v.broken }; });
async function swing(i, steps = 6) {
  const off = ((i % 3) - 1) * 0.25;
  const a = await pt(-1.3, 0.2 + off), b = await pt(1.3, -0.2 - off);
  const [p, q] = i % 2 ? [b, a] : [a, b];
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps }); await page.mouse.up();
}

// a slow drag only tinks
let v0 = await vein();
check(v0.hp === v0.max && v0.cracks === 0 && !v0.broken, "a fresh vein: full health, no cracks");
{
  const a = await pt(-1.3, 0), b = await pt(1.3, 0);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let k = 1; k <= 50; k++) { await page.mouse.move(a.x + (b.x - a.x) * k / 50, a.y); await page.waitForTimeout(45); }
  await page.mouse.up();
}
let v1 = await vein();
check(v1.hp === v1.max && v1.tinks === 1, `a slow drag just tinks off the rock, no damage (${JSON.stringify(v1)})`);

// swings crack it
await swing(0);
v1 = await vein();
check(v1.strikes === 1 && v1.hp < v1.max && v1.cracks >= 1, `one swing: one strike, a crack opens (hp ${Math.round(v1.hp)})`);
const bar1 = await page.evaluate(() => parseFloat(document.getElementById("veinBar").style.width));
check(Math.abs(bar1 - 100 * v1.hp / v1.max) < 0.5, "the vein bar shows what is left");
check((await page.textContent("#mSwings")) === "1", "the swing count shows");
await page.waitForTimeout(40);
await swing(1);
const v2 = await vein();
check(v2.strikes === 2 && v2.cracks > v1.cracks, "a second swing: more cracks");
if (shots) await page.screenshot({ path: `${shots}/mine-cracking.png` });

// leave halfway: the visit is kept, walk back in for free
await page.click("#mLeaveBtn");
check(await page.locator("#mineBody").isVisible() && !(await page.locator("#mineScene").isVisible()), "LEAVE goes back to the entrance");
check((await page.textContent("#mineNote")).includes("visit is saved"), "leaving halfway: told the visit is kept");
check((await page.textContent('[data-act="enter-mine"]')).includes("BACK TO THE VEIN"), "the entrance offers the way back in");
await reload();
check((await saved()).mine.pass === true, "the visit survives a reload");
await setAdSeconds(30);
await page.click('[data-act="enter-mine"]');
check(!(await page.locator("#adOverlay").isVisible()) && await page.locator("#mineScene").isVisible(), "a saved visit walks back in with no second ad");

// crack it open
let n = 0;
while (!(await vein()).broken && n < 20) await swing(n++);
const vb = await vein();
check(vb.broken, `the vein cracks open after ${vb.strikes} swings`);
w = await wallet();
check(w.diamonds === 5 + cfg.v, `cracking the vein pays exactly ${cfg.v} diamonds (now ${w.diamonds})`);
check((await saved()).wallet.diamonds === w.diamonds && (await saved()).mine.pass === false, "the diamonds are saved and the visit is used up");
await page.waitForSelector("#mresult", { state: "visible", timeout: 6000 });
check((await page.textContent("#mresult")).includes(`+${cfg.v}`), "the result shows the diamonds won");
if (shots) await page.screenshot({ path: `${shots}/mine-cracked.png` });
await swing(0);
check((await wallet()).diamonds === 5 + cfg.v, "swinging at the rubble pays nothing more");
await page.click('[data-act="mine-leave"]');
check(await page.locator("#mineBody").isVisible(), "back at the entrance");
check((await page.textContent('[data-act="enter-mine"]')).includes("ENTER THE MINE"), "another visit takes another ad");
check(!(await page.textContent("#mineNote")).includes("visit is saved"), "no stale visit message after cracking");

// ---- diamonds spend on land, a shortcut for coins
await page.click("#tabFarm");
check(await page.locator('[data-act="landdiamonds"]').isVisible(), "the farm offers land for diamonds");
await page.evaluate(() => { __farm.game.wallet.diamonds = 3; __farm.tick(); });
await page.click('[data-act="landdiamonds"]', { force: true });   // aria-disabled, still tappable to explain why
check((await page.locator(".plot[data-i]").count()) === 2 && (await wallet()).diamonds === 3, "too few diamonds: no land, nothing spent");
check((await page.textContent("#toast")).includes("The mine has more"), "too few diamonds: points at the mine");
await page.evaluate(() => { __farm.game.wallet.diamonds = 15; __farm.tick(); });
await page.click('[data-act="landdiamonds"]');
w = await wallet();
check((await page.locator(".plot[data-i]").count()) === 3 && w.diamonds === 5, `land bought for 10 diamonds (${w.diamonds} left)`);
check((await saved()).farm.plots.length === 3, "the land is saved");

// ---- timers are real while free; the loop needs nothing from the mine
await page.click('.plot[data-i="0"]');
await page.click('[data-plant="walnut"]');
check((await page.locator('.plot[data-i="0"]').getAttribute("class")).includes("growing"), "free game: a planted tree grows over time");
check(!(await page.locator("#adOverlay").isVisible()), "free game: planting never shows an ad");
const gateCopy = await page.textContent("body");
check(!/watch an ad to (plant|grow|chop|turn|continue)/i.test(gateCopy), "no ad is required to plant, grow, chop, or turn");

// ---- the full unlock
await page.click("#tabMine");
check(!(await page.locator("#fullBadge").isVisible()), "locked: no FULL badge");
await page.click('[data-act="unlock"]');
const conf = await page.textContent("#mineBody");
check(conf.includes("no money is taken"), "preview unlock says no money is taken");
await page.click('[data-act="unlock-cancel"]');
check((await saved()).mine.unlocked === false, "cancelling leaves the game free");
await page.click('[data-act="unlock"]');
await page.click('[data-act="unlock-confirm"]');
check(await page.locator("#fullBadge").isVisible(), "unlocked: a FULL badge shows");
check((await saved()).mine.unlocked === true, "the unlock is saved");
check((await page.textContent("#mineBody")).includes("Full game unlocked"), "the mine confirms the unlock");
check((await page.textContent("#mineBody")).includes("no ads"), "the mine says there are no ads");

// ads removed: walk straight in, every time
const d0 = (await wallet()).diamonds;
await page.click('[data-act="enter-mine"]');
check(!(await page.locator("#adOverlay").isVisible()) && await page.locator("#mineScene").isVisible(), "unlocked: entering the mine shows no ad");
const adsBefore = (await saved()).mine.adsWatched;
n = 0;
while (!(await vein()).broken && n < 20) await swing(n++);
check((await wallet()).diamonds === d0 + cfg.v, "unlocked: the vein still pays the same");
await page.waitForSelector('[data-act="mine-again"]', { state: "visible", timeout: 6000 });
await page.click('[data-act="mine-again"]');
check(!(await vein()).broken && (await vein()).hp === (await vein()).max, "unlocked: crack another, a fresh vein");
n = 0;
while (!(await vein()).broken && n < 20) await swing(n++);
check((await wallet()).diamonds === d0 + 2 * cfg.v, "unlocked: the second vein pays too");
check((await saved()).mine.adsWatched === adsBefore, "unlocked: no ad counted");
await page.waitForSelector("#mresult", { state: "visible", timeout: 6000 });
await page.click('[data-act="mine-leave"]');

// timers removed: the walnut planted earlier is ready, and new trees are ready at once
await page.click("#tabFarm");
check((await page.locator('.plot[data-i="0"]').getAttribute("class")).includes("mature"), "unlocked: the walnut that was growing is ready");
check((await page.textContent('.plot[data-i="0"] .plot-time')).includes("Ready"), "unlocked: no countdown shown");
await page.click('.plot[data-i="1"]');
check((await page.textContent("#ctx")).includes("Ready right away"), "unlocked: planting says ready right away");
await page.click('[data-plant="oak"]');
check((await page.locator('.plot[data-i="1"]').getAttribute("class")).includes("mature"), "unlocked: a new tree is ready the moment it is planted");
check((await page.locator('[data-act="speedup"]').count()) === 0 && (await page.locator('[data-act="grownow"]').count()) === 0, "unlocked: no speed-up buttons to sell");

// ---- survives a reload
await reload();
check(await page.locator("#fullBadge").isVisible(), "reload: still unlocked");
check((await page.locator('.plot[data-i="1"]').getAttribute("class")).includes("mature"), "reload: trees are still ready");
check(!(await page.textContent("#toast")).includes("While you were away"), "reload: no stale welcome-back message when unlocked");

if (shots) {
  await page.click("#tabMine");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${shots}/mine-unlocked.png` });
  await page.evaluate(() => { const g = __farm.game; g.mine.unlocked = false; __farm.persist(); });
  await reload();
  await page.click("#tabMine");
  await page.evaluate(() => { window.__mine.adProvider.seconds = 30; });
  await page.screenshot({ path: `${shots}/mine.png` });
  await page.click('[data-act="enter-mine"]');
  await page.screenshot({ path: `${shots}/ad.png` });
  await page.click("#adClose");
  console.log(`  shots in ${shots}`);
}

// ---- layout: nothing spills sideways at phone width
await page.click("#tabMine");
const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(over <= 0, `mine screen does not scroll sideways (overflow ${over}px)`);
const tabsOver = await page.evaluate(() => { const n = document.getElementById("tabs"); return n.scrollWidth - n.clientWidth; });
check(tabsOver <= 0, `tab bar and wallet fit at 420px (overflow ${tabsOver}px)`);

// ---- copy: no em dashes anywhere the player can read
const all = await page.evaluate(() => document.body.innerText);
check(!all.includes("—"), "no em dashes in what is on screen");

// ---- the lathe is untouched and free
await page.click("#tabLathe");
check(await page.locator("#stage").isVisible(), "the lathe is there with no gate");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

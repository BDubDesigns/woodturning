// Browser check of the farm, in a real page.
//   node tests/e2e-farm.mjs [path/to/page.html] [--shots dir]
// Drives the real UI: plant, persistence across reloads, growth while the
// page is closed (the saved clock is wound back, then the page is reopened),
// diamond speed-up, land expansion, and harvesting (never chopping) a mature tree.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const shotsIdx = args.indexOf("--shots");
const shots = shotsIdx >= 0 ? args.splice(shotsIdx, 2)[1] : null;
const file = resolve(args[0] || "lathe.html");
// Served over http like the real site (GitHub Pages). Headless Chromium's file:// localStorage
// intermittently reads empty after a reload, which would make the persistence checks flaky.
const server = createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(readFileSync(file)); });
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 420, height: 800 } });   // phone-sized
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };
const MIN = 60 * 1000;

const reload = async () => {   // a real reload (a same-URL goto can be a no-op)
  await page.reload();
  await page.waitForFunction(() => window.__farm);
};
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("woodturning.save")));
const plotClass = (i) => page.locator(`.plot[data-i="${i}"]`).getAttribute("class");
// Pretend the page was closed for `ms`. The page rewrites its save as it unloads, so the
// save is aged by an init script that runs on the NEXT load, before the game starts.
await page.addInitScript(() => {
  const ms = Number(localStorage.getItem("__windOnce") || 0);
  if (!ms) return;
  localStorage.removeItem("__windOnce");
  const s = JSON.parse(localStorage.getItem("woodturning.save"));
  s.farm.lastSeen -= ms;
  for (const p of s.farm.plots) if (p) p.plantedAt -= ms;
  localStorage.setItem("woodturning.save", JSON.stringify(s));
});
const windBack = (ms) => page.evaluate((ms) => localStorage.setItem("__windOnce", String(ms)), ms);

console.log("\nFARM");
await page.goto(url + "?view=2d#farm");
await page.evaluate(() => localStorage.clear());
await reload();

check(await page.locator("#farmScreen").isVisible(), "#farm opens the farm screen");
check(!(await page.locator("#latheScreen").isVisible()), "lathe screen is hidden while on the farm");
check((await page.locator(".plot[data-i]").count()) === 2, "starts with two plots");
check(await page.locator("#buyLand").isVisible(), "a buy-land tile is offered");
check((await page.textContent("#walletCoins")) === "250" && (await page.textContent("#walletDiamonds")) === "5", "wallet shows starting coins and diamonds");

// ---- plant
await page.click('.plot[data-i="0"]');
await page.click('[data-plant="pine"]');
check((await plotClass(0)).includes("growing"), "planting pine starts it growing");
let s = await saved();
check(s.farm.plots[0] && s.farm.plots[0].wood === "pine" && s.farm.plots[0].plantedAt > 0, "planting is saved with a growth timestamp");
await page.click('.plot[data-i="1"]');
await page.click('[data-plant="oak"]');
check((await saved()).farm.plots[1].wood === "oak", "a second wood grows beside it (oak)");

// ---- persists across a reload, still growing
await reload();
check((await plotClass(0)).includes("growing") && (await plotClass(1)).includes("growing"), "reload: both trees are still there and still growing");
check((await page.textContent('.plot[data-i="0"] .plot-time')).match(/^\d+:\d\d$/) !== null, "a countdown is shown");

// ---- grows while closed
await windBack(4 * MIN);   // pine takes 3 min, oak 8
await reload();
check((await plotClass(0)).includes("mature"), "closed for 4 minutes: the pine is mature on return");
check((await plotClass(1)).includes("growing"), "closed for 4 minutes: the oak is still growing");
check((await page.textContent("#toast")).includes("While you were away"), "welcome-back message mentions what grew");

// ---- speed-up
await page.click('.plot[data-i="1"]');
const rem0 = await page.evaluate(() => __farm.farm.remainingMs(__farm.farm.plotAt(1)));
await page.click('[data-act="speedup"]');
const rem1 = await page.evaluate(() => __farm.farm.remainingMs(__farm.farm.plotAt(1)));
check(Math.abs(rem0 - rem1 - 2 * MIN) < 3000, `speed up skipped 2 minutes (${Math.round(rem0 / 1000)}s -> ${Math.round(rem1 / 1000)}s)`);
check((await page.textContent("#walletDiamonds")) === "4", "speed up cost one diamond");
await page.click('[data-act="grownow"]');
check((await plotClass(1)).includes("mature"), "grow now finishes the oak");
const dia = await page.textContent("#walletDiamonds");
check(Number(dia) >= 0 && Number(dia) < 4, `grow now spent the rest (${dia} diamonds left)`);
check((await saved()).wallet.diamonds === Number(dia), "diamond balance is saved");
// ---- land
await page.evaluate(() => { __farm.game.wallet.coins = 90; __farm.tick(); });
await page.click("#buyLand");
check((await page.locator(".plot[data-i]").count()) === 2, "not enough coins: no land bought");
check((await page.textContent("#toast")).includes("100 coins"), "the message says what it costs");
await page.evaluate(() => { __farm.game.wallet.coins = 150; __farm.tick(); });
await page.click("#buyLand");
check((await page.locator(".plot[data-i]").count()) === 3, "with coins: a third plot appears");
check((await page.textContent("#walletCoins")) === "50", "land cost 100 coins");
check((await saved()).farm.plots.length === 3, "extra land is saved");
await page.click('[data-plant="walnut"]');
check((await page.locator(".plot.growing").count()) >= 1 && (await saved()).farm.plots[2].wood === "walnut", "new land grows a third wood at the same time");
// not enough diamonds: the speed-up is refused and nothing changes
await page.evaluate(() => { __farm.game.wallet.diamonds = 0; __farm.tick(); });
await page.click('[data-act="grownow"]', { force: true });   // aria-disabled, but still tappable to explain why
check((await page.textContent("#toast")).includes("You have 0"), "too few diamonds: told what it costs");
check((await plotClass(2)).includes("growing") && (await page.textContent("#walletDiamonds")) === "0", "too few diamonds: the tree is untouched");
await reload();
check((await page.locator(".plot[data-i]").count()) === 3, "reload: the land is still owned");

// ---- no chop on the farm: a grown tree is only harvested
await page.evaluate(() => { const f = __farm.farm; f.state.plots[0] = null; f.plant(0, "pine"); f.state.plots[0].plantedAt -= 10 * 60 * 1000; __farm.tick(); });
check((await plotClass(0)).includes("mature"), "set up a mature pine");
check((await page.textContent('.plot[data-i="0"]')).includes("Ready to harvest"), "a grown tree says it is ready to harvest");
check((await page.locator("#tabHarvest").count()) === 0, "there is no HARVEST tab");
const box = await page.locator('.plot[data-i="0"]').boundingBox();
for (const fromLeft of [true, false, true, false, true]) {
  const y = box.y + box.height * 0.6;
  const a = box.x + box.width * (fromLeft ? 0.15 : 0.85), b = box.x + box.width * (fromLeft ? 0.7 : 0.3);
  await page.mouse.move(a, y); await page.mouse.down();
  for (let k = 1; k <= 6; k++) { await page.mouse.move(a + ((b - a) * k) / 6, y); await page.waitForTimeout(15); }
  await page.mouse.up(); await page.waitForTimeout(60);
}
check((await page.evaluate(() => __farm.farm.plotAt(0) && __farm.farm.plotAt(0).wood)) === "pine", "swiping a grown tree does not chop it");
check((await page.evaluate(() => __farm.farm.logCount("pine"))) === 0, "no log from swiping");
await page.evaluate(() => { __farm.select(0); __farm.tick(); });
check((await page.locator('[data-act="chop"]').count()) === 0, "the panel has no CHOP button");
check((await page.locator('[data-act="harvest"].primary').count()) === 1, "HARVEST is the panel's main action for a grown tree");
check((await page.textContent("#ctx")).includes("forest"), "the panel points to the forest");
// a growing tree cannot be harvested
await page.evaluate(() => { __farm.farm.state.plots[1] = null; __farm.farm.plant(1, "oak"); __farm.select(1); __farm.tick(); });
check((await page.locator('[data-act="harvest"]').count()) === 0, "a growing tree has no HARVEST");
check(await page.evaluate(() => { window.Game.harvestPlot = 1; window.Game.showScreen("harvest"); return document.getElementById("harvestScreen").hidden; }), "the forest will not open on a growing tree");
// the HARVEST button opens the forest on this tree
await page.evaluate(() => { __farm.select(0); __farm.tick(); });
await page.click('[data-act="harvest"]');
await page.waitForFunction(() => window.__harvest && window.__harvest.running);
const hsrc = await page.evaluate(() => window.__harvest.source);
check(hsrc && hsrc.plot === 0 && hsrc.wood === "pine", "HARVEST opens the forest on the tapped tree");
await page.click("#tabFarm");
// a log for the lathe checks below, as if this pine had been harvested
await page.evaluate(() => { __farm.farm.fell(0); __farm.tick(); });
check((await page.textContent("#shed")).includes("Pine"), "a felled pine shows in the shed");
check((await saved()).inventory.stacks.log.pine === 1, "the log is saved in the shared inventory");

if (shots) {
  await page.evaluate(() => { const f = __farm.farm; f.state.plots[1] = null; f.plant(1, "walnut"); f.state.plots[1].plantedAt -= 6 * 60 * 1000; __farm.tick(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${shots}/farm.png` });
  console.log(`  shot ${shots}/farm.png`);
}

// ---- tabs: back to the lathe and it still works
await page.click("#tabLathe");
check(await page.locator("#stage").isVisible() && !(await page.locator("#farmScreen").isVisible()), "LATHE tab shows the lathe");
await page.waitForTimeout(400);
const lay = await page.evaluate(() => { const l = window.__lathe.views.current.layout(); return l.right - l.left; });
check(lay > 100, `lathe resized to the stage after returning (${Math.round(lay)}px wide)`);

// ---- the shed's log goes on the lathe; DONE turns it into a piece
check((await page.textContent("#stockLabel")) === "PRACTICE", "the lathe starts on a practice blank");
await page.click("#stockBtn");
check(await page.locator("#stockMenu").isVisible(), "STOCK opens the shed's list");
check((await page.textContent("#stockMenu")).includes("Pine log"), "the pine log from the farm is offered");
await page.click('#stockMenu [data-stock="log"][data-key="pine"]');
check(!(await page.locator("#stockMenu").isVisible()) && (await page.textContent("#stockLabel")) === "PINE LOG", "the pine log is mounted");
check((await page.evaluate(() => __farm.farm.logCount("pine"))) === 1, "mounting leaves the log in the shed until DONE");
await page.click("#doneBtn");
check((await page.textContent("#ltoast")).includes("Turn it first") && (await page.evaluate(() => __farm.farm.logCount("pine"))) === 1, "DONE before any cut keeps the log and says why");
const cutAt = await page.evaluate(() => { const v = window.__lathe.views.current, l = v.layout(), r = document.getElementById("stage").getBoundingClientRect(); return { x: r.left + (l.left + l.right) / 2, y: Math.min(r.bottom - 30, r.top + l.cy + l.rPx + 70) }; });
await page.mouse.move(cutAt.x, cutAt.y); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(cutAt.x, cutAt.y - 4 * i); await page.waitForTimeout(25); }
await page.waitForTimeout(900); await page.mouse.up();
await page.click("#doneBtn");
const turned = await page.evaluate(() => { const inv = __farm.state.inventory; return { logs: inv.count("log", "pine"), pieces: inv.list("piece").map((p) => ({ wood: p.wood, from: p.from })), label: document.getElementById("stockLabel").textContent }; });
check(turned.logs === 0 && turned.pieces.length === 1 && turned.pieces[0].wood === "pine" && turned.pieces[0].from === "log", "DONE: the log left the shed and a pine piece went in");
check(turned.label === "PRACTICE", "after DONE the lathe is back on a practice blank");
check((await saved()).inventory.items.filter((i) => i.kind === "piece").length === 1, "the piece is saved");
await page.click("#tabFarm");
check(await page.locator("#farmScreen").isVisible(), "FARM tab shows the farm again");
check((await page.textContent("#shed")).includes("Pieces"), "the shed lists the turned piece");

// ---- storage blocked: the page still plays
const ctx2 = await browser.newContext({ viewport: { width: 420, height: 800 } });
const p2 = await ctx2.newPage();
await p2.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
const errs2 = [];
p2.on("pageerror", (e) => errs2.push(e.message));
await p2.goto(url + "?view=2d#farm");
await p2.waitForFunction(() => window.__farm);
await p2.click('.plot[data-i="0"]');
await p2.click('[data-plant="pine"]');
check((await p2.locator('.plot[data-i="0"]').getAttribute("class")).includes("growing"), "with storage blocked, planting still works");
check(errs2.length === 0, "with storage blocked, no page errors" + (errs2.length ? ": " + errs2.join(" | ") : ""));
await ctx2.close();

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

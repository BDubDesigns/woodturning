// Browser check of the mine and the money model, in a real page.
//   node tests/e2e-mine.mjs [path/to/page.html] [--shots dir]
// Drives the real UI: the ad trade (finish and close early), gems and selling,
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
  gems: Number(await page.textContent("#walletGems")),
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
check(w.coins === 250 && w.diamonds === 5 && w.gems === 0, "wallet shows coins, diamonds and gems");

// ---- the trade is transparent: the screen prints what the model pays
const text = await page.textContent("#mineBody");
const cfg = await page.evaluate(() => ({ d: Game.Monetize.CFG.DIAMONDS_PER_AD, g: Game.Monetize.CFG.GEMS_PER_AD, c: Game.Monetize.CFG.COINS_PER_GEM, p: Game.Monetize.priceLabel() }));
check(text.includes(`get ${cfg.d} diamonds`), `the screen says one ad gives ${cfg.d} diamonds`);
check(text.includes(`${cfg.c} coins`), `the screen says a gem sells for ${cfg.c} coins`);
check(text.includes("No dice, no hidden rates"), "the screen says there is no randomness");
check(text.includes("complete game") && text.includes("only skip waiting"), "the free-game promise is printed");
check(text.includes(cfg.p) && text.includes("removes every ad and every timer"), "the unlock states its price and what it does");

// ---- close the ad early: nothing paid, nothing lost
await setAdSeconds(30);
await page.click('[data-act="mine-diamonds"]');
check(await page.locator("#adOverlay").isVisible(), "mining shows an ad");
check((await page.textContent("#adOverlay")).includes("AD"), "the ad is labelled as an ad");
check(await page.locator("#adClose").isVisible(), "the close button is there from the first moment");
await page.click("#adClose");
check(!(await page.locator("#adOverlay").isVisible()), "closing the ad dismisses it");
w = await wallet();
check(w.diamonds === 5, "closed early: no diamonds paid");
check((await page.textContent("#mineNote")).includes("nothing spent"), "closed early: told it cost nothing");
check((await saved()).mine.adsWatched === 0, "closed early: not counted as watched");
await page.click('[data-act="mine-diamonds"]');
await page.keyboard.press("Escape");
check(!(await page.locator("#adOverlay").isVisible()) && (await wallet()).diamonds === 5, "Escape also closes the ad with no reward");

// ---- finish the ad: exactly the printed amount
await setAdSeconds(0.3);
await page.click('[data-act="mine-diamonds"]');
await page.waitForSelector("#adOverlay", { state: "hidden" });
w = await wallet();
check(w.diamonds === 5 + cfg.d, `a finished ad pays exactly ${cfg.d} diamonds (now ${w.diamonds})`);
check((await saved()).wallet.diamonds === w.diamonds && (await saved()).mine.adsWatched === 1, "the diamonds and the ad count are saved");
await page.click('[data-act="mine-diamonds"]');
await page.waitForSelector("#adOverlay", { state: "hidden" });
check((await wallet()).diamonds === 5 + 2 * cfg.d, "a second ad pays the same, no dice");

// ---- gems, and selling them
await page.click('[data-act="mine-gems"]');
await page.waitForSelector("#adOverlay", { state: "hidden" });
w = await wallet();
check(w.gems === cfg.g, `mining gems pays exactly ${cfg.g}`);
await page.click('[data-act="sell-gems"]');
w = await wallet();
check(w.gems === 0 && w.coins === 250 + cfg.c * cfg.g, `selling gems pays ${cfg.c} coins each (${w.coins} coins)`);
check((await saved()).wallet.coins === w.coins, "the sale is saved");
await page.click('[data-act="sell-gems"]', { force: true });
check((await page.textContent("#mineNote")).includes("no gems"), "selling with no gems says so");

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

// ads removed: mining is immediate
const d0 = (await wallet()).diamonds;
await page.click('[data-act="mine-diamonds"]');
check(!(await page.locator("#adOverlay").isVisible()), "unlocked: mining shows no ad");
check((await wallet()).diamonds === d0 + cfg.d, "unlocked: mining still pays the same");
const adsBefore = (await saved()).mine.adsWatched;
await page.click('[data-act="mine-gems"]');
check((await saved()).mine.adsWatched === adsBefore, "unlocked: no ad counted");

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
  await page.click('[data-act="mine-diamonds"]');
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

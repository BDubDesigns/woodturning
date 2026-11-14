// Browser checks of Arbor Freight, the tool store.
//   node tests/e2e-shop.mjs [path/to/page.html] [shots-dir]
//
//  1. The store shows every line with what is installed and the next rung's price.
//  2. Short of coins: SAVE UP, and a tap buys nothing.
//  3. Buying the halogen takes the coins and hangs it over the lathe (S.lightLevel).
//  4. Buying chisels puts new tips on the rack, and they cut.
//  5. Buying a motor makes the same pass take more wood off.
//  6. What was bought is saved: a reload keeps it.
//  7. Blueprints: buying the bat's makes bat orders turn up on the board, and the
//     board teases the next one.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";

const file = resolve(process.argv[2] || "lathe.html");
const shots = process.argv[3] || null;
let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`file://${file}?tutorial=off&view=2d&testclock#shop`);
await page.waitForFunction(() => window.__shop && window.__lathe && window.__lathe.setSpec);
const tick = (s) => page.evaluate((s) => window.__lathe.advance(s), s);   // the lathe runs on its test clock (?testclock)
await tick(0.3);
const coins = () => page.evaluate(() => window.__farm.state.wallet.balance("coins"));

console.log("\nTHE STORE");
check(/ARBOR/.test(await page.locator("#screenTitle").textContent()), "the SHOP tab opens Arbor Freight");
check((await page.locator("#tabOrders").textContent()).trim() === "ORDERS" && (await page.locator("#tabShop").textContent()).trim() === "SHOP", "the tabs read ORDERS and SHOP");
check(await page.locator(".af-line[data-line]").count() === 6, "six lines: lighting, motor, chisels, sandpaper, brushes, finishing");
check(await page.locator(".bp-card").count() === 5 && await page.locator(".bp-card .bp-art").count() === 5, "and a blueprint card, with its drawing, for every piece");
check(/OWNED/.test(await page.locator('[data-blueprint="rolling_pin"]').textContent()), "the rolling pin blueprint comes with the shed");
check(await page.locator(".af-price").count() === 6, "each shows the next rung's price tag");
check(/80 grit/.test(await page.locator('.af-line[data-line="abrasives"]').textContent()) && /150 grit/.test(await page.locator('.af-line[data-line="abrasives"]').textContent()), "sandpaper: 80 grit installed, 150 grit next");
if (shots) await page.screenshot({ path: `${shots}/shop.png` });

console.log("\nSHORT OF COINS");
await page.evaluate(() => { const w = window.__farm.state.wallet; w.spend("coins", w.balance("coins") - 100); window.__shop.ui.render(true); });
check(/SAVE UP/.test(await page.locator('[data-buy="light"]').textContent()), "with 100 coins the 150 halogen says SAVE UP");
await page.click('[data-buy="light"]', { force: true });   // a real tap still lands on a greyed button
check(/150 coins and you have 100/.test(await page.locator("#stoast").textContent()), "the store says what it costs");
check(await coins() === 100 && await page.evaluate(() => window.__shop.shop.level("light")) === 0, "and a tap buys nothing");

console.log("\nBLUEPRINTS");
check(/BUY IT/.test(await page.locator('[data-blueprint="baseball_bat"]').textContent()) && /SAVE UP/.test(await page.locator('[data-blueprint="walking_stick"]').textContent()),
  "with 100 coins the 100 coin bat says BUY IT and the 250 walking stick SAVE UP");
await page.click('[data-blueprint="walking_stick"]', { force: true });
check(await coins() === 100 && !(await page.evaluate(() => window.__orders.board.ownsBlueprint("walking_stick"))), "a tap on SAVE UP buys nothing");
if (shots) await page.screenshot({ path: `${shots}/shop-blueprints.png` });
await page.click('[data-blueprint="baseball_bat"]');
await tick(0.2);
check(await coins() === 0 && await page.evaluate(() => window.__orders.board.ownsBlueprint("baseball_bat")), "BUY IT takes the 100 coins and the bat blueprint is owned");
check(/OWNED/.test(await page.locator('[data-bp-card="baseball_bat"]').textContent()), "its card is stamped OWNED");
check(/Blueprint bought/.test(await page.locator("#stoast").textContent()), "the store says so");
await page.evaluate(() => window.Game.showScreen("orders"));
const turned = await page.evaluate(() => {
  const b = window.__orders.board;
  for (let i = 0; i < 60 && !b.state.orders.some((o) => o.kind === "baseball_bat"); i++) {
    b.state.orders.slice().forEach((o) => b.decline(o.id));
    b.state.nextAt = 0; b.refill();
  }
  window.__orders.ui.render(true);
  return b.state.orders.map((o) => o.kind);
});
check(turned.includes("baseball_bat") && turned.every((k) => k === "baseball_bat" || k === "rolling_pin"), "bat orders turn up on the board now, and nothing else unowned (" + turned.join(", ") + ")");
check(await page.locator('.order[data-kind="baseball_bat"] [data-act="take"]').count() > 0 && await page.locator(".order.locked").count() === 0, "and can be taken: nothing on the board is locked");
check(await page.locator(".order.teaser").count() === 1 && /Walking stick/.test(await page.locator(".order.teaser").textContent()), "the board teases the next blueprint, the walking stick");
check(await page.locator(".order[data-order]").count() === 3, "the teaser takes no slot");
if (shots) await page.screenshot({ path: `${shots}/board-teaser.png`, fullPage: true });
await page.click('.order.teaser [data-act="teaser"]');
await tick(0.2);
check(await page.evaluate(() => window.Game.currentScreen()) === "shop", "its button opens the shop");
await page.evaluate(() => window.Game.showScreen("shop"));

console.log("\nBUYING");
await page.evaluate(() => { window.__farm.state.wallet.earn("coins", 5000); window.__shop.ui.render(true); });
const c0 = await coins();
await page.click('[data-buy="light"]');
await tick(0.2);
check(await coins() === c0 - 150, `the halogen costs 150 coins (${c0} -> ${await coins()})`);
check(await page.evaluate(() => window.__lathe.lightLevel) === 1, "and hangs over the lathe");
check(/Installed: Halogen/.test(await page.locator("#stoast").textContent()), "the store says so");
check(/LED shop panel/.test(await page.locator('.af-line[data-line="light"]').textContent()), "the next rung is offered");
check((await page.locator("#walletCoins").textContent()) === String(await coins()), "the wallet shows the new balance");

await page.click('[data-buy="chisels"]');
await tick(0.2);
await page.click("#tabLathe");
await tick(0.4);
const empty = await page.evaluate(() => ({ empty: window.__lathe.empty, pick: !document.getElementById("lathePick").hidden, done: document.getElementById("doneBtn").getAttribute("aria-disabled") }));
check(empty.empty && empty.pick && empty.done === "true" && (await page.locator("#stockLabel").textContent()) === "PICK WOOD", "the lathe starts empty and asks what to turn: nothing is loaded on its own");
{
  const box = await page.locator("#stage").boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.9); await page.mouse.down(); await tick(0.3); await page.mouse.up();
  check(await page.evaluate(() => window.__lathe.work.removedFraction()) === 0, "and a touch on the empty lathe cuts nothing");
}
await page.click('#lathePick [data-stock="practice"]');
await tick(0.1);
check(await page.evaluate(() => !window.__lathe.empty && document.getElementById("lathePick").hidden), "picking the practice blank mounts it");
check(await page.locator('#toolsCut [data-tip="parting"]').isVisible(), "a parting tool is on the rack");
await page.locator('#toolsCut [data-tip="parting"]').click();
check(await page.evaluate(() => window.__lathe.tip) === "parting", "and can be picked");

// the same short pass, before and after a motor upgrade: more wood comes off after
async function pass() {
  await page.evaluate(() => window.Lathe.mountBlank(null));
  await tick(0.2);
  const box = await page.locator("#stage").boundingBox();
  const x = box.x + box.width * 0.5, y = box.y + box.height * 0.8;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x, y - 4 * i); await tick(0.016); }
  await tick(0.6);
  await page.mouse.up();
  await tick(0.1);
  return page.evaluate(() => window.__lathe.work.removedFraction());
}
await page.evaluate(() => window.__lathe.setTip("gouge"));
const before = await pass();
await page.evaluate(() => window.Game.showScreen("shop"));
await page.click('[data-buy="motor"]');
await page.evaluate(() => window.Game.showScreen("lathe"));
await tick(0.2);
check(await page.evaluate(() => window.__lathe.cutBoost) > 0.5, "the one horse motor is installed");
const after = await pass();
check(after > before, `the same pass takes more off with the bigger motor (${(before * 100).toFixed(2)}% -> ${(after * 100).toFixed(2)}%)`);
if (shots) await page.screenshot({ path: `${shots}/lathe-upgraded.png` });

// a better brush and sprayer: the same stroke lays more paint, the same sweep more sheen
async function stroke(mode) {
  await page.evaluate((m) => { window.Lathe.mountBlank(null); window.__lathe.setMode(m); }, mode);
  await tick(0.2);
  const box = await page.locator("#stage").boundingBox();
  const x = box.x + box.width * 0.5, y = box.y + box.height * 0.8;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x, y - 4 * i); await tick(0.016); }
  await tick(0.15);
  await page.mouse.up();
  await tick(0.1);
  return page.evaluate((m) => m === "paint" ? window.__lathe.coat.coverage() : window.__lathe.coat.avgGloss(), mode);
}
const paint0 = await stroke("paint"), sheen0 = await stroke("finish");
await page.evaluate(() => window.Game.showScreen("shop"));
await page.click('[data-buy="brushes"]');
check(/Installed: Sash brush/.test(await page.locator("#stoast").textContent()), "the sash brush is installed");
await page.click('[data-buy="finish"]');
check(/Installed: Trigger sprayer/.test(await page.locator("#stoast").textContent()), "the trigger sprayer is installed");
await page.evaluate(() => window.Game.showScreen("lathe"));
const paint1 = await stroke("paint"), sheen1 = await stroke("finish");
check((await page.locator("#finishName").textContent()) === "TRIGGER SPRAYER", "the finish panel names the trigger sprayer");
check(paint1 > paint0 * 1.2, `the same stroke lays more paint with the sash brush (${paint0.toFixed(3)} -> ${paint1.toFixed(3)})`);
check(sheen1 > sheen0 * 1.2, `the same sweep builds more sheen with the trigger sprayer (${sheen0.toFixed(3)} -> ${sheen1.toFixed(3)})`);
await page.evaluate(() => window.__lathe.setMode("cut"));

console.log("\nSAVED");
await page.evaluate(() => window.__farm.persist());
await page.reload();
await page.waitForFunction(() => window.__shop && window.__lathe && window.__lathe.setSpec);
await tick(0.2);
const kept = await page.evaluate(() => ({ light: window.__lathe.lightLevel, tips: window.__lathe.tips, boost: window.__lathe.cutBoost, flow: window.__lathe.brushTool.flow, rate: window.__lathe.sprayGun.rate }));
check(kept.light === 1 && kept.tips.includes("parting") && kept.boost > 0.5, "after a reload the lamp, the chisel and the motor are still there");
check(kept.flow > 1 && kept.rate > 1, "and so are the brush and the sprayer");

console.log("\nRESET PROFILE");
await page.click("#settingsBtn");
check(!(await page.locator("#settingsOverlay").isHidden()), "the gear opens Settings");
await page.locator('#settingsOverlay [data-act="reset"]').click();
check(/TAP AGAIN/.test(await page.locator('#settingsOverlay [data-act="reset"]').textContent()) && await page.evaluate(() => window.__shop.shop.level("light")) === 1, "one tap only arms it: nothing is wiped yet");
await Promise.all([page.waitForNavigation(), page.locator('#settingsOverlay [data-act="reset"]').click()]);
await page.waitForFunction(() => window.__shop && window.__lathe && window.__lathe.setSpec);
await tick(0.2);
const fresh = await page.evaluate(() => ({ coins: window.__farm.state.wallet.balance("coins"), light: window.__shop.shop.level("light"), motor: window.__shop.shop.level("motor"), tips: window.__lathe.tips, done: window.__orders.board.state.done }));
check(fresh.coins === 250 && fresh.light === 0 && fresh.motor === 0 && fresh.tips.length === 2, `the second tap starts over as a new player (${JSON.stringify(fresh)})`);
await page.evaluate(() => { window.__farm.state.wallet.earn("coins", 77); window.__farm.persist(); });
await page.goto(`file://${file}?tutorial=off&view=2d&testclock&reset`);
await page.waitForFunction(() => window.__shop && window.__lathe && window.__lathe.setSpec);
check(await page.evaluate(() => window.__farm.state.wallet.balance("coins")) === 250, "?reset on the URL starts over too");
check(!/reset/.test(await page.evaluate(() => location.search)), "and drops itself from the URL, so a reload does not wipe again");

console.log("\nLAYOUT");
for (const w of [360, 412]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.evaluate(() => window.Game.showScreen("shop"));
  await tick(0.2);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= w, `no sideways scroll at ${w}px (${sw})`);
}
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

// Order cards that say where the wood is, and get it for you. In a real page.
//   node tests/e2e-orders-wood.mjs [path/to/page.html] [shots-dir]
//
//  1. No wood anywhere: the card says so and offers PLANT ONE. It asks first,
//     then plants in the first free plot and the card shows the tree growing,
//     with a live countdown. Short of coins or plots, it says why.
//  2. Growing: SEE THE TREE opens the farm on that plot.
//  3. Grown: CHOP IT DOWN takes the order and opens the forest on that tree.
//  4. The sawn blank: a card offers TURN IT NOW (for the order) or INTO THE SHED.
//  5. DELIVER only shows for a turned piece the customer would take; a piece
//     that isn't close enough is named as such.
//  6. With a blank in the shed, none of the farm talk: the card offers TAKE IT.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";

const file = resolve(process.argv[2] || "lathe.html");
const shots = process.argv[3] || null;
let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`file://${file}?tutorial=off&view=2d&testclock&reset#orders`);
await page.waitForFunction(() => window.__orders && window.__lathe && window.__lathe.setSpec);
// an empty shed and an empty farm, a known wallet, and one pine order first on the board
await page.evaluate(() => {
  const f = window.__farm, inv = f.game.inventory;
  inv.stacks = {}; inv.items = [];
  f.farm.state.plots = f.farm.state.plots.map(() => null);
  const w = f.state.wallet; w.spend("coins", w.balance("coins")); w.earn("coins", 100);
  f.persist(); window.__orders.ui.render(true);
});
const pineCard = () => page.locator('.order[data-order][data-wood="pine"]').first();
const pineId = await pineCard().getAttribute("data-order");
const card = () => page.locator(`.order[data-order="${pineId}"]`);
const render = () => page.evaluate(() => window.__orders.ui.render(true));
const text = async () => (await card().textContent()).replace(/\s+/g, " ");
const hasAct = (a) => card().locator(`[data-act="${a}"]`).count().then((n) => n > 0);

console.log("\nNO WOOD ANYWHERE: PLANT ONE");
check(/No pine in the shed or on the farm/.test(await text()), "the card says there is no pine in the shed or on the farm");
check(await hasAct("plant") && /PLANT ONE/.test(await text()) && /10 coins/.test(await text()), "and offers PLANT ONE, with the seed's price");
await card().locator('[data-act="plant"]').click();
let ov = await page.locator("#gradeOverlay").textContent();
check(!(await page.locator("#gradeOverlay").isHidden()) && /Plant a pine\?/.test(ov) && /plot 1/.test(ov) && /You have 100/.test(ov), "it asks first: what it costs, where it goes, what you have");
check(!/[—–]/.test(ov), "no em dashes in the question");
await page.click('#gradeOverlay [data-act="noplant"]');
check(await page.locator("#gradeOverlay").isHidden() && await page.evaluate(() => !window.__farm.farm.plotAt(0)), "NOT NOW plants nothing");
await card().locator('[data-act="plant"]').click();
if (shots) await page.screenshot({ path: `${shots}/plant-confirm.png` });
await page.click('#gradeOverlay [data-act="doplant"]');
let w = await page.evaluate(() => ({ plot: window.__farm.farm.plotAt(0), coins: window.__farm.state.wallet.balance("coins") }));
check(w.plot && w.plot.wood === "pine" && w.coins === 90, `PLANT IT plants a pine in plot 1 for 10 coins (${w.coins} left)`);

console.log("\nGROWING");
await render();
check(/Your pine tree is growing: .* to go/.test(await text()), `the card shows it growing, with the time to go (${(await text()).match(/growing: ([^.]*) to go/)?.[1]})`);
const t0 = await card().locator("[data-grow]").textContent();
await page.evaluate(() => { const p = window.__farm.farm.plotAt(0); p.plantedAt -= 20000; window.__farm.persist(); });
await page.waitForTimeout(1300);
const t1 = await card().locator("[data-grow]").textContent();
check(t0 !== t1, `the countdown ticks (${t0} -> ${t1})`);
check(await hasAct("seetree") && !(await hasAct("plant")), "SEE THE TREE instead of PLANT ONE");
if (shots) await page.screenshot({ path: `${shots}/growing.png` });
await card().locator('[data-act="seetree"]').click();
check(await page.evaluate(() => window.Game.currentScreen() === "farm" && window.__farm.selected === 0), "SEE THE TREE opens the farm with that tree picked");

console.log("\nGROWN: CHOP IT DOWN");
await page.evaluate(() => { const p = window.__farm.farm.plotAt(0); p.plantedAt -= 1e9; window.__farm.persist(); window.Game.showScreen("orders"); });
await render();
check(/Your pine tree is grown and ready to chop down/.test(await text()), "grown: the card says it is ready to chop down");
check(await hasAct("fell") && /CHOP IT DOWN/.test(await text()) && /Take the order/.test(await text()), "with CHOP IT DOWN, which takes the order");
if (shots) await page.screenshot({ path: `${shots}/grown.png` });
await card().locator('[data-act="fell"]').click();
await page.waitForTimeout(200);
w = await page.evaluate(() => ({ screen: window.Game.currentScreen(), active: window.__orders.board.state.active, plot: window.Game.harvestPlot, src: window.__harvest && window.__harvest.source }));
check(w.active === Number(pineId), "CHOP IT DOWN takes the order");
check(w.screen === "harvest" && w.plot === 0 && w.src && w.src.plot === 0 && w.src.wood === "pine", "and opens the forest on that very tree");

console.log("\nTHE SAWN BLANK");
// the real saw is played in e2e.mjs; here the blank arrives as it does when the saw frees it
const blankId = await page.evaluate(() => {
  const f = window.__farm, S = window.__lathe;
  f.farm.fell(0);
  f.state.inventory.take("log", "pine");
  const it = f.state.inventory.add("blank", { wood: "pine", seed: 3, profile: window.Game.State.pack(new Float32Array(S.work.radius.length).fill(S.work.baseRadius[0])), lengthUnits: 1, lengthRatio: 1, girthUnits: 1 });
  window.Lathe.harvestHost.offerBlank(it);
  return it.id;
});
let ch = await page.locator(".blank-choice").textContent();
check(/Your pine blank is ready/.test(ch) && /for .*'s/.test(ch) && /On the lathe for/.test(ch), "the card says the blank is for the order, and TURN IT NOW turns it for them");
check(/INTO THE SHED/.test(ch), "INTO THE SHED is the other choice");
if (shots) await page.screenshot({ path: `${shots}/blank-choice.png` });
await page.click('.blank-choice [data-act="toshed"]');
w = await page.evaluate(() => ({ screen: window.Game.currentScreen(), blanks: window.__farm.state.inventory.count("blank"), active: window.__orders.board.state.active, card: !!document.querySelector(".blank-choice") }));
check(w.screen === "farm" && w.blanks === 1 && !w.card, "INTO THE SHED: back to the farm, the blank in the shed");
check(w.active === Number(pineId), "and the order stays taken");
await page.evaluate(() => {   // back to the forest (it only opens on a grown tree), and the same choice again
  const f = window.__farm; f.farm.state.plots[0] = { wood: "pine", plantedAt: 0, skipped: 0 };
  window.Game.harvestPlot = 0; window.Game.showScreen("harvest");
});
await page.evaluate((id) => window.Lathe.harvestHost.offerBlank(window.__farm.state.inventory.get(id)), blankId);
await page.click('.blank-choice [data-act="turnnow"]');
await page.evaluate(() => window.__lathe.advance(0.2));
w = await page.evaluate(() => ({ screen: window.Game.currentScreen(), stock: window.__lathe.stock, order: window.__lathe.order && window.__lathe.order.id }));
check(w.screen === "lathe" && w.stock && w.stock.kind === "blank" && w.stock.id === blankId && w.order === Number(pineId), "TURN IT NOW: that blank on the lathe, with the order on it");

console.log("\nWITH A BLANK IN THE SHED");
await page.evaluate(() => { window.__orders.board.release(); window.__lathe.syncOrder(); window.__lathe.closeStock && window.__lathe.closeStock(); window.Game.showScreen("orders"); });
await render();
check(/In the shed: 1 pine blank/.test(await text()) && await hasAct("take") && !(await hasAct("fell")) && !(await hasAct("plant")) && !(await hasAct("seetree")), "the card offers TAKE IT and none of the farm talk");

console.log("\nDELIVER ONLY WHAT FITS");
const made = await page.evaluate((id) => {
  const f = window.__farm, b = window.__orders.board, C = window.Game.Commissions, St = window.Game.State, o = b.get(id);
  const target = C.targetProfile(o), n = target.length, base = new Float32Array(n).fill(window.__lathe.work.baseRadius[0]);
  const piece = (prof) => f.state.inventory.add("piece", { wood: "pine", from: "blank", shape: "Test", profile: St.pack(prof), start: St.pack(base), order: null,
    coat: { coat: St.pack(new Float32Array(n), 3), color: St.pack(new Float32Array(n * 3), 3), gloss: St.pack(new Float32Array(n), 3) }, sheen: null, spec: null, match: null, removed: 0, rough: St.pack(new Float32Array(n).fill(0.1), 3) });
  const bad = piece(base);
  return { bad: b.preview(id, bad.id).accepted, badId: bad.id };
}, Number(pineId));
await render();
check(!made.bad, "a piece left as the round blank would be turned down");
check(!(await hasAct("deliver")) && /isn't close enough for this one/.test(await text()), "so no DELIVER: the card says the turned piece isn't close enough");
const good = await page.evaluate((id) => {
  const f = window.__farm, b = window.__orders.board, C = window.Game.Commissions, St = window.Game.State, P = window.Lathe.Paint, o = b.get(id);
  const target = C.targetProfile(o), n = target.length, coat = new Float32Array(n), color = new Float32Array(n * 3), gloss = new Float32Array(n).fill(P.SHEEN[o.spec.sheen].gloss);
  for (let i = 0; i < n; i++) { const t = i / (n - 1), sg = o.spec.segments.find((s) => t >= s.a && t <= s.b); if (sg && sg.paint) { coat[i] = 1; color.set(P.PALETTE[sg.paint].rgb, i * 3); } }
  const it = f.state.inventory.add("piece", { wood: "pine", from: "blank", shape: "Test", profile: St.pack(target), start: St.pack(new Float32Array(n).fill(window.__lathe.work.baseRadius[0])), order: id,
    coat: { coat: St.pack(coat, 3), color: St.pack(color, 3), gloss: St.pack(gloss, 3) }, sheen: o.spec.sheen, spec: o.spec, match: 1, removed: 0.3, rough: St.pack(new Float32Array(n), 3) });
  return b.preview(id, it.id).accepted;
}, Number(pineId));
await render();
check(good && await hasAct("deliver") && /1 turned piece that fits/.test(await text()) && /A turned piece in the shed fits/.test(await text()), "a piece turned to the order: DELIVER, and the card counts only that one");
await card().locator('[data-act="deliver"]').click();
ov = await page.locator("#gradeOverlay").textContent();
check(await page.locator("#gradeOverlay [data-piece]").count() === 1 && await page.locator("#gradeOverlay .g-pick.no").count() === 0, "the DELIVER list offers only the piece that fits (2 pine pieces in the shed)");
await page.evaluate(() => { const o = document.getElementById("gradeOverlay"); o.hidden = true; o.innerHTML = ""; });

console.log("\nSHORT OF COINS OR PLOTS");
await page.evaluate(() => {
  const f = window.__farm, inv = f.game.inventory; inv.stacks = {}; inv.items = [];
  f.farm.state.plots = f.farm.state.plots.map(() => null);
  const w = f.state.wallet; w.spend("coins", w.balance("coins")); w.earn("coins", 3);
  f.persist(); window.Game.showScreen("orders");
});
await render();
check(await card().locator('[data-act="plant"].short').count() === 1, "short of coins, PLANT ONE is greyed");
await card().locator('[data-act="plant"]').click();
check(await page.evaluate(() => window.Game.currentScreen() === "farm" && !window.__farm.farm.plotAt(0)) && /seed costs 10 coins\. You have 3/.test(await page.locator("#otoast").textContent()), "and a tap says why and goes to the farm, where an ad can plant one");
await page.evaluate(() => {
  const f = window.__farm; f.farm.state.plots = f.farm.state.plots.map(() => ({ wood: "oak", plantedAt: Date.now(), skipped: 0 }));
  const w = f.state.wallet; w.earn("coins", 500); f.persist(); window.Game.showScreen("orders");
});
await render();
await card().locator('[data-act="plant"]').click();
check(await page.evaluate(() => window.Game.currentScreen() === "farm") && /Every plot is taken/.test(await page.locator("#otoast").textContent()), "every plot taken: it says so and goes to the farm");

check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");

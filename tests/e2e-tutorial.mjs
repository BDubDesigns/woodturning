// The new-player flow, played from a brand-new save in a real browser.
//   node tests/e2e-tutorial.mjs [path/to/page.html] [shots-dir]
//
// Taps the game's own controls the coach points at (tabs, PAINT, FINISH,
// DONE, TAKE IT, DELIVER, a plot, OAK, GROW NOW, HARVEST). The lathe work
// itself (the cut, the paint, the sheen) is a real swipe for the first cut
// and set directly after that, as the commission checks do. The forest's
// chopping is covered by e2e.mjs; here its phases are stepped through and the
// tree felled through the farm model, to check the coach follows along.
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
const url = `file://${file}?view=2d&testclock`;
await page.goto(url + "&reset");
await page.waitForFunction(() => window.__tutorial && window.__lathe && window.__lathe.stock);
const tick = (s) => page.evaluate((s) => window.__lathe.advance(s), s);
const step = () => page.evaluate(() => { window.__tutorial.refresh(); const c = window.__tutorial.tutorial.current(); return c ? c.id : null; });
const coach = () => page.locator("#coach").textContent();
const ringOn = (sel) => page.evaluate((sel) => {
  window.__tutorial.refresh();   // the ring follows on the next refresh; take one now rather than wait for it
  const r = document.getElementById("coachRing"), el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
  if (!el || r.hidden) return false;
  const a = r.getBoundingClientRect(), b = el.getBoundingClientRect();
  return a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom;
}, sel);
const covers = (sel) => page.evaluate((sel) => {   // does the coach card sit over this control?
  const c = document.getElementById("coach").getBoundingClientRect(), el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
  if (!el) return false;
  const b = el.getBoundingClientRect();
  return !(c.right <= b.left || c.left >= b.right || c.bottom <= b.top || c.top >= b.bottom);
}, sel);
const tabsShown = () => page.evaluate(() => ["tabFarm", "tabLathe", "tabMine", "tabOrders", "tabShop"].filter((id) => !document.getElementById(id).hidden).map((id) => id.slice(3).toLowerCase()));
const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/tutorial-${name}.png` }); };

console.log("\nFIRST OPEN");
check(JSON.stringify(await tabsShown()) === '["lathe"]', "only the LATHE tab shows");
let w = await page.evaluate(() => ({ coins: window.__farm.state.wallet.balance("coins"), dia: window.__farm.state.wallet.balance("diamonds"), logs: window.__farm.state.inventory.count("log", "pine"), stock: window.__lathe.stock }));
check(w.coins === 0 && w.dia === 0, "a new player starts with no coins or diamonds");
check(w.logs === 3 && w.stock && w.stock.kind === "log" && w.stock.key === "pine", "three pine logs in the shed, and one is on the lathe");
check(await step() === "cut", "the coach starts at the first cut");
check(/Your lathe/.test(await coach()) && /Skip tutorial/.test(await coach()), "the first card welcomes the player and offers a way out");
check(await page.evaluate(() => window.__orders.board.state.orders.length) === 0, "no orders yet");
await page.goto(url + "#shop");
await page.waitForFunction(() => window.__tutorial && window.__lathe);
check(await page.evaluate(() => window.Game.currentScreen()) === "lathe", "a link to a locked screen lands on the lathe");
await shot("01-first");

console.log("\nPRACTICE PIECE");
const box = await page.locator("#stage").boundingBox();
for (let pass = 0; pass < 3; pass++) {
  const x = box.x + box.width * (0.3 + pass * 0.15), y = box.y + box.height * 0.8;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x, y - 4 * i); await tick(0.02); }
  for (let i = 1; i <= 30; i++) { await page.mouse.move(x + box.width * 0.08 * (i / 30), y - 40); await tick(0.05); }
  await page.mouse.up();
}
const removed = await page.evaluate(() => window.__lathe.work.removedFraction());
check(await step() === "to_paint", `a real cut moves the coach on (${(removed * 100).toFixed(1)}% off)`);
check(await ringOn("#modePaint"), "the ring is on the PAINT button");
check(!(await covers("#modePaint")), "the card does not cover it");
await shot("02-to-paint");
await page.click("#modePaint");
check(await step() === "paint", "PAINT: the coach explains the brush");
await page.evaluate(() => { const S = window.__lathe; S.coat.coat.fill(1); S.coat.version++; });
await tick(0.1);
check(await step() === "to_finish" && await ringOn("#modeFinish"), "some paint on: the ring moves to FINISH");
await page.click("#modeFinish");
check(await step() === "finish", "FINISH: the coach explains the spray");
await page.evaluate(() => { const S = window.__lathe; S.coat.gloss.fill(window.Lathe.Paint.SHEEN.satin.gloss); S.coat.version++; });
await tick(0.1);
check(await step() === "keep" && await ringOn("#doneBtn"), "satin reached: the ring is on DONE");
await page.click("#doneBtn");
await tick(0.2);
w = await page.evaluate(() => ({ pieces: window.__farm.state.inventory.count("piece"), logs: window.__farm.state.inventory.count("log", "pine") }));
check(w.pieces === 1 && w.logs === 2, "DONE keeps the practice piece; two pine logs left");

console.log("\nFIRST COMMISSION");
check(await step() === "to_orders", "then ORDERS");
check(JSON.stringify(await tabsShown()) === '["lathe","orders"]', "the ORDERS tab appears, nothing else");
check(await ringOn("#tabOrders"), "the ring is on ORDERS");
await page.click("#tabOrders");
await tick(0.1);
const orders = await page.evaluate(() => window.__orders.board.state.orders.map((o) => o.wood + ":" + o.kind));
check(JSON.stringify(orders) === '["pine:rolling_pin","oak:rolling_pin"]', `the authored board: ${orders.join(", ")}`);
check(await page.locator('.order [data-act="decline"]').count() === 0 && await page.locator('.order [data-act="practise"]').count() === 0 && await page.locator(".order.empty").count() === 0,
  "no DECLINE, PRACTISE or GET ONE NOW while the coach runs");
check(await step() === "take" && await ringOn('[data-wood="pine"] [data-act="take"]'), "the ring is on the pine order's TAKE IT");
await shot("03-board");
await page.click('[data-wood="pine"] [data-act="take"]');
await tick(0.3);
check(await step() === "turn", "TAKE IT: the coach explains the dashed line");
w = await page.evaluate(() => ({ order: window.__lathe.order && window.__lathe.order.wood, stock: window.__lathe.stock }));
check(w.order === "pine" && w.stock && w.stock.key === "pine", "the pine order is on the lathe on a pine log");
// turn it to the line exactly, then paint to spec and spray the sheen it asks for
await page.evaluate(() => { const S = window.__lathe; for (let i = 0; i < S.work.radius.length; i++) S.work.radius[i] = Math.min(S.work.baseRadius[i], S.target[i]); S.work.version++; });
await tick(0.2);
check(await step() === "order_paint", "close to the line: on to paint");
await page.click("#modePaint");
await page.evaluate(() => {
  const S = window.__lathe, P = window.Lathe.Paint, n = S.work.radius.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), seg = S.spec.segments.find((s) => t >= s.a && t <= s.b);
    if (seg && seg.paint) { S.coat.coat[i] = 1; S.coat.color.set(P.PALETTE[seg.paint].rgb, i * 3); }
    S.coat.gloss[i] = P.SHEEN[S.spec.sheen].gloss;
  }
  S.coat.version++;
});
await page.click("#modeFinish");
check(await step() === "deliver", "FINISH: on to deliver");
await page.click("#doneBtn");
await tick(0.3);
check(await ringOn('[data-act="give"]'), "the grade dialog is up and the ring is on DELIVER");
await page.click('#gradeOverlay [data-act="give"]');
await tick(0.3);
w = await page.evaluate(() => ({ done: window.__orders.board.state.done, coins: window.__farm.state.wallet.balance("coins") }));
check(w.done === 1 && w.coins > 0, `delivered: ${w.coins} coins`);
const keep = page.locator('#gradeOverlay [data-act="keep"]');
if (await keep.count()) await keep.click();

console.log("\nTHE FARM");
check(await step() === "to_farm", "only the oak order is left, and no oak: the coach points at the farm");
check(JSON.stringify(await tabsShown()) === '["farm","lathe","orders"]', "the FARM tab appears");
await page.click("#tabFarm");
check(await step() === "plot" && await ringOn(".plot.empty"), "the ring is on an empty plot");
await page.click('.plot[data-i="0"]');
check(await step() === "plant" && await ringOn('[data-plant="oak"]'), "then on OAK");
w = await page.evaluate(() => ({ coins: window.__farm.state.wallet.balance("coins"), price: window.__farm.farm.plantPrice("oak") }));
check(w.coins >= w.price, `the player can afford the oak (${w.coins} coins, seed ${w.price})`);
await shot("04-plant");
await page.click('[data-plant="oak"]');
check(await step() === "speed", "planted: the coach hands over diamonds");
check(await page.evaluate(() => window.__farm.state.wallet.balance("diamonds")) === 5, "5 diamonds");
check(await ringOn('[data-act="grownow"]'), "the ring is on GROW NOW");
await page.click('[data-act="grownow"]');
check(await step() === "harvest" && await ringOn('[data-act="harvest"]'), "grown: the ring is on HARVEST");
await page.click('[data-act="harvest"]');
await page.waitForFunction(() => window.__harvest && window.Game.currentScreen() === "harvest");

console.log("\nTHE FOREST");
check(await step() === "chop" && /Chop it down/.test(await coach()), "the coach explains chopping");
await page.evaluate(() => { window.__farm.farm.fell(window.Game.harvestPlot >= 0 ? window.Game.harvestPlot : 0); window.__harvest.game.phase = "delimb"; });
check(await step() === "delimb" && /Clear the limbs/.test(await coach()), "then delimbing");
await page.evaluate(() => { window.__harvest.game.phase = "saw"; });
check(await step() === "saw" && /Saw the blank/.test(await coach()), "then sawing");
// the saw hands the blank to the lathe the way harvest-view.js does
await page.evaluate(() => {
  const inv = window.__farm.state.inventory, G = window.Game;
  inv.take("log", "oak");
  const S = window.__lathe, it = inv.add("blank", { wood: "oak", seed: 7, profile: G.State.pack(new Float32Array(S.work.radius.length).fill(S.work.baseRadius[0])), lengthUnits: 1, lengthRatio: 1, girthUnits: 1 });
  window.Lathe.mountStock({ kind: "blank", id: it.id });
  G.showScreen("lathe");
});
await tick(0.2);

console.log("\nTHE OAK ORDER");
check(await step() === "oak_order", "back on the lathe");
w = await page.evaluate(() => ({ order: window.__lathe.order && window.__lathe.order.wood, wood: window.__lathe.wood }));
check(w.order === "oak" && w.wood === "oak", "the oak order is already on, on the oak blank");
await page.evaluate(() => { const S = window.__lathe; for (let i = 0; i < S.work.radius.length; i++) S.work.radius[i] = Math.min(S.work.baseRadius[i], S.target[i]); S.work.version++; });
await tick(0.2);
await page.evaluate(() => {
  const S = window.__lathe, P = window.Lathe.Paint, n = S.work.radius.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), seg = S.spec.segments.find((s) => t >= s.a && t <= s.b);
    if (seg && seg.paint) { S.coat.coat[i] = 1; S.coat.color.set(P.PALETTE[seg.paint].rgb, i * 3); }
    S.coat.gloss[i] = P.SHEEN[S.spec.sheen].gloss;
  }
  S.coat.version++;
});
await page.click("#doneBtn");
await tick(0.3);
await page.click('#gradeOverlay [data-act="give"]');
await tick(0.3);
if (await keep.count()) await keep.click();

console.log("\nGRADUATION");
check(await step() === "graduate", "both orders delivered: graduation");
check(JSON.stringify(await tabsShown()) === '["farm","lathe","mine","orders","shop"]', "every tab is open");
check(await page.evaluate(() => window.__orders.board.state.orders.length) === 3, "the board filled up with new orders");
check(await ringOn("#tabShop"), "the ring is on SHOP");
await page.click("#tabShop");
check(await step() === "shop" && /GOT IT/.test(await coach()), "Arbor Freight: one card to read");
await shot("05-shop");
await page.click('[data-coach="ok"]');
check(await step() === null, "GOT IT ends the flow");
check(await page.locator("#coach").isHidden() && await page.locator("#coachRing").isHidden(), "the coach is gone");
await page.goto(url);
await page.waitForFunction(() => window.__tutorial && window.__lathe);
check(await page.evaluate(() => window.__tutorial.tutorial.done) && (await tabsShown()).length === 5, "a reload: still done, everything open");

console.log("\nSKIP");
await page.goto(url + "&reset");
await page.waitForFunction(() => window.__tutorial && window.__lathe);
await page.click('[data-coach="skip"]');
w = await page.evaluate(() => ({ done: window.__tutorial.tutorial.done, coins: window.__farm.state.wallet.balance("coins"), dia: window.__farm.state.wallet.balance("diamonds"), orders: window.__orders.board.state.orders.length }));
check(w.done && w.coins === 250 && w.dia === 5, "skip tutorial: done, with the starter pack (250 coins, 5 diamonds)");
check(w.orders === 3 && (await tabsShown()).length === 5, "and a full board, every tab open");
check(await page.locator("#coach").isHidden(), "no coach");

console.log("\nAN OLD SAVE");
// seeded before the page's own scripts run (an open page saves itself as it leaves)
const old = JSON.stringify({ v: 2, wallet: { coins: 77, diamonds: 1 }, inventory: { stacks: {}, items: [], nextId: 1 } });
await page.close();
const p2 = await ctx.newPage();
p2.on("pageerror", (e) => errors.push(e.message));
await p2.addInitScript((save) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("woodturning.save", save); } }, old);
await p2.goto(url);
await p2.waitForFunction(() => window.__tutorial && window.__lathe);
w = await p2.evaluate(() => ({ done: window.__tutorial.tutorial.done, coins: window.__farm.state.wallet.balance("coins") }));
check(w.done && w.coins === 77, "a save from before the flow skips it, and keeps its coins");

check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");

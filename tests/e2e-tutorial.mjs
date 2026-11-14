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
check(/tuck it away/.test(await coach()) && await page.evaluate(() => document.querySelector("#coach .coach-min").classList.contains("glow")), "and points out its own glowing hide button");
check(await page.evaluate(() => window.__orders.board.state.orders.length) === 0, "no orders yet");
await page.goto(url + "#shop");
await page.waitForFunction(() => window.__tutorial && window.__lathe);
check(await page.evaluate(() => window.Game.currentScreen()) === "lathe", "a link to a locked screen lands on the lathe");
await shot("01-first");

console.log("\nTUCKING THE CARD AWAY");
await page.click('[data-coach="min"]');
await page.waitForTimeout(400);
let tuck = await page.evaluate(() => {
  const pill = document.getElementById("coachPill"), done = document.getElementById("doneBtn"), p = pill.getBoundingClientRect(), d = done.getBoundingClientRect();
  const row = [...done.parentNode.children].filter((e) => e.getBoundingClientRect().width > 0 && e !== pill).map((e) => e.getBoundingClientRect());
  const overlaps = row.some((b) => !(p.right <= b.left || p.left >= b.right || p.bottom <= b.top || p.top >= b.bottom));
  return { card: document.getElementById("coach").hidden, pill: !pill.hidden && p.width > 0, row: !overlaps && Math.abs(p.left + p.width / 2 - (d.left + d.width / 2)) < 140,
    sameRow: p.bottom <= d.bottom + 2 && p.top >= d.top - p.height - 12, oneRow: row.filter((b) => Math.abs(b.top - d.top) < 8).length, text: pill.textContent, glow: getComputedStyle(pill).animationName };
});
check(tuck.card && tuck.pill, "the hide button tucks the card away into a button");
check(tuck.row && tuck.sameRow, "on the lathe the button sits by DONE, on top of nothing");
check(await page.evaluate(() => document.getElementById("coachPill").classList.contains("docked")), "in the bottom row itself, at this phone width");
check(/1\/22/.test(tuck.text) && tuck.glow === "coach-glow", `it glows and says which step (${tuck.text.trim()})`);
await shot("01b-tucked");
await page.waitForTimeout(300);
check(await step() === "cut" && await page.evaluate(() => document.getElementById("coach").hidden), "it stays tucked away while the step goes on");
await page.click("#coachPill");
await page.waitForTimeout(350);
check(await page.evaluate(() => !document.getElementById("coach").hidden && document.getElementById("coachPill").hidden) && /Your lathe/.test(await coach()), "tapping it brings the same step back");
await page.click('[data-coach="min"]');
await page.waitForTimeout(350);

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
check(await step() === "to_paint" && await page.evaluate(() => !document.getElementById("coach").hidden && document.getElementById("coachPill").hidden), "a new step opens its card again");
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
check(await page.evaluate(() => window.__lathe.spec.sheen === "satin" && window.__lathe.spec.name === "Three bands"), "the practice spec wants satin, so there is spraying to do");
// overshoot into gloss: the card says how to undo just the finish
await page.evaluate(() => { const S = window.__lathe; S.coat.gloss.fill(window.Lathe.Paint.SHEEN.gloss.gloss); S.coat.version++; });
await tick(0.1);
check(await step() === "finish" && /past satin into gloss/.test(await coach()) && /UNDO/.test(await coach()), "gloss is past satin: the step waits and the card says to UNDO");
await page.click("#newLogBtn");
await page.click('#undoOverlay [data-undo="yes"]');
await tick(0.1);
check(await page.evaluate(() => window.__lathe.coat.avgGloss() === 0 && window.__lathe.coat.coverage() > 0.5), "UNDO on FINISH took only the finish off");
await step();
check(!/past satin/.test(await coach()), "and the hint goes");
await page.evaluate(() => { const S = window.__lathe; S.coat.gloss.fill(window.Lathe.Paint.SHEEN.satin.gloss); S.coat.version++; });
await tick(0.1);
check(await step() === "keep" && await ringOn("#doneBtn"), "satin reached: the ring is on DONE");
await page.click("#doneBtn");
await tick(0.2);
w = await page.evaluate(() => ({ pieces: window.__farm.state.inventory.count("piece"), logs: window.__farm.state.inventory.count("log", "pine") }));
check(w.pieces === 1 && w.logs === 2, "DONE keeps the practice piece; two pine logs left");
w = await page.evaluate(() => ({ empty: window.__lathe.empty, stock: window.__lathe.stock, mode: window.__lathe.mode, pick: !document.getElementById("lathePick").hidden, text: document.getElementById("lathePick").textContent }));
check(w.empty && w.stock === null && w.mode === "cut" && w.pick, "after DONE the lathe is empty, back at the chisel, and asks what to turn");
check(/NOTHING ON THE LATHE/.test(w.text) && /Pine log/.test(w.text) && /Practice blank/.test(w.text), "with the shed's logs and the practice blank to pick from");

console.log("\nFIRST COMMISSION");
check(await step() === "to_orders", "then ORDERS");
check(JSON.stringify(await tabsShown()) === '["lathe","orders"]', "the ORDERS tab appears, nothing else");
check(await ringOn("#tabOrders"), "the ring is on ORDERS");
await page.click("#tabOrders");
await tick(0.1);
const orders = await page.evaluate(() => window.__orders.board.state.orders.map((o) => o.wood + ":" + o.kind));
await page.click('[data-coach="min"]');
await page.waitForTimeout(350);
tuck = await page.evaluate(() => { const p = document.getElementById("coachPill"); return { floating: p.classList.contains("floating"), shown: !p.hidden && p.getBoundingClientRect().bottom <= innerHeight }; });
check(tuck.floating && tuck.shown, "off the lathe the button floats at the bottom of the screen");
await page.click("#coachPill");
await page.waitForTimeout(350);
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
await page.mouse.click(5, 5);   // a tap outside the panel
await page.keyboard.press("Tab");
check(!(await page.locator("#gradeOverlay").isHidden()), "a tap outside the grade panel does not close it: DELIVER or KEEP IT");
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
check(await ringOn('[data-buy="light"]'), "the ring is on the halogen's BUY button");
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
let ask = await coach();
check(/Skip the tutorial\?/i.test(ask) && /250 coins and 5 diamonds/.test(ask) && /replay the tutorial any time from Settings/.test(ask), "skip asks first, and says what skipping means");
check(await page.evaluate(() => !window.__tutorial.tutorial.done), "nothing is skipped yet");
await page.click('[data-coach="stay"]');
check(await step() === "cut" && /Your lathe/.test(await coach()), "KEEP LEARNING goes back to the same card");
await page.click('[data-coach="skip"]');
await page.click('[data-coach="leave"]');
w = await page.evaluate(() => ({ done: window.__tutorial.tutorial.done, coins: window.__farm.state.wallet.balance("coins"), dia: window.__farm.state.wallet.balance("diamonds"), orders: window.__orders.board.state.orders.length }));
check(w.done && w.coins === 250 && w.dia === 5, "skip tutorial: done, with the starter pack (250 coins, 5 diamonds)");
check(w.orders === 3 && (await tabsShown()).length === 5, "and a full board, every tab open");
check(await page.locator("#coach").isHidden(), "no coach");

console.log("\nREPLAY");
await page.evaluate(() => { const w = window.__farm.state.wallet; w.spend("diamonds", w.balance("diamonds")); window.__farm.persist(); });   // a player who spent their diamonds
const wallet0 = await page.evaluate(() => [window.__farm.state.wallet.balance("coins"), window.__farm.state.wallet.balance("diamonds")]);
await page.click("#settingsBtn");
check(/REPLAY TUTORIAL/.test(await page.locator("#settingsOverlay").textContent()), "Settings offers REPLAY TUTORIAL once the tutorial is over");
await page.click('#settingsOverlay [data-act="replay"]');
await tick(0.1);
check(await step() === "cut" && /REPLAY/.test(await coach()), "the replay starts at the first card");
check((await tabsShown()).length === 5, "every tab stays open");
check(await page.evaluate(() => window.__lathe.stock === null), "on a free practice blank: none of the player's wood");
check(await page.locator('.order [data-act="decline"]').count() >= 0 && await page.evaluate(() => window.__orders.ui.guided === false), "the board keeps its usual buttons");
await page.evaluate(() => { const r = window.__lathe.work.radius; for (let i = 60; i < 180; i++) r[i] *= 0.85; window.__lathe.work.version++; });
await tick(0.1);
await page.click("#modePaint");
await page.evaluate(() => { const S = window.__lathe; S.coat.coat.fill(1); S.coat.version++; });
await tick(0.1); await step();
await page.click("#modeFinish");
await page.evaluate(() => { const S = window.__lathe; S.coat.gloss.fill(0.5); S.coat.version++; });
await tick(0.1);
check(await step() === "keep", "through the practice piece");
await page.click("#doneBtn", { force: true });   // greyed on a practice blank, but a tap still lands (and says why)
await tick(0.1);
check(await step() === "to_orders", "DONE on a practice blank is enough in a replay");
check(await page.evaluate(() => window.__orders.board.state.orders.length) === 3, "no first board posted over the real one");
await page.click('[data-coach="skip"]');
check(/Stop the tutorial\?/.test(await coach()) && /Nothing in your game changes/.test(await coach()), "stopping a replay asks too");
await page.click('[data-coach="leave"]');
const wallet1 = await page.evaluate(() => [window.__farm.state.wallet.balance("coins"), window.__farm.state.wallet.balance("diamonds")]);
check(await page.evaluate(() => window.__tutorial.tutorial.done) && JSON.stringify(wallet1) === JSON.stringify(wallet0), `stopped, and nothing was handed out (${wallet0} -> ${wallet1})`);
check((await tabsShown()).length === 5 && await page.locator("#coach").isHidden(), "everything still open, no coach");

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

console.log("\nTHE 3D VIEW");
await p2.goto(`file://${file}?testclock&reset`);
await p2.waitForFunction(() => window.__tutorial && window.__lathe && window.__lathe.stock);
await p2.evaluate(() => window.__lathe.advance(0.2));
const v3 = await p2.evaluate(() => ({ view: window.__lathe.views.current.kind, coach: !document.getElementById("coach").hidden, text: document.getElementById("coach").textContent }));
check(v3.view === "3d", "a new player in the 3D view");
check(v3.coach && /Your lathe/.test(v3.text), "sees the first coach card there too");
await p2.evaluate(() => { const r = window.__lathe.work.radius; for (let i = 60; i < 180; i++) r[i] *= 0.85; window.__lathe.work.version++; window.__lathe.advance(0.1); window.__tutorial.refresh(); });
check(await p2.evaluate(() => window.__tutorial.tutorial.current().id) !== "cut", "and the flow moves on in 3D as in 2D");

check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");

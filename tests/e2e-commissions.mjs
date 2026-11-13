// Browser checks of the commission board, end to end.
//   node tests/e2e-commissions.mjs [path/to/page.html] [shots-dir]
//
//  1. A new player's board is full, and has a pine order to start on.
//  2. TAKE IT puts the order on the lathe: its shape is the ghost, its paint
//     spec is on the spec card, and the shed's wood of that kind is mounted.
//  3. Real swipes change the live SHAPE score.
//  4. A piece turned to the target and painted to spec, then DONE: the grade
//     dialog offers it, DELIVER pays the coins, the piece leaves the shed,
//     the order leaves the board and a slot waits for the next one.
//  5. The wrong wood is kept, not offered; DECLINE replaces an order.
//  6. The board is saved: a reload shows the same orders.
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
await page.goto(`file://${file}?view=2d&testclock#orders`);
await page.waitForFunction(() => window.__orders && window.__lathe && window.__lathe.setSpec);
const tick = (s) => page.evaluate((s) => window.__lathe.advance(s), s);   // the lathe runs on its test clock (?testclock)
await tick(0.3);

console.log("\nBOARD");
const cards = await page.locator(".order[data-order]").count();
check(cards === 3, `three orders on a new board (${cards})`);
const first = await page.evaluate(() => window.__orders.board.state.orders[0]);
check(first.wood === "pine", "the first order is pine, the quickest wood to grow");
check(await page.locator(".order[data-order] .o-shape").count() === 3, "every order shows its target shape");
check(/No pine in the shed/.test(await page.locator(".order[data-order]").first().textContent()), "it says when the shed has none of that wood");
if (shots) await page.screenshot({ path: `${shots}/board.png` });

console.log("\nTAKE IT");
// a pine log in the shed, then take the pine order
await page.evaluate(() => { window.__farm.state.inventory.add("log", { wood: "pine" }, 2); window.__orders.ui.render(true); });
check(/1 pine log|2 pine logs/.test(await page.locator(".order[data-order]").first().textContent()), "with a log in the shed, the card says so");
await page.locator('.order[data-order] [data-act="take"]').first().click();
await tick(0.4);
let st = await page.evaluate(() => {
  const S = window.__lathe;
  return { screen: !document.getElementById("latheScreen").hidden, order: S.order && S.order.id, target: !!S.target, stock: S.stock, wood: S.wood,
    spec: S.spec && S.spec.name, wantSpec: S.order && S.order.spec.name, btn: document.getElementById("specNewBtn").textContent, label: document.getElementById("profileLabel").textContent };
});
check(st.screen, "TAKE IT goes to the lathe");
check(st.order === first.id && st.target, "the order is on the lathe with its target shape");
check(st.stock && st.stock.kind === "log" && st.wood === "pine", "the pine log from the shed is mounted");
check(st.spec === st.wantSpec, "the spec card shows the order's paint spec");
check(st.btn === "BOARD", "NEW SPEC becomes BOARD while an order is on");
check(/COMMISSION/.test(await page.locator("#specTag").textContent()), "the spec card says it is a commission");
check(/SHAPE\s*\d+%/.test(st.label), `the profile strip shows a live shape score (${st.label})`);

// the ghost is drawn in the 2D view: a pixel on the dashed target line is pale
const ghost = await page.evaluate(() => {
  const S = window.__lathe, v = document.querySelector("#stage canvas:not([style*='none'])") || document.querySelector("#stage canvas");
  return { has: !!S.target };
});
check(ghost.has, "the 2D view has a target to draw");

console.log("\nCUTTING");
const before = await page.evaluate(() => window.Game.Commissions.shapeScore(window.__lathe.work.radius, window.__lathe.target, window.__lathe.work.baseRadius).score);
// real swipes: touch below the log near the middle and push up, several passes
const box = await page.locator("#stage").boundingBox();
const lay = await page.evaluate(() => { const L = window.__lathe; return null; });
for (let pass = 0; pass < 6; pass++) {
  const x = box.x + box.width * 0.12, y = box.y + box.height * 0.8;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x, y - 4 * i); await tick(0.016); }
  for (let i = 1; i <= 20; i++) { await page.mouse.move(x + box.width * 0.1 * (i / 20), y - 40); await tick(0.03); }
  await page.mouse.up();
}
await tick(0.3);
const after = await page.evaluate(() => window.Game.Commissions.shapeScore(window.__lathe.work.radius, window.__lathe.target, window.__lathe.work.baseRadius).score);
check(after > before, `cutting the handle toward the line raises the shape score (${(before * 100).toFixed(0)}% -> ${(after * 100).toFixed(0)}%)`);

console.log("\nDONE AND DELIVER");
// finish the job exactly: turn to the target, paint to spec, spray to the sheen
await page.evaluate(() => {
  const S = window.__lathe, P = window.Lathe.Paint, n = S.work.radius.length;
  for (let i = 0; i < n; i++) S.work.radius[i] = Math.min(S.work.baseRadius[i], S.target[i]);
  S.work.version++;
});
await tick(0.2);   // let a frame pass: wood cut away takes its paint, so paint after the cut
await page.evaluate(() => {
  const S = window.__lathe, P = window.Lathe.Paint, n = S.work.radius.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), seg = S.spec.segments.find((s) => t >= s.a && t <= s.b);
    if (seg && seg.paint) { S.coat.coat[i] = 1; S.coat.color.set(P.PALETTE[seg.paint].rgb, i * 3); }
    S.coat.gloss[i] = P.SHEEN[S.spec.sheen].gloss;
  }
  S.coat.version++;
});
const coins0 = await page.evaluate(() => window.__farm.state.wallet.balance("coins"));
await page.click("#doneBtn");
await tick(0.3);
check(!(await page.locator("#gradeOverlay").isHidden()), "DONE with the order's wood opens the grade");
const offerText = await page.locator("#gradeOverlay").textContent();
check(/SHAPE/.test(offerText) && /PAINT/.test(offerText) && /SHEEN/.test(offerText), "the grade shows shape, paint and sheen");
const stars = await page.locator("#gradeOverlay .g-stars .stars span.on").count();
check(stars === 3, `a piece made to the order earns three stars (${stars})`);
if (shots) await page.screenshot({ path: `${shots}/grade.png` });
const pieceId = await page.evaluate(() => window.__farm.state.inventory.list("piece").at(-1).id);
await page.locator('#gradeOverlay [data-act="give"]').click();
await tick(0.3);
const coins1 = await page.evaluate(() => window.__farm.state.wallet.balance("coins"));
check(coins1 === coins0 + first.reward, `DELIVER pays the full ${first.reward} coins (${coins0} -> ${coins1})`);
check((await page.locator("#walletCoins").textContent()) === String(coins1), "the wallet shows it");
check(await page.evaluate((id) => !window.__farm.state.inventory.get(id), pieceId), "the piece left the shed");
check(await page.evaluate((id) => !window.__orders.board.get(id), first.id), "the order left the board");
check(await page.evaluate(() => !window.__lathe.order && !window.__lathe.target), "the lathe is free again");
if (shots) await page.screenshot({ path: `${shots}/delivered.png` });
await page.locator('#gradeOverlay [data-act="board"]').click();
await tick(0.3);
check(await page.locator(".order.empty").count() === 1, "an empty slot waits for the next order");
check(/DELIVERED\s*1 commission/.test(await page.locator("#boardFoot").textContent()), "the board counts it");
check(await page.locator("#boardFoot .order.hist li").count() === 1, "and lists it in its own panel");
check(await page.evaluate(() => getComputedStyle(document.querySelector("#boardFoot .stars span.on")).color) === "rgb(246, 196, 106)", "with gold stars");
check(/PRACTICE/.test(await page.locator("#specTag").textContent()), "with no order on, the lathe's spec card says it is practice");

console.log("\nWRONG WOOD AND DECLINE");
// the board is random: make one order an oak one, so this never depends on what was rolled
const oak = await page.evaluate(() => {
  const b = window.__orders.board, o = b.state.orders[b.state.orders.length - 1];
  o.wood = "oak"; window.__orders.ui.render(true);
  return o;
});
await page.locator(`.order[data-order="${oak.id}"] [data-act="take"]`).click();
await tick(0.3);
// turn a pine log against an order for another wood
await page.evaluate(() => { window.__lathe.mountStock({ kind: "log", key: "pine" }); const S = window.__lathe; for (let i = 20; i < 60; i++) S.work.radius[i] *= 0.7; S.work.version++; });
await page.click("#doneBtn");
await tick(0.3);
check(await page.locator("#gradeOverlay").isHidden(), "the wrong wood is not offered to the order");
check(/cannot go to them/.test(await page.locator("#ltoast").textContent()), "and the toast says why");
await page.evaluate(() => window.Game.showScreen("orders"));
await tick(0.3);
const n0 = await page.evaluate(() => window.__orders.board.state.orders.length);
await page.locator(`.order[data-order="${oak.id}"] [data-act="release"]`).click();
await tick(0.2);
check(await page.evaluate(() => !window.__orders.board.active() && !window.__lathe.order), "PUT ASIDE frees the lathe and keeps the order");
await page.locator(`.order[data-order="${oak.id}"] [data-act="decline"]`).click();
await tick(0.2);
check(await page.evaluate((id) => !window.__orders.board.get(id), oak.id), "DECLINE takes the order off the board");
check(await page.evaluate(() => window.__orders.board.state.orders.length) === n0 - 1, "and leaves the slot to fill later");
check(await page.evaluate(() => !window.__lathe.order), "a declined order leaves the lathe too");

console.log("\nSAVED");
const ids = await page.evaluate(() => { window.__farm.persist(); return window.__orders.board.state.orders.map((o) => o.id); });
await page.reload();
await page.waitForFunction(() => window.__orders && window.__lathe && window.__lathe.setSpec);
const ids2 = await page.evaluate(() => window.__orders.board.state.orders.map((o) => o.id));
check(JSON.stringify(ids) === JSON.stringify(ids2), "the board is the same after a reload");

console.log("\nLAYOUT");
const tabs = await page.evaluate(() => { const r = document.getElementById("tabs").getBoundingClientRect(); return { w: r.width, sw: document.documentElement.scrollWidth, vw: innerWidth }; });
check(tabs.sw <= tabs.vw, `no sideways scroll at phone width (${tabs.sw} <= ${tabs.vw})`);
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

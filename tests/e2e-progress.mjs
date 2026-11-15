// Progress on screen (issue #35 part 2), in a real page.
//   node tests/e2e-progress.mjs [path/to/page.html] [shots-dir]
//
//  1. A delivery plays the celebration: the stars fly one at a time, each a pluck
//     and a haptic tick, a tier crossed chimes, and it ends with the right bars,
//     names and lines. The rank reward counts into the wallet, which is held back
//     until it does.
//  2. A tap skips straight to the same end state.
//  3. The header badge shows the rank, and moves with it.
//  4. The badge opens the panel: the rank, what is next, every blueprint's tier
//     (unowned ones dimmed), and the customers met.
//  5. Arbor Freight's blueprint cards show the mastery.
//  6. With reduced motion the end state shows at once, with the sounds.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";

const file = resolve(process.argv[2] || "lathe.html");
const shots = process.argv[3] || null;
let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };
const errors = [];
const browser = await chromium.launch();

async function open(opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 360, height: 800 } }, opts || {}));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`file://${file}?tutorial=off&view=2d&testclock&reset#orders`);
  await page.waitForFunction(() => window.__orders && window.__progress && window.__lathe && window.__lathe.setSpec);
  await page.evaluate(() => {
    // count the celebration's sounds and vibrations (they can't be heard here)
    const A = window.Lathe.audio, H = window.Game.Haptics;
    window.__heard = { star: [], levelUp: 0, coinTick: 0, pulse: [] };
    const star = A.star, lv = A.levelUp, ct = A.coinTick, pu = H.pulse;
    A.star = (i) => { window.__heard.star.push(i); star(i); };
    A.levelUp = () => { window.__heard.levelUp++; lv(); };
    A.coinTick = (i) => { window.__heard.coinTick++; ct(i); };
    H.pulse = (n) => { window.__heard.pulse.push(n); pu(n); };
    // a known wallet, an empty shed, and the first order a pine rolling pin
    const f = window.__farm, w = f.state.wallet;
    f.game.inventory.items = []; f.game.inventory.stacks = {};
    w.spend("coins", w.balance("coins")); w.spend("diamonds", w.balance("diamonds")); w.earn("coins", 50);
    const o = f.board.state.orders[0]; o.kind = "rolling_pin"; o.wood = "pine";
    f.persist(); window.__orders.ui.render(true);
  });
  return { ctx, page };
}
/* A piece made exactly to an order, put in the shed. Returns its id. */
const addPerfect = (page, orderId) => page.evaluate((id) => {
  const b = window.__orders.board, o = b.get(id), St = window.Game.State, P = window.Lathe.Paint, Cut = window.Lathe.CFG;
  const target = b.targetProfile(o), n = target.length, coat = new P.Coating();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), seg = o.spec.segments.find((s) => t >= s.a && t <= s.b);
    if (seg && seg.paint) { coat.coat[i] = 1; coat.color.set(P.targetAt(o.spec, t, P.CFG.WOOD_RGB), i * 3); }
    coat.gloss[i] = P.SHEEN[o.spec.sheen].gloss;
  }
  const it = window.__farm.state.inventory.add("piece", { wood: o.wood, shape: "Test", profile: St.pack(target), start: St.pack(new Float32Array(n).fill(Cut.R0)),
    coat: { coat: St.pack(coat.coat, 3), color: St.pack(coat.color, 3), gloss: St.pack(coat.gloss, 3) }, rough: St.pack(new Float32Array(n).fill(0.05), 3), sheen: o.spec.sheen });
  return it.id;
}, orderId);
/* Deliver the first order's piece through YOUR PIECES (DELIVER there hands it over). */
async function deliverFirst(page) {
  const id = await page.evaluate(() => window.__orders.board.state.orders[0].id);
  await addPerfect(page, id);
  await page.evaluate(() => window.__orders.ui.showPieces());
  await page.locator(`#gradeOverlay [data-give="${id}"]`).first().click();
}
const celState = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), w = (s) => parseFloat(q(s).style.width);
  return {
    cel: q(".cel") && q(".cel").getAttribute("data-cel"),
    mName: q(".cel-mastery .cel-name").textContent, mBar: w(".cel-mastery .cel-bar i"), mSub: q(".cel-mastery .cel-sub").textContent, mPop: !q(".cel-mastery .cel-pop").hidden && q(".cel-mastery .cel-pop").textContent,
    rName: q(".cel-rank .cel-name").textContent, rRank: q(".cel-rank .cel-rk").textContent, rBar: w(".cel-rank .cel-bar i"), rSub: q(".cel-rank .cel-sub").textContent, rPop: !q(".cel-rank .cel-pop").hidden && q(".cel-rank .cel-pop").textContent,
    line: q(".cel-line").textContent, coins: q("#walletCoins").textContent, diamonds: q("#walletDiamonds").textContent,
    realCoins: window.__farm.state.wallet.balance("coins"), realDiamonds: window.__farm.state.wallet.balance("diamonds"),
    badge: q("#rankLabel").textContent, flying: document.querySelectorAll(".cel-fly").length
  };
});

/* ---------------- 1. the celebration ---------------- */
console.log("\nCELEBRATION");
let { ctx, page } = await open();
check((await page.locator("#rankLabel").textContent()) === "R1 · Hobbyist", "a new player's badge reads R1 · Hobbyist");
await deliverFirst(page);
await page.waitForTimeout(120);
let st = await celState(page);
check(st.cel === "playing", "DELIVER starts the celebration on the Delivered! card");
check(st.mName === "" && st.mBar === 0 && st.rName === "Hobbyist" && st.rRank === "1", "it starts from where the player was: no skill yet, Hobbyist");
check(+st.coins === st.realCoins - 100 && st.diamonds === "0", `the wallet shows the pay but holds the rank reward back until it counts in (shows ${st.coins}, holds ${st.realCoins})`);
check(st.badge === "R1 · Hobbyist", "and so does the badge");
await page.waitForTimeout(480);
st = await celState(page);
check(st.flying >= 1, `stars fly from the grade to the bar (${st.flying} in the air)`);
if (shots) await page.screenshot({ path: `${shots}/celebration-stars.png` });
await page.waitForFunction(() => document.querySelector(".cel[data-cel=done]"), null, { timeout: 8000 });
st = await celState(page);
const heard = await page.evaluate(() => window.__heard);
check(JSON.stringify(heard.star.slice(0, 3)) === "[0,1,2]", `each star plucks a note higher (${heard.star.join(",")})`);
check(heard.pulse.filter((p) => p === "star").length === 3, "each star lands with a haptic tick");
check(heard.levelUp >= 2 && heard.pulse.filter((p) => p === "levelup").length === 2, `Familiar and Apprentice each chime and buzz (${heard.levelUp} chimes)`);
check(heard.coinTick >= 5, `the reward counts in with quick ticks (${heard.coinTick})`);
check(st.mName === "Familiar" && Math.abs(st.mBar - 2 / 3 * 100) < 1 && st.mSub === "3/4 stars to Practiced" && /\+15% pay/.test(st.mPop),
  `it ends on Familiar, 3/4 stars to Practiced, with the +15% pay badge (${st.mName}, ${st.mBar.toFixed(0)}%, ${st.mSub})`);
check(st.rName === "Apprentice" && st.rRank === "2" && Math.abs(st.rBar - 2 / 7 * 100) < 1 && st.rSub === "3/8 stars to Rank 3" && /\+6/.test(st.rPop) && /\+100/.test(st.rPop),
  `and Rank 2 Apprentice, 3/8 stars to Rank 3, +6 diamonds +100 coins (${st.rName}, ${st.rBar.toFixed(0)}%, ${st.rSub})`);
check(/You're a Familiar rolling pin maker now\. Rolling pins pay \+15%\./.test(st.line) && /Rank 2: Apprentice!/.test(st.line), `the lines say so: "${st.line}"`);
check(!/—/.test(st.line), "no em dashes");
check(st.coins === String(st.realCoins) && st.diamonds === "6", `the wallet has counted it all in (${st.coins} coins, ${st.diamonds} diamonds)`);
if (shots) await page.screenshot({ path: `${shots}/celebration-end.png` });

/* ---------------- 3. the badge ---------------- */
console.log("\nBADGE");
check(st.badge === "R2 · Apprentice", `the header badge moved to R2 · Apprentice (${st.badge})`);
const bw = await page.evaluate(() => parseFloat(document.getElementById("rankBar").style.width));
check(Math.abs(bw - 2 / 7 * 100) < 1, `its bar shows the way to rank 3 (${bw.toFixed(0)}%)`);
await page.locator('#gradeOverlay [data-act="keep"]').click();
check(await page.locator("#gradeOverlay").isHidden(), "OK closes the card");
check(await page.evaluate(() => !document.body.classList.contains("cel-lift")), "and the wallet goes back to its place");
for (const scr of ["farm", "lathe", "shop"]) {
  await page.evaluate((s) => window.Game.showScreen(s), scr);
  check(await page.locator("#rankBadge").isVisible(), `the badge shows on the ${scr} screen`);
}

/* ---------------- 4. the panel ---------------- */
console.log("\nPANEL");
await page.click("#rankBadge");
check(!(await page.locator("#progressOverlay").isHidden()), "tapping the badge opens the progress panel");
const panel = await page.evaluate(() => {
  const o = document.getElementById("progressOverlay"), sk = (k) => o.querySelector(`[data-skill="${k}"]`);
  return { text: o.textContent, pin: sk("rolling_pin").textContent, pinOwned: !sk("rolling_pin").classList.contains("unowned"), bat: sk("walking_stick").textContent, batOwned: !sk("walking_stick").classList.contains("unowned"), faces: o.querySelectorAll(".pp-faces li").length };
});
check(/RANK 2/.test(panel.text) && /Apprentice/.test(panel.text) && /5 more stars to Rank 3 · Journeyman/.test(panel.text) && /9 diamonds and 150 coins/.test(panel.text), "it shows the rank, the next one's title and reward, and the stars it needs");
check(panel.pinOwned && /Familiar/.test(panel.pin) && /3\/4 stars to Practiced/.test(panel.pin) && /\+15% pay/.test(panel.pin), `the rolling pin: Familiar, 3/4 to Practiced, +15% pay`);
check(!panel.batOwned && /Get the blueprint at Arbor Freight/.test(panel.bat), "an unowned blueprint is dimmed and points at Arbor Freight");
check(panel.faces === 1, "the customer just met is listed with a portrait");
if (shots) await page.screenshot({ path: `${shots}/panel.png` });
await page.locator('#progressOverlay [data-act="closeprogress"]').click();
check(await page.locator("#progressOverlay").isHidden(), "CLOSE closes it");

/* ---------------- 5. the shop ---------------- */
console.log("\nSHOP");
await page.evaluate(() => { window.Game.showScreen("farm"); window.__progress.progress.addStars("rolling_pin", 15); window.Game.showScreen("shop"); });
const bp = await page.locator('[data-bp-card="rolling_pin"] .bp-mastery').textContent();
check(bp === "Expert · 18/25 stars to Renowned", `the rolling pin's blueprint card shows its mastery (${bp})`);
await ctx.close();

/* ---------------- 2. skip ---------------- */
console.log("\nSKIP");
({ ctx, page } = await open());
await deliverFirst(page);
await page.waitForTimeout(150);
await page.mouse.click(180, 400);
await page.waitForTimeout(60);
st = await celState(page);
check(st.cel === "done", "a tap skips to the end");
check(st.mName === "Familiar" && Math.abs(st.mBar - 2 / 3 * 100) < 1 && st.rName === "Apprentice" && st.rRank === "2", "the same end state: Familiar and Apprentice");
check(st.coins === String(st.realCoins) && st.diamonds === "6" && st.badge === "R2 · Apprentice", "the wallet and the badge jump to what they hold");
check(st.flying === 0, "no star is left in the air");
check(!(await page.locator("#gradeOverlay").isHidden()), "the skipping tap doesn't close the card");
await page.locator('#gradeOverlay [data-act="board"]').click();
check(await page.locator("#gradeOverlay").isHidden(), "after it, the buttons work as normal");
await page.evaluate(() => window.Game.showScreen("orders"));
await deliverFirst(page);
await page.waitForTimeout(150);
await page.locator('#gradeOverlay [data-act="keep"]').click();
st = await page.evaluate(() => ({ hidden: document.getElementById("gradeOverlay").hidden, coins: document.getElementById("walletCoins").textContent, real: window.__farm.state.wallet.balance("coins"), lift: document.body.classList.contains("cel-lift") }));
check(st.hidden && st.coins === String(st.real) && !st.lift, "OK mid-celebration skips it and closes the card in one tap, the wallet all counted in");
await ctx.close();

/* ---------------- 6. reduced motion ---------------- */
console.log("\nREDUCED MOTION");
({ ctx, page } = await open({ reducedMotion: "reduce" }));
await deliverFirst(page);
await page.waitForTimeout(50);
st = await celState(page);
check(st.cel === "done" && st.mName === "Familiar" && st.rName === "Apprentice" && st.flying === 0 && st.coins === String(st.realCoins), "with reduced motion the end state shows at once");
await page.waitForTimeout(1400);
const quiet = await page.evaluate(() => window.__heard);
check(quiet.star.length === 3 && quiet.levelUp >= 1, `and the sounds still play (${quiet.star.length} plucks, ${quiet.levelUp} chime)`);
await ctx.close();

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall progress checks passed");
process.exit(failed ? 1 : 0);

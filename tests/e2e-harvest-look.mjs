// Browser checks of how the harvest LOOKS, plus delimbing with real swipes.
//   node tests/e2e-harvest-look.mjs [path/to/page.html]
// Plain Chromium (the harvest is Canvas2D only).
//
//  1. Pixels: a deep notch is a hole. The pixel in the middle of the notch is the
//     background behind the tree (the same pixel with the tree not drawn at all),
//     not tan, and the wood beside it is not background. Checked for every wood.
//  2. Pixels: the notch edge may show only a thin pale line, never a fill.
//  3. Delimb with real mouse swipes that cross each limb at shallow and steep
//     angles, the crown leader lying along the log included: the counter on
//     screen reaches 0 exactly when the saw starts.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";

const file = resolve(process.argv[2] || "lathe.html");
let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };
const errors = [];

const browser = await chromium.launch();

async function open(wood, viewport) {
  const pg = await browser.newPage({ viewport });
  pg.on("pageerror", (e) => errors.push(e.message));
  pg.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // the forest opens only from a grown farm tree: grow one, tap it, then HARVEST
  await pg.goto(`file://${file}?tutorial=off&view=2d&seed=7#farm`);
  await pg.waitForFunction(() => window.__farm);
  await pg.evaluate((wood) => { const f = window.__farm.farm; f.state.plots[0] = null; f.plant(0, wood, { free: true }); f.state.plots[0].plantedAt -= 60 * 60 * 1000; window.__farm.tick(); }, wood);
  await pg.click('.plot[data-i="0"]');
  await pg.click('[data-act="harvest"]');
  await pg.waitForFunction(() => window.__harvest && window.__harvest.running);
  await pg.waitForTimeout(300);
  return pg;
}

/* ---------- 1 and 2: the notch is a hole ---------- */
for (const wood of ["oak", "pine", "walnut"]) {
  console.log(`\nNOTCH PIXELS (${wood})`);
  const pg = await open(wood, { width: 1100, height: 760 });
  const r = await pg.evaluate(() => {
    const v = window.__harvest, g = v.game;
    // a deep notch from the left, below the lowest branch so only sky and hills are behind it
    let t = 0;
    for (let k = 0; k < 3; k++) {
      const y = 0.9, w = g.trunk.widthAt(y) / 2;
      g.pointerDown(-(w + 0.5), y, t);
      for (let i = 1; i <= 10; i++) { t += 0.016; g.pointerMove(-(w + 0.5) + 1.5 * i / 10, y, t); }
      g.pointerUp(); t += 0.05;
    }
    const tr = g.trunk, i = tr.sliceAt(0.9), depth = tr.left[i], half = tr.W[i] / 2;
    const canvas = document.getElementById("hcanvas"), ctx = canvas.getContext("2d");
    const stage = document.getElementById("hstage"), c = v.cam;
    const k = canvas.width / stage.clientWidth;
    const px = (x, y) => [Math.round((stage.clientWidth / 2 + (x - c.x) * c.s) * k), Math.round((stage.clientHeight / 2 - (y - c.y) * c.s) * k)];
    const read = (p) => Array.from(ctx.getImageData(p[0], p[1], 1, 1).data).slice(0, 3);
    const dbg = { still: true, noParts: true };
    const at = {
      hole: px(-half + depth * 0.5, 0.9),          // the middle of the cut-away wood
      deepHole: px(-half + depth * 0.2, 0.9),      // close to the bark line, well inside the hole
      wood: px(-half + depth + 0.2, 0.9),          // solid trunk just beyond the notch
      barkAbove: px(-half + 0.35, 1.75),           // untouched trunk above the notch
      sky: px(-half - 3.2, 1.75)                   // open air well clear of the trunk
    };
    const withTree = {}, without = {}, onMagenta = {}, onLime = {};
    v.render(0, dbg);
    for (const key in at) withTree[key] = read(at[key]);
    v.render(0, { still: true, noParts: true, noTree: true });
    for (const key in at) without[key] = read(at[key]);
    // The same frame on two flat backgrounds: a pixel the tree draws is identical on both,
    // a background pixel follows the flat colour. That tells tree from background even
    // when the bark happens to be close in colour to the scenery behind it.
    v.render(0, { still: true, noParts: true, flat: "#ff00ff" });
    for (const key in at) onMagenta[key] = read(at[key]);
    v.render(0, { still: true, noParts: true, flat: "#00ff00" });
    for (const key in at) onLime[key] = read(at[key]);
    return { depth, half, withTree, without, onMagenta, onLime };
  });
  const d = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const tan = (p) => [[240, 209, 154], [214, 170, 108], [220, 182, 122], [227, 194, 134]].some((t) => d(p, t) < 40);
  check(r.depth > 0.35, `the notch is deep (${r.depth.toFixed(2)} of a ${(r.half * 2).toFixed(2)} wide trunk)`);
  check(d(r.withTree.hole, r.without.hole) <= 4, `middle of the notch is the background: rgb(${r.withTree.hole}) vs behind the tree rgb(${r.without.hole})`);
  check(d(r.withTree.deepHole, r.without.deepHole) <= 4, `inside the notch near the bark line is the background too: rgb(${r.withTree.deepHole})`);
  check(!tan(r.withTree.hole) && !tan(r.withTree.deepHole), "no tan in the notch");
  const drawn = (key) => d(r.onMagenta[key], r.onLime[key]) <= 2;      // same on both flat backgrounds: the tree put it there
  const background = (key) => d(r.onMagenta[key], r.onLime[key]) > 100; // follows the flat colour: nothing drawn there
  check(background("sky") && background("hole") && background("deepHole"), "the method sees open air as background (sky, and the inside of the notch)");
  check(drawn("wood"), `solid wood beside the notch is drawn: rgb(${r.withTree.wood}), the same on any background`);
  check(drawn("barkAbove"), `bark above the notch is drawn: rgb(${r.withTree.barkAbove}), the same on any background`);
  await pg.close();
}

/* ---------- 2b: no tan area anywhere on a notched trunk ---------- */
console.log("\nNOTCH EDGE");
{
  const pg = await open("oak", { width: 1100, height: 760 });
  const r = await pg.evaluate(() => {
    const v = window.__harvest, g = v.game; let t = 0;
    for (let k = 0; k < 3; k++) {
      const y = 0.9, w = g.trunk.widthAt(y) / 2;
      g.pointerDown(-(w + 0.5), y, t);
      for (let i = 1; i <= 10; i++) { t += 0.016; g.pointerMove(-(w + 0.5) + 1.5 * i / 10, y, t); }
      g.pointerUp(); t += 0.05;
    }
    v.render(0, { still: true, noParts: true });
    // count tan pixels in a box around the notch: only a thin line is allowed
    const canvas = document.getElementById("hcanvas"), ctx = canvas.getContext("2d"), stage = document.getElementById("hstage"), c = v.cam;
    const k = canvas.width / stage.clientWidth, i = g.trunk.sliceAt(0.9), half = g.trunk.W[i] / 2;
    const x0 = Math.round((stage.clientWidth / 2 + (-half - 0.1 - c.x) * c.s) * k), x1 = Math.round((stage.clientWidth / 2 + (half + 0.1 - c.x) * c.s) * k);
    const y0 = Math.round((stage.clientHeight / 2 - (1.5 - c.y) * c.s) * k), y1 = Math.round((stage.clientHeight / 2 - (0.3 - c.y) * c.s) * k);
    const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let tanN = 0, total = 0;
    for (let p = 0; p < data.length; p += 4) {
      total++;
      const R = data[p], G = data[p + 1], B = data[p + 2];
      if (R > 200 && G > 160 && B > 100 && B < 190 && R - B > 45) tanN++;
    }
    const notchArea = g.trunk.left[i] * 1.0 * c.s * k * c.s * k;     // roughly depth x 1 unit
    return { tanN, total, notchArea };
  });
  check(r.tanN < r.notchArea * 0.12, `tan pixels near the notch are a thin line, not a fill (${r.tanN} tan px vs a notch of about ${Math.round(r.notchArea)} px)`);
  await pg.close();
}

/* ---------- 3: delimb with real swipes, leader included ---------- */
for (const [label, off] of [["steep crossings", Math.PI / 2], ["shallow crossings", 0.3]]) {
  console.log(`\nDELIMB, ${label}`);
  const pg = await open("oak", { width: 1100, height: 760 });
  await pg.evaluate(() => {
    const g = window.__harvest.game; let t = 0;
    for (let n = 0; n < 40 && g.phase === "chop"; n++) {
      const y = 1.3, w = g.trunk.widthAt(y) / 2;
      g.pointerDown(-(w + 0.5), y, t);
      for (let i = 1; i <= 10; i++) { t += 0.016; g.pointerMove(-(w + 0.5) + 1.5 * i / 10, y, t); }
      g.pointerUp(); t += 0.05;
    }
  });
  await pg.waitForFunction(() => window.__harvest.game.phase === "delimb", null, { timeout: 12000 });
  await pg.waitForTimeout(600);
  const hasLeader = await pg.evaluate(() => window.__harvest.game.limbs.some((l) => l.b.leader));
  check(hasLeader, "the crown leader is among the limbs to clear");
  let swipes = 0, mismatch = "";
  while (swipes < 90) {
    const t = await pg.evaluate((off) => {
      const v = window.__harvest, g = v.game;
      if (g.phase !== "delimb") return null;
      // a limb that is not clean yet: prefer the leader when it is still standing
      const open = g.limbs.filter((l) => g.limbsLeft() && !g.limbClean(l));
      const l = open.find((x) => x.b.leader) || open[0];
      const s = Math.min(l.stub * 0.9, 0.14), p = g._pointAt(l, s), a = g._pointAt(l, s + 0.1), b = g._pointAt(l, Math.max(0, s - 0.1));
      const ang = Math.atan2(a.y - b.y, a.x - b.x) + off;
      const stage = document.getElementById("hstage").getBoundingClientRect(), c = v.cam;
      const sc = (x, y) => [stage.left + stage.width / 2 + (x - c.x) * c.s, stage.top + stage.height / 2 - (y - c.y) * c.s];
      const A = sc(p.x - Math.cos(ang) * 0.5, p.y - Math.sin(ang) * 0.5), B = sc(p.x + Math.cos(ang) * 0.5, p.y + Math.sin(ang) * 0.5);
      return { A, B, leader: l.b.leader };
    }, off);
    if (!t) break;
    await pg.mouse.move(t.A[0], t.A[1]); await pg.mouse.down();
    for (let i = 1; i <= 7; i++) { await pg.mouse.move(t.A[0] + (t.B[0] - t.A[0]) * i / 7, t.A[1] + (t.B[1] - t.A[1]) * i / 7); await pg.waitForTimeout(12); }
    await pg.mouse.up(); await pg.waitForTimeout(40);
    swipes++;
    // the number on screen and the phase must agree after every swipe
    const s = await pg.evaluate(() => ({ shown: document.getElementById("hLimbs").textContent, left: window.__harvest.game.limbsLeft(), phase: window.__harvest.game.phase }));
    await pg.waitForTimeout(120);
    const shown = await pg.evaluate(() => document.getElementById("hLimbs").textContent);
    if ((s.left === 0) !== (s.phase !== "delimb")) mismatch = `counter ${s.left} but phase ${s.phase}`;
    if (!mismatch && s.phase === "delimb" && shown !== String(s.left)) mismatch = `screen says ${shown} limbs left, model says ${s.left}`;
  }
  const end = await pg.evaluate(() => ({ phase: window.__harvest.game.phase, left: window.__harvest.game.limbsLeft(), leader: window.__harvest.game.limbs.find((l) => l.b.leader).stub }));
  check(end.phase === "saw" && end.left === 0, `reached the saw after ${swipes} swipes`);
  check(end.leader <= 0.32, `the leader was cut (${end.leader.toFixed(2)} left)`);
  check(mismatch === "", "the counter and the phase agreed after every swipe" + (mismatch ? ": " + mismatch : ""));
  await pg.waitForTimeout(400);
  const shown = await pg.textContent("#hLimbs");
  check(shown === "0", `the counter on screen reads ${shown} once the saw starts`);
  await pg.close();
}

// ---------- a cut stub is bare: its leaves come off with the cut, as a pine's needles do ----------
for (const wood of ["oak", "walnut"]) {
  console.log(`\nBARE STUBS (${wood})`);
  const pg = await browser.newPage({ viewport: { width: 412, height: 860 } });
  pg.on("pageerror", (e) => errors.push(e.message));
  await pg.goto(`file://${file}?tutorial=off&view=2d&seed=7#farm`);
  await pg.waitForFunction(() => window.__farm);
  await pg.evaluate((wood) => { const f = window.__farm.farm; f.state.plots[0] = null; f.plant(0, wood, { free: true }); f.state.plots[0].plantedAt -= 3600e3; window.__farm.tick(); }, wood);
  await pg.click('.plot[data-i="0"]'); await pg.click('[data-act="harvest"]');
  await pg.waitForFunction(() => window.__harvest && window.__harvest.running);
  await pg.evaluate(() => { const g = window.__harvest.game; let t = 100;
    for (let n = 0; n < 40 && g.phase === "chop"; n++) { const y = 1.4, w = g.trunk.widthAt(y) / 2; g.pointerDown(-(w + 0.5), y, t);
      for (let k = 1; k <= 10; k++) { t += 0.016; g.pointerMove(-(w + 0.5) + 1.6 * k / 10, y, t); } g.pointerUp(); t += 0.05; } });
  await pg.waitForFunction(() => window.__harvest.game.phase === "delimb", null, { timeout: 12000 });
  await pg.waitForTimeout(1200);
  // leaf green on the stage: a pixel much greener than it is red or blue
  const green = () => pg.evaluate(() => {
    const c = [...document.querySelectorAll("#harvestScreen canvas")].find((e) => e.width > 0), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i + 1] > d[i] + 30 && d[i + 1] > d[i + 2] + 30 && d[i + 1] > 90) n++;
    return n;
  });
  const before = await green();
  const cut = await pg.evaluate(() => { const g = window.__harvest.game; let t = 200, n = 0;
    for (const l of g.limbs.slice()) { if (!l.alive || l.stub < 0.8) continue; const s = l.stub * 0.55;
      const p = g._pointAt(l, s), a = g._pointAt(l, s + 0.1), q = g._pointAt(l, Math.max(0, s - 0.1));
      let tx = a.x - q.x, ty = a.y - q.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      for (let rep = 0; rep < 3; rep++) { g.pointerDown(p.x - ty * 0.5, p.y + tx * 0.5, t);
        for (let k = 1; k <= 6; k++) { t += 0.016; g.pointerMove(p.x - ty * 0.5 + ty * k / 6, p.y + tx * 0.5 - tx * k / 6, t); } g.pointerUp(); t += 0.05; }
      n++; }
    return { n, stubs: g.limbs.filter((l) => l.stub > 0.3).length }; });
  await pg.waitForTimeout(3000);   // the cut-off limbs and the falling leaves clear
  const after = await green();
  check(cut.n >= 3 && cut.stubs >= 3, `${cut.n} limbs cut halfway, ${cut.stubs} stubs left on the log`);
  check(after < before * 0.08, `the stubs are bare: leaf green ${before} -> ${after}`);
  await pg.close();
}

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

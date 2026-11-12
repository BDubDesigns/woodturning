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
  await pg.goto(`file://${file}?seed=7&wood=${wood}#harvest`);
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
      barkAbove: px(-half + 0.2, 1.75)             // untouched trunk above the notch
    };
    const withTree = {}, without = {};
    v.render(0, dbg);
    for (const key in at) withTree[key] = read(at[key]);
    v.render(0, { still: true, noParts: true, noTree: true });
    for (const key in at) without[key] = read(at[key]);
    return { depth, half, withTree, without };
  });
  const d = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const tan = (p) => [[240, 209, 154], [214, 170, 108], [220, 182, 122], [227, 194, 134]].some((t) => d(p, t) < 40);
  check(r.depth > 0.35, `the notch is deep (${r.depth.toFixed(2)} of a ${(r.half * 2).toFixed(2)} wide trunk)`);
  check(d(r.withTree.hole, r.without.hole) <= 4, `middle of the notch is the background: rgb(${r.withTree.hole}) vs behind the tree rgb(${r.without.hole})`);
  check(d(r.withTree.deepHole, r.without.deepHole) <= 4, `inside the notch near the bark line is the background too: rgb(${r.withTree.deepHole})`);
  check(!tan(r.withTree.hole) && !tan(r.withTree.deepHole), "no tan in the notch");
  check(d(r.withTree.wood, r.without.wood) > 25, `solid wood beside the notch is drawn: rgb(${r.withTree.wood}) vs background rgb(${r.without.wood})`);
  check(d(r.withTree.barkAbove, r.without.barkAbove) > 25, "bark above the notch is drawn");
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

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

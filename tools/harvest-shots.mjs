// Screenshots of the harvest's looks, for eyeballing changes to the art:
//   node tools/harvest-shots.mjs [page.html] outDir [prefix] [wood]
// Drives the model in the page (no mouse needed) to a deep notch on a standing
// tree, to the log lying down with all its limbs, and to the log with its limbs
// cleared, and saves a PNG of each at a desktop and a phone size. Plain
// Chromium: the harvest is Canvas2D only.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const [page_, out, prefix = "", wood = ""] = [resolve(process.argv[2] || "lathe.html"), resolve(process.argv[3] || "shots"), process.argv[4] || "", process.argv[5] || ""];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [label, viewport] of [["desktop", { width: 1100, height: 760 }], ["phone", { width: 390, height: 760 }]]) {
  const pg = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await pg.goto(`file://${page_}?seed=7${wood ? "&wood=" + wood : ""}#harvest`);
  await pg.waitForFunction(() => window.__harvest && window.__harvest.running);
  const snap = async (name) => { await pg.waitForTimeout(250); await pg.screenshot({ path: `${out}/${prefix}${label}-${name}.png` }); };
  // a standing tree with a deep notch from each side, not yet through
  await pg.evaluate(() => {
    const g = window.__harvest.game; let t = 0;
    const swing = (side, y, reach) => {
      const w = g.trunk.widthAt(y) / 2;
      g.pointerDown(side * (w + 0.5), y, t);
      for (let k = 1; k <= 10; k++) { t += 0.016; g.pointerMove(side * (w + 0.5) + side * -(0.5 + reach) * k / 10, y, t); }
      g.pointerUp(); t += 0.05;
    };
    for (let k = 0; k < 3; k++) swing(-1, 1.4, 1.0);
    for (let k = 0; k < 2; k++) swing(1, 1.0, 0.9);
    window.__harvest.update(0.02);
  });
  await snap("1-chopped-tree");
  // finish the tree and let it fall
  await pg.evaluate(() => {
    const g = window.__harvest.game; let t = 100;
    for (let n = 0; n < 40 && g.phase === "chop"; n++) {
      const y = 1.4, w = g.trunk.widthAt(y) / 2;
      g.pointerDown(-(w + 0.5), y, t);
      for (let k = 1; k <= 10; k++) { t += 0.016; g.pointerMove(-(w + 0.5) + 1.6 * k / 10, y, t); }
      g.pointerUp(); t += 0.05;
    }
  });
  await pg.waitForFunction(() => window.__harvest.game.phase === "delimb", null, { timeout: 12000 });
  await pg.waitForTimeout(1200);
  await snap("2-log-with-limbs");
  // cut the limbs off, close to the log, with the model's own slashes
  const left = await pg.evaluate(() => {
    const v = window.__harvest, g = v.game; let t = 200, guard = 0;
    while (g.phase === "delimb" && guard++ < 200) {
      const l = g.limbs.find((x) => x.alive), s = Math.min(l.stub * 0.9, 0.1);
      const p = g._pointAt(l, s), a = g._pointAt(l, s + 0.1), b = g._pointAt(l, Math.max(0, s - 0.1));
      let tx = a.x - b.x, ty = a.y - b.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      g.pointerDown(p.x - ty * 0.4, p.y + tx * 0.4, t);
      for (let k = 1; k <= 6; k++) { t += 0.016; g.pointerMove(p.x - ty * 0.4 + ty * 0.8 * k / 6, p.y + tx * 0.4 - tx * 0.8 * k / 6, t); }
      g.pointerUp(); t += 0.05;
      if (g.limbsLeft() === 1 && g.phase === "delimb") break;    // leave the last one for the picture below
    }
    return g.limbsLeft();
  });
  await pg.waitForTimeout(2600);                       // the cut-off limbs tumble away and clear
  await snap("3-delimbed-log");
  await pg.close();
}
await browser.close();
console.log(`shots in ${out}`);

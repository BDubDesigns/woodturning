// Browser check of the real page, both views.
//   node tests/e2e.mjs [path/to/page.html] [--shots dir]
// Uses the preinstalled Playwright + Chromium. For each view it presses
// below the log on the left and right, nudges up 40px, holds, and checks:
//   - the cut lands where the finger is (input mapping)
//   - the deepest point is DRAWN under the finger (catches a mirrored view)
//   - the finger never had to go over the wood
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const shotsIdx = args.indexOf("--shots");
const shots = shotsIdx >= 0 ? args.splice(shotsIdx, 2)[1] : null;
const page_ = resolve(args[0] || "lathe.html");
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("file://" + page_);
await page.waitForFunction(() => window.__lathe && window.__lathe.views && window.__lathe.views.current);
await page.waitForTimeout(400);

let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };

async function carve(t, opts = {}) {
  const info = await page.evaluate((t) => {
    const S = window.__lathe, v = S.views.current, lay = v.layout();
    const rect = document.getElementById("stage").getBoundingClientRect();
    return { x: rect.left + lay.left + t * (lay.right - lay.left), woodBottom: rect.top + lay.cy + lay.rPx, stageTop: rect.top, stageBottom: rect.bottom };
  }, t);
  const y0 = Math.min(info.stageBottom - 30, info.woodBottom + 70); // well below the wood
  await page.mouse.move(info.x, y0);
  await page.mouse.down();
  const push = opts.push ?? 40, steps = 12;
  let minY = y0;
  for (let i = 1; i <= steps; i++) { const y = y0 - (push * i) / steps; minY = Math.min(minY, y); await page.mouse.move(info.x, y); await page.waitForTimeout(25); }
  await page.waitForTimeout(opts.hold ?? 1200);
  await page.mouse.up();
  await page.waitForTimeout(60);
  return { ...info, minY };
}

async function measure() {
  return page.evaluate(() => {
    const S = window.__lathe, w = S.work, n = w.radius.length, v = S.views.current;
    let m = 0, mi = 0, best = -1, bi = 0;
    for (let i = 0; i < n; i++) { const d = w.baseRadius[i] - w.radius[i]; m += d; mi += d * i; if (d > best) { best = d; bi = i; } }
    const rect = document.getElementById("stage").getBoundingClientRect();
    return { centreT: mi / m / (n - 1), depth: best, drawnX: rect.left + v.sliceToScreenX(bi), kind: v.kind };
  });
}

for (const kind of ["3d", "2d"]) {
  await page.evaluate((k) => { const S = window.__lathe; k === "2d" ? S.views.use2D() : S.views.use3D(); }, kind);
  await page.waitForTimeout(300);
  const actual = await page.evaluate(() => window.__lathe.views.current.kind);
  console.log(`\n${kind.toUpperCase()} view (showing: ${actual})`);
  if (actual !== kind) { check(kind === "2d", "3D unavailable in this browser, skipped"); continue; }
  for (const t of [0.25, 0.75]) {
    await page.click("#newLogBtn");
    await page.waitForTimeout(100);
    const c = await carve(t);
    const m = await measure();
    check(Math.abs(m.centreT - t) < 0.02, `cut at t=${m.centreT.toFixed(3)}, finger at t=${t}`);
    check(Math.abs(m.drawnX - c.x) < 18, `deepest point drawn at x=${m.drawnX.toFixed(0)}, finger x=${c.x.toFixed(0)}`);
    check(c.minY > c.woodBottom, `finger stayed below the wood (lowest wood ${c.woodBottom.toFixed(0)}, finger reached ${c.minY.toFixed(0)})`);
    check(m.depth > 0.1 && m.depth <= 0.45, `40px nudge + hold cut ${(m.depth * 40).toFixed(1)} mm deep`);
  }
  // shallow nudge: cuts, but less
  await page.click("#newLogBtn");
  await carve(0.5, { push: 10, hold: 1200 });
  const shallow = await measure();
  check(shallow.depth > 0.005 && shallow.depth < 0.15, `10px nudge cut a shallow ${(shallow.depth * 40).toFixed(1)} mm`);

  if (shots) {
    // carve a little spindle for a visual check
    await page.click("#newLogBtn");
    await page.click("#tipGouge");
    for (const t of [0.3, 0.36, 0.42, 0.62, 0.68]) await carve(t, { hold: 700 });
    await page.click("#tipSkew");
    for (const t of [0.5, 0.18, 0.82]) await carve(t, { hold: 700 });
    await page.mouse.move(500, 700);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/lathe-${kind}.png` });
    console.log(`  shot ${shots}/lathe-${kind}.png`);
  }
}

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

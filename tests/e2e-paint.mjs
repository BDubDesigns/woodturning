// Browser check of paint and finish, in a real page, both views.
//   node tests/e2e-paint.mjs [path/to/page.html] [--shots dir]
// Drives the real UI with real pointer strokes (press below the log, nudge up,
// hold, like cutting) and checks:
//   - paint lands where the finger is, in the right colour, in the model AND on screen
//   - a light touch lays less than a firm one; the coat is built up by pressure
//   - the spec card shows the target, only palette paints are offered, the match score moves
//   - the spray builds gloss where aimed and the lit piece really gets brighter on screen
//   - cutting the wood takes the paint away; NEW LOG clears it
//   - no em or en dashes in anything the player reads; a phone-sized layout fits
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
await page.goto("file://" + page_ + "?tutorial=off&testclock");
await page.waitForFunction(() => window.__lathe && window.__lathe.views && window.__lathe.views.current);
const tick = (s) => page.evaluate((s) => window.__lathe.advance(s), s);   // the lathe runs on its test clock (?testclock)
await tick(0.4);

let failed = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failed++; };
const N = await page.evaluate(() => window.__lathe.coat.coat.length);
const idx = (t) => Math.round(t * (N - 1));

const BANDED = {
  name: "Test bands",
  segments: [{ a: 0, b: 0.5, paint: "crimson" }, { a: 0.5, b: 1, paint: "cobalt" }],
  sheen: "gloss"
};

/* Press below the log at t, nudge up, hold, release. Works for every tool. */
async function stroke(t, opts = {}) {
  const info = await page.evaluate((t) => {
    const S = window.__lathe, v = S.views.current, lay = v.layout();
    const rect = document.getElementById("stage").getBoundingClientRect();
    return { x: rect.left + lay.left + t * (lay.right - lay.left), woodBottom: rect.top + lay.cy + lay.rPx, stageBottom: rect.bottom };
  }, t);
  const y0 = Math.min(info.stageBottom - 30, info.woodBottom + 70);
  await page.mouse.move(info.x, y0);
  await page.mouse.down();
  const push = opts.push ?? 40, steps = 12;
  let minY = y0;
  for (let i = 1; i <= steps; i++) { const y = y0 - (push * i) / steps; minY = Math.min(minY, y); await page.mouse.move(info.x, y); await tick(0.025); }
  if (opts.to != null) {   // then sweep along the log, slowly
    const x1 = info.x + (opts.to - t) * (await page.evaluate(() => { const l = window.__lathe.views.current.layout(); return l.right - l.left; }));
    const n = 14;
    for (let i = 1; i <= n; i++) { await page.mouse.move(info.x + ((x1 - info.x) * i) / n, y0 - push); await tick((opts.sweepMs ?? 900) / n / 1000); }
  }
  await tick((opts.hold ?? 900) / 1000);
  await page.mouse.up();
  await page.mouse.move(40, 740);          // park the mouse off the stage so the tool is not hovering
  await tick(0.08);
  return { ...info, minY };
}

/* Mean colour and 99th percentile luminance of a patch of the real, rendered page. */
async function look(cx, cy, hw, hh) {
  const clip = { x: Math.max(0, Math.round(cx - hw)), y: Math.max(0, Math.round(cy - hh)), width: Math.round(hw * 2), height: Math.round(hh * 2) };
  const buf = await page.screenshot({ clip, timeout: 120000 });
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob());
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, lums = [];
    let r = 0, gg = 0, b = 0, n = 0, pale = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
      lums.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      if (d[i] > 150 && d[i + 2] > 0.72 * d[i]) pale++;   // near-white: wood and paint are warm or saturated, a reflection of light is not
    }
    lums.sort((a, b2) => a - b2);
    return { r: r / n, g: gg / n, b: b / n, p99: lums[Math.floor(lums.length * 0.99)], pale };
  }, buf.toString("base64"));
}
/* Where on the real page a position t along the piece is drawn (x) and its axis height (y). */
const onScreen = (t) => page.evaluate((t) => {
  const S = window.__lathe, v = S.views.current, lay = v.layout();
  const rect = document.getElementById("stage").getBoundingClientRect();
  return { x: rect.left + v.sliceToScreenX(Math.round(t * (S.coat.coat.length - 1))), y: rect.top + lay.cy, rPx: lay.rPx };
}, t);
const model = () => page.evaluate(() => {
  const S = window.__lathe, c = S.coat;
  return { coat: Array.from(c.coat), gloss: Array.from(c.gloss), color: Array.from(c.color), match: S.match(), mode: S.mode };
});
const visible = (sel) => page.locator(sel).isVisible();
// The readouts (match %, sheen meter) refresh on a throttled tick, and a slow machine can be a few frames
// behind, so tests wait for them to settle instead of sleeping a fixed time.
const settled = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 }).then(() => true, () => false);

for (const kind of ["3d", "2d"]) {
  await page.evaluate((k) => { const S = window.__lathe; k === "2d" ? S.views.use2D() : S.views.use3D(); }, kind);
  await tick(0.3);
  const actual = await page.evaluate(() => window.__lathe.views.current.kind);
  console.log(`\n${kind.toUpperCase()} view (showing: ${actual})`);
  if (actual !== kind) { check(kind === "2d", "3D unavailable in this browser, skipped"); continue; }

  // start clean, in cut mode
  await page.click("#modeCut");
  await page.evaluate(() => window.Lathe.mountBlank(null));   // a fresh practice blank
  check(await visible("#toolsCut") && !(await visible("#toolsPaint")) && !(await visible("#specBar")), "cut mode: chisels shown, paint tools and spec card hidden");

  /* ---------- paint ---------- */
  await page.click("#modePaint");
  await tick(0.4);
  check(await visible("#toolsPaint") && await visible("#specBar") && !(await visible("#toolsCut")) && !(await visible("#profileBar")), "paint mode: brush, palette and spec card shown, chisels hidden");
  const palette = await page.evaluate(() => Object.keys(window.Lathe.Paint.PALETTE));
  const swatches = await page.locator(".swatch").evaluateAll((els) => els.map((e) => e.dataset.color));
  check(swatches.length === palette.length && palette.every((k) => swatches.includes(k)), `the palette offers exactly the ${palette.length} spec paints`);
  check((await page.locator(".swatch").evaluateAll((els) => els.every((e) => e.getBoundingClientRect().width >= 34 && e.getBoundingClientRect().height >= 34))), "swatches are finger-sized");

  await page.evaluate((s) => window.__lathe.setSpec(s), BANDED);
  const needed = await page.locator(".swatch.needed").evaluateAll((els) => els.map((e) => e.dataset.color).sort());
  check(JSON.stringify(needed) === JSON.stringify(["cobalt", "crimson"]), "the swatches the spec needs are marked: " + needed.join(", "));
  check((await page.locator("#specName").textContent()) === "Test bands", "the spec card names the spec");
  check(/gloss/i.test(await page.locator("#specSheen").textContent()), "the spec card says what sheen it wants");
  const m0 = (await model()).match.total;

  await page.click('.swatch[data-color="crimson"]');
  check((await page.locator('.swatch[data-color="crimson"]').getAttribute("aria-pressed")) === "true", "picking a swatch selects it");
  const s1 = await stroke(0.25);
  let m = await model();
  const centre = (arr) => { let a = 0, b = 0; arr.forEach((v, i) => { a += v; b += v * i; }); return b / a / (N - 1); };
  check(Math.abs(centre(m.coat) - 0.25) < 0.02, `paint centred at t=${centre(m.coat).toFixed(3)}, finger at t=0.25`);
  check(m.coat[idx(0.25)] > 0.8, `coat under the finger is ${m.coat[idx(0.25)].toFixed(2)}`);
  check(m.coat[idx(0.75)] === 0 && m.coat[idx(0.6)] === 0, "no paint away from the brush");
  check(s1.minY > s1.woodBottom, "the finger stayed below the wood");
  const [r, g, b] = m.color.slice(idx(0.25) * 3, idx(0.25) * 3 + 3);
  check(r > 0.6 && g < 0.35 && b < 0.3, `the colour laid is crimson (${[r, g, b].map((v) => v.toFixed(2)).join(", ")})`);
  const here = await onScreen(0.25), there = await onScreen(0.75);
  const px = await look(here.x, here.y - here.rPx * 0.1, 8, 8), bare = await look(there.x, there.y - there.rPx * 0.1, 8, 8);
  // crimson is red with little green (g/r 0.2 in 3D, 0.4 in the flat view); bare wood is orange-brown (g/r 0.5 to 0.8)
  check(px.r > 60 && px.g < px.r * 0.45 && px.b < px.r * 0.45, `it is drawn red under the finger (rgb ${px.r.toFixed(0)},${px.g.toFixed(0)},${px.b.toFixed(0)})`);
  check(bare.g > bare.r * 0.46 && bare.b < bare.r, `and the far end is still bare wood (rgb ${bare.r.toFixed(0)},${bare.g.toFixed(0)},${bare.b.toFixed(0)})`);
  check((await model()).match.total > m0, "the match score went up");
  check(await settled(() => Number(document.getElementById("specMatch").textContent) === Math.round(window.__lathe.match().total * 100)), "and the spec card shows it");
  if (shots) await page.screenshot({ path: `${shots}/paint-${kind}-1.png`, timeout: 120000 });

  // pressure: a light nudge lays less than a firm one
  await page.evaluate(() => window.Lathe.mountBlank(null));   // a fresh practice blank
  await stroke(0.25, { push: 40, hold: 450 });
  const firm = (await model()).coat[idx(0.25)];
  await page.evaluate(() => window.Lathe.mountBlank(null));   // a fresh practice blank
  await stroke(0.25, { push: 9, hold: 450 });
  const light = (await model()).coat[idx(0.25)];
  check(light > 0.01 && light < firm - 0.1, `a light nudge lays ${light.toFixed(2)}, a firm one ${firm.toFixed(2)}`);

  // Paint the two bands the spec asks for, each one end to end: crimson on the left half, cobalt on the right.
  await page.evaluate(() => window.Lathe.mountBlank(null));   // a fresh practice blank
  await page.click('.swatch[data-color="crimson"]');
  await stroke(0.05, { to: 0.45, sweepMs: 3600, hold: 100 });
  await page.click('.swatch[data-color="cobalt"]');
  await stroke(0.55, { to: 0.95, sweepMs: 3600, hold: 100 });
  m = await model();
  check(m.coat[idx(0.3)] > 0.5 && m.coat[idx(0.75)] > 0.5, `a sweep lays an even band (${m.coat[idx(0.3)].toFixed(2)} and ${m.coat[idx(0.75)].toFixed(2)} mid-band)`);
  const cr = m.color.slice(idx(0.3) * 3, idx(0.3) * 3 + 3), cb = m.color.slice(idx(0.75) * 3, idx(0.75) * 3 + 3);
  check(cr[0] > cr[2] + 0.3 && cb[2] > cb[0] + 0.3, "red band on the left, blue band on the right");
  // A first pass can leave wood showing through (the game runs in slow motion below about 20 frames a second,
  // and this test machine renders at 4 to 6), and the match score rightly marks down a dark paint that is
  // part bare wood. So go back over each band, as a player does: a second pass builds the coat up.
  await page.click('.swatch[data-color="crimson"]');
  await stroke(0.45, { to: 0.05, sweepMs: 3600, hold: 100 });
  await page.click('.swatch[data-color="cobalt"]');
  await stroke(0.95, { to: 0.55, sweepMs: 3600, hold: 100 });
  m = await model();
  check(m.coat[idx(0.3)] > 0.7 && m.coat[idx(0.75)] > 0.7, `a second pass builds the coat up (${m.coat[idx(0.3)].toFixed(2)} and ${m.coat[idx(0.75)].toFixed(2)} mid-band)`);
  check(m.match.color > 0.4, `a good share of the spec's colour is matched (${(m.match.color * 100).toFixed(0)}%)`);
  await page.click("#brushLiner");
  await page.click('.swatch[data-color="ivory"]');
  const before = (await model()).coat.slice();
  await stroke(0.5, { hold: 700 });
  const after = (await model()).coat;
  let lined = 0; for (let i = 0; i < N; i++) if (after[i] > before[i] + 0.5) lined++;
  check(lined >= 2 && lined <= 12, `the liner lays a thin line (${lined} slices wide)`);
  await page.click("#brushWide");

  /* ---------- finish ---------- */
  // Look at the plain cobalt band (not the ivory pinstripe at the middle, which is pale by itself) in paint
  // mode, where the lamp is off, before and after spraying; the lamp's sweep would confuse the comparison.
  const T = 0.7;
  await page.click("#modePaint");
  await tick(0.5);
  const pre = await onScreen(T);
  const litSpot = [pre.x, pre.y - pre.rPx * 0.25, 45, pre.rPx * 0.4];   // inside the blank, clear of the steel tool rest
  const litBefore = await look(...litSpot);
  await page.click("#modeFinish");
  await tick(0.4);
  check(await visible("#toolsFinish") && await visible("#specBar") && !(await visible("#toolsPaint")), "finish mode: spray bottle and spec card shown");
  check(await settled(() => document.getElementById("glossName").textContent === "Matte"), "a fresh piece is matte");
  await stroke(T, { hold: 1600 });
  m = await model();
  check(m.gloss[idx(T)] > 0.3, `spray builds gloss where it is aimed (${m.gloss[idx(T)].toFixed(2)})`);
  check(m.gloss[idx(T)] > m.gloss[idx(T) + 25] && m.gloss[idx(0.95)] === 0, "and not where it is not");
  check(await settled(() => parseFloat(document.getElementById("glossFill").style.width) > 3), "the sheen meter moves");
  await page.click("#modePaint");
  await tick(0.9);
  const litAfter = await look(...litSpot);
  check(litAfter.pale > litBefore.pale + 20 && litAfter.p99 > litBefore.p99 + 25,
    `the finished wood catches the light on screen (white glints ${litBefore.pale} to ${litAfter.pale}, bright end ${litBefore.p99.toFixed(0)} to ${litAfter.p99.toFixed(0)})`);
  await page.click("#modeFinish");
  await tick(0.4);
  // finish the whole piece, then the finish score
  await page.evaluate(() => { const S = window.__lathe; for (let p = 0; p < 24; p++) for (let k = 0; k <= 60; k++) S.coat.spray(p % 2 ? 1 - k / 60 : k / 60, 1, 1 / 60); });
  await tick(0.3);
  m = await model();
  check(m.match.finish > 0.9 && m.match.sheen === "gloss", `a fully sprayed piece matches a gloss spec (finish ${(m.match.finish * 100).toFixed(0)}%)`);
  check(await settled(() => document.getElementById("glossName").textContent === "Gloss"), "and the meter reads Gloss");
  check(await settled(() => !!document.querySelector("#specSheen.ok")), "and the card says so");
  if (shots) await page.screenshot({ path: `${shots}/finish-${kind}.png`, timeout: 120000 });

  /* ---------- cutting takes the paint with it; new log clears it ---------- */
  await page.click("#modeCut");
  await tick(0.4);
  check(await visible("#toolsCut") && await visible("#profileBar") && !(await visible("#specBar")), "back to cut mode: chisels and profile strip return");
  const painted = (await model()).coat;
  check(painted[idx(0.25)] > 0.5, "the piece is still painted after switching modes");
  await stroke(0.25, { hold: 1200 });
  m = await model();
  check(m.coat[idx(0.25)] === 0 && m.gloss[idx(0.25)] === 0, "cutting the wood takes the paint and finish off");
  check(m.coat[idx(0.75)] > 0.5, "paint is untouched away from the cut");
  await page.evaluate(() => window.Lathe.mountBlank(null));   // a fresh practice blank
  m = await model();
  check(m.coat.every((v) => v === 0) && m.gloss.every((v) => v === 0), "a fresh practice blank is bare");

  /* ---------- UNDO: asks first, and takes off only its own layer ---------- */
  if (kind === "2d") {
    const layers = () => page.evaluate(() => { const S = window.__lathe; return { r: Array.from(S.work.radius), coat: Array.from(S.coat.coat), gloss: S.coat.avgGloss(), stock: JSON.stringify(S.stock) }; });
    const undo = async (yes) => { await page.click("#newLogBtn"); await page.click(yes ? '#undoOverlay [data-undo="yes"]' : '#undoOverlay [data-undo="no"]'); await tick(0.1); };
    await page.evaluate(() => { const S = window.__lathe; window.Lathe.mountStock({ kind: "log", key: "pine" }) || window.Lathe.mountBlank(null);
      for (let i = 40; i < 200; i++) S.work.radius[i] *= 0.9; S.work.version++; });
    await tick(0.1);
    await page.evaluate(() => { const S = window.__lathe; S.coat.coat.fill(0.9); S.coat.gloss.fill(0.6); S.coat.version++; });
    await tick(0.1);
    const full = await layers();
    await page.click("#modeFinish");
    await page.click("#newLogBtn");
    check(/Clear the finish\?/.test(await page.locator("#undoOverlay").textContent()) && /shape and the paint stay/.test(await page.locator("#undoOverlay").textContent()), "UNDO on FINISH asks first, and says only the finish goes");
    await page.click('#undoOverlay [data-undo="no"]');
    let L1 = await layers();
    check(L1.gloss === full.gloss && JSON.stringify(L1.coat) === JSON.stringify(full.coat), "KEEP IT changes nothing");
    await undo(true);
    L1 = await layers();
    check(L1.gloss === 0 && JSON.stringify(L1.coat) === JSON.stringify(full.coat) && JSON.stringify(L1.r) === JSON.stringify(full.r), "UNDO on FINISH: the sheen is off, the paint and the shape stay");
    await page.evaluate(() => { const S = window.__lathe; S.coat.gloss.fill(0.6); S.coat.version++; });
    await page.click("#modePaint");
    await undo(true);
    L1 = await layers();
    check(L1.coat.every((v) => v === 0) && L1.gloss === 0 && JSON.stringify(L1.r) === JSON.stringify(full.r), "UNDO on PAINT: paint and sheen off, the shape stays");
    await page.evaluate(() => { const S = window.__lathe; S.coat.coat.fill(0.9); S.coat.gloss.fill(0.6); S.coat.version++; });
    await page.click("#modeCut");
    await page.click("#newLogBtn");
    check(/Start this piece over\?/.test(await page.locator("#undoOverlay").textContent()), "UNDO on CUT asks to start the piece over");
    await page.click('#undoOverlay [data-undo="yes"]');
    await tick(0.1);
    L1 = await layers();
    const fresh = await page.evaluate(() => { const S = window.__lathe; return S.work.removedFraction(); });
    check(fresh === 0 && L1.coat.every((v) => v === 0) && L1.gloss === 0, "UNDO on CUT: fresh wood, no paint, no sheen");
    check(L1.stock === full.stock, `and the same stock stays on the lathe (${L1.stock})`);
  }

  /* ---------- specs ---------- */
  await page.click("#modePaint");
  await tick(0.3);
  const names = new Set();
  let ok = true;
  for (let i = 0; i < 12; i++) {
    await page.click("#specNewBtn");
    const spec = await page.evaluate(() => window.__lathe.spec);
    names.add(JSON.stringify(spec.segments) + spec.sheen);
    const marked = await page.locator(".swatch.needed").evaluateAll((els) => els.map((e) => e.dataset.color).sort());
    const want = [...new Set(spec.segments.map((s) => s.paint).filter(Boolean))].sort();
    if (JSON.stringify(marked) !== JSON.stringify(want) || !want.every((k) => swatches.includes(k))) ok = false;
  }
  check(ok, "every new spec only asks for paints the palette has, and the card marks them");
  check(names.size > 3, `NEW SPEC rolls different specs (${names.size} different in 12)`);
  await page.click("#modeCut");
}

/* ---------- copy: no em or en dashes anywhere the player reads ---------- */
console.log("\nCOPY");
for (const mode of ["cut", "paint", "finish"]) {
  await page.click("#mode" + mode[0].toUpperCase() + mode.slice(1));
  await tick(0.15);
  const text = await page.evaluate(() => document.body.innerText + "\n" + Array.from(document.querySelectorAll("[title],[aria-label]")).map((e) => (e.title || "") + " " + (e.getAttribute("aria-label") || "")).join("\n"));
  check(!/[–—]/.test(text), `no em or en dashes in the ${mode} screen text`);
}
await page.click("#modeCut");

/* ---------- a phone ---------- */
console.log("\nPHONE (420 x 800)");
await page.setViewportSize({ width: 420, height: 800 });
await tick(0.3);
for (const mode of ["Paint", "Finish"]) {
  await page.click("#mode" + mode);
  await tick(0.5);
  const fit = await page.evaluate(() => {
    const over = document.documentElement.scrollWidth > window.innerWidth + 1;
    const bad = Array.from(document.querySelectorAll("#footer button, footer button, #specBar button, .swatch")).filter((b) => b.offsetParent && (b.getBoundingClientRect().right > window.innerWidth + 1 || b.getBoundingClientRect().left < -1)).length;
    const st = document.getElementById("stage").getBoundingClientRect();
    const footer = document.querySelector("footer").getBoundingClientRect();
    return { over, bad, stageH: st.height, footerBottom: footer.bottom };
  });
  check(!fit.over && fit.bad === 0, `${mode.toLowerCase()} mode fits a phone without sideways scroll`);
  check(fit.stageH >= 190 && fit.footerBottom <= 801, `and leaves room to work (stage ${fit.stageH.toFixed(0)} px tall)`);
}
if (shots) await page.screenshot({ path: `${shots}/finish-phone.png`, timeout: 120000 });

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

/* ============================================================
   Harvest view (Canvas2D only, so every webview can paint it).
   Draws the forest scene and drives the harvest model from
   pointer input:

     chop    side view, the tree standing. Swipe into the trunk.
     fall    the camera follows the tree down and settles on the log.
     delimb  side view of the log. Swipe across branches.
     saw     top-down on the log. Rub across it where you want a cut.

   The model (harvest.js) owns every rule; this file maps the
   screen to it, draws what it says, and adds the juice: chips,
   leaves, dust, shake, a trail behind the finger, sound.
   ============================================================ */
(function (root) {
  "use strict";
  var L = root.Lathe, HC = L.HCFG, TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------- sprites, built once ---------- */
  function makeLeafSprite(seed) {
    var c = document.createElement("canvas"); c.width = c.height = 160;
    var g = c.getContext("2d"), s = seed * 9301 + 49297;
    function r() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
    var cols = ["#254a28", "#2f5d2e", "#3d7236", "#52863a", "#6e9c42", "#93b653"];
    for (var layer = 0; layer < cols.length; layer++) {
      for (var i = 0; i < 7; i++) {
        var a = r() * TAU, d = r() * 46 * (1 - layer * 0.07);
        var x = 80 + Math.cos(a) * d - layer * 2.4, y = 82 + Math.sin(a) * d * 0.9 - layer * 4.5;
        var rad = 22 + r() * 15 - layer * 1.4;
        g.fillStyle = cols[layer];
        g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
      }
    }
    g.fillStyle = "rgba(255,240,170,0.16)";
    for (var k = 0; k < 14; k++) { g.beginPath(); g.arc(52 + r() * 40, 46 + r() * 34, 2 + r() * 4, 0, TAU); g.fill(); }
    g.fillStyle = "rgba(12,26,12,0.28)";
    for (k = 0; k < 10; k++) { g.beginPath(); g.arc(50 + r() * 60, 96 + r() * 30, 3 + r() * 5, 0, TAU); g.fill(); }
    return c;
  }

  function createHarvest(opts) {
    opts = opts || {};
    var audio = L.audio;
        var stage = document.getElementById("hstage");
    var canvas = document.getElementById("hcanvas");
    var g = canvas.getContext("2d");
    var hintEl = document.getElementById("hhint"), toastEl = document.getElementById("htoast");
    var statSwings = document.getElementById("hSwings"), statLimbs = document.getElementById("hLimbs"), statCuts = document.getElementById("hCuts");
    var stepEls = { chop: document.getElementById("stepChop"), delimb: document.getElementById("stepDelimb"), saw: document.getElementById("stepSaw") };

    var seedUrl = /[?&]seed=(\d+)/.exec(root.location.search);
    var game = new L.Harvest(seedUrl ? parseInt(seedUrl[1], 10) : null);
    var sprites = [makeLeafSprite(1), makeLeafSprite(2), makeLeafSprite(3)];

    var running = false, W = 300, Hh = 300, dpr = 1;
    var T = 0;                         // clock, seconds
    var cam = { x: 0, y: 0, s: 50 }, camStart = null, camEnd = null;
    var shake = 0;                     // screen shake, 0..1
    var parts = [];                    // particles (world space) and sawdust (screen space)
    var trail = [];                    // recent finger positions, screen px
    var pointer = { active: false, id: null, x: 0, y: 0 };
    var saw = null;                    // top-down layout
    var sawBlend = 0;                  // 0 side view .. 1 top-down
    var handoff = -1;                  // seconds since the blank was freed, -1 when not
    var sawSpeed = 0, lastSawY = 0, lastSawT = 0;
    var toastT = 0, creakT = 0, uiT = 0;
    var swayAmp = 0.05;

    /* ============ layout and camera ============ */
    function resize() {
      W = stage.clientWidth || 300; Hh = stage.clientHeight || 300;
      dpr = Math.min(root.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
      if (game.phase === "chop" || game.phase === "crack") cam = camChop();
      else if (game.log) cam = camLog(game.log.bx, game.log.dir, game.log.len);
      layoutSaw();
    }
    function camChop() {
      var s = Math.min(Hh * 0.88 / (HC.TRUNK_H + HC.LEADER_H + 0.9), W * 0.96 / 4.9);
      return { x: 0, y: (Hh * 0.92 - Hh / 2) / s, s: s };
    }
    /* The camera for the log lying down: the whole log and its leader in view. */
    function camLog(bx, dir, len) {
      var tip = bx + dir * len, end = tip + dir * (HC.LEADER_H + 0.55);
      var minX = Math.min(bx, end) - 0.5, maxX = Math.max(bx, end) + 0.5;
      var c1 = camChop();
      var s = Math.min(W * 0.96 / (maxX - minX), Hh * 0.72 / 2.9, c1.s * 1.7);
      return { x: (minX + maxX) / 2, y: HC.GROUND + (Hh * 0.7 - Hh / 2) / s, s: s };
    }
    function sx(X) { return W / 2 + (X - cam.x) * cam.s; }
    function sy(Y) { return Hh / 2 - (Y - cam.y) * cam.s; }
    function layoutSaw() {
      if (!game.log) { saw = null; return; }
      var Lg = game.log.len, lenPx = Math.min(W * 0.9, Hh * 2.0, 1100);
      var scale = lenPx / Lg, avg = 0, k;
      for (k = 0; k < 10; k++) avg += game.log.radiusAt(Lg * (k + 0.5) / 10) * 2 / 10;
      var ty = scale * clamp(86 / (avg * scale), 1, 2.1);       // draw it thicker than true so a finger can work it
      saw = { x0: W / 2 - lenPx / 2, len: lenPx, scale: scale, ty: ty, cy: Hh * 0.5 };
    }

    /* ============ input ============ */
    function coords(e) {
      var r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, a, b;
      if (game.phase === "saw") { a = (px - saw.x0) / saw.scale; b = (py - saw.cy) / saw.ty; }
      else { a = cam.x + (px - W / 2) / cam.s; b = cam.y - (py - Hh / 2) / cam.s; }
      return { a: a, b: b, px: px, py: py };
    }
    function stamp(e) { return (e.timeStamp || performance.now()) / 1000; }
    function canTouch() { return game.phase === "chop" || game.phase === "delimb" || game.phase === "saw"; }
    stage.addEventListener("pointerdown", function (e) {
      if (pointer.active || !canTouch()) return;
      audio.init();
      pointer.active = true; pointer.id = e.pointerId;
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      var c = coords(e);
      pointer.x = c.px; pointer.y = c.py; trail.length = 0; trail.push({ x: c.px, y: c.py, t: T });
      lastSawY = c.py; lastSawT = stamp(e);
      game.pointerDown(c.a, c.b, stamp(e));
      e.preventDefault();
    });
    stage.addEventListener("pointermove", function (e) {
      if (!pointer.active || e.pointerId !== pointer.id) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!evs || !evs.length) evs = [e];
      for (var i = 0; i < evs.length; i++) {
        if (!canTouch()) break;
        var c = coords(evs[i]);
        pointer.x = c.px; pointer.y = c.py;
        trail.push({ x: c.px, y: c.py, t: T });
        game.pointerMove(c.a, c.b, stamp(evs[i]));
        if (game.phase === "saw") {
          var dt = Math.max(0.004, stamp(evs[i]) - lastSawT);
          sawSpeed += (Math.abs(c.py - lastSawY) / dt / (saw ? saw.ty * 2.4 : 100) - sawSpeed) * Math.min(1, dt * 12);
          lastSawY = c.py; lastSawT = stamp(evs[i]);
        }
      }
      if (trail.length > 24) trail.splice(0, trail.length - 24);
    });
    function endPointer(e) {
      if (e.pointerId !== pointer.id) return;
      pointer.active = false; pointer.id = null;
      game.pointerUp();
      sawSpeed = 0;
    }
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);

    /* ============ events from the model: sound, particles, messages ============ */
    function toast(msg, secs) { toastEl.textContent = msg; toastEl.classList.add("on"); toastT = secs || 2.2; }
    function addPart(p) { if (parts.length > 420) parts.shift(); parts.push(p); return p; }
    function chips(x, y, dirX, n, spread) {
      for (var i = 0; i < n; i++) {
        addPart({ w: true, x: x, y: y + rand(-0.1, 0.1), vx: dirX * rand(0.6, 3.2) + rand(-0.5, 0.5), vy: rand(0.5, 3.2),
          rot: rand(0, TAU), vr: rand(-12, 12), life: rand(0.7, 1.3), max: 1.3, size: rand(0.045, 0.11), kind: "chip", g: 9 });
      }
    }
    function leaves(x, y, n, power) {
      for (var i = 0; i < n; i++) {
        addPart({ w: true, x: x + rand(-0.8, 0.8), y: y + rand(-0.6, 0.6), vx: rand(-1, 1) * power, vy: rand(-0.3, 1.2) * power,
          rot: rand(0, TAU), vr: rand(-4, 4), life: rand(1.4, 2.8), max: 2.8, size: rand(0.07, 0.13), kind: "leaf", g: 1.1, sway: rand(0, TAU) });
      }
    }
    function dust(x, y, n, power) {
      for (var i = 0; i < n; i++) {
        addPart({ w: true, x: x + rand(-0.3, 0.3), y: y + rand(0, 0.2), vx: rand(-1.6, 1.6) * power, vy: rand(0.2, 1.1) * power,
          rot: 0, vr: 0, life: rand(0.7, 1.4), max: 1.4, size: rand(0.25, 0.5), kind: "dust", g: -0.15 });
      }
    }
    function sawdust(px, py, n, dir) {
      for (var i = 0; i < n; i++) {
        addPart({ w: false, x: px + rand(-3, 3), y: py, vx: rand(-60, 60) + 0 * dir, vy: rand(-90, -10) * (dir > 0 ? -1 : 1) + rand(-40, 40),
          rot: rand(0, TAU), vr: rand(-8, 8), life: rand(0.5, 1.0), max: 1.0, size: rand(1.4, 3.2), kind: "sawdust", g: 220 });
      }
    }
    function handleEvents() {
      var evs = game.drain();
      for (var i = 0; i < evs.length; i++) {
        var e = evs[i];
        switch (e.type) {
          case "thunk":
            audio.thunk(e.power); shake = Math.min(1, shake + 0.12 + 0.3 * e.power);
            chips(e.x, e.y, e.side, 9 + Math.round(e.power * 8)); hideHint();
            if (e.power > 0.5) leaves(0, HC.TRUNK_H - 1.2, 2, 0.6);
            break;
          case "chips":
            if (Math.random() < 0.55) chips(e.x, e.y, e.side, 1 + Math.floor(e.amount * 18));
            break;
          case "rustle":
            if (T - rustleT > 0.12) { rustleT = T; audio.rustle(e.power); leaves(e.x, e.y, 2, 0.8); swayAmp = Math.min(0.5, swayAmp + 0.06); }
            break;
          case "crack":
            audio.crack(e.stage); shake = Math.min(1, shake + 0.55);
            if (e.stage === 0) {
              toast("Cracking...", 1.4); setHint("");
              var wk = game.hStar; chips(0, wk, game.dir, 14);
            }
            leaves(0, HC.TRUNK_H - 0.5, 8, 1.2);
            break;
          case "release":
            if (e.dir) { audio.crack(2); toast("Timber!", 1.6); camStart = camNow(); camEnd = camLog(game.fall.finalBx * game.dir, game.dir, game.log ? game.log.len : HC.TRUNK_H - game.hStar); }
            break;
          case "thud":
            audio.thud(e.power); shake = Math.min(1, shake + 0.3 + 0.6 * e.power);
            dust(e.x, 0.2, 6 + Math.round(e.power * 8), 1 + e.power); leaves(e.x, 1.0, Math.round(6 * e.power) + 2, 1.5);
            break;
          case "snap":
            audio.snap(); break;
          case "landed":
            toast("Down. Clear the limbs.", 2.6);
            setHint("<b>Swipe a blade across each branch</b> to cut it away.<br />Cut close to the log for a clean finish. Thick ones take a few swipes.");
            camStart = null; camEnd = null; cam = camLog(game.log.bx, game.log.dir, game.log.len); layoutSaw();
            break;
          case "slash":
            hideHint();
            addPart({ w: true, x: e.x, y: e.y, vx: 0, vy: 0, rot: 0, vr: 0, life: 0.16, max: 0.16, size: 0.28, kind: "slash", g: 0 });
            break;
          case "snip":
            audio.snip(); shake = Math.min(1, shake + 0.1);
            leaves(e.x, e.y, 6, 1.2); chips(e.x, e.y, 0, 5);
            break;
          case "cleaned":
            audio.chime(); toast("Clean log. Now saw it.", 2.6);
            setHint("<b>Press on the log and rub back and forth</b> where you want a cut.<br />Make two cuts. The piece between them is your blank.");
            layoutSaw(); sawBlend = 0;
            break;
          case "sawdust":
            if (saw) {
              var kx = saw.x0 + e.u * saw.scale;
              sawdust(kx, saw.cy + e.v * saw.ty, 1 + Math.floor(e.amount * 110), e.dir);
            }
            hideHint();
            break;
          case "kerf":
            audio.kerf(); shake = Math.min(1, shake + 0.25);
            toast(e.done === 1 ? "First cut through. Make a second cut." : "Blank is free.", 2.4);
            break;
          case "refuse":
            toast(e.why === "end" ? "Too close to the end. Move in a little." : "Too close to the other cut.", 1.8);
            break;
          case "blank":
            handoff = 0; audio.chime(); toast("Blank ready. Off to the lathe.", 2.4);
            break;
        }
      }
    }
    var rustleT = 0;
    function camNow() { return { x: cam.x, y: cam.y, s: cam.s }; }

    /* ============ hint / HUD ============ */
    function setHint(html) { hintEl.innerHTML = html; hintEl.classList.toggle("gone", !html); }
    function hideHint() { hintEl.classList.add("gone"); }
    function phaseStep() {
      var p = game.phase;
      return p === "chop" || p === "crack" || p === "fall" ? "chop" : p === "delimb" ? "delimb" : "saw";
    }
    function updateHud() {
      statSwings.textContent = game.swings;
      statLimbs.textContent = game.phase === "chop" || game.phase === "crack" || game.phase === "fall" ? "-" : game.limbsLeft();
      var done = 0, ks = game.saw ? game.saw.kerfs : [];
      for (var i = 0; i < ks.length; i++) if (ks[i].done) done++;
      statCuts.innerHTML = done + "<small>/2</small>";
      var cur = phaseStep(), order = ["chop", "delimb", "saw"], ci = order.indexOf(cur);
      for (var k = 0; k < 3; k++) {
        var s = stepEls[order[k]];
        s.className = "step" + (k < ci || game.phase === "done" ? " done" : k === ci ? " now" : "");
        s.setAttribute("aria-current", k === ci && game.phase !== "done" ? "step" : "false");
      }
    }

    /* ============ drawing: scene ============ */
    var treeLine = [], tufts = [];
    (function seedScenery() {
      var i, x = -26;
      while (x < 26) {
        treeLine.push({ x: x, h: rand(2.6, 5.4), w: rand(0.9, 1.7), far: Math.random() < 0.5 });
        x += rand(0.5, 1.3);
      }
      for (i = 0; i < 160; i++) tufts.push({ x: rand(-16, 16), h: rand(0.12, 0.34), p: rand(0, TAU), tilt: rand(-0.4, 0.4) });
    })();

    function drawSky(groundPy) {
      var sky = g.createLinearGradient(0, 0, 0, groundPy);
      sky.addColorStop(0, "#16222a"); sky.addColorStop(0.38, "#2b3b3a"); sky.addColorStop(0.68, "#78694a");
      sky.addColorStop(0.9, "#d09a55"); sky.addColorStop(1, "#efb76a");
      g.fillStyle = sky; g.fillRect(0, 0, W, groundPy + 2);
      var sunX = W * 0.76 - cam.x * cam.s * 0.05, sunY = groundPy - cam.s * 0.9;
      var sun = g.createRadialGradient(sunX, sunY, 4, sunX, sunY, Math.max(W, Hh) * 0.55);
      sun.addColorStop(0, "rgba(255,214,140,0.65)"); sun.addColorStop(0.35, "rgba(255,190,110,0.22)"); sun.addColorStop(1, "rgba(255,190,110,0)");
      g.fillStyle = sun; g.fillRect(0, 0, W, groundPy + 2);
      // far ridge and treeline, drifting slower than the world
      var par = cam.s * 0.35, i, t;
      g.fillStyle = "#2a3829";
      g.beginPath(); g.moveTo(0, groundPy);
      for (i = 0; i <= 24; i++) {
        var px = (i / 24) * W, wx = (px - W / 2) / par + cam.x * 0.2;
        g.lineTo(px, groundPy - cam.s * (1.4 + 0.5 * Math.sin(wx * 0.5) + 0.3 * Math.sin(wx * 1.3 + 1)));
      }
      g.lineTo(W, groundPy); g.closePath(); g.fill();
      for (i = 0; i < treeLine.length; i++) {
        t = treeLine[i];
        var x = W / 2 + (t.x - cam.x * 0.45) * cam.s * 0.62, base = groundPy;
        if (x < -80 || x > W + 80) continue;
        g.fillStyle = t.far ? "#1f2c22" : "#16211a";
        var hh = t.h * cam.s * (t.far ? 0.62 : 0.85), ww = t.w * cam.s * 0.6;
        g.beginPath(); g.moveTo(x - ww, base); g.quadraticCurveTo(x - ww * 0.9, base - hh * 0.7, x, base - hh);
        g.quadraticCurveTo(x + ww * 0.9, base - hh * 0.7, x + ww, base); g.closePath(); g.fill();
      }
    }
    function drawGround(groundPy) {
      var gr = g.createLinearGradient(0, groundPy, 0, Hh);
      gr.addColorStop(0, "#3b2c19"); gr.addColorStop(0.18, "#2a1d10"); gr.addColorStop(1, "#130d07");
      g.fillStyle = gr; g.fillRect(0, groundPy, W, Hh - groundPy);
      g.fillStyle = "#4b6a2f"; g.fillRect(0, groundPy - 1, W, Math.max(3, cam.s * 0.07));
      g.fillStyle = "rgba(255,214,140,0.14)"; g.fillRect(0, groundPy - 1, W, 1.5);
      g.lineCap = "round";
      for (var i = 0; i < tufts.length; i++) {
        var f = tufts[i], x = sx(f.x);
        if (x < -10 || x > W + 10) continue;
        var sway = Math.sin(T * 1.6 + f.p) * 0.06 + f.tilt * 0.3 + (game.phase === "fall" ? 0.15 : 0);
        g.strokeStyle = i % 3 ? "#5b7d36" : "#41602a"; g.lineWidth = Math.max(1.2, cam.s * 0.03);
        var tx = x + (f.tilt + sway) * f.h * cam.s * 2.2;
        g.beginPath(); g.moveTo(x, groundPy); g.quadraticCurveTo(x + f.tilt * 3, groundPy - f.h * cam.s * 0.6, tx, groundPy - f.h * cam.s); g.stroke();
      }
    }

    /* ---- the tree, in a local frame: x across, y up from the break plane (or the ground) ---- */
    function frame(px, py, ang, fn) {
      g.save(); g.translate(px, py); g.rotate(ang); g.scale(cam.s, -cam.s);
      fn(); g.restore();
    }
    function edgeAt(h) {
      var tr = game.trunk, x = clamp(h / tr.dh, 0, tr.n - 1), i = Math.min(tr.n - 2, Math.floor(x)), f = x - i;
      function m(a) { return a[i] * (1 - f) + a[i + 1] * f; }
      return { W: m(tr.W), l: m(tr.left), r: m(tr.right) };
    }
    function trunkPoly(h0, h1, yoff) {
      var tr = game.trunk, i, e;
      g.beginPath();
      e = edgeAt(h0); g.moveTo(-e.W / 2, h0 - yoff);
      for (i = Math.ceil(h0 / tr.dh + 1e-6); i * tr.dh < h1 - 1e-6; i++) g.lineTo(-tr.W[i] / 2, i * tr.dh - yoff);
      e = edgeAt(h1); g.lineTo(-e.W / 2, h1 - yoff); g.lineTo(e.W / 2, h1 - yoff);
      for (i = Math.floor(h1 / tr.dh - 1e-6); i * tr.dh > h0 + 1e-6; i--) g.lineTo(tr.W[i] / 2, i * tr.dh - yoff);
      e = edgeAt(h0); g.lineTo(e.W / 2, h0 - yoff);
      g.closePath();
    }
    function wedges(h0, h1, yoff) {
      var tr = game.trunk, side, i, run;
      for (side = -1; side <= 1; side += 2) {
        var arr = side < 0 ? tr.left : tr.right;
        run = false;
        var i0 = Math.max(0, Math.floor(h0 / tr.dh)), i1 = Math.min(tr.n - 1, Math.ceil(h1 / tr.dh));
        for (i = i0; i <= i1 + 1; i++) {
          var d = i <= i1 ? arr[i] : 0, h = i * tr.dh;
          var inside = d > 0.004 && h >= h0 - 1e-6 && h <= h1 + 1e-6;
          if (inside && !run) { run = { a: i, pts: [] }; }
          if (inside) run.pts.push(i);
          if (!inside && run) { fillWedge(side, run.pts, arr, yoff); run = false; }
        }
      }
    }
    function fillWedge(side, idx, arr, yoff) {
      var tr = game.trunk, j, e0 = idx[0], e1 = idx[idx.length - 1];
      var deep = 0;
      for (j = 0; j < idx.length; j++) deep = Math.max(deep, arr[idx[j]]);
      g.beginPath();
      g.moveTo(side * tr.W[e0] / 2, e0 * tr.dh - yoff);
      for (j = 0; j < idx.length; j++) { var i = idx[j]; g.lineTo(side * (tr.W[i] / 2 - arr[i]), i * tr.dh - yoff); }
      g.lineTo(side * tr.W[e1] / 2, e1 * tr.dh - yoff);
      g.closePath();
      var gx = side * (tr.W[e0] / 2 - deep * 0.5);
      var gr = g.createLinearGradient(side * tr.W[e0] / 2, 0, gx - side * deep * 0.5, 0);
      gr.addColorStop(0, "#f0d19a"); gr.addColorStop(0.55, "#d6aa6c"); gr.addColorStop(1, "#8a5f33");
      g.fillStyle = gr; g.fill();
      g.strokeStyle = "rgba(52,30,12,0.75)"; g.lineWidth = 0.028;
      g.beginPath();
      for (j = 0; j < idx.length; j++) { var k = idx[j], xx = side * (tr.W[k] / 2 - arr[k]), yy = k * tr.dh - yoff; if (j === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy); }
      g.stroke();
    }
    function drawTrunkPart(h0, h1, yoff) {
      if (h1 - h0 < 1e-4) return;
      trunkPoly(h0, h1, yoff);
      var gr = g.createLinearGradient(-0.62, 0, 0.62, 0);
      gr.addColorStop(0, "#2c1b0e"); gr.addColorStop(0.22, "#5d3b20"); gr.addColorStop(0.46, "#7f5430");
      gr.addColorStop(0.7, "#5a3a1f"); gr.addColorStop(1, "#27180c");
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      g.lineCap = "round";
      for (var k = 0; k < 7; k++) {
        var f = (k - 3) * 0.13 + 0.02 * k;
        g.strokeStyle = k % 2 ? "rgba(24,14,6,0.34)" : "rgba(176,128,76,0.2)";
        g.lineWidth = 0.022 + (k % 3) * 0.01;
        g.beginPath();
        for (var h = h0; h <= h1 + 0.4; h += 0.4) {
          var e = edgeAt(Math.min(h, HC.TRUNK_H));
          var x = f * e.W + 0.035 * Math.sin(h * 2.3 + k * 1.9), y = Math.min(h, h1) - yoff;
          if (h === h0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      wedges(h0, h1, yoff);
      g.restore();
      trunkPoly(h0, h1, yoff);
      g.strokeStyle = "rgba(20,11,4,0.7)"; g.lineWidth = 0.03; g.stroke();
    }
    /* The splintered hinge where the tree let go; `up` is the stump side. */
    function drawSplinter(up, yoff) {
      var tr = game.trunk, i = tr.sliceAt(game.hStar);
      var xa = -tr.W[i] / 2 + tr.left[i], xb = tr.W[i] / 2 - tr.right[i], n = 8, k;
      var y0 = game.hStar - yoff, sgn = up ? 1 : -1;
      g.beginPath(); g.moveTo(xa, y0);
      for (k = 0; k <= n; k++) {
        var f = k / n, x = lerp(xa, xb, f);
        var jag = 0.12 + 0.34 * Math.abs(Math.sin(k * 2.7 + game.seed)) * (k === 0 || k === n ? 0.5 : 1);
        g.lineTo(x, y0 + sgn * (k % 2 ? jag : jag * 0.35));
      }
      g.lineTo(xb, y0); g.closePath();
      g.fillStyle = "#dcb67a"; g.fill();
      g.strokeStyle = "rgba(70,42,18,0.8)"; g.lineWidth = 0.03; g.stroke();
    }

    function swayX(Y) {
      var f = clamp(Y / (HC.TRUNK_H + 1), 0, 1.2);
      return swayAmp * Math.pow(f, 1.6) * Math.sin(T * 1.5 + Y * 0.35);
    }
    function branchCoords(b, k, yoff) { var p = b.pts[k]; return { x: b.s * p.p, y: b.y + p.q - yoff }; }
    function branchAtArc(b, s) {
      var pts = b.pts;
      for (var k = 0; k < pts.length - 1; k++) {
        if (s <= pts[k + 1].s || k === pts.length - 2) {
          var f = clamp((s - pts[k].s) / (pts[k + 1].s - pts[k].s), 0, 1);
          return { x: b.s * lerp(pts[k].p, pts[k + 1].p, f), y: b.y + lerp(pts[k].q, pts[k + 1].q, f) };
        }
      }
      return { x: 0, y: b.y };
    }
    function drawBranch(b, stub, yoff, swayOn) {
      var pts = b.pts, k, a, c;
      g.lineCap = "round"; g.lineJoin = "round";
      var segs = [];
      for (k = 0; k < pts.length; k++) {
        if (pts[k].s > stub && k > 0) {
          var f = (stub - pts[k - 1].s) / (pts[k].s - pts[k - 1].s);
          var A = branchAtArc(b, stub); segs.push({ x: A.x, y: A.y, s: stub }); break;
        }
        segs.push({ x: b.s * pts[k].p, y: b.y + pts[k].q, s: pts[k].s });
      }
      if (segs.length < 2) return;
      for (var pass = 0; pass < 2; pass++) {
        for (k = 0; k < segs.length - 1; k++) {
          a = segs[k]; c = segs[k + 1];
          var th = L.branchThick(b, (a.s + c.s) / 2);
          g.strokeStyle = pass ? "rgba(150,106,62,0.55)" : "#432b17";
          g.lineWidth = pass ? th * 0.38 : th;
          var ax = a.x + (swayOn ? swayX(a.y) : 0), cx2 = c.x + (swayOn ? swayX(c.y) : 0);
          g.beginPath();
          g.moveTo(ax, a.y - yoff - (pass ? th * 0.14 : 0)); g.lineTo(cx2, c.y - yoff - (pass ? th * 0.14 : 0)); g.stroke();
        }
      }
      // the cut end of a stub shows pale wood
      if (stub < b.len - 0.02) {
        var e = segs[segs.length - 1], th2 = L.branchThick(b, stub);
        g.fillStyle = "#e3c286";
        g.beginPath(); g.arc(e.x + (swayOn ? swayX(e.y) : 0), e.y - yoff, th2 * 0.5, 0, TAU); g.fill();
      }
    }
    function drawLeaves(b, stub, yoff, swayOn) {
      var fr = b.leader ? [1.0, 0.62, 0.3] : b.y > 4.4 ? [1.0, 0.74] : [1.0], i;
      for (i = 0; i < fr.length; i++) {
        var s = b.len * fr[i];
        if (s > stub + 0.02) continue;
        var p = branchAtArc(b, s), size = b.leaf * (b.leader ? 1.4 : 1.05) * (1 - i * 0.22);
        var x = p.x + (swayOn ? swayX(p.y) : 0), y = p.y - yoff;
        g.save(); g.translate(x, y); g.scale(1, -1);
        g.rotate((b.id * 0.9 + i * 1.7) * 0.3 + (swayOn ? Math.sin(T * 1.3 + b.id) * 0.04 : 0));
        var spr = sprites[(b.id + i) % 3];
        g.drawImage(spr, -size, -size, size * 2, size * 2);
        g.restore();
      }
    }
    function limbStub(b) {
      var ls = game.limbs;
      for (var i = 0; i < ls.length; i++) if (ls[i].id === b.id) return ls[i].stub;
      return b.len;
    }
    /* Everything above the break plane, drawn in the frame of a body whose
       break-plane centre is at world (px, py) and which has leaned `ang` rad. */
    function drawUpper(px, py, ang, hStar, withLimbs) {
      var br = game.tree.branches, b, i, swayOn = !ang && game.phase !== "delimb" && game.phase !== "saw" && game.phase !== "done";
      frame(sx(px), sy(py), ang, function () {
        for (i = 0; i < br.length; i++) {
          b = br[i];
          if (b.y < hStar || b.crushed) continue;
          drawBranch(b, withLimbs ? limbStub(b) : b.len, hStar, swayOn);
        }
        drawTrunkPart(hStar, HC.TRUNK_H, hStar);
        if (hStar > 0) drawSplinter(false, hStar);
        for (i = 0; i < br.length; i++) {
          b = br[i];
          if (b.y < hStar || b.crushed) continue;
          drawLeaves(b, withLimbs ? limbStub(b) : b.len, hStar, swayOn);
        }
      });
    }
    function drawStump(hStar) {
      var br = game.tree.branches, b, i;
      frame(sx(0), sy(0), 0, function () {
        for (i = 0; i < br.length; i++) { b = br[i]; if (b.y < hStar) drawBranch(b, b.len, 0, false); }
        drawTrunkPart(0, hStar, 0);
        drawSplinter(true, 0);
        for (i = 0; i < br.length; i++) { b = br[i]; if (b.y < hStar) drawLeaves(b, b.len, 0, false); }
      });
    }
    function drawShadow(x0, x1, y) {
      var cx = sx((x0 + x1) / 2), cy = sy(y), R = Math.max(10, Math.abs(x1 - x0) * cam.s * 0.55);
      g.save(); g.translate(cx, cy); g.scale(1, 0.16);
      var gr = g.createRadialGradient(0, 0, 2, 0, 0, R);
      gr.addColorStop(0, "rgba(8,5,2,0.55)"); gr.addColorStop(1, "rgba(8,5,2,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.restore();
    }
    function drawPieces() {
      var ps = game.pieces;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i], b = p.b, fade = clamp((2.2 - p.age) / 0.6, 0, 1);
        g.save(); g.globalAlpha = fade;
        g.translate(sx(p.ox), sy(p.oy)); g.rotate(-p.rot); g.scale(cam.s, -cam.s);
        g.lineCap = "round";
        var k;
        for (k = 0; k < p.pts.length - 1; k++) {
          g.strokeStyle = "#432b17"; g.lineWidth = L.branchThick(b, (p.pts[k].s + p.pts[k + 1].s) / 2);
          g.beginPath(); g.moveTo(p.pts[k].x, p.pts[k].y); g.lineTo(p.pts[k + 1].x, p.pts[k + 1].y); g.stroke();
        }
        var fr = b.leader ? [1.0, 0.62] : b.y > 4.4 ? [1.0, 0.74] : [1.0];
        for (k = 0; k < fr.length; k++) {
          var s = b.len * fr[k];
          if (s <= p.from) continue;
          var q = branchAtArc(b, s), a0 = branchAtArc(b, p.from);
          var wx = (q.x - a0.x) * (game.dir ? 1 : 1), wy = q.y - a0.y;
          // piece points are stored in world orientation, so place leaves by matching the polyline
          var idx = Math.min(p.pts.length - 1, Math.max(0, Math.round((s - p.from) / (b.len - p.from + 1e-6) * (p.pts.length - 1))));
          var P = p.pts[idx], size = b.leaf * 1.05 * (1 - k * 0.22);
          g.save(); g.translate(P.x, P.y); g.scale(1, -1); g.drawImage(sprites[(b.id + k) % 3], -size, -size, size * 2, size * 2); g.restore();
        }
        g.restore();
      }
    }
    function drawParts(dt) {
      var i, p;
      for (i = parts.length - 1; i >= 0; i--) {
        p = parts[i];
        p.life -= dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        if (p.w) {
          p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          if (p.kind === "leaf") { p.x += Math.sin(T * 3 + p.sway) * 0.35 * dt; p.vx *= 1 - 1.5 * dt; p.vy = Math.max(p.vy, -0.9); }
          if (p.kind === "chip" && p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vr *= 0.5; }
          if (p.kind === "dust") { p.size += dt * 0.9; p.vx *= 1 - 1.8 * dt; }
        } else {
          p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        }
      }
      for (i = 0; i < parts.length; i++) {
        p = parts[i];
        var a = clamp(p.life / (p.max * 0.5), 0, 1);
        var X = p.w ? sx(p.x) : p.x, Y = p.w ? sy(p.y) : p.y, sz = p.w ? p.size * cam.s : p.size;
        if (p.kind === "dust") {
          g.fillStyle = "rgba(150,120,80," + (0.28 * a).toFixed(3) + ")";
          g.beginPath(); g.arc(X, Y, sz, 0, TAU); g.fill();
        } else if (p.kind === "slash") {
          var f = p.life / p.max;
          g.strokeStyle = "rgba(255,244,214," + (0.9 * f).toFixed(3) + ")"; g.lineWidth = 3 * f + 1;
          g.beginPath(); g.arc(X, Y, sz * (1.2 - f), 0, TAU); g.stroke();
        } else {
          g.save(); g.translate(X, Y); g.rotate(p.rot);
          g.fillStyle = p.kind === "leaf" ? (i % 2 ? "rgba(112,158,66," : "rgba(76,124,52,") + a.toFixed(3) + ")"
            : p.kind === "sawdust" ? "rgba(232,198,140," + a.toFixed(3) + ")" : "rgba(226,190,128," + a.toFixed(3) + ")";
          if (p.kind === "leaf") { g.beginPath(); g.ellipse(0, 0, sz, sz * 0.5, 0, 0, TAU); g.fill(); }
          else g.fillRect(-sz, -sz * 0.45, sz * 2, sz * 0.9);
          g.restore();
        }
      }
    }
    function drawTrail() {
      var i, n = trail.length;
      while (n && T - trail[0].t > 0.28) { trail.shift(); n--; }
      if (n < 2 || game.phase === "saw") return;
      g.lineCap = "round"; g.lineJoin = "round";
      for (i = 1; i < n; i++) {
        var age = (T - trail[i].t) / 0.28, a = clamp(1 - age, 0, 1);
        g.strokeStyle = "rgba(255,238,200," + (0.55 * a).toFixed(3) + ")";
        g.lineWidth = 2 + 4 * a * (i / n);
        g.beginPath(); g.moveTo(trail[i - 1].x, trail[i - 1].y); g.lineTo(trail[i].x, trail[i].y); g.stroke();
      }
    }

    /* ============ drawing: top-down saw ============ */
    function pieceBounds() {
      var ks = game.saw ? game.saw.kerfs.filter(function (k) { return k.done; }).sort(function (a, b) { return a.u - b.u; }) : [];
      var bounds = [0], i;
      for (i = 0; i < ks.length; i++) bounds.push(ks[i].u);
      bounds.push(game.log.len);
      return { bounds: bounds, n: ks.length };
    }
    function drawSaw(alpha) {
      if (!saw || !game.log) return;
      var lg = game.log, Lg = lg.len;
      g.save(); g.globalAlpha = alpha;
      // bench
      var bg = g.createLinearGradient(0, 0, 0, Hh);
      bg.addColorStop(0, "#2a1d12"); bg.addColorStop(1, "#1a120a");
      g.fillStyle = bg; g.fillRect(0, 0, W, Hh);
      g.strokeStyle = "rgba(0,0,0,0.28)"; g.lineWidth = 2;
      for (var pl = 0; pl < 9; pl++) { g.beginPath(); g.moveTo(0, Hh * pl / 8); g.lineTo(W, Hh * pl / 8); g.stroke(); }
      // two supports under the log
      g.fillStyle = "#3a2a1a";
      var sup = [saw.x0 + saw.len * 0.08, saw.x0 + saw.len * 0.92];
      for (var s = 0; s < 2; s++) g.fillRect(sup[s] - 10, saw.cy - saw.ty * 0.95, 20, saw.ty * 1.9);
      // zones where a cut will not start
      var pb = pieceBounds(), i, k;
      // pieces
      var bh = pb.bounds;
      for (i = 0; i < bh.length - 1; i++) {
        var shift = 0, ks = game.saw.kerfs.filter(function (q) { return q.done; }).sort(function (a, b) { return a.u - b.u; });
        for (k = 0; k < ks.length; k++) {
          var gap = Math.min(1, ks[k].gap) * 9;
          shift += (i > k ? gap / 2 : -gap / 2);
        }
        var fade = 1, rise = 0;
        if (handoff >= 0) {
          var h = smooth(handoff / 0.9), mid = (i === 1);
          if (!mid) { fade = 1 - h; shift += (i === 0 ? -1 : 1) * h * 60; } else { rise = h; }
        }
        drawLogPiece(bh[i], bh[i + 1], shift, fade, rise);
      }
      // where a cut will not start: near the ends, and near a cut already made
      var zones = [[0, HC.SAW_END_MARGIN * Lg], [(1 - HC.SAW_END_MARGIN) * Lg, Lg]], kd = game.saw.kerfs;
      for (k = 0; k < kd.length; k++) if (kd[k].done) zones.push([Math.max(0, kd[k].u - HC.SAW_MIN_BLANK * Lg), Math.min(Lg, kd[k].u + HC.SAW_MIN_BLANK * Lg)]);
      if (handoff < 0) {
        g.save();
        for (k = 0; k < zones.length; k++) {
          var za = zones[k][0], zb = zones[k][1], zx0 = saw.x0 + za * saw.scale, zx1 = saw.x0 + zb * saw.scale;
          var zr = lg.radiusAt((za + zb) / 2) * saw.ty;
          g.beginPath(); g.rect(zx0, saw.cy - zr * 1.05, zx1 - zx0, zr * 2.1); g.clip();
          g.fillStyle = "rgba(10,6,2,0.34)"; g.fillRect(zx0, saw.cy - zr * 1.05, zx1 - zx0, zr * 2.1);
          g.strokeStyle = "rgba(232,163,61,0.16)"; g.lineWidth = 1;
          for (var hx = zx0 - zr * 2; hx < zx1 + zr * 2; hx += 11) { g.beginPath(); g.moveTo(hx, saw.cy + zr * 1.05); g.lineTo(hx + zr * 2.1, saw.cy - zr * 1.05); g.stroke(); }
          g.restore(); g.save();
        }
        g.restore();
      }
      // kerfs in progress
      var kz = game.saw.kerfs;
      for (k = 0; k < kz.length; k++) {
        var kk = kz[k], x = saw.x0 + kk.u * saw.scale;
        if (kk.done) continue;
        var r = lg.radiusAt(kk.u) * saw.ty;
        var wdt = 2 + 7 * kk.shown;
        g.fillStyle = "rgba(12,7,3," + (0.35 + 0.6 * kk.shown).toFixed(2) + ")";
        g.fillRect(x - wdt / 2, saw.cy - r, wdt, r * 2);
        g.fillStyle = "rgba(232,198,140,0.55)";
        g.fillRect(x - wdt / 2 - 1, saw.cy - r, 1, r * 2); g.fillRect(x + wdt / 2, saw.cy - r, 1, r * 2);
        // a depth gauge on the kerf: how far through
        g.fillStyle = "rgba(232,163,61,0.9)";
        g.fillRect(x - 3, saw.cy + r + 8, 6, 3);
        g.fillStyle = "rgba(20,15,11,0.7)"; g.fillRect(x - 24, saw.cy + r + 14, 48, 5);
        g.fillStyle = "#e8a33d"; g.fillRect(x - 24, saw.cy + r + 14, 48 * kk.shown, 5);
      }
      // the saw itself
      if (pointer.active && game.saw && game.saw.active && !game.saw.active.done) drawSawTool(game.saw.active);
      g.restore();
    }
    function drawLogPiece(u0, u1, shift, fade, rise) {
      var lg = game.log, steps = Math.max(6, Math.round((u1 - u0) / game.log.len * 60)), i;
      var cy = saw.cy - rise * 0, lift = rise * 10;
      g.save(); g.globalAlpha *= fade;
      g.beginPath();
      for (i = 0; i <= steps; i++) {
        var u = lerp(u0, u1, i / steps), r = lg.radiusAt(u) * saw.ty * (1 + rise * 0.06);
        var x = saw.x0 + u * saw.scale + shift;
        if (i === 0) g.moveTo(x, cy - r); else g.lineTo(x, cy - r);
      }
      for (i = steps; i >= 0; i--) {
        var u2 = lerp(u0, u1, i / steps), r2 = lg.radiusAt(u2) * saw.ty * (1 + rise * 0.06);
        g.lineTo(saw.x0 + u2 * saw.scale + shift, cy + r2);
      }
      g.closePath();
      if (rise > 0) { g.shadowColor = "rgba(232,163,61,0.8)"; g.shadowBlur = 24 * rise; }
      var gr = g.createLinearGradient(0, cy - saw.ty * 0.5, 0, cy + saw.ty * 0.5);
      gr.addColorStop(0, "#3a2414"); gr.addColorStop(0.22, "#6a4326"); gr.addColorStop(0.5, "#8b5d34");
      gr.addColorStop(0.78, "#5f3d22"); gr.addColorStop(1, "#2f1d0f");
      g.fillStyle = gr; g.fill();
      g.shadowBlur = 0;
      g.save(); g.clip();
      g.lineCap = "round";
      for (var k = 0; k < 8; k++) {
        var f = (k - 3.5) * 0.24;
        g.strokeStyle = k % 2 ? "rgba(20,11,4,0.32)" : "rgba(180,132,80,0.22)"; g.lineWidth = 1.2 + (k % 3) * 0.6;
        g.beginPath();
        for (i = 0; i <= steps; i++) {
          var uu = lerp(u0, u1, i / steps), rr = lg.radiusAt(uu) * saw.ty;
          var px = saw.x0 + uu * saw.scale + shift, py = cy + f * rr * 1.15 + Math.sin(uu * 2.1 + k) * 1.6;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      }
      // the stubs where limbs were: small knots
      var br = lg.tree.branches;
      for (k = 0; k < br.length; k++) {
        var b = br[k];
        if (b.leader || b.y < lg.hStar || b.crushed) continue;
        var ub = b.y - lg.hStar;
        if (ub < u0 || ub > u1) continue;
        var vy = (b.id % 2 ? -1 : 1) * lg.radiusAt(ub) * saw.ty * 0.45;
        g.strokeStyle = "rgba(40,22,8,0.55)"; g.lineWidth = 1.4;
        g.beginPath(); g.ellipse(saw.x0 + ub * saw.scale + shift, cy + vy, 6, 3.4, 0, 0, TAU); g.stroke();
      }
      g.restore();
      g.strokeStyle = "rgba(14,7,2,0.8)"; g.lineWidth = 1.5; g.stroke();
      // shine on the top
      g.restore();
    }
    function drawSawTool(kerf) {
      var x = saw.x0 + kerf.u * saw.scale, y = pointer.y, r = game.log.radiusAt(kerf.u) * saw.ty;
      var bladeLen = r * 2.5, dir = y > saw.cy ? -1 : 1;
      g.save();
      g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 8;
      var by0 = y, by1 = y + dir * bladeLen;
      var gr = g.createLinearGradient(x - 6, 0, x + 6, 0);
      gr.addColorStop(0, "#9aa4a9"); gr.addColorStop(0.5, "#e6edf0"); gr.addColorStop(1, "#8a9499");
      g.fillStyle = gr; g.fillRect(x - 5, Math.min(by0, by1), 10, Math.abs(by1 - by0));
      g.shadowBlur = 0;
      g.strokeStyle = "rgba(60,70,75,0.85)"; g.lineWidth = 1;
      for (var t = 0; t < Math.abs(by1 - by0); t += 5) { g.beginPath(); g.moveTo(x + 5, Math.min(by0, by1) + t); g.lineTo(x + 8, Math.min(by0, by1) + t + 2.5); g.stroke(); }
      // handle at the finger
      g.fillStyle = "#7c4a22"; g.strokeStyle = "#3d2411"; g.lineWidth = 1.5;
      g.beginPath(); g.roundRect ? g.roundRect(x - 13, y - 17, 26, 34, 8) : g.rect(x - 13, y - 17, 26, 34); g.fill(); g.stroke();
      g.fillStyle = "rgba(255,230,190,0.18)"; g.fillRect(x - 9, y - 12, 4, 24);
      g.restore();
    }

    /* ============ the frame ============ */
    function update(dt) {
      T += dt;
      // The page shell can change the stage's size after we measured it (fonts
      // loading, a tab bar wrapping, the phone turning): keep the canvas and the
      // input mapping in step with what is really on screen.
      if ((stage.clientWidth || 300) !== W || (stage.clientHeight || 300) !== Hh) resize();
      game.step(dt);
      handleEvents();
      shake = Math.max(0, shake - dt * 3.2);
      swayAmp += ((game.phase === "chop" ? 0.04 + 0.22 * game.shudder + 0.5 * game.trunk.progress() * game.trunk.progress() * 0.5
        : game.phase === "crack" ? 0.35 : 0) - swayAmp) * Math.min(1, dt * 6);
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove("on"); }
      // wood giving way: creaks as the hinge gets thin
      if (game.phase === "chop") {
        var pr = game.trunk.progress();
        creakT -= dt;
        if (pr > 0.62 && creakT <= 0) { audio.creak(); creakT = 1.4 - pr * 0.8 + Math.random() * 0.4; shake = Math.min(1, shake + 0.08); }
      }
      // camera
      if (game.phase === "fall" && camStart && camEnd) {
        var F = game.fall, p = smooth((game.fallT - 0.15) / Math.max(0.5, F.duration * 0.95));
        cam = { x: lerp(camStart.x, camEnd.x, p), y: lerp(camStart.y, camEnd.y, p), s: Math.exp(lerp(Math.log(camStart.s), Math.log(camEnd.s), p)) };
      }
      if (game.phase === "saw" || game.phase === "done") sawBlend = Math.min(1, sawBlend + dt / 0.55);
      if (handoff >= 0) {
        handoff += dt;
        if (handoff > 1.35) { handoff = -1; if (opts.onBlank) opts.onBlank(game.blank); }
      }
      if (game.phase === "saw") audio.saw(clamp(sawSpeed, 0, 1) * (pointer.active && game.saw && game.saw.active ? 1 : 0));
      else audio.saw(0);
      uiT += dt;
      if (uiT > 0.1) { uiT = 0; updateHud(); }
    }

    function render(dt) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      var shx = 0, shy = 0;
      if (shake > 0) { shx = (Math.random() - 0.5) * 7 * shake; shy = (Math.random() - 0.5) * 7 * shake; }
      g.translate(shx, shy);
      g.fillStyle = "#120d09"; g.fillRect(-10, -10, W + 20, Hh + 20);
      var groundPy = sy(0);
      if (sawBlend < 1 || game.phase !== "saw" && game.phase !== "done") {
        drawSky(groundPy); drawGround(groundPy);
        var ph = game.phase;
        if (ph === "chop") {
          drawShadow(-1, 1, 0.05);
          drawUpper(0, 0, 0, 0, false);
        } else if (ph === "crack") {
          drawStump(game.hStar);
          drawUpper(0, game.hStar, game.dir * game.crackLean + (Math.random() - 0.5) * 0.004 * shake, game.hStar, false);
        } else if (ph === "fall") {
          drawStump(game.hStar);
          var b = game.body;
          if (b) { drawShadow(b.bx, b.bx + b.dir * 4, 0.05); drawUpper(b.bx, b.by, b.dir * b.phi, game.hStar, false); }
        } else {
          drawStump(game.hStar);
          var lg = game.log;
          drawShadow(lg.bx, lg.bx + lg.dir * lg.len, 0.05);
          drawUpper(lg.bx, lg.by, lg.dir * Math.PI / 2, game.hStar, true);
          drawPieces();
        }
        drawParts(dt);
        drawTrail();
      }
      if (game.phase === "saw" || game.phase === "done") {
        if (sawBlend < 1) { g.save(); drawSaw(smooth(sawBlend)); g.restore(); }
        else drawSaw(1);
        // particles in screen space ride on top
        drawParts(dt);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    var last = 0;
    function loop(ts) {
      if (!running) return;
      root.requestAnimationFrame(loop);
      var dt = Math.min(0.05, Math.max(0, (ts - last) / 1000)); last = ts;
      try { update(dt); render(dt); }
      catch (err) { var eb = document.getElementById("err"); if (eb) { eb.style.display = "block"; eb.textContent = "Error: " + (err && err.message ? err.message : err); } }
    }

    function begin() {
      setHint("<b>Swipe into the trunk from the side.</b> Cuts land where your finger is.<br />Quick swipes bite. Keep chopping until it cracks.");
      toastEl.classList.remove("on"); toastT = 0;
      parts.length = 0; trail.length = 0; sawBlend = 0; handoff = -1; swayAmp = 0.05; shake = 0;
      cam = camChop(); camStart = camEnd = null; layoutSaw(); updateHud();
    }
    function reset() { game.reset(); begin(); }
    function show() {
      if (game.phase === "done") reset();         // that harvest went to the lathe; start a fresh tree
      resize();
      if (!running) { running = true; last = performance.now(); root.requestAnimationFrame(loop); }
    }
    function hide() { running = false; audio.saw(0); pointer.active = false; pointer.id = null; }
    root.addEventListener("resize", function () { if (running) resize(); });
    document.getElementById("hSoundBtn").addEventListener("click", function () { audio.toggle(); });
    document.getElementById("hNewTreeBtn").addEventListener("click", reset);
    begin();

    return { show: show, hide: hide, reset: reset, resize: resize, game: game, get cam() { return cam; }, get saw() { return saw; },
      get running() { return running; }, update: update, render: render };
  }

  L.createHarvest = createHarvest;

  /* The page shell (farm-ui.js) shows and hides the harvest screen through
     this host. The view is built the first time the screen is opened, when
     its stage has a size, and a finished blank goes to the lathe. */
  var view = null;
  L.harvestHost = {
    show: function () {
      if (!view) {
        view = createHarvest({ onBlank: function (blank) { L.mountBlank(blank); root.Game.showScreen("lathe"); } });
        root.__harvest = view;
      }
      view.show();
    },
    hide: function () { if (view) view.hide(); }
  };
})(window);

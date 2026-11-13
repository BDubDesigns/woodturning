/* ============================================================
   The mine scene (Canvas2D only, so every webview can paint it).

   A timbered mine shaft lit by a lantern, and in the middle a
   lump of rock with diamonds showing through. Swipe a pick across
   it: each strike knocks chunks and dust off, sparks fly, and a
   crack opens where it hit while the old ones creep further. When
   the vein gives, it bursts apart and the diamonds tumble out and
   fly up to the wallet.

   The vein model (vein.js) owns every rule. This file draws it and
   adds the juice. It never pays anything: on the break it calls
   `opts.onBroken()`, and the host (monetize-ui.js) decides what
   that is worth through one function.
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, V = G.Vein, TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); }
  function easeIn(t) { t = clamp(t, 0, 1); return t * t; }

  var ROCK = ["#6d6573", "#5d5663", "#4b4552", "#7a7280", "#544d5a"];
  var CHUNK = ["#5e5764", "#4a4450", "#706876", "#3d3843", "#837b88"];

  function createScene(opts) {
    var stage = opts.stage, canvas = opts.canvas, g = canvas.getContext("2d");
    var audio = (root.Lathe && root.Lathe.audio) || null;
    var onBroken = opts.onBroken || function () {};
    var onStrike = opts.onStrike || function () {};

    var W = 300, Hh = 300, dpr = 1, s = 80, cx = 150, cy = 150, floorY = 240;
    var bg = null, rockImg = null, rockBare = null, rockR = 0;
    var vein = null, running = false, raf = 0, lastT = 0, T = 0;
    var parts = [], shards = [], loose = [], trail = [];
    var shake = 0, flash = 0, kick = { x: 0, y: 0, vx: 0, vy: 0 }, brokeAt = -1;
    var pointer = { active: false, id: null, x: 0, y: 0, ang: -0.6 };
    var finished = false, frames = 0, fps = 0, fpsT = -1;

    /* ============ layout ============ */
    function layout() {
      W = stage.clientWidth || 300; Hh = stage.clientHeight || 300;
      dpr = Math.min(root.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
      floorY = Hh * 0.8;
      s = Math.max(40, Math.min(W * 0.3, Hh * 0.3));
      cx = W / 2; cy = floorY - 0.88 * s;
      bakeBackground();
      if (vein) bakeRock();
    }
    function px(x) { return cx + x * s; }
    function py(y) { return cy - y * s; }
    function toVein(e) {
      var r = stage.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
      return { X: X, Y: Y, x: (X - cx) / s, y: (cy - Y) / s };
    }

    /* Soft round sprites, made once: cheaper than a gradient per particle per frame. */
    function softSprite(rgb) {
      var c = document.createElement("canvas"); c.width = c.height = 64;
      var cg = c.getContext("2d"), gr = cg.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(" + rgb + ",1)"); gr.addColorStop(0.45, "rgba(" + rgb + ",0.35)"); gr.addColorStop(1, "rgba(" + rgb + ",0)");
      cg.fillStyle = gr; cg.fillRect(0, 0, 64, 64);
      return c;
    }
    var GLOW = softSprite("140,230,250"), DUST = softSprite("150,138,150"), WARM = softSprite("255,180,100");
    function sprite(img, x, y, r, a) { if (a <= 0) return; g.globalAlpha = Math.min(1, a); g.drawImage(img, x - r, y - r, r * 2, r * 2); g.globalAlpha = 1; }

    function offscreen(w, h) {
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      var cg = c.getContext("2d"); cg.scale(dpr, dpr);
      return { c: c, g: cg };
    }

    /* ============ the shaft: baked once per size ============ */
    function bakeBackground() {
      var o = offscreen(W, Hh), b = o.g, rng = V.mkRng(7), i;
      var gr = b.createLinearGradient(0, 0, 0, Hh);
      gr.addColorStop(0, "#211c26"); gr.addColorStop(0.6, "#17131b"); gr.addColorStop(1, "#0c0a0e");
      b.fillStyle = gr; b.fillRect(0, 0, W, Hh);

      // the rock face: overlapping lumps, then a few strata lines
      for (i = 0; i < 160; i++) {
        var x = rng() * W, y = rng() * floorY, r = 12 + rng() * 46, l = rng();
        b.fillStyle = "rgba(" + Math.round(70 + l * 40) + "," + Math.round(60 + l * 32) + "," + Math.round(72 + l * 36) + "," + (0.07 + rng() * 0.09) + ")";
        b.beginPath(); b.ellipse(x, y, r * (1 + rng() * 0.8), r, rng() * Math.PI, 0, TAU); b.fill();
      }
      b.strokeStyle = "rgba(0,0,0,0.22)"; b.lineWidth = 1.4;
      for (i = 0; i < 7; i++) {
        var y0 = (i + 0.5) / 7 * floorY;
        b.beginPath(); b.moveTo(0, y0);
        for (var xx = 0; xx <= W; xx += 24) b.lineTo(xx, y0 + Math.sin(xx * 0.013 + i) * 9 + (rng() - 0.5) * 6);
        b.stroke();
      }
      // a few faint crystals glinting in the far wall
      for (i = 0; i < 14; i++) {
        var gx = rng() * W, gy = rng() * floorY * 0.85, gs = 1.5 + rng() * 2;
        b.fillStyle = "rgba(140,220,240," + (0.12 + rng() * 0.2) + ")";
        b.beginPath(); b.moveTo(gx, gy - gs * 1.6); b.lineTo(gx + gs, gy); b.lineTo(gx, gy + gs * 1.6); b.lineTo(gx - gs, gy); b.closePath(); b.fill();
      }

      // the floor: packed dirt and rubble
      var fg = b.createLinearGradient(0, floorY - 10, 0, Hh);
      fg.addColorStop(0, "#2a2320"); fg.addColorStop(0.3, "#221c19"); fg.addColorStop(1, "#110d0b");
      b.fillStyle = fg;
      b.beginPath(); b.moveTo(0, floorY + 6);
      for (var fx = 0; fx <= W; fx += 20) b.lineTo(fx, floorY + Math.sin(fx * 0.05) * 3 + (rng() - 0.5) * 4);
      b.lineTo(W, Hh); b.lineTo(0, Hh); b.closePath(); b.fill();
      for (i = 0; i < 70; i++) {
        var rx = rng() * W, ry = floorY + 4 + rng() * (Hh - floorY), rr = 1.5 + rng() * 5 * (ry - floorY + 20) / (Hh - floorY + 20);
        b.fillStyle = CHUNK[Math.floor(rng() * CHUNK.length)];
        b.globalAlpha = 0.55 + rng() * 0.3;
        b.beginPath(); b.ellipse(rx, ry, rr * 1.4, rr, rng(), 0, TAU); b.fill();
      }
      b.globalAlpha = 1;
      // rail tracks running into the dark
      b.strokeStyle = "rgba(120,110,100,0.35)"; b.lineWidth = 2;
      b.beginPath(); b.moveTo(W * 0.5 - 6, floorY + 2); b.lineTo(W * 0.5 - W * 0.32, Hh); b.moveTo(W * 0.5 + 6, floorY + 2); b.lineTo(W * 0.5 + W * 0.32, Hh); b.stroke();
      b.strokeStyle = "rgba(90,64,40,0.45)"; b.lineWidth = 3;
      for (i = 1; i < 6; i++) {
        var t = i / 6, ty = lerp(floorY + 2, Hh, t * t), half = lerp(10, W * 0.36, t * t);
        b.beginPath(); b.moveTo(W / 2 - half, ty); b.lineTo(W / 2 + half, ty); b.stroke();
      }

      // timber supports: two posts and a cap beam (wood, of course)
      var postW = Math.max(16, W * 0.06), capH = Math.max(14, Hh * 0.045), capY = Hh * 0.06;
      function timber(x, y, w, h, vertical) {
        var tg = vertical ? b.createLinearGradient(x, 0, x + w, 0) : b.createLinearGradient(0, y, 0, y + h);
        tg.addColorStop(0, "#4a3220"); tg.addColorStop(0.45, "#6b4a2e"); tg.addColorStop(1, "#38261a");
        b.fillStyle = tg; b.fillRect(x, y, w, h);
        b.strokeStyle = "rgba(30,18,10,0.55)"; b.lineWidth = 1;
        for (var k = 0; k < 5; k++) {
          b.beginPath();
          if (vertical) { var gx2 = x + w * (0.15 + k * 0.17); b.moveTo(gx2, y); b.bezierCurveTo(gx2 + 2, y + h * 0.3, gx2 - 2, y + h * 0.7, gx2 + 1, y + h); }
          else { var gy2 = y + h * (0.2 + k * 0.15); b.moveTo(x, gy2); b.bezierCurveTo(x + w * 0.3, gy2 + 1.5, x + w * 0.7, gy2 - 1.5, x + w, gy2); }
          b.stroke();
        }
        b.strokeStyle = "rgba(0,0,0,0.5)"; b.lineWidth = 1.5; b.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
      timber(W * 0.035, capY, postW, floorY - capY + 8, true);
      timber(W * 0.965 - postW, capY, postW, floorY - capY + 8, true);
      timber(0, capY - capH * 0.4, W, capH, false);
      // iron bolts on the joints
      b.fillStyle = "#2c2a2a";
      [[W * 0.035 + postW / 2, capY + capH * 0.25], [W * 0.965 - postW / 2, capY + capH * 0.25]].forEach(function (p) {
        b.beginPath(); b.arc(p[0], p[1], 3, 0, TAU); b.fill();
      });

      // vignette
      var vg = b.createRadialGradient(W / 2, Hh * 0.55, Math.min(W, Hh) * 0.25, W / 2, Hh * 0.55, Math.max(W, Hh) * 0.8);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.6)");
      b.fillStyle = vg; b.fillRect(0, 0, W, Hh);
      bg = o.c;
    }

    function outlinePath(c, pts, ox, oy, k) {
      var n = pts.length;
      c.beginPath();
      for (var i = 0; i <= n; i++) {
        var a = pts[i % n], b2 = pts[(i + 1) % n];
        var mx = ox + (a[0] + b2[0]) / 2 * k, my = oy - (a[1] + b2[1]) / 2 * k;
        if (i === 0) c.moveTo(mx, my); else c.quadraticCurveTo(ox + a[0] * k, oy - a[1] * k, mx, my);
      }
      c.closePath();
    }

    function crystalPath(c, x, y, r, rot) {
      c.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = rot + i / 6 * TAU, rr = r * (i % 2 ? 0.72 : 1);
        if (i === 0) c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      c.closePath();
    }
    function drawCrystal(c, x, y, r, rot) {
      var cg = c.createLinearGradient(x - r, y - r, x + r, y + r);
      cg.addColorStop(0, "#e9fbff"); cg.addColorStop(0.35, "#8fe3f2"); cg.addColorStop(0.7, "#3fb3cc"); cg.addColorStop(1, "#1f6f84");
      crystalPath(c, x, y, r, rot);
      c.fillStyle = cg; c.fill();
      c.strokeStyle = "rgba(20,70,90,0.85)"; c.lineWidth = Math.max(1, r * 0.08); c.stroke();
      // facets
      c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = Math.max(0.8, r * 0.05);
      c.beginPath();
      for (var i = 0; i < 6; i += 2) {
        var a = rot + i / 6 * TAU;
        c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); c.lineTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3);
      }
      c.stroke();
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath(); c.ellipse(x - r * 0.32, y - r * 0.34, r * 0.2, r * 0.1, -0.7, 0, TAU); c.fill();
    }

    /* ============ the vein rock: baked per vein and size ============ */
    function bakeRock() {
      rockImg = bakeRockImage(true);
      rockBare = bakeRockImage(false);   // for the pieces after the break: the diamonds have fallen out
    }
    function bakeRockImage(withCrystals) {
      rockR = s * 1.35;
      var o = offscreen(rockR * 2, rockR * 2), b = o.g, ox = rockR, oy = rockR, rng = V.mkRng(vein.seed + 11), i;
      outlinePath(b, vein.outline, ox, oy, s);
      var rg = b.createRadialGradient(ox - s * 0.35, oy - s * 0.4, s * 0.1, ox, oy, s * 1.15);
      rg.addColorStop(0, "#8d8593"); rg.addColorStop(0.55, "#5f5866"); rg.addColorStop(1, "#332e38");
      b.fillStyle = rg; b.fill();
      b.save(); b.clip();
      // facets: angular patches of lighter and darker stone
      for (i = 0; i < 70; i++) {
        var fx = ox + (rng() * 2 - 1) * s * 1.2, fy = oy + (rng() * 2 - 1) * s, fr = s * (0.08 + rng() * 0.22), n = 3 + Math.floor(rng() * 3);
        b.beginPath();
        for (var k = 0; k < n; k++) {
          var a = k / n * TAU + rng() * 0.8;
          var xx = fx + Math.cos(a) * fr, yy = fy + Math.sin(a) * fr;
          if (k === 0) b.moveTo(xx, yy); else b.lineTo(xx, yy);
        }
        b.closePath();
        var lit = fy < oy ? 0.6 : 0.3;
        b.fillStyle = rng() < lit ? "rgba(200,190,210," + (0.05 + rng() * 0.08) + ")" : "rgba(10,6,14," + (0.08 + rng() * 0.12) + ")";
        b.fill();
      }
      // speckle
      for (i = 0; i < 260; i++) {
        b.fillStyle = rng() < 0.5 ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.18)";
        b.fillRect(ox + (rng() * 2 - 1) * s * 1.2, oy + (rng() * 2 - 1) * s, 1 + rng() * 1.5, 1 + rng() * 1.5);
      }
      // quartz seams: the vein itself, pale blue threads running through
      b.lineCap = "round";
      for (i = 0; i < 5; i++) {
        var y0 = (rng() - 0.5) * 1.2, a0 = (rng() - 0.5) * 0.9;
        b.strokeStyle = "rgba(150,220,235," + (0.16 + rng() * 0.14) + ")"; b.lineWidth = 1.5 + rng() * 3;
        b.beginPath();
        for (var t = -1.3; t <= 1.3; t += 0.1) {
          var vx = ox + t * s, vy = oy - (y0 + t * Math.tan(a0) * 0.5 + Math.sin(t * 3 + i) * 0.06) * s;
          if (t === -1.3) b.moveTo(vx, vy); else b.lineTo(vx, vy);
        }
        b.stroke();
      }
      // the diamonds showing through, each in a dark socket
      vein.crystals.forEach(function (c) {
        var x = ox + c.x * s, y = oy - c.y * s, r = c.size * s;
        b.fillStyle = "rgba(10,6,14,0.55)";
        b.beginPath(); b.ellipse(x + r * 0.1, y + r * 0.15, r * 1.35, r * 1.15, c.rot, 0, TAU); b.fill();
        if (!withCrystals) return;
        drawCrystal(b, x, y, r, c.rot);
        // little satellite shards
        for (var q = 0; q < 2; q++) {
          var a = c.rot + q * 2.4 + 0.8;
          drawCrystal(b, x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.05, r * 0.42, c.rot + q);
        }
      });
      // light from the lantern, top left, and shade underneath
      var sh = b.createLinearGradient(ox - s, oy - s, ox + s * 0.6, oy + s);
      sh.addColorStop(0, "rgba(255,210,150,0.16)"); sh.addColorStop(0.5, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,0.42)");
      b.fillStyle = sh; b.fillRect(0, 0, rockR * 2, rockR * 2);
      b.restore();
      // rim: a lit edge on top, a dark one below
      outlinePath(b, vein.outline, ox, oy, s);
      b.lineWidth = Math.max(1.5, s * 0.025); b.strokeStyle = "rgba(20,14,24,0.9)"; b.stroke();
      b.save(); b.clip();
      outlinePath(b, vein.outline, ox + s * 0.025, oy + s * 0.03, s);
      b.lineWidth = Math.max(2, s * 0.05); b.strokeStyle = "rgba(255,230,200,0.14)"; b.stroke();
      b.restore();
      return o.c;
    }

    /* ============ particles ============ */
    function addPart(p) { if (parts.length > 500) parts.shift(); parts.push(p); return p; }
    function chunk(x, y, vx, vy, size) {
      var n = 4 + Math.floor(Math.random() * 3), pts = [];
      for (var k = 0; k < n; k++) { var a = k / n * TAU + rand(-0.3, 0.3); pts.push([Math.cos(a) * rand(0.55, 1), Math.sin(a) * rand(0.55, 1)]); }
      addPart({ kind: "chunk", x: x, y: y, vx: vx, vy: vy, r: size, rot: rand(0, TAU), vr: rand(-12, 12), pts: pts,
        col: CHUNK[Math.floor(Math.random() * CHUNK.length)], life: rand(1.6, 2.6), age: 0, bounced: 0 });
    }
    function dust(x, y, vx, vy, r) {
      addPart({ kind: "dust", x: x, y: y, vx: vx, vy: vy, r: r, grow: rand(18, 40), life: rand(0.6, 1.2), age: 0, a: rand(0.18, 0.32) });
    }
    function spark(x, y, vx, vy, blue) {
      addPart({ kind: "spark", x: x, y: y, vx: vx, vy: vy, life: rand(0.18, 0.4), age: 0, blue: blue });
    }

    function burstAt(ev) {
      var X = px(ev.x), Y = py(ev.y), p = ev.power, i;
      // chunks spray back out of the face, against the swipe, and upward
      var nx = -ev.dx, ny = ev.dy;                 // screen-space reverse of the swipe (y flipped)
      var count = Math.round(5 + p * 9);
      for (i = 0; i < count; i++) {
        var a = Math.atan2(ny, nx) + rand(-1.1, 1.1), sp = rand(120, 300) * (0.6 + p * 0.7);
        chunk(X, Y, Math.cos(a) * sp + ev.dx * 60, Math.sin(a) * sp - rand(80, 220), rand(2.5, 6) * (s / 90) * (0.8 + p * 0.6));
      }
      for (i = 0; i < 5 + p * 4; i++) dust(X + rand(-6, 6), Y + rand(-6, 6), rand(-40, 40) + ev.dx * 40, rand(-60, -10), rand(4, 9));
      for (i = 0; i < 6 + p * 8; i++) {
        var sa = rand(0, TAU), ss = rand(250, 620);
        spark(X, Y, Math.cos(sa) * ss, Math.sin(sa) * ss, Math.random() < 0.3);
      }
      shake = Math.min(1, shake + 0.35 + p * 0.4);
      kick.vx += ev.dx * (60 + p * 120); kick.vy -= ev.dy * (60 + p * 120);
    }

    function shatter() {
      // the rock splits along a jittered grid, each piece cut from its own picture
      var COLS = 5, ROWS = 4, gx0 = -1.25, gy0 = -1.05, cw = 2.5 / COLS, ch = 2.1 / ROWS, grid = [], i, j;
      for (j = 0; j <= ROWS; j++) {
        grid.push([]);
        for (i = 0; i <= COLS; i++) {
          var edge = i === 0 || j === 0 || i === COLS || j === ROWS;
          grid[j].push([gx0 + i * cw + (edge ? 0 : rand(-0.35, 0.35) * cw), gy0 + j * ch + (edge ? 0 : rand(-0.35, 0.35) * ch)]);
        }
      }
      for (j = 0; j < ROWS; j++) for (i = 0; i < COLS; i++) {
        var quad = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
        var gx = 0, gy = 0, anyIn = false;
        quad.forEach(function (q) { gx += q[0] / 4; gy += q[1] / 4; if (vein.inside(q[0], q[1])) anyIn = true; });
        if (!anyIn && !vein.inside(gx, gy)) continue;
        var d = Math.sqrt(gx * gx + gy * gy) || 0.1, sp = rand(240, 480);
        shards.push({
          tri: quad.map(function (q) { return [q[0] - gx, q[1] - gy]; }), gx: gx, gy: gy,
          x: px(gx), y: py(gy), vx: gx / d * sp + rand(-60, 60), vy: -gy / d * sp * 0.5 - rand(260, 460),
          rot: 0, vr: rand(-6, 6), age: 0, life: rand(1.5, 2.2)
        });
      }
      for (i = 0; i < 60; i++) {
        var aa = rand(0, TAU), r0 = rand(0, 0.8);
        chunk(px(Math.cos(aa) * r0), py(Math.sin(aa) * r0 * 0.8), Math.cos(aa) * rand(150, 480), -Math.sin(aa) * rand(150, 380) - rand(100, 300), rand(3, 9) * (s / 90));
      }
      for (i = 0; i < 26; i++) dust(px(rand(-1, 1)), py(rand(-0.8, 0.6)), rand(-90, 90), rand(-90, -10), rand(10, 22));
      for (i = 0; i < 40; i++) { var sa = rand(0, TAU), ss = rand(300, 800); spark(cx, cy, Math.cos(sa) * ss, Math.sin(sa) * ss, true); }
      // the diamonds come loose
      vein.crystals.forEach(function (c, k) {
        loose.push({ x: px(c.x), y: py(c.y), vx: rand(-160, 160), vy: rand(-520, -360), r: Math.max(9, c.size * s * 1.1), rot: c.rot, vr: rand(-6, 6),
          age: 0, fly: 1.15 + k * 0.12, done: false, from: null });
      });
      flash = 1; shake = 1;
    }

    /* ============ input ============ */
    function canSwing() { return vein && !vein.broken; }
    stage.addEventListener("pointerdown", function (e) {
      if (pointer.active || !canSwing()) return;
      if (e.target !== canvas && e.target !== stage) return;   // buttons on the HUD keep their taps
      if (audio) audio.init();
      pointer.active = true; pointer.id = e.pointerId;
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      var c = toVein(e);
      pointer.x = c.X; pointer.y = c.Y;
      trail.length = 0; trail.push({ x: c.X, y: c.Y, t: T });
      vein.pointerDown(c.x, c.y, stamp(e));
      e.preventDefault();
    });
    stage.addEventListener("pointermove", function (e) {
      if (!pointer.active || e.pointerId !== pointer.id) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!evs || !evs.length) evs = [e];
      for (var i = 0; i < evs.length; i++) {
        var c = toVein(evs[i]);
        var ddx = c.X - pointer.x, ddy = c.Y - pointer.y;
        if (ddx * ddx + ddy * ddy > 4) pointer.ang = Math.atan2(ddy, ddx);
        pointer.x = c.X; pointer.y = c.Y;
        trail.push({ x: c.X, y: c.Y, t: T });
        if (canSwing()) handle(vein.pointerMove(c.x, c.y, stamp(evs[i])));
      }
      if (trail.length > 28) trail.splice(0, trail.length - 28);
    });
    function endPointer(e) {
      if (e.pointerId !== pointer.id) return;
      pointer.active = false; pointer.id = null;
      if (vein) vein.pointerUp();
    }
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    function stamp(e) { return (e.timeStamp || performance.now()) / 1000; }

    function handle(ev) {
      if (!ev) return;
      if (ev.type === "tink") {
        for (var i = 0; i < 4; i++) { var a = rand(0, TAU); spark(px(ev.x), py(ev.y), Math.cos(a) * 200, Math.sin(a) * 200, false); }
        if (audio) { audio.burst("highpass", 5200, 1, 0.06, 0.12); audio.thump(1200, 900, 0.05, 0.05); }
        onStrike(ev);
        return;
      }
      ev.cracks.forEach(function (c) { c._t = T; });
      burstAt(ev);
      if (audio) {
        audio.thump(170 - ev.power * 40, 50, 0.16, 0.3 + ev.power * 0.15);
        audio.burst("bandpass", 2400 + ev.power * 800, 1.3, 0.1, 0.22 + ev.power * 0.1);
        audio.burst("highpass", 5800, 1, 0.05, 0.1);
      }
      if (ev.broke) {
        brokeAt = T;
        shatter();
        // the result card never waits on a slow frame rate for long
        setTimeout(function () { if (vein === brokeVein && !finished) { finished = true; if (opts.onSettled) opts.onSettled(); } }, 3500);
        var brokeVein = vein;
        if (audio) { audio.thump(120, 36, 0.6, 0.55); audio.burst("lowpass", 900, 0.6, 0.7, 0.45); audio.burst("bandpass", 1900, 0.8, 0.35, 0.3, 0.05); }
        onBroken(ev);
      }
      onStrike(ev);
    }

    /* ============ simulation ============ */
    function step(dt) {
      T += dt;
      shake = Math.max(0, shake - dt * 2.6);
      flash = Math.max(0, flash - dt * 3.2);
      // the rock rocks back from a hit on a stiff spring
      kick.vx += (-kick.x * 520 - kick.vx * 18) * dt; kick.vy += (-kick.y * 520 - kick.vy * 18) * dt;
      kick.x += kick.vx * dt; kick.y += kick.vy * dt;

      var grav = 1300, i, p;
      for (i = parts.length - 1; i >= 0; i--) {
        p = parts[i]; p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        if (p.kind === "chunk") {
          p.vy += grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          var fy = floorY + 4 + (p.x * 7 % 9);
          if (p.y > fy && p.vy > 0) {
            p.y = fy; p.vy *= -0.32; p.vx *= 0.6; p.vr *= 0.5; p.bounced++;
            if (p.bounced === 1 && audio && Math.random() < 0.15) audio.burst("bandpass", 3000, 2, 0.03, 0.04);
          }
        } else if (p.kind === "dust") {
          p.vx *= 1 - dt * 2; p.vy *= 1 - dt * 2; p.vy -= 10 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.grow * dt;
        } else {
          p.vy += grav * 0.4 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 3; p.vy *= 1 - dt * 3;
        }
      }
      for (i = shards.length - 1; i >= 0; i--) {
        p = shards[i]; p.age += dt;
        if (p.age >= p.life) { shards.splice(i, 1); continue; }
        p.vy += grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y > floorY + 6 && p.vy > 0) { p.y = floorY + 6; p.vy *= -0.25; p.vx *= 0.55; p.vr *= 0.5; }
      }
      for (i = 0; i < loose.length; i++) {
        p = loose[i]; p.age += dt;
        if (p.age < p.fly) {
          p.vy += grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          if (p.y > floorY - p.r * 0.4 && p.vy > 0) { p.y = floorY - p.r * 0.4; p.vy *= -0.45; p.vx *= 0.7; p.vr *= 0.6; if (audio && Math.abs(p.vy) > 60) audio.burst("highpass", 6500, 2, 0.04, 0.05); }
        } else if (!p.done) {
          if (!p.from) { p.from = { x: p.x, y: p.y }; p.to = walletPoint(); }
          var t = (p.age - p.fly) / 0.55;
          if (t >= 1) {
            p.done = true;
            if (audio) audio.burst("highpass", 7000 + i * 300, 3, 0.08, 0.08);
            pulseWallet();
          }
          var e2 = easeIn(t);
          p.x = lerp(p.from.x, p.to.x, e2) + Math.sin(t * Math.PI) * (i % 2 ? 40 : -40);
          p.y = lerp(p.from.y, p.to.y, e2) - Math.sin(t * Math.PI) * 60;
          p.rot += dt * 8;
        }
      }
      if (vein && vein.broken && !finished && loose.length && loose.every(function (q) { return q.done; })) {
        finished = true;
        if (audio) audio.chime();
        if (opts.onSettled) opts.onSettled();
      }
      if (vein && vein.broken && !finished && !loose.length && T - brokeAt > 1.2) {
        finished = true;
        if (opts.onSettled) opts.onSettled();
      }
    }

    function walletPoint() {
      var el = document.getElementById("walletDiamonds"), r = stage.getBoundingClientRect();
      if (!el) return { x: W - 30, y: -20 };
      var b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top };
    }
    function pulseWallet() {
      var el = document.getElementById("walletDiamonds");
      var chip = el && el.parentNode;
      if (!chip) return;
      chip.classList.remove("chip-pulse"); void chip.offsetWidth; chip.classList.add("chip-pulse");
    }

    /* ============ drawing ============ */
    function draw() {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      var sx = 0, sy = 0;
      if (shake > 0) { sx = (Math.random() - 0.5) * shake * 12; sy = (Math.random() - 0.5) * shake * 10; }
      g.save(); g.translate(sx, sy);
      g.drawImage(bg, -8, -8, W + 16, Hh + 16);

      // the lantern hanging from the cap beam, flickering
      var flick = 0.85 + Math.sin(T * 11) * 0.04 + Math.sin(T * 23.7) * 0.03 + Math.sin(T * 3.1) * 0.05;
      var lx = W * 0.2, ly = Hh * 0.17;
      g.globalCompositeOperation = "lighter";
      sprite(WARM, lx, ly, Math.max(W, Hh) * 0.6, 0.2 * flick);
      sprite(WARM, lx, ly, 40, 0.5 * flick);
      g.globalCompositeOperation = "source-over";
      g.strokeStyle = "#1c1612"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(lx, Hh * 0.06 + 6); g.lineTo(lx, ly - 10); g.stroke();
      g.fillStyle = "#2b2420"; g.fillRect(lx - 7, ly - 11, 14, 4); g.fillRect(lx - 6, ly + 9, 12, 4);
      g.fillStyle = "rgba(255,214,140," + (0.85 * flick + 0.1) + ")";
      g.beginPath(); g.ellipse(lx, ly, 5, 9, 0, 0, TAU); g.fill();
      g.strokeStyle = "#2b2420"; g.lineWidth = 1.2; g.strokeRect(lx - 6, ly - 8, 12, 17);

      if (vein) {
        var prog = vein.progress();
        // shadow on the floor
        if (!vein.broken) {
          g.fillStyle = "rgba(0,0,0,0.45)";
          g.beginPath(); g.ellipse(cx + s * 0.1, floorY + 4, s * 1.15, s * 0.16, 0, 0, TAU); g.fill();
        }
        if (!vein.broken) drawRock(prog);
        drawShards();
      }
      drawParts();
      drawLoose();
      drawTrail();
      if (pointer.active && vein && !vein.broken) drawPick(pointer.x, pointer.y, pointer.ang);
      g.restore();
      if (flash > 0) { g.fillStyle = "rgba(230,250,255," + (flash * 0.55) + ")"; g.fillRect(0, 0, W, Hh); }
    }

    function drawRock(prog) {
      var ox = cx + kick.x, oy = cy + kick.y;
      g.drawImage(rockImg, ox - rockR, oy - rockR, rockR * 2, rockR * 2);
      // the diamonds breathe a little light, more as the rock opens up
      g.globalCompositeOperation = "lighter";
      vein.crystals.forEach(function (c, k) {
        var x = ox + c.x * s, y = oy - c.y * s, r = c.size * s;
        var pulse = 0.5 + 0.5 * Math.sin(T * 2.2 + k * 1.7);
        var a = 0.1 + 0.12 * pulse + prog * 0.24;
        sprite(GLOW, x, y, r * (2.6 + prog * 1.4), a);
        // a glint crossing now and then
        var gt = (T * 0.45 + k * 0.37) % 1;
        if (gt < 0.12) {
          var ga = Math.sin(gt / 0.12 * Math.PI), L = r * 1.6 * ga;
          g.strokeStyle = "rgba(255,255,255," + (0.8 * ga) + ")"; g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(x - r * 0.3 - L, y - r * 0.3); g.lineTo(x - r * 0.3 + L, y - r * 0.3);
          g.moveTo(x - r * 0.3, y - r * 0.3 - L); g.lineTo(x - r * 0.3, y - r * 0.3 + L); g.stroke();
        }
      });
      g.globalCompositeOperation = "source-over";

      // cracks: a dark split, a lit lip, and blue light leaking through once it is deep
      g.save();
      outlinePath(g, vein.outline, ox, oy, s); g.clip();
      g.lineCap = "round"; g.lineJoin = "round";
      var widen = 1 + prog * 1.6;
      for (var pass = 0; pass < 3; pass++) {
        for (var i = 0; i < vein.cracks.length; i++) {
          var c = vein.cracks[i], pts = c.pts;
          if (pts.length < 2) continue;
          var shown = c._t === undefined ? 1 : clamp((T - c._t) / 0.14, 0, 1);
          var nShow = Math.max(2, Math.ceil(pts.length * shown));
          var w = Math.max(0.8, c.width * s * 0.03 * widen);
          if (pass === 0) { g.strokeStyle = "rgba(255,235,210,0.2)"; g.lineWidth = w * 0.9; g.save(); g.translate(1.2, 1.4); }
          else if (pass === 1) { g.strokeStyle = "rgba(8,5,10,0.92)"; g.lineWidth = w; }
          else {
            if (prog < 0.35) continue;
            g.globalCompositeOperation = "lighter";
            g.strokeStyle = "rgba(110,215,235," + ((prog - 0.35) * 0.6 * (0.8 + 0.2 * Math.sin(T * 6 + i))) + ")";
            g.lineWidth = w * 0.45;
          }
          var base = g.lineWidth;
          for (var k = 1; k < nShow; k++) {
            g.lineWidth = Math.max(0.6, base * (1 - 0.75 * k / pts.length));
            g.beginPath();
            g.moveTo(ox + pts[k - 1][0] * s, oy - pts[k - 1][1] * s);
            g.lineTo(ox + pts[k][0] * s, oy - pts[k][1] * s);
            g.stroke();
          }
          if (pass === 0) g.restore();
          if (pass === 2) g.globalCompositeOperation = "source-over";
        }
      }
      g.restore();
    }

    function drawShards() {
      for (var i = 0; i < shards.length; i++) {
        var p = shards[i], a = 1 - clamp((p.age - p.life + 0.5) / 0.5, 0, 1);
        g.save();
        g.globalAlpha = a;
        g.translate(p.x, p.y); g.rotate(p.rot);
        g.beginPath();
        for (var k = 0; k < p.tri.length; k++) { var q = p.tri[k]; if (k === 0) g.moveTo(q[0] * s, -q[1] * s); else g.lineTo(q[0] * s, -q[1] * s); }
        g.closePath(); g.clip();
        g.drawImage(rockBare, -p.gx * s - rockR, p.gy * s - rockR, rockR * 2, rockR * 2);
        g.restore();
      }
    }

    function drawParts() {
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i], f = p.age / p.life;
        if (p.kind === "chunk") {
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
          g.globalAlpha = 1 - clamp((f - 0.75) / 0.25, 0, 1);
          g.beginPath();
          for (var k = 0; k < p.pts.length; k++) { var q = p.pts[k]; if (k === 0) g.moveTo(q[0] * p.r, q[1] * p.r); else g.lineTo(q[0] * p.r, q[1] * p.r); }
          g.closePath();
          g.fillStyle = p.col; g.fill();
          g.fillStyle = "rgba(255,240,220,0.18)";
          g.beginPath(); g.moveTo(p.pts[0][0] * p.r, p.pts[0][1] * p.r); g.lineTo(p.pts[1][0] * p.r, p.pts[1][1] * p.r); g.lineTo(0, 0); g.closePath(); g.fill();
          g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 0.8; g.stroke();
          g.restore();
        } else if (p.kind === "dust") {
          var da = p.a * (1 - f);
          sprite(DUST, p.x, p.y, p.r, da);
        }
      }
      g.globalCompositeOperation = "lighter"; g.lineCap = "round";
      for (var j = 0; j < parts.length; j++) {
        var sp = parts[j];
        if (sp.kind !== "spark") continue;
        var sf = 1 - sp.age / sp.life;
        g.strokeStyle = sp.blue ? "rgba(150,235,255," + sf + ")" : "rgba(255,210,140," + sf + ")";
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(sp.x, sp.y); g.lineTo(sp.x - sp.vx * 0.025, sp.y - sp.vy * 0.025); g.stroke();
      }
      g.globalCompositeOperation = "source-over";
    }

    function drawLoose() {
      for (var i = 0; i < loose.length; i++) {
        var p = loose[i];
        if (p.done) continue;
        g.globalCompositeOperation = "lighter";
        sprite(GLOW, p.x, p.y, p.r * 3, 0.45);
        g.globalCompositeOperation = "source-over";
        drawCrystal(g, p.x, p.y, p.r, p.rot);
      }
    }

    function drawTrail() {
      if (trail.length < 2) return;
      g.lineCap = "round"; g.lineJoin = "round";
      for (var i = 1; i < trail.length; i++) {
        var a = trail[i - 1], b = trail[i], age = T - b.t;
        if (age > 0.18) continue;
        var f = 1 - age / 0.18;
        g.strokeStyle = "rgba(255,240,220," + (0.5 * f) + ")";
        g.lineWidth = 1 + 5 * f * (i / trail.length);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    }

    /* A pick in the hand: a hickory handle and an iron head, swung along the stroke. */
    function drawPick(x, y, ang) {
      var k = Math.max(0.7, s / 110);
      g.save(); g.translate(x, y); g.rotate(ang + Math.PI * 0.5); g.scale(k, k);
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(-2, 6, 6, 46);
      var hg = g.createLinearGradient(-3, 0, 3, 0); hg.addColorStop(0, "#7a5230"); hg.addColorStop(0.5, "#b07d4a"); hg.addColorStop(1, "#6a4428");
      g.fillStyle = hg; g.fillRect(-3, 2, 6, 48);
      g.fillStyle = "#3e3c40";
      g.beginPath(); g.moveTo(-26, 8); g.quadraticCurveTo(0, -6, 26, 8); g.lineTo(22, 10); g.quadraticCurveTo(0, 1, -22, 10); g.closePath(); g.fill();
      g.fillStyle = "#8c8a92"; g.beginPath(); g.moveTo(-26, 8); g.quadraticCurveTo(0, -4, 26, 8); g.lineTo(24, 7); g.quadraticCurveTo(0, -3, -24, 7); g.closePath(); g.fill();
      g.fillStyle = "#2a282c"; g.fillRect(-5, 0, 10, 9);
      g.restore();
    }

    /* ============ loop ============ */
    function frame(now) {
      if (!running) return;
      if (fpsT < 0) fpsT = now;
      frames++; if (now - fpsT > 1000) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
      // a slow device still plays at real speed: step the world in small pieces
      var dt = Math.min(0.25, Math.max(0, (now - lastT) / 1000)); lastT = now;
      while (dt > 1e-4) { var h = Math.min(dt, 1 / 45); step(h); dt -= h; }
      draw();
      raf = root.requestAnimationFrame(frame);
    }

    function newVein() {
      vein = V.createVein({ crystals: opts.crystals, seed: opts.seed });
      parts.length = 0; shards.length = 0; loose.length = 0; trail.length = 0;
      shake = 0; flash = 0; kick = { x: 0, y: 0, vx: 0, vy: 0 }; brokeAt = -1; finished = false;
      if (W) bakeRock();
    }

    function show() {
      if (!vein) newVein();
      layout();
      if (running) return;
      running = true; lastT = performance.now();
      raf = root.requestAnimationFrame(frame);
    }
    function hide() {
      running = false; pointer.active = false; pointer.id = null;
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
    }
    root.addEventListener("resize", function () { if (running) layout(); });

    return {
      show: show, hide: hide, reset: newVein,
      get vein() { return vein; },
      get finished() { return finished; },
      get fps() { return fps; },
      /* Test hook: where on screen (client px) a vein-local point is. */
      clientPoint: function (x, y) { var r = stage.getBoundingClientRect(); return { x: r.left + px(x), y: r.top + py(y) }; }
    };
  }

  G.MineScene = { create: createScene };
})(window);

/* ============================================================
   2D view (Canvas2D). Draws the same lathe as the 3D view from
   the same radius profile: bed, stocks, the spinning blank
   silhouetted from the live profile, the chisel, flying chips.
   Every webview can paint it, so it is both the fallback when
   WebGL will not composite and a first-class view of its own.

   Sanded slices (the cutting model's rough) are tinted a lighter,
   even tan over the grain, and the sandpaper throws a fine pale dust
   that thins as the wood gets smooth, as in the 3D view.
   ============================================================ */
(function (root) {
  "use strict";
  var L = root.Lathe;

  function createView2D(stage, S) {
    var C = L.CFG, work = S.work, SEG = C.SEG, R0 = C.R0;
    var canvas = document.createElement("canvas");
    canvas.className = "fb";
    canvas.setAttribute("aria-label", "Lathe view");
    canvas.style.display = "none";
    var g = canvas.getContext("2d");
    stage.appendChild(canvas);
    var chips = [];
    var lay = null;

    function layout() {
      var w = stage.clientWidth || 300, h = stage.clientHeight || 300;
      var len = Math.min(w * 0.88, h * 2.1);
      var rPx = Math.max(18, Math.min(h * 0.17, len * 0.15));
      lay = { left: w / 2 - len / 2, right: w / 2 + len / 2, cy: h * 0.42, rPx: rPx, w: w, h: h, len: len };
      return lay;
    }
    function resize() {
      var dpr = Math.min(root.devicePixelRatio || 1, 2);
      canvas.width = Math.round(stage.clientWidth * dpr);
      canvas.height = Math.round(stage.clientHeight * dpr);
      layout();
    }
    function tipXY() {
      var Lp = lay, tool = S.tool;
      if (tool.mode === "rest") return { x: Lp.right - Lp.len * 0.2, y: Lp.cy + Lp.rPx * 1.45 };
      return { x: Lp.left + tool.t * Lp.len, y: Lp.cy + ((tool.r + tool.lift) / R0) * Lp.rPx * 0.96 };
    }

    function onCut(amount) {
      var p = tipXY();
      var n = Math.min(10, 2 + Math.floor(amount * 260));
      for (var i = 0; i < n; i++) {
        if (chips.length > 240) chips.shift();
        chips.push({
          x: p.x + (Math.random() - 0.5) * 10, y: p.y,
          vx: (Math.random() - 0.5) * 140, vy: -30 - Math.random() * 140,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 18,
          life: 0.9 + Math.random() * 0.6, s: 2 + Math.random() * 3.4
        });
      }
    }

    /* ---- sanding: an even, lighter tan over the grain where the wood is smooth ---- */
    var sandGrad = null, sandKey = "";
    function drawSanded(Lp, cy, rPx, len) {
      var rough = work.rough, coat = S.coat, n = SEG, step = len / (n - 1);
      var key = cy.toFixed(1) + ":" + rPx.toFixed(1);
      if (key !== sandKey) {
        sandKey = key;
        sandGrad = g.createLinearGradient(0, cy - rPx, 0, cy + rPx);
        sandGrad.addColorStop(0, "#94683a"); sandGrad.addColorStop(0.3, "#d4a76c");
        sandGrad.addColorStop(0.46, "#f2d3a2"); sandGrad.addColorStop(0.62, "#d9b27c");
        sandGrad.addColorStop(0.85, "#a27445"); sandGrad.addColorStop(1, "#77532c");
      }
      // smoothness quantised so a run is one rectangle; paint on top hides it
      function lvl(i) { return Math.round((1 - rough[i]) * (1 - (coat ? Math.min(1, coat.coat[i]) : 0)) * 12); }
      g.fillStyle = sandGrad;
      eachRun(n, function (a, b) { return lvl(a) === lvl(b); }, function (a, b) {
        var q = lvl(a);
        if (q <= 0) return;
        g.globalAlpha = Math.min(1, 0.7 * q / 12);
        g.fillRect(Lp.left + (a - 0.5) * step, cy - rPx - 1, (b - a + 1) * step + 0.5, rPx * 2 + 2);
      });
      g.globalAlpha = 1;
    }
    /* sanding dust: fine and pale, flung off along the spin (down and out at the pad) */
    function onSand(t, pr, rough, dt) {
      var tp = tipXY(), n = Math.floor(pr * rough * dt * 260 + Math.random());
      for (var i = 0; i < n; i++) {
        if (drops.length > 320) drops.shift();
        drops.push({ x: tp.x + (Math.random() - 0.5) * 24, y: tp.y - 2, vx: (Math.random() - 0.5) * 70, vy: 40 + Math.random() * 110,
                     g: 40, life: 0.6 + Math.random() * 0.6, fade: 1.6, s: 0.7 + Math.random() * 1.1, mist: true, col: "rgba(246,230,196,A)", sand: true });
      }
    }

    /* ---- paint, sheen, lamp, tools ---- */
    var P = L.Paint, shownTmp = [0, 0, 0];
    var lampT = 0.5, lampPhase = 0, lampOn = 0;
    var drops = [];   // flung paint and mist

    function css(c, a) { return "rgba(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + "," + a + ")"; }

    /* Walk the slices in runs of near-identical ones, so a stripe is one rectangle
       and not a hundred (a software canvas pays for every rect, every frame). */
    function eachRun(n, same, draw) {
      var i = 0, j;
      while (i < n) {
        j = i;
        while (j + 1 < n && same(i, j + 1)) j++;
        draw(i, j);
        i = j + 1;
      }
    }

    /* the coat, with the cylinder shading laid back over it */
    var shadeGrad = null, shadeKey = "";
    function drawPaint(Lp, cy, rPx, len) {
      var coat = S.coat;
      if (!coat || coat.coverage() < 0.0005) return;
      var n = SEG, step = len / (n - 1);
      var key = cy.toFixed(1) + ":" + rPx.toFixed(1);
      if (key !== shadeKey) {
        shadeKey = key;
        shadeGrad = g.createLinearGradient(0, cy - rPx, 0, cy + rPx);
        shadeGrad.addColorStop(0, "rgba(0,0,0,0.5)"); shadeGrad.addColorStop(0.3, "rgba(0,0,0,0.08)");
        shadeGrad.addColorStop(0.46, "rgba(255,255,255,0.12)"); shadeGrad.addColorStop(0.62, "rgba(0,0,0,0.04)");
        shadeGrad.addColorStop(0.85, "rgba(0,0,0,0.34)"); shadeGrad.addColorStop(1, "rgba(0,0,0,0.55)");
      }
      var c = coat.coat, col = coat.color;
      eachRun(n, function (a, b) {
        if (c[a] < 0.01 || c[b] < 0.01) return false;
        return Math.abs(c[b] - c[a]) < 0.04 &&
          Math.abs(col[b * 3] - col[a * 3]) + Math.abs(col[b * 3 + 1] - col[a * 3 + 1]) + Math.abs(col[b * 3 + 2] - col[a * 3 + 2]) < 0.03;
      }, function (a, b) {
        if (c[a] < 0.01) return;
        var m = (a + b) >> 1, x = Lp.left + (a - 0.5) * step, w = (b - a + 1) * step + 0.5;
        coat.shownColor(m, P.CFG.WOOD_RGB, shownTmp);
        g.globalAlpha = Math.min(1, c[m] * 1.05);
        g.fillStyle = css(shownTmp, 1);
        g.fillRect(x, cy - rPx - 1, w, rPx * 2 + 2);
        g.globalAlpha = Math.min(1, c[m]);
        g.fillStyle = shadeGrad;
        g.fillRect(x, cy - rPx - 1, w, rPx * 2 + 2);
      });
      g.globalAlpha = 1;
    }

    /* the finish: a soft bar of light along the top, as bright as the gloss under it,
       plus a hot glint where the lamp's light lands */
    function drawSheen(Lp, cy, rPx, len) {
      var coat = S.coat, n = SEG, step = len / (n - 1), gl = coat ? coat.gloss : null;
      eachRun(n, function (a, b) { return gl ? Math.abs(gl[b] - gl[a]) < 0.03 : true; }, function (a, b) {
        var v = gl ? gl[(a + b) >> 1] : 0, x = Lp.left + (a - 0.5) * step, w = (b - a + 1) * step + 0.5;
        g.fillStyle = "rgba(255,244,222," + (0.1 + v * 0.42).toFixed(3) + ")";
        g.fillRect(x, cy - rPx * 0.56, w, rPx * (0.2 + v * 0.06));
        if (v > 0.05) {
          g.fillStyle = "rgba(255,255,255," + (v * 0.55).toFixed(3) + ")";
          g.fillRect(x, cy - rPx * 0.5, w, rPx * 0.07);
        }
      });
      if (lampOn > 0.02 && coat) {
        var li = Math.max(0, Math.min(n - 1, Math.round(lampT * (n - 1)))), gloss = coat.gloss[li];
        var lx = Lp.left + lampT * len, ly = cy - rPx * 0.5, rad = rPx * 1.5;
        var gr = g.createRadialGradient(lx, ly, 0, lx, ly, rad);
        var k = lampOn * (0.1 + 0.85 * gloss);
        gr.addColorStop(0, "rgba(255,252,236," + k.toFixed(3) + ")");
        gr.addColorStop(0.35, "rgba(255,240,205," + (k * 0.4).toFixed(3) + ")");
        gr.addColorStop(1, "rgba(255,240,205,0)");
        g.fillStyle = gr; g.fillRect(lx - rad, cy - rPx, rad * 2, rPx * 2);
      }
    }

    function drawLamp(Lp, cy, rPx, len) {
      var lx = Lp.left + lampT * len, top = Math.max(6, cy - rPx * 2.7), by = top + rPx * 0.5;
      var cone = g.createLinearGradient(0, by, 0, cy);
      cone.addColorStop(0, "rgba(255,236,190," + (0.2 * lampOn).toFixed(3) + ")"); cone.addColorStop(1, "rgba(255,236,190,0)");
      g.fillStyle = cone;
      g.beginPath(); g.moveTo(lx - rPx * 0.35, by); g.lineTo(lx + rPx * 0.35, by); g.lineTo(lx + rPx * 1.5, cy - rPx * 0.4); g.lineTo(lx - rPx * 1.5, cy - rPx * 0.4); g.closePath(); g.fill();
      var gr = g.createRadialGradient(lx, by, 0, lx, by, rPx * 0.9);
      gr.addColorStop(0, "rgba(255,246,214," + (0.9 * lampOn).toFixed(3) + ")"); gr.addColorStop(1, "rgba(255,226,160,0)");
      g.fillStyle = gr; g.fillRect(lx - rPx, by - rPx, rPx * 2, rPx * 2);
      g.fillStyle = "#2c3234";
      g.beginPath(); g.moveTo(lx - rPx * 0.42, by); g.lineTo(lx - rPx * 0.18, top); g.lineTo(lx + rPx * 0.18, top); g.lineTo(lx + rPx * 0.42, by); g.closePath(); g.fill();
      g.fillStyle = "#fff4cf"; g.fillRect(lx - rPx * 0.32, by - 1, rPx * 0.64, 3);
    }

    function drawChisel(tipX, tipY, dx, dy, rPx) {
      var bx = tipX + dx * rPx * 1.05, by = tipY + dy * rPx * 1.05;
      var hx = bx + dx * rPx * 1.8, hy = by + dy * rPx * 1.8;
      g.strokeStyle = "#d6dde1"; g.lineWidth = Math.max(5, rPx * 0.16);
      g.beginPath(); g.moveTo(tipX, tipY); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = "#d9ae4e"; g.lineWidth = Math.max(6, rPx * 0.2);
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + dx * rPx * 0.22, by + dy * rPx * 0.22); g.stroke();
      g.strokeStyle = "#7c4a22"; g.lineWidth = Math.max(9, rPx * 0.3);
      g.beginPath(); g.moveTo(bx + dx * rPx * 0.22, by + dy * rPx * 0.22); g.lineTo(hx, hy); g.stroke();
      g.strokeStyle = "#e8eef2"; g.lineWidth = 2.4;
      var tip = L.TIPS[S.tip] || L.TIPS.gouge, z = tip.size || 1;
      if (tip.look === "sand") return;
      if (tip.look === "gouge") {
        g.beginPath(); g.arc(tipX - dx * 2, tipY - dy * 2, 4.4 * z, 0, Math.PI * 2); g.stroke();
      } else {
        g.beginPath(); g.moveTo(tipX - 5 * z, tipY + 3 * z); g.lineTo(tipX + 5 * z, tipY - 4 * z); g.stroke();
      }
    }

    /* the sanding pad: a cork block wrapped in paper, pressed up under the work */
    function drawPad(tipX, tipY, rPx) {
      var w = Math.max(28, rPx * 0.9), h = Math.max(8, rPx * 0.26);
      g.fillStyle = "#9c6b3c"; g.fillRect(tipX - w / 2, tipY + 3, w, h);
      g.fillStyle = "#c79a5c"; g.fillRect(tipX - w / 2 - 2, tipY, w + 4, 4);
      g.fillStyle = "rgba(60,36,16,0.55)";
      for (var i = 0; i < 9; i++) g.fillRect(tipX - w / 2 + (i * 7.3) % w, tipY + 1 + (i % 2), 1.2, 1.2);
      g.fillStyle = "#d9a27c";
      for (var f = 0; f < 3; f++) { g.beginPath(); g.ellipse(tipX - w * 0.28 + f * w * 0.28, tipY + 3 + h + 4, w * 0.11, 5, 0, 0, Math.PI * 2); g.fill(); }
    }

    function drawBrush(tipX, tipY, dx, dy, rPx) {
      var rgb = P.PALETTE[S.color].rgb, wide = S.paintTool === "brush";
      var bw = Math.max(wide ? 12 : 5, rPx * (wide ? 0.42 : 0.16)) * (wide && S.brushTool ? S.brushTool.width : 1);
      var tx = tipX + dx * rPx * 0.34, ty = tipY + dy * rPx * 0.34;          // top of the bristles
      var fx = tx + dx * rPx * 0.28, fy = ty + dy * rPx * 0.28;              // ferrule end
      var hx = fx + dx * rPx * 1.9, hy = fy + dy * rPx * 1.9;
      g.strokeStyle = "#7c4a22"; g.lineWidth = Math.max(8, rPx * 0.27);
      g.beginPath(); g.moveTo(fx, fy); g.lineTo(hx, hy); g.stroke();
      g.strokeStyle = "#c8cfd4"; g.lineWidth = bw + 2;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(fx, fy); g.stroke();
      g.fillStyle = css(rgb, 1);
      g.beginPath();                                                           // the loaded tuft, tapering to a point
      g.moveTo(tx - bw / 2, ty); g.quadraticCurveTo(tx - bw / 2, tipY + 1, tipX, tipY - 3);
      g.quadraticCurveTo(tx + bw / 2, tipY + 1, tx + bw / 2, ty); g.closePath(); g.fill();
      g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 1; g.stroke();
    }

    function drawBottle(tipX, tipY, dx, dy, rPx) {
      var ox = tipX + dx * rPx * 0.42, oy = tipY + dy * rPx * 0.42;           // nozzle stands off the wood
      var hx = ox + dx * rPx * 0.5, hy = oy + dy * rPx * 0.5;
      var bx = hx + dx * rPx * 1.5, by = hy + dy * rPx * 1.5;
      g.strokeStyle = "#a9c6d6"; g.lineWidth = Math.max(16, rPx * 0.55);        // bottle body
      g.beginPath(); g.moveTo(hx + dx * rPx * 0.2, hy + dy * rPx * 0.2); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.45)"; g.lineWidth = Math.max(4, rPx * 0.12);
      g.beginPath(); g.moveTo(hx + dx * rPx * 0.3 - 4, hy + dy * rPx * 0.3); g.lineTo(bx - 4, by); g.stroke();
      g.strokeStyle = "#e8a33d"; g.lineWidth = Math.max(10, rPx * 0.34);        // trigger head
      g.beginPath(); g.moveTo(ox, oy); g.lineTo(hx, hy); g.stroke();
      g.strokeStyle = "#d6dde1"; g.lineWidth = Math.max(4, rPx * 0.1);          // nozzle
      g.beginPath(); g.moveTo(tipX + dx * rPx * 0.1, tipY + dy * rPx * 0.1); g.lineTo(ox, oy); g.stroke();
    }

    function stepDrops(dt, floorY) {
      for (var i = drops.length - 1; i >= 0; i--) {
        var d = drops[i];
        d.life -= dt;
        if (d.life <= 0) { drops.splice(i, 1); continue; }
        d.vy += d.g * dt; d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.y > floorY - 1) { d.y = floorY - 1; d.vy = 0; d.vx *= 0.5; }
        g.fillStyle = d.col.replace("A", Math.min(1, d.life * d.fade).toFixed(2));
        if (d.mist) { g.beginPath(); g.arc(d.x, d.y, d.s * (1.3 - d.life), 0, Math.PI * 2); g.fill(); }
        else { g.beginPath(); g.ellipse(d.x, d.y, d.s * (1 + Math.min(1.2, Math.abs(d.vy) / 400)), d.s, 0, 0, Math.PI * 2); g.fill(); }
      }
    }

    /* flung paint: a spinning piece throws it off tangentially, down and out */
    function onPaint(pr, dt) {
      var tp = tipXY(), rgb = P.PALETTE[S.color].rgb, n = Math.floor(pr * dt * 90 + Math.random());
      for (var i = 0; i < n; i++) {
        if (drops.length > 260) drops.shift();
        var side = Math.random() < 0.5 ? -1 : 1;
        drops.push({ x: tp.x + (Math.random() - 0.5) * 14, y: tp.y - 2, vx: side * (30 + Math.random() * 150), vy: 30 + Math.random() * 120,
                     g: 560, life: 0.5 + Math.random() * 0.5, fade: 3, s: 1.2 + Math.random() * 2.2, mist: false, col: css(rgb, "A") });
      }
    }
    /* spray: a fine mist leaving the nozzle toward the wood */
    function onSpray(pr, dt) {
      var tp = tipXY(), n = Math.floor(pr * dt * 150 + Math.random());
      for (var i = 0; i < n; i++) {
        if (drops.length > 260) drops.shift();
        var ang = (Math.random() - 0.5) * 0.9, sp = 90 + Math.random() * 130;
        drops.push({ x: tp.x + (Math.random() - 0.5) * 6, y: tp.y + 8, vx: Math.sin(ang) * sp - 40, vy: -Math.cos(ang) * sp,
                     g: 0, life: 0.3 + Math.random() * 0.25, fade: 2.2, s: 1.4 + Math.random() * 1.6, mist: true, col: "rgba(225,242,255,A)" });
      }
    }

    function frame(dt) {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      var want = Math.round(w * Math.min(root.devicePixelRatio || 1, 2));
      if (canvas.width !== want) resize();
      var Lp = layout();
      var sc = canvas.width / w;
      var shx = 0, shy = 0;
      if (S.shake > 0 && !S.reduceMotion) { shx = (Math.random() - 0.5) * 6 * S.shake; shy = (Math.random() - 0.5) * 6 * S.shake; }
      g.setTransform(sc, 0, 0, sc, shx * sc, shy * sc);
      var cy = Lp.cy, rPx = Lp.rPx, len = Lp.len;
      lampOn += ((S.mode === "finish" ? 1 : 0) - lampOn) * Math.min(1, dt * 6);
      if (S.mode === "finish") {   // the lamp swings slowly end to end so the gloss catches it; it holds still for reduced motion
        lampPhase += dt * 0.55;
        lampT = S.reduceMotion ? 0.5 : 0.5 + 0.42 * Math.sin(lampPhase);
      }
      var bedY = cy + rPx * 1.62;
      var floorY = Math.min(h - 4, bedY + rPx * 0.9);
      var r = work.radius, i;

      // workshop backdrop + floor
      var bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#2e2115"); bg.addColorStop(0.55, "#20160e"); bg.addColorStop(1, "#120d09");
      g.fillStyle = bg; g.fillRect(-10, -10, w + 20, h + 20);
      g.fillStyle = "#0d0906"; g.fillRect(-10, floorY, w + 20, h - floorY + 10);
      g.fillStyle = "rgba(232,163,61,0.10)"; g.fillRect(-10, floorY, w + 20, 1.5);

      // the work light hung from the rafters, top centre: a pool of light under it, and the lamp itself
      var lv = Math.max(0, Math.min(3, S.lightLevel | 0)), lx = w / 2, ly = Math.max(10, Math.min(28, cy - rPx * 2.4));
      var pool = g.createRadialGradient(lx, cy, rPx * 0.4, lx, cy, len * (0.55 + lv * 0.08));
      pool.addColorStop(0, "rgba(255,226,170," + (0.1 + lv * 0.03).toFixed(2) + ")"); pool.addColorStop(1, "rgba(255,226,170,0)");
      g.fillStyle = pool; g.fillRect(-10, 0, w + 20, floorY);
      g.strokeStyle = "#111"; g.lineWidth = 1.2;
      var lampW = lv < 2 ? 0 : (lv === 2 ? 90 : 140);
      g.beginPath();
      if (lampW) { g.moveTo(lx - lampW * 0.4, 0); g.lineTo(lx - lampW * 0.4, ly); g.moveTo(lx + lampW * 0.4, 0); g.lineTo(lx + lampW * 0.4, ly); }
      else { g.moveTo(lx, 0); g.lineTo(lx, ly - 6); }
      g.stroke();
      var halo = g.createRadialGradient(lx, ly + 3, 0, lx, ly + 3, 26 + lampW * 0.4);
      halo.addColorStop(0, "rgba(255,240,205,0.75)"); halo.addColorStop(1, "rgba(255,220,160,0)");
      g.fillStyle = halo; g.fillRect(lx - 30 - lampW * 0.4, ly - 26, 60 + lampW * 0.8, 56);
      if (lv === 0) { g.fillStyle = "#1a1a1a"; g.fillRect(lx - 3, ly - 7, 6, 6); g.fillStyle = "#ffe2a8"; g.beginPath(); g.arc(lx, ly + 2, 5, 0, Math.PI * 2); g.fill(); }
      else if (lv === 1) { g.fillStyle = "#e0b321"; g.fillRect(lx - 12, ly - 5, 24, 9); g.fillStyle = "#fff0d0"; g.fillRect(lx - 10, ly + 3, 20, 3); }
      else { g.fillStyle = "#d8dadc"; g.fillRect(lx - lampW / 2, ly, lampW, 4); g.fillStyle = "#fff8ee"; g.fillRect(lx - lampW / 2 + 2, ly + 4, lampW - 4, 2); }

      // bed rails + supports
      g.fillStyle = "#39423e";
      g.fillRect(Lp.left - len * 0.1, bedY, len * 1.2, rPx * 0.32);
      g.fillStyle = "#232a27";
      g.fillRect(Lp.left - len * 0.04, bedY + rPx * 0.32, rPx * 0.55, floorY - bedY);
      g.fillRect(Lp.right + len * 0.04 - rPx * 0.55, bedY + rPx * 0.32, rPx * 0.55, floorY - bedY);

      // headstock (left) + tailstock (right), behind the blank
      g.fillStyle = "#46524c";
      g.fillRect(Lp.left - rPx * 1.6, cy - rPx * 1.5, rPx * 1.55, bedY - (cy - rPx * 1.5));
      g.fillStyle = "#39423e";
      g.fillRect(Lp.left - rPx * 1.72, cy - rPx * 1.72, rPx * 1.8, rPx * 0.3);
      g.fillStyle = "#46524c";
      g.fillRect(Lp.right + rPx * 0.1, cy - rPx * 1.3, rPx * 1.45, bedY - (cy - rPx * 1.3));
      g.fillStyle = "#39423e";
      g.fillRect(Lp.right - rPx * 0.02, cy - rPx * 1.52, rPx * 1.66, rPx * 0.3);

      // the blank: silhouette from the live radius profile
      g.beginPath();
      for (i = 0; i < SEG; i++) {
        var x = Lp.left + (i / (SEG - 1)) * len, y = cy - (r[i] / R0) * rPx;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      for (var j = SEG - 1; j >= 0; j--) g.lineTo(Lp.left + (j / (SEG - 1)) * len, cy + (r[j] / R0) * rPx);
      g.closePath();
      var wg = g.createLinearGradient(0, cy - rPx, 0, cy + rPx);
      wg.addColorStop(0, "#77512a"); wg.addColorStop(0.28, "#c08d4f");
      wg.addColorStop(0.46, "#eec288"); wg.addColorStop(0.62, "#caa066");
      wg.addColorStop(0.85, "#8a5c2c"); wg.addColorStop(1, "#5d3c1d");
      g.fillStyle = wg; g.fill();
      g.save();
      g.clip();
      drawPaint(Lp, cy, rPx, len);
      // grain streaks scrolling around the blank = the spin
      var phase = ((S.spinAngle * 0.3) % (Math.PI * 2)) / (Math.PI * 2);
      var spacing = rPx * 0.34, off = phase * spacing * 2;
      for (var k = 0; k < 9; k++) {
        var gy = cy - rPx - spacing + k * spacing + (off % spacing);
        if (gy > cy + rPx) continue;
        g.strokeStyle = k % 2 ? "rgba(105,62,26,0.20)" : "rgba(238,196,138,0.13)";
        g.lineWidth = 1 + (k % 3) * 0.7;
        g.beginPath();
        g.moveTo(Lp.left - 4, gy);
        g.bezierCurveTo(Lp.left + len * 0.3, gy + 2.5, Lp.left + len * 0.7, gy - 2.5, Lp.right + 4, gy + 1);
        g.stroke();
      }
      for (var kn = 0; kn < 3; kn++) {   // knots travelling around with the spin
        var kx = Lp.left + len * (0.22 + kn * 0.27);
        var ky = cy - rPx + (((phase + kn * 0.37) % 1) * 2) * rPx;
        g.strokeStyle = "rgba(96,58,24,0.4)"; g.lineWidth = 1.3;
        g.beginPath(); g.ellipse(kx, ky, 7, 3.4, 0.2, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.ellipse(kx, ky, 3.6, 1.7, 0.2, 0, Math.PI * 2); g.stroke();
      }
      drawSanded(Lp, cy, rPx, len);   // over the grain, so sanded wood reads even (the streaks fade, not vanish)
      drawSheen(Lp, cy, rPx, len);
      g.restore();
      g.strokeStyle = "rgba(40,24,10,0.55)"; g.lineWidth = 1.2; g.stroke();

      // a commission's target shape, as a dashed ghost to turn down to (cut mode only)
      if (S.target && S.mode === "cut") {
        var tg = S.target;
        g.save(); g.setLineDash([6, 5]); g.lineWidth = 1.6; g.strokeStyle = "rgba(255,241,200,0.9)";
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          g.beginPath();
          for (var gi = 0; gi < SEG; gi++) {
            var gx = Lp.left + (gi / (SEG - 1)) * len, gy = cy + sgn * (tg[gi] / R0) * rPx;
            if (gi === 0) g.moveTo(gx, gy); else g.lineTo(gx, gy);
          }
          g.stroke();
        }
        g.restore();
      }

      // end grain, chuck, tail centre
      g.fillStyle = "#dcb57e";
      g.beginPath(); g.ellipse(Lp.left, cy, 4.5, (r[0] / R0) * rPx, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(Lp.right, cy, 4.5, (r[SEG - 1] / R0) * rPx, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(130,84,40,0.6)"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(Lp.left, cy, 2.6, (r[0] / R0) * rPx * 0.6, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = "#2c3234";
      g.beginPath();
      g.moveTo(Lp.left - rPx * 0.95, cy - rPx * 0.44); g.lineTo(Lp.left + 2, cy - rPx * 0.3);
      g.lineTo(Lp.left + 2, cy + rPx * 0.3); g.lineTo(Lp.left - rPx * 0.95, cy + rPx * 0.44);
      g.closePath(); g.fill();
      g.fillStyle = "#99a1a6";
      g.beginPath();
      g.moveTo(Lp.right + rPx * 0.55, cy - rPx * 0.16); g.lineTo(Lp.right - 2, cy);
      g.lineTo(Lp.right + rPx * 0.55, cy + rPx * 0.16);
      g.closePath(); g.fill();

      // tool rest bar in front of the blank
      g.fillStyle = "#c8cfd4";
      g.fillRect(Lp.left + len * 0.14, cy + rPx * 1.08, len * 0.78, Math.max(3, rPx * 0.09));
      g.fillStyle = "#39423e";
      g.fillRect(Lp.right - len * 0.3, cy + rPx * 1.08, rPx * 0.4, bedY - cy - rPx * 1.08);

      // the tool, rising from below; its tip rides the bottom of the cut
      var tp = tipXY(), tipX = tp.x, tipY = tp.y;
      if (S.cutIntensity > 0.03) {
        tipX += (Math.random() - 0.5) * 3 * S.cutIntensity;
        tipY += (Math.random() - 0.5) * 3.4 * S.cutIntensity;
      }
      var dx = 0.42, dy = 1, dl = Math.sqrt(dx * dx + dy * dy); dx /= dl; dy /= dl;
      g.lineCap = "round";
      if (S.mode === "paint") drawBrush(tipX, tipY, dx, dy, rPx);
      else if (S.mode === "finish") drawBottle(tipX, tipY, dx, dy, rPx);
      else if ((L.TIPS[S.tip] || {}).look === "sand") drawPad(tipX, tipY, rPx);
      else drawChisel(tipX, tipY, dx, dy, rPx);

      if (S.mode === "finish") drawLamp(Lp, cy, rPx, len);

      stepDrops(dt, floorY);

      // chips
      for (var c2 = chips.length - 1; c2 >= 0; c2--) {
        var c = chips[c2];
        c.life -= dt;
        if (c.life <= 0) { chips.splice(c2, 1); continue; }
        c.vy += 620 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt;
        if (c.y > floorY - 2) { c.y = floorY - 2; c.vy *= -0.25; c.vx *= 0.6; }
        c.rot += c.vr * dt;
        g.save();
        g.translate(c.x, c.y); g.rotate(c.rot);
        g.fillStyle = "rgba(230,193,132," + Math.min(1, c.life * 2.4) + ")";
        g.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2);
        g.restore();
      }
    }

    layout();
    return {
      kind: "2d",
      canvas: canvas,
      layout: function () { return lay || layout(); },
      resize: resize,
      show: function () { canvas.style.display = "block"; resize(); },
      hide: function () { canvas.style.display = "none"; },
      onCut: onCut,
      onPaint: onPaint,
      onSpray: onSpray,
      onSand: onSand,
      dustCount: function () { var k = 0; for (var i = 0; i < drops.length; i++) if (drops[i].sand) k++; return k; },
      frame: frame,
      sliceToScreenX: function (i) { var Lp = lay || layout(); return Lp.left + (i / (SEG - 1)) * Lp.len; }
    };
  }

  L.createView2D = createView2D;
})(window);

/* ============================================================
   2D view (Canvas2D). Draws the same lathe as the 3D view from
   the same radius profile: bed, stocks, the spinning blank
   silhouetted from the live profile, the chisel, flying chips.
   Every webview can paint it, so it is both the fallback when
   WebGL will not composite and a first-class view of its own.
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
      var bedY = cy + rPx * 1.62;
      var floorY = Math.min(h - 4, bedY + rPx * 0.9);
      var r = work.radius, i;

      // workshop backdrop + floor
      var bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#2e2115"); bg.addColorStop(0.55, "#20160e"); bg.addColorStop(1, "#120d09");
      g.fillStyle = bg; g.fillRect(-10, -10, w + 20, h + 20);
      g.fillStyle = "#0d0906"; g.fillRect(-10, floorY, w + 20, h - floorY + 10);
      g.fillStyle = "rgba(232,163,61,0.10)"; g.fillRect(-10, floorY, w + 20, 1.5);

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
      g.fillStyle = "rgba(255,240,210,0.10)";   // sheen band
      g.fillRect(Lp.left, cy - rPx * 0.52, len, rPx * 0.42);
      g.restore();
      g.strokeStyle = "rgba(40,24,10,0.55)"; g.lineWidth = 1.2; g.stroke();

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

      // the chisel, rising from below; its tip rides the bottom of the cut
      var tp = tipXY(), tipX = tp.x, tipY = tp.y;
      if (S.cutIntensity > 0.03) {
        tipX += (Math.random() - 0.5) * 3 * S.cutIntensity;
        tipY += (Math.random() - 0.5) * 3.4 * S.cutIntensity;
      }
      var dx = 0.42, dy = 1, dl = Math.sqrt(dx * dx + dy * dy); dx /= dl; dy /= dl;
      var bx = tipX + dx * rPx * 1.05, by = tipY + dy * rPx * 1.05;
      var hx = bx + dx * rPx * 1.8, hy = by + dy * rPx * 1.8;
      g.lineCap = "round";
      g.strokeStyle = "#d6dde1"; g.lineWidth = Math.max(5, rPx * 0.16);
      g.beginPath(); g.moveTo(tipX, tipY); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = "#d9ae4e"; g.lineWidth = Math.max(6, rPx * 0.2);
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + dx * rPx * 0.22, by + dy * rPx * 0.22); g.stroke();
      g.strokeStyle = "#7c4a22"; g.lineWidth = Math.max(9, rPx * 0.3);
      g.beginPath(); g.moveTo(bx + dx * rPx * 0.22, by + dy * rPx * 0.22); g.lineTo(hx, hy); g.stroke();
      g.strokeStyle = "#e8eef2"; g.lineWidth = 2.4;
      if (S.tip === "gouge") {
        g.beginPath(); g.arc(tipX - dx * 2, tipY - dy * 2, 4.4, 0, Math.PI * 2); g.stroke();
      } else {
        g.beginPath(); g.moveTo(tipX - 5, tipY + 3); g.lineTo(tipX + 5, tipY - 4); g.stroke();
      }

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
      frame: frame,
      sliceToScreenX: function (i) { var Lp = lay || layout(); return Lp.left + (i / (SEG - 1)) * Lp.len; }
    };
  }

  L.createView2D = createView2D;
})(window);

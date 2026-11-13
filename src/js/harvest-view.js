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

  /* ---------- what a wood looks like ----------
     Colours and leaf style come from data, not code. The farm's wood table
     (Game.Farm.WOODS: trunk, leaf, leaf2, shape) says what colour the bark and
     the foliage are; LEAF_STYLES says what leaves a given shape of tree wears.
     A new kind of tree needs a row in each and nothing here changes. */
  var FALLBACK_WOOD = { id: "oak", name: "Oak", shape: "round", trunk: "#8f6b43", leaf: "#5c8a3a", leaf2: "#7aa84c" };
  var LEAF_STYLES = {
    round:   { shapes: [0, 1, 2] },     // broad leaves: ovate, narrow, round
    conifer: { shapes: [3, 1] }         // needles
  };
  function hex2rgb(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function rgb2hex(c) { return "#" + c.map(function (v) { v = Math.round(clamp(v, 0, 255)); return (v < 16 ? "0" : "") + v.toString(16); }).join(""); }
  /* k below 1 darkens toward black, above 1 lightens toward white. */
  function shade(h, k) {
    var c = hex2rgb(h);
    return rgb2hex(c.map(function (v) { return k <= 1 ? v * k : v + (255 - v) * (k - 1); }));
  }
  function mixHex(a, b, t) { var x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map(function (v, i) { return lerp(v, y[i], t); })); }

  function makeLeafSprites(greens, shapes) {
    var out = [];
    for (var si = 0; si < shapes.length; si++) {
      for (var ci = 0; ci < greens.length; ci++) {
        var shape = shapes[si];
        var c = document.createElement("canvas"); c.width = 40; c.height = 24;
        var g = c.getContext("2d");
        var tip = shape === 2 ? 31 : 37, wid = shape === 1 ? 5.5 : shape === 2 ? 1 : shape === 3 ? 8 : 2.5;
        g.beginPath(); g.moveTo(4, 12);
        g.quadraticCurveTo(14, wid, tip, 12); g.quadraticCurveTo(14, 24 - wid, 4, 12); g.closePath();
        var gr = g.createLinearGradient(0, 2, 0, 22);
        gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.5, greens[ci]); gr.addColorStop(1, "#12301a");
        g.fillStyle = greens[ci]; g.fill();
        g.globalAlpha = 0.32; g.fillStyle = gr; g.fill(); g.globalAlpha = 1;
        g.strokeStyle = "rgba(14,40,16,0.45)"; g.lineWidth = 1; g.stroke();
        if (shape !== 3) { g.strokeStyle = "rgba(14,40,16,0.4)"; g.beginPath(); g.moveTo(4, 12); g.lineTo(tip - 4, 12); g.stroke(); }
        out.push(c);
      }
    }
    return out;
  }
  function mkRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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
    var order = (root.Game && root.Game.Farm && root.Game.Farm.WOOD_ORDER) || ["pine", "oak", "walnut"];
    var woodUrl = /[?&]wood=(\w+)/.exec(root.location.search);
    /* Where the tree comes from. opts.source() names the grown farm tree
       the player picked ({ plot, wood }); felling it takes it off the
       farm, and its blank is kept in the shed. The page only opens the
       forest with one picked (farm-ui.js), so there is no practice tree
       to pick; with no source the tree plays the same but is not kept. */
    var src = null;
    function pickSource() { src = opts.source ? opts.source() : null; if (src) src.felled = false; return src; }
    function pickWood(seed) {
      if (src) return src.wood;
      if (woodUrl && order.indexOf(woodUrl[1]) >= 0) return woodUrl[1];
      return seed == null ? order[Math.floor(Math.random() * order.length)] : order[seed % order.length];
    }
    var seed0 = seedUrl ? parseInt(seedUrl[1], 10) : null;
    pickSource();
    var game = new L.Harvest(seed0, pickWood(seed0));
    var foliageCache = {}, foliageSeed = -1, looks = {};

    /* The look of one wood: bark colours and leaf sprites, derived once from the farm's wood data. */
    function lookOf(woodId) {
      var k = looks[woodId];
      if (k) return k;
      var farmWoods = root.Game && root.Game.Farm && root.Game.Farm.WOODS;
      var w = (farmWoods && farmWoods[woodId]) || FALLBACK_WOOD;
      var greens = [], i;
      for (i = 0; i < 8; i++) greens.push(mixHex(shade(w.leaf, 0.6), shade(w.leaf2, 1.3), i / 7));
      var style = LEAF_STYLES[w.shape] || LEAF_STYLES.round;
      k = looks[woodId] = {
        name: w.name, trunk: w.trunk, shape: w.shape,
        bark: [shade(w.trunk, 0.3), shade(w.trunk, 0.62), shade(w.trunk, 0.9), shade(w.trunk, 0.66), shade(w.trunk, 0.28)],
        limb: shade(w.trunk, 0.5), twig: shade(w.trunk, 0.6), limbHi: mixHex(w.trunk, "#ffffff", 0.18),
        sprites: makeLeafSprites(greens, style.shapes),
        // the crown's four tones, shadow to sunlit, for the masses of foliage
        canopy: [shade(w.leaf, 0.4), shade(w.leaf, 0.7), mixHex(w.leaf, w.leaf2, 0.45), shade(w.leaf2, 1.1)],
        needles: w.shape === "conifer"
      };
      return k;
    }
    function look() { return lookOf(game.tree.wood); }

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
            if (src && !src.felled) { src.felled = !!(opts.onFelled && opts.onFelled(src)); if (!src.felled) src = null; }
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
    /* The trunk's outline is the wood that is left: each edge is pulled in by the
       notch cut from it, so a notch is an opening you can see the sky through. */
    function trunkPoly(h0, h1, yoff) {
      var tr = game.trunk, i, e;
      g.beginPath();
      e = edgeAt(h0); g.moveTo(-e.W / 2 + e.l, h0 - yoff);
      for (i = Math.ceil(h0 / tr.dh + 1e-6); i * tr.dh < h1 - 1e-6; i++) g.lineTo(-tr.W[i] / 2 + tr.left[i], i * tr.dh - yoff);
      e = edgeAt(h1); g.lineTo(-e.W / 2 + e.l, h1 - yoff); g.lineTo(e.W / 2 - e.r, h1 - yoff);
      for (i = Math.floor(h1 / tr.dh - 1e-6); i * tr.dh > h0 + 1e-6; i--) g.lineTo(tr.W[i] / 2 - tr.right[i], i * tr.dh - yoff);
      e = edgeAt(h0); g.lineTo(e.W / 2 - e.r, h0 - yoff);
      g.closePath();
    }
    /* A thin pale line along the remaining wood where it was cut: the cut face seen edge on. */
    function notchEdges(h0, h1, yoff) {
      var tr = game.trunk, side, i, on;
      g.save(); g.lineCap = "round"; g.lineJoin = "round";
      g.strokeStyle = "rgba(238,212,158,0.92)"; g.lineWidth = 0.024;
      for (side = -1; side <= 1; side += 2) {
        var arr = side < 0 ? tr.left : tr.right;
        on = false; g.beginPath();
        for (i = Math.max(0, Math.floor(h0 / tr.dh)); i <= Math.min(tr.n - 1, Math.ceil(h1 / tr.dh)); i++) {
          var h = i * tr.dh;
          if (arr[i] > 0.004 && h >= h0 - 1e-6 && h <= h1 + 1e-6) {
            var x = side * (tr.W[i] / 2 - arr[i]) - side * 0.014, y = h - yoff;
            if (!on) { g.moveTo(x, y); on = true; } else g.lineTo(x, y);
          } else on = false;
        }
        g.stroke();
      }
      g.restore();
    }
    function drawTrunkPart(h0, h1, yoff) {
      if (h1 - h0 < 1e-4) return;
      trunkPoly(h0, h1, yoff);
      var gr = g.createLinearGradient(-0.75, 0, 0.75, 0), bk = look().bark;
      gr.addColorStop(0, bk[0]); gr.addColorStop(0.22, bk[1]); gr.addColorStop(0.46, bk[2]);
      gr.addColorStop(0.7, bk[3]); gr.addColorStop(1, bk[4]);
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
      g.restore();
      trunkPoly(h0, h1, yoff);
      g.strokeStyle = "rgba(20,11,4,0.7)"; g.lineWidth = 0.03; g.stroke();
      notchEdges(h0, h1, yoff);
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
    /* ---------- limbs, twigs and leaves ----------
       Each branch is the model's main limb (the part you cut) plus twigs that
       fork off it and small leaves along the twigs. The twigs and leaves are
       only for the eye: they are generated once per branch from the tree's seed,
       and they go wherever the limb goes (cut it and everything past the cut
       leaves with it). Geometry is kept in the tree's local frame (x across,
       y up), the same frame the trunk is drawn in. */
    function arcPoint(b, s) {
      var pts = b.pts, k = 0;
      while (k < pts.length - 2 && s > pts[k + 1].s) k++;
      var f = clamp((s - pts[k].s) / (pts[k + 1].s - pts[k].s), 0, 1);
      var dx = b.s * (pts[k + 1].p - pts[k].p), dy = pts[k + 1].q - pts[k].q;
      return { x: b.s * lerp(pts[k].p, pts[k + 1].p, f), y: b.y + lerp(pts[k].q, pts[k + 1].q, f), ang: Math.atan2(dy, dx) };
    }
    function makeTwig(r, x0, y0, ang, len, w0, s0, dens, size, upward) {
      var n = 4, pts = [], x = x0, y = y0, i;
      for (i = 0; i <= n; i++) {
        pts.push({ x: x, y: y, w: Math.max(0.011, w0 * (1 - 0.85 * i / n)), a: ang });
        ang += (Math.PI / 2 - ang) * upward + (r() - 0.5) * 0.3;
        x += Math.cos(ang) * len / n; y += Math.sin(ang) * len / n;
      }
      var leaves = [], nL = Math.max(3, Math.round(len / 0.085 * dens));
      for (i = 0; i < nL; i++) {
        var t = clamp(0.22 + 0.78 * (i + r() * 0.7) / nL, 0, 1), k = Math.min(n - 1, Math.floor(t * n)), f = t * n - k;
        var px = lerp(pts[k].x, pts[k + 1].x, f), py = lerp(pts[k].y, pts[k + 1].y, f);
        var side = i % 2 ? 1 : -1, la = pts[k].a + side * (0.45 + r() * 0.75);
        leaves.push({ x: px, y: py, a: la, size: size * (0.7 + r() * 0.65), u: r() });
      }
      var end = pts[n];
      for (i = -1; i <= 1; i++) leaves.push({ x: end.x, y: end.y, a: end.a + i * 0.55 + (r() - 0.5) * 0.3, size: size * (0.8 + r() * 0.5), u: r() });
      return { s0: s0, pts: pts, leaves: leaves };
    }
    function foliage(b) {
      if (foliageSeed !== game.seed) { foliageCache = {}; foliageSeed = game.seed; }
      var f = foliageCache[b.id];
      if (f) return f;
      var r = mkRng(game.seed * 131 + b.id * 977 + 7), twigs = [], F = game.tree.type.foliage;
      var hi = clamp(b.y / HC.TRUNK_H, 0, 1);
      var dens = b.leader ? F.dens * 1.7 : F.dens + F.densRise * hi, size = b.leader ? F.size * 1.3 : F.size + F.sizeRise * hi;
      var nT = b.leader ? F.leaderTwigs : F.twigs[0] + Math.round((0.5 * hi + 0.5 * r()) * (F.twigs[1] - F.twigs[0]));
      var i, side = r() < 0.5 ? -1 : 1;
      function span(range) { return range[0] + r() * (range[1] - range[0]); }
      for (i = 0; i < nT; i++) {
        var s0 = b.len * (0.3 + 0.62 * (i + r() * 0.4) / nT), P = arcPoint(b, s0);
        var len = span(F.twigLen) * (1.15 - 0.4 * s0 / b.len) * (b.leader ? 1.15 : 1);
        var tw = makeTwig(r, P.x, P.y, P.ang + side * span(F.spread), len, L.branchThick(b, s0) * 0.55, s0, dens, size, F.upward);
        twigs.push(tw);
        if (len > 0.42) {                              // a sprig forking off the twig
          var m = tw.pts[2];
          twigs.push(makeTwig(r, m.x, m.y, m.a - side * (0.6 + r() * 0.4), 0.2 + r() * 0.12, m.w * 0.7, s0, dens, size * 0.9, F.upward));
        }
        side = -side;
      }
      var T = arcPoint(b, b.len);                      // the tip forks in two
      for (i = -1; i <= 1; i += 2) {
        twigs.push(makeTwig(r, T.x, T.y, T.ang + i * (0.4 + r() * 0.3), 0.32 + r() * 0.28, L.branchThick(b, b.len) * 0.9, b.len, dens, size, F.upward));
      }
      if (F.canopy === "needles") { f = { jit: [] }; for (i = 0; i < 97; i++) f.jit.push(r()); }   // tiers are shaped at draw time (see drawConifer)
      else f = clumpCanopy(r, b, twigs, F, hi);
      f.twigs = twigs;
      foliageCache[b.id] = f;
      return f;
    }
    /* A broadleaf crown is made of clumps: round masses of leaves at the ends
       of the twigs, each a heap of overlapping puffs lit from above. Drawn in
       passes over every branch at once (see drawCanopy), neighbouring clumps
       melt into one crown. The leader carries a dome of clumps that closes the
       crown over the top of the stem. */
    function clumpCanopy(r, b, twigs, F, hi) {
      var clumps = [], i, R = F.mass * (1 + F.massRise * hi);
      function clump(x, y, rad, s0) {
        var n = 7 + Math.round(rad * 16), puffs = [], k = 0, guard = 0;
        while (k < n && guard++ < n * 6) {
          var px = (r() * 2 - 1) * rad * 0.78, py = (r() * 2 - 1) * rad * 0.7;
          if (px * px + py * py > rad * rad * 0.6) continue;
          var pr = rad * (0.3 + 0.24 * r());
          puffs.push({ x: x + px, y: y + py, r: pr, t: clamp(0.45 + 0.6 * (py / rad) - 0.25 * (px / rad) * b.s + 0.25 * (r() - 0.5), 0, 1) });
          k++;
        }
        var rim = [];                                   // single leaves breaking the outline
        for (k = 0; k < puffs.length; k++) {
          var P = puffs[k], dx = P.x - x, dy = P.y - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          if (d + P.r < rad * 0.72) continue;
          for (var j = 0; j < 1; j++) {
            var a = Math.atan2(dy, dx) + (r() - 0.5) * 1.4;
            rim.push({ x: P.x + Math.cos(a) * P.r * 0.85, y: P.y + Math.sin(a) * P.r * 0.85, a: a, size: F.size * (0.7 + r() * 0.4), u: 0.2 + 0.6 * r() * P.t });
          }
        }
        clumps.push({ s0: s0, x: x, y: y, r: rad, puffs: puffs, rim: rim });
      }
      for (i = 0; i < twigs.length; i++) {
        var tw = twigs[i], e = tw.pts[tw.pts.length - 1], m = tw.pts[2];
        var big = clamp(Math.hypot(e.x - tw.pts[0].x, e.y - tw.pts[0].y) / 0.6, 0.55, 1.2);
        clump(e.x, e.y + R * 0.15, R * big * (0.8 + 0.4 * r()), tw.s0);
        if (big > 0.7) clump(m.x, m.y + R * 0.1, R * 0.62 * (0.8 + 0.4 * r()), tw.s0);
      }
      if (b.leader) {                                   // the dome over the top of the stem
        var top = arcPoint(b, b.len), C = F.crown;
        for (i = 0; i < 7; i++) {
          var a = Math.PI / 2 + (i - 3) * 0.5, d = C * (i === 3 ? 0.15 : 0.62);
          clump(top.x + Math.cos(a) * d, top.y - 0.35 * C + Math.sin(a) * d * 0.85, R * (i === 3 ? 1.35 : 1.1) * (0.9 + 0.2 * r()), b.len * (0.5 + 0.5 * i / 7));
        }
      }
      return { clumps: clumps, needles: null };
    }
    /* A tapered stroke along points that carry a width: limbs and twigs that
       thin out as they go, not lines of one thickness. */
    function taperStroke(pts, swayOn, fill, hilite) {
      var n = pts.length, left = [], right = [], i;
      for (i = 0; i < n; i++) {
        var a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
        var tx = c.x - a.x, ty = c.y - a.y, tl = Math.sqrt(tx * tx + ty * ty) || 1;
        var nx = -ty / tl, ny = tx / tl, hw = pts[i].w / 2, sw = swayOn ? swayX(pts[i].y) : 0;
        left.push([pts[i].x + sw + nx * hw, pts[i].y + ny * hw]);
        right.push([pts[i].x + sw - nx * hw, pts[i].y - ny * hw]);
      }
      g.beginPath(); g.moveTo(left[0][0], left[0][1]);
      for (i = 1; i < n; i++) g.lineTo(left[i][0], left[i][1]);
      for (i = n - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
      g.closePath(); g.fillStyle = fill; g.fill();
      if (hilite) {
        g.beginPath(); g.moveTo(left[0][0], left[0][1]);
        for (i = 1; i < n; i++) g.lineTo(left[i][0], left[i][1]);
        g.strokeStyle = hilite; g.lineWidth = 0.014; g.stroke();
      }
    }
    /* The main limb between arcs a0 and a1, as points with widths. */
    function limbPoints(b, a0, a1) {
      var out = [], k, P = arcPoint(b, a0);
      out.push({ x: P.x, y: P.y, w: L.branchThick(b, a0) });
      for (k = 0; k < b.pts.length; k++) {
        if (b.pts[k].s <= a0 + 1e-6 || b.pts[k].s >= a1 - 1e-6) continue;
        out.push({ x: b.s * b.pts[k].p, y: b.y + b.pts[k].q, w: L.branchThick(b, b.pts[k].s) });
      }
      P = arcPoint(b, a1);
      out.push({ x: P.x, y: P.y, w: L.branchThick(b, a1) });
      return out;
    }
    /* Limb and twigs (the brown, behind the trunk) for the part of branch b from
       arc a0 to a1. yoff slides the local frame so y = 0 is the break plane. */
    function drawBranch(b, a0, a1, yoff, swayOn) {
      if (a1 - a0 < 0.02) return;
      var f = foliage(b), i, tw;
      g.save(); g.translate(0, -yoff); g.lineJoin = "round";
      for (i = 0; i < f.twigs.length && !look().needles; i++) {    // a conifer's twigs are inside its tiers
        tw = f.twigs[i];
        if (tw.s0 < a0 - 1e-6 || tw.s0 > a1 + 1e-6) continue;
        taperStroke(tw.pts, swayOn, look().twig, null);
      }
      taperStroke(limbPoints(b, a0, a1), swayOn, look().limb, look().limbHi);
      if (a1 < b.len - 0.02) {                        // a cut end shows pale wood
        var e = arcPoint(b, a1);
        g.fillStyle = "#e3c286";
        g.beginPath(); g.arc(e.x + (swayOn ? swayX(e.y) : 0), e.y, L.branchThick(b, a1) * 0.5, 0, TAU); g.fill();
      }
      g.restore();
    }
    /* The foliage of several branch parts ({ b, a0, a1 }), drawn together in
       passes (shadow, body, mid tone, sunlit, then loose leaves) so the crown
       is one mass rather than separate tufts. Only foliage growing from the
       stretch a0..a1 of a branch is drawn: cut a limb and its leaves go with it. */
    function drawCanopy(list, yoff, swayOn) {
      var lk = look(), C = lk.canopy, items = [], i, j, k, q;
      function sw(y) { return swayOn ? swayX(y) * 1.1 : 0; }
      if (lk.needles) { g.save(); g.translate(0, -yoff); drawConifer(list, sw); g.restore(); return; }
      for (i = 0; i < list.length; i++) {
        var it = list[i];
        if (it.a1 - it.a0 < 0.02) continue;
        var f = foliage(it.b), grp = f.clumps || f.needles;
        for (j = 0; j < grp.length; j++) if (grp[j].s0 >= it.a0 - 1e-6 && grp[j].s0 <= it.a1 + 1e-6) items.push(grp[j]);
      }
      if (!items.length) return;
      g.save(); g.translate(0, -yoff);
      {
        // [colour, puff scale, shift toward the light (x), shift up (y), only puffs lit above this]
        var pass = [[C[0], 1.06, 0.04, -0.07, -1], [C[1], 1, 0, 0, -1], [C[2], 0.74, 0.12, 0.16, 0.42], [C[3], 0.42, 0.24, 0.34, 0.74]];
        for (q = 0; q < pass.length; q++) {
          var P = pass[q];
          g.fillStyle = P[0]; g.beginPath();
          for (j = 0; j < items.length; j++) {
            var cl = items[j], o = sw(cl.y);
            for (k = 0; k < cl.puffs.length; k++) {
              var pf = cl.puffs[k];
              if (pf.t <= P[4]) continue;
              var cx = pf.x + o - P[2] * pf.r, cy = pf.y + P[3] * pf.r;
              g.moveTo(cx + pf.r * P[1], cy); g.arc(cx, cy, pf.r * P[1], 0, TAU);
            }
          }
          g.fill();
        }
        var spr = lk.sprites;
        for (j = 0; j < items.length; j++) {
          var c2 = items[j], o2 = sw(c2.y);
          for (k = 0; k < c2.rim.length; k++) {
            var lf = c2.rim[k], sc = lf.size / 32;
            g.save(); g.translate(lf.x + o2, lf.y); g.scale(1, -1); g.rotate(-lf.a - (swayOn ? Math.sin(T * 2 + k + j) * 0.06 : 0));
            g.drawImage(spr[Math.min(spr.length - 1, Math.floor(lf.u * spr.length))], -4 * sc, -12 * sc, 40 * sc, 24 * sc);
            g.restore();
          }
        }
      }
      g.restore();
    }
    /* A conifer is drawn as tiers, the way a pine reads from a distance: each
       bough carries a drooping skirt of needles that starts at the middle of
       the stem (so the trunk hides inside the crown), slopes down to the
       bough's tip and hangs a ragged fringe of needle tufts. Neighbouring
       boughs alternate sides, so their skirts overlap into full tiers that
       narrow toward the top, and the leader is a pointed spire of small tiers.
       Tiers are drawn bottom to top so each one's fringe hangs over the next. */
    function drawConifer(list, sw) {
      var C = look().canopy, F = game.tree.type.foliage, items = list.slice().sort(function (a, b) { return (a.b.leader ? 99 : a.b.y) - (b.b.leader ? 99 : b.b.y); });
      g.lineCap = "round"; g.lineJoin = "round";
      for (var i = 0; i < items.length; i++) {
        var it = items[i], jit = foliage(it.b).jit;
        if (it.b.leader) spire(it.b, it.a0, it.a1, jit); else tier(it.b, it.a0, it.a1, jit);
      }
      function J(jit, k) { return jit[((k % jit.length) + jit.length) % jit.length]; }
      function fillShape(poly, y0, y1) {
        g.beginPath(); g.moveTo(poly[0].x + sw(poly[0].y), poly[0].y);
        for (var k = 1; k < poly.length; k++) g.lineTo(poly[k].x + sw(poly[k].y), poly[k].y);
        g.closePath();
        var gr = g.createLinearGradient(0, y1, 0, y0);
        gr.addColorStop(0, C[2]); gr.addColorStop(0.45, C[1]); gr.addColorStop(1, C[0]);
        g.fillStyle = gr; g.fill();
      }
      function needles(pts, dx, dy, len, col, width, jit, off) {
        g.strokeStyle = col; g.lineWidth = width; g.beginPath();
        for (var k = 0; k < pts.length; k++) {
          var p = pts[k], l = len * (0.7 + 0.6 * J(jit, k + off)), a = 0.5 * (J(jit, k * 3 + off) - 0.5);
          var ex = dx * Math.cos(a) - dy * Math.sin(a), ey = dx * Math.sin(a) + dy * Math.cos(a);
          g.moveTo(p.x + sw(p.y), p.y); g.lineTo(p.x + sw(p.y) + ex * l, p.y + ey * l);
        }
        g.stroke();
      }
      // a point on a polyline, by fraction of its points
      function along(poly, t) {
        var x = t * (poly.length - 1), k = Math.min(poly.length - 2, Math.floor(x)), f = x - k;
        return { x: lerp(poly[k].x, poly[k + 1].x, f), y: lerp(poly[k].y, poly[k + 1].y, f) };
      }
      function tier(b, a0, a1, jit) {
        var to = Math.min(a1, b.len), from = Math.max(0, a0);
        if (to - from < 0.06 || to < 0.3) return;               // a flush stub carries no needles
        var rise = F.rise * (0.55 + 0.45 * b.len / 2), drop = F.drop, n = 9, top = [], bot = [], k, s, P, u;
        var over = -b.s * (0.08 + 0.12 * J(jit, 40));                 // cross the stem a little, so the two sides never meet in a straight seam
        if (from <= 0.001) top.push({ x: over, y: b.y + rise + 0.02 });
        for (k = 0; k <= n; k++) {
          s = lerp(from, to, k / n); P = arcPoint(b, s); u = s / b.len;
          top.push({ x: P.x, y: P.y + rise * Math.pow(1 - u, 1.3) + 0.03 });
          bot.push({ x: P.x, y: P.y - drop * (0.7 + 0.5 * u) });
        }
        var end = arcPoint(b, to), tipped = to >= b.len - 0.02;
        var tip = { x: end.x + (tipped ? Math.cos(end.ang) * 0.16 : 0), y: end.y + (tipped ? Math.sin(end.ang) * 0.16 - 0.04 : 0) };
        if (from <= 0.001) bot.unshift({ x: over, y: b.y - drop * 0.6 });
        // the lower edge, back toward the stem, as a fringe of needle tufts
        var poly = top.concat([tip]), fr = [];
        for (k = bot.length - 1; k > 0; k--) {
          var A = bot[k], B = bot[k - 1];
          for (var q = 0; q < 2; q++) {
            var t = (q + 0.5) / 2, d = F.fringe * (0.6 + 0.8 * J(jit, k * 2 + q));
            var m = { x: lerp(A.x, B.x, t) + b.s * d * 0.35, y: lerp(A.y, B.y, t) - d };
            poly.push(m); fr.push(m);
            poly.push({ x: lerp(A.x, B.x, t + 0.25), y: lerp(A.y, B.y, t + 0.25) });
          }
        }
        poly.push(bot[0]);
        fillShape(poly, Math.min(tip.y, bot[0].y) - F.fringe, top[0].y);
        // needle texture: sunlit along the top, mid tones over the body, dark tufts on the fringe
        var topPts = [], body = [], kk;
        for (kk = 0; kk < 26; kk++) topPts.push(along(top.concat([tip]), kk / 26));
        for (kk = 0; kk < 40; kk++) {
          var t1 = J(jit, kk * 5 + 1), t2 = 0.15 + 0.7 * J(jit, kk * 7 + 2), pa = along(top, t1), pb = along(bot, t1);
          body.push({ x: lerp(pa.x, pb.x, t2), y: lerp(pa.y, pb.y, t2) });
        }
        needles(body, b.s * 0.75, -0.66, 0.13, C[0], 0.022, jit, 3);
        needles(body.slice(0, 22), b.s * 0.8, -0.6, 0.11, C[2], 0.018, jit, 11);
        needles(topPts, b.s * 0.7, -0.72, 0.12, C[3], 0.017, jit, 5);
        needles(fr, b.s * 0.45, -0.9, 0.09, C[0], 0.022, jit, 7);
      }
      function spire(b, a0, a1, jit) {
        if (a1 < b.len * 0.6 || a0 > b.len * 0.4) return;
        var base = arcPoint(b, 0), tipP = arcPoint(b, b.len), ux = tipP.x - base.x, uy = tipP.y - base.y, L0 = Math.hypot(ux, uy) || 1;
        ux /= L0; uy /= L0;
        base = { x: base.x - ux * 0.4, y: base.y - uy * 0.4 }; L0 += 0.4;      // sink the spire into the top tier
        var nx = -uy, ny = ux, H = L0 + 0.2, steps = 4, poly = [], k, w0 = F.spireW;
        function at(h, w) { return { x: base.x + ux * h + nx * w, y: base.y + uy * h + ny * w }; }
        poly.push(at(H, 0));
        for (k = 1; k <= steps; k++) {                          // a zigzag cone: small tiers to the tip
          var h = H * (1 - k / steps) - 0.05, w = w0 * (0.25 + 0.75 * k / steps);
          poly.push(at(h + 0.18 * (1 - k / steps) + 0.06, w * 0.45));
          poly.push(at(h - 0.02, w * (0.95 + 0.2 * J(jit, k))));
        }
        for (k = steps; k >= 1; k--) {
          var h2 = H * (1 - k / steps) - 0.05, w2 = w0 * (0.25 + 0.75 * k / steps);
          poly.push(at(h2 - 0.02, -w2 * (0.95 + 0.2 * J(jit, k + 9))));
          poly.push(at(h2 + 0.18 * (1 - k / steps) + 0.06, -w2 * 0.45));
        }
        fillShape(poly, base.y - 0.1, base.y + H);
        var pts = [];
        for (k = 0; k < 24; k++) { var hh = H * (0.05 + 0.85 * J(jit, k * 3)), ww = w0 * (1 - hh / H) * (J(jit, k * 5 + 1) * 2 - 1) * 0.8; pts.push(at(hh, ww)); }
        needles(pts.slice(0, 12), -0.7, -0.7, 0.1, C[3], 0.016, jit, 2);
        needles(pts.slice(12), 0.7, -0.7, 0.1, C[2], 0.016, jit, 4);
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
          drawBranch(b, 0, withLimbs ? limbStub(b) : b.len, hStar, swayOn);
        }
        drawTrunkPart(hStar, HC.TRUNK_H, hStar);
        if (hStar > 0) drawSplinter(false, hStar);
        var list = [];
        for (i = 0; i < br.length; i++) {
          b = br[i];
          if (b.y < hStar || b.crushed) continue;
          list.push({ b: b, a0: 0, a1: withLimbs ? limbStub(b) : b.len });
        }
        drawCanopy(list, hStar, swayOn);
      });
    }
    function drawStump(hStar) {
      var br = game.tree.branches, b, i;
      frame(sx(0), sy(0), 0, function () {
        for (i = 0; i < br.length; i++) { b = br[i]; if (b.y < hStar) drawBranch(b, 0, b.len, 0, false); }
        drawTrunkPart(0, hStar, 0);
        drawSplinter(true, 0);
        var list = [];
        for (i = 0; i < br.length; i++) { b = br[i]; if (b.y < hStar) list.push({ b: b, a0: 0, a1: b.len }); }
        drawCanopy(list, 0, false);
      });
    }
    function drawShadow(x0, x1, y) {
      var cx = sx((x0 + x1) / 2), cy = sy(y), R = Math.max(10, Math.abs(x1 - x0) * cam.s * 0.55);
      g.save(); g.translate(cx, cy); g.scale(1, 0.16);
      var gr = g.createRadialGradient(0, 0, 2, 0, 0, R);
      gr.addColorStop(0, "rgba(8,5,2,0.55)"); gr.addColorStop(1, "rgba(8,5,2,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.restore();
    }
    /* A limb part that has been cut off: drawn in the log's frame, where it grew,
       then carried by the piece's own motion (moved from where it was cut, and
       turned about the cut). */
    function drawPieces() {
      var ps = game.pieces, lg = game.log;
      if (!lg) return;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i], fade = clamp((2.2 - p.age) / 0.6, 0, 1);
        g.save(); g.globalAlpha = fade;
        g.translate(sx(p.ox), sy(p.oy)); g.rotate(-p.rot); g.translate(-sx(p.ox0), -sy(p.oy0));
        frame(sx(lg.bx), sy(lg.by), lg.dir * Math.PI / 2, function () {
          drawBranch(p.b, p.from, p.b.len, lg.hStar, false);
          drawCanopy([{ b: p.b, a0: p.from, a1: p.b.len }], lg.hStar, false);
        });
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
          if (p.kind === "leaf") { g.beginPath(); g.ellipse(0, 0, sz, sz * (look().needles ? 0.12 : 0.5), 0, 0, TAU); g.fill(); }
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
      var gr = g.createLinearGradient(0, cy - saw.ty * 0.5, 0, cy + saw.ty * 0.5), bk = look().bark;
      gr.addColorStop(0, bk[0]); gr.addColorStop(0.22, bk[1]); gr.addColorStop(0.5, bk[2]);
      gr.addColorStop(0.78, bk[3]); gr.addColorStop(1, bk[4]);
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
        if (handoff > 1.35) { handoff = -1; if (opts.onBlank) opts.onBlank(game.blank, src && src.felled ? src : null); }
      }
      if (game.phase === "saw") audio.saw(clamp(sawSpeed, 0, 1) * (pointer.active && game.saw && game.saw.active ? 1 : 0));
      else audio.saw(0);
      uiT += dt;
      if (uiT > 0.1) { uiT = 0; updateHud(); }
    }

    /* dbg (tests only): { still, noTree, noParts } skip the shake, the tree, the particles;
       { flat: "#rrggbb" } paints that one colour instead of the sky and ground, so a test can
       tell tree pixels from background pixels without depending on what the scenery happens to be. */
    function render(dt, dbg) {
      dbg = dbg || {};
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      var shx = 0, shy = 0;
      if (shake > 0 && !dbg.still) { shx = (Math.random() - 0.5) * 7 * shake; shy = (Math.random() - 0.5) * 7 * shake; }
      g.translate(shx, shy);
      g.fillStyle = "#120d09"; g.fillRect(-10, -10, W + 20, Hh + 20);
      var groundPy = sy(0);
      if (sawBlend < 1 || game.phase !== "saw" && game.phase !== "done") {
        if (dbg.flat) { g.fillStyle = dbg.flat; g.fillRect(-10, -10, W + 20, Hh + 20); }
        else { drawSky(groundPy); drawGround(groundPy); }
        var ph = game.phase;
        if (dbg.noTree) {
          // tests only: the scene without the tree, to see what is behind it
        } else if (ph === "chop") {
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
        if (!dbg.noParts) { drawParts(dt); drawTrail(); }
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
      var whose = src ? "Your " + look().name.toLowerCase() + " from plot " + (src.plot + 1) + "." : "Practice tree, " + look().name.toLowerCase() + ". Nothing it gives is kept: grow a tree on the farm for wood to keep.";
      setHint(whose + " <b>Swipe into the trunk from the side.</b> Cuts land where your finger is.<br />Quick swipes bite. Keep chopping until it cracks.");
      toastEl.classList.remove("on"); toastT = 0;
      parts.length = 0; trail.length = 0; sawBlend = 0; handoff = -1; swayAmp = 0.05; shake = 0;
      cam = camChop(); camStart = camEnd = null; layoutSaw(); updateHud();
    }
    function reset() { pickSource(); game.reset(null, pickWood(null)); begin(); }
    /* A tree nobody has touched yet can be swapped for the one the farm offers now. */
    function untouched() { return game.phase === "chop" && game.swings === 0; }
    function sameSource(a, b) { return a === b || (!!a && !!b && a.plot === b.plot && a.wood === b.wood); }
    function refresh() { if (untouched() && !sameSource(src, opts.source ? opts.source() : null)) reset(); }
    function show() {
      if (game.phase === "done") reset();         // that harvest went to the lathe; start a fresh tree
      else refresh();                            // a farm tree grew since this one was set up
      resize();
      if (!running) { running = true; last = performance.now(); root.requestAnimationFrame(loop); }
    }
    function hide() { running = false; audio.saw(0); pointer.active = false; pointer.id = null; }
    root.addEventListener("resize", function () { if (running) resize(); });
    document.getElementById("hSoundBtn").addEventListener("click", function () { audio.toggle(); });
    begin();

    return { show: show, hide: hide, reset: reset, refresh: refresh, resize: resize, game: game, get source() { return src; }, get cam() { return cam; }, get saw() { return saw; },
      get running() { return running; }, update: update, render: render };
  }

  L.createHarvest = createHarvest;

  /* The page shell (farm-ui.js) shows and hides the harvest screen through
     this host. The view is built the first time the screen is opened, when
     its stage has a size, and a finished blank goes to the lathe. */
  var view = null;
  /* The farm and the shared state, once the page shell has made them. */
  function host() { return root.__farm || null; }
  function source() {
    var h = host();
    if (!h) return null;
    var f = h.farm, G = root.Game, i = G.harvestPlot;
    return i >= 0 && f.isMature(f.plotAt(i)) ? { plot: i, wood: f.plotAt(i).wood } : null;
  }
  function onFelled(src) {
    var h = host();
    if (!h) return false;
    var p = h.farm.plotAt(src.plot);
    if (!p || p.wood !== src.wood) return false;
    if (root.Game.harvestPlot === src.plot) root.Game.harvestPlot = -1;
    return h.farm.fell(src.plot).ok;        // the log is in the shed now, so leaving mid-harvest loses nothing
  }
  /* A sawn blank: from a farm tree, its log in the shed becomes a blank;
     from a practice tree it goes straight to the lathe and is not kept. */
  function onBlank(blank, src) {
    var h = host(), G = root.Game, item = null;
    if (src && h && h.state.inventory.take("log", src.wood)) {
      item = h.state.inventory.add("blank", {
        wood: src.wood, seed: blank.seed, profile: G.State.pack(blank.profile),
        lengthUnits: blank.lengthUnits, lengthRatio: blank.lengthRatio, girthUnits: blank.girthUnits
      });
    }
    if (!(item && L.mountStock && L.mountStock({ kind: "blank", id: item.id }))) L.mountBlank(blank);
    G.showScreen("lathe");
  }
  L.harvestHost = {
    show: function () {
      if (!view) {
        view = createHarvest({ source: source, onFelled: onFelled, onBlank: onBlank });
        root.__harvest = view;
      }
      view.show();
    },
    /* The farm asked to harvest a particular tree: start over on it, unless
       it is the very tree already standing here. A tree felled earlier and
       left mid-harvest is already a log in the shed, so nothing is lost. */
    fresh: function () {
      if (!view) return;
      var s = view.source, want = root.Game.harvestPlot;
      if (s && !s.felled && s.plot === want && view.game.phase !== "done") return;
      view.reset();
    },
    hide: function () { if (view) view.hide(); }
  };
})(window);

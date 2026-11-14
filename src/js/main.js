/* ============================================================
   THE LATHE: wiring. Owns the lathe's state, turns pointer input
   into (axial position, pressure), steps the cutting model, and
   hands the result to whichever view is showing.

   Stock: what is on the lathe. A log or a blank from the shared
   inventory (state.js), or a practice blank that belongs to no one.
   Real stock stays in the shed until DONE, which takes it out and
   puts the turned piece in its place, with its profile and paint
   kept so a commission can grade it. Practice work is never kept.

   Input model (see docs/lathe-feel-fix.md):
   - Touch down anywhere below the wood: the chisel snaps onto
     the wood surface at the finger's x. Contact, no cut yet.
   - Nudge up: the first ~40px of upward travel ramps pressure
     from zero to full. Pressure sets the depth of the pass.
   - The tip rides the bottom of the cut, so the finger stays
     below the wood and the cut is never covered.
   ============================================================ */
(function (root) {
  "use strict";
  var L = root.Lathe;
  var errBox = document.getElementById("err");
  function showErr(msg) { errBox.style.display = "block"; errBox.textContent = "Error: " + msg; }
  root.addEventListener("error", function (e) { showErr(e.message || e.type); });
  root.addEventListener("unhandledrejection", function (e) { showErr(e.reason && e.reason.message ? e.reason.message : e.reason); });

  // Boot a tick late so the page shell paints before WebGL/shader setup.
  setTimeout(boot, 30);

  function boot() {
    var C = L.CFG, audio = L.audio, P = L.Paint;
    var stage = document.getElementById("stage");

    var S = {
      work: new L.Workpiece(),
      coat: new P.Coating(),            // paint and finish on the piece (paint.js)
      pressure: new L.Pressure(),
      mode: "cut",                      // cut | paint | finish
      tip: "gouge",
      paintTool: "brush",               // brush | liner
      color: "crimson",                 // a P.PALETTE key
      spec: null,                       // the paint spec to match (a commission supplies this)
      lightLevel: 0,                    // the workshop's work light tier (view3d WORK_LIGHTS)
      order: null,                      // the commission being turned (commissions.js), or null
      target: null,                     // its target profile: SEG radii, drawn as a ghost to turn down to
      stock: null,                      // what is mounted: null (practice), { kind: "log", key: wood } or { kind: "blank", id }
      wood: null,                       // the wood of the stock, null for practice
      flow: 0,                          // brush / spray activity 0..1, drives the sound
      rpm: 1100,
      spinAngle: 0,
      cutIntensity: 0,
      shake: 0,
      catchCooldown: 0,
      everCut: false,
      reduceMotion: !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches),
      pointer: { active: false, hover: false, id: null, x: 0, y: 0, t: 0.5 },
      // what the views draw: rest (parked), hover (mouse over, just off the wood), contact (on the wood)
      tool: { mode: "rest", t: 0.5, r: C.R0, lift: 0 },
      lastT: -1
    };
    root.__lathe = S; // handy in the console and for the browser tests

    /* ---------------- views ---------------- */
    var view3d = null, view2d = null, view = null;
    var viewBtn = document.getElementById("viewBtn");
    function useView(v) {
      if (view === v) return;
      if (view) view.hide();
      view = v;
      view.show();
      viewBtn.textContent = view.kind === "3d" ? "2D VIEW" : "3D VIEW";
      viewBtn.style.display = view3d ? "" : "none";
    }
    function fallBackTo2D() { if (view && view.kind === "3d") useView(view2d); }
    view2d = L.createView2D(stage, S);
    try { view3d = L.createView3D(stage, S, fallBackTo2D); } catch (e) { view3d = null; }
    var forced = /[?&]view=2d\b/.test(location.search);
    useView(view3d && !forced ? view3d : view2d);
    viewBtn.addEventListener("click", function () { useView(view.kind === "3d" ? view2d : (view3d || view2d)); });
    root.addEventListener("resize", function () { view.resize(); });

    /* ---------------- input ---------------- */
    function now() { return performance.now() / 1000; }
    function setPointerXY(e) {
      var rect = stage.getBoundingClientRect();
      var p = S.pointer;
      p.x = e.clientX - rect.left; p.y = e.clientY - rect.top;
      var lay = view.layout(), span = lay.right - lay.left;
      p.t = Math.min(1, Math.max(0, (p.x - lay.left) / (span || 1)));
    }
    stage.addEventListener("pointerdown", function (e) {
      if (S.pointer.active) return;
      audio.init();
      var p = S.pointer;
      p.active = true; p.id = e.pointerId;
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      setPointerXY(e);
      S.pressure.down(p.y, now());
      S.work.endPass();
      e.preventDefault();
    });
    stage.addEventListener("pointermove", function (e) {
      var p = S.pointer;
      if (p.active) {
        if (e.pointerId !== p.id) return;
        var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        if (!evs || !evs.length) evs = [e];
        for (var i = 0; i < evs.length; i++) {
          setPointerXY(evs[i]);
          if (S.pressure.move(p.y, (evs[i].timeStamp || performance.now()) / 1000)) onCatch();
        }
      } else if (e.pointerType === "mouse") {
        p.hover = true;
        setPointerXY(e);
      }
    });
    function endPointer(e) {
      var p = S.pointer;
      if (e.pointerId !== p.id) return;
      p.active = false; p.id = null;
      if (e.pointerType !== "mouse") p.hover = false;
      S.pressure.up();
      S.work.endPass();
    }
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    stage.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && !S.pointer.active) S.pointer.hover = false; });

    /* A catch: pressure slammed in all at once. The tool digs and gets
       knocked back off the wood, with a shake and a thump. */
    var cutflash = document.getElementById("cutflash");
    function onCatch() {
      if (S.catchCooldown > 0) return;
      S.catchCooldown = C.CATCH_COOLDOWN;
      S.shake = Math.min(1, S.shake + 0.8);
      cutflash.classList.add("on");
      setTimeout(function () { cutflash.classList.remove("on"); }, 110);
      audio.clunk();
    }

    /* ---------------- UI ---------------- */
    var rpmSlider = document.getElementById("rpm"), rpmVal = document.getElementById("rpmVal");
    S.rpm = parseInt(rpmSlider.value, 10);
    rpmSlider.addEventListener("input", function () { S.rpm = parseInt(rpmSlider.value, 10); rpmVal.textContent = S.rpm + " RPM"; });
    /* The chisel rack: one button per tip the workshop owns. Gouge and skew are in
       the page; tips bought at Arbor Freight (shop.js) get a button here. */
    var tipGroup = document.getElementById("toolsCut");
    var TIP_ICON = {
      parting: '<svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true"><path d="M15 3h4v18l-2 6-2-6z" fill="none" stroke="#e8a33d" stroke-width="2.2" stroke-linejoin="round"/></svg>',
      detail: '<svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true"><path d="M10 6h14v6c0 4-3 7-7 7s-7-3-7-7z" fill="none" stroke="#e8a33d" stroke-width="2.2"/></svg>',
      roughing: '<svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true"><path d="M2 3h30v9c0 8-7 15-15 15S2 20 2 12z" fill="none" stroke="#e8a33d" stroke-width="2.4"/><path d="M8 7v5c0 5 4 9 9 9s9-4 9-9V7" fill="none" stroke="#e8a33d" stroke-width="1.4" opacity="0.55"/></svg>'
    };
    S.tips = ["gouge", "skew"];
    function tipButtons() { return Array.prototype.slice.call(tipGroup.querySelectorAll("[data-tip]")); }
    function setTip(t) {
      if (S.tips.indexOf(t) < 0) return;
      S.tip = t;
      tipButtons().forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-tip") === t ? "true" : "false"); });
    }
    function setTips(list) {
      S.tips = L.TIP_ORDER.filter(function (k) { return list.indexOf(k) >= 0; });
      S.tips.forEach(function (k) {
        if (tipGroup.querySelector('[data-tip="' + k + '"]')) return;
        var tp = L.TIPS[k], b = document.createElement("button");
        b.className = "tip-btn"; b.type = "button"; b.id = "tip" + k.charAt(0).toUpperCase() + k.slice(1);
        b.setAttribute("data-tip", k); b.setAttribute("aria-pressed", "false");
        b.innerHTML = (TIP_ICON[k] || "") + '<span><span class="tname">' + tp.name.toUpperCase() + '</span><div class="tdesc">' + tp.desc + "</div></span>";
        tipGroup.appendChild(b);
      });
      tipButtons().forEach(function (b) { b.hidden = S.tips.indexOf(b.getAttribute("data-tip")) < 0; });
      tipGroup.classList.toggle("many", S.tips.length > 2);
      tipGroup.style.gridTemplateColumns = S.tips.length > 2 ? "repeat(" + (S.tips.length > 4 ? 3 : 2) + ", 1fr)" : "";
      if (S.tips.indexOf(S.tip) < 0) setTip("gouge"); else setTip(S.tip);
    }
    tipGroup.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (b) { audio.init(); setTip(b.getAttribute("data-tip")); }
    });
    root.addEventListener("keydown", function (e) {
      if (e.key === "1") setTip("gouge");        // 3, 4 and 5 switch modes, so only the first two tips have keys
      if (e.key === "2") setTip("skew");
    });
    /* What the workshop has bought at Arbor Freight: the light over the lathe,
       the motor (how fast wood comes off) and the chisels on the rack. */
    S.cutBoost = 1;                     // set from the motor the workshop owns (shop.js); 1 only before the shop loads
    function applyUpgrades() {
      var shop = root.Game && root.Game.shop;
      if (!shop) return;
      S.lightLevel = shop.lightLevel();
      S.cutBoost = shop.cutBoost();
      S.brushTool = shop.brush();     // the store's brushes and sprayer (paint.js brush / spray)
      S.sprayGun = shop.spray();
      var fn = document.getElementById("finishName");     // the finish panel names the sprayer the workshop owns
      if (fn && shop.current("finish")) fn.textContent = shop.current("finish").name.toUpperCase();
      setTips(shop.tips());
    }
    L.applyUpgrades = applyUpgrades;
    var hint = document.getElementById("hint");
    var HINTS = {
      cut: hint.innerHTML,
      paint: "<b>Touch below the log, then nudge up</b> to lay paint. Slow and steady gives a solid coat.<br />Whip across fast for a thin streak. Change colour mid-spin to blend a gradient.",
      finish: "<b>Touch below the log, then nudge up</b> to spray. Sweep slowly for an even sheen.<br />Watch the lamp: gloss catches the light, matte stays flat."
    };
    var used = { cut: false, paint: false, finish: false };
    var statRemoved = document.getElementById("statRemoved"), statDepth = document.getElementById("statDepth"), statShape = document.getElementById("statShape");
    /* Mount a blank: the harvested one, or a practice blank when none is given. */
    var hintPractice = hint.innerHTML;
    var hintFresh = "<b>Fresh from the saw.</b> Touch below the log, then nudge up to push the chisel in.<br />Slow and steady cuts deep. Whip across fast and you only score the surface.";
    function mount(blank, stock) {
      if (blank) S.work.load(blank); else S.work.reset();
      setStock(stock || null);
      S.lastT = -1; S.everCut = false;
      S.pointer.active = false; S.pointer.id = null; S.pressure.up();
      statDepth.innerHTML = "0.0<small> mm</small>";
      hint.innerHTML = blank ? hintFresh : HINTS[S.mode];
      hint.classList.remove("gone"); used.cut = false;
      S.coat.reset();
      drawProfile(); drawSpec(); updateSpecInfo();
    }
    L.mountBlank = mount;     // the harvest hands its blank over through this
    document.getElementById("newLogBtn").addEventListener("click", function () { closeStock(); mount(null); });

    /* ---------------- stock: the shed's logs and blanks, and DONE ---------------- */
    var G = root.Game, R = G.Registry, St = G.State;
    function shared() { return G.state || null; }
    var stockBtn = document.getElementById("stockBtn"), stockLabel = document.getElementById("stockLabel");
    var stockMenu = document.getElementById("stockMenu"), doneBtn = document.getElementById("doneBtn");
    var ltoast = document.getElementById("ltoast"), ltoastTimer = 0;
    function toast(msg) {
      ltoast.textContent = msg; ltoast.classList.add("on");
      clearTimeout(ltoastTimer);
      ltoastTimer = setTimeout(function () { ltoast.classList.remove("on"); }, 3400);
    }
    function woodName(id) { return R.WOODS[id] ? R.WOODS[id].name : "Wood"; }
    function stockName(st) {
      if (!st) return "Practice";
      return woodName(S.wood) + " " + R.ITEMS[st.kind].name.toLowerCase();
    }
    function setStock(st) {
      var inv = shared() && shared().inventory;
      S.stock = st; S.wood = null;
      if (st && inv) {
        if (st.kind === "log") S.wood = st.key;
        else { var it = inv.get(st.id); S.wood = it ? it.wood : null; if (!it) S.stock = null; }
      } else S.stock = null;
      stockLabel.textContent = stockName(S.stock).toUpperCase();
      doneBtn.setAttribute("aria-disabled", S.stock ? "false" : "true");
      if (typeof updateOrderNote === "function") updateOrderNote();
    }
    /* Mount something from the shed. Nothing leaves the shed until DONE. */
    function mountStock(st) {
      var inv = shared() && shared().inventory;
      if (!st || !inv) { mount(null); return false; }
      if (st.kind === "log") {
        if (!inv.count("log", st.key)) return false;
        mount(null, st);
        return true;
      }
      var it = inv.get(st.id);
      if (!it || it.kind !== "blank") return false;
      mount({ species: it.wood, seed: it.seed, profile: St.unpack(it.profile), lengthUnits: it.lengthUnits, lengthRatio: it.lengthRatio, girthUnits: it.girthUnits }, { kind: "blank", id: it.id });
      return true;
    }
    L.mountStock = mountStock;

    function isMounted(st) {
      var c = S.stock;
      return !!c && !!st && c.kind === st.kind && (st.kind === "log" ? c.key === st.key : c.id === st.id);
    }
    function closeStock() { stockMenu.hidden = true; stockBtn.setAttribute("aria-expanded", "false"); }
    function openStock() {
      var inv = shared() && shared().inventory, h = "";
      h += "<h2>WHAT TO TURN</h2><p>Pick a log or a blank from the shed. It stays in the shed until you press DONE. Switching starts over on the new wood.</p>";
      h += '<div class="stock-list">';
      h += '<button type="button" class="stock-opt" data-stock="practice" aria-pressed="' + (S.stock ? "false" : "true") + '"><i style="background:#c99a5e"></i><span><b>Practice blank</b><small>Free, but nothing you turn on it is kept</small></span></button>';
      if (inv) {
        inv.list("blank").forEach(function (it) {
          var st = { kind: "blank", id: it.id }, w = R.WOODS[it.wood];
          h += '<button type="button" class="stock-opt" data-stock="blank" data-id="' + it.id + '" aria-pressed="' + isMounted(st) + '"><i style="background:' + (w ? w.trunk : "#c99a5e") + '"></i><span><b>' + woodName(it.wood) + ' blank</b><small>Sawn in the forest, shaped like its log</small></span></button>';
        });
        inv.list("log").forEach(function (s) {
          var st = { kind: "log", key: s.key }, w = R.WOODS[s.key];
          h += '<button type="button" class="stock-opt" data-stock="log" data-key="' + s.key + '" aria-pressed="' + isMounted(st) + '"><i style="background:' + w.trunk + '"></i><span><b>' + w.name + ' log</b><small>A round log, straight from the shed</small></span><span class="n">' + s.count + "</span></button>";
        });
        if (!inv.count("blank") && !inv.count("log")) h += "<p>The shed is empty. Grow a tree on the farm, then chop or harvest it.</p>";
      }
      h += "</div>";
      stockMenu.innerHTML = h;
      stockMenu.hidden = false;
      stockBtn.setAttribute("aria-expanded", "true");
    }
    stockBtn.addEventListener("click", function () { if (stockMenu.hidden) openStock(); else closeStock(); });
    stockMenu.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-stock]") : null;
      if (!b) return;
      var kind = b.getAttribute("data-stock");
      closeStock();
      if (kind === "practice") { mount(null); return; }
      var st = kind === "log" ? { kind: "log", key: b.getAttribute("data-key") } : { kind: "blank", id: parseInt(b.getAttribute("data-id"), 10) };
      if (isMounted(st)) return;
      if (mountStock(st)) toast(stockName(S.stock) + " on the lathe.");
    });
    // the menu sits on the stage: a tap on it is not a cut, and a tap anywhere else closes it
    stockMenu.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    stage.addEventListener("pointerdown", function (e) { if (!stockMenu.contains(e.target)) closeStock(); }, true);
    root.addEventListener("keydown", function (e) { if (e.key === "Escape" && !stockMenu.hidden) closeStock(); });

    /* Take the piece off the lathe: the stock leaves the shed and the
       turned piece goes in, with everything a commission needs to grade it. */
    function finishPiece() {
      var sh = shared();
      if (!S.stock || !sh) { toast("Practice piece. Mount a log or blank from the shed to keep what you turn."); return null; }
      var shape = L.shapeName(S.work);
      if (shape === "Blank") { toast("Turn it first. Nothing has been cut yet."); return null; }
      var wood = S.wood, from = S.stock.kind;
      var took = from === "log" ? sh.inventory.take("log", S.stock.key) : sh.inventory.take("blank", S.stock.id);
      if (!took) { setStock(null); toast("That wood is no longer in the shed, so this is now a practice piece."); return null; }
      var m = S.spec ? P.matchSpec(S.spec, S.coat) : null;
      var piece = sh.inventory.add("piece", {
        wood: wood, from: from, shape: shape,
        profile: St.pack(S.work.radius),
        start: St.pack(S.work.baseRadius),
        order: S.order ? S.order.id : null,
        coat: { coat: St.pack(S.coat.coat, 3), color: St.pack(S.coat.color, 3), gloss: St.pack(S.coat.gloss, 3) },
        sheen: m ? m.sheen : null,
        spec: S.spec || null,
        match: m ? Math.round(m.total * 1000) / 1000 : null,
        removed: Math.round(S.work.removedFraction() * 1000) / 1000
      });
      var order = S.order;
      mount(null);
      if (order && order.wood === wood && G.OrdersUI) G.OrdersUI.offer(order.id, piece.id);
      else if (order) toast(woodName(wood) + " piece added to the shed. " + order.client + " wants " + woodName(order.wood).toLowerCase() + ", so it cannot go to them.");
      else toast(woodName(wood) + " piece added to the shed.");
      return piece;
    }
    doneBtn.addEventListener("click", function () { audio.init(); closeStock(); finishPiece(); });
    var soundBtn = document.getElementById("soundBtn");
    soundBtn.addEventListener("click", function () {
      audio.setOn(!audio.on);
      soundBtn.setAttribute("aria-pressed", audio.on ? "true" : "false");
    });

    /* ---------------- modes: cut, paint, finish ---------------- */
    var modeBtns = { cut: document.getElementById("modeCut"), paint: document.getElementById("modePaint"), finish: document.getElementById("modeFinish") };
    var panels = { cut: document.getElementById("toolsCut"), paint: document.getElementById("toolsPaint"), finish: document.getElementById("toolsFinish") };
    var profileBar = document.getElementById("profileBar"), specBar = document.getElementById("specBar");
    var PITCH = { cut: 1, paint: 0.42, finish: 2.6 };   // brush swish is soft and low, the spray a high hiss
    function setMode(m) {
      if (!panels[m]) return;
      S.mode = m;
      S.pressure.catches = m === "cut";
      S.flow = 0;
      for (var k in modeBtns) {
        modeBtns[k].setAttribute("aria-pressed", k === m ? "true" : "false");
        panels[k].hidden = k !== m;
      }
      profileBar.hidden = m !== "cut";
      specBar.hidden = m === "cut";
      audio.pitch = PITCH[m];
      hint.innerHTML = HINTS[m];
      hint.classList.toggle("gone", used[m]);
      root.dispatchEvent(new Event("resize"));   // the footer changed height, so the stage did too
      drawProfile(); drawSpec(); updateSpecInfo();
    }
    modeBtns.cut.addEventListener("click", function () { audio.init(); setMode("cut"); });
    modeBtns.paint.addEventListener("click", function () { audio.init(); setMode("paint"); });
    modeBtns.finish.addEventListener("click", function () { audio.init(); setMode("finish"); });
    root.addEventListener("keydown", function (e) {
      if (e.key === "3") { setMode("cut"); }
      else if (e.key === "4") { setMode("paint"); }
      else if (e.key === "5") { setMode("finish"); }
    });

    /* paint choices: only palette colours, and the ones the spec needs wear a marker */
    var swatchWrap = document.getElementById("swatches"), swatchEls = {};
    P.PALETTE_ORDER.forEach(function (key) {
      var def = P.PALETTE[key], b = document.createElement("button");
      b.className = "swatch"; b.type = "button"; b.dataset.color = key;
      b.style.setProperty("--sw", def.hex);
      b.setAttribute("aria-label", def.name); b.title = def.name;
      b.setAttribute("aria-pressed", key === S.color ? "true" : "false");
      b.addEventListener("click", function () { audio.init(); setColor(key); });
      swatchWrap.appendChild(b); swatchEls[key] = b;
    });
    function setColor(key) {
      if (!P.PALETTE[key]) return;
      S.color = key;
      for (var k in swatchEls) swatchEls[k].setAttribute("aria-pressed", k === key ? "true" : "false");
    }
    var brushWideBtn = document.getElementById("brushWide"), brushLinerBtn = document.getElementById("brushLiner");
    function setBrush(t) {
      S.paintTool = t;
      brushWideBtn.setAttribute("aria-pressed", t === "brush" ? "true" : "false");
      brushLinerBtn.setAttribute("aria-pressed", t === "liner" ? "true" : "false");
    }
    brushWideBtn.addEventListener("click", function () { audio.init(); setBrush("brush"); });
    brushLinerBtn.addEventListener("click", function () { audio.init(); setBrush("liner"); });

    /* the paint spec: what the painting has to look like. A commission supplies one;
       until commissions land the lathe rolls its own so there is always something to match. */
    var specTag = document.getElementById("specTag"), specName = document.getElementById("specName"), specMatch = document.getElementById("specMatch"), specSheen = document.getElementById("specSheen");
    var specCanvas = document.getElementById("specCanvas"), specCtx = specCanvas.getContext("2d");
    function setSpec(spec) {
      if (!P.validSpec(spec)) return false;
      S.spec = spec;
      var need = P.specPaints(spec);
      for (var k in swatchEls) swatchEls[k].classList.toggle("needed", need.indexOf(k) >= 0);
      specName.textContent = S.order ? pieceName(S.order) + " · " + spec.name : spec.name;
      // with no commission on the lathe the spec is only for practice: say so, so it is never taken for an order
      updateOrderNote();
      drawSpec(); updateSpecInfo();
      return true;
    }
    var specNewBtn = document.getElementById("specNewBtn");
    specNewBtn.addEventListener("click", function () {
      if (S.order) { if (G.showScreen) G.showScreen("orders"); return; }
      setSpec(P.generateSpec());
    });

    /* ---------------- the commission on the lathe ----------------
       The board (commissions.js) says which order is active. Its target shape
       is drawn as a ghost on the piece and in the profile strip, its paint spec
       goes on the spec card, and DONE offers the piece to it. */
    function board() { return G.commissions || null; }
    function pieceName(o) { var d = G.Commissions && G.Commissions.PIECES[o.kind]; return d ? d.name : "Piece"; }
    var profileLabel = document.getElementById("profileLabel");
    function syncOrder() {
      var b = board(), o = b ? b.active() : null;
      if (o === S.order) return;
      S.order = o;
      S.target = o ? b.targetProfile(o) : null;
      specNewBtn.textContent = o ? "BOARD" : "NEW SPEC";
      specNewBtn.title = o ? "Back to the commission board" : "Roll a new paint spec";
      if (o) setSpec(o.spec); else setSpec(P.generateSpec());
      shapeShown = -1; updateShape();
      drawProfile();
    }
    L.syncOrder = syncOrder;
    /* Taking an order from the board: put the right wood on the lathe if the
       shed has some (a blank first, then a log), so the player can start. */
    function takeOrder() {
      syncOrder();
      var o = S.order, inv = shared() && shared().inventory;
      if (!o || !inv) return;
      if (S.stock && S.wood === o.wood) { toast(pieceName(o) + " for " + o.client + ". Turn it to the dashed line."); return; }
      var blanks = inv.list("blank", function (it) { return it.wood === o.wood; });
      var ok = blanks.length ? mountStock({ kind: "blank", id: blanks[0].id }) : inv.count("log", o.wood) ? mountStock({ kind: "log", key: o.wood }) : false;
      if (ok) toast(stockName(S.stock) + " on the lathe. Turn it to the dashed line.");
      else toast("No " + woodName(o.wood).toLowerCase() + " in the shed. Grow one on the farm. You can practise the shape meanwhile.");
    }
    L.takeOrder = takeOrder;
    /* Practise an order on a free practice blank: its shape and spec are on, the wood stays in the shed. */
    function practiseOrder() {
      syncOrder();
      if (!S.order) return;
      mount(null);
      toast("Practice blank on the lathe. Turn it to the line; it can't be delivered.");
    }
    L.practiseOrder = practiseOrder;
    /* With an order on, say plainly whether what is mounted can be delivered: any wood
       can be turned to the order's shape for practice, but only its own wood is accepted. */
    var orderNote = document.getElementById("orderNote");
    function deliverable() { return !!S.order && !!S.stock && S.wood === S.order.wood; }
    function updateOrderNote() {
      if (!orderNote || !specTag) return;   // early in boot, before these are found
      var o = S.order, ok = deliverable();
      if (!o) { specTag.textContent = "PRACTICE · NO ORDER"; specTag.className = "spec-tag"; orderNote.hidden = true; stage.classList.remove("has-note"); return; }
      var want = woodName(o.wood).toLowerCase();
      specTag.textContent = ok ? "COMMISSION · " + o.client.toUpperCase() : "PRACTICE ONLY · NEEDS " + want.toUpperCase();
      specTag.className = "spec-tag " + (ok ? "order" : "warn");
      orderNote.hidden = ok;
      stage.classList.toggle("has-note", !ok);
      if (!ok) orderNote.innerHTML = "<b>Practice only.</b> " + (S.stock ? "This is " + woodName(S.wood).toLowerCase() : "This is a practice blank") +
        ", so it can't be delivered. " + o.client + " needs " + want + ".";
    }
    var shapeShown = -1;
    function updateShape() {
      if (!S.target || !G.Commissions) { profileLabel.textContent = "PROFILE"; return; }
      var sc = Math.round(G.Commissions.shapeScore(S.work.radius, S.target, S.work.baseRadius).score * 100);
      if (sc === shapeShown) return;
      shapeShown = sc;
      profileLabel.innerHTML = "SHAPE<b>" + sc + "%</b>";
    }
    function rgbCss(c, a) { return "rgba(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + "," + (a == null ? 1 : a) + ")"; }
    var specDrawn = { version: -1, spec: null, w: 0 };
    function drawSpec() {
      if (specBar.hidden || !S.spec) return;
      var w = specCanvas.clientWidth, h = specCanvas.clientHeight;
      if (!w) return;
      // only repaint when the coat, the spec or the width changed: a canvas redraw is not free
      if (specDrawn.version === S.coat.version && specDrawn.spec === S.spec && specDrawn.w === w) return;
      specDrawn.version = S.coat.version; specDrawn.spec = S.spec; specDrawn.w = w;
      var dpr = Math.min(root.devicePixelRatio || 1, 2);
      if (specCanvas.width !== Math.round(w * dpr)) { specCanvas.width = Math.round(w * dpr); specCanvas.height = Math.round(h * dpr); }
      var g = specCtx, n = C.SEG, half = Math.floor(h / 2), i, j;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      var wood = P.CFG.WOOD_RGB, col = [0, 0, 0], cc = S.coat;
      // wanted (top row): the spec's bands
      S.spec.segments.forEach(function (sg) {
        g.fillStyle = rgbCss(sg.paint ? P.PALETTE[sg.paint].rgb : wood);
        g.fillRect(Math.floor(sg.a * w), 0, Math.ceil((sg.b - sg.a) * w) + 1, half);
      });
      // yours (bottom row): the coat over the wood, in runs of near-identical slices
      i = 0;
      while (i < n) {
        cc.shownColor(i, wood, col);
        j = i;
        while (j + 1 < n && Math.abs(cc.coat[j + 1] - cc.coat[i]) < 0.03 && Math.abs(cc.color[(j + 1) * 3] - cc.color[i * 3]) + Math.abs(cc.color[(j + 1) * 3 + 1] - cc.color[i * 3 + 1]) + Math.abs(cc.color[(j + 1) * 3 + 2] - cc.color[i * 3 + 2]) < 0.03) j++;
        g.fillStyle = rgbCss(col);
        g.fillRect(Math.floor(i / n * w), half, Math.ceil((j + 1) / n * w) - Math.floor(i / n * w), h - half);
        i = j + 1;
      }
      // gloss on yours: a bright streak along the top of the row, as strong as the sheen
      i = 0;
      while (i < n) {
        j = i;
        while (j + 1 < n && Math.abs(cc.gloss[j + 1] - cc.gloss[i]) < 0.04) j++;
        if (cc.gloss[i] >= 0.02) {
          g.fillStyle = "rgba(255,255,255," + (cc.gloss[i] * 0.4).toFixed(3) + ")";
          g.fillRect(Math.floor(i / n * w), half + 1, Math.ceil((j + 1) / n * w) - Math.floor(i / n * w), Math.max(2, (h - half) * 0.28));
        }
        i = j + 1;
      }
      g.strokeStyle = "rgba(20,14,8,0.8)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, half + 0.5); g.lineTo(w, half + 0.5); g.stroke();
      g.strokeStyle = "rgba(150,125,85,0.6)"; g.strokeRect(0.5, 0.5, w - 1, h - 1);
    }
    var lastMatch = null, infoSeen = { version: -1, spec: null };
    function updateSpecInfo() {
      if (!S.spec) return;
      if (infoSeen.version === S.coat.version && infoSeen.spec === S.spec) return;
      infoSeen.version = S.coat.version; infoSeen.spec = S.spec;
      var m = P.matchSpec(S.spec, S.coat);
      lastMatch = m;
      specMatch.textContent = String(Math.round(m.total * 100));
      var want = P.SHEEN[S.spec.sheen].name, have = P.SHEEN[m.sheen].name;
      specSheen.textContent = "Wants " + want.toLowerCase() + " finish, yours " + have.toLowerCase();
      specSheen.classList.toggle("ok", m.sheen === S.spec.sheen);
      var avg = S.coat.avgGloss();
      document.getElementById("glossFill").style.width = Math.round(avg * 100) + "%";
      document.getElementById("glossName").textContent = have;
    }

    /* ---------------- pressure meter: fills beside the finger ---------------- */
    var pmeter = document.getElementById("pmeter"), pfill = pmeter.firstChild;
    var meterOn = false;
    function updateMeter() {
      var p = S.pointer, on = p.active;
      if (on !== meterOn) { meterOn = on; pmeter.classList.toggle("on", on); }
      if (!on) return;
      var leftSide = p.x > stage.clientWidth - 60;
      pmeter.style.left = (p.x + (leftSide ? -36 : 28)) + "px";
      pmeter.style.top = (S.pressure.anchorY - C.PRESS_RAMP_PX) + "px";
      pfill.style.height = (S.pressure.value * 100).toFixed(1) + "%";
    }

    /* ---------------- profile strip + stats ---------------- */
    var profCanvas = document.getElementById("profileCanvas"), profCtx = profCanvas.getContext("2d");
    function drawProfile() {
      var w = profCanvas.clientWidth, h = profCanvas.clientHeight;
      if (!w) return;
      var dpr = Math.min(root.devicePixelRatio || 1, 2);
      if (profCanvas.width !== Math.round(w * dpr)) { profCanvas.width = Math.round(w * dpr); profCanvas.height = Math.round(h * dpr); }
      var g = profCtx, r = S.work.radius, n = r.length;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      var mid = h / 2, pad = 26, iw = w - pad * 2;
      g.strokeStyle = "rgba(150,125,85,0.5)"; g.setLineDash([3, 5]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(pad - 8, mid); g.lineTo(w - pad + 8, mid); g.stroke(); g.setLineDash([]);
      g.beginPath();
      for (var i = 0; i < n; i++) {
        var x = pad + (i / (n - 1)) * iw, y = mid - (r[i] / C.R0) * (mid - 3);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      for (var j = n - 1; j >= 0; j--) g.lineTo(pad + (j / (n - 1)) * iw, mid + (r[j] / C.R0) * (mid - 3));
      g.closePath();
      var grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#d9ab6d"); grad.addColorStop(0.5, "#c99a5e"); grad.addColorStop(1, "#a97a42");
      g.fillStyle = grad; g.fill();
      if (S.coat.coverage() > 0.001) {   // the paint, seen edge on
        g.save(); g.clip();
        var wood = P.CFG.WOOD_RGB, pc = [0, 0, 0], sw = iw / (n - 1) + 1;
        for (var q = 0; q < n; q++) {
          if (S.coat.coat[q] < 0.01) continue;
          S.coat.shownColor(q, wood, pc);
          g.globalAlpha = Math.min(1, S.coat.coat[q] * 1.05);
          g.fillStyle = "rgb(" + Math.round(pc[0] * 255) + "," + Math.round(pc[1] * 255) + "," + Math.round(pc[2] * 255) + ")";
          g.fillRect(pad + (q / (n - 1)) * iw - sw / 2, 0, sw, h);
        }
        g.restore();
      }
      g.strokeStyle = "rgba(70,45,20,0.6)"; g.lineWidth = 1; g.stroke();
      if (S.target) {                   // the commission's shape, to turn down to
        var tg = S.target;
        g.save(); g.setLineDash([4, 3]); g.strokeStyle = "#fff1c8"; g.lineWidth = 1.4;
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          g.beginPath();
          for (var ti = 0; ti < n; ti++) {
            var tx = pad + (ti / (n - 1)) * iw, ty = mid + sgn * (tg[ti] / C.R0) * (mid - 3);
            if (ti === 0) g.moveTo(tx, ty); else g.lineTo(tx, ty);
          }
          g.stroke();
        }
        g.restore();
      }
      if (S.lastT >= 0 && S.pointer.active) {
        var cx = pad + S.lastT * iw;
        g.strokeStyle = "#e8a33d"; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx, 2); g.lineTo(cx, h - 2); g.stroke();
      }
    }
    var statTick = 0;
    function updateStats(dt) {
      statTick += dt;
      if (statTick < 0.12) return; statTick = 0;
      var pct = S.work.removedFraction() * 100;
      statRemoved.innerHTML = pct.toFixed(pct < 10 ? 1 : 0) + "<small>%</small>";
      var d = S.lastT >= 0 ? S.work.depthAt(S.lastT) * C.MM_PER_UNIT : 0;
      statDepth.innerHTML = d.toFixed(1) + "<small> mm</small>";
      statShape.textContent = L.shapeName(S.work);
      if (S.target) updateShape();
      if (S.mode === "cut") drawProfile(); else { drawSpec(); updateSpecInfo(); }
    }

    /* ---------------- main loop ---------------- */
    var CHIP_SCALE = (120 / C.SEG) * 2.8;   // chip/sound tuning was done at 120 slices and the old, ~3x faster removal rate
    var lastFrame = performance.now(), frameN = 0;
    /* ?testclock (browser tests only): the simulation does not follow the wall clock.
       Time only moves, and frames only draw, when a test calls S.advance(seconds),
       in fixed 1/60 s steps (then one frame is drawn), so a held push cuts the same on any machine at any
       frame rate, and a three-second hold takes milliseconds. */
    var testClock = /[?&]testclock\b/.test(location.search);
    S.testClock = testClock;
    function frame(nowMs) {
      requestAnimationFrame(frame);
      if (L.hidden || testClock) { lastFrame = nowMs; return; }   // the farm is showing: the lathe sleeps (on the test clock it only draws in advance())
      try {
        var dt = Math.min(0.05, Math.max(0, (nowMs - lastFrame) / 1000)); lastFrame = nowMs;
        frameN++;
        step(dt);
        view.frame(dt);
      } catch (err) {
        showErr(err && err.message ? err.message : err);
      }
    }
    S.advance = function (seconds) {
      var n = Math.max(1, Math.round(seconds * 60));
      for (var k = 0; k < n; k++) step(1 / 60);
      updateStats(1); drawProfile(); drawSpec(); updateSpecInfo();
      view.frame(1 / 60);
      return n;
    };
    /* One tick of the lathe: spin, pressure, cutting, paint and spray, the tool, sound, stats. */
    function step(dt) {
        if (S.catchCooldown > 0) S.catchCooldown -= dt;
        S.spinAngle += S.rpm * (Math.PI * 2 / 60) * 0.22 * dt;   // slowed so the strobe reads; pitch follows the slider
        S.cutIntensity = Math.max(0, S.cutIntensity - dt * 3.2);
        S.shake = Math.max(0, S.shake - dt * 3.4);
        S.flow = Math.max(0, S.flow - dt * 3.2);
        if (S.coat.syncWork(S.work)) { drawProfile(); updateSpecInfo(); }   // wood cut away takes its paint

        var p = S.pointer, pr = S.pressure.update(dt);
        if (p.active) {
          S.lastT = p.t;
          if (S.mode === "cut") {
            var removed = S.work.cut(p.t, pr, S.tip, dt, (S.catchCooldown > 0 ? 0.45 : 1) * S.cutBoost, S.rpm) * CHIP_SCALE;
            if (removed > 0.00001) {
              S.cutIntensity = Math.min(1, S.cutIntensity + removed * 900);
              view.onCut(removed);
              if (!S.everCut) { S.everCut = true; used.cut = true; hint.classList.add("gone"); }
            }
          } else if (pr > 0.04) {
            var laid;
            if (S.mode === "paint") { laid = S.coat.brush(p.t, pr, S.paintTool, S.color, dt, S.brushTool); view.onPaint(pr, dt, laid); }
            else { laid = S.coat.spray(p.t, pr, dt, S.sprayGun); view.onSpray(pr, dt, laid); }
            S.flow = Math.max(S.flow, 0.12 + 0.3 * pr);
            if (!used[S.mode]) { used[S.mode] = true; hint.classList.add("gone"); }
          }
        }
        var tool = S.tool;
        if (p.active) { tool.mode = "contact"; tool.t = p.t; tool.r = S.work.sample(p.t); tool.lift = 0; }
        else if (p.hover) { tool.mode = "hover"; tool.t = p.t; tool.r = S.work.sample(p.t); tool.lift = 0.12; }
        else tool.mode = "rest";

        audio.update(S.mode === "cut" ? S.cutIntensity : S.flow, p.active ? 1 : 0, S.rpm);
        updateStats(dt);
        updateMeter();
    }
    setSpec(P.generateSpec());
    syncOrder();
    applyUpgrades();
    S.syncOrder = syncOrder; S.takeOrder = takeOrder; S.practiseOrder = practiseOrder; S.setTip = setTip; S.applyUpgrades = applyUpgrades;
    S.setSpec = setSpec; S.setMode = setMode; S.setColor = setColor; S.setBrush = setBrush;
    S.match = function () { return P.matchSpec(S.spec, S.coat); };
    S.mountStock = mountStock; S.finishPiece = finishPiece; S.openStock = openStock; S.closeStock = closeStock;
    drawProfile();
    requestAnimationFrame(frame);

    S.views = { get current() { return view; }, use2D: function () { useView(view2d); }, use3D: function () { if (view3d) useView(view3d); } };
  }
})(window);

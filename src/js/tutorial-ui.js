/* ============================================================
   The new-player flow on screen: the coach card, the highlight ring
   on the real control, and the tabs that stay hidden until the flow
   opens them. The flow itself is tutorial.js (pure); this file gives
   it its readings of the game (ctx) and draws what it says.

   The coach never offers its own shortcut buttons: it points at the
   game's own controls, so the player learns the app. The only buttons
   on the card are "skip tutorial" (first card) and GOT IT (a card
   that is just to read). The card lets taps through everywhere but
   its own buttons, and sits on the other half of the screen from
   the control it points at, so it never covers it.

   ?tutorial=off skips the flow (farm-ui.js reads it).
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, L = root.Lathe, T = G.Tutorial, C = G.Commissions, P = L.Paint, R = G.Registry;
  var host = root.__farm, tut = G.tutorial, ctx = G.tutorialCtx;
  var farm = host.farm, state = host.state, inv = state.inventory;
  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function lathe() { return root.__lathe || null; }
  function board() { return G.commissions || null; }

  /* ---------------- what the flow reads ---------------- */
  function plotsOf(wood, test) {
    var n = 0;
    farm.state.plots.forEach(function (p) { if (p && p.wood === wood && (!test || test(p))) n++; });
    return n;
  }
  Object.assign(ctx, {
    screen: function () { return G.currentScreen ? G.currentScreen() : null; },
    mode: function () { var S = lathe(); return S ? S.mode : null; },
    removed: function () { var S = lathe(); return S ? S.work.removedFraction() : 0; },
    coverage: function () { var S = lathe(); return S ? S.coat.coverage() : 0; },
    sheenRank: function () {
      var S = lathe();
      if (!S || !S.spec || !(S.coat.coverage() > 0 || S.coat.avgGloss() > 0)) return 0;
      return P.SHEEN_ORDER.indexOf(P.matchSpec(S.spec, S.coat).sheen);
    },
    shape: function () {
      var S = lathe();
      return S && S.target ? C.shapeScore(S.work.radius, S.target, S.work.baseRadius).score : 0;
    },
    logs: function (w) { return inv.count("log", w); },
    blanks: function (w) { return inv.list("blank", function (it) { return it.wood === w; }).length; },
    pieces: function (w) { return inv.list("piece", function (it) { return it.wood === w; }).length; },
    canDeliver: function (w) {
      var b = board();
      if (!b) return false;
      return b.state.orders.some(function (o) {
        return o.wood === w && b.candidates(o.id).some(function (it) { var g = b.preview(o.id, it.id); return g && g.accepted; });
      });
    },
    delivered: function () { var b = board(); return b ? b.state.done : 0; },
    activeWood: function () { var b = board(), o = b && b.active(); return o ? o.wood : null; },
    selectedEmpty: function () { var i = host.selected; return i >= 0 && !farm.plotAt(i); },
    planted: function (w) { return plotsOf(w); },
    grown: function (w) { return plotsOf(w, farm.isMature); },
    harvestPhase: function () { return root.__harvest && root.__harvest.game ? root.__harvest.game.phase : null; },
    coins: function () { return state.wallet.balance("coins"); },
    diamonds: function () { return state.wallet.balance("diamonds"); },
    plantPrice: function (w) { return farm.plantPrice(w); },
    setMode: function (m) { var S = lathe(); if (S && S.mode !== m) S.setMode(m); },
    /* Put this wood's order on the lathe, with that wood mounted if the shed has it. */
    takeOrder: function (w) {
      var b = board();
      if (!b) return;
      var o = b.state.orders.filter(function (q) { return q.wood === w; })[0];
      if (!o) return;
      b.accept(o.id);
      if (L.takeOrder) L.takeOrder();
    }
  });

  /* ---------------- tabs: hidden until the flow opens them ---------------- */
  var TAB_IDS = { farm: "tabFarm", lathe: "tabLathe", mine: "tabMine", orders: "tabOrders", shop: "tabShop" };
  function syncTabs() {
    for (var k in TAB_IDS) { var el = $(TAB_IDS[k]); if (el) el.hidden = !tut.unlocked(k); }
  }

  /* ---------------- the coach card and the ring ---------------- */
  var card = document.createElement("div");
  card.id = "coach"; card.className = "coach"; card.hidden = true;
  card.setAttribute("role", "status"); card.setAttribute("aria-live", "polite");
  var ring = document.createElement("div");
  ring.id = "coachRing"; ring.className = "coach-ring"; ring.hidden = true;
  ring.setAttribute("aria-hidden", "true");
  document.body.appendChild(ring); document.body.appendChild(card);

  var shownId = null;
  function renderCard(st) {
    if (!st) { card.hidden = true; card.innerHTML = ""; shownId = null; return; }
    var first = st.index === 0, n = st.index + 1, of = T.STEPS.length;
    card.innerHTML =
      '<div class="coach-k">GETTING STARTED <span>' + n + " / " + of + "</span></div>" +
      '<h2 class="coach-t">' + esc(st.title) + "</h2>" +
      '<p class="coach-p">' + esc(st.text) + "</p>" +
      (st.dismiss || first ? '<div class="coach-row">' +
        (st.dismiss ? '<button type="button" class="act primary" data-coach="ok"><span class="an">GOT IT</span><span class="ad">Off you go</span></button>' : "") +
        (first ? '<button type="button" class="coach-skip" data-coach="skip">Skip tutorial</button>' : "") +
        "</div>" : "");
    shownId = st.id;
  }
  card.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-coach]") : null;
    if (!b) return;
    if (b.getAttribute("data-coach") === "ok") tut.dismiss();
    else tut.skip();
    refresh();
  });

  function visible(el) {
    if (!el || el.hidden) return false;
    var r = el.getBoundingClientRect();   // anything under a hidden screen measures 0 x 0
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < root.innerHeight;
  }
  /* The first of the step's targets that is on screen right now. */
  function targetEl(st) {
    var list = st.target || [];
    for (var i = 0; i < list.length; i++) {
      var all = document.querySelectorAll(list[i]);
      for (var k = 0; k < all.length; k++) if (visible(all[k])) return all[k];
    }
    return null;
  }
  var lastPos = "";
  function place(st) {
    var on = !!st && (!st.screen || st.screen === ctx.screen());
    card.hidden = !on;
    if (!on) { ring.hidden = true; return; }
    var el = targetEl(st), vw = root.innerWidth, vh = root.innerHeight;
    var r = el ? el.getBoundingClientRect() : null;
    // a target the size of the stage needs no ring: the card says where to touch
    var big = r && r.width * r.height > vw * vh * 0.35;
    if (r && !big) {
      var pad = 6;
      ring.hidden = false;
      ring.style.left = Math.round(r.left - pad) + "px"; ring.style.top = Math.round(r.top - pad) + "px";
      ring.style.width = Math.round(r.width + pad * 2) + "px"; ring.style.height = Math.round(r.height + pad * 2) + "px";
    } else ring.hidden = true;
    // the card goes on the other half of the screen from what it points at
    var low = r ? (r.top + r.height / 2) > vh * 0.5 : false;
    if (big) low = true;    // the stage: the card goes up top, clear of the controls below it
    var pos = low ? "top" : "bottom";
    if (pos !== lastPos) { card.classList.toggle("at-top", pos === "top"); card.classList.toggle("at-bottom", pos === "bottom"); lastPos = pos; }
  }

  /* ---------------- the lathe for a new player ---------------- */
  /* The flow starts on a real pine log, not a practice blank, so DONE keeps the piece. */
  var LATHE_STEPS = { cut: 1, to_paint: 1, paint: 1, to_finish: 1, finish: 1, keep: 1 };
  function mountPine() {
    var S = lathe(), st = tut.current();
    if (!S || !st || !LATHE_STEPS[st.id] || S.stock) return;
    if (inv.count("log", "pine") && L.mountStock) L.mountStock({ kind: "log", key: "pine" });
  }

  /* ---------------- the loop ---------------- */
  function refresh() {
    tut.check();
    var st = tut.current();
    syncTabs();
    if ((st ? st.id : null) !== shownId) renderCard(st);
    place(st);
    if (!st) { card.hidden = true; ring.hidden = true; }
    if (G.OrdersUI && G.OrdersUI.guided !== tut.isActive()) { G.OrdersUI.guided = tut.isActive(); if (G.OrdersUI.render) G.OrdersUI.render(true); }
  }
  G.tutorialRefresh = refresh;

  function start() {
    if (!lathe()) { setTimeout(start, 50); return; }
    mountPine();
    refresh();
    // a locked screen asked for in the URL lands on the lathe
    var cur = ctx.screen();
    if (cur && !tut.unlocked(cur)) G.showScreen("lathe");
    setInterval(refresh, 400);
    root.addEventListener("resize", function () { place(tut.current()); });
    document.addEventListener("click", function () { setTimeout(refresh, 0); }, true);
    document.addEventListener("pointerup", function () { setTimeout(refresh, 30); }, true);
  }
  syncTabs();
  start();

  root.__tutorial = { tutorial: tut, ctx: ctx, refresh: refresh, card: card, ring: ring };
})(window);

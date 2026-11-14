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
    activeKind: function () { var b = board(), o = b && b.active(); return o ? o.kind : null; },
    hasOrder: function (kind) { var b = board(); return !!b && b.state.orders.some(function (o) { return o.kind === kind; }); },
    ownsBlueprint: function (kind) { var b = board(); return !!b && b.ownsBlueprint(kind); },
    postOrder: function (def) { var b = board(); if (b) b.postAuthored([def]); if (G.OrdersUI) G.OrdersUI.render(true); },
    tip: function () { var S = lathe(); return S ? S.tip : null; },
    smoothHere: function () { var S = lathe(); return S && S.smoothHere && S.sanding && S.sanding() ? S.smoothHere() : 0; },
    selectedEmpty: function () { var i = host.selected; return i >= 0 && !farm.plotAt(i); },
    planted: function (w) { return plotsOf(w); },
    grown: function (w) { return plotsOf(w, farm.isMature); },
    harvestPhase: function () { return root.__harvest && root.__harvest.game ? root.__harvest.game.phase : null; },
    coins: function () { return state.wallet.balance("coins"); },
    diamonds: function () { return state.wallet.balance("diamonds"); },
    plantPrice: function (w) { return farm.plantPrice(w); },
    setMode: function (m) { var S = lathe(); if (S && S.mode !== m) S.setMode(m); },
    piecesAll: function () { return inv.count("piece"); },
    plantedAll: function () { return farm.state.plots.filter(Boolean).length; },
    grownAll: function () { return farm.state.plots.filter(function (p) { return p && farm.isMature(p); }).length; },
    emptyPlots: function () { return farm.state.plots.filter(function (p) { return !p; }).length; },
    doneTaps: function () { return tut.state.taps || 0; },
    /* A replay starts on a free practice blank, so it uses none of the player's wood.
       An order that was on the lathe goes back on the board, still theirs. */
    startReplay: function () {
      var b = board();
      if (b && b.active()) b.release();
      if (L.syncOrder) L.syncOrder();
      if (L.mountBlank) L.mountBlank(null);
      practiceSpec();
      G.showScreen("lathe");
    },
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

  /* The card can be tucked away when it is in the way (over the log, say). It shrinks
     into a glowing button: in the lathe's bottom row, by DONE, or floating at the
     bottom of the other screens. Tapping the button brings the step back. A new step
     always opens its card again, since it says something new; the ring stays put. */
  var pill = document.createElement("button");
  pill.type = "button"; pill.id = "coachPill"; pill.className = "ctl-btn coach-pill"; pill.hidden = true;
  pill.setAttribute("aria-label", "Show the tutorial step");
  var minimized = false, doneBtnEl = $("doneBtn");
  /* Where the button goes. On the lathe it joins the bottom row, just before DONE:
     a round button, narrow enough for the row's spare room. If it would push a
     button onto a new line on this screen, it sits in the bottom corner of the stage
     instead. On every other screen it floats at the bottom middle. Measured when it
     appears and when the window changes size. */
  var stageEl = $("stage"), homeFor = "";
  function rowLines(row) {
    var tops = {};
    Array.prototype.forEach.call(row.children, function (e) { var r = e.getBoundingClientRect(); if (r.width > 0) tops[Math.round(r.top / 6)] = 1; });
    return Object.keys(tops).length;
  }
  function pillHome(force) {
    var onLathe = ctx.screen() === "lathe" && doneBtnEl && visible(doneBtnEl);
    var want = onLathe ? "lathe" : "float";
    if (!force && want === homeFor) return;
    homeFor = want;
    pill.classList.remove("floating", "docked", "corner");
    if (!onLathe) {
      if (pill.parentNode !== document.body) document.body.appendChild(pill);
      pill.classList.add("floating");
      return;
    }
    var row = doneBtnEl.parentNode, wasHidden = pill.hidden;
    if (pill.parentNode === row) row.removeChild(pill);
    var before = rowLines(row);
    pill.hidden = false;
    pill.classList.add("docked");
    row.insertBefore(pill, doneBtnEl);
    if (rowLines(row) > before) {               // no room in the row: the stage's corner instead
      row.removeChild(pill);
      pill.classList.remove("docked");
      pill.classList.add("corner");
      stageEl.appendChild(pill);
    }
    pill.hidden = wasHidden;
  }
  function pillLabel(st) {
    var word = tut.isReplay() ? "REPLAY" : "TUTORIAL";
    pill.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/></svg>' +
      '<span class="cp-word">' + word + " " + (st.index + 1) + "/" + T.STEPS.length + "</span>" +
      '<span class="cp-n" aria-hidden="true">' + (st.index + 1) + "</span>";
    pill.setAttribute("aria-label", "Show the tutorial, step " + (st.index + 1) + " of " + T.STEPS.length);
  }
  /* The card flies into the button (or out of it), so the player sees where it went. */
  function fly(out, after) {
    var a = card.getBoundingClientRect(), b = pill.getBoundingClientRect();
    if (!card.animate || !a.width || !b.width || matchMedia("(prefers-reduced-motion: reduce)").matches) { after(); return; }
    var dx = (b.left + b.width / 2) - (a.left + a.width / 2), dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    var away = "translateX(-50%) translate(" + dx + "px," + dy + "px) scale(0.12)", home = "translateX(-50%)";
    var anim = card.animate(out ? [{ transform: home, opacity: 1 }, { transform: away, opacity: 0.2 }] : [{ transform: away, opacity: 0.2 }, { transform: home, opacity: 1 }],
      { duration: 280, easing: "cubic-bezier(.3,.7,.4,1)" });
    if (out) anim.onfinish = after; else after();
  }
  function minimize() {
    var st = tut.current();
    if (!st || minimized) return;
    pillLabel(st); pill.hidden = false;
    pillHome(true);
    minimized = true;
    fly(true, function () { card.hidden = true; });
  }
  function restore() {
    if (!minimized) return;
    minimized = false;
    pill.hidden = true;
    card.hidden = false;
    place(tut.current());
    fly(false, function () {});
  }
  pill.addEventListener("click", function (e) { e.stopPropagation(); restore(); });
  pill.addEventListener("pointerdown", function (e) { e.stopPropagation(); });   // on the stage, a tap on it is not a cut
  document.body.appendChild(pill);

  /* Skipping asks first: a tap on "Skip tutorial" turns the card into the question,
     saying what skipping means, and KEEP LEARNING is the big button. */
  var shownId = null, confirming = false, shownHint = null;
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function confirmHtml() {
    if (tut.isReplay()) {
      return '<div class="coach-k">REPLAY</div><h2 class="coach-t">Stop the tutorial?</h2>' +
        '<p class="coach-p">Nothing in your game changes. You can replay it any time from Settings (the gear, top right).</p>' +
        '<div class="coach-row"><button type="button" class="act primary" data-coach="stay"><span class="an">KEEP GOING</span><span class="ad">Back to the tutorial</span></button>' +
        '<button type="button" class="act" data-coach="leave"><span class="an">STOP IT</span><span class="ad">Play on your own</span></button></div>';
    }
    var g = tut.skipGrant(), gift = [];
    if (g.coins) gift.push(plural(g.coins, "coin", "coins"));
    if (g.diamonds) gift.push(plural(g.diamonds, "diamond", "diamonds"));
    return '<div class="coach-k">SKIP THE TUTORIAL?</div><h2 class="coach-t">Learn it on your own?</h2>' +
      '<p class="coach-p">Skipping opens every tab now' + (gift.length ? " and gives you " + gift.join(" and ") + " to start with" : "") +
      ". Nobody will show you where things are, so it suits players who know the game. You can replay the tutorial any time from Settings (the gear, top right)" +
      (gift.length ? ", but the starting coins and diamonds only come once" : "") + ".</p>" +
      '<div class="coach-row"><button type="button" class="act primary" data-coach="stay"><span class="an">KEEP LEARNING</span><span class="ad">Back to the tutorial</span></button>' +
      '<button type="button" class="act" data-coach="leave"><span class="an">SKIP IT</span><span class="ad">Open everything now</span></button></div>';
  }
  function renderCard(st) {
    if (!st) { card.hidden = true; card.innerHTML = ""; shownId = null; confirming = false; return; }
    if (st.id !== shownId) { confirming = false; if (minimized) { minimized = false; pill.hidden = true; } }
    shownId = st.id;
    card.classList.toggle("confirm", confirming);
    if (confirming) { card.innerHTML = confirmHtml(); return; }
    var n = st.index + 1, of = T.STEPS.length, rep = tut.isReplay(), hint = st.hint ? st.hint(ctx) : null;
    shownHint = hint;
    card.innerHTML =
      '<div class="coach-k">' + (rep ? "REPLAY" : "GETTING STARTED") + " <span>" + n + " / " + of +
        '<button type="button" class="coach-min' + (st.showMin ? " glow" : "") + '" data-coach="min" aria-label="Hide this for now" title="Hide this for now"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button></span></div>' +
      '<h2 class="coach-t">' + esc(st.title) + "</h2>" +
      '<p class="coach-p">' + esc(st.text) + "</p>" +
      (hint ? '<p class="coach-p coach-hint">' + esc(hint) + "</p>" : "") +
      '<div class="coach-row">' +
        (st.dismiss ? '<button type="button" class="act primary" data-coach="ok"><span class="an">GOT IT</span><span class="ad">Off you go</span></button>' : "") +
        '<button type="button" class="coach-skip" data-coach="skip">' + (rep ? "Stop tutorial" : "Skip tutorial") + "</button>" +
      "</div>";
  }
  card.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-coach]") : null;
    if (!b) return;
    var what = b.getAttribute("data-coach");
    if (what === "min") { minimize(); return; }
    if (what === "ok") tut.dismiss();
    else if (what === "skip") confirming = true;
    else if (what === "stay") confirming = false;
    else if (what === "leave") { confirming = false; tut.skip(); }
    renderCard(tut.current());
    refresh();
  });
  // DONE taps, for the replay's steps that only ask the player to press it
  $("doneBtn").addEventListener("click", function () { if (tut.isActive()) { tut.state.taps = (tut.state.taps || 0) + 1; } }, true);

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
  /* The step's first target that is on this screen, even scrolled out of view (lower
     down the store, say), is scrolled into view once per step and screen, so the ring
     goes round the control the card names, not a fallback. */
  var scrolledFor = "";
  function scrollToTarget(st) {
    var key = st.id + ":" + ctx.screen();
    if (scrolledFor === key) return null;
    var list = st.target || [];
    for (var i = 0; i < list.length; i++) {
      var all = document.querySelectorAll(list[i]);
      for (var k = 0; k < all.length; k++) {
        var r = all[k].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          scrolledFor = key;
          if (!visible(all[k]) && all[k].scrollIntoView) all[k].scrollIntoView({ block: "center" });
          return visible(all[k]) ? all[k] : null;
        }
      }
    }
    return null;
  }
  var lastPos = "";
  function place(st) {
    var on = !!st && (!st.screen || st.screen === ctx.screen());
    card.hidden = !on || minimized;
    if (minimized) { pillHome(); pill.hidden = !on; }
    if (!on) { ring.hidden = true; return; }
    var el = scrollToTarget(st) || targetEl(st), vw = root.innerWidth, vh = root.innerHeight;
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
  var LATHE_STEPS = { cut: 1, pick_sand: 1, sand: 1, to_paint: 1, paint: 1, to_finish: 1, finish: 1, keep: 1 };
  function mountPine() {
    var S = lathe(), st = tut.current();
    if (!S || !st || !LATHE_STEPS[st.id]) return;
    if (!tut.isReplay() && !S.stock && inv.count("log", "pine") && L.mountStock) L.mountStock({ kind: "log", key: "pine" });
    practiceSpec();
  }
  /* The practice piece always gets the same spec, which wants satin. */
  function practiceSpec() { var S = lathe(); if (S && !S.order && S.setSpec) S.setSpec(T.PRACTICE_SPEC); }

  /* ---------------- the loop ---------------- */
  function refresh() {
    tut.check();
    var st = tut.current();
    syncTabs();
    if ((st ? st.id : null) !== shownId || (st && !confirming && (st.hint ? st.hint(ctx) : null) !== shownHint)) {
      var hintNow = st && st.hint ? st.hint(ctx) : null;
      renderCard(st);
      if (hintNow && minimized) restore();   // something went wrong: bring the card back to say how to fix it
    }
    place(st);
    if (!st) { card.hidden = true; ring.hidden = true; pill.hidden = true; minimized = false; }
    if (G.OrdersUI && G.OrdersUI.guided !== tut.guidedBoard()) { G.OrdersUI.guided = tut.guidedBoard(); if (G.OrdersUI.render) G.OrdersUI.render(true); }
  }
  G.tutorialRefresh = refresh;
  /* While the flow's 100 coins wait for the bat blueprint, nothing else spends coins:
     returns what to tell the player, or "" when spending is fine. */
  G.tutorialHoldsCoins = function () {
    var st = tut.current();
    return st && st.id === "buy_bat" && !tut.isReplay() && !ctx.ownsBlueprint("baseball_bat") ? "First the Baseball bat blueprint, at the top of Arbor Freight." : "";
  };

  function start() {
    if (!lathe()) { setTimeout(start, 50); return; }
    mountPine();
    refresh();
    // a locked screen asked for in the URL lands on the lathe
    var cur = ctx.screen();
    if (cur && !tut.unlocked(cur)) G.showScreen("lathe");
    setInterval(refresh, 400);
    root.addEventListener("resize", function () { if (minimized) pillHome(true); place(tut.current()); });
    // the ring is fixed to the window, so it follows its control on every scrolled frame
    // (the store and the board scroll; capture catches scrolls on any element)
    var scrollQueued = false;
    document.addEventListener("scroll", function () {
      if (scrollQueued || ring.hidden) return;          // nothing to follow: no work on a scroll at all
      scrollQueued = true;
      requestAnimationFrame(function () { scrollQueued = false; place(tut.current()); });
    }, true);
    document.addEventListener("click", function () { setTimeout(refresh, 0); }, true);
    document.addEventListener("pointerup", function () { setTimeout(refresh, 30); }, true);
  }
  syncTabs();
  start();

  root.__tutorial = { tutorial: tut, ctx: ctx, refresh: refresh, card: card, ring: ring, pill: pill, minimize: minimize, restore: restore, get minimized() { return minimized; } };
})(window);

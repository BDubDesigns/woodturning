/* ============================================================
   The commission board screen (the COMMISSIONS tab). Draws the
   orders from the board model (commissions.js), takes taps, and
   shows the grade when a piece is handed over. The model never
   knows the DOM exists.

   An order card shows who wants what: the target silhouette painted
   the way the order wants it, the wood, the paint and the sheen, what
   the shed holds of that wood, and the pay. TAKE IT puts the order on
   the lathe (main.js draws its shape as a ghost and grades DONE against
   it); a finished piece of the right wood can be delivered from here too.
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, C = G.Commissions, R = G.Registry, F = G.Farm;
  var P = root.Lathe.Paint, R0 = root.Lathe.CFG.R0;
  var host = root.__farm, board = G.commissions, state = host.state;
  function $(id) { return document.getElementById(id); }
  var listEl = $("orderList"), footEl = $("boardFoot"), toastEl = $("otoast"), overlay = $("gradeOverlay");
  var shown = false, sig = "";

  var COIN = '<svg class="coin" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#e8a33d" stroke="#8a5a1c" stroke-width="2"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="#8a5a1c" stroke-width="1.6"/></svg>';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function woodName(id) { return R.WOODS[id] ? R.WOODS[id].name : id; }
  function pieceName(o) { return C.PIECES[o.kind].name; }
  function article(name) { return /^[aeiou]/i.test(name) ? "an" : "a"; }
  function hex(rgb) { return "rgb(" + rgb.map(function (v) { return Math.round(v * 255); }).join(",") + ")"; }
  function starsHtml(n) { var s = ""; for (var i = 0; i < 3; i++) s += '<span class="' + (i < n ? "on" : "") + '">★</span>'; return '<span class="stars" aria-label="' + n + ' of 3 stars">' + s + "</span>"; }

  /* ---------------- toast ---------------- */
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("on"); }, 3200);
  }

  /* ---------------- the target, drawn ----------------
     The silhouette of the target profile, mirrored about the axis, painted
     with the order's bands over the wood, with a highlight as strong as the
     sheen it asks for. */
  function shapeSvg(o) {
    var t = C.targetProfile(o), n = t.length, W = 300, H = 64, mid = H / 2, sc = (mid - 2) / R0, i;
    var top = [], bot = [];
    for (i = 0; i < n; i += 2) { var x = (i / (n - 1)) * W; top.push(x.toFixed(1) + "," + (mid - t[i] * sc).toFixed(1)); bot.push(x.toFixed(1) + "," + (mid + t[i] * sc).toFixed(1)); }
    var x1 = W.toFixed(1);
    top.push(x1 + "," + (mid - t[n - 1] * sc).toFixed(1)); bot.push(x1 + "," + (mid + t[n - 1] * sc).toFixed(1));
    var d = "M" + top.join(" L") + " L" + bot.reverse().join(" L") + " Z";
    var id = "osh" + o.id, wood = R.WOODS[o.wood] ? R.WOODS[o.wood].trunk : "#c99a5e";
    var bands = o.spec.segments.map(function (sg) {
      if (!sg.paint) return "";
      return '<rect x="' + (sg.a * W).toFixed(1) + '" y="0" width="' + ((sg.b - sg.a) * W + 0.6).toFixed(1) + '" height="' + H + '" fill="' + P.PALETTE[sg.paint].hex + '"/>';
    }).join("");
    var gloss = P.SHEEN[o.spec.sheen].gloss;
    return '<svg class="o-shape" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><clipPath id="' + id + '"><path d="' + d + '"/></clipPath>' +
      '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="0.35" stop-color="#fff" stop-opacity="' + (0.08 + gloss * 0.3).toFixed(2) + '"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient></defs>' +
      '<g clip-path="url(#' + id + ')"><rect width="' + W + '" height="' + H + '" fill="' + wood + '"/>' + bands + '<rect width="' + W + '" height="' + H + '" fill="url(#' + id + 'g)"/></g>' +
      '<path d="' + d + '" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="1"/></svg>';
  }

  /* ---------------- what the shed has for an order ---------------- */
  /* Pieces in the shed that could go to this order. While the new-player flow
     runs, only one turned for it: the practice piece is not offered. */
  function fits(o) {
    var list = board.candidates(o.id);
    return api.guided ? list.filter(function (it) { return it.order === o.id; }) : list;
  }
  function stockFor(o) {
    var inv = state.inventory;
    return {
      blanks: inv.list("blank", function (it) { return it.wood === o.wood; }).length,
      logs: inv.count("log", o.wood),
      pieces: fits(o).length
    };
  }
  function haveLine(o, st) {
    var w = woodName(o.wood).toLowerCase(), parts = [];
    if (st.blanks) parts.push(st.blanks + " " + w + (st.blanks === 1 ? " blank" : " blanks"));
    if (st.logs) parts.push(st.logs + " " + w + (st.logs === 1 ? " log" : " logs"));
    if (st.pieces) parts.push(st.pieces + " turned " + (st.pieces === 1 ? "piece" : "pieces"));
    if (parts.length) return "In the shed: " + parts.join(", ") + ".";
    var grow = F && F.WOODS[o.wood] ? " (" + F.formatDuration(F.WOODS[o.wood].growMs) + " to grow)" : "";
    return "No " + w + " in the shed. Plant one on the farm" + grow + ".";
  }

  function act(label, desc, cls, data) {
    return '<button type="button" class="act' + (cls ? " " + cls : "") + '" data-act="' + data + '"><span class="an">' + label + '</span><span class="ad">' + desc + "</span></button>";
  }
  function waitText() {
    var ms = board.msUntilNext();
    return ms == null ? "" : F.formatDuration(ms);
  }

  /* ---------------- the board ---------------- */
  function signature() {
    var B = board.state;
    return JSON.stringify([api.guided, B.orders.map(function (o) { var st = stockFor(o); return [o.id, st.blanks, st.logs, st.pieces]; }), B.active, B.done, B.history.length, B.orders.length < C.CFG.BOARD_SIZE]);
  }
  function render(force) {
    if (!shown) return;
    board.refill();
    var s = signature();
    if (!force && s === sig) { tickClock(); return; }
    sig = s;
    var B = board.state, h = "";
    B.orders.forEach(function (o) {
      var st = stockFor(o), on = B.active === o.id, name = pieceName(o);
      h += '<article class="order' + (on ? " on" : "") + '" data-order="' + o.id + '" data-wood="' + esc(o.wood) + '">';
      h += '<div class="o-top"><div class="o-who">Order from <b>' + esc(o.client) + '</b></div><div class="o-pay" title="Pay for a perfect job">' + COIN + "<b>" + o.reward + "</b></div></div>";
      h += '<h3 class="o-name">' + esc(name) + (on ? '<span class="o-badge">ON THE LATHE</span>' : "") + "</h3>";
      h += shapeSvg(o);
      h += '<div class="o-tags"><span class="tag"><i class="dot" style="background:' + (R.WOODS[o.wood] ? R.WOODS[o.wood].trunk : "#c99a5e") + '"></i>' + woodName(o.wood) + "</span>";
      h += '<span class="tag">' + esc(o.spec.name) + "</span><span class=\"tag\">" + P.SHEEN[o.spec.sheen].name + " finish</span></div>";
      h += '<p class="o-blurb">' + esc(C.PIECES[o.kind].blurb) + "</p>";
      h += '<p class="o-have' + (st.blanks || st.logs || st.pieces ? "" : " none") + '">' + haveLine(o, st) + "</p>";
      h += '<div class="row">';
      if (on) {
        h += act("GO TO LATHE", "Turn it to the dashed line", "primary", "lathe");
        h += act("PUT ASIDE", "Keep the order, free the lathe", "", "release");
      } else {
        // while the new-player flow runs, the board is just its two orders: no practising, declining or rushing
        if (st.blanks || st.logs) {
          h += act("TAKE IT", "Put the " + woodName(o.wood).toLowerCase() + " on the lathe", "primary", "take");
          if (!api.guided) h += act("PRACTISE", "On a free practice blank. Your " + woodName(o.wood).toLowerCase() + " stays in the shed", "practice", "practise");
        } else if (!api.guided) h += act("PRACTISE IT", "Practice only: it needs " + woodName(o.wood).toLowerCase() + " to deliver", "practice", "take");
        if (!api.guided) h += act("DECLINE", "Another order comes in " + F.formatDuration(C.CFG.NEW_ORDER_MS), "", "decline");
      }
      if (st.pieces) h += act("DELIVER", st.pieces === 1 ? "A turned piece in the shed fits" : st.pieces + " turned pieces in the shed fit", on ? "" : "", "deliver");
      h += "</div></article>";
    });
    for (var k = B.orders.length; k < C.CFG.BOARD_SIZE && !api.guided; k++) {
      var dia = state.wallet.balance("diamonds"), cost = C.CFG.RUSH_DIAMONDS;
      h += '<article class="order empty"><p>A new order comes in <b data-wait>' + waitText() + "</b>.</p>" +
        '<div class="row">' + act("GET ONE NOW", cost + (cost === 1 ? " diamond" : " diamonds") + ". You have " + dia + ".", dia >= cost ? "" : "short", "rush") + "</div></article>";
    }
    listEl.innerHTML = h;
    var f = "", recent = B.history.slice(-5).reverse();
    if (recent.length) {
      f += '<section class="order hist" aria-label="Delivered commissions"><div class="h-top"><span class="h-k">DELIVERED</span><span class="h-n">' + B.done + (B.done === 1 ? " commission" : " commissions") + "</span></div>";
      f += '<ul class="b-hist">' + recent.map(function (r) {
        var w = R.WOODS[r.wood];
        return '<li>' + starsHtml(r.stars) + '<span class="h-what"><b>' + esc(C.PIECES[r.kind] ? C.PIECES[r.kind].name : r.kind) + "</b><small>for " + esc(r.client) + (w ? " · " + w.name : "") + '</small></span><span class="h-pay">' + COIN + "+" + r.pay + "</span></li>";
      }).join("") + "</ul></section>";
    }
    f += '<p class="b-help">Take an order, turn the shape, paint it, spray the finish, then press DONE on the lathe. The closer it is to the order, the more it pays. Only the wood the order names will do.</p>';
    footEl.innerHTML = f;
  }
  function tickClock() {
    var w = waitText();
    Array.prototype.forEach.call(listEl.querySelectorAll("[data-wait]"), function (el) { if (el.textContent !== w) el.textContent = w; });
  }

  listEl.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!b) return;
    var card = b.closest("[data-order]"), id = card ? parseInt(card.getAttribute("data-order"), 10) : 0;
    var o = board.get(id), what = b.getAttribute("data-act");
    if (!o) return;
    if (what === "take") {
      board.accept(id);
      G.showScreen("lathe");
      if (root.Lathe.takeOrder) root.Lathe.takeOrder();
    } else if (what === "practise") {        // the order's shape and spec on a free practice blank, the real wood kept
      board.accept(id);
      G.showScreen("lathe");
      if (root.Lathe.practiseOrder) root.Lathe.practiseOrder();
    } else if (what === "lathe") {
      G.showScreen("lathe");
      if (root.Lathe.takeOrder) root.Lathe.takeOrder();
    } else if (what === "release") {
      board.release(); toast("Put aside. It stays on the board.");
      if (root.Lathe.syncOrder) root.Lathe.syncOrder();
      render(true);
    } else if (what === "decline") {
      board.decline(id); toast("Declined. A new order comes in " + F.formatDuration(C.CFG.NEW_ORDER_MS) + ".");
      if (root.Lathe.syncOrder) root.Lathe.syncOrder();
      render(true);
    } else if (what === "deliver") {
      choose(o);
    }
  });
  function o0(id) { var o = board.get(id); return o ? esc(o.client) : "The customer"; }
  // GET ONE NOW on an empty slot: a diamond posts the next order straight away
  listEl.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-act="rush"]') : null;
    if (!b) return;
    var r = board.rushNext();
    if (r.ok) { toast("New order from " + r.order.client + "."); host.renderWallet(); render(true); }
    else if (r.reason === "not enough diamonds") toast("That takes " + r.need + (r.need === 1 ? " diamond" : " diamonds") + ". You have " + r.have + ". The mine has more.");
  });

  /* ---------------- handing a piece over ---------------- */
  function closeOverlay() { overlay.hidden = true; overlay.innerHTML = ""; }
  // a tap outside does nothing: the piece waits on DELIVER or KEEP IT, so it is never left in limbo.
  // Escape on a keyboard means KEEP IT, said plainly by the button it presses.
  root.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || overlay.hidden) return;
    var keep = overlay.querySelector('[data-act="keep"]');
    if (keep) keep.click(); else closeOverlay();
  });
  function bar(label, v) {
    var pct = Math.round(v * 100);
    return '<div class="g-row"><span class="gk">' + label + '</span><span class="gbar"><i style="width:' + pct + '%"></i></span><b>' + pct + "%</b></div>";
  }
  function gradeHtml(o, g) {
    var h = '<div class="g-stars">' + starsHtml(g.stars) + "</div>";
    h += bar("SHAPE", g.shape) + bar("PAINT", g.paint) + bar("SHEEN", g.sheen);
    h += '<p class="g-note">' + P.SHEEN[o.spec.sheen].name + " wanted, " + P.SHEEN[g.sheenGot].name.toLowerCase() + " given.</p>";
    return h;
  }
  /* The lathe's DONE with an order on it: show what this piece earns, and let
     the player hand it over or keep it to try again. */
  function offer(orderId, pieceId) {
    var o = board.get(orderId), g = board.preview(orderId, pieceId);
    if (!o || !g) return;
    var h = '<div class="grade-card"><h2 id="gradeTitle">' + esc(pieceName(o)) + " for " + esc(o.client) + "</h2>";
    h += gradeHtml(o, g);
    if (g.accepted) {
      h += '<p class="g-pay">Pays ' + COIN + "<b>" + g.pay + "</b> of " + o.reward + (g.bonus ? ' <span class="g-bonus">+' + Math.round(C.CFG.BONUS * 100) + "% bonus</span>" : "") + "</p>";
      h += '<div class="row">' + act("DELIVER", "Hand it over for " + g.pay + " coins", "primary", "give") + act("KEEP IT", "It stays in the shed. Try again", "", "keep") + "</div></div>";
    } else {
      h += '<p class="g-reject">' + esc(o.client) + " won't take it. A piece needs " + Math.round(C.CFG.PASS * 100) + "% to be accepted; this one is " + Math.round(g.total * 100) + "%. It stays in the shed.</p>";
      h += '<div class="row">' + act("KEEP IT", "Try another one", "primary", "keep") + "</div></div>";
    }
    overlay.innerHTML = h; overlay.hidden = false;
    if (g.accepted) overlay.querySelector('[data-act="give"]').addEventListener("click", function () { give(orderId, pieceId); });
    overlay.querySelector('[data-act="keep"]').addEventListener("click", function () { closeOverlay(); });
  }
  /* DELIVER on the board: pick which piece from the shed. */
  function choose(o) {
    var list = fits(o);
    if (!list.length) { toast("No turned " + woodName(o.wood).toLowerCase() + " piece in the shed."); return; }
    var h = '<div class="grade-card"><h2 id="gradeTitle">Deliver ' + article(pieceName(o)) + " " + esc(pieceName(o).toLowerCase()) + "</h2><p class=\"g-note\">Pick the piece to hand to " + esc(o.client) + ".</p><div class=\"g-list\">";
    list.slice().reverse().forEach(function (it) {
      var g = board.preview(o.id, it.id);
      h += '<button type="button" class="g-pick' + (g.accepted ? "" : " no") + '" data-piece="' + it.id + '"' + (g.accepted ? "" : ' aria-disabled="true"') + ">" + starsHtml(g.stars) + "<span><b>" + esc(woodName(it.wood)) + " " + esc((it.shape || "piece").toLowerCase()) + "</b><small>" +
        (g.accepted ? "Shape " + Math.round(g.shape * 100) + "% · paint " + Math.round(g.paint * 100) + "%" : "Turned down: under " + Math.round(C.CFG.PASS * 100) + "%") + '</small></span><span class="n">' + (g.accepted ? COIN + g.pay : "") + "</span></button>";
    });
    h += '</div><div class="row">' + act("CANCEL", "Keep them all", "", "keep") + "</div></div>";
    overlay.innerHTML = h; overlay.hidden = false;
    Array.prototype.forEach.call(overlay.querySelectorAll("[data-piece]"), function (b) {
      b.addEventListener("click", function () { give(o.id, parseInt(b.getAttribute("data-piece"), 10)); });
    });
    overlay.querySelector('[data-act="keep"]').addEventListener("click", closeOverlay);
  }
  function give(orderId, pieceId) {
    var r = board.deliver(orderId, pieceId);
    if (!r.ok) {
      closeOverlay();
      toast(r.reason === "wrong wood" ? "That piece is the wrong wood for this order." : r.reason === "rejected" ? o0(orderId) + " won't take that one. It needs " + Math.round(C.CFG.PASS * 100) + "% to be accepted." : "That piece is no longer in the shed.");
      return;
    }
    var o = r.order, g = r.grade;
    var h = '<div class="grade-card done"><h2 id="gradeTitle">Delivered!</h2><div class="g-stars">' + starsHtml(g.stars) + "</div>";
    h += '<p class="g-pay big">+' + COIN + "<b>" + r.pay + "</b></p>";
    h += '<p class="g-note">' + esc(o.client) + (g.stars >= 3 ? " is delighted with the " : g.stars >= 2 ? " is happy with the " : " takes the ") + esc(pieceName(o).toLowerCase()) + (g.bonus ? ", and adds a " + Math.round(C.CFG.BONUS * 100) + "% bonus" : "") + ".</p>";
    h += '<div class="row">' + act("BOARD", "See the other orders", "primary", "board") + act("OK", "Back to work", "", "keep") + "</div></div>";
    overlay.innerHTML = h; overlay.hidden = false;
    overlay.querySelector('[data-act="board"]').addEventListener("click", function () { closeOverlay(); G.showScreen("orders"); });
    overlay.querySelector('[data-act="keep"]').addEventListener("click", closeOverlay);
    if (root.Lathe.syncOrder) root.Lathe.syncOrder();
    host.renderWallet();
    render(true);
  }

  setInterval(function () { if (shown) render(false); }, 1000);

  var api = {
    show: function () { shown = true; render(true); },
    hide: function () { shown = false; },
    offer: offer, render: render, toast: toast,
    guided: !!(G.tutorial && G.tutorial.guidedBoard())   // the new-player flow is running (tutorial-ui.js keeps this up to date)
  };
  G.OrdersUI = api;
  root.__orders = { board: board, ui: api };
  if (G.startScreen === "orders") api.show();
})(window);

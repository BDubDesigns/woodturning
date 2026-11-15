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

   Blueprints (commissions.js): an order for a piece whose blueprint the
   player doesn't own shows locked, with no TAKE IT, until it is bought;
   buying it flips the card in place with a short highlight. Below the
   orders a greyed teaser shows the cheapest blueprint not owned yet, with
   a button to its card at Arbor Freight. The teaser is not an order and
   takes no slot, and it is hidden while the new-player flow runs.
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, C = G.Commissions, R = G.Registry, F = G.Farm, St = G.State;
  var P = root.Lathe.Paint, R0 = root.Lathe.CFG.R0;
  var host = root.__farm, board = G.commissions, state = host.state;
  function $(id) { return document.getElementById(id); }
  var listEl = $("orderList"), footEl = $("boardFoot"), toastEl = $("otoast"), overlay = $("gradeOverlay");
  var shown = false, sig = "", wasLocked = {}, justBought = {};

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
  var SW = 300, SH = 64;
  /* The outline of a profile (radius per slice), mirrored about the axis, as an SVG path. */
  function outline(t) {
    var n = t.length, mid = SH / 2, sc = (mid - 2) / R0, top = [], bot = [], i;
    for (i = 0; i < n; i += 2) { var x = (i / (n - 1)) * SW; top.push(x.toFixed(1) + "," + (mid - t[i] * sc).toFixed(1)); bot.push(x.toFixed(1) + "," + (mid + t[i] * sc).toFixed(1)); }
    var x1 = SW.toFixed(1);
    top.push(x1 + "," + (mid - t[n - 1] * sc).toFixed(1)); bot.push(x1 + "," + (mid + t[n - 1] * sc).toFixed(1));
    return "M" + top.join(" L") + " L" + bot.reverse().join(" L") + " Z";
  }
  /* The silhouette, filled with `inner` (wood, paint) and shaded as glossy as `gloss` (0..1). */
  function silhouette(id, d, inner, gloss) {
    return '<svg class="o-shape" viewBox="0 0 ' + SW + " " + SH + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><clipPath id="' + id + '"><path d="' + d + '"/></clipPath>' +
      '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="0.35" stop-color="#fff" stop-opacity="' + (0.08 + gloss * 0.3).toFixed(2) + '"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient></defs>' +
      '<g clip-path="url(#' + id + ')">' + inner + '<rect width="' + SW + '" height="' + SH + '" fill="url(#' + id + 'g)"/></g>' +
      '<path d="' + d + '" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="1"/></svg>';
  }
  /* A turned piece as it came off the lathe: its own profile, paint and sheen. */
  function pieceSvg(it) {
    var prof = St.unpack(it.profile), n = prof.length, wood = R.WOODS[it.wood] ? R.WOODS[it.wood].trunk : "#c99a5e";
    var inner = '<rect width="' + SW + '" height="' + SH + '" fill="' + wood + '"/>', c = it.coat || {}, gloss = 0;
    var coat = c.coat ? St.unpack(c.coat) : null, col = c.color ? St.unpack(c.color) : null, gl = c.gloss ? St.unpack(c.gloss) : null;
    var step = Math.max(1, Math.round(n / 120)), w = (SW / (n - 1)) * step + 0.6;
    if (coat && col) for (var i = 0; i < n; i += step) {
      if (!(coat[i] > 0.02)) continue;
      inner += '<rect x="' + ((i / (n - 1)) * SW - w / 2).toFixed(1) + '" y="0" width="' + w.toFixed(1) + '" height="' + SH + '" fill="' + hex([col[i * 3], col[i * 3 + 1], col[i * 3 + 2]]) + '" fill-opacity="' + Math.min(1, coat[i] * 1.05).toFixed(2) + '"/>';
    }
    if (gl) { for (var k = 0; k < gl.length; k++) gloss += gl[k]; gloss /= gl.length || 1; }
    return silhouette("pc" + it.id, outline(prof), inner, gloss);
  }
  function shapeSvg(o) {
    var t = C.targetProfile(o), W = SW, H = SH;
    var d = outline(t);
    var id = "osh" + o.id, wood = R.WOODS[o.wood] ? R.WOODS[o.wood].trunk : "#c99a5e";
    var bands = o.spec.segments.map(function (sg) {
      if (!sg.paint) return "";
      return '<rect x="' + (sg.a * W).toFixed(1) + '" y="0" width="' + ((sg.b - sg.a) * W + 0.6).toFixed(1) + '" height="' + H + '" fill="' + P.PALETTE[sg.paint].hex + '"/>';
    }).join("");
    return silhouette(id, d, '<rect width="' + W + '" height="' + H + '" fill="' + wood + '"/>' + bands, P.SHEEN[o.spec.sheen].gloss);
  }

  /* ---------------- what the shed has for an order ---------------- */
  /* Turned pieces of the order's wood in the shed. While the new-player flow runs,
     only one turned for it: the practice piece is not offered. */
  function ofWood(o) {
    var list = board.candidates(o.id);
    return api.guided ? list.filter(function (it) { return it.order === o.id; }) : list;
  }
  /* ...and of those, the ones the customer would actually take (close enough to pass). */
  function fits(o) {
    return ofWood(o).filter(function (it) { var g = board.preview(o.id, it.id); return g && g.accepted; });
  }
  /* Where the order's wood is on the farm: the first grown tree of it, and the one
     growing that is nearest to done (plot indexes, -1 for none). */
  function onFarm(o) {
    var f = host.farm, plots = f.state.plots, grown = -1, growing = -1, best = Infinity;
    for (var i = 0; i < plots.length; i++) {
      var p = plots[i];
      if (!p || p.wood !== o.wood) continue;
      if (f.isMature(p)) { if (grown < 0) grown = i; }
      else { var ms = f.remainingMs(p); if (ms < best) { best = ms; growing = i; } }
    }
    return { grown: grown, growing: growing };
  }
  function stockFor(o) {
    var inv = state.inventory, all = ofWood(o).length, ok = fits(o).length, farmAt = onFarm(o);
    return {
      blanks: inv.list("blank", function (it) { return it.wood === o.wood; }).length,
      logs: inv.count("log", o.wood),
      pieces: ok, misses: all - ok,
      grown: farmAt.grown, growing: farmAt.growing
    };
  }
  function haveLine(o, st) {
    var w = woodName(o.wood).toLowerCase(), parts = [];
    if (st.blanks) parts.push(st.blanks + " " + w + (st.blanks === 1 ? " blank" : " blanks"));
    if (st.logs) parts.push(st.logs + " " + w + (st.logs === 1 ? " log" : " logs"));
    if (st.pieces) parts.push(st.pieces + " turned " + (st.pieces === 1 ? "piece that fits" : "pieces that fit"));
    var miss = st.misses ? (st.misses === 1 ? "Your turned " + w + " piece isn't close enough for this one." : "Your " + st.misses + " turned " + w + " pieces aren't close enough for this one.") : "";
    if (st.blanks || st.logs) return "In the shed: " + parts.join(", ") + "." + (miss ? " " + miss : "");
    // nothing to turn in the shed: where the wood is on the farm
    var lead = parts.length ? "In the shed: " + parts.join(", ") + ". " : miss ? miss + " " : "";
    if (st.grown >= 0) return lead + "Your " + w + " tree is grown and ready to chop down for a blank.";
    if (st.growing >= 0) return lead + "Your " + w + " tree is growing: <b data-grow=\"" + st.growing + "\">" + F.formatDuration(host.farm.remainingMs(host.farm.plotAt(st.growing))) + "</b> to go.";
    return lead + "No " + w + " in the shed or on the farm.";
  }
  /* No wood to turn for an order: a button to get some. Chop down a grown tree, look in
     on a growing one, or plant one. */
  function getWood(o, st) {
    var wl = woodName(o.wood).toLowerCase();
    if (st.grown >= 0) return act("CHOP IT DOWN", "Take the order and go to the " + wl + " tree", "primary", "fell");
    if (st.growing >= 0) return act("SEE THE TREE", "On the farm", "", "seetree");
    var sd = seedFor(o), coins = state.wallet.balance("coins");
    return act("PLANT ONE", sd.price + " coins, " + sd.grow, sd.free < 0 || coins < sd.price ? "short" : "primary", "plant");
  }
  /* Coins a seed of this wood costs, how long it takes, and the first free plot. */
  function seedFor(o) {
    var f = host.farm, plots = f.state.plots, free = -1;
    for (var i = 0; i < plots.length; i++) if (!plots[i]) { free = i; break; }
    var instant = host.mine && host.mine.isUnlocked && host.mine.isUnlocked();
    return { price: f.plantPrice(o.wood), free: free, grow: instant ? "ready right away" : "grows in " + F.formatDuration(F.WOODS[o.wood].growMs) };
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
    return JSON.stringify([api.guided, B.blueprints, B.orders.map(function (o) { var st = stockFor(o); return [o.id, st.blanks, st.logs, st.pieces, st.misses, st.grown, st.growing]; }), state.wallet.balance("coins"), state.inventory.count("piece"), B.active, B.done, B.history.length, B.orders.length < C.CFG.BOARD_SIZE]);
  }
  function render(force) {
    if (!shown) return;
    board.refill();
    var s = signature();
    if (!force && s === sig) { tickClock(); return; }
    sig = s;
    var B = board.state, h = "";
    var flipped = [];
    B.orders.forEach(function (o) {
      var st = stockFor(o), on = B.active === o.id, name = pieceName(o), lock = board.locked(o);
      if ((wasLocked[o.id] || justBought[o.kind]) && !lock) flipped.push(o.id);
      wasLocked[o.id] = lock;
      h += '<article class="order' + (on ? " on" : "") + (lock ? " locked" : "") + '" data-order="' + o.id + '" data-wood="' + esc(o.wood) + '" data-kind="' + esc(o.kind) + '">';
      h += '<div class="o-top"><div class="o-who">Order from <b>' + esc(o.client) + '</b></div><div class="o-pay" title="Pay for a perfect job">' + COIN + "<b>" + o.reward + "</b></div></div>";
      h += '<h3 class="o-name">' + esc(name) + (on ? '<span class="o-badge">ON THE LATHE</span>' : "") + "</h3>";
      h += shapeSvg(o);
      h += '<div class="o-tags"><span class="tag"><i class="dot" style="background:' + (R.WOODS[o.wood] ? R.WOODS[o.wood].trunk : "#c99a5e") + '"></i>' + woodName(o.wood) + "</span>";
      h += '<span class="tag">' + esc(o.spec.name) + "</span><span class=\"tag\">" + P.SHEEN[o.spec.sheen].name + " finish</span></div>";
      h += '<p class="o-blurb">' + esc(C.PIECES[o.kind].blurb) + "</p>";
      h += '<p class="o-have' + (st.blanks || st.logs || st.pieces ? "" : st.grown >= 0 ? " ready" : st.growing >= 0 ? " growing" : " none") + '">' + haveLine(o, st) + "</p>";
      if (lock) h += '<p class="o-lock"><b>Locked.</b> Needs the ' + esc(name) + " blueprint" + (api.guided ? "." : ", from Arbor Freight.") + "</p>";
      h += '<div class="row">';
      if (lock) {
        if (!api.guided) {
          h += act("SEE BLUEPRINT", C.PIECES[o.kind].price + " coins at Arbor Freight", "primary", "blueprint");
          h += act("DECLINE", "Another order comes in " + F.formatDuration(C.CFG.NEW_ORDER_MS), "", "decline");
        }
      } else if (on) {
        if (!st.blanks && !st.logs && !api.guided && !(root.__lathe && root.__lathe.stock && root.__lathe.wood === o.wood)) h += getWood(o, st);
        h += act("GO TO LATHE", "Turn it to the dashed line", "primary", "lathe");
        h += act("PUT ASIDE", "Keep the order, free the lathe", "", "release");
      } else {
        // while the new-player flow runs, the board is just its two orders: no practising, declining or rushing
        if (st.blanks || st.logs) {
          h += act("TAKE IT", "Put the " + woodName(o.wood).toLowerCase() + " on the lathe", "primary", "take");
          if (!api.guided) h += act("PRACTISE", "On a free practice blank. Your " + woodName(o.wood).toLowerCase() + " stays in the shed", "practice", "practise");
        } else if (!api.guided) {
          h += getWood(o, st);
          h += act("PRACTISE IT", "Practice only: it needs " + woodName(o.wood).toLowerCase() + " to deliver", "practice", "take");
        }
        if (!api.guided) h += act("DECLINE", "Another order comes in " + F.formatDuration(C.CFG.NEW_ORDER_MS), "", "decline");
      }
      if (st.pieces && !lock) h += act("DELIVER", st.pieces === 1 ? "A turned piece in the shed fits" : st.pieces + " turned pieces in the shed fit", on ? "" : "", "deliver");   // only pieces it would accept
      h += "</div></article>";
    });
    for (var k = B.orders.length; k < C.CFG.BOARD_SIZE && !api.guided; k++) {
      var dia = state.wallet.balance("diamonds"), cost = C.CFG.RUSH_DIAMONDS;
      h += '<article class="order empty"><p>A new order comes in <b data-wait>' + waitText() + "</b>.</p>" +
        '<div class="row">' + act("GET ONE NOW", cost + (cost === 1 ? " diamond" : " diamonds") + ". You have " + dia + ".", dia >= cost ? "" : "short", "rush") + "</div></article>";
    }
    var tk = api.guided ? null : board.teaser();
    if (tk) {
      var tdef = C.PIECES[tk];
      h += '<article class="order teaser" data-teaser="' + tk + '">' + G.BlueprintArt.blueprintSVG(tk, { id: "teaser" + tk }) +
        '<p class="o-teaser"><b>' + esc(tdef.name) + "</b>: get the blueprint at Arbor Freight. Orders for it pay up to " + Math.round(tdef.base * (1 + C.CFG.BONUS)) + " coins in pine.</p>" +
        '<div class="row">' + act("SEE IT", tdef.price + " coins", "", "teaser") + "</div></article>";
    }
    listEl.innerHTML = h;
    justBought = {};
    flipped.forEach(function (id) { var el = listEl.querySelector('[data-order="' + id + '"]'); if (el) el.classList.add("unlocked"); });
    var f = "", recent = B.history.slice(-5).reverse();
    if (recent.length) {
      f += '<section class="order hist" aria-label="Delivered commissions"><div class="h-top"><span class="h-k">DELIVERED</span><span class="h-n">' + B.done + (B.done === 1 ? " commission" : " commissions") + "</span></div>";
      f += '<ul class="b-hist">' + recent.map(function (r) {
        var w = R.WOODS[r.wood];
        return '<li>' + starsHtml(r.stars) + '<span class="h-what"><b>' + esc(C.PIECES[r.kind] ? C.PIECES[r.kind].name : r.kind) + "</b><small>for " + esc(r.client) + (w ? " · " + w.name : "") + '</small></span><span class="h-pay">' + COIN + "+" + r.pay + "</span></li>";
      }).join("") + "</ul></section>";
    }
    var nPieces = state.inventory.count("piece");
    f += '<section class="order hist" aria-label="Your pieces"><div class="h-top"><span class="h-k">YOUR PIECES</span><span class="h-n">' + (nPieces ? nPieces + (nPieces === 1 ? " in the shed" : " in the shed") : "none yet") + "</span></div>" +
      (nPieces ? '<div class="row">' + act("SEE THEM", "Everything you've turned and kept", "", "pieces") + "</div>" : '<p class="b-help">Press DONE on the lathe to keep what you turn. It waits in the shed for an order.</p>') + "</section>";
    f += '<section class="order help" aria-label="How orders work"><div class="h-top"><span class="h-k">HOW ORDERS WORK</span></div>' +
      '<p class="b-help">Take an order, turn the shape, paint it, spray the finish, then press DONE on the lathe. The closer it is to the order, the more it pays. Only the wood the order names will do.</p></section>';
    footEl.innerHTML = f;
  }
  function tickClock() {
    var w = waitText();
    Array.prototype.forEach.call(listEl.querySelectorAll("[data-wait]"), function (el) { if (el.textContent !== w) el.textContent = w; });
    Array.prototype.forEach.call(listEl.querySelectorAll("[data-grow]"), function (el) {
      var p = host.farm.plotAt(parseInt(el.getAttribute("data-grow"), 10)), t = p ? F.formatDuration(host.farm.remainingMs(p)) : "";
      if (el.textContent !== t) el.textContent = t;
    });
  }

  listEl.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!b) return;
    var tz = b.closest("[data-teaser]");
    if (tz) { openBlueprint(tz.getAttribute("data-teaser")); return; }
    var card = b.closest("[data-order]"), id = card ? parseInt(card.getAttribute("data-order"), 10) : 0;
    var o = board.get(id), what = b.getAttribute("data-act");
    if (!o) return;
    if (what === "blueprint") { openBlueprint(o.kind); return; }
    if ((what === "take" || what === "practise") && board.locked(o)) { toast("That needs the " + pieceName(o) + " blueprint first."); return; }
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
    } else if (what === "fell") {             // take the order, and go and chop down that tree
      var at = onFarm(o).grown;
      if (at < 0) { render(true); return; }
      if (!board.locked(o)) board.accept(id);
      if (root.Lathe.syncOrder) root.Lathe.syncOrder();
      G.harvestPlot = at;
      if (root.Lathe.harvestHost.fresh) root.Lathe.harvestHost.fresh();
      G.showScreen("harvest");
    } else if (what === "seetree") {
      var g = onFarm(o).growing;
      G.showScreen("farm");
      if (g >= 0 && host.select) host.select(g);
    } else if (what === "plant") {
      askPlant(o);
    }
  });
  /* ---------------- your pieces ----------------
     Everything turned and kept, newest first, drawn as it came off the lathe. Each
     says what it was turned for, and which order on the board would take it now
     and for how much, with DELIVER right there. */
  function bestFit(it) {
    var best = null;
    board.state.orders.forEach(function (o) {
      if (o.wood !== it.wood || board.locked(o)) return;
      var g = board.preview(o.id, it.id);
      if (g && g.accepted && (!best || g.pay > best.g.pay)) best = { o: o, g: g };
    });
    return best;
  }
  function showPieces() {
    var inv = state.inventory, list = inv.list("piece").slice().reverse();
    var h = '<div class="grade-card pieces-card"><h2 id="gradeTitle">Your pieces</h2>';
    var stock = [];
    inv.list("log").forEach(function (s) { stock.push(s.count + " " + woodName(s.key).toLowerCase() + (s.count === 1 ? " log" : " logs")); });
    var bl = {};
    inv.list("blank").forEach(function (it) { bl[it.wood] = (bl[it.wood] || 0) + 1; });
    for (var w in bl) stock.push(bl[w] + " " + woodName(w).toLowerCase() + (bl[w] === 1 ? " blank" : " blanks"));
    h += '<p class="g-note">' + (list.length ? list.length + (list.length === 1 ? " turned piece" : " turned pieces") + " in the shed." : "No turned pieces yet. Press DONE on the lathe to keep what you turn.") +
      (stock.length ? " Also waiting to be turned: " + stock.join(", ") + "." : "") + "</p>";
    if (list.length) {
      h += '<div class="p-list">';
      list.forEach(function (it) {
        var made = it.order != null && board.get(it.order), fit = bestFit(it);
        var sheen = it.sheen && P.SHEEN[it.sheen] ? P.SHEEN[it.sheen].name + " finish" : "No finish";
        h += '<div class="p-item" data-piece="' + it.id + '">' + pieceSvg(it) +
          '<div class="p-what"><b>' + esc(woodName(it.wood)) + " " + esc((it.shape || "piece").toLowerCase()) + "</b><small>" + esc(sheen) +
          (made ? ". Turned for " + esc(made.client) + "'s " + esc(pieceName(made).toLowerCase()) : "") + ".</small></div>";
        if (fit) h += '<div class="p-fit">' + starsHtml(fit.g.stars) + '<span>' + esc(fit.o.client) + " would pay " + COIN + "<b>" + fit.g.pay + "</b></span>" +
          '<button type="button" class="act primary p-give" data-give="' + fit.o.id + '"><span class="an">DELIVER</span></button></div>';
        else h += '<div class="p-fit none">No order on the board would take it right now.</div>';
        h += "</div>";
      });
      h += "</div>";
    }
    h += '<div class="row">' + act("CLOSE", "Back to work", "", "closepieces") + "</div></div>";
    overlay.innerHTML = h; overlay.hidden = false;
    overlay.querySelector('[data-act="closepieces"]').addEventListener("click", closeOverlay);
    Array.prototype.forEach.call(overlay.querySelectorAll("[data-give]"), function (b) {
      b.addEventListener("click", function () {
        var pid = parseInt(b.closest("[data-piece]").getAttribute("data-piece"), 10);
        give(parseInt(b.getAttribute("data-give"), 10), pid);
      });
    });
  }
  /* PLANT ONE asks first: what it costs, how long it takes and where it goes. */
  function askPlant(o) {
    var sd = seedFor(o), coins = state.wallet.balance("coins"), w = woodName(o.wood), wl = w.toLowerCase();
    if (G.tutorialHoldsCoins && G.tutorialHoldsCoins()) { toast(G.tutorialHoldsCoins()); return; }
    if (sd.free < 0) { toast("Every plot is taken. Clear new land on the farm."); G.showScreen("farm"); return; }
    if (coins < sd.price) {
      toast(article(wl).replace(/^a/, "A") + " " + wl + " seed costs " + sd.price + " coins. You have " + coins + ". The farm can plant one for an ad.");
      G.showScreen("farm"); if (host.select) host.select(sd.free);
      return;
    }
    var h = '<div class="grade-card"><h2 id="gradeTitle">Plant ' + article(wl) + " " + esc(wl) + "?</h2>" +
      '<p class="g-note">For ' + esc(o.client) + "'s " + esc(pieceName(o).toLowerCase()) + ". It goes in plot " + (sd.free + 1) + " and " + sd.grow + ".</p>" +
      '<p class="g-pay">Costs ' + COIN + "<b>" + sd.price + "</b>. You have " + coins + ".</p>" +
      '<div class="row">' + act("PLANT IT", "Spend " + sd.price + " coins", "primary", "doplant") + act("NOT NOW", "Back to the orders", "", "noplant") + "</div></div>";
    overlay.innerHTML = h; overlay.hidden = false;
    overlay.querySelector('[data-act="noplant"]').addEventListener("click", closeOverlay);
    overlay.querySelector('[data-act="doplant"]').addEventListener("click", function () {
      var r = host.farm.plant(sd.free, o.wood);
      closeOverlay();
      if (!r.ok) { toast(r.reason === "not enough coins" ? "Not enough coins for that seed." : "That plot is taken now. Try again."); render(true); return; }
      host.renderWallet();
      var p = host.farm.plotAt(sd.free);
      toast(w + " planted in plot " + (sd.free + 1) + "." + (p && host.farm.isMature(p) ? " It's grown already." : " It'll be ready in " + F.formatDuration(host.farm.remainingMs(p)) + "."));
      render(true);
    });
  }
  footEl.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-act="pieces"]') : null;
    if (b) showPieces();
  });
  /* The shop, on one blueprint's card. */
  function openBlueprint(kind) {
    G.showScreen("shop");
    if (G.ShopUI && G.ShopUI.focusBlueprint) G.ShopUI.focusBlueprint(kind);
  }
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
    h += bar("SHAPE", g.shape) + bar("PAINT", g.paint) + bar("SHEEN", g.sheen) + bar("SMOOTH", g.smooth);
    h += '<p class="g-note">' + P.SHEEN[o.spec.sheen].name + " wanted, " + P.SHEEN[g.sheenGot].name.toLowerCase() + " given.</p>";
    return h;
  }
  /* The lathe's DONE with an order on it: show what this piece earns, and let
     the player hand it over or keep it to try again. */
  var offered = {};   // 3-star grades already felt here, so DELIVER right after does not buzz twice
  function offer(orderId, pieceId) {
    var o = board.get(orderId), g = board.preview(orderId, pieceId);
    if (!o || !g) return;
    var h = '<div class="grade-card"><h2 id="gradeTitle">' + esc(pieceName(o)) + " for " + esc(o.client) + "</h2>";
    if (g.stars >= 3 && G.Haptics) { G.Haptics.pulse("stars3"); offered[orderId + ":" + pieceId] = 1; }   // only 3 stars buzzes: a pulse means great
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
    if (g.stars >= 3 && G.Haptics && !offered[orderId + ":" + pieceId]) G.Haptics.pulse("stars3");
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
    offer: offer, render: render, toast: toast, showPieces: showPieces,
    /* A blueprint was just bought: its orders flash as they unlock, next time the board shows. */
    bought: function (kind) { justBought[kind] = true; sig = ""; },
    guided: !!(G.tutorial && G.tutorial.guidedBoard())   // the new-player flow is running (tutorial-ui.js keeps this up to date)
  };
  G.OrdersUI = api;
  root.__orders = { board: board, ui: api };
  if (G.startScreen === "orders") api.show();
})(window);

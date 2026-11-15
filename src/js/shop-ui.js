/* ============================================================
   Arbor Freight, the store screen (the SHOP tab). Draws the
   lines from the shop model (shop.js), takes BUY taps, and tells
   the lathe to put the upgrade to work. The model never knows
   the DOM exists.

   A line's card shows what is installed, the next rung for sale
   with its price tag and a BUY button, and the rungs after it, so
   the player can see what they are saving toward. Every rung owned
   gets a USE button (ACTIVE on the one in use), so a player can go back
   to the old lamp or a coarser grit; chisels only add to the rack, so
   that line has none.

   Below the lines, DECORATIONS (decor.js): things for the workshop, each
   bought once and shown in the 3D workshop. The disco ball also joins
   Lighting's USE list; the radio gets PLAY / STOP here (or tap it on the
   lathe). G.toggleRadio is how the lathe's tap reaches it.

   Above the lines, BLUEPRINTS: a card per piece with its drawing
   (blueprint-art.js), what it pays, and BUY IT / SAVE UP / OWNED.
   Blueprints belong to the board (commissions.js buyBlueprint), since
   they decide which orders it rolls. focusBlueprint(kind) scrolls to a
   card and flashes it (the board's teaser opens the shop on one).
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, Sh = G.Shop, C = G.Commissions, Art = G.BlueprintArt;
  var host = root.__farm, shop = G.shop, state = host.state, board = G.commissions, decor = G.decor, Dec = G.Decor;
  function $(id) { return document.getElementById(id); }
  var bodyEl = $("shopBody"), toastEl = $("stoast");
  var shown = false, sig = "";

  var COIN = '<svg class="coin" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#e8a33d" stroke="#8a5a1c" stroke-width="2"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="#8a5a1c" stroke-width="1.6"/></svg>';
  var ICON = {
    light: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2v6" stroke="#222" stroke-width="2"/><path d="M11 8h10l2 6H9z" fill="#3a3a3a"/><circle cx="16" cy="19" r="6" fill="#ffe2a8"/><path d="M8 26l-3 3M24 26l3 3M16 28v3" stroke="#f2c230" stroke-width="2" stroke-linecap="round"/></svg>',
    motor: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="9" width="18" height="15" rx="3" fill="#46625a"/><path d="M7 12v9M10 12v9M13 12v9M16 12v9M19 12v9" stroke="#2b3532" stroke-width="1.4"/><rect x="22" y="14" width="6" height="5" rx="1" fill="#99a1a6"/><rect x="6" y="24" width="14" height="3" fill="#2b3532"/></svg>',
    brushes: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="13" y="16" width="6" height="14" rx="2" fill="#7c4a22"/><rect x="11.5" y="11" width="9" height="6" rx="1" fill="#c8cfd4"/><path d="M11 11c0-5 2-9 5-9s5 4 5 9z" fill="#2f5fb3"/></svg>',
    finish: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="12" width="9" height="16" rx="3" fill="#a9d3e8" stroke="#5b8396" stroke-width="1.4"/><rect x="10.5" y="7" width="6" height="5" fill="#3a3a3a"/><path d="M16.5 8h6l-1 3h-5z" fill="#3a3a3a"/><path d="M24 7l4-2M24 9.5h5M24 12l4 2" stroke="#e8a33d" stroke-width="1.6" stroke-linecap="round"/></svg>',
    abrasives: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 10h22l-3 15H8z" fill="#c9a26a" stroke="#7c5a2a" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 10c5-4 17-4 22 0" fill="none" stroke="#7c5a2a" stroke-width="1.4"/><g fill="#7c5a2a"><circle cx="11" cy="15" r="1"/><circle cx="16" cy="18" r="1"/><circle cx="21" cy="14" r="1"/><circle cx="20" cy="21" r="1"/><circle cx="13" cy="21" r="1"/></g></svg>',
    chisels: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 3l3 0 0 14-1.5 3-1.5-3z" fill="#d6dde1"/><rect x="7.5" y="20" width="4" height="10" rx="1.5" fill="#7c4a22"/><path d="M19 3h5v12c0 2-1.2 3.5-2.5 3.5S19 17 19 15z" fill="#d6dde1"/><rect x="19.5" y="19" width="4" height="11" rx="1.5" fill="#7c4a22"/></svg>'
  };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("on"); }, 3400);
  }

  function signature() {
    return JSON.stringify([shop.state.owned, shop.state.active, decor.state, state.wallet.balance("coins"), board.state.blueprints, G.progress && G.progress.state.totalStars]);
  }
  function render(force) {
    if (!shown) return;
    var s = signature();
    if (!force && s === sig) return;
    sig = s;
    var coins = state.wallet.balance("coins");
    var h = '<div class="af-banner"><div class="af-logo">ARBOR <b>FREIGHT</b></div>' +
      '<div class="af-tag">Tools for people who turn wood, and a profit.</div>' +
      '<div class="af-sale">EVERYDAY LOW-ISH PRICES</div></div>';
    h += blueprintsHtml(coins);
    Sh.LINE_ORDER.forEach(function (k) {
      var ln = Sh.LINES[k], lv = shop.level(k), cur = shop.current(k), nx = shop.next(k);
      h += '<section class="af-line" data-line="' + k + '">';
      h += '<div class="af-head"><span class="af-icon">' + ICON[k] + '</span><div><h2>' + ln.name.toUpperCase() + "</h2><p>" + esc(ln.blurb) + '</p></div><span class="af-step">' + (lv + 1) + " / " + ln.tiers.length + "</span></div>";
      if (shop.switchable(k)) {
        // every rung owned, with USE on it (ACTIVE on the one in use)
        h += '<div class="af-own"><span class="af-k">' + (lv ? "YOURS: PICK ONE TO USE" : "INSTALLED") + "</span>";
        for (var t = 0; t <= lv; t++) {
          var on = t === shop.activeLevel(k), tr = ln.tiers[t];
          h += tierRow(k, t, tr, on);
        }
        // a decoration that can stand in for this line (the disco ball, for the light)
        shop.decorTiers(k).forEach(function (d) { h += tierRow(k, d.id, d.tier, shop.activeLevel(k) === -1 && shop.current(k) === d.tier); });
        h += "</div>";
      } else {
        h += '<div class="af-now"><span class="af-k">INSTALLED</span><b>' + esc(cur.name) + "</b><small>" + esc(cur.blurb) + "</small></div>";
      }
      if (nx) {
        var ok = coins >= nx.price;
        h += '<div class="af-item"><div class="af-text"><span class="af-k">NEXT UP</span><b>' + esc(nx.name) + "</b><small>" + esc(nx.blurb) + '</small></div><div class="af-price" aria-label="' + nx.price + ' coins">' + COIN + "<b>" + nx.price + "</b></div></div>";
        h += '<button type="button" class="act primary af-buy" data-buy="' + k + '"' + (ok ? "" : ' aria-disabled="true"') + '><span class="an">' + (ok ? "BUY IT" : "SAVE UP") + '</span><span class="ad">' +
          (ok ? nx.price + " coins. You have " + coins + "." : "You need " + (nx.price - coins) + " more coins. Orders pay.") + "</span></button>";
        var later = ln.tiers.slice(lv + 2);
        if (later.length) h += '<p class="af-later">Then: ' + later.map(function (t) { return esc(t.name) + " <b>" + t.price + "</b>"; }).join(" · ") + "</p>";
      } else {
        h += '<p class="af-top">Top of the line. Nothing bigger in the catalogue.</p>';
      }
      h += "</section>";
    });
    h += decorHtml(coins);
    h += '<p class="af-foot">All sales final. Prices go up as you go up the line, because of course they do.</p>';
    bodyEl.innerHTML = h;
  }

  function tierRow(k, t, tr, on) {
    return '<div class="af-tier' + (on ? " on" : "") + '"><div class="af-text"><b>' + esc(tr.name) + "</b>" + (on ? "<small>" + esc(tr.blurb) + "</small>" : "") + "</div>" +
      '<button type="button" class="act af-use' + (on ? " active" : "") + '" data-use="' + k + '" data-tier="' + t + '"' + (on ? ' aria-pressed="true" aria-disabled="true"' : "") + '><span class="an">' + (on ? "ACTIVE" : "USE") + "</span></button></div>";
  }

  /* ---------------- decorations ---------------- */
  var DECOR_ICON = {
    radio: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="11" width="24" height="16" rx="3" fill="#7a4a26"/><rect x="7" y="14" width="10" height="10" rx="1" fill="#c9b48a"/><circle cx="22" cy="18" r="3" fill="#ffc14d"/><path d="M20 11 L26 3" stroke="#bbb" stroke-width="1.5"/></svg>',
    string_lights: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M2 8 Q16 20 30 8" fill="none" stroke="#2b241b" stroke-width="1.5"/><g fill="#ffc46b"><circle cx="6" cy="12" r="2.4"/><circle cx="12" cy="15" r="2.4"/><circle cx="20" cy="15" r="2.4"/><circle cx="26" cy="12" r="2.4"/></g></svg>',
    cat: '<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="17" cy="20" rx="10" ry="6" fill="#d9822b"/><circle cx="9" cy="16" r="5" fill="#d9822b"/><path d="M5 13 L6 8 L9 12 Z M10 12 L13 8 L13 13 Z" fill="#d9822b"/><path d="M27 21 Q31 16 27 13" fill="none" stroke="#d9822b" stroke-width="2.4" stroke-linecap="round"/><rect x="6" y="26" width="20" height="3" rx="1" fill="#6b4a2a"/></svg>',
    trophy_wall: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="22" width="28" height="3" fill="#6b4a2a"/><path d="M6 21 Q4 13 6 7 Q8 13 6 21Z" fill="#c9884a"/><path d="M14 21 Q11 14 14 5 Q17 14 14 21Z" fill="#e0b321"/><path d="M23 21 Q20 15 23 9 Q26 15 23 21Z" fill="#a3684a"/><rect x="11" y="26" width="6" height="3" fill="#f2c230"/></svg>',
    disco: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 1v6" stroke="#aaa"/><circle cx="16" cy="17" r="10" fill="#cfd6de"/><path d="M6 17h20M16 7v20M9 10l14 14M23 10L9 24" stroke="#8a96a3" stroke-width="0.8"/><circle cx="12" cy="13" r="1.5" fill="#fff"/><circle cx="5" cy="28" r="1.6" fill="#ff4d6d"/><circle cx="27" cy="27" r="1.6" fill="#4dd2ff"/><circle cx="28" cy="6" r="1.4" fill="#ffe14d"/></svg>'
  };
  function decorHtml(coins) {
    var h = '<section class="af-line af-decor" id="afDecor"><div class="af-head"><span class="af-icon">' + DECOR_ICON.disco + '</span><div><h2>DECORATIONS</h2><p>Make the workshop yours. Each one is bought once and shows around the lathe.</p></div></div>';
    Dec.ORDER.forEach(function (id) {
      var it = Dec.ITEMS[id], own = decor.owns(id), ok = coins >= it.price;
      h += '<div class="dc-card' + (own ? " owned" : "") + '" data-decor-card="' + id + '"><span class="af-icon">' + DECOR_ICON[id] + '</span><div class="af-text"><b>' + esc(it.name) + "</b><small>" + esc(it.blurb) + "</small></div>";
      if (!own) h += '<div class="af-price" aria-label="' + it.price + ' coins">' + COIN + "<b>" + it.price + "</b></div>";
      h += "</div>";
      if (!own) {
        h += '<button type="button" class="act primary af-buy" data-decor="' + id + '"' + (ok ? "" : ' aria-disabled="true"') + '><span class="an">' + (ok ? "BUY IT" : "SAVE UP") + '</span><span class="ad">' +
          (ok ? it.price + " coins. You have " + coins + "." : "You need " + (it.price - coins) + " more coins. Orders pay.") + "</span></button>";
      } else if (id === "radio") {
        var on = decor.radioOn();
        h += '<button type="button" class="act' + (on ? "" : " primary") + ' af-buy" data-radio="1" aria-pressed="' + on + '"><span class="an">' + (on ? "STOP THE RADIO" : "PLAY THE RADIO") + '</span><span class="ad">' + (on ? "It's playing in the workshop" : "Or tap it on the shelf by the lathe") + "</span></button>";
      } else if (id === "disco") {
        var lit = shop.discoOn && shop.discoOn();
        h += '<button type="button" class="act' + (lit ? " owned" : " primary") + ' af-buy" data-use="light" data-tier="disco"' + (lit ? ' aria-disabled="true"' : "") + '><span class="an">' + (lit ? "IT'S YOUR LIGHT" : "USE AS THE LIGHT") + '</span><span class="ad">' + (lit ? "Pick a lamp under Lighting to see the work again" : "It hangs where the work light hangs") + "</span></button>";
      } else {
        h += '<p class="dc-owned">OWNED. It\'s in the workshop.</p>';
      }
    });
    return h + "</section>";
  }
  var DECOR_DONE = {
    radio: "It's on the shelf by the lathe. Tap it to play.",
    string_lights: "They're up along the rafters.",
    cat: "It's already asleep on the stool.",
    trophy_wall: "Your best pieces are on the shelf.",
    disco: "It's hanging where the work light was. Pick a lamp under Lighting any time."
  };
  function buyDecor(id) {
    var held = G.tutorialHoldsCoins && G.tutorialHoldsCoins();
    if (held) { toast(held); return; }
    var r = decor.buy(id);
    if (!r.ok) { if (r.reason === "not enough coins") toast("That's " + r.need + " coins and you have " + r.have + ". The orders board pays."); return; }
    if (root.Lathe.audio && root.Lathe.audio.buy) root.Lathe.audio.buy();
    if (id === "disco") shop.use("light", "disco");   // it goes up straight away: that's the fun of it
    toast("Bought: " + r.item.name + ". " + DECOR_DONE[id]);
    if (root.Lathe.applyUpgrades) root.Lathe.applyUpgrades();
    host.renderWallet();
    render(true);
  }
  /* The radio, on or off: from its button here, or a tap on it by the lathe. */
  G.toggleRadio = function () {
    if (!decor.owns("radio")) return false;
    var A = root.Lathe.audio;
    A.init();
    decor.setRadio(!decor.radioOn());
    A.radio(decor.radioOn());
    if (root.Lathe.applyUpgrades) root.Lathe.applyUpgrades();
    var say = decor.radioOn() ? "The radio's on." : "The radio's off.";
    if (G.currentScreen && G.currentScreen() === "shop") toast(say); else if (root.Lathe.toast) root.Lathe.toast(say);
    render(true);
    return decor.radioOn();
  };

  /* ---------------- blueprints ---------------- */
  function blueprintsHtml(coins) {
    var h = '<section class="af-line af-bp" id="afBlueprints"><div class="af-head"><span class="af-icon bp-icon">' + BP_ICON + '</span><div><h2>BLUEPRINTS</h2><p>Plans for new pieces. Own the plan and customers start ordering that piece. Harder pieces pay more.</p></div></div>';
    // the ones still for sale first, cheapest at the top; what is owned below
    C.BLUEPRINT_ORDER.filter(function (k) { return !board.ownsBlueprint(k); }).concat(C.BLUEPRINT_ORDER.filter(function (k) { return board.ownsBlueprint(k); })).forEach(function (k) {
      var def = C.PIECES[k], own = board.ownsBlueprint(k), ok = coins >= def.price;
      var pay = Math.round(def.base * (1 + C.CFG.BONUS));
      h += '<div class="bp-card' + (own ? " owned" : "") + '" data-bp-card="' + k + '">';
      h += Art.blueprintSVG(k, { owned: own, afford: own || ok, id: "shop" + k });
      h += '<div class="bp-text"><b>' + esc(def.name) + "</b>" + (own && G.ProgressUI ? '<span class="bp-mastery">' + esc(G.ProgressUI.masteryText(k)) + "</span>" : "") + "<small>" + esc(def.blurb) + ' Pays up to <span class="bp-pay">' + COIN + pay + "</span> coins in pine.</small></div>";
      if (own) h += '<button type="button" class="act af-buy bp-buy owned" data-blueprint="' + k + '" aria-disabled="true"><span class="an">OWNED</span><span class="ad">' + (def.price ? "Its orders turn up on the board" : "It came with the shed") + "</span></button>";
      else h += '<button type="button" class="act primary af-buy bp-buy" data-blueprint="' + k + '"' + (ok ? "" : ' aria-disabled="true"') + '><span class="an">' + (ok ? "BUY IT" : "SAVE UP") + '</span><span class="ad">' +
        (ok ? def.price + " coins. You have " + coins + "." : "You need " + (def.price - coins) + " more coins. Orders pay.") + "</span></button>";
      h += "</div>";
    });
    return h + "</section>";
  }
  var BP_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="6" width="26" height="20" rx="2" fill="#1d4a8a"/><path d="M7 16c3-5 6 0 9-1s5-4 9 1c-4 5-6 2-9 1s-6 4-9-1z" fill="none" stroke="#f4f8ff" stroke-width="1.4"/><path d="M5 16h22" stroke="#f4f8ff" stroke-width="0.7" stroke-dasharray="3 1.5"/></svg>';
  function buyBlueprint(k) {
    var held = k !== "baseball_bat" && G.tutorialHoldsCoins && G.tutorialHoldsCoins();
    if (held) { toast(held); return { ok: false, reason: "held" }; }
    var r = board.buyBlueprint(k);
    if (!r.ok) {
      if (r.reason === "not enough coins") toast("That blueprint is " + r.need + " coins and you have " + r.have + ". The orders board pays.");
      return r;
    }
    if (root.Lathe.audio && root.Lathe.audio.buy) root.Lathe.audio.buy();
    toast("Blueprint bought: " + C.PIECES[k].name + ". Orders for it come in on the board now.");
    host.renderWallet();
    render(true);
    flash(k);
    if (G.OrdersUI) { if (G.OrdersUI.bought) G.OrdersUI.bought(k); G.OrdersUI.render(true); }
    return r;
  }
  function flash(k, sel) {
    var card = bodyEl.querySelector(sel || '[data-bp-card="' + k + '"]');
    if (!card) return null;
    card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    setTimeout(function () { card.classList.remove("flash"); }, 1600);
    return card;
  }
  /* Show the store on one blueprint's card (the board's teaser lands here). */
  function focusBlueprint(k) {
    render(true);
    var card = flash(k);
    if (card && card.scrollIntoView) card.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* Show the store on one line (the lathe's tool drawer lands here). */
  function focusLine(k) {
    render(true);
    var card = flash(k, '.af-line[data-line="' + k + '"]');
    if (card && card.scrollIntoView) card.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  var WHERE = {
    light: "Go and see it hanging over the lathe.",
    motor: "The lathe cuts faster now.",
    chisels: "It is on the rack by the lathe, with the other chisels.",
    abrasives: "The new sheet is on the rack: sanding is faster and smoother now.",
    brushes: "Paint goes on faster now.",
    finish: "The sheen builds faster and more evenly now."
  };
  bodyEl.addEventListener("click", function (ev) {
    var dz = ev.target.closest ? ev.target.closest("[data-decor]") : null;
    if (dz) { buyDecor(dz.getAttribute("data-decor")); return; }
    if (ev.target.closest && ev.target.closest("[data-radio]")) { G.toggleRadio(); return; }
    var u = ev.target.closest ? ev.target.closest("[data-use]") : null;
    if (u) {
      var tierAttr = u.getAttribute("data-tier"), r0 = shop.use(u.getAttribute("data-use"), /^\d+$/.test(tierAttr) ? parseInt(tierAttr, 10) : tierAttr);
      if (r0.ok && !r0.same) {
        toast("Using: " + r0.tier.name + ".");
        if (root.Lathe.applyUpgrades) root.Lathe.applyUpgrades();
        render(true);
      }
      return;
    }
    var bp = ev.target.closest ? ev.target.closest("[data-blueprint]") : null;
    if (bp) { if (!bp.classList.contains("owned")) buyBlueprint(bp.getAttribute("data-blueprint")); return; }
    var b = ev.target.closest ? ev.target.closest("[data-buy]") : null;
    if (!b) return;
    var k = b.getAttribute("data-buy");
    // the tutorial's 100 coins are for the bat blueprint: nothing else until it is bought
    var held = G.tutorialHoldsCoins && G.tutorialHoldsCoins();
    if (held) { toast(held); return; }
    var r = shop.buy(k);
    if (!r.ok) {
      if (r.reason === "not enough coins") toast("That is " + r.need + " coins and you have " + r.have + ". The orders board pays.");
      return;
    }
    if (root.Lathe.audio && root.Lathe.audio.buy) root.Lathe.audio.buy();
    toast("Installed: " + r.tier.name + ". " + WHERE[k]);
    if (root.Lathe.applyUpgrades) root.Lathe.applyUpgrades();
    host.renderWallet();
    render(true);
  });
  setInterval(function () { if (shown) render(false); }, 1000);

  var api = { show: function () { shown = true; render(true); }, hide: function () { shown = false; }, render: render, toast: toast, focusBlueprint: focusBlueprint, focusLine: focusLine, buyBlueprint: buyBlueprint };
  G.ShopUI = api;
  root.__shop = { shop: shop, ui: api };
  if (G.startScreen === "shop") api.show();
})(window);

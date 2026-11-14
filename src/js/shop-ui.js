/* ============================================================
   Arbor Freight, the store screen (the SHOP tab). Draws the
   lines from the shop model (shop.js), takes BUY taps, and tells
   the lathe to put the upgrade to work. The model never knows
   the DOM exists.

   A line's card shows what is installed, the next rung for sale
   with its price tag and a BUY button, and the rungs after it, so
   the player can see what they are saving toward.

   Above the lines, BLUEPRINTS: a card per piece with its drawing
   (blueprint-art.js), what it pays, and BUY IT / SAVE UP / OWNED.
   Blueprints belong to the board (commissions.js buyBlueprint), since
   they decide which orders it rolls. focusBlueprint(kind) scrolls to a
   card and flashes it (the board's teaser opens the shop on one).
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, Sh = G.Shop, C = G.Commissions, Art = G.BlueprintArt;
  var host = root.__farm, shop = G.shop, state = host.state, board = G.commissions;
  function $(id) { return document.getElementById(id); }
  var bodyEl = $("shopBody"), toastEl = $("stoast");
  var shown = false, sig = "";

  var COIN = '<svg class="coin" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#e8a33d" stroke="#8a5a1c" stroke-width="2"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="#8a5a1c" stroke-width="1.6"/></svg>';
  var ICON = {
    light: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2v6" stroke="#222" stroke-width="2"/><path d="M11 8h10l2 6H9z" fill="#3a3a3a"/><circle cx="16" cy="19" r="6" fill="#ffe2a8"/><path d="M8 26l-3 3M24 26l3 3M16 28v3" stroke="#f2c230" stroke-width="2" stroke-linecap="round"/></svg>',
    motor: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="9" width="18" height="15" rx="3" fill="#46625a"/><path d="M7 12v9M10 12v9M13 12v9M16 12v9M19 12v9" stroke="#2b3532" stroke-width="1.4"/><rect x="22" y="14" width="6" height="5" rx="1" fill="#99a1a6"/><rect x="6" y="24" width="14" height="3" fill="#2b3532"/></svg>',
    brushes: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="13" y="16" width="6" height="14" rx="2" fill="#7c4a22"/><rect x="11.5" y="11" width="9" height="6" rx="1" fill="#c8cfd4"/><path d="M11 11c0-5 2-9 5-9s5 4 5 9z" fill="#2f5fb3"/></svg>',
    finish: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="12" width="9" height="16" rx="3" fill="#a9d3e8" stroke="#5b8396" stroke-width="1.4"/><rect x="10.5" y="7" width="6" height="5" fill="#3a3a3a"/><path d="M16.5 8h6l-1 3h-5z" fill="#3a3a3a"/><path d="M24 7l4-2M24 9.5h5M24 12l4 2" stroke="#e8a33d" stroke-width="1.6" stroke-linecap="round"/></svg>',
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
    return JSON.stringify([shop.state.owned, state.wallet.balance("coins"), board.state.blueprints]);
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
      h += '<div class="af-now"><span class="af-k">INSTALLED</span><b>' + esc(cur.name) + "</b><small>" + esc(cur.blurb) + "</small></div>";
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
    h += '<p class="af-foot">All sales final. Prices go up as you go up the line, because of course they do.</p>';
    bodyEl.innerHTML = h;
  }

  /* ---------------- blueprints ---------------- */
  function blueprintsHtml(coins) {
    var h = '<section class="af-line af-bp" id="afBlueprints"><div class="af-head"><span class="af-icon bp-icon">' + BP_ICON + '</span><div><h2>BLUEPRINTS</h2><p>Plans for new pieces. Own the plan and customers start ordering that piece. Harder pieces pay more.</p></div></div>';
    C.BLUEPRINT_ORDER.forEach(function (k) {
      var def = C.PIECES[k], own = board.ownsBlueprint(k), ok = coins >= def.price;
      var pay = Math.round(def.base * (1 + C.CFG.BONUS));
      h += '<div class="bp-card' + (own ? " owned" : "") + '" data-bp-card="' + k + '">';
      h += Art.blueprintSVG(k, { owned: own, afford: own || ok, id: "shop" + k });
      h += '<div class="bp-text"><b>' + esc(def.name) + "</b><small>" + esc(def.blurb) + ' Pays up to <span class="bp-pay">' + COIN + pay + "</span> coins in pine.</small></div>";
      if (own) h += '<button type="button" class="act af-buy bp-buy owned" data-blueprint="' + k + '" aria-disabled="true"><span class="an">OWNED</span><span class="ad">' + (def.price ? "Its orders turn up on the board" : "It came with the shed") + "</span></button>";
      else h += '<button type="button" class="act primary af-buy bp-buy" data-blueprint="' + k + '"' + (ok ? "" : ' aria-disabled="true"') + '><span class="an">' + (ok ? "BUY IT" : "SAVE UP") + '</span><span class="ad">' +
        (ok ? def.price + " coins. You have " + coins + "." : "You need " + (def.price - coins) + " more coins. Orders pay.") + "</span></button>";
      h += "</div>";
    });
    return h + "</section>";
  }
  var BP_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="6" width="26" height="20" rx="2" fill="#1d4a8a"/><path d="M7 16c3-5 6 0 9-1s5-4 9 1c-4 5-6 2-9 1s-6 4-9-1z" fill="none" stroke="#f4f8ff" stroke-width="1.4"/><path d="M5 16h22" stroke="#f4f8ff" stroke-width="0.7" stroke-dasharray="3 1.5"/></svg>';
  function buyBlueprint(k) {
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
    if (G.OrdersUI) G.OrdersUI.render(true);
    return r;
  }
  function flash(k) {
    var card = bodyEl.querySelector('[data-bp-card="' + k + '"]');
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

  var WHERE = {
    light: "Go and see it hanging over the lathe.",
    motor: "The lathe cuts faster now.",
    chisels: "It is on the rack by the lathe, with the other chisels.",
    brushes: "Paint goes on faster now.",
    finish: "The sheen builds faster and more evenly now."
  };
  bodyEl.addEventListener("click", function (ev) {
    var bp = ev.target.closest ? ev.target.closest("[data-blueprint]") : null;
    if (bp) { if (!bp.classList.contains("owned")) buyBlueprint(bp.getAttribute("data-blueprint")); return; }
    var b = ev.target.closest ? ev.target.closest("[data-buy]") : null;
    if (!b) return;
    var k = b.getAttribute("data-buy"), r = shop.buy(k);
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

  var api = { show: function () { shown = true; render(true); }, hide: function () { shown = false; }, render: render, toast: toast, focusBlueprint: focusBlueprint, buyBlueprint: buyBlueprint };
  G.ShopUI = api;
  root.__shop = { shop: shop, ui: api };
  if (G.startScreen === "shop") api.show();
})(window);

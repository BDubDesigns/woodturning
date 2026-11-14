/* ============================================================
   Arbor Freight, the store screen (the SHOP tab). Draws the
   lines from the shop model (shop.js), takes BUY taps, and tells
   the lathe to put the upgrade to work. The model never knows
   the DOM exists.

   A line's card shows what is installed, the next rung for sale
   with its price tag and a BUY button, and the rungs after it, so
   the player can see what they are saving toward.
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, Sh = G.Shop;
  var host = root.__farm, shop = G.shop, state = host.state;
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
    return JSON.stringify([shop.state.owned, state.wallet.balance("coins")]);
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

  var WHERE = {
    light: "Go and see it hanging over the lathe.",
    motor: "The lathe cuts faster now.",
    chisels: "It is on the rack by the lathe, with the other chisels.",
    brushes: "Paint goes on faster now.",
    finish: "The sheen builds faster and more evenly now."
  };
  bodyEl.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-buy]") : null;
    if (!b) return;
    var k = b.getAttribute("data-buy"), r = shop.buy(k);
    if (!r.ok) {
      if (r.reason === "not enough coins") toast("That is " + r.need + " coins and you have " + r.have + ". The orders board pays.");
      return;
    }
    toast("Installed: " + r.tier.name + ". " + WHERE[k]);
    if (root.Lathe.applyUpgrades) root.Lathe.applyUpgrades();
    host.renderWallet();
    render(true);
  });
  setInterval(function () { if (shown) render(false); }, 1000);

  var api = { show: function () { shown = true; render(true); }, hide: function () { shown = false; }, render: render, toast: toast };
  G.ShopUI = api;
  root.__shop = { shop: shop, ui: api };
  if (G.startScreen === "shop") api.show();
})(window);

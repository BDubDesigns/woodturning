/* ============================================================
   Farm screen and the page shell around it: the FARM / LATHE tabs,
   the wallet, saving. Draws the plots, takes taps, and
   hands everything to the farm model (farm.js). The model never
   knows the DOM exists.

   Trees are never chopped here: tap a grown tree, then HARVEST takes it
   to the forest, which is the only way into that screen.

   Plots are real buttons that live for the whole session. Once a second a tick refreshes
   the clocks and the drawn tree; the bottom panel only rebuilds when
   what it shows has changed.
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, F = G.Farm, Save = G.Save;
  var WOODS = F.WOODS;
  function $(id) { return document.getElementById(id); }

  var storage = Save.pickStorage(root);
  // ?reset on the URL starts over as a brand-new player (Settings has the same, behind two taps)
  if (/[?&]reset\b/.test(location.search)) {
    try { storage.removeItem(Save.KEY); } catch (e) {}
    try { history.replaceState(null, "", location.pathname + location.search.replace(/([?&])reset\b(=[^&]*)?&?/, "$1").replace(/[?&]$/, "") + location.hash); } catch (e) {}
  }
  var game = Save.load(storage);
  var M = G.Monetize, R = G.Registry;
  // The one shared state: every tab reads and writes this wallet and inventory.
  var state = G.State.createState(game, { onChange: persist });
  G.state = state;
  var mine = M.createMine(game, { state: state, onChange: persist });
  var farm = F.createFarm(game, { state: state, onChange: persist, timersOff: mine.timersOff, coinsPerDiamond: M.CFG.COINS_PER_DIAMOND_LAND });
  var wiping = false;   // a reset is under way: nothing may write the old save back
  function persist() { if (wiping) return; farm.touch(); Save.write(storage, game); renderWallet(); }

  /* ---------------- settings: reset the profile ----------------
     Wipes the save and reloads as a brand-new player. Two taps, so it is never
     done by accident. */
  var settingsEl = $("settingsOverlay"), armed = false;
  function closeSettings() { settingsEl.hidden = true; settingsEl.innerHTML = ""; armed = false; }
  function openSettings() {
    armed = false;
    settingsEl.innerHTML = '<div class="grade-card settings-card"><h2 id="settingsTitle">SETTINGS</h2>' +
      (G.tutorial && G.tutorial.done ?
        '<p class="g-note">Walk through the tutorial again. Nothing in your game changes: every tab stays open and nothing is given out a second time.</p>' +
        '<div class="row"><button type="button" class="act primary" data-act="replay"><span class="an">REPLAY TUTORIAL</span><span class="ad">A guided tour of the game</span></button></div>' : "") +
      '<p class="g-note">Reset to see the game as a new player sees it. This wipes everything on this device: coins, diamonds, trees, the shed, orders and upgrades.</p>' +
      '<div class="row"><button type="button" class="act danger" data-act="reset"><span class="an">RESET PROFILE</span><span class="ad">Start over from nothing</span></button>' +
      '<button type="button" class="act" data-act="close"><span class="an">CLOSE</span><span class="ad">Keep playing</span></button></div></div>';
    settingsEl.hidden = false;
  }
  function resetProfile() {
    wiping = true;
    try { storage.removeItem(Save.KEY); } catch (e) {}
    location.replace(location.pathname + location.search.replace(/[?&]reset\b(=[^&]*)?/, ""));
  }
  $("settingsBtn").addEventListener("click", openSettings);
  settingsEl.addEventListener("click", function (ev) {
    if (ev.target === settingsEl) { closeSettings(); return; }
    var b = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!b) return;
    if (b.getAttribute("data-act") === "close") { closeSettings(); return; }
    if (b.getAttribute("data-act") === "replay") {
      closeSettings();
      if (G.tutorial && G.tutorial.replay() && G.tutorialRefresh) G.tutorialRefresh();
      return;
    }
    if (!armed) {
      armed = true;
      b.classList.add("armed");
      b.innerHTML = '<span class="an">TAP AGAIN TO WIPE IT ALL</span><span class="ad">There is no undo</span>';
      return;
    }
    resetProfile();
  });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape" && !settingsEl.hidden) closeSettings(); });

  var plotsEl = $("plots"), ctxEl = $("ctx"), shedEl = $("shed"), toastEl = $("toast");
  var selected = -1;
  var els = [];          // per-plot { btn, svg, name, time, bar, sig }
  var landBtn = null;
  var ctxSig = "";

  /* ---------------- screens ---------------- */
  var screens = { farm: $("farmScreen"), harvest: $("harvestScreen"), lathe: $("latheScreen"), mine: $("mineScreen"), orders: $("ordersScreen"), shop: $("shopScreen") };
  // no HARVEST tab: the forest opens only from a grown tree on the farm
  var tabs = { farm: $("tabFarm"), lathe: $("tabLathe"), mine: $("tabMine"), orders: $("tabOrders"), shop: $("tabShop") };
  var titleEl = $("screenTitle"), subEl = $("screenSubtitle"), statsEl = $("latheStats"), harvestStatsEl = $("harvestStats");
  var current = null;
  /* Is there a grown tree for the forest to fell? Without one the forest
     has nothing to show, so asking for it lands on the farm instead. */
  function harvestReady() {
    var i = G.harvestPlot;
    return i >= 0 && farm.isMature(farm.plotAt(i));
  }
  function showScreen(name) {
    // a screen the new-player flow has not opened yet: stay on the lathe
    if (G.tutorial && !G.tutorial.unlocked(name)) name = "lathe";
    if (name === "harvest" && !harvestReady()) name = "farm";
    if (current === name) return;
    current = name;
    for (var k in screens) {
      screens[k].hidden = k !== name;
      if (tabs[k]) tabs[k].setAttribute("aria-selected", k === name ? "true" : "false");
    }
    var L = root.Lathe;
    L.hidden = name !== "lathe";            // the lathe sleeps while another screen shows
    L.audio.lathe(name === "lathe");        // and so does its motor
    harvestStatsEl.style.display = name === "harvest" ? "" : "none";
    if (name === "harvest") L.harvestHost.show(); else L.harvestHost.hide();
    if (name !== "mine" && root.MineUI) root.MineUI.hide();   // the mine scene sleeps too
    if (name !== "orders" && G.OrdersUI) G.OrdersUI.hide();
    if (name !== "shop" && G.ShopUI) G.ShopUI.hide();
    if (name === "farm") {
      titleEl.innerHTML = "THE <em>FARM</em>";
      subEl.textContent = "PLANT · WAIT · HARVEST · GROWS WHILE YOU ARE AWAY";
      statsEl.style.display = "none";
      tick();
      if (pendingToast) { toast(pendingToast); pendingToast = ""; }
    } else if (name === "harvest") {
      titleEl.innerHTML = "THE <em>FOREST</em>";
      subEl.textContent = "HARVEST · CHOP, DELIMB, SAW";
      statsEl.style.display = "none";
    } else if (name === "shop") {
      titleEl.innerHTML = "ARBOR <em>FREIGHT</em>";
      subEl.textContent = "TOOLS · LIGHTS · MOTORS · PRICES THAT ONLY GO UP";
      statsEl.style.display = "none";
      if (G.ShopUI) G.ShopUI.show();
    } else if (name === "orders") {
      titleEl.innerHTML = "THE <em>BOARD</em>";
      subEl.textContent = "COMMISSIONS · TURN IT · PAINT IT · GET PAID";
      statsEl.style.display = "none";
      if (G.OrdersUI) G.OrdersUI.show();
    } else if (name === "mine") {
      titleEl.innerHTML = "THE <em>MINE</em>";
      subEl.textContent = "WATCH AN AD · CRACK THE VEIN · " + M.CFG.DIAMONDS_PER_VEIN + " DIAMONDS";
      statsEl.style.display = "none";
      if (root.MineUI) root.MineUI.show();
    } else {
      titleEl.innerHTML = "THE <em>LATHE</em>";
      subEl.textContent = "PROTOTYPE 02 · SPINNING BLANK · REAL PROFILE CUTTING";
      statsEl.style.display = "";
      if (L.syncOrder) L.syncOrder();            // the board may have a new order on the lathe
      if (L.renderPick) L.renderPick();          // and the shed may have new wood for an empty lathe
      root.dispatchEvent(new Event("resize"));   // the lathe views size themselves to the stage
    }
    try { history.replaceState(null, "", name === "lathe" ? location.pathname + location.search : "#" + name); } catch (e) {}
  }
  G.showScreen = showScreen;
  G.currentScreen = function () { return current; };
  tabs.farm.addEventListener("click", function () { showScreen("farm"); });
  tabs.lathe.addEventListener("click", function () { showScreen("lathe"); });
  tabs.mine.addEventListener("click", function () { showScreen("mine"); });
  tabs.orders.addEventListener("click", function () { showScreen("orders"); });
  tabs.shop.addEventListener("click", function () { showScreen("shop"); });

  /* ---------------- wallet ---------------- */
  /* One chip per registered currency: each <b data-currency="id"> shows that balance. */
  var unlockedEl = $("fullBadge");
  var walletEls = Array.prototype.slice.call(document.querySelectorAll("[data-currency]"));
  function renderWallet() {
    walletEls.forEach(function (el) {
      var v = String(state.wallet.balance(el.getAttribute("data-currency")));
      if (el.textContent !== v) el.textContent = v;
    });
    unlockedEl.hidden = !mine.isUnlocked();
  }

  /* ---------------- toast ---------------- */
  var toastTimer = 0, pendingToast = "";
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("on"); }, 3200);
  }

  /* ---------------- drawing a tree ---------------- */
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function treeSVG(woodId, pr, st) {
    var w = WOODS[woodId];
    var s = '<ellipse cx="50" cy="108" rx="34" ry="7" fill="rgba(0,0,0,0.3)"/>';
    if (st === "seed") {
      return s + '<ellipse cx="50" cy="104" rx="12" ry="5" fill="#5a3f27"/><ellipse cx="50" cy="101" rx="3.4" ry="2.3" fill="#c9a36a"/>';
    }
    if (st === "sprout") {
      var h = 12 + clamp(pr / 0.4, 0, 1) * 16;
      return s + '<path d="M50 106 Q49 ' + (106 - h / 2) + ' 50 ' + (106 - h) + '" stroke="' + w.leaf + '" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="43" cy="' + (106 - h) + '" rx="7" ry="3.6" fill="' + w.leaf2 + '" transform="rotate(-25 43 ' + (106 - h) + ')"/>' +
        '<ellipse cx="57" cy="' + (104 - h) + '" rx="7" ry="3.6" fill="' + w.leaf + '" transform="rotate(25 57 ' + (104 - h) + ')"/>';
    }
    var k = clamp((pr - 0.4) / 0.6, 0, 1);
    var trunkH = 26 + k * 34, trunkW = 6 + k * 10, r = 12 + k * 24;
    var top = 108 - trunkH, x0 = 50 - trunkW / 2;
    s += '<rect x="' + x0 + '" y="' + top + '" width="' + trunkW + '" height="' + trunkH + '" rx="2" fill="' + w.trunk + '"/>';
    s += '<rect x="' + (x0 + trunkW * 0.62) + '" y="' + top + '" width="' + trunkW * 0.22 + '" height="' + trunkH + '" fill="rgba(0,0,0,0.14)"/>';
    if (w.shape === "conifer") {
      for (var i = 0; i < 3; i++) {
        var by = top + 6 - i * r * 0.62 + r * 0.55, hw = r * (1.05 - i * 0.24), ty = by - r * 0.95;
        s += '<polygon points="' + (50 - hw) + ',' + by + ' ' + (50 + hw) + ',' + by + ' 50,' + ty + '" fill="' + (i % 2 ? w.leaf2 : w.leaf) + '"/>';
      }
    } else {
      var cy = top - r * 0.2;
      s += '<circle cx="' + (50 - r * 0.55) + '" cy="' + (cy + r * 0.2) + '" r="' + r * 0.7 + '" fill="' + w.leaf + '"/>' +
        '<circle cx="' + (50 + r * 0.55) + '" cy="' + (cy + r * 0.2) + '" r="' + r * 0.7 + '" fill="' + w.leaf + '"/>' +
        '<circle cx="50" cy="' + cy + '" r="' + r * 0.85 + '" fill="' + w.leaf2 + '"/>';
    }
    return s;
  }

  /* ---------------- plots ---------------- */
  var STAGE_LABEL = { seed: "Seed", sprout: "Sprout", sapling: "Sapling", young: "Young tree", mature: "Mature" };

  function buildPlot(i) {
    var btn = document.createElement("button");
    btn.className = "plot"; btn.type = "button"; btn.setAttribute("data-i", String(i));
    btn.innerHTML = '<svg class="tree" viewBox="0 0 100 120" aria-hidden="true"></svg><span class="plot-name"></span><span class="plot-time"></span><span class="plot-bar"><i></i></span>';
    var e = { btn: btn, svg: btn.firstChild, name: btn.children[1], time: btn.children[2], bar: btn.children[3].firstChild, sig: "" };
    btn.addEventListener("click", function () { select(i); });
    return e;
  }

  function buildLand() {
    var btn = document.createElement("button");
    btn.className = "plot land"; btn.type = "button"; btn.id = "buyLand";
    btn.addEventListener("click", function () {
      var price = farm.landPrice(), dprice = farm.landPriceDiamonds();
      var r = farm.buyLand();
      if (r.ok) {
        toast("New land cleared. Plot " + (r.index + 1) + " is ready to plant.");
        select(r.index);
        layoutPlots();
      } else if (r.reason === "not enough coins") {
        toast("A new plot costs " + price + " coins or " + dprice + " diamonds. You have " + state.wallet.balance("coins") + " coins.");
      }
    });
    return btn;
  }

  /* Keep one element per plot, plus the buy-land tile at the end. */
  function layoutPlots() {
    while (els.length < farm.state.plots.length) {
      var e = buildPlot(els.length);
      els.push(e);
    }
    if (!landBtn) landBtn = buildLand();
    for (var i = 0; i < els.length; i++) plotsEl.appendChild(els[i].btn);   // keeps order
    var price = farm.landPrice();
    if (price === null) { if (landBtn.parentNode) plotsEl.removeChild(landBtn); }
    else plotsEl.appendChild(landBtn);
    tick();
  }

  function renderPlot(i) {
    var e = els[i], p = farm.plotAt(i), st = farm.stage(p);
    var pr = p ? farm.progress(p) : 0;
    var sig = (p ? p.wood : "-") + "|" + st + "|" + Math.round(pr * 60) + "|" + (i === selected ? 1 : 0);
    if (sig !== e.sig) {
      e.sig = sig;
      e.svg.innerHTML = p ? treeSVG(p.wood, pr, st) : '<ellipse cx="50" cy="104" rx="32" ry="8" fill="rgba(0,0,0,0.25)"/><path d="M50 92v-16M42 84h16" stroke="#9b7b4e" stroke-width="3" stroke-linecap="round" opacity="0.7"/>';
    }
    e.btn.className = "plot " + (p ? (st === "mature" ? "mature" : "growing") : "empty") + (i === selected ? " selected" : "");
    var label;
    if (!p) { e.name.textContent = "Plot " + (i + 1); e.time.textContent = "Tap to plant"; label = "Plot " + (i + 1) + ", empty"; }
    else if (st === "mature") { e.name.textContent = WOODS[p.wood].name.toUpperCase(); e.time.textContent = "Ready to harvest"; label = WOODS[p.wood].name + ", ready to harvest"; }
    else { e.name.textContent = WOODS[p.wood].name.toUpperCase(); e.time.textContent = F.formatDuration(farm.remainingMs(p)); label = WOODS[p.wood].name + " " + STAGE_LABEL[st].toLowerCase() + ", " + e.time.textContent + " left"; }
    e.bar.style.width = (p ? pr * 100 : 0).toFixed(1) + "%";
    e.btn.setAttribute("aria-label", "Plot " + (i + 1) + ": " + label);
    e.btn.setAttribute("aria-pressed", i === selected ? "true" : "false");
  }

  function renderLand() {
    var price = farm.landPrice();
    if (price === null) return;
    var poor = state.wallet.balance("coins") < price;
    landBtn.className = "plot land" + (poor ? " poor" : "");
    landBtn.innerHTML = '<span class="plus">+</span><span class="plot-name">NEW LAND</span><span class="plot-time">' + price + ' coins</span>';
    landBtn.setAttribute("aria-label", "Buy a new plot of land for " + price + " coins");
  }

  /* ---------------- selection and the panel ---------------- */
  function select(i) {
    if (i !== selected) adWood = null;
    selected = i;
    for (var k = 0; k < els.length; k++) renderPlot(k);
    renderCtx(true);
  }

  /* The shed shows the shared inventory: logs by wood, then a count of
     each other kind of item (blanks, turned pieces). */
  function renderShed() {
    var inv = state.inventory, h = '<span class="k">SHED</span>', any = false;
    inv.list("log").forEach(function (s) {
      any = true;
      h += '<span class="log" data-wood="' + s.key + '"><i style="background:' + WOODS[s.key].trunk + '"></i>' + WOODS[s.key].name + ' <b>' + s.count + "</b></span>";
    });
    R.ITEM_ORDER.forEach(function (kind) {
      if (R.ITEMS[kind].stack) return;
      var n = inv.count(kind);
      if (!n) return;
      any = true;
      h += '<span class="log item" data-kind="' + kind + '">' + R.ITEMS[kind].many + ' <b>' + n + "</b></span>";
    });
    if (!any) h += "<span>No logs yet. Grow a tree and harvest it.</span>";
    if (shedEl.innerHTML !== h) shedEl.innerHTML = h;
  }

  function act(label, desc, cls, ok, fn) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "act" + (cls ? " " + cls : "");
    b.innerHTML = '<span class="an">' + label + '</span><span class="ad">' + desc + "</span>";
    if (!ok) b.setAttribute("aria-disabled", "true");
    b.addEventListener("click", fn);
    return b;
  }

  /* Land for diamonds: the same plot coins buy, as a shortcut. */
  function landAct() {
    var cost = farm.landPriceDiamonds();
    if (cost === null) return null;
    var b = act("NEW LAND", cost + (cost === 1 ? " diamond" : " diamonds") + ", or " + farm.landPrice() + " coins", "", state.wallet.balance("diamonds") >= cost, function () {
      var r = farm.buyLandWithDiamonds();
      if (r.ok) { toast("New land cleared for " + r.cost + (r.cost === 1 ? " diamond." : " diamonds.") + " Plot " + (r.index + 1) + " is ready."); layoutPlots(); select(r.index); }
      else toast("New land takes " + cost + (cost === 1 ? " diamond" : " diamonds") + ". You have " + state.wallet.balance("diamonds") + ". The mine has more.");
    });
    b.setAttribute("data-act", "landdiamonds");
    return b;
  }

  /* Short of coins for a seed: one finished ad plants it for free. With the
     full unlock there are no ads, and a seed just costs coins. */
  var adWood = null;
  function adPlantAct(id) {
    var w = WOODS[id], plot = selected;
    var b = act("WATCH AN AD", "Plant the " + w.name.toLowerCase() + " for free", "primary", true, function () {
      if (!root.MineUI) return;
      root.MineUI.adProvider.show("plant a " + w.name.toLowerCase() + " for free", function (finished) {
        if (!finished) { toast("The ad was closed early, so nothing was planted."); return; }
        var r = farm.plant(plot, id, { free: true });
        adWood = null;
        if (r.ok) { toast(w.name + " planted. Thanks for watching."); select(plot); tick(); }
      });
    });
    b.setAttribute("data-act", "adplant");
    return b;
  }

  function ctxSignature() {
    var p = farm.plotAt(selected);
    var extra = state.wallet.balance("diamonds") + "|" + farm.state.plots.length + "|" + (mine.isUnlocked() ? 1 : 0);
    if (selected < 0) return "none|" + extra;
    if (!p) return "empty|" + selected + "|" + extra + "|" + state.wallet.balance("coins") + "|" + adWood;
    var cost = farm.isMature(p) ? 0 : farm.diamondsToFinish(p);
    return [selected, p.wood, farm.stage(p), cost, state.wallet.balance("diamonds")].join("|");
  }

  function renderCtx(force) {
    var sig = ctxSignature();
    if (!force && sig === ctxSig) return;
    ctxSig = sig;
    ctxEl.innerHTML = "";
    var p = farm.plotAt(selected);
    var line = document.createElement("div"); line.className = "line";
    var row = document.createElement("div"); row.className = "row";
    if (selected < 0) {
      line.textContent = "Tap a plot to plant or tend it. Tap a grown tree to harvest it. Trees keep growing while the game is closed.";
      ctxEl.appendChild(line);
      var la0 = landAct();
      if (la0) { row.appendChild(la0); ctxEl.appendChild(row); }
      return;
    }
    if (!p) {
      line.innerHTML = "<b>Plot " + (selected + 1) + "</b> is empty. What will you grow?";
      var coins = state.wallet.balance("coins");
      F.WOOD_ORDER.forEach(function (id) {
        var w = WOODS[id], price = farm.plantPrice(id);
        var b = act('<span class="dot" style="background:' + w.leaf + '"></span>' + w.name.toUpperCase(), price + " coins · " + (mine.isUnlocked() ? "ready right away" : F.formatDuration(w.growMs) + " to grow"), "", coins >= price, function () {
          var r = farm.plant(selected, id);
          if (r.ok) { adWood = null; select(selected); tick(); return; }
          if (r.reason !== "not enough coins") return;
          if (mine.isUnlocked()) { toast("A " + w.name.toLowerCase() + " seed costs " + r.price + " coins. You have " + state.wallet.balance("coins") + ". Orders pay coins."); return; }
          adWood = id; renderCtx(true);
          toast("A " + w.name.toLowerCase() + " seed costs " + r.price + " coins. You have " + state.wallet.balance("coins") + ". Or watch a short ad and plant it free.");
        });
        b.setAttribute("data-plant", id);
        row.appendChild(b);
      });
      if (adWood && !mine.isUnlocked()) row.appendChild(adPlantAct(adWood));
      var la1 = landAct();
      if (la1) row.appendChild(la1);
    } else if (farm.isMature(p)) {
      line.innerHTML = "<b>" + WOODS[p.wood].name + "</b> is fully grown. Take it to the forest to chop, delimb and saw it into a blank.";
      var hv = act("HARVEST", "Fell, trim and saw it into a blank", "primary", true, function () {
        G.harvestPlot = selected;
        if (root.Lathe.harvestHost.fresh) root.Lathe.harvestHost.fresh();
        showScreen("harvest");
      });
      hv.setAttribute("data-act", "harvest");
      row.appendChild(hv);
    } else {
      var st = farm.stage(p), cost = farm.diamondsToFinish(p), dia = state.wallet.balance("diamonds");
      line.innerHTML = "<b>" + WOODS[p.wood].name + "</b> " + STAGE_LABEL[st].toLowerCase() + ", <span id=\"ctxTime\">" + F.formatDuration(farm.remainingMs(p)) + "</span> left.";
      var skip = F.formatDuration(F.CFG.DIAMOND_MS);
      var s1 = act("SPEED UP", "Skip " + skip + " for 1 diamond", "", dia >= 1, function () {
        var r = farm.speedUp(selected);
        if (r.ok) { select(selected); tick(); } else toast("You need a diamond for that.");
      });
      s1.setAttribute("data-act", "speedup");
      var s2 = act("GROW NOW", "Finish it for " + cost + (cost === 1 ? " diamond" : " diamonds"), "primary", dia >= cost, function () {
        var c = farm.diamondsToFinish(farm.plotAt(selected));
        var r = farm.finishNow(selected);
        if (r.ok) { toast("Grown! That took " + c + (c === 1 ? " diamond." : " diamonds.")); select(selected); tick(); }
        else toast("Growing this now takes " + c + (c === 1 ? " diamond" : " diamonds") + ". You have " + state.wallet.balance("diamonds") + ".");
      });
      s2.setAttribute("data-act", "grownow");
      row.appendChild(s1); row.appendChild(s2);
    }
    ctxEl.appendChild(line); ctxEl.appendChild(row);
  }

  /* ---------------- the clock ---------------- */
  function tick() {
    if (current !== "farm") return;
    renderWallet();
    var pre = farm.state.plots.length;
    for (var i = 0; i < pre; i++) if (els[i]) renderPlot(i);
    renderLand();
    renderShed();
    renderCtx(false);
    var t = $("ctxTime"), p = farm.plotAt(selected);
    if (t && p) t.textContent = F.formatDuration(farm.remainingMs(p));
  }
  setInterval(tick, 1000);
  setInterval(function () { persist(); }, 5000);
  document.addEventListener("visibilitychange", function () { persist(); if (!document.hidden) tick(); });
  root.addEventListener("pagehide", persist);

  // set before the first screen shows: the harvest reads the farm through this
  root.__farm = {
    farm: farm, game: game, state: state, storage: storage, select: select, showScreen: showScreen, tick: tick,
    mine: mine, persist: persist, toast: toast, renderWallet: renderWallet, tickFarm: tick,
    get selected() { return selected; }
  };

  /* ---------------- start ---------------- */
  var grew = farm.grownWhileAway();
  layoutPlots();
  renderWallet();
  persist();
  /* The new-player flow (tutorial.js). Its readings of the game are filled in
     by tutorial-ui.js; the hand-outs and the board live here with the state. */
  var tutorialCtx = {
    grant: function (g) {
      var items = [];
      if (g.logs) for (var w in g.logs) items.push({ kind: "log", key: w, n: g.logs[w] });
      state.grant({ coins: g.coins, diamonds: g.diamonds, items: items });
      if (g.note) toast(g.note);
    },
    postFirstBoard: function (list) { if (G.commissions) G.commissions.postAuthored(list); },
    resumeBoard: function () { if (G.commissions) G.commissions.resume(); }
  };
  var tutorial = G.Tutorial.createTutorial(game, { ctx: tutorialCtx, onChange: persist });
  // ?tutorial=off skips it (the browser tests use it, so they keep testing what they test)
  if (/[?&]tutorial=off\b/.test(location.search)) tutorial.skip();
  G.tutorial = tutorial; G.tutorialCtx = tutorialCtx;
  root.__farm.tutorial = tutorial;
  /* The commission board: made here with the rest of the shared state, drawn by commissions-ui.js.
     It waits while the new-player flow runs, which posts its own first orders. */
  var board = G.Commissions.createBoard(game, { state: state, onChange: persist, timersOff: mine.timersOff, paused: tutorial.boardPaused });
  G.commissions = board;
  root.__farm.board = board;
  /* Arbor Freight, the tool store: made here too, drawn by shop-ui.js, read by the lathe. */
  var shop = G.Shop.createShop(game, { state: state, onChange: persist });
  G.shop = shop;
  root.__farm.shop = shop;

  var startScreen = /#farm\b/.test(location.hash) ? "farm" : /#harvest\b/.test(location.hash) ? "harvest" : /#mine\b/.test(location.hash) ? "mine" : /#orders\b/.test(location.hash) ? "orders" : /#shop\b/.test(location.hash) ? "shop" : "lathe";
  G.startScreen = startScreen;
  showScreen(startScreen);
  if (grew.length) {
    var names = grew.map(function (g) { return WOODS[g.wood].name.toLowerCase(); });
    pendingToast = grew.length === 1 ? "While you were away, your " + names[0] + " finished growing." : "While you were away, " + grew.length + " trees finished growing.";
    if (current === "farm") { toast(pendingToast); pendingToast = ""; }
  }

})(window);

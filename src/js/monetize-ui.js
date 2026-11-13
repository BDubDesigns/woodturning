/* ============================================================
   The mine screen: the entrance (one ad gets you in), the mine
   scene itself (mine-scene.js: crack the vein by hand), selling
   gems, the full unlock, and the ad overlay. Draws from the monetization model
   (monetize.js) and the shared game state farm-ui.js exposes as
   __farm. Wording rules: say what a thing costs and what it
   gives, in plain numbers, and never hide the close button.

   Two seams stand in for services that arrive with the Play
   Store slice:
     MineUI.adProvider   .show(done)   done(true) only if the ad ran to the end
     MineUI.payProvider  .buy(done)    done(true) only if the purchase went through
   The defaults are a labelled house ad and a preview purchase
   that takes no money and says so.
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, M = G.Monetize, CFG = M.CFG;
  var host = root.__farm, mine = host.mine, game = host.game;
  function $(id) { return document.getElementById(id); }
  var body = $("mineBody"), overlay = $("adOverlay");

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------------- providers ---------------- */
  var adProvider = {
    seconds: CFG.AD_SECONDS,
    /* A house ad: the game's own slot, clearly labelled, with a countdown
       and a close button that is there the whole time. */
    show: function (reward, done) {
      var ms = Math.max(50, adProvider.seconds * 1000), start = Date.now(), over = false, timer = 0;
      overlay.hidden = false;
      overlay.innerHTML =
        '<div class="ad-card">' +
          '<div class="ad-tag">AD</div>' +
          '<div class="ad-title" id="adTitle">Ad break</div>' +
          '<div class="ad-body">This is where a real ad plays in the store version. For now it is a short wait. Stay to the end to ' + esc(reward) + '.</div>' +
          '<div class="ad-time" id="adTime" aria-live="off"></div>' +
          '<div class="ad-bar"><i id="adBar"></i></div>' +
          '<button type="button" class="act ad-close" id="adClose"><span class="an">CLOSE</span><span class="ad">Leave now. You get nothing and lose nothing.</span></button>' +
        '</div>';
      var bar = $("adBar"), time = $("adTime"), close = $("adClose");
      function finish(ok) {
        if (over) return;
        over = true; clearInterval(timer);
        document.removeEventListener("keydown", onKey);
        overlay.hidden = true; overlay.innerHTML = "";
        done(ok);
      }
      function onKey(e) { if (e.key === "Escape") finish(false); }
      function step() {
        var left = ms - (Date.now() - start);
        if (left <= 0) { finish(true); return; }
        bar.style.width = (100 - (left / ms) * 100).toFixed(1) + "%";
        time.textContent = "Reward in " + Math.ceil(left / 1000) + "s";
      }
      close.addEventListener("click", function () { finish(false); });
      document.addEventListener("keydown", onKey);
      timer = setInterval(step, 100);
      step();
      try { close.focus(); } catch (e) {}
    }
  };

  var payProvider = {
    /* Preview purchase: no money moves. The store version replaces this
       with Google Play Billing. The player is told so before confirming. */
    needsConfirm: true,
    buy: function (done) { done(true); }
  };

  /* ---------------- the screen ---------------- */
  var confirming = false, note = "", noteTimer = 0, busy = false;

  function say(msg) {
    note = msg;
    var el = $("mineNote");
    if (el) { el.textContent = msg; el.classList.add("on"); }
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { note = ""; var e2 = $("mineNote"); if (e2) e2.classList.remove("on"); }, 4200);
  }

  function enterButton() {
    var free = !mine.needsAd(), pass = mine.state.pass;
    var desc = pass ? "Your visit is saved. The vein is waiting"
      : free ? "No ad. Walk straight in"
      : "Watch one ad of about " + CFG.AD_SECONDS + " seconds";
    return '<button type="button" class="act primary" data-act="enter-mine"><span class="an">' + (pass ? "BACK TO THE VEIN" : "ENTER THE MINE") + '</span><span class="ad">' + desc + "</span></button>";
  }

  function render() {
    var free = !mine.needsAd(), gems = game.wallet.gems, un = mine.isUnlocked();
    var h = "";

    var vein = plural(CFG.DIAMONDS_PER_VEIN, "diamond", "diamonds");
    h += '<section class="mine-card" aria-labelledby="mTradeH"><h2 id="mTradeH">THE TRADE</h2>';
    h += free
      ? "<p>You own the full game, so there are no ads. Walk in, crack the diamond vein, and it pays " + vein + ". Crack as many as you like.</p>"
      : "<p>Watch one ad of about " + CFG.AD_SECONDS + " seconds to get into the mine. Swing a pick at the diamond vein until it cracks open. It pays exactly " + vein + ", every time. No dice, no hidden rates.</p>";
    h += '<div class="row">' + enterButton() + "</div>";
    h += '<div class="mine-note" id="mineNote" role="status" aria-live="polite"></div></section>';

    h += '<section class="mine-card" aria-labelledby="mGemsH"><h2 id="mGemsH">GEMS</h2>';
    h += "<p>You have <b id=\"mineGems\">" + gems + "</b> " + (gems === 1 ? "gem" : "gems") + ". Each sells for " + CFG.COINS_PER_GEM + " coins.</p>";
    h += '<div class="row"><button type="button" class="act" data-act="sell-gems"' + (gems ? "" : ' aria-disabled="true"') + '><span class="an">SELL ' + (gems ? "ALL" : "GEMS") + '</span><span class="ad">' +
      (gems ? plural(gems, "gem", "gems") + " for " + gems * CFG.COINS_PER_GEM + " coins" : "Nothing to sell yet") + "</span></button></div></section>";

    h += '<section class="mine-card" aria-labelledby="mUseH"><h2 id="mUseH">WHAT DIAMONDS DO</h2><ul>' +
      "<li>Skip growing time. One diamond skips " + Math.round(G.Farm.CFG.DIAMOND_MS / 60000) + " minutes.</li>" +
      "<li>Grow a tree right now for the diamonds the wait is worth.</li>" +
      "<li>Buy new land, as a shortcut for coins.</li></ul>" +
      "<p class=\"promise\">The free game is a complete game. Diamonds only skip waiting. Nothing you need to plant, chop, or turn is behind an ad or a payment.</p></section>";

    h += '<section class="mine-card full' + (un ? " owned" : "") + '" aria-labelledby="mFullH"><h2 id="mFullH">FULL GAME</h2>';
    if (un) {
      h += "<p><b>Full game unlocked.</b> Thank you. No ads, no timers.</p>";
    } else {
      h += "<p>One payment of <b>" + M.priceLabel() + "</b>. It removes every ad and every timer: trees are ready the moment you plant them. It adds nothing the free game lacks, because the free game is already whole.</p>";
      if (!confirming) {
        h += '<div class="row"><button type="button" class="act" data-act="unlock"><span class="an">UNLOCK FULL GAME</span><span class="ad">' + M.priceLabel() + ", one time</span></button></div>";
      } else {
        h += '<p class="confirm">This is a preview build, so no money is taken. The Play Store version charges ' + M.priceLabel() + " through Google Play. Unlock now at no charge?</p>" +
          '<div class="row"><button type="button" class="act primary" data-act="unlock-confirm"><span class="an">UNLOCK, NO CHARGE</span><span class="ad">Removes ads and timers</span></button>' +
          '<button type="button" class="act" data-act="unlock-cancel"><span class="an">NOT NOW</span><span class="ad">Keep playing free</span></button></div>';
      }
    }
    h += "</section>";

    h += '<p class="mine-foot">Ads watched: <b id="mineAds">' + mine.state.adsWatched + "</b> · Gems sold: <b>" + mine.state.gemsSold + "</b></p>";
    body.innerHTML = h;
    if (note) { var el = $("mineNote"); el.textContent = note; el.classList.add("on"); }
  }

  /* ---------------- the mine scene ---------------- */
  var sceneEl = $("mineScene"), resultEl = $("mresult"), hintEl = $("mhint"), barEl = $("veinBar"), swingsEl = $("mSwings");
  var inScene = false, paid = null;
  var scene = G.MineScene.create({
    stage: $("mstage"), canvas: $("mcanvas"),
    crystals: CFG.DIAMONDS_PER_VEIN,
    onStrike: function (ev) {
      hintEl.classList.add("off");
      if (ev.type === "tink") { flashHint("Too slow. <b>Swing faster</b> to bite into the rock."); return; }
      barEl.style.width = (100 * ev.hp / scene.vein.maxHp).toFixed(1) + "%";
      swingsEl.textContent = String(scene.vein.strikes);
    },
    onBroken: function () { paid = awardVein(); },
    onSettled: showResult
  });

  /* The one place the vein's reward is paid. Wire a new wallet here. */
  function awardVein() { return mine.claimVein(); }

  var hintTimer = 0;
  function flashHint(html) {
    hintEl.innerHTML = html; hintEl.classList.remove("off");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hintEl.classList.add("off"); }, 1600);
  }

  function showResult() {
    var ok = paid && paid.ok, again = !mine.needsAd();
    resultEl.innerHTML =
      '<div class="mresult-card">' +
        "<h2>VEIN CRACKED</h2>" +
        (ok ? '<p class="mgain">+' + paid.amount + " <span>" + (paid.amount === 1 ? "diamond" : "diamonds") + "</span></p>" : "<p>The rock is open.</p>") +
        "<p>In " + plural(scene.vein.strikes, "swing", "swings") + ". You have " + game.wallet.diamonds + " diamonds.</p>" +
        '<div class="row">' +
          (again ? '<button type="button" class="act primary" data-act="mine-again"><span class="an">CRACK ANOTHER</span><span class="ad">No ad. Full game</span></button>' : "") +
          '<button type="button" class="act' + (again ? "" : " primary") + '" data-act="mine-leave"><span class="an">BACK TO THE ENTRANCE</span><span class="ad">' + (again ? "Done for now" : "Another visit takes another ad") + "</span></button>" +
        "</div>" +
      "</div>";
    resultEl.hidden = false;
  }

  function openScene(fresh) {
    inScene = true; paid = null;
    if (fresh || !scene.vein || scene.vein.broken) scene.reset();
    resultEl.hidden = true; resultEl.innerHTML = "";
    hintEl.innerHTML = "<b>Swipe across the rock</b> to swing the pick. Fast swings hit hardest.";
    hintEl.classList.remove("off");
    barEl.style.width = (100 * scene.vein.hp / scene.vein.maxHp).toFixed(1) + "%";
    swingsEl.textContent = String(scene.vein.strikes);
    body.hidden = true; sceneEl.hidden = false;
    scene.show();
  }
  function closeScene() {
    var cracked = scene.vein && scene.vein.broken;
    inScene = false;
    scene.hide();
    sceneEl.hidden = true; body.hidden = false;
    render();
    if (!cracked && mine.state.pass) say("Your visit is saved. Come back any time to crack the vein.");
  }

  /* ---------------- actions ---------------- */
  function enterMine() {
    if (busy) return;
    if (mine.hasPass()) { mine.enterMine(true); openScene(false); return; }
    busy = true;
    adProvider.show("get into the mine", function (finished) {
      busy = false;
      var r = mine.enterMine(finished);
      host.renderWallet();
      if (r.ok) openScene(true);
      else { render(); say("Ad closed early. You stay outside, and nothing is spent."); }
    });
  }

  sceneEl.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-act], button") : null;
    if (!b) return;
    var a = b.getAttribute("data-act") || b.id;
    if (a === "mine-leave" || a === "mLeaveBtn") closeScene();
    else if (a === "mine-again") { mine.enterMine(true); openScene(true); }
    else if (a === "mSoundBtn") { if (root.Lathe && root.Lathe.audio) root.Lathe.audio.toggle(); }
  });

  body.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!b) return;
    var a = b.getAttribute("data-act");
    if (a === "enter-mine") enterMine();
    else if (a === "sell-gems") {
      var r = mine.sellGems("all");
      host.renderWallet(); render();
      say(r.ok ? "Sold " + plural(r.gems, "gem", "gems") + " for " + r.coins + " coins." : "You have no gems to sell yet.");
    } else if (a === "unlock") { confirming = true; render(); }
    else if (a === "unlock-cancel") { confirming = false; render(); }
    else if (a === "unlock-confirm") {
      payProvider.buy(function (ok) {
        confirming = false;
        if (ok) { mine.unlock(); host.renderWallet(); host.tickFarm(); }
        render();
        say(ok ? "Full game unlocked. No more ads or timers." : "The purchase did not go through. You were not charged.");
      });
    }
  });

  function showMine() { if (inScene) { body.hidden = true; sceneEl.hidden = false; scene.show(); } else render(); }
  function hideMine() { scene.hide(); }

  root.MineUI = { show: showMine, hide: hideMine, adProvider: adProvider, payProvider: payProvider, awardVein: awardVein };
  root.__mine = { mine: mine, adProvider: adProvider, payProvider: payProvider, scene: scene, inScene: function () { return inScene; } };

  // a game that opens on #mine: farm-ui ran showScreen before this file loaded
  if (!$("mineScreen").hidden) render();
})(window);

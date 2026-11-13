/* ============================================================
   The mine screen: the ad trade for diamonds, the full unlock,
   and the ad overlay. Draws from the monetization model
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
          '<div class="ad-body">This is where a real ad plays in the store version. For now it is a short wait. Stay to the end to mine ' + esc(reward) + '.</div>' +
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

  function mineButton(kind) {
    var t = M.trade(kind), free = !mine.needsAd();
    var label = free ? "MINE " + t.amount + " " + t.noun.toUpperCase() : "MINE " + t.kind.toUpperCase();
    var desc = free ? "No ad. Instant." : "Watch one ad, get " + plural(t.amount, "diamond", "diamonds");
    return '<button type="button" class="act primary" data-act="mine-' + t.kind + '"><span class="an">' + label + '</span><span class="ad">' + desc + "</span></button>";
  }

  function render() {
    var free = !mine.needsAd(), un = mine.isUnlocked();
    var h = "";

    h += '<section class="mine-card" aria-labelledby="mTradeH"><h2 id="mTradeH">THE TRADE</h2>';
    h += free
      ? "<p>You own the full game, so there are no ads. Mining is free and pays the same.</p>"
      : "<p>Watch one ad of about " + CFG.AD_SECONDS + " seconds and mine " + plural(M.trade("diamonds").amount, "diamond", "diamonds") + ". You get exactly that, every time. No dice, no hidden rates.</p>";
    h += '<div class="row">' + mineButton("diamonds") + "</div>";
    h += '<div class="mine-note" id="mineNote" role="status" aria-live="polite"></div></section>';

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

    h += '<p class="mine-foot">Ads watched: <b id="mineAds">' + mine.state.adsWatched + "</b></p>";
    body.innerHTML = h;
    if (note) { var el = $("mineNote"); el.textContent = note; el.classList.add("on"); }
  }

  /* ---------------- actions ---------------- */
  function startMining(kind) {
    if (busy) return;
    var t = M.trade(kind);
    if (!mine.needsAd()) {
      var r = mine.mineReward(kind, true);
      if (r.ok) { host.renderWallet(); render(); say("Mined " + plural(r.amount, t.noun, t.noun) + "."); }
      return;
    }
    busy = true;
    adProvider.show(plural(t.amount, t.noun, t.noun), function (finished) {
      busy = false;
      var r = mine.mineReward(kind, finished);
      host.renderWallet();
      render();
      if (r.ok) say("Mined " + plural(r.amount, t.noun, t.noun) + ". Thanks for watching.");
      else say("Ad closed early. No reward, and nothing spent.");
    });
  }

  body.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!b) return;
    var a = b.getAttribute("data-act");
    if (a === "mine-diamonds") startMining("diamonds");
    else if (a === "unlock") { confirming = true; render(); }
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

  root.MineUI = { show: render, adProvider: adProvider, payProvider: payProvider };
  root.__mine = { mine: mine, adProvider: adProvider, payProvider: payProvider };

  // a game that opens on #mine: farm-ui ran showScreen before this file loaded
  if (!$("mineScreen").hidden) render();
})(window);

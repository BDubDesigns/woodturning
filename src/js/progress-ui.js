/* ============================================================
   Progress on screen (the model is progress.js): the delivery
   celebration, the rank badge in the header, and the progress panel.

   THE CELEBRATION plays on the "Delivered!" card (commissions-ui.js
   give() builds it with cardHtml and calls celebrate) as soon as the
   customer accepts the piece:
     1. the stars fly one at a time from the grade into that piece's
        mastery bar, STAR_GAP_MS apart;
     2. each lands with a pluck a note higher (audio.star) and a tiny
        haptic tick (Haptics.pulse("star"));
     3. the bar fills with an ease-out and a small overshoot (FILL_EASE);
     4. a mastery tier crossed: a beat, the bar flashes, a rising chime
        (audio.levelUp), the name flips, a "+15% pay" badge pops, and a
        bigger haptic ("levelup");
     5. then the rank bar fills the same way. A rank-up flips the title,
        and the coins and diamonds count up into the header wallet with
        quick ticks (audio.coinTick). The wallet and the badge are held
        back (farm-ui.js holdWallet) until they do.
     6. A tap anywhere skips to the end. With prefers-reduced-motion the
        end state shows at once, with the sounds only.
   Every timing number is in CFG below; the sounds' numbers are audio.CEL
   (audio.js) and the vibration patterns Haptics.CFG.PULSES (haptics.js).

   THE BADGE ("R2 · Apprentice", a thin bar to the next rank) sits in
   the header wallet on every screen. A tap opens THE PANEL: the rank,
   the next rank's title, reward and the stars it needs; every
   blueprint's mastery (unowned ones dimmed, pointing at Arbor Freight);
   and the clients met, with a placeholder portrait.
   ============================================================ */
(function (root) {
  "use strict";
  var G = root.Game, Pr = G.Progress, C = G.Commissions;
  var host = root.__farm, progress = G.progress, board = G.commissions;
  var audio = root.Lathe.audio, Hap = G.Haptics;
  function $(id) { return document.getElementById(id); }

  /* ---------- every timing number for the celebration ---------- */
  var CFG = {
    START_MS: 260,          // the card appears; this long before the first star flies
    STAR_GAP_MS: 250,       // between one star taking off and the next
    FLY_MS: 400,            // a star's flight from the grade to the bar
    FLY_LIFT_PX: 46,        // how high its arc rises above the straight line
    FILL_MS: 360,           // the bar's fill after each star...
    FILL_EASE: "cubic-bezier(0.34, 1.56, 0.64, 1)",   // ...an ease-out with a small overshoot: springy, not linear
    TIER_PAUSE_MS: 160,     // a tier crossed: the beat after the bar tops out, before the flash
    TIER_HOLD_MS: 620,      // ...and how long the new name and badge get before the bar moves on
    RANK_GAP_MS: 200,       // after the mastery bar, before the rank bar
    RANK_FILL_MS: 480,      // the rank bar's fill
    COUNT_MS: 650,          // a rank reward counting into the wallet...
    COUNT_TICKS: 10,        // ...in this many ticks
    END_MS: 120             // after the last thing moves, the card counts as done
  };

  var COIN = '<svg class="coin" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#e8a33d" stroke="#8a5a1c" stroke-width="2"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="#8a5a1c" stroke-width="1.6"/></svg>';
  var DIAMOND = '<svg class="coin" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 12L2 9z" fill="#6fd3e6" stroke="#2b7f93" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function an(word) { return /^[aeiou]/i.test(word) ? "an" : "a"; }
  function pct(mult) { return Math.round((mult - 1) * 100); }
  function reduced() { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); }

  /* ---------- words ---------- */
  function pieceDef(kind) { return C.PIECES[kind] || { name: kind, one: kind, many: kind + "s" }; }
  /* "You're a Skilled bat maker now. Bats pay +45%." At Legendary: "Your bats are heirloom quality now." */
  function masteryLine(ev) {
    var d = pieceDef(ev.kind);
    if (ev.tier >= Pr.TOP_TIER) return "Your " + d.many + " are heirloom quality now.";
    return "You're " + an(ev.name) + " " + ev.name + " " + d.one + " maker now. " + cap(d.many) + " pay +" + pct(ev.mult) + "%.";
  }
  function rewardText(rw) { return rw ? "+" + rw.diamonds + " diamonds, +" + rw.coins + " coins" : ""; }
  function rankLine(ev) {
    return "Rank " + ev.rank + ": " + ev.title + "! " + (ev.reward ? rewardText(ev.reward) + "." : "") +
      (ev.client ? " A new customer is at the door: " + ev.client + "." : "");
  }
  function masterySub(m) {
    if (!m.next) return m.stars + (m.stars === 1 ? " star" : " stars") + ". As good as it gets.";
    return m.stars + "/" + m.next.stars + " stars to " + m.next.name;
  }
  function rankSub(r) {
    if (!r.next) return r.stars + " stars. The top rank.";
    return r.stars + "/" + r.next.stars + " stars to Rank " + r.next.rank;
  }
  /* "Expert · 18/25 stars to Renowned", for the blueprint cards at Arbor Freight. */
  function masteryText(kind) {
    var m = progress.masteryOf(kind);
    return (m.tier ? m.name + " · " : "") + masterySub(m);
  }

  /* ---------- the header badge ---------- */
  var badge = $("rankBadge"), badgeLabel = $("rankLabel"), badgeBar = $("rankBar");
  var badgeHeld = 0;   // stars the celebration hasn't shown on the badge yet
  function renderBadge() {
    if (!badge) return;
    var r = Pr.rankAt(Math.max(0, progress.state.totalStars - badgeHeld));
    var t = "R" + r.rank + " · " + r.title;
    if (badgeLabel.textContent !== t) badgeLabel.textContent = t;
    badgeBar.style.width = Math.round(r.frac * 100) + "%";
    badge.setAttribute("aria-label", "Rank " + r.rank + ", " + r.title + ". " + rankSub(r) + ". Open your progress");
  }
  function bumpBadge() {
    if (!badge || reduced()) return;
    badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump");
  }

  /* ---------- the panel ---------- */
  var panel = $("progressOverlay");
  function portrait(name) {
    var words = name.replace(/^(The|Mr\.|Mrs\.|Dr\.|Old|Little|Aunt|Granny|Pastor|Coach|Captain|Chef|Count|Don|Doc|Big)\s+/i, "").split(/\s+/);
    var ini = (words[0] || name).charAt(0) + (words[1] ? words[1].charAt(0) : "");
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return '<span class="pp-face" style="--hue:' + (h % 360) + '" aria-hidden="true">' + esc(ini.toUpperCase()) + "</span>";
  }
  function bar(frac, cls) { return '<span class="pp-bar' + (cls ? " " + cls : "") + '"><i style="width:' + Math.round(frac * 100) + '%"></i></span>'; }
  function panelHtml() {
    var r = progress.rankOf(), h = '<div class="grade-card progress-card"><h2 id="progressTitle">Your progress</h2>';
    h += '<section class="pp-rank"><div class="pp-head"><span class="pp-k">RANK ' + r.rank + '</span><b>' + esc(r.title) + "</b></div>" + bar(r.frac, "rank");
    if (r.next) h += '<p class="pp-next">' + r.need + (r.need === 1 ? " more star" : " more stars") + " to <b>Rank " + r.next.rank + " · " + esc(r.next.title) + "</b>. It pays " +
      r.next.reward.diamonds + " diamonds and " + r.next.reward.coins + " coins" + (G.Clients && G.Clients.forRank(r.next.rank) ? ", and brings a new customer" : "") + ".</p>";
    else h += '<p class="pp-next">The top rank. Every star still counts toward your skills.</p>';
    h += '<p class="pp-help">Every star on a delivered piece counts. Ranking up pays coins and diamonds, and a new customer comes to the door.</p></section>';
    h += '<section class="pp-skills"><h3>YOUR SKILLS</h3><p class="pp-help">Each skill level pays 15% more for that piece.</p>';
    C.BLUEPRINT_ORDER.forEach(function (k) {
      var d = pieceDef(k), own = board.ownsBlueprint(k), m = progress.masteryOf(k);
      h += '<div class="pp-skill' + (own ? "" : " unowned") + '" data-skill="' + k + '"><div class="pp-head"><span class="pp-k">' + esc(d.name.toUpperCase()) + "</span><b>" + (own ? esc(m.tier ? m.name : "New") : "") + "</b>" +
        (own && m.tier ? '<span class="pp-bonus">+' + pct(m.mult) + "% pay</span>" : "") + "</div>";
      if (own) h += bar(m.frac) + '<p class="pp-sub">' + esc(masterySub(m)) + "</p>";
      else h += '<p class="pp-sub">Get the blueprint at Arbor Freight.</p>';
      h += "</div>";
    });
    h += "</section>";
    var met = board.state.met || [];
    h += '<section class="pp-clients"><h3>CUSTOMERS YOU\'VE MET</h3>';
    if (met.length) h += '<ul class="pp-faces">' + met.map(function (c) { return "<li>" + portrait(c) + "<span>" + esc(c) + "</span></li>"; }).join("") + "</ul>";
    else h += '<p class="pp-help">Deliver an order to meet your first customer.</p>';
    h += "</section>";
    h += '<div class="row"><button type="button" class="act" data-act="closeprogress"><span class="an">CLOSE</span><span class="ad">Back to work</span></button></div></div>';
    return h;
  }
  function openPanel() {
    panel.innerHTML = panelHtml(); panel.hidden = false;
    var b = panel.querySelector('[data-act="closeprogress"]');
    if (b && b.focus) b.focus();
  }
  function closePanel() { panel.hidden = true; panel.innerHTML = ""; }
  if (badge) badge.addEventListener("click", openPanel);
  panel.addEventListener("click", function (ev) {
    if (ev.target === panel) { closePanel(); return; }
    var b = ev.target.closest ? ev.target.closest('[data-act="closeprogress"]') : null;
    if (b) closePanel();
  });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) closePanel(); });

  /* ---------- the celebration ---------- */
  /* The progress part of the Delivered! card, drawn as it was BEFORE this delivery's
     stars; celebrate() then moves it to where it is now. */
  function before(r) {
    var kind = r.order.kind, n = r.grade.stars;
    return { kind: kind, n: n, s0: progress.starsOn(kind) - n, t0: progress.state.totalStars - n };
  }
  function cardHtml(r) {
    var b = before(r), m = Pr.masteryAt(b.s0), k = Pr.rankAt(b.t0), d = pieceDef(b.kind);
    return '<div class="cel" data-cel="ready">' +
      '<div class="cel-row cel-mastery"><div class="cel-head"><span class="cel-k">' + esc(d.name.toUpperCase()) + '</span><b class="cel-name">' + esc(m.name) + '</b><span class="cel-pop" hidden></span></div>' +
      '<div class="cel-bar"><i style="width:' + Math.round(m.frac * 100) + '%"></i></div><p class="cel-sub">' + esc(masterySub(m)) + "</p></div>" +
      '<div class="cel-row cel-rank"><div class="cel-head"><span class="cel-k">RANK <span class="cel-rk">' + k.rank + '</span></span><b class="cel-name">' + esc(k.title) + '</b><span class="cel-pop" hidden></span></div>' +
      '<div class="cel-bar rank"><i style="width:' + Math.round(k.frac * 100) + '%"></i></div><p class="cel-sub">' + esc(rankSub(k)) + "</p></div>" +
      '<p class="cel-line" aria-live="polite"></p><p class="cel-skip">Tap to skip</p></div>';
  }

  var play = null;   // the celebration playing now, or null
  /* card: the Delivered! card element (with cardHtml inside it). r: what board.deliver returned.
     opts.onDone(): once everything is in its final place (played out or skipped). */
  function celebrate(card, r, opts) {
    stop();
    opts = opts || {};
    var b = before(r), evs = r.events || [], cel = card.querySelector(".cel");
    var rows = { m: cel.querySelector(".cel-mastery"), r: cel.querySelector(".cel-rank") };
    var line = cel.querySelector(".cel-line"), overlay = card.parentNode;
    var P = { skipped: false, done: false, timers: [], flights: [] };
    play = P;
    var hold = { coins: (r.rewards && r.rewards.coins) || 0, diamonds: (r.rewards && r.rewards.diamonds) || 0 };
    host.holdWallet(hold);
    badgeHeld = b.n; renderBadge();
    // the wallet shows above the card's shade, to count into, and the card sits below it
    var nav = document.getElementById("tabs");
    if (nav) overlay.style.setProperty("--nav-bottom", Math.round(nav.getBoundingClientRect().bottom) + "px");
    document.body.classList.add("cel-lift");
    audio.init();

    function wait(ms) {
      return new Promise(function (res) {
        if (P.skipped) { res(); return; }
        var t = { res: res, id: setTimeout(function () { P.timers.splice(P.timers.indexOf(t), 1); res(); }, ms) };
        P.timers.push(t);
      });
    }
    function setBar(row, frac, ms, ease) {
      var i = row.querySelector(".cel-bar i");
      if (!ms) { i.style.transition = "none"; i.style.width = (frac * 100) + "%"; void i.offsetWidth; i.style.transition = ""; return; }
      i.style.transition = "width " + ms + "ms " + (ease || CFG.FILL_EASE);
      i.style.width = (frac * 100) + "%";
    }
    function setText(row, sel, t) { var el = row.querySelector(sel); if (el && el.textContent !== String(t)) el.textContent = t; }
    function pulseClass(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
    function flip(row, name) {
      var el = row.querySelector(".cel-name");
      pulseClass(el, "flip");
      var t = setTimeout(function () { el.textContent = name; }, 110);   // the name changes edge-on, mid-flip
      P.timers.push({ id: t, res: function () { el.textContent = name; } });
    }
    function pop(row, html) {
      var el = row.querySelector(".cel-pop");
      el.innerHTML = html; el.hidden = false; pulseClass(el, "on");
    }
    /* A star flies from the grade to the bar's end. Resolves when it lands (or at once when skipped). */
    function fly(i) {
      return new Promise(function (res) {
        var from = card.querySelectorAll(".g-stars .stars span.on")[i], to = rows.m.querySelector(".cel-bar");
        if (P.skipped || !from || !to || !document.body.animate) { res(); return; }
        var a = from.getBoundingClientRect(), z = to.getBoundingClientRect(), fill = to.querySelector("i").getBoundingClientRect();
        var x0 = a.left + a.width / 2, y0 = a.top + a.height / 2, x1 = Math.min(z.right - 6, Math.max(z.left + 6, fill.right)), y1 = z.top + z.height / 2;
        var el = document.createElement("span");
        el.className = "cel-fly"; el.textContent = "★"; el.style.left = x0 + "px"; el.style.top = y0 + "px";
        document.body.appendChild(el);
        var dx = x1 - x0, dy = y1 - y0;
        var anim = el.animate([
          { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
          { transform: "translate(calc(-50% + " + (dx * 0.45) + "px), calc(-50% + " + (dy * 0.45 - CFG.FLY_LIFT_PX) + "px)) scale(1.3)", opacity: 1, offset: 0.45 },
          { transform: "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px)) scale(0.45)", opacity: 0.85 }
        ], { duration: CFG.FLY_MS, easing: "cubic-bezier(0.45, 0, 0.3, 1)", fill: "forwards" });
        var f = { el: el, res: res };
        P.flights.push(f);
        anim.onfinish = function () { el.remove(); P.flights.splice(P.flights.indexOf(f), 1); res(); };
      });
    }
    function masteryEvent(tier) { for (var i = 0; i < evs.length; i++) if (evs[i].type === "mastery" && evs[i].tier === tier) return evs[i]; return null; }
    /* Star i has landed: the mastery bar takes it. */
    function land(i) {
      if (P.skipped) return Promise.resolve();
      audio.star(i);
      if (Hap) Hap.pulse("star");
      pulseClass(rows.m.querySelector(".cel-bar"), "bump");
      var was = Pr.masteryAt(b.s0 + i), now = Pr.masteryAt(b.s0 + i + 1);
      if (now.tier === was.tier) { setBar(rows.m, now.frac, CFG.FILL_MS); setText(rows.m, ".cel-sub", masterySub(now)); return Promise.resolve(); }
      // a tier crossed: top out the bar, a beat, then the flash, the chime, the new name and the badge
      setBar(rows.m, 1, CFG.FILL_MS);
      return wait(CFG.FILL_MS * 0.6 + CFG.TIER_PAUSE_MS).then(function () {
        if (P.skipped) return;
        var ev = masteryEvent(now.tier) || { kind: b.kind, tier: now.tier, name: now.name, mult: now.mult };
        pulseClass(rows.m, "flash");
        audio.levelUp();
        if (Hap) Hap.pulse("levelup");
        flip(rows.m, now.name);
        pop(rows.m, "+" + Math.round(Pr.MASTERY_STEP * 100) + "% pay");
        line.textContent = masteryLine(ev);
        setText(rows.m, ".cel-sub", masterySub(now));
        return wait(CFG.TIER_HOLD_MS).then(function () {
          if (P.skipped) return;
          setBar(rows.m, 0, 0);
          setBar(rows.m, now.frac, CFG.FILL_MS);
        });
      });
    }
    /* A rank reward counts down out of the wallet's hold, into the wallet, tick by tick. */
    function countIn(rw) {
      if (!rw) return Promise.resolve();
      var start = { coins: hold.coins, diamonds: hold.diamonds }, k = 0, n = CFG.COUNT_TICKS;
      function step() {
        if (P.skipped) return Promise.resolve();
        k++;
        hold.coins = Math.max(0, start.coins - Math.round(rw.coins * k / n));
        hold.diamonds = Math.max(0, start.diamonds - Math.round(rw.diamonds * k / n));
        host.holdWallet(hold);
        audio.coinTick(k);
        Array.prototype.forEach.call(document.querySelectorAll(".wallet .coin-chip"), function (c) { pulseClass(c, "bump"); });
        return k < n ? wait(CFG.COUNT_MS / n).then(step) : wait(CFG.END_MS).then(unbumpWallet);
      }
      return step();
    }
    function rankPhase() {
      var t1 = b.t0 + b.n, ranks = evs.filter(function (e) { return e.type === "rank"; }), chain = Promise.resolve();
      ranks.forEach(function (ev) {
        chain = chain.then(function () {
          if (P.skipped) return;
          audio.star(b.n);
          setBar(rows.r, 1, CFG.RANK_FILL_MS);
          return wait(CFG.RANK_FILL_MS * 0.6 + CFG.TIER_PAUSE_MS).then(function () {
            if (P.skipped) return;
            pulseClass(rows.r, "flash");
            audio.levelUp();
            if (Hap) Hap.pulse("levelup");
            flip(rows.r, ev.title);
            setText(rows.r, ".cel-rk", ev.rank);
            badgeHeld = Math.max(0, progress.state.totalStars - Pr.RANKS[ev.rank - 1].stars);
            renderBadge(); bumpBadge();
            if (ev.reward) pop(rows.r, DIAMOND + "+" + ev.reward.diamonds + " " + COIN + "+" + ev.reward.coins);
            line.textContent = rankLine(ev);
            return countIn(ev.reward).then(function () { return wait(CFG.TIER_HOLD_MS * 0.5); }).then(function () { if (!P.skipped) setBar(rows.r, 0, 0); });
          });
        });
      });
      return chain.then(function () {
        if (P.skipped) return;
        var k = Pr.rankAt(t1);
        if (!ranks.length) audio.star(b.n);
        setBar(rows.r, k.frac, CFG.RANK_FILL_MS);
        setText(rows.r, ".cel-sub", rankSub(k));
        badgeHeld = 0; renderBadge();
        return wait(CFG.RANK_FILL_MS);
      });
    }
    function unbumpWallet() { Array.prototype.forEach.call(document.querySelectorAll(".wallet .coin-chip.bump"), function (c) { c.classList.remove("bump"); }); }
    /* Everything where it ends up: used by skip, by reduced motion, and at the natural end. */
    function finalState() {
      var m = Pr.masteryAt(b.s0 + b.n), k = Pr.rankAt(b.t0 + b.n);
      var mEv = evs.filter(function (e) { return e.type === "mastery"; }), rEv = evs.filter(function (e) { return e.type === "rank"; });
      P.flights.forEach(function (f) { f.el.remove(); f.res(); }); P.flights = [];
      P.timers.forEach(function (t) { clearTimeout(t.id); t.res(); }); P.timers = [];
      setBar(rows.m, m.frac, 0); setBar(rows.r, k.frac, 0);
      setText(rows.m, ".cel-name", m.name); setText(rows.m, ".cel-sub", masterySub(m));
      setText(rows.r, ".cel-name", k.title); setText(rows.r, ".cel-rk", k.rank); setText(rows.r, ".cel-sub", rankSub(k));
      if (mEv.length) { var pm = rows.m.querySelector(".cel-pop"); pm.textContent = "+" + Math.round(Pr.MASTERY_STEP * 100 * mEv.length) + "% pay"; pm.hidden = false; pm.classList.add("on"); }
      var paid = rEv.filter(function (e) { return e.reward; });
      if (paid.length) {
        var pr = rows.r.querySelector(".cel-pop"), tot = paid.reduce(function (s, e) { s.d += e.reward.diamonds; s.c += e.reward.coins; return s; }, { d: 0, c: 0 });
        pr.innerHTML = DIAMOND + "+" + tot.d + " " + COIN + "+" + tot.c; pr.hidden = false; pr.classList.add("on");
      }
      var lines = mEv.length ? [masteryLine(mEv[mEv.length - 1])] : [];
      if (rEv.length) lines.push(rankLine(rEv[rEv.length - 1]));
      line.textContent = lines.join(" ");
      hold.coins = 0; hold.diamonds = 0; host.holdWallet(hold); unbumpWallet();
      badgeHeld = 0; renderBadge();
    }
    function finish() {
      if (P.done) return;
      P.done = true;
      overlay.removeEventListener("click", P.onTap, true);
      finalState();
      cel.setAttribute("data-cel", "done");
      if (play === P) play = null;
      if (opts.onDone) opts.onDone();
    }
    P.skip = function () {
      if (P.done) return;
      P.skipped = true;
      finish();
    };
    // a tap anywhere on the card or its shade, while it plays, skips to the end. A tap on one of the
    // card's buttons (BOARD, OK) also does what it says: the player wants to move on.
    P.onTap = function (ev) {
      if (P.done) return;
      var onButton = ev.target && ev.target.closest && ev.target.closest("[data-act]");
      if (!onButton) { ev.stopPropagation(); ev.preventDefault(); }
      P.skip();
    };
    overlay.addEventListener("click", P.onTap, true);
    cel.setAttribute("data-cel", "playing");

    if (reduced()) {
      // no motion: the end state now, and the sounds on their own
      finish();
      for (var s = 0; s < b.n; s++) (function (s) { setTimeout(function () { audio.star(s); }, CFG.START_MS + s * CFG.STAR_GAP_MS); })(s);
      if (evs.length) setTimeout(function () { audio.levelUp(); }, CFG.START_MS + b.n * CFG.STAR_GAP_MS + CFG.TIER_PAUSE_MS);
      return P;
    }

    (function run() {
      var chain = Promise.resolve(), i = 0;
      function next() {
        if (P.skipped) return Promise.resolve();
        if (i >= b.n) return chain;
        var k = i++, flight = fly(k);
        chain = chain.then(function () { return flight; }).then(function () { return land(k); });
        var crosses = Pr.tierFor(b.s0 + k + 1) > Pr.tierFor(b.s0 + k);
        // a star that crosses a tier holds the next one back until its moment is over
        return (crosses ? chain : wait(CFG.STAR_GAP_MS)).then(next);
      }
      wait(CFG.START_MS).then(next)
        .then(function () { return P.skipped ? null : wait(CFG.RANK_GAP_MS); })
        .then(function () { return P.skipped ? null : rankPhase(); })
        .then(function () { return P.skipped ? null : wait(CFG.END_MS); })
        .then(finish, finish);
    })();
    return P;
  }
  /* The card is going away: anything still playing jumps to the end, and the wallet comes down. */
  function stop() {
    if (play) { var p = play; p.skip(); }
    document.body.classList.remove("cel-lift");
  }

  renderBadge();
  var api = {
    CFG: CFG, renderBadge: renderBadge, openPanel: openPanel, closePanel: closePanel,
    cardHtml: cardHtml, celebrate: celebrate, stop: stop,
    masteryLine: masteryLine, rankLine: rankLine, masteryText: masteryText,
    playing: function () { return !!play && !play.done; }
  };
  G.ProgressUI = api;
  root.__progress = { progress: progress, ui: api };
})(window);

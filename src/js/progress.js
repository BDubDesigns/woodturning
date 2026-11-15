/* ============================================================
   Progress: blueprint mastery and the player's rank. Pure,
   renderer-free, testable in Node.

   Stars are the XP. Only the stars on an accepted delivery count
   (commissions.js deliver() calls addStars once the customer takes
   the piece); practice, rejected pieces and pieces kept in the shed
   earn nothing until they are delivered.

   Mastery is per blueprint, from the stars earned on that kind of
   piece (MASTERY). Each tier raises the pay for that piece by
   MASTERY_STEP: the multiplier is 1 + MASTERY_STEP x tier, and it is
   the tier BEFORE a delivery's stars are added, so the stars just
   earned don't boost the pay on the same piece. Stars past the top
   tier still count toward rank; the mastery bar just stays full.

   Rank is overall, from every star on every piece (RANKS). Each
   rank-up pays a one-time reward (3 x rank diamonds, 50 x rank coins)
   and brings a new client (Part 3). Rank never gates content.

   addStars(kind, n) returns what happened, in the order to show it:
   every mastery tier crossed, then every rank crossed, each with its
   reward. One delivery can cross more than one of each. The caller
   (commissions.js) pays the rank rewards straight away.

   The model owns the progress section of the save:
     game.progress { starsByKind: { rolling_pin: 3, ... }, totalStars, rankPaid }
   rankPaid is the highest rank whose reward has been handed over, so a
   reward is paid exactly once even if something adds stars twice.
   ============================================================ */
(function (root) {
  "use strict";

  /* ---------- the tables (every number is a starting point for playtesting) ---------- */
  var MASTERY_STEP = 0.15;   // each mastery tier is +15% pay on that piece
  var MASTERY = [            // stars on that piece to reach each tier
    { tier: 0, name: "",           stars: 0 },
    { tier: 1, name: "Familiar",   stars: 1 },
    { tier: 2, name: "Practiced",  stars: 4 },
    { tier: 3, name: "Skilled",    stars: 9 },
    { tier: 4, name: "Expert",     stars: 15 },
    { tier: 5, name: "Renowned",   stars: 25 },
    { tier: 6, name: "Legendary",  stars: 50 }
  ];
  var REWARD_DIAMONDS = 3, REWARD_COINS = 50;   // a rank-up pays this many x the new rank
  var RANKS = [              // total stars to reach each rank
    { rank: 1,  title: "Hobbyist",      stars: 0 },
    { rank: 2,  title: "Apprentice",    stars: 1 },
    { rank: 3,  title: "Journeyman",    stars: 8 },
    { rank: 4,  title: "Journeyman",    stars: 15 },
    { rank: 5,  title: "Craftsman",     stars: 25 },
    { rank: 6,  title: "Craftsman",     stars: 40 },
    { rank: 7,  title: "Craftsman",     stars: 60 },
    { rank: 8,  title: "Master Turner", stars: 85 },
    { rank: 9,  title: "Master Turner", stars: 120 },
    { rank: 10, title: "Master Turner", stars: 170 },
    { rank: 11, title: "Guild Master",  stars: 240 },
    { rank: 12, title: "Guild Master",  stars: 500 }
  ];
  MASTERY.forEach(function (m) { m.mult = Math.round((1 + MASTERY_STEP * m.tier) * 100) / 100; });
  RANKS.forEach(function (r) { r.reward = r.rank > 1 ? { diamonds: REWARD_DIAMONDS * r.rank, coins: REWARD_COINS * r.rank } : null; });
  var TOP_TIER = MASTERY.length - 1, TOP_RANK = RANKS[RANKS.length - 1].rank;

  /* ---------- pure lookups ---------- */
  function tierFor(stars) { var t = 0; for (var i = 0; i < MASTERY.length; i++) if (stars >= MASTERY[i].stars) t = i; return t; }
  function rankFor(stars) { var r = 1; for (var i = 0; i < RANKS.length; i++) if (stars >= RANKS[i].stars) r = RANKS[i].rank; return r; }
  function rankRow(rank) { return RANKS[Math.max(0, Math.min(RANKS.length - 1, rank - 1))]; }
  /* How far from one threshold to the next a count is, 0..1 (1 at the top). */
  function frac(stars, from, to) { return to == null ? 1 : Math.max(0, Math.min(1, (stars - from) / (to - from))); }
  function multFor(tier) { return MASTERY[Math.max(0, Math.min(TOP_TIER, tier))].mult; }
  /* A snapshot of mastery at a star count: { tier, name, stars, from, next, need, frac, mult }.
     next is the next tier ({ tier, name, stars, mult }) or null at Legendary; need is the stars still to go. */
  function masteryAt(stars) {
    var t = tierFor(stars), row = MASTERY[t], nx = t < TOP_TIER ? MASTERY[t + 1] : null;
    return { tier: t, name: row.name, stars: stars, from: row.stars, next: nx, need: nx ? nx.stars - stars : 0, frac: frac(stars, row.stars, nx && nx.stars), mult: row.mult };
  }
  /* A snapshot of rank at a star count: { rank, title, stars, from, next, need, frac, reward }.
     reward is what reaching this rank paid; next is the next rank (with its reward) or null at the top. */
  function rankAt(stars) {
    var r = rankFor(stars), row = rankRow(r), nx = r < TOP_RANK ? rankRow(r + 1) : null;
    return { rank: r, title: row.title, stars: stars, from: row.stars, next: nx, need: nx ? nx.stars - stars : 0, frac: frac(stars, row.stars, nx && nx.stars), reward: row.reward };
  }

  /* ---------- the save section ---------- */
  function count(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function defaultProgress() { return { starsByKind: {}, totalStars: 0, rankPaid: 1 }; }
  function normalize(p) {
    var out = defaultProgress();
    if (!p || typeof p !== "object") return out;
    if (p.starsByKind && typeof p.starsByKind === "object") for (var k in p.starsByKind) if (/^[a-z][a-z0-9_]*$/.test(k) && count(p.starsByKind[k])) out.starsByKind[k] = count(p.starsByKind[k]);
    out.totalStars = count(p.totalStars);
    out.rankPaid = Math.max(1, Math.min(TOP_RANK, count(p.rankPaid) || 1));
    return out;
  }

  /* game: the save object. opts.onChange: called after any change worth saving. */
  function createProgress(game, opts) {
    opts = opts || {};
    var onChange = opts.onChange || function () {};
    game.progress = normalize(game.progress);
    var S = game.progress;

    function starsOn(kind) { return S.starsByKind[kind] || 0; }
    function masteryOf(kind) { var m = masteryAt(starsOn(kind)); m.kind = kind; return m; }
    function rankOf() { return rankAt(S.totalStars); }
    /* The pay multiplier mastery gives a piece right now (before any new stars). */
    function mult(kind) { return multFor(tierFor(starsOn(kind))); }

    /* Add a delivery's stars. Returns the events, in the order to show them:
         { type: "mastery", kind, tier, name, mult, prev }   one per tier crossed
         { type: "rank", rank, title, reward: { diamonds, coins }, prev }   one per rank crossed
       A rank's reward is listed only the first time that rank is reached. */
    function addStars(kind, n) {
      n = count(n);
      if (!n || typeof kind !== "string") return [];
      var events = [], k0 = starsOn(kind), t0 = tierFor(k0), r0 = rankFor(S.totalStars);
      S.starsByKind[kind] = k0 + n;
      S.totalStars += n;
      var t1 = tierFor(S.starsByKind[kind]), r1 = rankFor(S.totalStars), i;
      for (i = t0 + 1; i <= t1; i++) events.push({ type: "mastery", kind: kind, tier: i, name: MASTERY[i].name, mult: MASTERY[i].mult, prev: MASTERY[i - 1].name });
      for (i = r0 + 1; i <= r1; i++) {
        var row = rankRow(i), paid = i <= S.rankPaid;
        events.push({ type: "rank", rank: i, title: row.title, reward: paid ? null : row.reward, prev: rankRow(i - 1).title });
        if (!paid) S.rankPaid = i;
      }
      onChange();
      return events;
    }

    return { state: S, starsOn: starsOn, masteryOf: masteryOf, rankOf: rankOf, mult: mult, addStars: addStars, totalStars: function () { return S.totalStars; } };
  }

  var api = {
    MASTERY: MASTERY, RANKS: RANKS, MASTERY_STEP: MASTERY_STEP, REWARD_DIAMONDS: REWARD_DIAMONDS, REWARD_COINS: REWARD_COINS, TOP_TIER: TOP_TIER, TOP_RANK: TOP_RANK,
    tierFor: tierFor, rankFor: rankFor, multFor: multFor, masteryAt: masteryAt, rankAt: rankAt,
    defaultProgress: defaultProgress, normalize: normalize, createProgress: createProgress
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Progress = api;
})(typeof window !== "undefined" ? window : globalThis);

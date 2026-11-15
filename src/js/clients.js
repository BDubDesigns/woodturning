/* ============================================================
   The customers: who orders from the board. Pure data and pure
   helpers, testable in Node.

   EVERYDAY are the original customers: no lean, no quirk, in the
   rotation from the start.

   BY_RANK brings a new customer at every rank (progress.js), ranks 2
   to 12. They are homages, never copies: no real people's names or
   likenesses and no trademarked names. Portraits come later; the
   panel draws a placeholder.
     lean   what they like to order. Any of: kinds (pieces), woods,
            styles (paint.js spec kinds: solid, banded, dipped, pinstripe,
            twotone), sheen, colors (a colour family of PALETTE keys).
            LEAN_CHANCE of their orders follow it; the rest are anything
            the player owns. A lean only picks pieces the player owns:
            leaning toward one they don't, they order something they do.
     quirk  pay on top of mastery: { mult, minStars } (minStars: only when
            the piece earns that many stars).
     lines  a few order lines in their voice, shown on their order card.
   Their first order goes on the board the moment the player reaches
   their rank, as an introduction (commissions.js), and after that they
   join the rotation.

   No em dashes in anything here: it is all player-facing.
   ============================================================ */
(function (root) {
  "use strict";

  var LEAN_CHANCE = 0.7;   // how often a customer's order follows their lean

  var EVERYDAY = ["Mrs. Alder", "Old Tom", "The Hollis twins", "Pastor Reed", "Juniper Cafe", "Coach Barrow", "Aunt Marigold",
    "Mr. Fennick", "The Bramble Inn", "Dr. Okafor", "Little Wren", "Captain Moss", "Granny Pell", "The Quarry Club"];

  var BY_RANK = [
    { rank: 2, name: "Chef Basil Fury", nod: "the shouting TV chef",
      lean: { kinds: ["rolling_pin"] },
      quirk: { mult: 1.2, minStars: 3 },
      lines: ["Sand it properly or it's RAW!", "This is a kitchen, not a playground. Make it smooth.", "Even. Smooth. Perfect. Is that so hard?"] },
    { rank: 3, name: "Big Paul", nod: "Paul Bunyan and his blue ox",
      lean: { kinds: ["baseball_bat"], woods: ["pine"], styles: ["solid"], colors: ["crimson", "tangerine", "sunflower", "cobalt", "moss"] },
      lines: ["Make it big. Babe's watching.", "Bigger. No, bigger than that.", "Something to swing between felling forests."] },
    { rank: 4, name: "Mr. Holmwood", nod: "Sherlock Holmes",
      lean: { kinds: ["walking_stick"], styles: ["pinstripe"] },
      lines: ["A cane, my dear turner. Elementary.", "The stripes must be precise. The details are everything.", "I deduce you have a steady hand."] },
    { rank: 5, name: "Kaylee Glow", nod: "the lifestyle influencer",
      lean: { styles: ["twotone"], sheen: "gloss", colors: ["blush", "mint", "sky", "lavender"] },
      lines: ["It has to pop for the feed.", "Pastel, glossy, and SO aesthetic. Thank you!!", "My followers are going to lose it."] },
    { rank: 6, name: "Little Jon of the Greenwood", nod: "Robin Hood's quarterstaff man",
      lean: { kinds: ["walking_stick"], woods: ["oak"], styles: ["banded"], colors: ["moss", "mint", "ivory"] },
      lines: ["Sturdy enough for a river crossing.", "Green for the forest, oak for the knocks.", "The lads say I'm too tall for a staff. Make it stout."] },
    { rank: 7, name: "Doc Brightwood", nod: "the time-travelling inventor",
      lean: { kinds: ["spindle"], styles: ["pinstripe"], sheen: "gloss" },
      lines: ["Great Scott, I need it yesterday!", "It's for the staircase. Don't ask about the wiring.", "If my calculations are right, this spindle changes everything."] },
    { rank: 8, name: "Bat Boy", nod: "a caped superhero wannabe who's really the team's bat boy",
      lean: { kinds: ["baseball_bat"], styles: ["solid"], sheen: "matte", colors: ["ink"] },
      lines: ["The city needs a hero. The hero needs a bat. Make it black.", "Matte black. Heroes don't shine, they lurk.", "By day I carry the team's bats. By night, also bats."] },
    { rank: 9, name: "Count Oakula", nod: "Dracula",
      lean: { kinds: ["spindle"], sheen: "matte", colors: ["oxblood", "ink"] },
      lines: ["For the staircase. Nothing pointy.", "Deliver after sundown, please.", "A deep red. The colour of a fine wine, of course."] },
    { rank: 10, name: "Chad Venture", nod: "the startup founder",
      lean: { woods: ["walnut"], styles: ["twotone"] },
      quirk: { mult: 1.15 },
      lines: ["We're basically a platform for chair legs.", "Two tone. Ship it. We'll iterate.", "This piece is going to disrupt furniture."] },
    { rank: 11, name: "Don Pinoli", nod: "the gentle mob boss",
      lean: { kinds: ["rolling_pin"], woods: ["walnut"] },
      quirk: { mult: 1.25 },
      lines: ["An offer you can't refuse.", "It's for Nonna. Make it nice.", "My family remembers who does good work."] },
    { rank: 12, name: "The Grand Duchess", nod: "royalty",
      lean: { kinds: ["spindle"], woods: ["walnut"], sheen: "gloss" },
      quirk: { mult: 1.3 },
      lines: ["For the east wing, naturally.", "One does like a proper gleam.", "Spare no effort. One will not spare the coin."] }
  ];

  var BY_NAME = {};
  EVERYDAY.forEach(function (n) { BY_NAME[n] = { name: n }; });
  BY_RANK.forEach(function (c) { BY_NAME[c.name] = c; });

  function get(name) { return BY_NAME[name] || null; }
  /* The new customer a rank brings, or null (rank 1 brings nobody). */
  function forRank(rank) { for (var i = 0; i < BY_RANK.length; i++) if (BY_RANK[i].rank === rank) return BY_RANK[i]; return null; }
  /* Everyone in the rotation at a rank: the everyday customers and every new one up to it. */
  function rotation(rank) {
    return EVERYDAY.concat(BY_RANK.filter(function (c) { return c.rank <= (rank || 1); }).map(function (c) { return c.name; }));
  }
  /* What a customer pays on top, for a piece earning `stars` (1 with no quirk). */
  function quirkMult(name, stars) {
    var c = BY_NAME[name], q = c && c.quirk;
    if (!q) return 1;
    if (q.minStars && !(stars >= q.minStars)) return 1;
    return q.mult;
  }
  /* "+20% at 3 stars", "+25%", or "" for the order card. */
  function quirkText(name) {
    var c = BY_NAME[name], q = c && c.quirk;
    if (!q) return "";
    return "+" + Math.round((q.mult - 1) * 100) + "%" + (q.minStars ? " at " + q.minStars + " stars" : "");
  }

  var api = { LEAN_CHANCE: LEAN_CHANCE, EVERYDAY: EVERYDAY, BY_RANK: BY_RANK, get: get, forRank: forRank, rotation: rotation, quirkMult: quirkMult, quirkText: quirkText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Clients = api;
})(typeof window !== "undefined" ? window : globalThis);

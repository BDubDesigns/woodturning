// Shared test fixtures.
"use strict";
const S = require("../src/js/save.js");
const T = require("../src/js/tutorial.js");

/* A player who has been through the new-player flow (or skipped it): the
   tutorial's starter coins and diamonds, an empty shed, the flow done.
   Most model tests want this rather than a brand-new game, which starts
   with nothing but three pine logs. */
function playedGame() {
  const g = S.newGame();
  g.wallet = { coins: T.STARTER.coins, diamonds: T.STARTER.diamonds };
  g.inventory = { stacks: {}, items: [], nextId: 1 };
  g.tutorial = { step: null, done: true };
  return g;
}
module.exports = { playedGame };

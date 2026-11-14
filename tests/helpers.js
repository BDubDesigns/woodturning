// Shared test fixtures.
"use strict";
const S = require("../src/js/save.js");
const T = require("../src/js/tutorial.js");

/* A player who has been through the new-player flow (or skipped it): 250
   coins and 5 diamonds, an empty shed, the flow done.
   Most model tests want this rather than a brand-new game, which starts
   with nothing but three pine logs. */
function playedGame() {
  const g = S.newGame();
  g.wallet = { coins: 250, diamonds: 5 };   // fixed, so the model tests don't move when the starter pack is tuned
  g.inventory = { stacks: {}, items: [], nextId: 1 };
  g.tutorial = { step: null, done: true };
  return g;
}
module.exports = { playedGame };

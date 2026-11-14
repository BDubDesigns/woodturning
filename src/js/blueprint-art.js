/* ============================================================
   Blueprint art: the drawing on a blueprint card at Arbor Freight
   (shop-ui.js) and on the board's teaser (commissions-ui.js).
   Pure, renderer-free, testable in Node: it returns an SVG string.

   The piece is drawn from its target profile (commissions.js
   targetProfile) with a fixed preview seed and never flipped, so a
   blueprint always shows the same piece the same way round:
     - a deep blue field with thin white grid lines
     - the profile as a white outline, mirrored about the axis,
       with a dashed centreline through it
     - dimension lines with arrowheads for the overall length and
       the widest diameter, in mm (cutting.js MM_PER_UNIT)
     - a title block in the corner with the piece name and price
   opts.owned stamps it OWNED. opts.afford === false dims the price
   (it stays readable). opts.id keeps ids unique when several
   drawings share a page.
   ============================================================ */
(function (root) {
  "use strict";
  var Game = root.Game || {};
  var C = Game.Commissions || require("./commissions.js");
  var Lathe = root.Lathe || {};
  var Cut = Lathe.CFG ? Lathe : require("./cutting.js");
  var CFG = Cut.CFG;

  var PREVIEW_SEED = 424242;
  var W = 320, H = 150;
  var X0 = 26, X1 = 280, MID = 70, RPX = 50;   // the piece spans X0..X1; R0 is RPX pixels
  var FONT = "'Barlow Condensed', 'Barlow', sans-serif";
  var BLUE = "#1d4a8a", LINE = "#f4f8ff";

  function f1(v) { return (Math.round(v * 10) / 10).toString(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function arrow(x, y, dx, dy) {     // a filled arrowhead at (x, y) pointing along (dx, dy)
    var px = -dy, py = dx, L = 6, w = 2.4;
    return '<path d="M' + f1(x) + " " + f1(y) + " L" + f1(x - dx * L + px * w) + " " + f1(y - dy * L + py * w) + " L" + f1(x - dx * L - px * w) + " " + f1(y - dy * L - py * w) + ' Z" fill="' + LINE + '"/>';
  }

  /* The drawing for a piece, as an SVG string, or "" for an unknown kind. */
  function blueprintSVG(kind, opts) {
    opts = opts || {};
    var def = C.PIECES[kind];
    if (!def) return "";
    var prof = C.targetProfile({ kind: kind, seed: PREVIEW_SEED }, { noFlip: true });
    var n = prof.length, sc = RPX / CFG.R0, i;
    var uid = "bp" + String(opts.id || kind).replace(/[^a-z0-9_]/gi, "");

    // the outline: along the top, back along the bottom
    var top = [], bot = [], maxR = 0, maxI = 0;
    for (i = 0; i < n; i++) {
      var x = X0 + (i / (n - 1)) * (X1 - X0), r = prof[i] * sc;
      top.push(f1(x) + " " + f1(MID - r));
      bot.push(f1(x) + " " + f1(MID + r));
      if (prof[i] > maxR) { maxR = prof[i]; maxI = i; }
    }
    var outline = "M" + top.join(" L") + " L" + bot.reverse().join(" L") + " Z";
    var lenMm = Math.round(CFG.LOG_LEN * CFG.MM_PER_UNIT), diaMm = Math.round(maxR * 2 * CFG.MM_PER_UNIT);
    var mx = X0 + (maxI / (n - 1)) * (X1 - X0), my0 = MID - maxR * sc, my1 = MID + maxR * sc;
    var rEnd0 = prof[0] * sc, rEnd1 = prof[n - 1] * sc;

    var h = '<svg class="bp-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Blueprint: ' + esc(def.name) + '">';
    // the field and its grid
    h += '<defs><pattern id="' + uid + 'g" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="' + LINE + '" stroke-opacity="0.1" stroke-width="0.6"/></pattern>' +
      '<pattern id="' + uid + 'G" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="' + LINE + '" stroke-opacity="0.2" stroke-width="0.8"/></pattern></defs>';
    h += '<rect width="' + W + '" height="' + H + '" fill="' + BLUE + '"/><rect width="' + W + '" height="' + H + '" fill="url(#' + uid + 'g)"/><rect width="' + W + '" height="' + H + '" fill="url(#' + uid + 'G)"/>';
    h += '<rect x="3" y="3" width="' + (W - 6) + '" height="' + (H - 6) + '" fill="none" stroke="' + LINE + '" stroke-opacity="0.55" stroke-width="1"/>';
    // the piece
    h += '<path d="' + outline + '" fill="' + LINE + '" fill-opacity="0.07" stroke="' + LINE + '" stroke-width="1.5" stroke-linejoin="round"/>';
    h += '<path d="M' + (X0 - 10) + " " + MID + " H" + (X1 + 10) + '" stroke="' + LINE + '" stroke-opacity="0.75" stroke-width="0.8" stroke-dasharray="9 3 2 3"/>';
    // overall length, above the piece
    var ly = 12;
    h += '<g stroke="' + LINE + '" stroke-width="0.7" stroke-opacity="0.8"><path d="M' + X0 + " " + f1(MID - rEnd0 - 3) + " V" + (ly - 3) + '"/><path d="M' + X1 + " " + f1(MID - rEnd1 - 3) + " V" + (ly - 3) + '"/></g>';
    h += '<path d="M' + (X0 + 5) + " " + ly + " H" + (X1 - 5) + '" stroke="' + LINE + '" stroke-width="0.9"/>' + arrow(X0, ly, -1, 0) + arrow(X1, ly, 1, 0);
    h += '<rect x="' + ((X0 + X1) / 2 - 26) + '" y="' + (ly - 6) + '" width="52" height="12" fill="' + BLUE + '"/>';
    h += '<text x="' + (X0 + X1) / 2 + '" y="' + (ly + 4) + '" text-anchor="middle" font-family="' + FONT + '" font-weight="600" font-size="11" fill="' + LINE + '">' + lenMm + " mm</text>";
    // the widest diameter, off to the right
    var dx = W - 18;
    h += '<g stroke="' + LINE + '" stroke-width="0.7" stroke-opacity="0.8"><path d="M' + f1(mx + 3) + " " + f1(my0) + " H" + (dx + 4) + '"/><path d="M' + f1(mx + 3) + " " + f1(my1) + " H" + (dx + 4) + '"/></g>';
    h += '<path d="M' + dx + " " + f1(my0 + 5) + " V" + f1(my1 - 5) + '" stroke="' + LINE + '" stroke-width="0.9"/>' + arrow(dx, my0, 0, -1) + arrow(dx, my1, 0, 1);
    h += '<rect x="' + (dx - 7) + '" y="' + (MID - 20) + '" width="14" height="40" fill="' + BLUE + '"/>';
    h += '<text transform="translate(' + (dx + 4) + " " + MID + ') rotate(-90)" text-anchor="middle" font-family="' + FONT + '" font-weight="600" font-size="11" fill="' + LINE + '">Ø ' + diaMm + " mm</text>";
    // the title block, bottom right
    var bw = 128, bh = 30, bx = W - 3 - bw, by = H - 3 - bh;
    var afford = opts.afford !== false, price = def.price ? def.price + " COINS" : "FREE";
    h += '<g font-family="' + FONT + '" fill="' + LINE + '"><rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" fill="' + BLUE + '" stroke="' + LINE + '" stroke-opacity="0.7" stroke-width="0.9"/>' +
      '<path d="M' + bx + " " + (by + 17) + " H" + (bx + bw) + '" stroke="' + LINE + '" stroke-opacity="0.5" stroke-width="0.6"/>' +
      '<text x="' + (bx + 6) + '" y="' + (by + 13) + '" font-weight="700" font-size="12.5" letter-spacing="0.06em">' + esc(def.name.toUpperCase()) + "</text>" +
      '<text x="' + (bx + 6) + '" y="' + (by + 27) + '" font-weight="500" font-size="9" letter-spacing="0.1em" fill-opacity="0.75">SCALE 1:4 · MM</text>' +
      '<text class="bp-price" x="' + (bx + bw - 6) + '" y="' + (by + 27) + '" text-anchor="end" font-weight="700" font-size="10" letter-spacing="0.08em" fill-opacity="' + (afford ? 1 : 0.4) + '">' + price + "</text></g>";
    if (opts.owned) {
      h += '<g class="bp-owned" transform="translate(' + (W / 2 - 50) + " " + (MID + 26) + ') rotate(-9)" font-family="' + FONT + '">' +
        '<rect x="-46" y="-17" width="92" height="30" rx="4" fill="none" stroke="#ff7a5c" stroke-width="2.6"/>' +
        '<text x="0" y="6" text-anchor="middle" font-weight="700" font-size="20" letter-spacing="0.18em" fill="#ff7a5c">OWNED</text></g>';
    }
    return h + "</svg>";
  }

  var api = { blueprintSVG: blueprintSVG, PREVIEW_SEED: PREVIEW_SEED };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.BlueprintArt = api;
})(typeof window !== "undefined" ? window : globalThis);

/* ============================================================
   Licensed assets, unscrambled at load (the shop cat).

   The store licence for bought models asks that players can't simply
   download them as-is, and that they're never published in the form
   they were bought in. So they live in a private repo (BDubDesigns/
   woodturning-assets), CI checks it out with a token, and tools/build.mjs
   puts them in the page scrambled (window.WT_ASSETS). This file undoes
   the scramble. A build without the private repo has none: has() is
   false and the game goes on without them (no cat).
   ============================================================ */
(function (root) {
  "use strict";
  var KEY = "bdub-woodturning-shop-assets-v1";   // the same key as tools/build.mjs
  var store = root.WT_ASSETS || {};
  function has(id) { return typeof store[id] === "string" && store[id].length > 0; }
  function bytes(id) {
    if (!has(id)) return null;
    var bin = atob(store[id]), n = bin.length, out = new Uint8Array(n), k = KEY.length;
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i) ^ KEY.charCodeAt((i * 7 + (i >> 5)) % k);
    return out;
  }
  function objectUrl(id, mime) {                  // for an image: a blob URL, never a data: URL of the plain file
    var b = bytes(id);
    return b ? URL.createObjectURL(new Blob([b], { type: mime })) : null;
  }
  var api = { has: has, bytes: bytes, objectUrl: objectUrl };
  var L = root.Lathe || (root.Lathe = {});
  L.assets = api;
})(typeof window !== "undefined" ? window : globalThis);

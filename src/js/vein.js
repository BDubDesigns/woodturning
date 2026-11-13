/* ============================================================
   Diamond vein model: pure, renderer-free, testable in Node.

   The mine scene is one rock vein in the middle of the screen.
   The player swipes a pick across it. Each swipe that crosses
   the rock fast enough is one strike: it takes health off the
   vein and opens a crack where it landed, running the way the
   swipe was going, and every older crack creeps a little longer.
   When the health is gone the vein breaks and the diamonds set
   in it come loose.

   Coordinates are vein-local: the vein sits at (0, 0) with a
   radius of about 1, y pointing up. The view scales them to
   pixels. Speeds are in vein radii per second.

   The vein never pays anything itself. It reports `broken`, and
   whoever hosts it decides what that is worth (see mine-scene.js
   and monetize.js). That keeps the reward in one place.
   ============================================================ */
(function (root) {
  "use strict";

  var VCFG = {
    HP: 100,
    SIDES: 15,            // corners on the vein outline
    MIN_SPEED: 2.4,       // radii/s: slower than this is a tap, the pick just tinks
    FULL_SPEED: 10,       // radii/s: at or past this a strike lands at full power
    DMG_MIN: 10,          // health a just-fast-enough strike takes
    DMG_MAX: 21,          // health a full-power strike takes
    CRACK_STEP: 0.07,     // length of one crack segment
    CRACK_LEN_MIN: 0.28,  // a new crack from a weak strike
    CRACK_LEN_MAX: 0.62,  // a new crack from a full-power strike
    GROW_PER_HIT: 0.08,   // every older crack creeps this much per strike
    BRANCH_P: 0.22,       // chance per segment that a crack forks
    MAX_CRACKS: 60,
    CRYSTALS: 5           // diamonds set in the rock (the host can change this)
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function mkRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pointInPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /* An irregular, slightly wide lump of rock. */
  function makeOutline(rng, sides) {
    var pts = [];
    for (var i = 0; i < sides; i++) {
      var a = (i / sides) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      var r = 0.84 + rng() * 0.22;
      pts.push([Math.cos(a) * r * 1.12, Math.sin(a) * r * 0.92]);
    }
    return pts;
  }

  /* Where the diamonds sit: spread out, well inside the rock. */
  function placeCrystals(rng, poly, n) {
    var out = [], tries = 0;
    while (out.length < n && tries < 400) {
      tries++;
      var x = (rng() * 2 - 1) * 0.8, y = (rng() * 2 - 1) * 0.62;
      if (!pointInPoly(x, y, poly)) continue;
      var ok = true;
      for (var k = 0; k < out.length; k++) {
        var dx = out[k].x - x, dy = out[k].y - y;
        if (dx * dx + dy * dy < 0.3 * 0.3) { ok = false; break; }
      }
      if (!ok) continue;
      out.push({ x: x, y: y, size: 0.1 + rng() * 0.06, rot: rng() * Math.PI, hue: rng() });
    }
    return out;
  }

  function createVein(opts) {
    opts = opts || {};
    var seed = opts.seed === undefined ? (Date.now() & 0xffffff) : opts.seed;
    var rng = mkRng(seed);
    var outline = makeOutline(rng, VCFG.SIDES);
    var crystals = placeCrystals(rng, outline, opts.crystals === undefined ? VCFG.CRYSTALS : opts.crystals);

    var vein = {
      seed: seed, outline: outline, crystals: crystals,
      hp: VCFG.HP, maxHp: VCFG.HP,
      cracks: [],          // { pts: [[x,y]...], heading, width, room }
      strikes: 0, tinks: 0,
      broken: false
    };

    // swipe tracking
    var down = false, last = null, armed = false;

    function inside(x, y) { return pointInPoly(x, y, outline); }

    /* Walk a crack from (x, y) along `heading` for `len`, bending a little
       and leaning toward the middle so cracks run into the rock, not around
       its rim. Forks become cracks of their own. Returns the new cracks. */
    function grow(crack, len, made) {
      var steps = Math.max(1, Math.round(len / VCFG.CRACK_STEP));
      for (var s = 0; s < steps; s++) {
        var p = crack.pts[crack.pts.length - 1];
        var toC = Math.atan2(-p[1], -p[0]);
        var d = toC - crack.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        crack.heading += d * 0.12 + (rng() - 0.5) * 0.7;
        var nx = p[0] + Math.cos(crack.heading) * VCFG.CRACK_STEP;
        var ny = p[1] + Math.sin(crack.heading) * VCFG.CRACK_STEP;
        if (!inside(nx, ny)) { crack.room = false; break; }
        crack.pts.push([nx, ny]);
        if (made && rng() < VCFG.BRANCH_P && vein.cracks.length + made.length < VCFG.MAX_CRACKS) {
          var side = rng() < 0.5 ? -1 : 1;
          var fork = { pts: [[nx, ny]], heading: crack.heading + side * (0.6 + rng() * 0.6), width: crack.width * 0.6, room: true, parent: crack };
          made.push(fork);
        }
      }
    }

    function strike(x, y, dx, dy, speed) {
      var power = clamp((speed - VCFG.MIN_SPEED) / (VCFG.FULL_SPEED - VCFG.MIN_SPEED), 0, 1);
      var dmg = VCFG.DMG_MIN + (VCFG.DMG_MAX - VCFG.DMG_MIN) * power;
      vein.hp = Math.max(0, vein.hp - dmg);
      vein.strikes++;

      // older cracks creep and widen
      for (var i = 0; i < vein.cracks.length; i++) {
        var c = vein.cracks[i];
        c.width = Math.min(1, c.width + 0.05);
        if (c.room) grow(c, VCFG.GROW_PER_HIT, null);
      }

      // a new crack where it landed, running the way the swipe ran
      var made = [];
      var heading = Math.atan2(dy, dx);
      var main = { pts: [[x, y]], heading: heading, width: 0.45 + 0.55 * power, room: true };
      made.push(main);
      grow(main, VCFG.CRACK_LEN_MIN + (VCFG.CRACK_LEN_MAX - VCFG.CRACK_LEN_MIN) * power, made);
      for (var f = 1; f < made.length; f++) grow(made[f], 0.12 + rng() * 0.2, null);
      for (var m = 0; m < made.length; m++) if (vein.cracks.length < VCFG.MAX_CRACKS) vein.cracks.push(made[m]);

      var ev = { type: "strike", x: x, y: y, dx: dx, dy: dy, power: power, damage: dmg, hp: vein.hp, cracks: made };
      if (vein.hp <= 0) { vein.broken = true; ev.broke = true; }
      return ev;
    }

    /* Where a segment from outside to inside first meets the rim. */
    function entry(ax, ay, bx, by) {
      var lo = 0, hi = 1;
      for (var k = 0; k < 14; k++) {
        var mid = (lo + hi) / 2;
        if (inside(ax + (bx - ax) * mid, ay + (by - ay) * mid)) hi = mid; else lo = mid;
      }
      return [ax + (bx - ax) * hi, ay + (by - ay) * hi];
    }

    /* ---- pointer input, in vein-local units and seconds ----
       A strike lands once per pass over the rock: the swipe arms when the
       finger is outside the rock (or lifts), and fires the first time it
       crosses in fast enough. Starting a swipe on the rock works too: it
       fires as soon as the finger gets moving. A slow pass is a tink. */
    function pointerDown(x, y, t) {
      down = true; last = { x: x, y: y, t: t }; armed = true;
      return null;
    }
    function pointerMove(x, y, t) {
      if (!down || vein.broken) return null;
      var p = last; last = { x: x, y: y, t: t };
      var dx = x - p.x, dy = y - p.y, dist = Math.sqrt(dx * dx + dy * dy);
      var wasIn = inside(p.x, p.y), isIn = inside(x, y);
      if (!wasIn && !isIn) { armed = true; return null; }
      if (!armed || dist < 1e-6) return null;
      var dt = Math.max(0.004, t - p.t), speed = dist / dt;
      var hitAt = wasIn ? [p.x, p.y] : entry(p.x, p.y, x, y);
      if (speed < VCFG.MIN_SPEED) {
        if (!wasIn) { armed = false; vein.tinks++; return { type: "tink", x: hitAt[0], y: hitAt[1] }; }
        return null;     // started on the rock and still slow: wait for the swing
      }
      armed = false;
      return strike(hitAt[0], hitAt[1], dx / dist, dy / dist, speed);
    }
    function pointerUp() { down = false; last = null; armed = true; return null; }

    vein.inside = inside;
    vein.pointerDown = pointerDown;
    vein.pointerMove = pointerMove;
    vein.pointerUp = pointerUp;
    vein.strike = strike;
    vein.progress = function () { return 1 - vein.hp / vein.maxHp; };
    return vein;
  }

  var api = { VCFG: VCFG, createVein: createVein, pointInPoly: pointInPoly, mkRng: mkRng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var G = root.Game || (root.Game = {});
  G.Vein = api;
})(typeof window !== "undefined" ? window : globalThis);

/* ============================================================
   Cutting model: pure, renderer-free, testable in Node.

   The workpiece is a 1D radius profile (one radius per slice
   along the length). Both views, 3D and 2D, draw from this same
   array. Cutting lowers radius values under the chisel.

   Three ideas make it feel like turning:

   1. Pressure, not position, sets depth. The finger stays below
      the wood. Upward travel from the touch-down point (the first
      ~40px) ramps pressure 0..1, and pressure sets how deep this
      pass may go (PASS_DEPTH at full pressure).

   2. Removal is rate-capped. Each slice loses at most `rate`
      units/sec, where rate = tip rate x RATE_SCALE x the RPM factor
      x the pressure factor (see removalRate). Faster spin and a
      harder push both take wood off quicker; a light touch at low
      RPM barely shaves. A fast whip spends almost no time over a slice
      and only scores it, while a slow steady pass reaches the full
      pass depth. Going deeper than one pass takes another pass:
      a slice's pass reference resets once the tool leaves it, or
      when pressure is let off. MIN_R guards the core.

   3. The profile stays smooth. The cut kernel falls to zero with
      zero slope at its edge, so a cut never leaves a hard step;
      the kernel centre is fractional, not snapped to a slice; and
      the cutting edge height comes from the bevel riding on the
      surrounding surface (kernel-weighted average), so each pass
      cuts toward a smoothed copy of the surface. Ridges between
      overlapping cuts get planed off, light passes act as
      finishing cuts, and the shape reads as turned, not chewed.

   4. Surface finish. Each slice also has a roughness, rough (1 is
      rough-sawn, 0 glass smooth). A cut moves the slices it cuts toward
      its tip's finish (a skew leaves a cleaner surface than a roughing
      gouge), so cutting a sanded spot makes it rough again.
      Sandpaper (TIPS.sand, kind "abrasive") is a tool on the rack like
      any tip, but main.js sends it to sand() instead of cut(). Under a
      soft pad it evens the profile out (each slice is pulled toward the
      average of its neighbours, only ever downward, so sanding takes off
      high spots and never builds wood up), takes a tiny, even amount off
      (sanding one spot forever slowly thins it) and eases rough toward
      the grit's floor. The grit is the workshop's sandpaper (shop.js
      abrasives): { smooth, rate, floor }. smoothness() is the mean of
      1 - rough over the graded span.
   ============================================================ */
(function (root) {
  "use strict";

  var CFG = {
    SEG: 240,            // slices along the blank
    LOG_LEN: 6.4,        // world units
    R0: 1.05,            // starting radius
    MIN_R: 0.14,         // never cut through the core
    CENTER_Y: 2.0,       // lathe axis height (3D world)
    MM_PER_UNIT: 40,     // depth readout scale (blank is about 84 mm across)
    END_MARGIN: 2,       // slices at each end held by the centres, never cut

    PRESS_RAMP_PX: 40,   // upward travel from touch-down that ramps pressure 0 -> 1
    PRESS_TAU: 0.045,    // seconds; pressure eases toward the finger, no instant plunges
    PASS_DEPTH: 0.36,    // max depth one pass can reach at full pressure (about 14 mm)
    NOSE_RADIUS: 0.1,    // fins narrower than this ball get rounded into beads (about 4 mm)

    // Removal speed. rate = TIPS[tip].rate * RATE_SCALE * rpmFactor * pressureFactor
    RATE_SCALE: 1,       // global knob for how fast wood comes off
    RPM_REF: 1100,       // the default spindle speed; rpmFactor is 1 here
    RPM_EXP: 1,          // rpmFactor = (rpm / RPM_REF) ^ RPM_EXP, so double the RPM cuts about twice as fast
    RPM_MIN: 200,        // the slider range; rpm is clamped to it
    RPM_MAX: 2400,
    PRESS_RATE_MIN: 0.12, // pressureFactor at the lightest touch
    PRESS_RATE_EXP: 1.6,  // pressureFactor = MIN + (1 - MIN) * p ^ EXP: a hard push cuts much faster than a nudge

    CATCH_WINDOW: 0.035, // seconds: pressure slammed 0 -> full faster than this is a catch
    CATCH_COOLDOWN: 0.9,

    // surface finish (rough: 1 rough-sawn .. 0 glass smooth)
    FINISH_RATE: 9,      // how fast a cut brings the slices it cuts to its tip's finish (per second at the kernel centre)
    SAND_SMOOTH: 1.6,    // how fast sanding pulls a slice toward its neighbours (x grit.smooth, pressure, RPM)
    SAND_MAX_RATE: 0.02, // ...never more than this many units/sec off a slice: sanding is gentle
    SAND_REMOVE: 0.0025, // units/sec taken off evenly under the pad at full pressure (about 0.1 mm/s)
    GRADE_EDGE: 0.03     // the ends sit in the centres and are not graded (as commissions.js EDGE)
  };
  /* The sandpaper the workshop starts with, if none is passed (shop.js abrasives tier 0). */
  var GRIT_80 = { smooth: 1, rate: 1.6, floor: 0.35 };

  var TIPS = {
    // halfWidth in world units; rate = max units/sec removed at the kernel centre
    // (before RATE_SCALE, RPM and pressure; see removalRate)
    // shape: "round" is a rounded trough (cos^2), "flat" a flat bottom (to `flat` of the half
    // width) with rounded shoulders. look/size: how the views draw the tip. finish: the
    // roughness a cut leaves behind. short: the label on the compact tool row. The gouge, skew and sandpaper are on the rack from the
    // start; the rest are sold at Arbor Freight (shop.js). kind "abrasive" sands, not cuts.
    gouge:    { short: "GOUGE", halfWidth: 0.5,  rate: 0.16, name: "Gouge",          shape: "round", look: "gouge", size: 1,    finish: 0.55, desc: "Wide, rounded scoop · roughing & curves" },
    skew:     { short: "SKEW", halfWidth: 0.19, rate: 0.22, name: "Skew",           shape: "flat", flat: 0.45, look: "skew", size: 1, finish: 0.35, desc: "Narrow, angled flat · crisp grooves & beads" },
    sand:     { short: "SANDPAPER", halfWidth: 0.35, rate: 0,    name: "Sandpaper",      shape: "round", look: "sand", size: 1, kind: "abrasive", desc: "Smooths the surface · fades the chisel marks" },
    parting:  { short: "PARTING", halfWidth: 0.075, rate: 0.3, name: "Parting tool",   shape: "flat", flat: 0.6, look: "skew", size: 0.45, finish: 0.6, desc: "Thin and deep · handles & shoulders" },
    detail:   { short: "DETAIL", halfWidth: 0.28, rate: 0.2,  name: "Detail gouge",   shape: "round", look: "gouge", size: 0.6, finish: 0.45, desc: "Small and round · tight beads & coves" },
    roughing: { short: "ROUGHING", halfWidth: 0.78, rate: 0.24, name: "Roughing gouge", shape: "round", look: "gouge", size: 1.5, finish: 0.75, desc: "Big and wide · takes a log round fast" }
  };
  var TIP_ORDER = ["gouge", "skew", "sand", "parting", "detail", "roughing"];

  function rpmFactor(rpm, cfg) {
    cfg = cfg || CFG;
    var r = rpm == null ? cfg.RPM_REF : Math.min(cfg.RPM_MAX, Math.max(cfg.RPM_MIN, rpm));
    return Math.pow(r / cfg.RPM_REF, cfg.RPM_EXP);
  }
  function pressureFactor(pressure, cfg) {
    cfg = cfg || CFG;
    var p = Math.min(1, Math.max(0, pressure));
    return cfg.PRESS_RATE_MIN + (1 - cfg.PRESS_RATE_MIN) * Math.pow(p, cfg.PRESS_RATE_EXP);
  }
  /* Max units/sec a tip removes at its kernel centre for this pressure and RPM. */
  function removalRate(tipKey, pressure, rpm, cfg) {
    cfg = cfg || CFG;
    return TIPS[tipKey].rate * cfg.RATE_SCALE * rpmFactor(rpm, cfg) * pressureFactor(pressure, cfg);
  }

  /* Cut kernel: weight 0..1 by distance from the tip centre (world units).
     Both shapes reach 0 with zero slope at the edge, so no step is ever cut. */
  function kernel(tipKey, d) {
    var tip = TIPS[tipKey], hw = tip.halfWidth;
    if (d >= hw) return 0;
    var u = d / hw;
    if (tip.shape === "round") {          // a rounded trough
      var c = Math.cos(u * Math.PI * 0.5);
      return c * c;
    }
    var f = tip.flat;                     // a flat bottom with rounded shoulders
    if (u <= f) return 1;
    var s = (u - f) / (1 - f);
    return 1 - s * s * (3 - 2 * s);
  }

  /* ---------------- workpiece ---------------- */
  function Workpiece(cfg) {
    this.cfg = cfg || CFG;
    var n = this.cfg.SEG;
    this.radius = new Float32Array(n);
    this.baseRadius = new Float32Array(n);
    this.passRef = new Float32Array(n);
    this.rough = new Float32Array(n);   // surface roughness per slice: 1 rough-sawn .. 0 glass smooth
    this._tmp = new Float32Array(n);
    this._tmp2 = new Float32Array(n);
    this.dx = this.cfg.LOG_LEN / (n - 1);
    this.version = 0;    // bumps whenever the profile changes; views redraw on change
    this.reset();
  }
  Workpiece.prototype.reset = function (seed) {
    var c = this.cfg, n = c.SEG;
    var ph = seed == null ? Math.random() * 6.28 : seed;
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      var end = Math.min(t, 1 - t) * 2;                    // 0 at ends, 1 mid
      var taper = 0.9 + 0.1 * Math.min(1, end * 5);         // slight end chamfer
      var wobble = 1 + 0.006 * Math.sin(t * 41.0 + ph) + 0.004 * Math.sin(t * 97.0 + ph * 2);
      this.radius[i] = c.R0 * taper * wobble;
    }
    this.baseRadius.set(this.radius);
    this.passRef.set(this.radius);
    this.rough.fill(1);
    this.startVol = this.volume();
    this.blank = null;
    this.version++;
  };
  /* Mount a harvested blank: a radius profile of SEG slices, none wider than
     R0 (see makeBlank in harvest.js). The ends stay under the centres. */
  Workpiece.prototype.load = function (blank) {
    var n = this.cfg.SEG, p = blank && blank.profile;
    if (!p || p.length !== n) throw new Error("blank profile must have " + n + " slices");
    for (var i = 0; i < n; i++) this.radius[i] = Math.min(this.cfg.R0, Math.max(this.cfg.MIN_R * 2, p[i]));
    this.baseRadius.set(this.radius);
    this.passRef.set(this.radius);
    this.rough.fill(1);
    this.startVol = this.volume();
    this.blank = blank;
    this.version++;
  };
  Workpiece.prototype.volume = function () {
    var v = 0, r = this.radius;
    for (var i = 0; i < r.length; i++) v += r[i] * r[i];
    return v;
  };
  Workpiece.prototype.removedFraction = function () {
    return this.startVol > 0 ? Math.max(0, 1 - this.volume() / this.startVol) : 0;
  };
  /* Radius at axial position t in [0,1], linearly interpolated. */
  Workpiece.prototype.sample = function (t) {
    var n = this.cfg.SEG;
    var x = Math.min(1, Math.max(0, t)) * (n - 1);
    var i = Math.min(n - 2, Math.floor(x)), f = x - i;
    return this.radius[i] * (1 - f) + this.radius[i + 1] * f;
  };
  Workpiece.prototype.depthAt = function (t) {
    var n = this.cfg.SEG;
    var i = Math.round(Math.min(1, Math.max(0, t)) * (n - 1));
    return Math.max(0, this.baseRadius[i] - this.radius[i]);
  };
  /* Lifting the tool ends the pass everywhere. */
  Workpiece.prototype.endPass = function () {
    this.passRef.set(this.radius);
  };

  /* One timestep of cutting. t = axial position 0..1 (fractional),
     pressure 0..1, rateScale lets a catch slow the cut, rpm is the
     spindle speed (defaults to RPM_REF). Returns the
     removed amount (sum of r^2 deltas, proportional to volume). */
  Workpiece.prototype.cut = function (t, pressure, tipKey, dt, rateScale, rpm) {
    var c = this.cfg, n = c.SEG, r = this.radius, ref = this.passRef;
    var spec = TIPS[tipKey];
    if (!spec || spec.kind === "abrasive") return 0;   // sandpaper sands (sand()), it does not cut
    var p = Math.min(1, Math.max(0, pressure));
    if (p < 0.02) { this.endPass(); return 0; }

    var xc = Math.min(1, Math.max(0, t)) * (n - 1);
    var hwS = spec.halfWidth / this.dx;
    var lo = Math.max(c.END_MARGIN, Math.floor(xc - hwS));
    var hi = Math.min(n - 1 - c.END_MARGIN, Math.ceil(xc + hwS));
    var rate = removalRate(tipKey, p, rpm, c) * (rateScale == null ? 1 : rateScale);
    var removed = 0, i, w, nr;

    // Slices the tool is not on start a fresh pass next time it arrives.
    for (i = 0; i < n; i++) {
      if (i < lo || i > hi) ref[i] = r[i];
    }

    // The bevel rides on the surface around the tip, so the cutting edge
    // sits at the average of the surface under the middle of the tip, not at each
    // slice's own height. Ridges standing above it get planed off, and the
    // edge blends back into the untouched surface where the kernel ends.
    var sumW = 0, sumR = 0, ws = this._tmp;
    for (i = lo; i <= hi; i++) {
      w = kernel(tipKey, Math.abs(i - xc) * this.dx);
      ws[i] = w;
      if (w <= 0) { ref[i] = r[i]; continue; }
      var bw = 2 * w - 1;                        // the bevel bears on the middle of the tip
      if (bw > 0) { sumW += bw; sumR += bw * ref[i]; }
    }
    if (sumW <= 0) return 0;
    var edge = sumR / sumW - p * c.PASS_DEPTH;   // cutting edge height at the centre

    var fin = spec.finish == null ? 0.5 : spec.finish, fa, rough = this.rough;
    for (i = lo; i <= hi; i++) {
      w = ws[i];
      if (w <= 0) continue;
      var target = Math.max(c.MIN_R, ref[i] - w * (ref[i] - edge));
      if (r[i] <= target) continue;
      nr = Math.max(target, r[i] - rate * w * dt);
      removed += r[i] * r[i] - nr * nr;
      r[i] = nr;
      // where the edge is taking wood off, the surface it leaves is the tip's finish
      fa = 1 - Math.exp(-c.FINISH_RATE * w * dt);
      rough[i] += (fin - rough[i]) * fa;
    }

    removed += this._roundOver(lo, hi);
    if (removed > 0) this.version++;
    return removed;
  };

  /* One timestep of sanding. t = axial position 0..1, pressure 0..1, grit the
     sandpaper ({ smooth, rate, floor }, GRIT_80 if not given), rpm the spindle
     speed: faster spin sands faster, through the same rpmFactor as cutting.
     Returns the wood taken off (sum of r^2 deltas, like cut()). */
  Workpiece.prototype.sand = function (t, pressure, dt, grit, rpm) {
    var c = this.cfg, n = c.SEG, r = this.radius, rough = this.rough;
    var p = Math.min(1, Math.max(0, pressure));
    if (p < 0.02 || !(dt > 0)) return 0;
    grit = grit || GRIT_80;
    var drive = pressureFactor(p, c) * rpmFactor(rpm, c);
    var xc = Math.min(1, Math.max(0, t)) * (n - 1);
    var hwS = TIPS.sand.halfWidth / this.dx;
    var lo = Math.max(c.END_MARGIN, Math.floor(xc - hwS));
    var hi = Math.min(n - 1 - c.END_MARGIN, Math.ceil(xc + hwS));
    var old = this._tmp2, i, j, w;
    for (i = Math.max(0, lo - 2); i <= Math.min(n - 1, hi + 2); i++) old[i] = r[i];
    var removed = 0, cap = c.SAND_MAX_RATE * dt, take = c.SAND_REMOVE * p * dt * rpmFactor(rpm, c);
    var kBase = c.SAND_SMOOTH * (grit.smooth > 0 ? grit.smooth : 1) * drive * dt;
    var fa = 1 - Math.exp(-(grit.rate > 0 ? grit.rate : GRIT_80.rate) * drive * dt);
    var floor = grit.floor >= 0 ? grit.floor : GRIT_80.floor;
    for (i = lo; i <= hi; i++) {
      w = kernel("sand", Math.abs(i - xc) * this.dx);
      if (w <= 0) continue;
      // 1. even out: toward the neighbours' average (two slices each side), only ever down
      var sum = 0, cnt = 0;
      for (j = i - 2; j <= i + 2; j++) if (j !== i && j >= 0 && j < n) { sum += old[j] * (j === i - 1 || j === i + 1 ? 2 : 1); cnt += (j === i - 1 || j === i + 1 ? 2 : 1); }
      var avg = sum / cnt, nr = old[i];
      if (avg < nr) {
        // a spot that is already level hardly changes: the pull is the gap, so returns diminish as it evens out
        var k = Math.min(0.5, kBase * w);
        nr = Math.max(nr - cap, nr + (avg - nr) * k);
      }
      // 2. a tiny, even amount of wood off under the pad
      nr -= take * w;
      nr = Math.max(c.MIN_R, Math.min(old[i], nr));
      if (nr < r[i]) { removed += r[i] * r[i] - nr * nr; r[i] = nr; }
      this.passRef[i] = Math.min(this.passRef[i], r[i]);
      // 3. the surface: rough eases toward the grit's floor (sanding never roughens it)
      if (rough[i] > floor) rough[i] = Math.max(floor, rough[i] + (floor - rough[i]) * fa * w);
    }
    this.version++;
    return removed;
  };
  /* How smooth the piece is: the mean of 1 - rough over the graded span. */
  Workpiece.prototype.smoothness = function () {
    var n = this.cfg.SEG, e = Math.round(this.cfg.GRADE_EDGE * (n - 1)), s = 0, cnt = 0;
    for (var i = e; i < n - e; i++) { s += 1 - this.rough[i]; cnt++; }
    return cnt ? s / cnt : 0;
  };
  /* How smooth it is under the pad at t: 1 - rough, weighted by the sanding kernel. */
  Workpiece.prototype.smoothAt = function (t) {
    var n = this.cfg.SEG, xc = Math.min(1, Math.max(0, t)) * (n - 1), hwS = TIPS.sand.halfWidth / this.dx;
    var lo = Math.max(0, Math.floor(xc - hwS)), hi = Math.min(n - 1, Math.ceil(xc + hwS)), s = 0, ws = 0;
    for (var i = lo; i <= hi; i++) { var w = kernel("sand", Math.abs(i - xc) * this.dx); s += w * (1 - this.rough[i]); ws += w; }
    return ws > 0 ? s / ws : 1 - this.rough[Math.round(xc)];
  };

  /* Roll a ball of the tool's nose radius over the profile under the
     tool (a morphological opening). Any fin or cusp narrower than the
     ball is rounded into a bead; valleys and broad shapes are left
     alone. It only removes wood, and it is idempotent: dwelling never
     makes it erode further. */
  Workpiece.prototype._roundOver = function (lo, hi) {
    var c = this.cfg, n = c.SEG, r = this.radius;
    var rho = c.NOSE_RADIUS, k = Math.max(1, Math.floor(rho / this.dx));
    var cap = this._cap || (this._cap = new Float32Array(2 * k + 1));
    var s;
    for (s = -k; s <= k; s++) {
      var x = s * this.dx;
      cap[s + k] = Math.sqrt(Math.max(0, rho * rho - x * x));
    }
    // The ball reaches k slices past the tool on each side.
    lo = Math.max(c.END_MARGIN, lo - k);
    hi = Math.min(n - 1 - c.END_MARGIN, hi + k);
    var eA = Math.max(0, lo - k), eB = Math.min(n - 1, hi + k);
    var ero = this._ero || (this._ero = new Float32Array(n));
    var i, j, v;
    for (i = eA; i <= eB; i++) {           // erosion: lowest the ball centre can sit
      v = Infinity;
      for (s = -k; s <= k; s++) {
        j = i + s;
        if (j < 0 || j >= n) continue;
        var e = r[j] - cap[s + k];
        if (e < v) v = e;
      }
      ero[i] = v;
    }
    var removed = 0;
    for (i = lo; i <= hi; i++) {           // dilation: the ball's upper envelope
      v = -Infinity;
      for (s = -k; s <= k; s++) {
        j = i - s;
        if (j < eA || j > eB) continue;
        var d = ero[j] + cap[s + k];
        if (d > v) v = d;
      }
      if (v < r[i] - 1e-6) {
        var nr = Math.max(c.MIN_R, v);
        removed += r[i] * r[i] - nr * nr;
        r[i] = nr;
      }
    }
    return removed;
  };

  /* ---------------- pressure from finger travel ----------------
     Touch-down anchors the chisel on the wood surface at zero
     pressure. Moving up from the anchor ramps pressure; moving
     down re-anchors, so backing off is always instant and the
     next push starts from wherever the finger is now. */
  function Pressure(cfg) {
    this.cfg = cfg || CFG;
    this.active = false;
    this.anchorY = 0;
    this.raw = 0;
    this.value = 0;
    this.catches = true;   // off while painting or spraying: slamming the pressure in is only a catch when cutting
    this._lowT = 0;
  }
  Pressure.prototype.down = function (y, now) {
    this.active = true;
    this.anchorY = y;
    this.raw = 0;
    this.value = 0;
    this._lowT = now || 0;
  };
  /* Returns true when this move was a catch (pressure slammed in). */
  Pressure.prototype.move = function (y, now) {
    if (!this.active) return false;
    if (y > this.anchorY) this.anchorY = y;
    this.raw = Math.min(1, Math.max(0, (this.anchorY - y) / this.cfg.PRESS_RAMP_PX));
    if (this.raw < 0.15) { this._lowT = now || 0; return false; }
    if (this.catches && this.raw >= 0.999 && now != null && now - this._lowT < this.cfg.CATCH_WINDOW) {
      this.knockBack(y);
      return true;
    }
    return false;
  };
  /* A catch knocks the tool back off the wood. */
  Pressure.prototype.knockBack = function (y) {
    this.anchorY = y;
    this.raw = 0;
    this.value *= 0.3;
  };
  Pressure.prototype.up = function () {
    this.active = false;
    this.raw = 0;
    this.value = 0;
  };
  Pressure.prototype.update = function (dt) {
    var a = 1 - Math.exp(-dt / this.cfg.PRESS_TAU);
    this.value += (this.raw - this.value) * a;
    if (this.value < 1e-4) this.value = 0;
    return this.value;
  };

  /* ---------------- silhouette name ---------------- */
  function shapeName(work) {
    var r = work.radius, n = r.length, R0 = work.cfg.R0;
    if (work.startVol - work.volume() < work.startVol * 0.004) return "Blank";
    var mn = 1e9, mnI = 0, ends = (r[8] + r[n - 9]) / 2;
    for (var i = 6; i < n - 6; i++) if (r[i] < mn) { mn = r[i]; mnI = i; }
    var mid = r[Math.floor(n / 2)];
    if (mn < R0 * 0.55) return mnI > n * 0.38 && mnI < n * 0.62 ? "Spindle neck" : "Deep groove";
    if (mid < ends - 0.1) return "Cove";
    if (mid > ends + 0.08) return "Bead / swell";
    return "Cylinder";
  }

  var api = { CFG: CFG, TIPS: TIPS, TIP_ORDER: TIP_ORDER, GRIT_80: GRIT_80, kernel: kernel, rpmFactor: rpmFactor, pressureFactor: pressureFactor, removalRate: removalRate, Workpiece: Workpiece, Pressure: Pressure, shapeName: shapeName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var L = root.Lathe || (root.Lathe = {});
  for (var key in api) L[key] = api[key];
})(typeof window !== "undefined" ? window : globalThis);

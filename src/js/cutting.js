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
      units/sec, so a fast whip spends almost no time over a slice
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

    CATCH_WINDOW: 0.035, // seconds: pressure slammed 0 -> full faster than this is a catch
    CATCH_COOLDOWN: 0.9
  };

  var TIPS = {
    // halfWidth in world units; rate = max units/sec removed at the kernel centre
    gouge: { halfWidth: 0.5, rate: 0.5, name: "Gouge" },
    skew:  { halfWidth: 0.19, rate: 0.7, name: "Skew" }
  };

  /* Cut kernel: weight 0..1 by distance from the tip centre (world units).
     Both shapes reach 0 with zero slope at the edge, so no step is ever cut. */
  function kernel(tipKey, d) {
    var hw = TIPS[tipKey].halfWidth;
    if (d >= hw) return 0;
    var u = d / hw;
    if (tipKey === "gouge") {             // wide rounded trough
      var c = Math.cos(u * Math.PI * 0.5);
      return c * c;
    }
    if (u <= 0.45) return 1;              // skew: flat bottom, rounded shoulders
    var s = (u - 0.45) / 0.55;
    return 1 - s * s * (3 - 2 * s);
  }

  /* ---------------- workpiece ---------------- */
  function Workpiece(cfg) {
    this.cfg = cfg || CFG;
    var n = this.cfg.SEG;
    this.radius = new Float32Array(n);
    this.baseRadius = new Float32Array(n);
    this.passRef = new Float32Array(n);
    this._tmp = new Float32Array(n);
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
    this.startVol = this.volume();
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
     pressure 0..1, rateScale lets a catch slow the cut. Returns the
     removed amount (sum of r^2 deltas, proportional to volume). */
  Workpiece.prototype.cut = function (t, pressure, tipKey, dt, rateScale) {
    var c = this.cfg, n = c.SEG, r = this.radius, ref = this.passRef;
    var spec = TIPS[tipKey];
    var p = Math.min(1, Math.max(0, pressure));
    if (p < 0.02) { this.endPass(); return 0; }

    var xc = Math.min(1, Math.max(0, t)) * (n - 1);
    var hwS = spec.halfWidth / this.dx;
    var lo = Math.max(c.END_MARGIN, Math.floor(xc - hwS));
    var hi = Math.min(n - 1 - c.END_MARGIN, Math.ceil(xc + hwS));
    var rate = spec.rate * (rateScale == null ? 1 : rateScale) * (0.35 + 0.65 * p);
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

    for (i = lo; i <= hi; i++) {
      w = ws[i];
      if (w <= 0) continue;
      var target = Math.max(c.MIN_R, ref[i] - w * (ref[i] - edge));
      if (r[i] <= target) continue;
      nr = Math.max(target, r[i] - rate * w * dt);
      removed += r[i] * r[i] - nr * nr;
      r[i] = nr;
    }

    removed += this._roundOver(lo, hi);
    if (removed > 0) this.version++;
    return removed;
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

  var api = { CFG: CFG, TIPS: TIPS, kernel: kernel, Workpiece: Workpiece, Pressure: Pressure, shapeName: shapeName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var L = root.Lathe || (root.Lathe = {});
  for (var key in api) L[key] = api[key];
})(typeof window !== "undefined" ? window : globalThis);

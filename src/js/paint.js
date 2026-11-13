/* ============================================================
   Paint and finish model: pure, renderer-free, testable in Node.

   A turned piece is a surface of revolution, so paint laid on it
   while it spins is the same all the way round. That means the
   whole paint job is one coat per slice along the length: a colour,
   an opacity (how much of the wood is covered) and a gloss (how much
   finish is on it). Stripes, clean bands and gradients all fall out
   of that, exactly as they do on a real spinning piece.

   Same feel rules as cutting:
   - Pressure sets the flow. Slow and steady lays a solid coat; whip
     across fast and you only leave a thin streak, because each slice
     only spends a moment under the brush.
   - Edges are soft for the brush and crisp for the liner.
   - Cutting wood away takes the paint with it (syncWork).

   A paint spec is plain data, the part of a commission that says
   what the painting must look like:
     { name, segments: [{ a, b, paint }], sheen }
   segments cover 0..1 along the length; paint is a PALETTE key, or
   null for bare wood. sheen is "matte" | "satin" | "gloss".
   matchSpec() grades a finished piece against it.
   ============================================================ */
(function (root) {
  "use strict";

  var CFG = {
    SEG: 240,          // must match the cutting model
    LOG_LEN: 6.4,      // world units, same as the cutting model
    END_MARGIN: 2,

    BRUSH_FLOW: 7,     // coat built per second at full pressure under the middle of the brush
    FLOW_FLOOR: 0.04,  // share of the flow still left at the lightest touch
    FLOW_EXP: 2,       // flow rises with pressure squared: a light touch lays a thin wash, a firm push a solid coat
    SPRAY_RATE: 1.6,   // gloss built per second at full pressure under the middle of the mist
    SPRAY_FLOOR: 0.3,

    WOOD_RGB: [0.71, 0.52, 0.30],   // bare blank, linear 0..1 sRGB-ish, what paint is judged against
    DIST_FULL: 0.06,   // colour distance still scored as a perfect slice
    DIST_ZERO: 0.3,    // colour distance scored as a miss
    EDGE_TOL: 0.012    // fraction of the length a band edge may be off before it costs
  };

  /* The paints. Spec colours come from this list, and these are the only
     colours the player can pick, so a spec can always be matched. */
  var PALETTE = {
    crimson:   { id: "crimson",   name: "Crimson",   hex: "#c0392b" },
    tangerine: { id: "tangerine", name: "Tangerine", hex: "#e8772e" },
    sunflower: { id: "sunflower", name: "Sunflower", hex: "#f0c334" },
    moss:      { id: "moss",      name: "Moss",      hex: "#5d8a3c" },
    teal:      { id: "teal",      name: "Teal",      hex: "#2a8c8c" },
    cobalt:    { id: "cobalt",    name: "Cobalt",    hex: "#2f5fb3" },
    plum:      { id: "plum",      name: "Plum",      hex: "#7a3b78" },
    ivory:     { id: "ivory",     name: "Ivory",     hex: "#efe6d0" },
    ink:       { id: "ink",       name: "Ink",       hex: "#25262b" }
  };
  var PALETTE_ORDER = ["crimson", "tangerine", "sunflower", "moss", "teal", "cobalt", "plum", "ivory", "ink"];
  for (var pk in PALETTE) PALETTE[pk].rgb = hexToRgb(PALETTE[pk].hex);
  function hexToRgb(h) {
    return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  }

  /* Applicators. halfWidth in world units, like the chisel tips. */
  var BRUSHES = {
    brush: { halfWidth: 0.3,  flow: 1.0, name: "Brush", soft: true },
    liner: { halfWidth: 0.07, flow: 1.0, name: "Liner", soft: false }
  };
  var SPRAY_HALF_WIDTH = 0.95;

  var SHEEN = {
    matte: { id: "matte", name: "Matte", gloss: 0.08 },
    satin: { id: "satin", name: "Satin", gloss: 0.5 },
    gloss: { id: "gloss", name: "Gloss", gloss: 0.92 }
  };
  var SHEEN_ORDER = ["matte", "satin", "gloss"];

  function sheenFor(gloss) {
    return gloss < 0.28 ? "matte" : gloss < 0.72 ? "satin" : "gloss";
  }

  /* Soft edge for the brush (cosine falloff), flat top with soft shoulder
     for the liner so a pinstripe stays a clean line. Zero slope at the edge. */
  function kernel(brushKey, d) {
    var hw = BRUSHES[brushKey].halfWidth;
    if (d >= hw) return 0;
    var u = d / hw;
    if (brushKey === "brush") { var c = Math.cos(u * Math.PI * 0.5); return c * c; }
    if (u <= 0.55) return 1;
    var s = (u - 0.55) / 0.45;
    return 1 - s * s * (3 - 2 * s);
  }
  function sprayKernel(d) {
    if (d >= SPRAY_HALF_WIDTH) return 0;
    var c = Math.cos((d / SPRAY_HALF_WIDTH) * Math.PI * 0.5);
    return c * c;
  }

  /* ---------------- the coat on the piece ---------------- */
  function Coating(cfg) {
    this.cfg = cfg || CFG;
    var n = this.cfg.SEG;
    this.color = new Float32Array(n * 3);   // paint colour per slice
    this.coat = new Float32Array(n);        // 0 bare wood .. 1 solid paint
    this.gloss = new Float32Array(n);       // 0 matte .. 1 full gloss
    this._lastR = new Float32Array(n);
    this._haveR = false;
    this.dx = this.cfg.LOG_LEN / (n - 1);
    this.version = 0;                       // bumps whenever anything changes; views redraw on change
    this.reset();
  }
  Coating.prototype.reset = function () {
    this.color.fill(0); this.coat.fill(0); this.gloss.fill(0);
    this._haveR = false;
    this.version++;
  };

  /* One timestep of painting. t = axial position 0..1, pressure 0..1,
     colorKey a PALETTE key. Returns the amount of paint laid (sum over slices
     of the share of each slice the new paint covers this step). */
  Coating.prototype.brush = function (t, pressure, brushKey, colorKey, dt) {
    var c = this.cfg, n = c.SEG, spec = BRUSHES[brushKey], paint = PALETTE[colorKey];
    if (!spec || !paint) return 0;
    var p = Math.min(1, Math.max(0, pressure));
    if (p < 0.02) return 0;
    var xc = Math.min(1, Math.max(0, t)) * (n - 1);
    var hwS = spec.halfWidth / this.dx;
    var lo = Math.max(c.END_MARGIN, Math.floor(xc - hwS));
    var hi = Math.min(n - 1 - c.END_MARGIN, Math.ceil(xc + hwS));
    var rate = c.BRUSH_FLOW * spec.flow * (c.FLOW_FLOOR + (1 - c.FLOW_FLOOR) * Math.pow(p, c.FLOW_EXP));
    var laid = 0, N = paint.rgb;
    for (var i = lo; i <= hi; i++) {
      var w = kernel(brushKey, Math.abs(i - xc) * this.dx);
      if (w <= 0) continue;
      var a = Math.min(1, rate * w * dt);          // how much of the new paint lands this step
      if (a < 1e-6) continue;
      // a slice already solid with paint still takes the new colour over the old one
      var old = this.coat[i], na = old + (1 - old) * a;
      // "over" compositing in premultiplied form: the new colour covers a bit, the old shows through
      for (var k = 0; k < 3; k++) {
        this.color[i * 3 + k] = (this.color[i * 3 + k] * old * (1 - a) + N[k] * a) / na;
      }
      this.coat[i] = na;
      laid += a;
    }
    if (laid > 0) this.version++;
    return laid;
  };

  /* One timestep of spraying finish. Returns the gloss added. */
  Coating.prototype.spray = function (t, pressure, dt) {
    var c = this.cfg, n = c.SEG;
    var p = Math.min(1, Math.max(0, pressure));
    if (p < 0.02) return 0;
    var xc = Math.min(1, Math.max(0, t)) * (n - 1);
    var hwS = SPRAY_HALF_WIDTH / this.dx;
    var lo = Math.max(c.END_MARGIN, Math.floor(xc - hwS));
    var hi = Math.min(n - 1 - c.END_MARGIN, Math.ceil(xc + hwS));
    var rate = c.SPRAY_RATE * (c.SPRAY_FLOOR + (1 - c.SPRAY_FLOOR) * p);
    var added = 0;
    for (var i = lo; i <= hi; i++) {
      var w = sprayKernel(Math.abs(i - xc) * this.dx);
      if (w <= 0) continue;
      var old = this.gloss[i], ng = old + (1 - old) * Math.min(1, rate * w * dt);
      if (ng - old < 1e-6) continue;
      this.gloss[i] = ng;
      added += ng - old;
    }
    if (added > 0) this.version++;
    return added;
  };

  /* Wood cut away takes its paint and finish with it. Call once per
     frame with the workpiece; it compares against the last radii seen. */
  Coating.prototype.syncWork = function (work) {
    var r = work.radius, n = this.cfg.SEG, last = this._lastR, changed = false;
    if (!this._haveR) { last.set(r); this._haveR = true; return false; }
    for (var i = 0; i < n; i++) {
      if (r[i] < last[i] - 1e-5) {
        if (this.coat[i] > 0 || this.gloss[i] > 0) {
          this.coat[i] = 0; this.gloss[i] = 0; this.color[i * 3] = this.color[i * 3 + 1] = this.color[i * 3 + 2] = 0;
          changed = true;
        }
      }
      last[i] = r[i];
    }
    if (changed) this.version++;
    return changed;
  };

  /* What slice i looks like: the wood with the coat over it. */
  Coating.prototype.shownColor = function (i, wood, out) {
    out = out || [0, 0, 0];
    var a = this.coat[i], w = wood || this.cfg.WOOD_RGB;
    for (var k = 0; k < 3; k++) out[k] = w[k] * (1 - a) + this.color[i * 3 + k] * a;
    return out;
  };
  Coating.prototype.coverage = function () {
    var s = 0, n = this.cfg.SEG;
    for (var i = 0; i < n; i++) s += this.coat[i];
    return s / n;
  };
  Coating.prototype.avgGloss = function () {
    var s = 0, n = this.cfg.SEG;
    for (var i = 0; i < n; i++) s += this.gloss[i];
    return s / n;
  };

  /* ---------------- specs ---------------- */
  function rng(seed) {                      // mulberry32: small, seedable, good enough
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, list, not) {
    var choices = list.filter(function (k) { return k !== not; });
    return choices[Math.floor(r() * choices.length)];
  }

  /* Generate a paint spec on the fly. Commissions call this (or build
     their own spec in the same shape). Same seed, same spec. */
  function generateSpec(seed, opts) {
    var r = rng(seed == null ? Math.floor(Math.random() * 4294967296) : seed);
    opts = opts || {};
    var kinds = ["solid", "banded", "dipped", "pinstripe", "twotone"];
    var kind = opts.kind || kinds[Math.floor(r() * kinds.length)];
    var c1 = pick(r, PALETTE_ORDER), c2 = pick(r, PALETTE_ORDER, c1), c3 = pick(r, PALETTE_ORDER, c2);
    var segs, name;
    if (kind === "solid") {
      segs = [{ a: 0, b: 1, paint: c1 }];
      name = "Solid " + PALETTE[c1].name;
    } else if (kind === "banded") {
      segs = [{ a: 0, b: 0.34, paint: c1 }, { a: 0.34, b: 0.66, paint: c2 }, { a: 0.66, b: 1, paint: c3 === c2 ? c1 : c3 }];
      name = "Three bands";
    } else if (kind === "dipped") {
      var cut = r() < 0.5 ? 0.3 : 0.7, left = cut < 0.5;
      segs = left ? [{ a: 0, b: cut, paint: c1 }, { a: cut, b: 1, paint: null }]
                  : [{ a: 0, b: cut, paint: null }, { a: cut, b: 1, paint: c1 }];
      name = "Dipped in " + PALETTE[c1].name;
    } else if (kind === "pinstripe") {
      segs = [
        { a: 0, b: 0.235, paint: c1 }, { a: 0.235, b: 0.265, paint: c2 }, { a: 0.265, b: 0.485, paint: c1 },
        { a: 0.485, b: 0.515, paint: c2 }, { a: 0.515, b: 0.735, paint: c1 }, { a: 0.735, b: 0.765, paint: c2 },
        { a: 0.765, b: 1, paint: c1 }
      ];
      name = PALETTE[c1].name + " with " + PALETTE[c2].name + " pinstripes";
    } else {
      segs = [{ a: 0, b: 0.5, paint: c1 }, { a: 0.5, b: 1, paint: c2 }];
      name = "Two tone";
    }
    var sheen = opts.sheen || SHEEN_ORDER[Math.floor(r() * SHEEN_ORDER.length)];
    return { name: name, kind: kind, segments: segs, sheen: sheen };
  }

  function specPaints(spec) {
    var seen = {}, out = [];
    spec.segments.forEach(function (s) { if (s.paint && !seen[s.paint]) { seen[s.paint] = true; out.push(s.paint); } });
    return out;
  }
  function describeSpec(spec) {
    var paints = specPaints(spec).map(function (k) { return PALETTE[k].name; });
    return spec.name + ". " + (paints.length ? paints.join(", ") + ". " : "Bare wood. ") + SHEEN[spec.sheen].name + " finish.";
  }
  function validSpec(spec) {
    if (!spec || typeof spec !== "object" || !Array.isArray(spec.segments) || !spec.segments.length) return false;
    if (!SHEEN[spec.sheen]) return false;
    var at = 0;
    for (var i = 0; i < spec.segments.length; i++) {
      var s = spec.segments[i];
      if (!s || !(s.a >= at - 1e-9) || !(s.b > s.a) || s.b > 1 + 1e-9) return false;
      if (s.paint != null && !PALETTE[s.paint]) return false;
      at = s.b;
    }
    return true;
  }

  /* The colour the spec wants at axial position t (RGB 0..1). */
  function targetAt(spec, t, wood) {
    for (var i = 0; i < spec.segments.length; i++) {
      var s = spec.segments[i];
      if (t >= s.a && (t < s.b || i === spec.segments.length - 1)) return s.paint ? PALETTE[s.paint].rgb : wood;
    }
    return wood;
  }
  /* Every colour the spec allows at t, with a little slack at band edges so a
     pinstripe a hair off still counts. */
  function targetsNear(spec, t, tol, wood) {
    var out = [];
    for (var i = 0; i < spec.segments.length; i++) {
      var s = spec.segments[i];
      if (t >= s.a - tol && t <= s.b + tol) out.push(s.paint ? PALETTE[s.paint].rgb : wood);
    }
    return out.length ? out : [wood];
  }
  function dist(a, b) {
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
  function smooth(e0, e1, x) {
    var u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return u * u * (3 - 2 * u);
  }

  /* Grade the paint job against a spec. Returns 0..1 scores:
     color (how much of the length is the right colour), finish
     (how close the sheen is), and total (colour counts most). */
  function matchSpec(spec, coating, wood, cfg) {
    cfg = cfg || CFG;
    wood = wood || cfg.WOOD_RGB;
    var n = cfg.SEG, m = cfg.END_MARGIN, sum = 0, cnt = 0, shown = [0, 0, 0];
    for (var i = m; i < n - m; i++) {
      var t = i / (n - 1);
      coating.shownColor(i, wood, shown);
      var best = Infinity, tg = targetsNear(spec, t, cfg.EDGE_TOL, wood);
      for (var k = 0; k < tg.length; k++) best = Math.min(best, dist(shown, tg[k]));
      sum += 1 - smooth(cfg.DIST_FULL, cfg.DIST_ZERO, best);
      cnt++;
    }
    var color = cnt ? sum / cnt : 0;
    var want = SHEEN[spec.sheen].gloss, have = coating.avgGloss();
    var finish = 1 - smooth(0.08, 0.5, Math.abs(have - want));
    return { color: color, finish: finish, total: 0.8 * color + 0.2 * finish, sheen: sheenFor(have) };
  }

  var api = {
    CFG: CFG, PALETTE: PALETTE, PALETTE_ORDER: PALETTE_ORDER, BRUSHES: BRUSHES, SHEEN: SHEEN, SHEEN_ORDER: SHEEN_ORDER,
    SPRAY_HALF_WIDTH: SPRAY_HALF_WIDTH,
    kernel: kernel, sprayKernel: sprayKernel, sheenFor: sheenFor,
    Coating: Coating, generateSpec: generateSpec, specPaints: specPaints, describeSpec: describeSpec,
    validSpec: validSpec, targetAt: targetAt, matchSpec: matchSpec, rng: rng
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var L = root.Lathe || (root.Lathe = {});
  L.Paint = api;
})(typeof window !== "undefined" ? window : globalThis);

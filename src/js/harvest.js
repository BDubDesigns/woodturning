/* ============================================================
   Harvest model: pure, renderer-free, testable in Node.

   Turns a grown tree into a lathe blank in three steps, each one
   driven by where the player's finger actually works:

   1. CHOP. The trunk is a column of slices. A swing from the side
      bites a notch into the slices under the finger. Depth comes
      from how far the finger travels into the wood, power from how
      fast it swings, and a rate cap keeps every bite smooth. Each
      swing can only add so much (CAP), so it takes a run of swings.
      When one slice is down to a thin hinge, the tree cracks and
      falls toward the side that was cut. The fall is a small rigid
      body simulation (hinge, kick off the stump, bounce, settle),
      not a tween.

   2. DELIMB. Branches are curves rising from the log. A blade
      swipe that crosses a branch cuts it right there; the outer
      part falls away and the stub left behind can be cut again.
      Thick branches take more than one swipe.

   3. SAW. Top-down on the log. Rubbing back and forth across the
      log deepens a kerf at the spot where you started; one long
      drag only counts for one stroke, so it takes real rubbing.
      Two cuts free the middle piece, which becomes the blank.

   World units: x runs left/right with the tree base at 0, y runs
   up from the ground. One unit is roughly the trunk's base width.
   ============================================================ */
(function (root) {
  "use strict";

  var H = {
    SLICES: 141,          // along the trunk
    TRUNK_H: 7.0,         // bare trunk height, ground to where the crown starts
    LEADER_H: 1.8,        // the crown leader above the trunk (about the longest tree's)
    CHOP_MIN: 0.55,       // choppable stretch of trunk
    CHOP_MAX: 3.4,
    HINGE: 0.2,           // fraction of the width that must stay to hold the tree up
    CAP: 0.16,            // deepest one swing can go beyond the notch it started from
    RATE: 5.0,            // world units per second a notch can deepen at full power
    SPEED_MIN: 1.2,       // slower than this (units/sec) only rests on the bark
    SPEED_FULL: 5.5,      // full-power swing speed
    NOTCH_HW0: 0.24,      // notch half height at zero depth
    NOTCH_HW_K: 0.55,     // wider the deeper it goes
    CRACK_TIME: 1.0,      // seconds of creaking before it lets go
    G: 16,                // gravity in world units/sec^2 (tuned to look right, not metres)
    RELEASE: 0.95,        // radians of lean at which the butt kicks off the stump
    GROUND: 0.45,         // height of the log's axis when it lies on the ground (about the butt's radius)
    RESTITUTION: 0.2,

    FLUSH: 0.16,          // a stub this short is flush with the log
    CLEAN: 0.32,          // ...and up to twice that still looks clean, so a stubborn short stub never blocks the saw
    DELIMB_SPEED: 6.0,    // finger speed (units/sec) for a full-power slash
    SLASH_POWER: 0.1,     // thickness one full slash removes

    SAW_END_MARGIN: 0.07, // cuts stay this fraction of the log away from the ends
    SAW_MIN_BLANK: 0.3,   // the middle piece is at least this fraction of the log
    SAW_GAIN: 0.095,      // kerf depth one log-width stroke adds
    SAW_STROKE_CAP: 1.15, // a stroke stops counting past this many log widths
    SAW_REVERSE: 0.1      // log widths of back-travel that start a new stroke
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- the tree ----------------
     A tree is data. TREES says what each wood grows into: how the trunk
     tapers and flares, how the branches are laid out (where they start, how
     far apart, how steeply they leave the trunk, how long and thick, how they
     shorten toward the top), and how the twigs and leaves are laid along them.
     makeTree(seed, wood) rolls one tree from that data and the seed. Colours
     and leaf style come from the farm's wood data (Game.Farm.WOODS: trunk, leaf,
     leaf2, shape), looked up by the same wood id, so a new tree is a new entry
     in each, and neither the model nor the renderer changes.

     Ranges are [min, max]. Angles are radians off the trunk's axis (0 is
     straight up, about 1.57 is level). Heights run up the bare trunk, which is
     always TRUNK_H tall, because the chop model (and so how long a log you get)
     does not depend on the kind of tree. */
  var TREES = {
    // a conifer: slim, straight, strongly tapering, many short level boughs, narrow at the top
    pine: {
      baseW: [0.7, 0.8], topW: [0.32, 0.38], taper: 1.0, flare: 0.1, spire: 1.5,
      branch: { first: [2.0, 2.2], gap: [0.34, 0.44], top: 0.2, a0: [1.35, 1.6], a0Rise: 0.05, a1: [1.08, 1.25],
                len: 2.5, lenFall: 1.9, lenJit: 0.25, thick: 0.1, thickFall: 0.04, thickJit: 0.02 },
      leader: { len: 2.0, thick: 0.14 },
      foliage: { twigs: [6, 8], twigLen: [0.4, 0.75], spread: [0.35, 0.9], upward: 0.02, dens: 1.3, densRise: 0.2, size: 0.11, sizeRise: 0, leaderTwigs: 8,
                 canopy: "needles", tuft: 0.46 }
    },
    // a spreading hardwood: broad trunk, long limbs leaving at a wide angle, a round crown
    oak: {
      baseW: [1.32, 1.48], topW: [0.84, 0.92], taper: 1.3, flare: 0.2, spire: 1.5,
      branch: { first: [2.2, 2.45], gap: [0.55, 0.75], top: 0.5, a0: [0.85, 1.2], a0Rise: -0.35, a1: [0.55, 0.7],
                len: 1.95, lenFall: 0.9, lenJit: 0.35, thick: 0.17, thickFall: 0.07, thickJit: 0.03 },
      leader: { len: 1.6, thick: 0.24 },
      foliage: { twigs: [4, 6], twigLen: [0.4, 0.8], spread: [0.5, 1.0], upward: 0.16, dens: 0.95, densRise: 0.5, size: 0.15, sizeRise: 0.03, leaderTwigs: 7,
                 canopy: "clumps", mass: 0.62, massRise: 0.1, crown: 1.5 }
    },
    // a stout hardwood: the thickest trunk, fewer heavier limbs, rising more steeply, a full crown
    walnut: {
      baseW: [1.46, 1.6], topW: [0.94, 1.04], taper: 1.15, flare: 0.28, spire: 1.5,
      branch: { first: [2.1, 2.35], gap: [0.7, 0.95], top: 0.6, a0: [0.6, 0.95], a0Rise: -0.2, a1: [0.5, 0.75],
                len: 2.1, lenFall: 1.0, lenJit: 0.4, thick: 0.22, thickFall: 0.09, thickJit: 0.03 },
      leader: { len: 1.5, thick: 0.26 },
      foliage: { twigs: [4, 5], twigLen: [0.5, 0.9], spread: [0.45, 0.85], upward: 0.2, dens: 1.1, densRise: 0.4, size: 0.17, sizeRise: 0.03, leaderTwigs: 7,
                 canopy: "clumps", mass: 0.7, massRise: 0.1, crown: 1.6 }
    }
  };
  var DEFAULT_WOOD = "oak";
  function treeType(wood) { return TREES[wood] || TREES[DEFAULT_WOOD]; }

  /* The trunk tapers gently up the bole, then (over the last `spire` units,
     inside the crown) narrows hard into the leader, so trunk and leader read as
     one stem running to a point instead of a pole with a flat top. */
  function trunkWidth(tree, h) {
    var f = clamp(h / H.TRUNK_H, 0, 1);
    var w = tree.baseW + (tree.topW - tree.baseW) * Math.pow(f, tree.taper);
    if (tree.spire && tree.tipW) {
      var z = clamp((h - (H.TRUNK_H - tree.spire)) / tree.spire, 0, 1);
      w += (tree.tipW - w) * z * z * (3 - 2 * z);
    }
    return w + tree.flare * Math.exp(-h * 3.2);       // root flare
  }

  /* A branch curve in its own frame: p out from the trunk, q up along it.
     Starts a little inside the trunk surface so the join is hidden. */
  function branchCurve(b) {
    var n = 7, pts = [], p = b.p0, q = 0, seg = b.len / (n - 1), s = 0;
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      pts.push({ p: p, q: q, s: s });
      var a = b.a0 + (b.a1 - b.a0) * t;
      p += Math.sin(a) * seg; q += Math.cos(a) * seg; s += seg;
    }
    return pts;
  }
  function branchThick(b, s) { return b.t0 * (1 - (b.taper || 0.72) * clamp(s / b.len, 0, 1)); }

  function makeTree(seed, wood) {
    var kind = TREES[wood] ? wood : DEFAULT_WOOD, T = TREES[kind];
    var r = rng(seed == null ? 1 : seed);
    function pick(range) { return range[0] + r() * (range[1] - range[0]); }
    var tree = {
      seed: seed == null ? 1 : seed, wood: kind, type: T,
      baseW: pick(T.baseW), topW: pick(T.topW), taper: T.taper, flare: T.flare,
      spire: T.spire || 0, tipW: T.leader.thick,
      branches: [], dirBias: r() < 0.5 ? -1 : 1
    };
    var B = T.branch, side = r() < 0.5 ? -1 : 1, y = pick(B.first), id = 0;
    while (y < H.TRUNK_H - B.top) {
      var f = y / H.TRUNK_H;                          // 0 low .. 1 high
      var b = {
        id: id++, y: y, s: side,
        a0: pick(B.a0) + B.a0Rise * f, len: B.len - B.lenFall * f + r() * B.lenJit,
        t0: B.thick - B.thickFall * f + r() * B.thickJit,
        leader: false
      };
      b.a1 = b.a0 * pick(B.a1);
      b.p0 = trunkWidth(tree, y) * 0.35;
      tree.branches.push(b);
      side = -side;
      y += pick(B.gap);
    }
    // the leader: the trunk carries on into the crown
    var ld = {
      id: id++, y: H.TRUNK_H, s: 1, a0: 0.1, a1: 0.04, len: T.leader.len,
      t0: T.leader.thick, leader: true, p0: 0, taper: 0.93      // runs out to a point
    };
    tree.branches.push(ld);
    for (var i = 0; i < tree.branches.length; i++) tree.branches[i].pts = branchCurve(tree.branches[i]);
    return tree;
  }

  /* ---------------- the trunk: notches cut into it ---------------- */
  function Trunk(tree) {
    this.tree = tree;
    var n = H.SLICES;
    this.n = n;
    this.dh = H.TRUNK_H / (n - 1);
    this.W = new Float32Array(n);
    this.left = new Float32Array(n);      // depth of the notch cut from the left edge
    this.right = new Float32Array(n);
    for (var i = 0; i < n; i++) this.W[i] = trunkWidth(tree, i * this.dh);
  }
  Trunk.prototype.sliceAt = function (h) { return clamp(Math.round(h / this.dh), 0, this.n - 1); };
  Trunk.prototype.widthAt = function (h) {
    var x = clamp(h / this.dh, 0, this.n - 1), i = Math.min(this.n - 2, Math.floor(x)), f = x - i;
    return this.W[i] * (1 - f) + this.W[i + 1] * f;
  };
  /* The slice that is closest to being cut through, among choppable slices. */
  Trunk.prototype.weakest = function () {
    var lo = this.sliceAt(H.CHOP_MIN), hi = this.sliceAt(H.CHOP_MAX), best = 1e9, bi = lo;
    for (var i = lo; i <= hi; i++) {
      var slack = this.W[i] * (1 - H.HINGE) - this.left[i] - this.right[i];
      if (slack < best) { best = slack; bi = i; }
    }
    return { i: bi, slack: best, h: bi * this.dh };
  };
  Trunk.prototype.remaining = function (i) { return this.W[i] - this.left[i] - this.right[i]; };
  /* How far through the tree the weakest spot is, 0 uncut .. 1 cracking. */
  Trunk.prototype.progress = function () {
    var wk = this.weakest(), i = wk.i;
    var total = this.W[i] * (1 - H.HINGE);
    return clamp(1 - wk.slack / total, 0, 1);
  };

  /* ---------------- the felled log ---------------- */
  /* Everything in the log frame: u along the log from the cut end, v up from the axis. */
  function Log(tree, trunk, hStar, dir) {
    this.tree = tree; this.trunk = trunk; this.hStar = hStar; this.dir = dir;
    this.len = H.TRUNK_H - hStar;
  }
  Log.prototype.radiusAt = function (u) {
    var h = clamp(this.hStar + u * 1, 0, H.TRUNK_H);
    return this.trunk.widthAt(h) * 0.5;
  };

  /* ---------------- the fall, as a rigid body ----------------
     Simulated for a tree falling to the right (dir +1) about the
     hinge at (0, hStar); mirrored for the left. Returns frames of
     the butt end position and lean so the view can play it back. */
  function simulateFall(hStar) {
    var Lr = H.TRUNK_H + H.LEADER_H - hStar;         // trunk plus crown leader
    var g = H.G, lc = 0.5 * Lr, I = Lr * Lr / 12, dt = 1 / 240;
    var frames = [], events = [];
    var th = 0.07, w = 0.35, t = 0, gl = H.GROUND, lastThud = -1;
    var push = function (bx, by, phi) { frames.push({ t: t, bx: bx, by: by, phi: phi }); };

    while (th < H.RELEASE && t < 6) {                   // hinged on the stump
      w += (1.5 * g / Lr) * Math.sin(th) * dt; th += w * dt; t += dt;
      push(0, hStar, th);
    }
    events.push({ t: t, type: "release" });
    // free body: state at the centre of mass, y up, positive omega = counter-clockwise
    var cx = lc * Math.sin(th), cy = hStar + lc * Math.cos(th);
    var vx = lc * w * Math.cos(th), vy = -lc * w * Math.sin(th);
    var om = -w, phi = th, landed = false, rest = false, bounces = 0;
    while (!rest && t < 8) {
      vy -= g * dt; cx += vx * dt; cy += vy * dt; phi += -om * dt; t += dt;
      var ends = [-1, 1], hit = false, k;
      for (k = 0; k < 2; k++) {
        var sgn = ends[k];
        var ex = cx + sgn * lc * Math.sin(phi), ey = cy + sgn * lc * Math.cos(phi);
        if (ey < gl) {
          hit = true;
          cy += gl - ey; ey = gl;
          var rx = ex - cx, vn = vy + om * rx;
          if (vn < 0) {
            var e = -vn > 1.2 ? H.RESTITUTION : 0;
            var j = -(1 + e) * vn / (1 + rx * rx / I);
            vy += j; om += rx * j / I;
            if (-vn > 1.0) {
              if (t - lastThud > 0.12) {
                events.push({ t: t, type: "thud", power: clamp(-vn / 9, 0.15, 1), x: ex, end: sgn });
                lastThud = t;
              }
              bounces++;
              if (!landed) { landed = true; events.push({ t: t, type: "land" }); }
            }
          }
        }
      }
      if (hit) { vx *= 1 - 3.2 * dt; om *= 1 - 2.2 * dt; }
      // bottom end: B = C - lc*(sin, cos)
      push(cx - lc * Math.sin(phi), cy - lc * Math.cos(phi), phi);
      var lowB = cy - lc * Math.cos(phi) - gl, lowT = cy + lc * Math.cos(phi) - gl;
      if (landed && Math.abs(vy) < 0.25 && Math.abs(om) < 0.25 && Math.abs(vx) < 0.4 &&
          Math.abs(lowB) < 0.05 && Math.abs(lowT) < 0.05) rest = true;
    }
    var last = frames[frames.length - 1];
    // settle flat: the body rests with both ends on the ground, lying along x
    var fx = last.bx, flat = { t: t, bx: fx, by: gl, phi: Math.PI / 2 };
    // short blend into the exact resting pose so nothing pops
    var from = last, blendT = 0.18, steps = 20;
    for (var s = 1; s <= steps; s++) {
      var f = s / steps; f = f * f * (3 - 2 * f);
      frames.push({
        t: t + blendT * s / steps, bx: from.bx + (flat.bx - from.bx) * f,
        by: from.by + (flat.by - from.by) * f, phi: from.phi + (flat.phi - from.phi) * f
      });
    }
    t += blendT;
    return { frames: frames, events: events, duration: t, Lr: Lr, finalBx: fx, bounces: bounces };
  }

  /* ---------------- the harvest game ---------------- */
  function Harvest(seed, wood) {
    this.events = [];
    this.reset(seed, wood);
  }

  /* A new tree of the given wood (pine, oak, walnut; anything else grows as oak). */
  Harvest.prototype.reset = function (seed, wood) {
    this.seed = seed == null ? Math.floor(Math.random() * 1e9) : seed;
    this.wood = TREES[wood] ? wood : (TREES[this.wood] ? this.wood : DEFAULT_WOOD);
    this.tree = makeTree(this.seed, this.wood);
    this.trunk = new Trunk(this.tree);
    this.phase = "chop";        // chop | crack | fall | delimb | saw | done
    this.swings = 0;
    this.stroke = null;
    this.crackT = 0; this.crackLean = 0; this.dir = 0; this.hStar = 0;
    this.fall = null; this.fallT = 0; this.body = null;
    this.log = null; this.limbs = []; this.pieces = []; this.sawKerfs = [];
    this.saw = null; this.blank = null; this.shudder = 0;
    this.events.length = 0;
    this.version = 0;
  };
  Harvest.prototype.emit = function (e) { this.events.push(e); };
  Harvest.prototype.drain = function () { var e = this.events; this.events = []; return e; };

  /* ----- input: one entry point per phase. Chop and delimb take world
     (x, y); saw takes the log frame (u along the log, v across it). ----- */
  Harvest.prototype.pointerDown = function (x, y, t) {
    if (this.phase === "chop") this._chopDown(x, y, t);
    else if (this.phase === "delimb") this.stroke = { x: x, y: y, t: t, spd: 0 };
    else if (this.phase === "saw") this._sawDown(x, y, t);
  };
  Harvest.prototype.pointerMove = function (x, y, t) {
    if (this.phase === "chop") this._chopMove(x, y, t);
    else if (this.phase === "delimb") this._delimbMove(x, y, t);
    else if (this.phase === "saw") this._sawMove(x, y, t);
  };
  Harvest.prototype.pointerUp = function () {
    if (this.phase === "saw") this._sawUp();
    this.stroke = null;
  };

  /* ----- chop ----- */
  Harvest.prototype._chopDown = function (x, y, t) {
    var tr = this.trunk, side = x < 0 ? -1 : 1;
    var arr = side < 0 ? tr.left : tr.right;
    this.stroke = {
      side: side, x: x, y: y, t: t, spd: 0, hit: false,
      ref: new Float32Array(arr), swing: false
    };
  };
  Harvest.prototype._chopMove = function (x, y, t) {
    var s = this.stroke;
    if (!s) return;
    var dt = Math.max(3e-3, t - s.t), dx = x - s.x;
    var inward = s.side < 0 ? dx / dt : -dx / dt;
    s.spd += (inward - s.spd) * Math.min(1, dt * 22);        // light smoothing
    var px = s.x, py = s.y;
    s.x = x; s.y = y; s.t = t;
    var tr = this.trunk;
    if (y < H.CHOP_MIN || y > H.CHOP_MAX) {
      // not a place the tree can be chopped: the crown just rustles
      if (inward > H.SPEED_MIN && Math.abs(x) < 1.6) this.emit({ type: "rustle", x: x, y: y, power: clamp(inward / H.SPEED_FULL, 0.2, 1) });
      return;
    }
    var sf = clamp((s.spd - H.SPEED_MIN) / (H.SPEED_FULL - H.SPEED_MIN), 0, 1);
    if (sf <= 0) return;
    var Wc = tr.widthAt(y), edge = s.side * Wc * 0.5;
    var pen = s.side < 0 ? x - edge : edge - x;          // how far past the bark the finger is
    if (pen <= 0.005) return;
    var arr = s.side < 0 ? tr.left : tr.right, oth = s.side < 0 ? tr.right : tr.left;
    var ic = tr.sliceAt(y);
    var T = Math.min(pen, s.ref[ic] + H.CAP);
    var hw = H.NOTCH_HW0 + H.NOTCH_HW_K * T;
    var lo = Math.max(tr.sliceAt(H.CHOP_MIN), Math.floor((y - hw) / tr.dh));
    var hi = Math.min(tr.sliceAt(H.CHOP_MAX), Math.ceil((y + hw) / tr.dh));
    var removed = 0, step = H.RATE * sf * dt;
    for (var i = lo; i <= hi; i++) {
      var u = Math.abs(i * tr.dh - y) / hw;
      if (u >= 1) continue;
      var c = Math.cos(u * Math.PI * 0.5), w = c * c;
      var cap = tr.W[i] * (1 - H.HINGE) - oth[i];
      var tgt = Math.min(cap, Math.max(s.ref[i], w * T));
      if (tgt > arr[i]) {
        var nd = Math.min(tgt, arr[i] + step * (0.3 + 0.7 * w));
        removed += nd - arr[i]; arr[i] = nd;
      }
    }
    if (removed > 1e-5) {
      if (!s.hit) {                                     // the bite: once per swing
        s.hit = true; this.swings++;
        this.emit({ type: "thunk", x: edge, y: y, side: s.side, power: sf });
      }
      this.emit({ type: "chips", x: edge + s.side * 0.0, y: y, side: s.side, amount: removed, power: sf });
      this.shudder = Math.min(1, this.shudder + removed * 3);
      this.version++;
      this._checkCrack();
    }
  };
  Harvest.prototype._checkCrack = function () {
    var wk = this.trunk.weakest();
    if (wk.slack > 0.004) return;
    var tr = this.trunk, i = wk.i, L = tr.left[i], R = tr.right[i];
    this.hStar = wk.h;
    this.dir = Math.abs(L - R) < 0.03 ? this.tree.dirBias : (L > R ? -1 : 1);   // falls the way you cut
    for (var b = 0; b < this.tree.branches.length; b++) if (this.tree.branches[b].leader) this.tree.branches[b].s = -this.dir;   // the leader lies along the log, up
    this.phase = "crack"; this.crackT = 0; this.stroke = null;
    this.emit({ type: "crack", stage: 0, dir: this.dir });
  };

  /* ----- crack, fall ----- */
  Harvest.prototype.step = function (dt) {
    this.shudder = Math.max(0, this.shudder - dt * 2.2);
    var i, p;
    if (this.phase === "crack") {
      var prev = this.crackT;
      this.crackT += dt;
      this.crackLean = 0.07 * Math.min(1, this.crackT / H.CRACK_TIME);
      if (prev < 0.35 && this.crackT >= 0.35) this.emit({ type: "crack", stage: 1, dir: this.dir });
      if (prev < 0.7 && this.crackT >= 0.7) this.emit({ type: "crack", stage: 2, dir: this.dir });
      if (this.crackT >= H.CRACK_TIME) {
        this.fall = simulateFall(this.hStar);
        this.fallT = 0; this.phase = "fall"; this.fallEv = 0;
        this.emit({ type: "release", dir: this.dir });
      }
    } else if (this.phase === "fall") {
      this.fallT += dt;
      var F = this.fall, tt = Math.min(this.fallT, F.duration);
      var fr = F.frames, lo = 0, hi = fr.length - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (fr[mid].t <= tt) lo = mid; else hi = mid; }
      var a = fr[lo], b = fr[Math.min(fr.length - 1, lo + 1)];
      var k = b.t > a.t ? clamp((tt - a.t) / (b.t - a.t), 0, 1) : 0;
      this.body = {
        bx: (a.bx + (b.bx - a.bx) * k) * this.dir, by: a.by + (b.by - a.by) * k,
        phi: a.phi + (b.phi - a.phi) * k, dir: this.dir
      };
      while (this.fallEv < F.events.length && F.events[this.fallEv].t <= tt) {
        var ev = F.events[this.fallEv++];
        if (ev.type === "thud") this.emit({ type: "thud", power: ev.power, x: ev.x * this.dir });
        if (ev.type === "land") this._snapUnderside();
      }
      if (this.fallT >= F.duration) this._landed();
    } else if (this.phase === "delimb") {
      this._stepPieces(dt);
    } else if (this.phase === "saw") {
      this._stepPieces(dt);
      this._stepSaw(dt);
    }
    if (this.phase === "done") this._stepPieces(dt);
  };

  /* Branches under the log are crushed in the landing. */
  Harvest.prototype._snapUnderside = function () {
    var br = this.tree.branches, n = 0;
    for (var i = 0; i < br.length; i++) {
      var b = br[i];
      if (b.y < this.hStar) continue;
      if (!b.leader && b.s * this.dir !== -1) { b.crushed = true; n++; }
    }
    if (n) this.emit({ type: "snap", count: n });
  };

  Harvest.prototype._landed = function () {
    var dir = this.dir, hStar = this.hStar;
    this.log = new Log(this.tree, this.trunk, hStar, dir);
    var bx = this.fall.finalBx * dir;
    this.log.bx = bx; this.log.by = H.GROUND;
    this.limbs = [];
    var br = this.tree.branches;
    for (var i = 0; i < br.length; i++) {
      var b = br[i];
      if (b.y < hStar || b.crushed) continue;
      var u0 = b.y - hStar, wp = [];
      for (var k = 0; k < b.pts.length; k++) {
        var pt = b.pts[k];
        // the leader carries on along the log's axis; the rest rise from its upper side
        wp.push({ x: bx + dir * (u0 + pt.q), y: H.GROUND + pt.p, s: pt.s });
      }
      this.limbs.push({
        id: b.id, b: b, wp: wp, stub: b.len, dmg: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        alive: true
      });
    }
    this.phase = "delimb"; this.body = null;
    this.emit({ type: "landed", limbs: this.limbs.length });
  };

  /* ----- delimb ----- */
  /* One definition of "clean", used by the counter and the phase gate alike:
     a limb is done once what is left of it is no longer than CLEAN. */
  Harvest.prototype.limbClean = function (L) { return L.stub <= H.CLEAN; };
  Harvest.prototype.limbsLeft = function () {
    var n = 0;
    for (var i = 0; i < this.limbs.length; i++) if (!this.limbClean(this.limbs[i])) n++;
    return n;
  };
  /* Does the swipe segment P0->P1 cross the branch segment A->B? Decided by which
     side of the branch each end of the swipe is on, with a point exactly on the
     line counting as one side, so a pointer sample landing right on a branch
     is a crossing for exactly one of the two swipe segments that meet there. */
  function segCross(p0x, p0y, p1x, p1y, ax, ay, bx, by) {
    var ex = bx - ax, ey = by - ay;
    var d0 = ex * (p0y - ay) - ey * (p0x - ax), d1 = ex * (p1y - ay) - ey * (p1x - ax);
    if ((d0 > 0) === (d1 > 0)) return null;
    var tt = d0 / (d0 - d1);
    var qx = p0x + (p1x - p0x) * tt, qy = p0y + (p1y - p0y) * tt;
    var uu = ((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey);
    if (uu < 0 || uu > 1) return null;
    return { t: tt, u: uu };
  }
  Harvest.prototype._delimbMove = function (x, y, t) {
    var s = this.stroke;
    if (!s) return;
    var dt = Math.max(3e-3, t - s.t);
    var ax = s.x, ay = s.y, dist = Math.sqrt((x - ax) * (x - ax) + (y - ay) * (y - ay));
    var spd = dist / dt;
    s.spd += (spd - s.spd) * Math.min(1, dt * 22);
    s.x = x; s.y = y; s.t = t;
    if (dist < 1e-5) return;
    var power = clamp(s.spd / H.DELIMB_SPEED, 0.4, 1.2) * H.SLASH_POWER;
    for (var i = 0; i < this.limbs.length; i++) {
      var L = this.limbs[i];
      if (!L.alive) continue;
      for (var k = 0; k < L.wp.length - 1; k++) {
        var A = L.wp[k], B = L.wp[k + 1];
        if (A.s >= L.stub) break;
        var c = segCross(ax, ay, x, y, A.x, A.y, B.x, B.y);
        if (!c) continue;
        var arc = A.s + (B.s - A.s) * c.u;
        if (arc >= L.stub - 0.01) continue;
        // Any swipe that crosses the branch cuts it. A shallow crossing (a swipe
        // that runs almost along the branch, like a horizontal swipe over the leader
        // lying along the log) still cuts, just a little less cleanly.
        var bdx = B.x - A.x, bdy = B.y - A.y, bl = Math.sqrt(bdx * bdx + bdy * bdy) || 1;
        var across = Math.abs((x - ax) * bdy - (y - ay) * bdx) / (dist * bl);
        this._hitLimb(L, arc, power * (0.6 + 0.4 * Math.min(1, across / 0.5)), ax + (x - ax) * c.t, ay + (y - ay) * c.t);
        break;
      }
    }
  };
  Harvest.prototype._hitLimb = function (L, arc, power, hx, hy) {
    var bin = Math.min(L.dmg.length - 1, Math.floor(arc / (L.b.len / L.dmg.length)));
    L.dmg[bin] += power;
    if (bin > 0) L.dmg[bin - 1] += power * 0.4;
    if (bin < L.dmg.length - 1) L.dmg[bin + 1] += power * 0.4;
    var need = branchThick(L.b, arc);
    this.emit({ type: "slash", x: hx, y: hy, id: L.id, power: power / H.SLASH_POWER });
    if (L.dmg[bin] < need) return;
    // cut through: everything past arc comes away
    var piece = { id: L.id, b: L.b, from: arc, pts: [], x: 0, y: 0, rot: 0, vx: 0, vy: 0, vr: 0, age: 0, leaf: true };
    var wp = L.wp, k, X, Y;
    var cutPt = this._pointAt(L, arc);
    piece.ox = cutPt.x; piece.oy = cutPt.y; piece.ox0 = cutPt.x; piece.oy0 = cutPt.y;
    for (k = 0; k < wp.length; k++) {
      if (wp[k].s <= arc) continue;
      piece.pts.push({ x: wp[k].x - cutPt.x, y: wp[k].y - cutPt.y, s: wp[k].s });
    }
    piece.pts.unshift({ x: 0, y: 0, s: arc });
    var dirx = wp[wp.length - 1].x - cutPt.x;
    piece.vx = (dirx >= 0 ? 1 : -1) * (0.6 + Math.random() * 0.9);
    piece.vy = 1.2 + Math.random() * 1.0;
    piece.vr = (dirx >= 0 ? 1 : -1) * (1.2 + Math.random() * 1.6);
    this.pieces.push(piece);
    L.stub = arc;
    for (var d = 0; d < L.dmg.length; d++) L.dmg[d] = 0;
    var clean = this.limbClean(L);
    L.alive = !clean;
    this.version++;
    this.emit({ type: "snip", x: hx, y: hy, id: L.id, clean: clean, left: this.limbsLeft() });
    if (this.limbsLeft() === 0) {
      this.phase = "saw"; this._initSaw();
      this.emit({ type: "cleaned" });
    }
  };
  Harvest.prototype._pointAt = function (L, arc) {
    var wp = L.wp;
    for (var k = 0; k < wp.length - 1; k++) {
      if (arc <= wp[k + 1].s) {
        var f = (arc - wp[k].s) / (wp[k + 1].s - wp[k].s || 1);
        return { x: wp[k].x + (wp[k + 1].x - wp[k].x) * f, y: wp[k].y + (wp[k + 1].y - wp[k].y) * f };
      }
    }
    return { x: wp[wp.length - 1].x, y: wp[wp.length - 1].y };
  };
  Harvest.prototype._stepPieces = function (dt) {
    for (var i = this.pieces.length - 1; i >= 0; i--) {
      var p = this.pieces[i];
      p.age += dt;
      p.vy -= H.G * 0.5 * dt;
      p.ox += p.vx * dt; p.oy += p.vy * dt; p.rot += p.vr * dt;
      if (p.oy < 0.12) { p.oy = 0.12; p.vy = 0; p.vx *= 0.8; p.vr *= 0.8; }
      if (p.age > 2.2) this.pieces.splice(i, 1);
    }
  };

  /* ----- saw ----- */
  Harvest.prototype._initSaw = function () {
    this.saw = { active: null, kerfs: [], start: 0, ext: 0, dirSign: 0, counted: 0, refused: false };
    this.sawKerfs = this.saw.kerfs;
  };
  Harvest.prototype.sawCheck = function (u) {
    var Ln = this.log.len, f = u / Ln;
    if (f < H.SAW_END_MARGIN || f > 1 - H.SAW_END_MARGIN) return "end";
    var ks = this.saw.kerfs;
    for (var i = 0; i < ks.length; i++) {
      if (ks[i].done && Math.abs(ks[i].u / Ln - f) < H.SAW_MIN_BLANK) return "close";
    }
    return null;
  };
  Harvest.prototype._sawDown = function (u, v, t) {
    var sw = this.saw, ks = sw.kerfs, Ln = this.log.len, i, k = null;
    sw.dirSign = 0; sw.counted = 0; sw.refused = false; sw.active = null;
    for (i = 0; i < ks.length; i++) if (!ks[i].done && Math.abs(ks[i].u - u) < 0.28) k = ks[i];
    if (!k) {
      var why = this.sawCheck(u);
      if (why) { sw.refused = true; this.emit({ type: "refuse", why: why }); return; }
      if (ks.length >= 2) {                              // a third start drops the shallowest unfinished one
        var drop = -1;
        for (i = 0; i < ks.length; i++) if (!ks[i].done && (drop < 0 || ks[i].prog < ks[drop].prog)) drop = i;
        if (drop < 0) { sw.refused = true; return; }
        ks.splice(drop, 1);
      }
      k = { u: u, prog: 0, shown: 0, done: false, gap: 0 };
      ks.push(k);
    }
    sw.active = k;
    sw.start = sw.ext = v / (this.log.radiusAt(k.u) * 2);
  };
  Harvest.prototype._sawMove = function (u, v, t) {
    var sw = this.saw, k = sw && sw.active;
    if (!k || k.done) return;
    var pos = v / (this.log.radiusAt(k.u) * 2);          // across the log, in log widths
    if (sw.dirSign === 0) {
      if (pos === sw.start) return;
      sw.dirSign = pos > sw.start ? 1 : -1; sw.ext = sw.start;
    }
    if ((pos - sw.ext) * sw.dirSign > 0) sw.ext = pos;   // still travelling the same way
    else if ((sw.ext - pos) * sw.dirSign > H.SAW_REVERSE) {   // real back stroke: a new stroke begins
      sw.dirSign = -sw.dirSign; sw.start = sw.ext; sw.ext = pos; sw.counted = 0;
    }
    var counted = Math.min(Math.abs(sw.ext - sw.start), H.SAW_STROKE_CAP);
    var add = (counted - sw.counted) * H.SAW_GAIN;
    if (add > 0) {
      sw.counted = counted;
      k.prog = Math.min(1, k.prog + add);
      this.emit({ type: "sawdust", u: k.u, v: v, amount: add, dir: sw.dirSign });
      if (k.prog >= 1 && !k.done) this._finishKerf(k);
    }
  };
  Harvest.prototype._sawUp = function () {
    if (this.saw) { this.saw.active = null; this.saw.dirSign = 0; this.saw.counted = 0; }
  };
  Harvest.prototype._finishKerf = function (k) {
    k.done = true; k.prog = 1;
    var done = 0;
    for (var i = 0; i < this.saw.kerfs.length; i++) if (this.saw.kerfs[i].done) done++;
    this.emit({ type: "kerf", u: k.u, done: done });
    if (done >= 2) {
      var ks = this.saw.kerfs.slice().sort(function (a, b) { return a.u - b.u; });
      this.blank = makeBlank(this.log, ks[0].u, ks[1].u);
      this.phase = "done";
      this.saw.active = null;
      this.emit({ type: "blank", blank: this.blank });
    }
  };
  Harvest.prototype._stepSaw = function (dt) {
    var ks = this.saw.kerfs;
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i];
      k.shown += (k.prog - k.shown) * (1 - Math.exp(-dt / 0.06));
      if (k.done) k.gap = Math.min(1, k.gap + dt * 3);
    }
  };

  /* ---------------- the blank ----------------
     The middle piece of the log, as a radius profile the lathe can
     load: SEG radii at most R0, in the log's own proportions. The
     piece is as thick as the log is there, taper and all, rescaled
     so its widest point fills the lathe's blank. Where a branch
     stub was cut there is a faint knot. */
  function makeBlank(log, u1, u2, seg, R0) {
    seg = seg || 240; R0 = R0 || 1.05;
    var prof = new Float32Array(seg), i, mx = 0, rr = new Float32Array(seg);
    var lenU = u2 - u1;
    for (i = 0; i < seg; i++) {
      var u = u1 + (i / (seg - 1)) * lenU;
      rr[i] = log.radiusAt(u);
      if (rr[i] > mx) mx = rr[i];
    }
    var knots = [], br = log.tree.branches;
    for (i = 0; i < br.length; i++) {
      var b = br[i];
      if (b.leader || b.y < log.hStar) continue;
      var uu = b.y - log.hStar;
      if (uu > u1 && uu < u2) knots.push((uu - u1) / lenU);
    }
    for (i = 0; i < seg; i++) {
      var t = i / (seg - 1), end = Math.min(t, 1 - t) * 2;
      var chamfer = 0.9 + 0.1 * Math.min(1, end * 5);
      var kn = 0;
      for (var j = 0; j < knots.length; j++) {
        var d = (t - knots[j]) / 0.012;
        kn = Math.max(kn, Math.exp(-d * d));
      }
      prof[i] = R0 * chamfer * (0.965 * (rr[i] / mx) + 0.02 * kn);
    }
    return {
      species: log.tree.wood,
      seed: log.tree.seed,
      profile: prof,
      lengthUnits: lenU,
      lengthRatio: lenU / log.len,
      girthUnits: mx * 2
    };
  }

  var api = {
    HCFG: H, makeTree: makeTree, Trunk: Trunk, Harvest: Harvest, Log: Log,
    simulateFall: simulateFall, makeBlank: makeBlank, trunkWidth: trunkWidth,
    branchThick: branchThick, branchCurve: branchCurve, TREES: TREES, treeType: treeType
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  var L = root.Lathe || (root.Lathe = {});
  for (var key in api) L[key] = api[key];
})(typeof window !== "undefined" ? window : globalThis);

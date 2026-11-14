/* ============================================================
   Haptics: the only place in the game that touches vibration.
   Everything else calls this module and never navigator.vibrate.

     Haptics.supported()          false where there is no way to vibrate (iPhone browsers)
     Haptics.enabled() / setEnabled(bool)   the Settings switch, saved in the profile
     Haptics.cut(level)           every frame while cutting; level 0..1. 0 = stop
     Haptics.sand(level)          every frame while the pad is on the wood; level = how rough the spot is
     Haptics.stop()               stop now
     Haptics.pulse(name)          a one-off: "catch", "done", "stars3"

   SWAP POINT FOR CAPACITOR (Slice 7, not now): this browser backend can
   only switch the motor on or off, so strength comes from how dense the
   pulses are. Capacitor's haptics plugin gives real strength control on
   Android and iPhone: replace send() / patternFor() below with the
   plugin's calls (cut and sand set the intensity of one continuous
   effect, pulse plays an impact pattern), and no game code changes.
   ============================================================ */
(function (root) {
  "use strict";

  /* ---------- every tuning number, in one place (feel them on a real phone) ----------
     The motor can only be on or off, so "strength" is two things: how long each pulse is
     (a very short one barely spins the motor up, so it feels soft) and how long the gap
     between pulses is. The pulse grows in a straight line with the level; the gap follows
     a curve (CURVE). */
  var CFG = {
    CUT: {                 // cutting: level = pressure x RPM (a hard press at 2400 RPM is 1)
      PULSE_LIGHT_MS: 8,   // a pulse at the lightest touch: soft (much under 8 some motors never spin up)
      PULSE_FULL_MS: 14,   // ...growing to this at full
      GAP_LIGHT_MS: 320,   // the gap at the lightest touch: slow, about 3 a second
      GAP_FULL_MS: 25,     // ...down to this at full: a rattle
      CURVE: 1.5           // the gap's curve from slow to fast: 1 is a straight line, above 1 leaves the slow end sooner, below 1 stays slow longer
    },
    SAND: {                // sanding: level = how rough the spot under the pad still is (pressure only switches it on)
      PULSE_SMOOTH_MS: 7,  // a smooth spot: tiny ticks...
      PULSE_ROUGH_MS: 10,  // ...a rough one: a little firmer
      GAP_SMOOTH_MS: 650,  // a smooth spot: super slow, so you feel it is done
      GAP_ROUGH_MS: 45,    // rough wood: fast and gritty
      CURVE: 1.5
    },
    WINDOW_MS: 250,        // how much pattern is sent at a time
    MIN_LEVEL: 0.02,       // below this counts as nothing (cutting only: a sanding pad on wood always ticks)
    RESEND_DELTA: 0.12,    // a level change this big re-times the beat straight away
    RESEND_LEAD_MS: 50,    // otherwise the next window is sent up to this long before its first pulse is due
    STOP_GRACE_MS: 60,     // a frame or two with no wood coming off does not stop it (no stutter)
    PULSE_GAP_MS: 60,      // a one-off that lands while another plays waits this long after it
    PULSES: {              // one-off patterns: on, off, on, ... in ms
      "catch": [35, 40, 35],              // the tool digs in: a sharp double jolt
      done: [30],                         // DONE: one soft thump
      stars3: [15, 70, 20, 70, 40]        // a 3-star grade: three rising taps
    }
  };

  /* ---------- level -> pattern (pure) ---------- */
  function clamp01(v) { return v > 1 ? 1 : v > 0 ? v : 0; }
  function feelOf(f) { return f === "sand" ? CFG.SAND : f && typeof f === "object" ? f : CFG.CUT; }
  /* The gap between pulses at a level, for a feel ("cut", the default, or "sand"). */
  function gapFor(level, f) {
    f = feelOf(f);
    var slow = f.GAP_LIGHT_MS != null ? f.GAP_LIGHT_MS : f.GAP_SMOOTH_MS, fast = f.GAP_FULL_MS != null ? f.GAP_FULL_MS : f.GAP_ROUGH_MS;
    return Math.round(fast + (slow - fast) * Math.pow(1 - clamp01(level), f.CURVE));
  }
  /* How long each pulse is at a level. */
  function pulseFor(level, f) {
    f = feelOf(f);
    var soft = f.PULSE_LIGHT_MS != null ? f.PULSE_LIGHT_MS : f.PULSE_SMOOTH_MS, firm = f.PULSE_FULL_MS != null ? f.PULSE_FULL_MS : f.PULSE_ROUGH_MS;
    return Math.round(soft + (firm - soft) * clamp01(level));
  }
  /* About WINDOW_MS of [pulse, gap, pulse, ...], always ending on a pulse (the gap after it
     is the next window's to keep); a slow level fits only one pulse. [] for a cutting level
     of nothing. */
  function patternFor(level, f) {
    var sand = f === "sand" || f === CFG.SAND;
    if (!sand && !(clamp01(level) >= CFG.MIN_LEVEL)) return [];
    level = clamp01(level);
    var on = pulseFor(level, f), off = gapFor(level, f), out = [on], t = on;
    while (t + off + on <= CFG.WINDOW_MS) { out.push(off, on); t += off + on; }
    return out;
  }
  function lengthOf(p) { var s = 0; for (var i = 0; i < p.length; i++) s += p[i]; return s; }

  /* ---------- the backend: the browser's vibration API ---------- */
  var H = {
    CFG: CFG, gapFor: gapFor, pulseFor: pulseFor, patternFor: patternFor,
    nav: function () { return root.navigator; },                           // tests swap this
    clock: function () { return root.performance ? root.performance.now() : Date.now(); }   // the lathe's test clock swaps this
  };
  function supported() { var n = H.nav(); return !!n && typeof n.vibrate === "function"; }
  function send(pattern) {
    if (!supported()) return;
    try { H.nav().vibrate(pattern); } catch (e) {}
  }

  /* ---------- the Settings switch ---------- */
  var profile = null, saveProfile = null, on = true;
  /* The profile's settings section (farm-ui.js hands it over) and how to save it. */
  function useProfile(settings, save) {
    profile = settings || null; saveProfile = save || null;
    on = !(profile && profile.vibration === false);
  }
  function enabled() { return on; }
  function setEnabled(v) {
    on = !!v;
    if (profile) profile.vibration = on;
    if (!on) stop();
    if (saveProfile) saveProfile();
  }

  /* ---------- continuous: cutting and sanding ----------
     The beat never jumps: when the level changes, the next pulse comes one new gap after
     the last pulse that played, not straight away, so a level that wobbles from frame to
     frame never bunches pulses up. */
  var cur = null;          // what was sent: { kind, level, t0, pattern, prevEnd, lastEnd, due } or null
  var zeroSince = -1;      // when the level first dropped to nothing
  var pulseUntil = 0, pulseTimer = 0;
  /* The end of the last pulse of cur that has finished by now (or the one before cur),
     or null while a pulse is still playing. */
  function lastPulseDone(now) {
    var t = cur.t0, done = cur.prevEnd;
    for (var i = 0; i < cur.pattern.length; i++) {
      var d = cur.pattern[i];
      if (i % 2 === 0 && d > 0) {
        if (now < t) break;
        if (now < t + d) return null;
        done = t + d;
      }
      t += d;
    }
    return done;
  }
  function feel(kind, level) {
    if (!on || !supported()) return;
    var now = H.clock();
    if (!(level >= CFG.MIN_LEVEL)) {
      if (!cur) return;
      if (zeroSince < 0) zeroSince = now;
      if (now - zeroSince >= CFG.STOP_GRACE_MS) { cur = null; zeroSince = -1; send(0); }
      return;
    }
    zeroSince = -1;
    if (now < pulseUntil) return;                // a one-off is playing: let it finish
    var p = patternFor(level, kind), delay = 0, prev = -1e9;
    if (cur) {
      var changed = cur.kind !== kind || Math.abs(level - cur.level) >= CFG.RESEND_DELTA;
      if (!changed && (now < cur.lastEnd || now < cur.due - CFG.RESEND_LEAD_MS)) return;   // the same feel, and the next pulse isn't due yet
      prev = lastPulseDone(now);
      if (prev === null) return;                 // mid-pulse: wait for it to finish
      delay = Math.max(0, Math.round(prev + gapFor(level, kind) - now));
      if (delay > 0) p = [0, delay].concat(p);
    }
    var len = lengthOf(p);
    cur = { kind: kind, level: level, t0: now, pattern: p, prevEnd: prev, lastEnd: now + len, due: now + len + gapFor(level, kind) };
    send(p);
  }
  function cut(level) { feel("cut", clamp01(level)); }
  /* level: how rough the spot under the pad is, 0 (as smooth as this grit goes) to 1. While
     the pad is on the wood it always ticks, super slowly once the spot is smooth. */
  function sand(level) { feel("sand", Math.max(CFG.MIN_LEVEL, clamp01(level))); }
  function stop() {
    var playing = !!cur || H.clock() < pulseUntil || !!pulseTimer;
    cur = null; zeroSince = -1; pulseUntil = 0;
    if (pulseTimer) { clearTimeout(pulseTimer); pulseTimer = 0; }
    if (playing && supported()) send(0);
  }

  /* ---------- one-offs ---------- */
  function pulse(name) {
    var p = CFG.PULSES[name];
    if (!p || !on || !supported()) return;
    var now = H.clock(), wait = pulseUntil > now ? pulseUntil - now + CFG.PULSE_GAP_MS : 0;
    function play() {
      pulseTimer = 0;
      cur = null; zeroSince = -1;                // the one-off replaces any cutting pattern
      pulseUntil = H.clock() + lengthOf(p);
      send(p.slice());
    }
    if (pulseTimer) { clearTimeout(pulseTimer); pulseTimer = 0; }
    if (wait > 0 && typeof setTimeout === "function") { pulseUntil = now + wait + lengthOf(p); pulseTimer = setTimeout(play, wait); }
    else play();
  }

  // a hidden page never keeps buzzing
  if (root.document && root.document.addEventListener) {
    root.document.addEventListener("visibilitychange", function () { if (root.document.hidden) stop(); });
  }

  H.supported = supported; H.enabled = enabled; H.setEnabled = setEnabled; H.useProfile = useProfile;
  H.cut = cut; H.sand = sand; H.stop = stop; H.pulse = pulse;
  if (typeof module !== "undefined" && module.exports) module.exports = H;
  var G = root.Game || (root.Game = {});
  G.Haptics = H;
})(typeof window !== "undefined" ? window : globalThis);

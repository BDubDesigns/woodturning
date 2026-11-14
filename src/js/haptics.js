/* ============================================================
   Haptics: the only place in the game that touches vibration.
   Everything else calls this module and never navigator.vibrate.

     Haptics.supported()          false where there is no way to vibrate (iPhone browsers)
     Haptics.enabled() / setEnabled(bool)   the Settings switch, saved in the profile
     Haptics.cut(level)           every frame while cutting; level 0..1. 0 = stop
     Haptics.sand(level)          the same, a lighter, finer feel, capped at CFG.SAND_CAP
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

  /* ---------- every tuning number, in one place (feel them on a real phone) ---------- */
  var CFG = {
    PULSE_MS: 12,          // one cutting pulse: short, so it reads as texture, not a buzz
    SAND_PULSE_MS: 8,      // sanding pulses are shorter still: a finer, lighter grain
    GAP_LIGHT_MS: 140,     // the gap between pulses at the lightest level...
    GAP_FULL_MS: 25,       // ...down to this at full (hard press at top RPM)
    WINDOW_MS: 250,        // how much pattern is sent at a time
    SAND_CAP: 0.5,         // sanding never gets past this level
    MIN_LEVEL: 0.02,       // below this counts as nothing
    RESEND_DELTA: 0.12,    // a level change this big sends a new pattern straight away
    RESEND_LEAD_MS: 50,    // otherwise the next one is sent up to this long before its first pulse is due, in time
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
  /* The gap between pulses at a level: GAP_LIGHT_MS at the lightest, GAP_FULL_MS at 1. */
  function gapFor(level, cfg) {
    cfg = cfg || CFG;
    return Math.round(cfg.GAP_LIGHT_MS + (cfg.GAP_FULL_MS - cfg.GAP_LIGHT_MS) * clamp01(level));
  }
  /* About WINDOW_MS of [pulse, gap, pulse, gap, ...]; [] for a level of nothing. */
  function patternFor(level, pulseMs, cfg) {
    cfg = cfg || CFG;
    level = clamp01(level);
    if (!(level >= cfg.MIN_LEVEL)) return [];
    var on = pulseMs || cfg.PULSE_MS, off = gapFor(level, cfg), out = [], t = 0;
    while (t + on <= cfg.WINDOW_MS) {
      out.push(on); t += on;
      if (t + off + on > cfg.WINDOW_MS) break;
      out.push(off); t += off;
    }
    return out;              // always ends on a pulse: the gap after it is the next pattern's to keep
  }
  function lengthOf(p) { var s = 0; for (var i = 0; i < p.length; i++) s += p[i]; return s; }

  /* ---------- the backend: the browser's vibration API ---------- */
  var H = {
    CFG: CFG, gapFor: gapFor, patternFor: patternFor,
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

  /* ---------- continuous: cutting and sanding ---------- */
  var cur = null;          // what is playing: { kind, level, gap, lastEnd (its last pulse ends), due (the next pulse is due) } or null
  var zeroSince = -1;      // when the level first dropped to nothing
  var pulseUntil = 0, pulseTimer = 0;
  function feel(kind, level, pulseMs) {
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
    var p = patternFor(level, pulseMs), delay = 0;
    if (cur && cur.kind === kind && Math.abs(level - cur.level) < CFG.RESEND_DELTA) {
      // the same feel: carry the beat on. Wait until the current pattern's last pulse is done
      // and the next is nearly due, then send the next window starting on that beat.
      if (now < cur.lastEnd || now < cur.due - CFG.RESEND_LEAD_MS) return;
      delay = Math.max(0, Math.round(cur.due - now));
      if (delay > 0) p = [0, delay].concat(p);
    }
    var len = lengthOf(p);
    cur = { kind: kind, level: level, lastEnd: now + len, due: now + len + gapFor(level) };
    send(p);
  }
  function cut(level) { feel("cut", clamp01(level), CFG.PULSE_MS); }
  function sand(level) { feel("sand", Math.min(CFG.SAND_CAP, clamp01(level)), CFG.SAND_PULSE_MS); }
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

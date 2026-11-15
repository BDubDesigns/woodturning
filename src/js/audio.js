/* Synthesised lathe audio: looped noise through a bandpass for the cut,
   a low sawtooth hum for the motor, a thump for a catch, and the delivery
   celebration's plucks, chime and coin ticks (audio.CEL has their numbers). Starts on the
   first press (browsers block audio until a user gesture). */
(function (root) {
  "use strict";
  var audio = { ctx: null, cutGain: null, humGain: null, on: true, pitch: 1 };   // pitch: 1 cutting, lower for the brush swish, higher for the spray hiss

  audio.init = function () {
    if (audio.ctx) { if (audio.ctx.state === "suspended") audio.ctx.resume(); return; }
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      audio.ctx = new AC();
      var ctx = audio.ctx;
      audio.master = ctx.createGain(); audio.master.gain.value = 0.9; audio.master.connect(ctx.destination);
      var len = ctx.sampleRate;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      var noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.7;
      audio.cutFilter = bp;
      audio.cutGain = ctx.createGain(); audio.cutGain.gain.value = 0;
      noise.connect(bp); bp.connect(audio.cutGain); audio.cutGain.connect(audio.master);
      noise.start();
      audio.noiseBuf = buf;
      // harvest saw: a raspy band of the same noise, level set per frame
      var sawBp = ctx.createBiquadFilter(); sawBp.type = "bandpass"; sawBp.frequency.value = 2300; sawBp.Q.value = 1.3;
      audio.sawFilter = sawBp;
      audio.sawGain = ctx.createGain(); audio.sawGain.gain.value = 0;
      noise.connect(sawBp); sawBp.connect(audio.sawGain); audio.sawGain.connect(audio.master);
      // sanding: a soft, airy hiss from the same noise, level set per frame
      var sandHp = ctx.createBiquadFilter(); sandHp.type = "highpass"; sandHp.frequency.value = 2200; sandHp.Q.value = 0.5;
      var sandBp = ctx.createBiquadFilter(); sandBp.type = "bandpass"; sandBp.frequency.value = 4200; sandBp.Q.value = 0.6;
      audio.sandFilter = sandBp;
      audio.sandGain = ctx.createGain(); audio.sandGain.gain.value = 0;
      noise.connect(sandHp); sandHp.connect(sandBp); sandBp.connect(audio.sandGain); audio.sandGain.connect(audio.master);
      var humOsc = ctx.createOscillator(); humOsc.type = "sawtooth"; humOsc.frequency.value = 52;
      audio.humOsc = humOsc;
      var humLp = ctx.createBiquadFilter(); humLp.type = "lowpass"; humLp.frequency.value = 220;
      audio.humGain = ctx.createGain(); audio.humGain.gain.value = 0.012;
      humOsc.connect(humLp); humLp.connect(audio.humGain); audio.humGain.connect(audio.master);
      humOsc.start();
      if (!audio.latheOn) audio.lathe(false);      // started on the harvest screen: no motor hum
      if (audio.radioOn && audio.radioOn()) audio.radio(true);   // the shop radio was left on: it starts with the sound
    } catch (e) { audio.ctx = null; }
  };

  /* ---- harvest sounds: short noise bursts and thumps, all one-shots ---- */
  audio.burst = function (type, freq, q, dur, gain, delay) {
    if (!audio.ctx || !audio.on || !audio.noiseBuf) return;
    var ctx = audio.ctx, t = ctx.currentTime + (delay || 0);
    var src = ctx.createBufferSource(); src.buffer = audio.noiseBuf;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.008, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(audio.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  };
  audio.thump = function (f0, f1, dur, gain, delay) {
    if (!audio.ctx || !audio.on) return;
    var ctx = audio.ctx, t = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(); o.type = "triangle";
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + dur + 0.02);
  };
  audio.thunk = function (power) {            // axe into wood
    var p = Math.max(0.2, Math.min(1, power || 0.5));
    audio.thump(150, 62, 0.14, 0.2 + 0.25 * p);
    audio.burst("bandpass", 900 + 700 * p, 0.8, 0.09, 0.22 + 0.2 * p);
  };
  audio.creak = function () {                 // the trunk complaining
    if (!audio.ctx || !audio.on) return;
    var ctx = audio.ctx, t = ctx.currentTime;
    var o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(74 + Math.random() * 20, t);
    o.frequency.linearRampToValueAtTime(54 + Math.random() * 14, t + 0.4);
    var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380; lp.Q.value = 6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(lp); lp.connect(g); g.connect(audio.master); o.start(t); o.stop(t + 0.45);
  };
  audio.crack = function (stage) {            // wood fibres letting go
    var k = stage || 0;
    audio.burst("highpass", 2600, 0.7, 0.05, 0.42 - k * 0.08);
    audio.burst("bandpass", 1500, 1.2, 0.07, 0.3, 0.045);
    audio.thump(90, 40, 0.18, 0.28 - k * 0.05);
  };
  audio.thud = function (power) {             // the log hitting the ground
    var p = Math.max(0.15, Math.min(1, power || 0.5));
    audio.thump(88, 30, 0.38, 0.55 * p + 0.1);
    audio.burst("lowpass", 520, 0.7, 0.22, 0.35 * p + 0.05);
  };
  audio.rustle = function (power) { audio.burst("highpass", 3200, 0.6, 0.14, 0.05 + 0.05 * (power || 0.5)); };
  audio.snip = function () {                  // blade through a branch
    audio.burst("bandpass", 2400, 2.2, 0.06, 0.2);
    audio.thump(420, 160, 0.05, 0.06);
  };
  audio.snap = function () { audio.burst("bandpass", 1300, 1.0, 0.1, 0.28); audio.thump(200, 80, 0.1, 0.12); };
  audio.kerf = function () { audio.thump(120, 60, 0.12, 0.2); audio.burst("bandpass", 1800, 1.0, 0.08, 0.2); };
  audio.chime = function () {                 // a small, warm "done"
    audio.thump(660, 660, 0.18, 0.05); audio.thump(880, 880, 0.26, 0.05, 0.09);
  };
  audio.buy = function () {                   // the till: a purchase at Arbor Freight
    audio.init();
    audio.burst("bandpass", 4200, 2.5, 0.05, 0.12); audio.thump(1046, 1046, 0.16, 0.06, 0.04); audio.thump(1568, 1568, 0.3, 0.06, 0.12);
  };
  /* ---- the delivery celebration (progress-ui.js): star plucks, a level-up chime, coin ticks ----
     Every tuning number for these three sounds is here. */
  audio.CEL = {
    STAR_BASE_HZ: 587.33,          // the first star's note (D5); each next star climbs the scale
    STAR_SCALE: [0, 2, 4, 7, 9],   // major pentatonic, in semitones: any run of stars sounds pleasant
    STAR_GAIN: 0.16,               // how loud a pluck is
    STAR_DECAY: 0.32,              // seconds for a pluck to ring out
    STAR_BRIGHT_HZ: 5200,          // the pluck's filter opens this far...
    STAR_DULL_HZ: 1300,            // ...and closes to this, which is what makes it a pluck
    LEVEL_NOTES: [0, 4, 7, 12],    // the level-up chime: root, third, fifth, octave (semitones over LEVEL_BASE_HZ)
    LEVEL_BASE_HZ: 783.99,         // G5
    LEVEL_GAP: 0.085,              // seconds between the chime's notes
    LEVEL_GAIN: 0.12,
    LEVEL_DECAY: 0.7,              // the last note rings this long; the others a little less
    COIN_HZ: [2093, 2349],         // a coin tick alternates between these two (C7, D7)
    COIN_GAIN: 0.05,
    COIN_DECAY: 0.05
  };
  function noteHz(base, semis) { return base * Math.pow(2, semis / 12); }
  /* One plucked note: a triangle and a soft octave through a closing lowpass. */
  function pluck(freq, gain, decay, delay) {
    if (!audio.ctx || !audio.on) return;
    var ctx = audio.ctx, t = ctx.currentTime + (delay || 0), C = audio.CEL;
    var o1 = ctx.createOscillator(); o1.type = "triangle"; o1.frequency.value = freq;
    var o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 2;
    var g2 = ctx.createGain(); g2.gain.value = 0.35;
    var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(C.STAR_BRIGHT_HZ, t); lp.frequency.exponentialRampToValueAtTime(C.STAR_DULL_HZ, t + decay * 0.5);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(audio.master);
    o1.start(t); o2.start(t); o1.stop(t + decay + 0.03); o2.stop(t + decay + 0.03);
  }
  /* A bell-ish note: a sine with a quiet inharmonic partial. */
  function bell(freq, gain, decay, delay) {
    if (!audio.ctx || !audio.on) return;
    var ctx = audio.ctx, t = ctx.currentTime + (delay || 0);
    [[1, 1], [2.76, 0.18], [5.4, 0.06]].forEach(function (pt) {
      var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = freq * pt[0];
      var g = ctx.createGain(), d = decay / (pt[0] > 1 ? 1.8 : 1);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain * pt[1], t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + d + 0.03);
    });
  }
  /* Star i of a delivery (0, 1, 2...) flies into the bar: each a note higher on the pentatonic scale. */
  audio.star = function (i) {
    var C = audio.CEL, sc = C.STAR_SCALE, k = Math.max(0, i | 0);
    var semis = sc[k % sc.length] + 12 * Math.floor(k / sc.length);
    pluck(noteHz(C.STAR_BASE_HZ, semis), C.STAR_GAIN, C.STAR_DECAY);
  };
  /* A mastery tier or a rank is reached: a rising chime. */
  audio.levelUp = function () {
    var C = audio.CEL, n = C.LEVEL_NOTES.length;
    C.LEVEL_NOTES.forEach(function (semis, i) {
      bell(noteHz(C.LEVEL_BASE_HZ, semis), C.LEVEL_GAIN * (i === n - 1 ? 1.1 : 0.85), i === n - 1 ? C.LEVEL_DECAY : C.LEVEL_DECAY * 0.6, i * C.LEVEL_GAP);
    });
    audio.burst("highpass", 6500, 0.5, 0.35, 0.025, (n - 1) * C.LEVEL_GAP);   // a little shimmer on the top note
  };
  /* A coin (or a diamond) counting into the wallet. i alternates the pitch. */
  audio.coinTick = function (i) {
    var C = audio.CEL;
    bell(C.COIN_HZ[(i | 0) % C.COIN_HZ.length], C.COIN_GAIN, C.COIN_DECAY);
  };

  /* ---- the shop radio (a decoration, decor.js): a soft synthesised tune, looped ----
     It plays on the lathe screen while the radio is on, and follows the sound toggle.
     Every number for it is here. */
  audio.RADIO = {
    BPM: 76,
    CHORDS: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]],   // I vi IV V, in semitones over ROOT_HZ
    ROOT_HZ: 261.63,         // C4
    ARP: [0, 1, 2, 1, 0, 2, 1, 2],   // which chord note each eighth note plays
    ARP_GAIN: 0.035, ARP_DECAY: 0.5, ARP_LOWPASS_HZ: 1800,
    BASS_GAIN: 0.05, BASS_DECAY: 0.9,
    LOOKAHEAD: 0.4           // seconds of tune scheduled ahead
  };
  var radio = { on: false, timer: 0, next: 0, step: 0, gain: null };
  function radioAudible() { return radio.on && audio.on && audio.latheOn; }
  function radioNote(freq, t, gain, decay, type, lowpass) {
    var ctx = audio.ctx, o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    if (lowpass) { var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = lowpass; o.connect(lp); lp.connect(g); } else o.connect(g);
    g.connect(radio.gain); o.start(t); o.stop(t + decay + 0.05);
  }
  function radioTick() {
    if (!audio.ctx || !radio.on) return;
    var R = audio.RADIO, ctx = audio.ctx, eighth = 30 / R.BPM;
    radio.gain.gain.setTargetAtTime(radioAudible() ? 1 : 0, ctx.currentTime, 0.08);
    if (radio.next < ctx.currentTime) radio.next = ctx.currentTime + 0.05;
    while (radio.next < ctx.currentTime + R.LOOKAHEAD) {
      var bar = Math.floor(radio.step / 8) % R.CHORDS.length, chord = R.CHORDS[bar], k = radio.step % 8;
      if (radioAudible()) {
        radioNote(R.ROOT_HZ * Math.pow(2, chord[R.ARP[k]] / 12), radio.next, R.ARP_GAIN, R.ARP_DECAY, "triangle", R.ARP_LOWPASS_HZ);
        if (k === 0 || k === 4) radioNote(R.ROOT_HZ / 2 * Math.pow(2, chord[0] / 12), radio.next, R.BASS_GAIN, R.BASS_DECAY, "sine", 0);
      }
      radio.next += eighth; radio.step++;
    }
  }
  /* Radio on or off. Before the first tap it only remembers, and starts once audio does (init). */
  audio.radio = function (on) {
    radio.on = !!on;
    if (radio.on) {
      if (!audio.ctx) return;
      if (!radio.gain) { radio.gain = audio.ctx.createGain(); radio.gain.gain.value = 0; radio.gain.connect(audio.master); }
      if (!radio.timer) { radio.next = 0; radio.timer = setInterval(radioTick, 100); radioTick(); }
    } else {
      if (radio.timer) { clearInterval(radio.timer); radio.timer = 0; }
      if (radio.gain) radio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05);
    }
  };
  audio.radioOn = function () { return radio.on; };

  /* sanding: level 0..1 (pressure x speed x how rough it still is), rpm brightens the hiss */
  audio.sand = function (level, rpmNow) {
    if (!audio.ctx || !audio.sandGain) return;
    var now = audio.ctx.currentTime, lv = audio.on && audio.latheOn ? Math.min(1, Math.max(0, level)) : 0;
    audio.sandGain.gain.setTargetAtTime(lv * 0.34, now, 0.05);
    audio.sandFilter.frequency.setTargetAtTime(3200 + (rpmNow || 1100) * 0.9, now, 0.1);
  };
  /* sawing: level 0..1 follows how fast the blade is moving */
  audio.saw = function (level) {
    if (!audio.ctx || !audio.sawGain) return;
    var now = audio.ctx.currentTime;
    audio.sawGain.gain.setTargetAtTime(audio.on ? Math.min(0.3, level * 0.3) : 0, now, 0.04);
    audio.sawFilter.frequency.setTargetAtTime(1900 + level * 1500, now, 0.06);
  };
  /* the lathe's motor hum and cut noise belong to the lathe screen only */
  audio.latheOn = true;
  audio.lathe = function (on) {
    audio.latheOn = on;
    if (!audio.ctx) return;
    var now = audio.ctx.currentTime;
    if (!on) {
      audio.cutGain.gain.setTargetAtTime(0, now, 0.05);
      if (audio.sandGain) audio.sandGain.gain.setTargetAtTime(0, now, 0.05);
      if (audio.humGain) audio.humGain.gain.setTargetAtTime(0, now, 0.05);
    } else if (audio.sawGain) {
      audio.sawGain.gain.setTargetAtTime(0, now, 0.05);
    }
  };

  audio.clunk = function () {
    if (!audio.ctx || !audio.on) return;
    var ctx = audio.ctx, t = ctx.currentTime;
    var osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g); g.connect(audio.master); osc.start(t); osc.stop(t + 0.18);
  };

  /* intensity 0..1 from the cut, contact 0..1 while the tool rubs the wood */
  audio.update = function (intensity, contact, rpmNow) {
    if (!audio.ctx || !audio.latheOn) return;
    var now = audio.ctx.currentTime;
    var level = Math.max(intensity, contact * 0.06);
    var target = audio.on ? Math.min(0.4, level * 0.55) : 0;
    audio.cutGain.gain.setTargetAtTime(target, now, 0.045);
    audio.cutFilter.frequency.setTargetAtTime((1100 + rpmNow * 0.45 + intensity * 500) * audio.pitch, now, 0.1);
    if (audio.humGain) audio.humGain.gain.setTargetAtTime(audio.on ? 0.006 + rpmNow * 0.000008 : 0, now, 0.2);
    if (audio.humOsc) audio.humOsc.frequency.setTargetAtTime(38 + rpmNow * 0.016, now, 0.2);
  };

  /* Flip sound on or off from any screen's SOUND button. */
  audio.toggle = function () {
    audio.init();
    audio.setOn(!audio.on);
    var btns = document.querySelectorAll("[data-sound]");
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-pressed", audio.on ? "true" : "false");
  };

  audio.setOn = function (on) {
    audio.on = on;
    if (!on && audio.ctx) {
      if (audio.sawGain) audio.sawGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.03);
      audio.cutGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.03);
      if (audio.sandGain) audio.sandGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.03);
      if (audio.humGain) audio.humGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.03);
    }
  };

  (root.Lathe || (root.Lathe = {})).audio = audio;
})(window);

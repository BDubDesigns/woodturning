/* Synthesised lathe audio: looped noise through a bandpass for the cut,
   a low sawtooth hum for the motor, a thump for a catch. Starts on the
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
      var humOsc = ctx.createOscillator(); humOsc.type = "sawtooth"; humOsc.frequency.value = 52;
      audio.humOsc = humOsc;
      var humLp = ctx.createBiquadFilter(); humLp.type = "lowpass"; humLp.frequency.value = 220;
      audio.humGain = ctx.createGain(); audio.humGain.gain.value = 0.012;
      humOsc.connect(humLp); humLp.connect(audio.humGain); audio.humGain.connect(audio.master);
      humOsc.start();
    } catch (e) { audio.ctx = null; }
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
    if (!audio.ctx) return;
    var now = audio.ctx.currentTime;
    var level = Math.max(intensity, contact * 0.06);
    var target = audio.on ? Math.min(0.4, level * 0.55) : 0;
    audio.cutGain.gain.setTargetAtTime(target, now, 0.045);
    audio.cutFilter.frequency.setTargetAtTime((1100 + rpmNow * 0.45 + intensity * 500) * audio.pitch, now, 0.1);
    if (audio.humGain) audio.humGain.gain.setTargetAtTime(audio.on ? 0.006 + rpmNow * 0.000008 : 0, now, 0.2);
    if (audio.humOsc) audio.humOsc.frequency.setTargetAtTime(38 + rpmNow * 0.016, now, 0.2);
  };

  audio.setOn = function (on) {
    audio.on = on;
    if (!on && audio.ctx) {
      audio.cutGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.03);
      if (audio.humGain) audio.humGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.03);
    }
  };

  (root.Lathe || (root.Lathe = {})).audio = audio;
})(window);

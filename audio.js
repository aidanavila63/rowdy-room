/* Chiptune engine — everything is synthesised with the Web Audio API,
   so there are no audio files to download and nothing to go missing. */
(function (global) {
  var KEY = 'mlt.audio.v1';
  var ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  var on = { music: true, sfx: true };
  var track = null, timer = null, step = 0, nextTime = 0;
  var listeners = [];

  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) { on.music = !!saved.music; on.sfx = !!saved.sfx; }
  } catch (e) {}

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(on)); } catch (e) {}
    listeners.forEach(function (f) { try { f(on); } catch (e) {} });
  }

  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  /* Must be called from a click/tap — browsers won't start audio otherwise. */
  function ready() {
    try {
      if (!ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.85;
        master.connect(ctx.destination);
        sfxBus = ctx.createGain();
        sfxBus.gain.value = 0.9;
        sfxBus.connect(master);
        musicBus = ctx.createGain();
        musicBus.gain.value = on.music ? 0.22 : 0;
        musicBus.connect(master);

        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- voices ---------------- */
  function tone(o) {
    if (!ctx) return;
    var t = o.at || ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.from, t);
    if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
    var peak = o.gain === undefined ? 0.3 : o.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    var node = osc;
    if (o.cutoff) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.cutoff, t);
      node.connect(f); f.connect(g);
    } else {
      node.connect(g);
    }
    g.connect(o.bus || sfxBus);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
  }

  function noise(o) {
    if (!ctx || !noiseBuf) return;
    var t = o.at || ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'highpass';
    f.frequency.setValueAtTime(o.freq || 6000, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(o.gain === undefined ? 0.18 : o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t);
    src.stop(t + o.dur + 0.02);
  }

  function arp(notes, spacing, opts) {
    if (!ctx) return;
    var t0 = ctx.currentTime;
    notes.forEach(function (m, i) {
      tone({
        at: t0 + i * spacing, from: hz(m), to: hz(m),
        dur: opts && opts.dur || spacing * 1.8,
        type: opts && opts.type || 'square',
        gain: opts && opts.gain || 0.22
      });
    });
  }

  /* ---------------- sound effects ---------------- */
  var SFX = {
    join: function () { arp([76, 83], 0.07, { dur: 0.16, gain: 0.2 }); },
    blip: function () { tone({ from: 900, to: 1400, dur: 0.07, gain: 0.16, type: 'square' }); },
    pick: function () { arp([72, 79], 0.055, { dur: 0.14, gain: 0.22, type: 'triangle' }); },
    tick: function () { tone({ from: 1500, to: 1500, dur: 0.045, gain: 0.13, type: 'square' }); },
    hurry: function () { tone({ from: 1046, to: 780, dur: 0.13, gain: 0.2, type: 'square' }); },
    start: function () { arp([60, 64, 67, 72], 0.075, { dur: 0.2, gain: 0.22 }); },
    reveal: function () {
      noise({ freq: 400, sweepTo: 7000, filter: 'bandpass', dur: 0.45, gain: 0.16 });
      tone({ from: 220, to: 660, dur: 0.4, gain: 0.16, type: 'sawtooth', cutoff: 2200 });
    },
    winner: function () { arp([72, 76, 79, 84], 0.085, { dur: 0.3, gain: 0.24 }); },
    gameover: function () {
      arp([60, 64, 67, 72, 76, 79, 84], 0.09, { dur: 0.34, gain: 0.24 });
      if (ctx) {
        [72, 76, 79, 84].forEach(function (m) {
          tone({ at: ctx.currentTime + 0.72, from: hz(m), to: hz(m), dur: 1.1, gain: 0.13, type: 'triangle' });
        });
        noise({ at: ctx.currentTime + 0.72, freq: 2000, sweepTo: 9000, filter: 'bandpass', dur: 0.8, gain: 0.1 });
      }
    },
    bye: function () { arp([67, 60], 0.08, { dur: 0.2, gain: 0.16, type: 'triangle' }); }
  };

  var debug = {
    count: 0,
    last: null,
    /* Peak amplitude coming out of the master bus — used to prove the
       synth is actually making sound, not just running silently. */
    peak: function (ms) {
      if (!ctx || !master) return Promise.resolve(0);
      var an = ctx.createAnalyser();
      an.fftSize = 2048;
      master.connect(an);
      var data = new Float32Array(an.fftSize);
      var best = 0, end = performance.now() + (ms || 700);
      return new Promise(function (res) {
        (function poll() {
          an.getFloatTimeDomainData(data);
          for (var i = 0; i < data.length; i++) {
            var v = Math.abs(data[i]);
            if (v > best) best = v;
          }
          if (performance.now() < end) requestAnimationFrame(poll);
          else { try { master.disconnect(an); } catch (e) {} res(best); }
        })();
      });
    }
  };
  function sfx(name) {
    if (!on.sfx || !ctx) return;
    var f = SFX[name];
    if (!f) return;
    debug.count++;
    debug.last = name;
    try { f(); } catch (e) {}
  }

  /* ---------------- music ---------------- */
  var TRACKS = {
    lobby: {
      bpm: 96,
      bass: [45, null, null, null, 45, null, null, null, 41, null, null, null, 43, null, null, null],
      lead: [69, null, 72, null, 76, null, 72, null, 69, null, 76, null, 74, null, 72, null],
      hat:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
    },
    round: {
      bpm: 128,
      bass: [33, null, 33, null, 36, null, 33, null, 31, null, 31, null, 33, null, 35, null],
      lead: [null, null, 69, null, null, null, 72, null, null, null, 67, null, null, null, 71, null],
      hat:  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1]
    }
  };

  function stepDur() { return 60 / TRACKS[track].bpm / 4; }

  function playStep(i, at) {
    var T = TRACKS[track];
    if (T.bass[i] !== null && T.bass[i] !== undefined) {
      tone({ at: at, from: hz(T.bass[i]), to: hz(T.bass[i]), dur: stepDur() * 1.7,
             type: 'sawtooth', gain: 0.5, cutoff: 420, bus: musicBus });
    }
    if (T.lead[i] !== null && T.lead[i] !== undefined) {
      tone({ at: at, from: hz(T.lead[i]), to: hz(T.lead[i]), dur: stepDur() * 1.3,
             type: 'square', gain: 0.16, bus: musicBus });
    }
    if (T.hat[i]) {
      noise({ at: at, freq: 7000, dur: 0.05, gain: 0.09, bus: musicBus });
    }
  }

  function scheduler() {
    if (!ctx || !track) return;
    while (nextTime < ctx.currentTime + 0.25) {
      playStep(step, Math.max(nextTime, ctx.currentTime));
      nextTime += stepDur();
      step = (step + 1) % 16;
    }
  }

  function music(name) {
    if (name === track) return;
    track = name && TRACKS[name] ? name : null;
    clearInterval(timer);
    timer = null;
    if (!track || !ctx) return;
    step = 0;
    nextTime = ctx.currentTime + 0.06;
    scheduler();
    timer = setInterval(scheduler, 45);
  }

  function setMusic(v) {
    on.music = !!v;
    if (musicBus && ctx) {
      musicBus.gain.setTargetAtTime(on.music ? 0.22 : 0.0001, ctx.currentTime, 0.05);
    }
    persist();
  }
  function setSfx(v) { on.sfx = !!v; persist(); }

  global.MLT = global.MLT || {};
  global.MLT.audio = {
    ready: ready,
    sfx: sfx,
    music: music,
    setMusic: setMusic,
    setSfx: setSfx,
    toggleMusic: function () { setMusic(!on.music); },
    toggleSfx: function () { setSfx(!on.sfx); },
    state: on,
    onChange: function (f) { listeners.push(f); f(on); },
    nowPlaying: function () { return track; },
    debug: debug
  };
})(window);

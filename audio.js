/* Chiptune engine — everything is synthesised with the Web Audio API,
   so there are no audio files to download and nothing to go missing. */
(function (global) {
  var KEY = 'mlt.audio.v1';
  var ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  var on = { music: true, sfx: true };
  var track = null, timer = null, step = 0, nextTime = 0, loopCount = 0;
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
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + (o.attack || 0.006));
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
    var t0 = (opts && opts.at) || ctx.currentTime;
    notes.forEach(function (m, i) {
      tone({
        at: t0 + i * spacing, from: hz(m), to: hz(m),
        dur: opts && opts.dur || spacing * 1.8,
        type: opts && opts.type || 'square',
        gain: opts && opts.gain || 0.22,
        bus: opts && opts.bus
      });
    });
  }

  /* A stacked, faintly detuned unison hit — several one-shot tones firing
     in the same instant read as one fat "chord" voice rather than N thin
     bleeps, without any shared gain-node bookkeeping. */
  function chord(midiList, dur, opts) {
    if (!ctx) return;
    opts = opts || {};
    var t = opts.at || ctx.currentTime;
    var n = midiList.length || 1;
    var peak = (opts.gain === undefined ? 0.2 : opts.gain) / Math.sqrt(n);
    midiList.forEach(function (m) {
      tone({ at: t, from: hz(m), dur: dur, type: opts.type || 'sawtooth',
             gain: peak, cutoff: opts.cutoff, bus: opts.bus, attack: opts.attack });
      tone({ at: t, from: hz(m) * 1.006, dur: dur, type: opts.type || 'sawtooth',
             gain: peak * 0.55, cutoff: opts.cutoff, bus: opts.bus, attack: opts.attack });
    });
  }

  /* A short pitch-dropping thump with a tiny transient click on top —
     the low-end "impact" every big sting is built around. */
  function kick(opts) {
    if (!ctx) return;
    opts = opts || {};
    var t = opts.at || ctx.currentTime;
    var dur = opts.dur || 0.16;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(opts.from || 150, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to || 42), t + dur);
    var peak = opts.gain === undefined ? 0.5 : opts.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(opts.bus || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.02);
    noise({ at: t, freq: 900, filter: 'lowpass', dur: 0.03,
            gain: opts.click === undefined ? 0.12 : opts.click, bus: opts.bus });
  }

  /* A rising sweep — filtered noise plus a climbing tone — for the half-
     second of "here it comes" tension right before a reveal or a round
     kicking off. */
  function riser(opts) {
    if (!ctx) return;
    opts = opts || {};
    var t = opts.at || ctx.currentTime;
    var dur = opts.dur || 0.32;
    var gain = opts.gain === undefined ? 0.15 : opts.gain;
    noise({ at: t, freq: opts.from || 400, sweepTo: opts.to || 7500, filter: 'bandpass',
            dur: dur, gain: gain, bus: opts.bus });
    tone({ at: t, from: opts.toneFrom || 240, to: opts.toneTo || 1300, dur: dur,
           gain: gain * 0.85, type: 'sawtooth', cutoff: opts.cutoff || 3000, bus: opts.bus });
  }

  /* A quick cascade of high, decaying notes — the "magic glimmer" layered
     on top of the bigger fanfares so they read as celebratory rather than
     just loud. */
  function sparkle(opts) {
    if (!ctx) return;
    opts = opts || {};
    var t0 = opts.at || ctx.currentTime;
    var n = opts.n || 7;
    var notes = opts.notes || [88, 91, 96, 91, 100, 96, 91, 96, 100, 103];
    var spacing = opts.spacing || 0.045;
    var gain = opts.gain === undefined ? 0.12 : opts.gain;
    for (var i = 0; i < n; i++) {
      tone({
        at: t0 + i * spacing + Math.random() * 0.008,
        from: hz(notes[i % notes.length]), dur: opts.dur || 0.16,
        type: 'triangle', gain: gain * (1 - i / (n * 1.7)), bus: opts.bus
      });
    }
  }

  /* Short, quiet noise burst — a percussive "click" that gives a tone or
     a UI tap a bit of transient bite it wouldn't have on its own. */
  function click(opts) {
    if (!ctx) return;
    opts = opts || {};
    noise({ at: opts.at, freq: opts.freq || 4000, filter: 'highpass',
            dur: opts.dur || 0.02, gain: opts.gain === undefined ? 0.08 : opts.gain, bus: opts.bus });
  }

  /* ---------------- sound effects ---------------- */
  var SFX = {
    /* frequent UI feedback — stays snappy no matter how many times a       */
    /* session fires it, but a touch more tactile than a bare bleep         */
    join: function () {
      arp([76, 83], 0.07, { dur: 0.16, gain: 0.2 });
      if (ctx) tone({ at: ctx.currentTime + 0.13, from: hz(88), dur: 0.24, gain: 0.09, type: 'triangle' });
    },
    blip: function () {
      tone({ from: 950, to: 1500, dur: 0.06, gain: 0.17, type: 'square' });
      click({ dur: 0.015, gain: 0.05 });
    },
    pick: function () { arp([72, 79, 84], 0.05, { dur: 0.14, gain: 0.21, type: 'triangle' }); },
    tick: function () { tone({ from: 1600, to: 1500, dur: 0.04, gain: 0.13, type: 'square' }); },
    hurry: function () {
      tone({ from: 1046, to: 700, dur: 0.11, gain: 0.22, type: 'square' });
      click({ freq: 3200, dur: 0.05, gain: 0.06 });
    },

    /* once-per-game moments — room to be a little bigger                   */
    start: function () {
      kick({ gain: 0.4, dur: 0.14 });
      riser({ dur: 0.26, gain: 0.11, from: 500, to: 5200 });
      arp([60, 64, 67, 72, 76], 0.06, { dur: 0.17, gain: 0.22, at: (ctx ? ctx.currentTime + 0.04 : 0) });
    },

    /* fires every reveal, sometimes 20-40 times a game — richer timbre,    */
    /* not a longer sound, so it never overstays its welcome                */
    reveal: function () {
      noise({ freq: 500, sweepTo: 8000, filter: 'bandpass', dur: 0.32, gain: 0.17 });
      tone({ from: 260, to: 760, dur: 0.3, gain: 0.18, type: 'sawtooth', cutoff: 2600 });
      if (ctx) kick({ at: ctx.currentTime + 0.015, gain: 0.2, dur: 0.1, from: 130, to: 55, click: 0.04 });
    },

    /* fires every round on a correct/leading result — a bright, punchy     */
    /* triumph sting, deliberately shorter than the once-per-game finales   */
    winner: function () {
      chord([72, 76, 79, 84], 0.3, { gain: 0.24 });
      sparkle({ n: 5, spacing: 0.04, gain: 0.13 });
    },

    /* reserved for the single biggest "you won the room" moment — the      */
    /* podium's #1 spot and the end-of-night recap's standings slide        */
    crown: function () {
      if (!ctx) return;
      var t0 = ctx.currentTime;
      kick({ at: t0, gain: 0.35, dur: 0.16 });
      chord([69, 73, 76, 81], 0.5, { at: t0, gain: 0.24 });
      chord([69, 73, 76, 81, 88], 0.7, { at: t0 + 0.24, gain: 0.17, type: 'triangle' });
      sparkle({ at: t0 + 0.1, n: 9, spacing: 0.05, gain: 0.14 });
    },

    /* the finale — once per game, plenty of room to go big: a hit, a run   */
    /* up the scale, a chord that resolves, then an echoing tail            */
    gameover: function () {
      if (!ctx) return;
      var t0 = ctx.currentTime;
      kick({ at: t0, gain: 0.45, dur: 0.16 });
      arp([60, 64, 67, 72, 76, 79, 84], 0.085, { dur: 0.32, gain: 0.24, at: t0 });
      kick({ at: t0 + 0.9, gain: 0.3, dur: 0.3, from: 95, to: 30 });
      chord([60, 64, 67, 72, 76, 79, 84], 0.95, { at: t0 + 0.9, gain: 0.18, type: 'triangle' });
      chord([60, 64, 67, 72, 76, 79, 84], 0.8, { at: t0 + 1.18, gain: 0.08, type: 'triangle' }); /* echo tail */
      sparkle({ at: t0 + 0.95, n: 10, spacing: 0.05, gain: 0.12 });
      noise({ at: t0 + 0.9, freq: 2000, sweepTo: 9000, filter: 'bandpass', dur: 0.9, gain: 0.12 });
    },

    bye: function () {
      chord([67, 62], 0.28, { gain: 0.15, type: 'triangle' });
      if (ctx) chord([60, 55], 0.4, { at: ctx.currentTime + 0.16, gain: 0.11, type: 'triangle' });
    },

    /* a quick bright-to-dark sweep for slide/screen transitions (the       */
    /* end-of-night recap uses this between slides)                        */
    whoosh: function () { noise({ freq: 5200, sweepTo: 500, filter: 'bandpass', dur: 0.2, gain: 0.13 }); }
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
  /* Four lanes of independent one-shot voices per step (bass, lead, a pad
     for harmonic color, plus hats) over a 32-step, two-phrase loop — the
     second half leans on related chord tones instead of repeating the
     first half note-for-note, so a track that loops for minutes on end
     still feels like it's going somewhere instead of looping in place.
     Nothing here shares a gain node across steps, so there's no automation
     to fight with the music on/off toggle, which only ever touches
     musicBus itself. */
  var TRACKS = {
    lobby: {
      bpm: 96,
      bass: [45, null, null, null, 45, null, null, null, 41, null, null, null, 43, null, null, null,
             45, null, null, null, 48, null, null, null, 43, null, null, null, 41, null, null, null],
      lead: [69, null, 72, null, 76, null, 72, null, 69, null, 76, null, 74, null, 72, null,
             72, null, 76, null, 79, null, 76, null, 74, null, 79, null, 77, null, 76, null],
      pad:  [null, null, null, null, 64, null, null, null, null, null, null, null, 67, null, null, null,
             null, null, null, null, 71, null, null, null, null, null, null, null, 74, null, null, null],
      hat:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1,
             0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      twinkle: [88, 91, 93, 96, 98]
    },
    round: {
      bpm: 128,
      bass: [33, null, 33, null, 36, null, 33, null, 31, null, 31, null, 33, null, 35, null,
             36, null, 36, null, 38, null, 36, null, 33, null, 33, null, 36, null, 38, null],
      lead: [null, null, 69, null, null, null, 72, null, null, null, 67, null, null, null, 71, null,
             null, null, 72, null, null, null, 74, null, null, null, 69, null, null, null, 74, null],
      pad:  [57, null, null, null, null, null, null, null, 60, null, null, null, null, null, null, null,
             60, null, null, null, null, null, null, null, 62, null, null, null, null, null, null, null],
      hat:  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1,
             1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
      twinkle: [93, 96, 98, 100]
    }
  };

  function stepDur() { return 60 / TRACKS[track].bpm / 4; }

  function playStep(i, at) {
    var T = TRACKS[track];
    var n = T.hat.length;
    /* a slow "breathing" brightness — the filters on the bass and pad
       drift gently over the length of the loop instead of sitting static,
       the classic chill-lounge production trick, done here just by
       varying the cutoff each new one-shot note gets rather than
       automating a shared filter node */
    var breathe = Math.sin((loopCount + i / n) * 0.9);
    if (T.bass[i] !== null && T.bass[i] !== undefined) {
      tone({ at: at, from: hz(T.bass[i]), to: hz(T.bass[i]), dur: stepDur() * 1.7,
             type: 'sawtooth', gain: 0.5, cutoff: 380 + breathe * 130, bus: musicBus });
      /* an octave-down layer under the bass for a bit more low-end weight */
      tone({ at: at, from: hz(T.bass[i] - 12), to: hz(T.bass[i] - 12), dur: stepDur() * 1.9,
             type: 'sine', gain: 0.24, cutoff: 220, bus: musicBus });
    }
    if (T.lead[i] !== null && T.lead[i] !== undefined) {
      tone({ at: at, from: hz(T.lead[i]), to: hz(T.lead[i]), dur: stepDur() * 1.3,
             type: 'square', gain: 0.16, bus: musicBus });
    }
    if (T.pad && T.pad[i] !== null && T.pad[i] !== undefined) {
      var padCutoff = 1150 + breathe * 480;
      /* two faintly detuned layers instead of one thin voice — a proper
         wide, warm pad instead of a single triangle bleep */
      tone({ at: at, from: hz(T.pad[i]), dur: stepDur() * 3.6,
             type: 'triangle', gain: 0.06, cutoff: padCutoff, bus: musicBus });
      tone({ at: at, from: hz(T.pad[i]) * 1.004, dur: stepDur() * 3.8,
             type: 'triangle', gain: 0.045, cutoff: padCutoff, bus: musicBus });
    }
    if (T.hat[i]) {
      var open = (i % 8 === 6);
      noise({ at: at, freq: open ? 6000 : 7500, dur: open ? 0.14 : 0.045,
              gain: open ? 0.07 : 0.09, bus: musicBus });
    }
    /* a rare, quiet high glint on an otherwise-empty step — an occasional
       extravagant flourish, not a constant one, so it stays chill */
    if (T.twinkle && !T.hat[i] && !T.lead[i] && Math.random() < 0.05) {
      var note = T.twinkle[Math.floor(Math.random() * T.twinkle.length)];
      tone({ at: at + stepDur() * 0.5, from: hz(note), dur: stepDur() * 2.2,
             type: 'triangle', gain: 0.035, bus: musicBus });
    }
  }

  function scheduler() {
    if (!ctx || !track) return;
    var n = TRACKS[track].hat.length;
    while (nextTime < ctx.currentTime + 0.25) {
      playStep(step, Math.max(nextTime, ctx.currentTime));
      nextTime += stepDur();
      step = (step + 1) % n;
      if (step === 0) loopCount++;
    }
  }

  function music(name) {
    if (name === track) return;
    track = name && TRACKS[name] ? name : null;
    clearInterval(timer);
    timer = null;
    if (!track || !ctx) return;
    step = 0;
    loopCount = 0;
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

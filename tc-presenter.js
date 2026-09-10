(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SAVE = 'tc.host.v1';
  var ACCENT = '#b6ff3b';

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  function blankGame() {
    return {
      code: randomCode(), seq: 0, phase: 'lobby',
      secs: 75, totalRounds: 8,
      packs: MLT.TC_PACKS.map(function (p) { return p.id; }),
      players: [], order: [], N: 0,
      round: 0, clueGiverId: null, item: null, usedPhrases: [],
      liveClues: [], guessed: {}, guessOrder: [],
      endsAt: null, history: [],
      host: null, lastCmd: 0, lastActivity: Date.now()
    };
  }

  var saved = MLT.store(SAVE);
  var G = saved || blankGame();
  if (!G.packs || !G.packs.length) G.packs = MLT.TC_PACKS.map(function (p) { return p.id; });
  if (!G.order) G.order = [];
  if (!G.usedPhrases) G.usedPhrases = [];
  if (!G.liveClues) G.liveClues = [];
  if (!G.guessed) G.guessed = {};
  if (!G.guessOrder) G.guessOrder = [];
  if (G.host === undefined) G.host = null;
  if (!G.lastCmd) G.lastCmd = 0;
  if (!G.lastActivity) G.lastActivity = Date.now();
  save();

  var wantNew = MLT.qs('new') === '1';
  var PLAYLIST = (MLT.qs('pl') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var PLAYLIST_MODE = MLT.qs('auto') === '1' || PLAYLIST.length > 0;
  if (wantNew) {
    try {
      var keep = ['bus', 'relay'].map(function (k) {
        var v = MLT.qs(k);
        return v ? k + '=' + encodeURIComponent(v) : null;
      }).filter(Boolean).join('&');
      history.replaceState(null, '', location.pathname + (keep ? '?' + keep : ''));
    } catch (e) {}
  }

  function randomCode() {
    var s = '';
    for (var i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    return s;
  }
  function save() { MLT.store(SAVE, G); }

  /* ------------------------------------------------------------------ */
  /* transport                                                           */
  /* ------------------------------------------------------------------ */
  var bus = null;

  function connect() {
    if (bus) bus.close();
    clearTimeout(pubTimer);
    bus = MLT.createBus({ code: G.code, role: 'host' });
    $('#status').classList.remove('hidden');
    MLT.wireStatus(bus, $('#status'));
    bus.on(onBusMessage);
  }

  function teardownBus(announce) {
    clearTimeout(pubTimer);
    if (bus) {
      if (announce) bus.send({ t: 'closed' });
      bus.clearState();
      bus.close();
      bus = null;
    }
  }

  function newRoom(forceCode) {
    teardownBus(true);
    clearInterval(clockTimer);
    G.code = (typeof forceCode === 'string' && /^[A-Z0-9]{4}$/.test(forceCode)) ? forceCode : randomCode();
    G.seq = 0;
    G.phase = 'lobby';
    G.round = 0;
    G.clueGiverId = null;
    G.item = null;
    G.usedPhrases = [];
    G.liveClues = [];
    G.guessed = {};
    G.guessOrder = [];
    G.endsAt = null;
    G.history = [];
    G.players = [];
    G.order = [];
    G.N = 0;
    G.host = null;
    G.lastCmd = 0;
    G.lastActivity = Date.now();
    save();
    connect();
    show('lobby');
    renderLobby();
    renderPacks();
    makeQR();
    broadcast(true);
    A.ready();
    A.music('lobby');
  }

  function closeRoom(reason) {
    teardownBus(true);
    clearInterval(clockTimer);
    MLT.store(SAVE, null);
    saved = null;
    G = blankGame();
    save();
    window.__TCG = G;
    openStart();
    if (reason) MLT.toast(reason);
  }

  var IDLE_LIMIT = 3 * 60 * 60 * 1000;
  setInterval(function () {
    if (!bus) return;
    if (Date.now() - (G.lastActivity || 0) > IDLE_LIMIT) closeRoom('Room timed out from inactivity');
  }, 60000);

  function enterRoom() {
    connect();
    show(G.phase === 'lobby' ? 'lobby' : G.phase);
    renderAll();
    makeQR();
    if (G.phase === 'clue') { runClock(); sendSecretItem(); }
    broadcast(true);
    A.ready();
    A.music(G.phase === 'clue' ? 'round' : 'lobby');
  }

  function openStart() {
    show('start');
    var resumable = !!(saved && saved.code && (saved.players.length || saved.phase !== 'lobby'));
    $('#btnResume').classList.toggle('hidden', !resumable);
    if (resumable) {
      var n = saved.players.length;
      $('#btnResume').textContent = 'Resume room ' + saved.code +
        ' · ' + n + ' player' + (n === 1 ? '' : 's');
      $('#startHint').textContent = 'Creating a new room clears the players. Scores are remembered either way.';
    } else {
      $('#startHint').textContent = '';
    }
  }

  var lastPub = 0, pubTimer = null;
  function broadcast(now) {
    var wait = now ? 0 : Math.max(0, 500 - (Date.now() - lastPub));
    clearTimeout(pubTimer);
    pubTimer = setTimeout(function () {
      if (!bus) return;
      lastPub = Date.now();
      G.seq++;
      G.lastActivity = Date.now();
      save();
      bus.sendState({ t: 'state', seq: G.seq, now: Date.now(), s: publicState() });
    }, wait);
  }

  function poolFromPacks() {
    var pool = [];
    MLT.TC_PACKS.forEach(function (pk) {
      if (G.packs.indexOf(pk.id) < 0) return;
      pk.items.forEach(function (it) { pool.push(it); });
    });
    return pool;
  }

  function pickItem() {
    var pool = poolFromPacks();
    if (!pool.length) return { phrase: 'MYSTERY', taboo: ['UNKNOWN', 'SECRET', 'HIDDEN'] };
    var avail = pool.filter(function (it) { return G.usedPhrases.indexOf(it.phrase) < 0; });
    if (!avail.length) { G.usedPhrases = []; avail = pool.slice(); }
    var it = avail[Math.floor(Math.random() * avail.length)];
    G.usedPhrases.push(it.phrase);
    return it;
  }

  function publicState() {
    var s = {
      phase: G.phase,
      players: G.players.map(function (p) { return { id: p.id, name: p.name, pts: p.pts }; }),
      host: G.host || null,
      N: G.N
    };
    if (G.phase === 'clue') {
      s.round = G.round; s.totalRounds = G.totalRounds;
      s.clueGiverId = G.clueGiverId;
      s.secs = G.secs; s.endsAt = G.endsAt;
      s.clues = G.liveClues;
      s.guessedIds = Object.keys(G.guessed);
      s.totalGuessers = Math.max(0, G.N - 1);
    } else if (G.phase === 'reveal') {
      s.round = G.round; s.totalRounds = G.totalRounds;
      s.clueGiverId = G.clueGiverId;
      s.phrase = G.item.phrase;
      s.taboo = G.item.taboo;
      s.clues = G.liveClues;
      s.correctCount = Object.keys(G.guessed).length;
      s.totalGuessers = Math.max(0, G.N - 1);
      var last = G.history[G.history.length - 1];
      s.clueGiverPts = last ? last.clueGiverPts : 0;
      s.guessed = G.guessed;
      s.guessOrder = G.guessOrder;
    } else if (G.phase === 'final') {
      s.awards = computeAwards();
    }
    return s;
  }

  function playerById(id) {
    for (var i = 0; i < G.players.length; i++) if (G.players[i].id === id) return G.players[i];
    return null;
  }
  function indexOfPlayer(id) {
    for (var i = 0; i < G.players.length; i++) if (G.players[i].id === id) return i;
    return -1;
  }
  function nameOf(id) { var p = playerById(id); return p ? p.name : '—'; }

  function sendSecretItem() {
    if (bus && G.clueGiverId && G.item) {
      bus.send({ t: 'secret', to: G.clueGiverId, round: G.round, phrase: G.item.phrase, taboo: G.item.taboo });
    }
  }

  /* ------------------------------------------------------------------ */
  /* incoming                                                            */
  /* ------------------------------------------------------------------ */
  function onBusMessage(m) {
    if (m.t === 'hello') {
      if (!m.from || !m.name) return;
      var p = playerById(m.from);
      if (p) {
        if (p.name !== m.name) p.name = String(m.name).slice(0, 18);
      } else {
        if (G.players.length >= 10) return;
        G.players.push({ id: m.from, name: String(m.name).slice(0, 18), pts: 0 });
        A.sfx('join');
      }
      save(); renderAll(); broadcast(true);

    } else if (m.t === 'bye') {
      var i = indexOfPlayer(m.from);
      if (i >= 0) {
        G.players.splice(i, 1);
        if (G.host === m.from) G.host = null;
        if (G.players.length === 0) { closeRoom('Everyone left — room closed'); return; }
        A.sfx('bye'); save(); renderAll(); broadcast(true);
      }

    } else if (m.t === 'cmd') {
      if (!G.host || m.from !== G.host) return;
      if (!(m.n > G.lastCmd)) return;
      G.lastCmd = m.n;
      save();
      var d = m.do;
      if (d === 'start') { if (G.phase === 'lobby' && G.players.length >= 3 && poolFromPacks().length >= 1) startGame(); }
      else if (d === 'skip') { if (G.phase === 'clue') doReveal(); }
      else if (d === 'timer+') { if (G.phase === 'clue') adjustTimer(5); }
      else if (d === 'timer-') { if (G.phase === 'clue') adjustTimer(-5); }
      else if (d === 'timerOff') { if (G.phase === 'clue') toggleNoTimer(); }
      else if (d === 'next') { if (G.phase === 'reveal') nextRound(); }
      else if (d === 'again') { if (G.phase === 'final') playAgain(); }

    } else if (m.t === 'clue') {
      if (G.phase !== 'clue' || m.from !== G.clueGiverId || m.round !== G.round) return;
      var text = String(m.text || '').trim().slice(0, 60);
      if (!text) return;
      var hit = MLT.tcCheckClue(text, G.item);
      if (hit) {
        if (bus) bus.send({ t: 'blocked', to: m.from, word: hit });
        return;
      }
      if (G.liveClues.length >= 20) G.liveClues.shift();
      G.liveClues.push(text);
      save(); broadcast(true);
      A.sfx('blip');

    } else if (m.t === 'needitem') {
      if (G.phase === 'clue' && m.from === G.clueGiverId) sendSecretItem();

    } else if (m.t === 'guess') {
      if (G.phase !== 'clue' || m.round !== G.round) return;
      if (m.from === G.clueGiverId) return;
      if (G.guessed[m.from] !== undefined) return;
      if (!playerById(m.from)) return;
      var guess = String(m.text || '').slice(0, 60);
      if (MLT.tcNormalize(guess) === MLT.tcNormalize(G.item.phrase) && MLT.tcNormalize(guess)) {
        var frac = G.endsAt ? Math.max(0, (G.endsAt - Date.now()) / (G.secs * 1000)) : 1;
        var pts = Math.max(15, Math.round(15 + 85 * frac));
        G.guessed[m.from] = pts;
        G.guessOrder.push(m.from);
        var pl = playerById(m.from);
        if (pl) pl.pts += pts;
        A.sfx('pick');
        save(); renderClue(); broadcast(true);
        var totalGuessers = Math.max(0, G.N - 1);
        if (totalGuessers > 0 && Object.keys(G.guessed).length >= totalGuessers) {
          setTimeout(function () { if (G.phase === 'clue') doReveal(); }, 700);
        }
      } else {
        if (bus) bus.send({ t: 'wrong', to: m.from });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* flow                                                                */
  /* ------------------------------------------------------------------ */
  function startGame() {
    var s = parseInt($('#secs').value, 10);
    if (!isNaN(s)) G.secs = s;
    var r = parseInt($('#rounds').value, 10);
    if (!isNaN(r)) G.totalRounds = r;
    G.order = G.players.map(function (p) { return p.id; });
    G.N = G.order.length;
    G.usedPhrases = [];
    G.history = [];
    G.players.forEach(function (p) { p.pts = 0; });
    G.round = 0;
    startRound();
  }

  function startRound() {
    G.phase = 'clue';
    G.clueGiverId = G.order[G.round % G.N];
    G.item = pickItem();
    G.liveClues = [];
    G.guessed = {};
    G.guessOrder = [];
    G.endsAt = G.secs > 0 ? Date.now() + G.secs * 1000 : null;
    save();
    show('clue');
    renderClue();
    broadcast(true);
    sendSecretItem();
    runClock();
    A.sfx('start');
    A.music('round');
  }

  var clockTimer = null;
  function runClock() {
    clearInterval(clockTimer);
    var clock = $('#clock');
    if (!G.endsAt) {
      clock.textContent = '∞';
      clock.classList.remove('urgent');
      $('#timerFill').style.width = '100%';
      return;
    }
    var span = Math.max(1, G.secs * 1000);
    var lastSec = -1;
    function tick() {
      var left = G.endsAt - Date.now();
      var sec = Math.ceil(left / 1000);
      if (sec !== lastSec && sec > 0 && sec <= 5) A.sfx(sec <= 3 ? 'hurry' : 'tick');
      lastSec = sec;
      if (left <= 0) {
        clearInterval(clockTimer);
        clock.textContent = '0';
        clock.classList.remove('urgent');
        $('#timerFill').style.width = '0%';
        if (G.phase === 'clue') doReveal();
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 5200);
      $('#timerFill').style.width = Math.max(0, (left / span) * 100) + '%';
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function adjustTimer(delta) {
    var wasOff = !(G.secs > 0);
    G.secs = Math.max(20, Math.min(180, (G.secs > 0 ? G.secs : 0) + delta));
    if (G.phase === 'clue') {
      G.endsAt = (wasOff || !G.endsAt)
        ? Date.now() + G.secs * 1000
        : Math.max(Date.now() + 2000, G.endsAt + delta * 1000);
      runClock();
    }
    save(); renderClue(); broadcast(true);
  }

  function toggleNoTimer() {
    if (G.secs > 0) {
      G.prevSecs = G.secs; G.secs = 0; G.endsAt = null;
    } else {
      G.secs = G.prevSecs || 75;
      if (G.phase === 'clue') G.endsAt = Date.now() + G.secs * 1000;
    }
    if (G.phase === 'clue') runClock();
    save(); renderClue(); broadcast(true);
  }

  function doReveal() {
    clearInterval(clockTimer);
    G.phase = 'reveal';
    G.endsAt = null;
    var totalGuessers = Math.max(0, G.N - 1);
    var correctCount = Object.keys(G.guessed).length;
    var clueGiverPts = totalGuessers > 0 ? Math.round(100 * correctCount / totalGuessers) : 0;
    var giverP = playerById(G.clueGiverId);
    if (giverP) giverP.pts += clueGiverPts;
    G.history.push({
      phrase: G.item.phrase, taboo: G.item.taboo, clueGiverId: G.clueGiverId,
      correctCount: correctCount, totalGuessers: totalGuessers, clueGiverPts: clueGiverPts,
      guessed: Object.assign({}, G.guessed), clues: G.liveClues.slice()
    });
    save();
    show('reveal');
    renderReveal();
    broadcast(true);
    A.music('lobby');
    A.sfx('reveal');
    if (totalGuessers > 0 && correctCount >= totalGuessers) setTimeout(function () { A.sfx('winner'); }, 500);
  }

  function nextRound() {
    if (G.round + 1 >= G.totalRounds) {
      G.phase = 'final';
      save();
      show('final');
      renderFinal();
      broadcast(true);
      A.music(null);
      A.sfx('gameover');
      setTimeout(function () { if (G.phase === 'final') A.music('lobby'); }, 4200);
      return;
    }
    G.round++;
    startRound();
  }

  function playAgain() {
    G.phase = 'lobby';
    G.round = 0; G.clueGiverId = null; G.item = null; G.usedPhrases = [];
    G.liveClues = []; G.guessed = {}; G.guessOrder = []; G.endsAt = null;
    G.history = [];
    G.players.forEach(function (p) { p.pts = 0; });
    save();
    show('lobby'); renderLobby(); broadcast(true);
    A.music('lobby');
  }

  /* ------------------------------------------------------------------ */
  /* awards                                                              */
  /* ------------------------------------------------------------------ */
  function computeAwards() {
    if (G.players.length < 3 || !G.history.length) return [];
    var giverTotals = {}, guessTotals = {};
    G.history.forEach(function (h) {
      giverTotals[h.clueGiverId] = (giverTotals[h.clueGiverId] || 0) + h.clueGiverPts;
      Object.keys(h.guessed).forEach(function (id) {
        guessTotals[id] = (guessTotals[id] || 0) + h.guessed[id];
      });
    });
    var awards = [];
    var bestGiver = null;
    Object.keys(giverTotals).forEach(function (id) {
      if (!playerById(id)) return;
      if (!bestGiver || giverTotals[id] > giverTotals[bestGiver]) bestGiver = id;
    });
    if (bestGiver && giverTotals[bestGiver] > 0) {
      awards.push({ t: 'Wordsmith', p: bestGiver, c: '#b6ff3b', d: 'Got the most guessers across every round they gave clues' });
    }
    var sharpest = null;
    Object.keys(guessTotals).forEach(function (id) {
      if (!playerById(id)) return;
      if (!sharpest || guessTotals[id] > guessTotals[sharpest]) sharpest = id;
    });
    if (sharpest && guessTotals[sharpest] > 0) {
      awards.push({ t: 'Sharp Ears', p: sharpest, c: '#3dff9e', d: 'Racked up the most points guessing quickly and correctly' });
    }
    return awards;
  }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */
  function joinUrl() {
    var base = location.href.split('?')[0].split('#')[0].replace(/present(\.html)?$/, '');
    var u = base + '?r=' + G.code;
    if (MLT.qs('bus')) u += '&bus=' + MLT.qs('bus');
    if (MLT.qs('relay')) u += '&relay=' + encodeURIComponent(MLT.qs('relay'));
    return u;
  }

  function makeQR() {
    var box = document.getElementById('qr');
    if (!box) return;
    box.innerHTML = '';
    try {
      if (window.QRCode) {
        new QRCode(box, {
          text: joinUrl(), width: 164, height: 164,
          colorDark: '#05040e', colorLight: '#ffffff'
        });
      }
    } catch (e) {}
  }

  function renderLobby() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var tiles = $('#codeText');
    if (tiles.textContent !== G.code) {
      tiles.innerHTML = '';
      G.code.split('').forEach(function (ch) {
        tiles.appendChild(el('span', { class: 'codechar', text: ch }));
      });
    }
    $('#joinUrl').textContent = joinUrl().replace(/^https?:\/\//, '');

    var box = $('#lobbyPlayers');
    box.innerHTML = '';
    G.players.forEach(function (p, i) {
      var kids = [avatar(p.name, i), el('span', { text: p.name })];
      if (G.host === p.id) kids.push(el('span', { class: 'tag', text: '· remote' }));
      box.appendChild(el('span', { class: 'chip' + (G.host === p.id ? ' remote' : '') }, kids));
    });
    renderHostPick();
    $('#pcount').textContent = '(' + G.players.length + ')';
    var avail = poolFromPacks().length;
    $('#btnStart').disabled = G.players.length < 3 || avail < 1;
    $('#lobbyHint').textContent = G.players.length < 3
      ? 'Waiting for people to join… you need at least 3 — one to give clues, at least two to guess.'
      : avail < 1
        ? 'Pick at least one phrase pack in Settings.'
        : 'Everyone in? Hit start.';
    renderPacks();
  }

  function renderHostPick() {
    var wrap = $('#hostPickBtns');
    wrap.innerHTML = '';
    $('#hostPick').classList.toggle('hidden', !G.players.length);
    G.players.forEach(function (p) {
      wrap.appendChild(el('button', {
        class: 'ghost mini', 'aria-pressed': G.host === p.id ? 'true' : 'false',
        style: G.host === p.id ? 'border-color:var(--cyan);color:var(--cyan)' : '',
        text: p.name,
        onclick: function () {
          G.host = (G.host === p.id) ? null : p.id;
          save(); renderLobby(); broadcast(true);
        }
      }));
    });
    if (G.host) {
      wrap.appendChild(el('button', {
        class: 'ghost mini', text: 'None',
        onclick: function () { G.host = null; save(); renderLobby(); broadcast(true); }
      }));
    }
    $('#hostPickHint').textContent = G.host
      ? nameOf(G.host) + "'s phone can now start and advance the game — you can walk away from this screen."
      : 'Tap a name to hand the game controls to that phone, so you can play along without standing at this screen.';
  }

  function renderPacks() {
    var box = $('#packs');
    if (!box) return;
    box.innerHTML = '';
    MLT.TC_PACKS.forEach(function (p) {
      var on = G.packs.indexOf(p.id) >= 0;
      box.appendChild(el('button', {
        class: 'pack', 'aria-pressed': on ? 'true' : 'false', 'data-pack': p.id,
        style: '--pc:' + p.accent,
        onclick: function () {
          var i = G.packs.indexOf(p.id);
          if (i >= 0) G.packs.splice(i, 1); else G.packs.push(p.id);
          save(); renderPacks(); renderLobby();
        }
      }, [
        el('span', { class: 'em', text: p.emoji }),
        el('span', { text: p.name }),
        el('span', { class: 'n', text: String(p.items.length) })
      ]));
    });
    var avail = poolFromPacks().length;
    $('#qcount').textContent = avail
      ? avail + ' phrase' + (avail === 1 ? '' : 's') + ' ready' + (G.packs.length ? ' · ' + G.packs.length + ' pack' + (G.packs.length > 1 ? 's' : '') : '')
      : 'Pick at least one pack.';
  }

  function renderClue() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    $('#cProgress').textContent = 'Round ' + (G.round + 1) + ' / ' + G.totalRounds;
    $('#cGiver').textContent = nameOf(G.clueGiverId) + ' is giving clues';
    var feed = $('#cClueFeed');
    feed.innerHTML = '';
    if (!G.liveClues.length) {
      feed.appendChild(el('div', { class: 'tiny', style: 'color:var(--dimmer)', text: 'Waiting for the first clue…' }));
    } else {
      G.liveClues.forEach(function (c) {
        feed.appendChild(el('div', { class: 'tc-cluebubble', text: c }));
      });
    }
    feed.scrollTop = feed.scrollHeight;
    var correct = Object.keys(G.guessed).length;
    var total = Math.max(0, G.N - 1);
    $('#cCorrectCount').textContent = correct;
    $('#cCorrectTotal').textContent = total;
    $('#secsNow').textContent = G.secs > 0 ? G.secs + 's per round' : 'no countdown';
    $('#btnNoTimer').textContent = G.secs > 0 ? 'No timer' : 'Timer on';
    $('#btnMinus').disabled = !(G.secs > 20);

    var box = $('#cluePlayers');
    box.innerHTML = '';
    G.players.forEach(function (p, i) {
      if (p.id === G.clueGiverId) {
        box.appendChild(el('span', { class: 'chip', style: 'border-color:var(--lime);box-shadow:0 0 14px rgba(182,255,59,0.3)' }, [
          avatar(p.name, i), el('span', { text: p.name }), el('span', { class: 'tag', text: '· clues' })
        ]));
      } else {
        box.appendChild(el('span', { class: 'chip' + (G.guessed[p.id] !== undefined ? ' voted' : '') }, [
          avatar(p.name, i), el('span', { text: p.name })
        ]));
      }
    });
  }

  function renderReveal() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var last = G.history[G.history.length - 1] || {};
    $('#rProgress').textContent = 'Round ' + (G.round + 1) + ' / ' + G.totalRounds;
    $('#rPhrase').textContent = G.item.phrase;
    $('#rTaboo').textContent = (G.item.taboo || []).join(' · ');
    var feed = $('#rClueFeed');
    feed.innerHTML = '';
    (last.clues || []).forEach(function (c) {
      feed.appendChild(el('div', { class: 'tc-cluebubble', text: c }));
    });
    $('#rGiverName').textContent = nameOf(G.clueGiverId);
    $('#rGiverPts').textContent = '+' + (last.clueGiverPts || 0) + ' pts';
    $('#rCorrectCount').textContent = last.correctCount || 0;
    $('#rCorrectTotal').textContent = last.totalGuessers || 0;

    var bars = $('#rBars');
    bars.innerHTML = '';
    var rows = G.guessOrder.map(function (id, i) {
      return { id: id, rank: i + 1, pts: G.guessed[id] };
    });
    rows.forEach(function (r) {
      var idx = indexOfPlayer(r.id);
      var col = MLT.colorFor(idx);
      var fill = el('i', { style: 'background:' + col + ';color:' + col });
      var num = el('div', { class: 'n', text: '0' });
      bars.appendChild(el('div', { class: 'bar' }, [
        el('div', { class: 'who' }, [avatar(nameOf(r.id), idx), el('span', { text: nameOf(r.id) })]),
        el('div', {}, [el('div', { class: 'track' }, [fill]), el('div', { class: 'voters', text: 'guessed #' + r.rank })]),
        num
      ]));
      setTimeout(function () { MLT.countUp(num, r.pts, 500); fill.style.width = r.pts + '%'; }, 60);
    });
    var missed = G.players.filter(function (p) { return p.id !== G.clueGiverId && G.guessed[p.id] === undefined; });
    if (missed.length) {
      bars.appendChild(el('div', { class: 'tiny', style: 'color:var(--dimmer);margin-top:2px', text: "Didn't get it: " + missed.map(function (p) { return p.name; }).join(', ') }));
    }
    $('#btnNextRound').textContent = (G.round + 1 >= G.totalRounds) ? 'Final standings' : 'Next round';
  }

  function renderPodium(node, players) {
    node.innerHTML = '';
    var top = players.slice(0, 3);
    if (!top.length) return;
    var heights = [168, 122, 92];
    [1, 0, 2].forEach(function (rank) {
      var p = top[rank];
      var slot = el('div', { class: 'plinth' });
      if (!p) { node.appendChild(slot); return; }
      var idx = indexOfPlayer(p.id);
      var col = MLT.colorFor(idx);
      slot.appendChild(el('div', { class: 'head' }, [
        avatar(p.name, idx),
        el('div', { class: 'nm', text: p.name }),
        el('div', { class: 'sc', text: p.pts + ' pts' })
      ]));
      var col2 = el('div', { class: 'col', style: 'color:' + col },
        [el('div', { class: 'rk', text: String(rank + 1) })]);
      slot.appendChild(col2);
      node.appendChild(slot);
      setTimeout(function () { col2.style.height = heights[rank] + 'px'; }, 120 + rank * 160);
    });
  }

  function renderFinal() {
    MLT.renderPlaylistCTA({ playlist: PLAYLIST, code: G.code, send: function (m) { if (bus) bus.send(m); } });
    document.documentElement.style.setProperty('--accent', '#3dff9e');
    var sorted = G.players.slice().sort(function (a, b) { return b.pts - a.pts; });
    renderPodium($('#podium'), sorted);

    var lb = $('#lb');
    lb.innerHTML = '';
    sorted.slice(3).forEach(function (p, i) {
      lb.appendChild(el('div', { class: 'lbrow' }, [
        el('div', { class: 'rank', text: String(i + 4) }),
        el('div', { class: 'name' }, [avatar(p.name, indexOfPlayer(p.id)), el('span', { text: p.name })]),
        el('div', { class: 'pts', text: p.pts + ' pts' })
      ]));
    });

    var box = $('#awards');
    box.innerHTML = '';
    computeAwards().forEach(function (aw) {
      var idx = indexOfPlayer(aw.p);
      box.appendChild(el('div', { class: 'award', style: '--ac:' + aw.c }, [
        el('div', { class: 't', text: aw.t }),
        el('div', { class: 'w' }, [avatar(nameOf(aw.p), idx), el('span', { text: nameOf(aw.p) })]),
        el('div', { class: 'd', text: aw.d })
      ]));
    });

    $('#finalTitle').textContent = sorted.length ? sorted[0].name + ' talks (and listens) the best' : 'Final standings';
    MLT.confetti(sorted.slice(0, 3).map(function (p) { return MLT.colorFor(indexOfPlayer(p.id)); }));
  }

  function renderAll() {
    if (G.phase === 'lobby') renderLobby();
    else if (G.phase === 'clue') renderClue();
    else if (G.phase === 'reveal') renderReveal();
    else renderFinal();
  }

  /* ------------------------------------------------------------------ */
  /* wiring                                                              */
  /* ------------------------------------------------------------------ */
  $('#btnCreate').addEventListener('click', newRoom);
  $('#btnResume').addEventListener('click', enterRoom);
  $('#btnMusic').addEventListener('click', function () { A.ready(); A.toggleMusic(); });
  $('#btnSfx').addEventListener('click', function () { A.ready(); A.toggleSfx(); if (A.state.sfx) A.sfx('blip'); });
  A.onChange(function (s) {
    $('#btnMusic').classList.toggle('off', !s.music);
    $('#btnSfx').classList.toggle('off', !s.sfx);
  });
  $('#btnSettings').addEventListener('click', function () { $('#settings').classList.toggle('hidden'); });
  $('#btnStart').addEventListener('click', function () { A.ready(); startGame(); });
  $('#packAll').addEventListener('click', function () {
    G.packs = MLT.TC_PACKS.map(function (p) { return p.id; });
    save(); renderPacks(); renderLobby();
  });
  $('#packNone').addEventListener('click', function () { G.packs = []; save(); renderPacks(); renderLobby(); });
  $('#rounds').addEventListener('change', function () {
    G.totalRounds = parseInt($('#rounds').value, 10) || G.totalRounds || 8;
    save();
  });
  $('#secs').addEventListener('change', function () {
    var v = parseInt($('#secs').value, 10);
    G.secs = isNaN(v) ? 75 : v;
    save();
  });
  $('#btnMinus').addEventListener('click', function () { adjustTimer(-5); });
  $('#btnPlus').addEventListener('click', function () { adjustTimer(5); });
  $('#btnNoTimer').addEventListener('click', toggleNoTimer);
  $('#btnSkip').addEventListener('click', doReveal);
  $('#btnNextRound').addEventListener('click', nextRound);
  $('#btnAgain').addEventListener('click', playAgain);
  $('#btnHome').addEventListener('click', newRoom);

  $('#rounds').value = String(G.totalRounds);
  if ($('#rounds').selectedIndex < 0) $('#rounds').value = '8';
  if (PLAYLIST_MODE) {
    var firstOpt = $('#rounds').options[0];
    if (firstOpt) { $('#rounds').value = firstOpt.value; }
    $('#rounds').dispatchEvent(new Event('change'));
  }
  $('#secs').value = String(G.secs);
  if ($('#secs').selectedIndex < 0) $('#secs').value = '75';
  renderPacks();

  if (PLAYLIST_MODE) newRoom((MLT.qs('r') || '').toUpperCase());
  else if (wantNew) newRoom();
  else if (saved && saved.phase === 'clue') enterRoom();
  else openStart();

  window.addEventListener('beforeunload', save);
  window.__TCG = G;
})();

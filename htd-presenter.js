(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SAVE = 'htd.host.v1';
  var SEEN = 'htd.seen.v1';
  var DEBATE_SECS = 30;

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  function blankGame() {
    return {
      code: randomCode(), seq: 0, phase: 'lobby',
      round: 0, total: 10, secs: 20, debateSecs: DEBATE_SECS,
      packs: MLT.HTD_PACKS.map(function (p) { return p.id; }),
      questions: [], players: [], votes1: {}, votes2: {}, endsAt: null,
      history: [], host: null, lastCmd: 0, lastActivity: Date.now()
    };
  }

  var saved = MLT.store(SAVE);
  var G = saved || blankGame();
  if (!G.packs || !G.packs.length) G.packs = MLT.HTD_PACKS.map(function (p) { return p.id; });
  if (!G.votes1) G.votes1 = {};
  if (!G.votes2) G.votes2 = {};
  if (!G.history) G.history = [];
  if (G.host === undefined) G.host = null;
  if (!G.lastCmd) G.lastCmd = 0;
  if (!G.lastActivity) G.lastActivity = Date.now();
  if (!G.questions) G.questions = [];
  if (!G.debateSecs) G.debateSecs = DEBATE_SECS;
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
  function loadSeen() { return MLT.store(SEEN) || []; }
  function saveSeen(a) { MLT.store(SEEN, a.slice(-400)); }
  function markSeen(text) {
    var s = loadSeen();
    if (s.indexOf(text) < 0) { s.push(text); saveSeen(s); }
  }

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
    G.votes1 = {}; G.votes2 = {};
    G.endsAt = null;
    G.players = [];
    G.questions = [];
    G.history = [];
    G.host = null;
    G.lastCmd = 0;
    G.lastActivity = Date.now();
    save();
    connect();
    show('lobby');
    renderLobby();
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
    window.__HG = G;
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
    show(phaseScreen(G.phase));
    renderAll();
    makeQR();
    if (G.phase === 'ask1' || G.phase === 'ask2') runClock();
    if (G.phase === 'debate') runDebateClock();
    broadcast(true);
    A.ready();
    A.music((G.phase === 'ask1' || G.phase === 'ask2') ? 'round' : 'lobby');
  }

  function phaseScreen(p) {
    if (p === 'ask1' || p === 'ask2') return 'ask';
    if (p === 'debate') return 'debate';
    if (p === 'reveal') return 'reveal';
    if (p === 'final') return 'final';
    return 'lobby';
  }

  function openStart() {
    show('start');
    var resumable = !!(saved && saved.code && (saved.players.length || saved.phase !== 'lobby'));
    $('#btnResume').classList.toggle('hidden', !resumable);
    if (resumable) {
      var n = saved.players.length;
      $('#btnResume').textContent = 'Resume room ' + saved.code +
        ' · ' + n + ' player' + (n === 1 ? '' : 's');
      $('#startHint').textContent = 'Creating a new room clears the players and the lobby. Scores are remembered either way.';
    } else {
      $('#startHint').textContent = '';
    }
  }

  var lastPub = 0, pubTimer = null;
  function broadcast(now) {
    var wait = now ? 0 : Math.max(0, 1100 - (Date.now() - lastPub));
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

  function currentQ() { return G.questions[G.round] || { t: '', p: 'food' }; }

  function avg(map) {
    var keys = Object.keys(map);
    if (!keys.length) return null;
    var sum = 0;
    keys.forEach(function (k) { sum += map[k]; });
    return sum / keys.length;
  }

  function publicState() {
    var q = currentQ();
    var s = {
      phase: G.phase, round: G.round, total: G.total,
      t: q.t, p: q.p, endsAt: G.endsAt, secs: G.secs, debateSecs: G.debateSecs,
      players: G.players.map(function (p) { return { id: p.id, name: p.name, pts: p.pts }; }),
      host: G.host || null
    };
    if (G.phase === 'ask1' || G.phase === 'ask2') {
      s.leg = G.phase === 'ask1' ? 1 : 2;
      s.voted = Object.keys(G.phase === 'ask1' ? G.votes1 : G.votes2);
    } else if (G.phase === 'debate') {
      s.votes1 = G.votes1;
      s.debaterA = q.debaterA; s.debaterB = q.debaterB;
    } else if (G.phase === 'reveal') {
      s.votes1 = G.votes1; s.votes2 = G.votes2;
      s.debaterA = q.debaterA; s.debaterB = q.debaterB;
      s.avgBefore = avg(G.votes1); s.avgAfter = avg(G.votes2);
      s.winner = q.winner;
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

  /* ------------------------------------------------------------------ */
  /* question pool — same shape as the classic pack model                */
  /* ------------------------------------------------------------------ */
  function poolFromPacks(ignoreSeen) {
    var seen = ignoreSeen ? [] : loadSeen();
    var pool = [];
    MLT.HTD_PACKS.forEach(function (pk) {
      if (G.packs.indexOf(pk.id) < 0) return;
      pk.items.forEach(function (t) {
        if (seen.indexOf(t) < 0) pool.push({ t: t, p: pk.id });
      });
    });
    return pool;
  }

  function buildQuestions() {
    var pool = poolFromPacks(false);
    if (!pool.length) { saveSeen([]); pool = poolFromPacks(true); }
    if (!pool.length) pool = MLT.HTD_PACKS[0].items.map(function (t) { return { t: t, p: MLT.HTD_PACKS[0].id }; });
    return MLT.shuffle(pool);
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
      if (d === 'start') { if (G.phase === 'lobby' && G.players.length >= 3) startGame(); }
      else if (d === 'reveal') { if (G.phase === 'ask1') endAsk1(); else if (G.phase === 'ask2') doReveal(); }
      else if (d === 'skipDebate') { if (G.phase === 'debate') endDebate(); }
      else if (d === 'next') { if (G.phase === 'reveal') nextRound(); }
      else if (d === 'again') { if (G.phase === 'final') playAgain(); }

    } else if (m.t === 'stance') {
      var leg = G.phase === 'ask1' ? 1 : G.phase === 'ask2' ? 2 : 0;
      if (!leg || m.round !== G.round) return;
      if (!playerById(m.from)) return;
      var v = Math.max(0, Math.min(100, Math.round(Number(m.value))));
      if (isNaN(v)) return;
      var bucket = leg === 1 ? G.votes1 : G.votes2;
      bucket[m.from] = v;
      save();
      if (leg === 1) renderAsk1(); else renderAsk2();
      var target = G.players.length;
      if (Object.keys(bucket).length >= target && target) {
        setTimeout(function () { if (leg === 1 && G.phase === 'ask1') endAsk1(); else if (leg === 2 && G.phase === 'ask2') doReveal(); }, 700);
      } else {
        broadcast(false);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* flow                                                                */
  /* ------------------------------------------------------------------ */
  function startGame() {
    G.total = parseInt($('#rounds').value, 10) || G.total || 10;
    var s = parseInt($('#secs').value, 10);
    if (!isNaN(s)) G.secs = s;
    var ds = parseInt($('#debateSecs').value, 10);
    if (!isNaN(ds)) G.debateSecs = ds;
    G.questions = buildQuestions();
    if (G.questions.length < G.total) G.total = G.questions.length;
    G.round = 0;
    G.history = [];
    G.players.forEach(function (p) { p.pts = 0; });
    startAsk1();
  }

  function startAsk1() {
    G.phase = 'ask1';
    G.votes1 = {}; G.votes2 = {};
    G.endsAt = G.secs > 0 ? Date.now() + G.secs * 1000 : null;
    markSeen(currentQ().t);
    save();
    show('ask');
    renderAsk1();
    broadcast(true);
    runClock();
    A.sfx('start');
    A.music('round');
  }

  /* pick the two people furthest apart; ties broken by a "controversy"
     score — distance from the room average, weighted by how confident
     (far from neutral) that voter's own stance was. */
  function pickDebaters() {
    var ids = Object.keys(G.votes1);
    if (ids.length < 2) return null;
    var roomAvg = avg(G.votes1);
    function controversy(id) {
      var v = G.votes1[id];
      var confidence = Math.abs(v - 50) / 50;
      return Math.abs(v - roomAvg) * confidence;
    }
    var minV = Math.min.apply(null, ids.map(function (id) { return G.votes1[id]; }));
    var maxV = Math.max.apply(null, ids.map(function (id) { return G.votes1[id]; }));
    var lows = ids.filter(function (id) { return G.votes1[id] === minV; });
    var highs = ids.filter(function (id) { return G.votes1[id] === maxV; });
    lows.sort(function (a, b) { return controversy(b) - controversy(a); });
    highs.sort(function (a, b) { return controversy(b) - controversy(a); });
    var a = lows[0], b = highs[0];
    if (a === b) { highs = ids.filter(function (id) { return id !== a; })
      .sort(function (x, y) { return G.votes1[y] - G.votes1[x]; }); b = highs[0] || a; }
    return { a: a, b: b };
  }

  function endAsk1() {
    clearInterval(clockTimer);
    var d = pickDebaters();
    var q = currentQ();
    q.debaterA = d ? d.a : null;
    q.debaterB = d ? d.b : null;
    G.phase = 'debate';
    G.endsAt = G.debateSecs > 0 ? Date.now() + G.debateSecs * 1000 : null;
    save();
    show('debate');
    renderDebate();
    broadcast(true);
    A.sfx('reveal');
    A.music('lobby');
  }

  function endDebate() {
    clearInterval(clockTimer);
    startAsk2();
  }

  function startAsk2() {
    G.phase = 'ask2';
    G.votes2 = {};
    G.endsAt = G.secs > 0 ? Date.now() + G.secs * 1000 : null;
    save();
    show('ask');
    renderAsk2();
    broadcast(true);
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
        if (G.phase === 'ask1') endAsk1(); else if (G.phase === 'ask2') doReveal();
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 5200);
      $('#timerFill').style.width = Math.max(0, (left / span) * 100) + '%';
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function runDebateClock() {
    clearInterval(clockTimer);
    var clock = $('#debateClock');
    if (!G.endsAt) { clock.textContent = '∞'; $('#debateFill').style.width = '100%'; return; }
    var span = Math.max(1, G.debateSecs * 1000);
    function tick() {
      var left = G.endsAt - Date.now();
      if (left <= 0) {
        clearInterval(clockTimer);
        clock.textContent = '0';
        $('#debateFill').style.width = '0%';
        if (G.phase === 'debate') endDebate();
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      $('#debateFill').style.width = Math.max(0, (left / span) * 100) + '%';
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function doReveal() {
    clearInterval(clockTimer);
    G.phase = 'reveal';
    G.endsAt = null;
    var q = currentQ();
    var before = avg(G.votes1), after = avg(G.votes2);
    var winner = null;
    if (before !== null && after !== null && q.debaterA && q.debaterB) {
      var posA = G.votes1[q.debaterA], posB = G.votes1[q.debaterB];
      var delta = after - before;
      var EPS = 3;
      if (Math.abs(delta) > EPS) winner = delta > 0 ? q.debaterB : q.debaterA;
      if (winner) { var wp = playerById(winner); if (wp) wp.pts += 2; }
    }
    q.winner = winner;
    var shifts = {};
    Object.keys(G.votes1).forEach(function (id) {
      if (G.votes2[id] !== undefined) shifts[id] = Math.abs(G.votes2[id] - G.votes1[id]);
    });
    G.history.push({
      t: q.t, p: q.p, debaterA: q.debaterA, debaterB: q.debaterB,
      posA: q.debaterA ? G.votes1[q.debaterA] : null, posB: q.debaterB ? G.votes1[q.debaterB] : null,
      before: before, after: after, winner: winner, shifts: shifts
    });
    save();
    show('reveal');
    renderReveal();
    broadcast(true);
    A.music('lobby');
    A.sfx('reveal');
    if (winner) setTimeout(function () { A.sfx('winner'); }, 950);
  }

  function nextRound() {
    if (G.round + 1 >= G.total) {
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
    startAsk1();
  }

  function playAgain() {
    G.phase = 'lobby';
    G.round = 0; G.votes1 = {}; G.votes2 = {}; G.endsAt = null; G.history = [];
    G.players.forEach(function (p) { p.pts = 0; });
    save();
    show('lobby'); renderLobby(); renderPacks(); broadcast(true);
    A.music('lobby');
  }

  /* ------------------------------------------------------------------ */
  /* awards                                                              */
  /* ------------------------------------------------------------------ */
  function computeAwards() {
    if (G.players.length < 3 || !G.history.length) return [];
    var wins = {}, shiftSum = {}, shiftN = {};
    G.history.forEach(function (h) {
      if (h.winner) wins[h.winner] = (wins[h.winner] || 0) + 1;
      Object.keys(h.shifts || {}).forEach(function (id) {
        shiftSum[id] = (shiftSum[id] || 0) + h.shifts[id];
        shiftN[id] = (shiftN[id] || 0) + 1;
      });
    });
    var awards = [];
    var bestWinner = null, bestWinN = 0;
    Object.keys(wins).forEach(function (id) {
      if (!playerById(id)) return;
      if (wins[id] > bestWinN) { bestWinN = wins[id]; bestWinner = id; }
    });
    if (bestWinner) {
      awards.push({ t: 'Most Convincing', p: bestWinner, c: '#ffd23f',
        d: 'Won ' + bestWinN + ' of ' + G.history.length + ' debates' });
    }
    var stillestId = null, stillestAvg = Infinity;
    Object.keys(shiftSum).forEach(function (id) {
      if (!playerById(id) || !shiftN[id]) return;
      var a = shiftSum[id] / shiftN[id];
      if (a < stillestAvg) { stillestAvg = a; stillestId = id; }
    });
    if (stillestId !== null) {
      awards.push({ t: 'Immovable Object', p: stillestId, c: '#22e6ff',
        d: 'Moved just ' + stillestAvg.toFixed(1) + ' points on average, no matter the argument' });
    }
    return awards;
  }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */
  function setAccent(packId) {
    var info = MLT.htdPackInfo(packId);
    document.documentElement.style.setProperty('--accent', info.accent);
    return info;
  }

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
        new QRCode(box, { text: joinUrl(), width: 164, height: 164, colorDark: '#05040e', colorLight: '#ffffff' });
      }
    } catch (e) {}
  }

  function renderLobby() {
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
    $('#btnStart').disabled = G.players.length < 3;
    $('#lobbyHint').textContent = G.players.length < 3
      ? 'Waiting for people to join… you need at least 3.'
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
        onclick: function () { G.host = (G.host === p.id) ? null : p.id; save(); renderLobby(); broadcast(true); }
      }));
    });
    if (G.host) {
      wrap.appendChild(el('button', {
        class: 'ghost mini', text: 'None',
        onclick: function () { G.host = null; save(); renderLobby(); broadcast(true); }
      }));
    }
    $('#hostPickHint').textContent = G.host
      ? nameOf(G.host) + "'s phone can now drive the game — you can walk away from this screen."
      : 'Tap a name to hand the game controls to that phone, so you can play along without standing at this screen.';
  }

  function renderPacks() {
    var box = $('#packs');
    box.innerHTML = '';
    MLT.HTD_PACKS.forEach(function (p) {
      var on = G.packs.indexOf(p.id) >= 0;
      box.appendChild(el('button', {
        class: 'pack', 'aria-pressed': on ? 'true' : 'false', 'data-pack': p.id,
        style: '--pc:' + p.accent,
        onclick: function () {
          var i = G.packs.indexOf(p.id);
          if (i >= 0) G.packs.splice(i, 1); else G.packs.push(p.id);
          save(); renderPacks();
        }
      }, [
        el('span', { class: 'em', text: p.emoji }),
        el('span', { text: p.name }),
        el('span', { class: 'n', text: String(p.items.length) })
      ]));
    });
    var fresh = poolFromPacks(false).length;
    $('#qcount').textContent = fresh
      ? fresh + ' unused statements ready' + (G.packs.length ? ' · ' + G.packs.length + ' pack' + (G.packs.length > 1 ? 's' : '') : '')
      : 'Pick at least one pack.';
  }

  function renderAsk1() {
    var q = currentQ();
    var info = setAccent(q.p);
    $('#qBanner').textContent = info.emoji + '  ' + info.name;
    $('#qProgress').textContent = 'Q' + (G.round + 1) + ' / ' + G.total;
    $('#qText').textContent = q.t;
    $('#legLabel').textContent = 'First vote';
    $('#btnReveal').textContent = 'Reveal spread';
    $('#votedCount').textContent = Object.keys(G.votes1).length;
    $('#votedTotal').textContent = G.players.length;

    var box = $('#askPlayers');
    box.innerHTML = '';
    G.players.forEach(function (p, i) {
      box.appendChild(el('span', { class: 'chip' + (G.votes1[p.id] !== undefined ? ' voted' : '') }, [
        avatar(p.name, i), el('span', { text: p.name })
      ]));
    });
  }

  function renderAsk2() {
    var q = currentQ();
    var info = setAccent(q.p);
    $('#qBanner').textContent = info.emoji + '  ' + info.name;
    $('#qProgress').textContent = 'Q' + (G.round + 1) + ' / ' + G.total;
    $('#qText').textContent = q.t;
    $('#legLabel').textContent = 'Re-vote — after hearing them argue it out';
    $('#btnReveal').textContent = 'Reveal result';
    $('#votedCount').textContent = Object.keys(G.votes2).length;
    $('#votedTotal').textContent = G.players.length;

    var box = $('#askPlayers');
    box.innerHTML = '';
    G.players.forEach(function (p, i) {
      box.appendChild(el('span', { class: 'chip' + (G.votes2[p.id] !== undefined ? ' voted' : '') }, [
        avatar(p.name, i), el('span', { text: p.name })
      ]));
    });
  }

  function renderSpectrum(node, votes, highlightA, highlightB) {
    node.innerHTML = '';
    // Players who land on the same (or nearly the same) value would otherwise
    // draw exactly on top of one another, hiding all but one dot and mashing
    // their name labels into an unreadable overlap. Cluster close values and
    // spread that cluster vertically (growing the track so the extra rows
    // and their labels have room) so every dot and label stays legible.
    var ROW = 34;
    var ids = G.players.map(function (p) { return p.id; }).filter(function (id) { return votes[id] !== undefined; });
    var groups = {};
    ids.forEach(function (id) {
      var key = Math.round(votes[id] / 4);
      (groups[key] = groups[key] || []).push(id);
    });
    var maxGroup = 1;
    Object.keys(groups).forEach(function (k) { if (groups[k].length > maxGroup) maxGroup = groups[k].length; });
    var track = el('div', { class: 'htd-track', style: maxGroup > 1 ? 'height:' + (50 + (maxGroup - 1) * ROW) + 'px' : '' });
    node.appendChild(track);
    ids.forEach(function (id) {
      var p = playerById(id);
      if (!p) return;
      var group = groups[Math.round(votes[id] / 4)];
      var i = group.indexOf(id);
      var vOffset = group.length > 1 ? (i - (group.length - 1) / 2) * ROW : 0;
      var isA = id === highlightA, isB = id === highlightB;
      var dot = el('div', {
        class: 'htd-dot' + (isA || isB ? ' hot' : ''),
        style: 'left:' + votes[id] + '%;top:calc(50% + ' + vOffset + 'px);' + (isA ? 'background:#22e6ff;box-shadow:0 0 12px #22e6ff' : isB ? 'background:#ff2d95;box-shadow:0 0 12px #ff2d95' : '')
      }, [el('span', { class: 'htd-dot-label', text: p.name })]);
      track.appendChild(dot);
    });
    return track;
  }

  function addMark(track, cls, pct) {
    if (pct === null || pct === undefined) return;
    track.appendChild(el('div', { class: 'htd-mark ' + cls, style: 'left:' + pct + '%' }));
  }

  function renderDebate() {
    var q = currentQ();
    var info = setAccent(q.p);
    $('#dBanner').textContent = info.emoji + '  ' + info.name;
    $('#dText').textContent = q.t;
    renderSpectrum($('#dSpectrum'), G.votes1, q.debaterA, q.debaterB);
    if (q.debaterA && q.debaterB) {
      var ai = indexOfPlayer(q.debaterA), bi = indexOfPlayer(q.debaterB);
      $('#debaterA').innerHTML = '';
      $('#debaterA').appendChild(avatar(nameOf(q.debaterA), ai));
      $('#debaterA').appendChild(el('span', { text: nameOf(q.debaterA) }));
      $('#debaterB').innerHTML = '';
      $('#debaterB').appendChild(avatar(nameOf(q.debaterB), bi));
      $('#debaterB').appendChild(el('span', { text: nameOf(q.debaterB) }));
      $('#dPrompt').textContent = nameOf(q.debaterA) + ' vs ' + nameOf(q.debaterB) + ' — you two, argue your side. Everyone else, get ready to re-vote.';
    } else {
      $('#dPrompt').textContent = 'Not enough spread to pick a debate this round — moving straight to the re-vote.';
    }
    runDebateClock();
  }

  function renderReveal() {
    var q = currentQ();
    var info = setAccent(q.p);
    $('#rBanner').textContent = info.emoji + '  ' + info.name;
    $('#rText').textContent = q.t;
    var before = avg(G.votes1), after = avg(G.votes2);
    var track = renderSpectrum($('#rSpectrum'), G.votes1, q.debaterA, q.debaterB);
    addMark(track, 'before', before);
    addMark(track, 'after', after);

    if (q.winner) {
      $('#rWinner').textContent = nameOf(q.winner) + ' won the room over';
    } else if (before !== null && after !== null) {
      $('#rWinner').textContent = 'The room didn’t budge';
    } else {
      $('#rWinner').textContent = 'Not enough votes to call it';
    }
    $('#rProgress').textContent = 'Q' + (G.round + 1) + ' / ' + G.total;
    $('#btnNext').textContent = (G.round + 1 >= G.total) ? 'Final standings' : 'Next question';
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
        el('div', { class: 'sc', text: p.pts + (p.pts === 1 ? ' point' : ' points') })
      ]));
      var col2 = el('div', { class: 'col', style: 'color:' + col }, [el('div', { class: 'rk', text: String(rank + 1) })]);
      slot.appendChild(col2);
      node.appendChild(slot);
      setTimeout(function () { col2.style.height = heights[rank] + 'px'; }, 120 + rank * 160);
    });
  }

  function renderFinal() {
    MLT.renderPlaylistCTA({ playlist: PLAYLIST, code: G.code, send: function (m) { if (bus) bus.send(m); } });
    var sorted = G.players.slice().sort(function (a, b) { return b.pts - a.pts; });
    renderPodium($('#podium'), sorted);

    var lb = $('#lb');
    lb.innerHTML = '';
    sorted.slice(3).forEach(function (p, i) {
      lb.appendChild(el('div', { class: 'lbrow' }, [
        el('div', { class: 'rank', text: String(i + 4) }),
        el('div', { class: 'name' }, [avatar(p.name, indexOfPlayer(p.id)), el('span', { text: p.name })]),
        el('div', { class: 'pts', text: p.pts + (p.pts === 1 ? ' pt' : ' pts') })
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

    $('#finalTitle').textContent = sorted.length && sorted[0].pts
      ? sorted[0].name + ' won the room every time'
      : 'Final standings';

    document.documentElement.style.setProperty('--accent', '#ffd23f');
    MLT.confetti(sorted.slice(0, 3).map(function (p) { return MLT.colorFor(indexOfPlayer(p.id)); }));
  }

  function renderAll() {
    if (G.phase === 'lobby') renderLobby();
    else if (G.phase === 'ask1') renderAsk1();
    else if (G.phase === 'ask2') renderAsk2();
    else if (G.phase === 'debate') renderDebate();
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
  $('#packAll').addEventListener('click', function () { G.packs = MLT.HTD_PACKS.map(function (p) { return p.id; }); save(); renderPacks(); });
  $('#packNone').addEventListener('click', function () { G.packs = []; save(); renderPacks(); });
  $('#btnForget').addEventListener('click', function () { saveSeen([]); renderPacks(); MLT.toast('Statement history cleared'); });
  $('#secs').addEventListener('change', function () { var v = parseInt($('#secs').value, 10); G.secs = isNaN(v) ? 20 : v; save(); });
  $('#debateSecs').addEventListener('change', function () { var v = parseInt($('#debateSecs').value, 10); G.debateSecs = isNaN(v) ? DEBATE_SECS : v; save(); });
  $('#btnReveal').addEventListener('click', function () {
    if (G.phase === 'ask1') endAsk1(); else if (G.phase === 'ask2') doReveal();
  });
  $('#btnSkipDebate').addEventListener('click', function () { if (G.phase === 'debate') endDebate(); });
  $('#btnNext').addEventListener('click', nextRound);
  $('#btnAgain').addEventListener('click', playAgain);
  $('#btnHome').addEventListener('click', newRoom);

  $('#rounds').value = String(G.total);
  if ($('#rounds').selectedIndex < 0) $('#rounds').value = '10';
  if (PLAYLIST_MODE) {
    var firstOpt = $('#rounds').options[0];
    if (firstOpt) { $('#rounds').value = firstOpt.value; }
    $('#rounds').dispatchEvent(new Event('change'));
  }
  $('#secs').value = String(G.secs);
  if ($('#secs').selectedIndex < 0) $('#secs').value = '20';
  $('#debateSecs').value = String(G.debateSecs);
  if ($('#debateSecs').selectedIndex < 0) $('#debateSecs').value = String(DEBATE_SECS);
  renderPacks();

  if (PLAYLIST_MODE) newRoom((MLT.qs('r') || '').toUpperCase());
  else if (wantNew) newRoom();
  else if (saved && (saved.phase === 'ask1' || saved.phase === 'ask2' || saved.phase === 'debate' || saved.phase === 'reveal')) enterRoom();
  else openStart();

  window.addEventListener('beforeunload', save);
  window.__HG = G;
})();

(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SAVE = 'cw.host.v1';
  var ACCENT = '#22e6ff';
  var LETTERS = ['A', 'B', 'C', 'D'];

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  function blankGame() {
    return {
      code: randomCode(), seq: 0, phase: 'lobby',
      round: 0, total: 15, secs: 20, showVoters: true,
      packs: MLT.CW_PACKS.map(function (p) { return p.id; }),
      questions: [],
      players: [], votes: {}, endsAt: null,
      history: [], host: null, lastCmd: 0, lastActivity: Date.now()
    };
  }

  var saved = MLT.store(SAVE);
  var G = saved || blankGame();
  if (!G.packs || !G.packs.length) G.packs = MLT.CW_PACKS.map(function (p) { return p.id; });
  if (!G.questions) G.questions = [];
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
    G.votes = {};
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
    window.__CWG = G;
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
    show(G.phase === 'ask' ? 'ask' : G.phase === 'reveal' ? 'reveal' : G.phase === 'final' ? 'final' : 'lobby');
    renderAll();
    makeQR();
    if (G.phase === 'ask') runClock();
    broadcast(true);
    A.ready();
    A.music(G.phase === 'ask' ? 'round' : 'lobby');
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

  function currentQ() { return G.questions[G.round] || { q: '', options: [], correct: 0 }; }

  function poolFromPacks() {
    var pool = [];
    MLT.CW_PACKS.forEach(function (pk) {
      if (G.packs.indexOf(pk.id) < 0) return;
      pk.items.forEach(function (it) { pool.push(it); });
    });
    return pool;
  }

  function publicState() {
    var q = currentQ();
    var s = {
      phase: G.phase, round: G.round, total: G.total,
      players: G.players.map(function (p) { return { id: p.id, name: p.name, pts: p.pts }; }),
      showVoters: !!G.showVoters,
      host: G.host || null
    };
    if (G.phase === 'ask' || G.phase === 'reveal') {
      s.q = q.q;
      s.options = q.options;
    }
    if (G.phase === 'ask') {
      s.voted = Object.keys(G.votes);
    } else if (G.phase === 'reveal') {
      s.correct = q.correct;
      s.votes = G.votes;
      s.counts = optionCounts(q);
    } else if (G.phase === 'final') {
      s.awards = computeAwards();
    }
    return s;
  }

  function optionCounts(q) {
    var counts = new Array((q.options || []).length).fill(0);
    Object.keys(G.votes).forEach(function (voter) {
      var v = G.votes[voter];
      if (counts[v.a] !== undefined) counts[v.a]++;
    });
    return counts;
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
      if (d === 'start') { if (G.phase === 'lobby' && G.players.length >= 2 && poolFromPacks().length >= 1) startGame(); }
      else if (d === 'reveal') { if (G.phase === 'ask') doReveal(); }
      else if (d === 'skip') { if (G.phase === 'ask') skipRound(); }
      else if (d === 'next') { if (G.phase === 'reveal') nextRound(); }
      else if (d === 'timer+') { if (G.phase === 'ask') adjustTimer(5); }
      else if (d === 'timer-') { if (G.phase === 'ask') adjustTimer(-5); }
      else if (d === 'timerOff') { if (G.phase === 'ask') toggleNoTimer(); }
      else if (d === 'again') { if (G.phase === 'final') playAgain(); }

    } else if (m.t === 'vote') {
      if (G.phase !== 'ask' || m.round !== G.round) return;
      if (!playerById(m.from)) return;
      var pick = m.pick || {};
      var q = currentQ();
      var a = parseInt(pick.a, 10), w = parseInt(pick.w, 10);
      if (isNaN(a) || a < 0 || a >= q.options.length) return;
      if ([1, 2, 3].indexOf(w) < 0) return;
      var prev = G.votes[m.from];
      if (prev && prev.a === a && prev.w === w) return;
      G.votes[m.from] = { a: a, w: w };
      A.sfx('pick');
      save(); renderAsk();
      if (Object.keys(G.votes).length >= G.players.length && G.players.length > 0) {
        setTimeout(function () { if (G.phase === 'ask') doReveal(); }, 700);
      } else {
        broadcast(false);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* flow                                                                */
  /* ------------------------------------------------------------------ */
  function startGame() {
    var desired = parseInt($('#rounds').value, 10) || G.total || 15;
    var s = parseInt($('#secs').value, 10);
    if (!isNaN(s)) G.secs = s;
    G.showVoters = $('#showVoters').checked;
    var pool = MLT.shuffle(poolFromPacks());
    G.total = Math.min(desired, pool.length);
    G.questions = pool.slice(0, G.total);
    G.round = 0;
    G.history = [];
    G.players.forEach(function (p) { p.pts = 0; });
    startRound();
  }

  function startRound() {
    G.phase = 'ask';
    G.votes = {};
    G.endsAt = G.secs > 0 ? Date.now() + G.secs * 1000 : null;
    save();
    show('ask');
    renderAsk();
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
        if (G.phase === 'ask') doReveal();
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
    G.secs = Math.max(5, Math.min(600, (G.secs > 0 ? G.secs : 0) + delta));
    if (G.phase === 'ask') {
      G.endsAt = (wasOff || !G.endsAt)
        ? Date.now() + G.secs * 1000
        : Math.max(Date.now() + 2000, G.endsAt + delta * 1000);
      runClock();
    }
    save(); renderAsk(); broadcast(true);
  }

  function toggleNoTimer() {
    if (G.secs > 0) {
      G.prevSecs = G.secs; G.secs = 0; G.endsAt = null;
    } else {
      G.secs = G.prevSecs || 20;
      if (G.phase === 'ask') G.endsAt = Date.now() + G.secs * 1000;
    }
    if (G.phase === 'ask') runClock();
    save(); renderAsk(); broadcast(true);
  }

  function doReveal() {
    clearInterval(clockTimer);
    G.phase = 'reveal';
    G.endsAt = null;
    var q = currentQ();
    var correctVoters = [], wrongVoters = [];
    Object.keys(G.votes).forEach(function (voter) {
      var v = G.votes[voter];
      var p = playerById(voter);
      if (!p) return;
      if (v.a === q.correct) { p.pts += v.w; correctVoters.push({ id: voter, w: v.w }); }
      else { p.pts -= v.w; wrongVoters.push({ id: voter, w: v.w }); }
    });
    G.history.push({
      q: q.q, options: q.options, correct: q.correct,
      counts: optionCounts(q), correctVoters: correctVoters, wrongVoters: wrongVoters
    });
    save();
    show('reveal');
    renderReveal(q);
    broadcast(true);
    A.music('lobby');
    A.sfx('reveal');
    if (correctVoters.length > 0) setTimeout(function () { A.sfx('winner'); }, 950);
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
    startRound();
  }

  function skipRound() {
    if (G.phase !== 'ask') return;
    clearInterval(clockTimer);
    G.votes = {};
    if (G.round + 1 >= G.questions.length) { doReveal(); return; }
    G.questions.splice(G.round, 1);
    if (G.total > G.questions.length) G.total = G.questions.length;
    startRound();
  }

  function playAgain() {
    G.phase = 'lobby';
    G.round = 0; G.votes = {}; G.endsAt = null; G.history = [];
    G.questions = [];
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
    var right = {}, lost = {};
    G.history.forEach(function (h) {
      h.correctVoters.forEach(function (v) { right[v.id] = (right[v.id] || 0) + 1; });
      h.wrongVoters.forEach(function (v) { lost[v.id] = (lost[v.id] || 0) + v.w; });
    });
    function topOf(map) {
      var wid = null, wn = 0;
      Object.keys(map).forEach(function (id) {
        if (!playerById(id)) return;
        if (map[id] > wn) { wn = map[id]; wid = id; }
      });
      return wn > 0 ? { id: wid, n: wn } : null;
    }
    var awards = [];
    var steady = topOf(right);
    if (steady) {
      awards.push({ t: 'Steady Hand', p: steady.id, c: '#3dff9e',
        d: 'Got ' + steady.n + (steady.n === 1 ? ' question' : ' questions') + ' right' });
    }
    var wrong = topOf(lost);
    if (wrong) {
      awards.push({ t: 'Confidently Wrong', p: wrong.id, c: '#ff8a3d',
        d: 'Lost ' + wrong.n + (wrong.n === 1 ? ' point' : ' points') + ' betting big on the wrong answer' });
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
    $('#btnStart').disabled = G.players.length < 2 || avail < 1;
    $('#lobbyHint').textContent = G.players.length < 2
      ? 'Waiting for people to join… you need at least 2.'
      : avail < 1
        ? 'Pick at least one question pack in Settings.'
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
      ? nameOf(G.host) + "'s phone can now start, skip and advance the game — you can walk away from this screen."
      : 'Tap a name to hand the game controls to that phone, so you can play along without standing at this screen.';
  }

  function renderPacks() {
    var box = $('#packs');
    if (!box) return;
    box.innerHTML = '';
    MLT.CW_PACKS.forEach(function (p) {
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
      ? avail + ' question' + (avail === 1 ? '' : 's') + ' ready' + (G.packs.length ? ' · ' + G.packs.length + ' pack' + (G.packs.length > 1 ? 's' : '') : '')
      : 'Pick at least one pack.';
  }

  function renderAsk() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var q = currentQ();
    $('#qProgress').textContent = 'Q' + (G.round + 1) + ' / ' + G.total;
    $('#qText').textContent = q.q;
    $('#votedCount').textContent = Object.keys(G.votes).length;
    $('#votedTotal').textContent = G.players.length;
    $('#secsNow').textContent = G.secs > 0 ? G.secs + 's per round' : 'no countdown';
    $('#btnNoTimer').textContent = G.secs > 0 ? 'No timer' : 'Timer on';
    $('#btnMinus').disabled = !(G.secs > 5);

    var box = $('#askPlayers');
    box.innerHTML = '';
    G.players.forEach(function (p, i) {
      box.appendChild(el('span', { class: 'chip' + (G.votes[p.id] ? ' voted' : '') }, [
        avatar(p.name, i), el('span', { text: p.name })
      ]));
    });
  }

  function renderOptBars(node, q, counts, votesMap) {
    node.innerHTML = '';
    var max = Math.max(1, counts.reduce(function (a, b) { return Math.max(a, b); }, 0));
    q.options.forEach(function (opt, idx) {
      var isCorrect = idx === q.correct;
      var n = counts[idx] || 0;
      var voters = [];
      if (votesMap) {
        Object.keys(votesMap).forEach(function (id) {
          if (votesMap[id].a === idx) voters.push(nameOf(id));
        });
      }
      var col = isCorrect ? '#3dff9e' : MLT.colorFor(idx);
      var fill = el('i', { style: 'background:' + col + ';color:' + col });
      var trackWrap = el('div', { style: 'grid-column:1 / -1;margin-top:2px' }, [el('div', { class: 'track' }, [fill])]);
      if (G.showVoters && voters.length) {
        trackWrap.appendChild(el('div', { class: 'voters', text: voters.join(', ') }));
      }
      var otext = el('div', { class: 'otext', style: 'display:flex;align-items:center;gap:10px' }, [
        el('span', { text: opt }),
        isCorrect ? el('span', { class: 'tag', style: 'color:#3dff9e', text: '✓ correct' }) : null
      ]);
      var numNode = el('div', { class: 'n', text: '0' });
      var row = el('div', { class: 'cw-optbar' + (isCorrect ? ' correct' : '') }, [
        el('span', { class: 'letter', text: LETTERS[idx] }),
        otext,
        numNode,
        trackWrap
      ]);
      node.appendChild(row);
      setTimeout(function () {
        MLT.countUp(numNode, n, 500);
        fill.style.width = (n / max) * 100 + '%';
      }, 60);
    });
  }

  function renderReveal(q) {
    document.documentElement.style.setProperty('--accent', ACCENT);
    q = q || currentQ();
    $('#rText').textContent = q.q;

    var counts = optionCounts(q);
    var cast = Object.keys(G.votes).length;
    var correctCount = 0;
    Object.keys(G.votes).forEach(function (v) { if (G.votes[v].a === q.correct) correctCount++; });
    $('#rWinner').textContent = cast === 0
      ? 'Nobody locked in an answer — it was ' + LETTERS[q.correct] + ') ' + q.options[q.correct]
      : 'The answer was ' + LETTERS[q.correct] + ') ' + q.options[q.correct] + ' — ' + correctCount + ' of ' + cast + ' got it right';

    renderOptBars($('#rOptBars'), q, counts, G.votes);

    var deltas = $('#rDeltas');
    deltas.innerHTML = '';
    G.players.forEach(function (p, i) {
      var v = G.votes[p.id];
      var kids = [avatar(p.name, i), el('span', { text: p.name })];
      if (v) {
        var right = v.a === q.correct;
        kids.push(el('span', {
          class: 'tag', style: 'color:' + (right ? '#3dff9e' : '#ff2d95'),
          text: (right ? '+' : '−') + v.w
        }));
      } else {
        kids.push(el('span', { class: 'tag', style: 'color:var(--dimmer)', text: 'sat out' }));
      }
      deltas.appendChild(el('span', { class: 'chip' }, kids));
    });

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

    $('#finalTitle').textContent = sorted.length && sorted[0].pts > 0
      ? sorted[0].name + " called it best"
      : 'Final standings';

    MLT.confetti(sorted.slice(0, 3).map(function (p) { return MLT.colorFor(indexOfPlayer(p.id)); }));
  }

  function renderAll() {
    if (G.phase === 'lobby') renderLobby();
    else if (G.phase === 'ask') renderAsk();
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
  $('#showVoters').addEventListener('change', function () {
    G.showVoters = $('#showVoters').checked; save(); broadcast(true);
  });
  $('#packAll').addEventListener('click', function () {
    G.packs = MLT.CW_PACKS.map(function (p) { return p.id; });
    save(); renderPacks(); renderLobby();
  });
  $('#packNone').addEventListener('click', function () { G.packs = []; save(); renderPacks(); renderLobby(); });
  $('#rounds').addEventListener('change', function () {
    G.total = parseInt($('#rounds').value, 10) || G.total || 15;
    save();
  });
  $('#secs').addEventListener('change', function () {
    var v = parseInt($('#secs').value, 10);
    G.secs = isNaN(v) ? 20 : v;
    save();
  });
  $('#btnMinus').addEventListener('click', function () { adjustTimer(-5); });
  $('#btnPlus').addEventListener('click', function () { adjustTimer(5); });
  $('#btnNoTimer').addEventListener('click', toggleNoTimer);
  $('#btnReveal').addEventListener('click', function () { if (G.phase === 'ask') doReveal(); });
  $('#btnSkip').addEventListener('click', skipRound);
  $('#btnNext').addEventListener('click', nextRound);
  $('#btnAgain').addEventListener('click', playAgain);
  $('#btnHome').addEventListener('click', newRoom);

  $('#rounds').value = String(G.total);
  if ($('#rounds').selectedIndex < 0) $('#rounds').value = '15';
  if (PLAYLIST_MODE) {
    var firstOpt = $('#rounds').options[0];
    if (firstOpt) { $('#rounds').value = firstOpt.value; }
    $('#rounds').dispatchEvent(new Event('change'));
  }
  $('#secs').value = String(G.secs);
  if ($('#secs').selectedIndex < 0) $('#secs').value = '20';
  $('#showVoters').checked = !!G.showVoters;
  renderPacks();

  if (PLAYLIST_MODE) newRoom((MLT.qs('r') || '').toUpperCase());
  else if (wantNew) newRoom();
  else if (saved && (saved.phase === 'ask' || saved.phase === 'reveal')) enterRoom();
  else openStart();

  window.addEventListener('beforeunload', save);
  window.__CWG = G;
})();

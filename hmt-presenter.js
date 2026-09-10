(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SAVE = 'hmt.host.v1';
  var ACCENT = '#ff8a3d';

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  function blankGame() {
    return {
      code: randomCode(), seq: 0, phase: 'lobby',
      round: 0, total: 10, secs: 20, showVoters: true,
      facts: {}, questions: [],
      players: [], votes: {}, endsAt: null,
      history: [], host: null, lastCmd: 0, lastActivity: Date.now()
    };
  }

  var saved = MLT.store(SAVE);
  var G = saved || blankGame();
  if (!G.facts) G.facts = {};
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

  /* Fisher-Yates — this page doesn't load questions.js or wyr.js, so this
     small generic helper (same shape as questions.js's) lives here too. */
  if (!MLT.shuffle) {
    MLT.shuffle = function (a, rnd) {
      a = a.slice();
      rnd = rnd || Math.random;
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(rnd() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };
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
    G.votes = {};
    G.endsAt = null;
    G.players = [];
    G.facts = {};
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
    window.__HMG = G;
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
      $('#startHint').textContent = 'Creating a new room clears the players and the facts they wrote. Scores are remembered either way.';
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

  function currentQ() { return G.questions[G.round] || { t: '', authorId: null }; }

  function factCounts() {
    var out = {};
    G.players.forEach(function (p) { out[p.id] = (G.facts[p.id] || []).length; });
    return out;
  }
  function totalFacts() {
    var n = 0;
    Object.keys(G.facts).forEach(function (id) { n += G.facts[id].length; });
    return n;
  }
  function factPool() {
    var pool = [];
    Object.keys(G.facts).forEach(function (id) {
      G.facts[id].forEach(function (f) { pool.push({ t: f.t, authorId: id }); });
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
    if (G.phase === 'lobby') {
      s.factCounts = factCounts();
      s.factTarget = Math.max(1, Math.ceil(G.total / Math.max(1, G.players.length)));
    }
    if (G.phase === 'ask' || G.phase === 'reveal') {
      s.t = q.t;
      s.authorId = q.authorId;
    }
    if (G.phase === 'ask') {
      s.voted = Object.keys(G.votes);
    } else if (G.phase === 'reveal') {
      s.votes = G.votes;
      s.tally = tally();
    } else if (G.phase === 'final') {
      s.awards = computeAwards();
    }
    return s;
  }

  function tally() {
    var counts = {};
    G.players.forEach(function (p) { counts[p.id] = 0; });
    Object.keys(G.votes).forEach(function (voter) {
      var target = G.votes[voter];
      if (counts[target] !== undefined) counts[target]++;
    });
    return G.players.map(function (p) { return { id: p.id, n: counts[p.id] }; })
      .sort(function (a, b) { return b.n - a.n; });
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

    } else if (m.t === 'fact') {
      if (G.phase !== 'lobby') return;
      if (!playerById(m.from)) return;
      var text = String(m.text || '').trim().slice(0, 140);
      if (text.length < 3) return;
      var list = G.facts[m.from] || (G.facts[m.from] = []);
      if (list.length >= 6) return;
      if (list.some(function (f) { return f.t.toLowerCase() === text.toLowerCase(); })) return;
      list.push({ t: text });
      A.sfx('blip');
      save(); renderLobby(); broadcast(true);

    } else if (m.t === 'cmd') {
      if (!G.host || m.from !== G.host) return;
      if (!(m.n > G.lastCmd)) return;
      G.lastCmd = m.n;
      save();
      var d = m.do;
      if (d === 'start') { if (G.phase === 'lobby' && G.players.length >= 3 && totalFacts() >= 3) startGame(); }
      else if (d === 'reveal') { if (G.phase === 'ask') doReveal(); }
      else if (d === 'skip') { if (G.phase === 'ask') skipRound(); }
      else if (d === 'next') { if (G.phase === 'reveal') nextRound(); }
      else if (d === 'timer+') { if (G.phase === 'ask') adjustTimer(5); }
      else if (d === 'timer-') { if (G.phase === 'ask') adjustTimer(-5); }
      else if (d === 'timerOff') { if (G.phase === 'ask') toggleNoTimer(); }
      else if (d === 'again') { if (G.phase === 'final') playAgain(); }

    } else if (m.t === 'vote') {
      if (G.phase !== 'ask' || m.round !== G.round) return;
      var q = currentQ();
      if (m.from === q.authorId) return;                /* can't guess your own fact */
      if (!playerById(m.from) || !playerById(m.pick)) return;
      if (G.votes[m.from] === m.pick) return;
      G.votes[m.from] = m.pick;
      A.sfx('pick');
      save(); renderAsk();
      var eligible = G.players.length - (playerById(q.authorId) ? 1 : 0);
      if (Object.keys(G.votes).length >= eligible && eligible > 0) {
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
    var desired = parseInt($('#rounds').value, 10) || G.total || 10;
    var s = parseInt($('#secs').value, 10);
    if (!isNaN(s)) G.secs = s;
    G.showVoters = $('#showVoters').checked;
    var pool = MLT.shuffle(factPool());
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
    var t = tally();
    var cast = Object.keys(G.votes).length;
    var correctCount = 0;
    var correctVoters = [], wrongVoters = [];
    Object.keys(G.votes).forEach(function (voter) {
      if (G.votes[voter] === q.authorId) { correctCount++; correctVoters.push(voter); }
      else wrongVoters.push(voter);
    });
    if (cast > 0) {
      correctVoters.forEach(function (id) { var p = playerById(id); if (p) p.pts += 1; });
      var author = playerById(q.authorId);
      if (author && wrongVoters.length > 0) author.pts += wrongVoters.length;
    }
    G.history.push({ t: q.t, authorId: q.authorId, correctVoters: correctVoters, wrongVoters: wrongVoters, tally: t });
    save();
    show('reveal');
    renderReveal(t, q);
    broadcast(true);
    A.music('lobby');
    A.sfx('reveal');
    if (cast > 0) setTimeout(function () { A.sfx('winner'); }, 950);
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
    var caught = {}, fooled = {};
    G.history.forEach(function (h) {
      h.correctVoters.forEach(function (id) { caught[id] = (caught[id] || 0) + 1; });
      if (h.wrongVoters.length) fooled[h.authorId] = (fooled[h.authorId] || 0) + h.wrongVoters.length;
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
    var eye = topOf(caught);
    if (eye) {
      awards.push({ t: 'Know Your People', p: eye.id, c: '#22e6ff',
        d: 'Correctly guessed ' + eye.n + (eye.n === 1 ? ' time' : ' times') });
    }
    var legend = topOf(fooled);
    if (legend) {
      awards.push({ t: 'Local Legend', p: legend.id, c: '#ff8a3d',
        d: 'Stumped the room ' + legend.n + (legend.n === 1 ? ' time' : ' times') + ' — a real mystery' });
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

    var target = Math.max(1, Math.ceil((parseInt($('#rounds').value, 10) || G.total) / Math.max(1, G.players.length)));
    var counts = factCounts();
    var box = $('#lobbyPlayers');
    box.innerHTML = '';
    G.players.forEach(function (p, i) {
      var n = counts[p.id] || 0;
      var kids = [avatar(p.name, i), el('span', { text: p.name })];
      kids.push(el('span', { class: 'tag', style: n >= target ? 'color:#3dff9e' : '', text: n + ' fact' + (n === 1 ? '' : 's') }));
      if (G.host === p.id) kids.push(el('span', { class: 'tag', text: '· remote' }));
      box.appendChild(el('span', { class: 'chip' + (G.host === p.id ? ' remote' : '') }, kids));
    });
    renderHostPick();
    $('#pcount').textContent = '(' + G.players.length + ')';
    var total = totalFacts();
    $('#factCount').textContent = total + ' fact' + (total === 1 ? '' : 's') + ' collected so far · aim for about ' + target + ' each';
    $('#btnStart').disabled = G.players.length < 3 || total < 3;
    $('#lobbyHint').textContent = G.players.length < 3
      ? 'Waiting for people to join… you need at least 3.'
      : total < 3
        ? 'Waiting on facts — need at least 3 collected.'
        : 'Everyone in and written something? Hit start.';
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

  function renderAsk() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var q = currentQ();
    $('#qProgress').textContent = 'Q' + (G.round + 1) + ' / ' + G.total;
    $('#qText').textContent = q.t;
    var eligible = G.players.length - (playerById(q.authorId) ? 1 : 0);
    $('#votedCount').textContent = Object.keys(G.votes).length;
    $('#votedTotal').textContent = eligible;
    $('#secsNow').textContent = G.secs > 0 ? G.secs + 's per round' : 'no countdown';
    $('#btnNoTimer').textContent = G.secs > 0 ? 'No timer' : 'Timer on';
    $('#btnMinus').disabled = !(G.secs > 5);

    var box = $('#askPlayers');
    box.innerHTML = '';
    G.players.forEach(function (p, i) {
      if (p.id === q.authorId) {
        box.appendChild(el('span', { class: 'chip', style: 'opacity:.55' }, [
          avatar(p.name, i), el('span', { text: p.name + " (it's theirs)" })
        ]));
        return;
      }
      box.appendChild(el('span', { class: 'chip' + (G.votes[p.id] ? ' voted' : '') }, [
        avatar(p.name, i), el('span', { text: p.name })
      ]));
    });
  }

  function renderReveal(t, q) {
    document.documentElement.style.setProperty('--accent', ACCENT);
    t = t || tally();
    q = q || currentQ();
    $('#rText').textContent = q.t;

    var cast = Object.keys(G.votes).length;
    var correctCount = 0;
    Object.keys(G.votes).forEach(function (v) { if (G.votes[v] === q.authorId) correctCount++; });
    $('#rWinner').textContent = cast === 0
      ? "Nobody voted — it's actually about " + nameOf(q.authorId)
      : "It's actually about " + nameOf(q.authorId) + ' — ' + correctCount + ' of ' + cast + ' got it right';

    var bars = $('#rBars');
    bars.innerHTML = '';
    var max = Math.max(1, t[0] ? t[0].n : 1);
    t.forEach(function (row) {
      var p = playerById(row.id);
      if (!p) return;
      var idx = indexOfPlayer(row.id);
      var col = MLT.colorFor(idx);
      var voters = Object.keys(G.votes)
        .filter(function (v) { return G.votes[v] === row.id; })
        .map(nameOf);
      var isAuthor = row.id === q.authorId;
      var fill = el('i', { style: 'background:' + col + ';color:' + col });
      var cell = el('div', {}, [el('div', { class: 'track' }, [fill])]);
      if (G.showVoters && voters.length) cell.appendChild(el('div', { class: 'voters', text: voters.join(', ') }));
      var num = el('div', { class: 'n', text: '0' });
      var whoKids = [avatar(p.name, idx), el('span', { text: p.name })];
      if (isAuthor) whoKids.push(el('span', { class: 'tag', style: 'color:#3dff9e', text: '✓ them' }));
      bars.appendChild(el('div', { class: 'bar', style: isAuthor ? 'outline:1px solid #3dff9e;border-radius:6px' : '' }, [
        el('div', { class: 'who' }, whoKids),
        cell, num
      ]));
      setTimeout(function () {
        fill.style.width = (row.n / max) * 100 + '%';
        MLT.countUp(num, row.n, 700);
      }, 60);
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
    document.documentElement.style.setProperty('--accent', '#ffd23f');
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
      ? sorted[0].name + " knows this room best"
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
  $('#rounds').addEventListener('change', function () {
    G.total = parseInt($('#rounds').value, 10) || G.total || 10;
    save(); renderLobby(); broadcast(true);
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
  if ($('#rounds').selectedIndex < 0) $('#rounds').value = '10';
  if (PLAYLIST_MODE) {
    var firstOpt = $('#rounds').options[0];
    if (firstOpt) { $('#rounds').value = firstOpt.value; }
    $('#rounds').dispatchEvent(new Event('change'));
  }
  $('#secs').value = String(G.secs);
  if ($('#secs').selectedIndex < 0) $('#secs').value = '20';
  $('#showVoters').checked = !!G.showVoters;

  if (PLAYLIST_MODE) newRoom((MLT.qs('r') || '').toUpperCase());
  else if (wantNew) newRoom();
  else if (saved && (saved.phase === 'ask' || saved.phase === 'reveal')) enterRoom();
  else openStart();

  window.addEventListener('beforeunload', save);
  window.__HMG = G;
  window.__hmtRenderLobby = renderLobby;
})();

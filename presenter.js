(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SAVE = 'mlt.host.v1';
  var SEEN = 'mlt.seen.v1';      /* survives "new room" so questions don't repeat */

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  function blankGame() {
    return {
      code: randomCode(), seq: 0, phase: 'lobby',
      round: 0, total: 15, secs: 20,
      showVoters: true, allowAdd: true,
      packs: MLT.PACKS.map(function (p) { return p.id; }),
      questions: [], players: [], votes: {}, endsAt: null,
      roomQ: [], history: [], host: null, lastCmd: 0, lastActivity: Date.now()
    };
  }

  var saved = MLT.store(SAVE);
  var G = saved || blankGame();
  if (!G.packs || !G.packs.length) G.packs = MLT.PACKS.map(function (p) { return p.id; });
  if (!G.roomQ) G.roomQ = [];
  if (!G.history) G.history = [];
  if (G.allowAdd === undefined) G.allowAdd = true;
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
  function loadSeen() { return MLT.store(SEEN) || []; }
  function saveSeen(a) { MLT.store(SEEN, a.slice(-600)); }
  function markSeen(text) {
    var s = loadSeen();
    if (s.indexOf(text) < 0) { s.push(text); saveSeen(s); }
  }

  /* ------------------------------------------------------------------ */
  /* transport                                                           */
  /* ------------------------------------------------------------------ */
  var bus = null;

  /* Connect (or reconnect) to this room's channel. */
  function connect() {
    if (bus) bus.close();
    clearTimeout(pubTimer);
    bus = MLT.createBus({ code: G.code, role: 'host' });
    $('#status').classList.remove('hidden');
    MLT.wireStatus(bus, $('#status'));
    bus.on(onBusMessage);
  }

  /* Tear down the current room's channel — tells anyone still connected,
     then wipes the retained state so nobody can join a dead room off an
     old QR code or link. */
  function teardownBus(announce) {
    clearTimeout(pubTimer);
    if (bus) {
      if (announce) bus.send({ t: 'closed' });
      bus.clearState();
      bus.close();
      bus = null;
    }
  }

  /* Fresh room: new code, empty lobby. Settings and question history stay. */
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
    G.roomQ = [];
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

  /* A room dies — nobody left in it, or it's been sitting untouched too
     long. Wipe it and send the host back to the front door rather than
     silently broadcasting into the void forever. */
  function closeRoom(reason) {
    teardownBus(true);
    clearInterval(clockTimer);
    MLT.store(SAVE, null);
    saved = null;
    G = blankGame();
    save();
    window.__G = G;
    openStart();
    if (reason) MLT.toast(reason);
  }

  /* Failsafe: a room nobody is using shouldn't sit open forever. Checked
     every minute; only bites once a room has gone quiet for hours. */
  var IDLE_LIMIT = 3 * 60 * 60 * 1000;
  setInterval(function () {
    if (!bus) return;
    if (Date.now() - (G.lastActivity || 0) > IDLE_LIMIT) closeRoom('Room timed out from inactivity');
  }, 60000);

  /* Go (back) into the saved room — used on a mid-game refresh. */
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
      $('#startHint').textContent = 'Creating a new room clears the players and the lobby. Scores and questions already used are remembered either way.';
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

  function currentQ() { return G.questions[G.round] || { t: '', p: 'classic' }; }

  function publicState() {
    var q = currentQ();
    var s = {
      phase: G.phase, round: G.round, total: G.total,
      q: q.t, qp: q.p, endsAt: G.endsAt, secs: G.secs,
      players: G.players.map(function (p) { return { id: p.id, name: p.name, pts: p.pts }; }),
      showVoters: !!G.showVoters,
      host: G.host || null
    };
    if (G.phase === 'ask' || G.phase === 'reveal') {
      var info = MLT.packInfo(q.p);
      s.pn = info.name; s.pe = info.emoji; s.pa = info.accent;
    }
    if (G.phase === 'lobby') {
      s.canAdd = !!G.allowAdd;
      s.roomQ = G.roomQ.length;
    } else if (G.phase === 'ask') {
      s.voted = Object.keys(G.votes);
    } else if (G.phase === 'reveal') {
      s.votes = G.votes;
      s.tally = tally();
    } else if (G.phase === 'final') {
      var a = computeAwards();
      s.awards = a.awards;
      s.moments = a.moments;
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
  /* awards — built from what each person actually got voted for         */
  /* ------------------------------------------------------------------ */
  function computeAwards() {
    var byPack = {}, totals = {}, best = {}, given = {};
    G.history.forEach(function (h) {
      var m = byPack[h.p] = byPack[h.p] || {};
      Object.keys(h.tally).forEach(function (pid) {
        var n = h.tally[pid];
        if (!n) return;
        m[pid] = (m[pid] || 0) + n;
        totals[pid] = (totals[pid] || 0) + n;
        if (!best[pid] || n > best[pid].n) best[pid] = { q: h.t, n: n };
      });
    });

    function winnerOf(map) {
      var wid = null, wn = 0;
      Object.keys(map).forEach(function (pid) {
        if (!playerById(pid)) return;
        var n = map[pid];
        if (n > wn || (n === wn && wid && (given[pid] || 0) < (given[wid] || 0))) { wn = n; wid = pid; }
      });
      return wn > 0 ? { pid: wid, n: wn } : null;
    }

    var awards = [];
    var overall = winnerOf(totals);
    if (overall) {
      awards.push({ t: 'Most Likely To Ever', p: overall.pid, c: '#ffd23f',
        d: overall.n + ' picks across the whole night' });
      given[overall.pid] = (given[overall.pid] || 0) + 1;
    }

    Object.keys(byPack).forEach(function (packId) {
      var info = MLT.packInfo(packId);
      var w = winnerOf(byPack[packId]);
      if (!w) return;
      awards.push({ t: info.title, p: w.pid, c: info.accent,
        d: info.emoji + ' ' + info.name + ' · ' + w.n + (w.n === 1 ? ' pick' : ' picks') });
      given[w.pid] = (given[w.pid] || 0) + 1;
    });

    if (G.players.length > 2) {
      var low = null;
      G.players.forEach(function (p) {
        var n = totals[p.id] || 0;
        if (low === null || n < low.n) low = { pid: p.id, n: n };
      });
      if (low) {
        awards.push({ t: 'Untouchable', p: low.pid, c: '#22e6ff',
          d: low.n === 0 ? 'Not picked once all night' : 'Only ' + low.n + ' picks — suspiciously clean' });
      }
    }

    var moments = G.players.slice(0, 10).map(function (p) {
      var b = best[p.id];
      return b ? { p: p.id, q: String(b.q).slice(0, 78), n: b.n } : null;
    }).filter(Boolean).sort(function (a, b) { return b.n - a.n; });

    return { awards: awards, moments: moments };
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
        /* Everyone's gone — don't leave the room open forever. Checked
           before any rendering/audio work runs, so a render hiccup can
           never leave a truly empty room stuck open. */
        if (G.players.length === 0) { closeRoom('Everyone left — room closed'); return; }
        A.sfx('bye'); save(); renderAll(); broadcast(true);
      }

    } else if (m.t === 'cmd') {
      /* Only the phone the computer linked may drive the game, and each
         command counts once (the relay can replay messages on reconnect). */
      if (!G.host || m.from !== G.host) return;
      if (!(m.n > G.lastCmd)) return;
      G.lastCmd = m.n;
      save();
      var d = m.do;
      if (d === 'start') { if (G.phase === 'lobby' && G.players.length >= 2) startGame(); }
      else if (d === 'reveal') { if (G.phase === 'ask') doReveal(); }
      else if (d === 'skip') { if (G.phase === 'ask') skipQuestion(); }
      else if (d === 'next') { if (G.phase === 'reveal') nextRound(); }
      else if (d === 'timer+') { if (G.phase === 'ask') adjustTimer(5); }
      else if (d === 'timer-') { if (G.phase === 'ask') adjustTimer(-5); }
      else if (d === 'timerOff') { if (G.phase === 'ask') toggleNoTimer(); }
      else if (d === 'again') { if (G.phase === 'final') playAgain(); }

    } else if (m.t === 'q') {
      if (G.phase !== 'lobby' || !G.allowAdd) return;
      var text = String(m.text || '').trim().replace(/^most likely to\s*/i, '').slice(0, 90);
      if (text.length < 3 || G.roomQ.length >= 80) return;
      var mine = G.roomQ.filter(function (q) { return q.by === m.from; }).length;
      if (mine >= 8) return;
      if (G.roomQ.some(function (q) { return q.t.toLowerCase() === text.toLowerCase(); })) return;
      G.roomQ.push({ t: text, by: m.from });
      A.sfx('blip');
      save(); renderLobby(); broadcast(false);

    } else if (m.t === 'vote') {
      if (G.phase !== 'ask' || m.round !== G.round) return;
      if (!playerById(m.from) || !playerById(m.pick)) return;
      if (G.votes[m.from] === m.pick) return;
      G.votes[m.from] = m.pick;
      A.sfx('pick');
      save(); renderAsk();
      if (Object.keys(G.votes).length >= G.players.length && G.players.length) {
        setTimeout(function () { if (G.phase === 'ask') doReveal(); }, 700);
      } else {
        broadcast(false);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* question pool                                                       */
  /* ------------------------------------------------------------------ */
  function customQuestions() {
    return ($('#custom').value || '').split('\n')
      .map(function (s) { return s.trim().replace(/^most likely to\s*/i, ''); })
      .filter(function (s) { return s.length > 1; });
  }

  function ownQuestions() {
    var own = customQuestions().map(function (t) { return { t: t, p: 'host' }; });
    G.roomQ.forEach(function (q) { own.push({ t: q.t, p: 'room' }); });
    return own;
  }

  function poolFromPacks(ignoreSeen) {
    var seen = ignoreSeen ? [] : loadSeen();
    var pool = [];
    MLT.PACKS.forEach(function (pk) {
      if (G.packs.indexOf(pk.id) < 0) return;
      pk.items.forEach(function (t) {
        if (seen.indexOf(t) < 0) pool.push({ t: t, p: pk.id });
      });
    });
    return pool;
  }

  function buildQuestions() {
    var seen = loadSeen();
    var own = MLT.shuffle(ownQuestions().filter(function (q) { return seen.indexOf(q.t) < 0; }));
    if ($('#onlyCustom').checked && own.length) return own;

    var pool = poolFromPacks(false);
    if (!pool.length) { saveSeen([]); pool = poolFromPacks(true); }
    if (!pool.length) pool = MLT.PACKS[0].items.map(function (t) { return { t: t, p: 'classic' }; });
    return own.concat(MLT.shuffle(pool));
  }

  /* ------------------------------------------------------------------ */
  /* flow                                                                */
  /* ------------------------------------------------------------------ */
  function startGame() {
    G.total = parseInt($('#rounds').value, 10) || G.total || 15;
    var s = parseInt($('#secs').value, 10);
    if (!isNaN(s)) G.secs = s;
    G.showVoters = $('#showVoters').checked;
    G.allowAdd = $('#allowAdd').checked;
    G.questions = buildQuestions();
    if (G.questions.length < G.total) G.total = G.questions.length;
    G.round = 0;
    G.history = [];
    G.players.forEach(function (p) { p.pts = 0; });
    startRound();
  }

  function startRound() {
    G.phase = 'ask';
    G.votes = {};
    G.endsAt = G.secs > 0 ? Date.now() + G.secs * 1000 : null;
    markSeen(currentQ().t);
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

  /* Change the countdown mid-game: applies to this round and every one after. */
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
    var t = tally();
    var rec = {};
    t.forEach(function (row) {
      var p = playerById(row.id);
      if (p) p.pts += row.n;
      if (row.n) rec[row.id] = row.n;
    });
    var q = currentQ();
    G.history.push({ t: q.t, p: q.p, tally: rec });
    save();
    show('reveal');
    renderReveal(t);
    broadcast(true);
    A.music('lobby');
    A.sfx('reveal');
    if (t[0] && t[0].n > 0) setTimeout(function () { A.sfx('winner'); }, 950);
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

  function skipQuestion() {
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
    G.players.forEach(function (p) { p.pts = 0; });
    save();
    show('lobby'); renderLobby(); renderPacks(); broadcast(true);
    A.music('lobby');
  }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */
  function setAccent(packId) {
    var info = MLT.packInfo(packId);
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
        new QRCode(box, {
          text: joinUrl(), width: 164, height: 164,
          colorDark: '#05040e', colorLight: '#ffffff'
        });
      }
    } catch (e) { /* no QR, the code still works */ }
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
    $('#btnStart').disabled = G.players.length < 2;
    $('#lobbyHint').textContent = G.players.length < 2
      ? 'Waiting for people to join… you need at least 2.'
      : 'Everyone in? Hit start.';

    $('#roomQCount').textContent = G.roomQ.length;
    $('#roomQBadge').classList.toggle('hidden', !G.roomQ.length);
    $('#btnRoomQ').classList.toggle('hidden', !G.roomQ.length);

    var list = $('#roomQList');
    if (!list.classList.contains('hidden')) {
      list.innerHTML = '';
      G.roomQ.forEach(function (q, i) {
        list.appendChild(el('div', { class: 'qitem' }, [
          el('span', { text: q.t }),
          el('button', {
            class: 'ghost mini danger', text: '✕',
            onclick: function () { G.roomQ.splice(i, 1); save(); renderLobby(); broadcast(true); }
          })
        ]));
      });
    }
    renderPacks();
  }

  /* Pick which joined phone gets the host's remote controls. */
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
    var q = currentQ();
    var info = setAccent(q.p);
    $('#qBanner').textContent = info.emoji + '  ' + info.name;
    $('#qProgress').textContent = 'Q' + (G.round + 1) + ' / ' + G.total;
    $('#qText').textContent = q.t;
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

  function renderReveal(t) {
    t = t || tally();
    var q = currentQ();
    var info = setAccent(q.p);
    $('#rBanner').textContent = info.emoji + '  ' + info.name;
    $('#rText').textContent = q.t;

    var cast = Object.keys(G.votes).length;
    var top = t.filter(function (r) { return r.n > 0 && r.n === t[0].n; });
    $('#rWinner').textContent = cast === 0
      ? 'Nobody voted 😴'
      : top.map(function (r) { return nameOf(r.id); }).join(' & ') + (top.length > 1 ? ' tie it' : ' takes it');

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
      var fill = el('i', { style: 'background:' + col + ';color:' + col });
      var cell = el('div', {}, [el('div', { class: 'track' }, [fill])]);
      if (G.showVoters && voters.length) cell.appendChild(el('div', { class: 'voters', text: voters.join(', ') }));
      var num = el('div', { class: 'n', text: '0' });
      bars.appendChild(el('div', { class: 'bar' }, [
        el('div', { class: 'who' }, [avatar(p.name, idx), el('span', { text: p.name })]),
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
        el('div', { class: 'sc', text: p.pts + (p.pts === 1 ? ' pick' : ' picks') })
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
    var sorted = G.players.slice().sort(function (a, b) { return b.pts - a.pts; });
    renderPodium($('#podium'), sorted);

    var lb = $('#lb');
    lb.innerHTML = '';
    sorted.slice(3).forEach(function (p, i) {
      lb.appendChild(el('div', { class: 'lbrow' }, [
        el('div', { class: 'rank', text: String(i + 4) }),
        el('div', { class: 'name' }, [avatar(p.name, indexOfPlayer(p.id)), el('span', { text: p.name })]),
        el('div', { class: 'pts', text: p.pts + (p.pts === 1 ? ' pick' : ' picks') })
      ]));
    });

    var a = computeAwards();
    var box = $('#awards');
    box.innerHTML = '';
    a.awards.forEach(function (aw) {
      var idx = indexOfPlayer(aw.p);
      box.appendChild(el('div', { class: 'award', style: '--ac:' + aw.c }, [
        el('div', { class: 't', text: aw.t }),
        el('div', { class: 'w' }, [avatar(nameOf(aw.p), idx), el('span', { text: nameOf(aw.p) })]),
        el('div', { class: 'd', text: aw.d })
      ]));
    });
    a.moments.forEach(function (mo) {
      var idx = indexOfPlayer(mo.p);
      box.appendChild(el('div', { class: 'award', style: '--ac:' + MLT.colorFor(idx) }, [
        el('div', { class: 't', text: 'Defining moment' }),
        el('div', { class: 'w' }, [avatar(nameOf(mo.p), idx), el('span', { text: nameOf(mo.p) })]),
        el('div', { class: 'd', text: 'Most likely to ' + mo.q + ' — ' + mo.n + (mo.n === 1 ? ' vote' : ' votes') })
      ]));
    });

    $('#finalTitle').textContent = sorted.length && sorted[0].pts
      ? sorted[0].name + ' is the most likely to anything'
      : 'Final standings';

    document.documentElement.style.setProperty('--accent', '#ffd23f');
    MLT.confetti(sorted.slice(0, 3).map(function (p) { return MLT.colorFor(indexOfPlayer(p.id)); }));
  }

  function renderAll() {
    if (G.phase === 'lobby') renderLobby();
    else if (G.phase === 'ask') renderAsk();
    else if (G.phase === 'reveal') renderReveal();
    else renderFinal();
  }

  function renderPacks() {
    var box = $('#packs');
    box.innerHTML = '';
    MLT.PACKS.forEach(function (p) {
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
    var fresh = poolFromPacks(false).length + ownQuestions().length;
    $('#qcount').textContent = fresh
      ? fresh + ' unused questions ready' + (G.packs.length ? ' · ' + G.packs.length + ' pack' + (G.packs.length > 1 ? 's' : '') : '')
      : 'Pick a pack, or add your own questions.';
    $('#seenCount').textContent = loadSeen().length;
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
  $('#btnRoomQ').addEventListener('click', function () {
    $('#roomQList').classList.toggle('hidden');
    renderLobby();
  });
  $('#btnStart').addEventListener('click', function () { A.ready(); startGame(); });
  $('#packAll').addEventListener('click', function () {
    G.packs = MLT.PACKS.map(function (p) { return p.id; });
    save(); renderPacks();
  });
  $('#packNone').addEventListener('click', function () { G.packs = []; save(); renderPacks(); });
  $('#btnForget').addEventListener('click', function () {
    saveSeen([]); renderPacks(); MLT.toast('Question history cleared');
  });
  $('#custom').addEventListener('input', renderPacks);
  $('#allowAdd').addEventListener('change', function () {
    G.allowAdd = $('#allowAdd').checked; save(); broadcast(true);
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
  $('#btnSkip').addEventListener('click', skipQuestion);
  $('#btnNext').addEventListener('click', nextRound);
  $('#btnAgain').addEventListener('click', playAgain);
  $('#btnHome').addEventListener('click', newRoom);

  /* restore saved settings into the controls */
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
  $('#allowAdd').checked = !!G.allowAdd;
  renderPacks();

  /* Where do we land? A game in progress resumes (so a stray refresh mid-round
     doesn't kill it); anything else starts at the front door. */
  if (PLAYLIST_MODE) newRoom((MLT.qs('r') || '').toUpperCase());
  else if (wantNew) newRoom();
  else if (saved && (saved.phase === 'ask' || saved.phase === 'reveal')) enterRoom();
  else openStart();

  window.addEventListener('beforeunload', save);
  window.__G = G;
})();

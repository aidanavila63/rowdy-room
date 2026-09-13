(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SAVE = 'tl.host.v1';
  var ACCENT = '#ff2d95';
  var TIERS = MLT.TL_TIERS;
  var TIER_COLOR = { S: '#ff2d95', A: '#ffd23f', B: '#22e6ff', C: '#9d6bff' };
  var ITEMS_PER_ROUND = 6;
  var BUILD_SECS = 90;
  var ARGUE_SECS = 20;
  var CLAIM_TIMEOUT = 8000;

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  function blankGame() {
    return {
      code: randomCode(), seq: 0, phase: 'lobby',
      round: 0, total: 3, secs: 60,
      packs: MLT.TL_PACKS.map(function (p) { return p.id; }),
      roomQ: [], allowAdd: true,
      usedItems: [], items: [],
      personal: {}, board: {}, claims: {}, claimedAt: {}, buildReady: {},
      moveCounts: {}, itemMoveCounts: {}, roundMoveCounts: {},
      contested: null, argueVotes: {},
      players: [], endsAt: null,
      history: [], host: null, lastCmd: 0, lastActivity: Date.now()
    };
  }

  var saved = MLT.store(SAVE);
  var G = saved || blankGame();
  if (!G.packs || !G.packs.length) G.packs = MLT.TL_PACKS.map(function (p) { return p.id; });
  if (!G.roomQ) G.roomQ = [];
  if (G.allowAdd === undefined) G.allowAdd = true;
  if (!G.usedItems) G.usedItems = [];
  if (!G.items) G.items = [];
  if (!G.personal) G.personal = {};
  if (!G.board) G.board = {};
  if (!G.claims) G.claims = {};
  if (!G.claimedAt) G.claimedAt = {};
  if (!G.buildReady) G.buildReady = {};
  if (!G.moveCounts) G.moveCounts = {};
  if (!G.itemMoveCounts) G.itemMoveCounts = {};
  if (!G.roundMoveCounts) G.roundMoveCounts = {};
  if (!G.argueVotes) G.argueVotes = {};
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
    G.usedItems = [];
    G.items = [];
    G.personal = {};
    G.board = {};
    G.claims = {};
    G.claimedAt = {};
    G.buildReady = {};
    G.moveCounts = {};
    G.itemMoveCounts = {};
    G.roundMoveCounts = {};
    G.contested = null;
    G.argueVotes = {};
    G.endsAt = null;
    G.players = [];
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
    window.__TLG = G;
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
    show(G.phase === 'rank' ? 'rank' : G.phase === 'build' ? 'build' : G.phase === 'argue' ? 'argue' : G.phase === 'reveal' ? 'reveal' : G.phase === 'final' ? 'final' : 'lobby');
    renderAll();
    renderPacks();
    makeQR();
    if (G.phase === 'rank') runClock();
    if (G.phase === 'build') runBuildClock();
    if (G.phase === 'argue') runArgueClock();
    broadcast(true);
    A.ready();
    A.music(G.phase === 'lobby' || G.phase === 'final' ? 'lobby' : 'round');
  }

  function openStart() {
    show('start');
    var resumable = !!(saved && saved.code && (saved.players.length || saved.phase !== 'lobby'));
    $('#btnResume').classList.toggle('hidden', !resumable);
    if (resumable) {
      var n = saved.players.length;
      $('#btnResume').textContent = 'Resume room ' + saved.code +
        ' · ' + n + ' player' + (n === 1 ? '' : 's');
      $('#startHint').textContent = 'Creating a new room clears the players and scores.';
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

  function publicState() {
    var s = {
      phase: G.phase, round: G.round, total: G.total, secs: G.secs, endsAt: G.endsAt,
      players: G.players.map(function (p) { return { id: p.id, name: p.name, pts: p.pts, emoji: p.emoji, color: p.color }; }),
      host: G.host || null
    };
    if (G.phase === 'lobby') {
      s.packs = G.packs;
      s.canAdd = !!G.allowAdd;
      s.roomQ = G.roomQ.length;
    } else if (G.phase === 'rank') {
      s.items = G.items;
      s.submitted = Object.keys(G.personal);
    } else if (G.phase === 'build') {
      s.items = G.items;
      s.board = G.board;
      /* claims are safe to broadcast in full — unlike Fibbers' Court's vote
         choices, there's nothing to hide here: everyone SEES who's holding
         what live, that's the whole point of a shared board. */
      s.claims = G.claims;
      s.buildReady = Object.keys(G.buildReady);
    } else if (G.phase === 'argue') {
      s.items = G.items;
      s.board = G.board;
      s.contested = G.contested;
      s.argueVoted = Object.keys(G.argueVotes);
    } else if (G.phase === 'reveal') {
      var h = G.history[G.history.length - 1] || {};
      s.items = h.items; s.board = h.finalBoard; s.personal = h.personal;
      s.scores = h.scoresThisRound; s.bumped = h.bumped; s.contestedText = h.contestedText;
    } else if (G.phase === 'final') {
      s.awards = computeAwards();
      s.mostContested = topContestedItem();
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
  function itemById(id) {
    for (var i = 0; i < G.items.length; i++) if (G.items[i].id === id) return G.items[i];
    return null;
  }
  function tierIdx(t) { var i = TIERS.indexOf(t); return i < 0 ? TIERS.length - 1 : i; }

  /* ------------------------------------------------------------------ */
  /* item pool                                                           */
  /* ------------------------------------------------------------------ */
  function poolFromPacks() {
    var pool = [];
    MLT.TL_PACKS.forEach(function (pk) {
      if (G.packs.indexOf(pk.id) < 0) return;
      pk.items.forEach(function (txt) { pool.push(txt); });
    });
    return pool;
  }

  function customItems() {
    var box = $('#custom');
    if (!box) return [];
    return (box.value || '').split('\n')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 1; });
  }

  function ownItems() {
    var own = customItems().slice();
    G.roomQ.forEach(function (q) { own.push(q.t); });
    return own;
  }

  function pickItems() {
    var pool = poolFromPacks().concat(ownItems());
    if (!pool.length) return [];
    var avail = pool.filter(function (txt) { return G.usedItems.indexOf(txt) < 0; });
    if (avail.length < ITEMS_PER_ROUND) { G.usedItems = []; avail = pool.slice(); }
    var chosen = MLT.shuffle(avail).slice(0, Math.min(ITEMS_PER_ROUND, avail.length));
    chosen.forEach(function (txt) { G.usedItems.push(txt); });
    return chosen.map(function (txt) { return { id: MLT.uid(), text: txt }; });
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
        if (m.emoji !== undefined) p.emoji = m.emoji;
        if (m.color !== undefined) p.color = m.color;
      } else {
        if (G.players.length >= 10) return;
        G.players.push({ id: m.from, name: String(m.name).slice(0, 18), pts: 0, emoji: m.emoji || '', color: m.color || '' });
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

    } else if (m.t === 'item') {
      if (G.phase !== 'lobby' || !G.allowAdd) return;
      var text = String(m.text || '').trim().slice(0, 60);
      if (text.length < 2 || G.roomQ.length >= 80) return;
      var mine = G.roomQ.filter(function (q) { return q.by === m.from; }).length;
      if (mine >= 8) return;
      if (G.roomQ.some(function (q) { return q.t.toLowerCase() === text.toLowerCase(); })) return;
      G.roomQ.push({ t: text, by: m.from });
      A.sfx('blip');
      save(); renderLobby(); broadcast(false);

    } else if (m.t === 'cmd') {
      if (!G.host || m.from !== G.host) return;
      if (!(m.n > G.lastCmd)) return;
      G.lastCmd = m.n;
      save();
      var d = m.do;
      if (d === 'start') { if (G.phase === 'lobby' && G.players.length >= 3 && poolFromPacks().length + ownItems().length >= ITEMS_PER_ROUND) startGame(); }
      else if (d === 'lockrank') { if (G.phase === 'rank') lockRanks(); }
      else if (d === 'lockboard') { if (G.phase === 'build') lockBoard(); }
      else if (d === 'resolveargue') { if (G.phase === 'argue') resolveArgue(); }
      else if (d === 'next') { if (G.phase === 'reveal') nextRound(); }
      else if (d === 'timer+') { if (G.phase === 'rank') adjustTimer(5); }
      else if (d === 'timer-') { if (G.phase === 'rank') adjustTimer(-5); }
      else if (d === 'timerOff') { if (G.phase === 'rank') toggleNoTimer(); }
      else if (d === 'again') { if (G.phase === 'final') playAgain(); }

    } else if (m.t === 'rank') {
      if (G.phase !== 'rank' || m.round !== G.round) return;
      if (!playerById(m.from)) return;
      var assign = m.assign || {};
      var ok = G.items.every(function (it) { return TIERS.indexOf(assign[it.id]) >= 0; });
      if (!ok) return;
      G.personal[m.from] = assign;
      A.sfx('blip');
      save(); renderRank(); broadcast(true);
      if (Object.keys(G.personal).length >= G.players.length) {
        setTimeout(function () { if (G.phase === 'rank') lockRanks(); }, 500);
      }

    } else if (m.t === 'claim') {
      if (G.phase !== 'build' || m.round !== G.round) return;
      if (!playerById(m.from)) return;
      if (!itemById(m.itemId)) return;
      var held = G.claims[m.itemId];
      var stale = held && (Date.now() - (G.claimedAt[m.itemId] || 0) > CLAIM_TIMEOUT);
      if (!held || held === m.from || stale) {
        G.claims[m.itemId] = m.from;
        G.claimedAt[m.itemId] = Date.now();
        save(); renderBuild(); broadcast(true);
      } else if (bus) {
        bus.send({ t: 'claimrejected', to: m.from, itemId: m.itemId });
      }

    } else if (m.t === 'place') {
      if (G.phase !== 'build' || m.round !== G.round) return;
      if (TIERS.indexOf(m.tier) < 0) return;
      if (G.claims[m.itemId] !== m.from) {
        if (bus) bus.send({ t: 'placerejected', to: m.from, itemId: m.itemId });
        return;
      }
      G.board[m.itemId] = m.tier;
      G.itemMoveCounts[m.itemId] = (G.itemMoveCounts[m.itemId] || 0) + 1;
      G.roundMoveCounts[m.itemId] = (G.roundMoveCounts[m.itemId] || 0) + 1;
      G.moveCounts[m.from] = (G.moveCounts[m.from] || 0) + 1;
      delete G.claims[m.itemId];
      delete G.claimedAt[m.itemId];
      A.sfx('pick');
      save(); renderBuild(); broadcast(true);

    } else if (m.t === 'release') {
      if (G.phase !== 'build' || m.round !== G.round) return;
      if (G.claims[m.itemId] === m.from) {
        delete G.claims[m.itemId];
        delete G.claimedAt[m.itemId];
        save(); renderBuild(); broadcast(true);
      }

    } else if (m.t === 'buildready') {
      if (G.phase !== 'build' || m.round !== G.round) return;
      if (!playerById(m.from)) return;
      var stillHolding = Object.keys(G.claims).some(function (itId) { return G.claims[itId] === m.from; });
      if (stillHolding) return; // shouldn't happen — player screen blocks locking in while holding
      if (G.buildReady[m.from]) return;
      G.buildReady[m.from] = true;
      A.sfx('blip');
      save(); renderBuild(); broadcast(true);
      if (Object.keys(G.buildReady).length >= G.players.length) {
        setTimeout(function () { if (G.phase === 'build') lockBoard(); }, 500);
      }

    } else if (m.t === 'arguevote') {
      if (G.phase !== 'argue' || m.round !== G.round) return;
      if (!playerById(m.from)) return;
      if (m.vote !== 'agree' && m.vote !== 'movedown') return;
      G.argueVotes[m.from] = m.vote;
      A.sfx('pick');
      save(); renderArgue();
      if (Object.keys(G.argueVotes).length >= G.players.length) {
        setTimeout(function () { if (G.phase === 'argue') resolveArgue(); }, 600);
      } else {
        broadcast(false);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* flow                                                                */
  /* ------------------------------------------------------------------ */
  function startGame() {
    G.total = parseInt($('#rounds').value, 10) || G.total || 3;
    var s = parseInt($('#secs').value, 10);
    if (!isNaN(s)) G.secs = s;
    G.round = 0;
    G.usedItems = [];
    G.history = [];
    G.moveCounts = {};
    G.itemMoveCounts = {};
    G.players.forEach(function (p) { p.pts = 0; });
    startRound();
  }

  function startRound() {
    G.items = pickItems();
    G.personal = {};
    G.board = {};
    G.claims = {};
    G.claimedAt = {};
    G.roundMoveCounts = {};
    G.contested = null;
    G.argueVotes = {};
    G.phase = 'rank';
    G.endsAt = G.secs > 0 ? Date.now() + G.secs * 1000 : null;
    save();
    show('rank');
    renderRank();
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
        if (G.phase === 'rank') lockRanks();
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
    if (G.phase === 'rank') {
      G.endsAt = (wasOff || !G.endsAt)
        ? Date.now() + G.secs * 1000
        : Math.max(Date.now() + 2000, G.endsAt + delta * 1000);
      runClock();
    }
    save(); renderRank(); broadcast(true);
  }

  function toggleNoTimer() {
    if (G.secs > 0) {
      G.prevSecs = G.secs; G.secs = 0; G.endsAt = null;
    } else {
      G.secs = G.prevSecs || 60;
      if (G.phase === 'rank') G.endsAt = Date.now() + G.secs * 1000;
    }
    if (G.phase === 'rank') runClock();
    save(); renderRank(); broadcast(true);
  }

  function lockRanks() {
    if (G.phase !== 'rank') return;
    clearInterval(clockTimer);
    moveToBuild();
  }

  function moveToBuild() {
    G.phase = 'build';
    G.board = {};
    G.claims = {};
    G.claimedAt = {};
    G.buildReady = {};
    G.roundMoveCounts = {};
    G.endsAt = Date.now() + BUILD_SECS * 1000;
    save();
    show('build');
    renderBuild();
    broadcast(true);
    runBuildClock();
    A.sfx('reveal');
  }

  var buildClockTimer = null;
  function runBuildClock() {
    clearInterval(buildClockTimer);
    var clock = $('#buildClock');
    var endsAt = G.endsAt;
    var span = BUILD_SECS * 1000;
    function tick() {
      var left = endsAt - Date.now();
      if (left <= 0) {
        clearInterval(buildClockTimer);
        clock.textContent = '0';
        clock.classList.remove('urgent');
        $('#buildFill').style.width = '0%';
        if (G.phase === 'build') lockBoard();
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 8000);
      $('#buildFill').style.width = Math.max(0, (left / span) * 100) + '%';
    }
    tick();
    buildClockTimer = setInterval(tick, 200);
  }

  function lockBoard() {
    if (G.phase !== 'build') return;
    clearInterval(buildClockTimer);
    /* anything still unplaced when time runs out just lands in C, so a
       round can never get stuck on stragglers */
    G.items.forEach(function (it) { if (!G.board[it.id]) G.board[it.id] = 'C'; });
    G.claims = {}; G.claimedAt = {}; G.buildReady = {};
    moveToArgueOrReveal();
  }

  function moveToArgueOrReveal() {
    var topId = null, topN = 1;
    Object.keys(G.roundMoveCounts).forEach(function (id) {
      if (G.roundMoveCounts[id] > topN) { topN = G.roundMoveCounts[id]; topId = id; }
    });
    if (topId) {
      G.contested = topId;
      G.argueVotes = {};
      G.phase = 'argue';
      G.endsAt = Date.now() + ARGUE_SECS * 1000;
      save();
      show('argue');
      renderArgue();
      broadcast(true);
      runArgueClock();
      A.sfx('start');
    } else {
      doReveal(null);
    }
  }

  var argueClockTimer = null;
  function runArgueClock() {
    clearInterval(argueClockTimer);
    var clock = $('#argueClock');
    var endsAt = G.endsAt;
    var span = ARGUE_SECS * 1000;
    function tick() {
      var left = endsAt - Date.now();
      if (left <= 0) {
        clearInterval(argueClockTimer);
        clock.textContent = '0';
        clock.classList.remove('urgent');
        $('#argueFill').style.width = '0%';
        if (G.phase === 'argue') resolveArgue();
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 5200);
      $('#argueFill').style.width = Math.max(0, (left / span) * 100) + '%';
    }
    tick();
    argueClockTimer = setInterval(tick, 200);
  }

  function resolveArgue() {
    if (G.phase !== 'argue') return;
    clearInterval(argueClockTimer);
    var agree = 0, movedown = 0;
    Object.keys(G.argueVotes).forEach(function (v) {
      if (G.argueVotes[v] === 'movedown') movedown++; else agree++;
    });
    var bumped = false;
    if (G.contested && movedown > agree) {
      var cur = tierIdx(G.board[G.contested]);
      if (cur < TIERS.length - 1) { G.board[G.contested] = TIERS[cur + 1]; bumped = true; }
    }
    doReveal({ itemId: G.contested, agree: agree, movedown: movedown, bumped: bumped });
  }

  function doReveal(argueResult) {
    G.phase = 'reveal';
    G.endsAt = null;
    var finalBoard = {};
    G.items.forEach(function (it) { finalBoard[it.id] = G.board[it.id] || 'C'; });
    var scoresThisRound = {};
    Object.keys(G.personal).forEach(function (pid) {
      var p = playerById(pid);
      if (!p) return;
      var pts = 0;
      G.items.forEach(function (it) {
        var mine = tierIdx(G.personal[pid][it.id]);
        var real = tierIdx(finalBoard[it.id]);
        var dist = Math.abs(mine - real);
        pts += dist === 0 ? 3 : dist === 1 ? 1 : 0;
      });
      scoresThisRound[pid] = pts;
      p.pts += pts;
    });
    G.history.push({
      items: G.items, finalBoard: finalBoard, personal: G.personal,
      scoresThisRound: scoresThisRound,
      contestedText: argueResult && argueResult.itemId ? (itemById(argueResult.itemId) || {}).text : null,
      bumped: argueResult ? argueResult.bumped : false,
      argueAgree: argueResult ? argueResult.agree : 0,
      argueMovedown: argueResult ? argueResult.movedown : 0
    });
    save();
    show('reveal');
    renderReveal();
    broadcast(true);
    A.music('lobby');
    A.sfx('reveal');
    setTimeout(function () { A.sfx('winner'); }, 950);
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

  function playAgain() {
    G.phase = 'lobby';
    G.round = 0; G.usedItems = []; G.items = [];
    G.personal = {}; G.board = {}; G.claims = {}; G.claimedAt = {}; G.buildReady = {};
    G.moveCounts = {}; G.itemMoveCounts = {}; G.roundMoveCounts = {};
    G.contested = null; G.argueVotes = {}; G.endsAt = null; G.history = [];
    G.players.forEach(function (p) { p.pts = 0; });
    save();
    show('lobby'); renderLobby(); renderPacks(); broadcast(true);
    A.music('lobby');
  }

  /* ------------------------------------------------------------------ */
  /* awards                                                              */
  /* ------------------------------------------------------------------ */
  function topContestedItem() {
    var topId = null, topN = 0;
    Object.keys(G.itemMoveCounts).forEach(function (id) {
      if (G.itemMoveCounts[id] > topN) { topN = G.itemMoveCounts[id]; topId = id; }
    });
    if (!topId || topN < 2) return null;
    var text = null;
    G.history.forEach(function (h) {
      h.items.forEach(function (it) { if (it.id === topId) text = it.text; });
    });
    return text ? { text: text, n: topN } : null;
  }

  function computeAwards() {
    if (G.players.length < 3 || !G.history.length) return [];
    var awards = [];
    var topId = null, topN = 0;
    Object.keys(G.moveCounts).forEach(function (id) {
      if (!playerById(id)) return;
      if (G.moveCounts[id] > topN) { topN = G.moveCounts[id]; topId = id; }
    });
    if (topId) {
      awards.push({ t: 'Tier Tyrant', p: topId, c: '#ff2d95',
        d: 'Placed or moved ' + topN + ' item' + (topN === 1 ? '' : 's') + ' on the shared board' });
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

  function renderPacks() {
    var box = $('#packs');
    if (!box) return;
    box.innerHTML = '';
    MLT.TL_PACKS.forEach(function (p) {
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
    var avail = poolFromPacks().length + ownItems().length;
    $('#qcount').textContent = avail >= ITEMS_PER_ROUND
      ? avail + ' items ready' + (G.packs.length ? ' · ' + G.packs.length + ' pack' + (G.packs.length > 1 ? 's' : '') : '')
      : 'Pick enough packs, or add your own, for at least ' + ITEMS_PER_ROUND + ' items.';
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
      var kids = [avatar(p.name, i, null, p), el('span', { text: p.name })];
      if (G.host === p.id) kids.push(el('span', { class: 'tag', text: '· remote' }));
      box.appendChild(el('span', { class: 'chip' + (G.host === p.id ? ' remote' : '') }, kids));
    });
    renderHostPick();
    $('#pcount').textContent = '(' + G.players.length + ')';
    $('#btnStart').disabled = G.players.length < 3 || poolFromPacks().length + ownItems().length < ITEMS_PER_ROUND;
    $('#lobbyHint').textContent = G.players.length < 3
      ? 'Waiting for people to join… you need at least 3.'
      : poolFromPacks().length + ownItems().length < ITEMS_PER_ROUND
        ? 'Pick enough packs in Settings for at least ' + ITEMS_PER_ROUND + ' items.'
        : 'Everyone in? Hit start.';

    var roomQCount = $('#roomQCount');
    if (roomQCount) {
      roomQCount.textContent = G.roomQ.length;
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
    }
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
      ? nameOf(G.host) + "'s phone can now run the round — you can walk away from this screen."
      : 'Tap a name to hand the game controls to that phone.';
  }

  function renderRank() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    $('#rankProgress').textContent = 'Round ' + (G.round + 1) + ' / ' + G.total;
    $('#secsNow').textContent = G.secs > 0 ? G.secs + 's to rank' : 'no countdown';
    $('#btnNoTimer').textContent = G.secs > 0 ? 'No timer' : 'Timer on';
    $('#btnMinus').disabled = !(G.secs > 5);
    var list = $('#rankItemsBig');
    list.innerHTML = '';
    G.items.forEach(function (it) {
      list.appendChild(el('div', { class: 'tl-itembig', text: it.text }));
    });
    var n = Object.keys(G.personal).length;
    $('#rankCount').textContent = n;
    $('#rankTotal').textContent = G.players.length;
    var box = $('#rankPlayers');
    box.innerHTML = '';
    G.players.forEach(function (p, i) {
      box.appendChild(el('span', { class: 'chip' + (G.personal[p.id] ? ' voted' : '') }, [
        avatar(p.name, i, null, p), el('span', { text: p.name })
      ]));
    });
  }

  function renderBuild() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    $('#buildProgress').textContent = 'Round ' + (G.round + 1) + ' / ' + G.total;
    var lanes = $('#buildLanes');
    lanes.innerHTML = '';
    TIERS.forEach(function (tier) {
      var laneItems = G.items.filter(function (it) { return G.board[it.id] === tier; });
      lanes.appendChild(el('div', { class: 'tl-lane', style: '--tc:' + TIER_COLOR[tier] }, [
        el('div', { class: 'tl-lane-label', text: tier }),
        el('div', { class: 'tl-lane-items' }, laneItems.map(function (it) {
          var claimant = G.claims[it.id];
          return el('div', { class: 'tl-chip' + (claimant ? ' claimed' : '') },
            [el('span', { text: it.text }), claimant ? el('span', { class: 'tl-claimtag', text: nameOf(claimant) }) : null].filter(Boolean));
        }))
      ]));
    });
    var tray = $('#buildTray');
    tray.innerHTML = '';
    var unplaced = G.items.filter(function (it) { return !G.board[it.id]; });
    unplaced.forEach(function (it) {
      var claimant = G.claims[it.id];
      tray.appendChild(el('div', { class: 'tl-chip' + (claimant ? ' claimed' : '') },
        [el('span', { text: it.text }), claimant ? el('span', { class: 'tl-claimtag', text: nameOf(claimant) }) : null].filter(Boolean)));
    });
    var readyN = Object.keys(G.buildReady).length;
    var base = unplaced.length
      ? unplaced.length + ' item' + (unplaced.length === 1 ? '' : 's') + ' still up for grabs'
      : 'Everything placed — still time to move things around.';
    $('#buildHint').textContent = base + ' · ' + readyN + ' / ' + G.players.length + ' locked in';
  }

  function renderArgue() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var it = itemById(G.contested);
    $('#argueItemText').textContent = it ? it.text : '—';
    $('#argueTierNow').textContent = G.board[G.contested] || 'C';
    var voted = Object.keys(G.argueVotes).length;
    $('#argueCount').textContent = voted;
    $('#argueTotal').textContent = G.players.length;
  }

  function renderReveal() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var h = G.history[G.history.length - 1];
    if (!h) return;
    $('#revealProgress').textContent = 'Round ' + (G.round + 1) + ' / ' + G.total;
    var lanes = $('#revealLanes');
    lanes.innerHTML = '';
    TIERS.forEach(function (tier) {
      var laneItems = h.items.filter(function (it) { return h.finalBoard[it.id] === tier; });
      lanes.appendChild(el('div', { class: 'tl-lane', style: '--tc:' + TIER_COLOR[tier] }, [
        el('div', { class: 'tl-lane-label', text: tier }),
        el('div', { class: 'tl-lane-items' }, laneItems.map(function (it) {
          return el('div', { class: 'tl-chip' }, [el('span', { text: it.text })]);
        }))
      ]));
    });
    $('#revealArgueNote').textContent = h.contestedText
      ? '"' + h.contestedText + '" got argued over (' + h.argueMovedown + ' vs ' + h.argueAgree + ')' + (h.bumped ? ' — bumped down a tier.' : ' — the room let it stand.')
      : 'Nothing got seriously contested this round.';
    var box = $('#revealScores');
    box.innerHTML = '';
    Object.keys(h.scoresThisRound).sort(function (a, b) { return h.scoresThisRound[b] - h.scoresThisRound[a]; }).forEach(function (pid) {
      var idx = indexOfPlayer(pid);
      box.appendChild(el('div', { class: 'chip' }, [
        avatar(nameOf(pid), idx), el('span', { text: nameOf(pid) }),
        el('span', { class: 'tag', text: '+' + h.scoresThisRound[pid] })
      ]));
    });
    $('#btnNext').textContent = (G.round + 1 >= G.total) ? 'Final standings' : 'Next round';
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
    MLT.renderPlaylistCTA({ playlist: PLAYLIST, code: G.code, players: G.players, bus: bus, send: function (m) { if (bus) bus.send(m); }, awards: computeAwards() });
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

    var mc = topContestedItem();
    $('#mostContested').textContent = mc ? 'Most fought over: "' + mc.text + '" (moved ' + mc.n + ' times)' : '';

    $('#finalTitle').textContent = sorted.length && sorted[0].pts
      ? sorted[0].name + ' reads the room best'
      : 'Final standings';

    MLT.confetti(sorted.slice(0, 3).map(function (p) { return MLT.colorFor(indexOfPlayer(p.id)); }));
  }

  function renderAll() {
    if (G.phase === 'lobby') renderLobby();
    else if (G.phase === 'rank') renderRank();
    else if (G.phase === 'build') renderBuild();
    else if (G.phase === 'argue') renderArgue();
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
    G.packs = MLT.TL_PACKS.map(function (p) { return p.id; });
    save(); renderPacks(); renderLobby();
  });
  $('#packNone').addEventListener('click', function () { G.packs = []; save(); renderPacks(); renderLobby(); });
  if ($('#custom')) $('#custom').addEventListener('input', function () { renderPacks(); renderLobby(); });
  if ($('#allowAdd')) {
    $('#allowAdd').checked = !!G.allowAdd;
    $('#allowAdd').addEventListener('change', function () {
      G.allowAdd = $('#allowAdd').checked; save(); broadcast(true);
    });
  }
  if ($('#btnRoomQ')) {
    $('#btnRoomQ').addEventListener('click', function () {
      $('#roomQList').classList.toggle('hidden');
      renderLobby();
    });
  }
  $('#rounds').addEventListener('change', function () {
    G.total = parseInt($('#rounds').value, 10) || G.total || 3;
    save();
  });
  $('#secs').addEventListener('change', function () {
    var v = parseInt($('#secs').value, 10);
    G.secs = isNaN(v) ? 60 : v;
    save();
  });
  $('#btnMinus').addEventListener('click', function () { adjustTimer(-5); });
  $('#btnPlus').addEventListener('click', function () { adjustTimer(5); });
  $('#btnNoTimer').addEventListener('click', toggleNoTimer);
  $('#btnLockRank').addEventListener('click', lockRanks);
  $('#btnLockBoard').addEventListener('click', lockBoard);
  $('#btnResolveArgue').addEventListener('click', function () { if (G.phase === 'argue') resolveArgue(); });
  $('#btnNext').addEventListener('click', nextRound);
  $('#btnAgain').addEventListener('click', playAgain);
  $('#btnHome').addEventListener('click', newRoom);

  $('#rounds').value = String(G.total);
  if ($('#rounds').selectedIndex < 0) $('#rounds').value = '3';
  if (PLAYLIST_MODE) {
    var firstOpt = $('#rounds').options[0];
    if (firstOpt) { $('#rounds').value = firstOpt.value; }
    $('#rounds').dispatchEvent(new Event('change'));
  }
  $('#secs').value = String(G.secs);
  if ($('#secs').selectedIndex < 0) $('#secs').value = '60';

  if (PLAYLIST_MODE) newRoom((MLT.qs('r') || '').toUpperCase());
  else if (wantNew) newRoom();
  else if (saved && (saved.phase === 'rank' || saved.phase === 'build' || saved.phase === 'argue' || saved.phase === 'reveal')) enterRoom();
  else openStart();

  window.addEventListener('beforeunload', save);
  window.__TLG = G;
})();

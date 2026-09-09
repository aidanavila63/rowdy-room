(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SAVE = 'wyr.host.v1';

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  function blankGame() {
    return {
      code: randomCode(), seq: 0, phase: 'lobby',
      round: 0, total: 12, secs: 20, showVoters: true,
      chains: MLT.WYR_CHAINS.map(function (c) { return c.id; }),
      order: [], cur: null, curIdx: 0, carryText: null,
      questions: [], players: [], votes: {}, endsAt: null,
      history: [], host: null, lastCmd: 0, lastActivity: Date.now()
    };
  }

  var saved = MLT.store(SAVE);
  var G = saved || blankGame();
  if (!G.chains || !G.chains.length) G.chains = MLT.WYR_CHAINS.map(function (c) { return c.id; });
  if (!G.order) G.order = [];
  if (G.host === undefined) G.host = null;
  if (!G.lastCmd) G.lastCmd = 0;
  if (!G.lastActivity) G.lastActivity = Date.now();
  if (!G.questions) G.questions = [];
  save();

  var wantNew = MLT.qs('new') === '1';
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

  function newRoom() {
    teardownBus(true);
    clearInterval(clockTimer);
    G.code = randomCode();
    G.seq = 0;
    G.phase = 'lobby';
    G.round = 0;
    G.votes = {};
    G.endsAt = null;
    G.players = [];
    G.questions = [];
    G.order = []; G.cur = null; G.curIdx = 0; G.carryText = null;
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
    window.__WG = G;
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

  function currentQ() { return G.questions[G.round] || { a: '', b: '', chain: G.chains[0] }; }

  function publicState() {
    var q = currentQ();
    var s = {
      phase: G.phase, round: G.round, total: G.total,
      a: q.a, b: q.b, chain: q.chain, endsAt: G.endsAt, secs: G.secs,
      players: G.players.map(function (p) { return { id: p.id, name: p.name, pts: p.pts }; }),
      showVoters: !!G.showVoters,
      host: G.host || null
    };
    if (G.phase === 'ask' || G.phase === 'reveal') {
      var info = MLT.wyrChainInfo(q.chain);
      s.cn = info.name; s.ce = info.emoji; s.ca = info.accent;
    }
    if (G.phase === 'ask') {
      s.voted = Object.keys(G.votes);
    } else if (G.phase === 'reveal') {
      s.votes = G.votes;
      var t = tally();
      s.votesA = t.a; s.votesB = t.b; s.majority = t.a >= t.b ? 'a' : 'b';
    } else if (G.phase === 'final') {
      s.awards = computeAwards();
    }
    return s;
  }

  function tally() {
    var a = 0, b = 0;
    Object.keys(G.votes).forEach(function (v) { if (G.votes[v] === 'a') a++; else if (G.votes[v] === 'b') b++; });
    return { a: a, b: b };
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
  /* the escalation ladder                                               */
  /* ------------------------------------------------------------------ */
  function pickNextChain() {
    if (!G.order.length) G.order = MLT.shuffle((G.chains.length ? G.chains : MLT.WYR_CHAINS.map(function (c) { return c.id; })).slice());
    return G.order.shift();
  }

  /* Builds the pairing for the round AFTER the one currently playing.
     carryText, when set, is the option that survived the round just
     revealed (the one fewer people picked) — it faces a fresh item next. */
  function buildRound(carryText) {
    var chain, items;
    if (carryText !== null && G.cur) {
      chain = MLT.wyrChainInfo(G.cur);
      items = chain.items;
      if (G.curIdx < items.length) {
        var next = items[G.curIdx];
        G.curIdx++;
        return { a: carryText, b: next, chain: G.cur };
      }
      /* ladder's used up — fall through to start a new one */
      G.cur = null;
    }
    G.cur = pickNextChain();
    chain = MLT.wyrChainInfo(G.cur);
    G.curIdx = 2;
    return { a: chain.items[0], b: chain.items[1], chain: G.cur };
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
      if (d === 'start') { if (G.phase === 'lobby' && G.players.length >= 2) startGame(); }
      else if (d === 'reveal') { if (G.phase === 'ask') doReveal(); }
      else if (d === 'skip') { if (G.phase === 'ask') skipRound(); }
      else if (d === 'next') { if (G.phase === 'reveal') nextRound(); }
      else if (d === 'timer+') { if (G.phase === 'ask') adjustTimer(5); }
      else if (d === 'timer-') { if (G.phase === 'ask') adjustTimer(-5); }
      else if (d === 'timerOff') { if (G.phase === 'ask') toggleNoTimer(); }
      else if (d === 'again') { if (G.phase === 'final') playAgain(); }

    } else if (m.t === 'vote') {
      if (G.phase !== 'ask' || m.round !== G.round) return;
      if (!playerById(m.from) || (m.pick !== 'a' && m.pick !== 'b')) return;
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
  /* flow                                                                */
  /* ------------------------------------------------------------------ */
  function startGame() {
    G.total = parseInt($('#rounds').value, 10) || G.total || 12;
    var s = parseInt($('#secs').value, 10);
    if (!isNaN(s)) G.secs = s;
    G.showVoters = $('#showVoters').checked;
    G.round = 0;
    G.history = [];
    G.order = []; G.cur = null; G.curIdx = 0; G.carryText = null;
    G.questions = [buildRound(null)];
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
    var t = tally();
    var cast = t.a + t.b;
    var majority = t.a >= t.b ? 'a' : 'b';     /* ties favour "a", so "b" escalates */
    var minority = majority === 'a' ? 'b' : 'a';
    var q = currentQ();
    if (cast > 0) {
      Object.keys(G.votes).forEach(function (voter) {
        if (G.votes[voter] === majority) {
          var p = playerById(voter);
          if (p) p.pts += 1;
        }
      });
    }
    G.history.push({ chain: q.chain, a: q.a, b: q.b, votesA: t.a, votesB: t.b });
    /* pre-build the next round now, while we know what survives */
    if (G.round + 1 < G.total) {
      G.questions[G.round + 1] = buildRound(cast > 0 ? q[minority] : q.a);
    }
    save();
    show('reveal');
    renderReveal(t, majority);
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
    startRound();
  }

  function playAgain() {
    G.phase = 'lobby';
    G.round = 0; G.votes = {}; G.endsAt = null; G.history = [];
    G.order = []; G.cur = null; G.curIdx = 0; G.carryText = null;
    G.questions = [];
    G.players.forEach(function (p) { p.pts = 0; });
    save();
    show('lobby'); renderLobby(); renderChains(); broadcast(true);
    A.music('lobby');
  }

  /* ------------------------------------------------------------------ */
  /* awards — no per-round "target", so keep it to two overall reads     */
  /* ------------------------------------------------------------------ */
  function computeAwards() {
    if (G.players.length < 2 || !G.history.length) return [];
    var sorted = G.players.slice().sort(function (a, b) { return b.pts - a.pts; });
    var awards = [];
    if (sorted[0] && sorted[0].pts > 0) {
      awards.push({
        t: 'Crowd Favorite', p: sorted[0].id, c: '#ffd23f',
        d: sorted[0].pts + ' of ' + G.history.length + ' calls sided with the room'
      });
    }
    var low = sorted[sorted.length - 1];
    if (low && low.id !== (sorted[0] || {}).id) {
      awards.push({
        t: 'Wildcard', p: low.id, c: '#9d6bff',
        d: 'Went against the room the most — only ' + low.pts + (low.pts === 1 ? ' agreed call' : ' agreed calls')
      });
    }
    return awards;
  }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */
  function setAccent(chainId) {
    var info = MLT.wyrChainInfo(chainId);
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
    $('#btnStart').disabled = G.players.length < 2;
    $('#lobbyHint').textContent = G.players.length < 2
      ? 'Waiting for people to join… you need at least 2.'
      : 'Everyone in? Hit start.';
    renderChains();
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
    var q = currentQ();
    var info = setAccent(q.chain);
    $('#qBanner').textContent = info.emoji + '  ' + info.name;
    $('#qProgress').textContent = 'Q' + (G.round + 1) + ' / ' + G.total;
    $('#optAText').textContent = q.a;
    $('#optBText').textContent = q.b;
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

  function renderReveal(t, majority) {
    t = t || tally();
    majority = majority || (t.a >= t.b ? 'a' : 'b');
    var q = currentQ();
    var info = setAccent(q.chain);
    $('#rBanner').textContent = info.emoji + '  ' + info.name;

    var cast = t.a + t.b;
    var votersFor = function (side) {
      return Object.keys(G.votes).filter(function (v) { return G.votes[v] === side; }).map(nameOf);
    };
    renderOptionBar($('#rOptA'), q.a, t.a, cast, votersFor('a'), majority === 'a');
    renderOptionBar($('#rOptB'), q.b, t.b, cast, votersFor('b'), majority === 'b');

    var minority = majority === 'a' ? 'b' : 'a';
    $('#rEscalates').textContent = cast === 0
      ? "Nobody voted — carrying on with " + q.a
      : 'Escalates next: ' + q[minority];
    $('#rProgress').textContent = 'Q' + (G.round + 1) + ' / ' + G.total;
    $('#btnNext').textContent = (G.round + 1 >= G.total) ? 'Final standings' : 'Next question';
  }

  function renderOptionBar(node, text, n, cast, voters, isMajority) {
    node.innerHTML = '';
    var pct = cast ? Math.round((n / cast) * 100) : 0;
    node.appendChild(el('div', { class: 'wyr-opt-label', text: text }));
    var track = el('div', { class: 'track' }, [el('i', { style: 'width:0%;background:var(--accent);color:var(--accent)' })]);
    node.appendChild(el('div', {}, [track]));
    var meta = el('div', { class: 'tiny', text: n + (n === 1 ? ' vote' : ' votes') + (isMajority && cast ? ' · room favorite' : '') });
    node.appendChild(meta);
    if (MLT_SHOW_VOTERS() && voters.length) node.appendChild(el('div', { class: 'voters', text: voters.join(', ') }));
    setTimeout(function () { track.firstChild.style.width = pct + '%'; }, 60);
  }
  function MLT_SHOW_VOTERS() { return !!G.showVoters; }

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
        el('div', { class: 'sc', text: p.pts + (p.pts === 1 ? ' agreed call' : ' agreed calls') })
      ]));
      var col2 = el('div', { class: 'col', style: 'color:' + col },
        [el('div', { class: 'rk', text: String(rank + 1) })]);
      slot.appendChild(col2);
      node.appendChild(slot);
      setTimeout(function () { col2.style.height = heights[rank] + 'px'; }, 120 + rank * 160);
    });
  }

  function renderFinal() {
    var sorted = G.players.slice().sort(function (a, b) { return b.pts - a.pts; });
    renderPodium($('#podium'), sorted);

    var lb = $('#lb');
    lb.innerHTML = '';
    sorted.slice(3).forEach(function (p, i) {
      lb.appendChild(el('div', { class: 'lbrow' }, [
        el('div', { class: 'rank', text: String(i + 4) }),
        el('div', { class: 'name' }, [avatar(p.name, indexOfPlayer(p.id)), el('span', { text: p.name })]),
        el('div', { class: 'pts', text: p.pts + (p.pts === 1 ? ' call' : ' calls') })
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
      ? sorted[0].name + ' called it best'
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

  function renderChains() {
    var box = $('#chains');
    box.innerHTML = '';
    MLT.WYR_CHAINS.forEach(function (c) {
      var on = G.chains.indexOf(c.id) >= 0;
      box.appendChild(el('button', {
        class: 'pack', 'aria-pressed': on ? 'true' : 'false', 'data-chain': c.id,
        style: '--pc:' + c.accent,
        onclick: function () {
          var i = G.chains.indexOf(c.id);
          if (i >= 0) G.chains.splice(i, 1); else G.chains.push(c.id);
          save(); renderChains();
        }
      }, [
        el('span', { class: 'em', text: c.emoji }),
        el('span', { text: c.name }),
        el('span', { class: 'n', text: String(c.items.length - 1) + ' rounds' })
      ]));
    });
    $('#qcount').textContent = G.chains.length
      ? G.chains.length + ' ladder' + (G.chains.length > 1 ? 's' : '') + ' selected'
      : 'Pick at least one ladder to play.';
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
  $('#chainAll').addEventListener('click', function () {
    G.chains = MLT.WYR_CHAINS.map(function (c) { return c.id; });
    save(); renderChains();
  });
  $('#chainNone').addEventListener('click', function () { G.chains = []; save(); renderChains(); });
  $('#showVoters').addEventListener('change', function () {
    G.showVoters = $('#showVoters').checked; save(); broadcast(true);
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
  if ($('#rounds').selectedIndex < 0) $('#rounds').value = '12';
  $('#secs').value = String(G.secs);
  if ($('#secs').selectedIndex < 0) $('#secs').value = '20';
  $('#showVoters').checked = !!G.showVoters;
  renderChains();

  if (wantNew) newRoom();
  else if (saved && (saved.phase === 'ask' || saved.phase === 'reveal')) enterRoom();
  else openStart();

  window.addEventListener('beforeunload', save);
  window.__WG = G;
})();

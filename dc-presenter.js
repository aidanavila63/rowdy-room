(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SAVE = 'dc.host.v1';
  var ACCENT = '#9d6bff';

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  function blankGame() {
    return {
      code: randomCode(), seq: 0, phase: 'lobby',
      drawSecs: 40, capSecs: 20,
      packs: MLT.DC_PACKS.map(function (p) { return p.id; }),
      players: [], order: [], orderNames: [], N: 0,
      round: 0, chains: [], submitted: {}, endsAt: null,
      revealIdx: 0, votes: {}, winnerIdx: null, voteCounts: null,
      host: null, lastCmd: 0, lastActivity: Date.now()
    };
  }

  var saved = MLT.store(SAVE);
  var G = saved || blankGame();
  if (!G.packs || !G.packs.length) G.packs = MLT.DC_PACKS.map(function (p) { return p.id; });
  if (!G.order) G.order = [];
  if (!G.orderNames) G.orderNames = [];
  if (!G.chains) G.chains = [];
  if (!G.submitted) G.submitted = {};
  if (!G.votes) G.votes = {};
  if (G.host === undefined) G.host = null;
  if (!G.lastCmd) G.lastCmd = 0;
  if (!G.lastActivity) G.lastActivity = Date.now();
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

  function stepType(r) { return (r % 2 === 0) ? 'draw' : 'caption'; }
  function chainOf(idx, r, N) { return ((idx - r) % N + N) % N; }

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
    G.chains = [];
    G.order = [];
    G.orderNames = [];
    G.N = 0;
    G.submitted = {};
    G.votes = {};
    G.winnerIdx = null;
    G.voteCounts = null;
    G.endsAt = null;
    G.revealIdx = 0;
    G.players = [];
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
    window.__DCG = G;
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
    if (G.phase === 'build') runClock();
    broadcast(true);
    A.ready();
    A.music(G.phase === 'build' ? 'round' : 'lobby');
  }

  function openStart() {
    show('start');
    var resumable = !!(saved && saved.code && (saved.players.length || saved.phase !== 'lobby'));
    $('#btnResume').classList.toggle('hidden', !resumable);
    if (resumable) {
      var n = saved.players.length;
      $('#btnResume').textContent = 'Resume room ' + saved.code +
        ' · ' + n + ' player' + (n === 1 ? '' : 's');
      $('#startHint').textContent = 'Creating a new room clears the players. Finished chains are not remembered.';
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

  function poolFromPacks() {
    var pool = [];
    MLT.DC_PACKS.forEach(function (pk) {
      if (G.packs.indexOf(pk.id) < 0) return;
      pk.items.forEach(function (it) { pool.push(it); });
    });
    return pool;
  }

  function buildSeeds(n) {
    var pool = poolFromPacks();
    if (!pool.length) pool = ['something ridiculous'];
    var seeds = [];
    var guard = 0;
    while (seeds.length < n && guard++ < 50) seeds = seeds.concat(MLT.shuffle(pool));
    return seeds.slice(0, n);
  }

  function activeSecs() { return stepType(G.round) === 'draw' ? G.drawSecs : G.capSecs; }
  function setActiveSecs(v) { if (stepType(G.round) === 'draw') G.drawSecs = v; else G.capSecs = v; }

  function publicState() {
    var s = {
      phase: G.phase,
      players: G.players.map(function (p) { return { id: p.id, name: p.name }; }),
      host: G.host || null,
      N: G.N
    };
    if (G.phase === 'build') {
      s.round = G.round;
      s.step = stepType(G.round);
      s.drawSecs = G.drawSecs; s.capSecs = G.capSecs;
      s.endsAt = G.endsAt;
      s.submittedCount = Object.keys(G.submitted).length;
      s.order = G.order;
      s.myTurn = {};
      G.order.forEach(function (pid, idx) {
        var c = chainOf(idx, G.round, G.N);
        s.myTurn[pid] = {
          chain: c,
          prev: G.chains[c][G.round],
          done: !!G.submitted[pid]
        };
      });
    } else if (G.phase === 'reveal') {
      s.revealIdx = G.revealIdx;
      s.chain = G.chains[G.revealIdx];
      s.orderNames = G.orderNames;
    } else if (G.phase === 'chainvote') {
      s.summaries = G.chains.map(function (c, i) {
        return { idx: i, seed: c[0].text, last: c[c.length - 1] };
      });
      s.votes = G.votes;
      s.voteCount = Object.keys(G.votes).length;
    } else if (G.phase === 'final') {
      s.winnerIdx = G.winnerIdx;
      s.winnerChain = G.chains[G.winnerIdx];
      s.voteCounts = G.voteCounts;
      s.orderNames = G.orderNames;
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
  function nameOf(id) {
    var oi = G.orderNames && G.order ? G.order.indexOf(id) : -1;
    if (oi >= 0) return G.orderNames[oi];
    var p = playerById(id);
    return p ? p.name : '—';
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
        G.players.push({ id: m.from, name: String(m.name).slice(0, 18) });
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
      else if (d === 'skip') { if (G.phase === 'build') fillMissingAndAdvance(); }
      else if (d === 'timer+') { if (G.phase === 'build') adjustTimer(5); }
      else if (d === 'timer-') { if (G.phase === 'build') adjustTimer(-5); }
      else if (d === 'timerOff') { if (G.phase === 'build') toggleNoTimer(); }
      else if (d === 'next') { if (G.phase === 'reveal') nextChain(); }
      else if (d === 'finish') { if (G.phase === 'chainvote') showFinal(); }
      else if (d === 'again') { if (G.phase === 'final') playAgain(); }

    } else if (m.t === 'vote') {
      if (G.phase !== 'build' || m.round !== G.round) return;
      var idx = G.order.indexOf(m.from);
      if (idx < 0 || G.submitted[m.from]) return;
      var N = G.N, r = G.round, step = stepType(r);
      var c = chainOf(idx, r, N);
      var payload;
      if (step === 'draw') {
        payload = { strokes: MLT.dcSanitizeStrokes(m.pick && m.pick.strokes) };
      } else {
        var text = MLT.dcSanitizeCaption(m.pick && m.pick.text);
        payload = { text: text || '…' };
      }
      G.chains[c][r + 1] = { type: step, by: m.from, data: payload };
      G.submitted[m.from] = true;
      A.sfx('pick');
      save(); renderBuild();
      if (Object.keys(G.submitted).length >= N) {
        setTimeout(function () { if (G.phase === 'build') advanceBuild(); }, 650);
      } else {
        broadcast(false);
      }

    } else if (m.t === 'cvote') {
      if (G.phase !== 'chainvote') return;
      if (!playerById(m.from)) return;
      var v = Number(m.pick);
      if (!isFinite(v) || v < 0 || v >= G.N) return;
      G.votes[m.from] = v;
      A.sfx('pick');
      save(); renderChainvote(); broadcast(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* flow                                                                */
  /* ------------------------------------------------------------------ */
  function startGame() {
    var ds = parseInt($('#drawSecs').value, 10);
    if (!isNaN(ds)) G.drawSecs = ds;
    var cs = parseInt($('#capSecs').value, 10);
    if (!isNaN(cs)) G.capSecs = cs;
    G.order = G.players.map(function (p) { return p.id; });
    G.orderNames = G.players.map(function (p) { return p.name; });
    G.N = G.order.length;
    var seeds = buildSeeds(G.N);
    G.chains = seeds.map(function (text) { return [{ type: 'prompt', text: text }]; });
    G.round = 0;
    G.revealIdx = 0;
    G.votes = {};
    G.winnerIdx = null;
    G.voteCounts = null;
    startBuildRound();
  }

  function startBuildRound() {
    G.phase = 'build';
    G.submitted = {};
    var secs = activeSecs();
    G.endsAt = secs > 0 ? Date.now() + secs * 1000 : null;
    save();
    show('build');
    renderBuild();
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
    var span = Math.max(1, activeSecs() * 1000);
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
        if (G.phase === 'build') fillMissingAndAdvance();
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
    var wasOff = !(activeSecs() > 0);
    setActiveSecs(Math.max(5, Math.min(300, (activeSecs() > 0 ? activeSecs() : 0) + delta)));
    if (G.phase === 'build') {
      G.endsAt = (wasOff || !G.endsAt)
        ? Date.now() + activeSecs() * 1000
        : Math.max(Date.now() + 2000, G.endsAt + delta * 1000);
      runClock();
    }
    save(); renderBuild(); broadcast(true);
  }

  function toggleNoTimer() {
    var key = stepType(G.round) === 'draw' ? 'prevDrawSecs' : 'prevCapSecs';
    if (activeSecs() > 0) {
      G[key] = activeSecs();
      setActiveSecs(0);
      G.endsAt = null;
    } else {
      setActiveSecs(G[key] || (stepType(G.round) === 'draw' ? 40 : 20));
      if (G.phase === 'build') G.endsAt = Date.now() + activeSecs() * 1000;
    }
    if (G.phase === 'build') runClock();
    save(); renderBuild(); broadcast(true);
  }

  function advanceBuild() {
    clearInterval(clockTimer);
    G.round++;
    if (G.round >= G.N) { startReveal(); return; }
    startBuildRound();
  }

  function fillMissingAndAdvance() {
    clearInterval(clockTimer);
    var N = G.N, r = G.round, step = stepType(r);
    G.order.forEach(function (pid, idx) {
      if (G.submitted[pid]) return;
      var c = chainOf(idx, r, N);
      var payload = step === 'draw' ? { strokes: [] } : { text: '(sat this one out)' };
      G.chains[c][r + 1] = { type: step, by: pid, data: payload };
    });
    advanceBuild();
  }

  function startReveal() {
    G.phase = 'reveal';
    G.endsAt = null;
    G.revealIdx = 0;
    save();
    show('reveal');
    renderReveal();
    broadcast(true);
    A.music('lobby');
    A.sfx('reveal');
  }

  function nextChain() {
    if (G.revealIdx + 1 >= G.N) { startChainvote(); return; }
    G.revealIdx++;
    save(); renderReveal(); broadcast(true);
    A.sfx('blip');
  }

  function startChainvote() {
    G.phase = 'chainvote';
    G.votes = {};
    save();
    show('chainvote');
    renderChainvote();
    broadcast(true);
    A.sfx('start');
  }

  function computeWinner() {
    var counts = new Array(G.N).fill(0);
    Object.keys(G.votes).forEach(function (pid) {
      var v = G.votes[pid];
      if (v >= 0 && v < G.N) counts[v]++;
    });
    var best = 0;
    for (var i = 1; i < G.N; i++) if (counts[i] > counts[best]) best = i;
    return { winnerIdx: best, counts: counts };
  }

  function showFinal() {
    clearInterval(clockTimer);
    var r = computeWinner();
    G.phase = 'final';
    G.winnerIdx = r.winnerIdx;
    G.voteCounts = r.counts;
    save();
    show('final');
    renderFinal();
    broadcast(true);
    A.music(null);
    A.sfx('gameover');
    setTimeout(function () { if (G.phase === 'final') A.music('lobby'); }, 4200);
  }

  function playAgain() {
    G.phase = 'lobby';
    G.round = 0; G.chains = []; G.order = []; G.orderNames = []; G.N = 0;
    G.submitted = {}; G.votes = {}; G.winnerIdx = null; G.voteCounts = null;
    G.endsAt = null; G.revealIdx = 0;
    save();
    show('lobby'); renderLobby(); broadcast(true);
    A.music('lobby');
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
      ? 'Waiting for people to join… you need at least 3 for a chain worth revealing.'
      : avail < 1
        ? 'Pick at least one prompt pack in Settings.'
        : 'Everyone in? Hit start — every player draws or writes every round.';
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
    MLT.DC_PACKS.forEach(function (p) {
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
      ? avail + ' prompt' + (avail === 1 ? '' : 's') + ' ready' + (G.packs.length ? ' · ' + G.packs.length + ' pack' + (G.packs.length > 1 ? 's' : '') : '')
      : 'Pick at least one pack.';
  }

  function renderBuild() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var step = stepType(G.round);
    $('#bProgress').textContent = 'Round ' + (G.round + 1) + ' / ' + G.N;
    $('#bStep').textContent = step === 'draw' ? '✏️ Everyone is drawing' : '💬 Everyone is captioning';
    $('#bHint').textContent = step === 'draw'
      ? 'Each phone got a prompt or someone else’s caption — they’re drawing what it says.'
      : 'Each phone got someone else’s drawing — they’re writing what they think it shows.';
    $('#submittedCount').textContent = Object.keys(G.submitted).length;
    $('#submittedTotal').textContent = G.N;
    $('#secsNow').textContent = activeSecs() > 0 ? activeSecs() + 's per round' : 'no countdown';
    $('#btnNoTimer').textContent = activeSecs() > 0 ? 'No timer' : 'Timer on';
    $('#btnMinus').disabled = !(activeSecs() > 5);

    var box = $('#buildPlayers');
    box.innerHTML = '';
    G.order.forEach(function (pid, i) {
      box.appendChild(el('span', { class: 'chip' + (G.submitted[pid] ? ' voted' : '') }, [
        avatar(nameOf(pid), i), el('span', { text: nameOf(pid) })
      ]));
    });
    var spectators = G.players.filter(function (p) { return G.order.indexOf(p.id) < 0; });
    var specBox = $('#spectatorPlayers');
    specBox.innerHTML = '';
    if (spectators.length) {
      specBox.appendChild(el('span', { class: 'tiny', text: 'Watching (joining next game): ' }));
      spectators.forEach(function (p, i) {
        specBox.appendChild(el('span', { class: 'chip' }, [avatar(p.name, i), el('span', { text: p.name })]));
      });
    }
  }

  function panelNode(item, big) {
    if (!item) return el('div', { class: 'dc-panel' }, [el('div', { class: 'tiny', text: '—' })]);
    if (item.type === 'prompt') {
      return el('div', { class: 'dc-panel dc-seed' }, [
        el('div', { class: 'tiny', text: 'THE PROMPT' }),
        el('div', { class: big ? 'dc-seedtext big' : 'dc-seedtext', text: item.text })
      ]);
    }
    if (item.type === 'draw') {
      var svgBox = el('div', { class: 'dc-canvasview', html: MLT.dcStrokesToSVG(item.data && item.data.strokes, MLT.DC_CANVAS_W, MLT.DC_CANVAS_H) });
      return el('div', { class: 'dc-panel' }, [
        svgBox,
        el('div', { class: 'dc-by', text: '🎨 ' + nameOf(item.by) })
      ]);
    }
    return el('div', { class: 'dc-panel dc-caption' }, [
      el('div', { class: 'dc-captiontext', text: '“' + (item.data && item.data.text || '') + '”' }),
      el('div', { class: 'dc-by', text: '💬 ' + nameOf(item.by) })
    ]);
  }

  function renderReveal() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var chain = G.chains[G.revealIdx] || [];
    $('#rProgress').textContent = 'Chain ' + (G.revealIdx + 1) + ' / ' + G.N;
    var strip = $('#filmstrip');
    strip.innerHTML = '';
    chain.forEach(function (item, i) {
      strip.appendChild(panelNode(item, i === 0));
      if (i < chain.length - 1) strip.appendChild(el('div', { class: 'dc-arrow', text: '→' }));
    });
    $('#btnNextChain').textContent = (G.revealIdx + 1 >= G.N) ? 'Vote for a favorite' : 'Next chain';
  }

  function renderChainvote() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var grid = $('#voteGrid');
    grid.innerHTML = '';
    var counts = new Array(G.N).fill(0);
    Object.keys(G.votes).forEach(function (pid) {
      var v = G.votes[pid];
      if (v >= 0 && v < G.N) counts[v]++;
    });
    var max = Math.max(1, counts.reduce(function (a, b) { return Math.max(a, b); }, 0));
    G.chains.forEach(function (chain, i) {
      var last = chain[chain.length - 1];
      var thumb = last.type === 'draw'
        ? el('div', { class: 'dc-thumb', html: MLT.dcStrokesToSVG(last.data && last.data.strokes, MLT.DC_CANVAS_W, MLT.DC_CANVAS_H) })
        : el('div', { class: 'dc-thumb dc-thumbtext', text: '“' + (last.data && last.data.text || '') + '”' });
      var fill = el('i', {});
      var n = counts[i];
      var card = el('div', { class: 'dc-votecard' }, [
        el('div', { class: 'tiny', text: 'Chain ' + (i + 1) + ' · started with "' + chain[0].text + '"' }),
        thumb,
        el('div', { class: 'track' }, [fill]),
        el('div', { class: 'n', text: n + ' vote' + (n === 1 ? '' : 's') })
      ]);
      grid.appendChild(card);
      setTimeout(function () { fill.style.width = (n / max) * 100 + '%'; fill.style.background = MLT.colorFor(i); fill.style.color = MLT.colorFor(i); }, 60);
    });
    $('#voteCount').textContent = Object.keys(G.votes).length;
    $('#voteTotal').textContent = G.players.length;
  }

  function renderFinal() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var chain = G.winnerChain || G.chains[G.winnerIdx] || [];
    var n = (G.voteCounts && G.voteCounts[G.winnerIdx]) || 0;
    $('#finalTitle').textContent = 'The room’s favorite chain';
    $('#finalSub').textContent = 'Chain ' + (G.winnerIdx + 1) + ' won with ' + n + ' vote' + (n === 1 ? '' : 's');
    var strip = $('#finalFilmstrip');
    strip.innerHTML = '';
    chain.forEach(function (item, i) {
      strip.appendChild(panelNode(item, i === 0));
      if (i < chain.length - 1) strip.appendChild(el('div', { class: 'dc-arrow', text: '→' }));
    });
    var tally = $('#finalTally');
    tally.innerHTML = '';
    (G.voteCounts || []).forEach(function (c, i) {
      var max = Math.max(1, (G.voteCounts || []).reduce(function (a, b) { return Math.max(a, b); }, 0));
      var fill = el('i', { style: 'background:' + MLT.colorFor(i) + ';color:' + MLT.colorFor(i) + ';width:' + ((c / max) * 100) + '%' });
      tally.appendChild(el('div', { class: 'bar' }, [
        el('div', { class: 'who' }, [el('span', { text: 'Chain ' + (i + 1) })]),
        el('div', { class: 'track' }, [fill]),
        el('div', { class: 'n', text: String(c) })
      ]));
    });
    MLT.confetti([MLT.colorFor(G.winnerIdx)]);
  }

  function renderAll() {
    if (G.phase === 'lobby') renderLobby();
    else if (G.phase === 'build') renderBuild();
    else if (G.phase === 'reveal') renderReveal();
    else if (G.phase === 'chainvote') renderChainvote();
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
    G.packs = MLT.DC_PACKS.map(function (p) { return p.id; });
    save(); renderPacks(); renderLobby();
  });
  $('#packNone').addEventListener('click', function () { G.packs = []; save(); renderPacks(); renderLobby(); });
  $('#drawSecs').addEventListener('change', function () {
    var v = parseInt($('#drawSecs').value, 10);
    G.drawSecs = isNaN(v) ? 40 : v;
    save();
  });
  $('#capSecs').addEventListener('change', function () {
    var v = parseInt($('#capSecs').value, 10);
    G.capSecs = isNaN(v) ? 20 : v;
    save();
  });
  $('#btnMinus').addEventListener('click', function () { adjustTimer(-5); });
  $('#btnPlus').addEventListener('click', function () { adjustTimer(5); });
  $('#btnNoTimer').addEventListener('click', toggleNoTimer);
  $('#btnSkip').addEventListener('click', fillMissingAndAdvance);
  $('#btnNextChain').addEventListener('click', nextChain);
  $('#btnFinishVote').addEventListener('click', showFinal);
  $('#btnAgain').addEventListener('click', playAgain);
  $('#btnHome').addEventListener('click', newRoom);

  $('#drawSecs').value = String(G.drawSecs);
  if ($('#drawSecs').selectedIndex < 0) $('#drawSecs').value = '40';
  $('#capSecs').value = String(G.capSecs);
  if ($('#capSecs').selectedIndex < 0) $('#capSecs').value = '20';
  renderPacks();

  if (wantNew) newRoom();
  else if (saved && saved.phase === 'build') enterRoom();
  else openStart();

  window.addEventListener('beforeunload', save);
  window.__DCG = G;
})();

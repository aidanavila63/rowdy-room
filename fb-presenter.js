(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SAVE = 'fb.host.v1';
  var ACCENT = '#9d6bff';
  var VOTE_SECS = 20;

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  function blankGame() {
    return {
      code: randomCode(), seq: 0, phase: 'lobby',
      round: 0, total: 10, secs: 45,
      packs: MLT.FB_PACKS.map(function (p) { return p.id; }),
      usedPrompts: [], item: null,
      fakes: {}, choices: [], votes: {},
      players: [], endsAt: null,
      history: [], host: null, lastCmd: 0, lastActivity: Date.now()
    };
  }

  var saved = MLT.store(SAVE);
  var G = saved || blankGame();
  if (!G.packs || !G.packs.length) G.packs = MLT.FB_PACKS.map(function (p) { return p.id; });
  if (!G.usedPrompts) G.usedPrompts = [];
  if (!G.fakes) G.fakes = {};
  if (!G.choices) G.choices = [];
  if (!G.votes) G.votes = {};
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
    clearInterval(voteClockTimer);
    G.code = (typeof forceCode === 'string' && /^[A-Z0-9]{4}$/.test(forceCode)) ? forceCode : randomCode();
    G.seq = 0;
    G.phase = 'lobby';
    G.round = 0;
    G.usedPrompts = [];
    G.item = null;
    G.fakes = {};
    G.choices = [];
    G.votes = {};
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
    clearInterval(voteClockTimer);
    MLT.store(SAVE, null);
    saved = null;
    G = blankGame();
    save();
    window.__FBG = G;
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
    show(G.phase === 'submit' ? 'submit' : G.phase === 'vote' ? 'vote' : G.phase === 'reveal' ? 'reveal' : G.phase === 'final' ? 'final' : 'lobby');
    renderAll();
    renderPacks();
    makeQR();
    if (G.phase === 'submit') runClock();
    if (G.phase === 'vote') runVoteClock();
    broadcast(true);
    A.ready();
    A.music(G.phase === 'submit' || G.phase === 'vote' ? 'round' : 'lobby');
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
      players: G.players.map(function (p) { return { id: p.id, name: p.name, pts: p.pts }; }),
      host: G.host || null
    };
    if (G.phase === 'lobby') {
      s.packs = G.packs;
    } else if (G.phase === 'submit') {
      s.prompt = G.item ? G.item.prompt : '';
      s.submitted = Object.keys(G.fakes);
    } else if (G.phase === 'vote') {
      s.prompt = G.item ? G.item.prompt : '';
      /* opaque choice ids only — never leak which one is real or who wrote it
         while voting is live, or a savvy player could read it in devtools. */
      s.choices = G.choices.map(function (c) { return { id: c.id, text: c.text }; });
      s.voted = Object.keys(G.votes);
    } else if (G.phase === 'reveal') {
      var h = G.history[G.history.length - 1] || {};
      s.prompt = h.prompt; s.answer = h.answer; s.choices = h.choices;
      s.votes = h.votes; s.correctVoters = h.correctVoters;
      s.fooledCounts = h.fooledCounts; s.correctCount = h.correctCount; s.totalVoters = h.totalVoters;
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
  function choiceById(id) {
    for (var i = 0; i < G.choices.length; i++) if (G.choices[i].id === id) return G.choices[i];
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* fact pool                                                           */
  /* ------------------------------------------------------------------ */
  function poolFromPacks() {
    var pool = [];
    MLT.FB_PACKS.forEach(function (pk) {
      if (G.packs.indexOf(pk.id) < 0) return;
      pk.items.forEach(function (it) { pool.push(it); });
    });
    return pool;
  }

  function pickItem() {
    var pool = poolFromPacks();
    if (!pool.length) return { prompt: 'Pick at least one pack to continue…', answer: '' };
    var avail = pool.filter(function (it) { return G.usedPrompts.indexOf(it.prompt) < 0; });
    if (!avail.length) { G.usedPrompts = []; avail = pool.slice(); }
    var item = avail[Math.floor(Math.random() * avail.length)];
    G.usedPrompts.push(item.prompt);
    return item;
  }

  function buildChoices() {
    var real = { id: MLT.uid(), text: G.item.answer, real: true, author: null };
    var fakes = Object.keys(G.fakes).map(function (pid) {
      return { id: MLT.uid(), text: G.fakes[pid], real: false, author: pid };
    });
    return MLT.shuffle([real].concat(fakes));
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
      if (d === 'start') { if (G.phase === 'lobby' && G.players.length >= 3 && poolFromPacks().length) startGame(); }
      else if (d === 'lock') { if (G.phase === 'submit') lockSubmissions(); }
      else if (d === 'reveal') { if (G.phase === 'vote') doReveal(); }
      else if (d === 'skip') { if (G.phase === 'submit') skipRound(); }
      else if (d === 'next') { if (G.phase === 'reveal') nextRound(); }
      else if (d === 'timer+') { if (G.phase === 'submit') adjustTimer(5); }
      else if (d === 'timer-') { if (G.phase === 'submit') adjustTimer(-5); }
      else if (d === 'timerOff') { if (G.phase === 'submit') toggleNoTimer(); }
      else if (d === 'again') { if (G.phase === 'final') playAgain(); }

    } else if (m.t === 'fake') {
      if (G.phase !== 'submit' || m.round !== G.round) return;
      if (!playerById(m.from)) return;
      var text = String(m.text || '').trim().slice(0, 60);
      if (text.length < 2) return;
      if (MLT.fbNormalize(text) === MLT.fbNormalize(G.item.answer)) {
        if (bus) bus.send({ t: 'tooclose', to: m.from });
        return;
      }
      G.fakes[m.from] = text;
      A.sfx('blip');
      save(); renderSubmit(); broadcast(true);
      if (Object.keys(G.fakes).length >= G.players.length) {
        setTimeout(function () { if (G.phase === 'submit') lockSubmissions(); }, 500);
      }

    } else if (m.t === 'vote') {
      if (G.phase !== 'vote' || m.round !== G.round) return;
      if (!playerById(m.from)) return;
      var choice = choiceById(m.pick);
      if (!choice) return;
      if (choice.author === m.from) {                  /* can't vote for your own fake */
        if (bus) bus.send({ t: 'selfvote', to: m.from });
        return;
      }
      if (G.votes[m.from] === m.pick) return;
      G.votes[m.from] = m.pick;
      A.sfx('pick');
      save(); renderVote();
      if (Object.keys(G.votes).length >= G.players.length) {
        setTimeout(function () { if (G.phase === 'vote') doReveal(); }, 700);
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
    G.round = 0;
    G.usedPrompts = [];
    G.history = [];
    G.players.forEach(function (p) { p.pts = 0; });
    startRound();
  }

  function startRound() {
    G.item = pickItem();
    G.fakes = {};
    G.phase = 'submit';
    G.endsAt = G.secs > 0 ? Date.now() + G.secs * 1000 : null;
    save();
    show('submit');
    renderSubmit();
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
        if (G.phase === 'submit') lockSubmissions();
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
    if (G.phase === 'submit') {
      G.endsAt = (wasOff || !G.endsAt)
        ? Date.now() + G.secs * 1000
        : Math.max(Date.now() + 2000, G.endsAt + delta * 1000);
      runClock();
    }
    save(); renderSubmit(); broadcast(true);
  }

  function toggleNoTimer() {
    if (G.secs > 0) {
      G.prevSecs = G.secs; G.secs = 0; G.endsAt = null;
    } else {
      G.secs = G.prevSecs || 45;
      if (G.phase === 'submit') G.endsAt = Date.now() + G.secs * 1000;
    }
    if (G.phase === 'submit') runClock();
    save(); renderSubmit(); broadcast(true);
  }

  function lockSubmissions() {
    if (G.phase !== 'submit') return;
    clearInterval(clockTimer);
    moveToVote();
  }

  function moveToVote() {
    G.choices = buildChoices();
    G.votes = {};
    G.phase = 'vote';
    G.endsAt = Date.now() + VOTE_SECS * 1000;
    save();
    show('vote');
    renderVote();
    broadcast(true);
    runVoteClock();
    A.sfx('reveal');
  }

  var voteClockTimer = null;
  function runVoteClock() {
    clearInterval(voteClockTimer);
    var clock = $('#voteClock');
    var endsAt = G.endsAt;
    var span = VOTE_SECS * 1000;
    function tick() {
      var left = endsAt - Date.now();
      if (left <= 0) {
        clearInterval(voteClockTimer);
        clock.textContent = '0';
        clock.classList.remove('urgent');
        $('#voteFill').style.width = '0%';
        if (G.phase === 'vote') doReveal();
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 5200);
      $('#voteFill').style.width = Math.max(0, (left / span) * 100) + '%';
    }
    tick();
    voteClockTimer = setInterval(tick, 200);
  }

  function skipRound() {
    if (G.phase !== 'submit') return;
    clearInterval(clockTimer);
    startRound();
  }

  function doReveal() {
    clearInterval(voteClockTimer);
    G.phase = 'reveal';
    G.endsAt = null;
    var correctVoters = [], fooledCounts = {};
    Object.keys(G.votes).forEach(function (voter) {
      var choice = choiceById(G.votes[voter]);
      if (!choice) return;
      if (choice.real) correctVoters.push(voter);
      else if (choice.author) fooledCounts[choice.author] = (fooledCounts[choice.author] || 0) + 1;
    });
    var totalVoters = Object.keys(G.votes).length;
    if (totalVoters > 0) {
      correctVoters.forEach(function (id) { var p = playerById(id); if (p) p.pts += 1; });
      Object.keys(fooledCounts).forEach(function (authorId) {
        var p = playerById(authorId);
        if (p) p.pts += fooledCounts[authorId];
      });
    }
    G.history.push({
      prompt: G.item.prompt, answer: G.item.answer, choices: G.choices, votes: G.votes,
      correctVoters: correctVoters, fooledCounts: fooledCounts,
      correctCount: correctVoters.length, totalVoters: totalVoters
    });
    save();
    show('reveal');
    renderReveal();
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

  function playAgain() {
    G.phase = 'lobby';
    G.round = 0; G.usedPrompts = []; G.item = null;
    G.fakes = {}; G.choices = []; G.votes = {}; G.endsAt = null; G.history = [];
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
    var caught = {}, fooled = {};
    G.history.forEach(function (h) {
      h.correctVoters.forEach(function (id) { caught[id] = (caught[id] || 0) + 1; });
      Object.keys(h.fooledCounts).forEach(function (id) { fooled[id] = (fooled[id] || 0) + h.fooledCounts[id]; });
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
    var seeker = topOf(caught);
    if (seeker) {
      awards.push({ t: 'Truth Seeker', p: seeker.id, c: '#22e6ff',
        d: 'Spotted the truth ' + seeker.n + (seeker.n === 1 ? ' time' : ' times') });
    }
    var fibber = topOf(fooled);
    if (fibber) {
      awards.push({ t: 'Master Fibber', p: fibber.id, c: '#ff2d95',
        d: 'Fooled ' + fibber.n + ' vote' + (fibber.n === 1 ? '' : 's') + ' with a fake' });
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
    MLT.FB_PACKS.forEach(function (p) {
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
      ? avail + ' fact' + (avail === 1 ? '' : 's') + ' ready' + (G.packs.length ? ' · ' + G.packs.length + ' pack' + (G.packs.length > 1 ? 's' : '') : '')
      : 'Pick at least one pack.';
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
    $('#btnStart').disabled = G.players.length < 3 || !poolFromPacks().length;
    $('#lobbyHint').textContent = G.players.length < 3
      ? 'Waiting for people to join… you need at least 3.'
      : !poolFromPacks().length
        ? 'Pick at least one fact pack in Settings.'
        : 'Everyone in? Hit start.';
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

  function renderSubmit() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    $('#subProgress').textContent = 'Round ' + (G.round + 1) + ' / ' + G.total;
    $('#subPrompt').textContent = G.item ? G.item.prompt : '—';
    var n = Object.keys(G.fakes).length;
    $('#subCount').textContent = n;
    $('#subTotal').textContent = G.players.length;
    $('#secsNow').textContent = G.secs > 0 ? G.secs + 's to answer' : 'no countdown';
    $('#btnNoTimer').textContent = G.secs > 0 ? 'No timer' : 'Timer on';
    $('#btnMinus').disabled = !(G.secs > 5);

    var box = $('#subPlayers');
    box.innerHTML = '';
    G.players.forEach(function (p, i) {
      box.appendChild(el('span', { class: 'chip' + (G.fakes[p.id] ? ' voted' : '') }, [
        avatar(p.name, i), el('span', { text: p.name })
      ]));
    });
  }

  function renderVote() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    $('#voteProgress').textContent = 'Round ' + (G.round + 1) + ' / ' + G.total;
    $('#votePrompt').textContent = G.item ? G.item.prompt : '—';
    var box = $('#voteChoices');
    box.innerHTML = '';
    G.choices.forEach(function (c) {
      box.appendChild(el('div', { class: 'fb-choice' }, [el('span', { text: c.text })]));
    });
    $('#voteCount').textContent = Object.keys(G.votes).length;
    $('#voteTotal').textContent = G.players.length;
  }

  function renderReveal() {
    document.documentElement.style.setProperty('--accent', ACCENT);
    var h = G.history[G.history.length - 1];
    if (!h) return;
    var promptBox = $('#revealPrompt');
    promptBox.innerHTML = '';
    var parts = h.prompt.split('___');
    promptBox.appendChild(document.createTextNode(parts[0] || ''));
    promptBox.appendChild(el('span', { class: 'fb-answer-fill', text: h.answer }));
    promptBox.appendChild(document.createTextNode(parts[1] || ''));
    var box = $('#revealChoices');
    box.innerHTML = '';
    var cast = h.totalVoters;
    h.choices.forEach(function (c) {
      var voters = Object.keys(h.votes).filter(function (v) { return h.votes[v] === c.id; }).map(nameOf);
      var n = voters.length;
      var pct = cast ? Math.round((n / cast) * 100) : 0;
      var fill = el('i', { style: 'width:0%;background:' + (c.real ? '#3dff9e' : '#ff2d95') });
      var row = el('div', { class: 'fb-reveal-row' + (c.real ? ' real' : '') }, [
        el('div', { class: 'fb-rr-tag', style: 'color:' + (c.real ? '#3dff9e' : '#ff2d95'), text: c.real ? 'THE TRUTH' : 'FAKE · by ' + nameOf(c.author) }),
        el('div', { class: 'fb-rr-text', text: c.text }),
        el('div', { class: 'track' }, [fill]),
        el('div', { class: 'tiny', text: n + (n === 1 ? ' vote' : ' votes') + (voters.length ? ' · ' + voters.join(', ') : '') })
      ]);
      box.appendChild(row);
      setTimeout(function () { fill.style.width = pct + '%'; }, 60);
    });
    $('#revealSummary').textContent = cast === 0
      ? 'Nobody voted this round.'
      : h.correctCount + ' of ' + cast + ' found the truth';
    $('#revealProgress').textContent = 'Round ' + (G.round + 1) + ' / ' + G.total;
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
      ? sorted[0].name + " can't be fooled"
      : 'Final standings';

    MLT.confetti(sorted.slice(0, 3).map(function (p) { return MLT.colorFor(indexOfPlayer(p.id)); }));
  }

  function renderAll() {
    if (G.phase === 'lobby') renderLobby();
    else if (G.phase === 'submit') renderSubmit();
    else if (G.phase === 'vote') renderVote();
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
    G.packs = MLT.FB_PACKS.map(function (p) { return p.id; });
    save(); renderPacks(); renderLobby();
  });
  $('#packNone').addEventListener('click', function () { G.packs = []; save(); renderPacks(); renderLobby(); });
  $('#rounds').addEventListener('change', function () {
    G.total = parseInt($('#rounds').value, 10) || G.total || 10;
    save();
  });
  $('#secs').addEventListener('change', function () {
    var v = parseInt($('#secs').value, 10);
    G.secs = isNaN(v) ? 45 : v;
    save();
  });
  $('#btnMinus').addEventListener('click', function () { adjustTimer(-5); });
  $('#btnPlus').addEventListener('click', function () { adjustTimer(5); });
  $('#btnNoTimer').addEventListener('click', toggleNoTimer);
  $('#btnLock').addEventListener('click', lockSubmissions);
  $('#btnSkip').addEventListener('click', skipRound);
  $('#btnRevealNow').addEventListener('click', function () { if (G.phase === 'vote') doReveal(); });
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
  if ($('#secs').selectedIndex < 0) $('#secs').value = '45';

  if (PLAYLIST_MODE) newRoom((MLT.qs('r') || '').toUpperCase());
  else if (wantNew) newRoom();
  else if (saved && (saved.phase === 'submit' || saved.phase === 'vote' || saved.phase === 'reveal')) enterRoom();
  else openStart();

  window.addEventListener('beforeunload', save);
  window.__FBG = G;
})();

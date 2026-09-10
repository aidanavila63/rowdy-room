(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var slot = MLT.qs('me');
  var SAVE = 'tc.me.v1' + (slot ? '.' + slot : '');
  var ACCENT = '#b6ff3b';

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '' };
  var bus = null;
  var S = null;
  var lastSeq = -1;
  var skew = 0;
  var seenRound = -1;
  var helloTimer = null, clockTimer = null;
  var confettied = false;
  var soundedReveal = -1;

  var mySecretItem = null, mySecretRound = -1;

  var urlCode = (MLT.qs('r') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  $('#code').value = urlCode || me.code || '';
  $('#name').value = me.name || '';
  if (!me.name && MLT.qs('nm')) $('#name').value = MLT.qs('nm');
  if (MLT.qs('auto') === '1' && urlCode && $('#name').value) setTimeout(join, 30);

  document.documentElement.style.setProperty('--accent', ACCENT);

  /* ------------------------------------------------------------------ */
  function join() {
    var code = ($('#code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    var name = ($('#name').value || '').trim().slice(0, 18);
    if (code.length !== 4) { MLT.toast('Enter the 4-character room code'); $('#code').focus(); return; }
    if (!name) { MLT.toast('Enter your name'); $('#name').focus(); return; }

    me.code = code; me.name = name;
    MLT.store(SAVE, me);

    A.ready();
    A.sfx('join');
    $('#status').classList.remove('hidden');
    bus = MLT.createBus({ code: code, role: 'player' });
    MLT.wireStatus(bus, $('#status'));
    bus.on(onMessage);
    bus.onStatus(function (s) { if (s === 'online') sayHello(); });

    show('wait');
    $('#waitHi').textContent = "You're in, " + name + '!';
    sayHello();
    clearInterval(helloTimer);
    helloTimer = setInterval(function () { if (!S) sayHello(); }, 5000);
  }

  function sayHello() {
    if (bus) bus.send({ t: 'hello', from: me.id, name: me.name });
  }

  /* ------------------------------------------------------------------ */
  function roomClosed() {
    clearInterval(helloTimer);
    clearInterval(clockTimer);
    if (bus) { bus.close(); bus = null; }
    S = null; lastSeq = -1; seenRound = -1; soundedReveal = -1;
    mySecretItem = null; mySecretRound = -1;
    A.sfx('bye');
    $('#status').classList.add('hidden');
    $('#hostBar').classList.add('hidden');
    $('#hostBtns').dataset.sig = '';
    document.body.classList.remove('has-host');
    show('join');
    MLT.toast('The host opened a new room — ask for the new code');
  }

  var leaving = false;
  function onMessage(m) {
    if (MLT.handleAdvance(m, me.name)) return;
    if (m.t === 'closed') { roomClosed(); return; }
    if (m.t === 'secret') {
      if (m.to === me.id) { mySecretItem = { phrase: m.phrase, taboo: m.taboo }; mySecretRound = m.round; render(); }
      return;
    }
    if (m.t === 'blocked') {
      if (m.to === me.id) { A.sfx('bye'); MLT.toast('Can’t say "' + m.word + '" — try another clue'); shakeClue(); }
      return;
    }
    if (m.t === 'wrong') {
      if (m.to === me.id) { A.sfx('bye'); MLT.toast('Not quite — try again'); shakeGuess(); }
      return;
    }
    if (m.t !== 'state') return;
    if (typeof m.seq === 'number' && m.seq <= lastSeq) return;
    lastSeq = m.seq;
    if (typeof m.now === 'number') skew = m.now - Date.now();
    S = m.s;
    if (!leaving && !S.players.some(function (p) { return p.id === me.id; })) sayHello();
    if (S.phase === 'clue' && S.clueGiverId === me.id && mySecretRound !== S.round && bus) {
      bus.send({ t: 'needitem', from: me.id });
    }
    render();
  }

  function shakeClue() {
    var input = $('#tcClueIn');
    if (!input) return;
    input.classList.remove('shake');
    void input.offsetWidth;
    input.classList.add('shake');
  }

  function shakeGuess() {
    var input = $('#tcGuessIn');
    if (!input) return;
    input.classList.remove('shake');
    void input.offsetWidth;
    input.classList.add('shake');
  }

  function playerIndex(id) {
    for (var i = 0; i < S.players.length; i++) if (S.players[i].id === id) return i;
    return -1;
  }
  function playerName(id) {
    var i = playerIndex(id);
    return i < 0 ? '—' : S.players[i].name;
  }

  /* ------------------------------------------------------------------ */
  var cmdN = 0;
  function cmd(d) {
    if (!bus) return;
    cmdN = Math.max(cmdN + 1, Date.now());
    bus.send({ t: 'cmd', from: me.id, do: d, n: cmdN });
    A.sfx('blip');
  }

  function renderHostBar() {
    var mine = !!(S && S.host === me.id);
    $('#hostBar').classList.toggle('hidden', !mine);
    document.body.classList.toggle('has-host', mine);
    if (!mine) return;

    var wrap = $('#hostBtns');
    var sig = S.phase + '|' + (S.round || 0) + '|' + S.players.length;
    if (wrap.dataset.sig === sig) return;
    wrap.dataset.sig = sig;
    wrap.innerHTML = '';

    function btn(label, action, opts) {
      opts = opts || {};
      wrap.appendChild(el('button', {
        class: opts.primary ? '' : 'ghost mini',
        disabled: opts.disabled ? 'disabled' : null,
        text: label,
        onclick: function () { cmd(action); }
      }));
    }

    if (S.phase === 'lobby') {
      btn('Start game', 'start', { primary: true, disabled: S.players.length < 3 });
    } else if (S.phase === 'clue') {
      btn('−5s', 'timer-');
      btn('+5s', 'timer+');
      btn('Reveal', 'skip', { primary: true });
    } else if (S.phase === 'reveal') {
      btn(S.round + 1 >= S.totalRounds ? 'Final standings' : 'Next round', 'next', { primary: true });
    } else if (S.phase === 'final') {
      btn('Play again', 'again', { primary: true });
    }
  }

  function render() {
    if (!S) return;
    renderHostBar();
    if (S.phase === 'lobby') { renderWait(); show('wait'); }
    else if (S.phase === 'clue') { renderClue(); show('clue'); }
    else if (S.phase === 'reveal') { renderReveal(); show('reveal'); }
    else if (S.phase === 'final') { renderDone(); show('final'); }
  }

  function renderWait() {
    clearInterval(clockTimer);
    confettied = false;
    var box = $('#waitPlayers');
    box.innerHTML = '';
    (S ? S.players : []).forEach(function (p, i) {
      box.appendChild(el('span', { class: 'chip' }, [
        avatar(p.name, i), el('span', { text: p.name + (p.id === me.id ? ' (you)' : '') })
      ]));
    });
    $('#waitMsg').textContent = (S && S.players.length < 3)
      ? 'Waiting for more players… you need at least 3.'
      : 'Waiting for the host to start…';
  }

  function renderClueFeed(node, clues) {
    node.innerHTML = '';
    if (!clues || !clues.length) {
      node.appendChild(el('div', { class: 'tiny', style: 'color:var(--dimmer)', text: 'Waiting for the first clue…' }));
    } else {
      clues.forEach(function (c) {
        node.appendChild(el('div', { class: 'tc-cluebubble', text: c }));
      });
    }
    node.scrollTop = node.scrollHeight;
  }

  function renderClue() {
    if (seenRound !== S.round) {
      seenRound = S.round;
      $('#tcClueIn').value = '';
      $('#tcGuessIn').value = '';
    }
    var amGiver = S.clueGiverId === me.id;
    $('#cBanner').textContent = 'Round ' + (S.round + 1) + ' / ' + S.totalRounds;
    $('#tcGiverUI').classList.toggle('hidden', !amGiver);
    $('#tcGuesserUI').classList.toggle('hidden', amGiver);

    if (amGiver) {
      var haveItem = mySecretRound === S.round && mySecretItem;
      $('#tcPhraseBig').textContent = haveItem ? mySecretItem.phrase : 'Getting your phrase…';
      var tabooBox = $('#tcTabooList');
      tabooBox.innerHTML = '';
      if (haveItem) {
        mySecretItem.taboo.forEach(function (w) {
          tabooBox.appendChild(el('span', { class: 'tc-taboochip', text: w }));
        });
      }
      renderClueFeed($('#tcClueFeedGiver'), S.clues);
      $('#cCorrect').textContent = (S.guessedIds || []).length;
      $('#cTotal').textContent = S.totalGuessers || 0;
    } else {
      renderClueFeed($('#tcClueFeedGuesser'), S.clues);
      var mine = (S.guessedIds || []).indexOf(me.id) >= 0;
      $('#tcGuessDone').classList.toggle('hidden', !mine);
      $('#tcGuessForm').classList.toggle('hidden', mine);
      $('#gCorrect').textContent = (S.guessedIds || []).length;
      $('#gTotal').textContent = S.totalGuessers || 0;
    }
    runClock();
  }

  function submitClue() {
    var text = ($('#tcClueIn').value || '').trim();
    if (!text) { MLT.toast('Type a clue first'); return; }
    if (mySecretItem) {
      var hit = MLT.tcCheckClue(text, mySecretItem);
      if (hit) {
        MLT.toast('Can’t say "' + hit + '" — try another clue');
        shakeClue();
        return;
      }
    }
    bus.send({ t: 'clue', from: me.id, round: S.round, text: text });
    $('#tcClueIn').value = '';
  }

  function submitGuess() {
    var text = ($('#tcGuessIn').value || '').trim();
    if (!text) { MLT.toast('Type a guess first'); return; }
    bus.send({ t: 'guess', from: me.id, round: S.round, text: text });
    $('#tcGuessIn').value = '';
  }

  function runClock() {
    clearInterval(clockTimer);
    var clock = $('#cClock');
    if (!S.endsAt) { clock.textContent = ''; clock.classList.remove('urgent'); $('#cFill').style.width = '100%'; return; }
    var endsAt = S.endsAt;
    var total = Math.max(1, (S.secs || 75) * 1000);
    function tick() {
      var left = endsAt - (Date.now() + skew);
      if (left <= 0) {
        clearInterval(clockTimer);
        clock.textContent = '0';
        clock.classList.remove('urgent');
        $('#cFill').style.width = '0%';
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 5200);
      $('#cFill').style.width = Math.min(100, (left / total) * 100) + '%';
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function renderReveal() {
    clearInterval(clockTimer);
    if (soundedReveal !== S.round) { soundedReveal = S.round; A.sfx('reveal'); }
    var amGiver = S.clueGiverId === me.id;
    $('#rBanner').textContent = 'Round ' + (S.round + 1) + ' / ' + S.totalRounds;
    $('#rPhrase').textContent = S.phrase;
    $('#rTaboo').textContent = (S.taboo || []).join(' · ');
    renderClueFeed($('#tcRevealFeed'), S.clues);
    $('#rGiverLine').textContent = (amGiver ? 'You' : playerName(S.clueGiverId)) + ' gave the clues — ' + S.correctCount + ' / ' + S.totalGuessers + ' guessed it';

    var outcome = $('#rMyOutcome');
    if (amGiver) {
      outcome.classList.remove('hidden');
      outcome.style.color = '#b6ff3b';
      outcome.style.background = 'rgba(182,255,59,0.1)';
      outcome.textContent = '+' + (S.clueGiverPts || 0) + ' pts for clues people could crack';
    } else if (S.guessed && S.guessed[me.id] !== undefined) {
      outcome.classList.remove('hidden');
      outcome.style.color = '#3dff9e';
      outcome.style.background = 'rgba(61,255,158,0.1)';
      outcome.textContent = '+' + S.guessed[me.id] + ' pts — you got it!';
    } else {
      outcome.classList.remove('hidden');
      outcome.style.color = '#ff2d95';
      outcome.style.background = 'rgba(255,45,149,0.1)';
      outcome.textContent = "Didn't guess it this time — 0 pts";
    }

    var bars = $('#rBars');
    bars.innerHTML = '';
    (S.guessOrder || []).forEach(function (id, i) {
      var idx = playerIndex(id);
      var col = MLT.colorFor(idx);
      var fill = el('i', { style: 'background:' + col + ';color:' + col });
      var num = el('div', { class: 'n', text: '0' });
      var pts = S.guessed[id];
      bars.appendChild(el('div', { class: 'bar' }, [
        el('div', { class: 'who' }, [avatar(playerName(id), idx), el('span', { text: playerName(id) + (id === me.id ? ' (you)' : '') })]),
        el('div', {}, [el('div', { class: 'track' }, [fill]), el('div', { class: 'voters', text: 'guessed #' + (i + 1) })]),
        num
      ]));
      setTimeout(function () { MLT.countUp(num, pts, 500); fill.style.width = pts + '%'; }, 60);
    });
  }

  function renderDone() {
    clearInterval(clockTimer);
    var sorted = S.players.slice().sort(function (a, b) { return b.pts - a.pts; });

    var node = $('#podium');
    node.innerHTML = '';
    var heights = [150, 110, 84];
    [1, 0, 2].forEach(function (rank) {
      var p = sorted[rank];
      var slotEl = el('div', { class: 'plinth' });
      if (!p) { node.appendChild(slotEl); return; }
      var idx = playerIndex(p.id);
      var col = MLT.colorFor(idx);
      slotEl.appendChild(el('div', { class: 'head' }, [
        avatar(p.name, idx),
        el('div', { class: 'nm', text: p.name + (p.id === me.id ? ' (you)' : '') }),
        el('div', { class: 'sc', text: p.pts + ' pts' })
      ]));
      var bar = el('div', { class: 'col', style: 'color:' + col }, [el('div', { class: 'rk', text: String(rank + 1) })]);
      slotEl.appendChild(bar);
      node.appendChild(slotEl);
      setTimeout(function () { bar.style.height = heights[rank] + 'px'; }, 120 + rank * 160);
    });

    var lb = $('#lb');
    lb.innerHTML = '';
    sorted.slice(3).forEach(function (p, i) {
      lb.appendChild(el('div', { class: 'lbrow' }, [
        el('div', { class: 'rank', text: String(i + 4) }),
        el('div', { class: 'name' }, [avatar(p.name, playerIndex(p.id)), el('span', { text: p.name + (p.id === me.id ? ' (you)' : '') })]),
        el('div', { class: 'pts', text: p.pts + ' pts' })
      ]));
    });

    var box = $('#awards');
    box.innerHTML = '';
    (S.awards || []).forEach(function (aw) {
      var idx = playerIndex(aw.p);
      box.appendChild(el('div', { class: 'award', style: '--ac:' + aw.c }, [
        el('div', { class: 't', text: aw.t }),
        el('div', { class: 'w' }, [avatar(playerName(aw.p), idx), el('span', { text: playerName(aw.p) })]),
        el('div', { class: 'd', text: aw.d })
      ]));
    });

    if (!confettied) {
      confettied = true;
      A.sfx('gameover');
      MLT.confetti(sorted.slice(0, 3).map(function (p) { return MLT.colorFor(playerIndex(p.id)); }));
    }
  }

  /* ------------------------------------------------------------------ */
  $('#btnSfx').addEventListener('click', function () {
    A.ready(); A.toggleSfx(); if (A.state.sfx) A.sfx('blip');
  });
  A.onChange(function (s) { $('#btnSfx').classList.toggle('off', !s.sfx); });
  $('#btnJoin').addEventListener('click', join);
  $('#name').addEventListener('keydown', function (e) { if (e.key === 'Enter') join(); });
  $('#code').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#name').focus(); });
  $('#btnClue').addEventListener('click', submitClue);
  $('#tcClueIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitClue(); });
  $('#btnGuess').addEventListener('click', submitGuess);
  $('#tcGuessIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitGuess(); });
  $('#btnLeave').addEventListener('click', function () {
    leaving = true;
    clearInterval(helloTimer);
    if (bus) bus.send({ t: 'bye', from: me.id });
    setTimeout(function () { location.href = location.pathname; }, 250);
  });
  window.addEventListener('pagehide', function () {
    if (bus && S && S.phase === 'lobby') bus.send({ t: 'bye', from: me.id });
  });

  window.__me = me;
})();

(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var slot = MLT.qs('me');
  var SAVE = 'cw.me.v1' + (slot ? '.' + slot : '');
  var ACCENT = '#22e6ff';
  var LETTERS = ['A', 'B', 'C', 'D'];
  var WAGERS = [
    { n: 1, label: 'Cautious', sub: '×1' },
    { n: 2, label: 'Confident', sub: '×2' },
    { n: 3, label: 'Certain', sub: '×3' }
  ];

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '' };
  var bus = null;
  var S = null;
  var lastSeq = -1;
  var skew = 0;
  var myAnswer = null, myWager = null;
  var seenRound = -1;
  var helloTimer = null, clockTimer = null;
  var confettied = false;
  var soundedRound = -1;

  var urlCode = (MLT.qs('r') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  $('#code').value = urlCode || me.code || '';
  $('#name').value = me.name || '';

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
    S = null; lastSeq = -1; myAnswer = null; myWager = null; seenRound = -1; soundedRound = -1;
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
    if (m.t === 'closed') { roomClosed(); return; }
    if (m.t !== 'state') return;
    if (typeof m.seq === 'number' && m.seq <= lastSeq) return;
    lastSeq = m.seq;
    if (typeof m.now === 'number') skew = m.now - Date.now();
    S = m.s;
    if (!leaving && !S.players.some(function (p) { return p.id === me.id; })) sayHello();
    render();
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
    var sig = S.phase + '|' + S.round + '|' + S.players.length + '|' + S.total;
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
      btn('Start game', 'start', { primary: true, disabled: S.players.length < 2 });
    } else if (S.phase === 'ask') {
      btn('−5s', 'timer-');
      btn('+5s', 'timer+');
      btn('Skip', 'skip');
      btn('Reveal', 'reveal', { primary: true });
    } else if (S.phase === 'reveal') {
      btn(S.round + 1 >= S.total ? 'Final standings' : 'Next question', 'next', { primary: true });
    } else if (S.phase === 'final') {
      btn('Play again', 'again', { primary: true });
    }
  }

  function render() {
    if (!S) return;
    renderHostBar();
    if (S.phase === 'lobby') { renderWait(); show('wait'); }
    else if (S.phase === 'ask') { renderVote(); show('vote'); }
    else if (S.phase === 'reveal') { renderResult(); show('result'); }
    else if (S.phase === 'final') { renderDone(); show('done'); }
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
    $('#waitMsg').textContent = (S && S.players.length < 2)
      ? 'Waiting for more players…'
      : 'Waiting for the host to start…';
  }

  function renderVote() {
    if (seenRound !== S.round) { myAnswer = null; myWager = null; seenRound = S.round; }
    $('#vBanner').textContent = 'Q' + (S.round + 1) + '/' + S.total;
    $('#vText').textContent = S.q;

    var list = $('#ansList');
    var sig = S.round + '|' + (S.options || []).join('|');
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.innerHTML = '';
      (S.options || []).forEach(function (opt, idx) {
        list.appendChild(el('button', {
          class: 'ans-btn', 'aria-pressed': 'false', 'data-idx': String(idx),
          onclick: function () { myAnswer = idx; trySubmit(); renderVote(); }
        }, [
          el('span', { class: 'letter', text: LETTERS[idx] }),
          el('span', { text: opt })
        ]));
      });
    }
    MLT.$$('#ansList .ans-btn').forEach(function (b) {
      var idx = parseInt(b.getAttribute('data-idx'), 10);
      var picked = myAnswer === idx;
      b.setAttribute('aria-pressed', picked ? 'true' : 'false');
      b.classList.toggle('dimmed', myAnswer !== null && !picked);
    });

    var wrow = $('#wagerRow');
    if (!wrow.dataset.built) {
      wrow.dataset.built = '1';
      wrow.innerHTML = '';
      WAGERS.forEach(function (w) {
        wrow.appendChild(el('button', {
          class: 'wager-btn', 'aria-pressed': 'false', 'data-w': String(w.n),
          onclick: function () {
            if (myAnswer === null) { MLT.toast('Pick an answer first'); return; }
            myWager = w.n; trySubmit(); renderVote();
          }
        }, [
          el('span', { class: 'lbl', text: w.label }),
          el('span', { class: 'sub', text: w.sub })
        ]));
      });
    }
    MLT.$$('#wagerRow .wager-btn').forEach(function (b) {
      var n = parseInt(b.getAttribute('data-w'), 10);
      b.setAttribute('aria-pressed', myWager === n ? 'true' : 'false');
      b.disabled = myAnswer === null;
    });

    var voted = (S.voted || []).length;
    $('#vHint').textContent = (myAnswer !== null && myWager)
      ? 'Locked in: ' + LETTERS[myAnswer] + ') ' + S.options[myAnswer] + ' at ×' + myWager + ' · ' + voted + '/' + S.players.length + ' locked in — you can still change it.'
      : myAnswer !== null
        ? "Now say how confident you are."
        : 'Pick an answer, then say how confident you are. ' + voted + '/' + S.players.length + ' locked in.';

    runClock();
  }

  function trySubmit() {
    if (myAnswer === null || !myWager) return;
    A.sfx('pick');
    bus.send({ t: 'vote', from: me.id, round: S.round, pick: { a: myAnswer, w: myWager } }, 'vote');
  }

  function runClock() {
    clearInterval(clockTimer);
    var clock = $('#vClock');
    if (!S.endsAt) { clock.textContent = ''; clock.classList.remove('urgent'); $('#vFill').style.width = '100%'; return; }
    var endsAt = S.endsAt;
    var total = Math.max(1, (S.secs ? S.secs * 1000 : endsAt - (Date.now() + skew)));
    function tick() {
      var left = endsAt - (Date.now() + skew);
      if (left <= 0) {
        clearInterval(clockTimer);
        clock.textContent = '0';
        clock.classList.remove('urgent');
        $('#vFill').style.width = '0%';
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 5200);
      $('#vFill').style.width = Math.min(100, (left / total) * 100) + '%';
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function renderResult() {
    clearInterval(clockTimer);
    if (soundedRound !== S.round) { soundedRound = S.round; A.sfx('reveal'); }
    $('#rBanner').textContent = 'Q' + (S.round + 1) + '/' + S.total;
    $('#rqText').textContent = S.q;

    var votes = S.votes || {}, counts = S.counts || [];
    var cast = Object.keys(votes).length;
    var correctCount = 0;
    Object.keys(votes).forEach(function (v) { if (votes[v].a === S.correct) correctCount++; });
    $('#rWin').textContent = cast === 0
      ? 'Nobody locked in an answer — it was ' + LETTERS[S.correct] + ') ' + S.options[S.correct]
      : 'The answer was ' + LETTERS[S.correct] + ') ' + S.options[S.correct] + ' — ' + correctCount + ' of ' + cast + ' got it right';

    var mine = votes[me.id];
    var outcome = $('#myOutcome');
    if (mine) {
      var right = mine.a === S.correct;
      outcome.classList.remove('hidden');
      outcome.style.color = right ? '#3dff9e' : '#ff2d95';
      outcome.style.background = right ? 'rgba(61,255,158,0.1)' : 'rgba(255,45,149,0.1)';
      outcome.textContent = (right ? '+' + mine.w + ' — you called it' : '−' + mine.w + ' — that one stung');
    } else {
      outcome.classList.add('hidden');
    }

    var bars = $('#rOptBars');
    bars.innerHTML = '';
    var max = Math.max(1, counts.reduce(function (a, b) { return Math.max(a, b); }, 0));
    (S.options || []).forEach(function (opt, idx) {
      var isCorrect = idx === S.correct;
      var n = counts[idx] || 0;
      var voters = Object.keys(votes).filter(function (v) { return votes[v].a === idx; }).map(playerName);
      var col = isCorrect ? '#3dff9e' : MLT.colorFor(idx);
      var fill = el('i', { style: 'background:' + col + ';color:' + col });
      var trackWrap = el('div', { style: 'grid-column:1 / -1;margin-top:2px' }, [el('div', { class: 'track' }, [fill])]);
      if (S.showVoters && voters.length) trackWrap.appendChild(el('div', { class: 'voters', text: voters.join(', ') }));
      var otext = el('div', { class: 'otext', style: 'display:flex;align-items:center;gap:8px' }, [
        el('span', { text: opt }),
        isCorrect ? el('span', { class: 'tag', style: 'color:#3dff9e', text: '✓' }) : null
      ]);
      var numNode = el('div', { class: 'n', text: '0' });
      bars.appendChild(el('div', { class: 'cw-optbar' + (isCorrect ? ' correct' : '') }, [
        el('span', { class: 'letter', text: LETTERS[idx] }),
        otext, numNode, trackWrap
      ]));
      setTimeout(function () { MLT.countUp(numNode, n, 500); fill.style.width = (n / max) * 100 + '%'; }, 60);
    });

    $('#rWait').textContent = 'Q' + (S.round + 1) + ' / ' + S.total + ' · waiting for the host…';
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
        el('div', { class: 'sc', text: p.pts + (p.pts === 1 ? ' point' : ' points') })
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
        el('div', { class: 'pts', text: p.pts + (p.pts === 1 ? ' pt' : ' pts') })
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

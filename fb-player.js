(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var slot = MLT.qs('me');
  var SAVE = 'fb.me.v1' + (slot ? '.' + slot : '');
  var ACCENT = '#9d6bff';

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '' };
  var bus = null;
  var S = null;
  var lastSeq = -1;
  var skew = 0;
  var myFake = '';
  var fakeRound = -1;
  var myVote = null;
  var votedRound = -1;
  var helloTimer = null, clockTimer = null;
  var confettied = false;
  var soundedRound = -1;

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
    S = null; lastSeq = -1; myFake = ''; fakeRound = -1; myVote = null; votedRound = -1; soundedRound = -1;
    $('#status').classList.add('hidden');
    $('#hostBar').classList.add('hidden');
    $('#hostBtns').dataset.sig = '';
    document.body.classList.remove('has-host');
    A.sfx('bye');
    show('join');
    MLT.toast('The host opened a new room — ask for the new code');
  }

  var leaving = false;
  function onMessage(m) {
    if (MLT.handleAdvance(m, me.name)) return;
    if (m.t === 'closed') { roomClosed(); return; }
    if (m.t === 'tooclose' && m.to === me.id) {
      MLT.toast("That's too close to the real answer — try another fake");
      return;
    }
    if (m.t === 'selfvote' && m.to === me.id) {
      myVote = null;
      MLT.toast("That one's your own fake — pick a different one");
      if (S) renderVote();
      return;
    }
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
    var sig = S.phase + '|' + (S.round || 0) + '|' + S.players.length + '|' + S.total;
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
    } else if (S.phase === 'submit') {
      btn('−5s', 'timer-');
      btn('+5s', 'timer+');
      btn('Lock answers', 'lock', { primary: true });
      btn('Skip', 'skip');
    } else if (S.phase === 'vote') {
      btn('Reveal now', 'reveal', { primary: true });
    } else if (S.phase === 'reveal') {
      btn(S.round + 1 >= S.total ? 'Final standings' : 'Next round', 'next', { primary: true });
    } else if (S.phase === 'final') {
      btn('Play again', 'again', { primary: true });
    }
  }

  function render() {
    if (!S) return;
    renderHostBar();
    if (S.phase === 'lobby') { renderWait(); show('wait'); }
    else if (S.phase === 'submit') { renderSubmit(); show('submit'); }
    else if (S.phase === 'vote') { renderVote(); show('vote'); }
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
    $('#waitMsg').textContent = S.players.length < 3
      ? 'Waiting for more players… need at least 3.'
      : 'Waiting for the host to start…';
  }

  function renderSubmit() {
    if (fakeRound !== S.round) { myFake = ''; fakeRound = -1; }
    $('#subBanner').textContent = 'Round ' + (S.round + 1) + ' / ' + S.total;
    $('#subPromptText').textContent = S.prompt;
    var sent = fakeRound === S.round;
    $('#fakeInput').disabled = false;
    if (sent && document.activeElement !== $('#fakeInput')) $('#fakeInput').value = myFake;
    var count = (S.submitted || []).length;
    $('#subHint').textContent = sent
      ? 'Sent — you can still change it. ' + count + '/' + S.players.length + ' have answered.'
      : 'Write a believable fake answer. ' + count + '/' + S.players.length + ' have answered.';
    runClock();

    var box = $('#subPlayers');
    box.innerHTML = '';
    S.players.forEach(function (p, i) {
      var done = (S.submitted || []).indexOf(p.id) >= 0;
      box.appendChild(el('span', { class: 'chip' + (done ? ' voted' : '') }, [
        avatar(p.name, i), el('span', { text: p.name + (p.id === me.id ? ' (you)' : '') })
      ]));
    });
  }

  function sendFake() {
    var text = ($('#fakeInput').value || '').trim().slice(0, 60);
    if (text.length < 2) { MLT.toast('Write at least a couple of characters'); return; }
    myFake = text;
    fakeRound = S.round;
    A.sfx('pick');
    bus.send({ t: 'fake', from: me.id, round: S.round, text: text });
    renderSubmit();
    MLT.toast('Sent — you can still change it before the round locks');
  }

  function runClock() {
    clearInterval(clockTimer);
    var clock = $('#subClock');
    if (!S.endsAt) { clock.textContent = ''; clock.classList.remove('urgent'); $('#subFill').style.width = '100%'; return; }
    var endsAt = S.endsAt;
    var total = Math.max(1, (S.secs ? S.secs * 1000 : endsAt - (Date.now() + skew)));
    function tick() {
      var left = endsAt - (Date.now() + skew);
      if (left <= 0) {
        clearInterval(clockTimer);
        clock.textContent = '0';
        clock.classList.remove('urgent');
        $('#subFill').style.width = '0%';
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 5200);
      $('#subFill').style.width = Math.min(100, (left / total) * 100) + '%';
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function renderVote() {
    if (votedRound !== S.round) { myVote = null; votedRound = -1; }
    $('#vBanner').textContent = 'Round ' + (S.round + 1) + ' / ' + S.total;
    $('#vPromptText').textContent = S.prompt;

    var grid = $('#vGrid');
    var sig = S.round + '|' + S.choices.map(function (c) { return c.id; }).join(',');
    if (grid.dataset.sig !== sig) {
      grid.dataset.sig = sig;
      grid.innerHTML = '';
      S.choices.forEach(function (c) {
        grid.appendChild(el('button', {
          class: 'fb-choice', 'data-cid': c.id, 'aria-pressed': 'false',
          onclick: function () { castVote(c.id); }
        }, [el('span', { text: c.text })]));
      });
    }
    MLT.$$('#vGrid .fb-choice').forEach(function (b) {
      var picked = myVote === b.getAttribute('data-cid');
      b.setAttribute('aria-pressed', picked ? 'true' : 'false');
      b.classList.toggle('dimmed', !!myVote && !picked);
    });

    var voted = (S.voted || []).length;
    $('#vHint').textContent = myVote
      ? 'Locked in · ' + voted + '/' + S.players.length + ' voted — you can still change it.'
      : 'Which one is the real answer? ' + voted + '/' + S.players.length + ' voted.';

    runVoteClock();
  }

  function runVoteClock() {
    clearInterval(clockTimer);
    var clock = $('#vClock');
    if (!S.endsAt) { clock.textContent = ''; clock.classList.remove('urgent'); $('#vFill').style.width = '100%'; return; }
    var endsAt = S.endsAt;
    var span = Math.max(1, endsAt - (Date.now() + skew));
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
      $('#vFill').style.width = Math.min(100, (left / span) * 100) + '%';
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function castVote(id) {
    if (!S || S.phase !== 'vote') return;
    myVote = id;
    votedRound = S.round;
    A.sfx('pick');
    bus.send({ t: 'vote', from: me.id, round: S.round, pick: id }, 'vote');
    renderVote();
  }

  function renderResult() {
    clearInterval(clockTimer);
    if (soundedRound !== S.round) { soundedRound = S.round; A.sfx('reveal'); }
    var parts = S.prompt.split('___');
    var box = $('#rPrompt');
    box.innerHTML = '';
    box.appendChild(document.createTextNode(parts[0] || ''));
    box.appendChild(el('span', { class: 'fb-answer-fill', text: S.answer }));
    box.appendChild(document.createTextNode(parts[1] || ''));

    var cast = S.totalVoters || 0;
    var votes = S.votes || {};
    var list = $('#rChoices');
    list.innerHTML = '';
    (S.choices || []).forEach(function (c) {
      var voters = Object.keys(votes).filter(function (v) { return votes[v] === c.id; }).map(playerName);
      var n = voters.length;
      var pct = cast ? Math.round((n / cast) * 100) : 0;
      var mine = myVote === c.id;
      var fill = el('i', { style: 'width:0%;background:' + (c.real ? '#3dff9e' : '#ff2d95') });
      list.appendChild(el('div', { class: 'fb-reveal-row' + (c.real ? ' real' : '') }, [
        el('div', { class: 'fb-rr-tag', style: 'color:' + (c.real ? '#3dff9e' : '#ff2d95'), text: (c.real ? 'THE TRUTH' : 'FAKE · by ' + playerName(c.author)) + (mine ? ' · your pick' : '') }),
        el('div', { class: 'fb-rr-text', text: c.text }),
        el('div', {}, [el('div', { class: 'track' }, [fill])]),
        el('div', { class: 'tiny', text: n + (n === 1 ? ' vote' : ' votes') })
      ]));
      setTimeout(function () { fill.style.width = pct + '%'; }, 60);
    });

    $('#rSummary').textContent = cast === 0
      ? 'Nobody voted this round.'
      : (S.correctCount || 0) + ' of ' + cast + ' found the truth';
    $('#rWait').textContent = 'Round ' + (S.round + 1) + ' / ' + S.total + ' · waiting for the host…';
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
        el('div', { class: 'name' }, [
          avatar(p.name, playerIndex(p.id)),
          el('span', { text: p.name + (p.id === me.id ? ' (you)' : '') })
        ]),
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
  $('#btnSendFake').addEventListener('click', sendFake);
  $('#fakeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendFake(); });
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

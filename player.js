(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  /* ?me=<slot> keeps separate identities in one browser (handy for testing) */
  var slot = MLT.qs('me');
  var SAVE = 'mlt.me.v1' + (slot ? '.' + slot : '');

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '' };
  var bus = null;
  var S = null;              /* last state from the presenter */
  var lastSeq = -1;
  var skew = 0;              /* presenter clock - my clock */
  var myVote = null;
  var votedRound = -1;
  var myQs = [];             /* questions I added this lobby */
  var helloTimer = null, clockTimer = null;
  var confettied = false;
  var soundedRound = -1;

  var urlCode = (MLT.qs('r') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  $('#code').value = urlCode || me.code || '';
  $('#name').value = me.name || '';
  if (!me.name && MLT.qs('nm')) $('#name').value = MLT.qs('nm');
  if (MLT.qs('auto') === '1' && urlCode && $('#name').value) setTimeout(join, 30);

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

  function addQuestion() {
    var text = ($('#myQ').value || '').trim().replace(/^most likely to\s*/i, '').slice(0, 90);
    if (text.length < 3) { MLT.toast('Give it a few more words'); return; }
    if (myQs.length >= 8) { MLT.toast('8 is plenty — let someone else have a go'); return; }
    myQs.push(text);
    bus.send({ t: 'q', from: me.id, text: text });
    $('#myQ').value = '';
    renderMyQs();
    MLT.toast('Added to the pile');
  }

  function renderMyQs() {
    var list = $('#myQList');
    list.innerHTML = '';
    myQs.forEach(function (t) {
      list.appendChild(el('div', { class: 'qitem' }, [el('span', { text: 'Most likely to ' + t })]));
    });
    $('#addHint').textContent = (S && S.roomQ ? S.roomQ + ' question' + (S.roomQ === 1 ? '' : 's') + ' from the room so far. ' : '') +
      (myQs.length ? "You've added " + myQs.length + '.' : '');
  }

  /* ------------------------------------------------------------------ */
  function roomClosed() {
    clearInterval(helloTimer);
    clearInterval(clockTimer);
    if (bus) { bus.close(); bus = null; }
    S = null; lastSeq = -1; myQs = []; myVote = null; votedRound = -1; soundedRound = -1;
    A.sfx('bye');
    $('#status').classList.add('hidden');
    $('#myQList').innerHTML = '';
    $('#hostBar').classList.add('hidden');
    $('#hostBtns').dataset.sig = '';
    document.body.classList.remove('has-host');
    setAccent('#22e6ff');
    show('join');
    MLT.toast('The host opened a new room — ask for the new code');
  }

  var leaving = false;
  function onMessage(m) {
    if (MLT.handleAdvance(m, me.name)) return;
    if (m.t === 'closed') { roomClosed(); return; }
    if (m.t !== 'state') return;
    if (typeof m.seq === 'number' && m.seq <= lastSeq) return;
    lastSeq = m.seq;
    if (typeof m.now === 'number') skew = m.now - Date.now();
    S = m.s;
    /* Not in the roster? Normally that means we dropped and should say
       hello again — but not if we just chose to leave: our own socket is
       still open for the moment it takes to navigate away, so we'd
       otherwise see the presenter's own "you're gone" broadcast and
       immediately rejoin ourselves. */
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
  function setAccent(c) {
    document.documentElement.style.setProperty('--accent', c || '#22e6ff');
  }

  /* ------------------------------------------------------------------ */
  /* ---- host remote: this phone was linked from the presenter screen ---- */
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
    setAccent('#22e6ff');
    confettied = false;
    var box = $('#waitPlayers');
    box.innerHTML = '';
    S.players.forEach(function (p, i) {
      box.appendChild(el('span', { class: 'chip' }, [
        avatar(p.name, i), el('span', { text: p.name + (p.id === me.id ? ' (you)' : '') })
      ]));
    });
    $('#waitMsg').textContent = S.players.length < 2
      ? 'Waiting for more players…'
      : 'Waiting for the host to start…';
    $('#addBox').classList.toggle('hidden', !S.canAdd);
    renderMyQs();
  }

  function renderVote() {
    if (votedRound !== S.round) { myVote = null; votedRound = -1; }
    setAccent(S.pa);
    $('#vBanner').textContent = (S.pe || '') + '  ' + (S.pn || '') + '  ·  Q' + (S.round + 1) + '/' + S.total;
    $('#vText').textContent = S.q;

    var grid = $('#vGrid');
    var sig = S.round + '|' + S.players.map(function (p) { return p.id + ':' + p.name; }).join(',');
    if (grid.dataset.sig !== sig) {
      grid.dataset.sig = sig;
      grid.innerHTML = '';
      S.players.forEach(function (p, i) {
        grid.appendChild(el('button', {
          class: 'vote', 'data-pid': p.id, 'aria-pressed': 'false',
          style: '--pcol:' + MLT.colorFor(i),
          onclick: function () { castVote(p.id); }
        }, [avatar(p.name, i), el('span', { text: p.name })]));
      });
    }
    MLT.$$('#vGrid .vote').forEach(function (b) {
      var picked = myVote === b.getAttribute('data-pid');
      b.setAttribute('aria-pressed', picked ? 'true' : 'false');
      b.classList.toggle('dimmed', !!myVote && !picked);
    });

    var voted = (S.voted || []).length;
    $('#vHint').textContent = myVote
      ? 'Locked in: ' + playerName(myVote) + ' · ' + voted + '/' + S.players.length + ' voted — you can still change it.'
      : 'Tap whoever it obviously is. ' + voted + '/' + S.players.length + ' voted.';

    runClock();
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

  function castVote(targetId) {
    if (!S || S.phase !== 'ask') return;
    myVote = targetId;
    votedRound = S.round;
    A.sfx('pick');
    bus.send({ t: 'vote', from: me.id, round: S.round, pick: targetId }, 'vote');
    renderVote();
  }

  function renderResult() {
    clearInterval(clockTimer);
    setAccent(S.pa);
    if (soundedRound !== S.round) { soundedRound = S.round; A.sfx('reveal'); }
    $('#rBanner').textContent = (S.pe || '') + '  ' + (S.pn || '');
    $('#rqText').textContent = S.q;

    var t = S.tally || [], votes = S.votes || {};
    var cast = Object.keys(votes).length;
    var top = t.filter(function (r) { return r.n > 0 && r.n === t[0].n; });
    $('#rWin').textContent = cast === 0
      ? 'Nobody voted 😴'
      : top.map(function (r) { return playerName(r.id); }).join(' & ') + (top.length > 1 ? ' tie it' : ' takes it');

    var bars = $('#rBars');
    bars.innerHTML = '';
    var max = Math.max(1, t[0] ? t[0].n : 1);
    t.forEach(function (row) {
      var idx = playerIndex(row.id);
      if (idx < 0) return;
      var col = MLT.colorFor(idx);
      var voters = Object.keys(votes)
        .filter(function (v) { return votes[v] === row.id; })
        .map(playerName);
      var fill = el('i', { style: 'background:' + col + ';color:' + col });
      var cell = el('div', {}, [el('div', { class: 'track' }, [fill])]);
      if (S.showVoters && voters.length) cell.appendChild(el('div', { class: 'voters', text: voters.join(', ') }));
      var num = el('div', { class: 'n', text: '0' });
      bars.appendChild(el('div', { class: 'bar' }, [
        el('div', { class: 'who' }, [avatar(S.players[idx].name, idx), el('span', { text: S.players[idx].name })]),
        cell, num
      ]));
      setTimeout(function () {
        fill.style.width = (row.n / max) * 100 + '%';
        MLT.countUp(num, row.n, 700);
      }, 60);
    });
    $('#rWait').textContent = 'Q' + (S.round + 1) + ' / ' + S.total + ' · waiting for the host…';
  }

  function renderDone() {
    clearInterval(clockTimer);
    setAccent('#ffd23f');
    var sorted = S.players.slice().sort(function (a, b) { return b.pts - a.pts; });

    var node = $('#podium');
    node.innerHTML = '';
    var heights = [150, 110, 84];
    [1, 0, 2].forEach(function (rank) {
      var p = sorted[rank];
      var slot = el('div', { class: 'plinth' });
      if (!p) { node.appendChild(slot); return; }
      var idx = playerIndex(p.id);
      var col = MLT.colorFor(idx);
      slot.appendChild(el('div', { class: 'head' }, [
        avatar(p.name, idx),
        el('div', { class: 'nm', text: p.name + (p.id === me.id ? ' (you)' : '') }),
        el('div', { class: 'sc', text: p.pts + (p.pts === 1 ? ' pick' : ' picks') })
      ]));
      var bar = el('div', { class: 'col', style: 'color:' + col }, [el('div', { class: 'rk', text: String(rank + 1) })]);
      slot.appendChild(bar);
      node.appendChild(slot);
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
        el('div', { class: 'pts', text: p.pts + (p.pts === 1 ? ' pick' : ' picks') })
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
    (S.moments || []).forEach(function (mo) {
      var idx = playerIndex(mo.p);
      box.appendChild(el('div', { class: 'award', style: '--ac:' + MLT.colorFor(idx) }, [
        el('div', { class: 't', text: 'Defining moment' }),
        el('div', { class: 'w' }, [avatar(playerName(mo.p), idx), el('span', { text: playerName(mo.p) })]),
        el('div', { class: 'd', text: 'Most likely to ' + mo.q + ' — ' + mo.n + (mo.n === 1 ? ' vote' : ' votes') })
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
  $('#btnAddQ').addEventListener('click', addQuestion);
  $('#myQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') addQuestion(); });
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

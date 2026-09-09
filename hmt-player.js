(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var slot = MLT.qs('me');
  var SAVE = 'hmt.me.v1' + (slot ? '.' + slot : '');
  var ACCENT = '#ff8a3d';

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '' };
  var bus = null;
  var S = null;
  var lastSeq = -1;
  var skew = 0;
  var myVote = null;
  var votedRound = -1;
  var myFacts = [];
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

  function addFact() {
    var text = ($('#myFact').value || '').trim().slice(0, 140);
    if (text.length < 3) { MLT.toast('Give it a few more words'); return; }
    if (myFacts.length >= 6) { MLT.toast('6 is plenty — save the rest for next time'); return; }
    myFacts.push(text);
    bus.send({ t: 'fact', from: me.id, text: text });
    $('#myFact').value = '';
    renderMyFacts();
    A.sfx('pick');
    MLT.toast('Added to the pile');
  }

  function renderMyFacts() {
    var list = $('#myFactList');
    list.innerHTML = '';
    myFacts.forEach(function (t) {
      list.appendChild(el('div', { class: 'qitem' }, [el('span', { text: t })]));
    });
    var target = S && S.factTarget ? S.factTarget : 3;
    $('#factHint').textContent = 'Aim for about ' + target + '. ' +
      (myFacts.length ? "You've added " + myFacts.length + '.' : 'True stuff only — birthdays, first jobs, pets, embarrassing moments, all fair game.');
  }

  /* ------------------------------------------------------------------ */
  function roomClosed() {
    clearInterval(helloTimer);
    clearInterval(clockTimer);
    if (bus) { bus.close(); bus = null; }
    S = null; lastSeq = -1; myVote = null; votedRound = -1; soundedRound = -1;
    A.sfx('bye');
    $('#status').classList.add('hidden');
    $('#myFactList').innerHTML = '';
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
      btn('Start game', 'start', { primary: true, disabled: S.players.length < 3 });
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
    $('#waitMsg').textContent = (S && S.players.length < 3)
      ? 'Waiting for more players…'
      : 'Waiting for the host to start…';
    renderMyFacts();
  }

  function renderVote() {
    if (votedRound !== S.round) { myVote = null; votedRound = -1; }
    var isAuthor = S.authorId === me.id;
    $('#vBanner').textContent = 'Q' + (S.round + 1) + '/' + S.total;

    $('#voteBody').classList.toggle('hidden', isAuthor);
    $('#authorBody').classList.toggle('hidden', !isAuthor);
    if (isAuthor) { runClock(); return; }

    $('#vText').textContent = S.t;

    var grid = $('#vGrid');
    var eligible = S.players.filter(function (p) { return p.id !== S.authorId; });
    var sig = S.round + '|' + eligible.map(function (p) { return p.id + ':' + p.name; }).join(',');
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
      ? 'Locked in: ' + playerName(myVote) + ' · ' + voted + '/' + eligible.length + ' voted — you can still change it.'
      : 'Whose fact is this? ' + voted + '/' + eligible.length + ' voted.';

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
    if (!S || S.phase !== 'ask' || S.authorId === me.id) return;
    myVote = targetId;
    votedRound = S.round;
    A.sfx('pick');
    bus.send({ t: 'vote', from: me.id, round: S.round, pick: targetId }, 'vote');
    renderVote();
  }

  function renderResult() {
    clearInterval(clockTimer);
    if (soundedRound !== S.round) { soundedRound = S.round; A.sfx('reveal'); }
    $('#rBanner').textContent = 'Q' + (S.round + 1) + '/' + S.total;
    $('#rqText').textContent = S.t;

    var t = S.tally || [], votes = S.votes || {};
    var cast = Object.keys(votes).length;
    var correctCount = 0;
    Object.keys(votes).forEach(function (v) { if (votes[v] === S.authorId) correctCount++; });
    $('#rWin').textContent = cast === 0
      ? "Nobody voted — it's actually " + playerName(S.authorId) + (S.authorId === me.id ? ' (you!)' : '')
      : "It's actually " + playerName(S.authorId) + (S.authorId === me.id ? ' (you!)' : '') + ' — ' + correctCount + '/' + cast + ' got it';

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
      var isAuthor = row.id === S.authorId;
      var fill = el('i', { style: 'background:' + col + ';color:' + col });
      var cell = el('div', {}, [el('div', { class: 'track' }, [fill])]);
      if (S.showVoters && voters.length) cell.appendChild(el('div', { class: 'voters', text: voters.join(', ') }));
      var num = el('div', { class: 'n', text: '0' });
      /* No inline "✓ them" badge here (unlike the presenter's wide screen) —
         the narrow mobile "who" column doesn't have room for a name plus a
         badge without truncating the name. The outline below plus the
         headline text above already make the right answer clear. */
      var whoKids = [avatar(S.players[idx].name, idx), el('span', { text: S.players[idx].name })];
      bars.appendChild(el('div', { class: 'bar', style: isAuthor ? 'outline:1px solid #3dff9e;border-radius:6px' : '' }, [
        el('div', { class: 'who' }, whoKids),
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
  $('#btnAddFact').addEventListener('click', addFact);
  $('#myFact').addEventListener('keydown', function (e) { if (e.key === 'Enter') addFact(); });
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

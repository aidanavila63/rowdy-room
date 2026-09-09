(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var slot = MLT.qs('me');
  var SAVE = 'ttr.me.v1' + (slot ? '.' + slot : '');
  var ACCENT = '#ff2d95';

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '', truth: '', lie: '' };
  var bus = null;
  var S = null;
  var lastSeq = -1;
  var skew = 0;
  var myVote = null;
  var votedRound = -1;
  var helloTimer = null, clockTimer = null;
  var confettied = false;
  var soundedRound = -1;
  var sentSubs = false;

  var urlCode = (MLT.qs('r') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  $('#code').value = urlCode || me.code || '';
  $('#name').value = me.name || '';
  $('#myTruth').value = me.truth || '';
  $('#myLie').value = me.lie || '';

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
    bus.onStatus(function (s) { if (s === 'online') { sayHello(); maybeSendSubs(); } });

    show('wait');
    $('#waitHi').textContent = "You're in, " + name + '!';
    sayHello();
    clearInterval(helloTimer);
    helloTimer = setInterval(function () { if (!S) sayHello(); }, 5000);
  }

  function sayHello() {
    if (bus) bus.send({ t: 'hello', from: me.id, name: me.name });
  }

  function maybeSendSubs() {
    if (me.truth && me.lie && bus) {
      bus.send({ t: 'facts', from: me.id, truth: me.truth, lie: me.lie });
      sentSubs = true;
    }
  }

  function saveSubs() {
    var t = ($('#myTruth').value || '').trim().slice(0, 100);
    var l = ($('#myLie').value || '').trim().slice(0, 100);
    if (t.length < 3 || l.length < 3) {
      MLT.toast('Write at least a few words for each one');
      return;
    }
    me.truth = t; me.lie = l;
    MLT.store(SAVE, me);
    sentSubs = false;
    maybeSendSubs();
    A.sfx('pick');
    renderWait();
    MLT.toast(sentSubs ? 'Saved — you can still change it before the game starts' : 'Saved locally, will send once connected');
  }

  /* ------------------------------------------------------------------ */
  function roomClosed() {
    clearInterval(helloTimer);
    clearInterval(clockTimer);
    if (bus) { bus.close(); bus = null; }
    S = null; lastSeq = -1; myVote = null; votedRound = -1; soundedRound = -1;
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
    if (S.phase === 'lobby' && !sentSubs) maybeSendSubs();
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
      btn('Start game', 'start', { primary: true, disabled: S.players.length < 3 || (S.subs || []).length < 2 });
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
      var ready = S && (S.subs || []).indexOf(p.id) >= 0;
      box.appendChild(el('span', { class: 'chip' }, [
        avatar(p.name, i),
        el('span', { text: p.name + (p.id === me.id ? ' (you)' : '') }),
        ready ? el('span', { class: 'tag', style: 'color:#3dff9e', text: '✓' }) : null
      ].filter(Boolean)));
    });
    var mine = me.truth && me.lie;
    $('#subForm').classList.toggle('hidden', false);
    $('#subStatus').textContent = mine
      ? "Saved — you can still edit and re-save before the host starts."
      : "Write one true thing and one believable lie about yourself.";
    $('#waitMsg').textContent = !mine
      ? 'Fill in your two statements below to join the round.'
      : (S && S.players.length < 3)
        ? 'Waiting for more players…'
        : 'Waiting for the host to start…';
  }

  function renderVote() {
    if (votedRound !== S.round) { myVote = null; votedRound = -1; }
    var isAuthor = S.authorId === me.id;
    $('#vBanner').textContent = "It's " + (isAuthor ? 'your' : playerName(S.authorId) + "'s") + ' turn  ·  Q' + (S.round + 1) + '/' + S.total;

    $('#voteBody').classList.toggle('hidden', isAuthor);
    $('#authorBody').classList.toggle('hidden', !isAuthor);
    if (isAuthor) { runClock(); return; }

    $('#optAText').textContent = S.a;
    $('#optBText').textContent = S.b;
    $('#optA').setAttribute('aria-pressed', myVote === 'a' ? 'true' : 'false');
    $('#optB').setAttribute('aria-pressed', myVote === 'b' ? 'true' : 'false');
    $('#optA').classList.toggle('dimmed', !!myVote && myVote !== 'a');
    $('#optB').classList.toggle('dimmed', !!myVote && myVote !== 'b');

    var voted = (S.voted || []).length;
    var eligible = S.players.length - 1;
    $('#vHint').textContent = myVote
      ? 'Locked in · ' + voted + '/' + eligible + ' voted — you can still change it.'
      : 'Which one\'s the lie? ' + voted + '/' + eligible + ' voted.';

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

  function castVote(side) {
    if (!S || S.phase !== 'ask' || S.authorId === me.id) return;
    myVote = side;
    votedRound = S.round;
    A.sfx('pick');
    bus.send({ t: 'vote', from: me.id, round: S.round, pick: side }, 'vote');
    renderVote();
  }

  function renderResult() {
    clearInterval(clockTimer);
    if (soundedRound !== S.round) { soundedRound = S.round; A.sfx('reveal'); }
    $('#rBanner').textContent = playerName(S.authorId) + (S.authorId === me.id ? ' (you)' : '') + "'s statements";

    var votes = S.votes || {};
    var votesA = S.votesA || 0, votesB = S.votesB || 0;
    var cast = votesA + votesB;
    var lieSlot = S.lie;
    var votersFor = function (side) {
      return Object.keys(votes).filter(function (v) { return votes[v] === side; }).map(playerName);
    };
    renderOptionBar($('#rOptA'), S.a, votesA, cast, votersFor('a'), lieSlot === 'a');
    renderOptionBar($('#rOptB'), S.b, votesB, cast, votersFor('b'), lieSlot === 'b');

    var correctCount = lieSlot === 'a' ? votesA : votesB;
    var wrongCount = cast - correctCount;
    $('#rEscalates').textContent = cast === 0
      ? 'Nobody voted this round.'
      : correctCount + ' of ' + cast + ' caught the lie · fooled ' + wrongCount;
    $('#rWait').textContent = 'Q' + (S.round + 1) + ' / ' + S.total + ' · waiting for the host…';
  }

  function renderOptionBar(node, text, n, cast, voters, isLie) {
    node.innerHTML = '';
    var pct = cast ? Math.round((n / cast) * 100) : 0;
    node.appendChild(el('div', { class: 'ttr-tag', style: 'color:' + (isLie ? '#ff2d95' : '#3dff9e'), text: isLie ? 'THE LIE' : 'TRUE' }));
    node.appendChild(el('div', { class: 'ttr-opt-label', text: text }));
    var fill = el('i', { style: 'width:0%;background:' + (isLie ? '#ff2d95' : '#3dff9e') });
    node.appendChild(el('div', {}, [el('div', { class: 'track' }, [fill])]));
    node.appendChild(el('div', { class: 'tiny', text: n + (n === 1 ? ' vote' : ' votes') }));
    if (S.showVoters && voters.length) node.appendChild(el('div', { class: 'voters', text: voters.join(', ') }));
    setTimeout(function () { fill.style.width = pct + '%'; }, 60);
  }

  function renderDone() {
    clearInterval(clockTimer);
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
        el('div', { class: 'sc', text: p.pts + (p.pts === 1 ? ' point' : ' points') })
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
  $('#btnSaveSubs').addEventListener('click', saveSubs);
  $('#optA').addEventListener('click', function () { castVote('a'); });
  $('#optB').addEventListener('click', function () { castVote('b'); });
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

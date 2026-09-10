(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var slot = MLT.qs('me');
  var SAVE = 'wyr.me.v1' + (slot ? '.' + slot : '');

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '' };
  var bus = null;
  var S = null;
  var lastSeq = -1;
  var skew = 0;
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
    S = null; lastSeq = -1; myVote = null; votedRound = -1; soundedRound = -1;
    A.sfx('bye');
    $('#status').classList.add('hidden');
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
  }

  function renderVote() {
    if (votedRound !== S.round) { myVote = null; votedRound = -1; }
    setAccent(S.ca);
    $('#vBanner').textContent = (S.ce || '') + '  ' + (S.cn || '') + '  ·  Q' + (S.round + 1) + '/' + S.total;

    $('#optAText').textContent = S.a;
    $('#optBText').textContent = S.b;
    $('#optA').setAttribute('aria-pressed', myVote === 'a' ? 'true' : 'false');
    $('#optB').setAttribute('aria-pressed', myVote === 'b' ? 'true' : 'false');
    $('#optA').classList.toggle('dimmed', !!myVote && myVote !== 'a');
    $('#optB').classList.toggle('dimmed', !!myVote && myVote !== 'b');

    var voted = (S.voted || []).length;
    $('#vHint').textContent = myVote
      ? 'Locked in · ' + voted + '/' + S.players.length + ' voted — you can still change it.'
      : 'Tap the one you\'d rather. ' + voted + '/' + S.players.length + ' voted.';

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
    if (!S || S.phase !== 'ask') return;
    myVote = side;
    votedRound = S.round;
    A.sfx('pick');
    bus.send({ t: 'vote', from: me.id, round: S.round, pick: side }, 'vote');
    renderVote();
  }

  function renderResult() {
    clearInterval(clockTimer);
    setAccent(S.ca);
    if (soundedRound !== S.round) { soundedRound = S.round; A.sfx('reveal'); }
    $('#rBanner').textContent = (S.ce || '') + '  ' + (S.cn || '');

    var votes = S.votes || {};
    var votesA = S.votesA || 0, votesB = S.votesB || 0;
    var cast = votesA + votesB;
    var majority = S.majority || (votesA >= votesB ? 'a' : 'b');
    var votersFor = function (side) {
      return Object.keys(votes).filter(function (v) { return votes[v] === side; }).map(playerName);
    };
    renderOptionBar($('#rOptA'), S.a, votesA, cast, votersFor('a'), majority === 'a');
    renderOptionBar($('#rOptB'), S.b, votesB, cast, votersFor('b'), majority === 'b');

    var minority = majority === 'a' ? 'b' : 'a';
    $('#rEscalates').textContent = cast === 0 ? 'Nobody voted' : 'Escalates next: ' + S[minority];
    $('#rWait').textContent = 'Q' + (S.round + 1) + ' / ' + S.total + ' · waiting for the host…';
  }

  function renderOptionBar(node, text, n, cast, voters, isMajority) {
    node.innerHTML = '';
    var pct = cast ? Math.round((n / cast) * 100) : 0;
    node.appendChild(el('div', { class: 'wyr-opt-label', text: text }));
    var fill = el('i', { style: 'width:0%;background:var(--accent);color:var(--accent)' });
    node.appendChild(el('div', {}, [el('div', { class: 'track' }, [fill])]));
    node.appendChild(el('div', { class: 'tiny', text: n + (n === 1 ? ' vote' : ' votes') + (isMajority && cast ? ' · room favorite' : '') }));
    if (S.showVoters && voters.length) node.appendChild(el('div', { class: 'voters', text: voters.join(', ') }));
    setTimeout(function () { fill.style.width = pct + '%'; }, 60);
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
        el('div', { class: 'sc', text: p.pts + (p.pts === 1 ? ' call' : ' calls') })
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
        el('div', { class: 'pts', text: p.pts + (p.pts === 1 ? ' call' : ' calls') })
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

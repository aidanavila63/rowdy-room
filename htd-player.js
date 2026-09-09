(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var slot = MLT.qs('me');
  var SAVE = 'htd.me.v1' + (slot ? '.' + slot : '');

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '' };
  var bus = null;
  var S = null;
  var lastSeq = -1;
  var skew = 0;
  var myValue = 50;
  var sentLeg = null, sentRound = -1;
  var sendTimer = null;
  var helloTimer = null, clockTimer = null;
  var confettied = false;
  var soundedRound = -1;

  var urlCode = (MLT.qs('r') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  $('#code').value = urlCode || me.code || '';
  $('#name').value = me.name || '';

  var LABELS = [
    [15, 'Strongly disagree'], [35, 'Disagree'], [65, 'Not sure'],
    [85, 'Agree'], [101, 'Strongly agree']
  ];
  function labelFor(v) {
    for (var i = 0; i < LABELS.length; i++) if (v < LABELS[i][0]) return LABELS[i][1];
    return LABELS[LABELS.length - 1][1];
  }

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
    S = null; lastSeq = -1; sentLeg = null; sentRound = -1; soundedRound = -1;
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
      btn('Start game', 'start', { primary: true, disabled: S.players.length < 3 });
    } else if (S.phase === 'ask1') {
      btn('Reveal spread', 'reveal', { primary: true });
    } else if (S.phase === 'debate') {
      btn('Skip to re-vote', 'skipDebate', { primary: true });
    } else if (S.phase === 'ask2') {
      btn('Reveal result', 'reveal', { primary: true });
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
    else if (S.phase === 'ask1' || S.phase === 'ask2') { renderVote(); show('vote'); }
    else if (S.phase === 'debate') { renderDebate(); show('debate'); }
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
  }

  function renderVote() {
    var leg = S.leg;
    if (sentRound !== S.round || sentLeg !== leg) {
      myValue = 50; sentRound = -1; sentLeg = null;
      $('#stanceSlider').value = 50;
    }
    $('#vBanner').textContent = 'Q' + (S.round + 1) + '/' + S.total;
    $('#vLegLabel').textContent = leg === 1 ? 'First vote' : 'Re-vote — after hearing them argue it out';
    $('#vStatement').textContent = S.t;
    $('#stanceLabel').textContent = labelFor(myValue);

    var voted = (S.voted || []).length;
    $('#vHint').textContent = (sentLeg === leg && sentRound === S.round)
      ? 'Locked in · ' + voted + '/' + S.players.length + ' voted — drag again to change it.'
      : 'Drag the slider, then it sends automatically. ' + voted + '/' + S.players.length + ' voted.';
  }

  function sendStance(v) {
    if (!bus || !S) return;
    bus.send({ t: 'stance', from: me.id, round: S.round, value: v }, 'stance');
    sentLeg = S.leg; sentRound = S.round;
    renderVote();
  }

  function renderDebate() {
    clearInterval(clockTimer);
    $('#dBanner').textContent = 'Q' + (S.round + 1) + '/' + S.total;
    $('#dStatement').textContent = S.t;
    var isA = S.debaterA === me.id, isB = S.debaterB === me.id;
    $('#debateSelf').classList.toggle('hidden', !(isA || isB));
    $('#debateWatch').classList.toggle('hidden', isA || isB);
    if (S.debaterA && S.debaterB) {
      $('#dVs').textContent = playerName(S.debaterA) + ' vs ' + playerName(S.debaterB);
    } else {
      $('#dVs').textContent = 'Skipping straight to the re-vote this round.';
    }
    runDebateClock();
  }

  function runDebateClock() {
    clearInterval(clockTimer);
    var clock = $('#dClock');
    if (!S.endsAt) { clock.textContent = ''; return; }
    var endsAt = S.endsAt;
    function tick() {
      var left = endsAt - (Date.now() + skew);
      if (left <= 0) { clearInterval(clockTimer); clock.textContent = '0'; return; }
      clock.textContent = Math.ceil(left / 1000);
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function renderResult() {
    clearInterval(clockTimer);
    if (soundedRound !== S.round) { soundedRound = S.round; A.sfx('reveal'); }
    $('#rBanner').textContent = 'Q' + (S.round + 1) + '/' + S.total;
    $('#rStatement').textContent = S.t;
    $('#rDebaters').textContent = S.debaterA && S.debaterB
      ? playerName(S.debaterA) + ' vs ' + playerName(S.debaterB)
      : '';

    var before = S.avgBefore, after = S.avgAfter;
    $('#rBeforeMark').style.left = (before === null || before === undefined ? 50 : before) + '%';
    $('#rAfterMark').style.left = (after === null || after === undefined ? 50 : after) + '%';
    $('#rBeforeMark').classList.toggle('hidden', before === null || before === undefined);
    $('#rAfterMark').classList.toggle('hidden', after === null || after === undefined);

    $('#rWinner').textContent = S.winner
      ? playerName(S.winner) + ' won the room over'
      : 'The room didn’t budge';
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
  $('#stanceSlider').addEventListener('input', function () {
    myValue = parseInt(this.value, 10);
    $('#stanceLabel').textContent = labelFor(myValue);
    clearTimeout(sendTimer);
    sendTimer = setTimeout(function () { sendStance(myValue); }, 280);
  });
  $('#stanceSlider').addEventListener('change', function () {
    myValue = parseInt(this.value, 10);
    clearTimeout(sendTimer);
    sendStance(myValue);
  });
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

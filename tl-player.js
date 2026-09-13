(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var slot = MLT.qs('me');
  var SAVE = 'tl.me.v1' + (slot ? '.' + slot : '');
  var ACCENT = '#ff2d95';
  var TIERS = MLT.TL_TIERS;
  var TIER_COLOR = { S: '#ff2d95', A: '#ffd23f', B: '#22e6ff', C: '#9d6bff' };

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '' };
  var bus = null;
  var S = null;
  var lastSeq = -1;
  var skew = 0;
  var clockTimer = null;
  var confettied = false;

  var myAssign = {};       // rank phase: itemId -> tier (local, private)
  var assignRound = -1;
  var selectedItem = null; // rank phase: item currently picked for tier assignment

  var heldItem = null;     // build phase: item id I currently hold the claim on
  var pendingClaim = null; // build phase: item id I just tried to claim, awaiting confirm/reject
  var heldRound = -1;

  var myArgueVote = null;
  var argueRound = -1;
  var myQs = [];

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

  var helloTimer = null;
  function sayHello() {
    if (bus) bus.send({ t: 'hello', from: me.id, name: me.name, emoji: MLT.avatarPref().emoji, color: MLT.avatarPref().color });
  }

  function addItem() {
    var text = ($('#myQ').value || '').trim().slice(0, 60);
    if (text.length < 2) { MLT.toast('Give it a couple more letters'); return; }
    if (myQs.length >= 8) { MLT.toast('8 is plenty — let someone else have a go'); return; }
    myQs.push(text);
    bus.send({ t: 'item', from: me.id, text: text });
    $('#myQ').value = '';
    renderMyQs();
    MLT.toast('Added to the pile');
  }

  function renderMyQs() {
    var list = $('#myQList');
    if (!list) return;
    list.innerHTML = '';
    myQs.forEach(function (t) {
      list.appendChild(el('div', { class: 'qitem' }, [el('span', { text: t })]));
    });
    var hint = $('#addHint');
    if (hint) {
      hint.textContent = (S && S.roomQ ? S.roomQ + ' item' + (S.roomQ === 1 ? '' : 's') + ' from the room so far. ' : '') +
        (myQs.length ? "You've added " + myQs.length + '.' : '');
    }
  }

  /* ------------------------------------------------------------------ */
  function roomClosed() {
    clearInterval(helloTimer);
    clearInterval(clockTimer);
    if (bus) { bus.close(); bus = null; }
    S = null; lastSeq = -1; myQs = [];
    if ($('#myQList')) $('#myQList').innerHTML = '';
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
    if (MLT.handleLobbyPoll(m, function (v) { if (bus) bus.send(v); })) return;
    if (m.t === 'closed') { roomClosed(); return; }
    if (m.t === 'claimrejected' && m.to === me.id) {
      if (pendingClaim === m.itemId) pendingClaim = null;
      MLT.toast('Someone else grabbed that first');
      if (S) renderBuild();
      return;
    }
    if (m.t === 'placerejected' && m.to === me.id) {
      heldItem = null;
      MLT.toast("That one slipped away — try again");
      if (S) renderBuild();
      return;
    }
    if (m.t !== 'state') return;
    if (typeof m.seq === 'number' && m.seq <= lastSeq) return;
    lastSeq = m.seq;
    if (typeof m.now === 'number') skew = m.now - Date.now();
    S = m.s;
    if (!leaving && !S.players.some(function (p) { return p.id === me.id; })) sayHello();
    if (S.phase === 'build' && heldItem && S.claims && S.claims[heldItem] !== me.id) heldItem = null;
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
  function itemById(id) {
    for (var i = 0; i < (S.items || []).length; i++) if (S.items[i].id === id) return S.items[i];
    return null;
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
    } else if (S.phase === 'rank') {
      btn('−5s', 'timer-');
      btn('+5s', 'timer+');
      btn('Lock it in', 'lockrank', { primary: true });
    } else if (S.phase === 'build') {
      btn('Lock the board', 'lockboard', { primary: true });
    } else if (S.phase === 'argue') {
      btn('Resolve now', 'resolveargue', { primary: true });
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
    else if (S.phase === 'rank') { renderRank(); show('rank'); }
    else if (S.phase === 'build') { renderBuild(); show('build'); }
    else if (S.phase === 'argue') { renderArgue(); show('argue'); }
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
        avatar(p.name, i, null, p), el('span', { text: p.name + (p.id === me.id ? ' (you)' : '') })
      ]));
    });
    $('#waitMsg').textContent = S.players.length < 3
      ? 'Waiting for more players… need at least 3.'
      : 'Waiting for the host to start…';
    if ($('#addBox')) $('#addBox').classList.toggle('hidden', !S.canAdd);
    renderMyQs();
  }

  /* ---------------- rank (private) ---------------- */
  function renderRank() {
    if (assignRound !== S.round) { myAssign = {}; assignRound = S.round; selectedItem = null; }
    $('#rankBanner').textContent = 'Round ' + (S.round + 1) + ' / ' + S.total;
    var count = (S.submitted || []).length;
    $('#rankHint').textContent = myAssign.__sent
      ? 'Locked in — ' + count + '/' + S.players.length + ' have ranked.'
      : 'Tap an item, then tap a tier to place it. ' + count + '/' + S.players.length + ' have ranked.';
    runClock();

    var tray = $('#rankTray');
    tray.innerHTML = '';
    (S.items || []).forEach(function (it) {
      if (myAssign[it.id]) return;
      tray.appendChild(el('button', {
        class: 'tl-chip tl-pick' + (selectedItem === it.id ? ' selected' : ''),
        onclick: function () { selectedItem = (selectedItem === it.id) ? null : it.id; renderRank(); }
      }, [el('span', { text: it.text })]));
    });

    var lanes = $('#rankLanes');
    lanes.innerHTML = '';
    TIERS.forEach(function (tier) {
      var laneItems = (S.items || []).filter(function (it) { return myAssign[it.id] === tier; });
      lanes.appendChild(el('div', { class: 'tl-lane', style: '--tc:' + TIER_COLOR[tier] }, [
        el('button', {
          class: 'tl-lane-label tl-lane-btn',
          onclick: function () {
            if (!selectedItem) { MLT.toast('Pick an item from below first'); return; }
            myAssign[selectedItem] = tier;
            selectedItem = null;
            renderRank();
            maybeAutoEnableLock();
          },
          text: tier
        }),
        el('div', { class: 'tl-lane-items' }, laneItems.map(function (it) {
          return el('button', {
            class: 'tl-chip',
            onclick: function () { delete myAssign[it.id]; renderRank(); }
          }, [el('span', { text: it.text })]);
        }))
      ]));
    });

    var allPlaced = (S.items || []).length > 0 && (S.items || []).every(function (it) { return !!myAssign[it.id]; });
    $('#btnLockRankMe').disabled = !allPlaced || !!myAssign.__sent;
    $('#btnLockRankMe').textContent = myAssign.__sent ? 'Locked in' : 'Lock in my tiers';
  }

  function maybeAutoEnableLock() {
    var allPlaced = (S.items || []).length > 0 && (S.items || []).every(function (it) { return !!myAssign[it.id]; });
    $('#btnLockRankMe').disabled = !allPlaced;
  }

  function sendRank() {
    var allPlaced = (S.items || []).every(function (it) { return !!myAssign[it.id]; });
    if (!allPlaced) { MLT.toast('Place every item into a tier first'); return; }
    var assign = {};
    (S.items || []).forEach(function (it) { assign[it.id] = myAssign[it.id]; });
    myAssign.__sent = true;
    A.sfx('pick');
    bus.send({ t: 'rank', from: me.id, round: S.round, assign: assign });
    renderRank();
    MLT.toast('Locked in — waiting on everyone else');
  }

  function runClock() {
    clearInterval(clockTimer);
    var clock = $('#rankClock');
    if (!S.endsAt) { clock.textContent = ''; clock.classList.remove('urgent'); $('#rankFill').style.width = '100%'; return; }
    var endsAt = S.endsAt;
    var total = Math.max(1, (S.secs ? S.secs * 1000 : endsAt - (Date.now() + skew)));
    function tick() {
      var left = endsAt - (Date.now() + skew);
      if (left <= 0) {
        clearInterval(clockTimer);
        clock.textContent = '0';
        clock.classList.remove('urgent');
        $('#rankFill').style.width = '0%';
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 5200);
      $('#rankFill').style.width = Math.min(100, (left / total) * 100) + '%';
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  /* ---------------- build (shared board) ---------------- */
  function renderBuild() {
    clearInterval(clockTimer);
    if (heldRound !== S.round) { heldItem = null; pendingClaim = null; heldRound = S.round; }
    // reconcile our optimistic claim attempt against the host's authoritative state
    var liveClaims = S.claims || {};
    if (pendingClaim && liveClaims[pendingClaim] === me.id) { heldItem = pendingClaim; pendingClaim = null; }
    else if (pendingClaim && liveClaims[pendingClaim] && liveClaims[pendingClaim] !== me.id) { pendingClaim = null; }
    $('#buildBanner').textContent = 'Round ' + (S.round + 1) + ' / ' + S.total;

    var claims = S.claims || {};
    var board = S.board || {};
    var buildReady = S.buildReady || [];
    var lockedIn = buildReady.indexOf(me.id) >= 0;

    function chipFor(it) {
      var claimant = claims[it.id];
      var mine = claimant === me.id;
      var isPending = pendingClaim === it.id;
      var cls = 'tl-chip tl-pick';
      if (mine) cls += ' held';
      else if (claimant) cls += ' claimed';
      if (isPending) cls += ' pending';
      return el('button', {
        class: cls,
        disabled: (lockedIn || (claimant && !mine)) ? 'disabled' : null,
        onclick: function () { tapItem(it.id, mine); }
      }, [
        el('span', { text: it.text }),
        (claimant && !mine) ? el('span', { class: 'tl-claimtag', text: playerName(claimant) }) : null,
        mine ? el('span', { class: 'tl-claimtag', text: 'you' }) : null
      ].filter(Boolean));
    }

    var tray = $('#buildTrayMe');
    tray.innerHTML = '';
    (S.items || []).filter(function (it) { return !board[it.id]; }).forEach(function (it) {
      tray.appendChild(chipFor(it));
    });

    var lanes = $('#buildLanesMe');
    lanes.innerHTML = '';
    TIERS.forEach(function (tier) {
      var laneItems = (S.items || []).filter(function (it) { return board[it.id] === tier; });
      lanes.appendChild(el('div', { class: 'tl-lane', style: '--tc:' + TIER_COLOR[tier] }, [
        el('button', {
          class: 'tl-lane-label tl-lane-btn',
          disabled: lockedIn ? 'disabled' : null,
          onclick: function () { dropOn(tier); },
          text: tier
        }),
        el('div', { class: 'tl-lane-items' }, laneItems.map(chipFor))
      ]));
    });

    var readyN = buildReady.length;
    var readyLine = readyN + ' / ' + S.players.length + ' locked in';
    $('#buildHintMe').textContent = lockedIn
      ? "Locked in — waiting on everyone else. " + readyLine
      : heldItem
        ? 'Holding "' + ((itemById(heldItem) || {}).text || '') + '" — tap a tier to drop it in.'
        : 'Tap an unclaimed item to grab it before someone else does. ' + readyLine;
    $('#btnReleaseMe').classList.toggle('hidden', !heldItem);
    $('#btnLockBuildMe').disabled = lockedIn || !!heldItem;
    $('#btnLockBuildMe').textContent = lockedIn ? 'Locked in' : 'Lock it in';
    runBuildClock();
  }

  function sendBuildReady() {
    if (!S || S.phase !== 'build') return;
    if (heldItem) { MLT.toast('Drop what you\'re holding first'); return; }
    A.sfx('pick');
    bus.send({ t: 'buildready', from: me.id, round: S.round });
  }

  function tapItem(itemId, alreadyMine) {
    if (alreadyMine) return; // already holding it, use a tier button to drop it
    if (heldItem) { MLT.toast('Drop what you\'re holding first'); return; }
    var claims = S.claims || {};
    if (claims[itemId] && claims[itemId] !== me.id) { MLT.toast(playerName(claims[itemId]) + ' already has that one'); return; }
    pendingClaim = itemId;
    bus.send({ t: 'claim', from: me.id, itemId: itemId, round: S.round });
    renderBuild();
    // optimistic: if the state broadcast confirms it's ours, heldItem gets set in onMessage's next render via S.claims check
  }

  function dropOn(tier) {
    if (!heldItem) { MLT.toast('Grab an item first'); return; }
    A.sfx('pick');
    bus.send({ t: 'place', from: me.id, itemId: heldItem, tier: tier, round: S.round });
    heldItem = null;
    pendingClaim = null;
    renderBuild();
  }

  function releaseHeld() {
    if (!heldItem) return;
    bus.send({ t: 'release', from: me.id, itemId: heldItem, round: S.round });
    heldItem = null;
    renderBuild();
  }

  var buildClockTimer2 = null;
  function runBuildClock() {
    clearInterval(buildClockTimer2);
    var clock = $('#buildClockMe');
    if (!S.endsAt) { clock.textContent = ''; return; }
    var endsAt = S.endsAt;
    function tick() {
      var left = endsAt - (Date.now() + skew);
      if (left <= 0) { clearInterval(buildClockTimer2); clock.textContent = '0'; return; }
      clock.textContent = Math.ceil(left / 1000);
    }
    tick();
    buildClockTimer2 = setInterval(tick, 500);
  }

  /* ---------------- argue ---------------- */
  function renderArgue() {
    clearInterval(clockTimer);
    if (argueRound !== S.round) { myArgueVote = null; argueRound = -1; }
    var it = itemById(S.contested);
    $('#argueBanner').textContent = 'Round ' + (S.round + 1) + ' / ' + S.total;
    $('#argueItemMe').textContent = it ? it.text : '—';
    $('#argueTierMe').textContent = (S.board && S.board[S.contested]) || 'C';
    var voted = (S.argueVoted || []).length;
    $('#argueHint').textContent = myArgueVote
      ? 'Vote locked in · ' + voted + '/' + S.players.length + ' voted.'
      : 'This one got moved around a lot — leave it, or bump it down a tier? ' + voted + '/' + S.players.length + ' voted.';
    $('#btnAgree').setAttribute('aria-pressed', myArgueVote === 'agree' ? 'true' : 'false');
    $('#btnMovedown').setAttribute('aria-pressed', myArgueVote === 'movedown' ? 'true' : 'false');
    runArgueClockPlayer();
  }

  var argueClockTimer2 = null;
  function runArgueClockPlayer() {
    clearInterval(argueClockTimer2);
    var clock = $('#argueClockMe');
    if (!S.endsAt) { clock.textContent = ''; return; }
    var endsAt = S.endsAt;
    function tick() {
      var left = endsAt - (Date.now() + skew);
      if (left <= 0) { clearInterval(argueClockTimer2); clock.textContent = '0'; return; }
      clock.textContent = Math.ceil(left / 1000);
    }
    tick();
    argueClockTimer2 = setInterval(tick, 500);
  }

  function castArgueVote(vote) {
    if (!S || S.phase !== 'argue') return;
    myArgueVote = vote;
    argueRound = S.round;
    A.sfx('pick');
    bus.send({ t: 'arguevote', from: me.id, round: S.round, vote: vote });
    renderArgue();
  }

  /* ---------------- reveal / final ---------------- */
  function renderResult() {
    clearInterval(clockTimer);
    $('#rBanner').textContent = 'Round ' + (S.round + 1) + ' / ' + S.total;
    var lanes = $('#rLanes');
    lanes.innerHTML = '';
    TIERS.forEach(function (tier) {
      var laneItems = (S.items || []).filter(function (it) { return (S.board || {})[it.id] === tier; });
      lanes.appendChild(el('div', { class: 'tl-lane', style: '--tc:' + TIER_COLOR[tier] }, [
        el('div', { class: 'tl-lane-label', text: tier }),
        el('div', { class: 'tl-lane-items' }, laneItems.map(function (it) {
          return el('div', { class: 'tl-chip' }, [el('span', { text: it.text })]);
        }))
      ]));
    });
    $('#rArgueNote').textContent = S.contestedText
      ? '"' + S.contestedText + '" got argued over' + (S.bumped ? ' — bumped down a tier.' : ' — the room let it stand.')
      : 'Nothing got seriously contested this round.';
    var box = $('#rScores');
    box.innerHTML = '';
    var scores = S.scores || {};
    Object.keys(scores).sort(function (a, b) { return scores[b] - scores[a]; }).forEach(function (pid) {
      var idx = playerIndex(pid);
      box.appendChild(el('div', { class: 'chip' }, [
        avatar(playerName(pid), idx), el('span', { text: playerName(pid) + (pid === me.id ? ' (you)' : '') }),
        el('span', { class: 'tag', text: '+' + scores[pid] })
      ]));
    });
    $('#rWait').textContent = 'Waiting for the host…';
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

    $('#mostContestedMe').textContent = S.mostContested
      ? 'Most fought over: "' + S.mostContested.text + '" (moved ' + S.mostContested.n + ' times)'
      : '';

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
  if ($('#btnAddQ')) $('#btnAddQ').addEventListener('click', addItem);
  $('#name').addEventListener('keydown', function (e) { if (e.key === 'Enter') join(); });
  $('#code').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#name').focus(); });
  $('#btnLockRankMe').addEventListener('click', sendRank);
  $('#btnReleaseMe').addEventListener('click', releaseHeld);
  $('#btnLockBuildMe').addEventListener('click', sendBuildReady);
  $('#btnAgree').addEventListener('click', function () { castArgueVote('agree'); });
  $('#btnMovedown').addEventListener('click', function () { castArgueVote('movedown'); });
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

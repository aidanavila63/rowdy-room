(function () {
  var $ = MLT.$, el = MLT.el, show = MLT.show, avatar = MLT.avatar, A = MLT.audio;
  var slot = MLT.qs('me');
  var SAVE = 'dc.me.v1' + (slot ? '.' + slot : '');
  var ACCENT = '#9d6bff';

  var me = MLT.store(SAVE) || { id: MLT.uid(), name: '', code: '' };
  var bus = null;
  var S = null;
  var lastSeq = -1;
  var skew = 0;
  var seenRound = -1;
  var mySubmitted = false;
  var helloTimer = null, clockTimer = null;
  var confettied = false;
  var soundedReveal = -1;

  var urlCode = (MLT.qs('r') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  $('#code').value = urlCode || me.code || '';
  $('#name').value = me.name || '';

  document.documentElement.style.setProperty('--accent', ACCENT);

  /* ------------------------------------------------------------------ */
  /* drawing canvas                                                      */
  /* ------------------------------------------------------------------ */
  var canvas = $('#dcCanvas'), ctx2d = canvas.getContext('2d');
  var CW = MLT.DC_CANVAS_W, CH = MLT.DC_CANVAS_H;
  var strokes = [];
  var curStroke = null;
  var curColor = MLT.DC_SWATCHES[0];
  var drawing = false;

  function canvasPoint(evt) {
    var rect = canvas.getBoundingClientRect();
    var cx = (evt.touches && evt.touches[0]) ? evt.touches[0].clientX : evt.clientX;
    var cy = (evt.touches && evt.touches[0]) ? evt.touches[0].clientY : evt.clientY;
    var x = (cx - rect.left) / rect.width * CW;
    var y = (cy - rect.top) / rect.height * CH;
    return [Math.max(0, Math.min(CW, x)), Math.max(0, Math.min(CH, y))];
  }

  function redrawCanvas() {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    var sx = canvas.width / CW, sy = canvas.height / CH;
    strokes.forEach(function (s) {
      if (s.p.length < 4) return;
      ctx2d.strokeStyle = s.c;
      ctx2d.lineWidth = 4.2 * Math.min(sx, sy);
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      ctx2d.beginPath();
      ctx2d.moveTo(s.p[0] * sx, s.p[1] * sy);
      for (var i = 2; i < s.p.length; i += 2) ctx2d.lineTo(s.p[i] * sx, s.p[i + 1] * sy);
      ctx2d.stroke();
    });
  }

  function sizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    redrawCanvas();
  }
  window.addEventListener('resize', sizeCanvas);

  function startStroke(evt) {
    if (mySubmitted) return;
    if (strokes.length >= 40) { MLT.toast('That’s enough strokes — Submit or Clear.'); return; }
    evt.preventDefault();
    drawing = true;
    var pt = canvasPoint(evt);
    curStroke = { c: curColor, p: [pt[0], pt[1]] };
    strokes.push(curStroke);
  }
  function moveStroke(evt) {
    if (!drawing || !curStroke) return;
    evt.preventDefault();
    var pt = canvasPoint(evt);
    var p = curStroke.p;
    var lx = p[p.length - 2], ly = p[p.length - 1];
    var dx = pt[0] - lx, dy = pt[1] - ly;
    if (dx * dx + dy * dy < 1.4) return; /* distance-based simplification */
    if (p.length / 2 >= 120) return; /* per-stroke point cap */
    p.push(pt[0], pt[1]);
    redrawCanvas();
  }
  function endStroke() { drawing = false; curStroke = null; }

  canvas.addEventListener('pointerdown', startStroke);
  canvas.addEventListener('pointermove', moveStroke);
  window.addEventListener('pointerup', endStroke);
  canvas.addEventListener('touchstart', startStroke, { passive: false });
  canvas.addEventListener('touchmove', moveStroke, { passive: false });
  canvas.addEventListener('touchend', endStroke);

  var swatchBox = $('#dcSwatches');
  MLT.DC_SWATCHES.forEach(function (c, i) {
    var b = el('button', {
      class: 'dc-swatch' + (i === 0 ? ' on' : ''), style: 'background:' + c,
      onclick: function () {
        curColor = c;
        MLT.$$('.dc-swatch', swatchBox).forEach(function (n) { n.classList.remove('on'); });
        b.classList.add('on');
      }
    });
    swatchBox.appendChild(b);
  });
  $('#btnUndo').addEventListener('click', function () { strokes.pop(); redrawCanvas(); });
  $('#btnClear').addEventListener('click', function () { strokes = []; redrawCanvas(); });

  function resetCanvas() {
    strokes = []; curStroke = null; drawing = false;
    curColor = MLT.DC_SWATCHES[0];
    MLT.$$('.dc-swatch', swatchBox).forEach(function (n, i) { n.classList.toggle('on', i === 0); });
    redrawCanvas();
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
    S = null; lastSeq = -1; seenRound = -1; mySubmitted = false; soundedReveal = -1;
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
    if (S.orderNames && S.order) {
      var oi = S.order.indexOf(id);
      if (oi >= 0) return S.orderNames[oi];
    }
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
    var sig = S.phase + '|' + (S.round || 0) + '|' + (S.revealIdx || 0) + '|' + S.players.length;
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
    } else if (S.phase === 'build') {
      btn('−5s', 'timer-');
      btn('+5s', 'timer+');
      btn('Skip round', 'skip', { primary: true });
    } else if (S.phase === 'reveal') {
      btn(S.revealIdx + 1 >= S.N ? 'Vote for a favorite' : 'Next chain', 'next', { primary: true });
    } else if (S.phase === 'chainvote') {
      btn('See the winner', 'finish', { primary: true });
    } else if (S.phase === 'final') {
      btn('Play again', 'again', { primary: true });
    }
  }

  function render() {
    if (!S) return;
    renderHostBar();
    if (S.phase === 'lobby') { renderWait(); show('wait'); }
    else if (S.phase === 'build') { renderBuild(); show('build'); }
    else if (S.phase === 'reveal') { renderReveal(); show('reveal'); }
    else if (S.phase === 'chainvote') { renderChainvote(); show('chainvote'); }
    else if (S.phase === 'final') { renderFinal(); show('final'); }
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

  function renderBuild() {
    var turn = S.myTurn ? S.myTurn[me.id] : null;
    if (seenRound !== S.round) {
      seenRound = S.round;
      mySubmitted = false;
      resetCanvas();
      $('#dcCaptionIn').value = '';
    }
    $('#bBanner').textContent = 'Round ' + (S.round + 1) + ' / ' + S.N;

    var spectating = !turn;
    $('#dcSpectate').classList.toggle('hidden', !spectating);
    $('#dcActive').classList.toggle('hidden', spectating);
    if (spectating) {
      runClock();
      return;
    }

    var isDraw = S.step === 'draw';
    $('#dcDrawUI').classList.toggle('hidden', !isDraw);
    $('#dcCaptionUI').classList.toggle('hidden', isDraw);

    var prev = turn.prev;
    var promptBox = $('#dcPrompt');
    promptBox.innerHTML = '';
    if (prev && prev.type === 'prompt') {
      promptBox.appendChild(el('div', { class: 'tiny', text: 'DRAW THIS' }));
      promptBox.appendChild(el('div', { class: 'qbig', style: 'font-size:clamp(20px,5vw,30px)', text: prev.text }));
    } else if (prev && prev.type === 'caption') {
      promptBox.appendChild(el('div', { class: 'tiny', text: 'DRAW THIS CAPTION' }));
      promptBox.appendChild(el('div', { class: 'qbig', style: 'font-size:clamp(18px,4.6vw,26px)', text: '“' + (prev.data && prev.data.text || '') + '”' }));
    } else if (prev && prev.type === 'draw') {
      promptBox.appendChild(el('div', { class: 'tiny', text: 'CAPTION THIS DRAWING' }));
      promptBox.appendChild(el('div', { class: 'dc-canvasview big', html: MLT.dcStrokesToSVG(prev.data && prev.data.strokes, MLT.DC_CANVAS_W, MLT.DC_CANVAS_H) }));
    }

    if (turn.done) {
      $('#dcDrawUI').classList.add('hidden');
      $('#dcCaptionUI').classList.add('hidden');
      $('#dcSubmitted').classList.remove('hidden');
    } else {
      $('#dcSubmitted').classList.add('hidden');
    }
    $('#bSubCount').textContent = S.submittedCount;
    $('#bSubTotal').textContent = S.N;
    runClock();
  }

  function submitDrawing() {
    if (mySubmitted) return;
    mySubmitted = true;
    A.sfx('pick');
    bus.send({ t: 'vote', from: me.id, round: S.round, pick: { strokes: strokes } }, 'vote');
    $('#dcDrawUI').classList.add('hidden');
    $('#dcSubmitted').classList.remove('hidden');
  }
  function submitCaption() {
    if (mySubmitted) return;
    var text = ($('#dcCaptionIn').value || '').trim();
    if (!text) { MLT.toast('Write something first'); return; }
    mySubmitted = true;
    A.sfx('pick');
    bus.send({ t: 'vote', from: me.id, round: S.round, pick: { text: text } }, 'vote');
    $('#dcCaptionUI').classList.add('hidden');
    $('#dcSubmitted').classList.remove('hidden');
  }

  function runClock() {
    clearInterval(clockTimer);
    var clock = $('#bClock');
    if (!S.endsAt) { clock.textContent = ''; clock.classList.remove('urgent'); $('#bFill').style.width = '100%'; return; }
    var endsAt = S.endsAt;
    var total = Math.max(1, (S.drawSecs || S.capSecs) * 1000);
    function tick() {
      var left = endsAt - (Date.now() + skew);
      if (left <= 0) {
        clearInterval(clockTimer);
        clock.textContent = '0';
        clock.classList.remove('urgent');
        $('#bFill').style.width = '0%';
        return;
      }
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('urgent', left <= 5200);
      $('#bFill').style.width = Math.min(100, (left / total) * 100) + '%';
    }
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function panelNode(item) {
    if (!item) return el('div', { class: 'dc-panel' }, [el('div', { class: 'tiny', text: '—' })]);
    if (item.type === 'prompt') {
      return el('div', { class: 'dc-panel dc-seed' }, [
        el('div', { class: 'tiny', text: 'THE PROMPT' }),
        el('div', { class: 'dc-seedtext', text: item.text })
      ]);
    }
    if (item.type === 'draw') {
      return el('div', { class: 'dc-panel' }, [
        el('div', { class: 'dc-canvasview', html: MLT.dcStrokesToSVG(item.data && item.data.strokes, MLT.DC_CANVAS_W, MLT.DC_CANVAS_H) }),
        el('div', { class: 'dc-by', text: '🎨 ' + playerName(item.by) })
      ]);
    }
    return el('div', { class: 'dc-panel dc-caption' }, [
      el('div', { class: 'dc-captiontext', text: '“' + (item.data && item.data.text || '') + '”' }),
      el('div', { class: 'dc-by', text: '💬 ' + playerName(item.by) })
    ]);
  }

  function renderReveal() {
    clearInterval(clockTimer);
    if (soundedReveal !== S.revealIdx) { soundedReveal = S.revealIdx; A.sfx('reveal'); }
    $('#rvProgress').textContent = 'Chain ' + (S.revealIdx + 1) + ' / ' + S.N;
    var strip = $('#rvFilmstrip');
    strip.innerHTML = '';
    (S.chain || []).forEach(function (item, i) {
      strip.appendChild(panelNode(item));
      if (i < S.chain.length - 1) strip.appendChild(el('div', { class: 'dc-arrow', text: '→' }));
    });
  }

  var myVote = null, votedChainRound = -1;
  function renderChainvote() {
    clearInterval(clockTimer);
    if (votedChainRound !== 0 && myVote === null) { /* no-op, kept for clarity */ }
    var grid = $('#cvGrid');
    grid.innerHTML = '';
    (S.summaries || []).forEach(function (s) {
      var thumb = s.last.type === 'draw'
        ? el('div', { class: 'dc-thumb', html: MLT.dcStrokesToSVG(s.last.data && s.last.data.strokes, MLT.DC_CANVAS_W, MLT.DC_CANVAS_H) })
        : el('div', { class: 'dc-thumb dc-thumbtext', text: '“' + (s.last.data && s.last.data.text || '') + '”' });
      var mine = myVote === s.idx;
      var card = el('button', {
        class: 'dc-votecard' + (mine ? ' picked' : ''),
        onclick: function () {
          myVote = s.idx;
          A.sfx('pick');
          bus.send({ t: 'cvote', from: me.id, pick: s.idx });
          renderChainvote();
        }
      }, [
        el('div', { class: 'tiny', text: 'Chain ' + (s.idx + 1) + ' · "' + s.seed + '"' }),
        thumb,
        mine ? el('div', { class: 'tag', style: 'color:var(--lime)', text: '✓ your vote' }) : null
      ]);
      grid.appendChild(card);
    });
    $('#cvCount').textContent = S.voteCount || 0;
    $('#cvTotal').textContent = S.players.length;
  }

  function renderFinal() {
    clearInterval(clockTimer);
    var n = (S.voteCounts && S.voteCounts[S.winnerIdx]) || 0;
    $('#fnSub').textContent = 'Chain ' + (S.winnerIdx + 1) + ' won with ' + n + ' vote' + (n === 1 ? '' : 's');
    var strip = $('#fnFilmstrip');
    strip.innerHTML = '';
    (S.winnerChain || []).forEach(function (item, i) {
      strip.appendChild(panelNode(item));
      if (i < S.winnerChain.length - 1) strip.appendChild(el('div', { class: 'dc-arrow', text: '→' }));
    });
    if (!confettied) {
      confettied = true;
      A.sfx('gameover');
      MLT.confetti([MLT.colorFor(S.winnerIdx)]);
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
  $('#btnSubmitDraw').addEventListener('click', submitDrawing);
  $('#btnSubmitCaption').addEventListener('click', submitCaption);
  $('#dcCaptionIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitCaption(); });
  $('#btnLeave').addEventListener('click', function () {
    leaving = true;
    clearInterval(helloTimer);
    if (bus) bus.send({ t: 'bye', from: me.id });
    setTimeout(function () { location.href = location.pathname; }, 250);
  });
  window.addEventListener('pagehide', function () {
    if (bus && S && S.phase === 'lobby') bus.send({ t: 'bye', from: me.id });
  });

  setTimeout(sizeCanvas, 0);
  window.__me = me;
})();

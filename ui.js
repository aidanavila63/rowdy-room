(function (global) {
  var COLORS = ['var(--c0)', 'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)'];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function colorFor(idx) { return COLORS[idx % COLORS.length]; }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    var s = (parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '');
    return s.toUpperCase();
  }

  function avatar(name, idx, cls) {
    var c = colorFor(idx);
    return el('i', {
      class: 'av ' + (cls || ''),
      style: 'background:' + c + ';box-shadow:0 0 12px ' + c,
      text: initials(name)
    });
  }

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* Count a number up, arcade-scoreboard style. */
  function countUp(node, to, ms) {
    to = to || 0;
    if (reduced || !to) { node.textContent = String(to); return; }
    var start = performance.now(), dur = ms || 600;
    (function step(t) {
      var k = Math.min(1, (t - start) / dur);
      node.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    })(start);
  }

  /* Tiny canvas confetti — no library, respects reduced motion. */
  function confetti(colors, ms) {
    if (reduced) return;
    var cv = document.getElementById('confetti');
    if (!cv) {
      cv = el('canvas', { id: 'confetti' });
      document.body.appendChild(cv);
    }
    var ctx = cv.getContext('2d');
    var w = cv.width = window.innerWidth;
    var h = cv.height = window.innerHeight;
    colors = colors && colors.length ? colors : ['#22e6ff', '#ff2d95', '#ffd23f', '#b6ff3b', '#9d6bff'];
    var bits = [];
    for (var i = 0; i < 160; i++) {
      bits.push({
        x: Math.random() * w,
        y: -20 - Math.random() * h * 0.5,
        vx: (Math.random() - 0.5) * 2.4,
        vy: 2 + Math.random() * 4,
        s: 4 + Math.random() * 7,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        c: colors[i % colors.length]
      });
    }
    var end = performance.now() + (ms || 2600);
    (function frame(t) {
      ctx.clearRect(0, 0, w, h);
      bits.forEach(function (b) {
        b.x += b.vx; b.y += b.vy; b.r += b.vr; b.vy += 0.02;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.5);
        ctx.restore();
      });
      if (t < end) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    })(performance.now());
  }

  function show(id) {
    $$('.screen').forEach(function (s) { s.classList.add('hidden'); });
    var t = document.getElementById(id);
    if (t) t.classList.remove('hidden');
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    if (!t) {
      t = el('div', { class: 'toast', id: 'toast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function wireStatus(bus, node) {
    bus.onStatus(function (s) {
      node.setAttribute('data-s', s);
      var label = { online: 'Connected', connecting: 'Connecting…', retrying: 'Reconnecting…', offline: 'Reconnecting…' }[s] || s;
      node.querySelector('.txt').textContent = label;
    });
  }

  function uid() {
    return 'p' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function store(key, val) {
    try {
      if (val === undefined) {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      }
      if (val === null) { localStorage.removeItem(key); return null; }
      localStorage.setItem(key, JSON.stringify(val));
      return val;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ */
  /* shuffle playlist — chain a few games together under one room code   */
  /* ------------------------------------------------------------------ */
  var GAMES = [
    { slug: 'most-likely-to', name: 'Most Likely To', emoji: '🎉' },
    { slug: 'would-you-rather', name: 'Would You Rather', emoji: '🌶️' },
    { slug: 'two-truths', name: 'Two Truths and a Room', emoji: '🤥' },
    { slug: 'hill-to-die-on', name: 'Hill to Die On', emoji: '⛰️' },
    { slug: 'hometown-trivia', name: 'Hometown Trivia', emoji: '🏠' },
    { slug: 'confidently-wrong', name: 'Confidently Wrong', emoji: '🎯' },
    { slug: 'group-brain', name: 'Group Brain', emoji: '🧠' },
    { slug: 'doodle-chain', name: 'Doodle Chain', emoji: '🎨' },
    { slug: 'speed-sketch', name: 'Speed Sketch', emoji: '✏️' },
    { slug: 'taboo-chain', name: 'Taboo Chain', emoji: '🤐' }
  ];

  function gameInfo(slug) {
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].slug === slug) return GAMES[i];
    return null;
  }

  function shuffleGames(n) {
    var pool = GAMES.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, Math.min(n || 3, pool.length));
  }

  /* Presenter side: on the final screen, if a playlist is queued, add a
     "Next game" button next to Play Again that hands the whole room —
     same code, every connected phone — straight into the next game. */
  function renderPlaylistCTA(opts) {
    var old = document.getElementById('mltPlaylistNext');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!opts || !opts.playlist || !opts.playlist.length) return;
    var anchor = $('#btnAgain');
    if (!anchor || !anchor.parentNode) return;
    var next = opts.playlist[0];
    var rest = opts.playlist.slice(1);
    var info = gameInfo(next);
    var btn = el('button', {
      class: 'big', id: 'mltPlaylistNext',
      text: '▶ Next up: ' + (info ? info.emoji + ' ' + info.name : next)
    });
    btn.addEventListener('click', function () {
      btn.disabled = true;
      try { opts.send({ t: 'advance', slug: next, r: opts.code, pl: rest }); } catch (e) {}
      setTimeout(function () {
        global.location.href = '/' + next + '/present.html?r=' + opts.code + '&auto=1' +
          (rest.length ? '&pl=' + rest.join(',') : '');
      }, 150);
    });
    anchor.parentNode.insertBefore(btn, anchor);
  }

  /* Player side: a host advancing the playlist broadcasts this — every
     connected phone follows straight into the next game, no re-scanning. */
  function handleAdvance(m, myName) {
    if (!m || m.t !== 'advance' || !m.slug || !m.r) return false;
    var url = '/' + m.slug + '/?r=' + m.r + '&auto=1' +
      (m.pl && m.pl.length ? '&pl=' + m.pl.join(',') : '') +
      (myName ? '&nm=' + encodeURIComponent(myName) : '');
    global.location.href = url;
    return true;
  }

  global.MLT = global.MLT || {};
  Object.assign(global.MLT, {
    $: $, $$: $$, el: el, colorFor: colorFor, initials: initials,
    avatar: avatar, show: show, toast: toast, wireStatus: wireStatus,
    uid: uid, store: store, confetti: confetti, countUp: countUp, reduced: reduced,
    GAMES: GAMES, gameInfo: gameInfo, shuffleGames: shuffleGames,
    renderPlaylistCTA: renderPlaylistCTA, handleAdvance: handleAdvance
  });
})(window);

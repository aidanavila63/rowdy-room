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

  /* `p` is an optional player-like object carrying a self-chosen
     { emoji, color } (see the avatar picker below) — when present it wins
     over the auto-assigned index color and initials, so a player looks the
     same everywhere their name is rendered. */
  function avatar(name, idx, cls, p) {
    var emoji = p && p.emoji;
    var c = (p && p.color) || colorFor(idx);
    return el('i', {
      class: 'av ' + (cls || '') + (emoji ? ' av-emoji' : ''),
      style: 'background:' + c + ';box-shadow:0 0 12px ' + c,
      text: emoji || initials(name)
    });
  }

  /* ------------------------------------------------------------------ */
  /* player avatar/color customization — picked once at join, remembered  */
  /* across every game and every lobby (it's a look, not a per-game       */
  /* identity), and carried to the host in the 'hello' message            */
  /* ------------------------------------------------------------------ */
  var EMOJIS = ['😀', '😎', '🤠', '🥳', '👻', '🤖', '🐶', '🐱', '🦄', '🐸',
    '🦊', '🐼', '🐵', '🍕', '🍩', '⚡', '🔥', '🌈', '🎲', '🎮', '🚀', '🌟', '💀', '👑'];

  function avatarPref() {
    var v = store('mlt.avatarpref.v1');
    return (v && (v.emoji || v.color)) ? v : { emoji: '', color: '' };
  }
  function setAvatarPref(p) { store('mlt.avatarpref.v1', p); }

  /* Injects a "pick a look" block right after the room name field on a
     join screen — every game's join page has the same #name/#code markup,
     so this one function covers all twelve without touching their HTML. */
  function mountAvatarPicker(nameFieldId) {
    if (document.getElementById('mltAvatarPicker')) return;
    var input = document.getElementById(nameFieldId || 'name');
    if (!input) return;
    var wrapDiv = input.parentNode;
    if (!wrapDiv || !wrapDiv.parentNode) return;
    var pref = avatarPref();

    var previewHolder = el('span', { class: 'av-preview-holder' });
    function renderPreview() {
      previewHolder.innerHTML = '';
      previewHolder.appendChild(avatar('?', 0, 'lg', pref));
    }

    var emojiRow = el('div', { class: 'avatar-emoji-grid' });
    EMOJIS.forEach(function (e) {
      var b = el('button', {
        type: 'button', class: 'ghost mini avatar-opt' + (pref.emoji === e ? ' picked' : ''), text: e
      });
      b.addEventListener('click', function () {
        pref.emoji = (pref.emoji === e) ? '' : e;
        setAvatarPref(pref);
        $$('.avatar-opt', emojiRow).forEach(function (x) { x.classList.remove('picked'); });
        if (pref.emoji) b.classList.add('picked');
        renderPreview();
      });
      emojiRow.appendChild(b);
    });

    var colorRow = el('div', { class: 'avatar-color-row' });
    COLORS.forEach(function (c) {
      var sw = el('button', {
        type: 'button', class: 'avatar-swatch' + (pref.color === c ? ' picked' : ''), style: 'background:' + c,
        'aria-label': 'Pick this color'
      });
      sw.addEventListener('click', function () {
        pref.color = (pref.color === c) ? '' : c;
        setAvatarPref(pref);
        $$('.avatar-swatch', colorRow).forEach(function (x) { x.classList.remove('picked'); });
        if (pref.color) sw.classList.add('picked');
        renderPreview();
      });
      colorRow.appendChild(sw);
    });

    renderPreview();
    var box = el('div', { class: 'avatar-picker', id: 'mltAvatarPicker' }, [
      el('label', { class: 'field', text: 'Pick a look (optional)' }),
      el('div', { class: 'row avatar-picker-row' }, [
        previewHolder,
        el('div', { class: 'stack tight grow' }, [emojiRow, colorRow])
      ])
    ]);
    wrapDiv.parentNode.insertBefore(box, wrapDiv.nextSibling);
  }

  /* ------------------------------------------------------------------ */
  /* alternate accent palettes — a purely cosmetic, app-wide "vibe" swap  */
  /* on top of the neon default; layered underneath (not instead of) the */
  /* per-question-pack accent color a game already sets during rounds    */
  /* ------------------------------------------------------------------ */
  var PALETTES = [
    { id: 'neon', name: '⚡ Neon', accent: '#22e6ff', cyan: '#22e6ff', magenta: '#ff2d95', lime: '#b6ff3b', gold: '#ffd23f', violet: '#9d6bff',
      c: ['#ff3b5c', '#22e6ff', '#ffd23f', '#3dff9e', '#9d6bff', '#ff2d95', '#2bffe0', '#ff8a3d'] },
    { id: 'sunset', name: '🌇 Sunset', accent: '#ff8a3d', cyan: '#ff8a3d', magenta: '#ff3b5c', lime: '#ffd23f', gold: '#ffb347', violet: '#ff5da2',
      c: ['#ff5da2', '#ff8a3d', '#ffd23f', '#ff3b5c', '#ffb347', '#ff2d95', '#ffcf5c', '#ff6f3c'] },
    { id: 'forest', name: '🌲 Forest', accent: '#3dff9e', cyan: '#3dff9e', magenta: '#ffd23f', lime: '#b6ff3b', gold: '#e0c341', violet: '#5ad1a4',
      c: ['#3dff9e', '#b6ff3b', '#5ad1a4', '#e0c341', '#2bd48a', '#94e36a', '#1fb787', '#c8e05a'] },
    { id: 'candy', name: '🍬 Candy', accent: '#ff8bd6', cyan: '#8bd8ff', magenta: '#ff8bd6', lime: '#c9ff8b', gold: '#ffe08b', violet: '#c88bff',
      c: ['#ff8bd6', '#8bd8ff', '#c88bff', '#ffe08b', '#c9ff8b', '#ff9ecf', '#8bffe6', '#ffb0e6'] },
    { id: 'mono', name: '🌙 Midnight', accent: '#9fb4d8', cyan: '#9fb4d8', magenta: '#c7d2e8', lime: '#7d93bd', gold: '#e7ecf7', violet: '#aebde0',
      c: ['#9fb4d8', '#c7d2e8', '#7d93bd', '#e7ecf7', '#aebde0', '#8fa3c9', '#d6dff2', '#6d84b0'] }
  ];

  function paletteInfo(id) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
    return PALETTES[0];
  }
  function themePref() { return store('mlt.theme.v1') || 'neon'; }
  function applyTheme(id) {
    var p = paletteInfo(id);
    var r = document.documentElement.style;
    r.setProperty('--cyan', p.cyan);
    r.setProperty('--magenta', p.magenta);
    r.setProperty('--lime', p.lime);
    r.setProperty('--gold', p.gold);
    r.setProperty('--violet', p.violet);
    r.setProperty('--accent', p.accent);
    p.c.forEach(function (col, i) { r.setProperty('--c' + i, col); });
  }
  function setThemePref(id) { store('mlt.theme.v1', id); applyTheme(id); }

  /* Mounts next to the existing Music/Sound buttons wherever they are —
     every presenter and player page (and the hub) shares that same
     .brandline strip, so this needs no per-page markup either. */
  function mountThemeToggle() {
    if (document.getElementById('mltThemeBtn')) return;
    var bar = $('.brandline');
    if (!bar) return;
    var anchor = document.getElementById('btnMusic') || document.getElementById('btnSfx') || null;
    var btn = el('button', { class: 'ghost mini', id: 'mltThemeBtn', type: 'button', title: 'Color theme', text: '🎨 Theme' });
    var pop = el('div', { class: 'theme-pop hidden', id: 'mltThemePop' });
    PALETTES.forEach(function (p) {
      var b = el('button', {
        type: 'button', class: 'ghost mini theme-opt' + (themePref() === p.id ? ' picked' : ''), text: p.name
      });
      b.addEventListener('click', function () {
        setThemePref(p.id);
        $$('.theme-opt', pop).forEach(function (x) { x.classList.remove('picked'); });
        b.classList.add('picked');
        pop.classList.add('hidden');
      });
      pop.appendChild(b);
    });
    btn.addEventListener('click', function () { pop.classList.toggle('hidden'); });
    document.addEventListener('click', function (ev) {
      if (!pop.contains(ev.target) && ev.target !== btn) pop.classList.add('hidden');
    });
    var holder = el('span', { class: 'theme-holder' }, [btn, pop]);
    if (anchor && anchor.parentNode === bar) bar.insertBefore(holder, anchor);
    else bar.appendChild(holder);
  }

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* Count a number up, arcade-scoreboard style — a gentle back-out overshoot
     (ticks slightly past the final number, then settles) reads as a lot
     more satisfying than a flat ease-out, for basically free. */
  function countUp(node, to, ms) {
    to = to || 0;
    if (reduced || !to) { node.textContent = String(to); return; }
    var start = performance.now(), dur = ms || 700;
    var c1 = 1.15, c3 = c1 + 1;
    (function step(t) {
      var k = Math.min(1, (t - start) / dur);
      var eased = k >= 1 ? 1 : 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
      node.textContent = String(Math.max(0, Math.round(to * eased)));
      if (k < 1) requestAnimationFrame(step);
      else node.textContent = String(to);
    })(start);
  }

  /* A brief, contained screen shake — targets .wrap (the actual page
     content) rather than <body>, so the fixed-position confetti canvas,
     toasts, and overlays stay perfectly still while the room itself
     "feels" the impact. */
  function screenShake() {
    if (reduced) return;
    var target = $('.wrap') || document.body;
    target.classList.remove('mlt-shake');
    void target.offsetWidth; /* restart the animation even if one is already playing */
    target.classList.add('mlt-shake');
    setTimeout(function () { target.classList.remove('mlt-shake'); }, 460);
  }

  /* A quick full-viewport radial flash in the given color — the "camera
     flash" that sells a big moment as an actual impact, not just more
     particles falling. */
  function flashBurst(color) {
    if (reduced) return;
    var f = document.getElementById('mltFlash');
    if (!f) {
      f = el('div', { class: 'mlt-flash', id: 'mltFlash' });
      document.body.appendChild(f);
    }
    f.style.background = 'radial-gradient(circle at 50% 38%, ' + (color || '#ffffff') + ' 0%, transparent 68%)';
    f.classList.remove('mlt-flash-active');
    void f.offsetWidth;
    f.classList.add('mlt-flash-active');
  }

  /* Confetti cannon — no library, respects reduced motion. Three sources
     at once (a gentle rain from the top, plus two cannons firing inward
     from the bottom corners) with mixed particle shapes read as a real
     celebration rather than a sprinkle; paired with a screen shake and a
     color-matched flash so the moment has weight, not just more pixels. */
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
    function addBit(x, y, vx, vy) {
      bits.push({
        x: x, y: y, vx: vx, vy: vy,
        s: 4 + Math.random() * 8,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
        shape: Math.random() < 0.4 ? 'circle' : 'rect',
        c: colors[Math.floor(Math.random() * colors.length)]
      });
    }
    for (var i = 0; i < 90; i++) {
      addBit(Math.random() * w, -20 - Math.random() * h * 0.5, (Math.random() - 0.5) * 2.4, 2 + Math.random() * 4);
    }
    for (var j = 0; j < 70; j++) {
      var a1 = -Math.PI * 0.62 + (Math.random() - 0.5) * 0.5, s1 = 7 + Math.random() * 7;
      addBit(w * 0.02, h * 0.98, Math.cos(a1) * s1, Math.sin(a1) * s1);
      var a2 = -Math.PI * 0.38 + (Math.random() - 0.5) * 0.5, s2 = 7 + Math.random() * 7;
      addBit(w * 0.98, h * 0.98, Math.cos(a2) * s2, Math.sin(a2) * s2);
    }

    var end = performance.now() + (ms || 3200);
    (function frame(t) {
      ctx.clearRect(0, 0, w, h);
      bits.forEach(function (b) {
        b.x += b.vx; b.y += b.vy; b.r += b.vr; b.vy += 0.05; b.vx *= 0.994;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        ctx.globalAlpha = 0.9;
        if (b.shape === 'circle') {
          ctx.beginPath(); ctx.arc(0, 0, b.s * 0.42, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.5);
        }
        ctx.restore();
      });
      if (t < end) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    })(performance.now());

    screenShake();
    flashBurst(colors[0]);
  }

  /* Screen switching. Guarded against redundant calls: render() functions
     across every game call show() on every incoming bus message (often
     several times a second), not just on real phase changes — without this
     guard, toggling .hidden off-then-back-on for the screen that's already
     showing would replay its entrance animation constantly. With it, the
     transition plays exactly once per genuine phase change, which is also
     what makes it a reliable place to mask brief state-sync gaps. */
  var shownId = null;
  function show(id) {
    if (id === shownId) return;
    shownId = id;
    $$('.screen').forEach(function (s) { s.classList.add('hidden'); });
    var t = document.getElementById(id);
    if (t) t.classList.remove('hidden');
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    if (!t) {
      t = el('div', { class: 'toast', id: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  var connStripTimer = null;
  function connStrip() {
    var t = document.getElementById('connStrip');
    if (!t) {
      t = el('div', { class: 'conn-strip', id: 'connStrip' });
      document.body.appendChild(t);
    }
    return t;
  }

  function wireStatus(bus, node) {
    bus.onStatus(function (s) {
      node.setAttribute('data-s', s);
      var label = { online: 'Connected', connecting: 'Connecting…', retrying: 'Reconnecting…', offline: 'Reconnecting…' }[s] || s;
      node.querySelector('.txt').textContent = label;
      connStrip();
      clearTimeout(connStripTimer);
      if (s === 'online') {
        document.body.classList.remove('conn-issue');
      } else {
        /* give a normal sub-second blip a chance to clear on its own before
           putting anything on screen for it — only a drop that actually
           lasts gets the loading-strip treatment */
        connStripTimer = setTimeout(function () {
          document.body.classList.add('conn-issue');
        }, 900);
      }
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
    { slug: 'taboo-chain', name: 'Taboo Chain', emoji: '🤐' },
    { slug: 'fibbers-court', name: "Fibbers' Court", emoji: '⚖️' },
    { slug: 'tier-list-live', name: 'Tier List Live', emoji: '🏆' }
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

  /* ------------------------------------------------------------------ */
  /* cross-game running tally — carried forward as a URL param each time  */
  /* the host advances the room into a new game, so "session standings"  */
  /* keep adding up until the host closes the room                       */
  /* ------------------------------------------------------------------ */
  function b64encode(str) {
    try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { return ''; }
  }
  function b64decode(str) {
    try { return decodeURIComponent(escape(atob(str))); } catch (e) { return ''; }
  }
  /* Keyed by name, not player id: each game keeps its own independent
     identity store (mlt.me.v1, wyr.me.v1, tl.me.v1, ...), so the same
     person gets a brand new id every time the lobby moves to a different
     game — id can't be used to recognize "the same player" across games.
     The name they typed is the one thing that travels with them (it's
     already carried forward via ?nm= on every auto-rejoin), so the running
     tally matches players by a normalized version of it instead. */
  function tallyKey(name) { return String(name || '').trim().toLowerCase(); }
  function decodeTally(raw) {
    var map = {};
    if (!raw) return map;
    try {
      var arr = JSON.parse(b64decode(raw));
      arr.forEach(function (r) {
        if (r && r.name) map[tallyKey(r.name)] = { name: r.name, total: +r.total || 0, emoji: r.emoji || '', color: r.color || '' };
      });
    } catch (e) {}
    return map;
  }
  function encodeTally(map) {
    var arr = Object.keys(map).map(function (k) {
      var r = map[k];
      return { name: r.name, total: r.total, emoji: r.emoji || '', color: r.color || '' };
    });
    return b64encode(JSON.stringify(arr));
  }
  /* Fold this game's final per-player points (players[].pts, 0 for games
     with no per-player score such as Doodle Chain) into whatever tally
     came in on the URL from the previous game in this lobby session.
     Also carries each player's chosen look (emoji/color) forward — it's
     the same by-name map, so the recap slideshow's standings can render
     real avatars instead of generic initials. */
  function mergeTally(players) {
    var map = decodeTally(qsGlobal('tally'));
    (players || []).forEach(function (p) {
      if (!p || !p.name) return;
      var k = tallyKey(p.name);
      var cur = map[k] || { name: p.name, total: 0 };
      cur.name = p.name;
      cur.total = (cur.total || 0) + (p.pts || 0);
      if (p.emoji) cur.emoji = p.emoji;
      if (p.color) cur.color = p.color;
      map[k] = cur;
    });
    return map;
  }
  function tallyRows(map) {
    return Object.keys(map)
      .map(function (k) { return { name: map[k].name, total: map[k].total, emoji: map[k].emoji, color: map[k].color }; })
      .sort(function (a, b) { return b.total - a.total; });
  }
  /* ------------------------------------------------------------------ */
  /* end-of-night recap — a highlight reel of every game's awards,        */
  /* carried forward on the URL the same way the tally is, so the host    */
  /* can close out the night with an animated slideshow instead of just   */
  /* walking away from the last game played                               */
  /* ------------------------------------------------------------------ */
  function decodeRecap(raw) {
    if (!raw) return [];
    try {
      var arr = JSON.parse(b64decode(raw));
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function encodeRecap(arr) { return b64encode(JSON.stringify(arr || [])); }

  function currentGameInfo() {
    try {
      var seg = global.location.pathname.split('/').filter(Boolean)[0];
      return gameInfo(seg);
    } catch (e) { return null; }
  }

  /* Awards come in as {t,p,c,d} with p = a player id local to *this*
     game's G.players — resolve it to a name (and look) right now, since
     ids don't survive the jump to the next game (see tallyKey above).
     A game with no per-player awards (Doodle Chain never passes any) or
     one with nothing worth showing just adds nothing — the reel only
     grows when there's a real highlight to carry. */
  function mergeRecap(players, awards) {
    var list = decodeRecap(qsGlobal('recap'));
    var info = currentGameInfo();
    if (info && awards && awards.length) {
      var byId = {};
      (players || []).forEach(function (p) { if (p) byId[p.id] = p; });
      var named = awards.map(function (a) {
        var p = byId[a.p];
        if (!p) return null;
        return { t: a.t, name: p.name, c: a.c, d: a.d, emoji: p.emoji || '', color: p.color || '' };
      }).filter(Boolean);
      if (named.length) list.push({ slug: info.slug, name: info.name, emoji: info.emoji, awards: named });
    }
    return list;
  }

  /* Carry the current page's transport override (?bus=bc for the local
     BroadcastChannel test mode, ?relay= for a pinned broker) forward into
     every lobby navigation — otherwise a test room would silently fall back
     to the real public brokers the moment it advanced into a second game. */
  function transportParams() {
    var out = '';
    var b = qsGlobal('bus'); if (b) out += '&bus=' + encodeURIComponent(b);
    var r = qsGlobal('relay'); if (r) out += '&relay=' + encodeURIComponent(r);
    return out;
  }
  function qsGlobal(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([^&]*)').exec(global.location.search);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ */
  /* persistent lobby — the room stays open across games: nobody rejoins,  */
  /* a running cross-game tally keeps score, and the host either picks    */
  /* what's next directly or lets the room vote on it                     */
  /* ------------------------------------------------------------------ */

  /* Presenter side: on the final screen, mount the "keep the party going"
     panel above Play Again/New room — session standings so far, a legacy
     Shuffle "Next up" button when a playlist queue is still active, a free
     pick of any game, and a live room vote. Everyone stays on the same
     room code the whole time; only the URL's ?tally= travels forward. */
  function renderPlaylistCTA(opts) {
    var old = document.getElementById('mltLobbyBar');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!opts || !opts.code) return;
    var anchor = $('#btnAgain');
    if (!anchor) return;
    var card = anchor.closest ? anchor.closest('.card') : null;
    var mountParent = card ? card.parentNode : anchor.parentNode.parentNode;
    var mountBefore = card || anchor.parentNode;
    if (!mountParent) return;

    var tallyMap = mergeTally(opts.players);
    var tallyParam = encodeTally(tallyMap);
    var rows = tallyRows(tallyMap);
    var recapList = mergeRecap(opts.players, opts.awards);
    var recapParam = encodeRecap(recapList);

    function goTo(slug, rest) {
      try { opts.send({ t: 'advance', slug: slug, r: opts.code, tally: tallyParam, recap: recapParam, pl: rest || [] }); } catch (e) {}
      setTimeout(function () {
        global.location.href = '/' + slug + '/present.html?r=' + opts.code + '&auto=1&tally=' + encodeURIComponent(tallyParam) +
          '&recap=' + encodeURIComponent(recapParam) +
          (rest && rest.length ? '&pl=' + rest.join(',') : '') + transportParams();
      }, 150);
    }

    var wrap = el('div', { class: 'card lobby-bar', id: 'mltLobbyBar' });

    if (rows.length) {
      var standings = el('div', { class: 'lobby-standings' }, [
        el('div', { class: 'kicker' }, [document.createTextNode('Lobby standings this session')])
      ]);
      rows.forEach(function (r, i) {
        standings.appendChild(el('div', { class: 'lobby-row' }, [
          el('span', { class: 'lobby-rank', text: '#' + (i + 1) }),
          avatar(r.name, i, null, r),
          el('span', { class: 'lobby-name', text: r.name }),
          el('span', { class: 'lobby-pts', text: r.total + ' pts' })
        ]));
      });
      wrap.appendChild(standings);
    }

    var actions = el('div', { class: 'row tight lobby-actions' });

    if (opts.playlist && opts.playlist.length) {
      var next = opts.playlist[0], rest = opts.playlist.slice(1), info = gameInfo(next);
      var nextBtn = el('button', {
        class: 'big', text: '▶ Next up: ' + (info ? info.emoji + ' ' + info.name : next)
      });
      nextBtn.addEventListener('click', function () { nextBtn.disabled = true; goTo(next, rest); });
      actions.appendChild(nextBtn);
    }

    var pickBtn = el('button', { class: 'ghost', text: '🎲 Pick next game' });
    var pickGrid = el('div', { class: 'lobby-pick-grid hidden' });
    GAMES.forEach(function (g) {
      var gb = el('button', { class: 'ghost mini', text: g.emoji + ' ' + g.name });
      gb.addEventListener('click', function () { gb.disabled = true; goTo(g.slug, []); });
      pickGrid.appendChild(gb);
    });
    pickBtn.addEventListener('click', function () { pickGrid.classList.toggle('hidden'); });

    if (opts.bus) {
      var voteBtn = el('button', { class: 'ghost', text: '🗳️ Let the room vote' });
      var voteBox = el('div', { class: 'lobby-vote-box hidden' });

      voteBtn.addEventListener('click', function () {
        voteBtn.disabled = true; pickBtn.disabled = true;
        var choices = shuffleGames(4);
        var counts = {}, voters = {};
        choices.forEach(function (g) { counts[g.slug] = 0; });
        var secs = 20, endsAt = Date.now() + secs * 1000;
        try { opts.send({ t: 'lobbypoll', choices: choices.map(function (g) { return g.slug; }), secs: secs }); } catch (e) {}
        voteBox.classList.remove('hidden');

        function draw() {
          voteBox.innerHTML = '';
          var left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
          voteBox.appendChild(el('div', { class: 'kicker', text: 'Room is voting… ' + left + 's' }));
          var max = Math.max(1, choices.reduce(function (m, g) { return Math.max(m, counts[g.slug] || 0); }, 0));
          choices.forEach(function (g) {
            var n = counts[g.slug] || 0;
            voteBox.appendChild(el('div', { class: 'lobby-vote-row' }, [
              el('span', { class: 'lobby-vote-label', text: g.emoji + ' ' + g.name }),
              el('div', { class: 'lobby-vote-track' }, [el('i', { style: 'width:' + Math.round(n / max * 100) + '%' })]),
              el('span', { class: 'lobby-vote-n', text: String(n) })
            ]));
          });
        }
        draw();

        function onVote(m) {
          if (!m || m.t !== 'lobbyvote' || !m.from || counts[m.pick] === undefined) return;
          voters[m.from] = m.pick;
          Object.keys(counts).forEach(function (k) { counts[k] = 0; });
          Object.keys(voters).forEach(function (v) { counts[voters[v]]++; });
          draw();
        }
        opts.bus.on(onVote);
        var iv = setInterval(draw, 500);
        setTimeout(function () {
          clearInterval(iv);
          var top = choices.slice().sort(function (a, b) { return (counts[b.slug] || 0) - (counts[a.slug] || 0); })[0];
          voteBox.appendChild(el('div', { class: 'kicker', text: 'Winner: ' + top.emoji + ' ' + top.name }));
          setTimeout(function () { goTo(top.slug, []); }, 900);
        }, secs * 1000 + 300);
      });

      actions.appendChild(pickBtn);
      actions.appendChild(voteBtn);
      wrap.appendChild(actions);
      wrap.appendChild(pickGrid);
      wrap.appendChild(voteBox);
    } else {
      actions.appendChild(pickBtn);
      wrap.appendChild(actions);
      wrap.appendChild(pickGrid);
    }

    /* "we're done for real" lives in its own quiet row, set apart from the
       keep-playing actions above it — this is the one choice that ends the
       room instead of continuing it. */
    var endRow = el('div', { class: 'lobby-end-row' }, [
      el('span', { class: 'tiny', text: 'Calling it a night?' })
    ]);
    var endBtn = el('button', { class: 'ghost mini lobby-end-btn', text: '🌙 End the night' });
    endBtn.addEventListener('click', function () {
      renderNightRecap({ recap: recapList, rows: rows, wrap: wrap });
    });
    endRow.appendChild(endBtn);
    wrap.appendChild(endRow);

    mountParent.insertBefore(wrap, mountBefore);
  }

  /* ------------------------------------------------------------------ */
  /* end-of-night recap slideshow — the room's own little awards          */
  /* ceremony: a full-screen, auto-advancing reel of every game's         */
  /* highlights followed by the final standings, then the room is done.   */
  /* Self-mounted the same way the lobby-poll overlay is, so it needs no   */
  /* per-game HTML and works identically on every one of the twelve games.*/
  /* ------------------------------------------------------------------ */
  function renderNightRecap(data) {
    var old = document.getElementById('mltRecapOverlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var slides = [{ kind: 'cover' }];
    (data.recap || []).forEach(function (g) { slides.push({ kind: 'game', game: g }); });
    slides.push({ kind: 'standings' });

    function hashIdx(name) {
      var s = String(name || ''), h = 0;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return Math.abs(h) % 8;
    }

    var idx = 0, timer = null;
    var DUR = 6000;

    var overlay = el('div', { class: 'recap-overlay', id: 'mltRecapOverlay' });
    var bar = el('div', { class: 'recap-progress' });
    slides.forEach(function () {
      bar.appendChild(el('i', { class: 'recap-seg' }, [el('i', { class: 'recap-fill' })]));
    });
    var stage = el('div', { class: 'recap-stage' });
    var closeBtn = el('button', { class: 'ghost mini recap-close', text: '✕ End' });
    var prevBtn = el('button', { class: 'ghost mini recap-nav', text: '‹ Back' });
    var nextBtn = el('button', { class: 'ghost mini recap-nav', text: 'Next ›' });

    function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

    function renderCover() {
      var n = (data.recap || []).length;
      return el('div', { class: 'recap-slide recap-cover' }, [
        el('div', { class: 'kicker', text: 'End of the night' }),
        el('h1', { text: "🌙 That's a wrap" }),
        el('p', { class: 'recap-sub', text: n
          ? (n + (n === 1 ? ' game' : ' games') + ' played tonight — here’s how it went.')
          : 'Here’s how tonight went.' })
      ]);
    }
    function renderGameSlide(g) {
      var box = el('div', { class: 'recap-slide recap-game' }, [
        el('div', { class: 'kicker', text: 'Awards' }),
        el('h2', { text: (g.emoji || '') + ' ' + g.name })
      ]);
      var grid = el('div', { class: 'awards' });
      (g.awards || []).forEach(function (aw) {
        grid.appendChild(el('div', { class: 'award', style: '--ac:' + aw.c }, [
          el('div', { class: 't', text: aw.t }),
          el('div', { class: 'w' }, [avatar(aw.name, hashIdx(aw.name), null, aw), el('span', { text: aw.name })]),
          el('div', { class: 'd', text: aw.d })
        ]));
      });
      box.appendChild(grid);
      return box;
    }
    function renderStandings() {
      var box = el('div', { class: 'recap-slide recap-standings' }, [
        el('div', { class: 'kicker', text: 'Session standings' }),
        el('h2', { text: 'Final tally' })
      ]);
      var rows = data.rows || [];
      if (!rows.length) {
        box.appendChild(el('p', { class: 'tiny', text: 'No points recorded tonight.' }));
        return box;
      }
      var podium = el('div', { class: 'podium' });
      var top = rows.slice(0, 3);
      var heights = [168, 122, 92];
      [1, 0, 2].forEach(function (rank) {
        var p = top[rank];
        var slot = el('div', { class: 'plinth' });
        if (!p) { podium.appendChild(slot); return; }
        var hi = hashIdx(p.name);
        var c = (p.color) || colorFor(hi);
        slot.appendChild(el('div', { class: 'head' }, [
          avatar(p.name, hi, null, p),
          el('div', { class: 'nm', text: p.name }),
          el('div', { class: 'sc', text: p.total + ' pts' })
        ]));
        var col2 = el('div', { class: 'col', style: 'color:' + c }, [el('div', { class: 'rk', text: String(rank + 1) })]);
        slot.appendChild(col2);
        podium.appendChild(slot);
        setTimeout(function () { col2.style.height = heights[rank] + 'px'; }, 150 + rank * 160);
      });
      box.appendChild(podium);
      if (rows.length > 3) {
        var lb = el('div', { class: 'lb' });
        rows.slice(3).forEach(function (p, i) {
          lb.appendChild(el('div', { class: 'lbrow' }, [
            el('div', { class: 'rank', text: String(i + 4) }),
            el('div', { class: 'name' }, [avatar(p.name, hashIdx(p.name), null, p), el('span', { text: p.name })]),
            el('div', { class: 'pts', text: p.total + ' pts' })
          ]));
        });
        box.appendChild(lb);
      }
      return box;
    }

    function draw() {
      clearTimer();
      stage.innerHTML = '';
      var s = slides[idx];
      var node = s.kind === 'cover' ? renderCover() : s.kind === 'game' ? renderGameSlide(s.game) : renderStandings();
      stage.appendChild(node);

      $$('.recap-seg', bar).forEach(function (seg, i) {
        seg.classList.remove('done', 'active');
        var fill = seg.firstChild;
        if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; }
        if (i < idx) { seg.classList.add('done'); if (fill) fill.style.width = '100%'; }
      });
      var curSeg = bar.children[idx];
      var curFill = curSeg && curSeg.firstChild;
      if (curSeg) curSeg.classList.add('active');

      prevBtn.disabled = idx === 0;
      nextBtn.textContent = idx === slides.length - 1 ? 'Done ✓' : 'Next ›';

      if (global.MLT && global.MLT.audio) global.MLT.audio.sfx(idx === 0 ? 'start' : 'whoosh');
      if (s.kind === 'standings' && (data.rows || []).length) {
        confetti();
        if (global.MLT && global.MLT.audio) global.MLT.audio.sfx('crown');
      }

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (curFill) { curFill.style.transition = 'width ' + DUR + 'ms linear'; curFill.style.width = '100%'; }
        });
      });
      timer = setTimeout(function () { advance(1); }, DUR);
    }
    function advance(dir) {
      var n = idx + dir;
      if (n < 0) return;
      if (n >= slides.length) { closeOverlay(); return; }
      idx = n; draw();
    }
    function closeOverlay() {
      clearTimer();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (data.wrap) {
        data.wrap.innerHTML = '';
        data.wrap.appendChild(el('div', { class: 'recap-done' }, [
          el('div', { class: 'kicker', text: 'Room closed' }),
          el('div', { text: "🌙 Thanks for playing — see you next time." })
        ]));
      }
    }

    prevBtn.addEventListener('click', function () { advance(-1); });
    nextBtn.addEventListener('click', function () { advance(1); });
    closeBtn.addEventListener('click', closeOverlay);

    overlay.appendChild(bar);
    overlay.appendChild(closeBtn);
    overlay.appendChild(stage);
    overlay.appendChild(el('div', { class: 'recap-navrow' }, [prevBtn, nextBtn]));
    document.body.appendChild(overlay);
    draw();
  }

  /* Player side: a host advancing the room broadcasts this — every
     connected phone follows straight into the next game, no re-scanning. */
  function handleAdvance(m, myName) {
    if (!m || m.t !== 'advance' || !m.slug || !m.r) return false;
    var url = '/' + m.slug + '/?r=' + m.r + '&auto=1' +
      (m.pl && m.pl.length ? '&pl=' + m.pl.join(',') : '') +
      (myName ? '&nm=' + encodeURIComponent(myName) : '') + transportParams();
    global.location.href = url;
    return true;
  }

  /* Player side: the host opened a "what's next" vote on the final screen —
     show a pick-one overlay; tapping a choice sends the vote straight back
     over the same room-code bus (the host is still listening on it, since
     nobody's navigated away yet). Auto-dismisses when the poll's timer
     ends even if the player didn't vote. */
  function handleLobbyPoll(m, sendVote) {
    if (!m || m.t !== 'lobbypoll' || !m.choices || !m.choices.length) return false;
    var old = document.getElementById('mltPollOverlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = el('div', { class: 'lobby-poll-overlay', id: 'mltPollOverlay' });
    var grid = el('div', { class: 'lobby-poll-grid' });
    m.choices.forEach(function (slug) {
      var info = gameInfo(slug);
      var b = el('button', { class: 'ghost', text: info ? info.emoji + ' ' + info.name : slug });
      b.addEventListener('click', function () {
        $$('.lobby-poll-grid button', box).forEach(function (x) { x.classList.remove('picked'); });
        b.classList.add('picked');
        try { sendVote({ t: 'lobbyvote', from: (global.__me && global.__me.id) || uid(), pick: slug }); } catch (e) {}
      });
      grid.appendChild(b);
    });
    box.appendChild(el('div', { class: 'lobby-poll-card' }, [
      el('div', { class: 'kicker', text: "What's next?" }),
      grid
    ]));
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, ((m.secs || 20) + 1) * 1000);
    return true;
  }

  global.MLT = global.MLT || {};
  Object.assign(global.MLT, {
    $: $, $$: $$, el: el, colorFor: colorFor, initials: initials,
    avatar: avatar, show: show, toast: toast, wireStatus: wireStatus,
    uid: uid, store: store, confetti: confetti, countUp: countUp, reduced: reduced,
    screenShake: screenShake, flashBurst: flashBurst,
    GAMES: GAMES, gameInfo: gameInfo, shuffleGames: shuffleGames,
    renderPlaylistCTA: renderPlaylistCTA, handleAdvance: handleAdvance,
    handleLobbyPoll: handleLobbyPoll, renderNightRecap: renderNightRecap,
    avatarPref: avatarPref, setAvatarPref: setAvatarPref, mountAvatarPicker: mountAvatarPicker,
    PALETTES: PALETTES, paletteInfo: paletteInfo, themePref: themePref,
    applyTheme: applyTheme, setThemePref: setThemePref, mountThemeToggle: mountThemeToggle
  });

  /* Self-mounting: ui.js loads at the end of <body> on every page (host,
     player, and the hub), so the DOM it needs is already there — no
     per-page wiring required for either the theme toggle or, on a join
     screen specifically, the avatar picker. */
  applyTheme(themePref());
  mountThemeToggle();
  if (document.getElementById('name') && document.getElementById('code')) {
    mountAvatarPicker('name');
  }
})(window);

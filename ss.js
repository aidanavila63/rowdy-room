/* "Speed Sketch" — one player secretly gets a word and draws it live
   against a countdown while everyone else free-types guesses from their
   phones. Unlike Doodle Chain, the drawing itself is never secret — it
   streams to every screen in real time as strokes (never a raster image)
   so the room can watch the picture take shape. Only the WORD is secret,
   and it never rides the normal retained state broadcast: it's sent to
   the artist alone as a direct, non-retained message the other phones
   simply aren't addressed by. */
(function (global) {
  var PACKS = [
    {
      id: 'objects', name: 'Everyday Objects', emoji: '☕', accent: '#22e6ff',
      items: [
        'umbrella', 'toothbrush', 'backpack', 'traffic light', 'birthday cake',
        'sandwich', 'lightbulb', 'guitar', 'pizza slice', 'roller skate',
        'campfire', 'ice cream cone', 'mailbox', 'lawnmower', 'wristwatch'
      ]
    },
    {
      id: 'animals', name: 'Animals', emoji: '🐘', accent: '#3dff9e',
      items: [
        'elephant', 'octopus', 'penguin', 'kangaroo', 'flamingo',
        'jellyfish', 'hedgehog', 'giraffe', 'gorilla', 'seahorse',
        'peacock', 'raccoon', 'walrus', 'chameleon', 'sloth'
      ]
    },
    {
      id: 'actions', name: 'Actions & Concepts', emoji: '🏃', accent: '#ffd23f',
      items: [
        'sneezing', 'juggling', 'tightrope walking', 'snoring', 'yoga pose',
        'skydiving', 'arm wrestling', 'sleepwalking', 'hiccups', 'stage fright',
        'time travel', 'gravity', 'jet lag', 'writer\'s block', 'déjà vu'
      ]
    },
    {
      id: 'fantasy', name: 'Famous & Fantasy', emoji: '🐲', accent: '#9d6bff',
      items: [
        'dragon', 'mermaid', 'wizard', 'unicorn', 'robot uprising',
        'haunted house', 'pirate ship', 'time machine', 'werewolf', 'genie lamp',
        'superhero cape', 'flying carpet', 'alien spaceship', 'vampire fangs', 'knight in armor'
      ]
    }
  ];

  function packInfo(id) {
    for (var i = 0; i < PACKS.length; i++) if (PACKS[i].id === id) return PACKS[i];
    return PACKS[0];
  }

  function shuffle(a, rnd) {
    a = a.slice();
    rnd = rnd || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ------------------------------------------------------------------ */
  /* canvas / stroke helpers — same small vector-stroke approach as       */
  /* Doodle Chain, duplicated here (rather than shared) so each game's     */
  /* pack file stays a self-contained drop-in, per the existing pattern.  */
  /* ------------------------------------------------------------------ */
  var CANVAS_W = 300, CANVAS_H = 180;
  var MAX_STROKES = 60, MAX_PTS_PER_STROKE = 120;
  var HEX_RE = /^#[0-9a-fA-F]{3,6}$/;

  function sanitizeStrokes(strokes) {
    if (!Array.isArray(strokes)) return [];
    var out = [];
    for (var i = 0; i < strokes.length && out.length < MAX_STROKES; i++) {
      var s = strokes[i];
      if (!s || !Array.isArray(s.p)) continue;
      var col = (typeof s.c === 'string' && HEX_RE.test(s.c)) ? s.c : '#181622';
      var pts = [];
      var bad = false;
      var lim = Math.min(s.p.length, MAX_PTS_PER_STROKE * 2);
      for (var j = 0; j < lim; j++) {
        var n = Number(s.p[j]);
        if (!isFinite(n)) { bad = true; break; }
        var max = (j % 2 === 0) ? CANVAS_W : CANVAS_H;
        pts.push(Math.max(0, Math.min(max, Math.round(n * 10) / 10)));
      }
      if (!bad && pts.length >= 4) out.push({ c: col, p: pts });
    }
    return out;
  }

  function strokesToSVG(strokes, w, h) {
    w = w || CANVAS_W; h = h || CANVAS_H;
    var body = (strokes || []).map(function (s) {
      var pts = s.p || [];
      var bits = [];
      for (var i = 0; i + 1 < pts.length; i += 2) bits.push(pts[i] + ',' + pts[i + 1]);
      if (bits.length < 2) return '';
      return '<polyline points="' + bits.join(' ') + '" stroke="' + s.c +
        '" fill="none" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>';
    }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" ' +
      'style="width:100%;height:100%;display:block" preserveAspectRatio="xMidYMid meet">' + body + '</svg>';
  }

  /* Normalize free-typed guesses and the secret word the same way before
     comparing, so punctuation/case/extra spaces never cause a false miss. */
  function normalizeGuess(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }

  var SWATCHES = ['#181622', '#ff2d95', '#0a8fb0', '#e0a800', '#1f9d5c', '#7c4fd6'];

  global.MLT = global.MLT || {};
  global.MLT.SS_PACKS = PACKS;
  global.MLT.ssPackInfo = packInfo;
  global.MLT.SS_CANVAS_W = CANVAS_W;
  global.MLT.SS_CANVAS_H = CANVAS_H;
  global.MLT.SS_SWATCHES = SWATCHES;
  global.MLT.ssSanitizeStrokes = sanitizeStrokes;
  global.MLT.ssStrokesToSVG = strokesToSVG;
  global.MLT.ssNormalize = normalizeGuess;
  if (!global.MLT.shuffle) global.MLT.shuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);

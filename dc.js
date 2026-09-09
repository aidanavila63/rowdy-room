/* "Doodle Chain" — exquisite-corpse style. One phone draws a prompt, the
   next phone sees only that drawing and captions it, the next phone sees
   only the caption and draws THAT — telescoping all the way around the
   room. Every player touches every chain exactly once, so this game has
   no per-player score: the payoff is watching each chain unfurl at the
   end, then voting for a favorite. Drawings ride the bus as vector
   strokes (small point arrays), never as raster images, so a chain of
   any length stays well under what the public brokers will carry. */
(function (global) {
  var PACKS = [
    {
      id: 'silly', name: 'Silly Scenes', emoji: '🤪', accent: '#ff2d95',
      items: [
        'a dog stealing a birthday cake',
        'grandma winning a rap battle',
        'a toddler running a board meeting',
        'someone proposing marriage at a drive-thru',
        'a clown getting a parking ticket',
        'a wedding where the cake falls over',
        'a superhero who is afraid of stairs',
        'a mime getting into a car crash',
        'a knight losing a fight to a goose',
        'a ghost that is scared of humans',
        'a pirate who gets seasick',
        'a robot trying to use chopsticks',
        'a snowman at the beach',
        'a very small dog walking a very large owner',
        'a chef cooking with oven mitts on both hands and feet'
      ]
    },
    {
      id: 'animals', name: 'Animals Being Weird', emoji: '🦆', accent: '#22e6ff',
      items: [
        'a cat running a business meeting',
        'a squirrel filing its taxes',
        'an octopus playing eight instruments at once',
        'a penguin trying to fly',
        'a llama at a job interview',
        'a shark ordering coffee',
        'a raccoon washing dishes badly',
        'a chicken crossing the road on a scooter',
        'a hedgehog trying to hug someone',
        'a giraffe stuck in a low doorway',
        'a turtle winning a race by cheating',
        'a bear raiding a picnic in disguise',
        'a flamingo that refuses to stand on both legs',
        'a goldfish with a tiny top hat',
        'a sloth trying to catch a bus'
      ]
    },
    {
      id: 'chaos', name: 'Everyday Chaos', emoji: '🧯', accent: '#ffd23f',
      items: [
        'a printer jamming at the worst possible moment',
        'someone stepping on a Lego barefoot',
        'a group chat spiraling out of control',
        'a Zoom call where the cat walks across the keyboard',
        'a toddler drawing on the wall in permanent marker',
        'a Wi-Fi router being worshipped like a god',
        'someone microwaving fish at the office',
        'a self-checkout machine yelling "unexpected item"',
        'a rollercoaster stopping at the very top',
        'a phone falling in slow motion toward a puddle',
        'a candle setting off the smoke alarm at 2am',
        'a shopping cart with one wobbly wheel taking over',
        'a GPS confidently sending someone into a lake',
        'a balloon animal that goes horribly wrong',
        'a fire drill during the middle of lunch'
      ]
    },
    {
      id: 'fantasy', name: 'Fantasy & Sci-Fi', emoji: '🐉', accent: '#9d6bff',
      items: [
        'a dragon afraid of butterflies',
        'a wizard who lost his spellbook at the library',
        'a robot uprising that gets called off for rain',
        'an alien trying to parallel park a spaceship',
        'a knight asking a dragon for directions',
        'a time traveler stuck in a waiting room',
        'a vampire allergic to garlic bread at a party',
        'a fairy godmother running late to the ball',
        'a mad scientist whose invention only makes toast',
        'a spaceship running out of fuel next to a gas station',
        'a unicorn getting stuck in traffic',
        'a genie granting a wish incorrectly on purpose',
        'a zombie trying to remember its grocery list',
        'a superhero whose only power is finding parking spots',
        'a mermaid trying to use an umbrella'
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
  /* canvas / stroke helpers — shared verbatim by the presenter (to      */
  /* render whatever a phone drew) and the player (to render what the    */
  /* PREVIOUS phone drew, before captioning it).                         */
  /* ------------------------------------------------------------------ */
  var CANVAS_W = 300, CANVAS_H = 180;
  var MAX_STROKES = 40, MAX_PTS_PER_STROKE = 120; /* points, i.e. 2x this many numbers */
  var HEX_RE = /^#[0-9a-fA-F]{3,6}$/;

  /* Defensively re-clamp whatever a client sent before it's ever stored
     or rebroadcast — never trust the bus. Drops malformed strokes and
     caps counts/coordinates so payload size can't grow unbounded. */
  function sanitizeStrokes(strokes) {
    if (!Array.isArray(strokes)) return [];
    var out = [];
    for (var i = 0; i < strokes.length && out.length < MAX_STROKES; i++) {
      var s = strokes[i];
      if (!s || !Array.isArray(s.p)) continue;
      var col = (typeof s.c === 'string' && HEX_RE.test(s.c)) ? s.c : '#f2f6ff';
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

  function sanitizeCaption(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  /* Builds inline SVG markup for a strokes array — resolution-independent,
     no raster round-trip. Every value going into this string has already
     passed sanitizeStrokes/HEX_RE, so plain interpolation is safe. */
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

  /* Canvas background is white, so the default pen color needs to be dark
     enough to actually show up — no near-white swatches up front. */
  var SWATCHES = ['#181622', '#ff2d95', '#0a8fb0', '#e0a800', '#1f9d5c', '#7c4fd6'];

  global.MLT = global.MLT || {};
  global.MLT.DC_PACKS = PACKS;
  global.MLT.dcPackInfo = packInfo;
  global.MLT.DC_CANVAS_W = CANVAS_W;
  global.MLT.DC_CANVAS_H = CANVAS_H;
  global.MLT.DC_SWATCHES = SWATCHES;
  global.MLT.dcSanitizeStrokes = sanitizeStrokes;
  global.MLT.dcSanitizeCaption = sanitizeCaption;
  global.MLT.dcStrokesToSVG = strokesToSVG;
  if (!global.MLT.shuffle) global.MLT.shuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);

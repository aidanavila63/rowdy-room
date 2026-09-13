/* "Taboo Chain" — one player secretly gets a phrase plus three forbidden
   words and has to get the room to guess the phrase by typing clues live,
   without ever using the phrase's own words or the three banned ones. The
   phrase and taboo list are private to the clue-giver only (same direct-
   message trick used for Speed Sketch's secret word); the clues themselves
   are never secret — they stream to every other phone as they're sent, so
   the room reads them build up in real time. Rotates one clue-giver per
   round, same single-performer rotation as Speed Sketch. */
(function (global) {
  var PACKS = [
    {
      id: 'everyday', name: 'Everyday Life', emoji: '🏠', accent: '#22e6ff',
      items: [
        { phrase: 'ALARM CLOCK', taboo: ['WAKE', 'TIME', 'SNOOZE'] },
        { phrase: 'UMBRELLA', taboo: ['RAIN', 'WET', 'HANDLE'] },
        { phrase: 'BACKPACK', taboo: ['SCHOOL', 'STRAPS', 'BAG'] },
        { phrase: 'TOOTHBRUSH', taboo: ['TEETH', 'BRUSH', 'CLEAN'] },
        { phrase: 'REMOTE CONTROL', taboo: ['TV', 'BUTTONS', 'CHANNEL'] },
        { phrase: 'TRAFFIC LIGHT', taboo: ['RED', 'GREEN', 'STOP'] },
        { phrase: 'DOORBELL', taboo: ['RING', 'BUTTON', 'VISITOR'] },
        { phrase: 'SHOWER', taboo: ['WATER', 'SOAP', 'WASH'] },
        { phrase: 'STAIRCASE', taboo: ['STEPS', 'UP', 'CLIMB'] },
        { phrase: 'MAILBOX', taboo: ['LETTER', 'MAIL', 'POST'] },
        { phrase: 'LIGHT SWITCH', taboo: ['ON', 'OFF', 'WALL'] },
        { phrase: 'WASHING MACHINE', taboo: ['CLOTHES', 'SPIN', 'LAUNDRY'] },
        { phrase: 'PILLOW', taboo: ['SLEEP', 'SOFT', 'BED'] },
        { phrase: 'KEYCHAIN', taboo: ['KEYS', 'RING', 'HOLDER'] },
        { phrase: 'WALLET', taboo: ['MONEY', 'CASH', 'POCKET'] }
      ]
    },
    {
      id: 'nature', name: 'Nature & Animals', emoji: '🦉', accent: '#3dff9e',
      items: [
        { phrase: 'OCTOPUS', taboo: ['TENTACLES', 'INK', 'SEA'] },
        { phrase: 'GIRAFFE', taboo: ['NECK', 'TALL', 'SPOTS'] },
        { phrase: 'THUNDERSTORM', taboo: ['RAIN', 'LIGHTNING', 'LOUD'] },
        { phrase: 'VOLCANO', taboo: ['LAVA', 'ERUPT', 'MOUNTAIN'] },
        { phrase: 'BEEHIVE', taboo: ['BEES', 'HONEY', 'BUZZ'] },
        { phrase: 'RAINBOW', taboo: ['COLORS', 'RAIN', 'SKY'] },
        { phrase: 'PENGUIN', taboo: ['ICE', 'BLACK', 'WADDLE'] },
        { phrase: 'SPIDER WEB', taboo: ['SPIDER', 'STICKY', 'SILK'] },
        { phrase: 'DESERT', taboo: ['SAND', 'HOT', 'DRY'] },
        { phrase: 'CHAMELEON', taboo: ['COLOR', 'LIZARD', 'CAMOUFLAGE'] },
        { phrase: 'WATERFALL', taboo: ['RIVER', 'FALL', 'ROCKS'] },
        { phrase: 'FIREFLY', taboo: ['GLOW', 'BUG', 'NIGHT'] },
        { phrase: 'CORAL REEF', taboo: ['FISH', 'OCEAN', 'COLORFUL'] },
        { phrase: 'BEAVER DAM', taboo: ['STICKS', 'RIVER', 'BEAVER'] },
        { phrase: 'SNOWFLAKE', taboo: ['SNOW', 'COLD', 'WINTER'] }
      ]
    },
    {
      id: 'food', name: 'Food & Drink', emoji: '🍩', accent: '#ffd23f',
      items: [
        { phrase: 'PIZZA', taboo: ['CHEESE', 'SLICE', 'ITALIAN'] },
        { phrase: 'SMOOTHIE', taboo: ['BLEND', 'FRUIT', 'DRINK'] },
        { phrase: 'POPCORN', taboo: ['MOVIE', 'BUTTER', 'KERNEL'] },
        { phrase: 'HOT SAUCE', taboo: ['SPICY', 'PEPPER', 'HOT'] },
        { phrase: 'ICE CREAM CONE', taboo: ['COLD', 'SCOOP', 'MELT'] },
        { phrase: 'SANDWICH', taboo: ['BREAD', 'LUNCH', 'SLICES'] },
        { phrase: 'BIRTHDAY CAKE', taboo: ['CANDLES', 'FROSTING', 'PARTY'] },
        { phrase: 'LEMONADE', taboo: ['LEMON', 'SOUR', 'SWEET'] },
        { phrase: 'TACO', taboo: ['SHELL', 'MEXICAN', 'FILLING'] },
        { phrase: 'DONUT', taboo: ['HOLE', 'SPRINKLES', 'GLAZE'] },
        { phrase: 'SPAGHETTI', taboo: ['NOODLES', 'SAUCE', 'ITALIAN'] },
        { phrase: 'COFFEE', taboo: ['CAFFEINE', 'BEANS', 'MORNING'] },
        { phrase: 'WATERMELON', taboo: ['SEEDS', 'GREEN', 'JUICY'] },
        { phrase: 'PANCAKE', taboo: ['SYRUP', 'FLIP', 'BREAKFAST'] },
        { phrase: 'NACHOS', taboo: ['CHIPS', 'CHEESE', 'DIP'] }
      ]
    },
    {
      id: 'feelings', name: 'Actions & Feelings', emoji: '😅', accent: '#9d6bff',
      items: [
        { phrase: 'SNEEZING', taboo: ['NOSE', 'COLD', 'ACHOO'] },
        { phrase: 'YAWNING', taboo: ['TIRED', 'MOUTH', 'SLEEPY'] },
        { phrase: 'HICCUPS', taboo: ['BREATH', 'STOMACH', 'SURPRISE'] },
        { phrase: 'STAGE FRIGHT', taboo: ['NERVOUS', 'CROWD', 'PERFORM'] },
        { phrase: "WRITER'S BLOCK", taboo: ['IDEAS', 'STUCK', 'WRITE'] },
        { phrase: 'DEJA VU', taboo: ['FEELING', 'BEFORE', 'MEMORY'] },
        { phrase: 'PROCRASTINATION', taboo: ['LATER', 'DELAY', 'LAZY'] },
        { phrase: 'EMBARRASSMENT', taboo: ['BLUSH', 'RED', 'AWKWARD'] },
        { phrase: 'ROAD RAGE', taboo: ['ANGRY', 'DRIVING', 'HONK'] },
        { phrase: 'BRAIN FREEZE', taboo: ['COLD', 'HEADACHE', 'ICY'] },
        { phrase: 'GOOSEBUMPS', taboo: ['SKIN', 'COLD', 'SCARY'] },
        { phrase: 'JET LAG', taboo: ['TIRED', 'TRAVEL', 'TIMEZONE'] },
        { phrase: 'FOMO', taboo: ['MISSING', 'PARTY', 'SOCIAL'] },
        { phrase: 'SLEEPWALKING', taboo: ['NIGHT', 'BED', 'WALK'] },
        { phrase: 'BUTTERFLIES', taboo: ['NERVOUS', 'STOMACH', 'FEELING'] }
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

  /* Normalize free-typed guesses and the secret phrase the same way before
     comparing, so punctuation/case/extra spaces never cause a false miss. */
  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }

  /* Forbidden set for an item = its three taboo words plus every word in
     the phrase itself (so you can't just say part of the answer either). */
  function forbiddenWords(item) {
    var words = normalize(item.phrase).split(' ').concat(
      (item.taboo || []).map(function (w) { return normalize(w); })
    );
    var seen = {}, out = [];
    words.forEach(function (w) {
      if (w && !seen[w]) { seen[w] = true; out.push(w); }
    });
    return out;
  }

  /* Checks a clue against an item's forbidden words as whole words (so
     "cats" doesn't get flagged for banning "cat", but "cat" does). Returns
     the first forbidden word hit, or null if the clue is clean. */
  function checkClue(text, item) {
    var norm = normalize(text);
    if (!norm) return null;
    var tokens = norm.split(' ');
    var forbidden = forbiddenWords(item);
    for (var i = 0; i < forbidden.length; i++) {
      if (tokens.indexOf(forbidden[i]) >= 0) return forbidden[i];
    }
    return null;
  }

  global.MLT = global.MLT || {};
  global.MLT.TC_PACKS = PACKS;
  global.MLT.tcPackInfo = packInfo;
  global.MLT.tcNormalize = normalize;
  global.MLT.tcForbiddenWords = forbiddenWords;
  global.MLT.tcCheckClue = checkClue;
  if (!global.MLT.shuffle) global.MLT.shuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);

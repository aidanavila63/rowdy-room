/* "Tier List Live" — the room privately ranks a set of items into S/A/B/C
   tiers on their own phones, then builds one shared tier list together in
   real time (drag an item to claim it, drop it to place it), argues out
   whichever placement caused the most back-and-forth, and locks it in.
   Scoring compares each player's private ranking to where the group's
   board actually landed. */
(function (global) {
  var TIERS = ['S', 'A', 'B', 'C'];

  var PACKS = [
    {
      id: 'food', name: 'Food & Drinks', emoji: '🍕', accent: '#ffd23f',
      items: [
        'Pineapple on pizza', 'Ketchup on eggs', 'Cereal before the milk', 'Mayo on fries',
        'Pickles on burgers', 'Ranch on pizza', 'Ice in soda', 'Hot sauce on everything',
        'Well-done steak', 'Black licorice', 'Gas station sushi', 'Diet soda over regular',
        'Cold pizza for breakfast', 'Ketchup on hot dogs', 'Warm milk'
      ]
    },
    {
      id: 'pop', name: 'Pop Culture Tropes', emoji: '🎬', accent: '#9d6bff',
      items: [
        "The chosen one who didn't ask for it", 'A wise mentor who dies halfway through',
        'The twist villain was the friend all along', 'A love triangle nobody asked for',
        'The sassy best friend sidekick', 'A training montage set to music',
        'The team leader who gives inspiring speeches', "A time-travel plot that breaks its own rules",
        "The villain's redemption arc", 'A cliffhanger that never gets resolved',
        "The hero's secret royal bloodline", 'A found-family ending',
        'The prophecy that was misunderstood the whole time', 'A montage that skips the hard part',
        'The sequel that retcons the first movie'
      ]
    },
    {
      id: 'chaos', name: 'Everyday Chaos', emoji: '🌀', accent: '#ff2d95',
      items: [
        'Replying-all by accident', "Forgetting someone's name mid-introduction",
        'Walking into a glass door in public', 'Texting the wrong group chat',
        'Tripping on a flat surface', "Waving back at someone who wasn't waving at you",
        'Showing up in the same outfit as someone else', 'Getting caught talking to yourself',
        'Sending a text and immediately regretting it', 'Laughing at the wrong moment in a meeting',
        'Forgetting why you walked into a room', 'A food stain right before something important',
        'Realizing your mic was unmuted', 'Getting someone\'s name wrong twice in one chat',
        'Waving at someone who then just walked past you'
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

  global.MLT = global.MLT || {};
  global.MLT.TL_TIERS = TIERS;
  global.MLT.TL_PACKS = PACKS;
  global.MLT.tlPackInfo = packInfo;
  if (!global.MLT.shuffle) global.MLT.shuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);

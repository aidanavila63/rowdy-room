/* "Hill to Die On" — a spicy statement, a continuous agree<->disagree
   slider, and the two people who land furthest apart get 30 seconds to
   argue it out before the room re-votes. */
(function (global) {
  var PACKS = [
    {
      id: 'food', name: 'Food Takes', emoji: '🍽️', accent: '#ffd23f',
      items: [
        'Cereal is a soup',
        'A hot dog is a sandwich',
        'Pineapple belongs on pizza',
        'Well-done steak is a crime against the cow',
        'Ketchup belongs on scrambled eggs',
        'Cold pizza for breakfast beats hot pizza',
        'Fruit salad shouldn’t have grapes in it',
        'Ranch makes everything better'
      ]
    },
    {
      id: 'everyday', name: 'Everyday Takes', emoji: '🛋️', accent: '#22e6ff',
      items: [
        'It’s fine to wear socks with sandals',
        'The toilet paper roll should go over, not under',
        'Texting “k” is worse than not responding at all',
        'You should always take your shoes off inside someone else’s home',
        'Splitting the bill evenly is fairer than itemizing it',
        'Snoozing your alarm more than once is a personality flaw',
        'It’s rude to show up more than 10 minutes early',
        'A messy car says more about someone than a messy room'
      ]
    },
    {
      id: 'culture', name: 'Culture Takes', emoji: '🎬', accent: '#9d6bff',
      items: [
        'Sequels are usually better than the original',
        'Reading the book first ruins the movie',
        'Karaoke is more fun to watch than to do',
        'Autotune ruins a good singer’s voice',
        'A movie under 90 minutes is automatically better paced',
        'Remakes should never be judged against the original',
        'Cliffhanger endings are a cheap trick, not good writing',
        'Laugh tracks make sitcoms funnier'
      ]
    },
    {
      id: 'petty', name: 'Petty Takes', emoji: '😤', accent: '#ff2d95',
      items: [
        'Being “a little late” every time makes you the rude one',
        'Reply-all should require a warning label',
        'A one-star review with no explanation is worse than no review',
        'It’s okay to peek at your gift before you’re supposed to',
        'Whispering during a movie in a theater is still unforgivable',
        'Regifting is totally fine as long as they don’t find out',
        'Liking your own post is embarrassing',
        'It’s fine to just leave a group chat without saying bye'
      ]
    }
  ];

  function packInfo(id) {
    for (var i = 0; i < PACKS.length; i++) if (PACKS[i].id === id) return PACKS[i];
    return PACKS[0];
  }

  /* Fisher-Yates — this page doesn't load questions.js, so define it here too. */
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
  global.MLT.HTD_PACKS = PACKS;
  global.MLT.htdPackInfo = packInfo;
  if (!global.MLT.shuffle) global.MLT.shuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);

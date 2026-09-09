/* "Would You Rather: Escalation" — ladders of two-option prompts that get
   more extreme each round. Each ladder ("chain") is an ordered list of
   single options; a round pairs two adjacent items, and whichever one gets
   FEWER votes (the one the room was more reluctant about) survives to face
   the next item in the ladder — so the dare only ever gets bigger. */
(function (global) {
  var CHAINS = [
    {
      id: 'spice', name: 'Spice Ladder', emoji: '🌶️', accent: '#ff3b5c',
      items: [
        'put ketchup on it',
        'put sriracha on it',
        'put a whole jalapeño on it',
        'put a scoop of wasabi on it',
        'put a whole ghost pepper on it',
        'put a pinch of Carolina Reaper flakes on it',
        'put a drop of pure capsaicin extract on it'
      ]
    },
    {
      id: 'money', name: 'Money Ladder', emoji: '💸', accent: '#ffd23f',
      items: [
        'find $20 on the sidewalk',
        'get a surprise $500 refund',
        'win a free vacation with no expiration date',
        'get a $10,000 bonus at the job you already have',
        'win a car, fully paid off',
        'win five years of rent-free living',
        'win a million dollars, taxed at 90%'
      ]
    },
    {
      id: 'fear', name: 'Fear Ladder', emoji: '😱', accent: '#9d6bff',
      items: [
        'hold a spider for ten seconds',
        'ride the tallest rollercoaster in the world',
        'go skydiving',
        'swim in the open ocean at night',
        'spend a night alone in a supposedly haunted house',
        'bungee jump off a bridge',
        'free-solo a small cliff with a harness as backup'
      ]
    },
    {
      id: 'chore', name: 'Chore Ladder', emoji: '🧹', accent: '#3dff9e',
      items: [
        'do the dishes every night for a week',
        'clean out a stranger\'s garage',
        'deep clean a gas station bathroom',
        'mow a football field with scissors',
        'hand-wash every window in an office building',
        'shovel an entire parking lot alone',
        'clear out a hoarder\'s storage unit'
      ]
    },
    {
      id: 'stage', name: 'Public Ladder', emoji: '🎤', accent: '#22e6ff',
      items: [
        'sing happy birthday out loud in a quiet café',
        'give a toast at a stranger\'s wedding',
        'do five minutes of stand-up comedy',
        'give a TED-style talk with zero prep',
        'host a game show live on stage',
        'get roasted by a comedian in front of a crowd',
        'have your most embarrassing text read aloud on live TV'
      ]
    }
  ];

  function chainInfo(id) {
    for (var i = 0; i < CHAINS.length; i++) if (CHAINS[i].id === id) return CHAINS[i];
    return CHAINS[0];
  }

  /* Fisher-Yates shuffle — same generic helper questions.js exposes for
     Most Likely To's pack rotation. This page doesn't load questions.js,
     so define it here too (guarded, in case both ever load together). */
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
  global.MLT.WYR_CHAINS = CHAINS;
  global.MLT.wyrChainInfo = chainInfo;
  if (!global.MLT.shuffle) global.MLT.shuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);

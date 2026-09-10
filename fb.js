/* "Fibbers' Court" — the big screen shows a real fact with the answer
   blanked out. Every phone privately writes a fake answer, all the fakes
   plus the real one get shuffled together anonymously, and the room votes
   for whichever one they believe is true. Correct guessers score; each
   fake's author scores for every voter it fooled. */
(function (global) {
  var PACKS = [
    {
      id: 'animals', name: 'Animal Kingdom', emoji: '🦦', accent: '#3dff9e',
      items: [
        { prompt: 'A group of flamingos is called a ___', answer: 'flamboyance' },
        { prompt: 'A baby kangaroo is called a ___', answer: 'joey' },
        { prompt: 'The only mammal capable of true powered flight is the ___', answer: 'bat' },
        { prompt: 'A group of crows is called a ___', answer: 'murder' },
        { prompt: 'The fastest land animal is the ___', answer: 'cheetah' },
        { prompt: 'An octopus has ___ hearts', answer: 'three' },
        { prompt: 'The largest animal ever known to have existed is the ___', answer: 'blue whale' },
        { prompt: 'A group of lions is called a ___', answer: 'pride' },
        { prompt: 'A shrimp’s heart is located in its ___', answer: 'head' },
        { prompt: 'The tallest animal in the world is the ___', answer: 'giraffe' },
        { prompt: 'A group of owls is called a ___', answer: 'parliament' },
        { prompt: 'Butterflies taste with their ___', answer: 'feet' },
        { prompt: 'The only bird that can fly backwards is the ___', answer: 'hummingbird' },
        { prompt: 'A group of jellyfish is called a ___', answer: 'smack' },
        { prompt: 'Sharks existed before ___ did', answer: 'trees' }
      ]
    },
    {
      id: 'history', name: 'History & Firsts', emoji: '🏺', accent: '#ffd23f',
      items: [
        { prompt: 'The first country to give women the right to vote was ___', answer: 'New Zealand' },
        { prompt: 'The shortest war in recorded history lasted about ___ minutes', answer: '38' },
        { prompt: 'Sputnik, the first satellite in space, was launched by ___', answer: 'the Soviet Union' },
        { prompt: 'The Eiffel Tower was originally built for the 1889 ___', answer: "World's Fair" },
        { prompt: 'Napoleon Bonaparte was born on the island of ___', answer: 'Corsica' },
        { prompt: 'The first modern Olympic Games were held in ___', answer: 'Greece' },
        { prompt: 'The Titanic sank in the year ___', answer: '1912' },
        { prompt: 'The first email was sent in the year ___', answer: '1971' },
        { prompt: 'The oldest university still operating today is in ___', answer: 'Morocco' },
        { prompt: 'The Berlin Wall fell in the year ___', answer: '1989' },
        { prompt: 'The word "salary" comes from the Latin word for ___', answer: 'salt' },
        { prompt: 'The first country to print paper money was ___', answer: 'China' },
        { prompt: 'The Statue of Liberty was a gift from ___', answer: 'France' },
        { prompt: "The Wright brothers' first flight lasted about ___ seconds", answer: '12' },
        { prompt: 'The Great Wall of China was built primarily to keep out the ___', answer: 'Mongols' }
      ]
    },
    {
      id: 'words', name: 'Language & Words', emoji: '🔤', accent: '#9d6bff',
      items: [
        { prompt: 'The dot over a lowercase "i" or "j" is called a ___', answer: 'tittle' },
        { prompt: '"ZIP" in ZIP code stands for Zone Improvement ___', answer: 'Plan' },
        { prompt: 'The "#" symbol is officially called the ___', answer: 'octothorpe' },
        { prompt: 'The English word with the most dictionary definitions is ___', answer: 'set' },
        { prompt: 'The longest one-syllable word in English is ___', answer: 'screeched' },
        { prompt: "The only common English word ending in the letters 'mt' is ___", answer: 'dreamt' },
        { prompt: 'The most commonly used letter in English is ___', answer: 'E' },
        { prompt: 'A word that reads the same forwards and backwards is a ___', answer: 'palindrome' },
        { prompt: 'Dictionaries now favor "octopuses" over the older plural ___', answer: 'octopi' },
        { prompt: 'The early Germanic writing system before Latin letters is called ___', answer: 'runes' },
        { prompt: 'The only letter absent from every U.S. state name is ___', answer: 'Q' },
        { prompt: 'The word "nerd" first appeared in a 1950 book by ___', answer: 'Dr. Seuss' },
        { prompt: 'A hill in New Zealand holds the record for longest place name, at ___ letters', answer: '85' },
        { prompt: "The word 'robot' comes from a Czech word meaning ___", answer: 'forced labor' },
        { prompt: 'The symbol "&" is called an ___', answer: 'ampersand' }
      ]
    },
    {
      id: 'science', name: 'Science & Space', emoji: '🔬', accent: '#22e6ff',
      items: [
        { prompt: 'The closest star to Earth, other than the Sun, is ___', answer: 'Proxima Centauri' },
        { prompt: 'Honey never spoils because it naturally resists ___', answer: 'bacteria' },
        { prompt: 'A bolt of lightning is hotter than the surface of the ___', answer: 'Sun' },
        { prompt: 'Human babies are born with about ___ bones, more than adults', answer: '300' },
        { prompt: 'The planet with the most known moons is ___', answer: 'Saturn' },
        { prompt: 'Bananas are naturally slightly ___ due to potassium-40', answer: 'radioactive' },
        { prompt: 'A day on Venus is longer than its ___', answer: 'year' },
        { prompt: 'The only rock that floats on water is ___', answer: 'pumice' },
        { prompt: 'Light takes about ___ minutes to travel from the Sun to Earth', answer: '8' },
        { prompt: 'The human nose can distinguish over a trillion different ___', answer: 'scents' },
        { prompt: 'The chemical symbol for gold, Au, comes from the Latin word ___', answer: 'aurum' },
        { prompt: 'Water is one of the few substances that expands when it ___', answer: 'freezes' },
        { prompt: 'The Great Barrier Reef is so large it can be seen from ___', answer: 'space' },
        { prompt: "Pound for pound, the body's strongest muscle is the ___", answer: 'jaw' },
        { prompt: 'An octopus has three hearts and ___ arms', answer: 'eight' }
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

  /* Normalize a fake answer / the real answer the same way before comparing,
     so a fake that's just a re-typed version of the real answer (different
     case, punctuation or spacing) can be caught before it goes out. */
  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }

  global.MLT = global.MLT || {};
  global.MLT.FB_PACKS = PACKS;
  global.MLT.fbPackInfo = packInfo;
  global.MLT.fbNormalize = normalize;
  if (!global.MLT.shuffle) global.MLT.shuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);

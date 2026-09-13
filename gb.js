/* "Group Brain" — a numeric trivia question, everyone types their own guess
   from their phone. No buzzer, no single first-right winner: you're scored
   on how close you personally landed, and the room's average gets revealed
   alongside you — sometimes the crowd is smarter than any one guesser. */
(function (global) {
  var PACKS = [
    {
      id: 'body', name: 'Human Body', emoji: '🫀', accent: '#ff2d95',
      items: [
        { q: 'How many bones are in the adult human body?', answer: 206, unit: 'bones' },
        { q: 'How many bones are in a human hand (including the wrist)?', answer: 27, unit: 'bones' },
        { q: 'How many teeth does a full set of adult human teeth have?', answer: 32, unit: 'teeth' },
        { q: 'About how many taste buds does the average human tongue have?', answer: 10000, unit: 'taste buds' },
        { q: 'How many chromosomes does a normal human cell have?', answer: 46, unit: 'chromosomes' },
        { q: 'About how many muscles are in the human body?', answer: 640, unit: 'muscles' },
        { q: "What is average adult human body temperature, in Fahrenheit?", answer: 98.6, unit: '°F' },
        { q: 'How many chambers does the human heart have?', answer: 4, unit: 'chambers' },
        { q: 'How many vertebrae are in the human spine?', answer: 33, unit: 'vertebrae' },
        { q: "About how many times per minute does a resting adult's heart beat?", answer: 70, unit: 'beats/min' },
        { q: 'How many ribs does an adult human have in total?', answer: 24, unit: 'ribs' },
        { q: 'About how many bones is a human baby born with?', answer: 300, unit: 'bones' },
        { q: 'About how many feet long is the human small intestine?', answer: 20, unit: 'feet' },
        { q: "About what percentage of the adult human body is water?", answer: 60, unit: '%' },
        { q: 'How many lobes do your two lungs have in total?', answer: 5, unit: 'lobes' }
      ]
    },
    {
      id: 'geo', name: 'Geography & Nature', emoji: '🌍', accent: '#22e6ff',
      items: [
        { q: 'How many continents are there?', answer: 7, unit: 'continents' },
        { q: 'How many oceans does Earth have?', answer: 5, unit: 'oceans' },
        { q: 'How many planets are in our solar system?', answer: 8, unit: 'planets' },
        { q: 'How many U.S. states are there?', answer: 50, unit: 'states' },
        { q: 'About how many countries are UN member states?', answer: 193, unit: 'countries' },
        { q: 'How tall is Mount Everest, in meters?', answer: 8849, unit: 'meters' },
        { q: 'About how long is the Nile River, in kilometers?', answer: 6650, unit: 'km' },
        { q: 'How many moons does Earth have?', answer: 1, unit: 'moons' },
        { q: "About what percentage of Earth's surface is covered by water?", answer: 71, unit: '%' },
        { q: 'About how old is the Earth, in billions of years?', answer: 4.5, unit: 'billion years' },
        { q: 'About how fast does sound travel at sea level, in meters per second?', answer: 343, unit: 'm/s' },
        { q: 'How many standard time zones are commonly recognized worldwide?', answer: 24, unit: 'time zones' },
        { q: 'About how deep is the Mariana Trench at its deepest point, in meters?', answer: 10935, unit: 'meters' },
        { q: 'How many bones does a giraffe have in its neck?', answer: 7, unit: 'bones' },
        { q: 'How many legs does a lobster have?', answer: 10, unit: 'legs' }
      ]
    },
    {
      id: 'history', name: 'History & Time', emoji: '🕰️', accent: '#ffd23f',
      items: [
        { q: "About how many years did the Hundred Years' War actually last?", answer: 116, unit: 'years' },
        { q: 'In what year was the Declaration of Independence signed?', answer: 1776, unit: '' },
        { q: 'How many years did World War I last?', answer: 4, unit: 'years' },
        { q: 'In what year did the Titanic sink?', answer: 1912, unit: '' },
        { q: 'A leap year happens roughly every how many years?', answer: 4, unit: 'years' },
        { q: 'How many days are in a non-leap year?', answer: 365, unit: 'days' },
        { q: 'How many hours are in a week?', answer: 168, unit: 'hours' },
        { q: 'How many minutes are in a day?', answer: 1440, unit: 'minutes' },
        { q: 'In what year was the first iPhone released?', answer: 2007, unit: '' },
        { q: 'How many years did the Berlin Wall stand, from 1961 to 1989?', answer: 28, unit: 'years' },
        { q: 'In what year did Neil Armstrong first walk on the Moon?', answer: 1969, unit: '' },
        { q: 'How many rings are on the Olympic flag?', answer: 5, unit: 'rings' },
        { q: 'The Summer Olympics are normally held every how many years?', answer: 4, unit: 'years' },
        { q: 'In what year did World War II end?', answer: 1945, unit: '' },
        { q: "How many amendments make up the U.S. Bill of Rights?", answer: 10, unit: 'amendments' }
      ]
    },
    {
      id: 'everyday', name: 'Everyday & Records', emoji: '🎲', accent: '#3dff9e',
      items: [
        { q: 'How many keys are on a standard piano?', answer: 88, unit: 'keys' },
        { q: 'How many total dots (pips) are on one six-sided die?', answer: 21, unit: 'pips' },
        { q: 'How many squares are on a chessboard?', answer: 64, unit: 'squares' },
        { q: 'How many cards are in a standard deck, excluding jokers?', answer: 52, unit: 'cards' },
        { q: 'How many strings does a standard violin have?', answer: 4, unit: 'strings' },
        { q: 'How many players from each team are on a soccer field at once?', answer: 11, unit: 'players' },
        { q: 'How many holes are in a standard round of golf?', answer: 18, unit: 'holes' },
        { q: 'How many Grand Slam tennis tournaments are there each year?', answer: 4, unit: 'tournaments' },
        { q: 'How many colors are traditionally counted in a rainbow?', answer: 7, unit: 'colors' },
        { q: 'How many Wonders of the Ancient World are on the classic list?', answer: 7, unit: 'wonders' },
        { q: 'How many days does February have in a leap year?', answer: 29, unit: 'days' },
        { q: 'How many letters are in the English alphabet?', answer: 26, unit: 'letters' },
        { q: 'How many stripes are on the American flag?', answer: 13, unit: 'stripes' },
        { q: 'How many stars are on the American flag?', answer: 50, unit: 'stars' },
        { q: 'How many minutes long is a regulation NBA game, excluding overtime?', answer: 48, unit: 'minutes' }
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

  /* Shared score formula: 100 at a perfect guess, decaying to 0 once the
     guess is off by 100% of the true value or more. Used identically by
     the host (to award points) and the player (to explain the reveal). */
  function scoreGuess(guess, answer) {
    var g = Number(guess), a = Number(answer);
    if (!isFinite(g)) return 0;
    var rel = Math.abs(g - a) / Math.max(Math.abs(a), 1e-9);
    return Math.max(0, Math.round(100 * (1 - rel)));
  }

  global.MLT = global.MLT || {};
  global.MLT.GB_PACKS = PACKS;
  global.MLT.gbPackInfo = packInfo;
  global.MLT.gbScore = scoreGuess;
  if (!global.MLT.shuffle) global.MLT.shuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);

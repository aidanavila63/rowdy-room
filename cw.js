/* "Confidently Wrong" — real trivia questions, but every answer comes with a
   wager. Guess right and your wager pays off; guess wrong and it costs you
   just as much — so betting the house on a shaky hunch is the whole joke. */
(function (global) {
  var PACKS = [
    {
      id: 'general', name: 'General Knowledge', emoji: '🧠', accent: '#22e6ff',
      items: [
        { q: 'What is the largest planet in our solar system?', options: ['Earth', 'Jupiter', 'Saturn', 'Neptune'], correct: 1 },
        { q: 'How many continents are there?', options: ['5', '6', '7', '8'], correct: 2 },
        { q: "What is the chemical symbol for gold?", options: ['Ag', 'Au', 'Gd', 'Go'], correct: 1 },
        { q: 'What is the smallest prime number?', options: ['0', '1', '2', '3'], correct: 2 },
        { q: 'Which language has the most native speakers worldwide?', options: ['English', 'Hindi', 'Mandarin Chinese', 'Spanish'], correct: 2 },
        { q: 'How many strings does a standard guitar have?', options: ['4', '5', '6', '7'], correct: 2 },
        { q: "What is the freezing point of water in Fahrenheit?", options: ['0°F', '32°F', '100°F', '212°F'], correct: 1 },
        { q: 'Which organ in the human body produces insulin?', options: ['Liver', 'Kidney', 'Pancreas', 'Spleen'], correct: 2 },
        { q: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], correct: 1 },
        { q: 'What is the tallest mountain in the world above sea level?', options: ['K2', 'Kilimanjaro', 'Mount Everest', 'Denali'], correct: 2 },
        { q: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Mercury', 'Jupiter'], correct: 1 },
        { q: 'What is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3 },
        { q: 'How many bones are in the adult human body?', options: ['186', '206', '226', '246'], correct: 1 },
        { q: 'What is the currency of Japan?', options: ['Yuan', 'Won', 'Yen', 'Ringgit'], correct: 2 },
        { q: 'Which gas do plants primarily absorb from the air for photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], correct: 2 }
      ]
    },
    {
      id: 'pop', name: 'Pop Culture', emoji: '🎬', accent: '#ff2d95',
      items: [
        { q: 'Which band released the album "Abbey Road"?', options: ['The Rolling Stones', 'The Beatles', 'Led Zeppelin', 'Pink Floyd'], correct: 1 },
        { q: 'Who directed the movie "Jaws"?', options: ['George Lucas', 'Steven Spielberg', 'Martin Scorsese', 'Francis Ford Coppola'], correct: 1 },
        { q: "In the 1939 film, what color are Dorothy's iconic shoes?", options: ['Silver', 'Red', 'Gold', 'Green'], correct: 1 },
        { q: 'Which streaming service produced "Stranger Things"?', options: ['Hulu', 'Amazon Prime', 'Netflix', 'Disney+'], correct: 2 },
        { q: 'Who played Iron Man in the Marvel Cinematic Universe?', options: ['Chris Evans', 'Chris Hemsworth', 'Robert Downey Jr.', 'Mark Ruffalo'], correct: 2 },
        { q: 'Which artist released the song "Bad Guy"?', options: ['Ariana Grande', 'Billie Eilish', 'Dua Lipa', 'Olivia Rodrigo'], correct: 1 },
        { q: 'What is the name of the coffee shop in the sitcom "Friends"?', options: ['Central Perk', 'The Grind', "Java Joe's", 'Common Grounds'], correct: 0 },
        { q: 'Which video game franchise features a character named Master Chief?', options: ['God of War', 'Halo', 'Gears of War', 'Call of Duty'], correct: 1 },
        { q: 'Who wrote the "Harry Potter" book series?', options: ['J.R.R. Tolkien', 'J.K. Rowling', 'Suzanne Collins', 'Rick Riordan'], correct: 1 },
        { q: 'Which sitcom is set in the fictional city of Springfield?', options: ['Family Guy', 'South Park', 'The Simpsons', 'King of the Hill'], correct: 2 },
        { q: "What was Beyoncé's musical group before going solo?", options: ['TLC', 'En Vogue', "Destiny's Child", 'Spice Girls'], correct: 2 },
        { q: 'Which actor plays the title character in "Deadpool"?', options: ['Hugh Jackman', 'Ryan Reynolds', 'Ryan Gosling', 'Chris Pratt'], correct: 1 },
        { q: 'Which company originally produced the Star Wars franchise?', options: ['Marvel Studios', 'Lucasfilm', 'Walt Disney Pictures', 'Warner Bros.'], correct: 1 },
        { q: 'Which fictional wizarding school does Harry Potter attend?', options: ['Beauxbatons', 'Durmstrang', 'Ilvermorny', 'Hogwarts'], correct: 3 },
        { q: 'Who is known as the "King of Pop"?', options: ['Elvis Presley', 'Michael Jackson', 'Prince', 'James Brown'], correct: 1 }
      ]
    },
    {
      id: 'science', name: 'Science & Nature', emoji: '🔬', accent: '#3dff9e',
      items: [
        { q: 'What is the chemical formula for water?', options: ['CO2', 'H2O', 'O2', 'NaCl'], correct: 1 },
        { q: 'How many legs does a spider have?', options: ['6', '8', '10', '12'], correct: 1 },
        { q: 'What is the powerhouse of the cell?', options: ['Nucleus', 'Ribosome', 'Mitochondria', 'Golgi apparatus'], correct: 2 },
        { q: 'Which planet is known for its prominent ring system?', options: ['Mars', 'Saturn', 'Mercury', 'Venus'], correct: 1 },
        { q: 'What is the hardest natural substance on Earth?', options: ['Gold', 'Iron', 'Diamond', 'Quartz'], correct: 2 },
        { q: 'How many chambers does the human heart have?', options: ['2', '3', '4', '5'], correct: 2 },
        { q: 'What gas do humans exhale that plants use for photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], correct: 2 },
        { q: 'What is the largest mammal in the world?', options: ['African elephant', 'Blue whale', 'Giraffe', 'Polar bear'], correct: 1 },
        { q: 'Which blood type is known as the "universal donor"?', options: ['A', 'B', 'AB', 'O negative'], correct: 3 },
        { q: 'The speed of light is approximately how many km per second?', options: ['30,000', '300,000', '3,000,000', '300'], correct: 1 },
        { q: "A shark's skeleton is made mostly of what material?", options: ['Bone', 'Cartilage', 'Keratin', 'Chitin'], correct: 1 },
        { q: "What is the most abundant gas in Earth's atmosphere?", options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Argon'], correct: 2 },
        { q: 'Which part of a plant primarily carries out photosynthesis?', options: ['Roots', 'Stem', 'Leaves', 'Flowers'], correct: 2 },
        { q: 'What is the boiling point of water at sea level, in Celsius?', options: ['90°C', '100°C', '110°C', '212°C'], correct: 1 },
        { q: 'Which animal is nicknamed the "King of the Jungle"?', options: ['Tiger', 'Lion', 'Elephant', 'Gorilla'], correct: 1 }
      ]
    },
    {
      id: 'history', name: 'History & Geography', emoji: '🗺️', accent: '#ffd23f',
      items: [
        { q: "Which country has the world's largest population today?", options: ['China', 'United States', 'India', 'Indonesia'], correct: 2 },
        { q: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], correct: 2 },
        { q: 'Which ancient civilization built the pyramids of Giza?', options: ['Romans', 'Egyptians', 'Greeks', 'Mayans'], correct: 1 },
        { q: 'In what year did World War II end?', options: ['1943', '1944', '1945', '1946'], correct: 2 },
        { q: 'Which river is traditionally cited as the longest in the world?', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], correct: 1 },
        { q: 'What is the smallest country in the world by area?', options: ['Monaco', 'San Marino', 'Vatican City', 'Liechtenstein'], correct: 2 },
        { q: 'Which U.S. president appears on the one-dollar bill?', options: ['Abraham Lincoln', 'George Washington', 'Thomas Jefferson', 'Benjamin Franklin'], correct: 1 },
        { q: 'The Great Wall is located in which country?', options: ['Japan', 'China', 'South Korea', 'Mongolia'], correct: 1 },
        { q: 'Which continent is the Sahara Desert located on?', options: ['Asia', 'Africa', 'Australia', 'South America'], correct: 1 },
        { q: 'What year did the Titanic sink?', options: ['1905', '1912', '1918', '1923'], correct: 1 },
        { q: 'Which country gifted the Statue of Liberty to the United States?', options: ['England', 'Spain', 'France', 'Italy'], correct: 2 },
        { q: 'What is the capital city of Canada?', options: ['Toronto', 'Vancouver', 'Montreal', 'Ottawa'], correct: 3 },
        { q: 'Which empire was ruled by Julius Caesar?', options: ['Greek Empire', 'Roman Empire', 'Ottoman Empire', 'Persian Empire'], correct: 1 },
        { q: 'The Berlin Wall fell in which year?', options: ['1987', '1989', '1991', '1993'], correct: 1 },
        { q: 'Which mountain range is traditionally cited as the boundary between Europe and Asia?', options: ['Alps', 'Andes', 'Ural Mountains', 'Himalayas'], correct: 2 }
      ]
    }
  ];

  var WAGERS = [
    { n: 1, label: 'Cautious', sub: '×1' },
    { n: 2, label: 'Confident', sub: '×2' },
    { n: 3, label: 'Certain', sub: '×3' }
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
  global.MLT.CW_PACKS = PACKS;
  global.MLT.CW_WAGERS = WAGERS;
  global.MLT.cwPackInfo = packInfo;
  if (!global.MLT.shuffle) global.MLT.shuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);

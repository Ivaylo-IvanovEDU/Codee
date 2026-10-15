const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// ============================================================
// CORS – разрешава достъп от GitHub Pages и локално
// ============================================================
const ALLOWED_ORIGINS = [
  'https://ТВОЕТО-ИМЕ.github.io',  // ← смени с твоето (по избор)
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST']
  }
});

// Сервиране на статични файлове
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('CodeWeek Escape Room сървър работи ✅');
});

// ============================================================
// ВЪПРОСИ – 10 въпроса × 10 точки
// ============================================================
const QUIZ = [
  {
    q: 'Какво представлява проектирането на уеб сайт?',
    a: [
      'Процес на инсталиране на операционна система.',
      'Процес на определяне на външния вид, структурата и организацията на уеб сайта.',
      'Процес на създаване само на изображения.',
      'Процес на настройване единствено на интернет връзката.'
    ],
    correct: 1  // B
  },
  {
    q: 'Какво представлява Wireframe?',
    a: [
      'Готов програмен код на уеб сайта.',
      'Инструмент за проверка на интернет връзката.',
      'Структурен план, показващ разположението на елементите в уеб страницата.',
      'Графичен редактор за обработка на снимки.'
    ],
    correct: 2  // C
  },
  {
    q: 'Кой вид структура организира уеб страниците в нива, подобно на пирамида?',
    a: [
      'Линейна структура.',
      'Мрежова структура.',
      'Хибридна структура.',
      'Йерархична структура.'
    ],
    correct: 3  // D
  },
  {
    q: 'Коя е основната цел на достъпността на уеб страниците?',
    a: [
      'Да направи сайта достъпен и използваем за различни потребители, включително хора с увреждания.',
      'Да увеличи броя на изображенията в сайта.',
      'Да ограничи навигацията в уеб страницата.',
      'Да премахне всички текстове от сайта.'
    ],
    correct: 0  // A
  },
  {
    q: 'Коя уеб технология се използва за описание и структуриране на съдържанието на уеб страницата?',
    a: [
      'CSS.',
      'JavaScript.',
      'HTML.',
      'SQL.'
    ],
    correct: 2  // C
  },
  {
    q: 'Каква е основната функция на CSS?',
    a: [
      'Създава бази данни.',
      'Оформя визуалния дизайн на уеб страниците.',
      'Управлява хардуерните компоненти на компютъра.',
      'Съхранява файловете на уеб сайта.'
    ],
    correct: 1  // B
  },
  {
    q: 'Каква е ролята на JavaScript в уеб програмирането?',
    a: [
      'Определя единствено структурата на HTML документа.',
      'Използва се само за създаване на изображения.',
      'Заменя необходимостта от уеб браузър.',
      'Добавя интерактивност и позволява динамична промяна на съдържанието.'
    ],
    correct: 3  // D
  },
  {
    q: 'Кой HTML таг се използва за създаване на абзац?',
    a: [
      'Тагът H1',
      'Тагът P',
      'Тагът IMG',
      'Тагът TITLE'
    ],
    correct: 1  // B
  },
  {
    q: 'Каква е разликата между атрибутите id и class?',
    a: [
      'id се използва само за изображения, а class – само за текст.',
      'Двата атрибута имат напълно еднакво предназначение.',
      'id идентифицира уникален елемент, а class може да се използва за групиране на няколко елемента.',
      'class задължително се поставя в затварящия таг.'
    ],
    correct: 2  // C
  },
  {
    q: 'Какво съдържа елементът <body> в HTML документа?',
    a: [
      'Само информация за автора на страницата.',
      'Само настройките за кодировка.',
      'Единствено заглавието, което се показва в раздела на браузъра.',
      'Видимото съдържание на уеб страницата – текстове, изображения, връзки и други елементи.'
    ],
    correct: 3  // D
  }
];

const POINTS_PER_CORRECT = 10;   // точки за верен отговор
const TIME_PER_QUESTION = 20;    // секунди за въпрос
const DELAY_BETWEEN = 2;         // секунди между въпросите

// ============================================================
// СЪСТОЯНИЕ
// ============================================================
let players = {};               // { socketId: { name, score, correctCount } }
let currentQuestion = -1;
let timerInterval = null;
let timeLeft = 0;
let answersThisRound = {};      // { socketId: { answerIndex, timeLeft } }
let answerLog = [];             // [{ playerName, questionIndex, correct, timeLeft }]
let gameRunning = false;

// ============================================================
// ПОМОЩНИ
// ============================================================
function getSortedPlayers() {
  return Object.values(players)
    .map(p => ({ name: p.name, score: p.score, correctCount: p.correctCount }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function broadcastPlayers() {
  io.emit('players-update', Object.values(players).map(p => ({
    name: p.name, score: p.score, correctCount: p.correctCount
  })));
}

function clearTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ============================================================
// SOCKET.IO
// ============================================================
io.on('connection', (socket) => {
  console.log('🔌 Свързан:', socket.id);

  // ---------- РЕГИСТРАЦИЯ ----------
  socket.on('register', (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      socket.emit('error-msg', 'Въведи име!');
      return;
    }
    const nameTaken = Object.values(players).some(
      p => p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (nameTaken) {
      socket.emit('error-msg', 'Това име вече е заето!');
      return;
    }

    players[socket.id] = { name: trimmed, score: 0, correctCount: 0 };
    socket.emit('registered', trimmed);
    broadcastPlayers();
    console.log('👤 Регистриран:', trimmed);
  });

  // ---------- ОПИС НА ВЪПРОСИТЕ (за учителя) ----------
  socket.on('request-quiz-outline', () => {
    const outline = QUIZ.map(q => ({ q: q.q, a: q.a }));
    socket.emit('quiz-outline', {
      questions: outline,
      currentQuestion: currentQuestion
    });
  });

  // ---------- СТАРТ ----------
  socket.on('start-game', () => {
    if (Object.keys(players).length === 0) {
      socket.emit('error-msg', 'Няма регистрирани играчи!');
      return;
    }
    if (gameRunning) {
      socket.emit('error-msg', 'Играта вече е стартирана!');
      return;
    }
    gameRunning = true;
    currentQuestion = -1;
    answerLog = [];
    Object.values(players).forEach(p => { p.score = 0; p.correctCount = 0; });
    broadcastPlayers();
    io.emit('game-started');
    nextQuestion();
  });

  // ---------- СЛЕДВАЩ ВЪПРОС ----------
  function nextQuestion() {
    currentQuestion++;
    if (currentQuestion >= QUIZ.length) {
      endGame();
      return;
    }

    answersThisRound = {};
    const q = QUIZ[currentQuestion];
    io.emit('question', {
      index: currentQuestion,
      total: QUIZ.length,
      text: q.q,
      answers: q.a,
      timeLimit: TIME_PER_QUESTION
    });

    timeLeft = TIME_PER_QUESTION;
    clearTimer();
    timerInterval = setInterval(() => {
      timeLeft--;
      io.emit('timer', timeLeft);

      if (timeLeft <= 0) {
        clearTimer();
        // Покажи верния отговор
        io.emit('answer-feedback', {
          correct: false,
          correctIndex: q.correct,
          timeout: true
        });
        io.emit('between-questions');
        setTimeout(() => { if (gameRunning) nextQuestion(); }, DELAY_BETWEEN * 1000);
      }
    }, 1000);
  }

  // ---------- ОТГОВОР ----------
  socket.on('answer', ({ questionIndex, answerIndex, timeLeft: tl }) => {
    const player = players[socket.id];
    if (!player) return;
    if (questionIndex !== currentQuestion) return;
    if (answersThisRound[socket.id]) return; // вече е отговарял

    answersThisRound[socket.id] = { answerIndex, timeLeft: tl };

    const q = QUIZ[currentQuestion];
    const correct = answerIndex === q.correct;

    if (correct) {
      // Верен отговор = точно 10 точки
      player.score += POINTS_PER_CORRECT;
      player.correctCount++;
    }

    answerLog.push({
      playerName: player.name,
      questionIndex: currentQuestion + 1,
      correct,
      timeLeft: tl
    });

    socket.emit('answer-feedback', { correct, correctIndex: q.correct });
    broadcastPlayers();
    io.emit('log-update', answerLog);

    // Ако всички са отговорили → следващ
    if (Object.keys(answersThisRound).length === Object.keys(players).length) {
      clearTimer();
      io.emit('between-questions');
      setTimeout(() => { if (gameRunning) nextQuestion(); }, DELAY_BETWEEN * 1000);
    }
  });

  // ---------- ПРОПУСКАНЕ ----------
  socket.on('skip-question', () => {
    if (!gameRunning) return;
    clearTimer();
    const q = QUIZ[currentQuestion];
    io.emit('answer-feedback', { correct: false, correctIndex: q.correct, skipped: true });
    io.emit('between-questions');
    setTimeout(() => { if (gameRunning) nextQuestion(); }, DELAY_BETWEEN * 1000);
  });

  // ---------- КРАЙ ----------
  function endGame() {
    gameRunning = false;
    clearTimer();
    io.emit('game-over', getSortedPlayers());
    console.log('🏁 Играта приключи');
  }

  // ---------- НУЛИРАНЕ ----------
  socket.on('reset-game', () => {
    clearTimer();
    players = {};
    currentQuestion = -1;
    answersThisRound = {};
    answerLog = [];
    gameRunning = false;
    io.emit('game-reset');
    broadcastPlayers();
    io.emit('log-update', []);
    console.log('🔄 Нулирано');
  });

  // ---------- ИЗКЛЮЧВАНЕ ----------
  socket.on('disconnect', () => {
    if (players[socket.id]) {
      console.log('❌ Изключен:', players[socket.id].name);
      delete players[socket.id];
      broadcastPlayers();
    }
  });
});

// ============================================================
// СТАРТИРАНЕ
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сървър работи на порт ${PORT}`);
});

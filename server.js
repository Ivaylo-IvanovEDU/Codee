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
  'https://ТВОЕТО-ИМЕ.github.io',  // ← смени с твоето
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

// Сервиране на статични файлове (по избор – ако искаш да хостваш и HTML от Render)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('CodeWeek Escape Room сървър работи ✅');
});

// ============================================================
// ВЪПРОСИ – редактирай тук
// ============================================================
const QUIZ = [
  {
    q: 'Кой HTML таг се използва за най-голямо заглавие?',
    a: ['<h1>', '<h6>', '<title>', '<header>'],
    correct: 0
  },
  {
    q: 'Кой CSS property управлява цвета на текста?',
    a: ['background-color', 'color', 'font-color', 'text-style'],
    correct: 1
  },
  {
    q: 'Кой JavaScript оператор проверява строго равенство?',
    a: ['==', '===', '=', '!='],
    correct: 1
  },
  {
    q: 'Кой HTML атрибут задава адрес на връзка?',
    a: ['src', 'link', 'href', 'url'],
    correct: 2
  },
  {
    q: 'Кой CSS display стойност прави елемента блок-контейнер с flexbox?',
    a: ['block', 'flex', 'inline', 'grid'],
    correct: 1
  },
  // ... добави още въпроси до 10
];

const TIME_PER_QUESTION = 20;   // секунди
const DELAY_BETWEEN = 2;        // секунди между въпросите

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
      // Точки: 1 + бонус за бързина (до +1)
      const bonus = Math.max(0, (tl / TIME_PER_QUESTION));
      const points = Math.round((1 + bonus) * 10) / 10;
      player.score = Math.round((player.score + points) * 10) / 10;
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

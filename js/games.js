/* ================================================================
   games.js  — Sistema giochi interattivi con punteggio automatico
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { showToast, escHtml } from './utils.js';
import { findUser } from './users.js';
import { broadcastAll } from './broadcast.js';
import { getAvailableRooms } from './rooms.js';

/* ── Stato giochi ────────────────────────────────────────────── */
let activeGame = null;
let gameTimer = null;
let gameData = {
  song: {
    currentSong: null,
    hints: [],
    answers: new Map(), // userId -> { answer, timestamp }
    correctAnswer: null,
    timeLimit: 30000, // 30 secondi
  },
  truthLie: {
    host: null,
    statements: [],
    votes: new Map(), // userId -> statementIndex
    timeLimit: 60000, // 60 secondi
  },
  quiz: {
    currentQuestion: null,
    questionIndex: 0,
    answers: new Map(), // userId -> { answer, timestamp }
    timeLimit: 15000, // 15 secondi
    questions: [
      { q: "Qual è la capitale dell'Italia?", a: "Roma", options: ["Roma", "Milano", "Napoli", "Torino"] },
      { q: "Quanto fa 2+2?", a: "4", options: ["3", "4", "5", "6"] },
      { q: "Qual è il pianeta più vicino al Sole?", a: "Mercurio", options: ["Venere", "Mercurio", "Terra", "Marte"] },
      { q: "In che anno è caduto il muro di Berlino?", a: "1989", options: ["1987", "1988", "1989", "1990"] },
      { q: "Chi ha scritto 'La Divina Commedia'?", a: "Dante Alighieri", options: ["Dante Alighieri", "Petrarca", "Boccaccio", "Machiavelli"] },
      { q: "Qual è l'oceano più grande?", a: "Pacifico", options: ["Atlantico", "Pacifico", "Indiano", "Artico"] },
      { q: "Quanti continenti ci sono?", a: "7", options: ["5", "6", "7", "8"] },
      { q: "Qual è il simbolo chimico dell'oro?", a: "Au", options: ["Go", "Au", "Or", "Gd"] },
      { q: "Chi ha dipinto la 'Gioconda'?", a: "Leonardo da Vinci", options: ["Michelangelo", "Leonardo da Vinci", "Raffaello", "Caravaggio"] },
      { q: "Qual è la montagna più alta del mondo?", a: "Everest", options: ["K2", "Everest", "Kilimangiaro", "Monte Bianco"] },
    ],
  },
};

/* ── Inizializza sistema giochi ───────────────────────────────── */
export function initGames() {
  if (!dom.gamesPanel) return;
  renderGamesPanel();
  checkActiveGame();
  
  /* Show/hide games panel based on room type */
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const isGamesRoom = roomData?.is_games_room === true;
  
  if (dom.gamesPanel) {
    dom.gamesPanel.hidden = !isGamesRoom;
  }
  
  /* Close button handler */
  if (dom.closeGamesPanelBtn) {
    dom.closeGamesPanelBtn.addEventListener('click', () => {
      if (dom.gamesPanel) dom.gamesPanel.hidden = true;
    });
  }
}

/* ── Controlla se c'è un gioco attivo nella stanza ───────────── */
export async function checkActiveGame() {
  if (!state.supa || !state.activeRoom) return;
  
  try {
    const { data, error } = await state.supa
      .from('active_games')
      .select('*')
      .eq('room_id', state.activeRoom)
      .eq('is_active', true)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (error) throw error;
    if (data) {
      activeGame = data;
      gameData[data.game_type] = { ...gameData[data.game_type], ...data.game_state };
      startGameUI(data.game_type, data.game_state);
    }
  } catch (err) {
    console.error('[Games] Error checking active game:', err);
  }
}

/* ── Gestione comandi /game ──────────────────────────────────── */
export function handleGameCommand(message) {
  const parts = message.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  
  if (cmd !== '/game') return false;
  
  const subCmd = parts[1]?.toLowerCase();
  const args = parts.slice(2);
  
  /* Verifica se siamo in una stanza Giochi */
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const isGamesRoom = roomData?.is_games_room === true;
  
  if (!isGamesRoom) {
    showToast('🎮 I giochi sono disponibili solo nella stanza Giochi!');
    return true;
  }
  
  if (!subCmd) {
    showGameHelp();
    return true;
  }
  
  switch (subCmd) {
    case 'start':
      handleStartGame(args);
      break;
    case 'song':
      startSongGame();
      break;
    case 'truth':
      startTruthLieGame();
      break;
    case 'quiz':
      startQuizGame();
      break;
    case 'guess':
      handleGuess(args.join(' '));
      break;
    case 'vote':
      handleVote(args[0]);
      break;
    case 'answer':
      handleAnswer(args.join(' '));
      break;
    case 'stop':
      stopGame();
      break;
    case 'scores':
      showScores();
      break;
    default:
      showGameHelp();
  }
  
  return true;
}

/* ── Mostra help giochi ───────────────────────────────────────── */
function showGameHelp() {
  const help = `
🎮 <strong>Comandi Giochi:</strong><br>
• <code>/game song</code> - Inizia "Indovina la canzone"<br>
• <code>/game truth</code> - Inizia "Due verità e una bugia"<br>
• <code>/game quiz</code> - Inizia "Quiz a tempo"<br>
• <code>/game guess [risposta]</code> - Indovina (per canzone)<br>
• <code>/game vote [1/2/3]</code> - Vota quale è la bugia<br>
• <code>/game answer [risposta]</code> - Rispondi al quiz<br>
• <code>/game stop</code> - Termina il gioco corrente<br>
• <code>/game scores</code> - Mostra classifica
  `;
  showToast(help, 5000);
}

/* ── Avvia gioco: Indovina la canzone ────────────────────────── */
async function startSongGame() {
  if (activeGame) {
    showToast('⚠️ C\'è già un gioco in corso! Usa /game stop per terminarlo.');
    return;
  }
  
  const songs = [
    { title: "Bohemian Rhapsody", hints: ["🎸", "👑", "1975"], artist: "Queen" },
    { title: "Billie Jean", hints: ["👟", "🌙", "1982"], artist: "Michael Jackson" },
    { title: "Hotel California", hints: ["🏨", "🌵", "1976"], artist: "Eagles" },
    { title: "Stairway to Heaven", hints: ["🪜", "☁️", "1971"], artist: "Led Zeppelin" },
    { title: "Imagine", hints: ["🌍", "✌️", "1971"], artist: "John Lennon" },
    { title: "Like a Rolling Stone", hints: ["🎲", "1965"], artist: "Bob Dylan" },
    { title: "Smells Like Teen Spirit", hints: ["👕", "1991"], artist: "Nirvana" },
    { title: "Sweet Child O' Mine", hints: ["🌹", "1987"], artist: "Guns N' Roses" },
    { title: "Wonderwall", hints: ["🧱", "1995"], artist: "Oasis" },
    { title: "Don't Stop Believin'", hints: ["🚂", "1981"], artist: "Journey" },
  ];
  
  const randomSong = songs[Math.floor(Math.random() * songs.length)];
  gameData.song.currentSong = randomSong;
  gameData.song.correctAnswer = randomSong.title.toLowerCase();
  gameData.song.answers.clear();
  gameData.song.hints = [];
  
  activeGame = {
    game_type: 'song',
    host_id: state.currentUser.id,
    room_id: state.activeRoom,
    game_state: gameData.song,
  };
  
  await saveActiveGame();
  
  /* Mostra primo hint */
  showSongHint(0);
  startGameUI('song', gameData.song);
  
  /* Timer per hint successivi */
  setTimeout(() => showSongHint(1), 10000);
  setTimeout(() => showSongHint(2), 20000);
  
  /* Timer fine gioco */
  gameTimer = setTimeout(() => endSongGame(), gameData.song.timeLimit);
  
  broadcastAll('game-started', {
    game_type: 'song',
    host: state.currentUser.name,
    room_id: state.activeRoom,
  });
  
  showToast(`🎵 Gioco iniziato! Indovina la canzone! Primo hint: ${randomSong.hints[0]}`);
}

/* ── Mostra hint canzone ─────────────────────────────────────── */
function showSongHint(index) {
  if (!activeGame || activeGame.game_type !== 'song') return;
  if (index >= gameData.song.currentSong.hints.length) return;
  
  const hint = gameData.song.currentSong.hints[index];
  gameData.song.hints.push(hint);
  
  broadcastAll('game-hint', {
    game_type: 'song',
    hint: hint,
    hint_index: index,
    room_id: state.activeRoom,
  });
  
  updateGamesPanel();
}

/* ── Gestisce guess canzone ──────────────────────────────────── */
function handleGuess(answer) {
  if (!activeGame || activeGame.game_type !== 'song') {
    showToast('⚠️ Nessun gioco canzone attivo!');
    return;
  }
  
  if (!answer || answer.trim() === '') {
    showToast('⚠️ Inserisci una risposta! Es: /game guess Bohemian Rhapsody');
    return;
  }
  
  const userId = state.currentUser.id;
  const normalizedAnswer = answer.trim().toLowerCase();
  const correctAnswer = gameData.song.correctAnswer;
  
  if (gameData.song.answers.has(userId)) {
    showToast('⚠️ Hai già risposto!');
    return;
  }
  
  gameData.song.answers.set(userId, {
    answer: answer.trim(),
    timestamp: Date.now(),
  });
  
  updateGamesPanel();
  
  if (normalizedAnswer === correctAnswer || normalizedAnswer.includes(correctAnswer) || correctAnswer.includes(normalizedAnswer)) {
    /* Risposta corretta! */
    clearTimeout(gameTimer);
    endSongGame(true, userId);
  } else {
    showToast(`❌ Sbagliato! Prova ancora. Hint: ${gameData.song.hints.join(' ')}`);
  }
}

/* ── Termina gioco canzone ───────────────────────────────────── */
async function endSongGame(winner = false, winnerId = null) {
  if (!activeGame || activeGame.game_type !== 'song') return;
  
  const correctAnswer = gameData.song.currentSong.title;
  const artist = gameData.song.currentSong.artist;
  
  if (winner && winnerId) {
    const winnerUser = findUser(winnerId);
    const winnerName = winnerUser?.name || 'Qualcuno';
    
    /* Assegna punteggio */
    await updateScore(winnerId, 'song', 10);
    
    broadcastAll('game-ended', {
      game_type: 'song',
      winner: winnerName,
      correct_answer: `${correctAnswer} - ${artist}`,
      room_id: state.activeRoom,
    });
    
    showToast(`🎉 ${winnerName} ha indovinato! La risposta era: ${correctAnswer} - ${artist}`);
  } else {
    broadcastAll('game-ended', {
      game_type: 'song',
      winner: null,
      correct_answer: `${correctAnswer} - ${artist}`,
      room_id: state.activeRoom,
    });
    
    showToast(`⏰ Tempo scaduto! La risposta era: ${correctAnswer} - ${artist}`);
  }
  
  await stopGame();
}

/* ── Avvia gioco: Due verità e una bugia ─────────────────────── */
async function startTruthLieGame() {
  if (activeGame) {
    showToast('⚠️ C\'è già un gioco in corso! Usa /game stop per terminarlo.');
    return;
  }
  
  activeGame = {
    game_type: 'truthLie',
    host_id: state.currentUser.id,
    room_id: state.activeRoom,
    game_state: {
      host: state.currentUser.name,
      statements: [],
      votes: new Map(),
    },
  };
  
  gameData.truthLie.host = state.currentUser.name;
  gameData.truthLie.statements = [];
  gameData.truthLie.votes.clear();
  
  await saveActiveGame();
  startGameUI('truthLie', gameData.truthLie);
  
  broadcastAll('game-started', {
    game_type: 'truthLie',
    host: state.currentUser.name,
    room_id: state.activeRoom,
  });
  
  showToast(`🎭 ${state.currentUser.name} ha iniziato "Due verità e una bugia"! Scrivi 3 affermazioni su di te (2 vere, 1 bugia) usando /game start truth [affermazione1] [affermazione2] [affermazione3]`);
}

/* ── Gestisce start con affermazioni ─────────────────────────── */
function handleStartGame(args) {
  if (args.length < 3) {
    showToast('⚠️ Devi fornire 3 affermazioni! Es: /game start truth "Sono andato a Parigi" "Ho un gatto" "Sono alto 2 metri"');
    return;
  }
  
  if (!activeGame || activeGame.game_type !== 'truthLie') {
    showToast('⚠️ Prima avvia il gioco con /game truth');
    return;
  }
  
  if (String(state.currentUser.id) !== String(activeGame.host_id)) {
    showToast('⚠️ Solo l\'host può fornire le affermazioni!');
    return;
  }
  
  gameData.truthLie.statements = args.slice(0, 3);
  updateGamesPanel();
  
  /* Timer per votazione */
  gameTimer = setTimeout(() => endTruthLieGame(), gameData.truthLie.timeLimit);
  
  broadcastAll('game-statements', {
    game_type: 'truthLie',
    statements: gameData.truthLie.statements,
    room_id: state.activeRoom,
  });
  
  showToast(`🎭 Affermazioni pubblicate! Votate quale è la bugia con /game vote [1/2/3]`);
}

/* ── Gestisce voto bugia ─────────────────────────────────────── */
function handleVote(statementIndex) {
  if (!activeGame || activeGame.game_type !== 'truthLie') {
    showToast('⚠️ Nessun gioco "Due verità e una bugia" attivo!');
    return;
  }
  
  if (!gameData.truthLie.statements || gameData.truthLie.statements.length === 0) {
    showToast('⚠️ Le affermazioni non sono ancora state pubblicate!');
    return;
  }
  
  const index = parseInt(statementIndex);
  if (isNaN(index) || index < 1 || index > 3) {
    showToast('⚠️ Vota un numero tra 1 e 3! Es: /game vote 2');
    return;
  }
  
  const userId = state.currentUser.id;
  
  if (gameData.truthLie.votes.has(userId)) {
    showToast('⚠️ Hai già votato!');
    return;
  }
  
  gameData.truthLie.votes.set(userId, index - 1); // 0-based
  updateGamesPanel();
  
  showToast(`✅ Hai votato l'affermazione ${index} come bugia!`);
}

/* ── Termina gioco verità/bugia ───────────────────────────────── */
async function endTruthLieGame() {
  if (!activeGame || activeGame.game_type !== 'truthLie') return;
  
  /* L'host deve rivelare quale è la bugia manualmente */
  showToast(`🎭 Tempo scaduto! L'host deve rivelare quale affermazione era la bugia.`);
  
  await stopGame();
}

/* ── Avvia gioco: Quiz a tempo ────────────────────────────────── */
async function startQuizGame() {
  if (activeGame) {
    showToast('⚠️ C\'è già un gioco in corso! Usa /game stop per terminarlo.');
    return;
  }
  
  gameData.quiz.questionIndex = 0;
  gameData.quiz.answers.clear();
  
  activeGame = {
    game_type: 'quiz',
    host_id: state.currentUser.id,
    room_id: state.activeRoom,
    game_state: gameData.quiz,
  };
  
  await saveActiveGame();
  askNextQuestion();
  
  broadcastAll('game-started', {
    game_type: 'quiz',
    host: state.currentUser.name,
    room_id: state.activeRoom,
  });
}

/* ── Chiedi prossima domanda quiz ────────────────────────────── */
function askNextQuestion() {
  if (!activeGame || activeGame.game_type !== 'quiz') return;
  
  if (gameData.quiz.questionIndex >= gameData.quiz.questions.length) {
    endQuizGame();
    return;
  }
  
  gameData.quiz.currentQuestion = gameData.quiz.questions[gameData.quiz.questionIndex];
  gameData.quiz.answers.clear();
  
  updateGamesPanel();
  
  broadcastAll('game-question', {
    game_type: 'quiz',
    question: gameData.quiz.currentQuestion.q,
    options: gameData.quiz.currentQuestion.options,
    question_number: gameData.quiz.questionIndex + 1,
    total_questions: gameData.quiz.questions.length,
    room_id: state.activeRoom,
  });
  
  showToast(`❓ Domanda ${gameData.quiz.questionIndex + 1}/${gameData.quiz.questions.length}: ${gameData.quiz.currentQuestion.q}`);
  
  /* Timer per risposta */
  gameTimer = setTimeout(() => {
    checkQuizAnswers();
    setTimeout(() => askNextQuestion(), 2000);
  }, gameData.quiz.timeLimit);
}

/* ── Gestisce risposta quiz ───────────────────────────────────── */
function handleAnswer(answer) {
  if (!activeGame || activeGame.game_type !== 'quiz') {
    showToast('⚠️ Nessun quiz attivo!');
    return;
  }
  
  if (!answer || answer.trim() === '') {
    showToast('⚠️ Inserisci una risposta! Es: /game answer Roma');
    return;
  }
  
  const userId = state.currentUser.id;
  const normalizedAnswer = answer.trim().toLowerCase();
  
  if (gameData.quiz.answers.has(userId)) {
    showToast('⚠️ Hai già risposto a questa domanda!');
    return;
  }
  
  gameData.quiz.answers.set(userId, {
    answer: answer.trim(),
    timestamp: Date.now(),
  });
  
  updateGamesPanel();
  showToast(`✅ Risposta registrata: ${answer.trim()}`);
}

/* ── Controlla risposte quiz ──────────────────────────────────── */
function checkQuizAnswers() {
  if (!activeGame || activeGame.game_type !== 'quiz') return;
  if (!gameData.quiz.currentQuestion) return;
  
  const correctAnswer = gameData.quiz.currentQuestion.a.toLowerCase();
  const correctUsers = [];
  
  gameData.quiz.answers.forEach((data, userId) => {
    const userAnswer = data.answer.toLowerCase();
    if (userAnswer === correctAnswer) {
      correctUsers.push(userId);
    }
  });
  
  /* Assegna punteggi */
  const pointsPerUser = correctUsers.length > 0 ? Math.max(1, Math.floor(10 / correctUsers.length)) : 0;
  correctUsers.forEach(userId => {
    updateScore(userId, 'quiz', pointsPerUser);
  });
  
  const correctNames = correctUsers.map(uid => findUser(uid)?.name || 'Qualcuno').join(', ');
  const correctText = correctUsers.length > 0 
    ? `✅ Corretti: ${correctNames} (+${pointsPerUser} punti)`
    : `❌ Nessuno ha risposto correttamente!`;
  
  showToast(`⏰ Tempo scaduto! Risposta corretta: ${gameData.quiz.currentQuestion.a}. ${correctText}`);
}

/* ── Termina gioco quiz ───────────────────────────────────────── */
async function endQuizGame() {
  if (!activeGame || activeGame.game_type !== 'quiz') return;
  
  showToast(`🎉 Quiz completato! Controlla la classifica con /game scores`);
  await stopGame();
}

/* ── Termina gioco corrente ──────────────────────────────────── */
async function stopGame() {
  if (!activeGame) return;
  
  if (gameTimer) {
    clearTimeout(gameTimer);
    gameTimer = null;
  }
  
  if (state.supa) {
    try {
      await state.supa
        .from('active_games')
        .update({ is_active: false, ended_at: new Date().toISOString() })
        .eq('id', activeGame.id);
    } catch (err) {
      console.error('[Games] Error stopping game:', err);
    }
  }
  
  activeGame = null;
  gameData.song.answers.clear();
  gameData.truthLie.votes.clear();
  gameData.quiz.answers.clear();
  
  updateGamesPanel();
  showToast('🛑 Gioco terminato!');
}

/* ── Salva gioco attivo ──────────────────────────────────────── */
async function saveActiveGame() {
  if (!state.supa || !activeGame) return;
  
  try {
    const gameState = { ...activeGame.game_state };
    /* Converti Map in oggetti per JSON */
    if (gameState.answers instanceof Map) {
      gameState.answers = Object.fromEntries(gameState.answers);
    }
    if (gameState.votes instanceof Map) {
      gameState.votes = Object.fromEntries(gameState.votes);
    }
    
    const { data, error } = await state.supa
      .from('active_games')
      .upsert({
        room_id: activeGame.room_id,
        game_type: activeGame.game_type,
        game_state: gameState,
        host_id: activeGame.host_id,
        is_active: true,
      }, {
        onConflict: 'room_id',
      })
      .select()
      .single();
    
    if (error) throw error;
    if (data) activeGame.id = data.id;
  } catch (err) {
    console.error('[Games] Error saving active game:', err);
  }
}

/* ── Aggiorna punteggio ────────────────────────────────────────── */
async function updateScore(userId, gameType, points) {
  if (!state.supa) return;
  
  try {
    const user = findUser(userId);
    const username = user?.name || 'Guest';
    
    const { data: existing, error: fetchError } = await state.supa
      .from('game_scores')
      .select('*')
      .eq('user_id', userId)
      .eq('room_id', state.activeRoom)
      .eq('game_type', gameType)
      .maybeSingle();
    
    if (fetchError) throw fetchError;
    
    if (existing) {
      await state.supa
        .from('game_scores')
        .update({
          score: existing.score + points,
          games_played: existing.games_played + 1,
          wins: existing.wins + (points > 0 ? 1 : 0),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await state.supa
        .from('game_scores')
        .insert({
          user_id: userId,
          username: username,
          room_id: state.activeRoom,
          game_type: gameType,
          score: points,
          games_played: 1,
          wins: points > 0 ? 1 : 0,
        });
    }
  } catch (err) {
    console.error('[Games] Error updating score:', err);
  }
}

/* ── Mostra classifica ────────────────────────────────────────── */
async function showScores() {
  if (!state.supa) return;
  
  try {
    const { data, error } = await state.supa
      .from('game_scores')
      .select('*')
      .eq('room_id', state.activeRoom)
      .order('score', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    if (!data || data.length === 0) {
      showToast('📊 Nessun punteggio ancora! Sii il primo a giocare!');
      return;
    }
    
    let leaderboard = '<strong>🏆 Classifica Giochi:</strong><br>';
    data.forEach((entry, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      leaderboard += `${medal} ${escHtml(entry.username)}: ${entry.score} punti (${entry.wins} vittorie)<br>`;
    });
    
    showToast(leaderboard, 8000);
  } catch (err) {
    console.error('[Games] Error fetching scores:', err);
    showToast('⚠️ Errore nel caricamento della classifica.');
  }
}

/* ── Avvia UI gioco ──────────────────────────────────────────── */
function startGameUI(gameType, gameState) {
  updateGamesPanel();
}

/* ── Aggiorna pannello giochi ──────────────────────────────────── */
function updateGamesPanel() {
  if (!dom.gamesPanelBody) return;
  
  if (!activeGame) {
    dom.gamesPanelBody.innerHTML = '<div class="games-panel-empty">🎮 Nessun gioco attivo. Usa /game per iniziare!</div>';
    return;
  }
  
  let html = `<div class="games-panel-header">🎮 ${getGameName(activeGame.game_type)}</div>`;
  
  if (activeGame.game_type === 'song') {
    html += renderSongGameUI();
  } else if (activeGame.game_type === 'truthLie') {
    html += renderTruthLieGameUI();
  } else if (activeGame.game_type === 'quiz') {
    html += renderQuizGameUI();
  }
  
  dom.gamesPanelBody.innerHTML = html;
}

/* ── Render UI canzone ────────────────────────────────────────── */
function renderSongGameUI() {
  const hints = gameData.song.hints.join(' ');
  const answersCount = gameData.song.answers.size;
  
  return `
    <div class="games-panel-content">
      <div class="game-hint">💡 Hint: ${hints || 'Nessun hint ancora'}</div>
      <div class="game-stats">👥 Risposte: ${answersCount}</div>
      <div class="game-instruction">Scrivi: <code>/game guess [titolo canzone]</code></div>
    </div>
  `;
}

/* ── Render UI verità/bugia ──────────────────────────────────── */
function renderTruthLieGameUI() {
  const statements = gameData.truthLie.statements;
  const votesCount = gameData.truthLie.votes.size;
  
  let statementsHtml = '';
  if (statements.length > 0) {
    statements.forEach((stmt, idx) => {
      statementsHtml += `<div class="game-statement">${idx + 1}. ${escHtml(stmt)}</div>`;
    });
  } else {
    statementsHtml = '<div class="game-instruction">In attesa delle affermazioni dall\'host...</div>';
  }
  
  return `
    <div class="games-panel-content">
      <div class="game-host">👤 Host: ${escHtml(gameData.truthLie.host)}</div>
      ${statementsHtml}
      <div class="game-stats">🗳️ Voti: ${votesCount}</div>
      <div class="game-instruction">Vota: <code>/game vote [1/2/3]</code></div>
    </div>
  `;
}

/* ── Render UI quiz ───────────────────────────────────────────── */
function renderQuizGameUI() {
  const question = gameData.quiz.currentQuestion;
  const answersCount = gameData.quiz.answers.size;
  const questionNum = gameData.quiz.questionIndex + 1;
  const totalQuestions = gameData.quiz.questions.length;
  
  if (!question) {
    return '<div class="games-panel-content">Caricamento domanda...</div>';
  }
  
  let optionsHtml = '';
  question.options.forEach((opt, idx) => {
    optionsHtml += `<div class="game-option">${String.fromCharCode(65 + idx)}. ${escHtml(opt)}</div>`;
  });
  
  return `
    <div class="games-panel-content">
      <div class="game-question-number">Domanda ${questionNum}/${totalQuestions}</div>
      <div class="game-question">${escHtml(question.q)}</div>
      ${optionsHtml}
      <div class="game-stats">👥 Risposte: ${answersCount}</div>
      <div class="game-instruction">Rispondi: <code>/game answer [risposta]</code></div>
    </div>
  `;
}

/* ── Render pannello giochi iniziale ─────────────────────────── */
function renderGamesPanel() {
  if (!dom.gamesPanelBody) return;
  updateGamesPanel();
}

/* ── Nome gioco ──────────────────────────────────────────────── */
function getGameName(gameType) {
  const names = {
    song: '🎵 Indovina la canzone',
    truthLie: '🎭 Due verità e una bugia',
    quiz: '❓ Quiz a tempo',
  };
  return names[gameType] || 'Gioco';
}

/* ── Esporta funzioni ─────────────────────────────────────────── */
export { updateGamesPanel };

/* ================================================================
   games.js  — Sistema giochi interattivi con punteggio automatico
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { showToast, escHtml, avatarColor, initials } from './utils.js';
import { findUser } from './users.js';
import { broadcastAll } from './broadcast.js';
import { getAvailableRooms } from './rooms.js';

/* ── Stato giochi ────────────────────────────────────────────── */
let activeGame = null;
let gameTimer = null;
let finalLeaderboardTimer = null;
let showingFinalLeaderboard = false;
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

/* ── Helper: restituisce il container corretto per il contenuto del gioco ── */
function getGameContainer() {
  const isMobile = window.innerWidth <= 768;
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const isGamesRoom = roomData?.is_games_room === true;
  
  /* Su mobile nella stanza giochi: usa usersPanelGameContent */
  if (isMobile && isGamesRoom && dom.usersPanelGameContent) {
    return dom.usersPanelGameContent;
  }
  /* Desktop o altre stanze: usa gamesPanelBody */
  return dom.gamesPanelBody;
}

/* ── Inizializza sistema giochi ───────────────────────────────── */
export function initGames() {
  if (!dom.gamesPanel) return;
  
  /* Reset games panel width CSS variable first, before any other operations */
  document.documentElement.style.setProperty('--games-panel-width', '0px');
  
  renderGamesPanel();
  checkActiveGame();
  
  /* Subscribe to active_games changes for real-time updates */
  if (state.supa) {
    const gamesChannel = state.supa.channel('active-games-updates');
    gamesChannel
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'active_games' },
        async (payload) => {
          /* Aggiorna solo se il cambiamento riguarda la stanza attiva */
          if (payload.new && String(payload.new.room_id) === String(state.activeRoom)) {
            console.log('[Games] Active game changed in current room, reloading...');
            await checkActiveGame();
            /* Forza aggiornamento UI */
            setTimeout(() => {
              updateGamesPanel();
            }, 100);
          } else if (payload.old && String(payload.old.room_id) === String(state.activeRoom)) {
            /* Gioco terminato nella stanza attiva */
            console.log('[Games] Active game ended in current room');
            await checkActiveGame();
            setTimeout(() => {
              updateGamesPanel();
            }, 100);
          }
        }
      )
      .subscribe();
  }
  
  /* Show/hide games panel based on room type and device */
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const isGamesRoom = roomData?.is_games_room === true;
  const isMobile = window.innerWidth <= 768;
  
  if (dom.gamesPanel) {
    /* Su mobile nella stanza giochi: nascondi gamesPanel (usa usersPanel) */
    dom.gamesPanel.hidden = !isGamesRoom || isMobile;
    /* Reset games panel width CSS variable if not in games room or on mobile */
    if (!isGamesRoom || isMobile) {
      document.documentElement.style.setProperty('--games-panel-width', '0px');
    }
  }
  
  /* Close button handler */
  if (dom.closeGamesPanelBtn) {
    dom.closeGamesPanelBtn.addEventListener('click', () => {
      if (dom.gamesPanel) dom.gamesPanel.hidden = true;
    });
  }
  
  /* Toggle users list button handler */
  if (dom.toggleUsersListBtn && dom.usersPanel) {
    const updateButtonText = () => {
      const isVisible = dom.usersPanel.classList.contains('open');
      dom.toggleUsersListBtn.textContent = '👥';
      dom.toggleUsersListBtn.title = isVisible ? 'Nascondi utenti online' : 'Visualizza utenti online';
    };
    
    dom.toggleUsersListBtn.addEventListener('click', () => {
      const isVisible = dom.usersPanel.classList.contains('open');
      if (isVisible) {
        dom.usersPanel.classList.remove('open');
        dom.usersPanel.classList.add('hidden');
        if (dom.panelOverlay) dom.panelOverlay.classList.remove('show');
        /* Reset CSS variable — chat torna a larghezza piena */
        document.documentElement.style.setProperty('--users-panel-width', '0px');
        /* Rimuovi TUTTI gli stili inline */
        dom.usersPanel.style.cssText = '';
        dom.usersPanel.style.position = '';
        dom.usersPanel.style.top = '';
        dom.usersPanel.style.bottom = '';
        dom.usersPanel.style.right = '';
        dom.usersPanel.style.zIndex = '';
        dom.usersPanel.style.width = '';
        dom.usersPanel.style.height = '';
      } else {
        dom.usersPanel.classList.remove('hidden');
        dom.usersPanel.classList.add('open');
        if (dom.panelOverlay) dom.panelOverlay.classList.add('show');
        
        /* Imposta larghezza di default se non già impostata */
        const isMobile = window.innerWidth <= 768;
        const gamesPanelWidth = dom.gamesPanel.offsetWidth || (isMobile ? 260 : 320);
        const savedW = parseInt(localStorage.getItem('nvc_panel_w'), 10);
        const defaultW = (savedW >= 200 && savedW <= 480) ? savedW : (isMobile ? 220 : 240);
        
        if (!dom.usersPanel.style.width || dom.usersPanel.style.width === '') {
          dom.usersPanel.style.width = defaultW + 'px';
        }
        
        /* Posiziona il pannello utenti a sinistra della barra giochi (sempre fixed) */
        dom.usersPanel.style.position = 'fixed';
        dom.usersPanel.style.top = 'var(--hdr-h, 60px)';
        dom.usersPanel.style.bottom = '0';
        dom.usersPanel.style.right = gamesPanelWidth + 'px';
        dom.usersPanel.style.zIndex = '399';
        
        /* Aggiorna CSS variable: la chat si restringe per non essere coperta */
        const panelW = parseInt(dom.usersPanel.style.width, 10) || defaultW;
        document.documentElement.style.setProperty('--users-panel-width', panelW + 'px');
      }
      updateButtonText();
    });
    
    /* Aggiorna il testo del bottone quando il pannello viene aperto/chiuso da altri punti */
    const observer = new MutationObserver(updateButtonText);
    observer.observe(dom.usersPanel, { attributes: true, attributeFilter: ['class'] });
    updateButtonText();
  }
  
  /* Rendi solo ridimensionabile il pannello giochi (NON draggable) */
  if (dom.gamesPanel) {
    const resizeHandle = document.getElementById('gamesPanelResizeHandle');
    
    if (resizeHandle) {
      import('./utils.js').then(({ makeResizable }) => {
        /* Rendi ridimensionabile */
        makeResizable(dom.gamesPanel, resizeHandle);
        
        /* Salva larghezza quando viene ridimensionato */
        const updateWidth = () => {
          const w = dom.gamesPanel.offsetWidth;
          if (w >= 200 && w <= 800) {
            localStorage.setItem('nvc_games_panel_w', w);
            document.documentElement.style.setProperty('--games-panel-width', w + 'px');
          }
        };
        
        /* Observer per cambiamenti di width */
        const observer = new MutationObserver(updateWidth);
        observer.observe(dom.gamesPanel, { attributes: true, attributeFilter: ['style'] });
        
        /* Aggiorna anche quando il resize finisce */
        resizeHandle.addEventListener('mouseup', updateWidth);
        resizeHandle.addEventListener('touchend', updateWidth);
      });
    }
    
    /* Carica larghezza salvata - ma solo se siamo in una stanza giochi */
    const availableRooms = getAvailableRooms();
    const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
    const isGamesRoom = roomData?.is_games_room === true;
    
    if (isGamesRoom) {
      const isMobile = window.innerWidth <= 768;
      const savedW = parseInt(localStorage.getItem('nvc_games_panel_w'), 10);
      if (savedW >= 200 && savedW <= 800) {
        dom.gamesPanel.style.width = savedW + 'px';
        document.documentElement.style.setProperty('--games-panel-width', savedW + 'px');
      } else {
        /* Default width: 260px su mobile, 320px su desktop */
        const defaultW = isMobile ? '260px' : '320px';
        if (!dom.gamesPanel.style.width) {
          dom.gamesPanel.style.width = defaultW;
        }
        document.documentElement.style.setProperty('--games-panel-width', defaultW);
      }
    } else {
      /* Non siamo in una stanza giochi, assicurati che la variabile sia 0 */
      document.documentElement.style.setProperty('--games-panel-width', '0px');
    }
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
      activeGame = {
        id: data.id,
        game_type: data.game_type,
        host_id: data.host_id,
        room_id: data.room_id,
        game_state: data.game_state,
      };
      
      /* Ricostruisci Maps da JSON */
      const gameState = data.game_state || {};
      if (data.game_type === 'song') {
        gameData.song = {
          currentSong: gameState.currentSong || null,
          hints: gameState.hints || [],
          answers: new Map(Object.entries(gameState.answers || {})),
          correctAnswer: gameState.correctAnswer || null,
          timeLimit: gameState.timeLimit || 30000,
        };
        /* Ripristina timer se necessario */
        if (gameData.song.currentSong && gameData.song.hints.length < 3) {
          const hintsRemaining = 3 - gameData.song.hints.length;
          if (hintsRemaining > 0) {
            setTimeout(() => showSongHint(gameData.song.hints.length), 10000);
          }
          if (hintsRemaining > 1) {
            setTimeout(() => showSongHint(gameData.song.hints.length + 1), 20000);
          }
        }
      } else if (data.game_type === 'truthLie') {
        gameData.truthLie = {
          host: gameState.host || null,
          statements: gameState.statements || [],
          votes: new Map(Object.entries(gameState.votes || {})),
          timeLimit: gameState.timeLimit || 60000,
        };
      } else if (data.game_type === 'quiz') {
        /* Assicurati che questions sia sempre inizializzato */
        const defaultQuestions = [
          { q: "Qual è la capitale d'Italia?", options: ["Roma", "Milano", "Napoli", "Torino"], a: "Roma" },
          { q: "Quanti continenti ci sono?", options: ["5", "6", "7", "8"], a: "7" },
          { q: "Qual è il fiume più lungo del mondo?", options: ["Nilo", "Amazzoni", "Mississippi", "Gange"], a: "Nilo" },
          { q: "In quale anno è caduto il muro di Berlino?", options: ["1987", "1989", "1991", "1993"], a: "1989" },
          { q: "Chi ha scritto '1984'?", options: ["George Orwell", "Aldous Huxley", "Ray Bradbury", "J.D. Salinger"], a: "George Orwell" },
        ];
        
        gameData.quiz = {
          currentQuestion: gameState.currentQuestion || null,
          questionIndex: gameState.questionIndex || 0,
          answers: new Map(Object.entries(gameState.answers || {}).map(([k, v]) => [
            k, 
            typeof v === 'string' ? { answer: v, timestamp: Date.now(), username: null } : v
          ])),
          timeLimit: gameState.timeLimit || 15000,
          questions: gameState.questions || defaultQuestions,
        };
        /* Se c'è una domanda attiva, ripristina il timer */
        if (gameData.quiz.currentQuestion) {
          /* Calcola tempo rimanente (approssimativo) */
          const timeElapsed = Date.now() - (gameState.questionStartTime || Date.now());
          const timeRemaining = Math.max(1000, gameData.quiz.timeLimit - timeElapsed);
          gameTimer = setTimeout(() => {
            checkQuizAnswers();
            setTimeout(() => askNextQuestion(), 2000);
          }, timeRemaining);
        }
      }
      
      startGameUI(data.game_type, gameData[data.game_type]);
      console.log('[Games] Reloaded active game:', data.game_type, 'in room', state.activeRoom);
      
      /* Forza aggiornamento UI anche su mobile */
      setTimeout(() => {
        updateGamesPanel();
      }, 100);
    } else {
      /* Nessun gioco attivo - reset */
      activeGame = null;
      gameData.song.answers.clear();
      gameData.truthLie.votes.clear();
      gameData.quiz.answers.clear();
      if (gameTimer) {
        clearTimeout(gameTimer);
        gameTimer = null;
      }
      updateGamesPanel();
    }
  } catch (err) {
    console.error('[Games] Error checking active game:', err);
  }
}

/* ── Gestione comandi /game e /giochi ─────────────────────────── */
export function handleGameCommand(message) {
  const parts = message.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  
  if (cmd !== '/game' && cmd !== '/giochi') return false;
  
  /* Verifica se siamo in una stanza Giochi */
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const isGamesRoom = roomData?.is_games_room === true;
  
  if (!isGamesRoom) {
    showToast('🎮 I giochi sono disponibili solo nella stanza Giochi!');
    return true;
  }
  
  /* Comando /giochi mostra menu interattivo */
  if (cmd === '/giochi') {
    showGamesMenu();
    return true;
  }
  
  const subCmd = parts[1]?.toLowerCase();
  const args = parts.slice(2);
  
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

/* ── Mostra menu interattivo giochi ───────────────────────────── */
function showGamesMenu() {
  const menuHtml = `
    <div class="games-menu-overlay" id="gamesMenuOverlay">
      <div class="games-menu-card">
        <div class="games-menu-header">
          <h3>🎮 Scegli un Gioco</h3>
          <button class="games-menu-close" id="gamesMenuClose">✕</button>
        </div>
        <div class="games-menu-options">
          <button class="games-menu-option" data-game="song">
            <span class="games-menu-icon">🎵</span>
            <div class="games-menu-info">
              <strong>Indovina la Canzone</strong>
              <span>Indovina il titolo dalla canzone dagli hint!</span>
            </div>
          </button>
          <button class="games-menu-option" data-game="truth">
            <span class="games-menu-icon">🎭</span>
            <div class="games-menu-info">
              <strong>Due Verità e una Bugia</strong>
              <span>Indovina quale affermazione è falsa!</span>
            </div>
          </button>
          <button class="games-menu-option" data-game="quiz">
            <span class="games-menu-icon">❓</span>
            <div class="games-menu-info">
              <strong>Quiz a Tempo</strong>
              <span>Rispondi velocemente alle domande!</span>
            </div>
          </button>
        </div>
        <div class="games-menu-footer">
          <button class="games-menu-btn-secondary" id="gamesMenuScores">🏆 Classifica</button>
        </div>
      </div>
    </div>
  `;
  
  /* Rimuovi menu esistente se presente */
  const existing = document.getElementById('gamesMenuOverlay');
  if (existing) existing.remove();
  
  document.body.insertAdjacentHTML('beforeend', menuHtml);
  const overlay = document.getElementById('gamesMenuOverlay');
  const closeBtn = document.getElementById('gamesMenuClose');
  const scoresBtn = document.getElementById('gamesMenuScores');
  
  /* Click su opzione gioco */
  overlay.querySelectorAll('.games-menu-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const gameType = btn.dataset.game;
      overlay.remove();
      if (gameType === 'song') startSongGame();
      else if (gameType === 'truth') startTruthLieGame();
      else if (gameType === 'quiz') startQuizGame();
    });
  });
  
  /* Close button */
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  
  /* Scores button */
  scoresBtn.addEventListener('click', () => {
    overlay.remove();
    showScores();
  });
}

/* ── Mostra help giochi ───────────────────────────────────────── */
function showGameHelp() {
  showToast('🎮 Usa /giochi per vedere il menu giochi! Oppure: /game song, /game truth, /game quiz', 5000);
}

/* ── Avvia gioco: Indovina la canzone ────────────────────────── */
async function startSongGame() {
  /* Rimuovi classifica finale se visibile */
  if (finalLeaderboardTimer) {
    clearTimeout(finalLeaderboardTimer);
    finalLeaderboardTimer = null;
  }
  showingFinalLeaderboard = false;
  
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
  
  /* Mostra toast solo se siamo nella stanza attiva */
  if (String(state.activeRoom) === String(activeGame.room_id)) {
    showToast(`🎵 Gioco iniziato! Indovina la canzone! Primo hint: ${randomSong.hints[0]}`);
  }
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
  
  /* Salva stato aggiornato */
  saveActiveGame();
  updateGamesPanel();
  
  if (normalizedAnswer === correctAnswer || normalizedAnswer.includes(correctAnswer) || correctAnswer.includes(normalizedAnswer)) {
    /* Risposta corretta! */
    clearTimeout(gameTimer);
    endSongGame(true, userId);
  } else {
    /* Toast solo se siamo nella stanza attiva */
    if (String(state.activeRoom) === String(activeGame.room_id)) {
      showToast(`❌ Sbagliato! Prova ancora. Hint: ${gameData.song.hints.join(' ')}`);
    }
  }
}

/* ── Termina gioco canzone ───────────────────────────────────── */
async function endSongGame(winner = false, winnerId = null) {
  if (!activeGame || activeGame.game_type !== 'song') return;
  
  const correctAnswer = gameData.song.currentSong.title;
  const artist = gameData.song.currentSong.artist;
  const isInActiveRoom = String(state.activeRoom) === String(activeGame.room_id);
  
  if (winner && winnerId) {
    const winnerUser = findUser(winnerId);
    const winnerName = winnerUser?.name || 'Qualcuno';
    
    /* Assegna punteggio */
    await updateScore(winnerId, 'song', 10);
    
    broadcastAll('game-ended', {
      game_type: 'song',
      winner: winnerName,
      correct_answer: `${correctAnswer} - ${artist}`,
      room_id: activeGame.room_id,
    });
    
    if (isInActiveRoom) {
      showToast(`🎉 ${winnerName} ha indovinato! La risposta era: ${correctAnswer} - ${artist}`);
    }
  } else {
    broadcastAll('game-ended', {
      game_type: 'song',
      winner: null,
      correct_answer: `${correctAnswer} - ${artist}`,
      room_id: activeGame.room_id,
    });
    
    if (isInActiveRoom) {
      showToast(`⏰ Tempo scaduto! La risposta era: ${correctAnswer} - ${artist}`);
    }
  }
  
  await stopGame();
}

/* ── Avvia gioco: Due verità e una bugia ─────────────────────── */
async function startTruthLieGame() {
  /* Rimuovi classifica finale se visibile */
  if (finalLeaderboardTimer) {
    clearTimeout(finalLeaderboardTimer);
    finalLeaderboardTimer = null;
  }
  showingFinalLeaderboard = false;
  
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
  
  /* Toast solo se siamo nella stanza attiva */
  if (String(state.activeRoom) === String(activeGame.room_id)) {
    showToast(`🎭 ${state.currentUser.name} ha iniziato "Due verità e una bugia"! Scrivi 3 affermazioni su di te (2 vere, 1 bugia) usando /game start truth [affermazione1] [affermazione2] [affermazione3]`);
  }
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
  
  /* Salva stato aggiornato */
  saveActiveGame();
  updateGamesPanel();
  
  /* Timer per votazione */
  gameTimer = setTimeout(() => endTruthLieGame(), gameData.truthLie.timeLimit);
  
  broadcastAll('game-statements', {
    game_type: 'truthLie',
    statements: gameData.truthLie.statements,
    room_id: state.activeRoom,
  });
  
  /* Toast solo se siamo nella stanza attiva */
  if (String(state.activeRoom) === String(activeGame.room_id)) {
    showToast(`🎭 Affermazioni pubblicate! Votate quale è la bugia con /game vote [1/2/3]`);
  }
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
  
  /* Salva stato aggiornato */
  saveActiveGame();
  updateGamesPanel();
  
  /* Toast solo se siamo nella stanza attiva */
  if (String(state.activeRoom) === String(activeGame.room_id)) {
    showToast(`✅ Hai votato l'affermazione ${index} come bugia!`);
  }
}

/* ── Termina gioco verità/bugia ───────────────────────────────── */
async function endTruthLieGame() {
  if (!activeGame || activeGame.game_type !== 'truthLie') return;
  
  const isInActiveRoom = String(state.activeRoom) === String(activeGame.room_id);
  
  /* L'host deve rivelare quale è la bugia manualmente */
  if (isInActiveRoom) {
    showToast(`🎭 Tempo scaduto! L'host deve rivelare quale affermazione era la bugia.`);
  }
  
  await stopGame();
}

/* ── Avvia gioco: Quiz a tempo ────────────────────────────────── */
async function startQuizGame() {
  /* Rimuovi classifica finale se visibile */
  if (finalLeaderboardTimer) {
    clearTimeout(finalLeaderboardTimer);
    finalLeaderboardTimer = null;
  }
  showingFinalLeaderboard = false;
  
  if (activeGame) {
    showToast('⚠️ C\'è già un gioco in corso! Usa /game stop per terminarlo.');
    return;
  }
  
  /* Assicurati che questions sia sempre inizializzato */
  if (!gameData.quiz.questions || gameData.quiz.questions.length === 0) {
    gameData.quiz.questions = [
      { q: "Qual è la capitale d'Italia?", options: ["Roma", "Milano", "Napoli", "Torino"], a: "Roma" },
      { q: "Quanti continenti ci sono?", options: ["5", "6", "7", "8"], a: "7" },
      { q: "Qual è il fiume più lungo del mondo?", options: ["Nilo", "Amazzoni", "Mississippi", "Gange"], a: "Nilo" },
      { q: "In quale anno è caduto il muro di Berlino?", options: ["1987", "1989", "1991", "1993"], a: "1989" },
      { q: "Chi ha scritto '1984'?", options: ["George Orwell", "Aldous Huxley", "Ray Bradbury", "J.D. Salinger"], a: "George Orwell" },
    ];
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
  
  /* Toast solo se siamo nella stanza attiva */
  if (String(state.activeRoom) === String(activeGame.room_id)) {
    showToast(`❓ Quiz iniziato! Preparati a rispondere velocemente!`);
  }
}

/* ── Chiedi prossima domanda quiz ────────────────────────────── */
function askNextQuestion() {
  if (!activeGame || activeGame.game_type !== 'quiz') return;
  
  /* Se stiamo mostrando la classifica finale, non fare nulla */
  if (showingFinalLeaderboard) return;
  
  if (gameData.quiz.questionIndex >= gameData.quiz.questions.length) {
    endQuizGame();
    return;
  }
  
  gameData.quiz.currentQuestion = gameData.quiz.questions[gameData.quiz.questionIndex];
  gameData.quiz.answers.clear();
  
  /* Salva stato aggiornato */
  saveActiveGame();
  updateGamesPanel();
  
  broadcastAll('game-question', {
    game_type: 'quiz',
    question: gameData.quiz.currentQuestion.q,
    options: gameData.quiz.currentQuestion.options,
    question_number: gameData.quiz.questionIndex + 1,
    total_questions: gameData.quiz.questions.length,
    room_id: state.activeRoom,
  });
  
  /* Toast solo se siamo nella stanza attiva */
  if (String(state.activeRoom) === String(activeGame.room_id)) {
    showToast(`❓ Domanda ${gameData.quiz.questionIndex + 1}/${gameData.quiz.questions.length}: ${gameData.quiz.currentQuestion.q}`);
  }
  
  /* Timer per risposta - solo se il gioco è ancora attivo */
  if (activeGame && activeGame.game_type === 'quiz' && !showingFinalLeaderboard) {
    gameTimer = setTimeout(() => {
      /* Verifica che il gioco sia ancora attivo prima di procedere */
      if (!activeGame || activeGame.game_type !== 'quiz' || showingFinalLeaderboard) return;
      if (gameData.quiz.questionIndex >= gameData.quiz.questions.length) {
        /* Gioco finito, non chiamare askNextQuestion */
        endQuizGame();
        return;
      }
      checkQuizAnswers();
      setTimeout(() => {
        /* Verifica di nuovo prima di chiedere la prossima domanda */
        if (!activeGame || activeGame.game_type !== 'quiz' || showingFinalLeaderboard) return;
        if (gameData.quiz.questionIndex >= gameData.quiz.questions.length) {
          endQuizGame();
          return;
        }
        askNextQuestion();
      }, 2000);
    }, gameData.quiz.timeLimit);
  }
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
    username: state.currentUser.name || state.currentUser.username,
  });
  
  /* Salva stato aggiornato */
  saveActiveGame();
  updateGamesPanel();
  
  /* Broadcast risposta a tutti gli utenti nella stanza */
  broadcastAll('game-answer', {
    game_type: 'quiz',
    user_id: userId,
    username: state.currentUser.name || state.currentUser.username,
    answer: answer.trim(),
    room_id: activeGame.room_id,
  });
  
  /* Toast solo se siamo nella stanza attiva */
  if (String(state.activeRoom) === String(activeGame.room_id)) {
    showToast(`✅ Risposta registrata: ${answer.trim()}`);
  }
}

/* ── Controlla risposte quiz ──────────────────────────────────── */
function checkQuizAnswers() {
  if (!activeGame || activeGame.game_type !== 'quiz') return;
  if (!gameData.quiz.currentQuestion) return;
  
  const correctAnswer = gameData.quiz.currentQuestion.a.toLowerCase();
  const correctUsers = [];
  
  gameData.quiz.answers.forEach((data, userId) => {
    const userAnswer = typeof data === 'string' ? data : data.answer;
    if (userAnswer.toLowerCase() === correctAnswer) {
      correctUsers.push(userId);
    }
  });
  
  /* Assegna punteggi - sistema più intelligente: più veloci = più punti */
  if (correctUsers.length > 0) {
    /* Ordina per timestamp (più veloce = timestamp più basso) */
    const sortedUsers = correctUsers
      .map(uid => {
        const data = gameData.quiz.answers.get(uid);
        return {
          userId: uid,
          timestamp: typeof data === 'object' && data.timestamp ? data.timestamp : Date.now(),
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
    
    /* Primo: 10 punti, secondo: 7, terzo: 5, altri: 3 */
    sortedUsers.forEach((user, index) => {
      let points = 3;
      if (index === 0) points = 10;
      else if (index === 1) points = 7;
      else if (index === 2) points = 5;
      updateScore(user.userId, 'quiz', points);
    });
    
    const correctNames = sortedUsers
      .map((u, idx) => {
        const user = findUser(u.userId);
        const name = user?.name || user?.username || 'Qualcuno';
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
        return `${medal} ${name}`;
      })
      .join(', ');
    
    const pointsText = sortedUsers.length === 1 
      ? '(+10 punti)'
      : sortedUsers.length === 2
      ? '(+10, +7 punti)'
      : sortedUsers.length === 3
      ? '(+10, +7, +5 punti)'
      : '(+10, +7, +5, +3 punti)';
    
    const correctText = `✅ Corretti: ${correctNames} ${pointsText}`;
    
    /* Toast solo se siamo nella stanza attiva */
    if (String(state.activeRoom) === String(activeGame.room_id)) {
      showToast(`⏰ Tempo scaduto! Risposta corretta: ${gameData.quiz.currentQuestion.a}. ${correctText}`);
    }
  } else {
    /* Toast solo se siamo nella stanza attiva */
    if (String(state.activeRoom) === String(activeGame.room_id)) {
      showToast(`⏰ Tempo scaduto! Risposta corretta: ${gameData.quiz.currentQuestion.a}. ❌ Nessuno ha risposto correttamente!`);
    }
  }
  
  /* INCREMENTA questionIndex per la prossima domanda */
  gameData.quiz.questionIndex++;
  saveActiveGame();
}

/* ── Termina gioco quiz ───────────────────────────────────────── */
async function endQuizGame() {
  if (!activeGame || activeGame.game_type !== 'quiz') return;
  
  /* FERMA il timer del quiz per evitare che continui */
  if (gameTimer) {
    clearTimeout(gameTimer);
    gameTimer = null;
  }
  
  const isInActiveRoom = String(state.activeRoom) === String(activeGame.room_id);
  
  /* Mostra classifica finale nel pannello */
  showingFinalLeaderboard = true;
  await renderFinalLeaderboard('quiz');
  
  if (isInActiveRoom) {
    showToast(`🎉 Quiz completato! Classifica finale mostrata.`);
  }
  
  /* Salva nel DB che il gioco è finito */
  if (state.supa) {
    try {
      await state.supa
        .from('active_games')
        .update({ is_active: false, ended_at: new Date().toISOString() })
        .eq('id', activeGame.id);
    } catch (err) {
      console.error('[Games] Error ending quiz game:', err);
    }
  }
  
  /* Timer per rimuovere la classifica dopo 1 minuto e fermare completamente il gioco */
  if (finalLeaderboardTimer) {
    clearTimeout(finalLeaderboardTimer);
  }
  finalLeaderboardTimer = setTimeout(() => {
    if (showingFinalLeaderboard) {
      showingFinalLeaderboard = false;
      /* Ferma completamente il gioco */
      activeGame = null;
      gameData.quiz.answers.clear();
      
      /* Su mobile nella stanza giochi: quando il gioco termina, mostra users list normale */
      const isMobile = window.innerWidth <= 768;
      const availableRooms = getAvailableRooms();
      const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
      const isGamesRoom = roomData?.is_games_room === true;
      
      if (isMobile && isGamesRoom && dom.usersList && dom.usersPanelGameContent) {
        dom.usersList.hidden = false;
        dom.usersPanelGameContent.hidden = true;
        dom.usersPanelGameContent.innerHTML = '';
      }
      
      updateGamesPanel();
    }
  }, 60000); // 1 minuto
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
  
  const wasInActiveRoom = activeGame && String(state.activeRoom) === String(activeGame.room_id);
  
  activeGame = null;
  gameData.song.answers.clear();
  gameData.truthLie.votes.clear();
  gameData.quiz.answers.clear();
  
  /* Su mobile nella stanza giochi: quando il gioco termina, mostra users list normale */
  const isMobile = window.innerWidth <= 768;
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const isGamesRoom = roomData?.is_games_room === true;
  
  if (isMobile && isGamesRoom && dom.usersList && dom.usersPanelGameContent) {
    dom.usersList.hidden = false;
    dom.usersPanelGameContent.hidden = true;
    dom.usersPanelGameContent.innerHTML = '';
  }
  
  updateGamesPanel();
  
  /* Toast solo se eravamo nella stanza attiva */
  if (wasInActiveRoom) {
    showToast('🛑 Gioco terminato!');
  }
}

/* ── Salva gioco attivo ──────────────────────────────────────── */
async function saveActiveGame() {
  if (!state.supa || !activeGame) return;
  
  try {
    /* Prendi lo stato corrente dal gameData */
    let gameState = {};
    if (activeGame.game_type === 'song') {
      gameState = {
        currentSong: gameData.song.currentSong,
        hints: gameData.song.hints,
        answers: Object.fromEntries(gameData.song.answers),
        correctAnswer: gameData.song.correctAnswer,
        timeLimit: gameData.song.timeLimit,
      };
    } else if (activeGame.game_type === 'truthLie') {
      gameState = {
        host: gameData.truthLie.host,
        statements: gameData.truthLie.statements,
        votes: Object.fromEntries(gameData.truthLie.votes),
        timeLimit: gameData.truthLie.timeLimit,
      };
    } else if (activeGame.game_type === 'quiz') {
      gameState = {
        currentQuestion: gameData.quiz.currentQuestion,
        questionIndex: gameData.quiz.questionIndex,
        answers: Object.fromEntries(gameData.quiz.answers),
        timeLimit: gameData.quiz.timeLimit,
        questions: gameData.quiz.questions,
      };
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

/* ── Render classifica finale nel pannello ───────────────────── */
async function renderFinalLeaderboard(gameType) {
  const container = getGameContainer();
  if (!state.supa || !container) return;
  
  try {
    const { data, error } = await state.supa
      .from('game_scores')
      .select('*')
      .eq('room_id', state.activeRoom)
      .eq('game_type', gameType)
      .order('score', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    let leaderboardHtml = '<div class="games-panel-content"><div class="game-leaderboard-final">';
    leaderboardHtml += '<div class="game-leaderboard-title">🏆 Classifica Finale</div>';
    
    if (!data || data.length === 0) {
      leaderboardHtml += '<div class="game-leaderboard-empty">Nessun punteggio ancora!</div>';
    } else {
      leaderboardHtml += '<div class="game-leaderboard-list">';
      data.forEach((entry, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const isMe = entry.user_id === state.currentUser?.id;
        leaderboardHtml += `
          <div class="game-leaderboard-item ${isMe ? 'game-leaderboard-me' : ''}">
            <span class="game-leaderboard-rank">${medal}</span>
            <span class="game-leaderboard-name">${escHtml(entry.username)}${isMe ? ' (Tu)' : ''}</span>
            <span class="game-leaderboard-score">${entry.score} punti</span>
          </div>
        `;
      });
      leaderboardHtml += '</div>';
    }
    
    leaderboardHtml += '</div></div>';
    container.innerHTML = leaderboardHtml;
    
    /* Su mobile: mostra game content, nascondi users list */
    if (window.innerWidth <= 768 && dom.usersPanelGameContent && dom.usersList) {
      dom.usersList.hidden = true;
      dom.usersPanelGameContent.hidden = false;
    }
  } catch (err) {
    console.error('[Games] Error fetching final leaderboard:', err);
    showToast('⚠️ Errore nel caricamento della classifica.');
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
  const container = getGameContainer();
  if (!container) return;
  
  /* Se stiamo mostrando la classifica finale, non aggiornare */
  if (showingFinalLeaderboard) {
    return;
  }
  
  const isMobile = window.innerWidth <= 768;
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const isGamesRoom = roomData?.is_games_room === true;
  
  if (!activeGame) {
    container.innerHTML = '<div class="games-panel-empty">🎮 Nessun gioco attivo. Usa <code>/giochi</code> per iniziare!</div>';
    
    /* Su mobile nella stanza giochi: quando non c'è gioco, mostra users list */
    if (isMobile && isGamesRoom && dom.usersList && dom.usersPanelGameContent) {
      dom.usersList.hidden = false;
      dom.usersPanelGameContent.hidden = true;
    }
    return;
  }
  
  /* Su mobile nella stanza giochi: quando c'è gioco, mostra game content */
  if (isMobile && isGamesRoom && dom.usersList && dom.usersPanelGameContent) {
    dom.usersList.hidden = true;
    dom.usersPanelGameContent.hidden = false;
  }
  
  let html = '';
  
  if (activeGame.game_type === 'song') {
    html = renderSongGameUI();
  } else if (activeGame.game_type === 'truthLie') {
    html = renderTruthLieGameUI();
  } else if (activeGame.game_type === 'quiz') {
    html = renderQuizGameUI();
  } else {
    html = '<div class="games-panel-empty">Tipo di gioco sconosciuto.</div>';
  }
  
  container.innerHTML = html;
  
  /* Aggiungi event listeners per bottoni cliccabili */
  attachGameButtonListeners();
}

/* ── Attacca event listeners ai bottoni del gioco ─────────────── */
function attachGameButtonListeners() {
  const container = getGameContainer();
  if (!container) return;
  
  /* Bottoni suggerimenti canzone */
  container.querySelectorAll('.game-suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const answer = btn.dataset.answer;
      if (answer) handleGuess(answer);
    });
  });
  
  /* Bottoni voto verità/bugia */
  container.querySelectorAll('.game-vote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const vote = btn.dataset.vote;
      if (vote) handleVote(vote);
    });
  });
  
  /* Bottoni risposta quiz */
  container.querySelectorAll('.game-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const answer = btn.dataset.answer;
      if (answer) {
        btn.disabled = true;
        btn.classList.add('disabled');
        handleAnswer(answer);
      }
    });
  });
}

/* ── Render UI canzone ────────────────────────────────────────── */
function renderSongGameUI() {
  const hints = gameData.song.hints.join(' ');
  const answersCount = gameData.song.answers.size;
  const userId = state.currentUser?.id;
  const hasAnswered = gameData.song.answers.has(userId);
  
  /* Suggerimenti comuni per canzoni */
  const suggestions = gameData.song.currentSong ? [
    gameData.song.currentSong.title,
    gameData.song.currentSong.artist,
  ].filter(Boolean) : [];
  
  let suggestionsHtml = '';
  if (suggestions.length > 0 && !hasAnswered) {
    suggestionsHtml = '<div class="game-suggestions"><strong>💡 Suggerimenti:</strong><div class="game-suggestion-buttons">';
    suggestions.forEach(suggestion => {
      suggestionsHtml += `<button class="game-suggestion-btn" data-answer="${escHtml(suggestion)}">${escHtml(suggestion)}</button>`;
    });
    suggestionsHtml += '</div></div>';
  }
  
  return `
    <div class="games-panel-content">
      <div class="game-hint">💡 Hint: ${hints || 'Nessun hint ancora'}</div>
      <div class="game-stats">👥 Risposte: ${answersCount}</div>
      ${hasAnswered ? '<div class="game-instruction">✅ Hai già risposto! Attendi il risultato...</div>' : suggestionsHtml + '<div class="game-instruction">Clicca su un suggerimento o scrivi: <code>/game guess [titolo]</code></div>'}
    </div>
  `;
}

/* ── Render UI verità/bugia ──────────────────────────────────── */
function renderTruthLieGameUI() {
  const statements = gameData.truthLie.statements;
  const votesCount = gameData.truthLie.votes.size;
  const userId = state.currentUser?.id;
  const hasVoted = gameData.truthLie.votes.has(userId);
  
  let statementsHtml = '';
  if (statements.length > 0) {
    statements.forEach((stmt, idx) => {
      const isVoted = hasVoted && gameData.truthLie.votes.get(userId) === idx;
      statementsHtml += `
        <div class="game-statement ${isVoted ? 'voted' : ''}" data-statement="${idx}">
          <span class="game-statement-num">${idx + 1}.</span>
          <span class="game-statement-text">${escHtml(stmt)}</span>
          ${!hasVoted ? `<button class="game-vote-btn" data-vote="${idx + 1}">Vota</button>` : ''}
          ${isVoted ? '<span class="game-voted-badge">✓ Votato</span>' : ''}
        </div>
      `;
    });
  } else {
    statementsHtml = '<div class="game-instruction">In attesa delle affermazioni dall\'host...</div>';
  }
  
  return `
    <div class="games-panel-content">
      <div class="game-host">👤 Host: ${escHtml(gameData.truthLie.host)}</div>
      ${statementsHtml}
      <div class="game-stats">🗳️ Voti: ${votesCount}</div>
      ${hasVoted ? '<div class="game-instruction">✅ Hai già votato! Attendi il risultato...</div>' : '<div class="game-instruction">Clicca "Vota" su un\'affermazione o scrivi: <code>/game vote [1/2/3]</code></div>'}
    </div>
  `;
}

/* ── Render UI quiz ───────────────────────────────────────────── */
function renderQuizGameUI() {
  const question = gameData.quiz.currentQuestion;
  const answersCount = gameData.quiz.answers.size;
  const questionNum = gameData.quiz.questionIndex + 1;
  const totalQuestions = gameData.quiz.questions.length;
  const userId = state.currentUser?.id;
  const hasAnswered = gameData.quiz.answers.has(userId);
  
  if (!question) {
    return '<div class="games-panel-content">Caricamento domanda...</div>';
  }
  
  /* Raggruppa risposte per opzione */
  const answersByOption = new Map();
  question.options.forEach(opt => {
    answersByOption.set(opt, []);
  });
  
  gameData.quiz.answers.forEach((data, uid) => {
    const userAnswer = typeof data === 'string' ? data : data.answer;
    const user = findUser(uid);
    const username = user?.name || user?.username || (typeof data === 'object' ? data.username : null) || 'Utente';
    
    /* Trova l'opzione corrispondente (case-insensitive) */
    const matchingOption = question.options.find(opt => 
      opt.toLowerCase() === userAnswer.toLowerCase()
    );
    
    if (matchingOption) {
      const existing = answersByOption.get(matchingOption) || [];
      existing.push({ userId: uid, username, isMe: uid === userId });
      answersByOption.set(matchingOption, existing);
    }
  });
  
  let optionsHtml = '';
  question.options.forEach((opt, idx) => {
    const letter = String.fromCharCode(65 + idx);
    const usersWhoAnswered = answersByOption.get(opt) || [];
    const userCount = usersWhoAnswered.length;
    const isMyAnswer = usersWhoAnswered.some(u => u.isMe);
    
    let usersListHtml = '';
    if (userCount > 0) {
      const usersList = usersWhoAnswered
        .map(u => u.isMe ? '<strong>Tu</strong>' : escHtml(u.username))
        .join(', ');
      usersListHtml = `<div class="game-option-users">👥 ${usersList} ${userCount > 1 ? `(${userCount})` : ''}</div>`;
    }
    
    optionsHtml += `
      <button class="game-option-btn ${hasAnswered ? 'disabled' : ''} ${isMyAnswer ? 'my-answer' : ''}" 
              data-answer="${escHtml(opt)}" ${hasAnswered ? 'disabled' : ''}>
        <span class="game-option-letter">${letter}</span>
        <div class="game-option-content">
          <span class="game-option-text">${escHtml(opt)}</span>
          ${usersListHtml}
        </div>
      </button>
    `;
  });
  
  return `
    <div class="games-panel-content">
      <div class="game-question-number">Domanda ${questionNum}/${totalQuestions}</div>
      <div class="game-question">${escHtml(question.q)}</div>
      <div class="game-options-container">${optionsHtml}</div>
      <div class="game-stats">👥 Totale risposte: ${answersCount}</div>
      ${hasAnswered ? '<div class="game-instruction">✅ Hai già risposto! Attendi il risultato...</div>' : '<div class="game-instruction">Clicca su una risposta o scrivi: <code>/game answer [risposta]</code></div>'}
    </div>
  `;
}

/* ── Render pannello giochi iniziale ─────────────────────────── */
function renderGamesPanel() {
  if (!dom.gamesPanelBody) return;
  updateGamesPanel();
}

/* ── Rimossa: lista utenti ora gestita dal usersPanel separato ──── */

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

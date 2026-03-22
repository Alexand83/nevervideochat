/* ================================================================
   supabase-client.js  — Supabase init + realtime subscriptions
================================================================ */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { state }           from './state.js';
import { dom }             from './dom.js';
import { showToast, playChatNotificationSoundIfEnabled } from './utils.js';
import { ensureUser, syncPresence, updateOwnPresence, handleTyping, renderUsers, noteChatMessageFromUser } from './users.js?v=20260462';
import { addMessage, extractQuote, renderMessage, handleReactionUpdate, updateMessageReactions } from './chat.js?v=20260463';
import { handleIncomingPM } from './private-chat.js';
import { handleCamRequest, handleCamAccepted, handleWebRTCSignal, handleCamClosed,
         closeCameraWindow, endCall, setRemoteSenderVideoOff } from './camera.js?v=20260471';
import { clearPendingCamRequest } from './storage.js';

/** Messaggi broadcast più vecchi di questo non mostrano toast/UI (evita replay al login/reconnect) */
const BROADCAST_UI_MAX_AGE_MS = 25000;
const BROADCAST_SESSION_SKEW_MS = 5000;

function isBroadcastTooOld(payload) {
  const ts = payload?.ts;
  if (typeof ts !== 'number') return false;
  if (Date.now() - ts > BROADCAST_UI_MAX_AGE_MS) return true;
  /* Stesso criterio Firebase: niente UI da broadcast inviati prima di questa connessione al canale */
  if (state.broadcastConnectedAt > 0 && ts < state.broadcastConnectedAt - BROADCAST_SESSION_SKEW_MS) return true;
  return false;
}

/* Flag per indicare se la sessione è appena stata creata (non controllare subito) */
let sessionJustCreated = false;
let sessionCreationTime = 0;
let isDisconnectingOthers = false; /* Flag per indicare che stiamo disconnettingo le altre sessioni */
let sessionCheckInterval = null; /* Intervallo per controllare periodicamente la sessione */
/* Grazia prima di mostrare login su disconnect (es. tab in background su smartphone): 1 minuto per rientrare */
let disconnectGraceTimer = null;
let reconnectingSupabase = false;
/* Timestamp ultima volta che la scheda è passata a hidden (evita race: disconnect arriva dopo visibility visible) */
let lastHiddenAt = 0;
const GRACE_AFTER_HIDDEN_MS = 120000; /* 2 min: grazia se tab era nascosto da meno di 2 min */
let graceReconnectInterval = null; /* retry reconnect ogni 15s quando in grazia e tab visibile */

export function initSupabaseClient() {
  if (!SUPABASE_URL.includes('supabase.co') || SUPABASE_ANON_KEY.startsWith('YOUR_')) {
    console.warn('[NVC] Supabase not configured — local-only mode.'); return false;
  }
  state.supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastHiddenAt = Date.now();
    } else if (disconnectGraceTimer && state.currentUser) {
      console.log('[Supabase] Tab visible again — trying to reconnect...');
      connectSupabase();
      if (!graceReconnectInterval) {
        graceReconnectInterval = setInterval(() => {
          if (!disconnectGraceTimer || !state.currentUser) return;
          connectSupabase();
        }, 15000);
      }
    }
  });
  
  /* Listener per rilevare quando la sessione viene invalidata (disconnessione da altra sessione) */
  state.supa.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      /* Sessione appena creata/aggiornata - imposta flag per non controllare subito */
      sessionJustCreated = true;
      sessionCreationTime = Date.now();
      /* Dopo 30 secondi, rimuovi il flag (allineato con markSessionAsNew) */
      setTimeout(() => {
        sessionJustCreated = false;
      }, 30000);
    }
    if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
      /* Solo se non è una nuova sessione appena creata E non stiamo disconnettingo altre sessioni */
      if (!sessionJustCreated && !isDisconnectingOthers) {
        console.warn('[Auth] Session invalidated - user was disconnected');
        showDisconnectedOverlay();
      }
    }
  });
  
  return true;
}

/* ── Marca che una nuova sessione è stata creata (chiamato dopo login) ── */
export function markSessionAsNew() {
  sessionJustCreated = true;
  sessionCreationTime = Date.now();
  /* Aumenta il tempo di protezione a 30 secondi per dare tempo alla sessione di stabilizzarsi completamente */
  setTimeout(() => {
    sessionJustCreated = false;
  }, 30000); /* 30 secondi di grazia per stabilizzare la sessione */
}

/* ── Marca che stiamo disconnettingo le altre sessioni (per evitare falsi positivi) ── */
export function markDisconnectingOthers() {
  isDisconnectingOthers = true;
  setTimeout(() => {
    isDisconnectingOthers = false;
  }, 10000); /* 10 secondi di protezione durante la disconnessione */
}

/* ── Programma overlay di disconnessione dopo delay (es. 90s grazia per tab in background) ── */
export function scheduleDisconnectedOverlay(delayMs) {
  if (disconnectGraceTimer) clearTimeout(disconnectGraceTimer);
  if (graceReconnectInterval) {
    clearInterval(graceReconnectInterval);
    graceReconnectInterval = null;
  }
  disconnectGraceTimer = setTimeout(() => {
    disconnectGraceTimer = null;
    if (graceReconnectInterval) {
      clearInterval(graceReconnectInterval);
      graceReconnectInterval = null;
    }
    showDisconnectedOverlay(true); /* forceShow: timer scaduto, mostra senza rivalutare grazia */
  }, delayMs);
  /* Se tab visibile, ritenta reconnect ogni 15s così non aspetti 90s al desk */
  if (document.visibilityState === 'visible' && state.currentUser) {
    graceReconnectInterval = setInterval(() => {
      if (!disconnectGraceTimer || !state.currentUser) return;
      connectSupabase();
    }, 15000);
  }
  console.log('[Supabase] Disconnect overlay scheduled in', delayMs / 1000, 's (grace period)');
}

/* ── Annulla la grazia (es. utente è tornato e connesso) ── */
export function clearDisconnectGrace() {
  if (disconnectGraceTimer) {
    clearTimeout(disconnectGraceTimer);
    disconnectGraceTimer = null;
    console.log('[Supabase] Disconnect grace cancelled');
  }
  if (graceReconnectInterval) {
    clearInterval(graceReconnectInterval);
    graceReconnectInterval = null;
  }
}

/* ── Mostra overlay di disconnessione (forceShow=true quando scatta il timer di grazia) ── */
export async function showDisconnectedOverlay(forceShow) {
  if (!state.currentUser) return;

  /* Già in grazia: non sovrascrivere (altri trigger non devono mostrare subito) */
  if (!forceShow && disconnectGraceTimer) return;

  /* Timer scaduto o tab visibile e non "recently hidden": mostra subito. Altrimenti grazia 90s */
  if (!forceShow) {
    const recentlyHidden = lastHiddenAt && (Date.now() - lastHiddenAt < GRACE_AFTER_HIDDEN_MS);
    if (document.hidden || recentlyHidden) {
      console.log('[Supabase] Disconnect while tab hidden/recent — 90s grace before login');
      scheduleDisconnectedOverlay(90000);
      return;
    }
  }

  clearDisconnectGrace();
  console.log('[Supabase] Session invalidated - redirecting to login');

  /* Ferma subito il controllo periodico sessione e canale Realtime per evitare blocchi al ritorno online */
  stopSessionCheckInterval();
  if (state.signalCh) {
    try { state.signalCh.unsubscribe(); } catch (_) {}
    state.signalCh = null;
  }

  /* Resetta stato camera così al re-ingresso (guest/login) la cam non risulta attiva in Eventi */
  try {
    const { resetCameraStateOnDisconnect } = await import('./camera.js?v=20260471');
    resetCameraStateOnDisconnect();
  } catch (e) {
    console.warn('[Supabase] resetCameraStateOnDisconnect failed:', e);
  }

  /* Mostra di nuovo app-main e app-header */
  const appMain = document.querySelector('.app-main');
  const appHeader = document.querySelector('.app-header');
  if (appMain) appMain.style.display = '';
  if (appHeader) appHeader.style.display = '';

  /* Pulisci lo stato dell'utente */
  state.currentUser = null;
  localStorage.removeItem('nvc_identity');
  localStorage.removeItem('nvc_auth_session');
  localStorage.removeItem('nvc_browser_session_id');
  localStorage.removeItem('nvc_session_id');
  sessionStorage.removeItem('nvc_browser_session_id');
  sessionStorage.removeItem('nvc_session_id');

  /* Disconnetti da Supabase (solo locale se offline, per non bloccare al ritorno online) */
  if (state.supa) {
    state.supa.auth.signOut().catch(err => {
      console.warn('[Supabase] Error signing out:', err);
    });
  }

  /* Mostra il modal di login/registrazione */
  const authModal = document.getElementById('authModal');
  if (authModal) {
    authModal.hidden = false;
    authModal.style.zIndex = '9999';
    authModal.style.pointerEvents = 'auto';
  }

  /* Nascondi altri modali/overlay che potrebbero bloccare i clic */
  const adminPanel = document.getElementById('adminPanel');
  if (adminPanel) adminPanel.hidden = true;
}

/* ── Load and subscribe to a specific room ── */
export async function connectRoom(roomId) {
  console.log('[Supabase] connectRoom called for room:', roomId);
  if (!state.supa || !state.rooms[roomId]) {
    console.warn('[Supabase] connectRoom: Missing supa or room', { hasSupa: !!state.supa, hasRoom: !!state.rooms[roomId] });
    return;
  }
  const room = state.rooms[roomId];

  /* ── 1. Clear old messages - new users don't see old messages ── */
  room.messages = [];
  if (roomId === state.activeRoom && dom.msgsContainer) {
    dom.msgsContainer.innerHTML = '';
    /* Show welcome banner if no messages */
    if (dom.welcomeBanner && !dom.welcomeBanner.parentNode) {
      dom.msgsContainer.appendChild(dom.welcomeBanner);
    }
  }

  /* ── 2. Don't load old messages - only show new ones from now on ── */
  console.log('[Supabase] connectRoom: Setting up message subscription for room', roomId);

  /* ── 2. Subscribe to new messages and reaction updates (Postgres Changes) ── */
  const dbSub = state.supa.channel(`db-messages-${roomId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, ({ new: m }) => {
      if (!m?.id || !m.reactions) return;
      const room = state.rooms[roomId];
      const msg = room?.messages?.find(mess => mess.id === m.id);
      if (msg) {
        msg.reactions = m.reactions;
        if (roomId === state.activeRoom && dom.msgsContainer) {
          const group = dom.msgsContainer.querySelector(`[data-msg-id="${m.id}"]`);
          if (group) updateMessageReactions(group, m.reactions);
        }
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, async ({ new: m }) => {
      /* NON controllare la sessione ad ogni messaggio - troppo aggressivo e causa falsi positivi */
      /* La sessione viene controllata solo in caso di errori espliciti (403, etc.) */
      try {
      if (m.user_id === state.currentUser.id) {
        /* This is our own message - update the temp ID with the DB UUID */
        const room = state.rooms[roomId];
        if (room) {
          /* Correlazione per ordine: primo INSERT = messaggio temp più vecchio (evita reazioni sul messaggio sbagliato) */
          const ourTempMessages = room.messages
            .filter(msg => (msg.userId === 'me' || msg.userId === state.currentUser.id) && msg.id && String(msg.id).startsWith('m') && String(msg.id).length < 30)
            .sort((a, b) => (a.ts || 0) - (b.ts || 0));
          const tempMsg = ourTempMessages[0] || null;
          if (tempMsg) {
            const oldId = tempMsg.id;
            tempMsg.id = m.id;
            /* Preserva reazioni locali (aggiunte prima che arrivasse l'id reale); poi persisti sul server */
            const serverReactions = m.reactions || {};
            const hadLocalReactions = tempMsg.reactions && Object.keys(tempMsg.reactions).length > 0;
            if (hadLocalReactions && (!serverReactions || Object.keys(serverReactions).length === 0)) {
              /* Merge: mantieni le locali e salvale sul server */
              tempMsg.reactions = tempMsg.reactions || {};
              try {
                await state.supa.from('messages').update({ reactions: tempMsg.reactions }).eq('id', m.id);
              } catch (err) {
                console.warn('[Supabase] Could not persist local reactions on confirm', err);
              }
            } else {
              tempMsg.reactions = Object.keys(serverReactions).length > 0 ? serverReactions : (tempMsg.reactions || {});
            }
            const group = dom.msgsContainer.querySelector(`[data-msg-id="${oldId}"]`);
            if (group) {
              group.dataset.msgId = m.id;
              updateMessageReactions(group, tempMsg.reactions);
            }
          }
        }
        return; /* already rendered optimistically */
      }
      if (state.ignoredUsers[String(m.user_id)]) {
        console.log('[Supabase] Message ignored (user is in ignored list)');
        return;
      }
      noteChatMessageFromUser(roomId, m.user_id, m.username);
      const { html, quoteHtml, quoteName } = extractQuote(m.content);
      console.log('[Supabase] Adding message to room:', { roomId, userId: m.user_id, hasHtml: !!html });
      addMessage({ userId: m.user_id, username: m.username, html, quoteHtml, quoteName, ts: new Date(m.created_at).getTime(), reactions: m.reactions || {}, msgId: m.id }, roomId);
      if (roomId === state.activeRoom) playChatNotificationSoundIfEnabled();
      } catch (err) {
        console.error('[Supabase] Error processing new message:', err);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Supabase] ✅ Subscribed to messages for room ${roomId}`);
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`[Supabase] ❌ Error subscribing to messages for room ${roomId}`);
      } else {
        console.log(`[Supabase] Message subscription status for room ${roomId}:`, status);
      }
    });

  room.dbSub = dbSub;
}

/* ── Verifica periodicamente se la sessione è ancora valida ── */
function startSessionCheckInterval() {
  /* Clear existing interval */
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
  }
  
  /* Check every 5 seconds if session is still valid */
  sessionCheckInterval = setInterval(async () => {
    if (!state.supa || !state.currentUser) return;
    
    /* NON controllare per utenti guest (non hanno sessione Supabase) */
    if (state.currentUser.isGuest) return;
    
    /* NON controllare se stiamo disconnettingo le altre sessioni */
    if (isDisconnectingOthers) return;
    
    /* NON controllare se la sessione è appena stata creata */
    if (sessionJustCreated) {
      const timeSinceCreation = Date.now() - sessionCreationTime;
      if (timeSinceCreation < 30000) return; /* 30 secondi di grazia */
    }
    
    try {
      /* Prova prima con getSession() */
      let session = await state.supa.auth.getSession();
      
      /* Se getSession() non trova la sessione, prova a recuperarla da localStorage */
      if (!session?.data?.session?.access_token) {
        const stored = JSON.parse(localStorage.getItem('nvc_auth_session') || 'null');
        if (stored?.access_token) {
          console.log('[Session Check] getSession() returned null, trying to restore from localStorage...');
          const { error: restoreError } = await state.supa.auth.setSession({
            access_token: stored.access_token,
            refresh_token: stored.refresh_token
          });
          if (!restoreError) {
            session = await state.supa.auth.getSession();
            console.log('[Session Check] Session restored from localStorage');
          }
        }
      }
      
      if (!session?.data?.session?.access_token) {
        /* Se non c'è sessione ma l'utente è registrato, potrebbe essere un problema */
        /* Ma non loggare come warning se è un guest */
        if (!state.currentUser.isGuest) {
          console.warn('[Session Check] No active session for registered user — showing login modal');
          showDisconnectedOverlay();
        }
        return;
      }
      
      /* CRITICO: Usa lo stesso sessionId salvato in localStorage, non generarne uno nuovo dal token */
      /* Il database ha l'UUID salvato, non i primi 40 caratteri del JWT */
      const { getSavedSessionId, createSessionId } = await import('./auth.js');
      const savedSessionId = getSavedSessionId();
      const sessionId = savedSessionId || createSessionId(session.data.session.access_token);
      
      console.log('[Session Check] Verifying session:', {
        userId: state.currentUser.id,
        hasSavedSessionId: !!savedSessionId,
        sessionId: sessionId?.substring(0, 20) + '...'
      });
      
      /* CRITICO: Verifica usando funzione SQL - più sicuro */
      try {
        const { data: isValid, error: checkError } = await state.supa
          .rpc('is_session_valid', {
            p_user_id: state.currentUser.id,
            p_session_id: sessionId
          });
        
        if (checkError) {
          console.error('[Session Check] Error calling is_session_valid RPC:', checkError);
          /* Se la funzione non esiste, continua (sistema non configurato) */
          if (checkError.code === '42883' || checkError.message?.includes('function') || checkError.message?.includes('does not exist')) {
            console.log('[Session Check] SQL function does not exist - skipping check (system not configured)');
          }
          return;
        }
        
        /* La funzione restituisce TRUE se la sessione è valida, FALSE altrimenti */
        if (!isValid) {
          console.warn('[Session Check] Session is NOT valid - this is an OLD session from another browser - disconnecting');
          showDisconnectedOverlay();
          if (sessionCheckInterval) {
            clearInterval(sessionCheckInterval);
            sessionCheckInterval = null;
          }
          return;
        }
        
        console.log('[Session Check] ✅ Session verified - is valid');
      } catch (err) {
        console.error('[Session Check] Exception:', err);
        /* Ignora errori per non bloccare l'app */
      }
    } catch (err) {
      console.warn('[Session Check] Error in periodic check:', err);
    }
  }, 5000); /* Check every 5 seconds */
}

/* ── Stop periodic session check ── */
function stopSessionCheckInterval() {
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
    sessionCheckInterval = null;
  }
}

/* ── Connect global signal channel + all rooms ── */
export async function connectSupabase() {
  console.log('[Supabase] 🔌 connectSupabase called');
  if (!state.supa) {
    console.warn('[Supabase] connectSupabase: state.supa is null!');
    showToast('⚠️ Supabase not configured — local mode.'); return;
  }
  if (reconnectingSupabase) return;
  reconnectingSupabase = true;
  try {
    /* Chiudi canale precedente se esiste (evita duplicati) */
    if (state.signalCh) {
      try { state.signalCh.unsubscribe(); } catch (_) {}
      state.signalCh = null;
    }
    /* ── Global signal channel (WebRTC, PM, cam requests — user-to-user) ── */
    state.broadcastConnectedAt = Date.now();
    state.signalCh = state.supa.channel('broadcast:signals-main');
    
    /* CRITICO: Se c'è un pending session invalidation broadcast, invialo ora che il canale è pronto */
    if (state.pendingSessionInvalidation) {
      try {
        const { broadcastAll } = await import('./broadcast.js');
        const pending = Array.isArray(state.pendingSessionInvalidation) 
          ? state.pendingSessionInvalidation 
          : [state.pendingSessionInvalidation];
        for (const invalidation of pending) {
          broadcastAll('session-invalidated', invalidation);
        }
        console.log('[Supabase] 📢 Sent pending session-invalidated broadcast(s)');
        delete state.pendingSessionInvalidation;
      } catch (err) {
        console.error('[Supabase] Error sending pending session-invalidated broadcast:', err);
      }
    }
    
    state.signalCh
      .on('broadcast', { event: 'typing'       }, ({ payload }) => {
        if (isBroadcastTooOld(payload)) return;
        handleTyping(payload);
      })
      .on('broadcast', { event: 'pm'           }, ({ payload }) => {
        if (isBroadcastTooOld(payload)) return; /* replay al reconnect: non riaprire chat privata */
        handleIncomingPM(payload);
      })
      .on('broadcast', { event: 'webrtc'       }, ({ payload }) => handleWebRTCSignal(payload))
      .on('broadcast', { event: 'cam-req'      }, ({ payload }) => {
        if (isBroadcastTooOld(payload)) return;
        handleCamRequest(payload);
      })
      .on('broadcast', { event: 'cam-accepted' }, ({ payload }) => {
        if (isBroadcastTooOld(payload)) return;
        handleCamAccepted(payload);
      })
      .on('broadcast', { event: 'cam-rejected' }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (isBroadcastTooOld(payload)) return; /* replay al login: non mostrare toast vecchi */
        clearPendingCamRequest(String(payload.from));
        if (payload.reason === 'wrong-room') {
          showToast(`📵 ${payload.fromName || 'User'} is in a different room — camera not available.`);
        } else {
          showToast(`❌ ${payload.fromName || 'User'} declined your camera request.`);
        }
      })
      .on('broadcast', { event: 'cam-revoked'  }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (isBroadcastTooOld(payload)) return; /* replay al login: non mostrare toast vecchi */
        const fromId = String(payload.from);
        if (state.cameraWindows[fromId]) closeCameraWindow(fromId);
        showToast('📵 Camera access revoked.');
      })
      .on('broadcast', { event: 'cam-watcher-left' }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (isBroadcastTooOld(payload)) return;
        import('./camera.js?v=20260471').then(({ handleCamWatcherLeftFromSignal }) =>
          handleCamWatcherLeftFromSignal(payload.from));
      })
      .on('broadcast', { event: 'cam-opened'   }, async ({ payload }) => {
        if (isBroadcastTooOld(payload)) return;
        if (String(payload.from) === String(state.currentUser?.id)) return;
        const fromId   = String(payload.from);
        const camRoom  = payload.room_id || null;   /* room where cam was activated */
        if (payload.videoOff !== undefined) state.remoteVideoOffState[fromId] = !!payload.videoOff;

        console.log('[Supabase] cam-opened received:', { from: fromId, roomId: camRoom });

        /* CRITICO: Update room.users for EVERY joined room — icon true only in camRoom */
        /* Questo assicura che l'icona della camera appaia immediatamente per tutti */
        const { ensureUser, renderUsers } = await import('./users.js');
        const { getAvailableRooms } = await import('./rooms.js');
        
        /* CRITICO: Controlla se la cam è in una stanza eventi */
        const availableRooms = getAvailableRooms();
        const camRoomData = availableRooms.find(r => String(r.id) === String(camRoom));
        const isInCamRoom = camRoom && String(camRoom) === String(state.activeRoom);

        /* CRITICO: La cam va mostrata SOLO nella stanza dove è stata aperta. Se siamo in un'altra stanza, non creare finestra/grid. */
        if (camRoom && !isInCamRoom) {
          console.log('[Supabase] cam-opened: Camera is in room', camRoom, 'but we are in room', state.activeRoom, '- NOT creating camera window');
          for (const [rId, room] of Object.entries(state.rooms)) {
            if (room.users[fromId]) room.users[fromId].hasCamera = (rId === camRoom);
          }
          const u = state.users.find(u => String(u.id) === fromId);
          if (u) u.hasCamera = (String(camRoom) === String(state.activeRoom));
          renderUsers();
          return;
        }

        for (const [rId, room] of Object.entries(state.rooms)) {
          if (room.users[fromId]) {
            /* Aggiorna hasCamera solo se la cam è in questa stanza */
            room.users[fromId].hasCamera = (rId === camRoom);
          } else if (rId === camRoom) {
            /* Se l'utente non è ancora nella stanza ma la cam è qui, aggiungilo */
            const user = ensureUser(fromId, payload.fromName || 'User', { 
              hasCamera: true, 
              online: true 
            });
            room.users[fromId] = {
              ...user,
              hasCamera: true
            };
          }
        }
        
        /* CRITICO: Aggiorna anche state.users per assicurarsi che hasCamera sia disponibile per la preservazione */
        /* Questo è importante perché syncPresence controlla anche state.users per preservare hasCamera */
        /* IMPORTANTE: hasCamera deve essere true se la cam è in QUALSIASI stanza in cui l'utente è presente */
        /* Questo assicura che quando arriva il sync della presenza, hasCamera sia già impostato */
        const u = state.users.find(u => String(u.id) === fromId);
        const inActiveRoom = camRoom && String(camRoom) === String(state.activeRoom);
        
        if (u) {
          /* Se la cam è nella stanza attiva, imposta hasCamera=true, altrimenti preserva il valore esistente se è true */
          /* Questo è importante perché l'utente potrebbe avere la cam aperta in una stanza diversa */
          if (inActiveRoom) {
            u.hasCamera = true;
          } else if (u.hasCamera !== true) {
            /* Se non è nella stanza attiva, preserva il valore esistente (potrebbe essere true da un'altra stanza) */
            /* Non impostare a false qui, perché potrebbe essere true in un'altra stanza */
          }
        } else {
          /* Se l'utente non esiste, crealo con hasCamera=true solo se è nella stanza attiva */
          ensureUser(fromId, payload.fromName || 'User', { hasCamera: inActiveRoom, online: true });
        }
        
        /* CRITICO: Marca questa camera come aperta via broadcast per prevenire che il sync la sovrascriva */
        /* Il flag scade dopo 10 secondi per permettere al sync di aggiornare correttamente se la camera viene chiusa */
        state.camerasOpenedViaBroadcast[fromId] = Date.now();
        setTimeout(() => {
          delete state.camerasOpenedViaBroadcast[fromId];
        }, 10000);
        
        /* Forza re-render immediato */
        renderUsers();
        
        /* Events room: update grid; if we still don't have this camera after delay, request (covers late joiners) */
        if (camRoom === state.activeRoom && inActiveRoom) {
          const { updateEventsCamGrid } = await import('./rooms.js');
          updateEventsCamGrid();
          const isEventsRoom = camRoomData?.max_cams && camRoomData.max_cams >= 1 && camRoomData.max_cams <= 8;
          if (isEventsRoom && !state.cameraWindows[fromId] && !state.incomingPCs?.[fromId]) {
            setTimeout(() => {
              if (state.activeRoom !== camRoom) return;
              if (state.cameraWindows[fromId] || state.incomingPCs?.[fromId]) return;
              import('./camera.js?v=20260471').then(({ requestPublicCamera }) => requestPublicCamera(fromId, { skipCooldown: true, forceRetry: true, pendingTtlMs: 5000, silentPendingExpiry: true }));
            }, 500);
          }
        }
      })
      .on('broadcast', { event: 'cam-video-off' }, ({ payload }) => {
        if (String(payload.from) === String(state.currentUser?.id)) return;
        const fromId = String(payload.from);
        state.remoteVideoOffState[fromId] = !!payload.videoOff;
        setRemoteSenderVideoOff(fromId, !!payload.videoOff);
      })
      .on('broadcast', { event: 'cam-closed'   }, ({ payload }) => handleCamClosed(payload))
      .on('broadcast', { event: 'call-ended'   }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (isBroadcastTooOld(payload)) return; /* replay al login: non mostrare toast vecchi */
        if (!dom.vcallWin.hidden) { endCall(false); showToast(`📵 ${payload.fromName} ended the call.`); }
      })
      .on('broadcast', { event: 'reaction-update' }, ({ payload }) => handleReactionUpdate(payload))
      .on('broadcast', { event: 'user-kicked' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        
        const { closeAllCamerasForUser } = await import('./camera.js?v=20260471');
        if (isCurrentUser || state.cameraWindows[targetId]) {
          await closeAllCamerasForUser(targetId);
        }
        
        if (isCurrentUser) {
          /* Replay-safe: verify kick still in DB */
          try {
            if (state.fb?.firestore) {
              const snap = await state.fb.firestore.collection('kicked_users').where('user_id', '==', targetId).get();
              const now = new Date();
              const hasValidKick = snap.docs.some(d => {
                const d_ = d.data();
                const expVal = d_.expires_at;
                const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
                if (!exp || exp <= now) return false;
                if (payload.is_global) return true;
                return String(d_.room_id) === String(payload.room_id);
              });
              if (!hasValidKick) return;
            }
          } catch (_) { return; }
          const roomId = payload.room_id;
          if (!state.kickedUsers[targetId]) state.kickedUsers[targetId] = {};
          if (payload.is_global) {
            for (const rId of Object.keys(state.rooms)) {
              state.kickedUsers[targetId][String(rId)] = payload.expires_at;
            }
            const { leaveRoom, renderRoomTabs } = await import('./rooms.js');
            for (const rId of Object.keys(state.rooms)) {
              await leaveRoom(rId, { silent: true, force: true });
            }
            renderRoomTabs();
            const { showKickOverlay } = await import('./kick-ban.js');
            await showKickOverlay(null, payload.expires_at, true);
          } else {
            state.kickedUsers[targetId][String(roomId)] = payload.expires_at;
            const { leaveRoom, renderRoomTabs } = await import('./rooms.js');
            if (state.rooms[roomId]) {
              await leaveRoom(roomId, { silent: true, force: true });
              renderRoomTabs();
            }
            const { showKickOverlay } = await import('./kick-ban.js');
            await showKickOverlay(roomId, payload.expires_at, false);
          }
        }
      })
      .on('broadcast', { event: 'user-banned' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        
        const { closeAllCamerasForUser } = await import('./camera.js?v=20260471');
        if (isCurrentUser || state.cameraWindows[targetId]) {
          await closeAllCamerasForUser(targetId);
        }
        
        if (isCurrentUser) {
          /* Replay-safe: verify ban still exists in DB (avoid stale broadcast after unban) */
          try {
            if (state.fb?.firestore) {
              const snap = await state.fb.firestore.collection('banned_users').where('user_id', '==', targetId).limit(1).get();
              if (snap.empty) return; /* Unbanned — ignore replayed user-banned */
              const data = snap.docs[0].data();
              const expVal = data.expires_at;
              const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
              if (exp && exp <= new Date()) return; /* Expired — ignore */
            }
          } catch (_) { return; }
          state.bannedUsers[targetId] = { expires_at: payload.expires_at, reason: payload.reason };
          const { leaveRoom, renderRoomTabs } = await import('./rooms.js');
          for (const rId of Object.keys(state.rooms)) {
            await leaveRoom(rId);
          }
          renderRoomTabs();
          const { showBanOverlay } = await import('./kick-ban.js');
          showBanOverlay(payload.reason || 'No reason provided', payload.expires_at);
        } else {
          const uidStr = String(targetId);
          for (const rId of Object.keys(state.rooms || {})) {
            if (state.rooms[rId]?.users[uidStr]) delete state.rooms[rId].users[uidStr];
          }
          const u = state.users.find(us => String(us.id) === uidStr);
          if (u) u.online = false;
          const { renderUsers } = await import('./users.js');
          renderUsers();
        }
      })
      .on('broadcast', { event: 'user-unbanned' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        delete state.bannedUsers[targetId];
        state.bannedUserIds?.delete?.(String(targetId));
        if (String(targetId) === String(state.currentUser?.id)) {
          const { hideKickBanOverlay } = await import('./kick-ban.js');
          hideKickBanOverlay();
          document.body.classList.remove('kick-ban-active');
          /* Reload so full init runs (rooms, firebase, etc.) without ban */
          window.location.reload();
        }
      })
      .on('broadcast', { event: 'user-muted' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        const roomId = payload.room_id ?? null;
        
        /* Replay-safe: verify mute still in DB */
        try {
          if (state.fb?.firestore) {
            const snap = await state.fb.firestore.collection('muted_users').where('user_id', '==', targetId).get();
            const now = new Date();
            const hasValidMute = snap.docs.some(d => {
              const d_ = d.data();
              const r = d_.room_id ?? null;
              if (String(r) !== String(roomId)) return false;
              const expVal = d_.expires_at;
              const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
              return !exp || exp > now;
            });
            if (!hasValidMute) return;
          }
        } catch (_) { return; }
        
        const { closeAllCamerasForUser, closeCameraWindow } = await import('./camera.js?v=20260471');
        if (isCurrentUser) {
          await closeAllCamerasForUser(targetId);
        } else if (state.cameraWindows[targetId]) {
          await closeCameraWindow(targetId);
        }
        
        state.mutedUsers[targetId] = { room_id: roomId, expires_at: payload.expires_at };
        const { renderUsers } = await import('./users.js');
        renderUsers();
        
        if (isCurrentUser && !isBroadcastTooOld(payload)) {
          const scope = roomId ? 'in this room' : 'globally';
          const duration = payload.duration > 0 ? ` for ${payload.duration} minutes` : ' permanently';
          showToast(`🔇 You have been muted ${scope}${duration}.`);
        }
      })
      .on('broadcast', { event: 'user-unmuted' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const roomId = payload.room_id || null;
        
        /* Remove from muted cache */
        if (roomId === null) {
          /* Global unmute - remove all mutes for this user */
          delete state.mutedUsers[targetId];
        } else {
          /* Room-specific unmute */
          const mute = state.mutedUsers[targetId];
          if (mute && mute.room_id === roomId) {
            delete state.mutedUsers[targetId];
          }
        }
        
        /* Re-render users to remove muted indicator */
        const { renderUsers } = await import('./users.js');
        renderUsers();
      })
      .on('broadcast', { event: 'game-answer' }, async ({ payload }) => {
        /* Aggiorna risposte quiz in tempo reale - solo aggiorna UI, non ricarica tutto */
        if (payload.game_type === 'quiz' && payload.room_id === state.activeRoom) {
          const { updateGamesPanel } = await import('./games.js');
          /* Aggiorna solo l'UI, non ricaricare tutto dal DB */
          setTimeout(() => updateGamesPanel(), 100);
        }
      })
      .on('broadcast', { event: 'game-question' }, async ({ payload }) => {
        /* Aggiorna UI quando arriva una nuova domanda - SOLO se non siamo noi */
        if (payload.game_type === 'quiz' && payload.room_id === state.activeRoom) {
          /* Se siamo noi ad aver inviato il broadcast, non fare nulla - abbiamo già aggiornato */
          if (String(payload.from) === String(state.currentUser?.id)) {
            return;
          }
          /* Aggiorna solo l'UI, NON ricaricare tutto il gioco per evitare conflitti con i timer */
          const { updateGamesPanel } = await import('./games.js');
          setTimeout(() => updateGamesPanel(), 100);
        }
      })
      .on('broadcast', { event: 'game-started' }, async ({ payload }) => {
        /* Aggiorna UI quando un gioco viene avviato nella stanza attiva */
        if (payload.room_id === state.activeRoom && String(payload.from) !== String(state.currentUser?.id)) {
          /* Solo se non siamo noi ad aver avviato il gioco */
          const { checkActiveGame } = await import('./games.js');
          await checkActiveGame();
        }
      })
      .on('broadcast', { event: 'session-invalidated' }, async ({ payload }) => {
        /* CRITICO: Quando una nuova sessione viene registrata per questo utente, verifica immediatamente */
        /* Se questa è la vecchia sessione, disconnetti */
        if (!state.currentUser || !state.currentUser.id) return;
        
        const targetUserId = payload.user_id || payload.userId;
        if (String(targetUserId) !== String(state.currentUser.id)) return; /* Non è per noi */
        
        console.log('[Session] ⚠️ Received session-invalidated broadcast - checking if this session is still valid...');
        
        /* Verifica immediatamente se questa sessione è ancora valida */
        const { verifySessionImmediately } = await import('./auth.js');
        const session = await state.supa.auth.getSession();
        if (session?.data?.session?.access_token) {
          const isValid = await verifySessionImmediately(state.currentUser.id, session.data.session.access_token);
          if (!isValid) {
            console.log('[Session] 🚨 This session is NOT valid - showing disconnect overlay');
            showDisconnectedOverlay();
          } else {
            console.log('[Session] ✅ This session is still valid - ignoring broadcast');
          }
        }
      })
      .on('broadcast', { event: 'force-disconnect' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        if (!state.currentUser || !targetId) return;
        const isCurrentUser = String(targetId) === String(state.currentUser.id);
        try {
          const { closeAllCamerasForUser } = await import('./camera.js?v=20260471');
          if (isCurrentUser || state.cameraWindows[targetId]) {
            await closeAllCamerasForUser(targetId);
          }
        } catch (_) {}
        if (isCurrentUser) {
          const roomIds = Object.keys(state.rooms || {});
          const { leaveRoom, renderRoomTabs } = await import('./rooms.js');
          for (const rId of roomIds) {
            await leaveRoom(rId, { silent: true, force: true });
          }
          renderRoomTabs();
          console.log('[Supabase] force-disconnect received - left rooms, showing disconnect overlay');
          showDisconnectedOverlay(true);
        } else {
          const uidStr = String(targetId);
          for (const rId of Object.keys(state.rooms || {})) {
            if (state.rooms[rId]?.users[uidStr]) delete state.rooms[rId].users[uidStr];
          }
          const u = state.users.find(u => String(u.id) === uidStr);
          if (u) u.online = false;
          const { renderUsers } = await import('./users.js');
          renderUsers();
        }
      })
      .subscribe((status) => {
        /* Canale chiuso/timeout/errore → showDisconnectedOverlay (grazia 60s se tab hidden, gestita dentro) */
        if ((status === 'CLOSED' || status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') && state.currentUser) {
          showDisconnectedOverlay();
        }
      });

    clearDisconnectGrace();
    showToast('🟢 Connected to NeverVideoChat');
    console.log('[NVC] Supabase connected.');
    
    /* Avvia il controllo periodico della sessione */
    startSessionCheckInterval();
  } catch (err) {
    console.error('[NVC] Connection error:', err);
    /* Se è un errore 403, significa che la sessione è stata invalidata */
    if (err?.status === 403 || err?.message?.includes('403') || err?.code === 'PGRST301') {
      showDisconnectedOverlay();
    } else {
      showToast('⚠️ Could not connect — check your credentials.');
    }
  } finally {
    reconnectingSupabase = false;
  }
}

/* ── Controlla se la sessione è ancora valida ── */
/* ── Controlla se la sessione è ancora valida (chiamato solo in caso di errori espliciti) ── */
async function checkSessionInvalid() {
  if (!state.supa || !state.currentUser) return false;
  
  /* NON controllare se stiamo disconnettingo le altre sessioni (evita falsi positivi) */
  if (isDisconnectingOthers) {
    return false;
  }
  
  /* NON controllare se la sessione è appena stata creata (durante inizializzazione) */
  if (sessionJustCreated) {
    const timeSinceCreation = Date.now() - sessionCreationTime;
    /* Se è passato meno di 30 secondi dalla creazione, non controllare (aumentato per sicurezza) */
    if (timeSinceCreation < 30000) {
      return false;
    }
  }
  
  try {
    const { data: { user }, error } = await state.supa.auth.getUser();
    if (error || !user) {
      /* Solo se non è una nuova sessione appena creata E non stiamo disconnettingo altre sessioni */
      if (!sessionJustCreated && !isDisconnectingOthers) {
        console.warn('[Auth] Session invalid - user was disconnected');
        showDisconnectedOverlay();
        return true;
      }
      return false;
    }
    return false;
  } catch (err) {
    /* Se è un errore 403, la sessione è stata invalidata */
    if (err?.status === 403 || err?.message?.includes('403')) {
      /* Solo se non è una nuova sessione appena creata E non stiamo disconnettingo altre sessioni */
      if (!sessionJustCreated && !isDisconnectingOthers) {
        console.warn('[Auth] Session invalid (403) - user was disconnected');
        showDisconnectedOverlay();
        return true;
      }
      return false;
    }
    return false;
  }
}

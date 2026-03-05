/* ================================================================
   supabase-client.js  — Supabase init + realtime subscriptions
================================================================ */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { state }           from './state.js';
import { dom }             from './dom.js';
import { showToast, playNotificationSound } from './utils.js';
import { ensureUser, syncPresence, updateOwnPresence, handleTyping, renderUsers } from './users.js';
import { addMessage, extractQuote, renderMessage, handleReactionUpdate } from './chat.js';
import { handleIncomingPM } from './private-chat.js';
import { handleCamRequest, handleCamAccepted, handleWebRTCSignal, handleCamClosed,
         closeCameraWindow, endCall } from './camera.js?v=20260438';
import { clearPendingCamRequest } from './storage.js';

/* Flag per indicare se la sessione è appena stata creata (non controllare subito) */
let sessionJustCreated = false;
let sessionCreationTime = 0;
let isDisconnectingOthers = false; /* Flag per indicare che stiamo disconnettingo le altre sessioni */
let sessionCheckInterval = null; /* Intervallo per controllare periodicamente la sessione */

export function initSupabaseClient() {
  if (!SUPABASE_URL.includes('supabase.co') || SUPABASE_ANON_KEY.startsWith('YOUR_')) {
    console.warn('[NVC] Supabase not configured — local-only mode.'); return false;
  }
  state.supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
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

/* ── Mostra overlay di disconnessione ── */
export function showDisconnectedOverlay() {
  const overlay = document.getElementById('disconnectedOverlay');
  if (overlay) {
    overlay.hidden = false;
    /* Nascondi tutto il resto */
    const appMain = document.querySelector('.app-main');
    const appHeader = document.querySelector('.app-header');
    if (appMain) appMain.style.display = 'none';
    if (appHeader) appHeader.style.display = 'none';
  }
}

/* ── Load and subscribe to a specific room ── */
export async function connectRoom(roomId) {
  if (!state.supa || !state.rooms[roomId]) return;
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

  /* ── 2. Subscribe to new messages (Postgres Changes filtered by room_id) ── */
  const dbSub = state.supa.channel(`db-messages-${roomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, async ({ new: m }) => {
      /* NON controllare la sessione ad ogni messaggio - troppo aggressivo e causa falsi positivi */
      /* La sessione viene controllata solo in caso di errori espliciti (403, etc.) */
      try {
      if (m.user_id === state.currentUser.id) {
        /* This is our own message - update the temp ID with the DB UUID */
        const room = state.rooms[roomId];
        if (room) {
          /* Find the most recent message from us without a DB ID */
          const tempMsg = room.messages
            .filter(msg => msg.userId === 'me' || msg.userId === state.currentUser.id)
            .find(msg => msg.id.startsWith('m') && msg.id.length < 20);
          if (tempMsg) {
            const oldId = tempMsg.id;
            tempMsg.id = m.id;
            tempMsg.reactions = m.reactions || {};
            /* Update DOM - search with old ID before updating */
            const group = dom.msgsContainer.querySelector(`[data-msg-id="${oldId}"]`);
            if (group) {
              group.dataset.msgId = m.id;
              /* Re-render to show reactions if any */
              if (m.reactions && Object.keys(m.reactions).length > 0) {
                group.remove();
                renderMessage(tempMsg);
              }
            }
          }
        }
        return; /* already rendered optimistically */
      }
      if (state.ignoredUsers[String(m.user_id)]) return;
      ensureUser(m.user_id, m.username);
      const { html, quoteHtml, quoteName } = extractQuote(m.content);
      addMessage({ userId: m.user_id, username: m.username, html, quoteHtml, quoteName, ts: new Date(m.created_at).getTime(), reactions: m.reactions || {}, msgId: m.id }, roomId);
      if (roomId === state.activeRoom) playNotificationSound();
      } catch (err) {
        console.error('[Supabase] Error processing new message:', err);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Supabase] Subscribed to messages for room ${roomId}`);
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`[Supabase] Error subscribing to messages for room ${roomId}`);
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
    
    /* NON controllare se stiamo disconnettingo le altre sessioni */
    if (isDisconnectingOthers) return;
    
    /* NON controllare se la sessione è appena stata creata */
    if (sessionJustCreated) {
      const timeSinceCreation = Date.now() - sessionCreationTime;
      if (timeSinceCreation < 30000) return; /* 30 secondi di grazia */
    }
    
    try {
      const session = await state.supa.auth.getSession();
      if (!session?.data?.session?.access_token) {
        console.warn('[Session Check] No active session found');
        return;
      }
      
      const sessionId = session.data.session.access_token.substring(0, 40);
      const savedSessionId = localStorage.getItem('nvc_session_id');
      
      /* Controllo rapido: se l'ID salvato non corrisponde, questa è una vecchia sessione */
      if (savedSessionId && savedSessionId !== sessionId) {
        console.warn('[Session Check] Session ID mismatch - disconnecting old session');
        showDisconnectedOverlay();
        if (sessionCheckInterval) {
          clearInterval(sessionCheckInterval);
          sessionCheckInterval = null;
        }
        return;
      }
      
      /* Verifica nel database */
      const { data: isValid, error: checkError } = await state.supa.rpc('is_session_valid', {
        p_user_id: state.currentUser.id,
        p_session_id: sessionId
      });
      
      if (checkError) {
        console.warn('[Session Check] Error checking session:', checkError);
        /* Se la funzione non esiste, potrebbe essere che lo script SQL non sia stato eseguito */
        if (checkError.message?.includes('function') || checkError.code === '42883') {
          console.error('[Session Check] CRITICAL: is_session_valid function not found! Execute supabase_active_sessions.sql in Supabase!');
        }
      } else if (isValid === false) {
        /* Questa NON è la sessione attiva - disconnettere immediatamente */
        console.warn('[Session Check] Session is not valid - disconnecting');
        showDisconnectedOverlay();
        if (sessionCheckInterval) {
          clearInterval(sessionCheckInterval);
          sessionCheckInterval = null;
        }
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
  if (!state.supa) {
    showToast('⚠️ Supabase not configured — local mode.'); return;
  }
  try {
    /* ── Global signal channel (WebRTC, PM, cam requests — user-to-user) ── */
    state.signalCh = state.supa.channel('broadcast:signals-main');
    state.signalCh
      .on('broadcast', { event: 'typing'       }, ({ payload }) => handleTyping(payload))
      .on('broadcast', { event: 'pm'           }, ({ payload }) => handleIncomingPM(payload))
      .on('broadcast', { event: 'webrtc'       }, ({ payload }) => handleWebRTCSignal(payload))
      .on('broadcast', { event: 'cam-req'      }, ({ payload }) => handleCamRequest(payload))
      .on('broadcast', { event: 'cam-accepted' }, ({ payload }) => handleCamAccepted(payload))
      .on('broadcast', { event: 'cam-rejected' }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        clearPendingCamRequest(String(payload.from));
        if (payload.reason === 'wrong-room') {
          showToast(`📵 ${payload.fromName || 'User'} is in a different room — camera not available.`);
        } else {
          showToast(`❌ ${payload.fromName || 'User'} declined your camera request.`);
        }
      })
      .on('broadcast', { event: 'cam-revoked'  }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        const fromId = String(payload.from);
        if (state.cameraWindows[fromId]) closeCameraWindow(fromId);
        showToast('📵 Camera access revoked.');
      })
      .on('broadcast', { event: 'cam-opened'   }, async ({ payload }) => {
        if (String(payload.from) === String(state.currentUser?.id)) return;
        const fromId   = String(payload.from);
        const camRoom  = payload.room_id || null;   /* room where cam was activated */

        /* Update room.users for EVERY joined room — icon true only in camRoom */
        for (const [rId, room] of Object.entries(state.rooms)) {
          if (room.users[fromId]) {
            /* Aggiorna hasCamera solo se la cam è in questa stanza */
            room.users[fromId].hasCamera = (rId === camRoom);
          }
        }
        /* Keep global state.users in sync (used as fallback) */
        const inMyRoom = !camRoom || camRoom === state.activeRoom;
        const u = state.users.find(u => String(u.id) === fromId);
        if (u) u.hasCamera = inMyRoom;
        else if (inMyRoom) ensureUser(fromId, payload.fromName, { hasCamera: true, online: true });
        /* Forza re-render immediato */
        renderUsers();
        
        /* Events room: update grid when cam-opened received */
        /* NOTE: We do NOT call requestPublicCamera here because the camera owner
           already auto-shares with everyone in startOwnCamera (push model).
           Requesting here would create DUPLICATE WebRTC connections. */
        if (camRoom === state.activeRoom && inMyRoom) {
          const { updateEventsCamGrid } = await import('./rooms.js');
          updateEventsCamGrid();
        }
      })
      .on('broadcast', { event: 'cam-closed'   }, ({ payload }) => handleCamClosed(payload))
      .on('broadcast', { event: 'call-ended'   }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (!dom.vcallWin.hidden) { endCall(false); showToast(`📵 ${payload.fromName} ended the call.`); }
      })
      .on('broadcast', { event: 'reaction-update' }, ({ payload }) => handleReactionUpdate(payload))
      .on('broadcast', { event: 'user-kicked' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        
        /* Close all cameras for the kicked user */
        const { closeAllCamerasForUser } = await import('./camera.js?v=20260438');
        if (isCurrentUser || state.cameraWindows[targetId]) {
          await closeAllCamerasForUser(targetId);
        }
        
        if (isCurrentUser) {
          const roomId = payload.room_id;
          /* Add to kicked cache */
          if (!state.kickedUsers[targetId]) state.kickedUsers[targetId] = {};
          if (payload.is_global) {
            /* Global kick: add to all rooms */
            for (const roomId of Object.keys(state.rooms)) {
              state.kickedUsers[targetId][roomId] = payload.expires_at;
            }
            /* Leave all rooms and show kick overlay */
            const { leaveRoom } = await import('./rooms.js');
            const { renderRoomTabs } = await import('./rooms.js');
            for (const rId of Object.keys(state.rooms)) {
              await leaveRoom(rId);
            }
            renderRoomTabs();
            const { showKickOverlay } = await import('./kick-ban.js');
            await showKickOverlay(null, payload.expires_at, true);
          } else {
            state.kickedUsers[targetId][roomId] = payload.expires_at;
            /* If in that room, leave it and show kick overlay */
            if (state.activeRoom === roomId) {
              const { leaveRoom } = await import('./rooms.js');
              const { renderRoomTabs } = await import('./rooms.js');
              await leaveRoom(roomId);
              renderRoomTabs();
              const { showKickOverlay } = await import('./kick-ban.js');
              await showKickOverlay(roomId, payload.expires_at, false);
            }
          }
        }
      })
      .on('broadcast', { event: 'user-banned' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        
        /* Close all cameras for the banned user */
        const { closeAllCamerasForUser } = await import('./camera.js?v=20260438');
        if (isCurrentUser || state.cameraWindows[targetId]) {
          await closeAllCamerasForUser(targetId);
        }
        
        if (isCurrentUser) {
          /* Add to banned cache with reason */
          state.bannedUsers[targetId] = { 
            expires_at: payload.expires_at,
            reason: payload.reason 
          };
          /* Leave all rooms and show ban overlay */
          const { leaveRoom } = await import('./rooms.js');
          const { renderRoomTabs } = await import('./rooms.js');
          for (const rId of Object.keys(state.rooms)) {
            await leaveRoom(rId);
          }
          renderRoomTabs();
          const { showBanOverlay } = await import('./kick-ban.js');
          showBanOverlay(payload.reason || 'No reason provided', payload.expires_at);
        }
      })
      .on('broadcast', { event: 'user-muted' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        
        /* Close all cameras for the muted user - always close if we're viewing their cam */
        const { closeAllCamerasForUser, closeCameraWindow } = await import('./camera.js?v=20260438');
        if (isCurrentUser) {
          await closeAllCamerasForUser(targetId);
        } else if (state.cameraWindows[targetId]) {
          /* Close their camera window (works for both floating and Events grid) */
          await closeCameraWindow(targetId);
        }
        
        const roomId = payload.room_id || null;
        /* Add to muted cache */
        state.mutedUsers[targetId] = { room_id: roomId, expires_at: payload.expires_at };
        
        /* Re-render users to show muted indicator */
        const { renderUsers } = await import('./users.js');
        renderUsers();
        
        if (isCurrentUser) {
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
      .subscribe();

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

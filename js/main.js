/* ================================================================
   main.js  — entry point: wires all modules together
================================================================ */
import { state }              from './state.js';
import { dom }                from './dom.js';
import { showToast }          from './utils.js';
import { APP_VERSION }        from './config.js';
import { loadRejectedCams, loadIgnoredUsers, loadDeviceSettings } from './storage.js';
import { initFirebaseClient, connectFirebase, connectRoom } from './firebase-client.js';
import { applyAuthIdentity, getOrCreateGuestIdentity,
         initAuthModal, initProfileModal, initSettingsModal, updateHeaderUser, loadUserSettingsFromProfile } from './auth.js';
import { initRooms, joinRoom, setLoadRoomMessages, setRenderMessage, renderRoomTabs, closeRoomPicker } from './rooms.js';
import { renderUsers, setOpenContextMenu } from './users.js';
import { addMessage, renderMessage, sendMessage, clearReplyTo, setChatDeps, initSearch, handleReactionUpdate, initMentionDropdown } from './chat.js';
import { setPChatDeps } from './private-chat.js';
import { initCameraSystem, initCallControls } from './camera.js?v=20260318';
import { initToolbar, initImageAttach, uploadToStorage, initEmojiPicker,
         initVoiceRecording, initContextMenu, openContextMenu,
         initPanelResize, initMobilePanel, setUIDeps, applyRichTextSettings } from './ui.js';
import { initAdminPanel, updateAdminButton } from './admin.js';
import { broadcast } from './broadcast.js';
import { initGames, handleGameCommand } from './games.js';

/* ── Wire cross-module forward references ── */
setOpenContextMenu(openContextMenu);   /* users.js → context menu */
setRenderMessage(renderMessage);       /* rooms.js → chat renderer */
setLoadRoomMessages(connectRoom);      /* rooms.js → Firebase room loader */

const supabaseReady = () => !!state.fb;
setChatDeps(openContextMenu, uploadToStorage, supabaseReady, renderRoomTabs, broadcast, handleGameCommand);
setPChatDeps(supabaseReady);
setUIDeps(uploadToStorage, supabaseReady);

/* ── Main init ── */
/* ── Filtra warning innocui dei cookie Cloudflare ── */
function filterCookieWarnings() {
  const originalWarn = console.warn;
  const originalError = console.error;
  
  console.warn = function(...args) {
    const message = args.join(' ');
    /* Ignora warning innocui dei cookie Cloudflare */
    if (message.includes('__cf_bm') || 
        message.includes('cookie') && message.includes('rifiutato') ||
        message.includes('cookie') && message.includes('domain')) {
      return; /* Non mostrare questi warning */
    }
    originalWarn.apply(console, args);
  };
  
  console.error = function(...args) {
    const message = args.join(' ');
    /* Ignora errori innocui dei cookie Cloudflare */
    if (message.includes('__cf_bm') || 
        (message.includes('cookie') && message.includes('rifiutato')) ||
        (message.includes('cookie') && message.includes('domain'))) {
      return; /* Non mostrare questi errori */
    }
    originalError.apply(console, args);
  };
}

async function init() {
  /* Filtra warning cookie prima di inizializzare */
  filterCookieWarnings();

  /* Versione in header vicino al logo */
  const appVersionEl = document.getElementById('appVersion');
  if (appVersionEl) appVersionEl.textContent = 'v' + APP_VERSION;
  
  /* CRITICO: Chiudi la propria cam quando si aggiorna la pagina (per gli altri utenti) */
  window.addEventListener('beforeunload', async () => {
    try {
      /* Chiudi la propria cam se attiva - questo invierà il broadcast cam-closed agli altri */
      if (state.localStream && state.cameraRoom) {
        const { broadcastAll } = await import('./broadcast.js');
        const { updateAllRoomPresences } = await import('./users.js');
        /* Invia broadcast che la cam è chiusa */
        broadcastAll('cam-closed', { room_id: state.cameraRoom });
        /* Aggiorna presenza per rimuovere hasCamera */
        await updateAllRoomPresences();
        /* Ferma il stream */
        state.localStream.getTracks().forEach(t => t.stop());
      }
      /* Chiudi tutte le cam remote che stiamo guardando */
      if (state.cameraWindows) {
        for (const uid of Object.keys(state.cameraWindows)) {
          if (String(uid) !== String(state.currentUser?.id)) {
            const { closeCameraWindow } = await import('./camera.js?v=20260318');
            await closeCameraWindow(uid).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.warn('[Main] Error closing cameras on unload:', err);
    }
  });

  window.addEventListener('offline', () => {
    if (!navigator.onLine && state.currentUser) {
      import('./firebase-client.js').then(({ showDisconnectedOverlay }) => showDisconnectedOverlay());
    }
  });
  window.addEventListener('online', () => {
    import('./firebase-client.js').then(({ clearDisconnectGrace }) => clearDisconnectGrace());
  });
  /* 1. Init UI subsystems */
  initToolbar(); initImageAttach(); initEmojiPicker(); initVoiceRecording();
  initMentionDropdown();
  initContextMenu(); initCameraSystem(); initCallControls();
  initMobilePanel(); initPanelResize();
  initAuthModal(); initProfileModal(); initSettingsModal();
  initSearch();
  initAdminPanel();

  /* 2. Create Firebase client (auth, Firestore, Realtime DB, Storage) */
  initFirebaseClient();

  /* CRITICO: Imposta finishInit PRIMA che l'utente possa fare login */
  const { setFinishInit } = await import('./auth.js');
  setFinishInit(finishInit);
  console.log('[Main] ✅ finishInit registered in auth module');

  /* OBBLIGATORIO: Nessun ripristino sessione/guest. Modal login solo a: caricamento pagina, offline, sessione invalidata. Il cambio stanza NON apre il modal. */
  localStorage.removeItem('nvc_identity');
  localStorage.removeItem('nvc_auth_session');
  localStorage.removeItem('nvc_browser_session_id');
  localStorage.removeItem('nvc_session_id');
  sessionStorage.removeItem('nvc_browser_session_id');
  sessionStorage.removeItem('nvc_session_id');

  dom.authModal.hidden = false;
}

/** Called after a user identity has been established */
export async function finishInit() {
  console.log('[Main] 🚀 finishInit called', { hasCurrentUser: !!state.currentUser, userId: state.currentUser?.id });
  /* Reset stato camera: dopo refresh la cam non deve ripartire (nessun restore) */
  state.localStream = null;
  state.cameraRoom = null;
  state.cameraWindows = {};
  state.outgoingPCs = {};
  state.camViewers = {};
  if (state.currentUser) state.currentUser.hasCamera = false;
  try {
    const { dom } = await import('./dom.js');
    if (dom.cameraBtnLabel) dom.cameraBtnLabel.textContent = 'Camera Off';
    if (dom.cameraBtnHeader) dom.cameraBtnHeader.classList.remove('camera-on');
  } catch (_) {}
  /* CONTROLLO IMMEDIATO: Verifica la sessione all'entrata iniziale (solo per utenti registrati) */
  if (state.currentUser && !state.currentUser.isGuest && state.fb) {
    try {
      const session = await state.fb.auth.getSession();
      if (session?.data?.session?.access_token) {
        const { verifySessionImmediately } = await import('./auth.js');
        const isValid = await verifySessionImmediately(state.currentUser.id, session.data.session.access_token);
        if (!isValid) {
          /* Sessione non valida - disconnesso, non continuare l'inizializzazione */
          return;
        }
      }
    } catch (err) {
      console.warn('[Main] Error checking session on init:', err);
    }
  }
  
  /* Load user permissions */
  const { loadUserPermissions } = await import('./permissions.js');
  await loadUserPermissions();
  
  /* Load and display announcements */
  const { loadAndDisplayAnnouncements, initAnnouncementsListener } = await import('./announcements.js');
  await loadAndDisplayAnnouncements();
  
  /* Initialize word filter */
  const { initWordFilterListener } = await import('./word-filter.js');
  await initWordFilterListener();
  initAnnouncementsListener();
  state.pendingCamRequests = {};
  state.rejectedCamUsers   = loadRejectedCams();
  state.ignoredUsers       = loadIgnoredUsers();
  state.settings = loadDeviceSettings();
  /* Utenti registrati: sovrascrivi con impostazioni dal profilo (DB) */
  if (state.currentUser && !state.currentUser.is_guest && state.fb) {
    try { await loadUserSettingsFromProfile(); } catch (e) { console.warn('[Settings] Load from profile failed', e); }
  }
  applyRichTextSettings(state.settings);
  if (!state.privateChats) state.privateChats = {};
  
  /* Reset games panel width CSS variable to 0 on init (unless in games room) */
  document.documentElement.style.setProperty('--games-panel-width', '0px');
  /* Reset users panel width CSS variable on init */
  document.documentElement.style.setProperty('--users-panel-width', '0px');

  /* Reply cancel button */
  dom.replyPreviewCancel?.addEventListener('click', clearReplyTo);

  /* Click su placeholder immagini in chat: carica immagine (se impostazione "non auto-display" attiva) */
  dom.msgsContainer?.addEventListener('click', (e) => {
    if (e.target?.classList?.contains('msg-img-placeholder')) {
      const src = e.target.dataset?.src;
      if (src) { e.target.src = src; e.target.classList.remove('msg-img-placeholder'); }
    }
  });

  /* Load and apply user theme and language */
  if (state.currentUser) {
    const { loadUserTheme } = await import('./themes.js');
    const { initI18n, setLanguage } = await import('./i18n.js');
    await loadUserTheme();
    setLanguage(state.currentUser.language || 'it');
    initI18n();
  }

  /* Load mute/kick/ban status for current user */
  if (state.fb && state.currentUser) {
    /* Crea/aggiorna profilo nel database con ruoli di default */
    await ensureUserProfile(state.currentUser);
    /* Carica nome e colore del ruolo (custom_roles) per presenza e lista utenti */
    await loadCurrentUserRole();

    await loadUserRestrictions(state.currentUser.id);
    await loadBannedUserIds();
    
    /* Check if user is banned - if so, show ban overlay and stop initialization */
    const { checkIsBanned } = await import('./users.js');
    if (checkIsBanned(state.currentUser.id)) {
      const ban = state.bannedUsers[String(state.currentUser.id)];
      const { showBanOverlay } = await import('./kick-ban.js');
      showBanOverlay(ban?.reason || 'You have been banned from all rooms.', ban?.expires_at);
      /* Don't initialize rooms, chat, or any other features - user is banned */
      return;
    }
  }

  /* Init room system (joins general room, subscribes presence + DB) */
  console.log('[Main] Initializing rooms...');
  await initRooms();
  console.log('[Main] ✅ Rooms initialized');
  
  /* Reset games panel width CSS variable after rooms are loaded */
  document.documentElement.style.setProperty('--games-panel-width', '0px');

  /* Connetti a Firebase (broadcast, presence, messages) prima di renderizzare */
  try {
    await connectFirebase();
    console.log('[Main] ✅ Firebase connected - UI ready');
  } catch (err) {
    console.error('[NVC] Error connecting to Firebase:', err);
    showToast('⚠️ Error connecting to server. Some features may not work.');
  }
  
  /* Ora che Supabase è connesso, renderizza utenti e inizializza UI */
  /* CRITICO: Renderizza subito l'utente corrente, poi aggiorna quando la presenza si sincronizza */
  renderUsers(); /* Renderizza subito (almeno l'utente corrente dovrebbe apparire) */
  updateHeaderUser();
  updateAdminButton(); /* Check admin access and show/hide button */
  initGames(); /* Initialize games system */
  
  /* Su mobile, assicura che il pannello utenti parta chiuso nelle stanze normali */
  document.documentElement.style.setProperty('--users-panel-width', '0px');
  
  /* Renderizza di nuovo dopo che la presenza si è sincronizzata */
  setTimeout(() => {
    console.log('[Main] Re-rendering users after presence sync');
    renderUsers();
  }, 1000); /* Aspetta 1 secondo per permettere alla presenza di sincronizzarsi */
  
  dom.msgInput?.focus();
}

/* ── Carica nome e colore del ruolo (custom_roles) per l'utente corrente ── */
async function loadCurrentUserRole() {
  if (!state.fb || !state.currentUser) return;
  if (state.currentUser.isGuest) {
    state.currentUser.roleName = 'Guest';
    state.currentUser.roleColor = '#8b949e';
    return;
  }
  try {
    const profileSnap = await state.fb.firestore.collection('profiles').doc(String(state.currentUser.id)).get();
    const data = profileSnap.exists ? profileSnap.data() : null;
    const customRoleId = data?.custom_role_id;
    if (!customRoleId) {
      state.currentUser.roleName = 'User';
      state.currentUser.roleColor = '#8b949e';
      return;
    }
    const roleSnap = await state.fb.firestore.collection('custom_roles').doc(String(customRoleId)).get();
    const role = roleSnap.exists ? roleSnap.data() : null;
    state.currentUser.roleName = role?.name || 'User';
    state.currentUser.roleColor = role?.color || '#8b949e';
  } catch (_) {
    state.currentUser.roleName = 'User';
    state.currentUser.roleColor = '#8b949e';
  }
}

/* ── Assicura che l'utente abbia un profilo nel database con ruoli di default ── */
async function ensureUserProfile(user) {
  if (!state.fb || !user) return;
  try {
    const ref = state.fb.firestore.collection('profiles').doc(String(user.id));
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? existingSnap.data() : null;
    const payload = {
      username: user.username || user.name,
      display_name: user.name,
      avatar_url: user.avatarUrl || null,
      is_guest: user.isGuest || false,
      updated_at: new Date().toISOString(),
    };
    if (!existing) {
      if (!user.isGuest) payload.role = 'user';
      payload.custom_role_id = user.isGuest ? 'guest' : 'user';
    } else {
      if (existing.role) delete payload.role;
      else if (!user.isGuest) payload.role = 'user';
      if (existing.custom_role_id) delete payload.custom_role_id;
      else payload.custom_role_id = user.isGuest ? 'guest' : 'user';
    }
    await ref.set(payload, { merge: true });
  } catch (err) {
    console.error('[Main] Error ensuring user profile:', err);
  }
}

/* ── Load mute/kick/ban status for current user ── */
async function loadUserRestrictions(userId) {
  if (!state.fb) return;
  /* Clear current user's restrictions first — DB is source of truth (avoids stale state from bfcache / old broadcast) */
  delete state.bannedUsers[userId];
  delete state.mutedUsers[userId];
  state.kickedUsers[userId] = {};
  try {
    /* Muted: repopulate only non-expired from DB */
    const now = new Date();
    const mutedSnap = await state.fb.firestore.collection('muted_users').where('user_id', '==', userId).get();
    mutedSnap.docs.forEach(d => {
      const m = d.data();
      const expVal = m.expires_at;
      const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
      if (!exp || exp > now) {
        state.mutedUsers[userId] = { room_id: m.room_id, expires_at: expVal };
      }
    });
    /* Kicked: populate only non-expired (already reset above) */
    const kickedSnap = await state.fb.firestore.collection('kicked_users').where('user_id', '==', userId).get();
    kickedSnap.docs.forEach(d => {
      const k = d.data();
      const expVal = k.expires_at;
      const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
      if (exp && exp > now) state.kickedUsers[userId][String(k.room_id)] = exp.toISOString();
    });
    /* Banned: only set if ban exists and not expired; store expires_at as ISO string for reliable parsing */
    const bannedSnap = await state.fb.firestore.collection('banned_users').where('user_id', '==', userId).limit(1).get();
    if (!bannedSnap.empty) {
      const banned = bannedSnap.docs[0].data();
      const expVal = banned.expires_at;
      const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
      if (!exp || exp > now) {
        state.bannedUsers[userId] = {
          expires_at: exp ? exp.toISOString() : null,
          reason: banned.reason
        };
      } else {
        delete state.bannedUsers[userId];
      }
    } else {
      delete state.bannedUsers[userId];
    }
  } catch (err) {
    console.error('[Main] Load restrictions error:', err);
    /* On error we already cleared state above — user is not restricted until DB says so */
  }
}

/* ── Carica l'elenco di tutti gli user_id bannati (per non mostrarli in lista anche se presenza fantasma) ── */
async function loadBannedUserIds() {
  if (!state.fb) return;
  try {
    const now = new Date();
    const snap = await state.fb.firestore.collection('banned_users').get();
    state.bannedUserIds = new Set();
    snap.docs.forEach(d => {
      const data = d.data();
      const uid = data.user_id;
      if (!uid) return;
      const expVal = data.expires_at;
      const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
      if (!exp || exp > now) state.bannedUserIds.add(String(uid));
    });
    if (state.bannedUserIds.size) {
      console.log('[Main] Loaded banned user IDs (hidden from list):', [...state.bannedUserIds]);
    }
  } catch (err) {
    console.error('[Main] Load banned user IDs error:', err);
    state.bannedUserIds = new Set();
  }
}

/* Close room picker when clicking outside */
document.addEventListener('click', e => {
  const panel = dom.roomPickerPanel;
  const addBtn = document.getElementById('roomPickerBtn') || document.querySelector('.room-add-btn');
  if (panel && !panel.hidden && !panel.contains(e.target) && e.target !== addBtn) {
    closeRoomPicker();
  }
});

document.addEventListener('DOMContentLoaded', init);

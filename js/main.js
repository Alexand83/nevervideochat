/* ================================================================
   main.js  — entry point: wires all modules together
================================================================ */
import { state }              from './state.js';
import { dom }                from './dom.js';
import { showToast }          from './utils.js';
import { loadRejectedCams, loadIgnoredUsers, loadDeviceSettings } from './storage.js';
import { initSupabaseClient, connectSupabase, connectRoom } from './supabase-client.js';
import { tryRestoreSession, applyAuthIdentity, getOrCreateGuestIdentity,
         initAuthModal, initProfileModal, initSettingsModal, updateHeaderUser } from './auth.js';
import { initRooms, joinRoom, setLoadRoomMessages, setRenderMessage, renderRoomTabs, closeRoomPicker } from './rooms.js';
import { renderUsers, setOpenContextMenu } from './users.js';
import { addMessage, renderMessage, sendMessage, clearReplyTo, setChatDeps, initSearch, handleReactionUpdate } from './chat.js';
import { setPChatDeps } from './private-chat.js';
import { initCameraSystem, initCallControls } from './camera.js?v=20260452';
import { initToolbar, initImageAttach, uploadToStorage, initEmojiPicker,
         initVoiceRecording, initContextMenu, openContextMenu,
         initPanelResize, initMobilePanel, setUIDeps } from './ui.js';
import { initAdminPanel, updateAdminButton } from './admin.js';
import { broadcast } from './broadcast.js';
import { initGames, handleGameCommand } from './games.js';

/* ── Wire cross-module forward references ── */
setOpenContextMenu(openContextMenu);   /* users.js → context menu */
setRenderMessage(renderMessage);       /* rooms.js → chat renderer */
setLoadRoomMessages(connectRoom);      /* rooms.js → supabase room loader */

const supabaseReady = () => !!state.supa;
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
  /* 1. Init UI subsystems */
  initToolbar(); initImageAttach(); initEmojiPicker(); initVoiceRecording();
  initContextMenu(); initCameraSystem(); initCallControls();
  initMobilePanel(); initPanelResize();
  initAuthModal(); initProfileModal(); initSettingsModal();
  initSearch();
  initAdminPanel();

  /* 2. Create Supabase client (needed for auth) */
  initSupabaseClient();

  /* 3. Try to restore a registered session */
  const restoredUser = await tryRestoreSession();
  if (restoredUser) {
    state.currentUser = restoredUser;
    localStorage.setItem('nvc_identity', JSON.stringify(state.currentUser));
    state.settings = loadDeviceSettings();
    await finishInit();
    return;
  }

  /* 4. Check existing guest identity */
  try {
    const stored = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
    if (stored?.id && stored?.name) {
      state.currentUser = stored;
      state.settings    = loadDeviceSettings();
      await finishInit();
      return;
    }
  } catch {}

  /* 5. No identity → show auth modal */
  dom.authModal.hidden = false;
}

/** Called after a user identity has been established */
export async function finishInit() {
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
  if (!state.privateChats) state.privateChats = {};
  
  /* Reset games panel width CSS variable to 0 on init (unless in games room) */
  document.documentElement.style.setProperty('--games-panel-width', '0px');
  /* Reset users panel width CSS variable on init */
  document.documentElement.style.setProperty('--users-panel-width', '0px');

  /* Wire the auth module's finishInit reference */
  const { setFinishInit } = await import('./auth.js');
  setFinishInit(finishInit);

  /* Reply cancel button */
  dom.replyPreviewCancel?.addEventListener('click', clearReplyTo);

  /* Load and apply user theme and language */
  if (state.currentUser) {
    const { loadUserTheme } = await import('./themes.js');
    const { initI18n, setLanguage } = await import('./i18n.js');
    await loadUserTheme();
    setLanguage(state.currentUser.language || 'it');
    initI18n();
  }

  /* Load mute/kick/ban status for current user */
  if (state.supa && state.currentUser) {
    /* Crea/aggiorna profilo nel database con ruoli di default */
    await ensureUserProfile(state.currentUser);
    
    await loadUserRestrictions(state.currentUser.id);
    
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
  await initRooms();
  
  /* Reset games panel width CSS variable after rooms are loaded */
  document.documentElement.style.setProperty('--games-panel-width', '0px');

  renderUsers();
  updateHeaderUser();
  updateAdminButton(); /* Check admin access and show/hide button */
  initGames(); /* Initialize games system */
  connectSupabase().catch(err => console.error('[NVC]', err));
  
  /* Su mobile, assicura che il pannello utenti parta chiuso nelle stanze normali */
  document.documentElement.style.setProperty('--users-panel-width', '0px');
  
  dom.msgInput?.focus();
}

/* ── Assicura che l'utente abbia un profilo nel database con ruoli di default ── */
async function ensureUserProfile(user) {
  if (!state.supa || !user) return;
  
  try {
    const profileData = {
      id: String(user.id),
      username: user.username || user.name,
      display_name: user.name,
      avatar_url: user.avatarUrl || null,
      is_guest: user.isGuest || false,
    };
    
    /* Assegna ruoli di default */
    if (user.isGuest) {
      profileData.custom_role_id = 'guest';
    } else {
      /* Per utenti registrati, assicura che abbiano ruolo 'user' di default */
      profileData.role = 'user';
      profileData.custom_role_id = 'user';
    }
    
    /* Usa upsert per creare o aggiornare, ma non sovrascrivere ruoli esistenti */
    const { data: existing } = await state.supa
      .from('profiles')
      .select('role, custom_role_id')
      .eq('id', String(user.id))
      .maybeSingle();
    
    if (existing) {
      /* Se esiste già, NON sovrascrivere ruoli esistenti */
      if (existing.role) {
        /* L'utente ha già un ruolo (owner, admin, moderator, user) - non sovrascriverlo */
        delete profileData.role;
      } else if (!user.isGuest) {
        /* Solo se non ha ruolo e non è guest, assegna 'user' di default */
        profileData.role = 'user';
      }
      
      if (existing.custom_role_id) {
        /* L'utente ha già un custom_role_id - non sovrascriverlo */
        delete profileData.custom_role_id;
      } else {
        /* Solo se non ha custom_role_id, assegna quello di default */
        profileData.custom_role_id = user.isGuest ? 'guest' : 'user';
      }
    }
    
    await state.supa.from('profiles').upsert(profileData, { onConflict: 'id' });
  } catch (err) {
    console.error('[Main] Error ensuring user profile:', err);
  }
}

/* ── Load mute/kick/ban status for current user ── */
async function loadUserRestrictions(userId) {
  if (!state.supa) return;
  try {
    /* Load muted users */
    const { data: muted, error: muteErr } = await state.supa
      .from('muted_users')
      .select('*')
      .eq('user_id', userId);
    if (!muteErr && muted) {
      muted.forEach(m => {
        if (!state.mutedUsers[userId]) state.mutedUsers[userId] = {};
        state.mutedUsers[userId] = { room_id: m.room_id, expires_at: m.expires_at };
      });
    }
    
    /* Load kicked users */
    const { data: kicked, error: kickErr } = await state.supa
      .from('kicked_users')
      .select('*')
      .eq('user_id', userId);
    if (!kickErr && kicked) {
      state.kickedUsers[userId] = {};
      kicked.forEach(k => {
        state.kickedUsers[userId][k.room_id] = k.expires_at;
      });
    }
    
    /* Load banned users */
    const { data: banned, error: banErr } = await state.supa
      .from('banned_users')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (!banErr && banned) {
      state.bannedUsers[userId] = { 
        expires_at: banned.expires_at,
        reason: banned.reason 
      };
    }
  } catch (err) {
    console.error('[Main] Load restrictions error:', err);
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

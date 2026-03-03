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
import { initCameraSystem, initCallControls } from './camera.js?v=20260418';
import { initToolbar, initImageAttach, uploadToStorage, initEmojiPicker,
         initVoiceRecording, initContextMenu, openContextMenu,
         initPanelResize, initMobilePanel, setUIDeps } from './ui.js';
import { initAdminPanel, updateAdminButton } from './admin.js';
import { broadcast } from './broadcast.js';

/* ── Wire cross-module forward references ── */
setOpenContextMenu(openContextMenu);   /* users.js → context menu */
setRenderMessage(renderMessage);       /* rooms.js → chat renderer */
setLoadRoomMessages(connectRoom);      /* rooms.js → supabase room loader */

const supabaseReady = () => !!state.supa;
setChatDeps(openContextMenu, uploadToStorage, supabaseReady, renderRoomTabs, broadcast);
setPChatDeps(supabaseReady);
setUIDeps(uploadToStorage, supabaseReady);

/* ── Main init ── */
async function init() {
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
  state.pendingCamRequests = {};
  state.rejectedCamUsers   = loadRejectedCams();
  state.ignoredUsers       = loadIgnoredUsers();
  if (!state.privateChats) state.privateChats = {};

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

  renderUsers();
  updateHeaderUser();
  updateAdminButton(); /* Check admin access and show/hide button */
  connectSupabase().catch(err => console.error('[NVC]', err));
  dom.msgInput?.focus();
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

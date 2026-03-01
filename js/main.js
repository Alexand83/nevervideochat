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
import { initCameraSystem, initCallControls } from './camera.js';
import { initToolbar, initImageAttach, uploadToStorage, initEmojiPicker,
         initVoiceRecording, initContextMenu, openContextMenu,
         initPanelResize, initMobilePanel, setUIDeps } from './ui.js';
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

  /* Init room system (joins general room, subscribes presence + DB) */
  await initRooms();

  renderUsers();
  updateHeaderUser();
  connectSupabase().catch(err => console.error('[NVC]', err));
  dom.msgInput?.focus();
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

/* ================================================================
   auth.js  — authentication, profile, settings modal
================================================================ */
import { AUTH_EMAIL_DOMAIN } from './config.js';
import { state }   from './state.js';
import { dom }     from './dom.js';
import { avatarColor, initials, showToast, setAvatarDisplay } from './utils.js';
import { loadDeviceSettings, saveDeviceSettings, removeRejectedCam, removeIgnoredUser } from './storage.js';
import { renderUsers, updateOwnPresence } from './users.js?v=20260462';
import { applyLiveDeviceSettingsIfStreaming } from './camera.js?v=20260466';
import { isSessionValid, upsertActiveSession, showDisconnectedOverlay, resetDisconnectOverlayFlag, restoreChatInputAfterLogin } from './firebase-client.js';

/* Forward refs set by main.js */
let _finishInit = null;
export function setFinishInit(fn) { _finishInit = fn; }

/** Unsubscribe Firestore listener profilo (camera/mic/suoni da DB). */
let _profileSettingsUnsub = null;

async function pushProfileSettingsPatchToFirestore(patch) {
  if (!state.currentUser?.id || state.currentUser.isGuest || !state.fb?.firestore) return;
  try {
    await state.fb.firestore.collection('profiles').doc(String(state.currentUser.id)).update(patch);
  } catch (err) {
    console.warn('[Auth] Profile settings sync failed:', err);
  }
}

/** Sincronizza cameraId + micId correnti su Firestore (es. dopo cambio da footer cam). Import dinamico da camera.js per evitare cicli. */
export function syncProfileMediaDevicesFromState() {
  const cam = state.settings?.cameraId || '';
  const mic = state.settings?.micId || '';
  void pushProfileSettingsPatchToFirestore({
    cameraId: cam || null,
    micId: mic || null,
  });
}

function setDeviceSelectValueIfKnown(selectEl, value) {
  if (!selectEl) return;
  const v = value || '';
  if (v === '' || [...selectEl.options].some((o) => o.value === v)) selectEl.value = v;
}

/**
 * Aggiorna state + localStorage + UI quando il documento profilo cambia (altro tab / altro device).
 * Se camera/mic cambiano, applica allo stream attivo.
 */
function handleProfileSettingsRemoteUpdate(data) {
  if (!data || !state.currentUser?.id) return;

  const soundChatDb = data.soundChat !== undefined ? data.soundChat : data.sound_chat;
  const soundPMDb = data.soundPM !== undefined ? data.soundPM : data.sound_pm;

  const nextCam = data.cameraId != null ? String(data.cameraId) : '';
  const nextMic = data.micId != null ? String(data.micId) : '';
  const curCam = String(state.settings?.cameraId ?? '');
  const curMic = String(state.settings?.micId ?? '');

  const prevSoundChat = state.settings?.soundChat !== false;
  const prevSoundPM = state.settings?.soundPM !== false;
  let nextSoundChat = prevSoundChat;
  let nextSoundPM = prevSoundPM;
  if (soundChatDb !== undefined) nextSoundChat = soundChatDb !== false;
  if (soundPMDb !== undefined) nextSoundPM = soundPMDb !== false;

  const camChanged = nextCam !== curCam;
  const micChanged = nextMic !== curMic;
  const soundChatChanged = nextSoundChat !== prevSoundChat;
  const soundPMChanged = nextSoundPM !== prevSoundPM;

  if (!camChanged && !micChanged && !soundChatChanged && !soundPMChanged) return;

  const merged = {
    ...loadDeviceSettings(),
    ...state.settings,
    cameraId: nextCam,
    micId: nextMic,
    soundChat: nextSoundChat,
    soundPM: nextSoundPM,
  };
  state.settings = merged;
  saveDeviceSettings(merged);

  setDeviceSelectValueIfKnown(dom.cameraDeviceSelect, nextCam);
  setDeviceSelectValueIfKnown(dom.micDeviceSelect, nextMic);
  const soundChatEl = document.getElementById('settingsSoundChat');
  const soundPMEl = document.getElementById('settingsSoundPM');
  if (soundChatChanged && soundChatEl) soundChatEl.checked = nextSoundChat;
  if (soundPMChanged && soundPMEl) soundPMEl.checked = nextSoundPM;

  if (camChanged || micChanged) {
    void applyLiveDeviceSettingsIfStreaming({ cameraId: curCam, micId: curMic });
  }
}

export function subscribeOwnProfileSettingsListener() {
  if (typeof _profileSettingsUnsub === 'function') {
    _profileSettingsUnsub();
  }
  _profileSettingsUnsub = null;
  if (!state.currentUser?.id || state.currentUser.isGuest || !state.fb?.firestore) return;

  const ref = state.fb.firestore.collection('profiles').doc(String(state.currentUser.id));
  _profileSettingsUnsub = ref.onSnapshot(
    (snap) => {
      if (snap.exists) handleProfileSettingsRemoteUpdate(snap.data());
    },
    (err) => console.warn('[Auth] Profile settings listener:', err)
  );
}

export function unsubscribeOwnProfileSettingsListener() {
  if (typeof _profileSettingsUnsub === 'function') {
    _profileSettingsUnsub();
  }
  _profileSettingsUnsub = null;
}

/* ── Auth helpers ──────────────────────────────────────────────── */
function nickToEmail(nick) {
  return `${nick.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}@${AUTH_EMAIL_DOMAIN}`;
}

/* ── Crea un ID univoco per la sessione (UUID per TAB) ── */
/* CRITICO: sessionStorage è per-tab. Così due tab = due session_id; al login in una tab
   Firestore active_sessions viene aggiornato con la nuova tab → l'altra tab vede session_id
   diverso dal proprio e si disconnette (una sola sessione attiva). */
function createSessionId(accessToken) {
  let sessionId = sessionStorage.getItem('nvc_browser_session_id');
  if (!sessionId) {
    sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    sessionStorage.setItem('nvc_browser_session_id', sessionId);
    console.log('[Auth] Generated new browser session ID (this tab):', sessionId.substring(0, 30) + '...');
  } else {
    console.log('[Auth] Using existing browser session ID (this tab):', sessionId.substring(0, 30) + '...');
  }
  return sessionId;
}

/* ── Salva l'ID della sessione (per-tab) ── */
function saveSessionId(sessionId) {
  sessionStorage.setItem('nvc_session_id', sessionId);
}

/* ── Ottieni l'ID della sessione salvato (questo tab) ── */
export function getSavedSessionId() {
  return sessionStorage.getItem('nvc_browser_session_id');
}

/* ── Verifica immediatamente se la sessione è valida ── */
export async function verifySessionImmediately(userId, accessToken) {
  if (!state.fb || !userId || !accessToken) return false;
  try {
    const sessionId = createSessionId(accessToken);
    const savedSessionId = getSavedSessionId();
    const isValid = await isSessionValid(userId, sessionId);
    if (!isValid) {
      showDisconnectedOverlay();
      clearAuthSession();
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

export async function registerUser(nick, password) {
  const { data, error } = await state.fb.auth.signUp({ email: nickToEmail(nick), password });
  if (error) throw error;
  const userId = data.user.id;
  await state.fb.firestore.collection('profiles').doc(String(userId)).set({
    id: userId, username: nick, display_name: nick, is_guest: false, role: 'user', custom_role_id: 'user', updated_at: new Date().toISOString(),
  }, { merge: true });
  if (data.session) persistAuthSession(data.session);
  return { userId, nick, avatarUrl: null };
}

export async function loginUser(nick, password) {
  const { data, error } = await state.fb.auth.signInWithPassword({ email: nickToEmail(nick), password });
  if (error) throw error;
  if (data.session) persistAuthSession(data.session);
  if (data.session?.access_token) {
    try {
      const sessionId = createSessionId(data.session.access_token);
      saveSessionId(sessionId);
      await upsertActiveSession(data.user.id, sessionId);
      try {
        const { broadcastAll } = await import('./broadcast.js');
        if (state.signalCh && state.signalCh.send) {
          broadcastAll('session-invalidated', { user_id: data.user.id, userId: data.user.id });
        } else {
          if (!state.pendingSessionInvalidation) state.pendingSessionInvalidation = [];
          state.pendingSessionInvalidation.push({ user_id: data.user.id, userId: data.user.id });
        }
      } catch (_) {}
    } catch (err) {
      console.warn('[Auth] Error registering active session:', err);
    }
  }
  if (data.session?.access_token && state.fb) await verifySessionImmediately(data.user.id, data.session.access_token);
  const { markSessionAsNew, markDisconnectingOthers } = await import('./firebase-client.js');
  markSessionAsNew();
  markDisconnectingOthers();
  if (data.session) persistAuthSession(data.session);
  markSessionAsNew();
  const profileSnap = await state.fb.firestore.collection('profiles').doc(String(data.user.id)).get();
  const profile = profileSnap.exists ? profileSnap.data() : null;
  const displayName = profile?.display_name || profile?.username || nick;
  return {
    userId: data.user.id,
    nick: displayName,
    username: profile?.username || nick,
    avatarUrl: profile?.avatar_url || null,
    theme_id: profile?.theme_id || 'dark',
    language: profile?.language || 'it',
  };
}

export async function logoutUser() {
  clearAuthSession();
  localStorage.removeItem('nvc_identity');
  try { await state.fb?.auth.signOut(); } catch {}
  location.reload();
}

function persistAuthSession(session) {
  localStorage.setItem('nvc_auth_session', JSON.stringify({
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
  }));
}
function clearAuthSession() { localStorage.removeItem('nvc_auth_session'); }

export async function tryRestoreSession() {
  if (!state.fb) return null;
  let { data } = await state.fb.auth.getSession();
  if (!data?.user?.id) {
    try {
      const cached = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
      if (cached?.id && cached?.name && cached.isGuest === false) {
        localStorage.removeItem('nvc_identity');
        return null;
      }
      if (cached?.isGuest && state.fb.auth.signInAnonymously) {
        const { data: anonData, error } = await state.fb.auth.signInAnonymously();
        if (!error && anonData?.user?.id) {
          const uid = anonData.user.id;
          const name = cached.name || `Guest_${uid.slice(-6)}`;
          const user = { id: uid, name, username: null, avatarUrl: null, isGuest: true, online: true, hasCamera: false };
          localStorage.setItem('nvc_identity', JSON.stringify(user));
          return user;
        }
      }
    } catch (_) {}
    return null;
  }
  if (data.user.isAnonymous) {
    const uid = data.user.id;
    const cached = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
    const name = (cached?.id === uid && cached?.name) ? cached.name : `Guest_${uid.slice(-6)}`;
    const user = { id: uid, name, username: null, avatarUrl: null, isGuest: true, online: true, hasCamera: false };
    localStorage.setItem('nvc_identity', JSON.stringify(user));
    return user;
  }
  const token = data.session?.access_token;
  if (!token) return null;
  let sessionId = getSavedSessionId() || createSessionId(token);
  try {
    const isValid = await isSessionValid(data.user.id, sessionId);
    if (isValid === false) {
      showDisconnectedOverlay();
      clearAuthSession();
      return null;
    }
    if (!getSavedSessionId()) sessionStorage.setItem('nvc_browser_session_id', sessionId);
    await verifySessionImmediately(data.user.id, token);
    const { markSessionAsNew } = await import('./firebase-client.js');
    markSessionAsNew();
    const profileSnap = await state.fb.firestore.collection('profiles').doc(String(data.user.id)).get();
    const profile = profileSnap.exists ? profileSnap.data() : null;
    const cachedId = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
    const displayName = profile?.display_name || profile?.username || cachedId?.name || `User_${data.user.id.slice(0, 6)}`;
    const user = {
      id: data.user.id,
      name: displayName,
      username: profile?.username || displayName,
      avatarUrl: profile?.avatar_url || null,
      isGuest: false,
      online: true,
      hasCamera: false,
      theme_id: profile?.theme_id || 'dark',
      language: profile?.language || 'it'
    };
    localStorage.setItem('nvc_identity', JSON.stringify(user));
    return user;
  } catch (err) {
    console.warn('[Auth] Session restore error:', err);
    return null;
  }
}

export function applyAuthIdentity(id, name, username, avatarUrl, isGuest, themeId = 'dark', language = 'it') {
  resetDisconnectOverlayFlag();
  restoreChatInputAfterLogin();
  state.currentUser = { 
    id, 
    name, 
    username: username || null, 
    avatarUrl: avatarUrl || null, 
    isGuest, 
    online: true, 
    hasCamera: false,
    theme_id: themeId,
    language: language
  };
  localStorage.setItem('nvc_identity', JSON.stringify(state.currentUser));
}

export function getOrCreateGuestIdentity() {
  try {
    const stored = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
    if (stored?.id && stored?.name && stored?.isGuest !== false) return { ...stored, hasCamera: false };
  } catch {}
  const id   = `guest_${Math.random().toString(36).slice(2, 10)}`;
  const name = `Guest_${id.slice(6, 12)}`;
  const user = { id, name, username: null, avatarUrl: null, isGuest: true, online: true, hasCamera: false };
  localStorage.setItem('nvc_identity', JSON.stringify(user));
  return user;
}

/* ── Auth modal ────────────────────────────────────────────────── */
export function initAuthModal() {
  dom.authTabLogin?.addEventListener('click',    () => switchAuthTab('login'));
  dom.authTabRegister?.addEventListener('click', () => switchAuthTab('register'));

  dom.loginForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const nick = dom.loginNick.value.trim(), pwd = dom.loginPwd.value;
    if (!nick || !pwd) return;
    setAuthBtnLoading(dom.loginSubmitBtn, true, 'Signing in…');
    hideAuthError('loginError');
    try {
      const user = await loginUser(nick, pwd);
      applyAuthIdentity(user.userId, user.nick, user.username, user.avatarUrl, false);
      dom.authModal.hidden = true;
      console.log('[Auth] Calling _finishInit after login:', { hasFinishInit: !!_finishInit });
      _finishInit?.();
    } catch (err) {
      showAuthError('loginError', err.message?.includes('Invalid') ? 'Incorrect nickname or password.' : (err.message || 'Sign-in failed.'));
    } finally { setAuthBtnLoading(dom.loginSubmitBtn, false, 'Sign In'); }
  });

  dom.registerForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const nick = dom.regNick.value.trim(), pwd = dom.regPwd.value, confirm = dom.regPwdConfirm.value;
    hideAuthError('registerError');
    if (!nick || nick.length < 3) return showAuthError('registerError', 'Nickname must be at least 3 characters.');
    if (pwd.length < 6)           return showAuthError('registerError', 'Password must be at least 6 characters.');
    if (pwd !== confirm)          return showAuthError('registerError', 'Passwords do not match.');
    setAuthBtnLoading(dom.registerSubmitBtn, true, 'Creating…');
    try {
      const user = await registerUser(nick, pwd);
      applyAuthIdentity(user.userId, nick, nick, null, false);
      dom.authModal.hidden = true;
      _finishInit?.();
    } catch (err) {
      let msg = err.message || 'Registration failed.';
      if (msg.includes('already registered') || msg.includes('already exists')) msg = 'This nickname is already taken.';
      showAuthError('registerError', msg);
    } finally { setAuthBtnLoading(dom.registerSubmitBtn, false, 'Create Account'); }
  });

  dom.guestContinueBtn?.addEventListener('click', async () => {
    if (!state.fb?.auth?.signInAnonymously) {
      showAuthError('loginError', 'Guest login non disponibile al momento. Riprova tra poco.');
      return;
    }
    const btn = dom.guestContinueBtn;
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = '…'; }
    try {
      /* Timeout di 5s: su Chrome mobile con privacy strette Firebase può bloccarsi
         senza mai risolvere né rigettare (indexedDB inaccessibile). */
      const signInPromise = state.fb.auth.signInAnonymously();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('guest-timeout')), 5000)
      );
      const { data, error } = await Promise.race([signInPromise, timeoutPromise]);
      if (error) throw error;
      const uid = data?.user?.id;
      if (!uid) throw new Error('Anonymous sign-in failed');
      const name = `Guest_${uid.slice(-6)}`;
      applyAuthIdentity(uid, name, null, null, true);
      dom.authModal.hidden = true;
      _finishInit?.();
    } catch (err) {
      console.warn('[Auth] Guest sign-in failed:', err.message || err);
      showAuthError('loginError', 'Impossibile entrare come ospite ora. Controlla connessione/browser e riprova.');
      showToast('⚠️ Guest login fallito: autenticazione richiesta per chat/presenza.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Continue as Guest'; }
    }
  });
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  dom.authTabLogin.classList.toggle('active', isLogin);
  dom.authTabRegister.classList.toggle('active', !isLogin);
  dom.loginForm.hidden    = !isLogin;
  dom.registerForm.hidden = isLogin;
  hideAuthError('loginError'); hideAuthError('registerError');
}
function showAuthError(id, msg)  { const el = document.getElementById(id); if (el) { el.textContent = msg; el.hidden = false; } }
function hideAuthError(id)       { const el = document.getElementById(id); if (el) el.hidden = true; }
function setAuthBtnLoading(btn, loading, txt) {
  btn.disabled = loading;
  if (loading) btn.dataset.origText = btn.textContent;
  btn.textContent = loading ? txt : (btn.dataset.origText || btn.textContent);
}

/* ── Profile modal ─────────────────────────────────────────────── */
export function initProfileModal() {
  dom.headerProfileBtn?.addEventListener('click', openProfileModal);
  dom.profileModalClose?.addEventListener('click', () => { dom.profileModal.hidden = true; });
  dom.profileAvatarChangeBtn?.addEventListener('click', async () => {
    const { hasPermission } = await import('./permissions.js');
    const { loadUserPermissions } = await import('./permissions.js');
    await loadUserPermissions();
    if (!hasPermission('can_change_avatar')) {
      showToast('🚫 You do not have permission to change avatar.');
      return;
    }
    dom.profileAvatarInput.click();
  });
  dom.profileAvatarInput?.addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    const { hasPermission } = await import('./permissions.js');
    const { loadUserPermissions } = await import('./permissions.js');
    await loadUserPermissions();
    if (!hasPermission('can_change_avatar')) {
      showToast('🚫 You do not have permission to change avatar.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => setAvatarDisplay(dom.profileAvatarDisplay, null, ev.target.result);
    reader.readAsDataURL(file);
    try {
      const url = await uploadAvatarFile(file);
      if (url) dom.profileAvatarInput.dataset.uploadedUrl = url;
    } catch (err) { showToast('⚠️ Avatar upload failed: ' + err.message); }
    e.target.value = '';
  });
  dom.profileSaveBtn?.addEventListener('click', async () => {
    const { hasPermission } = await import('./permissions.js');
    const { loadUserPermissions } = await import('./permissions.js');
    await loadUserPermissions();
    
    const name = dom.profileNameInput.value.trim();
    if (!name) return showToast('⚠️ Display name cannot be empty.');
    
    /* Check nickname permission */
    if (!hasPermission('can_change_nickname')) {
      showToast('🚫 You do not have permission to change nickname.');
      return;
    }
    
    /* Check avatar permission if avatar changed */
    const newUrl = dom.profileAvatarInput.dataset.uploadedUrl;
    if (newUrl && !hasPermission('can_change_avatar')) {
      showToast('🚫 You do not have permission to change avatar.');
      return;
    }
    
    const finalAvatarUrl = newUrl || state.currentUser.avatarUrl || null;
    dom.profileSaveBtn.disabled = true; dom.profileSaveBtn.textContent = 'Saving…';
    try {
      await saveProfile(name, finalAvatarUrl);
      dom.profileModal.hidden = true; showToast('✅ Profile saved.');
    } catch (err) { showToast('⚠️ Could not save profile: ' + err.message); }
    finally { dom.profileSaveBtn.disabled = false; dom.profileSaveBtn.textContent = 'Save Changes'; }
  });
  dom.profileLogoutBtn?.addEventListener('click', async () => {
    if (!confirm('Log out?')) return; await logoutUser();
  });
  dom.profileSwitchToAuthBtn?.addEventListener('click', () => {
    dom.profileModal.hidden = true; switchAuthTab('login'); dom.authModal.hidden = false;
  });
  dom.profileModal?.addEventListener('click', e => { if (e.target === dom.profileModal) dom.profileModal.hidden = true; });
}

async function openProfileModal() {
  const u = state.currentUser; if (!u) return;
  
  /* Load permissions to check what user can do */
  const { hasPermission, loadUserPermissions } = await import('./permissions.js');
  await loadUserPermissions();
  
  dom.profileNameInput.value = u.name || '';
  delete dom.profileAvatarInput.dataset.uploadedUrl;
  setAvatarDisplay(dom.profileAvatarDisplay, u.name, u.avatarUrl);
  dom.profileAccountInfo.textContent = u.isGuest
    ? 'Guest account — changes apply this session only.'
    : `Registered as @${u.username || u.name}`;
  dom.profileLogoutBtn.hidden       = u.isGuest;
  dom.profileSwitchToAuthBtn.hidden = !u.isGuest;
  
  /* Enable/disable fields based on permissions */
  const canChangeAvatar = hasPermission('can_change_avatar');
  const canChangeNickname = hasPermission('can_change_nickname');
  
  dom.profileAvatarChangeBtn.disabled = !canChangeAvatar;
  dom.profileAvatarChangeBtn.title = canChangeAvatar 
    ? 'Change photo' 
    : 'You do not have permission to change avatar';
  dom.profileNameInput.disabled = !canChangeNickname;
  dom.profileNameInput.title = canChangeNickname 
    ? 'Display name' 
    : 'You do not have permission to change nickname';
  dom.profileSaveBtn.disabled = !canChangeNickname && !canChangeAvatar;
  
  dom.profileModal.hidden = false;
}

const ALLOWED_AVATAR_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
async function uploadAvatarFile(file) {
  if (!state.fb) throw new Error('Not connected.');
  const bucket = state.fb.storage?.from('chat-media');
  if (!bucket?.upload) throw new Error('Storage not available.');
  let ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  if (!ALLOWED_AVATAR_EXT.has(ext)) ext = 'jpg';
  const path = `avatars/${state.currentUser.id}_${Date.now()}.${ext}`;
  const res = await bucket.upload(path, file, { upsert: true });
  if (res.error) throw res.error;
  return res.data?.publicUrl ?? (state.fb.getStoragePublicUrl ? await state.fb.getStoragePublicUrl(path) : '');
}

async function saveProfile(displayName, avatarUrl) {
  state.currentUser.name = displayName;
  if (avatarUrl) state.currentUser.avatarUrl = avatarUrl;
  localStorage.setItem('nvc_identity', JSON.stringify(state.currentUser));
  if (state.fb) {
    const ref = state.fb.firestore.collection('profiles').doc(String(state.currentUser.id));
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? existingSnap.data() : null;
    const payload = {
      username: state.currentUser.username || state.currentUser.name,
      display_name: displayName,
      avatar_url: avatarUrl || null,
      is_guest: state.currentUser.isGuest || false,
      updated_at: new Date().toISOString(),
    };
    if (!existing) {
      payload.role = state.currentUser.isGuest ? undefined : 'user';
      payload.custom_role_id = state.currentUser.isGuest ? 'guest' : 'user';
    }
    await ref.set(payload, { merge: true });
    
    /* Ricarica permessi dopo il salvataggio per assicurarsi che siano aggiornati */
    const { refreshPermissions } = await import('./permissions.js');
    await refreshPermissions();
  }
  
  /* Aggiorna UI e presenza con il nuovo display_name */
  updateHeaderUser(); 
  await updateOwnPresence(); 
  renderUsers();
  
  /* Aggiorna anche tutti i messaggi esistenti per riflettere il nuovo nome */
  if (state.rooms[state.activeRoom]) {
    const room = state.rooms[state.activeRoom];
    /* Rendi tutti i messaggi dell'utente corrente per aggiornare il nome */
    const msgGroups = dom.msgsContainer?.querySelectorAll(`[data-msg-id]`);
    if (msgGroups) {
      msgGroups.forEach(group => {
        const msgId = group.getAttribute('data-msg-id');
        const msg = room.messages.find(m => m.id === msgId);
        if (msg && (msg.userId === 'me' || msg.userId === state.currentUser?.id)) {
          const senderEl = group.querySelector('.msg-sender');
          if (senderEl) senderEl.textContent = 'You';
        }
      });
    }
  }
}

export function updateHeaderUser() {
  if (!state.currentUser) return;
  setAvatarDisplay(dom.headerAvatarChip, state.currentUser.username || state.currentUser.name, state.currentUser.avatarUrl);
}

/* ── Settings modal ────────────────────────────────────────────── */
function switchSettingsTab(tabId) {
  const tabs = dom.settingsModal?.querySelectorAll('.settings-tab');
  const panels = dom.settingsModal?.querySelectorAll('.settings-tab-panel');
  tabs?.forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
    t.setAttribute('aria-selected', t.dataset.tab === tabId ? 'true' : 'false');
  });
  const panelId = `settingsPanel${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`;
  panels?.forEach(p => {
    p.classList.toggle('hidden', p.id !== panelId);
  });
}

export function initSettingsModal() {
  dom.headerSettingsBtn?.addEventListener('click', openSettingsModal);
  dom.settingsModalClose?.addEventListener('click', () => { dom.settingsModal.hidden = true; });
  dom.settingsModal?.addEventListener('click', e => { if (e.target === dom.settingsModal) dom.settingsModal.hidden = true; });

  dom.settingsModal?.querySelectorAll('.settings-tab').forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
  });

  /* Suoni: state + localStorage + profilo Firestore (come le altre preferenze account) */
  const persistSoundPrefsLocally = () => {
    const base = { ...loadDeviceSettings(), ...(state.settings || {}) };
    const sc = document.getElementById('settingsSoundChat');
    const sp = document.getElementById('settingsSoundPM');
    if (sc) base.soundChat = sc.checked;
    if (sp) base.soundPM = sp.checked;
    state.settings = base;
    saveDeviceSettings(base);
    void pushProfileSettingsPatchToFirestore({
      soundChat: base.soundChat !== false,
      soundPM: base.soundPM !== false,
    });
  };
  document.getElementById('settingsSoundChat')?.addEventListener('change', persistSoundPrefsLocally);
  document.getElementById('settingsSoundPM')?.addEventListener('change', persistSoundPrefsLocally);

  /* Camera / microfono: applica subito allo stream attivo (anche stanza Eventi), senza premere Salva */
  let deviceApplyDebounce = null;
  const scheduleApplyDeviceSettingsFromSelects = () => {
    if (deviceApplyDebounce) clearTimeout(deviceApplyDebounce);
    deviceApplyDebounce = setTimeout(async () => {
      deviceApplyDebounce = null;
      const prevCam = state.settings?.cameraId ?? '';
      const prevMic = state.settings?.micId ?? '';
      const cam = dom.cameraDeviceSelect?.value ?? '';
      const mic = dom.micDeviceSelect?.value ?? '';
      if (cam === prevCam && mic === prevMic) return;
      const merged = { ...loadDeviceSettings(), cameraId: cam, micId: mic };
      state.settings = merged;
      saveDeviceSettings(merged);
      await applyLiveDeviceSettingsIfStreaming({ cameraId: prevCam, micId: prevMic });
      await pushProfileSettingsPatchToFirestore({
        cameraId: cam || null,
        micId: mic || null,
      });
    }, 300);
  };
  dom.cameraDeviceSelect?.addEventListener('change', scheduleApplyDeviceSettingsFromSelects);
  dom.micDeviceSelect?.addEventListener('change', scheduleApplyDeviceSettingsFromSelects);

  dom.detectDevicesBtn?.addEventListener('click', async () => {
    dom.detectDevicesBtn.textContent = 'Detecting…'; dom.detectDevicesBtn.disabled = true;
    try {
      await populateDeviceSelects();
      dom.detectDevicesHint.textContent = '✅ Devices detected. Select and press Save.';
    } catch (err) { dom.detectDevicesHint.textContent = '⚠️ Could not detect: ' + err.message; }
    finally { dom.detectDevicesBtn.textContent = '🔍 Detect Devices'; dom.detectDevicesBtn.disabled = false; }
  });

  /* Language selector */
  dom.languageSelect?.addEventListener('change', async (e) => {
    const lang = e.target.value;
    if (!state.currentUser) return;
    
    const { setLanguage } = await import('./i18n.js');
    setLanguage(lang);
    
    if (state.fb) {
      try {
        await state.fb.firestore.collection('profiles').doc(String(state.currentUser.id)).update({ language: lang });
        state.currentUser.language = lang;
      } catch (err) {
        console.error('[Auth] Update language error:', err);
      }
    }
  });
  
  /* Theme selector */
  dom.themeSelect?.addEventListener('change', async (e) => {
    const themeId = e.target.value;
    if (!state.currentUser) return;
    
    const { setUserTheme } = await import('./themes.js');
    await setUserTheme(themeId);
  });
  
  dom.settingsSaveBtn?.addEventListener('click', async () => {
    const s = {
      ...loadDeviceSettings(),
      cameraId: dom.cameraDeviceSelect?.value || '',
      micId: dom.micDeviceSelect?.value || '',
      autoLoadImages: document.getElementById('settingsAutoLoadImages')?.checked !== false,
      soundChat: document.getElementById('settingsSoundChat')?.checked !== false,
      soundPM: document.getElementById('settingsSoundPM')?.checked !== false,
      isBold: state.isBold,
      currentColor: state.currentColor,
      fontSize: state.fontSize,
    };
    saveDeviceSettings(s);
    state.settings = s;
    /* Utenti registrati: salva anche nel DB (profilo); guest: solo in locale */
    if (state.currentUser && !state.currentUser.isGuest && state.fb) {
      try {
        await state.fb.firestore.collection('profiles').doc(String(state.currentUser.id)).update({
          cameraId: s.cameraId || null,
          micId: s.micId || null,
          autoLoadImages: s.autoLoadImages !== false,
          soundChat: s.soundChat !== false,
          soundPM: s.soundPM !== false,
          isBold: s.isBold,
          currentColor: s.currentColor || null,
          fontSize: s.fontSize || null,
        });
      } catch (err) {
        console.error('[Auth] Save settings to profile failed:', err);
        showToast('⚠️ Impostazioni salvate in locale; sync con account non riuscita.');
      }
    }
    dom.settingsModal.hidden = true;
    showToast('✅ Settings saved.');
  });
}

function openSettingsModal() {
  const s = loadDeviceSettings();
  dom.cameraDeviceSelect.value = s.cameraId || '';
  dom.micDeviceSelect.value    = s.micId    || '';
  const autoLoadEl = document.getElementById('settingsAutoLoadImages');
  const soundChatEl = document.getElementById('settingsSoundChat');
  const soundPMEl = document.getElementById('settingsSoundPM');
  if (autoLoadEl) autoLoadEl.checked = s.autoLoadImages !== false;
  if (soundChatEl) soundChatEl.checked = s.soundChat !== false;
  if (soundPMEl) soundPMEl.checked = s.soundPM !== false;
  dom.detectDevicesHint.textContent = 'Click "Detect Devices" to list your cameras and microphones.';
  
  /* Set current language and theme */
  if (state.currentUser) {
    dom.languageSelect.value = state.currentUser.language || 'it';
    dom.themeSelect.value = state.currentUser.theme_id || 'dark';
  }
  
  renderRejectedCams();
  renderIgnoredUsers();
  switchSettingsTab('general');
  dom.settingsModal.hidden = false;
}

/**
 * Carica le impostazioni dal profilo Firestore per utenti registrati e le applica a state.settings + localStorage.
 * Chiamata dopo il login / al caricamento pagina se c'è sessione attiva.
 */
export async function loadUserSettingsFromProfile() {
  if (!state.currentUser?.id || state.currentUser.isGuest || !state.fb?.firestore) return;
  try {
    const snap = await state.fb.firestore.collection('profiles').doc(String(state.currentUser.id)).get();
    const data = snap.data();
    if (!data) return;
    const soundChatDb = data.soundChat !== undefined ? data.soundChat : data.sound_chat;
    const soundPMDb = data.soundPM !== undefined ? data.soundPM : data.sound_pm;
    const merged = {
      ...loadDeviceSettings(),
      ...(data.cameraId != null && { cameraId: data.cameraId }),
      ...(data.micId != null && { micId: data.micId }),
      ...(data.autoLoadImages !== undefined && { autoLoadImages: data.autoLoadImages }),
      ...(soundChatDb !== undefined && { soundChat: soundChatDb }),
      ...(soundPMDb !== undefined && { soundPM: soundPMDb }),
      ...(data.isBold !== undefined && { isBold: data.isBold }),
      ...(data.currentColor != null && { currentColor: data.currentColor }),
      ...(data.fontSize != null && { fontSize: data.fontSize }),
    };
    state.settings = merged;
    saveDeviceSettings(merged);
  } catch (err) {
    console.warn('[Auth] Load settings from profile failed:', err);
  }
}

async function populateDeviceSelects() {
  const perm = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => null);
  if (perm) perm.getTracks().forEach(t => t.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');
  const mics    = devices.filter(d => d.kind === 'audioinput');
  const savedCam = dom.cameraDeviceSelect.value;
  dom.cameraDeviceSelect.innerHTML = '<option value="">Default camera</option>';
  cameras.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId; opt.textContent = d.label || `Camera ${i + 1}`;
    if (d.deviceId === savedCam) opt.selected = true;
    dom.cameraDeviceSelect.appendChild(opt);
  });
  const savedMic = dom.micDeviceSelect.value;
  dom.micDeviceSelect.innerHTML = '<option value="">Default microphone</option>';
  mics.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId; opt.textContent = d.label || `Microphone ${i + 1}`;
    if (d.deviceId === savedMic) opt.selected = true;
    dom.micDeviceSelect.appendChild(opt);
  });
}

export function renderRejectedCams() {
  const list = dom.rejectedCamsList; if (!list) return;
  list.innerHTML = '';
  const entries = Object.entries(state.rejectedCamUsers);
  if (entries.length === 0) {
    const p = document.createElement('p'); p.className = 'rejected-cams-empty'; p.textContent = 'No blocked users.';
    list.appendChild(p); return;
  }
  entries.forEach(([uid, name]) => {
    const item = document.createElement('div'); item.className = 'rejected-cam-item';
    const nameEl = document.createElement('span'); nameEl.className = 'rejected-cam-name'; nameEl.textContent = name;
    const btn = document.createElement('button'); btn.className = 'rejected-cam-remove-btn'; btn.textContent = 'Unblock';
    btn.title = `Allow ${name} to send camera requests again`;
    btn.addEventListener('click', () => { removeRejectedCam(uid); renderRejectedCams(); showToast(`✅ ${name} unblocked.`); });
    item.append(nameEl, btn); list.appendChild(item);
  });
}

export function renderIgnoredUsers() {
  const list = dom.ignoredUsersList; if (!list) return;
  list.innerHTML = '';
  const entries = Object.entries(state.ignoredUsers);
  if (entries.length === 0) {
    const p = document.createElement('p'); p.className = 'rejected-cams-empty'; p.textContent = 'No ignored users.';
    list.appendChild(p); return;
  }
  entries.forEach(([uid, name]) => {
    const item = document.createElement('div'); item.className = 'rejected-cam-item';
    const nameEl = document.createElement('span'); nameEl.className = 'rejected-cam-name'; nameEl.textContent = name;
    const btn = document.createElement('button'); btn.className = 'rejected-cam-remove-btn'; btn.textContent = 'Unignore';
    btn.title = `Stop ignoring ${name}`;
    btn.addEventListener('click', () => { removeIgnoredUser(uid); renderIgnoredUsers(); showToast(`✅ ${name} unignored.`); });
    item.append(nameEl, btn); list.appendChild(item);
  });
}

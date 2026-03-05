/* ================================================================
   auth.js  — authentication, profile, settings modal
================================================================ */
import { AUTH_EMAIL_DOMAIN } from './config.js';
import { state }   from './state.js';
import { dom }     from './dom.js';
import { avatarColor, initials, showToast, setAvatarDisplay } from './utils.js';
import { loadDeviceSettings, saveDeviceSettings, removeRejectedCam, removeIgnoredUser } from './storage.js';
import { renderUsers, updateOwnPresence } from './users.js';

/* Forward refs set by main.js */
let _finishInit = null;
export function setFinishInit(fn) { _finishInit = fn; }

/* ── Auth helpers ──────────────────────────────────────────────── */
function nickToEmail(nick) {
  return `${nick.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}@${AUTH_EMAIL_DOMAIN}`;
}

export async function registerUser(nick, password) {
  const { data, error } = await state.supa.auth.signUp({ email: nickToEmail(nick), password });
  if (error) throw error;
  const userId = data.user.id;
  
  /* Assign default "user" role (ID is 'user' string in custom_roles table) */
  await state.supa.from('profiles').upsert(
    { 
      id: userId, 
      username: nick, 
      display_name: nick, 
      is_guest: false,
      role: 'user',  /* Default role for new users */
      custom_role_id: 'user'  /* Assign default "user" custom role */
    },
    { onConflict: 'id' }
  );
  if (data.session) persistAuthSession(data.session);
  return { userId, nick, avatarUrl: null };
}

export async function loginUser(nick, password) {
  const { data, error } = await state.supa.auth.signInWithPassword({ email: nickToEmail(nick), password });
  if (error) throw error;
  if (data.session) persistAuthSession(data.session);
  const { data: profile } = await state.supa.from('profiles').select('*').eq('id', data.user.id).single();
  const displayName = profile?.display_name || profile?.username || nick;
  return { 
    userId: data.user.id, 
    nick: displayName, 
    username: profile?.username || nick, 
    avatarUrl: profile?.avatar_url || null,
    theme_id: profile?.theme_id || 'dark',
    language: profile?.language || 'it'
  };
}

export async function logoutUser() {
  clearAuthSession();
  localStorage.removeItem('nvc_identity');
  try { await state.supa?.auth.signOut(); } catch {}
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
  if (!state.supa) return null;
  const stored = JSON.parse(localStorage.getItem('nvc_auth_session') || 'null');
  if (stored?.access_token) {
    try {
      const { data, error } = await state.supa.auth.setSession({
        access_token: stored.access_token, refresh_token: stored.refresh_token,
      });
      if (!error && data?.user) {
        if (data.session) persistAuthSession(data.session);
        const { data: profile } = await state.supa.from('profiles').select('*').eq('id', data.user.id).single();
        const cachedId    = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
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
      }
      clearAuthSession();
    } catch (netErr) { console.warn('[Auth] Session restore error:', netErr); }
  }
  try {
    const cached = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
    if (cached?.id && cached?.name && cached.isGuest === false) {
      showToast('⚠️ Session offline — using cached profile.');
      return { ...cached, online: true, hasCamera: false };
    }
  } catch {}
  return null;
}

export function applyAuthIdentity(id, name, username, avatarUrl, isGuest, themeId = 'dark', language = 'it') {
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
    if (stored?.id && stored?.name && stored?.isGuest !== false) return stored;
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

  dom.guestContinueBtn?.addEventListener('click', () => {
    state.currentUser = getOrCreateGuestIdentity();
    dom.authModal.hidden = true;
    _finishInit?.();
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
  dom.profileAvatarChangeBtn?.addEventListener('click', () => dom.profileAvatarInput.click());
  dom.profileAvatarInput?.addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
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
    const name = dom.profileNameInput.value.trim();
    if (!name) return showToast('⚠️ Display name cannot be empty.');
    const newUrl = dom.profileAvatarInput.dataset.uploadedUrl || state.currentUser.avatarUrl || null;
    dom.profileSaveBtn.disabled = true; dom.profileSaveBtn.textContent = 'Saving…';
    try {
      await saveProfile(name, newUrl);
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

function openProfileModal() {
  const u = state.currentUser; if (!u) return;
  dom.profileNameInput.value = u.name || '';
  delete dom.profileAvatarInput.dataset.uploadedUrl;
  setAvatarDisplay(dom.profileAvatarDisplay, u.name, u.avatarUrl);
  dom.profileAccountInfo.textContent = u.isGuest
    ? 'Guest account — changes apply this session only.'
    : `Registered as @${u.username || u.name}`;
  dom.profileLogoutBtn.hidden       = u.isGuest;
  dom.profileSwitchToAuthBtn.hidden = !u.isGuest;
  dom.profileModal.hidden = false;
}

async function uploadAvatarFile(file) {
  if (!state.supa) throw new Error('Not connected.');
  const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
  const path = `avatars/${state.currentUser.id}_${Date.now()}.${ext}`;
  const { error } = await state.supa.storage.from('chat-media').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = state.supa.storage.from('chat-media').getPublicUrl(path);
  return data.publicUrl;
}

async function saveProfile(displayName, avatarUrl) {
  state.currentUser.name = displayName;
  if (avatarUrl) state.currentUser.avatarUrl = avatarUrl;
  localStorage.setItem('nvc_identity', JSON.stringify(state.currentUser));
  if (state.supa) {
    const profileData = {
      id: state.currentUser.id,
      username: state.currentUser.username || state.currentUser.name,
      display_name: displayName,
      avatar_url: avatarUrl || null,
      is_guest: state.currentUser.isGuest || false,
    };
    
    /* Assegna ruoli di default */
    if (state.currentUser.isGuest) {
      profileData.custom_role_id = 'guest';
    } else {
      /* Per utenti registrati, assicura che abbiano ruolo 'user' di default */
      profileData.role = 'user';
      profileData.custom_role_id = 'user';
    }
    
    await state.supa.from('profiles').upsert(profileData, { onConflict: 'id' });
  }
  updateHeaderUser(); await updateOwnPresence(); renderUsers();
}

export function updateHeaderUser() {
  if (!state.currentUser) return;
  setAvatarDisplay(dom.headerAvatarChip, state.currentUser.username || state.currentUser.name, state.currentUser.avatarUrl);
}

/* ── Settings modal ────────────────────────────────────────────── */
export function initSettingsModal() {
  dom.headerSettingsBtn?.addEventListener('click', openSettingsModal);
  dom.settingsModalClose?.addEventListener('click', () => { dom.settingsModal.hidden = true; });
  dom.settingsModal?.addEventListener('click', e => { if (e.target === dom.settingsModal) dom.settingsModal.hidden = true; });

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
    
    /* Update user profile */
    if (state.supa) {
      try {
        await state.supa
          .from('profiles')
          .update({ language: lang })
          .eq('id', state.currentUser.id);
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
  
  dom.settingsSaveBtn?.addEventListener('click', () => {
    const s = { cameraId: dom.cameraDeviceSelect.value || '', micId: dom.micDeviceSelect.value || '' };
    saveDeviceSettings(s); state.settings = s;
    dom.settingsModal.hidden = true; showToast('✅ Settings saved.');
  });
}

function openSettingsModal() {
  const s = loadDeviceSettings();
  dom.cameraDeviceSelect.value = s.cameraId || '';
  dom.micDeviceSelect.value    = s.micId    || '';
  dom.detectDevicesHint.textContent = 'Click "Detect Devices" to list your cameras and microphones.';
  
  /* Set current language and theme */
  if (state.currentUser) {
    dom.languageSelect.value = state.currentUser.language || 'it';
    dom.themeSelect.value = state.currentUser.theme_id || 'dark';
  }
  
  renderRejectedCams();
  renderIgnoredUsers();
  dom.settingsModal.hidden = false;
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

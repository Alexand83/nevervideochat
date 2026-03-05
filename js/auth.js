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

/* ── Crea un ID univoco per la sessione (hash del token) ── */
function createSessionId(accessToken) {
  /* Usa una parte del token come ID univoco (primi 40 caratteri) */
  /* NON includere Date.now() perché deve essere lo stesso per tutta la durata della sessione */
  return accessToken.substring(0, 40);
}

/* ── Salva l'ID della sessione nel localStorage ── */
function saveSessionId(sessionId) {
  localStorage.setItem('nvc_session_id', sessionId);
}

/* ── Ottieni l'ID della sessione salvato ── */
function getSavedSessionId() {
  return localStorage.getItem('nvc_session_id');
}

/* ── Verifica immediatamente se la sessione è valida ── */
export async function verifySessionImmediately(userId, accessToken) {
  if (!state.supa || !userId || !accessToken) {
    console.warn('[Auth] IMMEDIATE CHECK: Missing parameters', { hasSupa: !!state.supa, userId, hasToken: !!accessToken });
    return false;
  }
  
  try {
    const sessionId = createSessionId(accessToken);
    const savedSessionId = getSavedSessionId();
    
    console.log('[Auth] Immediate session verification:', { 
      userId, 
      sessionId: sessionId.substring(0, 20) + '...',
      savedSessionId: savedSessionId ? savedSessionId.substring(0, 20) + '...' : 'none'
    });
    
    /* CRITICO: Verifica usando funzione SQL - più sicuro e gestisce meglio i casi edge */
    try {
      console.log('[Auth] 🔍 IMMEDIATE CHECK: Verifying session via SQL function...', {
        userId: userId,
        sessionId: sessionId.substring(0, 20) + '...'
      });
      
      const { data: isValid, error: checkError } = await state.supa
        .rpc('is_session_valid', {
          p_user_id: userId,
          p_session_id: sessionId
        });
      
      if (checkError) {
        console.error('[Auth] ❌ IMMEDIATE CHECK: Error calling is_session_valid RPC:', checkError);
        console.error('[Auth] ❌ Error code:', checkError.code);
        console.error('[Auth] ❌ Error message:', checkError.message);
        console.error('[Auth] ❌ Error status:', checkError.status);
        console.error('[Auth] ❌ Full error:', JSON.stringify(checkError, null, 2));
        
        /* Se la funzione non esiste, permettere (sistema non configurato) */
        if (checkError.code === '42883' || checkError.message?.includes('function') || checkError.message?.includes('does not exist')) {
          console.warn('[Auth] ⚠️ IMMEDIATE CHECK: SQL function does not exist - allowing (system not configured)');
          return true; /* Permetti se il sistema non è configurato */
        }
        
        /* Se c'è un altro errore, blocca per sicurezza */
        console.warn('[Auth] ⚠️ IMMEDIATE CHECK: Cannot verify session - blocking for security');
        return false;
      }
      
      console.log('[Auth] 🔍 IMMEDIATE CHECK: SQL function returned:', isValid);
      
      /* La funzione restituisce TRUE se la sessione è valida, FALSE altrimenti */
      if (!isValid) {
        console.warn('[Auth] 🚨 IMMEDIATE CHECK: Session is NOT valid - this is an OLD session from another browser - disconnecting NOW');
        const { showDisconnectedOverlay } = await import('./supabase-client.js');
        showDisconnectedOverlay();
        clearAuthSession();
        return false;
      }
      
      console.log('[Auth] ✅ IMMEDIATE CHECK: Session is valid - this is the active session');
    } catch (err) {
      console.error('[Auth] ❌ IMMEDIATE CHECK: Exception:', err);
      console.error('[Auth] ❌ Exception stack:', err.stack);
      /* In caso di errore, blocca per sicurezza */
      return false;
    }
    
    console.log('[Auth] IMMEDIATE CHECK: ✅ Session is valid');
    return true;
  } catch (err) {
    console.error('[Auth] IMMEDIATE CHECK: Exception:', err);
    /* In caso di errore, blocca per sicurezza */
    return false;
  }
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
  
  /* IMPORTANTE: Imposta la sessione PRIMA di tutto, così auth.uid() è disponibile per RLS */
  if (data.session) {
    /* Salva manualmente in localStorage (backup) */
    persistAuthSession(data.session);
    
    /* IMPORTANTE: Imposta la sessione nel client Supabase PRIMA di tutto */
    /* Questo rende auth.uid() disponibile per RLS e getSession() */
    const { error: setSessionError } = await state.supa.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
    
    if (setSessionError) {
      console.error('[Auth] Error setting session:', setSessionError);
    } else {
      console.log('[Auth] ✅ Session set in Supabase client - auth.uid() should be available now');
      
      /* Verifica che la sessione sia effettivamente disponibile */
      const { data: verifySession } = await state.supa.auth.getSession();
      if (verifySession?.session) {
        console.log('[Auth] ✅ Session verified - getSession() works');
      } else {
        console.warn('[Auth] ⚠️ Session set but getSession() returns null - this is a problem!');
      }
    }
  }
  
  /* IMPORTANTE: Registra questa come sessione attiva nel database DOPO aver impostato la sessione */
  /* Questo invalida immediatamente tutte le altre sessioni */
  if (data.session?.access_token) {
    try {
      /* Crea un ID univoco per questa sessione (hash del token) */
      const sessionId = createSessionId(data.session.access_token);
      
      console.log('[Auth] Registering new active session:', { userId: data.user.id, sessionId: sessionId.substring(0, 20) + '...' });
      
      /* Salva l'ID della sessione nel localStorage per riutilizzarlo */
      saveSessionId(sessionId);
      console.log('[Auth] Saved session ID to localStorage');
      
      /* APPROCCIO SICURO: Usa funzione SQL SECURITY DEFINER per bypassare RLS */
      try {
        console.log('[Auth] 📝 Registering new active session via SQL function...', {
          userId: data.user.id,
          sessionId: sessionId.substring(0, 20) + '...'
        });
        
        /* Chiama la funzione SQL che gestisce tutto lato server */
        const { data: rpcData, error: sessionError } = await state.supa
          .rpc('upsert_active_session', {
            p_user_id: data.user.id,
            p_session_id: sessionId
          });
        
        if (sessionError) {
          console.error('[Auth] ❌ ERROR calling upsert_active_session RPC!');
          console.error('[Auth] ❌ Error object:', sessionError);
          console.error('[Auth] ❌ Error code:', sessionError.code);
          console.error('[Auth] ❌ Error message:', sessionError.message);
          console.error('[Auth] ❌ Error status:', sessionError.status);
          console.error('[Auth] ❌ Error details (full):', JSON.stringify(sessionError, null, 2));
          
          /* Se la funzione non esiste, mostra messaggio chiaro */
          if (sessionError.code === '42883' || sessionError.message?.includes('function') || sessionError.message?.includes('does not exist')) {
            console.error('[Auth] 🚨 CRITICAL: SQL function upsert_active_session does not exist!');
            console.error('[Auth] 🚨 Please run supabase_active_sessions.sql in your Supabase SQL editor!');
            showToast('⚠️ Session management not configured. Please run supabase_active_sessions.sql in Supabase.');
          }
          
          /* Salva comunque in localStorage come fallback */
          const sessionData = {
            userId: data.user.id,
            sessionId: sessionId,
            timestamp: Date.now()
          };
          localStorage.setItem('nvc_active_session', JSON.stringify(sessionData));
          console.log('[Auth] 💾 Saved to localStorage fallback (RPC failed)');
        } else {
          console.log('[Auth] ✅ SUCCESS! Registered new active session via SQL function');
          console.log('[Auth] ✅ RPC result:', rpcData);
          console.log('[Auth] Old sessions are now invalid');
          
          /* CRITICO: Notifica tutte le altre sessioni di questo utente che sono state invalidate */
          /* Questo permette al browser 1 di disconnettersi immediatamente */
          try {
            const { broadcastAll } = await import('./broadcast.js');
            broadcastAll('session-invalidated', { user_id: data.user.id, userId: data.user.id });
            console.log('[Auth] 📢 Broadcasted session-invalidated to all other sessions');
          } catch (broadcastErr) {
            console.error('[Auth] Error broadcasting session-invalidated:', broadcastErr);
          }
        }
      } catch (dbErr) {
        console.error('[Auth] ❌ Database exception:', dbErr);
        console.error('[Auth] Exception details:', JSON.stringify(dbErr, null, 2));
        /* Salva comunque in localStorage come fallback */
        const sessionData = {
          userId: data.user.id,
          sessionId: sessionId,
          timestamp: Date.now()
        };
        localStorage.setItem('nvc_active_session', JSON.stringify(sessionData));
        console.log('[Auth] Saved to localStorage fallback');
      }
    } catch (err) {
      console.error('[Auth] Error registering active session:', err);
      if (err?.message?.includes('function') || err?.code === '42883') {
        console.error('[Auth] CRITICAL: Database functions not found! Execute supabase_active_sessions.sql!');
        showToast('⚠️ Session management not configured. Please run supabase_active_sessions.sql in Supabase.');
      }
    }
  }
  
  /* CONTROLLO IMMEDIATO: Verifica che questa sia la sessione attiva subito dopo il login */
  if (data.session?.access_token && state.supa) {
    await verifySessionImmediately(data.user.id, data.session.access_token);
  }
  
  /* IMPORTANTE: Disconnettere tutte le altre sessioni per permettere solo 1 sessione attiva */
  /* Usa scope: 'others' per disconnettere solo le altre sessioni, non quella corrente - PIÙ ISTANTANEO! */
  try {
    /* Importa le funzioni necessarie */
    const { markSessionAsNew, markDisconnectingOthers } = await import('./supabase-client.js');
    
    /* Marca questa come nuova sessione PRIMA di disconnettere le altre */
    markSessionAsNew();
    
    /* Marca che stiamo disconnettingo le altre sessioni (evita falsi positivi in checkSessionInvalid) */
    markDisconnectingOthers();
    
    /* Prova prima con scope: 'others' (più istantaneo - disconnette solo le altre) */
    try {
      await state.supa.auth.signOut({ scope: 'others' });
      console.log('[Auth] Disconnected all other sessions using scope: others (instant)');
    } catch (othersErr) {
      /* Se scope: 'others' non è supportato, usa il metodo fallback */
      console.warn('[Auth] scope: others not supported, using fallback method');
      const currentAccessToken = data.session?.access_token;
      const currentRefreshToken = data.session?.refresh_token;
      
      if (currentAccessToken && currentRefreshToken) {
        /* Fallback: disconnettere tutte le sessioni e ripristinare quella corrente */
        await state.supa.auth.signOut({ scope: 'global' });
        await state.supa.auth.setSession({
          access_token: currentAccessToken,
          refresh_token: currentRefreshToken,
        });
        markSessionAsNew(); /* Marca di nuovo dopo il restore */
        markDisconnectingOthers(); /* Marca di nuovo che stiamo disconnettingo */
        console.log('[Auth] Disconnected all other sessions using fallback method');
      }
    }
  } catch (signOutErr) {
    /* Se fallisce completamente, continua comunque - la sessione corrente è già valida */
    console.warn('[Auth] Could not disconnect old sessions (this is OK if first login):', signOutErr);
  }
  
  if (data.session) persistAuthSession(data.session);
  
  /* Marca la sessione come nuova anche dopo il persist */
  const { markSessionAsNew: markNew } = await import('./supabase-client.js');
  markNew();
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
        
        /* CRITICO: Verifica che questa sia la sessione attiva - SOLO database, localStorage è per-browser */
        if (data.session?.access_token) {
          /* Crea sessionId FUORI dal try così è disponibile per tutto il blocco */
          const sessionId = createSessionId(data.session.access_token);
          
          try {
            /* CRITICO: Verifica usando funzione SQL - più sicuro */
            const { data: isValid, error: checkError } = await state.supa
              .rpc('is_session_valid', {
                p_user_id: data.user.id,
                p_session_id: sessionId
              });
            
            if (checkError) {
              console.error('[Auth] Error calling is_session_valid RPC on restore:', checkError);
              /* Se la funzione non esiste, permettere il restore (sistema non configurato) */
              if (checkError.code === '42883' || checkError.message?.includes('function') || checkError.message?.includes('does not exist')) {
                console.warn('[Auth] SQL function does not exist - allowing restore (system not configured)');
              } else {
                console.warn('[Auth] Database check failed - allowing restore (might be first login)');
              }
            } else if (isValid === false) {
              /* La sessione non è valida - è una vecchia sessione da un altro browser */
              console.warn('[Auth] Restored session is NOT valid - this is an OLD session from another browser - disconnecting');
              const { showDisconnectedOverlay } = await import('./supabase-client.js');
              showDisconnectedOverlay();
              clearAuthSession();
              return null;
            } else {
              console.log('[Auth] ✅ Restored session is valid - this is the active session');
            }
          } catch (err) {
            console.error('[Auth] Error checking session on restore:', err);
            /* In caso di errore, permettere il restore per non bloccare l'utente */
          }
          
          /* CRITICO: Registra questa sessione nel database DOPO averla ripristinata */
          /* Questo è necessario perché se l'utente ha già una sessione salvata (cookie/localStorage), */
          /* non passa per loginUser() e quindi la sessione non viene mai registrata nel database */
          try {
            console.log('[Auth] 📝 RESTORE: Registering restored session via SQL function...', {
              userId: data.user.id,
              sessionId: sessionId.substring(0, 20) + '...'
            });
            
            /* Usa funzione SQL SECURITY DEFINER per bypassare RLS */
            const { data: rpcData, error: sessionError } = await state.supa
              .rpc('upsert_active_session', {
                p_user_id: data.user.id,
                p_session_id: sessionId
              });
            
            if (sessionError) {
              console.error('[Auth] ❌ RESTORE: Error calling upsert_active_session RPC!');
              console.error('[Auth] ❌ Error object:', sessionError);
              console.error('[Auth] ❌ Error code:', sessionError.code);
              console.error('[Auth] ❌ Error message:', sessionError.message);
              console.error('[Auth] ❌ Error status:', sessionError.status);
              console.error('[Auth] ❌ Error details (full):', JSON.stringify(sessionError, null, 2));
              
              if (sessionError.code === '42883' || sessionError.message?.includes('function') || sessionError.message?.includes('does not exist')) {
                console.error('[Auth] 🚨 RESTORE: SQL function upsert_active_session does not exist!');
                console.error('[Auth] 🚨 Please run supabase_active_sessions.sql in your Supabase SQL editor!');
              }
            } else {
              console.log('[Auth] ✅ RESTORE: Successfully registered restored session via SQL function');
              console.log('[Auth] ✅ RPC result:', rpcData);
              
              /* CRITICO: Notifica tutte le altre sessioni di questo utente che sono state invalidate */
              /* Questo permette al browser 1 di disconnettersi immediatamente */
              try {
                const { broadcastAll } = await import('./broadcast.js');
                broadcastAll('session-invalidated', { user_id: data.user.id, userId: data.user.id });
                console.log('[Auth] 📢 RESTORE: Broadcasted session-invalidated to all other sessions');
              } catch (broadcastErr) {
                console.error('[Auth] Error broadcasting session-invalidated:', broadcastErr);
              }
            }
            
            /* Salva l'ID della sessione per riferimento locale */
            saveSessionId(sessionId);
          } catch (err) {
            console.error('[Auth] ❌ RESTORE: Exception while registering session:', err);
            console.error('[Auth] ❌ Exception stack:', err.stack);
          }
        }
        
        /* CONTROLLO IMMEDIATO: Verifica che questa sia la sessione attiva subito dopo il restore */
        if (data.session?.access_token) {
          await verifySessionImmediately(data.user.id, data.session.access_token);
        }
        
        /* Marca la sessione come nuova per evitare che checkSessionInvalid la disconnetta */
        const { markSessionAsNew } = await import('./supabase-client.js');
        markSessionAsNew();
        
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
      /* Se l'errore è 403, significa che la sessione è stata invalidata da un'altra sessione */
      if (error?.status === 403 || error?.message?.includes('403')) {
        console.warn('[Auth] Session invalidated (403) - user was disconnected from another session');
        const { showDisconnectedOverlay } = await import('./supabase-client.js');
        showDisconnectedOverlay();
        clearAuthSession();
        return null;
      }
      clearAuthSession();
    } catch (netErr) { 
      console.warn('[Auth] Session restore error:', netErr);
      /* Se è un errore 403, mostra overlay di disconnessione */
      if (netErr?.status === 403 || netErr?.message?.includes('403')) {
        const { showDisconnectedOverlay } = await import('./supabase-client.js');
        showDisconnectedOverlay();
      }
    }
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
  /* Aggiorna il display_name in state.currentUser.name */
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
    
    /* IMPORTANTE: NON sovrascrivere mai i ruoli esistenti! */
    /* Controlla se esiste già un profilo con ruoli */
    const { data: existing } = await state.supa
      .from('profiles')
      .select('role, custom_role_id')
      .eq('id', String(state.currentUser.id))
      .maybeSingle();
    
    if (existing) {
      /* Se esiste già, NON toccare i ruoli - solo aggiornare nome/avatar */
      /* Non aggiungere role o custom_role_id al profileData */
    } else {
      /* Solo se NON esiste, assegna ruoli di default */
      if (state.currentUser.isGuest) {
        profileData.custom_role_id = 'guest';
      } else {
        /* Per nuovi utenti registrati, assegna 'user' di default */
        profileData.role = 'user';
        profileData.custom_role_id = 'user';
      }
    }
    
    await state.supa.from('profiles').upsert(profileData, { onConflict: 'id' });
    
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

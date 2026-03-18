/* ================================================================
   firebase-client.js — Firebase init (state.fb)
   Auth, Firestore, Realtime DB (presence/broadcast), Storage
================================================================ */
import { firebaseConfig, FIREBASE_RTDB_URL } from './firebase-config.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { state } from './state.js';
import { dom } from './dom.js';
import { showToast, playNotificationSound, processHtml } from './utils.js';
import { ensureUser, syncPresence, updateOwnPresence, handleTyping, renderUsers } from './users.js?v=20260453';
import { addMessage, extractQuote, renderMessage, handleReactionUpdate, updateMessageReactions } from './chat.js?v=20260453';
import { handleIncomingPM } from './private-chat.js';
import { handleCamRequest, handleCamAccepted, handleWebRTCSignal, handleCamClosed,
         closeCameraWindow, endCall, setRemoteSenderVideoOff } from './camera.js?v=20260318b';
import { clearPendingCamRequest } from './storage.js';

const firebase = typeof window !== 'undefined' ? window.firebase : null;

let app, auth, firestore, rtdb, storageRef;
let supabaseStorageClient = null; /* solo per Storage (bucket chat-media) se configurato */
let sessionJustCreated = false;
let sessionCreationTime = 0;
let isDisconnectingOthers = false;
let sessionCheckInterval = null;
let disconnectGraceTimer = null;
let reconnectingSupabase = false;
let lastHiddenAt = 0;
const GRACE_AFTER_HIDDEN_MS = 120000;
let graceReconnectInterval = null;
let broadcastUnsubscribe = null;
let messageUnsubscribes = {};
let activeSessionUnsubscribe = null;
let disconnectOverlayShown = false;

function mapTimestamp(o) {
  if (!o) return o;
  const r = { ...o };
  ['created_at', 'updated_at', 'edited_at', 'deleted_at'].forEach(k => {
    if (r[k] && typeof r[k].toDate === 'function') r[k] = r[k].toDate().toISOString();
  });
  return r;
}

/* ── RPC (Firestore active_sessions) ── */
async function rpc(name, params) {
  if (name === 'is_session_valid') {
    const userId = params.p_user_id;
    const sessionId = params.p_session_id;
    const snap = await firestore.collection('active_sessions').doc(String(userId)).get();
    const data = snap.data();
    if (!data || !data.session_id) return { data: true, error: null };
    return { data: data.session_id === sessionId, error: null };
  }
  if (name === 'upsert_active_session') {
    const userId = params.p_user_id;
    const sessionId = params.p_session_id;
    await firestore.collection('active_sessions').doc(String(userId)).set({
      session_id: sessionId,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { data: null, error: null };
  }
  return { data: null, error: { message: 'Unknown RPC' } };
}

export async function isSessionValid(userId, sessionId) {
  const r = await rpc('is_session_valid', { p_user_id: userId, p_session_id: sessionId });
  return r.data === true;
}
export async function upsertActiveSession(userId, sessionId) {
  const r = await rpc('upsert_active_session', { p_user_id: userId, p_session_id: sessionId });
  return r.error == null;
}

/* ── Storage adapter: Supabase (se configurato) oppure Firebase ── */
export function storageFrom(bucket) {
  if (bucket !== 'chat-media') return {};
  if (supabaseStorageClient) {
    const supabaseBucket = supabaseStorageClient.storage.from('chat-media');
    return {
      upload(path, file, opts) {
        return supabaseBucket.upload(path, file, { upsert: opts?.upsert ?? true })
          .then(({ error }) => {
            if (error) return { data: null, error };
            const { data: urlData } = supabaseBucket.getPublicUrl(path);
            return { data: { publicUrl: urlData?.publicUrl ?? '' }, error: null };
          })
          .catch(err => ({ data: null, error: err }));
      },
      getPublicUrl(path) {
        const { data } = supabaseBucket.getPublicUrl(path);
        return Promise.resolve({ data: { publicUrl: data?.publicUrl ?? '' } });
      },
    };
  }
  const rootRef = firebase.storage().ref();
  return {
    upload(path, file, opts) {
      const r = rootRef.child(path);
      return r.put(file, opts || {})
        .then(() => r.getDownloadURL())
        .then(publicUrl => ({ data: { publicUrl }, error: null }))
        .catch(err => ({ data: null, error: err }));
    },
    getPublicUrl(path) {
      return rootRef.child(path).getDownloadURL()
        .then(publicUrl => ({ data: { publicUrl } }))
        .catch(() => ({ data: { publicUrl: '' } }));
    },
  };
}
export function getStoragePublicUrl(path) {
  if (supabaseStorageClient) {
    const { data } = supabaseStorageClient.storage.from('chat-media').getPublicUrl(path);
    return Promise.resolve(data?.publicUrl ?? '');
  }
  return firebase.storage().ref(path).getDownloadURL();
}

/* ── Auth adapter (Firebase Auth → Supabase-shaped) ── */
function authAdapter() {
  const getSessionLike = async () => {
    const user = auth.currentUser;
    if (!user) return { data: { session: null, user: null } };
    const token = await user.getIdToken(true).catch(() => null);
    return {
      data: {
        session: token ? { access_token: token, refresh_token: '' } : null,
        user: { id: user.uid, isAnonymous: user.isAnonymous === true },
      },
    };
  };
  return {
    /* Guest users: enable "Anonymous" sign-in in Firebase Console → Authentication → Sign-in method */
    async signInAnonymously() {
      try {
        /* Usa persistenza SESSION (sessionStorage) invece di LOCAL (indexedDB).
           Chrome mobile blocca indexedDB in modalità privata o con impostazioni
           di privacy strette → signInAnonymously() si blocca senza risolvere. */
        const Persistence = firebase.auth?.Auth?.Persistence;
        if (Persistence?.SESSION) {
          await firebase.auth().setPersistence(Persistence.SESSION).catch(() => {});
        }
        const cr = await firebase.auth().signInAnonymously();
        const token = await cr.user.getIdToken().catch(() => null);
        return {
          data: { user: { id: cr.user.uid }, session: token ? { access_token: token, refresh_token: '' } : null },
          error: null,
        };
      } catch (e) {
        return { data: null, error: e };
      }
    },
    async signUp({ email, password }) {
      const cr = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const token = await cr.user.getIdToken();
      return {
        data: { user: { id: cr.user.uid }, session: { access_token: token, refresh_token: '' } },
        error: null,
      };
    },
    async signInWithPassword({ email, password }) {
      const cr = await firebase.auth().signInWithEmailAndPassword(email, password);
      const token = await cr.user.getIdToken();
      return {
        data: { user: { id: cr.user.uid }, session: { access_token: token, refresh_token: '' } },
        error: null,
      };
    },
    async getSession() {
      return getSessionLike();
    },
    async setSession({ access_token }) {
      if (!access_token) return { error: null };
      try {
        const user = auth.currentUser;
        if (user) await user.getIdToken(true);
        return { error: null };
      } catch (e) {
        return { error: e };
      }
    },
    async getUser() {
      const user = auth.currentUser;
      return { data: { user: user ? { id: user.uid, isAnonymous: user.isAnonymous === true } : null }, error: null };
    },
    signOut() {
      return auth.signOut();
    },
    onAuthStateChange(cb) {
      return auth.onAuthStateChanged(async (user) => {
        if (user) {
          const token = await user.getIdToken().catch(() => null);
          cb('SIGNED_IN', { access_token: token, user: { id: user.uid } });
        } else cb('SIGNED_OUT', null);
      });
    },
  };
}

/* ── Realtime DB: broadcast channel ── */
/* Filtra SOLO eventi che aprono UI (cam-req, cam-opened): ignora se troppo vecchi.
   WebRTC (offer/answer/ICE) NON va mai filtrato: altrimenti la connessione non si stabilisce → cam nera + niente audio. */
const BROADCAST_UI_MAX_AGE_MS = 25000;

export function createBroadcastChannel() {
  state.broadcastConnectedAt = Date.now(); /* solo messaggi con ts >= questo (meno skew) sono "live"; replay ha ts nel passato */
  const broadcastRef = rtdb.ref('broadcast');
  const handlers = {};
  const unsub = broadcastRef.on('child_added', (snap) => {
    const v = snap.val();
    if (!v || !v.event) return;
    const event = v.event;
    const ts = v.ts || 0;
    if (event === 'cam-req' || event === 'cam-opened') {
      if (ts && (Date.now() - ts > BROADCAST_UI_MAX_AGE_MS)) return; /* richieste/annunci vecchi: no popup */
    }
    if (event === 'cam-closed') {
      if (ts && (Date.now() - ts > BROADCAST_UI_MAX_AGE_MS)) return; /* replay al refresh: non chiudere finestre né mostrare toast */
    }
    if (event === 'cam-rejected' || event === 'cam-revoked' || event === 'call-ended') {
      if (ts && (Date.now() - ts > BROADCAST_UI_MAX_AGE_MS)) return; /* replay al login: non mostrare toast vecchi */
    }
    if (event === 'pm') {
      const pt = (v.payload && v.payload.ts) || ts || 0;
      if (pt && (Date.now() - pt > BROADCAST_UI_MAX_AGE_MS)) return; /* replay: non riaprire chat privata */
    }
    const payload = v.payload || {};
    /* Per webrtc passiamo _ts così handleWebRTCSignal può scartare replay vecchi (child_added su Firebase consegna tutti i messaggi passati al subscribe) */
    let payloadWithTs = event === 'webrtc' ? { ...payload, _ts: ts } : payload;
    if (event === 'webrtc') {
      /* Offer/ICE di stanza: payload.to può essere errato (replay/ordine Firebase). Forziamo to=me così camera.js non fa SKIP. Solo ctx==='private' resta targeted. */
      const isRoomIce = payloadWithTs?.sigType === 'ice' && payloadWithTs?.from && payloadWithTs?.ctx !== 'private';
      const isRoomOffer = payloadWithTs?.sigType === 'offer' && payloadWithTs?.from && payloadWithTs?.ctx !== 'private';
      if ((isRoomIce || isRoomOffer) && state.currentUser?.id) {
        payloadWithTs = { ...payloadWithTs, to: state.currentUser.id };
      }
      const toMe = payloadWithTs?.to != null && state.currentUser?.id != null && String(payloadWithTs.to) === String(state.currentUser.id);
      if (toMe) console.log('[WebRTC-FLOW] Firebase RX webrtc for me', (payloadWithTs.sigType || ''), 'from=', (v.from || '').slice(0, 8) + '…');
    }
    if (handlers[event]) handlers[event].forEach(fn => fn({ payload: payloadWithTs }));
  });
  return {
    on(ev, opts, fn) {
      if (ev !== 'broadcast' || !opts?.event) return this;
      const event = opts.event;
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(fn);
      return this;
    },
    send(msg) {
      if (msg.type !== 'broadcast') return;
      broadcastRef.push({
        event: msg.event,
        payload: msg.payload || {},
        from: state.currentUser?.id,
        ts: Date.now(),
      });
    },
    subscribe(cb) {
      if (cb) cb('SUBSCRIBED');
      return this;
    },
    unsubscribe() {
      broadcastRef.off('child_added', unsub);
      broadcastUnsubscribe = null;
    },
  };
}

/** Svuota la history del canale broadcast (evita replay di ban/kick/mute/pm al reconnect). Chiamare dopo ban/unban/unkick/unmute. */
export async function clearBroadcastHistory() {
  try {
    if (rtdb) await rtdb.ref('broadcast').remove();
  } catch (e) {
    console.warn('[Firebase] clearBroadcastHistory failed', e);
  }
}

/* ── Presence (Realtime DB per room) ── */
export function createPresenceChannel(roomIdStr, key) {
  const path = `presence/room_${roomIdStr.replace(/[.#$/[\]]/g, '_')}/${String(key).replace(/[.#$/[\]]/g, '_')}`;
  const ref = rtdb.ref(path);
  let presenceState = {};
  const syncListeners = [];
  const joinListeners = [];
  const leaveListeners = [];

  ref.onDisconnect().remove();
  const listenRef = rtdb.ref(`presence/room_${roomIdStr.replace(/[.#$/[\]]/g, '_')}`);
  const PRESENCE_STALE_MS = 10 * 60 * 1000; /* entry più vecchie di 10min = ghost (heartbeat ogni 3min) */
  let firstSnapshot = true;
  listenRef.on('value', (snap) => {
    const val = snap.val() || {};
    const oldState = presenceState;
    presenceState = {};
    const now = Date.now();
    Object.keys(val).forEach(uid => {
      const d = val[uid];
      if (!d || d.name == null) return;
      /* Salta entry stale (onDisconnect non scattato) */
      if (d.ts && now - d.ts > PRESENCE_STALE_MS) {
        /* Rimuovi silenziosamente il ghost da Firebase */
        rtdb.ref(`${`presence/room_${roomIdStr.replace(/[.#$/[\]]/g, '_')}`}/${uid}`).remove().catch(() => {});
        return;
      }
      presenceState[uid] = [{ ...d }];
    });

    if (firstSnapshot) {
      /* Al primo snapshot non generiamo join: l'utente sta solo caricando i presenti */
      firstSnapshot = false;
    } else {
      /* Join: uid presenti ora ma non prima */
      Object.keys(presenceState).forEach(uid => {
        if (!oldState[uid]) {
          joinListeners.forEach(fn => fn({ key: uid, newPresences: presenceState[uid] }));
        }
      });
      /* Leave: uid presenti prima ma non ora */
      Object.keys(oldState).forEach(uid => {
        if (!presenceState[uid]) {
          leaveListeners.forEach(fn => fn({ key: uid }));
        }
      });
    }

    syncListeners.forEach(fn => fn());
  });

  return {
    track(state) {
      return ref.set({ ...state, ts: Date.now() });
    },
    presenceState() {
      return presenceState;
    },
    on(ev, opts, fn) {
      if (ev === 'presence' && opts?.event === 'sync') syncListeners.push(fn);
      if (ev === 'presence' && opts?.event === 'join') joinListeners.push(fn);
      if (ev === 'presence' && opts?.event === 'leave') leaveListeners.push(fn);
      return this;
    },
    subscribe(fn) {
      if (typeof fn === 'function') Promise.resolve().then(() => fn('SUBSCRIBED'));
      return this;
    },
    unsubscribe() {
      listenRef.off();
      return ref.remove();
    },
  };
}

/* ── Messages subscription (Firestore): only new messages after subscribe ── */
export function subscribeMessages(roomId, onInsert) {
  if (messageUnsubscribes[roomId]) {
    messageUnsubscribes[roomId]();
    messageUnsubscribes[roomId] = null;
  }
  const connectTime = Date.now();
  const unsub = firestore.collection('messages')
    .where('room_id', '==', roomId)
    .orderBy('created_at', 'asc')
    .onSnapshot((snap) => {
      snap.docChanges().forEach(change => {
        const id = change.doc.id;
        const room = state.rooms[roomId];
        if (change.type === 'removed') {
          const idx = room?.messages?.findIndex(m => m.id === id) ?? -1;
          if (idx !== -1) room.messages.splice(idx, 1);
          if (roomId === state.activeRoom && dom.msgsContainer) {
            const group = dom.msgsContainer.querySelector(`[data-msg-id="${id}"]`);
            if (group) group.remove();
          }
          return;
        }
        if (change.type === 'modified') {
          const d = change.doc.data();
          const msg = room?.messages?.find(m => m.id === id);
          if (msg) {
            msg.reactions = d.reactions || {};
            if (d.content !== undefined) {
              const { html } = extractQuote(d.content);
              msg.html = html;
              msg.edited_at = d.edited_at?.toDate?.()?.getTime?.() ?? (typeof d.edited_at === 'string' ? new Date(d.edited_at).getTime() : null);
              if (roomId === state.activeRoom && dom.msgsContainer) {
                const group = dom.msgsContainer.querySelector(`[data-msg-id="${id}"]`);
                const textDiv = group?.querySelector('.msg-text');
                if (group && textDiv) {
                  textDiv.innerHTML = processHtml(html);
                  const timeEl = group.querySelector('.msg-time');
                  if (timeEl && msg.edited_at && !timeEl.querySelector('.msg-edited')) {
                    const ed = document.createElement('span');
                    ed.className = 'msg-edited'; ed.textContent = ' (modificato)';
                    timeEl.appendChild(ed);
                  }
                }
              }
            }
            if (roomId === state.activeRoom && dom.msgsContainer) {
              const group = dom.msgsContainer.querySelector(`[data-msg-id="${id}"]`);
              if (group) updateMessageReactions(group, msg.reactions);
            }
          }
          return;
        }
        if (change.type !== 'added') return;
        const d = change.doc.data();
        const created = d.created_at?.toDate?.()?.getTime?.() || (typeof d.created_at === 'string' ? new Date(d.created_at).getTime() : 0);
        if (created <= connectTime - 2000) return;
        const m = { id, ...mapTimestamp(d), created_at: d.created_at?.toDate?.()?.toISOString?.() || d.created_at };
        onInsert(m);
      });
    });
  messageUnsubscribes[roomId] = unsub;
  return { unsubscribe: unsub };
}

/* ── Disconnect overlay (same logic as supabase-client) ── */
export function scheduleDisconnectedOverlay(delayMs) {
  if (disconnectGraceTimer) clearTimeout(disconnectGraceTimer);
  if (graceReconnectInterval) { clearInterval(graceReconnectInterval); graceReconnectInterval = null; }
  disconnectGraceTimer = setTimeout(() => {
    disconnectGraceTimer = null;
    showDisconnectedOverlay(true);
  }, delayMs);
  if (document.visibilityState === 'visible' && state.currentUser) {
    graceReconnectInterval = setInterval(() => {
      if (!disconnectGraceTimer || !state.currentUser) return;
      connectFirebase();
    }, 15000);
  }
}
export function clearDisconnectGrace() {
  if (disconnectGraceTimer) { clearTimeout(disconnectGraceTimer); disconnectGraceTimer = null; }
  if (graceReconnectInterval) { clearInterval(graceReconnectInterval); graceReconnectInterval = null; }
}
export async function showDisconnectedOverlay(forceShow) {
  if (disconnectOverlayShown) return;
  if (!state.currentUser) return;
  disconnectOverlayShown = true;
  if (!forceShow && disconnectGraceTimer) { disconnectOverlayShown = false; return; }
  if (!forceShow) {
    const recentlyHidden = lastHiddenAt && (Date.now() - lastHiddenAt < GRACE_AFTER_HIDDEN_MS);
    if (document.hidden || recentlyHidden) {
      disconnectOverlayShown = false;
      scheduleDisconnectedOverlay(90000);
      return;
    }
  }
  clearDisconnectGrace();
  if (sessionCheckInterval) { clearInterval(sessionCheckInterval); sessionCheckInterval = null; }
  if (activeSessionUnsubscribe) { activeSessionUnsubscribe(); activeSessionUnsubscribe = null; }
  if (broadcastUnsubscribe) { broadcastUnsubscribe(); broadcastUnsubscribe = null; }
  Object.keys(messageUnsubscribes).forEach(roomId => {
    if (messageUnsubscribes[roomId]) messageUnsubscribes[roomId]();
  });
  messageUnsubscribes = {};
  try {
    const { resetCameraStateOnDisconnect } = await import('./camera.js?v=20260318b');
    resetCameraStateOnDisconnect();
  } catch (_) {}
  const appMain = document.querySelector('.app-main');
  const appHeader = document.querySelector('.app-header');
  if (appMain) appMain.style.display = '';
  if (appHeader) appHeader.style.display = '';
  state.currentUser = null;
  state.rooms = {};
  if (dom.msgsContainer) {
    dom.msgsContainer.innerHTML = '';
    if (dom.welcomeBanner && !dom.welcomeBanner.parentNode) dom.msgsContainer.appendChild(dom.welcomeBanner);
  }
  localStorage.removeItem('nvc_identity');
  localStorage.removeItem('nvc_auth_session');
  localStorage.removeItem('nvc_browser_session_id');
  localStorage.removeItem('nvc_session_id');
  sessionStorage.removeItem('nvc_browser_session_id');
  sessionStorage.removeItem('nvc_session_id');
  try { auth.signOut(); } catch (_) {}
  const authModal = document.getElementById('authModal');
  if (authModal) { authModal.hidden = false; authModal.style.zIndex = '9999'; authModal.style.pointerEvents = 'auto'; authModal.classList.add('modal-visible'); }
  const adminPanel = document.getElementById('adminPanel');
  if (adminPanel) adminPanel.hidden = true;
  const chatInputArea = document.getElementById('chatInputArea') || document.querySelector('.chat-input-area');
  if (chatInputArea) { chatInputArea.style.display = 'none'; chatInputArea.setAttribute('aria-hidden', 'true'); }
  if (dom.msgInput) { dom.msgInput.disabled = true; dom.msgInput.setAttribute('aria-hidden', 'true'); dom.msgInput.style.display = 'none'; }
  if (dom.sendBtn) { dom.sendBtn.disabled = true; dom.sendBtn.style.display = 'none'; }
}
export function restoreChatInputAfterLogin() {
  const chatInputArea = document.getElementById('chatInputArea') || document.querySelector('.chat-input-area');
  if (chatInputArea) { chatInputArea.style.display = ''; chatInputArea.removeAttribute('aria-hidden'); }
  if (dom.msgInput) { dom.msgInput.disabled = false; dom.msgInput.removeAttribute('aria-hidden'); dom.msgInput.style.display = ''; }
  if (dom.sendBtn) { dom.sendBtn.disabled = false; dom.sendBtn.style.display = ''; }
}
export function resetDisconnectOverlayFlag() {
  disconnectOverlayShown = false;
}
export function markSessionAsNew() {
  sessionJustCreated = true;
  sessionCreationTime = Date.now();
  setTimeout(() => { sessionJustCreated = false; }, 30000);
}
export function markDisconnectingOthers() {
  isDisconnectingOthers = true;
  setTimeout(() => { isDisconnectingOthers = false; }, 10000);
}
function stopSessionCheckInterval() {
  if (sessionCheckInterval) { clearInterval(sessionCheckInterval); sessionCheckInterval = null; }
}
export async function checkSessionInvalid() {
  if (!state.fb || !state.currentUser) return false;
  if (isDisconnectingOthers) return false;
  if (sessionJustCreated && (Date.now() - sessionCreationTime < 30000)) return false;
  try {
    const user = auth.currentUser;
    if (!user && !state.currentUser.isGuest) {
      showDisconnectedOverlay();
      return true;
    }
    /* Se abbiamo ancora currentUser ma un'altra sessione ha fatto login (active_sessions),
       Firestore può dare permission-denied in scrittura: verifica e mostra overlay. */
    if (user && !state.currentUser.isGuest) {
      const token = await user.getIdToken(true).catch(() => null);
      if (token) {
        const { getSavedSessionId, createSessionId } = await import('./auth.js');
        const sessionId = getSavedSessionId() || createSessionId(token);
        const isValid = await isSessionValid(state.currentUser.id, sessionId);
        if (!isValid) {
          showDisconnectedOverlay(true);
          return true;
        }
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

/* ── connectRoom: Firestore messages + same handlers ── */
export async function connectRoom(roomId) {
  if (!state.fb || !state.rooms[roomId]) return;
  const room = state.rooms[roomId];
  room.messages = [];
  if (roomId === state.activeRoom && dom.msgsContainer) {
    dom.msgsContainer.innerHTML = '';
    if (dom.welcomeBanner && !dom.welcomeBanner.parentNode) dom.msgsContainer.appendChild(dom.welcomeBanner);
  }
  const onInsert = async (m) => {
    try {
      if (m.user_id === state.currentUser.id) {
        /* Correlazione per ordine: il primo INSERT ricevuto va al più vecchio messaggio temp (evita reazioni sul messaggio sbagliato) */
        const ourTempMessages = room.messages
          .filter(msg => (msg.userId === 'me' || msg.userId === state.currentUser.id) && msg.id && String(msg.id).startsWith('m') && String(msg.id).length < 30)
          .sort((a, b) => (a.ts || 0) - (b.ts || 0));
        const tempMsg = ourTempMessages[0] || null;
        if (tempMsg) {
          const oldId = tempMsg.id;
          tempMsg.id = m.id;
          const serverReactions = m.reactions || {};
          const hadLocalReactions = tempMsg.reactions && Object.keys(tempMsg.reactions).length > 0;
          if (hadLocalReactions && (!serverReactions || Object.keys(serverReactions).length === 0)) {
            tempMsg.reactions = tempMsg.reactions || {};
            try {
              await firestore.collection('messages').doc(m.id).update({ reactions: tempMsg.reactions });
            } catch (err) {
              console.warn('[Firebase] Could not persist local reactions on confirm', err);
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
        return;
      }
      if (state.ignoredUsers[String(m.user_id)]) return;
      ensureUser(m.user_id, m.username);
      const { html, quoteHtml, quoteName } = extractQuote(m.content);
      addMessage({ userId: m.user_id, username: m.username, html, quoteHtml, quoteName, ts: new Date(m.created_at).getTime(), reactions: m.reactions || {}, msgId: m.id }, roomId);
      if (roomId === state.activeRoom && state.settings?.soundChat !== false) playNotificationSound();
    } catch (err) {
      console.error('[Firebase] Error processing message:', err);
    }
  };
  room.dbSub = subscribeMessages(roomId, onInsert);
}

/* ── Session check interval (Firebase: check auth.currentUser + Firestore session) ── */
function startSessionCheckInterval() {
  if (sessionCheckInterval) clearInterval(sessionCheckInterval);
  sessionCheckInterval = setInterval(async () => {
    if (!state.fb || !state.currentUser) return;
    if (state.currentUser.isGuest) return;
    if (isDisconnectingOthers) return;
    if (sessionJustCreated && (Date.now() - sessionCreationTime < 30000)) return;
    try {
      const user = auth.currentUser;
      if (!user) {
        if (!state.currentUser.isGuest) showDisconnectedOverlay();
        return;
      }
      const token = await user.getIdToken(true).catch(() => null);
      if (!token) return;
      const { getSavedSessionId, createSessionId } = await import('./auth.js');
      const sessionId = getSavedSessionId() || createSessionId(token);
      const isValid = await isSessionValid(state.currentUser.id, sessionId);
      if (isValid === false) {
        showDisconnectedOverlay();
        if (sessionCheckInterval) { clearInterval(sessionCheckInterval); sessionCheckInterval = null; }
      }
    } catch (_) {}
  }, 2000);
}

/* ── connectFirebase: broadcast channel + handlers (same as supabase-client) ── */
export async function connectFirebase() {
  if (!state.fb) return;
  if (reconnectingSupabase) return;
  reconnectingSupabase = true;
  try {
    if (state.signalCh && state.signalCh.unsubscribe) state.signalCh.unsubscribe();
    state.signalCh = createBroadcastChannel();
    broadcastUnsubscribe = () => state.signalCh?.unsubscribe?.();

    if (state.pendingSessionInvalidation) {
      try {
        const { broadcastAll } = await import('./broadcast.js');
        const pending = Array.isArray(state.pendingSessionInvalidation) ? state.pendingSessionInvalidation : [state.pendingSessionInvalidation];
        pending.forEach(inv => broadcastAll('session-invalidated', inv));
        delete state.pendingSessionInvalidation;
      } catch (_) {}
    }

    state.signalCh
      .on('broadcast', { event: 'typing' }, ({ payload }) => handleTyping(payload))
      .on('broadcast', { event: 'pm' }, ({ payload }) => handleIncomingPM(payload))
      .on('broadcast', { event: 'webrtc' }, ({ payload }) => handleWebRTCSignal(payload))
      .on('broadcast', { event: 'cam-req' }, ({ payload }) => handleCamRequest(payload))
      .on('broadcast', { event: 'cam-accepted' }, ({ payload }) => handleCamAccepted(payload))
      .on('broadcast', { event: 'cam-rejected' }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        clearPendingCamRequest(String(payload.from));
        showToast(payload.reason === 'wrong-room' ? `📵 ${payload.fromName || 'User'} is in a different room.` : `❌ ${payload.fromName || 'User'} declined.`);
      })
      .on('broadcast', { event: 'cam-revoked' }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (state.cameraWindows[payload.from]) closeCameraWindow(payload.from);
        showToast('📵 Camera access revoked.');
      })
      .on('broadcast', { event: 'cam-opened' }, async ({ payload }) => {
        if (String(payload.from) === String(state.currentUser?.id)) return;
        const fromId = String(payload.from);
        const camRoom = payload.room_id || null;
        if (payload.videoOff !== undefined) state.remoteVideoOffState[fromId] = !!payload.videoOff;
        const { getAvailableRooms } = await import('./rooms.js');
        const availableRooms = getAvailableRooms();
        const camRoomData = availableRooms.find(r => String(r.id) === String(camRoom));
        const isInCamRoom = camRoom && String(camRoom) === String(state.activeRoom);
        if (camRoom && !isInCamRoom) {
          for (const [rId, room] of Object.entries(state.rooms)) {
            if (room.users[fromId]) room.users[fromId].hasCamera = (rId === camRoom);
          }
          const u = state.users.find(u => String(u.id) === fromId);
          if (u) u.hasCamera = (String(camRoom) === String(state.activeRoom));
          renderUsers();
          return;
        }
        for (const [rId, room] of Object.entries(state.rooms)) {
          if (room.users[fromId]) room.users[fromId].hasCamera = (rId === camRoom);
          else if (rId === camRoom) {
            const user = ensureUser(fromId, payload.fromName || 'User', { hasCamera: true, online: true });
            room.users[fromId] = { ...user, hasCamera: true };
          }
        }
        const u = state.users.find(u => String(u.id) === fromId);
        const inActiveRoom = camRoom && String(camRoom) === String(state.activeRoom);
        if (u) { if (inActiveRoom) u.hasCamera = true; }
        else ensureUser(fromId, payload.fromName || 'User', { hasCamera: inActiveRoom, online: true });
        state.camerasOpenedViaBroadcast[fromId] = Date.now();
        setTimeout(() => delete state.camerasOpenedViaBroadcast[fromId], 10000);
        renderUsers();
        if (camRoom === state.activeRoom && inActiveRoom) {
          const { updateEventsCamGrid } = await import('./rooms.js');
          updateEventsCamGrid();
        }
      })
      .on('broadcast', { event: 'cam-video-off' }, ({ payload }) => {
        if (String(payload.from) === String(state.currentUser?.id)) return;
        state.remoteVideoOffState[String(payload.from)] = !!payload.videoOff;
        setRemoteSenderVideoOff(String(payload.from), !!payload.videoOff);
      })
      .on('broadcast', { event: 'cam-closed' }, ({ payload }) => handleCamClosed(payload))
      .on('broadcast', { event: 'call-ended' }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (!dom.vcallWin.hidden) { endCall(false); showToast(`📵 ${payload.fromName} ended the call.`); }
      })
      .on('broadcast', { event: 'reaction-update' }, ({ payload }) => handleReactionUpdate(payload))
      .on('broadcast', { event: 'user-kicked' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        const { closeAllCamerasForUser } = await import('./camera.js?v=20260318b');
        if (isCurrentUser || state.cameraWindows[targetId]) await closeAllCamerasForUser(targetId);
        /* Cache last-known name + suppress "leave" system message (kick). */
        try {
          const uidStr = String(targetId);
          const isGlobal = payload?.is_global === true;
          const kickRoom = payload?.room_id ?? null;
          for (const rId of Object.keys(state.rooms || {})) {
            const u = state.rooms[rId]?.users?.[uidStr];
            if (u?.name) state.lastKnownNames[uidStr] = u.name;
            const inScope = isGlobal ? true : (kickRoom ? String(kickRoom) === String(rId) : (String(rId) === String(state.activeRoom)));
            if (inScope) state.suppressLeaveSystemMsg[String(rId) + ':' + uidStr] = { ts: Date.now(), reason: 'kick' };
          }
        } catch (_) {}
        if (isCurrentUser) {
          /* Replay-safe: verify kick still in DB */
          try {
            const snap = await firestore.collection('kicked_users').where('user_id', '==', targetId).get();
            const now = new Date();
            const hasValidKick = snap.docs.some(d => {
              const d_ = d.data();
              const expVal = d_.expires_at;
              const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
              if (!exp || exp <= now) return false;
              if (payload.is_global) return true;
              return String(d_.room_id) === String(payload.room_id);
            });
            if (!hasValidKick) return; /* Unkicked or expired — ignore replay */
          } catch (_) { return; }
          const roomId = payload.room_id;
          if (!state.kickedUsers[targetId]) state.kickedUsers[targetId] = {};
          if (payload.is_global) {
            for (const rId of Object.keys(state.rooms)) state.kickedUsers[targetId][String(rId)] = payload.expires_at;
            const { leaveRoom, renderRoomTabs } = await import('./rooms.js');
            for (const rId of Object.keys(state.rooms)) await leaveRoom(rId, { silent: true, force: true });
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
        const { closeAllCamerasForUser } = await import('./camera.js?v=20260318b');
        if (isCurrentUser || state.cameraWindows[targetId]) await closeAllCamerasForUser(targetId);
        /* Cache last-known name + suppress "leave" system message (ban). */
        try {
          const uidStr = String(targetId);
          for (const rId of Object.keys(state.rooms || {})) {
            const u = state.rooms[rId]?.users?.[uidStr];
            if (u?.name) state.lastKnownNames[uidStr] = u.name;
            state.suppressLeaveSystemMsg[String(rId) + ':' + uidStr] = { ts: Date.now(), reason: 'ban' };
          }
        } catch (_) {}
        if (isCurrentUser) {
          /* Replay-safe: verify ban still exists in DB (avoid stale broadcast after unban) */
          try {
            const snap = await firestore.collection('banned_users').where('user_id', '==', targetId).limit(1).get();
            if (snap.empty) return; /* Unbanned — ignore replayed user-banned */
            const data = snap.docs[0].data();
            const expVal = data.expires_at;
            const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
            if (exp && exp <= new Date()) return; /* Expired — ignore */
          } catch (_) { /* On error, skip applying stale ban */ return; }
          state.bannedUsers[targetId] = { expires_at: payload.expires_at, reason: payload.reason };
          const { leaveRoom, renderRoomTabs } = await import('./rooms.js');
          for (const rId of Object.keys(state.rooms)) await leaveRoom(rId);
          renderRoomTabs();
          const { showBanOverlay } = await import('./kick-ban.js');
          showBanOverlay(payload.reason || 'No reason provided', payload.expires_at);
        } else {
          /* Altri client: togli subito dalla lista così sparisce da user list */
          const uidStr = String(targetId);
          for (const rId of Object.keys(state.rooms || {})) {
            if (state.rooms[rId]?.users[uidStr]) delete state.rooms[rId].users[uidStr];
          }
          const u = state.users.find(us => String(us.id) === uidStr);
          if (u) u.online = false;
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
          window.location.reload();
        }
      })
      .on('broadcast', { event: 'user-muted' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const roomId = payload.room_id ?? null;
        /* Replay-safe: verify mute still in DB */
        try {
          const snap = await firestore.collection('muted_users').where('user_id', '==', targetId).get();
          const now = new Date();
          const hasValidMute = snap.docs.some(d => {
            const d_ = d.data();
            const r = d_.room_id ?? null;
            if (String(r) !== String(roomId)) return false;
            const expVal = d_.expires_at;
            const exp = expVal ? (expVal.toDate ? expVal.toDate() : new Date(expVal)) : null;
            return !exp || exp > now;
          });
          if (!hasValidMute) return; /* Unmuted or expired — ignore replay */
        } catch (_) { return; }
        const { closeAllCamerasForUser, closeCameraWindow } = await import('./camera.js?v=20260318b');
        if (String(targetId) === String(state.currentUser?.id)) await closeAllCamerasForUser(targetId);
        else if (state.cameraWindows[targetId]) await closeCameraWindow(targetId);
        state.mutedUsers[targetId] = { room_id: roomId, expires_at: payload.expires_at };
        renderUsers();
        /* Toast solo se messaggio recente (no replay al refresh: evita "sei stato mutato" 3 volte) */
        const ts = payload?.ts || 0;
        if (String(targetId) === String(state.currentUser?.id) && (!ts || Date.now() - ts <= BROADCAST_UI_MAX_AGE_MS)) {
          showToast(`🔇 You have been muted.`);
        }
      })
      .on('broadcast', { event: 'user-unmuted' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const roomId = payload.room_id || null;
        if (roomId === null) delete state.mutedUsers[targetId];
        else {
          const mute = state.mutedUsers[targetId];
          if (mute && mute.room_id === roomId) delete state.mutedUsers[targetId];
        }
        renderUsers();
      })
      .on('broadcast', { event: 'game-answer' }, async ({ payload }) => {
        if (payload.game_type === 'quiz' && payload.room_id === state.activeRoom) {
          const { updateGamesPanel } = await import('./games.js');
          setTimeout(() => updateGamesPanel(), 100);
        }
      })
      .on('broadcast', { event: 'game-question' }, async ({ payload }) => {
        if (payload.game_type === 'quiz' && payload.room_id === state.activeRoom && String(payload.from) !== String(state.currentUser?.id)) {
          const { updateGamesPanel } = await import('./games.js');
          setTimeout(() => updateGamesPanel(), 100);
        }
      })
      .on('broadcast', { event: 'game-started' }, async ({ payload }) => {
        if (payload.room_id === state.activeRoom && String(payload.from) !== String(state.currentUser?.id)) {
          const { checkActiveGame } = await import('./games.js');
          await checkActiveGame();
        }
      })
      .on('broadcast', { event: 'session-invalidated' }, async ({ payload }) => {
        if (disconnectOverlayShown || !state.currentUser || String(payload.user_id || payload.userId) !== String(state.currentUser.id)) return;
        const { verifySessionImmediately } = await import('./auth.js');
        const token = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => null) : null;
        if (!token) return;
        const isValid = await verifySessionImmediately(state.currentUser.id, token);
        if (!isValid) showDisconnectedOverlay(true); /* altra scheda: modal e reset subito */
      })
      .on('broadcast', { event: 'force-disconnect' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        if (!state.currentUser || !targetId) return;
        const isCurrentUser = String(targetId) === String(state.currentUser.id);
        try {
          const { closeAllCamerasForUser } = await import('./camera.js?v=20260318b');
          if (isCurrentUser || state.cameraWindows[targetId]) {
            await closeAllCamerasForUser(targetId);
          }
        } catch (_) {}
        if (isCurrentUser) {
          /* La vittima deve uscire da tutte le stanze e attendere che la presenza sia rimossa (altrimenti al refresh riappare) */
          const roomIds = Object.keys(state.rooms || {});
          const { leaveRoom, renderRoomTabs } = await import('./rooms.js');
          for (const rId of roomIds) {
            await leaveRoom(rId, { silent: true, force: true });
          }
          renderRoomTabs();
          showDisconnectedOverlay(true);
        } else {
          const uidStr = String(targetId);
          for (const rId of Object.keys(state.rooms || {})) {
            if (state.rooms[rId]?.users[uidStr]) delete state.rooms[rId].users[uidStr];
          }
          const u = state.users.find(u => String(u.id) === uidStr);
          if (u) u.online = false;
          renderUsers();
        }
      })
      .subscribe();

    clearDisconnectGrace();
    showToast('🟢 Connected to NeverVideoChat');
    startSessionCheckInterval();
    /* Listener su active_sessions: se session_id cambia (login altrove), disconetti subito */
    const uid = state.currentUser?.id;
    if (uid && state.currentUser && !state.currentUser.isGuest) {
      activeSessionUnsubscribe = firestore.collection('active_sessions').doc(String(uid)).onSnapshot(snap => {
        if (disconnectOverlayShown || !snap.exists || isDisconnectingOthers) return;
        const data = snap.data();
        const docSessionId = data?.session_id ?? null;
        import('./auth.js').then(({ getSavedSessionId }) => {
          if (disconnectOverlayShown) return;
          const myId = getSavedSessionId();
          if (myId != null && docSessionId != null && docSessionId !== myId) {
            /* Login in altra scheda: mostra subito modal e resetta tutto, senza grazia */
            showDisconnectedOverlay(true);
            if (activeSessionUnsubscribe) { activeSessionUnsubscribe(); activeSessionUnsubscribe = null; }
          }
        });
      });
    }
  } catch (err) {
    console.error('[Firebase] Connection error:', err);
    showToast('⚠️ Could not connect.');
  } finally {
    reconnectingSupabase = false;
  }
}

export function initFirebaseClient() {
  if (!firebase || !firebaseConfig?.projectId) {
    console.warn('[NVC] Firebase not configured or SDK not loaded.');
    return false;
  }
  app = firebase.initializeApp(firebaseConfig);
  auth = app.auth();
  firestore = app.firestore();
  rtdb = FIREBASE_RTDB_URL ? app.database(FIREBASE_RTDB_URL) : app.database();
  const storage = app.storage();
  storageRef = storage.ref();

  if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL.includes('supabase') && !SUPABASE_ANON_KEY.startsWith('YOUR_')) {
    const supabaseGlobal = typeof window !== 'undefined' && window.supabase;
    const createClient = supabaseGlobal?.createClient ?? (typeof supabaseGlobal === 'function' ? supabaseGlobal : null);
    if (typeof createClient === 'function') {
      try {
        supabaseStorageClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[NVC] Storage: using Supabase bucket chat-media');
      } catch (e) {
        console.warn('[NVC] Storage: Supabase createClient failed, using Firebase Storage:', e?.message || e);
      }
    } else {
      console.warn('[NVC] Storage: Supabase script not loaded (window.supabase missing); using Firebase Storage. Load js/vendor/supabase.min.js for Supabase.');
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lastHiddenAt = Date.now();
    else if (disconnectGraceTimer && state.currentUser) {
      connectFirebase();
      if (!graceReconnectInterval) {
        graceReconnectInterval = setInterval(() => {
          if (!disconnectGraceTimer || !state.currentUser) return;
          connectFirebase();
        }, 15000);
      }
    }
  });

  auth.onAuthStateChanged((user) => {
    if (user) {
      sessionJustCreated = true;
      sessionCreationTime = Date.now();
      setTimeout(() => { sessionJustCreated = false; }, 30000);
    }
    if (!user && !sessionJustCreated && !isDisconnectingOthers) showDisconnectedOverlay();
  });

  state.fb = { auth: authAdapter(), firestore, rtdb, storageRef, storage: { from: storageFrom }, getStoragePublicUrl };
  return true;
}

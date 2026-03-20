/* ================================================================
   private-chat.js  — PM windows, incoming PM handler
================================================================ */
import { state }       from './state.js';
import { dom }         from './dom.js';
import { escHtml, avatarColor, initials, fmtTime, showToast, playPMNotificationSoundIfEnabled, makeDraggable } from './utils.js';
import { findUser, ensureUser, checkIsMuted } from './users.js?v=20260453';
import { broadcast }   from './broadcast.js';
import { setPendingCamRequest } from './storage.js';
import { isRoomCameraActive } from './camera.js';

/* Forward ref: set by main.js */
let _supabaseReady = null;
export function setPChatDeps(supaReady) { _supabaseReady = supaReady; }

/* ── Internal helpers ── */
function initOrGetPChat(uid) {
  if (!state.privateChats) state.privateChats = {};
  if (!state.privateChats[uid]) state.privateChats[uid] = { msgs: [], unread: 0, popup: null, minimised: false };
  return state.privateChats[uid];
}

export function openPrivateChat(uid) {
  /* Guard: never allow PM to self (uid can be 'me' or the actual currentUser id) */
  if (!uid || uid === 'me' || String(uid) === String(state.currentUser?.id)) return;
  const chat = initOrGetPChat(uid);
  if (chat.popup) { if (chat.minimised) restorePChat(uid); return; }
  const user = findUser(uid); if (!user) return;
  const color = avatarColor(user.name), init = initials(user.name);

  const popup = document.createElement('div');
  popup.className = 'pchat-popup'; popup.dataset.userId = uid;
  popup.innerHTML = `
    <div class="pchat-hdr">
      <div class="pchat-user-info">
        <div class="pchat-avatar" style="background:${color}">${init}</div>
        <span class="pchat-uname">${escHtml(user.name)}</span>
        ${user.online ? '<span class="pchat-online-dot"></span>' : ''}
      </div>
      <div class="pchat-ctrls">
        <button class="pchat-ctrl-btn pchat-vcall-btn" title="Video Call" aria-label="Start video call">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
        </button>
        <button class="pchat-ctrl-btn pchat-min-btn" title="Minimise">—</button>
        <button class="pchat-ctrl-btn pchat-close-btn" title="Close">✕</button>
      </div>
    </div>
    <div class="pchat-msgs" id="pchat-msgs-${uid}"></div>
    <div class="pchat-input-row">
      <input class="pchat-input" type="text" placeholder="Message ${escHtml(user.name)}…"
             id="pchat-input-${uid}" autocomplete="off">
      <button class="pchat-send-btn" id="pchat-send-${uid}" aria-label="Send">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>`;

  dom.privateChatCont.appendChild(popup);
  chat.popup = popup; chat.minimised = false;
  chat.msgs.forEach(m => renderPMsg(uid, m));
  makeDraggable(popup, popup.querySelector('.pchat-hdr'));

  popup.querySelector('.pchat-min-btn').addEventListener('click',   () => minPChat(uid));
  popup.querySelector('.pchat-close-btn').addEventListener('click', () => closePChat(uid));
  popup.querySelector('.pchat-vcall-btn').addEventListener('click', async () => {
    if (!_supabaseReady?.()) { showToast('⚠️ Server connection required for video calls.'); return; }
    if (!dom.vcallWin.hidden) { showToast('📹 A video call is already active.'); return; }
    if (isRoomCameraActive()) { showToast('Disattiva prima la cam nella stanza.'); return; }
    const myMute = state.currentUser?.id ? checkIsMuted(state.currentUser.id, state.activeRoom) : null;
    if (myMute) {
      const scope = myMute.global ? 'globally' : 'in this room';
      showToast(`🔇 You are muted ${scope} and cannot request video calls.`);
      return;
    }
    if (state.rejectedCamUsers?.[String(uid)]) {
      showToast(`🚫 ${user.name} rejected your request. Unblock in Settings.`); return;
    }
    if (state.pendingCamRequests?.[String(uid)]) {
      showToast(`⏳ Already waiting for ${user.name}'s reply.`); return;
    }
    /* Nuova richiesta esplicita: se avevamo chiuso manualmente la sua cam, togli il blocco così può riaprirsi. */
    if (state.manuallyClosedCameras?.[uid]) {
      delete state.manuallyClosedCameras[uid];
      console.log('[PChat] Clearing manual-close flag for', uid, 'due to explicit private cam request');
    }
    setPendingCamRequest(String(uid), 'private', user.name);
    let requesterHasForceView = false;
    try { const { hasPermission } = await import('./permissions.js'); requesterHasForceView = hasPermission('can_view_cam_without_accept'); } catch (_) {}
    broadcast('cam-req', uid, { reqType: 'private', requesterHasForceView });
    showToast(`📹 Video call request sent to ${user.name}…`);
  });

  const input = popup.querySelector(`#pchat-input-${uid}`);
  const sBtn  = popup.querySelector(`#pchat-send-${uid}`);
  async function doSend() {
    const txt = input.value.trim(); if (!txt) return;

    /* PM: se il destinatario non risulta online, blocca l'invio */
    const targetUid = String(uid);
    // In questa app `state.users[].online` può restare momentaneamente "stale".
    // Per bloccare correttamente usiamo la presenza live: il destinatario deve esistere in `room.users`.
    const isOnlineNow = Object.values(state.rooms || {}).some((r) => {
      const users = r?.users || {};
      return !!users[targetUid];
    });
    if (!isOnlineNow) {
      showToast('Mi dispiace, ma al momento la persona a cui stai scrivendo non è online.');
      return;
    }
    
    /* Security: Validate message length */
    const { MAX_MESSAGE_LENGTH } = await import('./config.js');
    if (txt.length > MAX_MESSAGE_LENGTH) {
      showToast(`⚠️ Message too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }

    const { checkPrivateChatSpam, registerPrivateChatSent } = await import('./chat-antispam.js');
    const spam = checkPrivateChatSpam(uid, txt);
    if (!spam.ok) {
      showToast(spam.toast);
      return;
    }
    registerPrivateChatSent(uid, txt);

    const msg = { from: 'me', text: txt, ts: Date.now() };
    chat.msgs.push(msg); renderPMsg(uid, msg); input.value = '';
    broadcast('pm', uid, { text: txt, ts: msg.ts });
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  sBtn.addEventListener('click', doSend);
  input.focus();
}

export function renderPMsg(uid, msg) {
  const chat = state.privateChats?.[uid]; if (!chat?.popup) return;
  const c = chat.popup.querySelector(`#pchat-msgs-${uid}`); if (!c) return;
  const el = document.createElement('div');
  el.className = `pchat-msg${msg.from === 'me' ? ' own' : ''}`;
  /* Security: Validate and limit message length */
  const safeText = (msg.text || '').substring(0, 10000);
  el.innerHTML = `<div class="pchat-bubble">${escHtml(safeText)}</div><div class="pchat-time">${fmtTime(msg.ts)}</div>`;
  c.appendChild(el); c.scrollTop = c.scrollHeight;
}

export function minPChat(uid) {
  const chat = state.privateChats?.[uid]; if (!chat?.popup) return;
  chat.popup.style.display = 'none'; chat.minimised = true;
  if (!dom.minimisedBar.querySelector(`[data-userid="${uid}"]`)) {
    const user = findUser(uid);
    const btn = document.createElement('button');
    btn.className = 'min-chat-btn'; btn.dataset.userid = uid;
    btn.style.background = avatarColor(user?.name ?? '?'); btn.textContent = initials(user?.name ?? '?');
    btn.title = user?.name ?? uid;
    const badge = document.createElement('span'); badge.className = 'min-chat-badge'; badge.id = `min-badge-${uid}`; badge.hidden = true;
    btn.appendChild(badge); btn.addEventListener('click', () => restorePChat(uid));
    dom.minimisedBar.appendChild(btn);
  }
}

export function restorePChat(uid) {
  const chat = state.privateChats?.[uid];
  if (!chat?.popup) { openPrivateChat(uid); return; }
  chat.popup.style.display = '';
  chat.minimised = false;
  const msgCont = chat.popup.querySelector(`#pchat-msgs-${uid}`);
  if (msgCont) { msgCont.innerHTML = ''; chat.msgs.forEach(m => renderPMsg(uid, m)); }
  chat.unread = 0; updateMinBadge(uid);
  dom.minimisedBar.querySelector(`[data-userid="${uid}"]`)?.remove();
}

export function closePChat(uid) {
  const chat = state.privateChats?.[uid]; if (!chat) return;
  chat.popup?.remove(); chat.popup = null;
  dom.minimisedBar.querySelector(`[data-userid="${uid}"]`)?.remove();
  chat.minimised = false; chat.unread = 0;
}

function updateMinBadge(uid) {
  const chat  = state.privateChats?.[uid];
  const badge = document.getElementById(`min-badge-${uid}`); if (!badge) return;
  if (chat?.unread > 0) { badge.textContent = chat.unread; badge.hidden = false; }
  else { badge.hidden = true; }
}

export function handleIncomingPM(payload) {
  if (String(payload.to) !== String(state.currentUser?.id)) return;
  const fromId   = String(payload.from);
  const fromName = payload.fromName || 'User';
  if (state.ignoredUsers[fromId]) return;   /* silently drop */

  ensureUser(fromId, fromName, { online: true });
  const chat = initOrGetPChat(fromId);
  const msg  = { from: fromId, text: payload.text, ts: payload.ts || Date.now() };
  chat.msgs.push(msg);
  playPMNotificationSoundIfEnabled();

  if (!chat.popup) {
    openPrivateChat(fromId);
  } else if (chat.minimised) {
    chat.unread++;
    updateMinBadge(fromId);
    showToast(`💬 ${fromName}: ${payload.text.slice(0, 60)}`);
  } else {
    renderPMsg(fromId, msg);
  }
}

/* ================================================================
   ui.js  — toolbar, emoji, voice, images, context menu, panel
================================================================ */
import { EMOJI_CATEGORIES }  from './config.js';
import { state }             from './state.js';
import { dom }               from './dom.js';
import { $, escHtml, avatarColor, initials, clamp, showToast } from './utils.js';
import { findUser }          from './users.js';
import { addIgnoredUser, removeIgnoredUser } from './storage.js';
import { broadcast }         from './broadcast.js';
import { closeCameraWindow, revokeViewer, refreshViewersPanel, requestPublicCamera } from './camera.js';
import { openPrivateChat, closePChat } from './private-chat.js';
import { sendMessage, clearReplyTo }  from './chat.js';
import { sendTypingEvent } from './users.js';

/* Forward ref for uploadToStorage (set by main.js) */
let _uploadToStorage = null;
let _supabaseReady   = null;
export function setUIDeps(upload, supaReady) { _uploadToStorage = upload; _supabaseReady = supaReady; }

/* ── Rich-text toolbar ─────────────────────────────────────────── */
export function initToolbar() {
  dom.boldBtn.addEventListener('click', () => {
    state.isBold = !state.isBold;
    dom.boldBtn.setAttribute('aria-pressed', String(state.isBold));
    dom.boldBtn.classList.toggle('active', state.isBold);
    dom.msgInput.focus(); document.execCommand('bold');
  });
  dom.colorPicker.addEventListener('input', e => {
    state.currentColor = e.target.value;
    dom.msgInput.focus(); document.execCommand('foreColor', false, state.currentColor);
  });
  dom.fontSizeSelect.addEventListener('change', e => {
    state.fontSize = e.target.value;
    dom.msgInput.focus(); document.execCommand('fontSize', false, state.fontSize);
  });
  dom.msgInput.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); dom.boldBtn.click(); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  dom.msgInput.addEventListener('input', sendTypingEvent);
  dom.sendBtn.addEventListener('click', sendMessage);
}

/* ── Image attachment ──────────────────────────────────────────── */
export function initImageAttach() {
  dom.imageAttachBtn.addEventListener('click', () => dom.imageFileInput.click());
  dom.imageFileInput.addEventListener('change', e => {
    const f = e.target.files[0]; if (f) loadImageFile(f); e.target.value = '';
  });
  dom.msgInput.addEventListener('paste', e => {
    const items = e.clipboardData?.items; if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) { e.preventDefault(); loadImageFile(item.getAsFile()); return; }
    }
  });
  dom.previewRemoveBtn.addEventListener('click', () => {
    state.pendingImage = null; dom.imgPreviewStrip.hidden = true; dom.previewThumb.src = '';
  });
}
function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    state.pendingImage = { dataUrl: ev.target.result, type: file.type };
    dom.previewThumb.src = ev.target.result; dom.imgPreviewStrip.hidden = false;
  };
  reader.readAsDataURL(file);
}

export async function uploadToStorage(input, folder, ext) {
  if (!_supabaseReady?.()) return null;
  try {
    let blob;
    if (typeof input === 'string') { const res = await fetch(input); blob = await res.blob(); }
    else blob = input;
    const name = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext || 'bin'}`;
    const { error } = await state.supa.storage.from('chat-media').upload(name, blob, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data: { publicUrl } } = state.supa.storage.from('chat-media').getPublicUrl(name);
    return publicUrl;
  } catch (err) { console.warn('Storage upload error:', err); return null; }
}

/* ── Emoji picker ──────────────────────────────────────────────── */
export function initEmojiPicker() {
  buildEmojiPicker();
  dom.emojiPickerBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = !dom.emojiPanel.hidden;
    dom.emojiPanel.hidden = open;
    dom.emojiPickerBtn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', e => {
    if (!dom.emojiPanel.hidden && !dom.emojiPanel.contains(e.target) && e.target !== dom.emojiPickerBtn) {
      dom.emojiPanel.hidden = true; dom.emojiPickerBtn.setAttribute('aria-expanded', 'false');
    }
  });
}
function buildEmojiPicker() {
  const tabs = Object.keys(EMOJI_CATEGORIES); let active = tabs[0];
  function renderTab(key) {
    active = key; dom.emojiGrid.innerHTML = '';
    EMOJI_CATEGORIES[key].forEach(emoji => {
      const c = document.createElement('button'); c.type = 'button'; c.className = 'emoji-cell';
      c.textContent = emoji; c.setAttribute('aria-label', emoji);
      c.addEventListener('click', () => insertEmoji(emoji)); dom.emojiGrid.appendChild(c);
    });
    dom.emojiTabsRow.querySelectorAll('.emoji-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  }
  tabs.forEach(key => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'emoji-tab-btn';
    b.textContent = key; b.dataset.key = key; b.addEventListener('click', () => renderTab(key));
    dom.emojiTabsRow.appendChild(b);
  });
  renderTab(active);
}
function insertEmoji(emoji) {
  dom.msgInput.focus();
  const sel = window.getSelection();
  if (sel?.rangeCount) {
    const r = sel.getRangeAt(0); r.deleteContents();
    const n = document.createTextNode(emoji); r.insertNode(n);
    r.setStartAfter(n); r.setEndAfter(n); sel.removeAllRanges(); sel.addRange(r);
  } else { dom.msgInput.textContent += emoji; }
  dom.emojiPanel.hidden = true; dom.emojiPickerBtn.setAttribute('aria-expanded', 'false');
}

/* ── Voice recording ───────────────────────────────────────────── */
export function initVoiceRecording() {
  dom.voiceMsgBtn.addEventListener('click',   startRecording);
  dom.recStopBtn.addEventListener('click',    stopRecording);
  dom.recCancelBtn.addEventListener('click',  cancelRecording);
}

function mimeToExt(m) {
  return { 'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/x-m4a':'m4a','audio/aac':'aac','audio/mpeg':'mp3' }
    [(m || '').split(';')[0].toLowerCase().trim()] || 'webm';
}

function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) { showToast('⚠️ Voice recording not supported.'); return; }
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      state.recordingChunks = []; state.recordingSeconds = 0;
      const mime = ['audio/webm;codecs=opus','audio/webm','audio/ogg','audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      state.mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      state.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) state.recordingChunks.push(e.data); };
      state.mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const actualMime = state.mediaRecorder.mimeType || 'audio/webm';
        const ext  = mimeToExt(actualMime);
        const blob = new Blob(state.recordingChunks, { type: actualMime });
        if (!_supabaseReady?.()) { showToast('⚠️ Not connected — voice messages require Supabase.'); dom.voiceRecStrip.hidden = true; clearInterval(state.recordingTimer); dom.recTimer.textContent = '0:00'; return; }
        showToast('⏳ Uploading voice message…');
        const url = await uploadToStorage(blob, 'voices', ext);
        if (!url) { showToast('⚠️ Voice upload failed.'); dom.voiceRecStrip.hidden = true; clearInterval(state.recordingTimer); dom.recTimer.textContent = '0:00'; return; }
        /* Import addMessage lazily to avoid circular dep */
        const { addMessage } = await import('./chat.js');
        const html = `<div class="voice-msg-wrap">🎙️ Voice message<audio controls src="${url}" preload="metadata"></audio></div>`;
        addMessage({ userId: 'me', html, ts: Date.now() });
        state.supa.from('messages').insert({
          user_id: state.currentUser.id, username: state.currentUser.name, content: html, room_id: state.activeRoom,
        }).then(({ error }) => { if (error) console.warn('voice msg insert:', error); });
        dom.voiceRecStrip.hidden = true; clearInterval(state.recordingTimer); dom.recTimer.textContent = '0:00';
      };
      state.mediaRecorder.start(250); dom.voiceRecStrip.hidden = false;
      state.recordingTimer = setInterval(() => {
        state.recordingSeconds++;
        dom.recTimer.textContent = `${Math.floor(state.recordingSeconds/60)}:${String(state.recordingSeconds%60).padStart(2,'0')}`;
      }, 1000);
    })
    .catch(() => showToast('🎙️ Microphone access denied.'));
}
function stopRecording()   { if (state.mediaRecorder?.state !== 'inactive') state.mediaRecorder.stop(); clearInterval(state.recordingTimer); }
function cancelRecording() {
  if (state.mediaRecorder?.state !== 'inactive') {
    state.mediaRecorder.onstop = () => {};
    state.mediaRecorder.stop();
    state.mediaRecorder.stream?.getTracks().forEach(t => t.stop());
  }
  clearInterval(state.recordingTimer); dom.voiceRecStrip.hidden = true; dom.recTimer.textContent = '0:00';
}

/* ── Context menu ──────────────────────────────────────────────── */
export function openContextMenu(uid, anchor) {
  const user = findUser(uid); if (!user || uid === state.currentUser?.id) return;
  state.contextTargetUID = uid;
  const color = avatarColor(user.name), init = initials(user.name);
  dom.ctxUserHdr.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px">
    <span style="display:inline-flex;width:22px;height:22px;border-radius:50%;background:${color};align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0">${init}</span>
    ${escHtml(user.name)}</span>`;

  const isIgnored  = !!state.ignoredUsers[String(uid)];
  const alreadyView = !!state.cameraWindows[String(uid)];
  const pendingReq  = !!state.pendingCamRequests[String(uid)];
  const isOffline   = user.online !== true;
  const camBlocked  = alreadyView || pendingReq || isOffline || isIgnored;

  dom.ctxCamBtn.disabled      = camBlocked;
  dom.ctxCamBtn.style.opacity = camBlocked ? '0.35' : '1';
  dom.ctxCamBtn.title = alreadyView ? 'Already viewing their camera'
                      : pendingReq  ? 'Request already sent — waiting for reply'
                      : isIgnored   ? 'User is ignored — unignore to interact'
                      : isOffline   ? 'User is offline'
                      : user.hasCamera ? 'Request Camera' : 'Request Camera (cam may not be active)';

  if (dom.ctxIgnoreBtn) {
    dom.ctxIgnoreBtn.classList.toggle('is-ignored', isIgnored);
    const ignoreLabel = dom.ctxIgnoreBtn.querySelector('.ctx-ignore-label') || dom.ctxIgnoreBtn;
    ignoreLabel.textContent = isIgnored ? 'Unignore User' : 'Ignore User';
    dom.ctxIgnoreBtn.title  = isIgnored ? 'Stop ignoring this user' : 'Hide messages and revoke cam access';
  }

  /* Show/hide admin actions based on permissions */
  if (dom.ctxAdminActions) {
    checkAndShowAdminActions(uid).then(hasPerms => {
      dom.ctxAdminActions.hidden = !hasPerms;
    });
  }

  const r = anchor.getBoundingClientRect();
  dom.ctxMenu.style.top  = `${clamp(r.bottom + 4, 4, window.innerHeight - 200)}px`;
  dom.ctxMenu.style.left = `${clamp(r.left, 4, window.innerWidth - 210)}px`;
  dom.ctxMenu.hidden = false; dom.ctxOverlay.hidden = false;
}

/* ── Check if current user has admin/mod permissions ── */
async function checkAndShowAdminActions(targetUid) {
  if (!state.supa || !state.currentUser) return false;
  if (String(targetUid) === String(state.currentUser?.id)) return false; /* Can't admin yourself */
  
  try {
    const { data, error } = await state.supa
      .from('profiles')
      .select('role, custom_role_id')
      .eq('id', state.currentUser.id)
      .single();
    if (error || !data) return false;
    
    const role = data.role;
    if (role === 'owner' || role === 'admin') return true;
    if (role === 'moderator') return true;
    
    /* Check custom role permissions */
    if (data.custom_role_id) {
      const { data: customRole } = await state.supa
        .from('custom_roles')
        .select('permissions')
        .eq('id', data.custom_role_id)
        .single();
      if (customRole?.permissions) {
        return customRole.permissions.can_kick || customRole.permissions.can_ban || customRole.permissions.can_mute;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function closeCtxMenu() { dom.ctxMenu.hidden = true; dom.ctxOverlay.hidden = true; state.contextTargetUID = null; }

export function initContextMenu() {
  dom.ctxPrivateBtn.addEventListener('click', () => {
    const u = state.contextTargetUID; closeCtxMenu(); if (u) openPrivateChat(u);
  });
  dom.ctxCamBtn.addEventListener('click', () => {
    const u = state.contextTargetUID; closeCtxMenu(); if (u) requestPublicCamera(u);
  });
  dom.ctxIgnoreBtn?.addEventListener('click', () => {
    const uid  = state.contextTargetUID;
    const user = findUser(uid);
    closeCtxMenu(); if (!uid || !user) return;
    const name = user.username || user.name;
    if (state.ignoredUsers[String(uid)]) {
      removeIgnoredUser(uid); showToast(`✅ ${name} unignored.`);
    } else {
      /* Side-effects: revoke cam access, close their cam window, close PM */
      if (state.camViewers?.[uid]) {
        broadcast('cam-revoked', uid, {});
        delete state.camViewers[uid]; refreshViewersPanel(state.currentUser?.id);
      }
      if (state.cameraWindows?.[uid]) closeCameraWindow(uid);
      closePChat(uid);
      addIgnoredUser(uid, name);
      showToast(`🔇 ${name} ignored — messages and cam access blocked.`);
    }
  });
  /* Admin actions */
  dom.ctxKickBtn?.addEventListener('click', async () => {
    const uid = state.contextTargetUID;
    const user = findUser(uid);
    closeCtxMenu();
    if (!uid || !user) return;
    if (await handleKickUser(uid, user.name || user.username)) {
      showToast(`👢 Kicked ${user.name || user.username}`);
    }
  });
  
  dom.ctxMuteBtn?.addEventListener('click', async () => {
    const uid = state.contextTargetUID;
    const user = findUser(uid);
    closeCtxMenu();
    if (!uid || !user) return;
    const duration = prompt(`Mute ${user.name || user.username} for how many minutes? (0 = permanent)`);
    if (duration === null) return;
    const mins = parseInt(duration) || 0;
    if (await handleMuteUser(uid, user.name || user.username, mins)) {
      showToast(`🔇 Muted ${user.name || user.username} ${mins > 0 ? `for ${mins} minutes` : 'permanently'}`);
    }
  });
  
  dom.ctxBanBtn?.addEventListener('click', async () => {
    const uid = state.contextTargetUID;
    const user = findUser(uid);
    closeCtxMenu();
    if (!uid || !user) return;
    const reason = prompt(`Ban ${user.name || user.username}. Reason:`);
    if (reason === null) return;
    if (await handleBanUser(uid, user.name || user.username, reason)) {
      showToast(`🚫 Banned ${user.name || user.username}`);
    }
  });
  
  dom.ctxOverlay.addEventListener('click', closeCtxMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtxMenu(); });
}

/* ── Admin action handlers (reuse from admin.js) ── */
async function handleKickUser(userId, userName) {
  if (!state.supa) return false;
  try {
    broadcast('user-kicked', userId, { reason: 'Kicked by admin/mod' });
    return true;
  } catch (err) {
    console.error('[UI] Kick error:', err);
    showToast('⚠️ Failed to kick user.');
    return false;
  }
}

async function handleMuteUser(userId, userName, minutes) {
  if (!state.supa) return false;
  try {
    const expiresAt = minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
    const { error } = await state.supa.from('muted_users').upsert({
      user_id: userId,
      muted_by: state.currentUser.id,
      expires_at: expiresAt,
    }, { onConflict: 'user_id' });
    if (error) throw error;
    broadcast('user-muted', userId, { duration: minutes });
    return true;
  } catch (err) {
    console.error('[UI] Mute error:', err);
    showToast('⚠️ Failed to mute user.');
    return false;
  }
}

async function handleBanUser(userId, userName, reason) {
  if (!state.supa) return false;
  try {
    const { error } = await state.supa.from('banned_users').upsert({
      user_id: userId,
      username: userName,
      reason: reason || 'Banned by admin/mod',
      banned_by: state.currentUser.id,
    }, { onConflict: 'user_id' });
    if (error) throw error;
    broadcast('user-banned', userId, { reason: reason || 'Banned by admin/mod' });
    return true;
  } catch (err) {
    console.error('[UI] Ban error:', err);
    showToast('⚠️ Failed to ban user.');
    return false;
  }
}

/* ── Panel resize (desktop) ────────────────────────────────────── */
export function initPanelResize() {
  const handle = document.getElementById('panelResizeHandle');
  const panel  = dom.usersPanel;
  if (!handle || !panel) return;
  const savedW = parseInt(localStorage.getItem('nvc_panel_w'), 10);
  if (savedW >= 160 && savedW <= 480) panel.style.width = savedW + 'px';
  let dragging = false, startX = 0, startW = 0;
  const onStart = e => { dragging = true; startX = e.touches?.[0]?.clientX ?? e.clientX; startW = panel.getBoundingClientRect().width; handle.classList.add('is-resizing'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault(); };
  const onMove  = e => { if (!dragging) return; const x = e.touches?.[0]?.clientX ?? e.clientX; panel.style.width = Math.min(480, Math.max(160, startW + (startX - x))) + 'px'; };
  const onEnd   = () => { if (!dragging) return; dragging = false; handle.classList.remove('is-resizing'); document.body.style.cursor = ''; document.body.style.userSelect = ''; localStorage.setItem('nvc_panel_w', parseInt(panel.style.width, 10)); };
  handle.addEventListener('mousedown', onStart);
  handle.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onEnd);
  document.addEventListener('touchend',  onEnd);
}

/* ── Mobile panel ──────────────────────────────────────────────── */
export function initMobilePanel() {
  const open  = () => { dom.usersPanel.classList.add('open'); dom.panelOverlay.classList.add('show'); dom.mobileUsersToggle.setAttribute('aria-expanded','true'); };
  const close = () => { dom.usersPanel.classList.remove('open'); dom.panelOverlay.classList.remove('show'); dom.mobileUsersToggle.setAttribute('aria-expanded','false'); };
  dom.mobileUsersToggle.addEventListener('click', () => dom.usersPanel.classList.contains('open') ? close() : open());
  dom.closePanelBtn.addEventListener('click', close);
  dom.panelOverlay.addEventListener('click', close);
}

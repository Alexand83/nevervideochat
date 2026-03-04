/* ================================================================
   ui.js  — toolbar, emoji, voice, images, context menu, panel
================================================================ */
import { EMOJI_CATEGORIES }  from './config.js';
import { state }             from './state.js';
import { dom }               from './dom.js';
import { $, escHtml, avatarColor, initials, clamp, showToast } from './utils.js';
import { findUser, checkIsMuted, renderUsers } from './users.js';
import { addIgnoredUser, removeIgnoredUser } from './storage.js';
import { broadcast }         from './broadcast.js';
import { closeCameraWindow, closeAllCamerasForUser, revokeViewer, refreshViewersPanel, requestPublicCamera } from './camera.js?v=20260437';
import { openPrivateChat, closePChat } from './private-chat.js';
import { sendMessage, clearReplyTo }  from './chat.js';
import { sendTypingEvent } from './users.js';
import { joinRoom, getAvailableRooms } from './rooms.js';

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
    dom.msgInput.focus();
    
    /* Enable CSS styling */
    document.execCommand('styleWithCSS', false, true);
    
    /* For X-Large (5), use fontSize 7 (max) and then override with CSS */
    /* For other sizes, use the value directly */
    const execValue = state.fontSize === '5' ? '7' : state.fontSize;
    document.execCommand('fontSize', false, execValue);
    
    /* For X-Large, immediately replace the <font size="7"> with a <span style="font-size: 24px"> */
    if (state.fontSize === '5') {
      /* Use requestAnimationFrame to ensure the font tag is created first */
      requestAnimationFrame(() => {
        const fontTags = dom.msgInput.querySelectorAll('font[size="7"]');
        fontTags.forEach(font => {
          /* Only replace if it doesn't already have a style override */
          if (!font.style.fontSize) {
            const span = document.createElement('span');
            span.style.fontSize = '24px';
            span.innerHTML = font.innerHTML;
            font.parentNode.replaceChild(span, font);
          }
        });
      });
    }
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
  
  /* Check if user has camera active in current room */
  const roomId = state.activeRoom;
  const room = state.rooms[roomId];
  const targetInRoom = room?.users[uid];
  const hasCameraActive = targetInRoom?.hasCamera || (user.hasCamera && user.online);
  
  /* Check if we're in Events room - hide camera request button */
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const isEventsRoom = roomData?.max_cams && roomData.max_cams >= 1 && roomData.max_cams <= 8;
  
  const camBlocked  = alreadyView || pendingReq || isOffline || isIgnored || !hasCameraActive || isEventsRoom;

  dom.ctxCamBtn.disabled      = camBlocked;
  dom.ctxCamBtn.style.opacity = camBlocked ? '0.35' : '1';
  dom.ctxCamBtn.style.display = isEventsRoom ? 'none' : ''; /* Hide in Events room */
  dom.ctxCamBtn.title = isEventsRoom ? 'Cameras are public in Events room'
                      : alreadyView ? 'Already viewing their camera'
                      : pendingReq  ? 'Request already sent — waiting for reply'
                      : isIgnored   ? 'User is ignored — unignore to interact'
                      : isOffline   ? 'User is offline'
                      : !hasCameraActive ? 'User does not have camera active'
                      : 'Request Camera';

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
      
      /* Update mute button text based on mute status */
      if (hasPerms && dom.ctxMuteBtn) {
        const muteInfo = checkIsMuted(uid, state.activeRoom);
        const muteLabel = dom.ctxMuteBtn.querySelector('.ctx-mute-label') || dom.ctxMuteBtn;
        if (muteInfo) {
          muteLabel.textContent = 'Unmute User';
          dom.ctxMuteBtn.title = muteInfo.global ? 'Unmute user globally' : 'Unmute user in this room';
        } else {
          muteLabel.textContent = 'Mute User';
          dom.ctxMuteBtn.title = 'Mute user';
        }
      }
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
  dom.ctxKickBtn?.addEventListener('click', () => {
    const uid = state.contextTargetUID;
    const user = findUser(uid);
    closeCtxMenu();
    if (!uid || !user) return;
    openKickModal(uid, user.name || user.username);
  });
  
  dom.ctxMuteBtn?.addEventListener('click', async () => {
    const uid = state.contextTargetUID;
    const user = findUser(uid);
    closeCtxMenu();
    if (!uid || !user) return;
    
    /* Check if user is already muted */
    const muteInfo = checkIsMuted(uid, state.activeRoom);
    if (muteInfo) {
      /* Unmute user */
      if (await handleUnmuteUser(uid, user.name || user.username, muteInfo)) {
        showToast(`✅ Unmuted ${user.name || user.username}`);
      }
    } else {
      /* Mute user */
      openMuteModal(uid, user.name || user.username);
    }
  });
  
  dom.ctxBanBtn?.addEventListener('click', () => {
    const uid = state.contextTargetUID;
    const user = findUser(uid);
    closeCtxMenu();
    if (!uid || !user) return;
    openBanModal(uid, user.name || user.username);
  });
  
  dom.ctxOverlay.addEventListener('click', closeCtxMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtxMenu(); });
}

/* ── Modal functions ── */
function openKickModal(userId, userName) {
  dom.kickModalUserName.textContent = userName;
  dom.kickModal.hidden = false;
  dom.kickDuration.value = '5';
  dom.kickScopeRoom.checked = true;
  
  const handleConfirm = async () => {
    const mins = parseInt(dom.kickDuration.value) || 0;
    if (mins <= 0) {
      showToast('⚠️ Please enter a valid number of minutes (minimum 1).');
      return;
    }
    const isGlobal = dom.kickScopeGlobal.checked;
    closeKickModal();
    if (await handleKickUser(userId, userName, mins, isGlobal)) {
      showToast(`👢 Kicked ${userName} ${isGlobal ? 'from all rooms' : 'from this room'}`);
    }
  };
  
  const handleCancel = () => {
    closeKickModal();
  };
  
  dom.kickConfirmBtn.onclick = handleConfirm;
  dom.kickCancelBtn.onclick = handleCancel;
  dom.kickModalClose.onclick = handleCancel;
  dom.kickModal.onclick = (e) => { if (e.target === dom.kickModal) handleCancel(); };
  /* Enter key on duration input confirms */
  dom.kickDuration.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); } };
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { handleCancel(); document.removeEventListener('keydown', escHandler); }
  });
  dom.kickDuration.focus();
}

function closeKickModal() {
  dom.kickModal.hidden = true;
}

function openMuteModal(userId, userName) {
  dom.muteModalUserName.textContent = userName;
  dom.muteModal.hidden = false;
  dom.muteDuration.value = '0';
  dom.muteScopeRoom.checked = true;
  
  const handleConfirm = async () => {
    const mins = parseInt(dom.muteDuration.value) || 0;
    const isGlobal = dom.muteScopeGlobal.checked;
    closeMuteModal();
    if (await handleMuteUser(userId, userName, mins, isGlobal)) {
      showToast(`🔇 Muted ${userName} ${isGlobal ? 'globally' : 'in this room'} ${mins > 0 ? `for ${mins} minutes` : 'permanently'}`);
    }
  };
  
  const handleCancel = () => {
    closeMuteModal();
  };
  
  dom.muteConfirmBtn.onclick = handleConfirm;
  dom.muteCancelBtn.onclick = handleCancel;
  dom.muteModalClose.onclick = handleCancel;
  dom.muteModal.onclick = (e) => { if (e.target === dom.muteModal) handleCancel(); };
  /* Enter key on duration input confirms */
  dom.muteDuration.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); } };
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { handleCancel(); document.removeEventListener('keydown', escHandler); }
  });
  dom.muteDuration.focus();
}

function closeMuteModal() {
  dom.muteModal.hidden = true;
}

function openBanModal(userId, userName) {
  dom.banModalUserName.textContent = userName;
  dom.banModal.hidden = false;
  dom.banReason.value = '';
  dom.banTypePermanent.checked = true;
  dom.banTemporaryOptions.style.display = 'none';
  
  dom.banTypePermanent.onchange = () => {
    dom.banTemporaryOptions.style.display = 'none';
  };
  dom.banTypeTemporary.onchange = () => {
    dom.banTemporaryOptions.style.display = 'block';
  };
  
  const handleConfirm = async () => {
    const reason = dom.banReason.value.trim();
    const isPermanent = dom.banTypePermanent.checked;
    let expiresAt = null;
    if (!isPermanent) {
      const days = parseInt(dom.banDays.value) || 0;
      if (days <= 0) {
        showToast('⚠️ Please enter a valid number of days (minimum 1).');
        return;
      }
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }
    closeBanModal();
    if (await handleBanUser(userId, userName, reason, expiresAt)) {
      showToast(`🚫 Banned ${userName} ${isPermanent ? 'permanently' : `for ${dom.banDays.value} days`}`);
    }
  };
  
  const handleCancel = () => {
    closeBanModal();
  };
  
  dom.banConfirmBtn.onclick = handleConfirm;
  dom.banCancelBtn.onclick = handleCancel;
  dom.banModalClose.onclick = handleCancel;
  dom.banModal.onclick = (e) => { if (e.target === dom.banModal) handleCancel(); };
  /* Enter key on days input confirms */
  if (dom.banDays) dom.banDays.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); } };
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { handleCancel(); document.removeEventListener('keydown', escHandler); }
  });
}

function closeBanModal() {
  dom.banModal.hidden = true;
}

/* ── Admin action handlers ── */
async function handleKickUser(userId, userName, minutes, isGlobal) {
  if (!state.supa) return false;
  const mins = minutes || 5;
  
  try {
    const expiresAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
    const roomId = isGlobal ? null : state.activeRoom;
    
    if (isGlobal) {
      /* Global kick: kick from all rooms */
      const { data: rooms } = await state.supa.from('rooms').select('id');
      if (rooms) {
        for (const room of rooms) {
          await state.supa.from('kicked_users').upsert({
            user_id: userId,
            room_id: String(room.id),
            kicked_by: state.currentUser.id,
            expires_at: expiresAt,
          }, { onConflict: 'user_id,room_id' });
        }
      }
    } else {
      /* Room-specific kick */
      const { error } = await state.supa.from('kicked_users').upsert({
        user_id: userId,
        room_id: state.activeRoom,
        kicked_by: state.currentUser.id,
        expires_at: expiresAt,
      }, { onConflict: 'user_id,room_id' });
      if (error) throw error;
    }
    
    /* Close all cameras for the user */
    await closeAllCamerasForUser(userId);
    
    /* Broadcast kick event */
    broadcast('user-kicked', userId, { room_id: roomId, expires_at: expiresAt, is_global: isGlobal });
    
    /* If kicked user is current user, handle it */
    if (String(userId) === String(state.currentUser?.id)) {
      if (isGlobal) {
        /* Leave all rooms and show kick overlay */
        const { leaveRoom } = await import('./rooms.js');
        const { renderRoomTabs } = await import('./rooms.js');
        for (const rId of Object.keys(state.rooms)) {
          await leaveRoom(rId);
        }
        renderRoomTabs();
        const { showKickOverlay } = await import('./kick-ban.js');
        await showKickOverlay(null, expiresAt, true);
      } else {
        /* Leave this room and show kick overlay */
        const { leaveRoom } = await import('./rooms.js');
        const { renderRoomTabs } = await import('./rooms.js');
        await leaveRoom(state.activeRoom);
        renderRoomTabs();
        const { showKickOverlay } = await import('./kick-ban.js');
        await showKickOverlay(state.activeRoom, expiresAt, false);
      }
    }
    return true;
  } catch (err) {
    console.error('[UI] Kick error:', err);
    showToast('⚠️ Failed to kick user.');
    return false;
  }
}

async function handleMuteUser(userId, userName, minutes, isGlobal) {
  if (!state.supa) return false;
  const roomId = isGlobal ? null : state.activeRoom;
  
  try {
    const expiresAt = minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
    const { error } = await state.supa.from('muted_users').upsert({
      user_id: userId,
      room_id: roomId,  /* NULL = global, TEXT = room-specific */
      muted_by: state.currentUser.id,
      expires_at: expiresAt,
    }, { onConflict: 'user_id,room_id' });
    if (error) throw error;
    
    /* Update local state */
    state.mutedUsers[String(userId)] = { room_id: roomId, expires_at: expiresAt };
    
    /* Close all cameras for the user */
    await closeAllCamerasForUser(userId);
    
    /* Broadcast mute event */
    broadcast('user-muted', userId, { room_id: roomId, duration: minutes, expires_at: expiresAt });
    
    /* Re-render users to show muted indicator */
    renderUsers();
    
    if (String(userId) === String(state.currentUser?.id)) {
      const scopeText = roomId ? 'in this room' : 'globally';
      showToast(`🔇 You have been muted ${scopeText} ${minutes > 0 ? `for ${minutes} minutes` : 'permanently'}.`);
    }
    return true;
  } catch (err) {
    console.error('[UI] Mute error:', err);
    showToast('⚠️ Failed to mute user.');
    return false;
  }
}

async function handleUnmuteUser(userId, userName, muteInfo) {
  if (!state.supa) return false;
  
  try {
    const roomId = muteInfo.global ? null : muteInfo.room_id;
    
    /* Delete mute from database */
    let query = state.supa.from('muted_users').delete().eq('user_id', userId);
    if (roomId === null) {
      query = query.is('room_id', null);
    } else {
      query = query.eq('room_id', roomId);
    }
    
    const { error } = await query;
    if (error) throw error;
    
    /* Update local state */
    if (muteInfo.global || muteInfo.room_id === state.activeRoom) {
      delete state.mutedUsers[String(userId)];
    } else {
      /* If unmuting from a different room, keep the mute for other rooms */
      const mute = state.mutedUsers[String(userId)];
      if (mute && mute.room_id === roomId) {
        delete state.mutedUsers[String(userId)];
      }
    }
    
    /* Broadcast unmute event */
    broadcast('user-unmuted', userId, { room_id: roomId });
    
    /* Re-render users to remove muted indicator */
    renderUsers();
    
    return true;
  } catch (err) {
    console.error('[UI] Unmute error:', err);
    showToast('⚠️ Failed to unmute user.');
    return false;
  }
}

async function handleBanUser(userId, userName, reason, expiresAt) {
  if (!state.supa) return false;
  
  try {
    const { error } = await state.supa.from('banned_users').upsert({
      user_id: userId,
      username: userName,
      reason: reason || 'Banned by admin/mod',
      banned_by: state.currentUser.id,
      expires_at: expiresAt,
    }, { onConflict: 'user_id' });
    if (error) throw error;
    
    /* Close all cameras for the user */
    await closeAllCamerasForUser(userId);
    
    /* Broadcast ban event - user must leave ALL rooms */
    broadcast('user-banned', userId, { reason: reason || 'Banned by admin/mod', expires_at: expiresAt });
    
    /* If banned user is current user, show ban overlay */
    if (String(userId) === String(state.currentUser?.id)) {
      /* Leave all rooms and show ban overlay */
      const { leaveRoom } = await import('./rooms.js');
      const { renderRoomTabs } = await import('./rooms.js');
      for (const rId of Object.keys(state.rooms)) {
        await leaveRoom(rId);
      }
      renderRoomTabs();
      const { showBanOverlay } = await import('./kick-ban.js');
      showBanOverlay(reason || 'No reason provided', expiresAt);
    }
    return true;
  } catch (err) {
    console.error('[UI] Ban error:', err);
    showToast('⚠️ Failed to ban user.');
    return false;
  }
}

/* ── Panel resize (desktop + mobile) ────────────────────────────────────── */
export function initPanelResize() {
  const handle = document.getElementById('panelResizeHandle');
  const panel  = dom.usersPanel;
  if (!handle || !panel) return;
  
  /* Load saved width (desktop) or set default (mobile) */
  const isMobile = window.innerWidth <= 768;
  const savedW = parseInt(localStorage.getItem('nvc_panel_w'), 10);
  if (isMobile) {
    /* On mobile, set default width if not already set */
    if (!panel.style.width || panel.style.width === '') {
      panel.style.width = savedW >= 200 && savedW <= 480 ? savedW + 'px' : '280px';
    }
  } else {
    /* On desktop, use saved width */
    if (savedW >= 160 && savedW <= 480) panel.style.width = savedW + 'px';
  }
  
  let dragging = false, startX = 0, startW = 0;
  
  const onStart = e => {
    dragging = true;
    startX = e.touches?.[0]?.clientX ?? e.clientX;
    startW = panel.getBoundingClientRect().width;
    handle.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  };
  
  const onMove = e => {
    if (!dragging) return;
    const x = e.touches?.[0]?.clientX ?? e.clientX;
    const deltaX = startX - x; /* On mobile (right side), dragging left increases width */
    const newWidth = isMobile 
      ? Math.min(480, Math.max(200, startW + deltaX))  /* Mobile: min 200px, max 480px */
      : Math.min(480, Math.max(160, startW + deltaX)); /* Desktop: min 160px, max 480px */
    panel.style.width = newWidth + 'px';
    e.preventDefault();
  };
  
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const finalWidth = parseInt(panel.style.width, 10);
    if (finalWidth >= 160 && finalWidth <= 480) {
      localStorage.setItem('nvc_panel_w', finalWidth);
    }
  };
  
  handle.addEventListener('mousedown', onStart);
  handle.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onEnd);
  document.addEventListener('touchend',  onEnd);
  document.addEventListener('touchcancel', onEnd);
}

/* ── Mobile panel (e desktop toggle) ──────────────────────────── */
export function initMobilePanel() {
  const open  = () => { dom.usersPanel.classList.add('open'); dom.panelOverlay.classList.add('show'); if (dom.mobileUsersToggle) dom.mobileUsersToggle.setAttribute('aria-expanded','true'); };
  const close = () => { dom.usersPanel.classList.remove('open'); dom.panelOverlay.classList.remove('show'); if (dom.mobileUsersToggle) dom.mobileUsersToggle.setAttribute('aria-expanded','false'); };
  if (dom.mobileUsersToggle) {
    dom.mobileUsersToggle.addEventListener('click', () => dom.usersPanel.classList.contains('open') ? close() : open());
  }
  if (dom.closePanelBtn) {
    dom.closePanelBtn.addEventListener('click', close);
  }
  if (dom.panelOverlay) {
    dom.panelOverlay.addEventListener('click', close);
  }
}

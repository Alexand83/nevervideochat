/* ================================================================
   ui.js  — toolbar, emoji, voice, images, context menu, panel
================================================================ */
import { EMOJI_CATEGORIES }  from './config.js';
import { state }             from './state.js';
import { dom }               from './dom.js';
import { $, escHtml, avatarColor, initials, clamp, showToast, normalizeHexColorForInput, normalizeFontSizeKey } from './utils.js';
import { findUser, checkIsMuted, renderUsers } from './users.js?v=20260462';
import { addIgnoredUser, removeIgnoredUser, loadDeviceSettings, saveDeviceSettings } from './storage.js';
import { broadcast }         from './broadcast.js';
import { closeCameraWindow, closeAllCamerasForUser, revokeViewer, refreshViewersPanel, requestPublicCamera } from './camera.js?v=20260473';
import { openPrivateChat, closePChat } from './private-chat.js';
import { sendMessage, clearReplyTo, addSystemMessage }  from './chat.js?v=20260464';
import { sendTypingEvent } from './users.js?v=20260462';
import { joinRoom, getAvailableRooms } from './rooms.js';
import { hasPermission } from './permissions.js';

/* Forward ref for uploadToStorage (set by main.js) */
let _uploadToStorage = null;
let _supabaseReady   = null;
export function setUIDeps(upload, supaReady) { _uploadToStorage = upload; _supabaseReady = supaReady; }

/* ── Avatar lightbox (enlarge avatar image) ────────────────────── */
let _avatarLbBackdrop = null;
let _avatarLbMedia = null;
let _avatarLbName = null;
let _avatarLbCloseBtn = null;
let _avatarLbDetails = null;
let _avatarLbProfileBtn = null;
let _avatarLbPmBtn = null;
let _avatarLbMenuBtn = null;
let _avatarLbActiveUserId = null;
let _avatarLbAnchorEl = null;
let _avatarLbOpen = false;
let _prevBodyOverflow = '';

function _ensureAvatarLightbox() {
  if (_avatarLbBackdrop) return;
  const backdrop = document.createElement('div');
  backdrop.id = 'avatarLightbox';
  backdrop.className = 'nvc-modal-backdrop avatar-lightbox-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.innerHTML = `
    <div class="avatar-lightbox" role="document">
      <div class="avatar-lightbox-hdr">
        <div class="avatar-lightbox-name" id="avatarLightboxName"></div>
        <button class="nvc-modal-close-btn avatar-lightbox-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="avatar-lightbox-media" id="avatarLightboxMedia"></div>
      <div class="avatar-lightbox-details" id="avatarLightboxDetails"></div>
      <div class="avatar-lightbox-actions">
        <button class="auth-btn-ghost avatar-lightbox-profile-btn" id="avatarLightboxProfileBtn" type="button" hidden>
          Apri profilo
        </button>
        <button class="auth-btn-ghost avatar-lightbox-pm-btn" id="avatarLightboxPmBtn" type="button" hidden>
          Apri chat privata
        </button>
        <button class="auth-btn-ghost avatar-lightbox-menu-btn" id="avatarLightboxMenuBtn" type="button" hidden>
          Menu utente
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  _avatarLbBackdrop = backdrop;
  _avatarLbMedia = backdrop.querySelector('#avatarLightboxMedia');
  _avatarLbName = backdrop.querySelector('#avatarLightboxName');
  _avatarLbDetails = backdrop.querySelector('#avatarLightboxDetails');
  _avatarLbProfileBtn = backdrop.querySelector('#avatarLightboxProfileBtn');
  _avatarLbPmBtn = backdrop.querySelector('#avatarLightboxPmBtn');
  _avatarLbMenuBtn = backdrop.querySelector('#avatarLightboxMenuBtn');
  _avatarLbCloseBtn = backdrop.querySelector('.avatar-lightbox-close');

  _avatarLbCloseBtn.addEventListener('click', () => closeAvatarLightbox());
  _avatarLbProfileBtn?.addEventListener('click', () => {
    closeAvatarLightbox();
    dom.headerProfileBtn?.click();
  });
  _avatarLbPmBtn?.addEventListener('click', () => {
    const uid = _avatarLbActiveUserId;
    if (!uid || uid === 'me' || String(uid) === String(state.currentUser?.id)) return;
    closeAvatarLightbox();
    openPrivateChat(uid);
  });
  _avatarLbMenuBtn?.addEventListener('click', () => {
    const uid = _avatarLbActiveUserId;
    const anchorEl = _avatarLbAnchorEl;
    if (!uid || !anchorEl || uid === 'me' || String(uid) === String(state.currentUser?.id)) return;
    closeAvatarLightbox();
    openContextMenu(uid, anchorEl);
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeAvatarLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _avatarLbOpen) closeAvatarLightbox();
  });
}

function _parseBgUrl(bgImage) {
  const s = String(bgImage || '').trim();
  if (!s || s === 'none') return null;
  const m = s.match(/url\((['"]?)(.*?)\1\)/i);
  return m?.[2] || null;
}

function _getAvatarInfoFromElement(el) {
  if (!el) return null;
  const name =
    el.getAttribute('data-avatar-name') ||
    el.getAttribute('title') ||
    el.closest('.user-item')?.querySelector('.user-item-name')?.textContent ||
    el.closest('.msg-group')?.querySelector('.msg-sender')?.textContent ||
    '';

  const url =
    el.getAttribute('data-avatar-url') ||
    el.dataset?.avatarUrl ||
    _parseBgUrl(el.style?.backgroundImage) ||
    _parseBgUrl(getComputedStyle(el).backgroundImage);

  const initial = (el.getAttribute('data-avatar-initial') || el.textContent || '').trim().slice(0, 2);
  const color =
    el.getAttribute('data-avatar-color') ||
    el.style?.backgroundColor ||
    getComputedStyle(el).backgroundColor ||
    '#111';

  const userId =
    el.getAttribute('data-avatar-user-id') ||
    el.dataset?.avatarUserId ||
    el.closest('.user-item')?.dataset?.userId ||
    null;

  return { name, url, initial, color, userId: userId ? String(userId) : null };
}

function _deviceTypeLabel(deviceType) {
  if (deviceType === 'mobile') return 'Mobile';
  if (deviceType === 'tablet') return 'Tablet';
  return 'Desktop';
}

function _buildAvatarDetails({ userId, fallbackName }) {
  const me = state.currentUser || null;
  const isMe = !!(me && userId && String(userId) === String(me.id));
  const user = isMe ? me : (userId ? findUser(String(userId)) : null);
  const role = user?.roleName || (user?.isGuest ? 'Guest' : 'Registered');
  const status = user?.online === false ? 'Offline' : 'Online';
  const device = _deviceTypeLabel(user?.deviceType);
  const displayName = user?.name || user?.username || fallbackName || 'User';
  const idLabel = userId ? String(userId).slice(0, 10) + (String(userId).length > 10 ? '…' : '') : 'n/a';

  return {
    isMe,
    displayName,
    rows: [
      { k: 'Nome', v: displayName },
      { k: 'Ruolo', v: role },
      { k: 'Stato', v: status },
      { k: 'Dispositivo', v: device },
      { k: 'ID', v: idLabel },
    ],
  };
}

export function openAvatarLightbox({ name = '', url = null, initial = '', color = '#111', userId = null, anchorEl = null } = {}) {
  _ensureAvatarLightbox();
  if (!_avatarLbBackdrop || !_avatarLbMedia || !_avatarLbDetails) return;

  _avatarLbMedia.innerHTML = '';
  const details = _buildAvatarDetails({ userId, fallbackName: name });
  _avatarLbName.textContent = details.displayName;

  if (url) {
    const img = document.createElement('img');
    img.className = 'avatar-lightbox-img';
    img.alt = (name || 'Avatar').trim();
    img.src = url;
    img.loading = 'eager';
    _avatarLbMedia.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'avatar-lightbox-placeholder';
    ph.style.background = color;
    ph.textContent = (initial || '?').slice(0, 2).toUpperCase();
    _avatarLbMedia.appendChild(ph);
  }

  _avatarLbDetails.innerHTML = details.rows
    .map(r => `<div class="avatar-lightbox-row"><span class="avatar-lightbox-k">${escHtml(r.k)}</span><span class="avatar-lightbox-v">${escHtml(r.v)}</span></div>`)
    .join('');
  _avatarLbActiveUserId = details.isMe ? null : (userId ? String(userId) : null);
  _avatarLbAnchorEl = anchorEl || null;
  if (_avatarLbProfileBtn) _avatarLbProfileBtn.hidden = !details.isMe;
  if (_avatarLbPmBtn) _avatarLbPmBtn.hidden = details.isMe || !_avatarLbActiveUserId;
  if (_avatarLbMenuBtn) _avatarLbMenuBtn.hidden = details.isMe || !_avatarLbActiveUserId;

  _prevBodyOverflow = document.body.style.overflow || '';
  document.body.style.overflow = 'hidden';
  _avatarLbBackdrop.hidden = false;
  _avatarLbOpen = true;
}

export function closeAvatarLightbox() {
  if (!_avatarLbBackdrop) return;
  _avatarLbBackdrop.hidden = true;
  _avatarLbOpen = false;
  _avatarLbActiveUserId = null;
  _avatarLbAnchorEl = null;
  document.body.style.overflow = _prevBodyOverflow;
}

export function initAvatarLightbox() {
  _ensureAvatarLightbox();
  /* Capture phase to win against existing click handlers (context menu). */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !(t instanceof Element)) return;
    const av = t.closest('.msg-avatar, .user-item-avatar, .pchat-avatar, .cam-win-avatar');
    if (!av) return;
    const info = _getAvatarInfoFromElement(av);
    if (!info) return;
    /* If it's an avatar without photo and without initial, skip. */
    if (!info.url && !info.initial) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    openAvatarLightbox({ ...info, anchorEl: av });
  }, true);
}

/* ── Rich-text toolbar ─────────────────────────────────────────── */
/**
 * Dopo zoom accessibilità sul .chat-section: il browser applica `zoom` un frame dopo;
 * doppio rAF + execCommand allinea la grandezza toolbar al reale (anche con bozza nel campo).
 */
export function scheduleApplyFontSizeToolbarAfterLayout() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      applyFontSizeToolbarToInput();
    });
  });
}

/** Applica colore/grandezza/grassetto da settings a state e alla toolbar (chiamata da main/auth dopo load settings). */
export function applyRichTextSettings(settings, opts = {}) {
  if (!settings) return;
  const prevFontKey = normalizeFontSizeKey(state.fontSize);
  if (settings.isBold !== undefined) state.isBold = !!settings.isBold;
  if (settings.currentColor !== undefined) state.currentColor = normalizeHexColorForInput(settings.currentColor);
  if (settings.fontSize !== undefined) state.fontSize = normalizeFontSizeKey(settings.fontSize);
  const fontSizeChangedFromProfile =
    settings.fontSize !== undefined && normalizeFontSizeKey(state.fontSize) !== prevFontKey;
  if (dom.boldBtn) {
    dom.boldBtn.setAttribute('aria-pressed', String(state.isBold));
    dom.boldBtn.classList.toggle('active', state.isBold);
  }
  if (dom.colorPicker) dom.colorPicker.value = state.currentColor;
  if (dom.fontSizeSelect) dom.fontSizeSelect.value = state.fontSize;
  syncMsgInputRichTextStyle();
  /*
   * execCommand('fontSize') ricalcola tutta la formattazione: va chiamato solo se la grandezza nel profilo è davvero cambiata.
   * Altrimenti (solo colore/grassetto) rovinava il font size nel contenteditable.
   */
  if (!opts.deferToolbarSync && fontSizeChangedFromProfile) {
    scheduleApplyFontSizeToolbarAfterLayout();
  }
}

function persistRichTextToLocalStorage() {
  const merged = {
    ...loadDeviceSettings(),
    isBold: state.isBold,
    currentColor: normalizeHexColorForInput(state.currentColor),
    fontSize: normalizeFontSizeKey(state.fontSize),
  };
  state.settings = { ...(state.settings || {}), isBold: merged.isBold, currentColor: merged.currentColor, fontSize: merged.fontSize };
  saveDeviceSettings(merged);
  void import('./auth.js').then(({ pushRichTextPrefsToProfile }) => pushRichTextPrefsToProfile?.()).catch(() => {});
}

/** Mappa valore toolbar (1–5) a px per l’input: così il testo digitato eredita colore/dimensione/grassetto. */
const FONT_SIZE_PX = { '1': '10px', '2': '12px', '3': '14px', '4': '18px', '5': '24px' };

/** Applica colore, grandezza e grassetto allo stile dell’area messaggio così ciò che si scrive corrisponde alla toolbar.
 *  Con accessibilità >100% lo zoom su .msg-input (CSS) scala tutto senza !important sui figli. */
export function syncMsgInputRichTextStyle() {
  if (!dom.msgInput) return;
  dom.msgInput.style.color = state.currentColor || '';
  const fs = normalizeFontSizeKey(state.fontSize);
  dom.msgInput.style.fontSize = FONT_SIZE_PX[fs] || '14px';
  dom.msgInput.style.fontWeight = state.isBold ? 'bold' : 'normal';
}

/** Riapplica colore e grassetto solo agli span/font che non li hanno (creati da fontSize senza colore). Non sovrascrive formattazione mista. */
function applyColorAndBoldToRichNodes() {
  if (!dom.msgInput) return;
  const color = state.currentColor || '';
  const weight = state.isBold ? 'bold' : 'normal';
  dom.msgInput.querySelectorAll('span, font').forEach(el => {
    if (!el.style.color || String(el.style.color).trim() === '') el.style.color = color;
    if (!el.style.fontWeight || String(el.style.fontWeight).trim() === '') el.style.fontWeight = weight;
  });
}

/** Stesso flusso del select “Font size”: sync + execCommand fontSize sui nodi del contenteditable. */
export function applyFontSizeToolbarToInput() {
  if (!dom.msgInput) return;
  syncMsgInputRichTextStyle();
  dom.msgInput.focus();
  document.execCommand('styleWithCSS', false, true);
  const fs = normalizeFontSizeKey(state.fontSize);
  const execValue = fs === '5' ? '7' : fs;
  document.execCommand('fontSize', false, execValue);
  applyColorAndBoldToRichNodes();
  requestAnimationFrame(() => {
    if (fs === '5') {
      const fontTags = dom.msgInput.querySelectorAll('font[size="7"]');
      fontTags.forEach(font => {
        if (!font.style.fontSize) {
          const span = document.createElement('span');
          span.style.fontSize = '24px';
          span.style.color = state.currentColor || '';
          span.style.fontWeight = state.isBold ? 'bold' : 'normal';
          span.innerHTML = font.innerHTML;
          font.parentNode.replaceChild(span, font);
        }
      });
    }
    applyColorAndBoldToRichNodes();
  });
  setTimeout(applyColorAndBoldToRichNodes, 0);
}

/** Dopo accessibilità → 100%: riapplica la grandezza toolbar al testo nell’input (altrimenti serve cambiare il select a mano). */
export function refreshInputAfterA11yOff() {
  applyFontSizeToolbarToInput();
}

export function initToolbar() {
  dom.boldBtn.addEventListener('click', () => {
    state.isBold = !state.isBold;
    dom.boldBtn.setAttribute('aria-pressed', String(state.isBold));
    dom.boldBtn.classList.toggle('active', state.isBold);
    persistRichTextToLocalStorage();
    syncMsgInputRichTextStyle();
    dom.msgInput.focus(); document.execCommand('bold');
  });
  dom.colorPicker.addEventListener('input', e => {
    state.currentColor = e.target.value;
    persistRichTextToLocalStorage();
    syncMsgInputRichTextStyle();
    dom.msgInput.focus(); document.execCommand('foreColor', false, state.currentColor);
  });
  dom.fontSizeSelect.addEventListener('change', e => {
    state.fontSize = e.target.value;
    persistRichTextToLocalStorage();
    applyFontSizeToolbarToInput();
  });
  dom.msgInput.addEventListener('input', () => {
    /* Ogni battuta può creare nuovi span senza colore: riapplica così non appare mai in bianco */
    applyColorAndBoldToRichNodes();
    sendTypingEvent();
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

const SAFE_FOLDER = /^[a-z0-9_-]+$/i;
const SAFE_EXT    = /^[a-z0-9]+$/i;
export async function uploadToStorage(input, folder, ext) {
  if (!state.fb) return null;
  try {
    const safeFolder = SAFE_FOLDER.test(String(folder || '')) ? String(folder) : 'uploads';
    const rawExt = (ext || 'bin').toString().toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const safeExt = SAFE_EXT.test(rawExt) ? rawExt : 'bin';
    let blob;
    if (typeof input === 'string') { const res = await fetch(input); blob = await res.blob(); }
    else blob = input;
    const name = `${safeFolder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${safeExt}`;
    const res = await state.fb.storage.from('chat-media').upload(name, blob, { cacheControl: '3600', upsert: false });
    if (res.error) throw res.error;
    return res.data?.publicUrl ?? null;
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
        if (!state.fb) { showToast('⚠️ Not connected — voice messages require backend.'); dom.voiceRecStrip.hidden = true; clearInterval(state.recordingTimer); dom.recTimer.textContent = '0:00'; return; }
        showToast('⏳ Uploading voice message…');
        const url = await uploadToStorage(blob, 'voices', ext);
        if (!url) { showToast('⚠️ Voice upload failed.'); dom.voiceRecStrip.hidden = true; clearInterval(state.recordingTimer); dom.recTimer.textContent = '0:00'; return; }
        const html = `<div class="voice-msg-wrap">🎙️ Voice message<audio controls src="${url}" preload="metadata"></audio></div>`;
        const { checkPublicChatSpam, registerPublicChatSent } = await import('./chat-antispam.js');
        const spam = checkPublicChatSpam(html);
        if (!spam.ok) {
          showToast(spam.toast);
          dom.voiceRecStrip.hidden = true;
          clearInterval(state.recordingTimer);
          dom.recTimer.textContent = '0:00';
          return;
        }
        registerPublicChatSent(html);
        /* Import addMessage lazily to avoid circular dep */
        const { addMessage } = await import('./chat.js');
        addMessage({ userId: 'me', html, ts: Date.now() });
        state.fb.firestore.collection('messages').add({
          user_id: state.currentUser.id, username: state.currentUser.name, content: html, room_id: state.activeRoom, reactions: {}, created_at: new Date(),
        }).then(() => {}).catch(err => console.warn('voice msg insert:', err));
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

/* ── Dictation (speech-to-text) ───────────────────────────────── */
export function initDictation() {
  if (!dom.dictateBtn || !dom.msgInput) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    /* Firefox non supporta Web Speech API: mostra il pulsante ma al clic spiega le alternative */
    dom.dictateBtn.addEventListener('click', () => {
      const isWin = /Win/i.test(navigator.platform);
      const hint = isWin ? ' Su Windows puoi usare Win+H per la dettatura di sistema.' : '';
      showToast('🎙️ La dettatura vocale non è supportata in Firefox. Usa Chrome, Edge o Safari.' + hint);
    });
    dom.dictateBtn.setAttribute('title', 'Dettatura (non supportata in Firefox — usa Chrome/Edge/Safari)');
    return;
  }
  let recognition = null;
  let isDictating = false;

  const insertTextAtCursor = (text) => {
    if (!text?.trim()) return;
    dom.msgInput.focus();
    const sel = window.getSelection();
    if (sel && dom.msgInput.contains(sel.anchorNode)) {
      document.execCommand('insertText', false, text.trim() + ' ');
    } else {
      const range = document.createRange();
      range.selectNodeContents(dom.msgInput);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand('insertText', false, text.trim() + ' ');
    }
    sendTypingEvent();
  };

  const startDictation = () => {
    if (isDictating) return;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || navigator.language || 'it-IT';

    recognition.onresult = (e) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final) insertTextAtCursor(final);
    };
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'aborted') return;
      showToast('⚠️ Errore dettatura: ' + (e.error || 'unknown'));
    };
    recognition.onend = () => {
      if (!isDictating) {
        dom.dictateBtn?.classList.remove('dictating');
        dom.dictateBtn?.setAttribute('aria-pressed', 'false');
      }
    };
    try {
      recognition.start();
      isDictating = true;
      dom.dictateBtn.classList.add('dictating');
      dom.dictateBtn.setAttribute('aria-pressed', 'true');
      showToast('🎙️ Dettatura attiva — clicca di nuovo per fermare');
    } catch (err) {
      showToast('⚠️ Impossibile avviare la dettatura');
    }
  };

  const stopDictation = () => {
    if (!isDictating) return;
    isDictating = false;
    try { recognition?.stop(); } catch {}
    recognition = null;
    dom.dictateBtn?.classList.remove('dictating');
    dom.dictateBtn?.setAttribute('aria-pressed', 'false');
  };

  dom.dictateBtn.addEventListener('click', () => {
    if (isDictating) stopDictation();
    else startDictation();
  });
}

/* ── Context menu ──────────────────────────────────────────────── */
export function openContextMenu(uid, anchor) {
  const user = findUser(uid);
  if (!user || !anchor) return;
  if (uid === 'me' || String(uid) === String(state.currentUser?.id)) return;
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
  
  const amIMuted = checkIsMuted(state.currentUser?.id, state.activeRoom);
  const camBlocked  = alreadyView || pendingReq || isOffline || isIgnored || !hasCameraActive || isEventsRoom || amIMuted;

  dom.ctxCamBtn.disabled      = camBlocked;
  dom.ctxCamBtn.style.opacity = camBlocked ? '0.35' : '1';
  dom.ctxCamBtn.style.display = isEventsRoom ? 'none' : ''; /* Hide in Events room */
  dom.ctxCamBtn.title = isEventsRoom ? 'Cameras are public in Events room'
                      : amIMuted ? 'You are muted — cannot request cameras'
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
  if (!state.fb || !state.currentUser) return false;
  if (String(targetUid) === String(state.currentUser?.id)) return false; /* Can't admin yourself */
  
  try {
    const profileSnap = await state.fb.firestore.collection('profiles').doc(state.currentUser.id).get();
    const data = profileSnap?.data();
    if (!data) return false;
    
    const role = data.role;
    if (role === 'owner' || role === 'admin') return true;
    if (role === 'moderator') return true;
    if (data.custom_role_id) {
      const roleSnap = await state.fb.firestore.collection('custom_roles').doc(data.custom_role_id).get();
      const customRole = roleSnap?.data();
      if (customRole?.permissions) {
        return customRole.permissions.can_kick || customRole.permissions.can_ban || customRole.permissions.can_mute || customRole.permissions.can_disconnect;
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
    const u = state.contextTargetUID;
    closeCtxMenu();
    if (!u || u === 'me' || String(u) === String(state.currentUser?.id)) return;
    openPrivateChat(u);
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
  
  dom.ctxDisconnectBtn?.addEventListener('click', async () => {
    const uid = state.contextTargetUID;
    const user = findUser(uid);
    closeCtxMenu();
    if (!uid || !user) return;
    if (!hasPermission('can_disconnect')) {
      showToast('🚫 You do not have permission to disconnect users.');
      return;
    }
    const { broadcast } = await import('./broadcast.js');
    if (!confirm(`Disconnect ${user.name || user.username}? This will log them out and return them to login.`)) return;
    broadcast('force-disconnect', String(uid), {});
    showToast(`⏏ Disconnected ${user.name || user.username}`);
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
  if (!state.fb) return false;
  const mins = minutes || 5;
  
  try {
    const uidStr = String(userId);
    const displayName =
      (userName && String(userName).trim()) ||
      state.rooms?.[String(state.activeRoom)]?.users?.[uidStr]?.name ||
      state.lastKnownNames?.[uidStr] ||
      state.users?.find?.(u => String(u.id) === uidStr)?.name ||
      'Guest';
    state.lastKnownNames[uidStr] = displayName;

    const expiresAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
    const roomId = isGlobal ? null : state.activeRoom;
    const col = state.fb.firestore.collection('kicked_users');
    const payload = { user_id: userId, username: displayName || null, kicked_by: state.currentUser.id, expires_at: expiresAt };
    
    if (isGlobal) {
      const roomsSnap = await state.fb.firestore.collection('rooms').get();
      for (const doc of roomsSnap.docs) {
        await col.doc(`${userId}_${doc.id}`).set({ ...payload, room_id: doc.id }, { merge: true });
      }
    } else {
      await col.doc(`${userId}_${state.activeRoom}`).set({ ...payload, room_id: state.activeRoom }, { merge: true });
    }
    
    /* Close all cameras for the user */
    await closeAllCamerasForUser(userId);
    
    /* Broadcast kick event */
    broadcast('user-kicked', userId, { room_id: roomId, expires_at: expiresAt, is_global: isGlobal });

    /* System message immediato: kick */
    if (isGlobal) {
      if (state.activeRoom) addSystemMessage(`👢 ${displayName} è stato kickato`, String(state.activeRoom));
      for (const rId of Object.keys(state.rooms || {})) {
        state.suppressLeaveSystemMsg[String(rId) + ':' + uidStr] = { ts: Date.now(), reason: 'kick' };
      }
    } else {
      addSystemMessage(`👢 ${displayName} è stato kickato`, String(state.activeRoom));
      state.suppressLeaveSystemMsg[String(state.activeRoom) + ':' + uidStr] = { ts: Date.now(), reason: 'kick' };
    }

    /* Togli subito l'utente kickato dalla lista (chi ha kickato lo vede sparire) */
    if (isGlobal) {
      for (const rId of Object.keys(state.rooms)) {
        const n = state.rooms[rId]?.users?.[uidStr]?.name;
        if (n) state.lastKnownNames[uidStr] = n;
        if (state.rooms[rId]?.users[uidStr]) delete state.rooms[rId].users[uidStr];
      }
    } else if (state.rooms[state.activeRoom]?.users[uidStr]) {
      const n = state.rooms[state.activeRoom]?.users?.[uidStr]?.name;
      if (n) state.lastKnownNames[uidStr] = n;
      delete state.rooms[state.activeRoom].users[uidStr];
    }
    renderUsers();

    /* If kicked user is current user, handle it (stesso comportamento del broadcast) */
    if (String(userId) === String(state.currentUser?.id)) {
      const targetId = String(userId);
      if (!state.kickedUsers[targetId]) state.kickedUsers[targetId] = {};
      if (isGlobal) {
        for (const rId of Object.keys(state.rooms)) state.kickedUsers[targetId][String(rId)] = expiresAt;
        const { leaveRoom, renderRoomTabs } = await import('./rooms.js');
        for (const rId of Object.keys(state.rooms)) await leaveRoom(rId, { silent: true, force: true });
        renderRoomTabs();
        const { showKickOverlay } = await import('./kick-ban.js');
        await showKickOverlay(null, expiresAt, true);
      } else {
        state.kickedUsers[targetId][String(state.activeRoom)] = expiresAt;
        const { leaveRoom, renderRoomTabs } = await import('./rooms.js');
        if (state.rooms[state.activeRoom]) {
          await leaveRoom(state.activeRoom, { silent: true, force: true });
          renderRoomTabs();
        }
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
  if (!state.fb) return false;
  const roomId = isGlobal ? null : state.activeRoom;
  
  try {
    const expiresAt = minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
    const docId = `${userId}_${roomId ?? 'global'}`;
    await state.fb.firestore.collection('muted_users').doc(docId).set({
      user_id: userId,
      username: userName || null,
      room_id: roomId,
      muted_by: state.currentUser.id,
      expires_at: expiresAt,
    }, { merge: true });
    
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
  if (!state.fb) return false;
  
  try {
    const roomId = muteInfo.global ? null : muteInfo.room_id;
    const col = state.fb.firestore.collection('muted_users');
    const docId = `${userId}_${roomId ?? 'global'}`;
    await col.doc(docId).delete();
    
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
  if (!state.fb) return false;
  
  try {
    const uidStr = String(userId);
    const displayName =
      (userName && String(userName).trim()) ||
      state.rooms?.[String(state.activeRoom)]?.users?.[uidStr]?.name ||
      state.lastKnownNames?.[uidStr] ||
      state.users?.find?.(u => String(u.id) === uidStr)?.name ||
      'Guest';
    state.lastKnownNames[uidStr] = displayName;

    await state.fb.firestore.collection('banned_users').doc(String(userId)).set({
      user_id: userId,
      username: displayName,
      reason: reason || 'Banned by admin/mod',
      banned_by: state.currentUser.id,
      expires_at: expiresAt,
    }, { merge: true });
    
    /* Close all cameras for the user */
    await closeAllCamerasForUser(userId);
    
    /* Broadcast ban event - user must leave ALL rooms */
    broadcast('user-banned', userId, { reason: reason || 'Banned by admin/mod', expires_at: expiresAt });
    const { clearBroadcastHistory } = await import('./firebase-client.js');
    await clearBroadcastHistory(); /* niente replay al reconnect */

    /* System message immediato: ban */
    if (state.activeRoom) addSystemMessage(`🚫 ${displayName} è stato bannato`, String(state.activeRoom));
    for (const rId of Object.keys(state.rooms || {})) {
      state.suppressLeaveSystemMsg[String(rId) + ':' + uidStr] = { ts: Date.now(), reason: 'ban' };
    }
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

/* ── Update users panel width CSS variable ── */
/* Solo stanza giochi: aggiorna --users-panel-width per spingere la chat a sinistra.
   Stanze normali: pannello fixed overlay (UX drawer standard) → variabile sempre 0px */
export async function updateUsersPanelWidthCSS() {
  if (!dom.usersPanel) return;

  /* In stanze normali su mobile il pannello è un overlay fixed: non toccare la chat */
  let isGamesRoom = false;
  try {
    const { getAvailableRooms } = await import('./rooms.js');
    const availableRooms = getAvailableRooms?.() || [];
    const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
    isGamesRoom = roomData?.is_games_room === true;
  } catch (e) { /* ignore */ }

  if (!isGamesRoom) {
    /* Stanze normali: assicurati che la variabile sia 0 (no effetti sul layout) */
    document.documentElement.style.setProperty('--users-panel-width', '0px');
    return;
  }

  /* Stanza giochi: aggiorna variabile in base allo stato del pannello.
     La posizione (fixed/right) è gestita dal toggle button in games.js */
  const isOpen = dom.usersPanel.classList.contains('open');
  if (isOpen) {
    /* Aspetta che il pannello sia renderizzato prima di leggere la larghezza */
    await new Promise(r => setTimeout(r, 50));
    const width = dom.usersPanel.getBoundingClientRect().width || 240;
    document.documentElement.style.setProperty('--users-panel-width', width + 'px');
  } else {
    document.documentElement.style.setProperty('--users-panel-width', '0px');
  }
}

/* ── Panel resize (desktop + mobile) ────────────────────────────────────── */
export function initPanelResize() {
  const handle = document.getElementById('panelResizeHandle');
  const panel  = dom.usersPanel;
  if (!handle || !panel) return;

  const isMobile = window.innerWidth <= 768;
  const savedW = parseInt(localStorage.getItem('nvc_panel_w'), 10);

  if (isMobile) {
    /* Imposta larghezza iniziale su mobile */
    if (!panel.style.width) {
      panel.style.width = savedW >= 200 && savedW <= 480 ? savedW + 'px' : '280px';
    }
  } else {
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
    const deltaX = startX - x; /* Su mobile (pannello a destra): trascina sinistra = più largo */
    const maxWidth = isMobile ? Math.min(480, Math.floor(window.innerWidth * 0.9)) : 480;
    const newWidth = isMobile
      ? Math.min(maxWidth, Math.max(200, startW + deltaX))
      : Math.min(480, Math.max(160, startW + deltaX));
    panel.style.width = newWidth + 'px';
    /* Aggiorna CSS var quando pannello è aperto (mobile e desktop in stanza giochi) */
    if (panel.classList.contains('open')) {
      if (isMobile) {
        document.documentElement.style.setProperty('--users-panel-width', newWidth + 'px');
        /* Aggiorna posizione bottone floating durante il resize */
        if (dom.floatingUsersBtn) {
          const isGamesRoom = panel.style.position === 'fixed';
          if (isGamesRoom && dom.gamesPanel && !dom.gamesPanel.hidden) {
            const gamesPanelWidth = dom.gamesPanel.offsetWidth || 260;
            dom.floatingUsersBtn.style.right = `calc(${gamesPanelWidth}px + ${newWidth}px + 12px)`;
          } else {
            dom.floatingUsersBtn.style.right = `calc(${newWidth}px + 12px)`;
          }
        }
      } else {
        /* Desktop: aggiorna CSS var solo in stanza giochi */
        updateUsersPanelWidthCSS();
      }
    }
    e.preventDefault();
  };

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const finalWidth = parseInt(panel.style.width, 10);
    if (finalWidth >= 160 && finalWidth <= 480) localStorage.setItem('nvc_panel_w', finalWidth);
    /* Aggiorna CSS var quando pannello è aperto (sia mobile che desktop in stanza giochi) */
    if (panel.classList.contains('open')) {
      updateUsersPanelWidthCSS();
      
      /* Su mobile: aggiorna posizione right se in stanza giochi e posizione bottone floating */
      if (isMobile) {
        const isGamesRoom = panel.style.position === 'fixed';
        if (isGamesRoom && dom.gamesPanel && !dom.gamesPanel.hidden) {
          const gamesPanelWidth = dom.gamesPanel.offsetWidth || 260;
          panel.style.right = gamesPanelWidth + 'px';
          /* Aggiorna posizione bottone floating */
          if (dom.floatingUsersBtn) {
            const panelWidth = panel.getBoundingClientRect().width || finalWidth;
            dom.floatingUsersBtn.style.right = `calc(${gamesPanelWidth}px + ${panelWidth}px + 12px)`;
          }
        } else if (dom.floatingUsersBtn) {
          /* Stanze normali: aggiorna solo posizione bottone floating */
          const panelWidth = panel.getBoundingClientRect().width || finalWidth;
          dom.floatingUsersBtn.style.right = `calc(${panelWidth}px + 12px)`;
        }
      } else {
        /* Desktop: aggiorna posizione right se in stanza giochi */
        if (dom.gamesPanel && !dom.gamesPanel.hidden && panel.style.position === 'fixed') {
          const gamesPanelWidth = dom.gamesPanel.offsetWidth || 320;
          panel.style.right = gamesPanelWidth + 'px';
        }
      }
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
  const updateFloatingButtonPosition = () => {
    if (!dom.floatingUsersBtn || window.innerWidth > 768) return;
    const isOpen = dom.usersPanel.classList.contains('open');
    if (isOpen) {
      /* Quando pannello aperto: sposta il bottone a sinistra del pannello */
      const panelWidth = dom.usersPanel.getBoundingClientRect().width || 280;
      const isGamesRoom = dom.usersPanel.style.position === 'fixed';
      if (isGamesRoom && dom.gamesPanel && !dom.gamesPanel.hidden) {
        /* In stanza giochi: bottone a sinistra del pannello utenti (che è a sinistra della barra giochi) */
        const gamesPanelWidth = dom.gamesPanel.offsetWidth || 260;
        dom.floatingUsersBtn.style.right = `calc(${gamesPanelWidth}px + ${panelWidth}px + 12px)`;
      } else {
        /* Stanze normali: bottone a sinistra del pannello */
        dom.floatingUsersBtn.style.right = `calc(${panelWidth}px + 12px)`;
      }
    } else {
      /* Quando pannello chiuso: bottone in alto a destra */
      dom.floatingUsersBtn.style.right = '12px';
    }
  };

  const open = () => {
    dom.usersPanel.classList.add('open');
    dom.panelOverlay.classList.add('show');
    if (dom.mobileUsersToggle) dom.mobileUsersToggle.setAttribute('aria-expanded', 'true');
    if (dom.floatingUsersBtn) {
      dom.floatingUsersBtn.setAttribute('aria-expanded', 'true');
      updateFloatingButtonPosition();
    }
    /* Su mobile aggiorna CSS var (updateUsersPanelWidthCSS gestisce il check stanza giochi) */
    if (window.innerWidth <= 768) {
      setTimeout(() => {
        updateUsersPanelWidthCSS();
        updateFloatingButtonPosition();
      }, 100);
    }
  };

  const close = () => {
    dom.usersPanel.classList.remove('open');
    dom.panelOverlay.classList.remove('show');
    if (dom.mobileUsersToggle) dom.mobileUsersToggle.setAttribute('aria-expanded', 'false');
    if (dom.floatingUsersBtn) {
      dom.floatingUsersBtn.setAttribute('aria-expanded', 'false');
      updateFloatingButtonPosition();
    }
    document.documentElement.style.setProperty('--users-panel-width', '0px');
    /* Reset stili inline (usati in stanza giochi) */
    if (dom.usersPanel) dom.usersPanel.style.cssText = '';
    const chatSection = document.querySelector('.chat-section');
    if (chatSection) { chatSection.style.flex = ''; chatSection.style.minWidth = ''; }
  };

  /* Toggle button nell'header (desktop) */
  if (dom.mobileUsersToggle && window.getComputedStyle(dom.mobileUsersToggle).display !== 'none') {
    dom.mobileUsersToggle.addEventListener('click', () =>
      dom.usersPanel.classList.contains('open') ? close() : open()
    );
  }

  /* Floating button (mobile) */
  if (dom.floatingUsersBtn) {
    dom.floatingUsersBtn.addEventListener('click', () =>
      dom.usersPanel.classList.contains('open') ? close() : open()
    );
    /* Aggiorna posizione quando il pannello si apre/chiude */
    if (dom.usersPanel) {
      const observer = new MutationObserver(() => {
        if (window.innerWidth <= 768) {
          updateFloatingButtonPosition();
        }
      });
      observer.observe(dom.usersPanel, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (dom.closePanelBtn)  dom.closePanelBtn.addEventListener('click', close);
  if (dom.panelOverlay)   dom.panelOverlay.addEventListener('click', close);

  /* Observer: aggiorna CSS var quando cambia classe (gestione stanza giochi) */
  if (dom.usersPanel) {
    const observer = new MutationObserver(() => {
      if (window.innerWidth <= 768) {
        setTimeout(() => {
          updateUsersPanelWidthCSS();
          updateFloatingButtonPosition();
        }, 50);
      }
    });
    observer.observe(dom.usersPanel, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  /* Aggiorna su resize finestra */
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (window.innerWidth <= 768 && dom.usersPanel?.classList.contains('open')) {
        updateUsersPanelWidthCSS();
        updateFloatingButtonPosition();
      } else if (window.innerWidth > 768) {
        document.documentElement.style.setProperty('--users-panel-width', '0px');
        if (dom.floatingUsersBtn) dom.floatingUsersBtn.style.right = '12px';
      }
    }, 150);
  });
}

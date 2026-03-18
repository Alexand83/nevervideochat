/* ================================================================
   chat.js  — public chat: render, send, quote/reply
================================================================ */
import { state }          from './state.js';
import { dom }            from './dom.js';
import { escHtml, avatarColor, initials, fmtTime, processHtml, scrollToBottom, showToast, sanitiseHtml, safeAvatarUrl } from './utils.js';
import { findUser, ensureUser, stopTyping } from './users.js?v=20260453';
import { hasPermission } from './permissions.js';

/* Forward refs — set by main.js to avoid circular deps */
let _openContextMenu = null;
let _uploadToStorage = null;
let _supabaseReady   = null;
let _renderRoomTabs  = null;
let _broadcast       = null;
let _handleGameCommand = null;

/* ── Le funzioni createSessionId e getSavedSessionId sono ora in auth.js ── */
/* ── Importale quando necessario ── */
export function setChatDeps(openCtx, uploadStorage, supaReady, renderTabs, broadcast, handleGameCmd) {
  _openContextMenu = openCtx;
  _uploadToStorage = uploadStorage;
  _supabaseReady   = supaReady;
  _renderRoomTabs  = renderTabs;
  _broadcast       = broadcast;
  _handleGameCommand = handleGameCmd;
}

/* ── Extract quote metadata from persisted message content ── */
export function extractQuote(content) {
  if (!content || !content.includes('msg-quote-meta')) return { html: content, quoteHtml: null, quoteName: null };
  try {
    const tmp  = document.createElement('div');
    tmp.innerHTML = content;
    const meta = tmp.querySelector('.msg-quote-meta');
    if (!meta) return { html: content, quoteHtml: null, quoteName: null };
    const quoteName = meta.getAttribute('data-quote-name') || '';
    const quoteHtml = decodeURIComponent(meta.getAttribute('data-quote-html') || '');
    meta.remove();
    return { html: tmp.innerHTML, quoteHtml: quoteHtml || null, quoteName: quoteName || null };
  } catch { return { html: content, quoteHtml: null, quoteName: null }; }
}

/* ── Add a message to the active room and render it ── */
export function addMessage({ userId, html, ts = Date.now(), quoteHtml = null, quoteName = null, username = null, reactions = null, msgId = null }, roomId) {
  console.log('[Chat] addMessage called:', { userId, roomId: roomId || state.activeRoom, hasHtml: !!html, msgId });
  const rId  = roomId || state.activeRoom;
  const room = state.rooms[rId];
  if (!room) {
    console.warn('[Chat] addMessage: Room not found', rId);
    return;
  }

  /* Filter ignored users */
  if (userId && userId !== 'me' && state.ignoredUsers[String(userId)]) return;

  const msg = { 
    id: msgId || `m${Date.now()}${Math.random()}`, 
    userId, html, ts, quoteHtml, quoteName, username,
    reactions: reactions || {}
  };
  room.messages.push(msg);

  /* ── Enforce max 60 messages limit ── */
  const MAX_MESSAGES = 60;
  if (room.messages.length > MAX_MESSAGES) {
    const removed = room.messages.splice(0, room.messages.length - MAX_MESSAGES);
    /* Remove old messages from DOM if this is the active room */
    if (rId === state.activeRoom && dom.msgsContainer) {
      removed.forEach(oldMsg => {
        const group = dom.msgsContainer.querySelector(`[data-msg-id="${oldMsg.id}"]`);
        if (group) group.remove();
      });
    }
  }

  /* Increment unread count if message is in a non-active room */
  if (rId !== state.activeRoom && userId !== 'me' && userId !== state.currentUser?.id) {
    room.unreadCount = (room.unreadCount || 0) + 1;
    /* Forward ref to renderRoomTabs */
    if (_renderRoomTabs) _renderRoomTabs();
  }

  /* Notifica se qualcuno ti ha menzionato (anche se sei in un'altra stanza) */
  if (userId !== 'me' && userId !== state.currentUser?.id && isMessageMentioningMe(msg.html)) {
    const fromName = msg.username || findUser(msg.userId)?.name || 'Qualcuno';
    const roomName = state.rooms[rId]?.name || rId;
    const inOtherRoom = rId !== state.activeRoom;
    showToast(inOtherRoom
      ? `📩 ${fromName} ti ha menzionato in #${roomName}`
      : `📩 ${fromName} ti ha menzionato nella chat`);
  }

  /* Only render if this is the active room */
  if (rId === state.activeRoom) {
    console.log('[Chat] Rendering message in active room:', { msgId: msg.id, userId: msg.userId });
    renderMessage(msg);
    /* Hide welcome banner when first message arrives */
    if (dom.welcomeBanner?.parentNode) dom.welcomeBanner.remove();
  } else {
    console.log('[Chat] Message not rendered (not active room):', { msgId: msg.id, activeRoom: state.activeRoom, messageRoom: rId });
  }
}

/* ── System message (enter/leave) nel feed chat ── */
export function addSystemMessage(text, roomId) {
  const rId = roomId || state.activeRoom;
  if (rId !== state.activeRoom) return;
  if (!dom.msgsContainer) return;
  if (dom.welcomeBanner?.parentNode) dom.welcomeBanner.remove();
  const el = document.createElement('div');
  const isEnter = text.includes('entrat');
  el.className = `msg-system ${isEnter ? 'msg-system-enter' : 'msg-system-leave'}`;
  el.textContent = text;
  dom.msgsContainer.appendChild(el);
  scrollToBottom();
  /* Rimuovi messaggi di sistema vecchi se ne accumula troppi (max 6) */
  const all = dom.msgsContainer.querySelectorAll('.msg-system');
  if (all.length > 6) all[0].remove();
}

/* ── Render a single message bubble ── */
export function renderMessage(msg) {
  if (dom.welcomeBanner?.parentNode) dom.welcomeBanner.remove();
  const isMine  = msg.userId === 'me' || msg.userId === state.currentUser?.id;
  const user    = isMine
    ? state.currentUser
    : (findUser(msg.userId) || { name: msg.username || 'User', isGuest: true, avatarUrl: null });
  /* Usa display_name (name) se disponibile, altrimenti username */
  const displayName = user.name || user.username || 'User';
  const color   = avatarColor(displayName);
  const init    = initials(displayName);

  const group = document.createElement('div');
  group.className = `msg-group${isMine ? ' own' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar'; avatar.title = displayName;
  const safeUrl = safeAvatarUrl(user.avatarUrl);
  if (safeUrl) {
    avatar.classList.add('has-photo');
    avatar.style.backgroundImage    = `url(${safeUrl})`;
    avatar.style.backgroundSize     = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.dataset.avatarUrl = safeUrl;
  } else {
    avatar.style.background = color; avatar.textContent = init;
    avatar.dataset.avatarColor = color;
    avatar.dataset.avatarInitial = init;
  }
  avatar.dataset.avatarName = displayName;
  /* Context menu on right-click / long-press gesture; single tap/click reserved for avatar enlarge. */
  if (!isMine && _openContextMenu) avatar.addEventListener('contextmenu', (e) => { e.preventDefault(); _openContextMenu(msg.userId, avatar); });

  const content = document.createElement('div');
  content.className = 'msg-content';

  const meta    = document.createElement('div');
  meta.className = 'msg-meta';

  const senderEl = document.createElement('span');
  senderEl.className = 'msg-sender';
  senderEl.textContent = isMine ? 'You' : displayName;

  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time'; timeEl.textContent = fmtTime(msg.ts);
  if (msg.edited_at) {
    const editedSpan = document.createElement('span');
    editedSpan.className = 'msg-edited'; editedSpan.textContent = ' (modificato)';
    timeEl.appendChild(editedSpan);
  }

  if (user.isGuest && !isMine) {
    const gt = document.createElement('span');
    gt.className = 'guest-tag'; gt.textContent = 'Guest';
    meta.append(senderEl, gt, timeEl);
  } else { meta.append(senderEl, timeEl); }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  /* Quote block */
  if (msg.quoteHtml) {
    const qBlock  = document.createElement('div');
    qBlock.className = 'msg-quote';
    const qAuthor = document.createElement('span');
    qAuthor.className = 'msg-quote-author'; qAuthor.textContent = msg.quoteName || '';
    const qText   = document.createElement('span');
    qText.className = 'msg-quote-text';
    const tmp = document.createElement('div');
    tmp.innerHTML = processHtml(msg.quoteHtml || '');
    qText.textContent = (tmp.textContent || '').slice(0, 120) + ((tmp.textContent || '').length > 120 ? '…' : '');
    qBlock.append(qAuthor, qText);
    bubble.appendChild(qBlock);
  }

  const textDiv = document.createElement('div');
  textDiv.className = 'msg-text';
  textDiv.innerHTML = processHtml(msg.html);
  /* Opzione impostazioni: non caricare immagini automaticamente (solo al click) */
  if (state.settings?.autoLoadImages === false) {
    textDiv.querySelectorAll('img').forEach(img => {
      img.dataset.src = img.src || img.getAttribute('src') || '';
      img.removeAttribute('src');
      img.classList.add('msg-img-placeholder');
      img.alt = 'Click to load image';
    });
  }
  bubble.appendChild(textDiv);

  /* Reactions */
  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'msg-reactions';
  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    Object.entries(msg.reactions).forEach(([emoji, userIds]) => {
      if (!Array.isArray(userIds) || userIds.length === 0) return;
      const reactBtn = document.createElement('button');
      reactBtn.className = 'msg-reaction';
      const hasReacted = userIds.includes(String(state.currentUser?.id));
      if (hasReacted) reactBtn.classList.add('reacted');
      reactBtn.textContent = `${emoji} ${userIds.length}`;
      reactBtn.title = `${userIds.length} reaction${userIds.length > 1 ? 's' : ''}`;
      reactBtn.addEventListener('click', () => toggleReaction(msg.id, emoji));
      reactionsDiv.appendChild(reactBtn);
    });
  }
  bubble.appendChild(reactionsDiv);

  /* Action buttons row */
  const actionsRow = document.createElement('div');
  actionsRow.className = 'msg-actions';
  
  /* Add reaction button */
  const reactBtn = document.createElement('button');
  reactBtn.className = 'msg-action-btn msg-react-btn';
  reactBtn.innerHTML = '😊';
  reactBtn.title = 'Add reaction';
  reactBtn.addEventListener('click', (e) => openReactionPicker(e, msg.id));
  
  /* Reply button */
  const replyBtn = document.createElement('button');
  replyBtn.className = 'msg-action-btn msg-reply-btn';
  replyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg> Reply`;
  const authorName = isMine ? 'You' : displayName;
  replyBtn.addEventListener('click', () => setReplyTo(msg.userId, authorName, msg.html));

  actionsRow.append(reactBtn, replyBtn);
  const canEdit = (isMine && hasPermission('can_edit_own_messages')) || (!isMine && hasPermission('can_edit_messages'));
  const canDelete = (isMine && hasPermission('can_delete_own_messages')) || (!isMine && hasPermission('can_delete_messages'));
  if (canEdit) {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn msg-edit-btn';
    editBtn.textContent = 'Modifica';
    editBtn.title = 'Modifica messaggio';
    editBtn.addEventListener('click', () => startEditMessage(msg.id));
    actionsRow.appendChild(editBtn);
  }
  if (canDelete) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'msg-action-btn msg-delete-btn';
    deleteBtn.textContent = 'Elimina';
    deleteBtn.title = 'Elimina messaggio';
    deleteBtn.addEventListener('click', () => confirmDeleteMessage(msg.id));
    actionsRow.appendChild(deleteBtn);
  }
  content.append(meta, bubble, actionsRow);
  group.append(avatar, content);
  group.dataset.msgId = msg.id;
  dom.msgsContainer.appendChild(group);
  scrollToBottom();
}

/* ── Modifica messaggio (inline: bubble div diventa editabile, poi Salva) ── */
async function startEditMessage(msgId) {
  const { loadUserPermissions } = await import('./permissions.js');
  await loadUserPermissions();
  let roomId = null;
  let msg = null;
  for (const rid of Object.keys(state.rooms || {})) {
    msg = state.rooms[rid].messages.find(m => m.id === msgId);
    if (msg) { roomId = rid; break; }
  }
  if (!msg || !roomId || !state.fb) return;
  const group = dom.msgsContainer?.querySelector(`[data-msg-id="${msgId}"]`);
  const textDiv = group?.querySelector('.msg-text');
  const actionsRow = group?.querySelector('.msg-actions');
  if (!group || !textDiv || !actionsRow) return;
  const currentHtml = msg.html || '';
  const plainText = (() => { const d = document.createElement('div'); d.innerHTML = currentHtml; return d.textContent || ''; })();
  const wrap = document.createElement('div');
  wrap.className = 'msg-edit-wrap';
  const textarea = document.createElement('textarea');
  textarea.className = 'msg-edit-input';
  textarea.rows = 3;
  textarea.value = plainText;
  const btnRow = document.createElement('div');
  btnRow.className = 'msg-edit-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'msg-edit-save';
  saveBtn.textContent = 'Salva';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'msg-edit-cancel';
  cancelBtn.textContent = 'Annulla';
  const finish = () => {
    if (wrap.parentNode) wrap.remove();
    if (textDiv.parentNode) textDiv.hidden = false;
    actionsRow.hidden = false;
  };
  saveBtn.addEventListener('click', async () => {
    const { MAX_MESSAGE_LENGTH } = await import('./config.js');
    const newText = textarea.value.trim();
    if (!newText) { finish(); return; }
    if (newText.length > MAX_MESSAGE_LENGTH) {
      showToast(`⚠️ Messaggio troppo lungo (max ${MAX_MESSAGE_LENGTH} caratteri).`);
      return;
    }
    const newHtml = sanitiseHtml(newText);
    const FONT_SIZE_PX = { '1': '10px', '2': '12px', '3': '14px', '4': '18px', '5': '24px' };
    const px = FONT_SIZE_PX[state.fontSize] || '14px';
    const style = `color:${state.currentColor || 'inherit'};font-size:${px};font-weight:${state.isBold ? 'bold' : 'normal'};`;
    const wrappedHtml = `<span style="${style}">${newHtml}</span>`;
    try {
      await state.fb.firestore.collection('messages').doc(msgId).update({
        content: wrappedHtml,
        edited_at: new Date(),
      });
      msg.html = wrappedHtml;
      msg.edited_at = Date.now();
      textDiv.innerHTML = processHtml(wrappedHtml);
      const timeEl = group.querySelector('.msg-time');
      if (timeEl && !timeEl.querySelector('.msg-edited')) {
        const ed = document.createElement('span');
        ed.className = 'msg-edited'; ed.textContent = ' (modificato)';
        timeEl.appendChild(ed);
      }
      showToast('Messaggio modificato.');
    } catch (err) {
      showToast('⚠️ Impossibile modificare: ' + (err.message || 'errore'));
    }
    finish();
  });
  cancelBtn.addEventListener('click', finish);
  btnRow.append(saveBtn, cancelBtn);
  wrap.append(textarea, btnRow);
  textDiv.hidden = true;
  actionsRow.hidden = true;
  textDiv.parentNode.insertBefore(wrap, textDiv);
  textarea.focus();
}

/* ── Elimina messaggio (conferma poi rimozione da Firestore e da UI) ── */
function confirmDeleteMessage(msgId) {
  if (!confirm('Eliminare questo messaggio?')) return;
  deleteMessage(msgId);
}

export async function deleteMessage(msgId) {
  let roomId = null;
  let msg = null;
  for (const rid of Object.keys(state.rooms || {})) {
    msg = state.rooms[rid].messages.find(m => m.id === msgId);
    if (msg) { roomId = rid; break; }
  }
  if (!msg || !roomId || !state.fb) {
    showToast('Messaggio non trovato.');
    return;
  }
  try {
    await state.fb.firestore.collection('messages').doc(msgId).delete();
    const room = state.rooms[roomId];
    const idx = room.messages.findIndex(m => m.id === msgId);
    if (idx !== -1) room.messages.splice(idx, 1);
    const group = dom.msgsContainer?.querySelector(`[data-msg-id="${msgId}"]`);
    if (group) group.remove();
    showToast('Messaggio eliminato.');
  } catch (err) {
    showToast('⚠️ Impossibile eliminare: ' + (err.message || 'errore'));
  }
}

/* ── Reply/quote state ── */
export function setReplyTo(userId, name, html) {
  state.replyTo = { userId, name, html };
  if (dom.replyPreviewBar)    dom.replyPreviewBar.hidden = false;
  if (dom.replyPreviewAuthor) dom.replyPreviewAuthor.textContent = `↩ ${name}`;
  if (dom.replyPreviewText)   dom.replyPreviewText.textContent   = (() => {
    const t = document.createElement('div');
    t.innerHTML = processHtml(html || '');
    return (t.textContent || '').slice(0, 80);
  })();

  /* UX: when user clicks "Reply", focus the message composer immediately. */
  try {
    if (dom.msgInput) {
      dom.msgInput.focus();
      const sel = window.getSelection?.();
      if (sel && sel.rangeCount) sel.removeAllRanges();
      const range = document.createRange?.();
      if (range) {
        range.selectNodeContents(dom.msgInput);
        range.collapse(false); /* caret at end */
        sel?.addRange(range);
      }
    }
  } catch (_) {}
}
export function clearReplyTo() {
  state.replyTo = null;
  if (dom.replyPreviewBar) dom.replyPreviewBar.hidden = true;
}

/* ── @mention: utenti in stanza (per dropdown e conversione) ── */
function getRoomUsersForMention() {
  const room = state.rooms[state.activeRoom];
  if (!room?.users || !state.currentUser) return [];
  const myId = String(state.currentUser.id);
  return Object.entries(room.users)
    .filter(([uid]) => String(uid) !== myId)
    .map(([, u]) => ({
      id: u.id,
      name: (u.name || u.username || 'User').trim(),
      username: (u.username || u.name || '').trim(),
    }))
    .filter(u => u.name || u.username);
}

/** Converte @DisplayName nel testo in <span class="mention" data-username="DisplayName">@DisplayName</span> */
function convertMentionsInHtml(html) {
  const users = getRoomUsersForMention();
  if (!users.length) return html;
  let out = html;
  const byLen = [...users].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
  for (const u of byLen) {
    const name = (u.name || u.username || '').trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`@(${escaped})(?![\\w])`, 'gi');
    out = out.replace(re, (match) => {
      const display = match.slice(1);
      return `<span class="mention" data-username="${escHtml(display)}">@${escHtml(display)}</span>`;
    });
  }
  return out;
}

/** True se il messaggio contiene una mention dell'utente corrente (per notifica) */
function isMessageMentioningMe(html) {
  if (!state.currentUser) return false;
  const d = document.createElement('div');
  d.innerHTML = html || '';
  const mentions = d.querySelectorAll('.mention[data-username]');
  const myName = (state.currentUser.name || '').trim();
  const myUsername = (state.currentUser.username || '').trim();
  for (const el of mentions) {
    const name = (el.getAttribute('data-username') || '').trim();
    if (name && (name === myName || name === myUsername)) return true;
  }
  const text = (d.textContent || '').trim();
  if (myName && text.includes('@' + myName)) return true;
  if (myUsername && myUsername !== myName && text.includes('@' + myUsername)) return true;
  return false;
}

/* ── Mention dropdown: helper contenteditable ── */
function getTextIndexFromSelection(container) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(container);
  range.setEnd(sel.anchorNode, sel.anchorOffset);
  return range.toString().length;
}

function getRangeForTextIndex(container, startIndex, endIndex) {
  const range = document.createRange();
  let current = 0;
  let startSet = false;
  let endSet = false;
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent || '').length;
      const end = current + len;
      if (!startSet && end > startIndex) {
        range.setStart(node, Math.min(len, startIndex - current));
        startSet = true;
      }
      if (!endSet && end >= endIndex) {
        range.setEnd(node, Math.min(len, endIndex - current));
        endSet = true;
      }
      current = end;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.childNodes) {
      for (const child of node.childNodes) {
        if (endSet) return;
        walk(child);
      }
    }
  }
  walk(container);
  return range;
}

let mentionDropdownEl = null;
let mentionStartIndex = -1;
let mentionSelectedIndex = 0;

export function initMentionDropdown() {
  if (!dom.msgInput || !dom.chatInputArea) return;
  mentionDropdownEl = document.createElement('div');
  mentionDropdownEl.className = 'mention-dropdown';
  mentionDropdownEl.setAttribute('role', 'listbox');
  mentionDropdownEl.hidden = true;
  dom.chatInputArea.appendChild(mentionDropdownEl);

  function hideMentionDropdown() {
    mentionDropdownEl.hidden = true;
    mentionStartIndex = -1;
  }

  function insertMentionChoice(displayName) {
    const input = dom.msgInput;
    const text = input.textContent || '';
    const query = mentionStartIndex >= 0 ? text.slice(mentionStartIndex + 1).split(/\s/)[0] || '' : '';
    const from = mentionStartIndex;
    const to = Math.min(from + 1 + query.length, text.length);
    const range = getRangeForTextIndex(input, from, to);
    if (range.collapsed) return;
    range.deleteContents();
    const toInsert = `@${displayName} `;
    const textNode = document.createTextNode(toInsert);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    hideMentionDropdown();
    input.focus();
  }

  dom.msgInput.addEventListener('input', () => {
    const text = dom.msgInput.textContent || '';
    const idx = getTextIndexFromSelection(dom.msgInput);
    const lastAt = text.lastIndexOf('@');
    if (lastAt === -1 || idx <= lastAt) {
      hideMentionDropdown();
      return;
    }
    const query = text.slice(lastAt + 1).split(/\s/)[0] || '';
    if (/\s/.test(query)) { hideMentionDropdown(); return; }
    if (mentionStartIndex < 0) mentionStartIndex = lastAt;
    const users = getRoomUsersForMention();
    const q = query.toLowerCase();
    const filtered = users.filter(u => {
      const n = (u.name || '').toLowerCase();
      const uu = (u.username || '').toLowerCase();
      return n.startsWith(q) || uu.startsWith(q);
    });
    mentionSelectedIndex = 0;
    if (filtered.length === 0) {
      mentionDropdownEl.hidden = true;
      return;
    }
    mentionDropdownEl.hidden = false;
    mentionDropdownEl.innerHTML = '';
    filtered.slice(0, 8).forEach((u, i) => {
      const name = u.name || u.username || 'User';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mention-dropdown-item' + (i === 0 ? ' selected' : '');
      btn.textContent = name;
      btn.setAttribute('role', 'option');
      btn.addEventListener('click', () => insertMentionChoice(name));
      mentionDropdownEl.appendChild(btn);
    });
  });

  dom.msgInput.addEventListener('keydown', (e) => {
    if (!mentionDropdownEl || mentionDropdownEl.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); hideMentionDropdown(); return; }
    if (e.key === 'Enter' && mentionDropdownEl.querySelectorAll('.mention-dropdown-item').length) {
      e.preventDefault();
      const items = mentionDropdownEl.querySelectorAll('.mention-dropdown-item');
      const sel = items[mentionSelectedIndex];
      if (sel) sel.click();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const items = mentionDropdownEl.querySelectorAll('.mention-dropdown-item');
      if (items.length) {
        mentionSelectedIndex = (mentionSelectedIndex + 1) % items.length;
        items.forEach((it, i) => it.classList.toggle('selected', i === mentionSelectedIndex));
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const items = mentionDropdownEl.querySelectorAll('.mention-dropdown-item');
      if (items.length) {
        mentionSelectedIndex = (mentionSelectedIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle('selected', i === mentionSelectedIndex));
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (mentionDropdownEl && !mentionDropdownEl.hidden && !mentionDropdownEl.contains(e.target) && e.target !== dom.msgInput) {
      hideMentionDropdown();
    }
  });
}

/* ── Send a public message ── */
export async function sendMessage() {
  /* Check if current user can send messages (not muted/banned) */
  if (!state.currentUser) return;
  
  /* CRITICO: Verifica che questa sia la sessione attiva - solo la nuova sessione può scrivere */
  /* Solo per utenti registrati (non guest) */
  if (state.fb && state.currentUser.id && !state.currentUser.isGuest) {
    try {
      let session = await state.fb.auth.getSession();
      if (!session?.data?.session?.access_token) {
        const stored = JSON.parse(localStorage.getItem('nvc_auth_session') || 'null');
        if (stored?.access_token) {
          await state.fb.auth.setSession({ access_token: stored.access_token, refresh_token: stored.refresh_token });
          session = await state.fb.auth.getSession();
        }
      }
      if (!session?.data?.session?.access_token) {
        showToast('⚠️ Session expired. Please refresh the page.');
        return;
      }
      const { createSessionId, getSavedSessionId } = await import('./auth.js');
      const savedSessionId = getSavedSessionId();
      const sessionId = savedSessionId || createSessionId(session.data.session.access_token);
      try {
        const { isSessionValid, showDisconnectedOverlay } = await import('./firebase-client.js');
        const isValid = await isSessionValid(state.currentUser.id, sessionId);
        if (!isValid) {
          showDisconnectedOverlay(true); /* sessione invalidata (es. login altra scheda): modal e reset subito */
          return;
        }
      } catch (err) {
        console.error('[Chat] Error checking session:', err);
        showToast('⚠️ Error verifying session. Message blocked.');
        return;
      }
    } catch (err) {
      console.error('[Chat] Error verifying session:', err);
      showToast('⚠️ Error verifying session. Message blocked.');
      return;
    }
  }
  
  /* Check permissions */
  const { hasPermission, loadUserPermissions } = await import('./permissions.js');
  await loadUserPermissions(); /* Ensure permissions are loaded */
  if (!hasPermission('can_post_messages')) {
    showToast('🚫 You do not have permission to post messages.');
    return;
  }
  
  /* Check if banned */
  const { checkIsBanned } = await import('./users.js');
  if (checkIsBanned(state.currentUser.id)) {
    showToast('🚫 You are banned and cannot send messages.');
    return;
  }
  
  /* Check if muted (global or in this room) */
  const { checkIsMuted } = await import('./users.js');
  const mute = checkIsMuted(state.currentUser.id, state.activeRoom);
  if (mute) {
    const scope = mute.global ? 'globally' : `in this room`;
    showToast(`🔇 You are muted ${scope} and cannot send messages.`);
    return;
  }
  
  /* Check for game commands BEFORE processing message */
  const textContent = dom.msgInput.textContent || dom.msgInput.innerText || '';
  if (_handleGameCommand && (textContent.trim().startsWith('/game') || textContent.trim().startsWith('/giochi'))) {
    const handled = _handleGameCommand(textContent);
    if (handled) {
      dom.msgInput.innerHTML = '';
      return; /* Don't send as regular message */
    }
  }
  
  let html = dom.msgInput.innerHTML.trim().replace(/^(<br\s*\/?>)+|(<br\s*\/?>)+$/gi, '').trim();
  const hasText  = html.length > 0 && html !== '<br>';
  const hasImage = !!state.pendingImage;
  if (!hasText && !hasImage) return;
  if (!hasText) html = '';

  /* Converti @nick in <span class="mention"> per evidenziare le mention */
  html = convertMentionsInHtml(html);

  /* Se il messaggio è solo testo (nessun span/font/b/strong), avvolgi con lo stile rich-text corrente così nel feed si vede colore/dimensione/grassetto */
  const hasRichTags = /<(span|font)[\s>]|<b[\s>]|<\/b>|<strong[\s>]|<\/strong>/i.test(html);
  if (hasText && html && !hasRichTags) {
    const FONT_SIZE_PX = { '1': '10px', '2': '12px', '3': '14px', '4': '18px', '5': '24px' };
    const px = FONT_SIZE_PX[state.fontSize] || '14px';
    const style = `color:${state.currentColor || 'inherit'};font-size:${px};font-weight:${state.isBold ? 'bold' : 'normal'};`;
    html = `<span style="${style}">${html}</span>`;
  }
  
  /* Security: Validate message length to prevent DoS */
  const { MAX_MESSAGE_LENGTH } = await import('./config.js');
  if (html.length > MAX_MESSAGE_LENGTH) {
    showToast(`⚠️ Message too long (max ${MAX_MESSAGE_LENGTH} characters).`);
    return;
  }
  
  /* Security: Sanitize HTML before saving to DB */
  html = sanitiseHtml(html);

  /* Word filter check - extract plain text for filtering */
  const plainText = textContent || dom.msgInput.textContent || dom.msgInput.innerText || '';
  if (plainText.trim()) {
    const { filterMessage } = await import('./word-filter.js');
    const filtered = filterMessage(plainText);
    
    if (filtered.blocked) {
      showToast('🚫 Your message contains filtered words and cannot be sent.');
      return;
    }
    
    /* If text was replaced, update html with filtered text */
    if (filtered.text !== plainText) {
      /* Re-sanitize the filtered text */
      html = sanitiseHtml(filtered.text);
    }
  }

  if (hasImage) {
    const url = (_supabaseReady?.())
      ? await _uploadToStorage?.(state.pendingImage.dataUrl, 'images', 'jpg')
      : null;
    html += `<img class="msg-img" src="${url || state.pendingImage.dataUrl}" alt="image">`;
    state.pendingImage = null;
    dom.imgPreviewStrip.hidden = true;
  }

  const quote     = state.replyTo;
  let quoteHtml = quote?.html || null;
  let quoteName = quote?.name || null;
  clearReplyTo();
  
  /* Security: Validate and sanitize quote */
  if (quoteHtml) {
    const { MAX_QUOTE_LENGTH } = await import('./config.js');
    if (quoteHtml.length > MAX_QUOTE_LENGTH) {
      quoteHtml = quoteHtml.substring(0, MAX_QUOTE_LENGTH);
    }
    quoteHtml = sanitiseHtml(quoteHtml);
  }
  if (quoteName) {
    const { MAX_USERNAME_LENGTH } = await import('./config.js');
    if (quoteName.length > MAX_USERNAME_LENGTH) {
      quoteName = quoteName.substring(0, MAX_USERNAME_LENGTH);
    }
    quoteName = escHtml(quoteName);
  }
  
  /* Nascondi "sta scrivendo" quando si invia */
  stopTyping();

  /* Optimistic render */
  const tempId = `m${Date.now()}${Math.random()}`;
  addMessage({ userId: 'me', html, ts: Date.now(), quoteHtml, quoteName, msgId: tempId });
  dom.msgInput.innerHTML = '';
  
  /* Persist to Supabase with room_id */
  const fullContent = quoteHtml
    ? `<div data-quote-name="${quoteName || ''}" data-quote-html="${encodeURIComponent(quoteHtml)}" class="msg-quote-meta"></div>${html}`
    : html;

  if (_supabaseReady?.() && state.fb) {
    state.fb.firestore.collection('messages').add({
      user_id: state.currentUser.id,
      username: state.currentUser.name,
      content: fullContent,
      room_id: state.activeRoom,
      reactions: {},
      created_at: new Date(),
    }).then(async (ref) => {
      const dbId = ref.id;
      const room = state.rooms[state.activeRoom];
      if (room) {
        const localMsg = room.messages.find(m => m.id === tempId);
        if (localMsg) {
          localMsg.id = dbId;
          const group = dom.msgsContainer?.querySelector(`[data-msg-id="${tempId}"]`);
          if (group) group.dataset.msgId = dbId;
        }
      }
    }).catch(async (err) => {
      if (err?.code === 'permission-denied' || err?.message?.includes('403')) {
        const { checkSessionInvalid } = await import('./firebase-client.js');
        await checkSessionInvalid();
        return;
      }
      console.warn('[NVC] msg insert:', err);
    });
  }
}

/* ── Reactions ── */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
let reactionPickerEl = null;

function openReactionPicker(e, msgId) {
  e.stopPropagation();
  if (reactionPickerEl) reactionPickerEl.remove();
  
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  QUICK_REACTIONS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'reaction-picker-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      toggleReaction(msgId, emoji);
      picker.remove();
      reactionPickerEl = null;
    });
    picker.appendChild(btn);
  });
  
  const rect = e.target.getBoundingClientRect();
  picker.style.left = `${rect.left}px`;
  picker.style.top = `${rect.bottom + 4}px`;
  document.body.appendChild(picker);
  reactionPickerEl = picker;
  
  setTimeout(() => {
    const clickOutside = (ev) => {
      if (!picker.contains(ev.target)) {
        picker.remove();
        reactionPickerEl = null;
        document.removeEventListener('click', clickOutside);
      }
    };
    setTimeout(() => document.addEventListener('click', clickOutside), 10);
  }, 10);
}

async function toggleReaction(msgId, emoji) {
  if (!msgId) {
    console.warn('[NVC] toggleReaction: missing msgId');
    return;
  }
  if (!state.fb && !state.supa) {
    console.warn('[NVC] toggleReaction: no backend (fb/supa)');
    return;
  }
  
  /* Find message in all rooms */
  let msg = null, roomId = null;
  for (const rid in state.rooms) {
    msg = state.rooms[rid].messages.find(m => m.id === msgId);
    if (msg) { roomId = rid; break; }
  }
  if (!msg) {
    console.warn('[NVC] toggleReaction: message not found', { msgId, rooms: Object.keys(state.rooms) });
    return;
  }
  
  const myId = String(state.currentUser?.id);
  const reactions = { ...(msg.reactions || {}) }; /* clone to avoid mutation issues */
  const userIds = [...(reactions[emoji] || [])]; /* clone array */
  const idx = userIds.indexOf(myId);
  
  if (idx >= 0) {
    userIds.splice(idx, 1);
    if (userIds.length === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = userIds;
    }
  } else {
    userIds.push(myId);
    reactions[emoji] = userIds;
  }
  
  /* Update local state */
  msg.reactions = reactions;
  
  /* Persist reactions: Supabase (if used) and/or Firestore */
  const isTempId = /^m\d+\.?\d*$/.test(msgId);
  if (isTempId) {
    console.warn('[NVC] toggleReaction: skipping DB update for temp ID', { msgId });
  } else {
    try {
      if (state.supa) {
        const { error } = await state.supa.from('messages').update({ reactions }).eq('id', msgId);
        if (error) throw error;
      }
      if (state.fb) {
        await state.fb.firestore.collection('messages').doc(msgId).update({ reactions });
      }
    } catch (err) {
      console.error('[NVC] toggleReaction: DB update failed', { error: err, msgId });
    }
  }
  
  /* Update only reactions in DOM (don't re-render entire message) */
  const group = dom.msgsContainer.querySelector(`[data-msg-id="${msgId}"]`);
  if (group && roomId === state.activeRoom) {
    updateMessageReactions(group, reactions);
  }
  
  /* Broadcast reaction change */
  if (_broadcast) _broadcast('reaction-update', null, { msgId, emoji, userId: myId, added: idx < 0 });
}

/* ── Update only reactions DOM without re-rendering entire message (exported for Firestore/Supabase sync) ── */
export function updateMessageReactions(groupEl, reactions) {
  const bubble = groupEl.querySelector('.msg-bubble');
  if (!bubble) return;
  
  /* Remove old reactions div */
  const oldReactions = bubble.querySelector('.msg-reactions');
  if (oldReactions) oldReactions.remove();
  
  /* Create new reactions div */
  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'msg-reactions';
  if (reactions && Object.keys(reactions).length > 0) {
    Object.entries(reactions).forEach(([emoji, userIds]) => {
      if (!Array.isArray(userIds) || userIds.length === 0) return;
      const reactBtn = document.createElement('button');
      reactBtn.className = 'msg-reaction';
      const hasReacted = userIds.includes(String(state.currentUser?.id));
      if (hasReacted) reactBtn.classList.add('reacted');
      reactBtn.textContent = `${emoji} ${userIds.length}`;
      reactBtn.title = `${userIds.length} reaction${userIds.length > 1 ? 's' : ''}`;
      const msgId = groupEl.dataset.msgId;
      reactBtn.addEventListener('click', () => toggleReaction(msgId, emoji));
      reactionsDiv.appendChild(reactBtn);
    });
  }
  
  /* Insert reactions before actions row (or at end of bubble if no actions) */
  const actionsRow = bubble.parentElement.querySelector('.msg-actions');
  if (actionsRow) {
    bubble.insertBefore(reactionsDiv, null); /* append to bubble */
  } else {
    bubble.appendChild(reactionsDiv);
  }
}

export function handleReactionUpdate(payload) {
  if (!payload.msgId) return;
  const myId = String(state.currentUser?.id);
  if (payload.userId === myId) return; /* already handled locally */
  
  /* Find message */
  let msg = null, roomId = null;
  for (const rid in state.rooms) {
    msg = state.rooms[rid].messages.find(m => m.id === payload.msgId);
    if (msg) { roomId = rid; break; }
  }
  if (!msg) return;
  
  const reactions = msg.reactions || {};
  const userIds = reactions[payload.emoji] || [];
  const idx = userIds.indexOf(payload.userId);
  
  if (payload.added) {
    if (idx < 0) userIds.push(payload.userId);
  } else {
    if (idx >= 0) userIds.splice(idx, 1);
    if (userIds.length === 0) delete reactions[payload.emoji];
  }
  msg.reactions = reactions;
  
  /* Update only reactions in DOM (don't re-render entire message) */
  if (roomId === state.activeRoom) {
    const group = dom.msgsContainer.querySelector(`[data-msg-id="${payload.msgId}"]`);
    if (group) {
      updateMessageReactions(group, reactions);
    }
  }
}

/* ── Search ── */
let searchQuery = '';
let searchResults = [];

export function initSearch() {
  if (!dom.headerSearchBtn || !dom.searchBar || !dom.searchInput) return;
  
  dom.headerSearchBtn.addEventListener('click', () => {
    dom.searchBar.hidden = false;
    dom.searchInput.focus();
  });
  
  dom.searchCloseBtn?.addEventListener('click', () => {
    dom.searchBar.hidden = true;
    searchQuery = '';
    searchResults = [];
    clearSearchHighlight();
  });
  
  dom.searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    if (searchQuery.length < 2) {
      clearSearchHighlight();
      return;
    }
    performSearch();
  });
  
  /* Ctrl+K shortcut */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !e.target.matches('input, textarea')) {
      e.preventDefault();
      dom.searchBar.hidden = false;
      dom.searchInput.focus();
    }
    if (e.key === 'Escape' && !dom.searchBar.hidden) {
      dom.searchBar.hidden = true;
      clearSearchHighlight();
    }
  });
}

function performSearch() {
  const room = state.rooms[state.activeRoom];
  if (!room) return;
  
  searchResults = room.messages.filter(msg => {
    const text = (() => {
      const div = document.createElement('div');
      div.innerHTML = processHtml(msg.html || '');
      return (div.textContent || '').toLowerCase();
    })();
    const username = (msg.username || '').toLowerCase();
    return text.includes(searchQuery) || username.includes(searchQuery);
  });
  
  highlightSearchResults();
  scrollToFirstResult();
}

function highlightSearchResults() {
  clearSearchHighlight();
  if (searchResults.length === 0) return;
  
  const groups = Array.from(dom.msgsContainer.querySelectorAll('.msg-group'));
  groups.forEach(group => {
    const msgId = group.dataset.msgId;
    if (!msgId) return;
    const found = searchResults.find(m => m.id === msgId);
    if (found) {
      group.classList.add('search-match');
      const textEl = group.querySelector('.msg-text');
      if (textEl && searchQuery) {
        const html = textEl.innerHTML;
        const regex = new RegExp(`(${escapeRegex(searchQuery)})`, 'gi');
        textEl.innerHTML = html.replace(regex, '<mark class="search-highlight">$1</mark>');
      }
    }
  });
}

function clearSearchHighlight() {
  dom.msgsContainer.querySelectorAll('.msg-group').forEach(g => {
    g.classList.remove('search-match');
    const textEl = g.querySelector('.msg-text');
    if (textEl) {
      const html = textEl.innerHTML;
      textEl.innerHTML = html.replace(/<mark class="search-highlight">(.*?)<\/mark>/gi, '$1');
    }
  });
}

function scrollToFirstResult() {
  const first = dom.msgsContainer.querySelector('.search-match');
  if (first) {
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

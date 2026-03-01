/* ================================================================
   chat.js  — public chat: render, send, quote/reply
================================================================ */
import { state }          from './state.js';
import { dom }            from './dom.js';
import { escHtml, avatarColor, initials, fmtTime, processHtml, scrollToBottom, showToast } from './utils.js';
import { findUser, ensureUser } from './users.js';

/* Forward refs — set by main.js to avoid circular deps */
let _openContextMenu = null;
let _uploadToStorage = null;
let _supabaseReady   = null;
let _renderRoomTabs  = null;
let _broadcast       = null;
export function setChatDeps(openCtx, uploadStorage, supaReady, renderTabs, broadcast) {
  _openContextMenu = openCtx;
  _uploadToStorage = uploadStorage;
  _supabaseReady   = supaReady;
  _renderRoomTabs  = renderTabs;
  _broadcast       = broadcast;
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
  const rId  = roomId || state.activeRoom;
  const room = state.rooms[rId];
  if (!room) return;

  /* Filter ignored users */
  if (userId && userId !== 'me' && state.ignoredUsers[String(userId)]) return;

  const msg = { 
    id: msgId || `m${Date.now()}${Math.random()}`, 
    userId, html, ts, quoteHtml, quoteName, username,
    reactions: reactions || {}
  };
  room.messages.push(msg);

  /* Increment unread count if message is in a non-active room */
  if (rId !== state.activeRoom && userId !== 'me' && userId !== state.currentUser?.id) {
    room.unreadCount = (room.unreadCount || 0) + 1;
    /* Forward ref to renderRoomTabs */
    if (_renderRoomTabs) _renderRoomTabs();
  }

  /* Only render if this is the active room */
  if (rId === state.activeRoom) renderMessage(msg);
}

/* ── Render a single message bubble ── */
export function renderMessage(msg) {
  if (dom.welcomeBanner?.parentNode) dom.welcomeBanner.remove();
  const isMine  = msg.userId === 'me' || msg.userId === state.currentUser?.id;
  const user    = isMine
    ? state.currentUser
    : (findUser(msg.userId) || { name: msg.username || 'User', isGuest: true, avatarUrl: null });
  const color   = avatarColor(user.name);
  const init    = initials(user.name);

  const group = document.createElement('div');
  group.className = `msg-group${isMine ? ' own' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar'; avatar.title = user.name;
  if (user.avatarUrl) {
    avatar.classList.add('has-photo');
    avatar.style.backgroundImage    = `url(${user.avatarUrl})`;
    avatar.style.backgroundSize     = 'cover';
    avatar.style.backgroundPosition = 'center';
  } else {
    avatar.style.background = color; avatar.textContent = init;
  }
  if (!isMine && _openContextMenu) avatar.addEventListener('click', () => _openContextMenu(msg.userId, avatar));

  const content = document.createElement('div');
  content.className = 'msg-content';

  const meta    = document.createElement('div');
  meta.className = 'msg-meta';

  const senderEl = document.createElement('span');
  senderEl.className = 'msg-sender';
  senderEl.textContent = isMine ? 'You' : user.name;

  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time'; timeEl.textContent = fmtTime(msg.ts);

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
    const tmp = document.createElement('div'); tmp.innerHTML = msg.quoteHtml;
    qText.textContent = tmp.textContent.slice(0, 120) + (tmp.textContent.length > 120 ? '…' : '');
    qBlock.append(qAuthor, qText);
    bubble.appendChild(qBlock);
  }

  const textDiv = document.createElement('div');
  textDiv.className = 'msg-text';
  textDiv.innerHTML = processHtml(msg.html);
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
  const authorName = isMine ? 'You' : user.name;
  replyBtn.addEventListener('click', () => setReplyTo(msg.userId, authorName, msg.html));
  
  actionsRow.append(reactBtn, replyBtn);
  content.append(meta, bubble, actionsRow);
  group.append(avatar, content);
  group.dataset.msgId = msg.id;
  dom.msgsContainer.appendChild(group);
  scrollToBottom();
}

/* ── Reply/quote state ── */
export function setReplyTo(userId, name, html) {
  state.replyTo = { userId, name, html };
  if (dom.replyPreviewBar)    dom.replyPreviewBar.hidden = false;
  if (dom.replyPreviewAuthor) dom.replyPreviewAuthor.textContent = `↩ ${name}`;
  if (dom.replyPreviewText)   dom.replyPreviewText.textContent   = (() => {
    const t = document.createElement('div'); t.innerHTML = html;
    return t.textContent.slice(0, 80);
  })();
}
export function clearReplyTo() {
  state.replyTo = null;
  if (dom.replyPreviewBar) dom.replyPreviewBar.hidden = true;
}

/* ── Send a public message ── */
export async function sendMessage() {
  let html = dom.msgInput.innerHTML.trim().replace(/^(<br\s*\/?>)+|(<br\s*\/?>)+$/gi, '').trim();
  const hasText  = html.length > 0 && html !== '<br>';
  const hasImage = !!state.pendingImage;
  if (!hasText && !hasImage) return;
  if (!hasText) html = '';

  if (hasImage) {
    const url = (_supabaseReady?.())
      ? await _uploadToStorage?.(state.pendingImage.dataUrl, 'images', 'jpg')
      : null;
    html += `<img class="msg-img" src="${url || state.pendingImage.dataUrl}" alt="image">`;
    state.pendingImage = null;
    dom.imgPreviewStrip.hidden = true;
  }

  const quote     = state.replyTo;
  const quoteHtml = quote?.html || null;
  const quoteName = quote?.name || null;
  clearReplyTo();

  /* Optimistic render */
  const tempId = `m${Date.now()}${Math.random()}`;
  addMessage({ userId: 'me', html, ts: Date.now(), quoteHtml, quoteName, msgId: tempId });
  dom.msgInput.innerHTML = '';

  /* Persist to Supabase with room_id */
  const fullContent = quoteHtml
    ? `<div data-quote-name="${escHtml(quoteName || '')}" data-quote-html="${encodeURIComponent(quoteHtml)}" class="msg-quote-meta"></div>${html}`
    : html;

  if (_supabaseReady?.()) {
    state.supa.from('messages').insert({
      user_id:  state.currentUser.id,
      username: state.currentUser.name,
      content:  fullContent,
      room_id:  state.activeRoom,
      reactions: {},
    }).then(({ data, error }) => {
      if (error) {
        console.warn('[NVC] msg insert:', error);
        return;
      }
      /* Update local message with DB UUID */
      if (data && data[0]) {
        const dbId = data[0].id;
        const room = state.rooms[state.activeRoom];
        if (room) {
          const localMsg = room.messages.find(m => m.id === tempId);
          if (localMsg) {
            localMsg.id = dbId;
            /* Update DOM if message is rendered */
            const group = dom.msgsContainer.querySelector(`[data-msg-id="${tempId}"]`);
            if (group) {
              group.dataset.msgId = dbId;
            }
          }
        }
      }
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
  if (!_supabaseReady?.() || !msgId) {
    console.warn('[NVC] toggleReaction: missing supabase or msgId', { msgId, ready: !!_supabaseReady?.() });
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
  
  /* Update DB - only if msgId is a UUID (from DB), not a temp ID */
  if (msgId.startsWith('m') && msgId.length < 20) {
    console.warn('[NVC] toggleReaction: skipping DB update for temp ID', { msgId });
  } else {
    const { error } = await state.supa.from('messages')
      .update({ reactions })
      .eq('id', msgId);
    if (error) {
      console.error('[NVC] toggleReaction: DB update failed', { error, msgId });
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

/* ── Update only reactions DOM without re-rendering entire message ── */
function updateMessageReactions(groupEl, reactions) {
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
      div.innerHTML = msg.html;
      return div.textContent || '';
    })().toLowerCase();
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

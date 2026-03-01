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
export function setChatDeps(openCtx, uploadStorage, supaReady) {
  _openContextMenu = openCtx;
  _uploadToStorage = uploadStorage;
  _supabaseReady   = supaReady;
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
export function addMessage({ userId, html, ts = Date.now(), quoteHtml = null, quoteName = null, username = null }, roomId) {
  const rId  = roomId || state.activeRoom;
  const room = state.rooms[rId];
  if (!room) return;

  /* Filter ignored users */
  if (userId && userId !== 'me' && state.ignoredUsers[String(userId)]) return;

  const msg = { id: `m${Date.now()}${Math.random()}`, userId, html, ts, quoteHtml, quoteName, username };
  room.messages.push(msg);

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
  textDiv.innerHTML = processHtml(msg.html);
  bubble.appendChild(textDiv);

  /* Reply button */
  const replyBtn = document.createElement('button');
  replyBtn.className = 'msg-reply-btn';
  replyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg> Reply`;
  const authorName = isMine ? 'You' : user.name;
  replyBtn.addEventListener('click', () => setReplyTo(msg.userId, authorName, msg.html));

  content.append(meta, bubble, replyBtn);
  group.append(avatar, content);
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
  addMessage({ userId: 'me', html, ts: Date.now(), quoteHtml, quoteName });
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
    }).then(({ error }) => { if (error) console.warn('[NVC] msg insert:', error); });
  }
}

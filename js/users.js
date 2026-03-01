/* ================================================================
   users.js  — user presence, list rendering, typing
================================================================ */
import { state } from './state.js';
import { dom }   from './dom.js';
import { avatarColor, initials } from './utils.js';

/* Forward-declared — set by main.js to break circular dep */
let _openContextMenu = null;
export function setOpenContextMenu(fn) { _openContextMenu = fn; }

/* ── User helpers ── */
export function findUser(id) {
  if (id === 'me' || id === state.currentUser?.id) return state.currentUser;
  return state.users.find(u => u.id === id) || null;
}

export function ensureUser(id, name, extra = {}) {
  if (!id || id === state.currentUser?.id) return;
  let u = state.users.find(u => u.id === id);
  if (!u) {
    u = { id, name, isGuest: true, online: false, hasCamera: false, avatarUrl: null };
    state.users.push(u);
  }
  if (name)                 u.name      = name;
  if ('username'  in extra) u.username  = extra.username  || null;
  if ('isGuest'   in extra) u.isGuest   = extra.isGuest;
  if ('online'    in extra) u.online    = extra.online;
  if ('hasCamera' in extra) u.hasCamera = extra.hasCamera;
  if ('avatarUrl' in extra) u.avatarUrl = extra.avatarUrl;
  return u;
}

/* ── Render user list for the active room ── */
export function renderUsers() {
  const roomId   = state.activeRoom;
  const room     = state.rooms[roomId];
  /* For the active room, show users tracked in that room's presence.
     Fall back to global state.users for backward compatibility.       */
  const roomUsers = room ? Object.values(room.users || {}) : state.users.filter(u => u?.online);

  dom.usersList.innerHTML = '';
  const all    = [state.currentUser, ...roomUsers.filter(u => u && u.id !== state.currentUser?.id && u.online)];
  const online = all.length;
  if (dom.onlineCountLabel) dom.onlineCountLabel.textContent = online;
  if (dom.onlineBadge)      dom.onlineBadge.textContent      = online;

  all.forEach(user => {
    if (!user) return;
    const li = document.createElement('div');
    li.className = 'user-item';
    li.setAttribute('role', 'listitem');
    li.dataset.userId = user.id;

    const displayName = user.username || user.name;

    const av = document.createElement('div');
    av.className = 'user-item-avatar';
    if (user.avatarUrl) {
      av.classList.add('has-photo');
      av.style.cssText = `background-image:url(${user.avatarUrl});background-size:cover;background-position:center;background-color:transparent`;
    } else {
      av.style.backgroundColor = avatarColor(displayName);
      av.textContent = initials(displayName);
    }
    const dot = document.createElement('span');
    dot.className = `status-dot${user.online ? '' : ' offline'}`;
    av.appendChild(dot);

    const info   = document.createElement('div'); info.className = 'user-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = `user-item-name${user.online ? '' : ' offline'}`;
    nameEl.textContent = displayName;
    const sub = document.createElement('div');
    sub.className  = 'user-item-sub';
    sub.textContent = user.online ? 'Online' : 'Offline';
    info.append(nameEl, sub);
    li.append(av, info);

    if (user.hasCamera && user.online) {
      const ci = document.createElement('span');
      ci.className = 'user-cam-icon'; ci.textContent = '📹'; ci.title = 'Camera on';
      li.appendChild(ci);
    }
    if (!user.isGuest) {
      const rb = document.createElement('span');
      rb.className = 'registered-tag'; rb.textContent = '✓'; rb.title = 'Registered user';
      li.appendChild(rb);
    } else {
      const gt = document.createElement('span'); gt.className = 'guest-tag'; gt.textContent = 'Guest'; li.appendChild(gt);
    }
    if (user.id === state.currentUser?.id) {
      const yt = document.createElement('span'); yt.className = 'you-tag'; yt.textContent = 'You'; li.appendChild(yt);
    }
    if (user.id !== state.currentUser?.id && _openContextMenu) {
      li.addEventListener('click', e => { e.stopPropagation(); _openContextMenu(user.id, li); });
    }
    dom.usersList.appendChild(li);
  });
}

/* ── Own presence track ── */
export async function updateOwnPresence(presenceCh) {
  const ch = presenceCh || (state.rooms[state.activeRoom]?.presenceCh);
  if (!ch) return;
  await ch.track({
    id:        state.currentUser.id,
    name:      state.currentUser.name,
    username:  state.currentUser.username || state.currentUser.name,
    isGuest:   state.currentUser.isGuest,
    hasCamera: state.currentUser.hasCamera,
    online:    true,
    avatarUrl: state.currentUser.avatarUrl || null,
  });
}

/* ── Sync presence state for a room ── */
export function syncPresence(presenceState, roomId) {
  const rId  = roomId || state.activeRoom;
  const room = state.rooms[rId];
  if (!room) return;

  const myId = String(state.currentUser.id);

  /* Update room-local users map */
  room.users = {};
  Object.entries(presenceState).forEach(([uid, presences]) => {
    if (String(uid) === myId) return;
    const info = presences[0];
    const user = {
      id: String(uid),
      name:      info.name,
      username:  info.username || null,
      isGuest:   info.isGuest,
      online:    true,
      hasCamera: !!info.hasCamera,
      avatarUrl: info.avatarUrl || null,
    };
    room.users[String(uid)] = user;
    /* Also keep the global state.users in sync */
    ensureUser(String(uid), info.name, { username: info.username || null, isGuest: info.isGuest, online: true, hasCamera: !!info.hasCamera, avatarUrl: info.avatarUrl || null });
  });

  if (rId === state.activeRoom) renderUsers();
}

/* ── Typing indicator ── */
export function sendTypingEvent() {
  if (!state.signalCh) return;
  state.signalCh.send({ type: 'broadcast', event: 'typing',
    payload: { from: state.currentUser.id, name: state.currentUser.name, isTyping: true } });
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    state.signalCh?.send({ type: 'broadcast', event: 'typing',
      payload: { from: state.currentUser.id, name: state.currentUser.name, isTyping: false } });
  }, 2500);
}
export function handleTyping(payload) {
  if (payload.from === state.currentUser?.id) return;
  if (payload.isTyping) {
    dom.typingTxt.textContent = `${payload.name} is typing…`;
    dom.typingRow.classList.add('visible');
  } else {
    dom.typingRow.classList.remove('visible');
  }
}

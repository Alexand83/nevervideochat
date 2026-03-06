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

  console.log('[Users] renderUsers called:', {
    roomId,
    hasRoom: !!room,
    roomUsersCount: roomUsers.length,
    stateUsersCount: state.users.length,
    hasCurrentUser: !!state.currentUser,
    currentUserId: state.currentUser?.id
  });

  if (!dom.usersList) {
    console.error('[Users] dom.usersList is null!');
    return;
  }

  dom.usersList.innerHTML = '';
  
  /* CRITICO: Assicurati che l'utente corrente sia sempre nella lista, anche se non è ancora nella presenza */
  const all    = [state.currentUser, ...roomUsers.filter(u => u && u.id !== state.currentUser?.id && u.online)];
  const online = all.length;
  
  console.log('[Users] Rendering users:', {
    totalUsers: all.length,
    currentUserIncluded: all.some(u => u?.id === state.currentUser?.id),
    users: all.map(u => ({ id: u?.id, name: u?.name, online: u?.online }))
  });
  if (dom.onlineCountLabel) dom.onlineCountLabel.textContent = online;
  if (dom.onlineBadge)      dom.onlineBadge.textContent      = online;
  if (dom.floatingUsersBadge) dom.floatingUsersBadge.textContent = online;

  /* Games panel users list removed - now using separate usersPanel */
  
  all.forEach(user => {
    if (!user) return;
    const li = document.createElement('div');
    li.className = 'user-item';
    li.setAttribute('role', 'listitem');
    li.dataset.userId = user.id;

    /* Usa display_name (name) se disponibile, altrimenti username, altrimenti name */
    const displayName = user.name || user.username || 'User';

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

    /* For the current user: show cam icon only in the room where cam is active */
    const hasCamHere = user.id === state.currentUser?.id
      ? (state.cameraRoom === roomId)
      : (user.hasCamera && user.online);

    if (hasCamHere) {
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
    
    /* Show muted indicator */
    const muteInfo = checkIsMuted(user.id, roomId);
    if (muteInfo) {
      const muteTag = document.createElement('span');
      muteTag.className = 'muted-tag';
      muteTag.textContent = '🔇 Muted';
      muteTag.title = muteInfo.global ? 'Muted globally' : `Muted in this room`;
      li.appendChild(muteTag);
    }
    
    if (user.id !== state.currentUser?.id && _openContextMenu) {
      li.addEventListener('click', e => { e.stopPropagation(); _openContextMenu(user.id, li); });
    }
    dom.usersList.appendChild(li);
  });
}

/* ── Check if user is muted (in this room or globally) ── */
export function checkIsMuted(userId, roomId) {
  const mute = state.mutedUsers[String(userId)];
  if (!mute) return null;
  
  /* Check if expired */
  if (mute.expires_at && new Date(mute.expires_at) < new Date()) {
    delete state.mutedUsers[String(userId)];
    return null;
  }
  
  /* Global mute applies everywhere */
  if (mute.room_id === null) {
    return { global: true, room_id: null };
  }
  
  /* Room-specific mute only applies to that room */
  if (mute.room_id === roomId) {
    return { global: false, room_id: roomId };
  }
  
  return null;
}

/* ── Check if user is kicked from this room ── */
export function checkIsKicked(userId, roomId) {
  const kicked = state.kickedUsers[String(userId)];
  if (!kicked || !kicked[roomId]) return false;
  
  const expiresAt = kicked[roomId];
  if (new Date(expiresAt) < new Date()) {
    /* Expired, remove from cache */
    delete kicked[roomId];
    if (Object.keys(kicked).length === 0) {
      delete state.kickedUsers[String(userId)];
    }
    return false;
  }
  
  return true;
}

/* ── Check if user is banned ── */
export function checkIsBanned(userId) {
  const ban = state.bannedUsers[String(userId)];
  if (!ban) return false;
  
  /* Check if expired */
  if (ban.expires_at && new Date(ban.expires_at) < new Date()) {
    delete state.bannedUsers[String(userId)];
    return false;
  }
  
  return true;
}

/* ── Own presence track ── */
export async function updateOwnPresence(presenceCh) {
  const ch = presenceCh || (state.rooms[state.activeRoom]?.presenceCh);
  if (!ch) return;

  /* Determine which room this channel belongs to */
  let roomId = state.activeRoom;
  for (const [rId, room] of Object.entries(state.rooms)) {
    if (room.presenceCh === ch) { roomId = rId; break; }
  }

  await ch.track({
    id:        state.currentUser.id,
    name:      state.currentUser.name,  /* display_name - quello che l'utente vuole mostrare */
    username:  state.currentUser.username || null,  /* username dell'account (per login) */
    isGuest:   state.currentUser.isGuest,
    hasCamera: state.cameraRoom === roomId,   /* true only in the room where cam is active */
    online:    true,
    avatarUrl: state.currentUser.avatarUrl || null,
  });
}

/* ── Update presence in ALL joined rooms (used after cam toggle) ── */
export async function updateAllRoomPresences() {
  for (const room of Object.values(state.rooms)) {
    if (room.presenceCh) await updateOwnPresence(room.presenceCh);
  }
}

/* ── Sync presence state for a room ── */
export function syncPresence(presenceState, roomId) {
  const rId  = roomId || state.activeRoom;
  const room = state.rooms[rId];
  if (!room) return;

  const myId = String(state.currentUser.id);

  /* Update room-local users map - NON resettare completamente, preserva hasCamera se già presente */
  Object.entries(presenceState).forEach(([uid, presences]) => {
    if (String(uid) === myId) return;
    const info = presences[0];
    /* info.name è il display_name dalla presenza */
    const existingUser = room.users[String(uid)];
    
    /* CRITICO: Logica di preservazione hasCamera migliorata */
    /* Se hasCamera è già true nell'utente esistente, preservalo SEMPRE a meno che la presenza non dica esplicitamente false */
    /* Questo evita che il sync sovrascriva hasCamera quando la presenza non è ancora aggiornata */
    let hasCamera;
    if (info.hasCamera === true) {
      /* La presenza dice esplicitamente true - usa quello */
      hasCamera = true;
    } else if (info.hasCamera === false) {
      /* La presenza dice esplicitamente false - usa quello */
      hasCamera = false;
    } else {
      /* hasCamera è undefined o null nella presenza - preserva quello esistente */
      /* Se l'utente esiste già e ha hasCamera=true, mantienilo */
      if (existingUser?.hasCamera === true) {
        hasCamera = true;
      } else {
        hasCamera = false;
      }
    }
    
    const user = {
      id: String(uid),
      name:      info.name || info.username || 'User',  /* display_name dalla presenza */
      username:  info.username || null,  /* username dell'account */
      isGuest:   info.isGuest,
      online:    true,
      hasCamera: hasCamera,  /* Preserva hasCamera se già presente, altrimenti usa quello dalla presenza */
      avatarUrl: info.avatarUrl || null,
    };
    room.users[String(uid)] = user;
    /* Also keep the global state.users in sync */
    ensureUser(String(uid), info.name || info.username || 'User', { username: info.username || null, isGuest: info.isGuest, online: true, hasCamera: hasCamera, avatarUrl: info.avatarUrl || null });
  });
  
  /* Rimuovi utenti che non sono più nella presenza */
  const presentUserIds = new Set(Object.keys(presenceState).map(String));
  Object.keys(room.users).forEach(uid => {
    if (uid !== myId && !presentUserIds.has(uid)) {
      delete room.users[uid];
    }
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

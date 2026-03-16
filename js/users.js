/* ================================================================
   users.js  — user presence, list rendering, typing
================================================================ */
import { state } from './state.js';
import { dom }   from './dom.js';
import { avatarColor, initials, safeAvatarUrl } from './utils.js';

/* Forward-declared — set by main.js to break circular dep */
let _openContextMenu = null;
export function setOpenContextMenu(fn) { _openContextMenu = fn; }

/* ── Rilevamento tipo dispositivo ───────────────────────────────
   Ritorna 'mobile' | 'tablet' | 'desktop'.
   Chiamato una volta e cachato per evitare ricalcoli ripetuti.    */
let _deviceTypeCache = null;
export function getDeviceType() {
  if (_deviceTypeCache) return _deviceTypeCache;
  const ua = navigator.userAgent;
  let type;
  if (/iPad/i.test(ua)) {
    type = 'tablet';
  } else if (/Android/i.test(ua) && !/Mobile/i.test(ua)) {
    type = 'tablet'; /* Android tablet: "Android" senza "Mobile" */
  } else if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) {
    type = 'tablet'; /* iPad con iOS 13+ che si maschera da Mac */
  } else if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    type = 'mobile';
  } else {
    type = 'desktop';
  }
  _deviceTypeCache = type;
  return type;
}

/* Emoji per tipo dispositivo */
const DEVICE_EMOJI = { mobile: '📱', tablet: '💻', desktop: '🖥️' };
const DEVICE_LABEL = { mobile: 'Mobile', tablet: 'Tablet', desktop: 'PC' };

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
  if ('roleName'   in extra) u.roleName   = extra.roleName   ?? 'User';
  if ('roleColor'  in extra) u.roleColor  = extra.roleColor  ?? '#8b949e';
  if ('deviceType' in extra) u.deviceType = extra.deviceType ?? 'desktop';
  return u;
}

/* ── Render user list for the active room ── */
export function renderUsers() {
  const roomId   = state.activeRoom;
  const room     = state.rooms[roomId];
  /* For the active room, show users tracked in that room's presence.
     Fall back to global state.users for backward compatibility.       */
  let roomUsers = room ? Object.values(room.users || {}) : state.users.filter(u => u?.online);
  const bannedIds = state.bannedUserIds || new Set();
  const filteredOut = roomUsers.filter(u => u && bannedIds.has(String(u.id)));
  if (filteredOut.length) {
    roomUsers = roomUsers.filter(u => !u || !bannedIds.has(String(u.id)));
    console.log('[Users] Filtered out banned users (ghost presence):', filteredOut.map(u => ({ id: u.id, name: u.name })));
  }
  console.log('[Users] renderUsers called:', {
    roomId,
    hasRoom: !!room,
    roomUsersCount: roomUsers.length,
    userIdsInRoom: roomUsers.map(u => u?.id),
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
    const safeUrl = safeAvatarUrl(user.avatarUrl);
    if (safeUrl) {
      av.classList.add('has-photo');
      av.style.cssText = `background-image:url(${safeUrl});background-size:cover;background-position:center;background-color:transparent`;
    } else {
      av.style.backgroundColor = avatarColor(displayName);
      av.textContent = initials(displayName);
    }
    const dot = document.createElement('span');
    dot.className = `status-dot${user.online ? '' : ' offline'}`;
    av.appendChild(dot);

    const roleName  = user.roleName || 'User';
    const roleColor = user.roleColor || '#8b949e';

    const info   = document.createElement('div'); info.className = 'user-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = `user-item-name${user.online ? '' : ' offline'}`;
    nameEl.textContent = displayName;
    nameEl.style.color = roleColor;
    const sub = document.createElement('div');
    sub.className  = 'user-item-sub';
    sub.textContent = roleName;
    sub.style.color = roleColor;
    info.append(nameEl, sub);

    /* Icona dispositivo (mobile / tablet / desktop) */
    const dtype = user.deviceType || (user.id === state.currentUser?.id ? getDeviceType() : 'desktop');
    const deviceEl = document.createElement('span');
    deviceEl.className = `user-device-icon user-device-${dtype}`;
    deviceEl.title = DEVICE_LABEL[dtype] || 'PC';
    deviceEl.textContent = DEVICE_EMOJI[dtype] || DEVICE_EMOJI.desktop;
    li.append(av, info, deviceEl);

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
  const key = String(roomId);
  if (!kicked || !kicked[key]) return false;
  
  const expiresAt = kicked[key];
  if (new Date(expiresAt) < new Date()) {
    /* Expired, remove from cache */
    delete kicked[key];
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
  
  /* Check if expired (expires_at can be ISO string or Firestore Timestamp) */
  if (ban.expires_at) {
    const exp = ban.expires_at.toDate ? ban.expires_at.toDate() : new Date(ban.expires_at);
    if (!Number.isNaN(exp.getTime()) && exp < new Date()) {
      delete state.bannedUsers[String(userId)];
      return false;
    }
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
    id:         state.currentUser.id,
    name:       state.currentUser.name,
    username:   state.currentUser.username || null,
    isGuest:    state.currentUser.isGuest,
    hasCamera:  state.cameraRoom === roomId,
    online:     true,
    avatarUrl:  state.currentUser.avatarUrl || null,
    roleName:   state.currentUser.roleName  || 'User',
    roleColor:  state.currentUser.roleColor || '#8b949e',
    deviceType: getDeviceType(),
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

  const bannedIds = state.bannedUserIds || new Set();
  /* Update room-local users map - NON resettare completamente, preserva hasCamera se già presente. Salta utenti bannati (presenza fantasma). */
  Object.entries(presenceState).forEach(([uid, presences]) => {
    if (String(uid) === myId) return;
    if (bannedIds.has(String(uid))) return;
    const info = presences[0];
    /* info.name è il display_name dalla presenza */
    const existingUser = room.users[String(uid)];
    const globalUser = state.users.find(u => String(u.id) === String(uid));
    
    /* CRITICO: Logica di preservazione hasCamera migliorata */
    /* Se hasCamera è già true nell'utente esistente O in state.users, preservalo SEMPRE a meno che la presenza non dica esplicitamente false */
    /* Questo evita che il sync sovrascriva hasCamera quando la presenza non è ancora aggiornata */
    let hasCamera;
    
    /* CRITICO: Se questa camera è stata aperta via broadcast di recente, preserva hasCamera=true */
    /* Questo previene che il sync sovrascriva hasCamera quando la presenza non è ancora aggiornata */
    /* CRITICO: Ridotto a 5 secondi per evitare di preservare cam che non esistono più */
    const wasOpenedViaBroadcast = state.camerasOpenedViaBroadcast[String(uid)];
    const broadcastTime = wasOpenedViaBroadcast ? Date.now() - wasOpenedViaBroadcast : Infinity;
    const isRecentBroadcast = broadcastTime < 5000; /* 5 secondi invece di 10 */
    
    if (info.hasCamera === true) {
      /* La presenza dice esplicitamente true - usa quello */
      hasCamera = true;
    } else if (info.hasCamera === false) {
      /* La presenza dice esplicitamente false: rispetta sempre (es. utente ha aggiornato la pagina, cam spenta) */
      /* Solo se c'è un broadcast molto recente (cam appena aperta) preserva true per latenza presenza */
      if (isRecentBroadcast) {
        hasCamera = true;
        console.log('[Users] Preserving hasCamera=true for', uid, 'during sync (presence says false but broadcast was', Math.round(broadcastTime/1000), 's ago)');
      } else {
        hasCamera = false;
      }
    } else {
      /* hasCamera è undefined o null nella presenza - preserva quello esistente */
      /* Controlla sia in room.users che in state.users per maggiore robustezza */
      /* IMPORTANTE: Se hasCamera è true in QUALSIASI fonte (room.users o state.users) O se è stata aperta via broadcast, preservalo */
      if (existingUser?.hasCamera === true || globalUser?.hasCamera === true || isRecentBroadcast) {
        hasCamera = true;
        if (isRecentBroadcast) {
          console.log('[Users] Preserving hasCamera=true for', uid, 'during sync (opened via broadcast', Math.round(broadcastTime/1000), 's ago)');
        } else {
          console.log('[Users] Preserving hasCamera=true for', uid, 'during sync (presence has undefined)');
        }
      } else {
        hasCamera = false;
      }
    }
    
    const user = {
      id:         String(uid),
      name:       info.name || info.username || 'User',
      username:   info.username || null,
      isGuest:    info.isGuest,
      online:     true,
      hasCamera:  hasCamera,
      avatarUrl:  info.avatarUrl || null,
      roleName:   info.roleName  || 'User',
      roleColor:  info.roleColor || '#8b949e',
      deviceType: info.deviceType || 'desktop',
    };
    room.users[String(uid)] = user;
    /* Annulla leave in sospeso: utente ancora in presenza (evita falso "esce/rientra" da track cam) */
    const timerKey = rId + ':' + uid;
    if (state.presenceLeaveTimers[timerKey]) {
      clearTimeout(state.presenceLeaveTimers[timerKey]);
      delete state.presenceLeaveTimers[timerKey];
    }
    /* Also keep the global state.users in sync */
    ensureUser(String(uid), info.name || info.username || 'User', { username: info.username || null, isGuest: info.isGuest, online: true, hasCamera: hasCamera, avatarUrl: info.avatarUrl || null, roleName: user.roleName, roleColor: user.roleColor, deviceType: user.deviceType });
  });

  /* Rimuovi utenti che non sono più nella presenza — con debounce 2s come per leave (Supabase invia sync senza utente prima del join su track()) */
  const presentUserIds = new Set(Object.keys(presenceState).map(String));
  Object.keys(room.users).forEach(uid => {
    if (uid === myId || presentUserIds.has(uid)) return;
    const timerKey = rId + ':' + uid;
    if (state.presenceLeaveTimers[timerKey]) clearTimeout(state.presenceLeaveTimers[timerKey]);
    state.presenceLeaveTimers[timerKey] = setTimeout(async () => {
      delete state.presenceLeaveTimers[timerKey];
      if (!state.rooms[rId]) return;
      /* Double-check: se è ancora in presenceState() non rimuovere (falso leave da sync in ritardo) */
      const ch = state.rooms[rId]?.presenceCh;
      const currentPresence = ch?.presenceState?.() ?? {};
      if (Object.prototype.hasOwnProperty.call(currentPresence, uid)) return;
      delete state.rooms[rId].users[uid];
      state.presenceLeftAt[rId + ':' + uid] = Date.now();
      if (state.cameraWindows[uid]) {
        const { closeCameraWindow } = await import('./camera.js');
        await closeCameraWindow(uid);
      }
      if (rId === state.activeRoom) renderUsers();
    }, 2000);
  });

  /* CRITICO: Inserisci sempre il current user in lista se è nella stanza (fix: nick non appariva dopo refresh) */
  if (state.currentUser && rId === state.activeRoom) {
    room.users[myId] = {
      id:         myId,
      name:       state.currentUser.name,
      username:   state.currentUser.username || null,
      isGuest:    state.currentUser.isGuest,
      online:     true,
      hasCamera:  state.cameraRoom === rId,
      avatarUrl:  state.currentUser.avatarUrl || null,
      roleName:   state.currentUser.roleName  || 'User',
      roleColor:  state.currentUser.roleColor || '#8b949e',
      deviceType: getDeviceType(),
    };
  }

  if (rId === state.activeRoom) renderUsers();
}

/* ── Typing indicator ── */
export function sendTypingEvent() {
  if (!state.signalCh || !state.currentUser) return;
  const roomId = state.activeRoom;
  const payload = { from: state.currentUser.id, name: state.currentUser.name, isTyping: true, roomId };
  state.signalCh.send({ type: 'broadcast', event: 'typing', payload });
  /* Mostra subito "Stai scrivendo..." anche a te (il broadcast di solito non torna al mittente) */
  handleTyping(payload);
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    if (!state.currentUser) return;
    const stopPayload = { from: state.currentUser.id, name: state.currentUser.name, isTyping: false, roomId };
    state.signalCh?.send({ type: 'broadcast', event: 'typing', payload: stopPayload });
    handleTyping(stopPayload); /* nasconde "Stai scrivendo..." anche per te */
  }, 2500);
}

/** Invia "non sta scrivendo" e azzera il timer (es. quando si invia un messaggio). */
export function stopTyping() {
  if (state.typingTimer) {
    clearTimeout(state.typingTimer);
    state.typingTimer = null;
  }
  if (!state.signalCh || !state.currentUser) return;
  const payload = { from: state.currentUser.id, name: state.currentUser.name, isTyping: false, roomId: state.activeRoom };
  state.signalCh.send({ type: 'broadcast', event: 'typing', payload });
  handleTyping(payload); /* nasconde "Stai scrivendo..." subito */
}

export function handleTyping(payload) {
  /* Mostra solo se è nella stessa stanza */
  if (payload.roomId != null && String(payload.roomId) !== String(state.activeRoom)) return;
  const uid = String(payload.from);
  if (payload.isTyping) {
    state.typingUsers[uid] = { name: payload.name || 'User', roomId: payload.roomId };
  } else {
    delete state.typingUsers[uid];
  }
  updateTypingDisplay();
}

/** Aggiorna il testo "X sta scrivendo" / "X, Y, Z stanno scrivendo..." in base a state.typingUsers (solo stanza attiva). */
function updateTypingDisplay() {
  const roomId = String(state.activeRoom);
  const myId = state.currentUser?.id ? String(state.currentUser.id) : '';
  const list = Object.entries(state.typingUsers || {})
    .filter(([, v]) => v && String(v.roomId) === roomId)
    .map(([uid, v]) => ({ uid, name: v.name }));

  if (list.length === 0) {
    dom.typingRow.classList.remove('visible');
    return;
  }

  import('./i18n.js').then(({ t }) => {
    const single = t('chat.typing', 'sta scrivendo...');
    const plural = t('chat.typingPlural', 'stanno scrivendo...');
    const you = t('chat.typingYou', 'Stai scrivendo...');
    let text;
    if (list.length === 1) {
      text = list[0].uid === myId ? you : `${list[0].name} ${single}`;
    } else {
      const names = list.map(({ uid, name }) => (uid === myId ? (t('users.you', 'Tu') || 'Tu') : name));
      text = `${names.join(', ')} ${plural}`;
    }
    dom.typingTxt.textContent = text;
  }).catch(() => {
    if (list.length === 1) {
      dom.typingTxt.textContent = list[0].uid === myId ? 'Stai scrivendo...' : `${list[0].name} sta scrivendo...`;
    } else {
      const names = list.map(({ uid, name }) => (uid === myId ? 'Tu' : name));
      dom.typingTxt.textContent = `${names.join(', ')} stanno scrivendo...`;
    }
  });
  dom.typingRow.classList.add('visible');
}

/* ================================================================
   rooms.js  — multi-room tabs, join/leave, per-room presence+chat
================================================================ */
import { DEFAULT_ROOM_ID } from './config.js';
import { state }           from './state.js';
import { dom }             from './dom.js';
import { showToast }       from './utils.js';
import { syncPresence, updateOwnPresence, renderUsers } from './users.js';

/* Forward refs set by main.js */
let _loadRoomMessages = null;  // (roomId) => Promise<void>
export function setLoadRoomMessages(fn) { _loadRoomMessages = fn; }

/* ── Available rooms cache (loaded from DB) ── */
let availableRoomsCache = [];

/* ── Load rooms from database ── */
export async function loadRoomsFromDB() {
  if (!state.supa) return;
  try {
    const { data, error } = await state.supa
      .from('rooms')
      .select('*')
      .eq('is_open', true)
      .order('created_at', { ascending: true });
    if (error) throw error;
    availableRoomsCache = data || [];
  } catch (err) {
    console.error('[Rooms] Load error:', err);
    availableRoomsCache = [];
  }
}

/* ── Get available rooms (from cache or DB) ── */
export function getAvailableRooms() {
  return availableRoomsCache;
}

/* ── Create a room state entry ── */
function mkRoom(id, name = null, icon = '💬') {
  return { id, name: name || id, icon, messages: [], presenceCh: null, dbSub: null, users: {}, unreadCount: 0 };
}

/* ── Join a room (subscribe presence + DB, load messages) ── */
export async function joinRoom(roomId) {
  if (state.rooms[roomId]) {
    switchRoom(roomId);
    return;
  }
  if (!state.supa) return;
  
  /* Check if user is banned */
  const { checkIsBanned } = await import('./users.js');
  if (checkIsBanned(state.currentUser?.id)) {
    showToast('🚫 You are banned and cannot join rooms.');
    return;
  }
  
  /* Check if user is kicked from this room */
  const { checkIsKicked } = await import('./users.js');
  if (checkIsKicked(state.currentUser?.id, roomId)) {
    showToast(`👢 You have been kicked from this room.`);
    return;
  }

  /* Load room info from DB if available */
  const roomInfo = availableRoomsCache.find(r => r.id === roomId);
  state.rooms[roomId] = mkRoom(roomId, roomInfo?.name, roomInfo?.icon);

  /* Presence channel for this room */
  const presenceCh = state.supa.channel(`presence:room-${roomId}`, {
    config: { presence: { key: state.currentUser.id } },
  });

  presenceCh
    .on('presence', { event: 'sync' }, () => {
      syncPresence(presenceCh.presenceState(), roomId);
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      const uid = String(key);
      if (uid === String(state.currentUser.id)) return;
      const info = newPresences[0];
      if (!state.rooms[roomId]) return;
      state.rooms[roomId].users[uid] = {
        id: uid, name: info.name, username: info.username || null,
        isGuest: info.isGuest, online: true,
        hasCamera: !!info.hasCamera, avatarUrl: info.avatarUrl || null,
      };
      if (roomId === state.activeRoom) {
        renderUsers();
        showToast(`👤 ${info.name} joined #${state.rooms[roomId].name}`);
      }
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      const uid = String(key);
      if (!state.rooms[roomId]) return;
      delete state.rooms[roomId].users[uid];
      if (roomId === state.activeRoom) renderUsers();
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') await updateOwnPresence(presenceCh);
    });

  state.rooms[roomId].presenceCh = presenceCh;

  /* Load messages & subscribe to DB changes */
  if (_loadRoomMessages) await _loadRoomMessages(roomId);

  renderRoomTabs();
  switchRoom(roomId);
}

/* ── Leave a room ── */
export function leaveRoom(roomId) {
  if (roomId === 'general') { showToast('ℹ️ Cannot leave the General room.'); return; }
  const room = state.rooms[roomId];
  if (!room) return;

  /* Unsubscribe channels */
  room.presenceCh?.unsubscribe();
  room.dbSub?.unsubscribe();
  delete state.rooms[roomId];

  renderRoomTabs();

  /* If we were on this room, switch to general */
  if (state.activeRoom === roomId) switchRoom('general');
  showToast(`👋 Left #${room.name}`);
}

/* ── Switch active room (no network activity, just UI) ── */
export function switchRoom(roomId) {
  if (!state.rooms[roomId]) return;
  state.activeRoom = roomId;
  /* Reset unread count when switching to this room */
  state.rooms[roomId].unreadCount = 0;
  renderRoomTabs();
  renderActiveRoomMessages();
  renderUsers();
  /* Update camera button to reflect whether cam is active in this room */
  _updateCamBtn();
}

function _updateCamBtn() {
  const btn   = document.getElementById('cameraBtnHeader');
  const label = document.getElementById('cameraBtnLabel');
  if (!btn || !label) return;
  const camHere = state.cameraRoom === state.activeRoom;
  label.textContent = camHere ? 'Camera On' : 'Camera Off';
  btn.classList.toggle('camera-on', camHere);
}

/* ── Render the tab bar ── */
export function renderRoomTabs() {
  const bar = dom.roomTabsBar;
  if (!bar) return;
  bar.innerHTML = '';

  Object.values(state.rooms).forEach(room => {
    const tab = document.createElement('button');
    tab.className = `room-tab${room.id === state.activeRoom ? ' active' : ''}`;
    tab.dataset.roomId = room.id;

    const label = document.createElement('span');
    label.className = 'room-tab-label';
    label.textContent = `${room.icon} ${room.name}`;
    tab.appendChild(label);

    /* Unread badge */
    if (room.unreadCount > 0 && room.id !== state.activeRoom) {
      const badge = document.createElement('span');
      badge.className = 'room-tab-badge';
      badge.textContent = room.unreadCount > 99 ? '99+' : String(room.unreadCount);
      tab.appendChild(badge);
    }

    if (room.id !== 'general') {
      const x = document.createElement('button');
      x.className = 'room-tab-close';
      x.title = `Leave #${room.name}`;
      x.textContent = '✕';
      x.addEventListener('click', e => { e.stopPropagation(); leaveRoom(room.id); });
      tab.appendChild(x);
    }

    tab.addEventListener('click', () => switchRoom(room.id));
    bar.appendChild(tab);
  });

  /* "+" room picker button */
  const addBtn = document.createElement('button');
  addBtn.className = 'room-add-btn';
  addBtn.title = 'Join another room';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', e => { e.stopPropagation(); toggleRoomPicker(); });
  bar.appendChild(addBtn);
}

/* ── Room picker popup ── */
let _pickerOpen = false;
export function toggleRoomPicker() {
  const panel = dom.roomPickerPanel;
  if (!panel) return;
  _pickerOpen = !_pickerOpen;
  panel.hidden = !_pickerOpen;
  if (_pickerOpen) renderRoomPicker();
}
export function closeRoomPicker() {
  _pickerOpen = false;
  if (dom.roomPickerPanel) dom.roomPickerPanel.hidden = true;
}

function renderRoomPicker() {
  const panel = dom.roomPickerPanel;
  if (!panel) return;
  panel.innerHTML = '<div class="room-picker-title">Join a room</div>';
  
  const rooms = getAvailableRooms();
  if (rooms.length === 0) {
    panel.innerHTML += '<div class="room-picker-item"><span>No rooms available</span></div>';
    return;
  }
  
  rooms.forEach(room => {
    const row = document.createElement('div');
    row.className = 'room-picker-item';
    const alreadyIn = !!state.rooms[room.id];
    row.innerHTML = `<span>${room.icon || '💬'} ${room.name}</span>`;
    if (alreadyIn) {
      const badge = document.createElement('span');
      badge.className = 'room-picker-joined'; badge.textContent = '✓ Joined';
      row.appendChild(badge);
    } else {
      const btn = document.createElement('button');
      btn.className = 'room-picker-join-btn'; btn.textContent = 'Join';
      btn.addEventListener('click', () => { closeRoomPicker(); joinRoom(room.id); });
      row.appendChild(btn);
    }
    panel.appendChild(row);
  });
}

/* ── Re-render messages for the active room ── */
export function renderActiveRoomMessages() {
  const msgsContainer = document.getElementById('msgsContainer');
  const room = state.rooms[state.activeRoom];
  if (!msgsContainer || !room) return;

  /* Clear and re-render from room.messages cache */
  msgsContainer.innerHTML = '';
  if (dom.welcomeBanner && room.messages.length === 0) {
    msgsContainer.appendChild(dom.welcomeBanner);
  } else {
    room.messages.forEach(msg => {
      /* renderMessage is imported lazily from chat.js via forward ref */
      if (_renderMessage) _renderMessage(msg);
    });
    msgsContainer.scrollTop = msgsContainer.scrollHeight;
  }
}

let _renderMessage = null;
export function setRenderMessage(fn) { _renderMessage = fn; }

/* ── Init: load rooms from DB and join default ── */
export async function initRooms() {
  await loadRoomsFromDB();
  await joinRoom(DEFAULT_ROOM_ID);
}

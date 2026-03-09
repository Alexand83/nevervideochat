/* ================================================================
   rooms.js  — multi-room tabs, join/leave, per-room presence+chat
================================================================ */
import { DEFAULT_ROOM_ID } from './config.js';
import { state }           from './state.js';
import { dom }             from './dom.js';
import { showToast, escHtml } from './utils.js';
import { syncPresence, updateOwnPresence, renderUsers, findUser } from './users.js';

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
function mkRoom(id, name = null, icon = '💬', maxCams = null) {
  return { id: String(id), name: name || String(id), icon, max_cams: maxCams, messages: [], presenceCh: null, dbSub: null, users: {}, unreadCount: 0 };
}

/* ── Join a room (subscribe presence + DB, load messages) ── */
export async function joinRoom(roomId) {
  console.log('[Rooms] 🚪 joinRoom called for room:', roomId);
  const roomIdStr = String(roomId);
  
  /* Reset games panel width CSS variable when joining a room */
  document.documentElement.style.setProperty('--games-panel-width', '0px');
  
  if (state.rooms[roomIdStr]) {
    switchRoom(roomIdStr);
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
  if (checkIsKicked(state.currentUser?.id, roomIdStr)) {
    showToast(`👢 You have been kicked from this room.`);
    return;
  }

  /* Load room info from DB if available */
  const roomInfo = availableRoomsCache.find(r => String(r.id) === roomIdStr);
  state.rooms[roomIdStr] = mkRoom(roomIdStr, roomInfo?.name, roomInfo?.icon, roomInfo?.max_cams);

  /* Presence channel for this room */
  const presenceCh = state.supa.channel(`presence:room-${roomIdStr}`, {
    config: { presence: { key: state.currentUser.id } },
  });

  presenceCh
    .on('presence', { event: 'sync' }, () => {
      const presenceState = presenceCh.presenceState();
      /* Annulla leave in sospeso per utenti ancora presenti (Supabase invia leave+join quando qualcuno fa track(), es. cam on/off) */
      Object.keys(presenceState).forEach(uid => {
        const timerKey = roomIdStr + ':' + uid;
        if (state.presenceLeaveTimers[timerKey]) {
          clearTimeout(state.presenceLeaveTimers[timerKey]);
          delete state.presenceLeaveTimers[timerKey];
        }
      });
      syncPresence(presenceState, roomIdStr);
      /* CRITICO: Renderizza utenti dopo il sync della presenza */
      if (roomIdStr === String(state.activeRoom)) {
        renderUsers();
      }
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      const uid = String(key);
      if (uid === String(state.currentUser.id)) return;
      /* Annulla leave in sospeso: era un falso leave da track() (es. cam on/off), non una vera uscita */
      const timerKey = roomIdStr + ':' + uid;
      if (state.presenceLeaveTimers[timerKey]) {
        clearTimeout(state.presenceLeaveTimers[timerKey]);
        delete state.presenceLeaveTimers[timerKey];
      }
      const info = newPresences[0];
      if (!state.rooms[roomIdStr]) return;
      
      /* CRITICO: Logica di preservazione hasCamera migliorata */
      /* Se hasCamera è già true nell'utente esistente, preservalo SEMPRE a meno che la presenza non dica esplicitamente false */
      const existingUser = state.rooms[roomIdStr].users[uid];
      const globalUser = findUser(uid);
      
      let hasCamera;
      if (info.hasCamera === true) {
        /* La presenza dice esplicitamente true - usa quello */
        hasCamera = true;
      } else if (info.hasCamera === false) {
        /* La presenza dice esplicitamente false - usa quello */
        hasCamera = false;
      } else {
        /* hasCamera è undefined o null nella presenza - preserva quello esistente */
        /* Controlla sia in room.users che in state.users per maggiore robustezza */
        if (existingUser?.hasCamera === true || globalUser?.hasCamera === true) {
          hasCamera = true;
        } else {
          hasCamera = false;
        }
      }
      
      state.rooms[roomIdStr].users[uid] = {
        id: uid, name: info.name, username: info.username || null,
        isGuest: info.isGuest, online: true,
        hasCamera: hasCamera, avatarUrl: info.avatarUrl || null,
      };
      if (roomIdStr === String(state.activeRoom)) {
        renderUsers();
        /* Toast solo per join veri: non se era già online (track/update), non se ha appena rientrato dopo breve disconnect */
        const wasAlreadyOnline = existingUser?.online;
        const leftKey = roomIdStr + ':' + uid;
        const leftAt = state.presenceLeftAt[leftKey];
        if (leftAt) delete state.presenceLeftAt[leftKey];
        const justRejoined = leftAt && (Date.now() - leftAt < 30000);
        if (!wasAlreadyOnline && !justRejoined) {
          showToast(`👤 ${info.name} joined #${state.rooms[roomIdStr].name}`);
        }
      }
    })
    .on('presence', { event: 'leave' }, async ({ key }) => {
      const uid = String(key);
      if (!state.rooms[roomIdStr]) return;
      if (uid === String(state.currentUser?.id)) return;
      /* Debounce: Supabase invia leave+join quando qualcuno fa track() (es. cam on/off). Aspettiamo 2s: se arriva sync/join con l'utente ancora presente, annulliamo. */
      const timerKey = roomIdStr + ':' + uid;
      if (state.presenceLeaveTimers[timerKey]) clearTimeout(state.presenceLeaveTimers[timerKey]);
      state.presenceLeaveTimers[timerKey] = setTimeout(async () => {
        delete state.presenceLeaveTimers[timerKey];
        if (!state.rooms[roomIdStr]) return;
        /* Double-check: se è ancora in presenceState() non rimuovere (falso leave, es. cam off / tab switch) */
        const currentPresence = presenceCh.presenceState();
        if (Object.prototype.hasOwnProperty.call(currentPresence, uid)) return;
        delete state.rooms[roomIdStr].users[uid];
        state.presenceLeftAt[roomIdStr + ':' + uid] = Date.now();
        if (state.cameraWindows[uid]) {
          const { closeCameraWindow } = await import('./camera.js?v=20260308');
          await closeCameraWindow(uid);
        }
        if (roomIdStr === String(state.activeRoom)) renderUsers();
      }, 2000);
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await updateOwnPresence(presenceCh);
        /* Dopo aver aggiornato la presenza, forza un re-sync per assicurarsi che tutti vedano lo stato corretto */
        setTimeout(() => {
          syncPresence(presenceCh.presenceState(), roomIdStr);
          /* CRITICO: Renderizza utenti dopo il sync della presenza */
          if (roomIdStr === String(state.activeRoom)) {
            renderUsers();
          }
        }, 200);
      }
    });

  state.rooms[roomIdStr].presenceCh = presenceCh;

  /* Load messages & subscribe to DB changes */
  if (_loadRoomMessages) await _loadRoomMessages(roomIdStr);

  renderRoomTabs();
  switchRoom(roomIdStr);
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

/* ── Timer to auto-close camera if user stays away from Events room > 1 min ── */
let _eventsRoomCamOffTimer = null;

/* ── Switch active room (no network activity, just UI) ── */
export function switchRoom(roomId) {
  const roomIdStr = String(roomId);
  if (!state.rooms[roomIdStr]) return;
  
  /* Reset games panel width CSS variable immediately when switching rooms */
  document.documentElement.style.setProperty('--games-panel-width', '0px');

  /* Track previous room to detect Events room transitions */
  const previousRoomId = String(state.activeRoom);
  const previousRoomData = availableRoomsCache.find(r => String(r.id) === previousRoomId);
  const wasEventsRoom = !!(previousRoomData?.max_cams && previousRoomData.max_cams >= 1 && previousRoomData.max_cams <= 8);

  state.activeRoom = roomIdStr;
  /* Reset unread count when switching to this room */
  if (state.rooms[roomId]) state.rooms[roomId].unreadCount = 0;
  
  /* Check if room has max_cams (Events room) */
  const roomData = availableRoomsCache.find(r => String(r.id) === roomIdStr);
  const maxCams = roomData?.max_cams;
  const isEventsRoom = !!(maxCams && maxCams >= 1 && maxCams <= 8);
  const isGamesRoom = roomData?.is_games_room === true;
  
  /* Show/hide games panel */
  if (dom.gamesPanel) {
    const isMobile = window.innerWidth <= 768;
    if (isGamesRoom) {
      /* Su mobile: nascondi gamesPanel, usa usersPanel per il gioco */
      if (isMobile) {
        dom.gamesPanel.hidden = true;
        dom.gamesPanel.classList.remove('open');
        document.documentElement.style.setProperty('--games-panel-width', '0px');
        /* Su mobile: mostra usersPanel (conterrà il gioco se attivo) */
        if (dom.usersPanel) {
          dom.usersPanel.classList.remove('hidden');
          /* Non aprire automaticamente su mobile, l'utente apre con il bottone floating */
          dom.usersPanel.classList.remove('open');
          if (dom.panelOverlay) dom.panelOverlay.classList.remove('show');
        }
      } else {
        /* Desktop: mostra gamesPanel, nascondi usersPanel */
        dom.gamesPanel.hidden = false;
        dom.gamesPanel.classList.add('open');
        if (dom.usersPanel) {
          dom.usersPanel.classList.add('hidden');
          dom.usersPanel.classList.remove('open');
          if (dom.panelOverlay) dom.panelOverlay.classList.remove('show');
        }
        /* Aggiorna CSS variable per il padding della chat */
        setTimeout(() => {
          const panelWidth = dom.gamesPanel.offsetWidth || 320;
          document.documentElement.style.setProperty('--games-panel-width', panelWidth + 'px');
        }, 100);
      }
      /* Re-check active game when entering games room */
      import('./games.js').then(async ({ checkActiveGame, updateGamesPanel }) => {
        await checkActiveGame();
        /* Forza aggiornamento UI dopo il check */
        setTimeout(() => {
          updateGamesPanel();
        }, 150);
      });
    } else {
      dom.gamesPanel.hidden = true;
      dom.gamesPanel.classList.remove('open');
      document.documentElement.style.setProperty('--games-panel-width', '0px');
      /* Ripristina usersPanel nelle altre stanze */
      if (dom.usersPanel) {
        /* Su desktop: il pannello è visibile come flex-child senza bisogno di classe 'open'
           Su mobile: NON aggiungere 'open' — il drawer deve restare chiuso di default */
        dom.usersPanel.classList.remove('hidden');
        dom.usersPanel.classList.remove('open'); /* Mobile: pannello chiuso (off-screen) */
        if (dom.panelOverlay) dom.panelOverlay.classList.remove('show');
        /* Rimuovi TUTTI gli stili inline residui dalla stanza giochi */
        dom.usersPanel.style.cssText = '';
        /* Rimuovi anche singoli stili che potrebbero essere stati impostati */
        dom.usersPanel.style.position = '';
        dom.usersPanel.style.top = '';
        dom.usersPanel.style.bottom = '';
        dom.usersPanel.style.right = '';
        dom.usersPanel.style.zIndex = '';
        dom.usersPanel.style.width = '';
        dom.usersPanel.style.height = '';
        dom.usersPanel.style.flex = '';
        dom.usersPanel.style.minWidth = '';
        dom.usersPanel.style.maxWidth = '';
        dom.usersPanel.style.overflowX = '';
        
        /* Reset chat section styles */
        const chatSection = document.querySelector('.chat-section');
        if (chatSection) {
          chatSection.style.cssText = '';
          chatSection.style.flex = '';
          chatSection.style.minWidth = '';
          chatSection.style.width = '';
          chatSection.style.maxWidth = '';
          chatSection.style.marginRight = '';
        }
        
        /* Reset app-main styles (potrebbe avere overflow-x o altri stili) */
        const appMain = document.querySelector('.app-main');
        if (appMain) {
          appMain.style.cssText = '';
          appMain.style.overflowX = '';
          appMain.style.flex = '';
        }
        
        /* Reset CSS variables */
        document.documentElement.style.setProperty('--users-panel-width', '0px');
      }
    }
  }
  
  if (isEventsRoom) {
    /* ENTERING Events room — cancel any pending camera-off timer */
    if (_eventsRoomCamOffTimer) {
      clearTimeout(_eventsRoomCamOffTimer);
      _eventsRoomCamOffTimer = null;
    }
    /* Show events cam grid: clear e re-render SOLO se si arriva da un'altra stanza (altrimenti si perdono le cam remote) */
    if (dom.eventsCamGrid) {
      dom.eventsCamGrid.hidden = false;
      dom.eventsCamGrid.setAttribute('data-max-cams', String(maxCams));
      if (previousRoomId !== roomIdStr) {
        renderEventsCamGrid(maxCams);
      } else {
        updateEventsCamGrid();
      }
    }
    /* Re-insert own camera into Events grid if it was active in this room */
    if (state.localStream && String(state.cameraRoom) === roomIdStr) {
      import('./camera.js?v=20260308').then(async ({ insertCameraIntoEventsGrid }) => {
        if (state.activeRoom === roomIdStr) {
          const ownCamWin = state.cameraWindows[state.currentUser.id];
          /* CRITICO: Se la cam esiste già, ri-inserirla nella grid invece di ricrearla */
          if (ownCamWin && ownCamWin.isEventsGrid) {
            /* La cam esiste già - ri-inserirla nella grid se non è già presente */
            const existingSlot = dom.eventsCamGrid?.querySelector(`[data-user-id="${state.currentUser.id}"]`);
            if (!existingSlot) {
              console.log('[Events Room] Re-inserting own camera into grid');
              insertCameraIntoEventsGrid(state.currentUser.id, state.localStream, 'You', true);
            } else {
              /* Slot già presente - assicurati che il video stia riproducendo */
              const video = existingSlot.querySelector('video');
              if (video && video.paused) {
                video.play().catch(() => {});
              }
            }
          } else if (!ownCamWin) {
            /* La cam non esiste - crearla */
            const { createCameraWindow } = await import('./camera.js?v=20260308');
            createCameraWindow(state.currentUser.id, state.localStream, 'You', true);
          }
        }
      });
    }
  } else {
    /* LEAVING Events room (or switching between non-Events rooms) */
    if (wasEventsRoom && state.localStream && String(state.cameraRoom) === previousRoomId) {
      /* Start 1-minute timer: if user doesn't return, close their camera */
      if (_eventsRoomCamOffTimer) clearTimeout(_eventsRoomCamOffTimer);
      _eventsRoomCamOffTimer = setTimeout(async () => {
        _eventsRoomCamOffTimer = null;
        /* Only close if still away from the Events room and camera is still for that room */
        if (state.activeRoom !== previousRoomId && state.cameraRoom === previousRoomId) {
          console.log('[Events Room] User away > 1 min — closing camera');
          const { closeCameraWindow } = await import('./camera.js?v=20260308');
          closeCameraWindow(state.currentUser.id);
        }
      }, 60000);
    }
    /* Chiudi SOLO le PC e finestre della grid Eventi. Le cam in General (floating) restano aperte per quando torni in General. */
    if (wasEventsRoom) {
      for (const uid of Object.keys(state.incomingPCs)) {
        const cw = state.cameraWindows[uid];
        if (!cw?.isEventsGrid) continue; /* non chiudere la PC di cam in altra stanza (es. General) */
        try { state.incomingPCs[uid].close(); } catch {}
        delete state.incomingPCs[uid];
      }
      /* Pending cam requests: pulisci solo per utenti che avevano cam in Eventi (opzionale: pulisci tutto per semplicità) */
      for (const uid of Object.keys(state.pendingCamRequests || {})) {
        delete state.pendingCamRequests[uid];
      }
      /* Rimuovi solo le finestre della grid Eventi; tieni le floating (cam in General). */
      for (const uid of Object.keys(state.cameraWindows)) {
        if (String(uid) === String(state.currentUser?.id)) continue;
        const cw = state.cameraWindows[uid];
        if (cw?.isEventsGrid) delete state.cameraWindows[uid];
      }
      console.log('[Events Room] Left Events room — closed only grid PCs and cleaned up grid windows');
    }
    /* Hide events cam grid */
    if (dom.eventsCamGrid) {
      dom.eventsCamGrid.hidden = true;
      clearEventsCamGrid();
    }
  }

  /* Own camera: mostra la finestra floating solo nella stanza dove la cam è attiva (non in Eventi se aperta in General e viceversa) */
  const ownWin = state.cameraWindows[state.currentUser?.id];
  if (ownWin && !ownWin.isEventsGrid && ownWin.el) {
    const camInThisRoom = String(state.cameraRoom) === String(state.activeRoom);
    ownWin.el.style.display = camInThisRoom ? '' : 'none';
  }

  /* Remote cameras: mostra solo quelle che hanno la cam in QUESTA stanza (non la cam di General in Eventi e viceversa) */
  const activeRoomUsers = state.rooms[state.activeRoom]?.users || {};
  for (const uid of Object.keys(state.cameraWindows)) {
    if (String(uid) === String(state.currentUser?.id)) continue;
    const cw = state.cameraWindows[uid];
    if (!cw?.el) continue;
    const hasCamInThisRoom = !!activeRoomUsers[uid]?.hasCamera;
    if (cw.isEventsGrid) {
      /* Slot nella grid Eventi: visibile solo se siamo in Eventi e l'utente ha cam qui (la grid stessa è già hidden se non Eventi) */
      cw.el.style.display = hasCamInThisRoom ? '' : 'none';
    } else {
      /* Finestra floating: nascondi se la cam è in un'altra stanza */
      cw.el.style.display = hasCamInThisRoom ? '' : 'none';
    }
  }

  renderRoomTabs();
  renderActiveRoomMessages();
  renderUsers();
  /* Update camera button to reflect whether cam is active in this room */
  _updateCamBtn();
  
  /* Events room: automatically request cameras from users who already have them open */
  if (isEventsRoom) {
    const room = state.rooms[roomIdStr];
    if (room) {
      /* Request cameras after a short delay to let WebRTC connections settle.
         CRITICAL: always check state.activeRoom === roomIdStr before acting — the
         user may have already switched away before the timeout fires. */
      setTimeout(async () => {
        /* Guard: abort if user has left this room */
        if (state.activeRoom !== roomIdStr) return;

        const { requestPublicCamera } = await import('./camera.js?v=20260308');
        const allUsers = Object.values(room.users);
        const usersWithCam = allUsers.filter(user =>
          user.hasCamera && user.online && String(user.id) !== String(state.currentUser?.id)
        );
        console.log('[Events Room] Requesting cameras from', usersWithCam.length, 'users:', usersWithCam.map(u => u.name || u.id));

        usersWithCam.forEach((user, index) => {
          /* CRITICO: Rimuovi manuallyClosedCameras per questo utente se ha ancora la cam attiva */
          /* Questo permette di richiedere di nuovo la cam quando si ritorna in Events room */
          if (state.manuallyClosedCameras[user.id] && user.hasCamera) {
            console.log('[Events Room] Clearing manuallyClosedCameras for', user.name || user.id, '- camera is active again');
            delete state.manuallyClosedCameras[user.id];
          }
          
          const alreadyViewing  = !!state.cameraWindows[user.id];
          const pcActive        = !!state.incomingPCs?.[user.id];
          const reqPending      = !!state.pendingCamRequests?.[user.id];
          if (!alreadyViewing && !pcActive && !reqPending) {
            setTimeout(() => {
              /* Guard: abort if user has left before the staggered delay fires */
              if (state.activeRoom !== roomIdStr) return;
              console.log('[Events Room] Requesting camera from', user.name || user.id);
              requestPublicCamera(user.id);
            }, index * 200);
          } else {
            console.log('[Events Room] Already viewing/connecting camera from', user.name || user.id);
          }
        });
      }, 1000);
    }
  }
}

function _updateCamBtn() {
  const btn   = document.getElementById('cameraBtnHeader');
  const label = document.getElementById('cameraBtnLabel');
  if (!btn || !label) return;
  const camHere = String(state.cameraRoom) === String(state.activeRoom);
  label.textContent = camHere ? 'Camera On' : 'Camera Off';
  btn.classList.toggle('camera-on', camHere);
}

/* ── Render the tab bar ── */
export function renderRoomTabs() {
  const bar = dom.roomTabsBar;
  if (!bar) return;
  bar.innerHTML = '';

  Object.values(state.rooms).forEach(room => {
    const roomIdStr = String(room.id);
    const tab = document.createElement('button');
    tab.className = `room-tab${roomIdStr === String(state.activeRoom) ? ' active' : ''}`;
    tab.dataset.roomId = roomIdStr;

    const label = document.createElement('span');
    label.className = 'room-tab-label';
    label.textContent = `${room.icon} ${room.name}`;
    tab.appendChild(label);

    /* Unread badge */
    if (room.unreadCount > 0 && roomIdStr !== String(state.activeRoom)) {
      const badge = document.createElement('span');
      badge.className = 'room-tab-badge';
      badge.textContent = room.unreadCount > 99 ? '99+' : String(room.unreadCount);
      tab.appendChild(badge);
    }

    // Allow leaving all rooms except General (by name, not ID)
    if (room.name !== 'General') {
      const x = document.createElement('button');
      x.className = 'room-tab-close';
      x.title = `Leave #${room.name}`;
      x.textContent = '✕';
      x.addEventListener('click', e => { e.stopPropagation(); leaveRoom(roomIdStr); });
      tab.appendChild(x);
    }

    tab.addEventListener('click', () => switchRoom(roomIdStr));
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
    const roomIdStr = String(room.id);
    const alreadyIn = !!state.rooms[roomIdStr];
    row.innerHTML = `<span>${escHtml(room.icon || '💬')} ${escHtml(room.name)}</span>`;
    if (alreadyIn) {
      const badge = document.createElement('span');
      badge.className = 'room-picker-joined'; badge.textContent = '✓ Joined';
      row.appendChild(badge);
    } else {
      const btn = document.createElement('button');
      btn.className = 'room-picker-join-btn'; btn.textContent = 'Join';
      btn.addEventListener('click', () => { closeRoomPicker(); joinRoom(roomIdStr); });
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
  console.log('[Rooms] 🏠 initRooms called');
  await loadRoomsFromDB();
  // Cerca la stanza "General" per ID o nome
  const generalRoom = availableRoomsCache.find(r => r.name === 'General' || String(r.id) === '1');
  if (generalRoom) {
    console.log('[Rooms] Joining general room:', generalRoom.id);
    await joinRoom(String(generalRoom.id));
    console.log('[Rooms] ✅ Joined general room');
  } else {
    // Fallback: prova a unire la prima stanza disponibile
    if (availableRoomsCache.length > 0) {
      await joinRoom(String(availableRoomsCache[0].id));
    }
  }
}

/* ── Events Room Camera Grid ── */
function renderEventsCamGrid(maxCams) {
  if (!dom.eventsCamGrid) return;
  
  /* Don't create empty slots - they will be created dynamically */
  dom.eventsCamGrid.innerHTML = '';
  
  /* Set max_cams attribute for CSS to calculate width automatically */
  dom.eventsCamGrid.setAttribute('data-max-cams', String(maxCams));
  
  /* Populate with active cameras in this room */
  updateEventsCamGrid();
}

function clearEventsCamGrid() {
  if (!dom.eventsCamGrid) return;
  
  /* Close all REMOTE camera windows in the events grid and their peer connections.
     This is critical so that when re-entering the Events room, cameras are re-requested.
     We do NOT close own camera here (that persists across room switches). */
  Object.keys(state.cameraWindows).forEach(uid => {
    const cw = state.cameraWindows[uid];
    if (cw?.isEventsGrid && String(uid) !== String(state.currentUser?.id)) {
      /* Close the incoming peer connection */
      if (state.incomingPCs[uid]) {
        try { state.incomingPCs[uid].close(); } catch {}
        delete state.incomingPCs[uid];
      }
      delete state.cameraWindows[uid];
    }
  });
  
  dom.eventsCamGrid.innerHTML = '';
}

export function updateEventsCamGrid() {
  if (!dom.eventsCamGrid) return;
  
  const roomData = availableRoomsCache.find(r => String(r.id) === String(state.activeRoom));
  const maxCams = roomData?.max_cams;
  if (!maxCams) {
    dom.eventsCamGrid.hidden = true;
    return;
  }
  
  /* Count only slots that have an actual video (real cameras) */
  const slots = Array.from(dom.eventsCamGrid.querySelectorAll('.events-cam-slot'));
  const numCams = slots.filter(s => s.querySelector('video')).length;
  
  /* Show grid only when there are active cameras */
  if (numCams === 0) {
    dom.eventsCamGrid.hidden = true;
    return;
  }
  
  dom.eventsCamGrid.hidden = false;
  
  /* Set max_cams attribute for CSS to calculate width automatically */
  /* The CSS will use data-max-cams to determine the width of each camera slot */
  dom.eventsCamGrid.setAttribute('data-max-cams', String(maxCams));
}

/* Called when a remote cam is closed - removes their slot from grid */
export function removeCameraFromEventsGrid(uid) {
  if (!dom.eventsCamGrid) return;
  const slot = dom.eventsCamGrid.querySelector(`[data-user-id="${uid}"]`);
  if (slot) {
    slot.remove();
    updateEventsCamGrid(); /* Recalculate columns after removal */
  }
}

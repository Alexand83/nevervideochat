/* ================================================================
   camera.js  — camera windows, WebRTC, public cam share, private call
================================================================ */
/* VERSION MARKER — if you see this in logs, new code is running */
console.log('%c[NVC] camera.js v20260426 loaded', 'color:#0f0;background:#000;font-weight:bold;padding:2px 6px;border-radius:3px');

import { ICE_SERVERS }   from './config.js';
import { state }         from './state.js';
import { dom }           from './dom.js';
import { $, avatarColor, initials, escHtml, showToast, makeDraggable, makeResizable } from './utils.js';
import { broadcast, broadcastAll } from './broadcast.js';
import { findUser, ensureUser, renderUsers, updateOwnPresence, updateAllRoomPresences } from './users.js';
import { addRejectedCam, clearPendingCamRequest, setPendingCamRequest, getMediaConstraints } from './storage.js';
import { getAvailableRooms } from './rooms.js';

const CAM_STEP = 30;
function camCount() { return Object.keys(state.cameraWindows).length; }

/* ── Camera window ─────────────────────────────────────────────── */
export function createCameraWindow(uid, stream, name, isOwn) {
  /* Check if active room has max_cams (Events room) */
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const maxCams = roomData?.max_cams;
  const isEventsRoom = maxCams && maxCams >= 1 && maxCams <= 8;
  
  if (isEventsRoom) {
    /* Insert into events cam grid instead of floating window */
    insertCameraIntoEventsGrid(uid, stream, name, isOwn);
    return;
  }
  
  /* Normal floating window */
  if (state.cameraWindows[uid]) {
    state.cameraWindows[uid].el.style.zIndex = String(700 + camCount()); return;
  }
  const color = avatarColor(name), init = initials(name), n = camCount();
  const win   = document.createElement('div');
  win.className = 'cam-window'; win.id = `cam-win-${uid}`;
  win.setAttribute('role', 'dialog'); win.setAttribute('aria-label', `${name} camera`);
  win.style.right  = (20 + n * CAM_STEP) + 'px';
  win.style.bottom = (80 + n * CAM_STEP) + 'px';
  win.style.zIndex = String(650 + n);

  const viewersBtnHtml = isOwn
    ? `<button class="cam-viewers-btn" id="cam-viewers-btn-${uid}" title="Who is watching">👁 <span id="cam-viewers-count-${uid}">0</span></button>
       <div class="cam-viewers-panel" id="cam-viewers-panel-${uid}" hidden></div>` : '';

  const footer = isOwn ? `
    <div class="cam-win-footer">
      <button class="cam-ctrl-btn" id="cam-mic-btn-${uid}" aria-label="Toggle microphone" aria-pressed="true">
        <svg id="cam-mic-on-${uid}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
        </svg>
        <svg id="cam-mic-off-${uid}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
          <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/>
        </svg>
        <span id="cam-mic-lbl-${uid}">Mic On</span>
      </button>
      <div class="mic-meter-section">
        <div class="mic-meter-bar-wrap"><div class="mic-meter-bar"><div class="mic-meter-fill" id="mic-fill-${uid}"></div></div></div>
        <span class="mic-meter-lbl">Mic Level</span>
      </div>
    </div>` : `
    <div class="cam-win-footer cam-win-footer-remote">
      <span class="cam-win-live-badge">🔴 Live</span>
    </div>`;

  win.innerHTML = `
    <div class="cam-win-hdr" id="cam-win-hdr-${uid}">
      <div class="cam-win-user-info">
        <span class="cam-win-avatar" style="background:${color}">${escHtml(init)}</span>
        <span class="cam-win-name">${escHtml(name)}</span>
        ${isOwn ? '<span class="cam-win-you-tag">You</span>' : ''}
      </div>
      ${viewersBtnHtml}
      <button class="cam-win-close-btn" aria-label="Close camera window">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="cam-win-video-wrap">
      <video id="cam-vid-${uid}" autoplay ${isOwn ? 'muted' : ''} playsinline
             style="${isOwn ? 'transform:scaleX(-1)' : ''}"></video>
    </div>
    ${footer}
    <div class="cam-resize-handle" id="cam-rz-${uid}" aria-hidden="true"></div>`;

  document.body.appendChild(win);
  state.cameraWindows[uid] = { el: win, stream, isOwn, micEnabled: true };

  const videoEl = $(`cam-vid-${uid}`);
  if (videoEl) {
    videoEl.srcObject = null; videoEl.srcObject = stream;
    videoEl.play().catch(() => {});
  }
  win.querySelector('.cam-win-close-btn').addEventListener('click', () => closeCameraWindow(uid));

  if (isOwn) {
    const mb = $(`cam-mic-btn-${uid}`);
    if (mb) mb.addEventListener('click', () => toggleCamMic(uid));
    startMicMeter(stream, uid);
    const vBtn   = $(`cam-viewers-btn-${uid}`);
    const vPanel = $(`cam-viewers-panel-${uid}`);
    if (vBtn && vPanel) {
      vBtn.addEventListener('click', e => {
        e.stopPropagation(); vPanel.hidden = !vPanel.hidden;
        if (!vPanel.hidden) refreshViewersPanel(uid);
      });
      document.addEventListener('click', () => { if (vPanel) vPanel.hidden = true; });
    }
  }
  makeDraggable(win, $(`cam-win-hdr-${uid}`));
  makeResizable(win, $(`cam-rz-${uid}`));
}

export function refreshViewersPanel(ownUid) {
  const panel   = $(`cam-viewers-panel-${ownUid}`);
  const countEl = $(`cam-viewers-count-${ownUid}`);
  const entries = Object.entries(state.camViewers);
  if (countEl) countEl.textContent = String(entries.length);
  if (!panel) return;
  panel.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'cam-viewers-title'; title.textContent = 'Viewers';
  panel.appendChild(title);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cam-viewers-empty'; empty.textContent = 'No one watching yet.';
    panel.appendChild(empty); return;
  }
  entries.forEach(([vUid, vName]) => {
    const row = document.createElement('div'); row.className = 'cam-viewer-item';
    const nameEl  = document.createElement('span'); nameEl.className = 'cam-viewer-name'; nameEl.textContent = vName;
    const kickBtn = document.createElement('button'); kickBtn.className = 'cam-viewer-kick';
    kickBtn.textContent = '✕'; kickBtn.title = `Stop sharing with ${vName}`;
    kickBtn.addEventListener('click', e => {
      e.stopPropagation(); revokeViewer(vUid); refreshViewersPanel(ownUid);
      showToast(`🚫 Stopped sharing cam with ${vName}.`);
    });
    row.append(nameEl, kickBtn); panel.appendChild(row);
  });
}

export function revokeViewer(viewerUid) {
  const uid  = String(viewerUid);
  const name = state.camViewers[uid] || findUser(uid)?.name || 'User';
  if (state.outgoingPCs[uid]) {
    try { state.outgoingPCs[uid].close(); } catch {}
    delete state.outgoingPCs[uid];
  }
  delete state.camViewers[uid];
  broadcast('cam-revoked', uid, {});
  addRejectedCam(uid, name);  /* kick = block future requests */
}

/* ── Close own camera (called when muted) ── */
export async function closeOwnCamera() {
  if (!state.localStream) return;
  await closeCameraWindow(state.currentUser?.id);
}

/* ── Close all cameras for a user (their own + cameras they are watching) ── */
export async function closeAllCamerasForUser(userId) {
  const isCurrentUser = String(userId) === String(state.currentUser?.id);
  
  if (isCurrentUser) {
    /* Close user's own camera if active */
    if (state.localStream) {
      await closeOwnCamera();
    }
    
    /* Close all cameras the user is watching (all camera windows except their own) */
    const cameraWindowIds = Object.keys(state.cameraWindows);
    for (const uid of cameraWindowIds) {
      if (String(uid) !== String(state.currentUser?.id)) {
        await closeCameraWindow(uid);
      }
    }
  } else {
    /* Close the user's camera if we are watching it */
    if (state.cameraWindows[userId]) {
      await closeCameraWindow(userId);
    }
  }
}

export async function closeCameraWindow(uid) {
  /* Check if this camera is in events grid */
  const camWin = state.cameraWindows[uid];
  if (camWin?.isEventsGrid) {
    /* Remove slot from events grid entirely */
    const slot = camWin.el;
    if (slot && slot.parentNode) slot.remove();
    delete state.cameraWindows[uid];
    /* Recalculate columns */
    const { updateEventsCamGrid } = await import('./rooms.js');
    updateEventsCamGrid();
    
    /* If this is own camera, also stop stream */
    const isOwn = uid === state.currentUser?.id || uid === 'me';
    if (isOwn) {
      const closedRoom = state.cameraRoom;
      state.localStream?.getTracks().forEach(t => t.stop());
      state.localStream = null;
      state.cameraClosedAt = Date.now();
      state.cameraRoom = null;
      Object.keys(state.outgoingPCs).forEach(peerId => {
        state.outgoingPCs[peerId]?.close(); delete state.outgoingPCs[peerId];
      });
      state.currentUser.hasCamera = false;
      dom.cameraBtnLabel.textContent = 'Camera Off'; dom.cameraBtnHeader.classList.remove('camera-on');
      broadcastAll('cam-closed', { room_id: closedRoom });
      await updateAllRoomPresences(); renderUsers(); showToast('📹 Camera disabled.');
    }
    return;
  }
  
  /* Normal floating window close */
  const cw = state.cameraWindows[uid]; if (!cw) return;
  stopMicMeter(uid); cw.el.remove(); delete state.cameraWindows[uid];
  const isOwn = uid === state.currentUser?.id || uid === 'me';
  if (isOwn) {
    const closedRoom = state.cameraRoom;
    state.localStream?.getTracks().forEach(t => t.stop());
    state.localStream = null;
    state.cameraClosedAt = Date.now();
    state.cameraRoom = null;
    Object.keys(state.outgoingPCs).forEach(peerId => {
      state.outgoingPCs[peerId]?.close(); delete state.outgoingPCs[peerId];
    });
    state.currentUser.hasCamera = false;
    dom.cameraBtnLabel.textContent = 'Camera Off'; dom.cameraBtnHeader.classList.remove('camera-on');
    broadcastAll('cam-closed', { room_id: closedRoom });
    await updateAllRoomPresences(); renderUsers(); showToast('📹 Camera disabled.');
  } else {
    if (state.incomingPCs[uid]) { state.incomingPCs[uid].close(); delete state.incomingPCs[uid]; }
  }
}

export async function handleCamClosed(payload) {
  if (payload.from === state.currentUser?.id) return;
  const uid      = String(payload.from);
  
  /* Check if camera is in events grid */
  /* Normal floating window close */
  const inMyRoom = !payload.room_id || payload.room_id === state.activeRoom;

  /* Close the local window if it's open */
  const cw = state.cameraWindows[uid];
  if (cw) {
    if (cw.isEventsGrid) {
      /* Remove slot from events grid entirely */
      const slot = cw.el;
      if (slot && slot.parentNode) slot.remove();
      delete state.cameraWindows[uid];
      /* Recalculate columns */
      const { updateEventsCamGrid } = await import('./rooms.js');
      updateEventsCamGrid();
    } else {
      /* Normal floating window */
      stopMicMeter(uid);
      cw.el.remove();
    }
    delete state.cameraWindows[uid];
  }
  if (state.incomingPCs[uid]) { state.incomingPCs[uid].close(); delete state.incomingPCs[uid]; }

  /* Clear hasCamera in ALL joined rooms for this user */
  for (const room of Object.values(state.rooms)) {
    if (room.users[uid]) room.users[uid].hasCamera = false;
  }
  const u = state.users.find(u => u.id === uid);
  if (u) u.hasCamera = false;

  renderUsers();
  if (inMyRoom) showToast(`📹 ${payload.fromName} turned off their camera`);
}

function toggleCamMic(uid) {
  const cw = state.cameraWindows[uid]; if (!cw) return;
  cw.micEnabled = !cw.micEnabled;
  state.localStream?.getAudioTracks().forEach(t => { t.enabled = cw.micEnabled; });
  const mb = $(`cam-mic-btn-${uid}`), on = $(`cam-mic-on-${uid}`), off = $(`cam-mic-off-${uid}`), lbl = $(`cam-mic-lbl-${uid}`);
  if (mb) { mb.setAttribute('aria-pressed', String(cw.micEnabled)); mb.classList.toggle('mic-muted', !cw.micEnabled); }
  if (on)  on.style.display  = cw.micEnabled ? '' : 'none';
  if (off) off.style.display = cw.micEnabled ? 'none' : '';
  if (lbl) lbl.textContent   = cw.micEnabled ? 'Mic On' : 'Mic Muted';
}

export async function toggleOwnCamera() {
  if (state.localStream) {
    /* Check if camera is in Events grid */
    const camWin = state.cameraWindows[state.currentUser.id];
    if (camWin?.isEventsGrid) {
      /* Close Events grid camera */
      await closeCameraWindow(state.currentUser.id);
    } else if (camWin) {
      /* Close normal floating window */
      await closeCameraWindow(state.currentUser.id);
    } else {
      /* Camera window doesn't exist but stream is active - force close */
      state.localStream?.getTracks().forEach(t => t.stop());
      state.localStream = null;
      state.cameraClosedAt = Date.now();
      state.cameraRoom = null;
      Object.keys(state.outgoingPCs).forEach(peerId => {
        state.outgoingPCs[peerId]?.close(); delete state.outgoingPCs[peerId];
      });
      state.currentUser.hasCamera = false;
      dom.cameraBtnLabel.textContent = 'Camera Off';
      dom.cameraBtnHeader.classList.remove('camera-on');
      broadcastAll('cam-closed', { room_id: state.cameraRoom });
      const { updateAllRoomPresences } = await import('./users.js');
      await updateAllRoomPresences();
      renderUsers();
      showToast('📹 Camera disabled.');
    }
  } else {
    await startOwnCamera();
  }
}

export async function startOwnCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { showToast('⚠️ Camera not supported.'); return; }
  try {
    const msSince = Date.now() - state.cameraClosedAt;
    if (msSince < 450) await new Promise(r => setTimeout(r, 450 - msSince));
    state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
    state.currentUser.hasCamera = true;
    state.cameraRoom = state.activeRoom;    /* camera is active in THIS room */
    dom.cameraBtnLabel.textContent = 'Camera On'; dom.cameraBtnHeader.classList.add('camera-on');
    /* Check if Events room before creating camera window */
    const availableRooms = getAvailableRooms();
    const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
    const isEventsRoom = roomData?.max_cams && roomData.max_cams >= 1 && roomData.max_cams <= 8;
    
    /* Make sure Events grid is visible if it's an Events room */
    if (isEventsRoom && dom.eventsCamGrid) {
      dom.eventsCamGrid.hidden = false;
    }
    
    createCameraWindow(state.currentUser.id, state.localStream, 'You', true);
    
    /* Verify camera was created successfully */
    if (!state.cameraWindows[state.currentUser.id]) {
      /* Camera creation failed - reset state */
      state.localStream?.getTracks().forEach(t => t.stop());
      state.localStream = null;
      state.currentUser.hasCamera = false;
      state.cameraRoom = null;
      dom.cameraBtnLabel.textContent = 'Camera Off';
      dom.cameraBtnHeader.classList.remove('camera-on');
      showToast('⚠️ Failed to create camera window.');
      return;
    }
    
    broadcastAll('cam-opened', { room_id: state.cameraRoom });
    await updateAllRoomPresences(); 
    renderUsers();
    
    if (isEventsRoom) {
      /* Automatically share with all users in Events room */
      const room = state.rooms[state.activeRoom];
      console.log('[Events Room] Camera opened, auto-sharing with users in room:', room ? Object.values(room.users).map(u => ({ id: u.id, name: u.name, online: u.online })) : 'no room');
      if (room) {
        const usersToShare = Object.values(room.users).filter(user => 
          user.online && String(user.id) !== String(state.currentUser?.id)
        );
        console.log('[Events Room] Auto-sharing camera with', usersToShare.length, 'users:', usersToShare.map(u => u.name || u.id));
        usersToShare.forEach((user, index) => {
          /* Small delay to ensure stream is ready, stagger requests */
          setTimeout(() => {
            console.log('[Events Room] Sharing camera with', user.name || user.id);
            sharePublicCameraTo(user.id);
          }, 300 + (index * 200)); /* 300ms base + 200ms per user */
        });
      }
    }
    
    /* Grid column layout is updated inside insertCameraIntoEventsGrid */
    
    showToast('📹 Camera enabled.');
  } catch (err) {
    state.localStream = null;
    showToast(err.name === 'NotAllowedError' ? '🚫 Camera/mic access denied.' : `⚠️ Camera error: ${err.message}`);
  }
}

function startMicMeter(stream, uid) {
  stopMicMeter(uid);
  const audioTrack = stream.getAudioTracks()[0]; if (!audioTrack) return;
  try {
    const analysisStream = new MediaStream([audioTrack]);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(analysisStream);
    const an  = ctx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.75;
    src.connect(an);
    const data = new Uint8Array(an.frequencyBinCount);
    function tick() {
      an.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const pct  = Math.min(100, Math.round((avg / 70) * 100));
      const fill = $(`mic-fill-${uid}`);
      if (fill) {
        fill.style.width = ((state.cameraWindows[uid]?.micEnabled !== false) ? pct : 0) + '%';
        fill.style.backgroundPosition = Math.max(0, (pct - 50) * 2) + '% 0';
      }
      if (state.micAnalysers[uid]) state.micAnalysers[uid].raf = requestAnimationFrame(tick);
    }
    state.micAnalysers[uid] = { ctx, raf: requestAnimationFrame(tick) };
  } catch (err) { console.warn('Mic meter:', err); }
}

function stopMicMeter(uid) {
  const a = state.micAnalysers[uid]; if (!a) return;
  if (a.raf) cancelAnimationFrame(a.raf);
  if (a.ctx) a.ctx.close().catch(() => {});
  delete state.micAnalysers[uid];
  const fill = $(`mic-fill-${uid}`); if (fill) fill.style.width = '0%';
}

export function initCameraSystem() {
  dom.cameraBtnHeader.addEventListener('click', toggleOwnCamera);
}

/* ── Public camera request ────────────────────────────────────── */
export function requestPublicCamera(targetUid) {
  const uid    = String(targetUid);
  const target = findUser(uid);
  console.log('[Camera Request] requestPublicCamera called for', uid, 'target:', target);
  if (!target?.online) { 
    console.warn('[Camera Request] Target is offline:', target);
    showToast(`${target?.name || 'User'} is offline.`); 
    return; 
  }
  if (!state.supa) { 
    console.warn('[Camera Request] Supabase not connected');
    showToast('⚠️ Server connection required.'); 
    return; 
  }
  
  /* Check if target has camera active in this room */
  const roomId = state.activeRoom;
  const room = state.rooms[roomId];
  const targetInRoom = room?.users[uid];
  const hasCameraActive = targetInRoom?.hasCamera || (target.hasCamera && target.online);
  console.log('[Camera Request] Room:', roomId, 'targetInRoom:', targetInRoom, 'hasCameraActive:', hasCameraActive);
  
  if (!hasCameraActive) {
    console.warn('[Camera Request] Target does not have camera active');
    showToast(`📹 ${target.name} does not have their camera active.`);
    return;
  }
  
  if (state.cameraWindows[uid]) { 
    console.log('[Camera Request] Already viewing camera from', uid);
    showToast(`📹 Already viewing ${target.name}'s camera.`); 
    return; 
  }
  if (state.pendingCamRequests[uid]) { 
    console.log('[Camera Request] Already waiting for reply from', uid);
    showToast(`⏳ Already waiting for ${target.name}'s reply.`); 
    return; 
  }
  console.log('[Camera Request] Sending camera request to', uid, 'in room', state.activeRoom);
  setPendingCamRequest(uid, 'public', target.name);
  broadcast('cam-req', uid, { reqType: 'public', room_id: state.activeRoom });
  showToast(`📹 Camera request sent to ${target.name}…`);
}

/* ── Incoming cam/call request ────────────────────────────────── */
export function handleCamRequest(payload) {
  if (payload.to !== state.currentUser?.id) return;
  const fromId   = String(payload.from);
  const fromName = payload.fromName || 'User';

  /* Auto-reject if blocked or ignored */
  if (state.rejectedCamUsers[fromId] || state.ignoredUsers[fromId]) {
    broadcast('cam-rejected', fromId, { reqType: payload.reqType || 'public' });
    return;
  }

  /* Auto-reject if the request is for a different room than the active one */
  if (payload.room_id && payload.room_id !== state.activeRoom) {
    broadcast('cam-rejected', fromId, { reqType: payload.reqType || 'public', reason: 'wrong-room' });
    return;
  }

  /* Events room: auto-accept public camera requests (cameras are public) */
  if (payload.reqType === 'public' && payload.room_id === state.activeRoom) {
    const availableRooms = getAvailableRooms();
    const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
    const isEventsRoom = roomData?.max_cams && roomData.max_cams >= 1 && roomData.max_cams <= 8;
    
    if (isEventsRoom) {
      /* Auto-accept in Events room - cameras are public */
      console.log('[Events Room] Auto-accepting camera request from', fromName || fromId, 'in Events room');
      sharePublicCameraTo(fromId);
      return;
    }
  }

  if (payload.reqType === 'public') {
    dom.camReqBody.textContent   = `${fromName} wants to see your camera.`;
    dom.camReqOverlay.hidden     = false;
    dom.camAcceptBtn.onclick = async () => { dom.camReqOverlay.hidden = true; await sharePublicCameraTo(fromId); };
    dom.camRejectBtn.onclick = () => {
      dom.camReqOverlay.hidden = true;
      addRejectedCam(fromId, fromName);
      broadcast('cam-rejected', fromId, {});
      showToast(`❌ Request from ${fromName} declined and blocked.`);
    };
  } else if (payload.reqType === 'private') {
    dom.camReqBody.textContent   = `${fromName} wants to start a private video call.`;
    dom.camReqOverlay.hidden     = false;
    dom.camAcceptBtn.onclick = async () => { dom.camReqOverlay.hidden = true; await acceptPrivateCall(fromId, fromName); };
    dom.camRejectBtn.onclick = () => {
      dom.camReqOverlay.hidden = true;
      addRejectedCam(fromId, fromName);
      broadcast('cam-rejected', fromId, { reqType: 'private' });
      showToast(`❌ Video call from ${fromName} declined and blocked.`);
    };
  }
}

export function handleCamAccepted(payload) {
  if (payload.to !== state.currentUser?.id) return;
  clearPendingCamRequest(String(payload.from));
  if (payload.reqType === 'private') startPrivateCall(payload.from);
}

/* ── Share own camera to a viewer via WebRTC ───────────────────── */
export async function sharePublicCameraTo(toUid) {
  try {
    if (!state.localStream) {
      const msSince = Date.now() - state.cameraClosedAt;
      if (msSince < 450) await new Promise(r => setTimeout(r, 450 - msSince));
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.currentUser.hasCamera = true;
      state.cameraRoom = state.activeRoom;
      dom.cameraBtnLabel.textContent = 'Camera On'; dom.cameraBtnHeader.classList.add('camera-on');
      createCameraWindow(state.currentUser.id, state.localStream, 'You', true);
      broadcastAll('cam-opened', { room_id: state.cameraRoom });
      await updateAllRoomPresences();
    }
    console.log('[WebRTC] Creating peer connection for', toUid);
    /* Close existing peer connection if it exists */
    if (state.outgoingPCs[toUid]) {
      console.log('[WebRTC] Closing existing peer connection for', toUid);
      const oldPc = state.outgoingPCs[toUid];
      oldPc.close();
      delete state.outgoingPCs[toUid];
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    state.outgoingPCs[toUid] = pc;
    const tracks = state.localStream.getTracks().filter(t => t.readyState === 'live');
    console.log('[WebRTC] Adding', tracks.length, 'tracks to peer connection:', tracks.map(t => ({ kind: t.kind, readyState: t.readyState })));
    tracks.forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log('[WebRTC] Outgoing ICE candidate type:', candidate.type, 'protocol:', candidate.protocol, 'to', toUid);
        broadcast('webrtc', toUid, { sigType: 'ice', candidate, ctx: 'public' });
      }
    };
    console.log('[WebRTC] Creating offer for', toUid);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log('[WebRTC] Sending offer to', toUid, 'SDP length:', offer.sdp.length);
    broadcast('webrtc', toUid, { sigType: 'offer', sdp: offer.sdp, ctx: 'public' });
    broadcast('cam-accepted', toUid, {});
    
    const viewerUser = findUser(toUid);
    state.camViewers[toUid] = viewerUser?.username || viewerUser?.name || toUid;
    refreshViewersPanel(state.currentUser.id);

    /* Monitor outgoing connection — attempt ICE restart on disconnect before giving up */
    pc.addEventListener('connectionstatechange', () => {
      console.log('[WebRTC] Outgoing connection state changed:', pc.connectionState, 'for', toUid);
      if (pc.connectionState === 'disconnected') {
        /* Try ICE restart — creates new ICE candidates without changing media */
        console.log('[WebRTC] Outgoing disconnected for', toUid, '— sending ICE restart offer');
        pc.createOffer({ iceRestart: true })
          .then(offer => pc.setLocalDescription(offer))
          .then(() => broadcast('webrtc', toUid, { sigType: 'offer', sdp: pc.localDescription.sdp, ctx: 'public' }))
          .catch(err => console.warn('[WebRTC] ICE restart offer failed:', err));
      }
      if (['disconnected','failed','closed'].includes(pc.connectionState)) {
        delete state.camViewers[toUid]; refreshViewersPanel(state.currentUser?.id);
      }
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      console.log('[WebRTC] Outgoing ICE connection state changed:', pc.iceConnectionState, 'for', toUid);
    });
  } catch (err) { showToast('⚠️ Could not share camera: ' + err.message); }
}

/* ── All incoming WebRTC signals ──────────────────────────────── */
export async function handleWebRTCSignal(payload) {
  if (payload.to !== state.currentUser?.id) return;
  const { sigType, from, sdp, candidate } = payload;
  const isPublic = payload.ctx === 'public', isPrivate = payload.ctx === 'private';

  if (isPublic) {
    if (sigType === 'offer') {
      /* Prevent duplicate PC creation — if we're already processing an offer for this user, ignore */
      if (state.incomingPCs[from]) {
        const existingPc = state.incomingPCs[from];
        /* If PC is already in a stable/connected state, close it and create new one */
        if (existingPc.signalingState === 'stable' || existingPc.connectionState === 'connected') {
          console.log('[WebRTC] Closing existing incoming peer connection for', from, 'state:', existingPc.signalingState, existingPc.connectionState);
          existingPc.close();
          delete state.incomingPCs[from];
          
          /* Remove old slot from Events grid to avoid black screen with dead video */
          const oldCw = state.cameraWindows[from];
          if (oldCw?.isEventsGrid && oldCw.el && oldCw.el.parentNode) {
            console.log('[WebRTC] Removing old slot for', from, 'before creating new connection');
            const oldVideo = oldCw.el.querySelector('video');
            if (oldVideo) {
              oldVideo.pause();
              oldVideo.srcObject = null; /* Abort any pending play() */
            }
            oldCw.el.remove();
            delete state.cameraWindows[from];
            /* Delay to ensure DOM cleanup completes before new stream arrives */
            await new Promise(r => setTimeout(r, 100));
          }
        } else {
          /* PC is still being set up — ignore duplicate offer */
          console.warn('[WebRTC] Ignoring duplicate offer from', from, '— PC already exists in state:', existingPc.signalingState);
          return;
        }
      }
      
      /* If we have an active outgoing PC for this user, it might interfere with incoming PC ICE negotiation.
         Wait for outgoing PC to stabilize (or timeout after 500ms) before processing incoming offer. */
      const outgoingPc = state.outgoingPCs[from];
      if (outgoingPc) {
        const outgoingState = outgoingPc.connectionState;
        if (outgoingState === 'connecting' || outgoingState === 'new') {
          console.log('[WebRTC] Outgoing PC exists for', from, 'in state', outgoingState, '— waiting for stabilization');
          /* Wait up to 500ms for outgoing PC to connect, then proceed anyway */
          let waited = 0;
          while (waited < 500 && (outgoingPc.connectionState === 'connecting' || outgoingPc.connectionState === 'new')) {
            await new Promise(r => setTimeout(r, 50));
            waited += 50;
          }
          console.log('[WebRTC] Outgoing PC state after wait:', outgoingPc.connectionState, 'waited:', waited, 'ms');
        } else if (outgoingState === 'connected') {
          /* Outgoing PC is already connected — add small delay to let ICE resources free up */
          console.log('[WebRTC] Outgoing PC connected for', from, '— delaying incoming PC by 300ms');
          await new Promise(r => setTimeout(r, 300));
        }
      }
      
      console.log('[WebRTC] Creating new incoming peer connection for', from);
      const pc = new RTCPeerConnection(ICE_SERVERS);
      state.incomingPCs[from] = pc;
      pc.onicecandidate = ({ candidate: c }) => {
        if (c) {
          console.log('[WebRTC] Local ICE candidate type:', c.type, 'protocol:', c.protocol, 'for incoming from', from);
          broadcast('webrtc', from, { sigType: 'ice', candidate: c, ctx: 'public' });
        }
      };
      
      /* Flag to prevent openRemoteCamWindow from being called multiple times
         (ontrack fires once per track: audio + video = 2 times for the same stream) */
      let streamOpened = false;
      
      pc.ontrack = ({ streams, track }) => {
        console.log('[WebRTC] ontrack from', from, '- kind:', track?.kind, 'readyState:', track?.readyState, 'streams:', streams?.length, 'streamOpened:', streamOpened);
        if (!streams || !streams[0]) { console.warn('[WebRTC] No streams in ontrack from', from); return; }
        
        /* Only open the camera window ONCE per peer connection regardless of track type.
           DO NOT check for video tracks here — on some browsers/PCs, audio track arrives first
           and streams[0] may not yet include video. Using streamOpened flag is sufficient. */
        if (streamOpened) {
          console.log('[WebRTC] Stream already opened for', from, '- ignoring duplicate ontrack (kind:', track?.kind, ')');
          return;
        }
        streamOpened = true;
        
        ensureUser(from, payload.fromName);
        
        const stream = streams[0];
        console.log('[WebRTC] Opening window for', from, 'stream tracks:', stream.getTracks().map(t => t.kind + ':' + t.readyState));
        
        /* Open window immediately — insertCameraIntoEventsGrid handles stream readiness */
        openRemoteCamWindow(from, stream, payload.fromName);
      };
      
      /* Monitor incoming connection — auto-reconnect if it fails */
      let reconnectAttempts = 0;
      const MAX_RECONNECT = 3;

      pc.addEventListener('connectionstatechange', () => {
        console.log('[WebRTC] Connection state changed:', pc.connectionState, 'for', from);
        if (pc.connectionState === 'failed') {
          /* Only act if this PC is still the current one */
          if (state.incomingPCs[from] !== pc) return;
          delete state.incomingPCs[from];

          /* Blank out the dead video so user sees a spinner instead of frozen frame */
          const cw = state.cameraWindows[from];
          if (cw?.isEventsGrid && cw.el) {
            const deadVideo = cw.el.querySelector('video');
            if (deadVideo) { deadVideo.pause(); deadVideo.srcObject = null; }
          }

          if (reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            const delay = reconnectAttempts * 2000; /* 2s, 4s, 6s */
            console.log('[WebRTC] Incoming failed for', from,
              '— reconnect attempt', reconnectAttempts, 'of', MAX_RECONNECT, 'in', delay, 'ms');

            setTimeout(() => {
              const user = findUser(from);
              const currentCw = state.cameraWindows[from];
              const streamAlive = currentCw?.stream?.active &&
                currentCw.stream.getTracks().some(t => t.readyState === 'live');
              /* Only reconnect if: user still online with cam, stream is dead, no PC already active */
              if (user?.hasCamera && user?.online && !streamAlive && !state.incomingPCs[from]) {
                console.log('[WebRTC] Re-requesting camera from', from);
                /* Remove dead slot so it gets created fresh */
                if (currentCw?.isEventsGrid && currentCw.el?.parentNode) {
                  currentCw.el.remove();
                }
                delete state.cameraWindows[from];
                /* Clear stale pending flag so request goes through */
                delete state.pendingCamRequests[from];
                requestPublicCamera(from);
              } else {
                console.log('[WebRTC] Skipping reconnect for', from,
                  '— user online:', user?.online, 'hasCamera:', user?.hasCamera,
                  'streamAlive:', streamAlive, 'pcExists:', !!state.incomingPCs[from]);
              }
            }, delay);
          } else {
            console.error('[WebRTC] Max reconnect attempts reached for', from);
            /* Show error indicator on slot */
            const currentCw = state.cameraWindows[from];
            if (currentCw?.isEventsGrid && currentCw.el) {
              const err = document.createElement('div');
              err.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;' +
                'justify-content:center;background:rgba(0,0,0,0.75);color:#fff;font-size:11px;text-align:center;padding:4px;';
              err.textContent = '❌ Connection failed\nTry refreshing';
              currentCw.el.style.position = 'relative';
              currentCw.el.appendChild(err);
            }
          }
        }
      });
      /* Retry play() when connection becomes ready — multiple triggers for robustness */
      const retryPlay = (trigger) => {
        const cw = state.cameraWindows[from];
        if (!cw?.isEventsGrid || !cw.el) {
          console.log('[WebRTC] Retry play() skipped for', from, '— no camera window (trigger:', trigger, ')');
          return;
        }
        const vid = cw.el.querySelector('video');
        if (!vid || !vid.srcObject) {
          console.log('[WebRTC] Retry play() skipped for', from, '— no video/srcObject (trigger:', trigger, ')');
          return;
        }
        if (!vid.paused) {
          console.log('[WebRTC] Retry play() skipped for', from, '— already playing (trigger:', trigger, ')');
          return; /* Already playing */
        }
        
        console.log('[WebRTC] Retrying play() for', from, 'ICE:', pc.iceConnectionState, 'conn:', pc.connectionState, 'trigger:', trigger);
        vid.play().then(() => {
          console.log('[Events Grid] Playing for', from, '(retry-triggered:', trigger, ') — unmuting:', !cw.isOwn);
          if (!cw.isOwn) vid.muted = false;
        }).catch(err => {
          console.warn('[WebRTC] Retry play() failed for', from, ':', err.name, '(trigger:', trigger, ')');
        });
      };

      pc.addEventListener('iceconnectionstatechange', () => {
        console.log('[WebRTC] ICE connection state changed:', pc.iceConnectionState, 'for', from);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setTimeout(() => retryPlay('ICE-connected'), 100); /* Small delay to ensure video is in DOM */
        }
      });
      
      pc.addEventListener('connectionstatechange', () => {
        console.log('[WebRTC] Connection state changed:', pc.connectionState, 'for', from);
        if (pc.connectionState === 'connected') {
          setTimeout(() => retryPlay('connection-connected'), 200); /* Retry when full connection is established */
        }
      });
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcast('webrtc', from, { sigType: 'answer', sdp: answer.sdp, ctx: 'public' });
    } else if (sigType === 'answer') {
      const pc = state.outgoingPCs[from];
      if (pc) {
        console.log('[WebRTC] Received answer from', from, 'PC state:', pc.signalingState, 'connectionState:', pc.connectionState);
        /* Only set remote description if we're in the correct state */
        if (pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription({ type: 'answer', sdp });
            console.log('[WebRTC] Successfully set remote answer from', from);
          } catch (err) {
            console.error('[WebRTC] Error setting remote answer:', err, 'PC state:', pc.signalingState);
            /* If we're already connected, ignore the error */
            if (pc.signalingState === 'stable' && pc.connectionState === 'connected') {
              console.log('[WebRTC] Connection already established, ignoring answer');
            } else {
              throw err;
            }
          }
        } else {
          console.warn('[WebRTC] Cannot set remote answer - wrong state:', pc.signalingState, 'expected: have-local-offer');
          /* If connection is already established, this is fine */
          if (pc.signalingState === 'stable' && pc.connectionState === 'connected') {
            console.log('[WebRTC] Connection already established, answer not needed');
          }
        }
      } else {
        console.warn('[WebRTC] Received answer from', from, 'but no outgoing PC found');
      }
    } else if (sigType === 'ice') {
      const pc = state.outgoingPCs[from] || state.incomingPCs[from];
      if (pc && candidate) {
        /* candidate may be deserialized as plain object — reconstruct RTCIceCandidate for logging */
        const candType = candidate.type || (candidate.candidate?.includes(' typ relay ') ? 'relay' : 
                                          candidate.candidate?.includes(' typ srflx ') ? 'srflx' : 
                                          candidate.candidate?.includes(' typ host ') ? 'host' : 'unknown');
        const candProto = candidate.protocol || (candidate.candidate?.includes(' UDP ') ? 'udp' : 
                                                 candidate.candidate?.includes(' TCP ') ? 'tcp' : 'unknown');
        console.log('[WebRTC] Remote ICE candidate type:', candType, 'protocol:', candProto, 'from', from);
        /* Reconstruct RTCIceCandidate if needed (WebRTC accepts plain objects too, but safer) */
        const iceCandidate = candidate instanceof RTCIceCandidate ? candidate : new RTCIceCandidate(candidate);
        await pc.addIceCandidate(iceCandidate).catch(console.warn);
      }
    }
  }

  if (isPrivate) {
    if (sigType === 'offer') {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      state.privatePeer = pc; state.activeCallUID = from;
      pc.onicecandidate = ({ candidate: c }) => { if (c) broadcast('webrtc', from, { sigType: 'ice', candidate: c, ctx: 'private' }); };
      pc.ontrack = ({ streams }) => {
        dom.remoteVideoEl.srcObject = streams[0]; dom.remoteVideoEl.play().catch(() => {});
        dom.remotePlaceholder.style.display = 'none'; dom.vcallStatus.textContent = 'Connected';
      };
      if (state.localStream) state.localStream.getTracks().filter(t => t.readyState === 'live').forEach(t => pc.addTrack(t, state.localStream));
      const caller = findUser(from);
      dom.localVideoEl.srcObject = state.localStream; dom.vcallName.textContent = caller?.name || from;
      dom.vcallStatus.textContent = 'Connecting…'; dom.vcallAvatar.textContent = initials(caller?.name || '?');
      dom.vcallAvatar.style.background = avatarColor(caller?.name || '?'); dom.vcallWin.hidden = false;
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      broadcast('webrtc', from, { sigType: 'answer', sdp: answer.sdp, ctx: 'private' });
    } else if (sigType === 'answer') {
      if (state.privatePeer) { await state.privatePeer.setRemoteDescription({ type: 'answer', sdp }); dom.vcallStatus.textContent = 'Connected'; }
    } else if (sigType === 'ice') {
      if (state.privatePeer && candidate) await state.privatePeer.addIceCandidate(candidate).catch(console.warn);
    }
  }
}

function openRemoteCamWindow(uid, stream, userName = null) {
  clearPendingCamRequest(String(uid));
  const user = findUser(uid);
  const name = userName || user?.name || uid;
  
  /* Check if we're in Events room - if so, ensure grid is visible */
  const availableRooms = getAvailableRooms();
  const roomData = availableRooms.find(r => String(r.id) === String(state.activeRoom));
  const isEventsRoom = roomData?.max_cams && roomData.max_cams >= 1 && roomData.max_cams <= 8;
  
  if (isEventsRoom && dom.eventsCamGrid) {
    dom.eventsCamGrid.hidden = false;
  }
  
  createCameraWindow(uid, stream, name, false);
}

/* ── Private video call ───────────────────────────────────────── */
async function acceptPrivateCall(fromUid, fromName) {
  try {
    if (!state.localStream) {
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.streamOpenedForCall = true;
    } else { state.streamOpenedForCall = false; }
    const user = findUser(fromUid) || { name: fromName, isGuest: true };
    dom.localVideoEl.srcObject = state.localStream; dom.vcallName.textContent = user.name;
    dom.vcallStatus.textContent = 'Connecting…'; dom.vcallAvatar.textContent = initials(user.name);
    dom.vcallAvatar.style.background = avatarColor(user.name);
    dom.remotePlaceholder.style.display = ''; dom.vcallWin.hidden = false;
    state.activeCallUID = fromUid;
    broadcast('cam-accepted', fromUid, { reqType: 'private' });
  } catch (err) { showToast('⚠️ Could not access camera/mic: ' + err.message); }
}

async function startPrivateCall(targetUid) {
  const target = findUser(targetUid);
  try {
    if (!state.localStream) {
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.streamOpenedForCall = true;
    } else { state.streamOpenedForCall = false; }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    state.privatePeer = pc; state.activeCallUID = targetUid;
    state.localStream.getTracks().filter(t => t.readyState === 'live').forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate: c }) => { if (c) broadcast('webrtc', targetUid, { sigType: 'ice', candidate: c, ctx: 'private' }); };
    pc.ontrack = ({ streams }) => {
      dom.remoteVideoEl.srcObject = streams[0]; dom.remoteVideoEl.play().catch(() => {});
      dom.remotePlaceholder.style.display = 'none'; dom.vcallStatus.textContent = 'Connected';
    };
    dom.localVideoEl.srcObject = state.localStream; dom.vcallName.textContent = target?.name || targetUid;
    dom.vcallStatus.textContent = 'Calling…'; dom.vcallAvatar.textContent = initials(target?.name || '?');
    dom.vcallAvatar.style.background = avatarColor(target?.name || '?');
    dom.remotePlaceholder.style.display = ''; dom.vcallWin.hidden = false;
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    broadcast('webrtc', targetUid, { sigType: 'offer', sdp: offer.sdp, ctx: 'private' });
  } catch (err) { showToast('⚠️ Could not start call: ' + err.message); }
}

export function initCallControls() {
  dom.vcallEndBtn.addEventListener('click', endCall);
  dom.vcallHdrClose.addEventListener('click', endCall);
  dom.vcallMicBtn.addEventListener('click', () => {
    const m = dom.vcallMicBtn.classList.toggle('off');
    dom.vcallMicBtn.setAttribute('aria-pressed', String(!m));
    state.localStream?.getAudioTracks().forEach(t => { t.enabled = !m; });
  });
  dom.vcallCamBtn.addEventListener('click', () => {
    const o = dom.vcallCamBtn.classList.toggle('off');
    dom.vcallCamBtn.setAttribute('aria-pressed', String(!o));
    state.localStream?.getVideoTracks().forEach(t => { t.enabled = !o; });
  });
  makeDraggable(dom.vcallWin, dom.vcallDragHandle);
}

export function endCall(notify = true) {
  if (notify && state.activeCallUID) broadcast('call-ended', state.activeCallUID, {});
  state.privatePeer?.close(); state.privatePeer = null;
  dom.vcallWin.hidden = true;
  dom.remoteVideoEl.srcObject = null; dom.localVideoEl.srcObject = null;
  dom.remotePlaceholder.style.display = '';
  if (state.streamOpenedForCall && state.localStream) {
    if (!state.cameraWindows[state.currentUser.id]) {
      const closedRoom = state.cameraRoom;
      state.localStream.getTracks().forEach(t => t.stop());
      state.localStream = null; state.currentUser.hasCamera = false; state.cameraRoom = null;
      dom.cameraBtnLabel.textContent = 'Camera Off'; dom.cameraBtnHeader.classList.remove('camera-on');
      broadcastAll('cam-closed', { room_id: closedRoom });
      updateAllRoomPresences(); renderUsers();
    }
    state.streamOpenedForCall = false;
  }
  state.activeCallUID = null; showToast('📵 Call ended.');
}

/* Insert camera into Events room grid */
function insertCameraIntoEventsGrid(uid, stream, name, isOwn) {
  if (!dom.eventsCamGrid) return;

  dom.eventsCamGrid.hidden = false;

  /* ── ALWAYS check DOM first — remove any existing slot for this user (even if not in state.cameraWindows)
      This prevents race conditions when guest riactivates cam while we have outgoing PC active */
  let targetSlot = dom.eventsCamGrid.querySelector(`[data-user-id="${uid}"]`);
  if (targetSlot) {
    /* Slot exists in DOM — check if it matches our state */
    const cw = state.cameraWindows[uid];
    if (cw?.isEventsGrid && cw.el === targetSlot) {
      /* Slot matches state — check if we need to rebuild */
    } else {
      /* Slot exists in DOM but not in state (or different reference) — remove it immediately
         This happens when guest riactivates cam and old slot wasn't cleaned up properly */
      console.log('[Events Grid] Found orphaned slot in DOM for', uid, '— removing before creating new');
      const orphanVideo = targetSlot.querySelector('video');
      if (orphanVideo) {
        orphanVideo.pause();
        orphanVideo.srcObject = null;
      }
      targetSlot.remove();
      targetSlot = null;
    }
  }
  
  /* ── If slot still exists (matches state), check if we need to rebuild ── */
  if (targetSlot) {
    const existingVideo = targetSlot.querySelector('video');
    if (existingVideo && stream) {
      const oldStream = existingVideo.srcObject;
      if (oldStream?.id === stream.id) {
        /* Same stream ID — check if it's still alive */
        const hasLiveTracks = oldStream.getTracks().some(t => t.readyState === 'live');
        if (hasLiveTracks) {
          /* Same live stream — just make sure it's playing */
          if (existingVideo.paused) existingVideo.play().catch(() => {});
          return;
        } else {
          /* Same stream ID but dead — remove and rebuild */
          console.log('[Events Grid] Old stream is dead for', uid, '— rebuilding slot');
        }
      } else if (oldStream && oldStream.id !== stream.id) {
        /* Different stream — always rebuild when stream ID changes */
        console.log('[Events Grid] Different stream ID for', uid, 'old:', oldStream.id, 'new:', stream.id);
      }
    } else if (existingVideo && !existingVideo.srcObject) {
      /* Video exists but no stream — dead slot, rebuild */
      console.log('[Events Grid] Slot has video but no stream for', uid, '— rebuilding');
    }
    /* New/different stream OR stream is null/undefined OR video is missing OR old stream is dead
       — MUST rebuild slot completely to avoid black screen */
    console.log('[Events Grid] Rebuilding slot for', uid, 'stream:', stream ? 'new' : 'null', 'existingVideo:', !!existingVideo);
    if (existingVideo) {
      existingVideo.pause();
      existingVideo.srcObject = null;   /* ← aborts pending play cleanly */
    }
    /* Remove old slot completely and create fresh one */
    targetSlot.remove();
    targetSlot = null;
  }
  
  if (!targetSlot) {
    /* Check max_cams limit */
    const availableRooms = getAvailableRooms();
    const maxCams = availableRooms.find(r => String(r.id) === String(state.activeRoom))?.max_cams;
    const currentSlots = dom.eventsCamGrid.querySelectorAll('.events-cam-slot');
    if (maxCams && currentSlots.length >= maxCams) { showToast('⚠️ All camera slots are full.'); return; }
    targetSlot = document.createElement('div');
    targetSlot.className = 'events-cam-slot';
    targetSlot.dataset.userId = uid;
    dom.eventsCamGrid.appendChild(targetSlot);
  }

  /* ── Build slot content ── */
  targetSlot.innerHTML = '';
  targetSlot.dataset.userId = uid;

  /* Video element — always start MUTED so autoplay works on ALL browsers (PC/Safari/etc.)
     For remote streams we auto-unmute once playing; own cam stays muted always */
  const video = document.createElement('video');
  video.autoplay   = true;
  video.playsInline = true;
  video.muted      = true;   /* KEY: muted = guaranteed autoplay on any browser */
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  if (isOwn) video.style.transform = 'scaleX(-1)';

  /* Label */
  const label = document.createElement('div');
  label.className = 'events-cam-slot-label';
  label.textContent = name || uid || 'User';
  label.style.cssText = 'cursor:pointer;display:block;visibility:visible;opacity:1;';
  label.title = `Click to view ${name || uid}'s profile`;
  label.addEventListener('click', (e) => {
    e.stopPropagation(); e.preventDefault();
    import('./ui.js').then(({ openContextMenu }) => openContextMenu(uid, label));
  });

  targetSlot.appendChild(video);
  targetSlot.appendChild(label);

  console.log('[Events Grid v20260426] Slot created for', uid, 'isOwn:', isOwn, 'hasStream:', !!stream);

  /* ── Assign stream and play ── */
  if (stream) {
    const assignAndPlay = () => {
      console.log('[Events Grid] assignAndPlay called for', uid, 'stream tracks:', stream.getTracks().map(t => t.kind + ':' + t.readyState));
      video.srcObject = stream;

      /* play() may hang forever on Edge/Windows when ICE hasn't connected yet.
         We use a canplay/loadeddata fallback so playback starts once frames flow,
         regardless of whether play() resolves. */
      let playStarted = false;

      const onFrames = () => {
        if (playStarted) return;
        playStarted = true;
        video.play().then(() => {
          console.log('[Events Grid] Playing for', uid, '(via frame event) — unmuting:', !isOwn);
          if (!isOwn) video.muted = false;
        }).catch(console.warn);
      };
      video.addEventListener('canplay',     onFrames, { once: true });
      video.addEventListener('loadeddata',  onFrames, { once: true });

      console.log('[Events Grid] Calling play() for', uid, 'video.paused:', video.paused, 'video.srcObject:', !!video.srcObject);
      const playPromise = video.play();
      if (playPromise && typeof playPromise.then === 'function') {
        /* Set a timeout to detect if play() is hanging (common on Edge/Windows when ICE not connected) */
        let playRetryCount = 0;
        const MAX_PLAY_RETRIES = 5;
        const playTimeout = setTimeout(() => {
          /* Check if play() is still pending (video is paused and has srcObject) */
          if (!playStarted && video.parentNode && video.paused && video.srcObject) {
            playRetryCount++;
            console.log('[Events Grid] play() hanging for', uid, `— forcing retry ${playRetryCount}/${MAX_PLAY_RETRIES} after 1s`);
            /* Force retry — play() might be waiting for ICE connection */
            video.play().then(() => {
              if (!playStarted) {
                playStarted = true;
                console.log('[Events Grid] Playing for', uid, `(forced retry ${playRetryCount}) — unmuting:`, !isOwn);
                if (!isOwn) video.muted = false;
              }
            }).catch(err => {
              if (err.name !== 'AbortError') {
                console.warn('[Events Grid] Forced retry play() failed:', err.name);
                /* If retry failed and we haven't reached max, schedule another retry */
                if (playRetryCount < MAX_PLAY_RETRIES && video.parentNode && video.srcObject) {
                  setTimeout(() => {
                    if (!playStarted && video.paused && video.srcObject) {
                      video.play().catch(console.warn);
                    }
                  }, 1000);
                }
              }
            });
          }
        }, 1000);
        
        playPromise.then(() => {
          clearTimeout(playTimeout);
          if (playStarted) return; /* already handled by frame event */
          playStarted = true;
          console.log('[Events Grid] Playing for', uid, '(playPromise resolved) — unmuting:', !isOwn);
          if (!isOwn) video.muted = false;
        }).catch(err => {
          clearTimeout(playTimeout);
          /* AbortError is expected when slot is removed during play() — ignore it */
          if (err.name === 'AbortError') {
            console.log('[Events Grid] play() aborted for', uid, '(slot likely removed) — ignoring');
            return;
          }
          console.warn('[Events Grid] play() failed for', uid, ':', err.name);
          /* Only retry if video is still in DOM and has stream */
          setTimeout(() => {
            if (!playStarted && video.parentNode && video.srcObject) {
              video.play().catch(console.warn);
            }
          }, 500);
        });
      }
      
      /* Fallback timeout: if play() doesn't resolve and frame events don't fire within 3s,
         force retry (ICE might have connected in the meantime) */
      setTimeout(() => {
        /* Only retry if video is still in DOM and has stream */
        if (!playStarted && video.parentNode && video.paused && video.srcObject) {
          console.log('[Events Grid] Timeout fallback — forcing play() for', uid);
          video.play().then(() => {
            playStarted = true;
            console.log('[Events Grid] Playing for', uid, '(timeout fallback) — unmuting:', !isOwn);
            if (!isOwn) video.muted = false;
          }).catch(err => {
            if (err.name !== 'AbortError') console.warn('[Events Grid] Timeout fallback play() failed:', err.name);
          });
        }
      }, 3000);
      
      /* Continuous retry: force play() every 2 seconds until video starts playing
         This handles cases where play() hangs indefinitely on Edge/Windows */
      const continuousRetry = setInterval(() => {
        if (playStarted) {
          clearInterval(continuousRetry);
          return;
        }
        if (!video.parentNode || !video.srcObject) {
          clearInterval(continuousRetry);
          return;
        }
        /* If video is paused, force play() */
        if (video.paused) {
          console.log('[Events Grid] Continuous retry — forcing play() for', uid);
          video.play().then(() => {
            if (!playStarted) {
              playStarted = true;
              clearInterval(continuousRetry);
              console.log('[Events Grid] Playing for', uid, '(continuous retry) — unmuting:', !isOwn);
              if (!isOwn) video.muted = false;
            }
          }).catch(err => {
            if (err.name !== 'AbortError') {
              console.warn('[Events Grid] Continuous retry play() failed:', err.name);
            }
          });
        } else {
          /* Video is playing — mark as started and stop retry */
          playStarted = true;
          clearInterval(continuousRetry);
          console.log('[Events Grid] Playing for', uid, '(detected playing) — unmuting:', !isOwn);
          if (!isOwn) video.muted = false;
        }
      }, 2000);
      
      /* Stop continuous retry after 30 seconds */
      setTimeout(() => {
        clearInterval(continuousRetry);
        if (!playStarted) {
          console.warn('[Events Grid] Continuous retry stopped for', uid, '— video still not playing after 30s');
        }
      }, 30000);
    };

    const activeTracks = stream.getTracks().filter(t => t.readyState === 'live');
    console.log('[Events Grid] Stream tracks for', uid, 'total:', stream.getTracks().length, 'live:', activeTracks.length);
    if (activeTracks.length > 0) {
      console.log('[Events Grid] Tracks are live — calling assignAndPlay immediately for', uid);
      assignAndPlay();
    } else {
      /* Tracks not ready yet — poll until live (max 5s) */
      console.log('[Events Grid] Tracks not live yet — polling for', uid);
      let attempts = 0;
      const poll = () => {
        attempts++;
        const liveTracks = stream.getTracks().filter(t => t.readyState === 'live');
        if (liveTracks.length > 0) {
          console.log('[Events Grid] Tracks became live after', attempts, 'attempts — calling assignAndPlay for', uid);
          assignAndPlay();
        } else if (attempts < 50) {
          setTimeout(poll, 100);
        } else {
          console.warn('[Events Grid] Timeout waiting for live tracks for', uid, '— assigning anyway');
          assignAndPlay();
        }
      };
      setTimeout(poll, 100);
    }
  } else {
    console.warn('[Events Grid] No stream for', uid);
  }

  /* ── Store reference ── */
  state.cameraWindows[uid] = { el: targetSlot, stream, isOwn, micEnabled: true, isEventsGrid: true };

  /* ── Update grid layout ── */
  import('./rooms.js').then(({ updateEventsCamGrid }) => updateEventsCamGrid());
}

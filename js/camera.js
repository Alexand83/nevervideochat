/* ================================================================
   camera.js  — camera windows, WebRTC, public cam share, private call
================================================================ */
/* VERSION MARKER — if you see this in logs, new code is running */
console.log('%c[NVC] camera.js v20260310 loaded', 'color:#0f0;background:#000;font-weight:bold;padding:2px 6px;border-radius:3px');

import { ICE_SERVERS }   from './config.js';
import { state }         from './state.js';
import { dom }           from './dom.js';
import { $, avatarColor, initials, escHtml, showToast, makeDraggable, makeResizable } from './utils.js';
import { broadcast, broadcastAll } from './broadcast.js';
import { findUser, ensureUser, renderUsers, updateOwnPresence, updateAllRoomPresences } from './users.js';
import { addRejectedCam, removeRejectedCam, clearPendingCamRequest, setPendingCamRequest, getMediaConstraints, saveDeviceSettings } from './storage.js';
import { getAvailableRooms } from './rooms.js';

const CAM_STEP = 30;
function camCount() { return Object.keys(state.cameraWindows).length; }
/** Per evitare XSS/breakout in id HTML: solo caratteri sicuri */
function safeId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '') || 'u'; }

/** True se la cam è attiva nella stanza (per obbligare a disattivarla prima della videochiamata privata). */
export function isRoomCameraActive() {
  return !!(state.localStream && state.cameraRoom != null);
}

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
  const safeUid = safeId(uid);
  const color = avatarColor(name), init = initials(name), n = camCount();
  const win   = document.createElement('div');
  win.className = 'cam-window'; win.id = `cam-win-${safeUid}`;
  win.setAttribute('role', 'dialog'); win.setAttribute('aria-label', `${name} camera`);
  win.style.right  = (20 + n * CAM_STEP) + 'px';
  win.style.bottom = (80 + n * CAM_STEP) + 'px';
  win.style.zIndex = String(650 + n);

  const viewersBtnHtml = isOwn
    ? `<button class="cam-viewers-btn" id="cam-viewers-btn-${safeUid}" title="Who is watching">👁 <span id="cam-viewers-count-${safeUid}">0</span></button>
       <div class="cam-viewers-panel" id="cam-viewers-panel-${safeUid}" hidden></div>` : '';

  const footer = isOwn ? `
    <div class="cam-win-footer">
      <button class="cam-ctrl-btn" id="cam-mic-btn-${safeUid}" aria-label="Toggle microphone" aria-pressed="true">
        <svg id="cam-mic-on-${safeUid}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
        </svg>
        <svg id="cam-mic-off-${safeUid}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
          <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/>
        </svg>
      </button>
      <button class="cam-ctrl-btn cam-video-toggle-btn" id="cam-video-toggle-btn-${safeUid}" type="button" aria-label="Video on/off" title="Disattiva video (solo voce)" aria-pressed="false">
        <span class="cam-video-toggle-icons"><svg class="cam-video-icon cam-video-icon-on" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg><svg class="cam-video-icon cam-video-icon-off" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" hidden><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/><line x1="2" y1="2" x2="22" y2="22"/></svg></span>
      </button>
      <div class="cam-device-wrap">
        <button class="cam-ctrl-btn cam-device-btn" id="cam-device-btn-${safeUid}" aria-label="Cambia camera" title="Dispositivo camera (frontale/retro)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
        <div class="cam-device-dropdown" id="cam-device-dropdown-${safeUid}" hidden></div>
      </div>
      <div class="mic-volume-section mic-volume-vertical" id="mic-volume-wrap-${safeUid}" title="Volume microfono: trascina la pallina">
        <div class="mic-volume-track"><div class="mic-volume-fill" id="mic-fill-${safeUid}"></div><div class="mic-volume-thumb" id="mic-thumb-${safeUid}"></div></div>
      </div>
    </div>` : `
    <div class="cam-win-footer cam-win-footer-remote">
      <button class="cam-ctrl-btn cam-remote-hide-video-btn" id="cam-remote-hide-video-${safeUid}" type="button" title="Nascondi video" aria-label="Nascondi video" aria-pressed="false">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
      </button>
      <button class="cam-ctrl-btn cam-remote-mute-btn" id="cam-remote-mute-${safeUid}" title="Mute voce" aria-pressed="false">🔊</button>
      <div class="cam-remote-volume-wrap mic-volume-vertical" id="cam-remote-volume-wrap-${safeUid}" title="Volume sua voce">
        <div class="mic-volume-track"><div class="mic-volume-fill" id="cam-remote-fill-${safeUid}"></div><div class="mic-volume-thumb" id="cam-remote-thumb-${safeUid}"></div></div>
      </div>
    </div>`;

  win.innerHTML = `
    <div class="cam-win-hdr" id="cam-win-hdr-${safeUid}">
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
      <video id="cam-vid-${safeUid}" autoplay ${isOwn ? 'muted' : ''} playsinline
             style="${isOwn ? 'transform:scaleX(-1)' : ''}"></video>
      <div class="cam-solo-voce-placeholder" id="cam-solo-voce-${safeUid}" hidden><span class="cam-solo-voce-icon">🎤</span><span class="cam-solo-voce-txt">Solo voce</span></div>
    </div>
    ${footer}
    <div class="cam-resize-handle" id="cam-rz-${safeUid}" aria-hidden="true"></div>`;

  document.body.appendChild(win);
  const remoteSenderVideoOff = !isOwn && !!state.remoteVideoOffState?.[uid];
  state.cameraWindows[uid] = { el: win, stream, isOwn, micEnabled: true, videoOff: false, videoHiddenByMe: false, remoteSenderVideoOff };

  const videoEl = $(`cam-vid-${safeUid}`);
  if (videoEl) {
    videoEl.srcObject = null; videoEl.srcObject = stream;
    if (!isOwn) {
      videoEl.muted = true;
      videoEl.volume = 1;
    }
    videoEl.play().then(() => {
      if (!isOwn) {
        videoEl.muted = false;
        initRemoteVolumeControl(uid);
      }
    }).catch(() => {});
    if (!isOwn) {
      updateRemoteVideoVisibility(uid);
      /* Fallback: dopo 2s se il video è ancora senza frame, reattach (utile su stessa rete quando i frame arrivano un po' dopo) */
      setTimeout(() => {
        const cw = state.cameraWindows[uid];
        if (!cw?.stream || cw.el !== win) return;
        const v = cw.el.querySelector('video');
        if (v && v.srcObject === cw.stream && v.videoWidth === 0 && cw.stream.getVideoTracks().some(t => t.readyState === 'live')) {
          v.srcObject = null;
          v.srcObject = cw.stream;
          v.muted = true;
          v.play().then(() => { v.muted = false; }).catch(() => {});
        }
      }, 2000);
    }
    /* CRITICO: Monitora il flusso per rilevare quando si interrompe */
    /* Chiudi la cam dopo 30 secondi di assenza di flusso */
    if (!isOwn && stream) {
      let lastActiveTime = Date.now();
      let streamCheckInterval = null;
      
      const checkStreamHealth = async () => {
        if (!state.cameraWindows[uid]) {
          /* Camera già chiusa - pulisci l'interval */
          if (streamCheckInterval) {
            clearInterval(streamCheckInterval);
            streamCheckInterval = null;
          }
          return;
        }
        
        const tracks = stream?.getTracks() || [];
        const hasActiveTracks = tracks.some(t => t.readyState === 'live');
        const videoTrack = tracks.find(t => t.kind === 'video');
        const isVideoLive = videoTrack?.readyState === 'live';
        
        /* CRITICO: Per cam nella grid degli eventi, chiudi immediatamente se il flusso è morto */
        const cw = state.cameraWindows[uid];
        const isInEventsGrid = cw?.isEventsGrid;
        
        if (hasActiveTracks && isVideoLive) {
          lastActiveTime = Date.now();
        } else {
          const timeSinceLastActive = Date.now() - lastActiveTime;
          /* CRITICO: Per cam nella grid degli eventi, chiudi dopo 15 secondi invece di 30 */
          /* 15 secondi per gestire problemi di connessione o refresh pagina */
          const timeout = isInEventsGrid ? 15000 : 30000;
          
          if (timeSinceLastActive > timeout) {
            /* Flusso morto - stessa procedura di cam-closed: togli dalla grid e aggiorna hasCamera */
            console.log('[Camera] Stream dead for', Math.round(timeSinceLastActive/1000), 's - removing camera from grid for', uid, isInEventsGrid ? '(Events grid)' : '');
            if (streamCheckInterval) {
              clearInterval(streamCheckInterval);
              streamCheckInterval = null;
            }
            removeRemoteCameraFromGrid(uid).catch(() => {});
          }
        }
      };
      
      /* Controlla ogni 5 secondi */
      streamCheckInterval = setInterval(checkStreamHealth, 5000);
      
      /* Salva l'interval per poterlo pulire */
      if (state.cameraWindows[uid]) {
        state.cameraWindows[uid].streamCheckInterval = streamCheckInterval;
      }
      
      /* Monitora anche gli eventi dei track */
      const tracks = stream.getTracks();
      tracks.forEach(track => {
        track.addEventListener('ended', () => {
          console.log('[Camera] Track ended for', uid, '- kind:', track.kind);
          checkStreamHealth();
        });
      });
      
      /* Controlla immediatamente */
      checkStreamHealth();

      /* Placeholder "Solo voce" quando il remoto disattiva il video + sync periodico */
      function syncRemoteVideoPlaceholder() {
        if (!state.cameraWindows[uid]) return;
        const cw = state.cameraWindows[uid];
        const stream = cw?.stream;
        const videoTrack = stream?.getVideoTracks()[0];
        cw.videoOff = !videoTrack || !videoTrack.enabled;
        updateRemoteVideoVisibility(uid);
      }
      syncRemoteVideoPlaceholder();
      const remoteVideoCheckInterval = setInterval(syncRemoteVideoPlaceholder, 1000);
      if (state.cameraWindows[uid]) state.cameraWindows[uid].remoteVideoCheckInterval = remoteVideoCheckInterval;
    }
  }
  win.querySelector('.cam-win-close-btn').addEventListener('click', () => closeCameraWindow(uid));

  if (isOwn) {
    const mb = $(`cam-mic-btn-${safeId(uid)}`);
    if (mb) mb.addEventListener('click', () => toggleCamMic(uid));
    startMicMeter(stream, uid);
    initMicVolumeSlider(uid);
    const videoToggleBtn = $(`cam-video-toggle-btn-${safeId(uid)}`);
    if (videoToggleBtn) videoToggleBtn.addEventListener('click', () => toggleSoloVoce(uid));
    const devBtn = $(`cam-device-btn-${safeId(uid)}`);
    const devDrop = $(`cam-device-dropdown-${safeId(uid)}`);
    if (devBtn && devDrop) {
      devBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        devDrop.hidden = !devDrop.hidden;
        if (!devDrop.hidden) await openCameraDeviceDropdown(uid, devDrop);
      });
      devDrop.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', () => { if (devDrop) devDrop.hidden = true; });
    }
    const vBtn   = $(`cam-viewers-btn-${safeId(uid)}`);
    const vPanel = $(`cam-viewers-panel-${safeId(uid)}`);
    if (vBtn && vPanel) {
      vBtn.addEventListener('click', e => {
        e.stopPropagation(); vPanel.hidden = !vPanel.hidden;
        if (!vPanel.hidden) refreshViewersPanel(uid);
      });
      document.addEventListener('click', () => { if (vPanel) vPanel.hidden = true; });
    }
  } else {
    /* Cam remota: pulsante "Nascondi video" (solo audio) */
    const hideVideoBtn = $(`cam-remote-hide-video-${safeId(uid)}`);
    if (hideVideoBtn) {
      hideVideoBtn.addEventListener('click', () => {
        const cw = state.cameraWindows[uid];
        if (!cw) return;
        cw.videoHiddenByMe = !cw.videoHiddenByMe;
        hideVideoBtn.setAttribute('aria-pressed', String(cw.videoHiddenByMe));
        hideVideoBtn.title = cw.videoHiddenByMe ? 'Mostra video' : 'Nascondi video';
        updateRemoteVideoVisibility(uid);
      });
    }
  }
  makeDraggable(win, $(`cam-win-hdr-${safeId(uid)}`));
  makeResizable(win, $(`cam-rz-${safeId(uid)}`));
}

export function refreshViewersPanel(ownUid) {
  const panel   = $(`cam-viewers-panel-${safeId(ownUid)}`);
  const countEl = $(`cam-viewers-count-${safeId(ownUid)}`);
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
  stopRemoteSpeakingIndicator(uid);
  closeRemoteVolumeContext(uid);

  /* CRITICO: Pulisci l'interval di monitoraggio del flusso se presente */
  if (camWin?.streamCheckInterval) {
    clearInterval(camWin.streamCheckInterval);
    camWin.streamCheckInterval = null;
  }
  if (camWin?.remoteVideoCheckInterval) {
    clearInterval(camWin.remoteVideoCheckInterval);
    camWin.remoteVideoCheckInterval = null;
  }
  
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
      stopMicMeter(uid);
      const closedRoom = state.cameraRoom;
      if (state.micPipeline) {
        state.micPipeline.ctx.close().catch(() => {});
        state.micPipeline = null;
      }
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
  stopMicMeter(uid); 
  /* CRITICO: Rimuovi il stream prima di rimuovere la cam per evitare che streamAlive risulti true */
  if (cw.stream) {
    cw.stream.getTracks().forEach(t => t.stop());
    cw.stream = null;
  }
  cw.el.remove(); 
  delete state.cameraWindows[uid];
  const isOwn = uid === state.currentUser?.id || uid === 'me';
  if (isOwn) {
    stopMicMeter(uid);
    const closedRoom = state.cameraRoom;
    if (state.micPipeline) {
      state.micPipeline.ctx.close().catch(() => {});
      state.micPipeline = null;
    }
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
    /* CRITICO: Marca questa camera come chiusa manualmente dall'utente */
    /* Questo impedisce che venga riaperta automaticamente */
    state.manuallyClosedCameras[uid] = true;
    console.log('[Camera] Camera manually closed by user:', uid, '- will not auto-reopen');
    
    if (state.incomingPCs[uid]) { 
      state.incomingPCs[uid].close(); 
      delete state.incomingPCs[uid]; delete state.pendingIncomingICE[uid]; 
    }
  }
}

/**
 * Resetta tutto lo stato camera alla disconnessione (WiFi/sessione).
 * Così al re-ingresso (guest o login) la cam non risulta più attiva in Eventi.
 */
export function resetCameraStateOnDisconnect() {
  const selfId = state.currentUser?.id;
  if (state.micPipeline) {
    state.micPipeline.ctx.close().catch(() => {});
    state.micPipeline = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
  }
  state.cameraRoom = null;
  state.cameraClosedAt = 0;
  for (const uid of Object.keys(state.outgoingPCs)) {
    try { state.outgoingPCs[uid].close(); } catch (_) {}
    delete state.outgoingPCs[uid];
  }
  for (const uid of Object.keys(state.incomingPCs)) {
    try { state.incomingPCs[uid].close(); } catch (_) {}
    delete state.incomingPCs[uid]; delete state.pendingIncomingICE[uid];
  }
  for (const uid of Object.keys(state.cameraWindows)) {
    const cw = state.cameraWindows[uid];
    if (cw.streamCheckInterval) { clearInterval(cw.streamCheckInterval); cw.streamCheckInterval = null; }
    if (cw.stream) { cw.stream.getTracks().forEach(t => t.stop()); cw.stream = null; }
    if (cw.isEventsGrid && cw.el?.parentNode) cw.el.remove();
    else if (cw.el?.parentNode) { stopMicMeter(uid); cw.el.remove(); }
    delete state.cameraWindows[uid];
  }
  if (selfId) {
    for (const room of Object.values(state.rooms)) {
      if (room.users[selfId]) room.users[selfId].hasCamera = false;
    }
    const u = state.users.find(x => x.id === selfId);
    if (u) u.hasCamera = false;
  }
  if (dom.cameraBtnLabel) dom.cameraBtnLabel.textContent = 'Camera Off';
  if (dom.cameraBtnHeader) dom.cameraBtnHeader.classList.remove('camera-on');
  import('./rooms.js').then(({ updateEventsCamGrid }) => updateEventsCamGrid()).catch(() => {});
}

/**
 * Rimuove una camera remota dalla grid/UI (stessa procedura di handleCamClosed lato viewer).
 * Usata quando: timeout flusso, disconnect 15s, connection failed dopo retry, refresh pagina altrui.
 * NON imposta manuallyClosedCameras così la cam può essere richiesta di nuovo quando tornano.
 */
export async function removeRemoteCameraFromGrid(uid) {
  const cw = state.cameraWindows[uid];
  if (!cw) return;
  if (cw.streamCheckInterval) {
    clearInterval(cw.streamCheckInterval);
    cw.streamCheckInterval = null;
  }
  if (cw.stream) {
    cw.stream.getTracks().forEach(t => t.stop());
    cw.stream = null;
  }
  if (cw.isEventsGrid) {
    const slot = cw.el;
    if (slot && slot.parentNode) slot.remove();
    const { updateEventsCamGrid } = await import('./rooms.js');
    updateEventsCamGrid();
  } else {
    stopMicMeter(uid);
    cw.el.remove();
  }
  delete state.cameraWindows[uid];
  if (state.incomingPCs[uid]) {
    try { state.incomingPCs[uid].close(); } catch {}
    delete state.incomingPCs[uid]; delete state.pendingIncomingICE[uid];
  }
  for (const room of Object.values(state.rooms)) {
    if (room.users[uid]) room.users[uid].hasCamera = false;
  }
  const u = state.users.find(u => u.id === uid);
  if (u) u.hasCamera = false;
  /* Togli dalla lista online della stanza attiva così grid e lista si aggiornano insieme */
  const ar = state.activeRoom;
  if (ar && state.rooms[ar]?.users[uid]) {
    delete state.rooms[ar].users[uid];
  }
  renderUsers();
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
  if (state.incomingPCs[uid]) { state.incomingPCs[uid].close(); delete state.incomingPCs[uid]; delete state.pendingIncomingICE[uid]; }

  /* Clear hasCamera in ALL joined rooms for this user */
  for (const room of Object.values(state.rooms)) {
    if (room.users[uid]) room.users[uid].hasCamera = false;
  }
  const u = state.users.find(u => u.id === uid);
  if (u) u.hasCamera = false;
  /* Togli dalla lista online così grid e lista si aggiornano insieme */
  const ar = state.activeRoom;
  if (ar && state.rooms[ar]?.users[uid]) {
    delete state.rooms[ar].users[uid];
  }

  /* CRITICO: Rimuovi il flag di chiusura manuale quando la camera viene effettivamente chiusa dall'altro utente */
  /* Questo permette all'utente di richiedere di nuovo la camera in futuro se vuole */
  if (state.manuallyClosedCameras[uid]) {
    delete state.manuallyClosedCameras[uid];
    console.log('[Camera] Removed manual close flag for', uid, '- camera was closed by owner');
  }

  renderUsers();
  if (inMyRoom) showToast(`📹 ${payload.fromName} turned off their camera`);
}

function toggleCamMic(uid) {
  const cw = state.cameraWindows[uid]; if (!cw) return;
  cw.micEnabled = !cw.micEnabled;
  state.localStream?.getAudioTracks().forEach(t => { t.enabled = cw.micEnabled; });
  const mb = $(`cam-mic-btn-${safeId(uid)}`), on = $(`cam-mic-on-${safeId(uid)}`), off = $(`cam-mic-off-${safeId(uid)}`);
  if (mb) { mb.setAttribute('aria-pressed', String(cw.micEnabled)); mb.classList.toggle('mic-muted', !cw.micEnabled); }
  if (on)  on.style.display  = cw.micEnabled ? '' : 'none';
  if (off) off.style.display = cw.micEnabled ? 'none' : '';
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

/* ── Pipeline audio: GainNode per controllare volume mic (barra verticale alza/abbassa) ── */
function createMicVolumePipeline(stream) {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return null;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    const gainNode = ctx.createGain();
    gainNode.gain.value = 1;
    const dest = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    src.connect(gainNode);
    gainNode.connect(dest);
    src.connect(analyser);
    const newAudioTrack = dest.stream.getAudioTracks()[0];
    stream.removeTrack(audioTrack);
    stream.addTrack(newAudioTrack);
    return { gainNode, analyser, ctx };
  } catch (err) {
    console.warn('[Camera] createMicVolumePipeline failed:', err);
    return null;
  }
}

export async function startOwnCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { showToast('⚠️ Camera not supported.'); return; }
  try {
    const msSince = Date.now() - state.cameraClosedAt;
    if (msSince < 450) await new Promise(r => setTimeout(r, 450 - msSince));
    state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
    state.micPipeline = createMicVolumePipeline(state.localStream) || null;
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
    
    /* CRITICO: Aggiorna prima la presenza locale per assicurarsi che sia corretta */
    /* Questo deve essere fatto PRIMA di aggiornare la presenza in Supabase */
    for (const [rId, room] of Object.entries(state.rooms)) {
      if (room.users[state.currentUser.id]) {
        room.users[state.currentUser.id].hasCamera = (rId === state.cameraRoom);
      } else {
        /* Se l'utente non è ancora nella stanza, aggiungilo */
        room.users[state.currentUser.id] = {
          ...state.currentUser,
          hasCamera: (rId === state.cameraRoom)
        };
      }
    }
    
    /* Aggiorna anche state.currentUser.hasCamera per coerenza */
    state.currentUser.hasCamera = true;
    
    /* Broadcast e aggiorna presenza in Supabase */
    broadcastAll('cam-opened', { room_id: state.cameraRoom, videoOff: state.cameraWindows[state.currentUser?.id]?.videoOff === true });
    
    /* Aggiorna la presenza in tutte le stanze - chiama più volte per assicurarsi che sia propagata */
    await updateAllRoomPresences();
    renderUsers();
    
    /* Aggiorna di nuovo dopo brevi delay per assicurarsi che la presenza sia sincronizzata */
    setTimeout(async () => {
      await updateAllRoomPresences();
      renderUsers();
    }, 300);
    
    setTimeout(async () => {
      await updateAllRoomPresences();
      renderUsers();
    }, 800);
    
    setTimeout(async () => {
      await updateAllRoomPresences();
      renderUsers();
    }, 1500);
    
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
  const pipeline = state.micPipeline;
  if (!pipeline?.analyser) return;
  try {
    const an = pipeline.analyser;
    const data = new Uint8Array(an.frequencyBinCount);
    const SPEAKING_THRESHOLD = 18;
    function tick() {
      an.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const pct = Math.min(100, Math.round((avg / 70) * 100));
      const win = state.cameraWindows[uid]?.el;
      if (win) win.classList.toggle('cam-speaking', (state.cameraWindows[uid]?.micEnabled !== false) && pct > SPEAKING_THRESHOLD);
      if (state.micAnalysers[uid]) state.micAnalysers[uid].raf = requestAnimationFrame(tick);
    }
    state.micAnalysers[uid] = { ctx: pipeline.ctx, raf: requestAnimationFrame(tick) };
  } catch (err) { console.warn('Mic speaking indicator:', err); }
}

function stopMicMeter(uid) {
  const a = state.micAnalysers[uid]; if (!a) return;
  if (a.raf) cancelAnimationFrame(a.raf);
  if (a.ctx && a.ctx !== state.micPipeline?.ctx) a.ctx.close().catch(() => {});
  delete state.micAnalysers[uid];
  const win = state.cameraWindows[uid]?.el;
  if (win) win.classList.remove('cam-speaking');
}

/* ── Indicatore "sta parlando" per cam remota (analisi audio stream remoto) ── */
function startRemoteSpeakingIndicator(uid, stream) {
  stopRemoteSpeakingIndicator(uid);
  const audioTrack = stream?.getAudioTracks()[0];
  if (!audioTrack) {
    setTimeout(() => {
      const s = state.cameraWindows[uid]?.stream;
      if (s) startRemoteSpeakingIndicator(uid, s);
    }, 400);
    return;
  }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const SPEAKING_THRESHOLD = 18;
    function tick() {
      if (!state.cameraWindows[uid]) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const win = state.cameraWindows[uid]?.el;
      if (win) win.classList.toggle('cam-speaking', avg > SPEAKING_THRESHOLD);
      if (state.remoteMicAnalysers[uid]) state.remoteMicAnalysers[uid].raf = requestAnimationFrame(tick);
    }
    state.remoteMicAnalysers[uid] = { ctx, raf: requestAnimationFrame(tick) };
  } catch (err) { console.warn('[Camera] Remote speaking indicator:', err); }
}

function stopRemoteSpeakingIndicator(uid) {
  const a = state.remoteMicAnalysers[uid];
  if (a) {
    if (a.raf) cancelAnimationFrame(a.raf);
    if (a.ctx) a.ctx.close().catch(() => {});
    delete state.remoteMicAnalysers[uid];
  }
  const win = state.cameraWindows[uid]?.el;
  if (win) win.classList.remove('cam-speaking');
}

/* ── Controllo volume mic: barra con pallina (cursor grab) ── */
function initMicVolumeSlider(uid) {
  const wrap = $(`mic-volume-wrap-${safeId(uid)}`);
  const fill = $(`mic-fill-${safeId(uid)}`);
  const thumb = $(`mic-thumb-${safeId(uid)}`);
  const pipeline = state.micPipeline;
  if (!wrap || !fill || !pipeline?.gainNode) return;
  const gainNode = pipeline.gainNode;
  const setVolumeFromPct = (pct) => {
    const clamped = Math.max(0, Math.min(100, pct));
    const gain = clamped / 100;
    gainNode.gain.value = gain;
    fill.style.width = clamped + '%';
    if (thumb) thumb.style.left = clamped + '%';
  };
  setVolumeFromPct(100);
  const onInput = (e) => {
    const rect = wrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const pct = (x / rect.width) * 100;
    setVolumeFromPct(pct);
  };
  wrap.addEventListener('mousedown', (e) => {
    e.preventDefault();
    wrap.classList.add('grabbing');
    onInput(e);
    const move = (ev) => onInput(ev);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      wrap.classList.remove('grabbing');
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  wrap.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onInput(e);
    const move = (ev) => { ev.preventDefault(); onInput(ev); };
    const end = () => {
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
  });
}

/* ── Volume e mute della voce della cam remota (Web Audio: gain + indicatore "sta parlando") ── */
function initRemoteVolumeControl(uid) {
  const cw = state.cameraWindows[uid];
  const stream = cw?.stream;
  const muteBtn = $(`cam-remote-mute-${safeId(uid)}`);
  const wrap = $(`cam-remote-volume-wrap-${safeId(uid)}`);
  const fill = $(`cam-remote-fill-${safeId(uid)}`);
  const thumb = $(`cam-remote-thumb-${safeId(uid)}`);
  const video = $(`cam-vid-${safeId(uid)}`);
  if (!wrap || !video) return;

  const audioTrack = stream?.getAudioTracks()[0];
  let remoteCtx = null;
  let remoteGain = null;
  let analyser = null;

  if (audioTrack) {
    try {
      remoteCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (remoteCtx.state === 'suspended') remoteCtx.resume().catch(() => {});
      const src = remoteCtx.createMediaStreamSource(new MediaStream([audioTrack]));
      remoteGain = remoteCtx.createGain();
      remoteGain.gain.value = 1;
      src.connect(remoteGain);
      remoteGain.connect(remoteCtx.destination);
      video.muted = true; /* audio da Web Audio, non dal video */

      /* stesso stream per indicatore "sta parlando" */
      analyser = remoteCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const SPEAKING_THRESHOLD = 18;
      function tick() {
        if (!state.cameraWindows[uid]) return;
        if (remoteCtx.state === 'suspended') remoteCtx.resume().catch(() => {});
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const win = state.cameraWindows[uid]?.el;
        if (win) win.classList.toggle('cam-speaking', avg > SPEAKING_THRESHOLD);
        if (cw.remoteVolumeCtx) cw.remoteSpeakRaf = requestAnimationFrame(tick);
      }
      cw.remoteVolumeCtx = remoteCtx;
      cw.remoteSpeakRaf = requestAnimationFrame(tick);
    } catch (err) { console.warn('[Camera] Remote Web Audio failed:', err); }
  }

  if (!remoteGain) video.muted = false;

  let lastVolumePct = 100;
  const setVolumeFromPct = (pct) => {
    const clamped = Math.max(0, Math.min(100, pct));
    lastVolumePct = clamped;
    const vol = clamped / 100;
    if (remoteGain) remoteGain.gain.value = vol;
    else { video.volume = vol; if (vol > 0) video.muted = false; }
    if (fill) fill.style.width = clamped + '%';
    if (thumb) thumb.style.left = clamped + '%';
  };
  setVolumeFromPct(100);

  let isMuted = false;
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      isMuted = !isMuted;
      if (remoteGain) remoteGain.gain.value = isMuted ? 0 : lastVolumePct / 100;
      else video.muted = isMuted;
      muteBtn.setAttribute('aria-pressed', String(isMuted));
      muteBtn.textContent = isMuted ? '🔇' : '🔊';
    });
  }

  const onInput = (e) => {
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const pct = (x / rect.width) * 100;
    setVolumeFromPct(pct);
    if (isMuted && pct > 0) { isMuted = false; if (muteBtn) { muteBtn.setAttribute('aria-pressed', 'false'); muteBtn.textContent = '🔊'; } }
  };
  wrap.addEventListener('mousedown', (e) => {
    e.preventDefault();
    wrap.classList.add('grabbing');
    onInput(e);
    const move = (ev) => onInput(ev);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      wrap.classList.remove('grabbing');
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  wrap.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onInput(e);
    const move = (ev) => { ev.preventDefault(); onInput(ev); };
    const end = () => {
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
  });
}

function closeRemoteVolumeContext(uid) {
  const cw = state.cameraWindows[uid];
  if (!cw) return;
  if (cw.remoteSpeakRaf) cancelAnimationFrame(cw.remoteSpeakRaf);
  cw.remoteSpeakRaf = null;
  if (cw.remoteVolumeCtx) {
    cw.remoteVolumeCtx.close().catch(() => {});
    cw.remoteVolumeCtx = null;
  }
}

function updateVideoToggleButton(uid) {
  const cw = state.cameraWindows[uid];
  const btn = $(`cam-video-toggle-btn-${safeId(uid)}`);
  if (!btn) return;
  const onIcon = btn.querySelector('.cam-video-icon-on');
  const offIcon = btn.querySelector('.cam-video-icon-off');
  const isOff = !!cw?.videoOff;
  btn.setAttribute('aria-pressed', String(isOff));
  btn.title = isOff ? 'Riattiva video' : 'Disattiva video (solo voce)';
  if (onIcon) onIcon.hidden = isOff;
  if (offIcon) offIcon.hidden = !isOff;
  btn.classList.toggle('cam-video-off', isOff);
}

/* ── Cam remota: mostra video o placeholder (Solo voce / Video nascosto) ── */
function updateRemoteVideoVisibility(uid) {
  const cw = state.cameraWindows[uid];
  if (!cw || cw.isOwn) return;
  const videoEl = $(`cam-vid-${safeId(uid)}`);
  const placeholder = $(`cam-solo-voce-${safeId(uid)}`);
  if (!videoEl || !placeholder) return;
  const showVideo = !cw.videoHiddenByMe && !cw.videoOff && !cw.remoteSenderVideoOff;
  videoEl.style.display = showVideo ? '' : 'none';
  placeholder.hidden = showVideo;
  if (!showVideo) {
    const txt = placeholder.querySelector('.cam-solo-voce-txt');
    if (txt) txt.textContent = cw.videoHiddenByMe ? 'Video nascosto' : 'Solo voce';
  }
}

/** Chiamato quando riceviamo broadcast cam-video-off: il remoto ha disattivato/riattivato il video (solo voce). */
export function setRemoteSenderVideoOff(remoteUid, videoOff) {
  const cw = state.cameraWindows[remoteUid];
  if (!cw || cw.isOwn) return;
  cw.remoteSenderVideoOff = !!videoOff;
  updateRemoteVideoVisibility(remoteUid);
}

/* ── Toggle solo voce nella propria cam (nascondi video, solo audio) ── */
function toggleSoloVoce(uid) {
  const cw = state.cameraWindows[uid];
  if (!cw?.isOwn || !state.localStream) return;
  const videoEl = $(`cam-vid-${safeId(uid)}`);
  const placeholder = $(`cam-solo-voce-${safeId(uid)}`);
  if (!videoEl) return;
  const videoTrack = state.localStream.getVideoTracks()[0];
  cw.videoOff = !cw.videoOff;
  if (videoTrack) videoTrack.enabled = !cw.videoOff;
  if (cw.videoOff) {
    videoEl.style.display = 'none';
    if (placeholder) placeholder.hidden = false;
  } else {
    videoEl.style.display = '';
    if (placeholder) placeholder.hidden = true;
  }
  updateVideoToggleButton(uid);
  /* Notifica i viewer così mostrano placeholder "Solo voce" invece di schermo nero */
  broadcastAll('cam-video-off', { from: state.currentUser.id, videoOff: cw.videoOff });
}

/* ── Cambio camera on the fly (dropdown in footer) ── */
async function openCameraDeviceDropdown(uid, dropdownEl) {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const videoDevices = devices.filter(d => d.kind === 'videoinput');
  const currentId = state.settings?.cameraId || '';
  dropdownEl.innerHTML = '';
  if (videoDevices.length === 0) {
    dropdownEl.innerHTML = '<div class="cam-device-item cam-device-empty">Nessuna camera</div>';
    return;
  }
  videoDevices.forEach(dev => {
    const label = dev.label || `Camera ${dev.deviceId.slice(0, 8)}`;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'cam-device-item' + (dev.deviceId === currentId ? ' active' : '');
    item.textContent = label;
    item.dataset.deviceId = dev.deviceId;
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      dropdownEl.hidden = true;
      if (dev.deviceId !== currentId) await switchCameraDevice(uid, dev.deviceId);
    });
    dropdownEl.appendChild(item);
  });
}

async function switchCameraDevice(ownUid, deviceId) {
  if (!state.localStream || !state.cameraWindows[ownUid]) return;
  const oldVideoTrack = state.localStream.getVideoTracks()[0];
  if (!oldVideoTrack) return;
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: state.settings?.micId ? { deviceId: { exact: state.settings.micId } } : true,
    });
    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) { newStream.getTracks().forEach(t => t.stop()); return; }
    state.localStream.removeTrack(oldVideoTrack);
    oldVideoTrack.stop();
    state.localStream.addTrack(newVideoTrack);
    newStream.getAudioTracks().forEach(t => t.stop());
    state.settings = state.settings || {};
    state.settings.cameraId = deviceId;
    saveDeviceSettings(state.settings);

    const videoEl = $(`cam-vid-${safeId(ownUid)}`);
    if (videoEl && videoEl.srcObject === state.localStream) {
      videoEl.srcObject = null;
      videoEl.srcObject = state.localStream;
    }
    Object.keys(state.outgoingPCs).forEach(peerId => {
      const pc = state.outgoingPCs[peerId];
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(newVideoTrack).catch(console.warn);
    });
    showToast('📹 Camera cambiata.');
  } catch (err) {
    console.warn('[Camera] switchCameraDevice failed:', err);
    showToast('⚠️ Impossibile cambiare camera.');
  }
}

/**
 * Su smartphone quando si cambia app e si torna nel browser, il tab può essere
 * sospeso e lo stream della camera (getUserMedia) viene fermato → video nero.
 * Al ritorno in pagina rileviamo track non più "live" e riacquisiamo lo stream.
 */
async function recoverLocalStreamAfterVisibility() {
  if (!state.localStream || state.cameraRoom == null) return;
  const videoTrack = state.localStream.getVideoTracks()[0];
  const audioTrack = state.localStream.getAudioTracks()[0];
  const stillLive = state.localStream.active &&
    videoTrack?.readyState === 'live' &&
    (!audioTrack || audioTrack.readyState === 'live');
  if (stillLive) return;

  const ownUid = state.currentUser?.id;
  if (!ownUid || !state.cameraWindows[ownUid]) return;

  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const newStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = newStream;
    state.micPipeline = createMicVolumePipeline(state.localStream) || null;

    const cw = state.cameraWindows[ownUid];
    const videoEl = cw?.el?.querySelector?.('video') || $(`cam-vid-${safeId(ownUid)}`);
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.srcObject = state.localStream;
      videoEl.play().catch(() => {});
    }

    Object.keys(state.outgoingPCs).forEach(peerId => {
      const pc = state.outgoingPCs[peerId];
      const newVideo = state.localStream.getVideoTracks()[0];
      const newAudio = state.localStream.getAudioTracks()[0];
      pc.getSenders().forEach(sender => {
        if (sender.track?.kind === 'video' && newVideo) sender.replaceTrack(newVideo).catch(() => {});
        if (sender.track?.kind === 'audio' && newAudio) sender.replaceTrack(newAudio).catch(() => {});
      });
    });

    startMicMeter(state.localStream, ownUid);
    showToast('📹 Camera ripristinata.');
  } catch (err) {
    console.warn('[Camera] recoverLocalStreamAfterVisibility failed:', err);
    showToast('⚠️ Ripristino camera non riuscito. Prova a disattivare e riattivare la camera.');
  }
}

export function initCameraSystem() {
  dom.cameraBtnHeader.addEventListener('click', toggleOwnCamera);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recoverLocalStreamAfterVisibility();
  });
}

/* ── Public camera request ────────────────────────────────────── */
export function requestPublicCamera(targetUid) {
  const uid    = String(targetUid);
  const target = findUser(uid);
  console.log('[WebRTC-FLOW] CAM-REQ: request camera from', (uid || '').slice(0, 8) + '…', 'target=', (target?.id || '').slice(0, 8) + '…');
  if (!target?.online) { 
    console.warn('[Camera Request] Target is offline:', target);
    showToast(`${target?.name || 'User'} is offline.`); 
    return; 
  }
  if (!state.fb) { 
    console.warn('[Camera Request] Backend not connected');
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
  
  /* If already viewing (slot exists in grid or floating window), skip */
  if (state.cameraWindows[uid]) { 
    console.log('[Camera Request] Already viewing camera from', uid);
    return; 
  }
  /* If an incoming PC already exists and is connected/connecting, skip */
  const existingInPC = state.incomingPCs[uid];
  if (existingInPC && (existingInPC.connectionState === 'connected' || existingInPC.connectionState === 'connecting' || existingInPC.iceConnectionState === 'connected' || existingInPC.iceConnectionState === 'checking')) {
    console.log('[Camera Request] Incoming PC for', uid, 'already exists in state:', existingInPC.connectionState, '/ ICE:', existingInPC.iceConnectionState, '— skipping duplicate request');
    return;
  }
  if (state.pendingCamRequests[uid]) { 
    console.log('[Camera Request] Already waiting for reply from', uid);
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

  /* room_id e confronti in stringa per evitare problemi PC (number vs string dopo 15s / tab switch) */
  const requestRoom = payload.room_id != null ? String(payload.room_id) : null;
  const availableRooms = getAvailableRooms();
  const roomData = requestRoom ? availableRooms.find(r => String(r.id) === requestRoom) : null;
  const isEventsRoom = !!(roomData?.max_cams && roomData.max_cams >= 1 && roomData.max_cams <= 8);

  const activeRoomStr = state.activeRoom != null ? String(state.activeRoom) : '';
  const cameraRoomStr = state.cameraRoom != null ? String(state.cameraRoom) : '';
  const weAreInRequestRoom = requestRoom && requestRoom === activeRoomStr;
  /* Su PC dopo 15s/tab switch cameraRoom può essere vuoto anche con stream attivo: usa anche activeRoom se abbiamo localStream */
  const ourCamIsInRequestRoom = requestRoom && (requestRoom === cameraRoomStr || (state.localStream && requestRoom === activeRoomStr));
  const wouldAutoAcceptEvents = payload.reqType === 'public' && isEventsRoom && (weAreInRequestRoom || ourCamIsInRequestRoom);

  /* Per Eventi: rimuovi eventuale blocco residuo in rejectedCamUsers (es. da sessione precedente / PC dopo 15s) */
  if (wouldAutoAcceptEvents && state.rejectedCamUsers[fromId]) {
    removeRejectedCam(fromId);
    console.log('[Events Room] Cleared stale rejected for', fromName || fromId, '- auto-accepting Events request');
  }

  /* Auto-reject if blocked or ignored */
  if (state.rejectedCamUsers[fromId] || state.ignoredUsers[fromId]) {
    broadcast('cam-rejected', fromId, { reqType: payload.reqType || 'public' });
    return;
  }

  /* Auto-reject only if the request is for a room we're not in AND not the room where our cam is */
  if (requestRoom && requestRoom !== activeRoomStr && requestRoom !== cameraRoomStr) {
    broadcast('cam-rejected', fromId, { reqType: payload.reqType || 'public', reason: 'wrong-room' });
    return;
  }

  /* Auto-accept SOLO ed esclusivamente per la stanza Eventi (max_cams 1-8) */
  if (wouldAutoAcceptEvents) {
    console.log('[Events Room] Auto-accepting camera request from', fromName || fromId, '(only for Events room)');
    sharePublicCameraTo(fromId);
    return;
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
    dom.camAcceptBtn.onclick = async () => {
      if (isRoomCameraActive()) { showToast('Disattiva prima la cam nella stanza.'); return; }
      dom.camReqOverlay.hidden = true;
      await acceptPrivateCall(fromId, fromName);
    };
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
  console.log('[WebRTC-FLOW] sharePublicCameraTo called → will send offer to', (toUid || '').slice(0, 8) + '…');
  try {
    if (!state.localStream) {
      const msSince = Date.now() - state.cameraClosedAt;
      if (msSince < 450) await new Promise(r => setTimeout(r, 450 - msSince));
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.micPipeline = createMicVolumePipeline(state.localStream) || null;
      state.currentUser.hasCamera = true;
      state.cameraRoom = state.activeRoom;
      dom.cameraBtnLabel.textContent = 'Camera On'; dom.cameraBtnHeader.classList.add('camera-on');
      createCameraWindow(state.currentUser.id, state.localStream, 'You', true);
      broadcastAll('cam-opened', { room_id: state.cameraRoom, videoOff: state.cameraWindows[state.currentUser?.id]?.videoOff === true });
      await updateAllRoomPresences();
    }
    console.log('[WebRTC-FLOW] OUTGOING PC: create for', (toUid || '').slice(0, 8) + '…');
    /* Close existing peer connection if it exists */
    if (state.outgoingPCs[toUid]) {
      console.log('[WebRTC-FLOW] OUTGOING: close existing for', (toUid || '').slice(0, 8) + '…');
      const oldPc = state.outgoingPCs[toUid];
      oldPc.close();
      delete state.outgoingPCs[toUid];
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    state.outgoingPCs[toUid] = pc;
    const tracks = state.localStream.getTracks().filter(t => t.readyState === 'live');
    console.log('[WebRTC-FLOW] OUTGOING: add', tracks.length, 'tracks to', (toUid || '').slice(0, 8) + '…');
    tracks.forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log('[WebRTC-FLOW] TX ICE dir=out to', (toUid || '').slice(0, 8) + '…', 'type=', candidate.type);
        /* dir:'out' = from our outgoing PC → guest adds to their incomingPC */
        broadcast('webrtc', toUid, { sigType: 'ice', candidate, ctx: 'public', dir: 'out' });
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log('[WebRTC-FLOW] OUTGOING: send offer to', (toUid || '').slice(0, 8) + '…', 'sdpLen=', offer.sdp?.length);
    broadcast('webrtc', toUid, { sigType: 'offer', sdp: offer.sdp, ctx: 'public', room_id: state.cameraRoom });
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

/* Filtro anti-replay Firebase: child_added consegna tutti i messaggi passati → scarta webrtc scritti prima della nostra connessione */
const WEBRTC_CONNECT_SKEW_MS = 5000;

/* ── All incoming WebRTC signals ──────────────────────────────── */
export async function handleWebRTCSignal(payload) {
  if (payload.to !== state.currentUser?.id) return;
  const { sigType, from, sdp, candidate, dir } = payload;
  const isPublic = payload.ctx === 'public', isPrivate = payload.ctx === 'private';

  /* Firebase replay: ignora webrtc pubblici scritti prima che ci connettessimo (evita cam che riappaiono al refresh) */
  if (isPublic && payload._ts != null && state.broadcastConnectedAt > 0 && payload._ts < state.broadcastConnectedAt - WEBRTC_CONNECT_SKEW_MS) return;

  if (isPublic) {
      if (sigType === 'offer') {
        /* Serializza per peer: replay Firebase può consegnare la stessa offer più volte; la seconda deve aspettare la prima e poi uscire. */
        const prev = state._incomingOfferDone[from] || Promise.resolve();
        let doneResolve;
        state._incomingOfferDone[from] = new Promise(r => { doneResolve = r; });
        try {
          await prev;
        } catch (_) {}
        try {
          if (state.manuallyClosedCameras[from]) return;
          if (state.incomingPCs[from]) return;

      /* Guard: camera solo in stanza Eventi e noi non siamo in quella stanza → rifiuta */
      const availableRooms = getAvailableRooms();
      const eventsRooms = availableRooms.filter(r => r.max_cams && r.max_cams >= 1 && r.max_cams <= 8);
      const guestHasCamInEventsOnly = eventsRooms.some(eventsRoom => {
        const roomIdStr = String(eventsRoom.id);
        const room = state.rooms[roomIdStr];
        const guestInRoom = room?.users[from];
        return guestInRoom?.hasCamera === true;
      }) && !Object.values(state.rooms).some(room => {
        const guestInRoom = room.users[from];
        const isEventsRoom = eventsRooms.some(er => String(er.id) === String(room.id));
        return guestInRoom?.hasCamera === true && !isEventsRoom; /* has cam in non-Events room */
      });
      
      if (guestHasCamInEventsOnly) {
        const guestEventsRoom = eventsRooms.find(eventsRoom => {
          const roomIdStr = String(eventsRoom.id);
          const room = state.rooms[roomIdStr];
          return room?.users[from]?.hasCamera === true;
        });
        const guestEventsRoomId = guestEventsRoom ? String(guestEventsRoom.id) : null;
        const isInGuestEventsRoom = guestEventsRoomId && String(state.activeRoom) === guestEventsRoomId;
        
        if (!isInGuestEventsRoom) {
          console.log('[WebRTC] Rejecting offer from', from, '— guest has camera only in Events room', guestEventsRoomId, 'but we are in room', state.activeRoom);
          return; /* Don't create PC — guest's cam is for Events room only */
        }
      }
      
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pc._createdInRoom = state.activeRoom; /* Track room at creation — used to discard stale streams */
      pc._camRoom = payload.room_id != null ? String(payload.room_id) : null; /* room where cam was opened (from offer) */
      state.incomingPCs[from] = pc;
      pc.onicecandidate = ({ candidate: c }) => {
        if (c) broadcast('webrtc', from, { sigType: 'ice', candidate: c, ctx: 'public', dir: 'in' });
      };
      
      /* Apri finestra al primo ontrack (così la cam si apre subito quando si accetta la richiesta); al secondo track (video) reattach per evitare nero */
      let streamOpened = false;
      
      pc.ontrack = ({ streams, track }) => {
        if (!streams || !streams[0]) return;
        const stream = streams[0];
        ensureUser(from, payload.fromName);
        
        /* Secondo track: aggiungi allo stream della finestra e reattach video per evitare nero */
        const cw = state.cameraWindows[from];
        if (streamOpened && cw?.stream) {
          if (track?.kind === 'video' && !cw.stream.getVideoTracks().length) {
            cw.stream.addTrack(track);
            cw.videoOff = false;
            updateRemoteVideoVisibility(from);
            const vid = cw.el?.querySelector?.('video') || document.getElementById(`cam-vid-${safeId(from)}`);
            if (vid) {
              vid.srcObject = null;
              vid.srcObject = cw.stream;
              vid.muted = true;
              vid.play().then(() => { if (!cw.isOwn) vid.muted = false; }).catch(() => {});
            }
          } else if (track?.kind === 'audio' && !cw.stream.getAudioTracks().length) {
            cw.stream.addTrack(track);
            closeRemoteVolumeContext(from);
            initRemoteVolumeControl(from);
          }
          return;
        }
        streamOpened = true;
        
        /* Guard: stanza / manually closed / camRoom */
        if (pc._createdInRoom && String(pc._createdInRoom) !== String(state.activeRoom)) {
          try { pc.close(); } catch {}
          if (state.incomingPCs[from] === pc) delete state.incomingPCs[from]; delete state.pendingIncomingICE[from];
          return;
        }
        const availableRooms = getAvailableRooms();
        const eventsRooms = availableRooms.filter(r => r.max_cams && r.max_cams >= 1 && r.max_cams <= 8);
        const guestHasCamInEventsOnly = eventsRooms.some(eventsRoom => {
          const roomIdStr = String(eventsRoom.id);
          const room = state.rooms[roomIdStr];
          const guestInRoom = room?.users[from];
          return guestInRoom?.hasCamera === true;
        }) && !Object.values(state.rooms).some(room => {
          const guestInRoom = room.users[from];
          const isEventsRoom = eventsRooms.some(er => String(er.id) === String(room.id));
          return guestInRoom?.hasCamera === true && !isEventsRoom;
        });
        if (guestHasCamInEventsOnly) {
          const guestEventsRoom = eventsRooms.find(eventsRoom => {
            const roomIdStr = String(eventsRoom.id);
            const room = state.rooms[roomIdStr];
            return room?.users[from]?.hasCamera === true;
          });
          const guestEventsRoomId = guestEventsRoom ? String(guestEventsRoom.id) : null;
          const isInGuestEventsRoom = guestEventsRoomId && String(state.activeRoom) === guestEventsRoomId;
          if (!isInGuestEventsRoom) {
            try { pc.close(); } catch {}
            if (state.incomingPCs[from] === pc) delete state.incomingPCs[from]; delete state.pendingIncomingICE[from];
            return;
          }
        }
        if (state.manuallyClosedCameras[from]) return;
        const camRoom = pc._camRoom || payload.room_id || null;
        if (camRoom && String(camRoom) !== String(state.activeRoom)) return;
        
        /* Apri subito al primo track (audio o video): la finestra compare quando accetti; il video si aggiorna al secondo ontrack con reattach */
        openRemoteCamWindow(from, stream, payload.fromName);
      };
      
      /* Monitor incoming connection — auto-reconnect if it fails */
      let reconnectAttempts = 0;
      const MAX_RECONNECT = 3;
      /* Se resta "connecting" o "new" per 45s, togli dalla grid (prima 25s: troppo poco con replay Firebase / rete lenta) */
      const CONNECTING_TIMEOUT_MS = 45000;
      let connectingTimeout = setTimeout(() => {
        if (state.incomingPCs[from] !== pc) return;
        if (pc.connectionState === 'connecting' || pc.connectionState === 'new') {
          console.warn('[WebRTC-FLOW] INCOMING TIMEOUT', CONNECTING_TIMEOUT_MS / 1000, 's for', from, '| connectionState=', pc.connectionState, 'iceState=', pc.iceConnectionState, '→ remove from grid');
          try { pc.close(); } catch {}
          delete state.incomingPCs[from]; delete state.pendingIncomingICE[from];
          removeRemoteCameraFromGrid(from).catch(() => {});
        }
      }, CONNECTING_TIMEOUT_MS);

      pc.addEventListener('connectionstatechange', () => {
        console.log('[WebRTC] Connection state changed:', pc.connectionState, 'for', from);
        if (pc.connectionState === 'connected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          clearTimeout(connectingTimeout);
        }
        
        /* CRITICO: Per disconnected, NON chiudere immediatamente - potrebbe riconnettersi */
        /* Chiudi solo se rimane disconnected per più di 15 secondi */
        if (pc.connectionState === 'disconnected') {
          const cw = state.cameraWindows[from];
          if (cw && !cw.disconnectTimer) {
            console.log('[WebRTC] Connection disconnected for', from, '- will remove from grid if not reconnected in 15s');
            cw.disconnectTimer = setTimeout(() => {
              /* Dopo 15s ancora disconnected/failed: togli dalla grid (come refresh). Non dipendere da hasActiveTracks: può restare "live" anche con connessione morta. */
              if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                console.log('[WebRTC] Still disconnected/failed after 15s for', from, '- removing camera from grid');
                removeRemoteCameraFromGrid(from).catch(() => {});
              }
              if (cw) delete cw.disconnectTimer;
            }, 15000);
          }
        }
        
        /* CRITICO: Se si riconnette, cancella il timer di chiusura */
        if (pc.connectionState === 'connected' || pc.connectionState === 'connecting') {
          const cw = state.cameraWindows[from];
          if (cw?.disconnectTimer) {
            clearTimeout(cw.disconnectTimer);
            delete cw.disconnectTimer;
            console.log('[WebRTC] Connection reconnected for', from, '- cancelled close timer');
          }
        }
        
        if (pc.connectionState === 'failed') {
          if (state.incomingPCs[from] !== pc) return;
          delete state.incomingPCs[from]; delete state.pendingIncomingICE[from];

          /* Rimuovi slot SUBITO in modo sincrono (così non resta mai schermo nero), poi cleanup completo e eventuale reconnect */
          const cw = state.cameraWindows[from];
          if (cw) {
            if (cw.streamCheckInterval) { clearInterval(cw.streamCheckInterval); cw.streamCheckInterval = null; }
            if (cw.stream) { cw.stream.getTracks().forEach(t => t.stop()); cw.stream = null; }
            if (cw.isEventsGrid && cw.el?.parentNode) cw.el.remove();
            else if (cw.el?.parentNode) { stopMicMeter(from); cw.el.remove(); }
            delete state.cameraWindows[from];
            import('./rooms.js').then(({ updateEventsCamGrid }) => updateEventsCamGrid()).catch(() => {});
            for (const room of Object.values(state.rooms)) { if (room.users[from]) room.users[from].hasCamera = false; }
            const u = state.users.find(usr => usr.id === from);
            if (u) u.hasCamera = false;
            /* Togli dalla lista online così grid e lista si aggiornano insieme */
            if (state.activeRoom && state.rooms[state.activeRoom]?.users[from]) {
              delete state.rooms[state.activeRoom].users[from];
            }
            renderUsers();
          }

          removeRemoteCameraFromGrid(from).then(() => {
            if (reconnectAttempts >= MAX_RECONNECT) return;
            reconnectAttempts++;
            const delay = reconnectAttempts * 2000;
            console.log('[WebRTC] Incoming failed for', from, '— reconnect attempt', reconnectAttempts, 'of', MAX_RECONNECT, 'in', delay, 'ms');
            setTimeout(() => {
              if (pc._createdInRoom && String(state.activeRoom) !== String(pc._createdInRoom)) return;
              if (state.manuallyClosedCameras[from]) return;
              const user = findUser(from);
              if (user?.hasCamera && user?.online && !state.cameraWindows[from] && !state.incomingPCs[from]) {
                console.log('[WebRTC] Re-requesting camera from', from);
                delete state.pendingCamRequests[from];
                requestPublicCamera(from);
              }
            }, delay);
          }).catch(() => {});

          if (reconnectAttempts >= MAX_RECONNECT) {
            console.error('[WebRTC] Max reconnect attempts reached for', from);
          }
        }
      });
      /* Retry play() quando la connessione è pronta; reattach forzato per evitare video nero (stesso LAN o remoto) */
      const retryPlay = (trigger, forceReattach = false) => {
        const cw = state.cameraWindows[from];
        if (!cw?.el) return;
        const vid = cw.el.querySelector('video');
        if (!vid) return;
        if (forceReattach && cw.stream) {
          vid.srcObject = null;
          vid.srcObject = cw.stream;
          vid.muted = true;
        }
        if (!vid.srcObject) return;
        if (!vid.paused && !forceReattach) return;
        vid.play().then(() => {
          if (!cw.isOwn) vid.muted = false;
        }).catch(() => {});
      };

      pc.addEventListener('iceconnectionstatechange', () => {
        console.log('[WebRTC] VIEWER incoming PC', from.slice(0, 8) + '…', 'iceConnectionState=', pc.iceConnectionState);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setTimeout(() => retryPlay('ICE-connected', true), 150);
          setTimeout(() => retryPlay('ICE-connected+1s', true), 1150);
        }
      });
      
      pc.addEventListener('connectionstatechange', () => {
        console.log('[WebRTC] VIEWER incoming PC', from.slice(0, 8) + '…', 'connectionState=', pc.connectionState);
        if (pc.connectionState === 'connected') {
          setTimeout(() => retryPlay('connection-connected', true), 300);
          setTimeout(() => retryPlay('connection-connected+2s', true), 2300);
        }
      });
      console.log('[WebRTC-FLOW] INCOMING: setRemoteDescription(offer) for', from);
      await pc.setRemoteDescription({ type: 'offer', sdp });
      /* Flush ICE arrivati prima dell'offer (dir 'out' da questo peer). Se sono di una vecchia sessione addIceCandidate può fallire → catch e ignora. */
      const prePcCount = state.pendingIncomingICE[from]?.length || 0;
      if (prePcCount) {
        console.log('[WebRTC-FLOW] INCOMING: flush pre-PC ICE', prePcCount, 'for', from);
        for (const c of state.pendingIncomingICE[from]) {
          await pc.addIceCandidate(c).catch(err => console.warn('[WebRTC] Pre-PC ICE flush error:', err.message));
        }
        state.pendingIncomingICE[from] = [];
      }
      /* Flush any buffered ICE candidates that arrived before the offer (on this PC) */
      const onPcCount = pc._pendingCandidates?.length || 0;
      if (onPcCount) {
        console.log('[WebRTC-FLOW] INCOMING: flush on-PC ICE', onPcCount, 'for', from);
        for (const c of pc._pendingCandidates) {
          await pc.addIceCandidate(c).catch(err => console.warn('[WebRTC] Buffered ICE flush error:', err.message));
        }
        pc._pendingCandidates = [];
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcast('webrtc', from, { sigType: 'answer', sdp: answer.sdp, ctx: 'public' });
        } finally {
          if (typeof doneResolve === 'function') doneResolve();
        }
      return;
    }
    if (sigType === 'answer') {
      const pc = state.outgoingPCs[from];
      console.log('[WebRTC-FLOW] RX answer from', from, '| hasOutgoingPC=', !!pc, pc ? 'signaling=' + pc.signalingState + ' conn=' + pc.connectionState : '');
      if (pc) {
        /* Only set remote description if we're in the correct state */
        if (pc.signalingState === 'have-local-offer') {
          try {
            console.log('[WebRTC-FLOW] OUTGOING: setRemoteDescription(answer) for', from);
            await pc.setRemoteDescription({ type: 'answer', sdp });
            console.log('[WebRTC-FLOW] OUTGOING: answer applied for', from);
            /* Flush any buffered ICE candidates that arrived before the answer */
            if (pc._pendingCandidates?.length) {
              console.log('[WebRTC] Flushing', pc._pendingCandidates.length, 'buffered ICE candidates for outgoing PC to', from);
              for (const c of pc._pendingCandidates) {
                await pc.addIceCandidate(c).catch(err => console.warn('[WebRTC] Buffered ICE flush error:', err.message));
              }
              pc._pendingCandidates = [];
            }
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
          /* Replay Firebase o answer duplicata: PC già stable, ignora senza warn */
          if (pc.signalingState !== 'stable' || pc.connectionState !== 'connected') {
            console.warn('[WebRTC] Cannot set remote answer - wrong state:', pc.signalingState, 'expected: have-local-offer');
          }
        }
      } else {
        console.log('[WebRTC-FLOW] RX answer from', from, '→ no outgoing PC (ignored)');
      }
    } else if (sigType === 'ice') {
      /* Route ICE candidate to correct PC based on 'dir' field:
         - dir:'out' means sender sent from their outgoingPC (sharing their cam TO us)
           → goes to our incomingPC (the one receiving their cam)
         - dir:'in'  means sender sent from their incomingPC (receiving our cam FROM us)
           → goes to our outgoingPC (the one sharing our cam)
         - no dir (legacy): try outgoingPC first, then incomingPC */
      let pc;
      if (dir === 'out') {
        pc = state.incomingPCs[from]; /* Their outgoing shares to us → our incoming receives */
      } else if (dir === 'in') {
        pc = state.outgoingPCs[from]; /* Their incoming receives from us → our outgoing shares */
      } else {
        pc = state.outgoingPCs[from] || state.incomingPCs[from]; /* Legacy fallback */
      }
      if (!candidate) return;
      const iceCandidate = candidate instanceof RTCIceCandidate ? candidate : new RTCIceCandidate(candidate);
      /* dir 'out': if we don't have incoming PC yet (offer not processed), buffer so we don't drop owner's ICE */
      if (dir === 'out' && !pc) {
        state.pendingIncomingICE[from] = state.pendingIncomingICE[from] || [];
        state.pendingIncomingICE[from].push(iceCandidate);
        console.log('[WebRTC-FLOW] ICE dir=out from', (from || '').slice(0, 8) + '…', '→ BUFFER (no incoming PC) size=', state.pendingIncomingICE[from].length);
        return;
      }
      if (pc) {
        const candType = candidate.type || (candidate.candidate?.includes(' typ relay ') ? 'relay' : 
                                          candidate.candidate?.includes(' typ srflx ') ? 'srflx' : 
                                          candidate.candidate?.includes(' typ host ') ? 'host' : 'unknown');
        const pcType = pc === state.outgoingPCs[from] ? 'outgoing' : 'incoming';
        if (!pc.remoteDescription) {
          pc._pendingCandidates = pc._pendingCandidates || [];
          pc._pendingCandidates.push(iceCandidate);
          console.log('[WebRTC-FLOW] ICE from', (from || '').slice(0, 8) + '…', 'dir=', dir, '→', pcType, 'BUFFER (no remoteDesc) size=', pc._pendingCandidates.length);
        } else {
          console.log('[WebRTC-FLOW] ICE from', (from || '').slice(0, 8) + '…', 'dir=', dir, '→', pcType, 'ADD', candType);
          await pc.addIceCandidate(iceCandidate).catch(err => console.warn('[WebRTC] addIceCandidate error:', err.message));
        }
      } else {
        console.log('[WebRTC-FLOW] ICE from', (from || '').slice(0, 8) + '…', 'dir=', dir, '→ DROP (no PC)');
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
  /* CRITICO: Non aprire mai una finestra "remota" per se stessi (replay/race possono mandare offer con from=me) */
  if (String(uid) === String(state.currentUser?.id)) return;
  /* CRITICO: Lo stream remoto non deve essere il nostro localStream (evita cam "mia" nella finestra sbagliata) */
  if (stream === state.localStream) return;
  console.log('[WebRTC-FLOW] openRemoteCamWindow', (uid || '').slice(0, 8) + '…', 'tracks=', stream?.getTracks?.()?.length);
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
export function insertCameraIntoEventsGrid(uid, stream, name, isOwn) {
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

  console.log('[Events Grid v20260452] Slot created for', uid, 'isOwn:', isOwn, 'hasStream:', !!stream);

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

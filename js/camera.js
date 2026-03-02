/* ================================================================
   camera.js  — camera windows, WebRTC, public cam share, private call
================================================================ */
import { ICE_SERVERS }   from './config.js';
import { state }         from './state.js';
import { dom }           from './dom.js';
import { $, avatarColor, initials, escHtml, showToast, makeDraggable, makeResizable } from './utils.js';
import { broadcast, broadcastAll } from './broadcast.js';
import { findUser, ensureUser, renderUsers, updateOwnPresence, updateAllRoomPresences } from './users.js';
import { addRejectedCam, clearPendingCamRequest, setPendingCamRequest, getMediaConstraints } from './storage.js';

const CAM_STEP = 30;
function camCount() { return Object.keys(state.cameraWindows).length; }

/* ── Camera window ─────────────────────────────────────────────── */
export function createCameraWindow(uid, stream, name, isOwn) {
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

export function handleCamClosed(payload) {
  if (payload.from === state.currentUser?.id) return;
  const uid      = String(payload.from);
  const inMyRoom = !payload.room_id || payload.room_id === state.activeRoom;

  /* Close the local window if it's open */
  const cw = state.cameraWindows[uid];
  if (cw) { stopMicMeter(uid); cw.el.remove(); delete state.cameraWindows[uid]; }
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
  if (state.localStream) closeCameraWindow(state.currentUser.id);
  else await startOwnCamera();
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
    createCameraWindow(state.currentUser.id, state.localStream, 'You', true);
    broadcastAll('cam-opened', { room_id: state.cameraRoom });
    await updateAllRoomPresences(); renderUsers(); showToast('📹 Camera enabled.');
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
  if (!target?.online) { showToast(`${target?.name || 'User'} is offline.`); return; }
  if (!state.supa)     { showToast('⚠️ Server connection required.'); return; }
  if (state.cameraWindows[uid]) { showToast(`📹 Already viewing ${target.name}'s camera.`); return; }
  if (state.pendingCamRequests[uid]) { showToast(`⏳ Already waiting for ${target.name}'s reply.`); return; }
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
    const pc = new RTCPeerConnection(ICE_SERVERS);
    state.outgoingPCs[toUid] = pc;
    state.localStream.getTracks().filter(t => t.readyState === 'live').forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) broadcast('webrtc', toUid, { sigType: 'ice', candidate, ctx: 'public' });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    broadcast('webrtc', toUid, { sigType: 'offer', sdp: offer.sdp, ctx: 'public' });
    broadcast('cam-accepted', toUid, {});

    const viewerUser = findUser(toUid);
    state.camViewers[toUid] = viewerUser?.username || viewerUser?.name || toUid;
    refreshViewersPanel(state.currentUser.id);

    pc.addEventListener('connectionstatechange', () => {
      if (['disconnected','failed','closed'].includes(pc.connectionState)) {
        delete state.camViewers[toUid]; refreshViewersPanel(state.currentUser?.id);
      }
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
      const pc = new RTCPeerConnection(ICE_SERVERS);
      state.incomingPCs[from] = pc;
      pc.onicecandidate = ({ candidate: c }) => { if (c) broadcast('webrtc', from, { sigType: 'ice', candidate: c, ctx: 'public' }); };
      pc.ontrack = ({ streams }) => { ensureUser(from, payload.fromName); openRemoteCamWindow(from, streams[0]); };
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcast('webrtc', from, { sigType: 'answer', sdp: answer.sdp, ctx: 'public' });
    } else if (sigType === 'answer') {
      const pc = state.outgoingPCs[from]; if (pc) await pc.setRemoteDescription({ type: 'answer', sdp });
    } else if (sigType === 'ice') {
      const pc = state.outgoingPCs[from] || state.incomingPCs[from];
      if (pc && candidate) await pc.addIceCandidate(candidate).catch(console.warn);
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

function openRemoteCamWindow(uid, stream) {
  clearPendingCamRequest(String(uid));
  const user = findUser(uid);
  createCameraWindow(uid, stream, user?.name || uid, false);
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

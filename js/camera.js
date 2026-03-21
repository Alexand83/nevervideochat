/* ================================================================
   camera.js  — camera windows, WebRTC, public cam share, private call
================================================================ */
/* VERSION MARKER — if you see this in logs, new code is running */
console.log('%c[NVC] camera.js v20260469 loaded', 'color:#0f0;background:#000;font-weight:bold;padding:2px 6px;border-radius:3px');

import { ICE_SERVERS_FALLBACK, ICE_ENDPOINT_URL, ICE_P2P_ONLY, ICE_P2P_KEEP_TURN_ON_CELLULAR } from './config.js';
import { state }         from './state.js';
import { dom }           from './dom.js';
import { $, avatarColor, initials, escHtml, showToast, makeDraggable, makeResizable } from './utils.js';
import { broadcast, broadcastAll } from './broadcast.js';
import { findUser, ensureUser, renderUsers, updateOwnPresence, updateAllRoomPresences, checkIsKicked, checkIsBanned, checkIsMuted } from './users.js?v=20260462';
import { addRejectedCam, removeRejectedCam, clearPendingCamRequest, setPendingCamRequest, getMediaConstraints, getVideoConstraintsForLevel, getVideoConstraintsForDevice, saveDeviceSettings } from './storage.js';
import { loadPermissionsForUser } from './permissions.js';
import { getAvailableRooms } from './rooms.js';

const CAM_STEP = 30;
function camCount() { return Object.keys(state.cameraWindows).length; }

/* ── ICE config sicura da Firestore ─────────────────────────────
   Le credenziali TURN sono memorizzate nel documento Firestore
   "config/ice_servers", leggibile solo da utenti autenticati e
   mai scrivibile dal client (regola write:false).
   Il documento NON è mai nel sorgente JS né nel repo git.
   Fallback a STUN-only se Firestore non è disponibile.
   Vedi: firebase/firestore.rules e firebase/FIRESTORE_COLLECTIONS.md */
let _iceConfigCache = null;
let _iceConfigFetchedAt = 0;
const ICE_CONFIG_TTL_MS = 3_600_000; // 1 ora
let _loggedIceP2pOnly = false;
let _loggedCellularTurnOverride = false;

/** Rete cellulare / instabile (5G spesso dietro CGNAT): serve TURN e soglie ICE diverse. */
function isLikelyCellularNetwork() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.type === 'cellular') return true;
    if (c.saveData === true) return true;
    const et = c.effectiveType;
    if (et === 'slow-2g' || et === '2g' || et === '3g') return true;
    return false;
  } catch (_) {
    return false;
  }
}

function enrichIceConfigForNetwork(cfg) {
  if (!cfg || !Array.isArray(cfg.iceServers)) return cfg;
  if (!isLikelyCellularNetwork()) return cfg;
  const n = Number(cfg.iceCandidatePoolSize) || 4;
  return {
    ...cfg,
    /* Più candidati pre-gatherati = handshake ICE più rapido quando il relay è necessario */
    iceCandidatePoolSize: Math.max(n, 10),
  };
}

if (typeof navigator !== 'undefined') {
  const nc = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (nc?.addEventListener) {
    nc.addEventListener('change', () => {
      _iceConfigCache = null;
      _iceConfigFetchedAt = 0;
      console.log('[WebRTC] ICE config cache cleared (network change — WiFi↔cellulare, ecc.)');
    });
  }
}

/** Rimuove turn:/turns: da ogni entry (solo STUN → massimo sforzo P2P). */
function stripTurnUrlsFromIceServers(iceServers) {
  if (!Array.isArray(iceServers)) {
    return ICE_SERVERS_FALLBACK.iceServers.map((x) => ({ urls: x.urls }));
  }
  const out = [];
  for (const s of iceServers) {
    if (!s || s.urls == null) continue;
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    const kept = urls.filter((u) => {
      const x = String(u).trim().toLowerCase();
      return x.startsWith('stun:') || x.startsWith('stuns:');
    });
    if (!kept.length) continue;
    out.push({ urls: kept.length === 1 ? kept[0] : kept });
  }
  return out.length ? out : ICE_SERVERS_FALLBACK.iceServers.map((x) => ({ urls: x.urls }));
}

function applyIceP2pOnly(cfg) {
  if (!ICE_P2P_ONLY || !cfg) return cfg;
  if (ICE_P2P_KEEP_TURN_ON_CELLULAR && isLikelyCellularNetwork()) {
    if (!_loggedCellularTurnOverride) {
      _loggedCellularTurnOverride = true;
      console.warn('[WebRTC] ICE_P2P_ONLY + KEEP_TURN_ON_CELLULAR: su cellulare si mantengono i server TURN.');
    }
    return cfg;
  }
  if (!_loggedIceP2pOnly) {
    _loggedIceP2pOnly = true;
    console.warn('[WebRTC] ICE_P2P_ONLY=true — solo STUN, nessun TURN. Dietro NAT difficile la cam può non partire.');
  }
  const iceServers = stripTurnUrlsFromIceServers(cfg.iceServers);
  return {
    ...cfg,
    iceServers,
  };
}

/* ── WebRTC transport indicator (P2P / RELAY) ─────────────────── */
async function _deriveNetModeFromStats(pc) {
  try {
    const stats = await pc.getStats();
    let selectedPair = null;
    let transport = null;
    stats.forEach(r => {
      if (r.type === 'candidate-pair' && r.selected) selectedPair = r;
      if (r.type === 'transport' && r.selectedCandidatePairId) transport = r;
    });
    if (!selectedPair && transport?.selectedCandidatePairId) selectedPair = stats.get(transport.selectedCandidatePairId) || null;
    if (!selectedPair) return null;

    const localId = selectedPair.localCandidateId;
    const remoteId = selectedPair.remoteCandidateId;
    const localCand = localId ? stats.get(localId) : null;
    const remoteCand = remoteId ? stats.get(remoteId) : null;
    const localType = localCand?.candidateType || null;
    const remoteType = remoteCand?.candidateType || null;

    if (localType === 'relay' || remoteType === 'relay') return 'RELAY';
    if (localType === 'srflx' || remoteType === 'srflx') return 'P2P';
    if (localType === 'host'  || remoteType === 'host')  return 'P2P';
    return null;
  } catch (_) {
    return null;
  }
}

function _setNetBadge(uid, mode) {
  const cw = state.cameraWindows?.[uid];
  const el = cw?.el?.querySelector?.(`#cam-net-${safeId(uid)}`) || document.getElementById(`cam-net-${safeId(uid)}`);
  if (!el) return;
  if (!mode) { el.textContent = '…'; el.classList.remove('net-relay','net-p2p'); return; }
  el.textContent = mode;
  el.classList.toggle('net-relay', mode === 'RELAY');
  el.classList.toggle('net-p2p',  mode === 'P2P');
}

function _noteCandidateNetType(uid, candType) {
  const cw = state.cameraWindows?.[uid];
  if (!cw) return;
  cw._sawAnyIceCand = true;
  if (candType === 'relay') {
    cw._sawRelayIceCand = true;
    _setNetBadge(uid, 'RELAY');
  }
}

function startNetModeMonitor(uid, pc) {
  if (!uid || !pc) return;
  const cw = state.cameraWindows?.[uid];
  if (!cw) return;
  if (cw.netCheckInterval) { clearInterval(cw.netCheckInterval); cw.netCheckInterval = null; }
  let last = null;

  const tick = async () => {
    const cwCur = state.cameraWindows?.[uid];
    if (!cwCur || state.incomingPCs?.[uid] !== pc) {
      if (cwCur?.netCheckInterval) { clearInterval(cwCur.netCheckInterval); cwCur.netCheckInterval = null; }
      return;
    }
    /* Se abbiamo visto un relay candidate, il tipo è già noto. */
    if (cwCur._sawRelayIceCand) return;
    const mode = await _deriveNetModeFromStats(pc);
    if (mode && mode !== last) {
      last = mode;
      _setNetBadge(uid, mode);
    } else if (!mode && !last) {
      _setNetBadge(uid, null);
    }
  };

  tick();
  cw.netCheckInterval = setInterval(tick, 2000);
}

/** Evita storm di restart su Firebase replay / jitter */
const ICE_RESTART_COOLDOWN_MS = 42_000;

function relayRecoveryThresholds() {
  if (isLikelyCellularNetwork()) {
    /* Latenza più alta su 5G/relay: evita ICE restart continui per RTT “normale” mobile */
    return { badRtt: 0.92, badLoss: 0.09 };
  }
  return { badRtt: 0.55, badLoss: 0.06 };
}

async function _getRelayAndHealth(pc) {
  try {
    const stats = await pc.getStats();
    let selectedPair = null;
    stats.forEach((r) => {
      if (r.type === 'candidate-pair' && r.selected) selectedPair = r;
    });
    if (!selectedPair) return { isRelay: false, rttSec: null, lossFrac: null };
    const loc = selectedPair.localCandidateId ? stats.get(selectedPair.localCandidateId) : null;
    const rem = selectedPair.remoteCandidateId ? stats.get(selectedPair.remoteCandidateId) : null;
    const isRelay = loc?.candidateType === 'relay' || rem?.candidateType === 'relay';
    const rttSec = selectedPair.currentRoundTripTime != null ? Number(selectedPair.currentRoundTripTime) : null;
    let lost = 0;
    let sent = 0;
    stats.forEach((r) => {
      if (r.type === 'outbound-rtp' && r.kind === 'video') {
        if (Number.isFinite(r.packetsLost)) lost += r.packetsLost;
        if (Number.isFinite(r.packetsSent)) sent += r.packetsSent;
      }
    });
    const lossFrac = sent > 60 ? lost / sent : null;
    return { isRelay, rttSec, lossFrac };
  } catch (_) {
    return { isRelay: false, rttSec: null, lossFrac: null };
  }
}

async function tryIceRestartOutgoingPublic(pc, toUid) {
  if (!pc || pc.signalingState !== 'stable') return;
  if (!['connected', 'connecting', 'disconnected', 'failed'].includes(pc.connectionState)) return;
  const now = Date.now();
  if ((pc._lastPublicIceRestartMs || 0) + ICE_RESTART_COOLDOWN_MS > now) return;
  pc._lastPublicIceRestartMs = now;
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    broadcast('webrtc', toUid, {
      sigType: 'offer',
      sdp: pc.localDescription.sdp,
      ctx: 'public',
      room_id: state.cameraRoom,
      iceRestart: true,
    });
    console.log('[WebRTC] ICE restart inviato (broadcaster → viewer)', String(toUid).slice(0, 8) + '…');
  } catch (e) {
    console.warn('[WebRTC] ICE restart outgoing fallito', e?.message || e);
  }
}

async function tryIceRestartIncomingPublic(pc, broadcasterUid) {
  if (!pc || pc.signalingState !== 'stable') return;
  if (!['connected', 'connecting', 'disconnected', 'failed'].includes(pc.connectionState)) return;
  const now = Date.now();
  if ((pc._lastViewerIceRestartMs || 0) + ICE_RESTART_COOLDOWN_MS > now) return;
  pc._lastViewerIceRestartMs = now;
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    broadcast('webrtc', broadcasterUid, {
      sigType: 'viewer_ice_restart_offer',
      sdp: pc.localDescription.sdp,
      ctx: 'public',
      room_id: state.activeRoom,
    });
    console.log('[WebRTC] ICE restart inviato (viewer → broadcaster)', String(broadcasterUid).slice(0, 8) + '…');
  } catch (e) {
    console.warn('[WebRTC] ICE restart viewer fallito', e?.message || e);
  }
}

function startPublicCamRelayRecoveryOutgoing(pc, toUid) {
  if (pc._relayRecoveryIv) clearInterval(pc._relayRecoveryIv);
  pc._relayRecoveryIv = setInterval(async () => {
    if (state.outgoingPCs[toUid] !== pc) {
      clearInterval(pc._relayRecoveryIv);
      pc._relayRecoveryIv = null;
      return;
    }
    const h = await _getRelayAndHealth(pc);
    if (!h.isRelay) return;
    const { badRtt: br, badLoss: bl } = relayRecoveryThresholds();
    const badRtt = h.rttSec != null && h.rttSec > br;
    const badLoss = h.lossFrac != null && h.lossFrac > bl;
    const iceBad = pc.iceConnectionState === 'disconnected';
    if (badRtt || badLoss || iceBad) {
      console.log('[WebRTC] Relay instabile (out):', { toUid: String(toUid).slice(0, 8), ...h, ice: pc.iceConnectionState });
      await tryIceRestartOutgoingPublic(pc, toUid);
    }
  }, 6000);
}

function startPublicCamRelayRecoveryIncoming(pc, broadcasterUid) {
  if (pc._relayRecoveryIv) clearInterval(pc._relayRecoveryIv);
  pc._relayRecoveryIv = setInterval(async () => {
    if (state.incomingPCs[broadcasterUid] !== pc) {
      clearInterval(pc._relayRecoveryIv);
      pc._relayRecoveryIv = null;
      return;
    }
    const h = await _getRelayAndHealth(pc);
    if (!h.isRelay) return;
    const { badRtt: br, badLoss: bl } = relayRecoveryThresholds();
    const badRtt = h.rttSec != null && h.rttSec > br;
    const badLoss = h.lossFrac != null && h.lossFrac > bl;
    const iceBad = pc.iceConnectionState === 'disconnected';
    if (badRtt || badLoss || iceBad) {
      console.log('[WebRTC] Relay instabile (in):', { from: String(broadcasterUid).slice(0, 8), ...h, ice: pc.iceConnectionState });
      await tryIceRestartIncomingPublic(pc, broadcasterUid);
    }
  }, 6000);
}

async function getIceConfig() {
  const now = Date.now();
  if (_iceConfigCache && (now - _iceConfigFetchedAt) < ICE_CONFIG_TTL_MS) {
    return enrichIceConfigForNetwork(applyIceP2pOnly(_iceConfigCache));
  }
  try {
    /* 1) Prefer endpoint sicuro (/api/ice) che genera credenziali TURN via Metered API (server-side). */
    try {
      const tryFetchIce = async (url) => {
        const r = await fetch(url, { method: 'GET', credentials: 'omit' });
        if (!r || !r.ok) return null;
        const data = await r.json().catch(() => null);
        if (!data || !Array.isArray(data.iceServers) || data.iceServers.length === 0) return null;
        _iceConfigCache = {
          iceServers:           data.iceServers,
          /* Pool piccolo = meno traffico iniziale su STUN/TURN (risparmio sul relay) */
          iceCandidatePoolSize: data.iceCandidatePoolSize ?? 4,
          bundlePolicy:         data.bundlePolicy         ?? 'max-bundle',
          rtcpMuxPolicy:        data.rtcpMuxPolicy        ?? 'require',
        };
        _iceConfigFetchedAt = now;
        return enrichIceConfigForNetwork(applyIceP2pOnly(_iceConfigCache));
      };

      /* A) Se hosti su Firebase Hosting (o reverse-proxy), funziona il rewrite /api/ice */
      const fromRelative = await tryFetchIce('/api/ice');
      if (fromRelative) return fromRelative;

      /* B) GitHub Pages: preferisci Worker (se configurato), altrimenti Function URL assoluto */
      const host = String(window.location?.host || '');
      if (host.endsWith('github.io')) {
        if (ICE_ENDPOINT_URL && String(ICE_ENDPOINT_URL).trim()) {
          const fromWorker = await tryFetchIce(String(ICE_ENDPOINT_URL).trim());
          if (fromWorker) return fromWorker;
        }
        const projectId = 'nevervideochat'; /* Firebase Project ID (non project number) */
        const region = 'europe-west1';
        const fnUrl = `https://${region}-${projectId}.cloudfunctions.net/getIceServers`;
        const fromFn = await tryFetchIce(fnUrl);
        if (fromFn) return fromFn;
      }
    } catch (_) { /* ignore, fallback below */ }

    /* 2) Fallback: Firestore config/ice_servers (static). */
    const snap = await state.fb?.firestore.collection('config').doc('ice_servers').get();
    if (snap?.exists) {
      const data = snap.data();
      if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
        _iceConfigCache = {
          iceServers:           data.iceServers,
          iceCandidatePoolSize: data.iceCandidatePoolSize ?? 4,
          bundlePolicy:         data.bundlePolicy         ?? 'max-bundle',
          rtcpMuxPolicy:        data.rtcpMuxPolicy        ?? 'require',
        };
        _iceConfigFetchedAt = now;
        return enrichIceConfigForNetwork(applyIceP2pOnly(_iceConfigCache));
      }
    }
  } catch (_) {}
  return enrichIceConfigForNetwork(applyIceP2pOnly(ICE_SERVERS_FALLBACK));
}
/** Per evitare XSS/breakout in id HTML: solo caratteri sicuri */
function safeId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '') || 'u'; }


/** Contatore globale reconnect per peer: impedisce il loop infinito dopo MAX_GLOBAL_RECONNECT tentativi */
const _globalReconnectCounts = {};
const MAX_GLOBAL_RECONNECT = 3;

/** Qualità video adattiva: livello corrente e flag "forzata bassa" (pulsante Riduci qualità) */
let currentEncodingLevel = 'low';
let forceLowQuality = false;

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
      <span class="cam-quality-wrap" id="cam-quality-wrap-${safeUid}">
        <span class="cam-quality-label" id="cam-quality-label-${safeUid}" title="Qualità video inviata">Bassa</span>
        <button type="button" class="cam-ctrl-btn cam-quality-btn" id="cam-quality-btn-${safeUid}" title="Riduci qualità per connessioni lente">Riduci qualità</button>
      </span>
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
        ${!isOwn ? `<span class="cam-net-badge" id="cam-net-${safeUid}" title="Connessione WebRTC">…</span>` : ''}
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
      <video id="cam-vid-${safeUid}" autoplay muted playsinline
             style="${isOwn ? 'transform:scaleX(-1)' : ''}"></video>
      <div class="cam-solo-voce-placeholder" id="cam-solo-voce-${safeUid}" hidden><span class="cam-solo-voce-icon">🎤</span><span class="cam-solo-voce-txt">Solo voce</span></div>
    </div>
    ${footer}
    <div class="cam-resize-handle" id="cam-rz-${safeUid}" aria-hidden="true"></div>`;

  document.body.appendChild(win);
  const remoteSenderVideoOff = !isOwn && !!state.remoteVideoOffState?.[uid];
  state.cameraWindows[uid] = { el: win, stream, isOwn, micEnabled: true, videoOff: false, videoHiddenByMe: false, remoteSenderVideoOff };

  const videoEl = $(`cam-vid-${safeUid}`);
  const placeholderEl = $(`cam-solo-voce-${safeUid}`);
  if (videoEl) {
    /* Remoto: stream con VIDEO TRACK PRIMO (alcuni browser mostrano nero se il primo track è audio) */
    const streamToAttach = !isOwn && stream?.getTracks?.()?.length
      ? new MediaStream([...stream.getVideoTracks(), ...stream.getAudioTracks()])
      : stream;
    videoEl.srcObject = null;
    videoEl.srcObject = streamToAttach;
    if (!isOwn) {
      videoEl.muted = true;
      videoEl.volume = 1;
    } else {
      /* Propria cam: placeholder "Solo voce" nascosto finché l'utente non disattiva il video; video sempre visibile */
      if (placeholderEl) { placeholderEl.hidden = true; placeholderEl.style.display = 'none'; }
      videoEl.style.display = 'block';
    }
    const doPlay = () => {
    videoEl.play().catch(() => {});
    };
    if (!isOwn) requestAnimationFrame(() => doPlay());
    else doPlay();
    /* Propria cam: forza primo frame — riattacca srcObject finché videoWidth è 0 */
    if (isOwn && stream?.getVideoTracks?.()?.length) {
      const forceFirstFrame = () => {
        if (!state.cameraWindows[uid]?.stream || state.cameraWindows[uid].stream !== stream) return;
        if (videoEl.videoWidth > 0) return;
        videoEl.srcObject = null;
        videoEl.srcObject = stream;
        videoEl.play().catch(() => {});
      };
      videoEl.addEventListener('loadeddata', forceFirstFrame, { once: true });
      videoEl.addEventListener('canplay',    forceFirstFrame, { once: true });
      setTimeout(forceFirstFrame, 400);
    }
    if (!isOwn) {
      /* iOS (Chrome e Safari): tenta autoplay diretto dopo l'interazione utente.
         Se il browser blocca l'audio, initRemoteVolumeControl mostrerà il piccolo
         overlay "🔇 Tocca per sentire l'audio" — nessun badge nell'header. */
      const isAnyIOS = /CriOS|iPhone|iPad|iPod/i.test(navigator.userAgent);

      if (isAnyIOS) {
        /* Autoplay su tutti gli iOS: sblocca l'audio subito, fallback overlay al tap */
        const tryAutoAudio = () => {
          const vid2 = win.querySelector('video');
          if (!vid2 || !state.cameraWindows[uid]) return;
          vid2.muted = false;
          const p = vid2.play();
          const afterPlay = () => { if (state.cameraWindows[uid]) initRemoteVolumeControl(uid); };
          if (p) p.then(afterPlay).catch(() => { vid2.muted = true; afterPlay(); });
          else afterPlay();
        };
        if (stream?.getAudioTracks?.()?.length) {
          tryAutoAudio();
        } else {
          setTimeout(() => {
            if (state.cameraWindows[uid]?.stream?.getAudioTracks?.()?.length) tryAutoAudio();
          }, 500);
        }
      } else {
        /* Desktop Chrome/Firefox/Safari, Android: comportamento originale */
        if (stream?.getAudioTracks?.()?.length) {
          initRemoteVolumeControl(uid);
        } else {
          setTimeout(() => {
            if (state.cameraWindows[uid]?.stream?.getAudioTracks?.()?.length)
              initRemoteVolumeControl(uid);
          }, 500);
        }
      }
      updateRemoteVideoVisibility(uid);
      /* Polling ogni 400ms per 20s: finché il video è nero e il track è vivo, ricrea l'elemento.
         Su Chrome Android il decoder WebRTC può impiegare >12s ad avviarsi (bug noto). */
      let pollCount = 0;
      const MAX_POLL = 50; /* 50 × 400ms = 20s */
      const pollInterval = setInterval(() => {
        pollCount++;
        const cw = state.cameraWindows[uid];
        if (pollCount > MAX_POLL || !cw || cw.stream !== stream) {
          clearInterval(pollInterval);
          if (cw) cw._remoteVideoPollInterval = null;
          return;
        }
        const v = cw.el?.querySelector('video');
        if (v?.videoWidth > 0) { clearInterval(pollInterval); cw._remoteVideoPollInterval = null; return; }
        if (stream.getVideoTracks().some(t => t.readyState === 'live')) {
          /* Ogni 4 tentativi (~1.6s) alterna tra: track.enabled toggle e rimpiazzo elemento.
             Il toggle enabled forza il decoder Chrome Android a ripartire senza creare DOM nuovo. */
          if (pollCount % 4 === 0) {
            const vt = stream.getVideoTracks()[0];
            if (vt) { vt.enabled = false; setTimeout(() => { vt.enabled = true; }, 80); }
          } else {
            replaceRemoteVideoElement(uid);
          }
        }
      }, 400);
      if (state.cameraWindows[uid]) state.cameraWindows[uid]._remoteVideoPollInterval = pollInterval;

      /* Long-term monitor via requestVideoFrameCallback (se supportato) o fallback raf.
         Continua a monitorare anche dopo il poll di 20s: se il video torna nero (freeze),
         forza un srcObject refresh. Utile per Chrome Android dove il decoder può freezare. */
      const videoElForRvfc = $(`cam-vid-${safeUid}`);
      if (videoElForRvfc && typeof videoElForRvfc.requestVideoFrameCallback === 'function') {
        let lastFrameW = 0;
        let rvfcFrozenCount = 0;
        const rvfcLoop = (now, meta) => {
          const cwCur = state.cameraWindows[uid];
          if (!cwCur || cwCur.stream !== stream) return; /* stream cambiato: stop */
          const vidCur = cwCur.el?.querySelector('video');
          if (!vidCur) return;
          if (meta.width > 0 && meta.height > 0) {
            lastFrameW = meta.width;
            rvfcFrozenCount = 0;
          } else if (lastFrameW > 0) {
            /* Frame width tornato a 0 → freeze/black */
            rvfcFrozenCount++;
            if (rvfcFrozenCount >= 3) {
              rvfcFrozenCount = 0;
              console.log('[Camera] rvfc freeze detected, recovering', uid);
              const ts = [...(cwCur.stream?.getVideoTracks() || []), ...(cwCur.stream?.getAudioTracks() || [])];
              vidCur.srcObject = null;
              vidCur.srcObject = new MediaStream(ts);
              vidCur.play().catch(() => {});
            }
          }
          vidCur.requestVideoFrameCallback(rvfcLoop);
        };
        videoElForRvfc.requestVideoFrameCallback(rvfcLoop);
      }
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
        /* Qualsiasi track live (audio o video) conta come "connessione attiva" */
        const hasActiveTracks = tracks.some(t => t.readyState === 'live');
        
        /* CRITICO: Per cam nella grid degli eventi, chiudi immediatamente se il flusso è morto */
        const cw = state.cameraWindows[uid];
        const isInEventsGrid = cw?.isEventsGrid;
        
        if (hasActiveTracks) {
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
            /* Non è un vero "cam-closed": non azzerare hasCamera (l'utente potrebbe avere ancora la cam attiva).
               Rimuovi la finestra/PC e ritenta la richiesta. */
            removeRemoteCameraFromGrid(uid, { keepHasCamera: true }).then(() => {
              const u = findUser(uid);
              if (u?.online && !state.manuallyClosedCameras?.[uid]) {
                delete state.pendingCamRequests[uid];
                requestPublicCamera(uid, { skipCooldown: true, forceRetry: true, pendingTtlMs: 5000, silentPendingExpiry: true });
              }
            }).catch(() => {});
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
        /* Bug Chrome Android documentato (Twilio issue #931): il track remoto diventa
           briefly .muted poi .unmuted ma il video resta nero. Al primo unmute,
           se il video non ha ancora frame, riattacchiamo srcObject + toggle enabled. */
        if (track.kind === 'video') {
          track.addEventListener('unmute', () => {
            const cw = state.cameraWindows[uid];
            if (!cw || cw.isOwn) return;
            const vid = cw.el?.querySelector('video');
            if (!vid || vid.videoWidth > 0) return;
            console.log('[Camera] Chrome Android track unmute recovery for', uid);
            /* Toggle enabled: forza Chrome Android a riavviare il decoder */
            track.enabled = false;
            setTimeout(() => {
              track.enabled = true;
              const cwNow = state.cameraWindows[uid];
              if (!cwNow) return;
              const vidNow = cwNow.el?.querySelector('video');
              if (!vidNow || vidNow.videoWidth > 0) return;
              /* Ancora nero dopo toggle: riattacca srcObject */
              const ts = [...(cwNow.stream?.getVideoTracks() || []), ...(cwNow.stream?.getAudioTracks() || [])];
              vidNow.srcObject = null;
              vidNow.srcObject = new MediaStream(ts);
              vidNow.play().catch(() => {});
            }, 150);
          });
        }
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
      const remoteVideoCheckInterval = setInterval(syncRemoteVideoPlaceholder, 2000);
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
        if (devDrop.hidden) {
          devDrop.hidden = false;
          await openCameraDeviceDropdown(uid, devDrop);
        } else {
          hideCameraDeviceDropdown(uid);
        }
      });
      devDrop.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', () => { hideCameraDeviceDropdown(uid); });
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
    updateCamQualityUI(currentEncodingLevel);
    const qualityBtn = $(`cam-quality-btn-${safeId(uid)}`);
    if (qualityBtn) {
      qualityBtn.addEventListener('click', () => {
        forceLowQuality = !forceLowQuality;
        if (forceLowQuality) {
          Object.keys(state.outgoingPCs).forEach(peerId => {
            const pc = state.outgoingPCs[peerId];
            clearEncodingRampTimer(pc);
            applyVideoEncoding(pc, 'low');
          });
          updateCamQualityUI('low');
          showToast('📉 Qualità video ridotta per connessioni lente.');
        } else {
          /* Ripristino: riavvia il ramp-up automatico per ogni PC.
             Non usare currentEncodingLevel (è ancora 'low' — lo aveva sovrascritto
             updateCamQualityUI('low') quando era stato premuto "Riduci qualità").
             startEncodingRampUp risale low → medium (15s) → high (15s). */
          Object.keys(state.outgoingPCs).forEach(peerId => {
            startEncodingRampUp(state.outgoingPCs[peerId], peerId);
          });
          updateCamQualityUI('low'); /* il label salirà col ramp */
          showToast('📈 Qualità automatica riattivata — sale gradualmente.');
        }
      });
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
    clearEncodingRampTimer(state.outgoingPCs[uid]);
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
  if (camWin?.netCheckInterval) {
    clearInterval(camWin.netCheckInterval);
    camWin.netCheckInterval = null;
  }
  
  if (camWin?.isEventsGrid) {
    /* Remove slot from events grid entirely */
    const slot = camWin.el;
    if (slot && slot.parentNode) slot.remove();
    delete state.cameraWindows[uid];
    /* Recalculate columns */
    const { updateEventsCamGrid } = await import('./rooms.js');
    updateEventsCamGrid();
    
    if (uid === state.currentUser?.id || uid === 'me') await _teardownOwnStream();
    return;
  }
  
  /* Normal floating window close */
  const cw = state.cameraWindows[uid]; if (!cw) return;
  /* Menu dispositivo può essere stato spostato su body: ripristina / chiudi prima di rimuovere la finestra */
  hideCameraDeviceDropdown(uid);
  if (cw._remoteVideoPollInterval) { clearInterval(cw._remoteVideoPollInterval); cw._remoteVideoPollInterval = null; }
  stopMicMeter(uid);
  if (cw.stream) { cw.stream.getTracks().forEach(t => t.stop()); cw.stream = null; }
  if (cw.el?.parentNode) cw.el.remove();
  delete state.cameraWindows[uid];

  if (uid === state.currentUser?.id || uid === 'me') {
    await _teardownOwnStream();
  } else {
    state.manuallyClosedCameras[uid] = true;
    if (state.incomingPCs[uid]) {
      state.incomingPCs[uid].close();
      delete state.incomingPCs[uid]; delete state.pendingIncomingICE[uid];
    }
  }
}

/** Arresta lo stream locale e aggiorna UI/presenza. Chiamato da closeCameraWindow e toggleOwnCamera. */
async function _teardownOwnStream() {
  const selfId = state.currentUser?.id;
  stopMicMeter(selfId);
      const closedRoom = state.cameraRoom;
  if (state.micPipeline) { state.micPipeline.ctx.close().catch(() => {}); state.micPipeline = null; }
      state.localStream?.getTracks().forEach(t => t.stop());
      state.localStream = null;
      state.cameraClosedAt = Date.now();
      state.cameraRoom = null;
  clearCaptureRamp();
  for (const peerId of Object.keys(state.outgoingPCs)) {
    clearEncodingRampTimer(state.outgoingPCs[peerId]);
    state.outgoingPCs[peerId]?.close();
    delete state.outgoingPCs[peerId];
  }
      state.currentUser.hasCamera = false;
  dom.cameraBtnLabel.textContent = 'Camera Off';
  dom.cameraBtnHeader.classList.remove('camera-on');
      broadcastAll('cam-closed', { room_id: closedRoom });
  await updateAllRoomPresences();
  renderUsers();
  showToast('📹 Camera disabled.');
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
  clearCaptureRamp();
  for (const uid of Object.keys(state.outgoingPCs)) {
    clearEncodingRampTimer(state.outgoingPCs[uid]);
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
export async function removeRemoteCameraFromGrid(uid, opts = {}) {
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
  /* Reset contatore reconnect: quando la finestra è chiusa (manualmente o definitivamente) */
  delete _globalReconnectCounts[uid];
  /* keepHasCamera=true durante reconnect automatico: il broadcaster ha ancora la cam aperta,
     azzerarla causerebbe il reject dell'offer di riconnessione. */
  if (!opts.keepHasCamera) {
    for (const room of Object.values(state.rooms)) {
      if (room.users[uid]) room.users[uid].hasCamera = false;
    }
    const u = state.users.find(u => u.id === uid);
    if (u) u.hasCamera = false;
  }
  /* Non rimuovere l'utente dalla stanza: resta in lista (presence); aggiorniamo solo hasCamera. */
  /* Pulisci cooldown e pending così l'utente può ri-richiedere subito (cam auto-chiusa, non manuale) */
  clearPendingCamRequest(uid);
  delete state.camReqCooldowns[uid];
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
      if (cw.el?.parentNode) cw.el.remove();
      const { updateEventsCamGrid } = await import('./rooms.js');
      updateEventsCamGrid();
    } else {
      stopMicMeter(uid);
      if (cw.el?.parentNode) cw.el.remove();
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
  /* Non rimuovere l'utente dalla stanza: resta in lista (ha solo spento la cam). */
  
  /* CRITICO: Rimuovi il flag di chiusura manuale quando la camera viene effettivamente chiusa dall'altro utente */
  /* Questo permette all'utente di richiedere di nuovo la camera in futuro se vuole */
  if (state.manuallyClosedCameras[uid]) {
    delete state.manuallyClosedCameras[uid];
    console.log('[Camera] Removed manual close flag for', uid, '- camera was closed by owner');
  }

  renderUsers();
  if (inMyRoom) {
    const knownName = findUser(uid)?.name || payload.fromName || 'User';
    showToast(`📹 ${knownName} turned off their camera`);
  }
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
    const camWin = state.cameraWindows[state.currentUser.id];
    if (camWin) {
      await closeCameraWindow(state.currentUser.id);
    } else {
      /* Stream attivo ma finestra già rimossa — chiudi direttamente */
      await _teardownOwnStream();
    }
  } else {
    /* Muted users cannot turn on camera (global or room mute). */
    const myMute = state.currentUser?.id ? checkIsMuted(state.currentUser.id, state.activeRoom) : null;
    if (myMute) {
      const scope = myMute.global ? 'globally' : 'in this room';
      showToast(`🔇 You are muted ${scope} and cannot turn on camera.`);
      return;
    }
    await startOwnCamera();
  }
}

/* ── Pipeline audio: GainNode per controllare volume mic (barra verticale alza/abbassa) ── */
async function createMicVolumePipeline(stream) {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return null;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    /* CRITICO: attendi resume così il contesto è running e il track invia audio (e l'analyser ha dati per il bordo "sta parlando") */
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    return { gainNode, analyser, ctx };
  } catch (err) {
    console.warn('[Camera] createMicVolumePipeline failed:', err);
    return null;
  }
}

/** Timer per ramp silenzioso qualità cattura (minimal → low → medium → high). */
let captureRampTimer = null;

function clearCaptureRamp() {
  if (captureRampTimer) { clearTimeout(captureRampTimer); captureRampTimer = null; }
  state.videoCaptureLevel = null;
}

export async function startOwnCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { showToast('⚠️ Camera not supported.'); return; }
  const myMute = state.currentUser?.id ? checkIsMuted(state.currentUser.id, state.activeRoom) : null;
  if (myMute) {
    const scope = myMute.global ? 'globally' : 'in this room';
    showToast(`🔇 You are muted ${scope} and cannot turn on camera.`);
    return;
  }
  try {
    const msSince = Date.now() - state.cameraClosedAt;
    if (msSince < 450) await new Promise(r => setTimeout(r, 450 - msSince));
    state.videoCaptureLevel = 'minimal';
    state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
    state.micPipeline = await createMicVolumePipeline(state.localStream) || null;
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
      clearCaptureRamp();
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
    
    broadcastAll('cam-opened', { room_id: state.cameraRoom, videoOff: state.cameraWindows[state.currentUser?.id]?.videoOff === true });
    await updateAllRoomPresences();
    renderUsers();
    /* Secondo aggiornamento a 800ms: assicura propagazione dopo il broadcast */
    setTimeout(async () => { await updateAllRoomPresences(); renderUsers(); }, 800);
    
    /* Ramp silenzioso qualità cattura: minimal → low (5s) → medium (15s) → high (30s) se l'hardware regge */
    if (captureRampTimer) clearTimeout(captureRampTimer);
    const scheduleNextRamp = (delayMs) => {
      captureRampTimer = setTimeout(() => tryRampUpCaptureQuality(), delayMs);
    };
    scheduleNextRamp(5000);
    
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
      if (pipeline.ctx.state === 'suspended') pipeline.ctx.resume().catch(() => {});
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
async function initRemoteVolumeControl(uid) {
  closeRemoteVolumeContext(uid);
  const cw = state.cameraWindows[uid];
  const stream = cw?.stream;
  const muteBtn = $(`cam-remote-mute-${safeId(uid)}`);
  const wrap = $(`cam-remote-volume-wrap-${safeId(uid)}`);
  const fill = $(`cam-remote-fill-${safeId(uid)}`);
  const thumb = $(`cam-remote-thumb-${safeId(uid)}`);
  const video = $(`cam-vid-${safeId(uid)}`) || cw?.el?.querySelector?.('video');
  /* Serve almeno il video (floating o grid Eventi): senza non possiamo fare Web Audio. wrap è opzionale (in grid non c'è). */
  if (!video) return;

  const audioTrack = stream?.getAudioTracks()[0];
  let remoteCtx = null;
  let remoteGain = null;
  let analyser = null;

  /* Helper: rimuovi overlay "Tap to hear" */
  const removeTapOverlay = () => cw?.el?.querySelector?.('.cam-tap-audio')?.remove();

  if (audioTrack) {
    /* iOS (Safari e Chrome/CriOS): AudioContext.resume() può riportare falsi positivi
       e createMediaStreamSource non riceve dati reali dai track WebRTC su iOS.
       Saltiamo Web Audio e usiamo getStats() per il glow; l'audio esce dall'<video>. */
    const isIOS = /CriOS|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS) {
      /* Tutti gli iOS: createMediaStreamSource() non riceve dati WebRTC → skip Web Audio.
         Audio diretto dall'<video>; getStats() per lo speaking indicator. */
      if (!video.muted) {
        /* Speaking indicator via getStats */
        const fallbackPc = state.incomingPCs[uid];
        if (fallbackPc && cw && !cw._statsInterval) {
          cw._statsInterval = setInterval(async () => {
            if (!state.cameraWindows[uid]) { clearInterval(cw._statsInterval); cw._statsInterval = null; return; }
            try {
              const stats = await fallbackPc.getStats();
              let level = 0;
              stats.forEach(s => { if (s.type === 'inbound-rtp' && s.kind === 'audio') level = s.audioLevel ?? 0; });
              const el = state.cameraWindows[uid]?.el;
              if (el) el.classList.toggle('cam-speaking', level > 0.008);
            } catch (_) {}
          }, 150);
        }
        /* Su iOS video.volume è read-only: slider = mute toggle. */
      } else {
        /* video.muted = true → autoplay bloccato (es. Safari con restrizioni). Mostra overlay tap. */
        if (cw?.el && !cw.el.querySelector('.cam-tap-audio') && !cw.el.querySelector('.cam-audio-badge')) {
          const ov = document.createElement('div');
          ov.className = 'cam-tap-audio';
          ov.textContent = '🔇 Tocca per sentire l\'audio';
          (cw.el.querySelector('.cam-win-video-wrap') || cw.el).appendChild(ov);
          const activateFallback = () => {
            removeTapOverlay();
            const v = cw.el?.querySelector('video');
            if (v) { v.muted = false; v.play().catch(() => {}); }
            closeRemoteVolumeContext(uid);
            initRemoteVolumeControl(uid);
          };
          cw.el.addEventListener('click',      activateFallback, { once: true });
          cw.el.addEventListener('touchstart', activateFallback, { once: true, passive: true });
        }
      }
      /* Salta il blocco Web Audio standard, vai al setup mute/volume */
    } else {
    try {
      remoteCtx = new (window.AudioContext || window.webkitAudioContext)();
      /* resume() può fallire su mobile senza gesto dell'utente */
      const resumeOk = await remoteCtx.resume().then(() => remoteCtx.state === 'running').catch(() => false);

      if (!resumeOk) {
        remoteCtx.close().catch(() => {});
        remoteCtx = null;
        /* Mostra overlay tap */
        if (cw?.el && !cw.el.querySelector('.cam-tap-audio') && !cw.el.querySelector('.cam-chrome-play')) {
          const ov = document.createElement('div');
          ov.className = 'cam-tap-audio';
          ov.textContent = '🔇 Tocca per sentire l\'audio';
          (cw.el.querySelector('.cam-win-video-wrap') || cw.el).appendChild(ov);
          const activateAudio = () => {
            removeTapOverlay();
            video.muted = false;
            video.play().catch(() => {});
            closeRemoteVolumeContext(uid);
            initRemoteVolumeControl(uid);
          };
          cw.el.addEventListener('click',      activateAudio, { once: true });
          cw.el.addEventListener('touchstart', activateAudio, { once: true, passive: true });
        }
      } else {
        /* Contesto running (PC o Safari/mobile dopo interazione) → pipeline Web Audio completa */
        const src = remoteCtx.createMediaStreamSource(new MediaStream([audioTrack]));
        remoteGain = remoteCtx.createGain();
        remoteGain.gain.value = 1;
        src.connect(remoteGain);
        remoteGain.connect(remoteCtx.destination);
        video.muted = true; /* audio da Web Audio */
        removeTapOverlay();

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
      }
    } catch (err) {
      console.warn('[Camera] Remote Web Audio failed:', err);
    }
    } /* end else (non-iOS) */
  }

  /* Unmuta solo se lo stream non ha audio tracks */
  if (!audioTrack) video.muted = false;

  /* Salta se i handler sono già stati attaccati in una chiamata precedente
     (evita accumulo di listener da replaceRemoteVideoElement + activateAudio) */
  if (cw._volumeHandlersAttached) return;
  cw._volumeHandlersAttached = true;

  /* Su iOS video.volume è read-only: lo slider funziona come mute toggle (0% = muto, >0% = audio). */
  const isIOSDevice = /CriOS|iPhone|iPad|iPod/i.test(navigator.userAgent);

  let lastVolumePct = 100;
  const getVid = () => isIOSDevice ? (cw.el?.querySelector('video') || video) : video;
  const setVolumeFromPct = (pct) => {
    const clamped = Math.max(0, Math.min(100, pct));
    lastVolumePct = clamped;
    const vol = clamped / 100;
    if (remoteGain) {
      remoteGain.gain.value = vol;
    } else if (!isIOSDevice) {
      getVid().volume = vol;
      if (vol > 0) getVid().muted = false;
    }
    if (fill) fill.style.width = clamped + '%';
    if (thumb) thumb.style.left = clamped + '%';
  };
  if (wrap || fill) setVolumeFromPct(100);

  let isMuted = false;
  const applyMute = (muted) => {
    isMuted = muted;
    if (remoteGain) remoteGain.gain.value = isMuted ? 0 : lastVolumePct / 100;
    else getVid().muted = isMuted;
    muteBtn?.setAttribute('aria-pressed', String(isMuted));
    if (muteBtn) muteBtn.textContent = isMuted ? '🔇' : '🔊';
  };

  if (muteBtn) {
    const toggleMute = () => applyMute(!isMuted);
    muteBtn.addEventListener('click', toggleMute);
    if (isIOSDevice) {
      muteBtn.addEventListener('touchend', (e) => { e.preventDefault(); toggleMute(); }, { passive: false });
    }
  }

  if (wrap) {
    const onInput = (e) => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const pct = (x / rect.width) * 100;
      if (isIOSDevice) {
        /* Su iOS volume non controllabile: slider = toggle mute a 0% */
        const shouldMute = pct < 5;
        setVolumeFromPct(shouldMute ? 0 : 100);
        applyMute(shouldMute);
      } else {
        setVolumeFromPct(pct);
        if (isMuted && pct > 0) applyMute(false);
      }
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
    }, { passive: false });
  }
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
  if (cw._statsInterval) {
    clearInterval(cw._statsInterval);
    cw._statsInterval = null;
  }
  /* Permette di riattaccare i handler se la finestra viene ricreata */
  cw._volumeHandlersAttached = false;
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

/** Sostituisce l'elemento <video> remoto con uno nuovo e riattacca lo stream (video track PRIMO per evitare cam nera). Ritorna true se sostituito o già ok. */
function replaceRemoteVideoElement(uid) {
  const cw = state.cameraWindows[uid];
  if (!cw?.stream || cw.isOwn) return false;
  const videoTracks = cw.stream.getVideoTracks();
  const hasVideo = videoTracks.some(t => t.readyState === 'live');
  if (!hasVideo) return false;
  /* Finestre floating: .cam-win-video-wrap; stanza Eventi: video diretto nello slot */
  const wrap = cw.el?.querySelector('.cam-win-video-wrap') || cw.el;
  const oldV = wrap?.querySelector?.('video');
  if (!wrap || !oldV) return false;
  if (oldV.videoWidth > 0) return true; /* già ok */
  const newV = document.createElement('video');
  newV.id = oldV.id;
  newV.setAttribute('autoplay', '');
  newV.setAttribute('playsinline', '');
  if (newV.webkitPlaysInline !== undefined) newV.webkitPlaysInline = true;
  /* Preserva lo stato mute del vecchio elemento (es. audio già attivato dall'utente) */
  newV.muted = oldV.muted;
  newV.playsInline = true;
  newV.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  /* Video track PRIMO: alcuni browser decodificano meglio il primo track dello stream */
  const tracks = [...cw.stream.getVideoTracks(), ...cw.stream.getAudioTracks()];
  newV.srcObject = new MediaStream(tracks);
  wrap.replaceChild(newV, oldV);
  requestAnimationFrame(() => {
    newV.play().catch(() => {});
  });
  /* Reinizializza audio solo se non c'è già un AudioContext attivo.
     Se remoteVolumeCtx esiste (GainNode via Web Audio su non-iOS) non serve reinit:
     il GainNode è connesso all'audio track, non all'elemento video. */
  const cwForAudio = state.cameraWindows[uid];
  if (cwForAudio && !cwForAudio.remoteVolumeCtx &&
      cwForAudio.stream?.getAudioTracks?.()?.length) {
    closeRemoteVolumeContext(uid);
    initRemoteVolumeControl(uid);
  }
  return true;
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
    if (placeholder) { placeholder.hidden = false; placeholder.style.display = ''; }
  } else {
    videoEl.style.display = '';
    if (placeholder) { placeholder.hidden = true; placeholder.style.display = 'none'; }
  }
  updateVideoToggleButton(uid);
  /* Notifica i viewer così mostrano placeholder "Solo voce" invece di schermo nero */
  broadcastAll('cam-video-off', { from: state.currentUser.id, videoOff: cw.videoOff });
}

/* ── Cambio camera on the fly (dropdown in footer) ── */
async function openCameraDeviceDropdown(uid, dropdownEl) {
  mountCameraDeviceDropdown(dropdownEl);
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const videoDevices = devices.filter(d => d.kind === 'videoinput');
  const currentId = state.settings?.cameraId || '';
  dropdownEl.innerHTML = '';
  if (videoDevices.length === 0) {
    dropdownEl.innerHTML = '<div class="cam-device-item cam-device-empty">Nessuna camera</div>';
    positionDeviceDropdown(uid, dropdownEl);
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
      restoreCameraDeviceDropdown(dropdownEl);
      if (dev.deviceId !== currentId) await switchCameraDevice(uid, dev.deviceId);
    });
    dropdownEl.appendChild(item);
  });
  positionDeviceDropdown(uid, dropdownEl);
}

/** Sposta il menu su document.body: .cam-window ha transform (animazione) + overflow:hidden → altrimenti fixed è clippato. */
function mountCameraDeviceDropdown(dropdownEl) {
  if (!dropdownEl) return;
  if (!dropdownEl._deviceDropOriginalParent) {
    dropdownEl._deviceDropOriginalParent = dropdownEl.parentNode;
  }
  if (dropdownEl.parentNode !== document.body) {
    document.body.appendChild(dropdownEl);
  }
}

function restoreCameraDeviceDropdown(dropdownEl) {
  if (!dropdownEl) return;
  if (dropdownEl._resizeBound) {
    window.removeEventListener('resize', dropdownEl._resizeBound);
    dropdownEl._resizeBound = null;
  }
  const p = dropdownEl._deviceDropOriginalParent;
  if (p && dropdownEl.parentNode === document.body) {
    p.appendChild(dropdownEl);
  }
  dropdownEl.style.position = '';
  dropdownEl.style.left = '';
  dropdownEl.style.top = '';
  dropdownEl.style.right = '';
  dropdownEl.style.bottom = '';
  dropdownEl.style.zIndex = '';
  dropdownEl.style.maxHeight = '';
  dropdownEl.style.minWidth = '';
}

function hideCameraDeviceDropdown(uid) {
  const devDrop = $(`cam-device-dropdown-${safeId(uid)}`);
  if (!devDrop || devDrop.hidden) return;
  devDrop.hidden = true;
  restoreCameraDeviceDropdown(devDrop);
}

/** Allinea al bottone cam, viewport, finestra piccola: sopra se c’è spazio, sotto altrimenti + max-height scroll. */
function positionDeviceDropdown(uid, dropdownEl) {
  const btn = $(`cam-device-btn-${safeId(uid)}`);
  if (!btn || !dropdownEl) return;

  if (dropdownEl._resizeBound) {
    window.removeEventListener('resize', dropdownEl._resizeBound);
    dropdownEl._resizeBound = null;
  }

  const run = () => {
    if (dropdownEl.hidden) return;
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    dropdownEl.style.position = 'fixed';
    dropdownEl.style.zIndex = '10050';
    dropdownEl.style.right = 'auto';
    dropdownEl.style.bottom = 'auto';
    dropdownEl.style.minWidth = Math.min(280, Math.max(180, rect.width + 32)) + 'px';

    dropdownEl.style.maxHeight = 'none';
    const naturalH = Math.max(dropdownEl.offsetHeight, dropdownEl.scrollHeight, 80);

    const spaceAbove = rect.top - margin - gap;
    const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
    const preferAbove = spaceAbove >= 100 && spaceAbove >= spaceBelow - 24;

    let top;
    let maxH;
    if (preferAbove) {
      maxH = Math.min(340, Math.max(80, spaceAbove));
      const showH = Math.min(naturalH, maxH);
      top = rect.top - showH - gap;
      if (top < margin) {
        top = margin;
        maxH = Math.min(maxH, Math.max(80, rect.top - margin - gap));
      }
    } else {
      top = rect.bottom + gap;
      maxH = Math.min(340, Math.max(80, spaceBelow));
    }
    dropdownEl.style.maxHeight = maxH + 'px';

    const dw = dropdownEl.getBoundingClientRect().width || 220;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - dw - margin));
    dropdownEl.style.left = `${left}px`;
    dropdownEl.style.top = `${top}px`;
  };

  requestAnimationFrame(() => requestAnimationFrame(run));

  const onResize = () => {
    if (!dropdownEl.hidden) run();
  };
  dropdownEl._resizeBound = onResize;
  window.addEventListener('resize', onResize);
}

/** Sostituisce il track su tutte le connessioni che inviano il nostro stream (stanza + Eventi + videochiamata). */
function replaceOutgoingMediaTrack(kind, track) {
  if (!track) return;
  Object.keys(state.outgoingPCs || {}).forEach((peerId) => {
    const pc = state.outgoingPCs[peerId];
    const sender = pc.getSenders().find((s) => s.track?.kind === kind);
    if (sender) sender.replaceTrack(track).catch(() => {});
  });
  if (state.privatePeer) {
    const sender = state.privatePeer.getSenders().find((s) => s.track?.kind === kind);
    if (sender) sender.replaceTrack(track).catch(() => {});
  }
}

/**
 * Cambia sorgente video dello stream locale senza toccare l'audio (impostazioni / footer).
 * `deviceId` vuoto = videocamera predefinita di sistema.
 */
async function switchLocalVideoDevice(ownUid, deviceId) {
  if (!state.localStream) return;
  const cw = state.cameraWindows[ownUid];
  const level = state.videoCaptureLevel || 'minimal';
  const videoConstr = getVideoConstraintsForDevice(deviceId || '', level);
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: videoConstr,
    audio: false,
  });
  const newVideoTrack = newStream.getVideoTracks()[0];
  if (!newVideoTrack) {
    newStream.getTracks().forEach((t) => t.stop());
    throw new Error('No video track');
  }
  const oldVideoTrack = state.localStream.getVideoTracks()[0];
  if (oldVideoTrack) {
    state.localStream.removeTrack(oldVideoTrack);
    oldVideoTrack.stop();
  }
  state.localStream.addTrack(newVideoTrack);
  newStream.getTracks().forEach((t) => {
    if (t !== newVideoTrack) t.stop();
  });

  const videoEl = cw ? $(`cam-vid-${safeId(ownUid)}`) : null;
  if (videoEl && videoEl.srcObject === state.localStream) {
    videoEl.srcObject = null;
    videoEl.srcObject = state.localStream;
  }
  if (dom.localVideoEl && dom.localVideoEl.srcObject === state.localStream) {
    dom.localVideoEl.srcObject = null;
    dom.localVideoEl.srcObject = state.localStream;
  }

  if (cw?.videoOff) newVideoTrack.enabled = false;

  replaceOutgoingMediaTrack('video', newVideoTrack);
}

/**
 * Cambia microfono dello stream locale e ricostruisce la pipeline Web Audio (volume / VU).
 */
async function switchLocalMicrophoneDevice(micId) {
  if (!state.localStream) return;
  const ownUid = state.currentUser?.id;
  if (!ownUid) return;

  const audioConstraint = micId
    ? { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true }
    : { echoCancellation: true, noiseSuppression: true };

  const newStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraint });
  const newRaw = newStream.getAudioTracks()[0];
  if (!newRaw) {
    newStream.getTracks().forEach((t) => t.stop());
    throw new Error('No audio track');
  }

  if (state.micPipeline) {
    try {
      await state.micPipeline.ctx.close();
    } catch (_) {}
    state.micPipeline = null;
  }

  state.localStream.getAudioTracks().forEach((t) => {
    try {
      state.localStream.removeTrack(t);
      t.stop();
    } catch (_) {}
  });
  state.localStream.addTrack(newRaw);
  newStream.getTracks().forEach((t) => {
    if (t !== newRaw) t.stop();
  });

  state.micPipeline = (await createMicVolumePipeline(state.localStream)) || null;
  const outAudio = state.localStream.getAudioTracks()[0];
  replaceOutgoingMediaTrack('audio', outAudio);

  const cw = state.cameraWindows[ownUid];
  if (cw && cw.micEnabled === false && outAudio) outAudio.enabled = false;

  startMicMeter(state.localStream, ownUid);
  if (state.cameraWindows[ownUid]) initMicVolumeSlider(ownUid);
}

/**
 * Se la camera è attiva (qualsiasi stanza, incluso Eventi), applica subito camera/mic
 * scelti in Impostazioni. `prev` = valori prima dell'aggiornamento di state.settings.
 */
export async function applyLiveDeviceSettingsIfStreaming(prev = {}) {
  const ownUid = state.currentUser?.id;
  if (!ownUid || !state.localStream) return;
  const cw = state.cameraWindows[ownUid];
  const hasRoomCam = state.cameraRoom != null && cw?.isOwn;
  const hasPrivateCall = !!state.privatePeer;
  const hasCallOnlyStream = !!(state.streamOpenedForCall && state.activeCallUID);
  if (!hasRoomCam && !hasPrivateCall && !hasCallOnlyStream) return;

  const pCam = prev.cameraId ?? '';
  const pMic = prev.micId ?? '';
  const curCam = state.settings?.cameraId || '';
  const curMic = state.settings?.micId || '';

  if (pCam === curCam && pMic === curMic) return;

  try {
    if (pCam !== curCam) await switchLocalVideoDevice(ownUid, curCam);
    if (pMic !== curMic) await switchLocalMicrophoneDevice(curMic);
  } catch (err) {
    console.warn('[Camera] applyLiveDeviceSettingsIfStreaming:', err);
    showToast('⚠️ Impossibile applicare il dispositivo. Riprova o riavvia la camera.');
  }
}

async function switchCameraDevice(ownUid, deviceId) {
  if (!state.localStream || !state.cameraWindows[ownUid]) return;
  const hadVideo = !!state.localStream.getVideoTracks()[0];
  if (!hadVideo) {
    showToast('⚠️ Nessun video attivo da sostituire.');
    return;
  }
  try {
    state.settings = state.settings || {};
    state.settings.cameraId = deviceId;
    saveDeviceSettings(state.settings);
    await switchLocalVideoDevice(ownUid, deviceId);
    void import('./auth.js')
      .then((m) => { if (typeof m.syncProfileMediaDevicesFromState === 'function') m.syncProfileMediaDevicesFromState(); })
      .catch(() => {});
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
    state.micPipeline = (await createMicVolumePipeline(state.localStream)) || null;

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
export async function requestPublicCamera(targetUid, opts = {}) {
  const uid    = String(targetUid);
  const target = findUser(uid);
  const skipCooldown = opts.skipCooldown === true;
  const forceRetry = opts.forceRetry === true;
  const pendingTtlMs = Number.isFinite(opts.pendingTtlMs) ? Math.max(1000, opts.pendingTtlMs) : 60_000;
  const silentPendingExpiry = opts.silentPendingExpiry === true;
  console.log('[WebRTC-FLOW] CAM-REQ: request camera from', (uid || '').slice(0, 8) + '…', 'target=', (target?.id || '').slice(0, 8) + '…');
  /* Muted users cannot send camera requests (global or room-specific mute). */
  const myMute = state.currentUser?.id ? checkIsMuted(state.currentUser.id, state.activeRoom) : null;
  if (myMute) {
    const scope = myMute.global ? 'globally' : 'in this room';
    showToast(`🔇 You are muted ${scope} and cannot request cameras.`);
    return;
  }
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
    if (!forceRetry) return;
    clearPendingCamRequest(uid);
  }
  /* Rate-limit: max 1 richiesta ogni 30s per lo stesso destinatario */
  const CAM_REQ_COOLDOWN_MS = 30_000;
  const lastReqTs = state.camReqCooldowns[uid] || 0;
  if (!skipCooldown && Date.now() - lastReqTs < CAM_REQ_COOLDOWN_MS) {
    const secsLeft = Math.ceil((CAM_REQ_COOLDOWN_MS - (Date.now() - lastReqTs)) / 1000);
    showToast(`⏳ Attendi ${secsLeft}s prima di inviare un'altra richiesta cam.`);
    return;
  }
  state.camReqCooldowns[uid] = Date.now();
  console.log('[Camera Request] Sending camera request to', uid, 'in room', state.activeRoom);
  /* L'utente sta chiedendo di nuovo esplicitamente: se prima aveva chiuso manualmente quella cam, permettiamo di riaprirla. */
  if (state.manuallyClosedCameras[uid]) {
    delete state.manuallyClosedCameras[uid];
    console.log('[Camera Request] Clearing manual-close flag for', uid, 'due to explicit new request');
  }
  setPendingCamRequest(uid, 'public', target.name, {
    ttlMs: pendingTtlMs,
    showExpiryToast: !silentPendingExpiry,
  });
  /* Non inviare requesterHasForceView nella payload: il ricevente verifica
     in modo indipendente da Firebase — il campo è spoofabile da client malevoli. */
  broadcast('cam-req', uid, { reqType: 'public', room_id: state.activeRoom });
  showToast(`📹 Camera request sent to ${target.name}…`);
}

/* ── Incoming cam/call request ────────────────────────────────── */
export async function handleCamRequest(payload) {
  if (payload.to !== state.currentUser?.id) return;
  const fromId   = String(payload.from);
  /* Usa il nome dalla fonte fidata (stato locale/DB), non dalla payload —
     il mittente potrebbe mettere qualsiasi stringa come fromName. */
  const fromName = findUser(fromId)?.name || payload.fromName || 'User';

  /* room_id e confronti in stringa per evitare problemi PC (number vs string dopo 15s / tab switch) */
  const requestRoom = payload.room_id != null ? String(payload.room_id) : null;
  /* Reject cam requests from muted users to enforce rule even if sender bypasses UI. */
  const requesterMuted = checkIsMuted(fromId, requestRoom || state.activeRoom);
  if (requesterMuted) {
    broadcast('cam-rejected', fromId, { reqType: payload.reqType || 'public', reason: 'muted-user' });
    return;
  }
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

  /* Ruolo con "View cams without accept": verifica indipendente da Firebase —
     NON ci si fida del campo requesterHasForceView nella payload (spoofabile). */
  if (payload.reqType === 'public') {
    try {
      const requesterPerms = await loadPermissionsForUser(fromId);
      if (requesterPerms.can_view_cam_without_accept === true) {
      sharePublicCameraTo(fromId);
      return;
    }
    } catch (_) {}
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
  if (String(payload.to) !== String(state.currentUser?.id)) return;
  clearPendingCamRequest(String(payload.from));
  if (payload.reqType === 'private') startPrivateCall(payload.from, payload.fromName);
}

/* ── Share own camera to a viewer via WebRTC ───────────────────── */
export async function sharePublicCameraTo(toUid) {
  console.log('[WebRTC-FLOW] sharePublicCameraTo called → will send offer to', (toUid || '').slice(0, 8) + '…');
  try {
    if (!state.localStream) {
      const msSince = Date.now() - state.cameraClosedAt;
      if (msSince < 450) await new Promise(r => setTimeout(r, 450 - msSince));
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.micPipeline = (await createMicVolumePipeline(state.localStream)) || null;
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
      clearEncodingRampTimer(oldPc);
      oldPc.close();
      delete state.outgoingPCs[toUid];
    }
    const pc = new RTCPeerConnection(await getIceConfig());
    state.outgoingPCs[toUid] = pc;
    const tracks = state.localStream.getTracks().filter(t => t.readyState === 'live');
    console.log('[WebRTC-FLOW] OUTGOING: add', tracks.length, 'tracks to', (toUid || '').slice(0, 8) + '…');
    tracks.forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        const cStr = candidate.candidate || '';
        const candType = candidate.type || (cStr.includes(' typ relay ') ? 'relay' :
                                            cStr.includes(' typ srflx ') ? 'srflx' :
                                            cStr.includes(' typ host ') ? 'host' : 'unknown');
        console.log('[WebRTC-FLOW] TX ICE dir=out to', (toUid || '').slice(0, 8) + '…', 'type=', candType);
        /* Serialize so Firebase/JSON round-trip preserves candidate (RTCIceCandidate may not survive) */
        const candidatePayload = { candidate: cStr, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? 0 };
        broadcast('webrtc', toUid, { sigType: 'ice', candidate: candidatePayload, ctx: 'public', dir: 'out' });
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    applyVideoEncoding(pc, 'low');
    updateCamQualityUI('low');
    startEncodingRampUp(pc, toUid);
    console.log('[WebRTC-FLOW] OUTGOING: send offer to', (toUid || '').slice(0, 8) + '…', 'sdpLen=', offer.sdp?.length);
    broadcast('webrtc', toUid, { sigType: 'offer', sdp: offer.sdp, ctx: 'public', room_id: state.cameraRoom });
    broadcast('cam-accepted', toUid, {});
    
    const viewerUser = findUser(toUid);
    state.camViewers[toUid] = viewerUser?.username || viewerUser?.name || toUid;
    refreshViewersPanel(state.currentUser.id);

    /* Monitor outgoing connection — attempt ICE restart on disconnect before giving up */
    pc.addEventListener('connectionstatechange', () => {
      console.log('[WebRTC] Outgoing connection state changed:', pc.connectionState, 'for', toUid);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        console.log('[WebRTC] Outgoing', pc.connectionState, 'for', toUid, '— ICE restart (cooldown condiviso)');
        tryIceRestartOutgoingPublic(pc, toUid);
      }
      /* Solo su closed: altrimenti disconnected/failed toglie il viewer prima che il restart ICE possa recuperare */
      if (pc.connectionState === 'closed') {
        clearEncodingRampTimer(pc);
        delete state.camViewers[toUid]; refreshViewersPanel(state.currentUser?.id);
      }
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      console.log('[WebRTC] Outgoing ICE connection state changed:', pc.iceConnectionState, 'for', toUid);
    });
    startPublicCamRelayRecoveryOutgoing(pc, toUid);
  } catch (err) { showToast('⚠️ Could not share camera: ' + err.message); }
}

/* ── Ramp silenzioso qualità CATTURA (getUserMedia): minimal → low → medium → high ── */
async function tryRampUpCaptureQuality() {
  captureRampTimer = null;
  if (!state.localStream || state.cameraRoom == null) return;
  const levels = ['minimal', 'low', 'medium', 'high'];
  const cur = state.videoCaptureLevel || 'minimal';
  const idx = levels.indexOf(cur);
  const next = levels[idx + 1];
  if (!next) return;
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: getVideoConstraintsForLevel(next),
      audio: false,
    });
    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) {
      newStream.getTracks().forEach(t => t.stop());
          return;
    }
    const oldVideoTrack = state.localStream.getVideoTracks()[0];
    if (!oldVideoTrack) {
      newStream.getTracks().forEach(t => t.stop());
      return;
    }
    state.localStream.removeTrack(oldVideoTrack);
    state.localStream.addTrack(newVideoTrack);
    oldVideoTrack.stop();
    newStream.getTracks().filter(t => t !== newVideoTrack).forEach(t => t.stop());
    state.videoCaptureLevel = next;
    Object.values(state.outgoingPCs || {}).forEach(pc => {
      const sender = pc.getSenders?.().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(newVideoTrack).catch(() => {});
    });
    const delays = { minimal: 5000, low: 10000, medium: 15000, high: 0 };
    const delay = delays[next] || 0;
    if (delay > 0) captureRampTimer = setTimeout(() => tryRampUpCaptureQuality(), delay);
  } catch (_) {
    /* Fallito: resta al livello corrente; nessun toast, silenzioso */
  }
}

/* ── Qualità video adattiva (encoding WebRTC): partenza bassa, ramp-up se la connessione regge ── */
/* Bitrate più bassi = meno GB su TURN quando serve relay; il ramp-up sale comunque se la rete regge */
const ENCODING_PROFILES = {
  low:    { maxBitrate: 200000, scaleResolutionDownBy: 2   },
  medium: { maxBitrate: 360000, scaleResolutionDownBy: 1.5 },
  high:   { maxBitrate: 550000, scaleResolutionDownBy: 1   },
};
const RAMP_UP_INTERVAL_MS = 15000;

function applyVideoEncoding(pc, profile) {
  const p = ENCODING_PROFILES[profile] || ENCODING_PROFILES.low;
  try {
    pc.getSenders().forEach(sender => {
      if (sender.track?.kind !== 'video') return;
      sender.getParameters().then(params => {
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = p.maxBitrate;
        params.encodings[0].scaleResolutionDownBy = p.scaleResolutionDownBy;
        return sender.setParameters(params);
      }).catch(() => {});
    });
  } catch (_) {}
}

function clearEncodingRampTimer(pc) {
  if (pc?._encodingRampTimer) { clearInterval(pc._encodingRampTimer); pc._encodingRampTimer = null; }
}

const QUALITY_LABELS = { low: 'Bassa', medium: 'Media', high: 'Alta' };

function updateCamQualityUI(level) {
  currentEncodingLevel = level;
  const uid = state.currentUser?.id;
  if (!uid) return;
  const id = safeId(uid);
  const labelEl = document.getElementById(`cam-quality-label-${id}`);
  if (labelEl) labelEl.textContent = QUALITY_LABELS[level] || 'Bassa';
  const btnEl = document.getElementById(`cam-quality-btn-${id}`);
  if (btnEl) {
    btnEl.textContent = forceLowQuality ? 'Ripristina qualità auto' : 'Riduci qualità';
    btnEl.title = forceLowQuality ? 'Ripristina aumento automatico qualità' : 'Riduci qualità per connessioni lente';
  }
}

function startEncodingRampUp(pc, peerId) {
  if (pc._encodingRampTimer) return;
  let level = 0;
  const levels = ['low', 'medium', 'high'];
  pc._encodingRampTimer = setInterval(() => {
    if (pc.connectionState === 'closed') {
      clearEncodingRampTimer(pc);
          return;
    }
    if (forceLowQuality) return;
    if (pc.connectionState !== 'connected') return;
    level = Math.min(level + 1, levels.length - 1);
    const profile = levels[level];
    applyVideoEncoding(pc, profile);
    updateCamQualityUI(profile);
    if (level >= levels.length - 1) clearEncodingRampTimer(pc);
  }, RAMP_UP_INTERVAL_MS);
}

/* Filtro anti-replay Firebase: child_added consegna tutti i messaggi passati → scarta webrtc scritti prima della nostra connessione */
const WEBRTC_CONNECT_SKEW_MS = 5000;

/** Serializza ICE per Firebase/JSON (come cam pubblica) — RTCIceCandidate non sopravvive al round-trip. */
function serializeIceForBroadcast(c) {
  if (!c || !c.candidate) return null;
  return {
    candidate: c.candidate,
    sdpMid: c.sdpMid ?? null,
    sdpMLineIndex: c.sdpMLineIndex ?? 0,
  };
}

function parseIceFromBroadcast(raw) {
  if (raw == null) return null;
  if (raw instanceof RTCIceCandidate) return raw;
  const candStr = typeof raw === 'string' ? String(raw).trim() : raw.candidate;
  if (!candStr) return null;
  const init = {
    candidate: candStr,
    sdpMid: raw.sdpMid != null ? raw.sdpMid : null,
    sdpMLineIndex: raw.sdpMLineIndex != null ? raw.sdpMLineIndex : 0,
  };
  try {
    return new RTCIceCandidate(init);
  } catch (_) {
    return null;
  }
}

async function addPrivatePeerIceCandidate(pc, raw) {
  if (!pc) return;
  const ice = parseIceFromBroadcast(raw);
  if (!ice) return;
  if (!pc.remoteDescription) {
    pc._privatePendingIce = pc._privatePendingIce || [];
    pc._privatePendingIce.push(ice);
    return;
  }
  await pc.addIceCandidate(ice).catch((err) => console.warn('[WebRTC private] addIceCandidate:', err?.message || err));
}

async function flushPrivatePeerPendingIce(pc) {
  if (!pc?._privatePendingIce?.length) return;
  const pending = pc._privatePendingIce.splice(0);
  for (const ice of pending) {
    await pc.addIceCandidate(ice).catch((err) => console.warn('[WebRTC private] flush ICE:', err?.message || err));
  }
}

function attachPrivatePeerMediaRecovery(pc) {
  const tryPlayRemote = () => {
    const v = dom.remoteVideoEl;
    if (!v?.srcObject) return;
    v.muted = false;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.play().catch(() => {});
  };
  pc.addEventListener('iceconnectionstatechange', () => {
    const s = pc.iceConnectionState;
    if (s === 'connected' || s === 'completed') {
      dom.vcallStatus.textContent = 'Connected';
      setTimeout(tryPlayRemote, 50);
      setTimeout(tryPlayRemote, 400);
      setTimeout(tryPlayRemote, 1200);
    } else if (s === 'failed') {
      dom.vcallStatus.textContent = 'Connessione fallita';
    } else if (s === 'disconnected') {
      dom.vcallStatus.textContent = 'Connessione instabile…';
    }
  });
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'connected') {
      dom.vcallStatus.textContent = 'Connected';
      setTimeout(tryPlayRemote, 100);
      setTimeout(tryPlayRemote, 1600);
    }
    if (pc.connectionState === 'failed') dom.vcallStatus.textContent = 'Connessione fallita';
  });
}

function bindPrivatePeerOnTrack(pc) {
  pc.ontrack = (ev) => {
    const tr = ev.track;
    const v = dom.remoteVideoEl;
    if (ev.streams?.[0]) {
      v.srcObject = ev.streams[0];
    } else if (tr) {
      let ms = v.srcObject instanceof MediaStream ? v.srcObject : null;
      if (!ms) ms = new MediaStream();
      if (!ms.getTracks().some((t) => t.id === tr.id)) ms.addTrack(tr);
      v.srcObject = ms;
    } else {
      return;
    }
    v.muted = false;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    dom.remotePlaceholder.style.display = 'none';
    /* "Connected" solo quando ICE è ok — evita falso positivo mentre il video è ancora nero */
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      dom.vcallStatus.textContent = 'Connected';
    }
    const play = () => { v.muted = false; v.play().catch(() => {}); };
    play();
    tr.addEventListener('unmute', play);
    tr.addEventListener('ended', () => console.warn('[WebRTC private] remote track ended', tr.kind));
  };
}

/** Nome da mostrare per il peer in videochiamata (nick da broadcast / lista / lastKnownNames, mai solo uid lungo). */
function peerDisplayName(peerUid, signalPayload = null) {
  const uid = String(peerUid);
  const fn = signalPayload?.fromName && String(signalPayload.fromName).trim();
  if (fn) ensureUser(uid, fn, { online: true });
  const u = state.users.find(x => String(x.id) === uid);
  const listName = u?.name && String(u.name).trim();
  if (listName) return listName;
  if (fn) return fn;
  const lk = state.lastKnownNames?.[uid];
  if (lk && String(lk).trim()) return String(lk).trim();
  return uid;
}

/* ── All incoming WebRTC signals ──────────────────────────────── */
export async function handleWebRTCSignal(payload) {
  const { sigType, from, sdp, candidate, dir } = payload || {};
  const isPublic = payload?.ctx === 'public', isPrivate = payload?.ctx === 'private';
  /* Hard guard: ignore public signaling from users currently banned or kicked in this room.
     Prevents stale/replayed offers from re-creating ghost camera/user state. */
  if (isPublic && from) {
    if (checkIsBanned(String(from)) || checkIsKicked(String(from), String(state.activeRoom))) {
      delete state.pendingIncomingICE[from];
      return;
    }
  }
  const toMeStrict = payload != null && state.currentUser?.id != null && String(payload.to).trim() === String(state.currentUser.id).trim();
  /* ICE pubblica: a volte `to` è corretto via Firebase; mai usare fallback per ctx private (deve matchare `to`). */
  const toMeIceFallback = sigType === 'ice' && from && candidate && payload?.ctx !== 'private';
  const toMe = toMeStrict || toMeIceFallback;
  if (!toMe) {
    if (payload?.sigType === 'ice') {
      console.log('[WebRTC-FLOW] SKIP ICE (to!=me)', payload?.to != null ? 'to=' + String(payload.to).slice(0, 12) : 'payload.to missing', 'me=' + (String(state.currentUser?.id || '')).slice(0, 12), 'ctx=', payload?.ctx || '');
    } else if (payload?.sigType === 'offer' && payload?.to != null) {
      console.log('[WebRTC-FLOW] SKIP offer to!=me', 'to=', String(payload.to).slice(0, 12), 'me=', (String(state.currentUser?.id || '')).slice(0, 12));
    }
    return;
  }
  if (sigType === 'ice' && candidate) {
    console.log('[WebRTC-FLOW] RX ICE for me from', (from || '').slice(0, 8) + '…', toMeIceFallback && !toMeStrict ? '(public ICE fallback)' : '', 'ctx=', payload?.ctx || '');
  }

  /* Firebase/Supabase replay: ignora offer troppo vecchie (evita cam / videochiamata privata che riappaiono al refresh).
     ICE/answer senza PC attivo sono già no-op; offer crea PC + UI → va filtrata. */
  const offerSignalTs = payload._ts ?? payload.ts;
  if (sigType === 'offer' && offerSignalTs != null && state.broadcastConnectedAt > 0 && offerSignalTs < state.broadcastConnectedAt - WEBRTC_CONNECT_SKEW_MS) {
    if (isPublic || isPrivate) return;
  }

  /* Public block: SOLO cam stanza / ICE senza ctx private.
     CRITICO: ICE con ctx==='private' non deve MAI passare qui — altrimenti i candidati finiscono su incomingPC pubblico
     (stesso uid del peer) e la videochiamata privata resta senza ICE → video nero. */
  const handleAsPublic = isPublic || (sigType === 'ice' && from && candidate && payload?.ctx !== 'private');
  if (handleAsPublic) {
      /* Viewer chiede rinegoziazione ICE (es. relay TURN pessimo → provare di nuovo host/srflx) */
      if (sigType === 'viewer_ice_restart_offer' && isPublic && sdp) {
        const viewerUid = from;
        const pcOut = state.outgoingPCs[viewerUid];
        if (!pcOut) return;
        if (pcOut.signalingState !== 'stable') return;
        try {
          await pcOut.setRemoteDescription({ type: 'offer', sdp });
          const ans = await pcOut.createAnswer();
          await pcOut.setLocalDescription(ans);
          broadcast('webrtc', viewerUid, { sigType: 'answer', sdp: ans.sdp, ctx: 'public' });
          console.log('[WebRTC] viewer_ice_restart_offer ok → answer verso', String(viewerUid).slice(0, 8) + '…');
        } catch (e) {
          console.warn('[WebRTC] viewer_ice_restart_offer fallito', e?.message || e);
        }
        return;
      }
      if (sigType === 'offer') {
        if (!isPublic) return; /* only process public offers */
        /* Ignora offerta propria: Firebase recapita il messaggio anche al mittente, non creare incoming PC per se stessi */
        if (from && state.currentUser?.id && String(from) === String(state.currentUser.id)) return;
        /* Rifiuta offerta non solicitata: se non abbiamo né una richiesta pendente, né una finestra
           già aperta, né una PC esistente per questo broadcaster, l'offer è arrivata per un altro
           utente (stesso UID su due tab, o segnale consegnato a tutti su canale broadcast).
           Eccezione: stanza Events (auto-request) → la pendingCamRequest viene già impostata. */
        const hasPending  = !!state.pendingCamRequests[from];
        const hasWindow   = !!state.cameraWindows[from];
        const hasPC       = !!state.incomingPCs[from];
        const hasViewerIntent = hasPending || hasWindow || hasPC;
        if (!hasPending && !hasWindow && !hasPC) {
          console.log('[WebRTC] Rejecting unsolicited offer from', (from || '').slice(0, 8) + '… — no pending request / window / PC for this peer');
          return;
        }
        /* Accetta offerta se: (a) hasCamera=true in locale, oppure (b) room_id dell'offer
           coincide con la stanza attiva. Il caso (b) copre la race condition in cui l'offer
           arriva prima del broadcast cam-opened, o durante reconnect quando removeRemoteCameraFromGrid
           ha già azzerato hasCamera. */
        const offererHasCamInMyRoom = !!state.rooms[state.activeRoom]?.users[from]?.hasCamera;
        const offerRoomId = payload.room_id != null ? String(payload.room_id) : null;
        const offerRoomMatches = offerRoomId === String(state.activeRoom);
        /* IMPORTANT:
           room_id match alone is not enough (replayed/stale offers can still carry current room_id).
           Accept room_id fallback only when there is an active viewer intent for this peer. */
        if (!offererHasCamInMyRoom && !(offerRoomMatches && hasViewerIntent)) {
          console.log('[WebRTC] Rejecting offer from', (from || '').slice(0, 8) + '… — no camera in current room', state.activeRoom, 'offer room_id=', offerRoomId);
          return;
        }
        /* Offer accettata: se hasCamera era temporaneamente false (race condition), correggilo */
        if (!offererHasCamInMyRoom && state.rooms[state.activeRoom]?.users[from]) {
          state.rooms[state.activeRoom].users[from].hasCamera = true;
          const uFix = findUser(from);
          if (uFix) uFix.hasCamera = true;
        }
        /* Serializza per peer: replay Firebase può consegnare la stessa offer più volte; la seconda deve aspettare la prima e poi uscire. */
        const prev = state._incomingOfferDone[from] || Promise.resolve();
        let doneResolve;
        state._incomingOfferDone[from] = new Promise(r => { doneResolve = r; });
        try {
          await prev;
        } catch (_) {}
        try {
          if (state.manuallyClosedCameras[from]) return;
          const existingInc = state.incomingPCs[from];
          if (existingInc && sdp) {
            const canRenego =
              existingInc.signalingState === 'stable' &&
              ['connected', 'connecting', 'disconnected'].includes(existingInc.connectionState);
            if (canRenego) {
              try {
                console.log('[WebRTC] Nuova offerta su PC esistente (ICE restart broadcaster) da', String(from).slice(0, 8) + '…');
                await existingInc.setRemoteDescription({ type: 'offer', sdp });
                const answer = await existingInc.createAnswer();
                await existingInc.setLocalDescription(answer);
                broadcast('webrtc', from, { sigType: 'answer', sdp: answer.sdp, ctx: 'public' });
                startPublicCamRelayRecoveryIncoming(existingInc, from);
              } catch (err) {
                console.warn('[WebRTC] Re-offer / ICE restart fallita:', err?.message || err);
              }
              return;
            }
            return;
          }

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
      
      /* Viewer: usa ICE normale (host+srflx+relay). Con relay-only i candidati che arrivano sono spesso host/srflx e vengono ignorati → ICE resta "new". */
      const pc = new RTCPeerConnection(await getIceConfig());
      pc._createdInRoom = state.activeRoom; /* Track room at creation — used to discard stale streams */
      pc._camRoom = payload.room_id != null ? String(payload.room_id) : null; /* room where cam was opened (from offer) */
      state.incomingPCs[from] = pc;
      pc.onicecandidate = ({ candidate: c }) => {
        if (c) {
          const cStr = c.candidate || '';
          const candType = c.type || (cStr.includes(' typ relay ') ? 'relay' :
                                      cStr.includes(' typ srflx ') ? 'srflx' :
                                      cStr.includes(' typ host ') ? 'host' : 'unknown');
          _noteCandidateNetType(from, candType);
          const candidatePayload = { candidate: cStr, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? 0 };
          broadcast('webrtc', from, { sigType: 'ice', candidate: candidatePayload, ctx: 'public', dir: 'in' });
        }
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
            /* Sostituisci subito l'elemento video (spesso era nero con stream solo-audio); poi retry a intervalli */
            replaceRemoteVideoElement(from);
            /* Solo 2 passaggi ritardati: evita sfarfallii da troppi replaceChild */
            [650, 2200].forEach((t) => setTimeout(() => {
              if (state.cameraWindows[from]?.stream === cw.stream) replaceRemoteVideoElement(from);
            }, t));
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
      let wasEverConnected = false; /* riduce retry se la connessione non si è mai stabilita */
      /* Cellular / TURN: handshake più lento — evita timeout prematuro su 5G */
      const CONNECTING_TIMEOUT_MS = isLikelyCellularNetwork() ? 60_000 : 45_000;
      let connectingTimeout = setTimeout(() => {
        if (state.incomingPCs[from] !== pc) return;
        if (pc.connectionState === 'connecting' || pc.connectionState === 'new') {
          console.warn('[WebRTC-FLOW] INCOMING TIMEOUT', CONNECTING_TIMEOUT_MS / 1000, 's for', from, '| connectionState=', pc.connectionState, 'iceState=', pc.iceConnectionState, '→ remove remote cam (user stays in list)');
          try { pc.close(); } catch {}
          delete state.incomingPCs[from]; delete state.pendingIncomingICE[from];
          /* Timeout non equivale a cam spenta: non azzerare hasCamera, ritenta richiesta */
          removeRemoteCameraFromGrid(from, { keepHasCamera: true }).then(() => {
            const u = findUser(from);
            if (u?.online && !state.manuallyClosedCameras?.[from]) {
              delete state.pendingCamRequests[from];
              requestPublicCamera(from, { skipCooldown: true, forceRetry: true, pendingTtlMs: 5000, silentPendingExpiry: true });
            }
          }).catch(() => {});
        }
      }, CONNECTING_TIMEOUT_MS);

      pc.addEventListener('connectionstatechange', () => {
        console.log('[WebRTC-FLOW] INCOMING connectionState=', pc.connectionState, 'iceConnectionState=', pc.iceConnectionState, 'for', from.slice(0, 8) + '…');
        if (pc.connectionState === 'connected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          clearTimeout(connectingTimeout);
        }

        if (pc.connectionState === 'connected') {
          wasEverConnected = true;
          /* Connessione stabilita: reset contatore globale e rimuovi overlay */
          delete _globalReconnectCounts[from];
          state.cameraWindows[from]?.el?.querySelector('.cam-reconnecting')?.remove();
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
                removeRemoteCameraFromGrid(from, { keepHasCamera: true }).then(() => {
                  const u = findUser(from);
                  if (u?.online && !state.manuallyClosedCameras?.[from]) {
                    delete state.pendingCamRequests[from];
                    requestPublicCamera(from, { skipCooldown: true, forceRetry: true, pendingTtlMs: 5000, silentPendingExpiry: true });
                  }
                }).catch(() => {});
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
          }
        }
        
        if (pc.connectionState === 'failed') {
          if (state.incomingPCs[from] !== pc) return;
          delete state.incomingPCs[from]; delete state.pendingIncomingICE[from];
          /* Su mobile Chrome ICE può fallire entro ~1s.
             Invece di chiudere subito, mostriamo un overlay "Riconnessione…"
             e ritentiamo MAX_RECONNECT volte con delay crescente.
             Se nel frattempo il broadcaster ha inviato un ICE-restart offer
             e state.incomingPCs[from] è già stato ricreato, il timer esce
             senza toccare nulla. */
          if (reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            const delay = Math.min(reconnectAttempts * 3000, 9000);
            const cwF = state.cameraWindows[from];
            if (cwF?.el) {
              const wrapF = cwF.el.querySelector('.cam-win-video-wrap') || cwF.el;
              if (!wrapF.querySelector('.cam-reconnecting')) {
                const ov = document.createElement('div');
                ov.className = 'cam-reconnecting';
                ov.textContent = '⟳ Riconnessione…';
                wrapF.appendChild(ov);
              }
            }
            setTimeout(() => {
              if (pc._createdInRoom && String(state.activeRoom) !== String(pc._createdInRoom)) return;
              if (state.manuallyClosedCameras[from]) return;
              state.cameraWindows[from]?.el?.querySelector('.cam-reconnecting')?.remove();
              /* Se una nuova connessione è già in corso (es. ICE restart del
                 broadcaster), non interferire: lasciamo che si stabilisca. */
              if (state.incomingPCs[from]) return;
              const user = findUser(from);
              /* Incrementa contatore globale; dopo MAX_GLOBAL_RECONNECT stop al loop */
              _globalReconnectCounts[from] = (_globalReconnectCounts[from] || 0) + 1;
              const tooManyRetries = _globalReconnectCounts[from] > MAX_GLOBAL_RECONNECT;
              if (user?.online && !tooManyRetries) {
                /* keepHasCamera=true: il broadcaster ha ancora la cam — non azzeriamo
                   il flag così l'offer di riconnessione non viene rifiutata. */
                removeRemoteCameraFromGrid(from, { keepHasCamera: true }).then(() => {
                  if (!state.cameraWindows[from] && !state.incomingPCs[from]) {
                delete state.pendingCamRequests[from];
                requestPublicCamera(from, { skipCooldown: true, forceRetry: true, pendingTtlMs: 5000, silentPendingExpiry: true });
                  }
                }).catch(() => {});
              } else {
                /* Troppi tentativi o utente offline: chiudi definitivamente */
                delete _globalReconnectCounts[from];
                removeRemoteCameraFromGrid(from).catch(() => {});
              }
            }, delay);
          } else {
            removeRemoteCameraFromGrid(from).catch(() => {});
          }
        }
      });
      /* Retry play() quando la connessione è pronta. Un solo reattach alla prima connected per evitare flicker. */
      let didReattach = false;
      const retryPlay = (trigger, forceReattach = false) => {
        const cw = state.cameraWindows[from];
        if (!cw?.el) return;
        const vid = cw.el.querySelector('video');
        if (!vid) return;
        if (forceReattach && cw.stream && !didReattach) {
          didReattach = true;
          vid.srcObject = null;
          vid.srcObject = cw.stream;
          vid.muted = true; /* remoto: audio solo da Web Audio così volume/mute funzionano */
        }
        if (!vid.srcObject) return;
        if (!vid.paused && !forceReattach) return;
        vid.play().then(() => {}).catch(() => {});
      };

      pc.addEventListener('iceconnectionstatechange', () => {
        console.log('[WebRTC-FLOW] INCOMING PC', from.slice(0, 8) + '…', 'iceConnectionState=', pc.iceConnectionState, 'connectionState=', pc.connectionState);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          /* Solo play: reattach troppo presto qui spesso non porta frame → meglio dopo connectionState connected */
          setTimeout(() => retryPlay('ICE-connected', false), 120);
          /* Fallback per browser che non espongono selected candidate pair:
             se abbiamo visto candidati ma non relay, assumiamo P2P quando ICE è connesso. */
          const cw = state.cameraWindows?.[from];
          if (cw && cw._sawAnyIceCand && !cw._sawRelayIceCand) _setNetBadge(from, 'P2P');
        } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          tryIceRestartIncomingPublic(pc, from);
        }
      });
      
      pc.addEventListener('connectionstatechange', () => {
        console.log('[WebRTC-FLOW] INCOMING PC', from.slice(0, 8) + '…', 'connectionState=', pc.connectionState, 'iceConnectionState=', pc.iceConnectionState);
        if (pc.connectionState === 'connected') {
          setTimeout(() => retryPlay('connection-connected', true), 550);
          setTimeout(() => retryPlay('connection+2s', false), 2400);
          /* Eventi: un solo recupero “nero” se dopo ICE il video non decodifica (senza loop) */
          setTimeout(() => {
            if (state.incomingPCs[from] !== pc) return;
            const cw = state.cameraWindows[from];
            if (!cw?.isEventsGrid || !cw.el || !cw.stream) return;
            const vid = cw.el.querySelector('video');
            if (!vid || !vid.srcObject) return;
            const hasLiveVideo = cw.stream.getVideoTracks().some((t) => t.kind === 'video' && t.readyState === 'live');
            if (!hasLiveVideo) return;
            if (vid.videoWidth > 0 && !vid.paused) return;
            vid.srcObject = null;
            vid.srcObject = cw.stream;
            vid.muted = true;
            vid.play().catch(() => {});
            /* Un solo replace se ancora nero (max 1 volta extra oltre retryPlay) */
            setTimeout(() => {
              if (state.incomingPCs[from] !== pc || !state.cameraWindows[from]?.isEventsGrid) return;
              if (vid.videoWidth > 0) return;
              replaceRemoteVideoElement(from);
            }, 400);
          }, 2100);
        }
      });
      console.log('[WebRTC-FLOW] INCOMING PC', from.slice(0, 8) + '…', 'listeners attached, initial state:', pc.connectionState, pc.iceConnectionState);
      console.log('[WebRTC-FLOW] INCOMING: setRemoteDescription(offer) for', from);
      await pc.setRemoteDescription({ type: 'offer', sdp });
      /* Flush gli ULTIMI N ICE nel buffer (i più recenti = quasi sempre per quest'offerta). Con relay-only servono i candidati relay che arrivano dopo l'offer; se filtriamo per _ts restiamo con 0 e ICE resta "new". */
      const pending = state.pendingIncomingICE[from] || [];
      const maxFlush = 50;
      const toFlush = pending.length <= maxFlush ? pending : pending.slice(-maxFlush);
      state.pendingIncomingICE[from] = [];
      if (toFlush.length) {
        console.log('[WebRTC] VIEWER: flush', toFlush.length, 'buffered ICE (last', maxFlush, ') to incoming PC from', from.slice(0, 8) + '…');
        for (const entry of toFlush) {
          const c = entry.c || entry;
          await pc.addIceCandidate(c).catch(err => console.warn('[WebRTC] Pre-PC ICE flush error:', err.message));
        }
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
      console.log('[WebRTC-FLOW] INCOMING after ICE flush:', from.slice(0, 8) + '…', 'iceConn=', pc.iceConnectionState, 'conn=', pc.connectionState);
      /* Diagnostic: log PC state after 2s and 5s to see if we ever reach connected (NAT/firewall) */
      [2000, 5000].forEach(ms => setTimeout(() => {
        if (state.incomingPCs[from] !== pc) return;
        console.log('[WebRTC-FLOW] INCOMING PC', from.slice(0, 8) + '…', '+' + (ms/1000) + 's', 'iceConn=', pc.iceConnectionState, 'conn=', pc.connectionState);
      }, ms));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[WebRTC-FLOW] INCOMING PC', from.slice(0, 8) + '…', 'after createAnswer, state:', pc.connectionState, pc.iceConnectionState);
      /* Retry play senza reattach a 1.5s e 4s per connessioni che si stabiliscono in ritardo (NAT/firewall); evita multipli reattach = meno flicker */
      [1500, 4000].forEach(ms => setTimeout(() => retryPlay('delayed-' + ms + 'ms', false), ms));
      broadcast('webrtc', from, { sigType: 'answer', sdp: answer.sdp, ctx: 'public' });
      startPublicCamRelayRecoveryIncoming(pc, from);
        } finally {
          if (typeof doneResolve === 'function') doneResolve();
        }
      return;
    }
    if (sigType === 'answer') {
      if (!isPublic) return; /* only process public answers */
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
        /* Dopo ICE restart avviato dal viewer: answer sul nostro incoming PC */
        const inc = state.incomingPCs[from];
        if (inc && inc.signalingState === 'have-local-offer') {
          try {
            await inc.setRemoteDescription({ type: 'answer', sdp });
            console.log('[WebRTC] Answer applicata su incoming PC (post ICE restart viewer)');
            if (inc._pendingCandidates?.length) {
              for (const c of inc._pendingCandidates) {
                await inc.addIceCandidate(c).catch(() => {});
              }
              inc._pendingCandidates = [];
            }
          } catch (e) {
            console.warn('[WebRTC] Answer su incoming PC fallita', e?.message || e);
          }
        } else {
          console.log('[WebRTC-FLOW] RX answer from', from, '→ nessun outgoing/incoming in stato atteso (ignorata)');
        }
      }
    } else if (sigType === 'ice') {
      /* Route ICE candidate to correct PC based on 'dir' field:
         - dir:'out' means sender sent from their outgoingPC (sharing their cam TO us)
           → goes to our incomingPC (the one receiving their cam)
         - dir:'in'  means sender sent from their incomingPC (receiving our cam FROM us)
           → goes to our outgoingPC (the one sharing our cam)
         - no dir (legacy): try outgoingPC first, then incomingPC */
      if (!candidate) {
        if (from && state.incomingPCs?.[from]) console.warn('[WebRTC] ICE from', (from || '').slice(0, 8) + '…', 'missing candidate in payload (keys:', Object.keys(payload || {}).join(','), ')');
        return;
      }
      console.log('[WebRTC-FLOW] RX ICE from', (from || '').slice(0, 8) + '…', 'dir=', dir, 'hasIncomingPC=', !!state.incomingPCs[from], 'hasOutgoingPC=', !!state.outgoingPCs[from]);
      let pc;
      if (dir === 'out') {
        pc = state.incomingPCs[from]; /* Their outgoing shares to us → our incoming receives */
      } else if (dir === 'in') {
        pc = state.outgoingPCs[from]; /* Their incoming receives from us → our outgoing shares */
      } else {
        pc = state.outgoingPCs[from] || state.incomingPCs[from]; /* Legacy fallback */
      }
      /* Normalize: Firebase may deliver candidate as object { candidate, sdpMid, sdpMLineIndex } or as string (SDP line) */
      const candidateObj = typeof candidate === 'string'
        ? { candidate: candidate.trim() }
        : (candidate && typeof candidate === 'object' && 'candidate' in candidate ? candidate : { candidate: String(candidate) });
      const iceCandidate = candidate instanceof RTCIceCandidate ? candidate : new RTCIceCandidate(candidateObj);
      /* dir 'out': if we don't have incoming PC yet (offer not processed), buffer con _ts per flush solo ICE della stessa sessione.
         Bufferizza solo se abbiamo una richiesta pendente o una finestra/PC per questo peer:
         evita di accumulare ICE per broadcaster che non abbiamo mai richiesto (stesso UID su più tab). */
      if (dir === 'out' && !pc) {
        /* Buffer only when there is active viewer intent/relationship for this peer.
           This prevents stale ICE floods (replay/ghost peers) from filling the buffer forever. */
        const hasRelation = !!state.pendingCamRequests[from] || !!state.cameraWindows[from] || !!state.incomingPCs[from] || !!state.outgoingPCs[from];
        if (!hasRelation) {
          console.log('[WebRTC-FLOW] ICE from', (from || '').slice(0, 8) + '…', 'dir=out → DROP (no relation/intent)');
          return;
        }
        state.pendingIncomingICE[from] = state.pendingIncomingICE[from] || [];
        /* Cap a 100: evita crescita illimitata in caso di flood di candidati ICE */
        if (state.pendingIncomingICE[from].length < 100) {
          const iceTs = payload._ts ?? payload.ts ?? Date.now();
          state.pendingIncomingICE[from].push({ c: iceCandidate, _ts: iceTs });
        }
        console.log('[WebRTC-FLOW] ICE from', (from || '').slice(0, 8) + '…', 'dir=out → BUFFER (no incoming PC yet) size=', state.pendingIncomingICE[from].length);
        return;
      }
      if (pc) {
        const candType = candidate.type || (candidate.candidate?.includes(' typ relay ') ? 'relay' : 
                                          candidate.candidate?.includes(' typ srflx ') ? 'srflx' : 
                                          candidate.candidate?.includes(' typ host ') ? 'host' : 'unknown');
        const pcType = pc === state.outgoingPCs[from] ? 'outgoing' : 'incoming';
        /* Aggiorna badge rete: se vediamo un relay candidate, sappiamo che è TURN. */
        if (pcType === 'incoming') _noteCandidateNetType(from, candType);
        if (!pc.remoteDescription) {
          pc._pendingCandidates = pc._pendingCandidates || [];
          pc._pendingCandidates.push(iceCandidate);
          console.log('[WebRTC-FLOW] ICE from', (from || '').slice(0, 8) + '…', 'dir=', dir, '→', pcType, 'BUFFER (no remoteDesc) size=', pc._pendingCandidates.length);
        } else {
          if (pcType === 'incoming') console.log('[WebRTC] VIEWER: add ICE to incoming PC from', (from || '').slice(0, 8) + '…', 'type=', candType);
          await pc.addIceCandidate(iceCandidate).catch(err => console.warn('[WebRTC] addIceCandidate error:', err.message));
        }
      } else {
        console.log('[WebRTC-FLOW] ICE from', (from || '').slice(0, 8) + '…', 'dir=', dir, '→ DROP (no PC)');
      }
    }
  }

  if (isPrivate) {
    if (sigType === 'offer') {
      if (state.privatePeer) {
        try { state.privatePeer.close(); } catch (_) {}
        state.privatePeer = null;
      }
      const pc = new RTCPeerConnection(await getIceConfig());
      state.privatePeer = pc;
      state.activeCallUID = from;
      bindPrivatePeerOnTrack(pc);
      attachPrivatePeerMediaRecovery(pc);
      pc.onicecandidate = ({ candidate: c }) => {
        const p = serializeIceForBroadcast(c);
        if (p) broadcast('webrtc', from, { sigType: 'ice', candidate: p, ctx: 'private' });
      };
      if (state.localStream) state.localStream.getTracks().filter(t => t.readyState === 'live').forEach(t => pc.addTrack(t, state.localStream));
      const remoteLabel = peerDisplayName(from, payload);
      dom.localVideoEl.srcObject = state.localStream;
      dom.vcallName.textContent = remoteLabel;
      dom.vcallStatus.textContent = 'Connecting…';
      dom.vcallAvatar.textContent = initials(remoteLabel);
      dom.vcallAvatar.style.background = avatarColor(remoteLabel);
      dom.vcallWin.hidden = false;
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await flushPrivatePeerPendingIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await flushPrivatePeerPendingIce(pc);
      broadcast('webrtc', from, { sigType: 'answer', sdp: answer.sdp, ctx: 'private' });
    } else if (sigType === 'answer') {
      if (state.privatePeer) {
        try {
          await state.privatePeer.setRemoteDescription({ type: 'answer', sdp });
          await flushPrivatePeerPendingIce(state.privatePeer);
          dom.vcallStatus.textContent = 'In connessione…';
        } catch (err) {
          console.warn('[WebRTC private] answer failed:', err?.message || err);
        }
      }
    } else if (sigType === 'ice') {
      if (state.privatePeer && candidate) await addPrivatePeerIceCandidate(state.privatePeer, candidate);
    }
  }
}

function openRemoteCamWindow(uid, stream, userName = null) {
  if (String(uid) === String(state.currentUser?.id)) return;
  if (stream === state.localStream) return;
  clearPendingCamRequest(String(uid));
  const user = findUser(uid);
  createCameraWindow(uid, stream, userName || user?.name || uid, false);
  /* Aggiorna badge rete (P2P/RELAY) per questa connessione */
  const pc = state.incomingPCs?.[uid];
  if (pc) startNetModeMonitor(uid, pc);
}

/* ── Private video call ───────────────────────────────────────── */
async function acceptPrivateCall(fromUid, fromName) {
  try {
    if (!state.localStream) {
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.streamOpenedForCall = true;
    } else { state.streamOpenedForCall = false; }
    const remoteLabel = peerDisplayName(fromUid, fromName ? { fromName } : null);
    dom.localVideoEl.srcObject = state.localStream;
    dom.vcallName.textContent = remoteLabel;
    dom.vcallStatus.textContent = 'Connecting…';
    dom.vcallAvatar.textContent = initials(remoteLabel);
    dom.vcallAvatar.style.background = avatarColor(remoteLabel);
    dom.remotePlaceholder.style.display = ''; dom.vcallWin.hidden = false;
    state.activeCallUID = fromUid;
    broadcast('cam-accepted', fromUid, { reqType: 'private' });
  } catch (err) { showToast('⚠️ Could not access camera/mic: ' + err.message); }
}

async function startPrivateCall(targetUid, remoteFromName = null) {
  try {
    if (!state.localStream) {
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.streamOpenedForCall = true;
    } else { state.streamOpenedForCall = false; }
    const pc = new RTCPeerConnection(await getIceConfig());
    state.privatePeer = pc;
    state.activeCallUID = targetUid;
    bindPrivatePeerOnTrack(pc);
    attachPrivatePeerMediaRecovery(pc);
    state.localStream.getTracks().filter(t => t.readyState === 'live').forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate: c }) => {
      const p = serializeIceForBroadcast(c);
      if (p) broadcast('webrtc', targetUid, { sigType: 'ice', candidate: p, ctx: 'private' });
    };
    const remoteLabel = peerDisplayName(targetUid, remoteFromName ? { fromName: remoteFromName } : null);
    dom.localVideoEl.srcObject = state.localStream;
    dom.vcallName.textContent = remoteLabel;
    dom.vcallStatus.textContent = 'Calling…';
    dom.vcallAvatar.textContent = initials(remoteLabel);
    dom.vcallAvatar.style.background = avatarColor(remoteLabel);
    dom.remotePlaceholder.style.display = ''; dom.vcallWin.hidden = false;
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    applyVideoEncoding(pc, 'low');
    startEncodingRampUp(pc, targetUid);
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
  if (dom.vcallResizeHandle) {
    makeResizable(dom.vcallWin, dom.vcallResizeHandle, {
      minWidth: 260,
      minHeight: 220,
      maxWidth: () => window.innerWidth - 8,
      maxHeight: () => {
        const vv = window.visualViewport;
        return Math.max(200, (vv ? vv.height : window.innerHeight) - 8);
      },
      pinFirst: true,
    });
  }
}

export function endCall(notify = true) {
  if (notify && state.activeCallUID) broadcast('call-ended', state.activeCallUID, {});
  if (state.privatePeer) { clearEncodingRampTimer(state.privatePeer); state.privatePeer.close(); state.privatePeer = null; }
  dom.vcallWin.hidden = true;
  try {
    dom.vcallWin.style.width = '';
    dom.vcallWin.style.height = '';
    dom.vcallWin.style.left = '';
    dom.vcallWin.style.top = '';
    dom.vcallWin.style.right = '';
    dom.vcallWin.style.bottom = '';
  } catch (_) {}
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
  state.activeCallUID = null;
  if (notify) showToast('📵 Call ended.');
}

/* Insert camera into Events room grid — SOLO quando siamo nella stanza Eventi */
export function insertCameraIntoEventsGrid(uid, stream, name, isOwn) {
  if (!dom.eventsCamGrid) return;
  const roomData = getAvailableRooms().find(r => String(r.id) === String(state.activeRoom));
  const isEventsRoom = roomData?.max_cams && roomData.max_cams >= 1 && roomData.max_cams <= 8;
  if (!isEventsRoom) return; /* Non inserire in grid se siamo in un'altra stanza (es. dopo refresh in General) */

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
  
  /* ── If slot still exists (matches state), reuse it when only stream changes to reduce mobile flicker ── */
  if (targetSlot) {
    const existingVideo = targetSlot.querySelector('video');
    if (existingVideo && stream) {
      const oldStream = existingVideo.srcObject;
      if (oldStream?.id === stream.id) {
        const hasLiveTracks = oldStream.getTracks().some(t => t.readyState === 'live');
        if (hasLiveTracks) {
          if (existingVideo.paused) existingVideo.play().catch(() => {});
          return;
        }
      }
      /* Same slot, new or dead stream: update in place instead of removing slot (reduces flicker on mobile) */
      existingVideo.srcObject = stream;
      existingVideo.play().catch(() => {});
      const labelEl = targetSlot.querySelector('.events-cam-slot-label');
      if (labelEl) labelEl.textContent = name || uid || 'User';
      return;
    } else if (existingVideo && !stream) {
      existingVideo.srcObject = null;
      existingVideo.pause();
      return;
    }
    /* No video element or no stream and no existing video — remove and create fresh slot */
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
     For remote streams we auto-unmute once playing (via Web Audio in initRemoteVolumeControl); own cam stays muted always */
  const video = document.createElement('video');
  video.id = `cam-vid-${safeId(uid)}`; /* necessario per initRemoteVolumeControl (audio remoto in grid) */
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
          console.log('[Events Grid] Playing for', uid, '(via frame event)');
          /* remoto: audio da initRemoteVolumeControl (Web Audio), video resta muted */
        }).catch(console.warn);
      };
      video.addEventListener('canplay',     onFrames, { once: true });
      video.addEventListener('loadeddata',  onFrames, { once: true });
      /* Primo frame spesso dopo "unmute" del track — un solo play, niente loop */
      stream.getVideoTracks().forEach((t) => {
        if (t.kind !== 'video') return;
        t.addEventListener('unmute', () => {
          if (video.parentNode && video.srcObject) video.play().catch(() => {});
        }, { once: true });
      });

      console.log('[Events Grid] Calling play() for', uid, 'video.paused:', video.paused, 'video.srcObject:', !!video.srcObject);
      const playPromise = video.play();
      if (playPromise && typeof playPromise.then === 'function') {
        /* Set a timeout to detect if play() is hanging (common on Edge/Windows when ICE not connected) */
        let playRetryCount = 0;
        const MAX_PLAY_RETRIES = 2;
        const playTimeout = setTimeout(() => {
          /* Check if play() is still pending (video is paused and has srcObject) */
          if (!playStarted && video.parentNode && video.paused && video.srcObject) {
            playRetryCount++;
            console.log('[Events Grid] play() hanging for', uid, `— forcing retry ${playRetryCount}/${MAX_PLAY_RETRIES} after 1s`);
            /* Force retry — play() might be waiting for ICE connection */
            video.play().then(() => {
              if (!playStarted) {
                playStarted = true;
                console.log('[Events Grid] Playing for', uid, `(forced retry ${playRetryCount})`);
              }
            }).catch(err => {
              if (err.name !== 'AbortError') {
                console.warn('[Events Grid] Forced retry play() failed:', err.name);
                /* If retry failed and we haven't reached max, schedule another retry */
                if (playRetryCount < MAX_PLAY_RETRIES && video.parentNode && video.srcObject) {
                  setTimeout(() => {
                    if (!playStarted && video.paused && video.srcObject) video.play().catch(console.warn);
                  }, 1200);
                }
              }
            });
          }
        }, 1000);
        
        playPromise.then(() => {
          clearTimeout(playTimeout);
          if (playStarted) return; /* already handled by frame event */
          playStarted = true;
          console.log('[Events Grid] Playing for', uid, '(playPromise resolved)');
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
            console.log('[Events Grid] Playing for', uid, '(timeout fallback)');
          }).catch(err => {
            if (err.name !== 'AbortError') console.warn('[Events Grid] Timeout fallback play() failed:', err.name);
          });
        }
      }, 3000);
      
      /* Al massimo 2 tentativi play distanziati (no loop stretto = meno sfarfallio) */
      let continuousRetryCount = 0;
      const MAX_CONTINUOUS_RETRIES = 2;
      const continuousRetry = setInterval(() => {
        if (playStarted || continuousRetryCount >= MAX_CONTINUOUS_RETRIES) {
          clearInterval(continuousRetry);
          return;
        }
        if (!video.parentNode || !video.srcObject) {
          clearInterval(continuousRetry);
          return;
        }
        if (video.paused) {
          continuousRetryCount++;
          video.play().then(() => {
            if (!playStarted) {
              playStarted = true;
              clearInterval(continuousRetry);
            }
          }).catch(() => {});
        } else {
          playStarted = true;
          clearInterval(continuousRetry);
        }
      }, 6500);

      setTimeout(() => {
        clearInterval(continuousRetry);
        if (!playStarted) {
          console.warn('[Events Grid] Continuous retry stopped for', uid, '— video still not playing after ~20s');
        }
      }, 20000);
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

  /* CRITICO: per la propria cam in Eventi avvia il mic meter: tiene vivo l'AudioContext (altrimenti si sospende e il mic si stacca dopo ~0.5s) */
  if (isOwn) startMicMeter(stream, uid);
  /* Per cam remota in Eventi: audio via Web Audio + tick che tiene vivo il contesto (altrimenti i viewer sentono 1s e poi si stacca) */
  if (!isOwn && stream?.getAudioTracks?.()?.length) initRemoteVolumeControl(uid);

  /* ── Update grid layout ── */
  import('./rooms.js').then(({ updateEventsCamGrid }) => updateEventsCamGrid());
}

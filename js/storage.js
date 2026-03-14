/* ================================================================
   storage.js  — localStorage helpers (rejected cams, ignored users,
                 pending cam requests, device settings)
================================================================ */
import { state } from './state.js';
import { showToast } from './utils.js';

/* ── Pending cam-request helpers (auto-expire after 60s) ── */
const _pendingTimers = {};

export function setPendingCamRequest(uid, type, name) {
  clearPendingCamRequest(uid);
  state.pendingCamRequests[uid] = type;
  _pendingTimers[uid] = setTimeout(() => {
    if (state.pendingCamRequests[uid]) {
      delete state.pendingCamRequests[uid];
      delete _pendingTimers[uid];
      showToast(`⌛ No reply from ${name} — camera request expired.`);
    }
  }, 60_000);
}

export function clearPendingCamRequest(uid) {
  delete state.pendingCamRequests[uid];
  if (_pendingTimers[uid]) { clearTimeout(_pendingTimers[uid]); delete _pendingTimers[uid]; }
}

/* ── Rejected-cam list ── */
export function loadRejectedCams() {
  try { return JSON.parse(localStorage.getItem('nvc_rejected_cams') || '{}'); } catch { return {}; }
}
export function saveRejectedCams() {
  localStorage.setItem('nvc_rejected_cams', JSON.stringify(state.rejectedCamUsers));
}
export function addRejectedCam(uid, name) {
  state.rejectedCamUsers[String(uid)] = name || 'User';
  saveRejectedCams();
}
export function removeRejectedCam(uid) {
  delete state.rejectedCamUsers[String(uid)];
  saveRejectedCams();
}

/* ── Ignored users list ── */
export function loadIgnoredUsers() {
  try { return JSON.parse(localStorage.getItem('nvc_ignored_users') || '{}'); } catch { return {}; }
}
export function saveIgnoredUsers() {
  localStorage.setItem('nvc_ignored_users', JSON.stringify(state.ignoredUsers));
}
/**
 * Mark a user as ignored (storage only).
 * Side-effects (revoking cam access etc.) are handled by the caller.
 */
export function addIgnoredUser(uid, name) {
  state.ignoredUsers[String(uid)] = name || 'User';
  saveIgnoredUsers();
}
export function removeIgnoredUser(uid) {
  delete state.ignoredUsers[String(uid)];
  saveIgnoredUsers();
}

/* ── Device settings ── */
export function loadDeviceSettings() {
  try { return JSON.parse(localStorage.getItem('nvc_device_settings') || '{}'); } catch { return {}; }
}
export function saveDeviceSettings(settings) {
  localStorage.setItem('nvc_device_settings', JSON.stringify(settings));
}
/** Profilo video ottimizzato per connessioni scadenti: risoluzione e fps contenuti così tutti riescono a vedere. */
const VIDEO_CONSTRAINTS_LOW = {
  width:  { ideal: 640, max: 1280 },
  height: { ideal: 360, max: 720 },
  frameRate: { ideal: 15, max: 24 },
};

export function getMediaConstraints() {
  const s = state.settings || {};
  /* ideal invece di exact: se il dispositivo salvato non c'è più (mic/cam disconnessi) il browser usa un altro e audio/video partono */
  const videoBase = s.cameraId
    ? { deviceId: { ideal: s.cameraId }, ...VIDEO_CONSTRAINTS_LOW }
    : VIDEO_CONSTRAINTS_LOW;
  const audioBase = s.micId ? { deviceId: { ideal: s.micId } } : true;
  return {
    video: videoBase,
    audio: audioBase,
  };
}

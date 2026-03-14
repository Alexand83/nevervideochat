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
export function getMediaConstraints() {
  const s = state.settings || {};
  /* Niente limiti risoluzione/fps: massima compatibilità. ideal per deviceId così se il dispositivo non c'è il browser ne sceglie un altro. */
  return {
    video: s.cameraId ? { deviceId: { ideal: s.cameraId } } : true,
    audio: s.micId ? { deviceId: { ideal: s.micId } } : true,
  };
}

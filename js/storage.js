/* ================================================================
   storage.js  — localStorage helpers (rejected cams, ignored users,
                 pending cam requests, device settings)
================================================================ */
import { state } from './state.js';
import { showToast } from './utils.js';

/* ── Pending cam-request helpers (auto-expire after 60s) ── */
const _pendingTimers = {};

export function setPendingCamRequest(uid, type, name, opts = {}) {
  const ttlMs = Number.isFinite(opts.ttlMs) ? Math.max(1000, opts.ttlMs) : 60_000;
  const showExpiryToast = opts.showExpiryToast !== false;
  clearPendingCamRequest(uid);
  state.pendingCamRequests[uid] = type;
  _pendingTimers[uid] = setTimeout(() => {
    if (state.pendingCamRequests[uid]) {
      delete state.pendingCamRequests[uid];
      delete _pendingTimers[uid];
      if (showExpiryToast) showToast(`⌛ No reply from ${name} — camera request expired.`);
    }
  }, ttlMs);
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
/** Livelli di cattura: partenza minimale per PC vecchi, ramp silenzioso se l'hardware regge.
 *  Tutti in 16:9 per evitare "salto/zoom" quando si passa al livello successivo (object-fit: cover). */
const CAPTURE_LEVELS = ['minimal', 'low', 'medium', 'high'];
const VIDEO_CONSTRAINTS_BY_LEVEL = {
  minimal: { width: { ideal: 320, max: 424 }, height: { ideal: 180, max: 240 }, frameRate: { ideal: 10, max: 15 } },
  low:     { width: { ideal: 640, max: 1280 }, height: { ideal: 360, max: 720 }, frameRate: { ideal: 15, max: 24 } },
  medium:  { width: { ideal: 854, max: 854 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 20, max: 24 } },
  high:    { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 24, max: 30 } },
};

/** Constraint video per livello + deviceId opzionale (stringa vuota = default sistema). */
export function getVideoConstraintsForDevice(deviceId, level) {
  const base = VIDEO_CONSTRAINTS_BY_LEVEL[level] || VIDEO_CONSTRAINTS_BY_LEVEL.minimal;
  if (deviceId) return { deviceId: { exact: deviceId }, ...base };
  return { ...base };
}

/** Restituisce i constraint video per un livello (solo video, per ramp silenzioso). */
export function getVideoConstraintsForLevel(level) {
  const s = state.settings || {};
  return getVideoConstraintsForDevice(s.cameraId || '', level);
}

export function getMediaConstraints() {
  const s = state.settings || {};
  const level = state.videoCaptureLevel || 'minimal';
  const videoBase = getVideoConstraintsForLevel(level);
  const audioBase = s.micId ? { deviceId: { exact: s.micId } } : true;
  return {
    video: videoBase,
    audio: audioBase,
  };
}

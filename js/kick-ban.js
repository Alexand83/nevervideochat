/* ================================================================
   kick-ban.js  — kick/ban overlay and available room finder
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { checkIsKicked, checkIsBanned } from './users.js?v=20260462';
import { joinRoom, getAvailableRooms, loadRoomsFromDB } from './rooms.js';
import { showToast } from './utils.js';

/* ── Find an available room where user is not kicked ──
   excludeRoomId: stanza da escludere sempre (es. quella da cui sei stato kickato) */
export async function findAvailableRoom(excludeRoomId = null) {
  await loadRoomsFromDB();
  const availableRooms = getAvailableRooms();
  const userId = state.currentUser?.id;
  const exclude = excludeRoomId != null ? String(excludeRoomId) : null;

  if (!userId) return null;

  for (const room of availableRooms) {
    const roomId = String(room.id);
    if (exclude && roomId === exclude) continue; /* esclusione esplicita */
    if (!checkIsKicked(userId, roomId)) return roomId;
  }
  return null;
}

/* ── Show kick overlay ── */
export async function showKickOverlay(roomId, expiresAt, isGlobal) {
  const now = new Date();
  const expires = new Date(expiresAt);
  const timeUntilExpiry = expires - now;

  /* Kick already expired: don't show overlay, clear from state, join default room */
  if (timeUntilExpiry <= 0) {
    const uid = state.currentUser?.id;
    if (uid && state.kickedUsers[uid]) {
      if (roomId != null) delete state.kickedUsers[uid][String(roomId)];
      else state.kickedUsers[uid] = {};
      if (Object.keys(state.kickedUsers[uid] || {}).length === 0) delete state.kickedUsers[uid];
    }
    showToast('✅ Your kick has expired. You can rejoin.');
    await loadRoomsFromDB();
    const defaultRoomId = await findAvailableRoom(null); /* nessuna esclusione: kick scaduto */
    if (defaultRoomId) await joinRoom(defaultRoomId);
    return;
  }

  /* Hide main app */
  document.body.classList.add('kick-ban-active');
  dom.kickBanOverlay.hidden = false;

  const minutesRemaining = Math.ceil(timeUntilExpiry / (1000 * 60));
  dom.kickBanIcon.textContent = '👢';
  dom.kickBanTitle.textContent = isGlobal ? 'You have been kicked from all rooms' : 'You have been kicked from this room';
  dom.kickBanMessage.innerHTML = `You cannot rejoin for <span id="kickBanMinutes">${minutesRemaining}</span> minutes.`;
  dom.kickBanExpires.textContent = `Until: ${expires.toLocaleString()}`;

  /* If not global kick, try to find an available room (escludi sempre la stanza da cui sei kickato) */
  const kickedFromRoomId = roomId != null ? String(roomId) : null;
  if (!isGlobal) {
    const availableRoomId = await findAvailableRoom(kickedFromRoomId);
    if (availableRoomId) {
      dom.kickBanActions.hidden = false;
      dom.kickBanEnterBtn.onclick = async () => {
        const rid = await findAvailableRoom(kickedFromRoomId);
        if (rid) await joinRoom(rid);
        hideKickBanOverlay();
      };
    } else {
      dom.kickBanActions.hidden = true;
    }
  } else {
    dom.kickBanActions.hidden = true;
  }

  /* Auto-hide when kick expires and enter default room */
  setTimeout(async () => {
    if (!dom.kickBanOverlay || dom.kickBanOverlay.hidden) return;
    const uid = state.currentUser?.id;
    if (uid && state.kickedUsers[uid]) {
      if (roomId != null) delete state.kickedUsers[uid][String(roomId)];
      else state.kickedUsers[uid] = {};
      if (Object.keys(state.kickedUsers[uid] || {}).length === 0) delete state.kickedUsers[uid];
    }
    hideKickBanOverlay();
    showToast('✅ Your kick has expired. You can now rejoin rooms.');
    await loadRoomsFromDB();
    const defaultRoomId = await findAvailableRoom(null);
    if (defaultRoomId) await joinRoom(defaultRoomId);
  }, timeUntilExpiry);

  const expiredCheck = setInterval(async () => {
    if (!dom.kickBanOverlay || dom.kickBanOverlay.hidden) {
      clearInterval(expiredCheck);
      return;
    }
    if (new Date(expiresAt) <= new Date()) {
      clearInterval(expiredCheck);
      const uid = state.currentUser?.id;
      if (uid && state.kickedUsers[uid]) {
        if (roomId != null) delete state.kickedUsers[uid][String(roomId)];
        else state.kickedUsers[uid] = {};
        if (Object.keys(state.kickedUsers[uid] || {}).length === 0) delete state.kickedUsers[uid];
      }
      hideKickBanOverlay();
      showToast('✅ Your kick has expired. You can rejoin.');
      await loadRoomsFromDB();
      const defaultRoomId = await findAvailableRoom(null);
      if (defaultRoomId) await joinRoom(defaultRoomId);
    }
  }, 10000);
}

/* ── Show ban overlay ── */
export function showBanOverlay(reason, expiresAt) {
  const now = new Date();
  const expires = expiresAt ? (expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt)) : null;
  const timeUntilExpiry = expires && !Number.isNaN(expires.getTime()) ? expires - now : null;

  /* Ban already expired (temporary ban): clear state and reload so user can use app */
  if (expiresAt && timeUntilExpiry !== null && timeUntilExpiry <= 0) {
    const uid = state.currentUser?.id;
    if (uid) delete state.bannedUsers[uid];
    showToast('✅ Your ban has expired. You can rejoin.');
    window.location.reload();
    return;
  }

  /* Hide main app */
  document.body.classList.add('kick-ban-active');
  dom.kickBanOverlay.hidden = false;

  dom.kickBanIcon.textContent = '🚫';
  dom.kickBanTitle.textContent = 'You have been banned';
  dom.kickBanMessage.textContent = reason || 'You have been banned from all rooms.';

  if (expires && !Number.isNaN(expires.getTime()) && timeUntilExpiry !== null) {
    const minutesRemaining = Math.ceil(timeUntilExpiry / (1000 * 60));
    dom.kickBanMinutes.textContent = minutesRemaining;
    dom.kickBanExpires.textContent = `Ban expires: ${expires.toLocaleString()}`;

    /* Auto-clear when ban expires: check every 10s, then reload */
    const expiredCheck = setInterval(() => {
      if (!dom.kickBanOverlay || dom.kickBanOverlay.hidden) {
        clearInterval(expiredCheck);
        return;
      }
      if (expires <= new Date()) {
        clearInterval(expiredCheck);
        const uid = state.currentUser?.id;
        if (uid) delete state.bannedUsers[uid];
        hideKickBanOverlay();
        document.body.classList.remove('kick-ban-active');
        showToast('✅ Your ban has expired. You can rejoin.');
        window.location.reload();
      }
    }, 10000);
  } else {
    dom.kickBanMinutes.textContent = 'permanently';
    dom.kickBanExpires.textContent = 'This ban is permanent.';
  }

  /* Banned users cannot join any room — hide actions (no "Enter available room") */
  dom.kickBanActions.hidden = true;
  if (dom.kickBanEnterBtn) dom.kickBanEnterBtn.onclick = null;
}

/* ── Hide kick/ban overlay ── */
export function hideKickBanOverlay() {
  document.body.classList.remove('kick-ban-active');
  if (dom.kickBanOverlay) {
    dom.kickBanOverlay.hidden = true;
  }
}

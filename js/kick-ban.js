/* ================================================================
   kick-ban.js  — kick/ban overlay and available room finder
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { checkIsKicked, checkIsBanned } from './users.js';
import { joinRoom, getAvailableRooms, loadRoomsFromDB } from './rooms.js';
import { showToast } from './utils.js';

/* ── Find an available room where user is not kicked ── */
export async function findAvailableRoom() {
  await loadRoomsFromDB();
  const availableRooms = getAvailableRooms();
  const userId = state.currentUser?.id;
  
  if (!userId) return null;
  
  /* Find first room where user is not kicked */
  for (const room of availableRooms) {
    const roomId = String(room.id);
    if (!checkIsKicked(userId, roomId)) {
      return roomId;
    }
  }
  
  return null;
}

/* ── Show kick overlay ── */
export async function showKickOverlay(roomId, expiresAt, isGlobal) {
  /* Hide main app */
  document.body.classList.add('kick-ban-active');
  dom.kickBanOverlay.hidden = false;
  
  /* Calculate minutes remaining */
  const now = new Date();
  const expires = new Date(expiresAt);
  const minutesRemaining = Math.ceil((expires - now) / (1000 * 60));
  
  /* Update UI */
  dom.kickBanIcon.textContent = '👢';
  dom.kickBanTitle.textContent = isGlobal ? 'You have been kicked from all rooms' : 'You have been kicked from this room';
  dom.kickBanMessage.innerHTML = `You cannot rejoin for <span id="kickBanMinutes">${minutesRemaining}</span> minutes.`;
  dom.kickBanExpires.textContent = `Until: ${expires.toLocaleString()}`;
  
  /* If not global kick, try to find an available room */
  if (!isGlobal) {
    const availableRoomId = await findAvailableRoom();
    if (availableRoomId) {
      dom.kickBanActions.hidden = false;
      dom.kickBanEnterBtn.onclick = async () => {
        await joinRoom(availableRoomId);
        hideKickBanOverlay();
      };
    } else {
      dom.kickBanActions.hidden = true;
    }
  } else {
    dom.kickBanActions.hidden = true;
  }
  
  /* Auto-hide when kick expires */
  const timeUntilExpiry = expires - now;
  if (timeUntilExpiry > 0) {
    setTimeout(() => {
      if (dom.kickBanOverlay && !dom.kickBanOverlay.hidden) {
        hideKickBanOverlay();
        showToast('✅ Your kick has expired. You can now rejoin rooms.');
      }
    }, timeUntilExpiry);
  }
}

/* ── Show ban overlay ── */
export function showBanOverlay(reason, expiresAt) {
  /* Hide main app */
  document.body.classList.add('kick-ban-active');
  dom.kickBanOverlay.hidden = false;
  
  /* Update UI — ban is always global, no "available room" option */
  dom.kickBanIcon.textContent = '🚫';
  dom.kickBanTitle.textContent = 'You have been banned';
  dom.kickBanMessage.textContent = reason || 'You have been banned from all rooms.';
  
  if (expiresAt) {
    const expires = new Date(expiresAt);
    const now = new Date();
    const minutesRemaining = Math.ceil((expires - now) / (1000 * 60));
    dom.kickBanMinutes.textContent = minutesRemaining;
    dom.kickBanExpires.textContent = `Ban expires: ${expires.toLocaleString()}`;
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

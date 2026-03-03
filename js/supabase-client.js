/* ================================================================
   supabase-client.js  — Supabase init + realtime subscriptions
================================================================ */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { state }           from './state.js';
import { dom }             from './dom.js';
import { showToast, playNotificationSound } from './utils.js';
import { ensureUser, syncPresence, updateOwnPresence, handleTyping, renderUsers } from './users.js';
import { addMessage, extractQuote, renderMessage, handleReactionUpdate } from './chat.js';
import { handleIncomingPM } from './private-chat.js';
import { handleCamRequest, handleCamAccepted, handleWebRTCSignal, handleCamClosed,
         closeCameraWindow, endCall } from './camera.js?v=20260415';
import { clearPendingCamRequest } from './storage.js';

export function initSupabaseClient() {
  if (!SUPABASE_URL.includes('supabase.co') || SUPABASE_ANON_KEY.startsWith('YOUR_')) {
    console.warn('[NVC] Supabase not configured — local-only mode.'); return false;
  }
  state.supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return true;
}

/* ── Load and subscribe to a specific room ── */
export async function connectRoom(roomId) {
  if (!state.supa || !state.rooms[roomId]) return;
  const room = state.rooms[roomId];

  /* ── 1. Clear old messages - new users don't see old messages ── */
  room.messages = [];
  if (roomId === state.activeRoom && dom.msgsContainer) {
    dom.msgsContainer.innerHTML = '';
    /* Show welcome banner if no messages */
    if (dom.welcomeBanner && !dom.welcomeBanner.parentNode) {
      dom.msgsContainer.appendChild(dom.welcomeBanner);
    }
  }

  /* ── 2. Don't load old messages - only show new ones from now on ── */

  /* ── 2. Subscribe to new messages (Postgres Changes filtered by room_id) ── */
  const dbSub = state.supa.channel(`db-messages-${roomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, ({ new: m }) => {
      if (m.user_id === state.currentUser.id) {
        /* This is our own message - update the temp ID with the DB UUID */
        const room = state.rooms[roomId];
        if (room) {
          /* Find the most recent message from us without a DB ID */
          const tempMsg = room.messages
            .filter(msg => msg.userId === 'me' || msg.userId === state.currentUser.id)
            .find(msg => msg.id.startsWith('m') && msg.id.length < 20);
          if (tempMsg) {
            const oldId = tempMsg.id;
            tempMsg.id = m.id;
            tempMsg.reactions = m.reactions || {};
            /* Update DOM - search with old ID before updating */
            const group = dom.msgsContainer.querySelector(`[data-msg-id="${oldId}"]`);
            if (group) {
              group.dataset.msgId = m.id;
              /* Re-render to show reactions if any */
              if (m.reactions && Object.keys(m.reactions).length > 0) {
                group.remove();
                renderMessage(tempMsg);
              }
            }
          }
        }
        return; /* already rendered optimistically */
      }
      if (state.ignoredUsers[String(m.user_id)]) return;
      ensureUser(m.user_id, m.username);
      const { html, quoteHtml, quoteName } = extractQuote(m.content);
      addMessage({ userId: m.user_id, username: m.username, html, quoteHtml, quoteName, ts: new Date(m.created_at).getTime(), reactions: m.reactions || {}, msgId: m.id }, roomId);
      if (roomId === state.activeRoom) playNotificationSound();
    })
    .subscribe();

  room.dbSub = dbSub;
}

/* ── Connect global signal channel + all rooms ── */
export async function connectSupabase() {
  if (!state.supa) {
    showToast('⚠️ Supabase not configured — local mode.'); return;
  }
  try {
    /* ── Global signal channel (WebRTC, PM, cam requests — user-to-user) ── */
    state.signalCh = state.supa.channel('broadcast:signals-main');
    state.signalCh
      .on('broadcast', { event: 'typing'       }, ({ payload }) => handleTyping(payload))
      .on('broadcast', { event: 'pm'           }, ({ payload }) => handleIncomingPM(payload))
      .on('broadcast', { event: 'webrtc'       }, ({ payload }) => handleWebRTCSignal(payload))
      .on('broadcast', { event: 'cam-req'      }, ({ payload }) => handleCamRequest(payload))
      .on('broadcast', { event: 'cam-accepted' }, ({ payload }) => handleCamAccepted(payload))
      .on('broadcast', { event: 'cam-rejected' }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        clearPendingCamRequest(String(payload.from));
        if (payload.reason === 'wrong-room') {
          showToast(`📵 ${payload.fromName || 'User'} is in a different room — camera not available.`);
        } else {
          showToast(`❌ ${payload.fromName || 'User'} declined your camera request.`);
        }
      })
      .on('broadcast', { event: 'cam-revoked'  }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        const fromId = String(payload.from);
        if (state.cameraWindows[fromId]) closeCameraWindow(fromId);
        showToast('📵 Camera access revoked.');
      })
      .on('broadcast', { event: 'cam-opened'   }, async ({ payload }) => {
        if (String(payload.from) === String(state.currentUser?.id)) return;
        const fromId   = String(payload.from);
        const camRoom  = payload.room_id || null;   /* room where cam was activated */

        /* Update room.users for EVERY joined room — icon true only in camRoom */
        for (const [rId, room] of Object.entries(state.rooms)) {
          if (room.users[fromId]) room.users[fromId].hasCamera = (rId === camRoom);
        }
        /* Keep global state.users in sync (used as fallback) */
        const inMyRoom = !camRoom || camRoom === state.activeRoom;
        const u = state.users.find(u => String(u.id) === fromId);
        if (u) u.hasCamera = inMyRoom;
        else if (inMyRoom) ensureUser(fromId, payload.fromName, { hasCamera: true, online: true });
        renderUsers();
        
        /* Events room: update grid when cam-opened received */
        /* NOTE: We do NOT call requestPublicCamera here because the camera owner
           already auto-shares with everyone in startOwnCamera (push model).
           Requesting here would create DUPLICATE WebRTC connections. */
        if (camRoom === state.activeRoom && inMyRoom) {
          const { updateEventsCamGrid } = await import('./rooms.js');
          updateEventsCamGrid();
        }
      })
      .on('broadcast', { event: 'cam-closed'   }, ({ payload }) => handleCamClosed(payload))
      .on('broadcast', { event: 'call-ended'   }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (!dom.vcallWin.hidden) { endCall(false); showToast(`📵 ${payload.fromName} ended the call.`); }
      })
      .on('broadcast', { event: 'reaction-update' }, ({ payload }) => handleReactionUpdate(payload))
      .on('broadcast', { event: 'user-kicked' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        
        /* Close all cameras for the kicked user */
        const { closeAllCamerasForUser } = await import('./camera.js?v=20260415');
        if (isCurrentUser || state.cameraWindows[targetId]) {
          await closeAllCamerasForUser(targetId);
        }
        
        if (isCurrentUser) {
          const roomId = payload.room_id;
          /* Add to kicked cache */
          if (!state.kickedUsers[targetId]) state.kickedUsers[targetId] = {};
          if (payload.is_global) {
            /* Global kick: add to all rooms */
            for (const roomId of Object.keys(state.rooms)) {
              state.kickedUsers[targetId][roomId] = payload.expires_at;
            }
            /* Leave all rooms and show kick overlay */
            const { leaveRoom } = await import('./rooms.js');
            const { renderRoomTabs } = await import('./rooms.js');
            for (const rId of Object.keys(state.rooms)) {
              await leaveRoom(rId);
            }
            renderRoomTabs();
            const { showKickOverlay } = await import('./kick-ban.js');
            await showKickOverlay(null, payload.expires_at, true);
          } else {
            state.kickedUsers[targetId][roomId] = payload.expires_at;
            /* If in that room, leave it and show kick overlay */
            if (state.activeRoom === roomId) {
              const { leaveRoom } = await import('./rooms.js');
              const { renderRoomTabs } = await import('./rooms.js');
              await leaveRoom(roomId);
              renderRoomTabs();
              const { showKickOverlay } = await import('./kick-ban.js');
              await showKickOverlay(roomId, payload.expires_at, false);
            }
          }
        }
      })
      .on('broadcast', { event: 'user-banned' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        
        /* Close all cameras for the banned user */
        const { closeAllCamerasForUser } = await import('./camera.js?v=20260415');
        if (isCurrentUser || state.cameraWindows[targetId]) {
          await closeAllCamerasForUser(targetId);
        }
        
        if (isCurrentUser) {
          /* Add to banned cache with reason */
          state.bannedUsers[targetId] = { 
            expires_at: payload.expires_at,
            reason: payload.reason 
          };
          /* Leave all rooms and show ban overlay */
          const { leaveRoom } = await import('./rooms.js');
          const { renderRoomTabs } = await import('./rooms.js');
          for (const rId of Object.keys(state.rooms)) {
            await leaveRoom(rId);
          }
          renderRoomTabs();
          const { showBanOverlay } = await import('./kick-ban.js');
          showBanOverlay(payload.reason || 'No reason provided', payload.expires_at);
        }
      })
      .on('broadcast', { event: 'user-muted' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const isCurrentUser = String(targetId) === String(state.currentUser?.id);
        
        /* Close all cameras for the muted user - always close if we're viewing their cam */
        const { closeAllCamerasForUser, closeCameraWindow } = await import('./camera.js?v=20260415');
        if (isCurrentUser) {
          await closeAllCamerasForUser(targetId);
        } else if (state.cameraWindows[targetId]) {
          /* Close their camera window (works for both floating and Events grid) */
          await closeCameraWindow(targetId);
        }
        
        const roomId = payload.room_id || null;
        /* Add to muted cache */
        state.mutedUsers[targetId] = { room_id: roomId, expires_at: payload.expires_at };
        
        /* Re-render users to show muted indicator */
        const { renderUsers } = await import('./users.js');
        renderUsers();
        
        if (isCurrentUser) {
          const scope = roomId ? 'in this room' : 'globally';
          const duration = payload.duration > 0 ? ` for ${payload.duration} minutes` : ' permanently';
          showToast(`🔇 You have been muted ${scope}${duration}.`);
        }
      })
      .on('broadcast', { event: 'user-unmuted' }, async ({ payload }) => {
        const targetId = payload.to || payload.user_id;
        const roomId = payload.room_id || null;
        
        /* Remove from muted cache */
        if (roomId === null) {
          /* Global unmute - remove all mutes for this user */
          delete state.mutedUsers[targetId];
        } else {
          /* Room-specific unmute */
          const mute = state.mutedUsers[targetId];
          if (mute && mute.room_id === roomId) {
            delete state.mutedUsers[targetId];
          }
        }
        
        /* Re-render users to remove muted indicator */
        const { renderUsers } = await import('./users.js');
        renderUsers();
      })
      .subscribe();

    showToast('🟢 Connected to NeverVideoChat');
    console.log('[NVC] Supabase connected.');
  } catch (err) {
    console.error('[NVC] Connection error:', err);
    showToast('⚠️ Could not connect — check your credentials.');
  }
}

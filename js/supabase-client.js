/* ================================================================
   supabase-client.js  — Supabase init + realtime subscriptions
================================================================ */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { state }           from './state.js';
import { dom }             from './dom.js';
import { showToast, playNotificationSound } from './utils.js';
import { ensureUser, syncPresence, updateOwnPresence, handleTyping, renderUsers } from './users.js';
import { addMessage, extractQuote, renderMessage } from './chat.js';
import { handleIncomingPM } from './private-chat.js';
import { handleCamRequest, handleCamAccepted, handleWebRTCSignal, handleCamClosed,
         closeCameraWindow, endCall } from './camera.js';
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

  /* ── 1. Load last 60 messages for this room ── */
  const { data: msgs, error: msgErr } = await state.supa
    .from('messages').select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true }).limit(60);

  if (!msgErr && msgs?.length) {
    if (dom.welcomeBanner?.parentNode && roomId === state.activeRoom) dom.welcomeBanner.remove();
    msgs.forEach(m => {
      const isMine = m.user_id === state.currentUser.id;
      if (!isMine && state.ignoredUsers[String(m.user_id)]) return;
      if (!isMine) ensureUser(m.user_id, m.username);
      const { html, quoteHtml, quoteName } = extractQuote(m.content);
      addMessage(
        { userId: isMine ? 'me' : m.user_id, username: m.username, html, quoteHtml, quoteName, ts: new Date(m.created_at).getTime() },
        roomId
      );
    });
    /* Re-render if this is the active room */
    if (roomId === state.activeRoom && dom.msgsContainer) {
      dom.msgsContainer.innerHTML = '';
      room.messages.forEach(msg => renderMessage(msg));
      dom.msgsContainer.scrollTop = dom.msgsContainer.scrollHeight;
    }
  }

  /* ── 2. Subscribe to new messages (Postgres Changes filtered by room_id) ── */
  const dbSub = state.supa.channel(`db-messages-${roomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, ({ new: m }) => {
      if (m.user_id === state.currentUser.id) return; /* already rendered optimistically */
      if (state.ignoredUsers[String(m.user_id)]) return;
      ensureUser(m.user_id, m.username);
      const { html, quoteHtml, quoteName } = extractQuote(m.content);
      addMessage({ userId: m.user_id, username: m.username, html, quoteHtml, quoteName, ts: new Date(m.created_at).getTime() }, roomId);
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
        showToast(`❌ ${payload.fromName || 'User'} declined your camera request.`);
      })
      .on('broadcast', { event: 'cam-revoked'  }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        const fromId = String(payload.from);
        if (state.cameraWindows[fromId]) closeCameraWindow(fromId);
        showToast('📵 Camera access revoked.');
      })
      .on('broadcast', { event: 'cam-opened'   }, ({ payload }) => {
        if (String(payload.from) === String(state.currentUser?.id)) return;
        const u = state.users.find(u => String(u.id) === String(payload.from));
        if (u) { u.hasCamera = true; renderUsers(); }
        else  { ensureUser(String(payload.from), payload.fromName, { hasCamera: true, online: true }); renderUsers(); }
      })
      .on('broadcast', { event: 'cam-closed'   }, ({ payload }) => handleCamClosed(payload))
      .on('broadcast', { event: 'call-ended'   }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (!dom.vcallWin.hidden) { endCall(false); showToast(`📵 ${payload.fromName} ended the call.`); }
      })
      .subscribe();

    showToast('🟢 Connected to NeverVideoChat');
    console.log('[NVC] Supabase connected.');
  } catch (err) {
    console.error('[NVC] Connection error:', err);
    showToast('⚠️ Could not connect — check your credentials.');
  }
}

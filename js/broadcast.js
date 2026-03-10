/* ================================================================
   broadcast.js  — Broadcast helpers (Firebase Realtime DB)
================================================================ */
import { state } from './state.js';

export function supabaseReady() { return !!state.fb; }

/** Send a broadcast to a specific user via the global signal channel */
export function broadcast(event, toUid, extra = {}) {
  if (!state.signalCh) return;
  state.signalCh.send({
    type:    'broadcast',
    event,
    payload: { to: String(toUid), from: state.currentUser?.id, fromName: state.currentUser?.name, ts: Date.now(), ...extra },
  });
}

/** Send a broadcast to ALL users via the global signal channel */
export function broadcastAll(event, extra = {}) {
  if (!state.signalCh) return;
  state.signalCh.send({
    type:    'broadcast',
    event,
    payload: { from: state.currentUser?.id, fromName: state.currentUser?.name, ts: Date.now(), ...extra },
  });
}

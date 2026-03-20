/* ================================================================
   chat-antispam.js — limiti client-side; valori da Firestore
   config/chat_antispam (Admin → General), con default se assente.
================================================================ */

const DOC_ID = 'chat_antispam';

/** Default se il documento non esiste o i campi sono invalidi */
export const DEFAULT_CHAT_ANTISPAM = {
  publicMinMs: 1100,
  publicMaxPerMinute: 42,
  publicDuplicateWindowMs: 3500,
  pmMinMs: 900,
  pmMaxPerMinute: 36,
  pmDuplicateWindowMs: 3000,
};

function _clamp(n, lo, hi, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
}

/** Stato effettivo usato dai check (sincrono) */
let _cfg = { ...DEFAULT_CHAT_ANTISPAM };

function _applyPayload(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  _cfg = {
    publicMinMs: _clamp(d.publicMinMs, 300, 30_000, DEFAULT_CHAT_ANTISPAM.publicMinMs),
    publicMaxPerMinute: _clamp(d.publicMaxPerMinute, 5, 120, DEFAULT_CHAT_ANTISPAM.publicMaxPerMinute),
    publicDuplicateWindowMs: _clamp(
      d.publicDuplicateWindowMs,
      1000,
      60_000,
      DEFAULT_CHAT_ANTISPAM.publicDuplicateWindowMs
    ),
    pmMinMs: _clamp(d.pmMinMs, 300, 30_000, DEFAULT_CHAT_ANTISPAM.pmMinMs),
    pmMaxPerMinute: _clamp(d.pmMaxPerMinute, 5, 120, DEFAULT_CHAT_ANTISPAM.pmMaxPerMinute),
    pmDuplicateWindowMs: _clamp(
      d.pmDuplicateWindowMs,
      1000,
      60_000,
      DEFAULT_CHAT_ANTISPAM.pmDuplicateWindowMs
    ),
  };
}

let _unsubAntispam = null;

/**
 * Ascolta config/chat_antispam (utenti autenticati).
 * Chiamare da finishInit quando Firestore è disponibile.
 */
export function initChatAntispamListener(firestore) {
  if (!firestore) return;
  try {
    _unsubAntispam?.();
  } catch (_) {}
  _unsubAntispam = null;
  const ref = firestore.collection('config').doc(DOC_ID);
  _unsubAntispam = ref.onSnapshot(
    (snap) => {
      _applyPayload(snap.exists ? snap.data() : null);
    },
    (err) => {
      console.warn('[Antispam] Firestore listener:', err);
      _applyPayload(null);
    }
  );
}

/** Per Admin: applica i valori letti una tantum (es. prima del listener) */
export function applyChatAntispamFromDoc(data) {
  _applyPayload(data);
}

export function getChatAntispamSnapshot() {
  return { ..._cfg };
}

const WINDOW_MS = 60_000;

function _pruneTimestamps(arr, now) {
  while (arr.length && now - arr[0] > WINDOW_MS) arr.shift();
}

/* ── Chat pubblica ── */
let _pubLast = 0;
const _pubWindow = [];
let _pubDupSig = '';
let _pubDupAt = 0;

export function checkPublicChatSpam(contentFull) {
  const now = Date.now();
  const { publicMinMs, publicMaxPerMinute, publicDuplicateWindowMs } = _cfg;
  if (now - _pubLast < publicMinMs) {
    const s = Math.ceil((publicMinMs - (now - _pubLast)) / 1000);
    return { ok: false, toast: `⏳ Vai più piano: attendi ${s}s prima del prossimo messaggio.` };
  }
  _pruneTimestamps(_pubWindow, now);
  if (_pubWindow.length >= publicMaxPerMinute) {
    return { ok: false, toast: '🚫 Troppi messaggi in poco tempo. Riprova tra circa un minuto.' };
  }
  const sig = String(contentFull || '').slice(0, 500);
  if (sig.length > 0 && sig === _pubDupSig && now - _pubDupAt < publicDuplicateWindowMs) {
    return { ok: false, toast: '⏸️ Hai già inviato lo stesso messaggio poco fa.' };
  }
  return { ok: true };
}

export function registerPublicChatSent(contentFull) {
  const now = Date.now();
  _pubLast = now;
  _pruneTimestamps(_pubWindow, now);
  _pubWindow.push(now);
  _pubDupSig = String(contentFull || '').slice(0, 500);
  _pubDupAt = now;
}

/* ── PM ── */
/** @type {Map<string, { last: number, window: number[], dupText: string, dupAt: number }>} */
const _pmByPeer = new Map();

function _getPm(peerUid) {
  const id = String(peerUid);
  if (!_pmByPeer.has(id)) {
    _pmByPeer.set(id, { last: 0, window: [], dupText: '', dupAt: 0 });
  }
  return _pmByPeer.get(id);
}

export function checkPrivateChatSpam(peerUid, text) {
  const now = Date.now();
  const { pmMinMs, pmMaxPerMinute, pmDuplicateWindowMs } = _cfg;
  const st = _getPm(peerUid);
  if (now - st.last < pmMinMs) {
    const s = Math.ceil((pmMinMs - (now - st.last)) / 1000);
    return { ok: false, toast: `⏳ Attendi ${s}s prima di inviare un altro messaggio privato.` };
  }
  _pruneTimestamps(st.window, now);
  if (st.window.length >= pmMaxPerMinute) {
    return { ok: false, toast: '🚫 Troppi messaggi privati verso questa persona. Pausa un minuto.' };
  }
  const t = String(text || '').trim().slice(0, 500);
  if (t.length > 0 && t === st.dupText && now - st.dupAt < pmDuplicateWindowMs) {
    return { ok: false, toast: '⏸️ Stesso messaggio privato inviato poco fa.' };
  }
  return { ok: true };
}

export function registerPrivateChatSent(peerUid, text) {
  const now = Date.now();
  const st = _getPm(peerUid);
  st.last = now;
  _pruneTimestamps(st.window, now);
  st.window.push(now);
  st.dupText = String(text || '').trim().slice(0, 500);
  st.dupAt = now;
}

/** Payload da salvare su Firestore (solo owner) */
export function buildChatAntispamPayloadFromForm(fields) {
  return {
    publicMinMs: _clamp(fields.publicMinMs, 300, 30_000, DEFAULT_CHAT_ANTISPAM.publicMinMs),
    publicMaxPerMinute: _clamp(fields.publicMaxPerMinute, 5, 120, DEFAULT_CHAT_ANTISPAM.publicMaxPerMinute),
    publicDuplicateWindowMs: _clamp(
      fields.publicDuplicateWindowMs,
      1000,
      60_000,
      DEFAULT_CHAT_ANTISPAM.publicDuplicateWindowMs
    ),
    pmMinMs: _clamp(fields.pmMinMs, 300, 30_000, DEFAULT_CHAT_ANTISPAM.pmMinMs),
    pmMaxPerMinute: _clamp(fields.pmMaxPerMinute, 5, 120, DEFAULT_CHAT_ANTISPAM.pmMaxPerMinute),
    pmDuplicateWindowMs: _clamp(
      fields.pmDuplicateWindowMs,
      1000,
      60_000,
      DEFAULT_CHAT_ANTISPAM.pmDuplicateWindowMs
    ),
    updated_at: new Date(),
  };
}

/* ================================================================
   utils.js  — pure utility helpers + toast + notifications
================================================================ */
import { AVATAR_COLORS } from './config.js';
import { state } from './state.js';

/* ── DOM shorthand ── */
export const $ = id => document.getElementById(id);

/* ── Text helpers ── */
export function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
export function sanitiseHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  
  /* Remove dangerous tags */
  d.querySelectorAll('script,style,object,embed,iframe,frame,frameset,meta,link,base,form,input,button,textarea,select,option').forEach(e => e.remove());
  
  /* Remove dangerous attributes (event handlers, javascript:, data:, etc.) */
  d.querySelectorAll('*').forEach(e => {
    [...e.attributes].forEach(a => {
      const attrName = a.name.toLowerCase();
      const attrValue = a.value.toLowerCase();
      
      /* Remove event handlers */
      if (attrName.startsWith('on')) {
        e.removeAttribute(a.name);
        return;
      }
      
      /* Remove javascript: and data: URLs */
      if (attrValue.startsWith('javascript:') || attrValue.startsWith('data:text/html') || attrValue.startsWith('vbscript:')) {
        e.removeAttribute(a.name);
        return;
      }
      
      /* Remove dangerous attributes */
      if (['href', 'src', 'action', 'formaction'].includes(attrName)) {
        if (attrValue.startsWith('javascript:') || attrValue.startsWith('data:text/html')) {
          e.removeAttribute(a.name);
        }
      }
    });
  });
  
  return d.innerHTML;
}
export function processHtml(html) {
  let safe = sanitiseHtml(html);
  safe = safe.replace(
    /(?<!['"=])(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[^\s<"']+)/g,
    (url) => {
      const vid = ytVideoId(url);
      if (!vid) return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
              <div class="yt-embed-wrap">
                <iframe src="https://www.youtube.com/embed/${vid}" allowfullscreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
                </iframe>
              </div>`;
    }
  );
  return safe;
}
export function ytVideoId(url) {
  const m = url.match(/(?:youtube\.com\/(?:[^/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* ── Avatar ── */
export function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (name.charCodeAt(i) + ((h << 5) - h)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
export function initials(name) {
  if (name == null || typeof name !== 'string') return '?';
  const s = name.trim();
  if (!s) return '?';
  return s.split(/\s+/).map(n => n[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '?';
}
/** Restituisce url solo se sicuro (http/https o data:image), altrimenti null per evitare XSS */
export function safeAvatarUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim().toLowerCase();
  if (u.startsWith('https://') || u.startsWith('http://')) return url;
  if (u.startsWith('data:image/')) return url;
  return null;
}
export function setAvatarDisplay(el, name, avatarUrl) {
  if (!el) return;
  const safeUrl = safeAvatarUrl(avatarUrl);
  if (safeUrl) {
    el.style.backgroundImage    = `url(${safeUrl})`;
    el.style.backgroundSize     = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.style.background = avatarColor(name || '?');
    el.textContent = initials(name || '?');
  }
}

/* ── Time ── */
export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ── Math ── */
export function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }

/* ── Toast notifications ── */
export function showToast(msg, duration = 3500) {
  const cont = document.getElementById('toastCont');
  if (!cont) return;
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  cont.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, duration);
}

/* ── Audio notification (Impostazioni → Notifiche: suoni chat / PM) ── */

/** Preferenze salvate come bool / stringa / numero da Firestore o localStorage */
function notificationSoundEnabled(val, defaultOn = true) {
  if (val === undefined || val === null) return defaultOn;
  if (val === false || val === 0 || val === '0') return false;
  if (typeof val === 'string' && /^false$/i.test(val.trim())) return false;
  return true;
}

/** true se l'utente ha lasciato attivo il suono per la chat pubblica (default: on) */
export function shouldPlayChatNotificationSound() {
  return notificationSoundEnabled(state.settings?.soundChat, true);
}

/** true se l'utente ha lasciato attivo il suono per i messaggi privati (default: on) */
export function shouldPlayPMNotificationSound() {
  return notificationSoundEnabled(state.settings?.soundPM, true);
}

/** Suono nuovo messaggio in stanza (solo se abilitato in impostazioni) */
export function playChatNotificationSoundIfEnabled() {
  if (!shouldPlayChatNotificationSound()) return;
  void playNotificationSound();
}

/** Suono messaggio privato in arrivo (solo se abilitato in impostazioni) */
export function playPMNotificationSoundIfEnabled() {
  if (!shouldPlayPMNotificationSound()) return;
  void playNotificationSound();
}

let _audioUnlockListenersAttached = false;

/**
 * Dopo il login, sblocca l'AudioContext al primo click/tasto (policy browser).
 * Senza questo, il primo suono in arrivo spesso non si sente finché non c'è un gesto utente.
 */
export function attachNotificationAudioUnlockOnGesture() {
  if (_audioUnlockListenersAttached) return;
  _audioUnlockListenersAttached = true;
  const unlock = () => {
    try {
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      state.audioCtx.resume?.().catch(() => {});
    } catch (_) {}
  };
  document.addEventListener('click', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
}

export async function playNotificationSound() {
  try {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = state.audioCtx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
  } catch (_) {}
}

/* ── Auto-scroll ── */
export function scrollToBottom() {
  const c = document.getElementById('msgsContainer');
  if (c) c.scrollTop = c.scrollHeight;
}

/* ── Drag + Resize (mouse + touch) ── */

/** Extract {x,y} from mouse or touch event */
function _evXY(e) {
  const src = e.touches ? e.touches[0] : e;
  return { x: src.clientX, y: src.clientY };
}

/** Ensure element is position:fixed and pinned to left/top viewport coords.
 *  Works for both fixed (cam windows) and relative/static (pchat popups). */
function _pinToLeftTop(el) {
  const already = el.style.left && el.style.left !== 'auto' && el.style.left !== '';
  if (already && getComputedStyle(el).position === 'fixed') return;   /* nothing to do */
  const r = el.getBoundingClientRect();
  el.style.position = 'fixed';
  el.style.left   = r.left + 'px';
  el.style.top    = r.top  + 'px';
  el.style.right  = 'auto';
  el.style.bottom = 'auto';
  el.style.margin = '0';
}

export function makeDraggable(el, handle) {
  if (!handle) return;
  let ox = 0, oy = 0, mx = 0, my = 0;

  function onMove(e) {
    e.preventDefault();
    const { x, y } = _evXY(e);
    el.style.left = clamp(ox + x - mx, 0, window.innerWidth  - el.offsetWidth)  + 'px';
    el.style.top  = clamp(oy + y - my, 0, window.innerHeight - el.offsetHeight) + 'px';
  }
  function onEnd() {
    document.removeEventListener('mousemove',   onMove);
    document.removeEventListener('touchmove',   onMove);
    document.removeEventListener('mouseup',     onEnd);
    document.removeEventListener('touchend',    onEnd);
    document.removeEventListener('touchcancel', onEnd);
  }
  function onStart(e) {
    /* Never block interactive elements inside the handle (close btn, etc.) */
    if (e.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    if (e.touches && e.touches.length > 1) return;   /* ignore pinch-to-zoom */
    e.preventDefault();
    _pinToLeftTop(el);
    ox = el.offsetLeft; oy = el.offsetTop;
    const { x, y } = _evXY(e);
    mx = x; my = y;
    document.addEventListener('mousemove',   onMove);
    document.addEventListener('touchmove',   onMove,  { passive: false });
    document.addEventListener('mouseup',     onEnd);
    document.addEventListener('touchend',    onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  handle.addEventListener('mousedown',  onStart);
  handle.addEventListener('touchstart', onStart, { passive: false });
}

/**
 * @param {HTMLElement} el
 * @param {HTMLElement} handle
 * @param {object} [opts]
 * @param {number} [opts.minWidth=200]
 * @param {number} [opts.minHeight=150]
 * @param {number|(() => number)} [opts.maxWidth] default window-8
 * @param {number|(() => number)} [opts.maxHeight] default window-8
 * @param {boolean} [opts.pinFirst=true] convert right/bottom fixed layout to left+top before resize
 */
export function makeResizable(el, handle, opts = {}) {
  if (!handle) return;
  const minW = opts.minWidth ?? 200;
  const minH = opts.minHeight ?? 150;
  let sw = 0, sh = 0, mx = 0, my = 0;

  function onMove(e) {
    e.preventDefault();
    const { x, y } = _evXY(e);
    const maxW = typeof opts.maxWidth === 'function' ? opts.maxWidth() : (opts.maxWidth ?? window.innerWidth - 8);
    const maxH = typeof opts.maxHeight === 'function' ? opts.maxHeight() : (opts.maxHeight ?? window.innerHeight - 8);
    el.style.width = clamp(sw + x - mx, minW, maxW) + 'px';
    el.style.height = clamp(sh + y - my, minH, maxH) + 'px';
  }
  function onEnd() {
    document.removeEventListener('mousemove',   onMove);
    document.removeEventListener('touchmove',   onMove);
    document.removeEventListener('mouseup',     onEnd);
    document.removeEventListener('touchend',    onEnd);
    document.removeEventListener('touchcancel', onEnd);
  }
  function onStart(e) {
    if (e.touches && e.touches.length > 1) return;
    e.preventDefault(); e.stopPropagation();
    if (opts.pinFirst !== false) _pinToLeftTop(el);
    sw = el.offsetWidth; sh = el.offsetHeight;
    const { x, y } = _evXY(e);
    mx = x; my = y;
    document.addEventListener('mousemove',   onMove);
    document.addEventListener('touchmove',   onMove,  { passive: false });
    document.addEventListener('mouseup',     onEnd);
    document.addEventListener('touchend',    onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  handle.addEventListener('mousedown',  onStart);
  handle.addEventListener('touchstart', onStart, { passive: false });
}

/* ── Toolbar chat (colore / grandezza) — normalizzazione per Firestore e <input type="color"> ── */
export const DEFAULT_CHAT_RICH_COLOR = '#e6edf3';

/** Valore sicuro per `input[type=color]` (#rrggbb). Accetta hex corto, 8 cifre, rgb(). */
export function normalizeHexColorForInput(color) {
  if (color == null || color === '') return DEFAULT_CHAT_RICH_COLOR;
  const s = String(color).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]; const g = s[2]; const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7).toLowerCase();
  const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const h = (n) => Math.min(255, Math.max(0, parseInt(n, 10))).toString(16).padStart(2, '0');
    return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`;
  }
  return DEFAULT_CHAT_RICH_COLOR;
}

/** Mappa sempre a '1'…'5' come nel <select> (Firestore può restituire numeri). */
export function normalizeFontSizeKey(v) {
  if (v === '' || v == null) return '3';
  const n = String(v).trim();
  if (/^[1-5]$/.test(n)) return n;
  const num = Number(n);
  if (Number.isFinite(num) && num >= 1 && num <= 5) return String(Math.round(num));
  return '3';
}

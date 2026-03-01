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
  const d = document.createElement('div'); d.innerHTML = html;
  d.querySelectorAll('script,style,object,embed').forEach(e => e.remove());
  d.querySelectorAll('*').forEach(e =>
    [...e.attributes].forEach(a => { if (a.name.startsWith('on')) e.removeAttribute(a.name); })
  );
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
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}
export function setAvatarDisplay(el, name, avatarUrl) {
  if (!el) return;
  if (avatarUrl) {
    el.style.backgroundImage    = `url(${avatarUrl})`;
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

/* ── Audio notification ── */
export function playNotificationSound() {
  try {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
  } catch {}
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

/** Convert right/bottom positioning to left/top so dragging works correctly */
function _pinToLeftTop(el) {
  if (el.style.left && el.style.left !== 'auto') return;   /* already pinned */
  const r = el.getBoundingClientRect();
  el.style.left   = r.left + 'px';
  el.style.top    = r.top  + 'px';
  el.style.right  = 'auto';
  el.style.bottom = 'auto';
}

export function makeDraggable(el, handle) {
  if (!handle) return;
  let ox = 0, oy = 0, mx = 0, my = 0, active = false;

  function onStart(e) {
    if (e.touches && e.touches.length > 1) return;   /* ignore pinch */
    e.preventDefault();
    _pinToLeftTop(el);
    active = true;
    ox = el.offsetLeft; oy = el.offsetTop;
    const { x, y } = _evXY(e);
    mx = x; my = y;
  }
  function onMove(e) {
    if (!active) return;
    e.preventDefault();
    const { x, y } = _evXY(e);
    el.style.left = clamp(ox + x - mx, 0, window.innerWidth  - el.offsetWidth)  + 'px';
    el.style.top  = clamp(oy + y - my, 0, window.innerHeight - el.offsetHeight) + 'px';
  }
  function onEnd() { active = false; }

  handle.addEventListener('mousedown',   onStart);
  handle.addEventListener('touchstart',  onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove,  { passive: false });
  document.addEventListener('mouseup',   onEnd);
  document.addEventListener('touchend',  onEnd);
  document.addEventListener('touchcancel', onEnd);
}

export function makeResizable(el, handle) {
  if (!handle) return;
  let sw = 0, sh = 0, mx = 0, my = 0, active = false;

  function onStart(e) {
    if (e.touches && e.touches.length > 1) return;
    e.preventDefault(); e.stopPropagation();
    active = true;
    sw = el.offsetWidth; sh = el.offsetHeight;
    const { x, y } = _evXY(e);
    mx = x; my = y;
  }
  function onMove(e) {
    if (!active) return;
    e.preventDefault();
    const { x, y } = _evXY(e);
    el.style.width  = Math.max(200, sw + x - mx) + 'px';
    el.style.height = Math.max(150, sh + y - my) + 'px';
  }
  function onEnd() { active = false; }

  handle.addEventListener('mousedown',   onStart);
  handle.addEventListener('touchstart',  onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove,  { passive: false });
  document.addEventListener('mouseup',   onEnd);
  document.addEventListener('touchend',  onEnd);
  document.addEventListener('touchcancel', onEnd);
}

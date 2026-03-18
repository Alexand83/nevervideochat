/* ================================================================
   debug-overlay.js — on-device log overlay (iOS friendly)
   Enable with ?debug=1 (persists via localStorage).
================================================================ */

import { showToast } from './utils.js';

const LS_KEY = 'nvc_debug_overlay';

function isEnabledByUrlOrStorage() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('debug') === '1') {
      localStorage.setItem(LS_KEY, '1');
      return true;
    }
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

function fmtTs(ms) {
  try {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch { return ''; }
}

function safeStr(x) {
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

export function initDebugOverlay() {
  if (!isEnabledByUrlOrStorage()) return;

  const MAX_LINES = 400;
  const lines = [];

  const addLine = (level, args) => {
    const msg = args.map(safeStr).join(' ');
    lines.push(`[${fmtTs(Date.now())}] ${level} ${msg}`);
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    if (ta && !overlay.hidden) ta.value = lines.join('\n');
  };

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args) => { addLine('LOG ', args); original.log(...args); };
  console.warn = (...args) => { addLine('WARN', args); original.warn(...args); };
  console.error = (...args) => { addLine('ERR ', args); original.error(...args); };

  // UI
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'DBG';
  btn.setAttribute('aria-label', 'Open debug log');
  btn.style.cssText = [
    'position:fixed',
    'right:12px',
    'bottom:12px',
    'z-index:99999',
    'padding:8px 10px',
    'border-radius:999px',
    'border:1px solid rgba(255,255,255,.18)',
    'background:rgba(13,17,23,.85)',
    'color:#e6edf3',
    'font-weight:800',
    'font-size:12px',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
  ].join(';');

  const overlay = document.createElement('div');
  overlay.hidden = true;
  overlay.style.cssText = [
    'position:fixed',
    'left:10px',
    'right:10px',
    'bottom:10px',
    'top:10px',
    'z-index:999999',
    'background:rgba(0,0,0,.72)',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
    'border-radius:12px',
    'padding:10px',
    'display:flex',
    'flex-direction:column',
    'gap:10px',
  ].join(';');

  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;color:#e6edf3;font-weight:800;';
  hdr.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
    <span style="font-size:14px">Debug log</span>
    <span style="font-size:11px;color:#8b949e;font-weight:700">(max ${MAX_LINES})</span>
  </div>`;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;align-items:center;';

  const mkSmallBtn = (txt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.style.cssText = 'padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(22,27,34,.9);color:#e6edf3;font-weight:800;';
    return b;
  };

  const copyBtn = mkSmallBtn('Copia');
  const clearBtn = mkSmallBtn('Pulisci');
  const closeBtn = mkSmallBtn('Chiudi');

  btnRow.append(copyBtn, clearBtn, closeBtn);
  hdr.appendChild(btnRow);

  const ta = document.createElement('textarea');
  ta.readOnly = true;
  ta.spellcheck = false;
  ta.style.cssText = [
    'flex:1',
    'width:100%',
    'resize:none',
    'border-radius:10px',
    'border:1px solid rgba(255,255,255,.12)',
    'background:rgba(13,17,23,.92)',
    'color:#e6edf3',
    'padding:10px',
    'font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    'font-size:11px',
    'line-height:1.35',
  ].join(';');

  overlay.append(hdr, ta);

  const open = () => {
    overlay.hidden = false;
    ta.value = lines.join('\n');
    ta.scrollTop = ta.scrollHeight;
  };
  const close = () => { overlay.hidden = true; };

  btn.addEventListener('click', () => (overlay.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);
  clearBtn.addEventListener('click', () => { lines.length = 0; ta.value = ''; });
  copyBtn.addEventListener('click', async () => {
    try {
      const txt = ta.value || lines.join('\n');
      await navigator.clipboard.writeText(txt);
      showToast('📋 Log copiato');
    } catch {
      try {
        ta.focus(); ta.select();
        document.execCommand('copy');
        showToast('📋 Log copiato');
      } catch {
        showToast('⚠️ Copia non riuscita');
      }
    }
  });

  document.body.append(btn, overlay);
  addLine('LOG ', ['[DebugOverlay] enabled']);
}


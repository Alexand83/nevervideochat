/* =================================================================
   NeverVideoChat — script.js  ·  Supabase Edition
   ─────────────────────────────────────────────────────────────────
   Backend: Supabase (Realtime + Postgres + Storage)
   Frontend: Vanilla JS ES6+, hosted on GitHub Pages

   What Supabase provides
   ──────────────────────
   • Realtime Postgres Changes  → persistent public chat messages
   • Realtime Presence          → live user list (who's online, has camera)
   • Realtime Broadcast         → typing indicators, private messages,
                                   WebRTC signalling, camera requests
   • Storage bucket "chat-media"→ uploaded images + voice files

   ╔═══════════════════════════════════════════════════════════════╗
   ║  SETUP: fill in the two constants just below (section 0)      ║
   ╚═══════════════════════════════════════════════════════════════╝

   Sections
   ─────────
     0.  Supabase config  ← FILL IN YOUR CREDENTIALS HERE
     1.  Emoji data
     2.  App state
     3.  DOM references
     4.  Utility helpers
     5.  User identity (localStorage)
     6.  Logo fallback
     7.  Sound notification (Web Audio)
     8.  Toast
     9.  Messages — render + send
    10.  Users panel
    11.  Rich-text toolbar
    12.  Image attachment + Storage upload
    13.  Emoji picker
    14.  Voice recording + Storage upload
    15.  Private messaging (Broadcast)
    16.  Context menu
    17.  Multi-window camera system
    18.  WebRTC (public camera share + private call)
    19.  Mobile panel toggle
    20.  Drag + Resize helpers
    21.  Auto-scroll
    22.  Supabase connection + Realtime subscriptions
    23.  Init
================================================================= */
'use strict';

/* ================================================================
   0. SUPABASE CONFIG
   ─────────────────────────────────────────────────────────────────
   1. Go to https://supabase.com → New Project
   2. Project Settings → API
   3. Copy "Project URL" and "anon / public" key into the two lines
      below, then push to GitHub.  Both values are safe to commit
      (the anon key is intentionally public — RLS policies protect
       your data).
================================================================= */
const SUPABASE_URL      = 'https://kybarxjynjxpagxijpti.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0HLInJsBCt5kZCVW9yifcg_1TGxHMCm';

/* ================================================================
   1. EMOJI DATA
================================================================ */
const EMOJI_CATEGORIES = {
  '😊': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍',
         '🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔',
         '🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴',
         '😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓',
         '🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥',
         '😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈',
         '👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  '👋': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉',
         '👆','☝️','👇','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏',
         '💪','🦵','🦶','👂','👃','👀','👅','👄','💋'],
  '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞',
         '💓','💗','💖','💘','💝','💟','♥️','💋','🫶'],
  '🎉': ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🥈','🥉','🎯','🎮','🕹️','🎲','♟️',
         '🎨','🖼️','🎭','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎻','🎙️',
         '📻','📺','📷','📸','📹','💻','🖥️','⌨️','🖱️'],
  '🌸': ['🌸','💐','🌺','🌻','🌼','🌷','🌹','🥀','🌿','🍀','🍁','🍂','🍃','🌱','🌲',
         '🌳','🌴','🌵','🌾','🌊','🌈','⭐','🌟','✨','💫','⚡','🔥','❄️','🌙','☀️',
         '⛅','☁️','⛈️','🌩️','🌨️','🌀','🦋','🐝'],
  '🍕': ['🍕','🍔','🍟','🌭','🍿','🥓','🥚','🍳','🧇','🥞','🍣','🍜','🍝','🍛',
         '🍱','🦀','🦞','🦐','🍦','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭',
         '☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍸','🍹'],
};
const AVATAR_COLORS = [
  '#1f6feb','#388bfd','#a371f7','#da3633','#d29922',
  '#3fb950','#238636','#e8523a','#f78166','#79c0ff',
];
/*
 * ICE server configuration
 * ──────────────────────────────────────────────────────────────────
 * STUN  → trova il tuo IP pubblico. Gratuiti. Funzionano per ~80%
 *          dei casi (falliscono con NAT simmetrico: aziende, VPN,
 *          alcuni operatori mobile).
 * TURN  → relay video/audio quando STUN non basta. Necessari per
 *          connettere il 20% rimanente.
 *
 * OpenRelay è un progetto open-source con TURN gratuiti per sviluppo.
 * Per produzione ad alto traffico: https://www.metered.ca (1 GB/mese
 * gratis, poi ~$0.40/GB) oppure self-host coturn su un VPS.
 * ──────────────────────────────────────────────────────────────────
 */
const ICE_SERVERS = {
  iceServers: [
    /* ── STUN multipli (ridondanza) ── */
    { urls: 'stun:stun.l.google.com:19302'      },
    { urls: 'stun:stun1.l.google.com:19302'     },
    { urls: 'stun:stun2.l.google.com:19302'     },
    { urls: 'stun:stun.cloudflare.com:3478'     },
    { urls: 'stun:stun.relay.metered.ca:80'     },

    /* ── TURN gratuiti OpenRelay (sviluppo / basso traffico) ── */
    {
      urls:       'turn:openrelay.metered.ca:80',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls:       'turn:openrelay.metered.ca:443',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls:       'turn:openrelay.metered.ca:443?transport=tcp',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls:       'turns:openrelay.metered.ca:443?transport=tcp',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },

    /* ── TURN Metered (opzionale — crea account su metered.ca,
          sostituisci username e credential con le tue credenziali) ──
    {
      urls:       'turn:global.relay.metered.ca:80',
      username:   'TUO_USERNAME_METERED',
      credential: 'TUA_CREDENTIAL_METERED',
    },
    ── */
  ],

  /* Ordine ICE: prova prima la connessione diretta (host),
     poi riflessa (srflx/STUN), infine relay (TURN) */
  iceCandidatePoolSize: 10,
};

/* ================================================================
   2. APP STATE
================================================================ */
const state = {
  /* Local user (loaded from localStorage in section 5) */
  currentUser: null,

  /* Remote users — populated via Supabase Presence */
  users: [],

  messages:     [],
  privateChats: {},

  /* Rich-text */
  isBold: false, currentColor: '#e6edf3', fontSize: '3',

  /* Pending image */
  pendingImage: null,

  /* Voice recording */
  mediaRecorder: null, recordingChunks: [], recordingTimer: null, recordingSeconds: 0,

  /* Camera windows (public mode)
     { [userId]: { el, stream, isOwn, micEnabled } }          */
  cameraWindows: {},
  micAnalysers:  {},   // { [userId]: { ctx, raf } }
  localStream:   null,

  /* WebRTC
     outgoingPCs: B shares their stream to requester A  → { [toUserId]: RTCPeerConnection }
     incomingPCs: A receives stream from B              → { [fromUserId]: RTCPeerConnection }
     privatePeer: peer for the private vcall-win        */
  outgoingPCs:   {},
  incomingPCs:   {},
  privatePeer:   null,
  activeCallUID: null,

  /* Typing debounce */
  typingTimer: null,

  /* Context menu */
  contextTargetUID: null,

  /* Supabase Realtime channels */
  supa:            null,
  presenceCh:      null,
  signalCh:        null,

  /* Web Audio for notifications */
  audioCtx: null,
};

/* ================================================================
   3. DOM REFERENCES
================================================================ */
const $ = id => document.getElementById(id);

const dom = {
  headerLogo: $('headerLogo'), logoFallback: $('logoFallback'),
  cameraBtnHeader: $('cameraBtnHeader'), cameraBtnLabel: $('cameraBtnLabel'),
  mobileUsersToggle: $('mobileUsersToggle'), onlineBadge: $('onlineBadge'),

  msgsContainer: $('msgsContainer'), welcomeBanner: $('welcomeBanner'),
  typingRow: $('typingRow'), typingTxt: $('typingTxt'),

  msgInput: $('msgInput'), sendBtn: $('sendBtn'),
  boldBtn: $('boldBtn'), colorPicker: $('colorPicker'), fontSizeSelect: $('fontSizeSelect'),
  emojiPickerBtn: $('emojiPickerBtn'), imageAttachBtn: $('imageAttachBtn'),
  imageFileInput: $('imageFileInput'), voiceMsgBtn: $('voiceMsgBtn'),
  imgPreviewStrip: $('imgPreviewStrip'), previewThumb: $('previewThumb'),
  previewRemoveBtn: $('previewRemoveBtn'), voiceRecStrip: $('voiceRecStrip'),
  recTimer: $('recTimer'), recStopBtn: $('recStopBtn'), recCancelBtn: $('recCancelBtn'),
  emojiPanel: $('emojiPanel'), emojiTabsRow: $('emojiTabsRow'), emojiGrid: $('emojiGrid'),

  usersPanel: $('usersPanel'), usersList: $('usersList'),
  onlineCountLabel: $('onlineCountLabel'), closePanelBtn: $('closePanelBtn'),
  panelOverlay: $('panelOverlay'),

  privateChatCont: $('privateChatCont'), minimisedBar: $('minimisedBar'),
  toastCont: $('toastCont'),

  camReqOverlay: $('camReqOverlay'), camReqBody: $('camReqBody'),
  camAcceptBtn: $('camAcceptBtn'), camRejectBtn: $('camRejectBtn'),

  vcallWin: $('vcallWin'), vcallDragHandle: $('vcallDragHandle'),
  vcallAvatar: $('vcallAvatar'), vcallName: $('vcallName'), vcallStatus: $('vcallStatus'),
  vcallHdrClose: $('vcallHdrClose'), remoteVideoEl: $('remoteVideoEl'),
  localVideoEl: $('localVideoEl'), remotePlaceholder: $('remotePlaceholder'),
  remotePHAvatar: $('remotePHAvatar'), remotePHName: $('remotePHName'),
  vcallMicBtn: $('vcallMicBtn'), vcallEndBtn: $('vcallEndBtn'), vcallCamBtn: $('vcallCamBtn'),

  ctxMenu: $('ctxMenu'), ctxUserHdr: $('ctxUserHdr'),
  ctxPrivateBtn: $('ctxPrivateBtn'), ctxCamBtn: $('ctxCamBtn'), ctxOverlay: $('ctxOverlay'),
};

/* ================================================================
   4. UTILITY HELPERS
================================================================ */
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (name.charCodeAt(i) + ((h << 5) - h)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name) { return name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase(); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
function clamp(x,lo,hi) { return Math.min(Math.max(x,lo),hi); }
function ytVideoId(url) {
  const m = url.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
function sanitiseHtml(html) {
  const d = document.createElement('div'); d.innerHTML = html;
  d.querySelectorAll('script,style,object,embed').forEach(e => e.remove());
  d.querySelectorAll('*').forEach(e => [...e.attributes].forEach(a => { if(a.name.startsWith('on')) e.removeAttribute(a.name); }));
  return d.innerHTML;
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function findUser(id) {
  if (id === 'me' || id === state.currentUser?.id) return state.currentUser;
  return state.users.find(u => u.id === id) || null;
}
/** Add/update a remote user in state.users */
function ensureUser(id, name, extra = {}) {
  if (!id || id === state.currentUser?.id) return;
  let u = state.users.find(u => u.id === id);
  if (!u) { u = { id, name, isGuest: true, online: false, hasCamera: false }; state.users.push(u); }
  if (name)                 u.name      = name;
  if ('isGuest'   in extra) u.isGuest   = extra.isGuest;
  if ('online'    in extra) u.online    = extra.online;
  if ('hasCamera' in extra) u.hasCamera = extra.hasCamera;
  return u;
}
function supabaseReady() { return !!state.supa; }

/* ================================================================
   5. USER IDENTITY (stored in localStorage — no login required)
================================================================ */
function getOrCreateIdentity() {
  try {
    const stored = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
    if (stored?.id && stored?.name) return stored;
  } catch (_) {}
  const id   = (typeof crypto !== 'undefined' && crypto.randomUUID)
                  ? crypto.randomUUID()
                  : `u${Date.now()}${Math.random().toString(36).slice(2,8)}`;
  const user = {
    id,
    name:    `Guest_${Math.floor(Math.random() * 90000) + 10000}`,
    isGuest: true,
    online:  true,
    hasCamera: false,
  };
  localStorage.setItem('nvc_identity', JSON.stringify(user));
  return user;
}

/* ================================================================
   6. LOGO FALLBACK
================================================================ */
(function initLogo() {
  const img = dom.headerLogo;
  const fallbacks = [
    'https://rask-arch.github.io/raskvideochat/logo.svg',
    'https://rask-arch.github.io/raskvideochat/assets/logo.png',
  ];
  let a = 0;
  img.addEventListener('error', () => {
    if (a < fallbacks.length) { img.src = fallbacks[a++]; }
    else { img.hidden = true; dom.logoFallback.hidden = false; }
  });
})();

/* ================================================================
   7. SOUND NOTIFICATION
================================================================ */
function playNotificationSound() {
  try {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = state.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(880, ctx.currentTime);
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

/* ================================================================
   8. TOAST
================================================================ */
function showToast(msg, duration = 3500) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  dom.toastCont.appendChild(el);
  setTimeout(() => el.remove(), duration + 350);
}

/* ================================================================
   9. MESSAGES — render + send
================================================================ */
function addMessage({ userId, html, ts = Date.now() }) {
  const msg = { id: `m${Date.now()}${Math.random()}`, userId, html, ts };
  state.messages.push(msg);
  renderMessage(msg);
}

function renderMessage(msg) {
  if (dom.welcomeBanner?.parentNode) dom.welcomeBanner.remove();

  /* Resolve display identity — userId might be a raw UUID from DB */
  const isMine  = msg.userId === 'me' || msg.userId === state.currentUser?.id;
  const user    = isMine ? state.currentUser : (findUser(msg.userId) || { name: msg.username || 'User', isGuest: true });
  const color   = avatarColor(user.name);
  const init    = initials(user.name);

  const group = document.createElement('div');
  group.className = `msg-group${isMine ? ' own' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar'; avatar.style.background = color;
  avatar.textContent = init; avatar.title = user.name;
  if (!isMine) avatar.addEventListener('click', () => openContextMenu(msg.userId, avatar));

  const content = document.createElement('div');
  content.className = 'msg-content';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';

  const senderEl = document.createElement('span');
  senderEl.className = 'msg-sender';
  senderEl.textContent = isMine ? 'You' : user.name;

  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time'; timeEl.textContent = fmtTime(msg.ts);

  if (user.isGuest && !isMine) {
    const gt = document.createElement('span');
    gt.className = 'guest-tag'; gt.textContent = 'Guest';
    meta.append(senderEl, gt, timeEl);
  } else { meta.append(senderEl, timeEl); }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = processHtml(msg.html);

  content.append(meta, bubble);
  group.append(avatar, content);
  dom.msgsContainer.appendChild(group);
  scrollToBottom();
}

function processHtml(html) {
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

/** Send a public message — optimistic render + Supabase insert */
async function sendMessage() {
  let html = dom.msgInput.innerHTML.trim().replace(/^(<br\s*\/?>)+|(<br\s*\/?>)+$/gi,'').trim();
  const hasText  = html.length > 0 && html !== '<br>';
  const hasImage = !!state.pendingImage;
  if (!hasText && !hasImage) return;
  if (!hasText) html = '';

  if (hasImage) {
    const url = supabaseReady()
      ? await uploadToStorage(state.pendingImage.dataUrl, 'images', 'jpg')
      : null;
    html += `<img class="msg-img" src="${url || state.pendingImage.dataUrl}" alt="image">`;
    state.pendingImage = null;
    dom.imgPreviewStrip.hidden = true;
  }

  /* Optimistic: show immediately */
  addMessage({ userId: 'me', html, ts: Date.now() });
  dom.msgInput.innerHTML = '';

  /* Persist to Supabase (non-blocking) */
  if (supabaseReady()) {
    state.supa.from('messages').insert({
      user_id:  state.currentUser.id,
      username: state.currentUser.name,
      content:  html,
    }).then(({ error }) => { if (error) console.warn('msg insert:', error); });
  }
}

/* ================================================================
   10. USERS PANEL
================================================================ */
function renderUsers() {
  dom.usersList.innerHTML = '';
  const all = [state.currentUser, ...state.users];
  const online = all.filter(u => u?.online).length;
  dom.onlineCountLabel.textContent = online;
  dom.onlineBadge.textContent = online;

  all.forEach(user => {
    if (!user) return;
    const li = document.createElement('div');
    li.className = 'user-item'; li.setAttribute('role','listitem'); li.dataset.userId = user.id;

    const av = document.createElement('div');
    av.className = 'user-item-avatar'; av.style.background = avatarColor(user.name);
    av.textContent = initials(user.name);
    const dot = document.createElement('span');
    dot.className = `status-dot${user.online ? '' : ' offline'}`;
    av.appendChild(dot);

    const info = document.createElement('div'); info.className = 'user-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = `user-item-name${user.online ? '' : ' offline'}`;
    nameEl.textContent = user.name;
    const sub = document.createElement('div');
    sub.className = 'user-item-sub'; sub.textContent = user.online ? 'Online' : 'Offline';
    info.append(nameEl, sub);
    li.append(av, info);

    if (user.hasCamera && user.online) {
      const ci = document.createElement('span');
      ci.className = 'user-cam-icon'; ci.textContent = '📹'; ci.title = 'Camera on';
      li.appendChild(ci);
    }
    if (user.isGuest) { const gt = document.createElement('span'); gt.className = 'guest-tag'; gt.textContent = 'Guest'; li.appendChild(gt); }
    if (user.id === state.currentUser?.id) { const yt = document.createElement('span'); yt.className = 'you-tag'; yt.textContent = 'You'; li.appendChild(yt); }

    if (user.id !== state.currentUser?.id) {
      li.addEventListener('click', e => { e.stopPropagation(); openContextMenu(user.id, li); });
    }
    dom.usersList.appendChild(li);
  });
}

/* ================================================================
   11. RICH-TEXT TOOLBAR
================================================================ */
function initToolbar() {
  dom.boldBtn.addEventListener('click', () => {
    state.isBold = !state.isBold;
    dom.boldBtn.setAttribute('aria-pressed', String(state.isBold));
    dom.boldBtn.classList.toggle('active', state.isBold);
    dom.msgInput.focus(); document.execCommand('bold');
  });
  dom.colorPicker.addEventListener('input', e => {
    state.currentColor = e.target.value;
    dom.msgInput.focus(); document.execCommand('foreColor', false, state.currentColor);
  });
  dom.fontSizeSelect.addEventListener('change', e => {
    state.fontSize = e.target.value;
    dom.msgInput.focus(); document.execCommand('fontSize', false, state.fontSize);
  });
  dom.msgInput.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); dom.boldBtn.click(); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  /* Typing indicator via Supabase Broadcast */
  dom.msgInput.addEventListener('input', sendTypingEvent);
  dom.sendBtn.addEventListener('click', sendMessage);
}

/* ================================================================
   12. IMAGE ATTACHMENT + SUPABASE STORAGE UPLOAD
================================================================ */
function initImageAttach() {
  dom.imageAttachBtn.addEventListener('click', () => dom.imageFileInput.click());
  dom.imageFileInput.addEventListener('change', e => {
    const f = e.target.files[0]; if (f) loadImageFile(f); e.target.value = '';
  });
  dom.msgInput.addEventListener('paste', e => {
    const items = e.clipboardData?.items; if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) { e.preventDefault(); loadImageFile(item.getAsFile()); return; }
    }
  });
  dom.previewRemoveBtn.addEventListener('click', () => {
    state.pendingImage = null; dom.imgPreviewStrip.hidden = true; dom.previewThumb.src = '';
  });
}
function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    state.pendingImage = { dataUrl: ev.target.result, type: file.type };
    dom.previewThumb.src = ev.target.result; dom.imgPreviewStrip.hidden = false;
  };
  reader.readAsDataURL(file);
}

/**
 * Upload a file (data URL or Blob) to the Supabase Storage bucket "chat-media".
 * Returns the public URL, or null on failure.
 */
async function uploadToStorage(input, folder, ext) {
  if (!supabaseReady()) return null;
  try {
    let blob;
    if (typeof input === 'string') {        // data URL → Blob
      const res = await fetch(input); blob = await res.blob();
    } else { blob = input; }
    const name = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext || 'bin'}`;
    const { error } = await state.supa.storage.from('chat-media').upload(name, blob, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data: { publicUrl } } = state.supa.storage.from('chat-media').getPublicUrl(name);
    return publicUrl;
  } catch (err) { console.warn('Storage upload error:', err); return null; }
}

/* ================================================================
   13. EMOJI PICKER
================================================================ */
function initEmojiPicker() {
  buildEmojiPicker();
  dom.emojiPickerBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = !dom.emojiPanel.hidden;
    dom.emojiPanel.hidden = open;
    dom.emojiPickerBtn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', e => {
    if (!dom.emojiPanel.hidden && !dom.emojiPanel.contains(e.target) && e.target !== dom.emojiPickerBtn) {
      dom.emojiPanel.hidden = true; dom.emojiPickerBtn.setAttribute('aria-expanded','false');
    }
  });
}
function buildEmojiPicker() {
  const tabs = Object.keys(EMOJI_CATEGORIES); let active = tabs[0];
  function renderTab(key) {
    active = key; dom.emojiGrid.innerHTML = '';
    EMOJI_CATEGORIES[key].forEach(emoji => {
      const c = document.createElement('button'); c.type = 'button'; c.className = 'emoji-cell';
      c.textContent = emoji; c.setAttribute('aria-label', emoji);
      c.addEventListener('click', () => insertEmoji(emoji)); dom.emojiGrid.appendChild(c);
    });
    dom.emojiTabsRow.querySelectorAll('.emoji-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  }
  tabs.forEach(key => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'emoji-tab-btn';
    b.textContent = key; b.dataset.key = key; b.addEventListener('click', () => renderTab(key));
    dom.emojiTabsRow.appendChild(b);
  });
  renderTab(active);
}
function insertEmoji(emoji) {
  dom.msgInput.focus();
  const sel = window.getSelection();
  if (sel?.rangeCount) {
    const r = sel.getRangeAt(0); r.deleteContents();
    const n = document.createTextNode(emoji); r.insertNode(n);
    r.setStartAfter(n); r.setEndAfter(n); sel.removeAllRanges(); sel.addRange(r);
  } else { dom.msgInput.textContent += emoji; }
  dom.emojiPanel.hidden = true; dom.emojiPickerBtn.setAttribute('aria-expanded','false');
}

/* ================================================================
   14. VOICE RECORDING + SUPABASE STORAGE UPLOAD
================================================================ */
function initVoiceRecording() {
  dom.voiceMsgBtn.addEventListener('click', startRecording);
  dom.recStopBtn.addEventListener('click',  stopRecording);
  dom.recCancelBtn.addEventListener('click',cancelRecording);
}
function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    showToast('⚠️ Voice recording is not supported in this browser.'); return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      state.recordingChunks = []; state.recordingSeconds = 0;
      const mime = ['audio/webm;codecs=opus','audio/webm','audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      state.mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      state.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) state.recordingChunks.push(e.data); };
      state.mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(state.recordingChunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
        /* Upload to Supabase Storage; fall back to local object URL */
        let src = URL.createObjectURL(blob);
        if (supabaseReady()) {
          const url = await uploadToStorage(blob, 'voices', 'webm');
          if (url) src = url;
        }
        const html = `<div class="voice-msg-wrap">🎙️ Voice message<audio controls src="${src}"></audio></div>`;
        addMessage({ userId: 'me', html, ts: Date.now() });
        if (supabaseReady()) {
          state.supa.from('messages').insert({
            user_id: state.currentUser.id, username: state.currentUser.name, content: html,
          }).then(({ error }) => { if (error) console.warn('voice msg insert:', error); });
        }
        dom.voiceRecStrip.hidden = true; clearInterval(state.recordingTimer); dom.recTimer.textContent = '0:00';
      };
      state.mediaRecorder.start(250); dom.voiceRecStrip.hidden = false;
      state.recordingTimer = setInterval(() => {
        state.recordingSeconds++;
        const m = Math.floor(state.recordingSeconds/60), s = String(state.recordingSeconds%60).padStart(2,'0');
        dom.recTimer.textContent = `${m}:${s}`;
      }, 1000);
    })
    .catch(() => showToast('🎙️ Microphone access denied.'));
}
function stopRecording() {
  if (state.mediaRecorder?.state !== 'inactive') state.mediaRecorder.stop();
  clearInterval(state.recordingTimer);
}
function cancelRecording() {
  if (state.mediaRecorder?.state !== 'inactive') {
    state.mediaRecorder.onstop = () => {};
    state.mediaRecorder.stop();
    state.mediaRecorder.stream?.getTracks().forEach(t => t.stop());
  }
  clearInterval(state.recordingTimer); dom.voiceRecStrip.hidden = true; dom.recTimer.textContent = '0:00';
}

/* ================================================================
   15. PRIVATE MESSAGING (via Supabase Realtime Broadcast)
   Messages are ephemeral — no DB needed for private chat.
   Only the target user hears the broadcast (filtered client-side).
================================================================ */
function initOrGetPChat(uid) {
  if (!state.privateChats[uid]) state.privateChats[uid] = { msgs:[], unread:0, popup:null, minimised:false };
  return state.privateChats[uid];
}
function openPrivateChat(uid) {
  const chat = initOrGetPChat(uid);
  if (chat.popup) { if (chat.minimised) restorePChat(uid); return; }
  const user = findUser(uid); if (!user) return;
  const color = avatarColor(user.name), init = initials(user.name);
  const popup = document.createElement('div');
  popup.className = 'pchat-popup'; popup.dataset.userId = uid;
  popup.innerHTML = `
    <div class="pchat-hdr">
      <div class="pchat-user-info">
        <div class="pchat-avatar" style="background:${color}">${init}</div>
        <span class="pchat-uname">${escHtml(user.name)}</span>
        ${user.online ? '<span class="pchat-online-dot"></span>' : ''}
      </div>
      <div class="pchat-ctrls">
        <button class="pchat-ctrl-btn pchat-min-btn" title="Minimise">—</button>
        <button class="pchat-ctrl-btn pchat-close-btn" title="Close">✕</button>
      </div>
    </div>
    <div class="pchat-msgs" id="pchat-msgs-${uid}"></div>
    <div class="pchat-input-row">
      <input class="pchat-input" type="text" placeholder="Message ${escHtml(user.name)}…"
             id="pchat-input-${uid}" autocomplete="off">
      <button class="pchat-send-btn" id="pchat-send-${uid}" aria-label="Send">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>`;
  dom.privateChatCont.appendChild(popup); chat.popup = popup; chat.minimised = false;
  chat.msgs.forEach(m => renderPMsg(uid, m));
  makeDraggable(popup, popup.querySelector('.pchat-hdr'));
  popup.querySelector('.pchat-min-btn').addEventListener('click',   () => minPChat(uid));
  popup.querySelector('.pchat-close-btn').addEventListener('click', () => closePChat(uid));
  const input = popup.querySelector(`#pchat-input-${uid}`);
  const sBtn  = popup.querySelector(`#pchat-send-${uid}`);
  function doSend() {
    const txt = input.value.trim(); if (!txt) return;
    const msg = { from: 'me', text: txt, ts: Date.now() };
    chat.msgs.push(msg); renderPMsg(uid, msg); input.value = '';
    broadcast('pm', uid, { text: txt, ts: msg.ts });
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  sBtn.addEventListener('click', doSend);
  input.focus();
}
function renderPMsg(uid, msg) {
  const chat = state.privateChats[uid]; if (!chat?.popup) return;
  const c = chat.popup.querySelector(`#pchat-msgs-${uid}`); if (!c) return;
  const el = document.createElement('div');
  el.className = `pchat-msg${msg.from === 'me' ? ' own' : ''}`;
  el.innerHTML = `<div class="pchat-bubble">${escHtml(msg.text)}</div><div class="pchat-time">${fmtTime(msg.ts)}</div>`;
  c.appendChild(el); c.scrollTop = c.scrollHeight;
}
function minPChat(uid) {
  const chat = state.privateChats[uid]; if (!chat?.popup) return;
  chat.popup.style.display = 'none'; chat.minimised = true;
  if (!dom.minimisedBar.querySelector(`[data-userid="${uid}"]`)) {
    const user = findUser(uid);
    const btn = document.createElement('button');
    btn.className = 'min-chat-btn'; btn.dataset.userid = uid;
    btn.style.background = avatarColor(user?.name ?? '?'); btn.textContent = initials(user?.name ?? '?');
    btn.title = user?.name ?? uid;
    const badge = document.createElement('span'); badge.className = 'min-chat-badge'; badge.id = `min-badge-${uid}`; badge.hidden = true;
    btn.appendChild(badge); btn.addEventListener('click', () => restorePChat(uid));
    dom.minimisedBar.appendChild(btn);
  }
}
function restorePChat(uid) {
  const chat = state.privateChats[uid];
  if (!chat?.popup) { openPrivateChat(uid); return; }
  chat.popup.style.display = ''; chat.minimised = false; chat.unread = 0; updateMinBadge(uid);
  dom.minimisedBar.querySelector(`[data-userid="${uid}"]`)?.remove();
}
function closePChat(uid) {
  const chat = state.privateChats[uid]; if (!chat) return;
  chat.popup?.remove(); chat.popup = null;
  dom.minimisedBar.querySelector(`[data-userid="${uid}"]`)?.remove();
  chat.minimised = false; chat.unread = 0;
}
function updateMinBadge(uid) {
  const chat = state.privateChats[uid]; const badge = $(`min-badge-${uid}`); if (!badge) return;
  if (chat?.unread > 0) { badge.textContent = chat.unread; badge.hidden = false; } else { badge.hidden = true; }
}
/** Handle incoming private message from Broadcast */
function handleIncomingPM(payload) {
  if (payload.to !== state.currentUser?.id) return;
  ensureUser(payload.from, payload.fromName);
  const chat = initOrGetPChat(payload.from);
  const msg  = { from: payload.from, text: payload.text, ts: payload.ts || Date.now() };
  chat.msgs.push(msg);
  if (chat.popup && !chat.minimised) {
    renderPMsg(payload.from, msg);
  } else {
    chat.unread++; updateMinBadge(payload.from);
    showToast(`💬 ${payload.fromName}: ${payload.text.slice(0,50)}`);
    playNotificationSound();
  }
}

/* ================================================================
   16. CONTEXT MENU
================================================================ */
function openContextMenu(uid, anchor) {
  const user = findUser(uid); if (!user || uid === state.currentUser?.id) return;
  state.contextTargetUID = uid;
  const color = avatarColor(user.name), init = initials(user.name);
  dom.ctxUserHdr.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px">
    <span style="display:inline-flex;width:22px;height:22px;border-radius:50%;
                 background:${color};align-items:center;justify-content:center;
                 font-size:9px;font-weight:700;color:#fff;flex-shrink:0">${init}</span>
    ${escHtml(user.name)}</span>`;
  dom.ctxCamBtn.disabled      = !user.hasCamera || !user.online;
  dom.ctxCamBtn.style.opacity = (user.hasCamera && user.online) ? '1' : '0.4';
  const r = anchor.getBoundingClientRect();
  dom.ctxMenu.style.top  = `${clamp(r.bottom+4,4,window.innerHeight-200)}px`;
  dom.ctxMenu.style.left = `${clamp(r.left,4,window.innerWidth-210)}px`;
  dom.ctxMenu.hidden = false; dom.ctxOverlay.hidden = false;
}
function closeCtxMenu() { dom.ctxMenu.hidden=true; dom.ctxOverlay.hidden=true; state.contextTargetUID=null; }
function initContextMenu() {
  dom.ctxPrivateBtn.addEventListener('click', () => { const u=state.contextTargetUID; closeCtxMenu(); if(u) openPrivateChat(u); });
  dom.ctxCamBtn.addEventListener('click',    () => { const u=state.contextTargetUID; closeCtxMenu(); if(u) requestPublicCamera(u); });
  dom.ctxOverlay.addEventListener('click', closeCtxMenu);
  document.addEventListener('keydown', e => { if(e.key==='Escape') closeCtxMenu(); });
}

/* ================================================================
   17. MULTI-WINDOW CAMERA SYSTEM
   (public mode: each stream = independent .cam-window)
================================================================ */
const CAM_STEP = 30;
function camCount() { return Object.keys(state.cameraWindows).length; }

function createCameraWindow(uid, stream, name, isOwn) {
  if (state.cameraWindows[uid]) {
    const w = state.cameraWindows[uid].el;
    w.style.zIndex = String(700 + camCount()); return;
  }
  const color = avatarColor(name), init = initials(name), n = camCount();
  const win = document.createElement('div');
  win.className = 'cam-window'; win.id = `cam-win-${uid}`;
  win.setAttribute('role','dialog'); win.setAttribute('aria-label', `${name} camera`);
  win.style.right  = (20 + n * CAM_STEP) + 'px';
  win.style.bottom = (80 + n * CAM_STEP) + 'px';
  win.style.zIndex = String(650 + n);
  const footer = isOwn ? `
    <div class="cam-win-footer">
      <button class="cam-ctrl-btn" id="cam-mic-btn-${uid}" aria-label="Toggle microphone" aria-pressed="true">
        <svg id="cam-mic-on-${uid}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
        </svg>
        <svg id="cam-mic-off-${uid}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
          <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/>
        </svg>
        <span id="cam-mic-lbl-${uid}">Mic On</span>
      </button>
      <div class="mic-meter-section">
        <div class="mic-meter-bar-wrap"><div class="mic-meter-bar"><div class="mic-meter-fill" id="mic-fill-${uid}"></div></div></div>
        <span class="mic-meter-lbl">Mic Level</span>
      </div>
    </div>` : `
    <div class="cam-win-footer cam-win-footer-remote">
      <span class="cam-win-live-badge">🔴 Live</span>
    </div>`;
  win.innerHTML = `
    <div class="cam-win-hdr" id="cam-win-hdr-${uid}">
      <div class="cam-win-user-info">
        <span class="cam-win-avatar" style="background:${color}">${escHtml(init)}</span>
        <span class="cam-win-name">${escHtml(name)}</span>
        ${isOwn ? '<span class="cam-win-you-tag">You</span>' : ''}
      </div>
      <button class="cam-win-close-btn" aria-label="Close camera window">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="cam-win-video-wrap">
      <video id="cam-vid-${uid}" autoplay ${isOwn ? 'muted' : ''} playsinline
             style="${isOwn ? 'transform:scaleX(-1)' : ''}"></video>
    </div>
    ${footer}
    <div class="cam-resize-handle" id="cam-rz-${uid}" aria-hidden="true"></div>`;
  document.body.appendChild(win);
  state.cameraWindows[uid] = { el: win, stream, isOwn, micEnabled: true };
  const videoEl = $(`cam-vid-${uid}`);
  if (videoEl) videoEl.srcObject = stream;
  win.querySelector('.cam-win-close-btn').addEventListener('click', () => closeCameraWindow(uid));
  if (isOwn) {
    const mb = $(`cam-mic-btn-${uid}`);
    if (mb) mb.addEventListener('click', () => toggleCamMic(uid));
    startMicMeter(stream, uid);
  }
  makeDraggable(win, $(`cam-win-hdr-${uid}`));
  makeResizable(win, $(`cam-rz-${uid}`));
}

function closeCameraWindow(uid) {
  const cw = state.cameraWindows[uid]; if (!cw) return;
  stopMicMeter(uid); cw.el.remove(); delete state.cameraWindows[uid];
  if (uid === state.currentUser?.id || uid === 'me') {
    state.localStream?.getTracks().forEach(t => t.stop()); state.localStream = null;
    state.currentUser.hasCamera = false;
    dom.cameraBtnLabel.textContent = 'Camera Off'; dom.cameraBtnHeader.classList.remove('camera-on');
    updateOwnPresence(); renderUsers(); showToast('📹 Camera disabled.');
  }
}

function toggleCamMic(uid) {
  const cw = state.cameraWindows[uid]; if (!cw) return;
  cw.micEnabled = !cw.micEnabled;
  state.localStream?.getAudioTracks().forEach(t => { t.enabled = cw.micEnabled; });
  const mb = $(`cam-mic-btn-${uid}`), on = $(`cam-mic-on-${uid}`), off = $(`cam-mic-off-${uid}`), lbl = $(`cam-mic-lbl-${uid}`);
  if (mb) { mb.setAttribute('aria-pressed', String(cw.micEnabled)); mb.classList.toggle('mic-muted', !cw.micEnabled); }
  if (on)  on.style.display  = cw.micEnabled ? '' : 'none';
  if (off) off.style.display = cw.micEnabled ? 'none' : '';
  if (lbl) lbl.textContent   = cw.micEnabled ? 'Mic On' : 'Mic Muted';
}

/* ── Own camera toggle (header button) ─────────────────────────── */
async function toggleOwnCamera() {
  if (state.localStream) { closeCameraWindow(state.currentUser.id); }
  else { await startOwnCamera(); }
}
async function startOwnCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { showToast('⚠️ Camera not supported.'); return; }
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      video: { width:{ideal:1280}, height:{ideal:720}, facingMode:'user' }, audio: true,
    });
    state.currentUser.hasCamera = true;
    dom.cameraBtnLabel.textContent = 'Camera On'; dom.cameraBtnHeader.classList.add('camera-on');
    createCameraWindow(state.currentUser.id, state.localStream, 'You', true);
    updateOwnPresence(); renderUsers(); showToast('📹 Camera enabled.');
  } catch (err) {
    state.localStream = null;
    showToast(err.name === 'NotAllowedError' ? '🚫 Camera/mic access denied.' : `⚠️ Camera error: ${err.message}`);
  }
}

/* ── Mic level meter (per-window, Web Audio AnalyserNode) ────────── */
function startMicMeter(stream, uid) {
  stopMicMeter(uid);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const an  = ctx.createAnalyser(); an.fftSize=256; an.smoothingTimeConstant=0.75;
    src.connect(an);
    const data = new Uint8Array(an.frequencyBinCount);
    function tick() {
      an.getByteFrequencyData(data);
      const avg = data.reduce((a,b)=>a+b,0)/data.length;
      const pct = Math.min(100, Math.round((avg/70)*100));
      const fill = $(`mic-fill-${uid}`);
      if (fill) {
        const cw = state.cameraWindows[uid];
        fill.style.width = (cw?.micEnabled !== false ? pct : 0) + '%';
        fill.style.backgroundPosition = Math.max(0,(pct-50)*2) + '% 0';
      }
      if (state.micAnalysers[uid]) state.micAnalysers[uid].raf = requestAnimationFrame(tick);
    }
    state.micAnalysers[uid] = { ctx, raf: requestAnimationFrame(tick) };
  } catch (err) { console.warn('Mic meter:', err); }
}
function stopMicMeter(uid) {
  const a = state.micAnalysers[uid]; if (!a) return;
  if (a.raf) cancelAnimationFrame(a.raf);
  if (a.ctx) a.ctx.close().catch(()=>{});
  delete state.micAnalysers[uid];
  const fill = $(`mic-fill-${uid}`); if (fill) fill.style.width='0%';
}

function initCameraSystem() { dom.cameraBtnHeader.addEventListener('click', toggleOwnCamera); }

/* ================================================================
   18. WEBRTC — public camera share + private call
   Signalling goes via Supabase Realtime Broadcast.
   ICE traversal uses Google's public STUN servers.
================================================================ */

/** Broadcast a signal to a specific user (all clients see it; filtered by .to) */
function broadcast(event, toUid, extra = {}) {
  if (!state.signalCh) {
    console.warn('Signal channel not ready'); return;
  }
  state.signalCh.send({
    type: 'broadcast', event,
    payload: { from: state.currentUser.id, fromName: state.currentUser.name, to: toUid, ...extra },
  });
}

/* ── Public camera request ─────────────────────────────────────── */
function requestPublicCamera(targetUid) {
  const target = findUser(targetUid);
  if (!target?.hasCamera || !target.online) { showToast(`${target?.name || 'User'} camera is not enabled.`); return; }
  if (!supabaseReady()) { showToast('⚠️ Server connection required for camera requests.'); return; }
  broadcast('cam-req', targetUid, { reqType: 'public' });
  showToast(`📹 Camera request sent to ${target.name}…`);
}

/** B receives a public camera request from A */
function handleCamRequest(payload) {
  if (payload.to !== state.currentUser?.id) return;
  if (payload.reqType !== 'public') return;
  dom.camReqBody.textContent = `${payload.fromName} wants to see your camera.`;
  dom.camReqOverlay.hidden = false;
  dom.camAcceptBtn.onclick = async () => {
    dom.camReqOverlay.hidden = true;
    await sharePublicCameraTo(payload.from, payload.fromName);
  };
  dom.camRejectBtn.onclick = () => {
    dom.camReqOverlay.hidden = true;
    broadcast('cam-rejected', payload.from, {});
    showToast(`❌ Camera request from ${payload.fromName} declined.`);
  };
}

/** B shares their camera stream to A via WebRTC */
async function sharePublicCameraTo(toUid) {
  try {
    if (!state.localStream) {
      state.localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
      state.currentUser.hasCamera = true;
      dom.cameraBtnLabel.textContent = 'Camera On'; dom.cameraBtnHeader.classList.add('camera-on');
      createCameraWindow(state.currentUser.id, state.localStream, 'You', true);
      updateOwnPresence();
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    state.outgoingPCs[toUid] = pc;
    state.localStream.getTracks().forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) broadcast('webrtc', toUid, { sigType:'ice', candidate, ctx:'public' });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    broadcast('webrtc', toUid, { sigType:'offer', sdp: offer.sdp, ctx:'public' });
    broadcast('cam-accepted', toUid, {});
  } catch (err) { showToast('⚠️ Could not share camera: ' + err.message); }
}

/** Handle all incoming WebRTC signals */
async function handleWebRTCSignal(payload) {
  if (payload.to !== state.currentUser?.id) return;
  const { sigType, from, sdp, candidate } = payload;
  const isPublic  = payload.ctx === 'public';
  const isPrivate = payload.ctx === 'private';

  if (isPublic) {
    if (sigType === 'offer') {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      state.incomingPCs[from] = pc;
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) broadcast('webrtc', from, { sigType:'ice', candidate, ctx:'public' });
      };
      pc.ontrack = ({ streams }) => {
        ensureUser(from, payload.fromName);
        openRemoteCamWindow(from, streams[0]);
      };
      await pc.setRemoteDescription({ type:'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcast('webrtc', from, { sigType:'answer', sdp: answer.sdp, ctx:'public' });
    }
    else if (sigType === 'answer') {
      const pc = state.outgoingPCs[from]; if (pc) await pc.setRemoteDescription({ type:'answer', sdp });
    }
    else if (sigType === 'ice') {
      const pc = state.outgoingPCs[from] || state.incomingPCs[from];
      if (pc && candidate) await pc.addIceCandidate(candidate).catch(console.warn);
    }
  }

  if (isPrivate) {
    /* Private call signalling — uses vcallWin (PiP) */
    if (sigType === 'offer') {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      state.privatePeer = pc;
      state.activeCallUID = from;
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) broadcast('webrtc', from, { sigType:'ice', candidate, ctx:'private' });
      };
      pc.ontrack = ({ streams }) => {
        dom.remoteVideoEl.srcObject = streams[0];
        dom.remotePlaceholder.style.display = 'none';
      };
      if (state.localStream) state.localStream.getTracks().forEach(t => pc.addTrack(t, state.localStream));
      await pc.setRemoteDescription({ type:'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcast('webrtc', from, { sigType:'answer', sdp: answer.sdp, ctx:'private' });
    }
    else if (sigType === 'answer') {
      if (state.privatePeer) await state.privatePeer.setRemoteDescription({ type:'answer', sdp });
    }
    else if (sigType === 'ice') {
      if (state.privatePeer && candidate) await state.privatePeer.addIceCandidate(candidate).catch(console.warn);
    }
  }
}

function openRemoteCamWindow(uid, stream) {
  const user = findUser(uid);
  createCameraWindow(uid, stream, user?.name || uid, false);
}

/* ── Private video call (from private chat) ────────────────────── */
async function startPrivateCall(targetUid) {
  const target = findUser(targetUid);
  if (!supabaseReady()) { showToast('⚠️ Server connection required for calls.'); return; }
  try {
    if (!state.localStream) {
      state.localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    state.privatePeer = pc; state.activeCallUID = targetUid;
    state.localStream.getTracks().forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) broadcast('webrtc', targetUid, { sigType:'ice', candidate, ctx:'private' });
    };
    pc.ontrack = ({ streams }) => {
      dom.remoteVideoEl.srcObject = streams[0];
      dom.remotePlaceholder.style.display = 'none';
    };
    /* Show call window */
    dom.localVideoEl.srcObject = state.localStream;
    dom.vcallName.textContent   = target?.name || targetUid;
    dom.vcallStatus.textContent = 'Calling…';
    dom.vcallAvatar.textContent = initials(target?.name || '?');
    dom.vcallAvatar.style.background = avatarColor(target?.name || '?');
    dom.vcallWin.hidden = false;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    broadcast('webrtc', targetUid, { sigType:'offer', sdp: offer.sdp, ctx:'private' });
  } catch (err) { showToast('⚠️ Could not start call: ' + err.message); }
}

function initCallControls() {
  dom.vcallEndBtn.addEventListener('click', endCall);
  dom.vcallHdrClose.addEventListener('click', endCall);
  dom.vcallMicBtn.addEventListener('click', () => {
    const m = dom.vcallMicBtn.classList.toggle('off');
    dom.vcallMicBtn.setAttribute('aria-pressed', String(!m));
    state.localStream?.getAudioTracks().forEach(t => { t.enabled = !m; });
  });
  dom.vcallCamBtn.addEventListener('click', () => {
    const o = dom.vcallCamBtn.classList.toggle('off');
    dom.vcallCamBtn.setAttribute('aria-pressed', String(!o));
    state.localStream?.getVideoTracks().forEach(t => { t.enabled = !o; });
  });
  makeDraggable(dom.vcallWin, dom.vcallDragHandle);
  dom.camAcceptBtn.addEventListener('click', () => { dom.camReqOverlay.hidden = true; });
  dom.camRejectBtn.addEventListener('click', () => { dom.camReqOverlay.hidden = true; showToast('❌ Request declined.'); });
}
function endCall() {
  state.privatePeer?.close(); state.privatePeer = null;
  dom.vcallWin.hidden = true; dom.remoteVideoEl.srcObject = null;
  state.activeCallUID = null; showToast('📵 Call ended.');
}

/* ================================================================
   19. MOBILE PANEL TOGGLE
================================================================ */
function initMobilePanel() {
  const open  = () => { dom.usersPanel.classList.add('open'); dom.panelOverlay.classList.add('show'); dom.mobileUsersToggle.setAttribute('aria-expanded','true'); };
  const close = () => { dom.usersPanel.classList.remove('open'); dom.panelOverlay.classList.remove('show'); dom.mobileUsersToggle.setAttribute('aria-expanded','false'); };
  dom.mobileUsersToggle.addEventListener('click', () => dom.usersPanel.classList.contains('open') ? close() : open());
  dom.closePanelBtn.addEventListener('click', close);
  dom.panelOverlay.addEventListener('click', close);
}

/* ================================================================
   20. DRAG + RESIZE HELPERS
================================================================ */
function makeDraggable(el, handle) {
  if (!handle) return;
  let dragging=false, ox=0, oy=0, sl=0, st=0;
  function onStart(e) {
    if (e.target?.classList?.contains('cam-resize-handle')) return;
    const {clientX:x,clientY:y} = e.touches ? e.touches[0] : e;
    dragging=true; ox=x; oy=y;
    const r = el.getBoundingClientRect(); sl=r.left; st=r.top;
    el.style.left=sl+'px'; el.style.top=st+'px'; el.style.right='auto'; el.style.bottom='auto'; el.style.position='fixed';
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const {clientX:x,clientY:y}=e.touches?e.touches[0]:e;
    el.style.left=clamp(sl+x-ox,0,window.innerWidth-el.offsetWidth)+'px';
    el.style.top=clamp(st+y-oy,0,window.innerHeight-el.offsetHeight)+'px';
  }
  function onEnd() { dragging=false; }
  handle.addEventListener('mousedown', onStart,{passive:false}); handle.addEventListener('touchstart',onStart,{passive:false});
  document.addEventListener('mousemove',onMove); document.addEventListener('touchmove',onMove,{passive:true});
  document.addEventListener('mouseup',onEnd);    document.addEventListener('touchend',onEnd);
}
function makeResizable(el, handle) {
  if (!handle) return;
  let resizing=false,sx=0,sy=0,sw=0,sh=0;
  function onStart(e) { resizing=true; const {clientX:x,clientY:y}=e.touches?e.touches[0]:e; sx=x;sy=y;sw=el.offsetWidth;sh=el.offsetHeight; e.preventDefault(); e.stopPropagation(); }
  function onMove(e) {
    if (!resizing) return;
    const {clientX:x,clientY:y}=e.touches?e.touches[0]:e;
    el.style.width  = clamp(sw+x-sx,200,window.innerWidth*0.92)+'px';
    el.style.height = clamp(sh+y-sy,190,window.innerHeight*0.88)+'px';
  }
  function onEnd() { resizing=false; }
  handle.addEventListener('mousedown',onStart,{passive:false}); handle.addEventListener('touchstart',onStart,{passive:false});
  document.addEventListener('mousemove',onMove); document.addEventListener('touchmove',onMove,{passive:true});
  document.addEventListener('mouseup',onEnd);    document.addEventListener('touchend',onEnd);
}

/* ================================================================
   21. AUTO-SCROLL
================================================================ */
function scrollToBottom() {
  const c = dom.msgsContainer;
  if (c.scrollHeight - c.scrollTop - c.clientHeight < 200)
    requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
}

/* ================================================================
   22. SUPABASE CONNECTION + REALTIME SUBSCRIPTIONS
================================================================ */

/** Update own presence data (call when camera/name changes) */
async function updateOwnPresence() {
  if (!state.presenceCh) return;
  await state.presenceCh.track({
    id:        state.currentUser.id,
    name:      state.currentUser.name,
    isGuest:   state.currentUser.isGuest,
    hasCamera: state.currentUser.hasCamera,
    online:    true,
  });
}

/** Sync state.users from Supabase Presence state */
function syncPresence(presenceState) {
  const onlineIds = new Set(Object.keys(presenceState));
  onlineIds.delete(state.currentUser.id);

  Object.entries(presenceState).forEach(([uid, presences]) => {
    if (uid === state.currentUser.id) return;
    const info = presences[0];
    ensureUser(uid, info.name, { isGuest: info.isGuest, online: true, hasCamera: info.hasCamera });
  });
  state.users.forEach(u => { u.online = onlineIds.has(u.id); });
  renderUsers();
}

/** Typing indicator via Broadcast */
function sendTypingEvent() {
  if (!state.signalCh) return;
  state.signalCh.send({ type:'broadcast', event:'typing',
    payload: { from: state.currentUser.id, name: state.currentUser.name, isTyping: true } });
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    state.signalCh?.send({ type:'broadcast', event:'typing',
      payload: { from: state.currentUser.id, name: state.currentUser.name, isTyping: false } });
  }, 2500);
}
function handleTyping(payload) {
  if (payload.from === state.currentUser?.id) return;
  if (payload.isTyping) {
    dom.typingTxt.textContent = `${payload.name} is typing…`;
    dom.typingRow.classList.add('visible');
  } else {
    dom.typingRow.classList.remove('visible');
  }
}

async function connectSupabase() {
  /* Check credentials are filled in */
  if (!SUPABASE_URL.includes('supabase.co') || SUPABASE_ANON_KEY.startsWith('YOUR_')) {
    console.warn('[NeverVideoChat] Supabase not configured. Running in local-only mode.');
    showToast('⚠️ Supabase not configured — local mode. Fill in SUPABASE_URL and SUPABASE_ANON_KEY in script.js');
    return;
  }

  try {
    /* Init Supabase client */
    state.supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    /* ── 1. Load last 60 public messages ── */
    const { data: msgs, error: msgErr } = await state.supa
      .from('messages').select('*')
      .order('created_at', { ascending: true }).limit(60);

    if (!msgErr && msgs?.length) {
      if (dom.welcomeBanner?.parentNode) dom.welcomeBanner.remove();
      msgs.forEach(m => {
        const isMine = m.user_id === state.currentUser.id;
        if (!isMine) ensureUser(m.user_id, m.username);
        renderMessage({ userId: isMine ? 'me' : m.user_id, username: m.username, html: m.content, ts: new Date(m.created_at).getTime() });
      });
    }

    /* ── 2. Subscribe to new public messages (Postgres Changes) ── */
    state.supa.channel('db-messages')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, ({ new: m }) => {
        if (m.user_id === state.currentUser.id) return; // already rendered optimistically
        ensureUser(m.user_id, m.username);
        renderMessage({ userId: m.user_id, username: m.username, html: m.content, ts: new Date(m.created_at).getTime() });
        playNotificationSound();
      })
      .subscribe();

    /* ── 3. Presence channel (online users + camera state) ── */
    state.presenceCh = state.supa.channel('presence:room-main', {
      config: { presence: { key: state.currentUser.id } },
    });
    state.presenceCh
      .on('presence', { event:'sync' }, () => syncPresence(state.presenceCh.presenceState()))
      .on('presence', { event:'join' }, ({ key, newPresences }) => {
        if (key !== state.currentUser.id) showToast(`👤 ${newPresences[0].name} joined the chat`);
      })
      .on('presence', { event:'leave' }, ({ leftPresences }) => {
        const u = state.users.find(u => u.id === leftPresences[0]?.id);
        if (u) { u.online = false; renderUsers(); showToast(`👋 ${u.name} left`); }
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') await updateOwnPresence();
      });

    /* ── 4. Signal channel (Broadcast — typing, PM, WebRTC, cam-req) ── */
    state.signalCh = state.supa.channel('broadcast:signals-main');
    state.signalCh
      .on('broadcast', { event:'typing'   }, ({ payload }) => handleTyping(payload))
      .on('broadcast', { event:'pm'       }, ({ payload }) => handleIncomingPM(payload))
      .on('broadcast', { event:'webrtc'   }, ({ payload }) => handleWebRTCSignal(payload))
      .on('broadcast', { event:'cam-req'  }, ({ payload }) => handleCamRequest(payload))
      .subscribe();

    showToast('🟢 Connected to NeverVideoChat');
    console.log('[NeverVideoChat] Supabase connected.');
  } catch (err) {
    console.error('[NeverVideoChat] Supabase connection error:', err);
    showToast('⚠️ Could not connect to server — check your credentials.');
  }
}

/* ================================================================
   23. INIT
================================================================ */
async function init() {
  /* Load/create user identity */
  state.currentUser = getOrCreateIdentity();

  renderUsers();
  initToolbar();
  initImageAttach();
  initEmojiPicker();
  initVoiceRecording();
  initContextMenu();
  initCameraSystem();
  initCallControls();
  initMobilePanel();

  /* Connect to Supabase (non-blocking) */
  connectSupabase().catch(err => console.error(err));

  dom.msgInput.focus();
}

document.addEventListener('DOMContentLoaded', init);

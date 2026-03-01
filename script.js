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
  cameraWindows:    {},
  micAnalysers:     {},   // { [userId]: { ctx, raf } }
  localStream:      null,
  /* Timestamp (ms) when the own camera was last stopped.
     Used to enforce a minimum hardware-release delay before getUserMedia
     is called again (prevents black-screen on Windows/macOS drivers). */
  cameraClosedAt:   0,

  /* WebRTC
     outgoingPCs: B shares their stream to requester A  → { [toUserId]: RTCPeerConnection }
     incomingPCs: A receives stream from B              → { [fromUserId]: RTCPeerConnection }
     privatePeer: peer for the private vcall-win
     streamOpenedForCall: true = stream was created for this call only (stop on endCall)
                          false = stream pre-existed (public cam was already on → keep it) */
  outgoingPCs:          {},
  incomingPCs:          {},
  privatePeer:          null,
  activeCallUID:        null,
  streamOpenedForCall:  false,

  /* Typing debounce */
  typingTimer: null,

  /* Pending camera / call requests sent BY this user
     { [targetUid]: 'public' | 'private' }
     Prevents spam: a second request to the same user is blocked
     until the first is accepted, rejected, or the target disconnects. */
  pendingCamRequests: {},

  /* Users who rejected OUR camera requests.
     { [uid]: displayName }
     Persisted to localStorage under 'nvc_rejected_cams'.            */
  rejectedCamUsers: {},

  /* Users we are ignoring — messages and PMs hidden, cam access revoked.
     { [uid]: displayName }
     Persisted to localStorage under 'nvc_ignored_users'.            */
  ignoredUsers: {},

  /* Current reply-to context for public chat quotes */
  replyTo: null,  /* { userId, name, html } | null */

  /* Users currently viewing my own cam stream { [uid]: name }       */
  camViewers: {},

  /* Presence leave debounce timers
     { [uid]: timeoutId }
     Supabase fires leave+join on every .track() update; we wait 600ms
     before treating a leave as a real disconnect.                     */
  presenceLeaveTimers: {},

  /* Context menu */
  contextTargetUID: null,

  /* Supabase Realtime channels */
  supa:            null,
  presenceCh:      null,
  signalCh:        null,

  /* Web Audio for notifications */
  audioCtx: null,

  /* Device settings (camera/mic deviceId, loaded from localStorage) */
  settings: {},
};

/* ================================================================
   3. DOM REFERENCES
================================================================ */
const $ = id => document.getElementById(id);

const dom = {
  logoFallback: $('logoFallback'),
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

  /* Header user chip */
  headerAvatarChip: $('headerAvatarChip'),
  headerProfileBtn: $('headerProfileBtn'), headerSettingsBtn: $('headerSettingsBtn'),

  /* Auth modal */
  authModal: $('authModal'),
  authTabLogin: $('authTabLogin'), authTabRegister: $('authTabRegister'),
  loginForm: $('loginForm'), loginNick: $('loginNick'), loginPwd: $('loginPwd'),
  loginError: $('loginError'), loginSubmitBtn: $('loginSubmitBtn'),
  registerForm: $('registerForm'), regNick: $('regNick'), regPwd: $('regPwd'),
  regPwdConfirm: $('regPwdConfirm'), registerError: $('registerError'),
  registerSubmitBtn: $('registerSubmitBtn'), guestContinueBtn: $('guestContinueBtn'),

  /* Profile modal */
  profileModal: $('profileModal'), profileModalClose: $('profileModalClose'),
  profileAvatarDisplay: $('profileAvatarDisplay'),
  profileAvatarChangeBtn: $('profileAvatarChangeBtn'),
  profileAvatarInput: $('profileAvatarInput'),
  profileNameInput: $('profileNameInput'),
  profileAccountInfo: $('profileAccountInfo'),
  profileSaveBtn: $('profileSaveBtn'), profileLogoutBtn: $('profileLogoutBtn'),
  profileSwitchToAuthBtn: $('profileSwitchToAuthBtn'),

  /* Settings modal */
  settingsModal: $('settingsModal'), settingsModalClose: $('settingsModalClose'),
  cameraDeviceSelect: $('cameraDeviceSelect'), micDeviceSelect: $('micDeviceSelect'),
  detectDevicesBtn: $('detectDevicesBtn'), detectDevicesHint: $('detectDevicesHint'),
  settingsSaveBtn: $('settingsSaveBtn'),

  /* Rejected cam list */
  rejectedCamsSection: $('rejectedCamsSection'),
  rejectedCamsList:    $('rejectedCamsList'),

  /* Ignored users list */
  ignoredUsersSection: $('ignoredUsersSection'),
  ignoredUsersList:    $('ignoredUsersList'),

  /* Context menu ignore */
  ctxIgnoreBtn:   $('ctxIgnoreBtn'),
  ctxIgnoreLabel: $('ctxIgnoreLabel'),

  /* Reply/quote preview bar */
  replyPreviewBar:    $('replyPreviewBar'),
  replyPreviewAuthor: $('replyPreviewAuthor'),
  replyPreviewText:   $('replyPreviewText'),
  replyPreviewCancel: $('replyPreviewCancel'),
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
  if (!u) { u = { id, name, isGuest: true, online: false, hasCamera: false, avatarUrl: null }; state.users.push(u); }
  if (name)                  u.name      = name;
  if ('username'  in extra)  u.username  = extra.username  || null;
  if ('isGuest'   in extra)  u.isGuest   = extra.isGuest;
  if ('online'    in extra)  u.online    = extra.online;
  if ('hasCamera' in extra)  u.hasCamera = extra.hasCamera;
  if ('avatarUrl' in extra)  u.avatarUrl = extra.avatarUrl;
  return u;
}
function supabaseReady() { return !!state.supa; }

/* ── Pending cam-request helpers (auto-expire after 60s) ─────────── */
const _pendingTimers = {};   // { [uid]: timeoutId }

function setPendingCamRequest(uid, type, name) {
  clearPendingCamRequest(uid);   // cancel any previous timer
  state.pendingCamRequests[uid] = type;
  /* Auto-expire: if no reply in 60s, clear the pending state */
  _pendingTimers[uid] = setTimeout(() => {
    if (state.pendingCamRequests[uid]) {
      delete state.pendingCamRequests[uid];
      delete _pendingTimers[uid];
      showToast(`⌛ No reply from ${name} — camera request expired.`);
    }
  }, 60_000);
}

function clearPendingCamRequest(uid) {
  delete state.pendingCamRequests[uid];
  if (_pendingTimers[uid]) { clearTimeout(_pendingTimers[uid]); delete _pendingTimers[uid]; }
}

/* ── Rejected-cam list helpers ────────────────────────────────────── */
function loadRejectedCams() {
  try { return JSON.parse(localStorage.getItem('nvc_rejected_cams') || '{}'); }
  catch { return {}; }
}
function saveRejectedCams() {
  localStorage.setItem('nvc_rejected_cams', JSON.stringify(state.rejectedCamUsers));
}
function addRejectedCam(uid, name) {
  state.rejectedCamUsers[String(uid)] = name || 'User';
  saveRejectedCams();
}
function removeRejectedCam(uid) {
  delete state.rejectedCamUsers[String(uid)];
  saveRejectedCams();
}

/* ── Ignored users helpers ──────────────────────────────────────── */
function loadIgnoredUsers() {
  try { return JSON.parse(localStorage.getItem('nvc_ignored_users') || '{}'); } catch { return {}; }
}
function saveIgnoredUsers() {
  localStorage.setItem('nvc_ignored_users', JSON.stringify(state.ignoredUsers));
}
function addIgnoredUser(uid, name) {
  state.ignoredUsers[String(uid)] = name || 'User';
  saveIgnoredUsers();

  /* Immediately revoke any cam access this user has to my stream */
  const uidStr = String(uid);
  if (state.outgoingPCs[uidStr]) {
    try { state.outgoingPCs[uidStr].close(); } catch {}
    delete state.outgoingPCs[uidStr];
    broadcast('cam-revoked', uidStr, {});
  }
  delete state.camViewers[uidStr];
  refreshViewersPanel(state.currentUser?.id);

  /* Close any remote cam window of theirs we have open */
  if (state.cameraWindows[uidStr]) closeCameraWindow(uidStr);
}
function removeIgnoredUser(uid) {
  delete state.ignoredUsers[String(uid)];
  saveIgnoredUsers();
}

/* ================================================================
   4b. AUTH — Register · Login · Logout · Session restore
   ─────────────────────────────────────────────────────────────────
   Uses Supabase Auth with a fake e-mail: {nick}@nvc.local
   ⚠ IMPORTANT: Disable e-mail confirmation in your Supabase project:
     Dashboard → Authentication → Providers → Email
     → "Confirm email": OFF  → Save
================================================================ */
const AUTH_EMAIL_DOMAIN = 'nvc.local';

function nickToEmail(nick) {
  /* Sanitise nickname to a valid email-local part */
  return `${nick.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}@${AUTH_EMAIL_DOMAIN}`;
}

async function registerUser(nick, password) {
  const email = nickToEmail(nick);
  const { data, error } = await state.supa.auth.signUp({ email, password });
  if (error) throw error;
  const userId = data.user.id;

  /* Create / upsert profile row */
  await state.supa.from('profiles').upsert({
    id:           userId,
    username:     nick,
    display_name: nick,
    is_guest:     false,
  }, { onConflict: 'id' });

  /* Persist session tokens manually (persistSession: false) */
  if (data.session) persistAuthSession(data.session);

  return { userId, nick, avatarUrl: null };
}

async function loginUser(nick, password) {
  const email = nickToEmail(nick);
  const { data, error } = await state.supa.auth.signInWithPassword({ email, password });
  if (error) throw error;

  if (data.session) persistAuthSession(data.session);

  /* Load profile */
  const { data: profile } = await state.supa
    .from('profiles').select('*').eq('id', data.user.id).single();

  const displayName = profile?.display_name || profile?.username || nick;
  return {
    userId:    data.user.id,
    nick:      displayName,
    username:  profile?.username || nick,
    avatarUrl: profile?.avatar_url || null,
  };
}

async function logoutUser() {
  clearAuthSession();
  localStorage.removeItem('nvc_identity');
  try { await state.supa?.auth.signOut(); } catch (_) {}
  location.reload();
}

function persistAuthSession(session) {
  localStorage.setItem('nvc_auth_session', JSON.stringify({
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
  }));
}
function clearAuthSession() {
  localStorage.removeItem('nvc_auth_session');
}

/** Try to restore a previous registered session. Returns user object or null.
 *  Strategy:
 *   1. Try to restore Supabase session from saved tokens (online).
 *   2. If that fails, try to use cached nvc_identity from localStorage (offline/expired).
 *   3. If nothing found, return null → guest will be created.
 */
async function tryRestoreSession() {
  if (!state.supa) return null;

  /* ── Try online session restore ── */
  const stored = JSON.parse(localStorage.getItem('nvc_auth_session') || 'null');
  if (stored?.access_token) {
    try {
      const { data, error } = await state.supa.auth.setSession({
        access_token:  stored.access_token,
        refresh_token: stored.refresh_token,
      });

      if (!error && data?.user) {
        /* Refresh tokens */
        if (data.session) persistAuthSession(data.session);

        /* Load fresh profile */
        const { data: profile } = await state.supa
          .from('profiles').select('*').eq('id', data.user.id).single();

        /* display_name takes priority; fall back to username; then cached identity */
        const cachedId = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
        const displayName = profile?.display_name
                         || profile?.username
                         || cachedId?.name
                         || `User_${data.user.id.slice(0, 6)}`;

        const user = {
          id:        data.user.id,
          name:      displayName,
          username:  profile?.username || displayName,
          avatarUrl: profile?.avatar_url || null,
          isGuest:   false,
          online:    true,
          hasCamera: false,
        };
        /* Cache identity locally so next restore works even offline */
        localStorage.setItem('nvc_identity', JSON.stringify(user));
        return user;
      }

      /* Token invalid/expired — clear tokens but keep identity cache */
      console.warn('[Auth] Token invalid, clearing tokens but keeping cached identity.');
      clearAuthSession();

    } catch (netErr) {
      console.warn('[Auth] Network error during session restore:', netErr);
      /* Fall through to cached identity */
    }
  }

  /* ── Fallback: use cached nvc_identity (offline / token expired) ── */
  try {
    const cached = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
    if (cached?.id && cached?.name && cached.isGuest === false) {
      console.info('[Auth] Using cached registered identity:', cached.name);
      showToast('⚠️ Session offline — using cached profile. Re-login for full access.');
      return { ...cached, online: true, hasCamera: false };
    }
  } catch (_) {}

  return null; /* no session → guest will be created */
}

/* ── Auth modal initialisation ──────────────────────────────── */
function initAuthModal() {
  /* Tab switching */
  dom.authTabLogin.addEventListener('click', () => switchAuthTab('login'));
  dom.authTabRegister.addEventListener('click', () => switchAuthTab('register'));

  /* Sign-in form */
  dom.loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const nick = dom.loginNick.value.trim();
    const pwd  = dom.loginPwd.value;
    if (!nick || !pwd) return;
    setAuthBtnLoading(dom.loginSubmitBtn, true, 'Signing in…');
    hideAuthError('loginError');
    try {
      const user = await loginUser(nick, pwd);
      applyAuthIdentity(user.userId, user.nick, user.username, user.avatarUrl, false);
      dom.authModal.hidden = true;
      finishInit();
    } catch (err) {
      const msg = err.message?.includes('Invalid') ? 'Incorrect nickname or password.' : (err.message || 'Sign-in failed.');
      showAuthError('loginError', msg);
    } finally { setAuthBtnLoading(dom.loginSubmitBtn, false, 'Sign In'); }
  });

  /* Register form */
  dom.registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const nick    = dom.regNick.value.trim();
    const pwd     = dom.regPwd.value;
    const confirm = dom.regPwdConfirm.value;
    hideAuthError('registerError');
    if (!nick || nick.length < 3) return showAuthError('registerError', 'Nickname must be at least 3 characters.');
    if (pwd.length < 6)           return showAuthError('registerError', 'Password must be at least 6 characters.');
    if (pwd !== confirm)          return showAuthError('registerError', 'Passwords do not match.');
    setAuthBtnLoading(dom.registerSubmitBtn, true, 'Creating…');
    try {
      const user = await registerUser(nick, pwd);
      applyAuthIdentity(user.userId, nick, nick, null, false);
      dom.authModal.hidden = true;
      finishInit();
    } catch (err) {
      let msg = err.message || 'Registration failed.';
      if (msg.includes('already registered') || msg.includes('already exists')) msg = 'This nickname is already taken.';
      showAuthError('registerError', msg);
    } finally { setAuthBtnLoading(dom.registerSubmitBtn, false, 'Create Account'); }
  });

  /* Guest button */
  dom.guestContinueBtn.addEventListener('click', () => {
    state.currentUser = getOrCreateGuestIdentity();
    dom.authModal.hidden = true;
    finishInit();
  });
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  dom.authTabLogin.classList.toggle('active', isLogin);
  dom.authTabRegister.classList.toggle('active', !isLogin);
  dom.loginForm.hidden    = !isLogin;
  dom.registerForm.hidden = isLogin;
  hideAuthError('loginError');
  hideAuthError('registerError');
}

function showAuthError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}
function hideAuthError(id) {
  const el = $(id); if (el) el.hidden = true;
}
function setAuthBtnLoading(btn, loading, loadingText) {
  btn.disabled = loading;
  if (loading) btn.dataset.origText = btn.textContent;
  btn.textContent = loading ? loadingText : (btn.dataset.origText || btn.textContent);
}

/** Build and store identity after successful auth */
function applyAuthIdentity(id, name, username, avatarUrl, isGuest) {
  state.currentUser = { id, name, username: username || null, avatarUrl: avatarUrl || null, isGuest, online: true, hasCamera: false };
  localStorage.setItem('nvc_identity', JSON.stringify(state.currentUser));
}

/* ================================================================
   4c. PROFILE — display name · avatar upload · save
================================================================ */

function initProfileModal() {
  dom.headerProfileBtn?.addEventListener('click', openProfileModal);
  dom.profileModalClose?.addEventListener('click', () => { dom.profileModal.hidden = true; });
  dom.profileAvatarChangeBtn?.addEventListener('click', () => dom.profileAvatarInput.click());
  dom.profileAvatarInput?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    /* Instant preview */
    const reader = new FileReader();
    reader.onload = ev => setAvatarDisplay(dom.profileAvatarDisplay, null, ev.target.result);
    reader.readAsDataURL(file);
    /* Upload */
    try {
      const url = await uploadAvatarFile(file);
      if (url) dom.profileAvatarInput.dataset.uploadedUrl = url;
    } catch (err) { showToast('⚠️ Avatar upload failed: ' + err.message); }
    e.target.value = '';
  });
  dom.profileSaveBtn?.addEventListener('click', async () => {
    const name = dom.profileNameInput.value.trim();
    if (!name) return showToast('⚠️ Display name cannot be empty.');
    const newUrl = dom.profileAvatarInput.dataset.uploadedUrl || state.currentUser.avatarUrl || null;
    dom.profileSaveBtn.disabled = true; dom.profileSaveBtn.textContent = 'Saving…';
    try {
      await saveProfile(name, newUrl);
      dom.profileModal.hidden = true;
      showToast('✅ Profile saved.');
    } catch (err) { showToast('⚠️ Could not save profile: ' + err.message); }
    finally { dom.profileSaveBtn.disabled = false; dom.profileSaveBtn.textContent = 'Save Changes'; }
  });
  dom.profileLogoutBtn?.addEventListener('click', async () => {
    if (!confirm('Log out?')) return;
    await logoutUser();
  });
  dom.profileSwitchToAuthBtn?.addEventListener('click', () => {
    dom.profileModal.hidden = true;
    switchAuthTab('login');
    dom.authModal.hidden = false;
  });
  /* Close on backdrop click */
  dom.profileModal?.addEventListener('click', e => { if (e.target === dom.profileModal) dom.profileModal.hidden = true; });
}

function openProfileModal() {
  const u = state.currentUser;
  if (!u) return;
  dom.profileNameInput.value = u.name || '';
  delete dom.profileAvatarInput.dataset.uploadedUrl;
  setAvatarDisplay(dom.profileAvatarDisplay, u.name, u.avatarUrl);
  dom.profileAccountInfo.textContent = u.isGuest
    ? 'Guest account — changes apply this session only.'
    : `Registered as @${u.username || u.name}`;
  dom.profileLogoutBtn.hidden        = u.isGuest;
  dom.profileSwitchToAuthBtn.hidden  = !u.isGuest;
  dom.profileModal.hidden = false;
}

async function uploadAvatarFile(file) {
  if (!state.supa) throw new Error('Not connected.');
  const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
  const path = `avatars/${state.currentUser.id}_${Date.now()}.${ext}`;
  const { error } = await state.supa.storage.from('chat-media').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = state.supa.storage.from('chat-media').getPublicUrl(path);
  return data.publicUrl;
}

async function saveProfile(displayName, avatarUrl) {
  state.currentUser.name = displayName;
  if (avatarUrl) state.currentUser.avatarUrl = avatarUrl;
  localStorage.setItem('nvc_identity', JSON.stringify(state.currentUser));

  if (!state.currentUser.isGuest && state.supa) {
    await state.supa.from('profiles').upsert({
      id:           state.currentUser.id,
      username:     state.currentUser.username || state.currentUser.name,
      display_name: displayName,
      avatar_url:   avatarUrl || null,
      is_guest:     false,
    }, { onConflict: 'id' });
  }

  updateHeaderUser();
  await updateOwnPresence();
  renderUsers();
}

/** Render avatar into a container div: photo if available, else coloured initials.
 *  NOTE: we use backgroundColor + backgroundImage as SEPARATE properties to avoid
 *  the `background` shorthand resetting backgroundImage in some browsers.          */
function setAvatarDisplay(el, name, avatarUrl) {
  if (!el) return;
  if (avatarUrl) {
    el.style.backgroundImage    = `url(${avatarUrl})`;
    el.style.backgroundSize     = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundColor    = 'transparent';
    el.textContent              = '';
    el.classList.add('has-photo');
  } else {
    el.style.backgroundImage    = 'none';
    el.style.backgroundColor    = name ? avatarColor(name) : 'var(--bg3)';
    el.textContent              = name ? initials(name) : '?';
    el.classList.remove('has-photo');
  }
}

/** Refresh the header chip (left column) */
function updateHeaderUser() {
  const u = state.currentUser;
  if (!u) return;
  /* Header profile button: avatar chip */
  setAvatarDisplay(dom.headerAvatarChip, u.username || u.name, u.avatarUrl);
}

/* ================================================================
   4d. SETTINGS — camera / mic device selection
================================================================ */

function initSettingsModal() {
  dom.headerSettingsBtn?.addEventListener('click', openSettingsModal);
  dom.settingsModalClose?.addEventListener('click', () => { dom.settingsModal.hidden = true; });
  dom.settingsModal?.addEventListener('click', e => { if (e.target === dom.settingsModal) dom.settingsModal.hidden = true; });

  dom.detectDevicesBtn?.addEventListener('click', async () => {
    dom.detectDevicesBtn.textContent = 'Detecting…';
    dom.detectDevicesBtn.disabled    = true;
    try {
      await populateDeviceSelects();
      dom.detectDevicesHint.textContent = '✅ Devices detected. Select and press Save.';
    } catch (err) {
      dom.detectDevicesHint.textContent = '⚠️ Could not detect devices: ' + err.message;
    } finally {
      dom.detectDevicesBtn.textContent = '🔍 Detect Devices';
      dom.detectDevicesBtn.disabled    = false;
    }
  });

  dom.settingsSaveBtn?.addEventListener('click', () => {
    const s = {
      cameraId: dom.cameraDeviceSelect.value || '',
      micId:    dom.micDeviceSelect.value    || '',
    };
    saveDeviceSettings(s);
    state.settings = s;
    dom.settingsModal.hidden = true;
    showToast('✅ Settings saved.');
  });
}

function openSettingsModal() {
  /* Load saved settings into selects */
  const s = loadDeviceSettings();
  dom.cameraDeviceSelect.value = s.cameraId || '';
  dom.micDeviceSelect.value    = s.micId    || '';
  dom.detectDevicesHint.textContent = 'Click "Detect Devices" to list your cameras and microphones.\nBrowser permission for camera/mic is required.';
  renderRejectedCams();
  renderIgnoredUsers();
  dom.settingsModal.hidden = false;
}

/** Render the pending cam requests list (waiting for reply) inside Settings modal */
/** Render the rejected-cam list inside Settings modal.
 *  The section is ALWAYS visible; shows an empty-state hint when the list is empty. */
function renderRejectedCams() {
  const list = dom.rejectedCamsList;
  if (!list) return;

  list.innerHTML = '';
  const entries = Object.entries(state.rejectedCamUsers);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className   = 'rejected-cams-empty';
    empty.textContent = 'No blocked users.';
    list.appendChild(empty);
    return;
  }

  entries.forEach(([uid, name]) => {
    const item = document.createElement('div');
    item.className = 'rejected-cam-item';

    const nameEl = document.createElement('span');
    nameEl.className   = 'rejected-cam-name';
    nameEl.textContent = name;

    const removeBtn = document.createElement('button');
    removeBtn.className   = 'rejected-cam-remove-btn';
    removeBtn.textContent = 'Unblock';
              removeBtn.title       = `Allow ${name} to send camera requests to you again`;
    removeBtn.addEventListener('click', () => {
      removeRejectedCam(uid);
      renderRejectedCams();
                showToast(`✅ ${name} unblocked — they can send you camera requests again.`);
    });

    item.append(nameEl, removeBtn);
    list.appendChild(item);
  });
}

/** Render ignored users list in Settings */
function renderIgnoredUsers() {
  const list = dom.ignoredUsersList;
  if (!list) return;
  list.innerHTML = '';
  const entries = Object.entries(state.ignoredUsers);
  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'rejected-cams-empty'; p.textContent = 'No ignored users.';
    list.appendChild(p); return;
  }
  entries.forEach(([uid, name]) => {
    const item = document.createElement('div');
    item.className = 'rejected-cam-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'rejected-cam-name'; nameEl.textContent = name;
    const btn = document.createElement('button');
    btn.className = 'rejected-cam-remove-btn'; btn.textContent = 'Unignore';
    btn.title = `Stop ignoring ${name}`;
    btn.addEventListener('click', () => {
      removeIgnoredUser(uid);
      renderIgnoredUsers();
      showToast(`✅ ${name} unignored.`);
    });
    item.append(nameEl, btn);
    list.appendChild(item);
  });
}

/* ── Quote / reply helpers ──────────────────────────────────────── */
function setReplyTo(userId, name, html) {
  state.replyTo = { userId, name, html };
  if (dom.replyPreviewBar)    dom.replyPreviewBar.hidden = false;
  if (dom.replyPreviewAuthor) dom.replyPreviewAuthor.textContent = name;
  if (dom.replyPreviewText) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    dom.replyPreviewText.textContent = tmp.textContent.slice(0, 80) + (tmp.textContent.length > 80 ? '…' : '');
  }
  dom.msgInput?.focus();
}
function clearReplyTo() {
  state.replyTo = null;
  if (dom.replyPreviewBar) dom.replyPreviewBar.hidden = true;
  if (dom.replyPreviewAuthor) dom.replyPreviewAuthor.textContent = '';
  if (dom.replyPreviewText)   dom.replyPreviewText.textContent   = '';
}

async function populateDeviceSelects() {
  /* Request permission first so device labels are revealed */
  const perm = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => null);
  if (perm) perm.getTracks().forEach(t => t.stop());

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');
  const mics    = devices.filter(d => d.kind === 'audioinput');

  /* Camera select */
  const savedCam = dom.cameraDeviceSelect.value;
  dom.cameraDeviceSelect.innerHTML = '<option value="">Default camera</option>';
  cameras.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value       = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1}`;
    if (d.deviceId === savedCam) opt.selected = true;
    dom.cameraDeviceSelect.appendChild(opt);
  });

  /* Mic select */
  const savedMic = dom.micDeviceSelect.value;
  dom.micDeviceSelect.innerHTML = '<option value="">Default microphone</option>';
  mics.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value       = d.deviceId;
    opt.textContent = d.label || `Microphone ${i + 1}`;
    if (d.deviceId === savedMic) opt.selected = true;
    dom.micDeviceSelect.appendChild(opt);
  });
}

function loadDeviceSettings() {
  try {
    const key = `nvc_settings_${state.currentUser?.id || 'guest'}`;
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch { return {}; }
}

function saveDeviceSettings(settings) {
  const key = `nvc_settings_${state.currentUser?.id || 'guest'}`;
  localStorage.setItem(key, JSON.stringify(settings));
}

/** Build getUserMedia constraints from saved settings */
function getMediaConstraints() {
  const s = state.settings || {};
  return {
    video: s.cameraId
      ? { deviceId: { exact: s.cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: s.micId
      ? { deviceId: { exact: s.micId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true },
  };
}

/* ================================================================
   5. USER IDENTITY
================================================================ */
/** Return existing guest identity or create a new one */
function getOrCreateGuestIdentity() {
  try {
    const stored = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
    if (stored?.id && stored?.name && stored?.isGuest !== false) return stored;
  } catch (_) {}
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `u${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id,
    name:      `Guest_${Math.floor(Math.random() * 90000) + 10000}`,
    isGuest:   true,
    online:    true,
    hasCamera: false,
    avatarUrl: null,
  };
  localStorage.setItem('nvc_identity', JSON.stringify(user));
  return user;
}
/** Kept for backward-compatibility (called by some older code paths) */
function getOrCreateIdentity() { return getOrCreateGuestIdentity(); }

/* ================================================================
   6. LOGO — inline SVG, nothing to load
================================================================ */

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
/** Extract embedded quote metadata from stored message content */
function extractQuote(content) {
  if (!content || !content.includes('msg-quote-meta')) return { html: content, quoteHtml: null, quoteName: null };
  try {
    const tmp = document.createElement('div');
    tmp.innerHTML = content;
    const meta = tmp.querySelector('.msg-quote-meta');
    if (!meta) return { html: content, quoteHtml: null, quoteName: null };
    const quoteName = meta.getAttribute('data-quote-name') || '';
    const quoteHtml = decodeURIComponent(meta.getAttribute('data-quote-html') || '');
    meta.remove();
    return { html: tmp.innerHTML, quoteHtml: quoteHtml || null, quoteName: quoteName || null };
  } catch { return { html: content, quoteHtml: null, quoteName: null }; }
}

function addMessage({ userId, html, ts = Date.now(), quoteHtml = null, quoteName = null }) {
  /* Don't show messages from ignored users */
  if (userId && userId !== 'me' && state.ignoredUsers[String(userId)]) return;
  const msg = { id: `m${Date.now()}${Math.random()}`, userId, html, ts, quoteHtml, quoteName };
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
  avatar.className = 'msg-avatar';
  avatar.title = user.name;
  if (user.avatarUrl) {
    avatar.classList.add('has-photo');
    avatar.style.backgroundImage    = `url(${user.avatarUrl})`;
    avatar.style.backgroundSize     = 'cover';
    avatar.style.backgroundPosition = 'center';
  } else {
    avatar.style.background = color;
    avatar.textContent = init;
  }
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

  /* If msg includes a quote block, render it first */
  if (msg.quoteHtml) {
    const qBlock = document.createElement('div');
    qBlock.className = 'msg-quote';
    const qAuthor = document.createElement('span');
    qAuthor.className = 'msg-quote-author';
    qAuthor.textContent = msg.quoteName || '';
    const qText = document.createElement('span');
    qText.className = 'msg-quote-text';
    const tmp = document.createElement('div'); tmp.innerHTML = msg.quoteHtml;
    qText.textContent = tmp.textContent.slice(0, 120) + (tmp.textContent.length > 120 ? '…' : '');
    qBlock.append(qAuthor, qText);
    bubble.appendChild(qBlock);
  }

  const textDiv = document.createElement('div');
  textDiv.innerHTML = processHtml(msg.html);
  bubble.appendChild(textDiv);

  /* Reply button */
  const replyBtn = document.createElement('button');
  replyBtn.className = 'msg-reply-btn';
  replyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg> Reply`;
  const authorName = isMine ? 'You' : user.name;
  replyBtn.addEventListener('click', () => setReplyTo(msg.userId, authorName, msg.html));

  content.append(meta, bubble, replyBtn);
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

  /* Build quote prefix if replying */
  const quote     = state.replyTo;
  const quoteHtml = quote?.html  || null;
  const quoteName = quote?.name  || null;
  clearReplyTo();

  /* Optimistic: show immediately */
  addMessage({ userId: 'me', html, ts: Date.now(), quoteHtml, quoteName });
  dom.msgInput.innerHTML = '';

  /* Persist to Supabase — encode quote in content as a special prefix */
  const fullContent = quoteHtml
    ? `<div data-quote-name="${escHtml(quoteName||'')}" data-quote-html="${encodeURIComponent(quoteHtml)}" class="msg-quote-meta"></div>${html}`
    : html;

  if (supabaseReady()) {
    state.supa.from('messages').insert({
      user_id:  state.currentUser.id,
      username: state.currentUser.name,
      content:  fullContent,
    }).then(({ error }) => { if (error) console.warn('msg insert:', error); });
  }
}

/* ================================================================
   10. USERS PANEL
================================================================ */
function renderUsers() {
  dom.usersList.innerHTML = '';
  /* Show ONLY users with online === true (strict — rules out undefined/false) */
  const all = [state.currentUser, ...state.users.filter(u => u?.online === true)];
  const online = all.length;
  dom.onlineCountLabel.textContent = online;
  dom.onlineBadge.textContent = online;

  all.forEach(user => {
    if (!user) return;
    const li = document.createElement('div');
    li.className = 'user-item'; li.setAttribute('role','listitem'); li.dataset.userId = user.id;

    /* Prefer display name (username) over raw nick (name) */
    const displayName = user.username || user.name;

    const av = document.createElement('div');
    av.className = 'user-item-avatar';
    if (user.avatarUrl) {
      av.classList.add('has-photo');
      av.style.backgroundImage    = `url(${user.avatarUrl})`;
      av.style.backgroundSize     = 'cover';
      av.style.backgroundPosition = 'center';
      av.style.backgroundColor    = 'transparent';
    } else {
      av.style.backgroundColor = avatarColor(displayName);
      av.textContent = initials(displayName);
    }
    const dot = document.createElement('span');
    dot.className = `status-dot${user.online ? '' : ' offline'}`;
    av.appendChild(dot);

    const info = document.createElement('div'); info.className = 'user-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = `user-item-name${user.online ? '' : ' offline'}`;
    nameEl.textContent = displayName;
    const sub = document.createElement('div');
    sub.className = 'user-item-sub'; sub.textContent = user.online ? 'Online' : 'Offline';
    info.append(nameEl, sub);
    li.append(av, info);

    if (user.hasCamera && user.online) {
      const ci = document.createElement('span');
      ci.className = 'user-cam-icon'; ci.textContent = '📹'; ci.title = 'Camera on';
      li.appendChild(ci);
    }
    /* Registered badge (✓) — shown for non-guest users */
    if (!user.isGuest) {
      const rb = document.createElement('span');
      rb.className = 'registered-tag'; rb.textContent = '✓'; rb.title = 'Registered user';
      li.appendChild(rb);
    } else {
      const gt = document.createElement('span'); gt.className = 'guest-tag'; gt.textContent = 'Guest'; li.appendChild(gt);
    }
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
/* Maps MediaRecorder mimeType → file extension for Supabase Storage */
function mimeToExt(mimeType) {
  const base = (mimeType || '').split(';')[0].toLowerCase().trim();
  return { 'audio/webm':'webm', 'audio/ogg':'ogg', 'audio/mp4':'mp4',
           'audio/x-m4a':'m4a', 'audio/aac':'aac', 'audio/mpeg':'mp3' }[base] || 'webm';
}

function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    showToast('⚠️ Voice recording is not supported in this browser.'); return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      state.recordingChunks = []; state.recordingSeconds = 0;

      /* FIX: include audio/mp4 for iOS Safari which doesn't support webm */
      const mime = ['audio/webm;codecs=opus','audio/webm','audio/ogg','audio/mp4']
                     .find(t => MediaRecorder.isTypeSupported(t)) || '';
      state.mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      state.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) state.recordingChunks.push(e.data); };

      state.mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());

        const actualMime = state.mediaRecorder.mimeType || 'audio/webm';
        const ext        = mimeToExt(actualMime);  /* FIX: correct extension per browser */
        const blob       = new Blob(state.recordingChunks, { type: actualMime });

        /* FIX: never fall back to a blob: URL — blob: URLs are
           browser-local and useless for other users.
           If Storage upload fails, abort and tell the user.         */
        if (!supabaseReady()) {
          showToast('⚠️ Not connected — voice messages require Supabase Storage.');
          dom.voiceRecStrip.hidden = true; clearInterval(state.recordingTimer);
          dom.recTimer.textContent = '0:00'; return;
        }

        showToast('⏳ Uploading voice message…');
        const url = await uploadToStorage(blob, 'voices', ext);

        if (!url) {
          /* Upload failed — a blob: URL would break for all other users */
          showToast('⚠️ Voice upload failed. Check that the Supabase Storage ' +
                    '"chat-media" bucket exists and allows public access.');
          dom.voiceRecStrip.hidden = true; clearInterval(state.recordingTimer);
          dom.recTimer.textContent = '0:00'; return;
        }

        /* URL is a permanent public Supabase Storage URL — safe to store in DB */
        const html = `<div class="voice-msg-wrap">🎙️ Voice message` +
                     `<audio controls src="${url}" preload="metadata"></audio></div>`;
        addMessage({ userId: 'me', html, ts: Date.now() });

        state.supa.from('messages').insert({
          user_id:  state.currentUser.id,
          username: state.currentUser.name,
          content:  html,
        }).then(({ error }) => { if (error) console.warn('voice msg DB insert:', error); });

        dom.voiceRecStrip.hidden = true; clearInterval(state.recordingTimer);
        dom.recTimer.textContent = '0:00';
      };

      state.mediaRecorder.start(250); dom.voiceRecStrip.hidden = false;
      state.recordingTimer = setInterval(() => {
        state.recordingSeconds++;
        const m = Math.floor(state.recordingSeconds/60),
              s = String(state.recordingSeconds%60).padStart(2,'0');
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
        <button class="pchat-ctrl-btn pchat-vcall-btn" title="Video Call" aria-label="Start video call">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
        </button>
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
  popup.querySelector('.pchat-vcall-btn').addEventListener('click', () => {
    if (!supabaseReady()) { showToast('⚠️ Server connection required for video calls.'); return; }
    if (!dom.vcallWin.hidden) { showToast('📹 A video call is already active.'); return; }
    if (state.rejectedCamUsers[String(uid)]) {
      showToast(`🚫 ${user.name} rejected your request. Unblock them in Settings → "Blocked Requests".`); return;
    }
    if (state.pendingCamRequests[String(uid)]) {
      showToast(`⏳ Already waiting for ${user.name}'s reply.`); return;
    }
    setPendingCamRequest(String(uid), 'private', user.name);
    broadcast('cam-req', uid, { reqType: 'private' });
    showToast(`📹 Video call request sent to ${user.name}…`);
  });
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
  chat.popup.style.display = '';
  chat.minimised = false;

  /* Re-renderizza tutti i messaggi per mostrare quelli arrivati mentre era minimizzata */
  const msgCont = chat.popup.querySelector(`#pchat-msgs-${uid}`);
  if (msgCont) {
    msgCont.innerHTML = '';
    chat.msgs.forEach(m => renderPMsg(uid, m));
  }

  chat.unread = 0;
  updateMinBadge(uid);
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
  if (String(payload.to) !== String(state.currentUser?.id)) return;
  const fromId   = String(payload.from);
  const fromName = payload.fromName || 'User';

  /* Silently drop messages from ignored users */
  if (state.ignoredUsers[fromId]) return;

  ensureUser(fromId, fromName, { online: true });

  const chat = initOrGetPChat(fromId);
  const msg  = { from: fromId, text: payload.text, ts: payload.ts || Date.now() };
  chat.msgs.push(msg);
  playNotificationSound();

  if (!chat.popup) {
    /* Prima volta che questo utente scrive → apri la finestra (auto-open solo al primo msg) */
    openPrivateChat(fromId);
  } else if (chat.minimised) {
    /* Finestra minimizzata → NON aprire, aggiorna solo il badge */
    chat.unread++;
    updateMinBadge(fromId);
    showToast(`💬 ${fromName}: ${payload.text.slice(0, 60)}`);
  } else {
    /* Finestra già aperta e visibile → aggiungi il messaggio */
    renderPMsg(fromId, msg);
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
  const alreadyView  = !!state.cameraWindows[String(uid)];
  const pendingReq   = !!state.pendingCamRequests[String(uid)];
  const isOffline    = user.online !== true;
  /* Only block on states we actually know about — the receiver manages their own block list */
  const camBlocked   = alreadyView || pendingReq || isOffline;
  dom.ctxCamBtn.disabled      = camBlocked;
  dom.ctxCamBtn.style.opacity = camBlocked ? '0.35' : '1';

  const reason = alreadyView ? 'Already viewing their camera'
               : pendingReq  ? 'Request already sent — waiting for reply'
               : isOffline   ? 'User is offline'
               : '';
  dom.ctxCamBtn.title = reason || (user.hasCamera ? 'Request Camera' : 'Request Camera (cam may not be active)');

  /* Ignore button label + style */
  const isIgnored = !!state.ignoredUsers[String(uid)];
  if (dom.ctxIgnoreBtn) {
    dom.ctxIgnoreBtn.classList.toggle('is-ignored', isIgnored);
    if (dom.ctxIgnoreLabel) dom.ctxIgnoreLabel.textContent = isIgnored ? 'Unignore User' : 'Ignore User';
    dom.ctxIgnoreBtn.title = isIgnored ? 'Stop ignoring this user' : 'Hide messages and revoke cam access';
  }

  const r = anchor.getBoundingClientRect();
  dom.ctxMenu.style.top  = `${clamp(r.bottom+4,4,window.innerHeight-200)}px`;
  dom.ctxMenu.style.left = `${clamp(r.left,4,window.innerWidth-210)}px`;
  dom.ctxMenu.hidden = false; dom.ctxOverlay.hidden = false;
}
function closeCtxMenu() { dom.ctxMenu.hidden=true; dom.ctxOverlay.hidden=true; state.contextTargetUID=null; }
function initContextMenu() {
  dom.ctxPrivateBtn.addEventListener('click', () => { const u=state.contextTargetUID; closeCtxMenu(); if(u) openPrivateChat(u); });
  dom.ctxCamBtn.addEventListener('click',    () => { const u=state.contextTargetUID; closeCtxMenu(); if(u) requestPublicCamera(u); });
  dom.ctxIgnoreBtn?.addEventListener('click', () => {
    const u = state.contextTargetUID;
    const user = findUser(u);
    closeCtxMenu();
    if (!u || !user) return;
    const name = user.username || user.name;
    if (state.ignoredUsers[String(u)]) {
      removeIgnoredUser(u);
      showToast(`✅ ${name} unignored.`);
    } else {
      addIgnoredUser(u, name);
      showToast(`🔇 ${name} ignored — their messages are now hidden.`);
    }
  });
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
  const viewersBtnHtml = isOwn ? `<button class="cam-viewers-btn" id="cam-viewers-btn-${uid}" title="Who is watching">👁 <span id="cam-viewers-count-${uid}">0</span></button>
    <div class="cam-viewers-panel" id="cam-viewers-panel-${uid}" hidden></div>` : '';

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
      ${viewersBtnHtml}
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
  if (videoEl) {
    /* BLACK-SCREEN FIX: reset srcObject first to force the video
       element to fully re-initialize with the new stream.
       Skipping this can cause black frames when re-opening camera.  */
    videoEl.srcObject = null;
    videoEl.srcObject = stream;
    /* Explicit play() so browsers that gate autoplay-audio start
       playback reliably (especially mobile).                        */
    videoEl.play().catch(() => {});
  }
  win.querySelector('.cam-win-close-btn').addEventListener('click', () => closeCameraWindow(uid));
  if (isOwn) {
    const mb = $(`cam-mic-btn-${uid}`);
    if (mb) mb.addEventListener('click', () => toggleCamMic(uid));
    startMicMeter(stream, uid);

    /* Viewers button toggle */
    const vBtn = $(`cam-viewers-btn-${uid}`);
    const vPanel = $(`cam-viewers-panel-${uid}`);
    if (vBtn && vPanel) {
      vBtn.addEventListener('click', e => {
        e.stopPropagation();
        vPanel.hidden = !vPanel.hidden;
        if (!vPanel.hidden) refreshViewersPanel(uid);
      });
      document.addEventListener('click', () => { if (vPanel) vPanel.hidden = true; });
    }
  }
  makeDraggable(win, $(`cam-win-hdr-${uid}`));
  makeResizable(win, $(`cam-rz-${uid}`));
}

function refreshViewersPanel(ownUid) {
  const panel = $(`cam-viewers-panel-${ownUid}`);
  const countEl = $(`cam-viewers-count-${ownUid}`);
  const entries = Object.entries(state.camViewers);
  if (countEl) countEl.textContent = String(entries.length);
  if (!panel) return;
  panel.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'cam-viewers-title'; title.textContent = 'Viewers';
  panel.appendChild(title);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cam-viewers-empty'; empty.textContent = 'No one watching yet.';
    panel.appendChild(empty); return;
  }
  entries.forEach(([vUid, vName]) => {
    const row = document.createElement('div');
    row.className = 'cam-viewer-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'cam-viewer-name'; nameEl.textContent = vName;
    const kickBtn = document.createElement('button');
    kickBtn.className = 'cam-viewer-kick'; kickBtn.textContent = '✕';
    kickBtn.title = `Stop sharing with ${vName}`;
    kickBtn.addEventListener('click', e => {
      e.stopPropagation();
      revokeViewer(vUid);
      refreshViewersPanel(ownUid);
      showToast(`🚫 Stopped sharing cam with ${vName}.`);
    });
    row.append(nameEl, kickBtn);
    panel.appendChild(row);
  });
}

function revokeViewer(viewerUid) {
  const uid = String(viewerUid);
  if (state.outgoingPCs[uid]) {
    try { state.outgoingPCs[uid].close(); } catch {}
    delete state.outgoingPCs[uid];
  }
  delete state.camViewers[uid];
  broadcast('cam-revoked', uid, {});
}

function closeCameraWindow(uid) {
  const cw = state.cameraWindows[uid]; if (!cw) return;
  stopMicMeter(uid); cw.el.remove(); delete state.cameraWindows[uid];

  const isOwn = uid === state.currentUser?.id || uid === 'me';

  if (isOwn) {
    /* ── Own camera ───────────────────────────────────────────────
       Stop local tracks and close ALL outgoing PCs (we stop sending
       to every viewer).  Keep incomingPCs open — we can still watch
       other people's cameras even after turning ours off.           */
    state.localStream?.getTracks().forEach(t => t.stop());
    state.localStream = null;
    /* Record when we stopped so startOwnCamera can enforce a minimum
       hardware-release delay to avoid black-screen on re-open.       */
    state.cameraClosedAt = Date.now();

    Object.keys(state.outgoingPCs).forEach(peerId => {
      state.outgoingPCs[peerId]?.close();
      delete state.outgoingPCs[peerId];
    });
    /* incomingPCs intentionally left open */

    state.currentUser.hasCamera = false;
    dom.cameraBtnLabel.textContent = 'Camera Off';
    dom.cameraBtnHeader.classList.remove('camera-on');
    broadcastAll('cam-closed', {});
    updateOwnPresence(); renderUsers(); showToast('📹 Camera disabled.');
  } else {
    /* ── Remote camera ────────────────────────────────────────────
       The LOCAL user closed their viewer window (pressed ✕).
       Close only the INCOMING PC (we were receiving from them).
       Never touch outgoingPCs[uid]: we might still be sending our
       own stream to them — closing it would freeze THEIR view of us.

       ICON-FIX: do NOT set u.hasCamera = false here!
       The remote user's camera may still be running — we just chose
       to close our viewing window.  hasCamera is only cleared by:
         • handleCamClosed  (user truly turned off their camera)
         • presence-leave   (user disconnected)                      */
    if (state.incomingPCs[uid]) {
      state.incomingPCs[uid].close();
      delete state.incomingPCs[uid];
    }
    /* No renderUsers() needed — hasCamera state is unchanged.      */
  }
}
/** Someone else turned off their camera — destroy our window for them */
function handleCamClosed(payload) {
  if (payload.from === state.currentUser?.id) return; // ignore own echo
  const uid = payload.from;
  const cw = state.cameraWindows[uid];
  if (cw) { stopMicMeter(uid); cw.el.remove(); delete state.cameraWindows[uid]; }

  /* Close ONLY the incoming PC (we were receiving their stream).
     NEVER close outgoingPCs[uid]: that is the connection we use to
     send OUR stream to them — closing it would freeze their view of us. */
  if (state.incomingPCs[uid]) { state.incomingPCs[uid].close(); delete state.incomingPCs[uid]; }

  const u = state.users.find(u => u.id === uid);
  if (u) { u.hasCamera = false; renderUsers(); }
  showToast(`📹 ${payload.fromName} turned off their camera`);
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
    /* BLACK-SCREEN FIX: Camera hardware (especially on Windows) needs
       ~300-500ms after track.stop() before it can be re-acquired.
       If we closed the camera recently, wait for the driver to release. */
    const msSinceClosed = Date.now() - state.cameraClosedAt;
    const MIN_RELEASE_MS = 450;
    if (msSinceClosed < MIN_RELEASE_MS) {
      await new Promise(r => setTimeout(r, MIN_RELEASE_MS - msSinceClosed));
    }

    state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
    state.currentUser.hasCamera = true;
    dom.cameraBtnLabel.textContent = 'Camera On';
    dom.cameraBtnHeader.classList.add('camera-on');
    createCameraWindow(state.currentUser.id, state.localStream, 'You', true);

    /* INSTANT-ICON FIX: use fast Broadcast so other clients update
       their user-list camera icon immediately (Presence is too slow). */
    broadcastAll('cam-opened', {});
    updateOwnPresence();
    renderUsers();
    showToast('📹 Camera enabled.');
  } catch (err) {
    state.localStream = null;
    showToast(err.name === 'NotAllowedError' ? '🚫 Camera/mic access denied.' : `⚠️ Camera error: ${err.message}`);
  }
}

/* ── Mic level meter (per-window, Web Audio AnalyserNode) ────────── */
function startMicMeter(stream, uid) {
  stopMicMeter(uid);
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return;
  try {
    /* BUG-2 FIX: Create a SEPARATE MediaStream for analysis that wraps
       only the audio track.  This prevents the AudioContext from
       "owning" the microphone stream and interfering with WebRTC audio
       on iOS Safari / some Chrome versions.                           */
    const analysisStream = new MediaStream([audioTrack]);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    /* Resume immediately — browsers start AudioContext in suspended
       state until user interaction; resume avoids a silent analyser  */
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(analysisStream);
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
  if (!state.signalCh) { console.warn('Signal channel not ready'); return; }
  state.signalCh.send({
    type: 'broadcast', event,
    /* Store IDs as strings for consistent comparison on both sides */
    payload: { from: String(state.currentUser.id), fromName: state.currentUser.name, to: String(toUid), ...extra },
  });
}
/** Broadcast to ALL connected users (no .to filter used by receivers) */
function broadcastAll(event, extra = {}) {
  if (!state.signalCh) return;
  state.signalCh.send({
    type: 'broadcast', event,
    payload: { from: state.currentUser.id, fromName: state.currentUser.name, ...extra },
  });
}

/* ── Public camera request ─────────────────────────────────────── */
function requestPublicCamera(targetUid) {
  const uid = String(targetUid);
  const target = findUser(uid);
  if (!target?.online) { showToast(`${target?.name || 'User'} is offline.`); return; }
  if (!supabaseReady()) { showToast('⚠️ Server connection required for camera requests.'); return; }
  /* Already viewing their camera */
  if (state.cameraWindows[uid]) {
    showToast(`📹 Already viewing ${target.name}'s camera.`); return;
  }
  /* Request already sent and pending */
  if (state.pendingCamRequests[uid]) {
    showToast(`⏳ Already waiting for ${target.name}'s reply. (60s auto-expire)`); return;
  }
  setPendingCamRequest(uid, 'public', target.name);
  broadcast('cam-req', uid, { reqType: 'public' });
  showToast(`📹 Camera request sent to ${target.name}…`);
}

/** Handles both public camera requests and private video call requests */
function handleCamRequest(payload) {
  if (payload.to !== state.currentUser?.id) return;

  const fromId   = String(payload.from);
  const fromName = payload.fromName || 'User';

  /* ── Auto-reject if this sender was previously blocked by me ── */
  if (state.rejectedCamUsers[fromId]) {
    broadcast('cam-rejected', fromId, { reqType: payload.reqType || 'public' });
    return; /* silent — don't show dialog, don't show toast */
  }

  if (payload.reqType === 'public') {
    dom.camReqBody.textContent = `${fromName} wants to see your camera.`;
    dom.camReqOverlay.hidden = false;
    dom.camAcceptBtn.onclick = async () => {
      dom.camReqOverlay.hidden = true;
      await sharePublicCameraTo(fromId, fromName);
    };
    dom.camRejectBtn.onclick = () => {
      dom.camReqOverlay.hidden = true;
      addRejectedCam(fromId, fromName);           /* ← save to MY blocked list */
      broadcast('cam-rejected', fromId, {});
      showToast(`❌ Request from ${fromName} declined and blocked. Manage in Settings.`);
    };
  } else if (payload.reqType === 'private') {
    dom.camReqBody.textContent = `${fromName} wants to start a private video call.`;
    dom.camReqOverlay.hidden = false;
    dom.camAcceptBtn.onclick = async () => {
      dom.camReqOverlay.hidden = true;
      await acceptPrivateCall(fromId, fromName);
    };
    dom.camRejectBtn.onclick = () => {
      dom.camReqOverlay.hidden = true;
      addRejectedCam(fromId, fromName);           /* ← save to MY blocked list */
      broadcast('cam-rejected', fromId, { reqType: 'private' });
      showToast(`❌ Video call from ${fromName} declined and blocked. Manage in Settings.`);
    };
  }
}

/**
 * B accepted a private video call from A.
 * B: get local stream, show vcall window, tell A we accepted (A will send the offer).
 */
async function acceptPrivateCall(fromUid, fromName) {
  try {
    if (!state.localStream) {
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.streamOpenedForCall = true;
    } else {
      state.streamOpenedForCall = false;
    }
    const user = findUser(fromUid) || { name: fromName, isGuest: true };
    dom.localVideoEl.srcObject  = state.localStream;
    dom.vcallName.textContent   = user.name;
    dom.vcallStatus.textContent = 'Connecting…';
    dom.vcallAvatar.textContent = initials(user.name);
    dom.vcallAvatar.style.background = avatarColor(user.name);
    dom.remotePlaceholder.style.display = '';
    dom.vcallWin.hidden = false;
    state.activeCallUID = fromUid;
    /* Signal acceptance — A will react by creating and sending the WebRTC offer */
    broadcast('cam-accepted', fromUid, { reqType: 'private' });
  } catch (err) {
    showToast('⚠️ Could not access camera/mic: ' + err.message);
  }
}

/**
 * A receives cam-accepted:
 *   - for public: the offer is already on its way (sent by sharePublicCameraTo)
 *   - for private: A must now initiate WebRTC as the offerer
 */
function handleCamAccepted(payload) {
  if (payload.to !== state.currentUser?.id) return;
  /* Clear pending request — accepted */
  clearPendingCamRequest(String(payload.from));
  if (payload.reqType === 'private') {
    /* We are A (the caller) — B accepted → open our side of vcall and send WebRTC offer */
    startPrivateCall(payload.from);
  }
  /* public: offer was already sent inside sharePublicCameraTo — nothing to do here */
}

/** B shares their camera stream to A via WebRTC */
async function sharePublicCameraTo(toUid) {
  try {
    if (!state.localStream) {
      const msSinceClosed = Date.now() - state.cameraClosedAt;
      if (msSinceClosed < 450) await new Promise(r => setTimeout(r, 450 - msSinceClosed));
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.currentUser.hasCamera = true;
      dom.cameraBtnLabel.textContent = 'Camera On'; dom.cameraBtnHeader.classList.add('camera-on');
      createCameraWindow(state.currentUser.id, state.localStream, 'You', true);
      broadcastAll('cam-opened', {}); /* instant icon update on all clients */
      updateOwnPresence();
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    state.outgoingPCs[toUid] = pc;
    /* BUG-2 FIX: only add tracks whose readyState is 'live' to avoid
       sending ended/stopped tracks to the remote peer               */
    state.localStream.getTracks()
      .filter(t => t.readyState === 'live')
      .forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) broadcast('webrtc', toUid, { sigType:'ice', candidate, ctx:'public' });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    broadcast('webrtc', toUid, { sigType:'offer', sdp: offer.sdp, ctx:'public' });
    broadcast('cam-accepted', toUid, {});

    /* Track this viewer */
    const viewerUser = findUser(toUid);
    state.camViewers[toUid] = viewerUser?.username || viewerUser?.name || toUid;
    refreshViewersPanel(state.currentUser.id);

    /* Remove viewer when connection drops */
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        delete state.camViewers[toUid];
        refreshViewersPanel(state.currentUser?.id);
      }
    });
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
      /* B receives offer from A → set up peer, show vcall window, send answer */
      const pc = new RTCPeerConnection(ICE_SERVERS);
      state.privatePeer = pc;
      state.activeCallUID = from;
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) broadcast('webrtc', from, { sigType: 'ice', candidate, ctx: 'private' });
      };
      pc.ontrack = ({ streams }) => {
        dom.remoteVideoEl.srcObject     = streams[0];
        dom.remoteVideoEl.play().catch(() => {}); /* BUG-2: explicit play */
        dom.remotePlaceholder.style.display = 'none';
        dom.vcallStatus.textContent     = 'Connected';
      };
      /* Add local stream tracks so A can see B too */
      if (state.localStream) {
        state.localStream.getTracks()
          .filter(t => t.readyState === 'live')
          .forEach(t => pc.addTrack(t, state.localStream));
      }
      /* Show vcall window for B (already opened in acceptPrivateCall, but ensure it's visible) */
      const caller = findUser(from);
      dom.localVideoEl.srcObject  = state.localStream;
      dom.vcallName.textContent   = caller?.name || from;
      dom.vcallStatus.textContent = 'Connecting…';
      dom.vcallAvatar.textContent = initials(caller?.name || '?');
      dom.vcallAvatar.style.background = avatarColor(caller?.name || '?');
      dom.vcallWin.hidden = false;
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcast('webrtc', from, { sigType: 'answer', sdp: answer.sdp, ctx: 'private' });
    }
    else if (sigType === 'answer') {
      if (state.privatePeer) {
        await state.privatePeer.setRemoteDescription({ type: 'answer', sdp });
        dom.vcallStatus.textContent = 'Connected';
      }
    }
    else if (sigType === 'ice') {
      if (state.privatePeer && candidate) await state.privatePeer.addIceCandidate(candidate).catch(console.warn);
    }
  }
}

function openRemoteCamWindow(uid, stream) {
  const user = findUser(uid);
  /* Clear any pending request now that the stream is actually arriving */
  clearPendingCamRequest(String(uid));
  createCameraWindow(uid, stream, user?.name || uid, false);
}

/* ── Private video call — A creates offer after B accepts ─────── */
async function startPrivateCall(targetUid) {
  const target = findUser(targetUid);
  try {
    if (!state.localStream) {
      state.localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      state.streamOpenedForCall = true;   // opened just for this call → stop on endCall
    } else {
      state.streamOpenedForCall = false;  // pre-existing public cam → keep it after call
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    state.privatePeer = pc; state.activeCallUID = targetUid;
    state.localStream.getTracks()
      .filter(t => t.readyState === 'live')
      .forEach(t => pc.addTrack(t, state.localStream));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) broadcast('webrtc', targetUid, { sigType: 'ice', candidate, ctx: 'private' });
    };
    pc.ontrack = ({ streams }) => {
      dom.remoteVideoEl.srcObject = streams[0];
      dom.remoteVideoEl.play().catch(() => {});   /* BUG-2: explicit play */
      dom.remotePlaceholder.style.display = 'none';
      dom.vcallStatus.textContent = 'Connected';
    };
    /* Show our side of the call window */
    dom.localVideoEl.srcObject  = state.localStream;
    dom.vcallName.textContent   = target?.name || targetUid;
    dom.vcallStatus.textContent = 'Calling…';
    dom.vcallAvatar.textContent = initials(target?.name || '?');
    dom.vcallAvatar.style.background = avatarColor(target?.name || '?');
    dom.remotePlaceholder.style.display = '';
    dom.vcallWin.hidden = false;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    broadcast('webrtc', targetUid, { sigType: 'offer', sdp: offer.sdp, ctx: 'private' });
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
}
/**
 * End the private video call.
 * @param {boolean} notify - true = send "call-ended" broadcast to the other party
 *                           false = call came from the other party's signal (no loop)
 */
function endCall(notify = true) {
  /* Notify the other party so their window closes too */
  if (notify && state.activeCallUID) {
    broadcast('call-ended', state.activeCallUID, {});
  }

  /* Close the WebRTC peer */
  state.privatePeer?.close();
  state.privatePeer = null;

  /* Hide the vcall window and clear its video elements */
  dom.vcallWin.hidden = true;
  dom.remoteVideoEl.srcObject = null;
  dom.localVideoEl.srcObject  = null;
  dom.remotePlaceholder.style.display = '';

  /* If the local stream was opened ONLY for this call (camera wasn't on before),
     stop all tracks and update UI.  If the public camera was already on, leave it. */
  if (state.streamOpenedForCall && state.localStream) {
    const hasPubCamWin = !!state.cameraWindows[state.currentUser.id];
    if (!hasPubCamWin) {
      /* No public camera window → kill the stream entirely */
      state.localStream.getTracks().forEach(t => t.stop());
      state.localStream = null;
      state.currentUser.hasCamera = false;
      dom.cameraBtnLabel.textContent = 'Camera Off';
      dom.cameraBtnHeader.classList.remove('camera-on');
      broadcastAll('cam-closed', {});
      updateOwnPresence();
      renderUsers();
    }
    state.streamOpenedForCall = false;
  }

  state.activeCallUID = null;
  showToast('📵 Call ended.');
}

/* ================================================================
   19. MOBILE PANEL TOGGLE
================================================================ */
/* ── Users-panel horizontal resize (desktop) ──────────────────── */
function initPanelResize() {
  const handle = document.getElementById('panelResizeHandle');
  const panel  = dom.usersPanel;
  if (!handle || !panel) return;

  /* Restore saved width */
  const savedW = parseInt(localStorage.getItem('nvc_panel_w'), 10);
  if (savedW && savedW >= 160 && savedW <= 480) panel.style.width = savedW + 'px';

  let dragging = false, startX = 0, startW = 0;

  function onStart(e) {
    dragging = true;
    startX   = e.touches ? e.touches[0].clientX : e.clientX;
    startW   = panel.getBoundingClientRect().width;
    handle.classList.add('is-resizing');
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const x    = e.touches ? e.touches[0].clientX : e.clientX;
    const diff = startX - x;           /* drag left = panel wider */
    const newW = Math.min(480, Math.max(160, startW + diff));
    panel.style.width = newW + 'px';
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('is-resizing');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    /* Persist preferred width */
    localStorage.setItem('nvc_panel_w', parseInt(panel.style.width, 10));
  }

  handle.addEventListener('mousedown',  onStart);
  handle.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup',   onEnd);
  document.addEventListener('touchend',  onEnd);
}

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
    /* Never steal events from interactive elements — fixes iOS button tap */
    if (e.target?.closest('button, a, input, select, textarea, [data-no-drag]')) return;
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
    username:  state.currentUser.username || state.currentUser.name,
    isGuest:   state.currentUser.isGuest,
    hasCamera: state.currentUser.hasCamera,
    online:    true,
    avatarUrl: state.currentUser.avatarUrl || null,
  });
}

/** Sync state.users from Supabase Presence state */
function syncPresence(presenceState) {
  const myId     = String(state.currentUser.id);
  const onlineIds = new Set(Object.keys(presenceState).map(String));
  onlineIds.delete(myId);

  Object.entries(presenceState).forEach(([uid, presences]) => {
    if (String(uid) === myId) return;
    const info = presences[0];
    ensureUser(String(uid), info.name, { username: info.username || null, isGuest: info.isGuest, online: true, hasCamera: !!info.hasCamera, avatarUrl: info.avatarUrl || null });
  });
  /* Mark everyone NOT in the current presence state as offline */
  state.users.forEach(u => { u.online = onlineIds.has(String(u.id)); });
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

/** Create the Supabase JS client (called early, before auth modal) */
function initSupabaseClient() {
  if (!SUPABASE_URL.includes('supabase.co') || SUPABASE_ANON_KEY.startsWith('YOUR_')) {
    console.warn('[NeverVideoChat] Supabase not configured — local-only mode.');
    return false;
  }
  /* persistSession: false stops the SDK from touching third-party localStorage
     (Edge / Safari block it as "Tracking Prevention").
     We save/restore tokens ourselves in nvc_auth_session.                    */
  state.supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession:     false,
      autoRefreshToken:   false,
      detectSessionInUrl: false,
    },
  });
  return true;
}

async function connectSupabase() {
  if (!state.supa) {
    showToast('⚠️ Supabase not configured — local mode. Fill in SUPABASE_URL and SUPABASE_ANON_KEY in script.js');
    return;
  }

  try {

    /* ── 1. Load last 60 public messages ── */
    const { data: msgs, error: msgErr } = await state.supa
      .from('messages').select('*')
      .order('created_at', { ascending: true }).limit(60);

    if (!msgErr && msgs?.length) {
      if (dom.welcomeBanner?.parentNode) dom.welcomeBanner.remove();
      msgs.forEach(m => {
        const isMine = m.user_id === state.currentUser.id;
        if (!isMine && state.ignoredUsers[String(m.user_id)]) return; // ignored
        if (!isMine) ensureUser(m.user_id, m.username);
        const { html: mHtml, quoteHtml: mQHtml, quoteName: mQName } = extractQuote(m.content);
        renderMessage({ userId: isMine ? 'me' : m.user_id, username: m.username, html: mHtml, quoteHtml: mQHtml, quoteName: mQName, ts: new Date(m.created_at).getTime() });
      });
    }

    /* ── 2. Subscribe to new public messages (Postgres Changes) ── */
    state.supa.channel('db-messages')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, ({ new: m }) => {
        if (m.user_id === state.currentUser.id) return; // already rendered optimistically
        if (state.ignoredUsers[String(m.user_id)]) return; // ignored
        ensureUser(m.user_id, m.username);
        const { html, quoteHtml, quoteName } = extractQuote(m.content);
        renderMessage({ userId: m.user_id, username: m.username, html, quoteHtml, quoteName, ts: new Date(m.created_at).getTime() });
        playNotificationSound();
      })
      .subscribe();

    /* ── 3. Presence channel (online users + camera state) ── */
    state.presenceCh = state.supa.channel('presence:room-main', {
      config: { presence: { key: state.currentUser.id } },
    });
    state.presenceCh
      .on('presence', { event:'sync' }, () => syncPresence(state.presenceCh.presenceState()))

      /* ── join ──────────────────────────────────────────────────────
         Fires for a real join AND every time a user calls .track()
         to update their presence (e.g. camera toggle).
         BUG-1 FIX: update hasCamera + renderUsers immediately here.
         BUG-3 FIX: cancel any pending "left" timer for this uid.    */
      .on('presence', { event:'join' }, ({ key, newPresences }) => {
        const uid  = String(key);
        const myId = String(state.currentUser?.id);
        if (uid === myId) return;

        /* Cancel debounced-leave timer for this uid (was a presence
           update, not a real disconnect)                             */
        if (state.presenceLeaveTimers[uid]) {
          clearTimeout(state.presenceLeaveTimers[uid]);
          delete state.presenceLeaveTimers[uid];
        }

        const info      = newPresences[0];
        const wasOnline = !!state.users.find(u => String(u.id) === uid)?.online;
        ensureUser(uid, info.name, { username: info.username || null, isGuest: info.isGuest, online: true, hasCamera: !!info.hasCamera, avatarUrl: info.avatarUrl || null });
        renderUsers(); /* immediately reflect camera-icon change      */
        if (!wasOnline) showToast(`👤 ${info.name} joined the chat`);
      })

      /* ── leave ─────────────────────────────────────────────────────
         BUG-3 FIX: Supabase fires leave+join on every .track() call
         (presence update).  Debounce 600ms; if a join arrives first,
         cancel the timer — it was just a presence update.
         Also never process our own leave (reconnect artefact).       */
      .on('presence', { event:'leave' }, ({ key, leftPresences }) => {
        const uid  = String(key);
        const myId = String(state.currentUser?.id);
        if (uid === myId) return;

        /* Look up name now, before the user might be removed         */
        const u    = state.users.find(u => String(u.id) === uid)
                  ?? state.users.find(u => String(u.id) === String(leftPresences?.[0]?.id));
        const name = u?.name ?? leftPresences?.[0]?.name ?? 'A user';

        clearTimeout(state.presenceLeaveTimers[uid]);
        state.presenceLeaveTimers[uid] = setTimeout(() => {
          delete state.presenceLeaveTimers[uid];

          /* Double-check: is the user still present? (rejoined quickly) */
          const stillPresent = !!(state.presenceCh?.presenceState()?.[uid]);
          if (stillPresent) return;

          const uu = state.users.find(u => String(u.id) === uid);
          if (uu) { uu.online = false; renderUsers(); }
          showToast(`👋 ${name} left`);

          /* Clear any pending cam/call request towards this user */
          clearPendingCamRequest(uid);

          if (state.cameraWindows[uid]) closeCameraWindow(uid);
          if (state.activeCallUID === uid && !dom.vcallWin.hidden) {
            endCall(false);
            showToast(`📵 ${name} disconnected — call ended.`);
          }
        }, 600);
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') await updateOwnPresence();
      });

    /* ── 4. Signal channel (Broadcast — typing, PM, WebRTC, cam events) ── */
    state.signalCh = state.supa.channel('broadcast:signals-main');
    state.signalCh
      .on('broadcast', { event:'typing'      }, ({ payload }) => handleTyping(payload))
      .on('broadcast', { event:'pm'          }, ({ payload }) => handleIncomingPM(payload))
      .on('broadcast', { event:'webrtc'      }, ({ payload }) => handleWebRTCSignal(payload))
      .on('broadcast', { event:'cam-req'     }, ({ payload }) => handleCamRequest(payload))
      .on('broadcast', { event:'cam-accepted' }, ({ payload }) => handleCamAccepted(payload))
      .on('broadcast', { event:'cam-rejected' }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        const fromId = String(payload.from);
        clearPendingCamRequest(fromId);
        /* The RECEIVER decides to block — this side only clears the pending state */
        showToast(`❌ ${payload.fromName || 'User'} declined your camera request.`);
      })
      .on('broadcast', { event:'cam-revoked' }, ({ payload }) => {
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        /* The stream owner kicked us — close our remote window */
        const fromId = String(payload.from);
        if (state.cameraWindows[fromId]) closeCameraWindow(fromId);
        showToast(`📵 Camera access revoked.`);
      })
      .on('broadcast', { event:'cam-opened'   }, ({ payload }) => {
        /* INSTANT-ICON FIX: camera-open via fast Broadcast so the
           user-list camera icon updates in <100ms instead of ~1-2s  */
        if (String(payload.from) === String(state.currentUser?.id)) return;
        const u = state.users.find(u => String(u.id) === String(payload.from));
        if (u) { u.hasCamera = true; renderUsers(); }
        else {
          ensureUser(String(payload.from), payload.fromName, { hasCamera: true, online: true });
          renderUsers();
        }
      })
      .on('broadcast', { event:'cam-closed'   }, ({ payload }) => handleCamClosed(payload))
      .on('broadcast', { event:'call-ended'   }, ({ payload }) => {
        /* The other party ended the call — clean up our side */
        if (String(payload.to) !== String(state.currentUser?.id)) return;
        if (!dom.vcallWin.hidden) {
          endCall(false); /* false = don't re-broadcast (avoid loop) */
          showToast(`📵 ${payload.fromName} ended the call.`);
        }
      })
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
  /* ── 1. Init non-Supabase UI ── */
  initToolbar();
  initImageAttach();
  initEmojiPicker();
  initVoiceRecording();
  initContextMenu();
  initCameraSystem();
  initCallControls();
  initMobilePanel();
  initPanelResize();
  initAuthModal();
  initProfileModal();
  initSettingsModal();

  /* ── 2. Create Supabase client (needed for auth) ── */
  initSupabaseClient();

  /* ── 3. Try to restore a registered session ── */
  const restoredUser = await tryRestoreSession();
  if (restoredUser) {
    state.currentUser = restoredUser;
    localStorage.setItem('nvc_identity', JSON.stringify(state.currentUser));
    state.settings = loadDeviceSettings();
    await finishInit();
    return;
  }

  /* ── 4. Check for existing guest identity ── */
  try {
    const stored = JSON.parse(localStorage.getItem('nvc_identity') || 'null');
    if (stored?.id && stored?.name) {
      state.currentUser = stored;
      state.settings = loadDeviceSettings();
      await finishInit();
      return;
    }
  } catch (_) {}

  /* ── 5. No identity → show auth modal ── */
  dom.authModal.hidden = false;
}

/** Called after a user identity has been established (auth or guest) */
async function finishInit() {
  /* pendingCamRequests are session-only — always start clean */
  state.pendingCamRequests = {};

  /* Load persisted lists */
  state.rejectedCamUsers = loadRejectedCams();
  state.ignoredUsers     = loadIgnoredUsers();

  /* Reply cancel button */
  dom.replyPreviewCancel?.addEventListener('click', clearReplyTo);

  renderUsers();
  updateHeaderUser();
  connectSupabase().catch(err => console.error('[NVC]', err));
  dom.msgInput.focus();
}

document.addEventListener('DOMContentLoaded', init);

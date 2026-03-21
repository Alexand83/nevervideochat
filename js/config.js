/* ================================================================
   config.js  — all compile-time constants
================================================================ */
/* Incrementa a ogni release / deploy */
export const APP_VERSION = '1.0.2';

/* Firebase config is in js/firebase-config.js */
export const AUTH_EMAIL_DOMAIN = 'nvc.local';

/* Storage: se impostati, usa Supabase (bucket chat-media); altrimenti Firebase Storage.
   Lascia stringhe vuote '' per usare solo Firebase. */
export const SUPABASE_URL      = 'https://kybarxjynjxpagxijpti.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_0HLInJsBCt5kZCVW9yifcg_1TGxHMCm';

// Rooms are now loaded from database (see rooms.js loadRoomsFromDB)
export const DEFAULT_ROOM_ID = 'general';

/* Security constants */
export const MAX_MESSAGE_LENGTH = 10000; /* Max characters in message (including HTML) */
export const MAX_USERNAME_LENGTH = 50;
export const MAX_ROOM_NAME_LENGTH = 100;
export const MAX_QUOTE_LENGTH = 5000;

export const AVATAR_COLORS = [
  '#1f6feb','#388bfd','#a371f7','#da3633','#d29922',
  '#3fb950','#238636','#e8523a','#f78166','#79c0ff',
];

/**
 * Fallback STUN-only config usato se la Edge Function get-ice-config non è raggiungibile.
 * Le credenziali TURN (relay) vengono caricate a runtime dalla Edge Function — non sono
 * mai esposte nel bundle JS. Vedi supabase/functions/get-ice-config/README.md.
 */
/**
 * Se true: il client usa solo STUN (scoperta NAT) e ignora tutti gli URL turn:/turns:.
 * Per test P2P puri: true. Per produzione (5G/CGNAT): false + relay TURN.
 */
export const ICE_P2P_ONLY = false;

/**
 * Solo se ICE_P2P_ONLY è true: su rete cellulare mantieni comunque i server TURN (sicurezza reale).
 * Per test STUN-only ovunque lascia false.
 */
export const ICE_P2P_KEEP_TURN_ON_CELLULAR = false;

export const ICE_SERVERS_FALLBACK = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302'  },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.relay.metered.ca:80' },
  ],
  iceCandidatePoolSize: 6,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

/**
 * Optional ICE config endpoint (recommended on GitHub Pages).
 * Set this to your Cloudflare Worker URL (e.g. "https://nvc-ice.<user>.workers.dev/ice").
 * If empty, the app will fall back to Firebase Function URL (if available) and then Firestore.
 */
export const ICE_ENDPOINT_URL = 'https://nvc-ice-proxy.tmalex.workers.dev/ice';

export const EMOJI_CATEGORIES = {
  '😊': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  '👋': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','☝️','👇','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦵','🦶','👂','👃','👀','👅','👄','💋'],
  '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💋','🫶'],
  '🎉': ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🥈','🥉','🎯','🎮','🕹️','🎲','♟️','🎨','🖼️','🎭','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎻','🎙️','📻','📺','📷','📸','📹','💻','🖥️','⌨️','🖱️'],
  '🌸': ['🌸','💐','🌺','🌻','🌼','🌷','🌹','🥀','🌿','🍀','🍁','🍂','🍃','🌱','🌲','🌳','🌴','🌵','🌾','🌊','🌈','⭐','🌟','✨','💫','⚡','🔥','❄️','🌙','☀️','⛅','☁️','⛈️','🌩️','🌨️','🌀','🦋','🐝'],
  '🍕': ['🍕','🍔','🍟','🌭','🍿','🥓','🥚','🍳','🧇','🥞','🍣','🍜','🍝','🍛','🍱','🦀','🦞','🦐','🍦','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍸','🍹'],
};

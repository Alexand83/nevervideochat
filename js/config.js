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

export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302'  },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
  iceCandidatePoolSize: 10,
};

/** Se true, la PC in entrata (viewer) usa solo relay (TURN). Utile se la cam resta nera per NAT simmetrico. */
export const VIDEO_ICE_RELAY_ONLY = false;

export const EMOJI_CATEGORIES = {
  '😊': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  '👋': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','☝️','👇','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦵','🦶','👂','👃','👀','👅','👄','💋'],
  '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💋','🫶'],
  '🎉': ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🥈','🥉','🎯','🎮','🕹️','🎲','♟️','🎨','🖼️','🎭','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎻','🎙️','📻','📺','📷','📸','📹','💻','🖥️','⌨️','🖱️'],
  '🌸': ['🌸','💐','🌺','🌻','🌼','🌷','🌹','🥀','🌿','🍀','🍁','🍂','🍃','🌱','🌲','🌳','🌴','🌵','🌾','🌊','🌈','⭐','🌟','✨','💫','⚡','🔥','❄️','🌙','☀️','⛅','☁️','⛈️','🌩️','🌨️','🌀','🦋','🐝'],
  '🍕': ['🍕','🍔','🍟','🌭','🍿','🥓','🥚','🍳','🧇','🥞','🍣','🍜','🍝','🍛','🍱','🦀','🦞','🦐','🍦','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍸','🍹'],
};

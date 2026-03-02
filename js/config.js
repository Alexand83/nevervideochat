/* ================================================================
   config.js  — all compile-time constants
================================================================ */
export const SUPABASE_URL      = 'https://kybarxjynjxpagxijpti.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_0HLInJsBCt5kZCVW9yifcg_1TGxHMCm';
export const AUTH_EMAIL_DOMAIN = 'nvc.local';

// Rooms are now loaded from database (see rooms.js loadRoomsFromDB)
export const DEFAULT_ROOM_ID = 'general';

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

export const EMOJI_CATEGORIES = {
  '😊': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  '👋': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','☝️','👇','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦵','🦶','👂','👃','👀','👅','👄','💋'],
  '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💋','🫶'],
  '🎉': ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🥈','🥉','🎯','🎮','🕹️','🎲','♟️','🎨','🖼️','🎭','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎻','🎙️','📻','📺','📷','📸','📹','💻','🖥️','⌨️','🖱️'],
  '🌸': ['🌸','💐','🌺','🌻','🌼','🌷','🌹','🥀','🌿','🍀','🍁','🍂','🍃','🌱','🌲','🌳','🌴','🌵','🌾','🌊','🌈','⭐','🌟','✨','💫','⚡','🔥','❄️','🌙','☀️','⛅','☁️','⛈️','🌩️','🌨️','🌀','🦋','🐝'],
  '🍕': ['🍕','🍔','🍟','🌭','🍿','🥓','🥚','🍳','🧇','🥞','🍣','🍜','🍝','🍛','🍱','🦀','🦞','🦐','🍦','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍸','🍹'],
};

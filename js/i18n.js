/* ================================================================
   i18n.js — Internationalization (translations)
================================================================ */
import { state } from './state.js';

/* ── Translations ── */
const translations = {
  it: {
    // Header
    'header.camera': 'Camera',
    'header.cameraOn': 'Camera Attiva',
    'header.cameraOff': 'Camera Spenta',
    'header.online': 'Online',
    'header.search': 'Cerca',
    'header.admin': 'Admin',
    'header.profile': 'Profilo',
    'header.settings': 'Impostazioni',
    
    // Chat
    'chat.placeholder': 'Scrivi un messaggio...',
    'chat.send': 'Invia',
    'chat.welcome': 'Benvenuto in NeverVideoChat',
    'chat.welcomeDesc': 'Inizia a chattare con gli altri utenti!',
    'chat.typing': 'sta scrivendo...',
    'chat.reply': 'Rispondi',
    'chat.react': 'Reagisci',
    
    // User list
    'users.online': 'Online',
    'users.you': 'Tu',
    'users.registered': 'Registrato',
    'users.guest': 'Ospite',
    'users.muted': 'Mutato',
    
    // Rooms
    'rooms.general': 'Generale',
    'rooms.events': 'Eventi',
    'rooms.join': 'Entra',
    'rooms.joined': 'Giunto',
    
    // Modals
    'modal.close': 'Chiudi',
    'modal.save': 'Salva',
    'modal.cancel': 'Annulla',
    'modal.delete': 'Elimina',
    
    // Admin
    'admin.rooms': 'Stanze',
    'admin.users': 'Utenti',
    'admin.banned': 'Bannati',
    'admin.ips': 'IP Bloccati',
    'admin.roles': 'Ruoli',
    'admin.themes': 'Temi',
    
    // Settings
    'settings.language': 'Lingua',
    'settings.theme': 'Tema',
    'settings.notifications': 'Notifiche',
    
    // Actions
    'action.kick': 'Espelli',
    'action.ban': 'Banna',
    'action.mute': 'Muta',
    'action.unmute': 'Smuta',
    'action.ignore': 'Ignora',
    'action.unignore': 'Non ignorare',
    
    // Messages
    'msg.banned': 'Sei stato bannato',
    'msg.kicked': 'Sei stato espulso',
    'msg.muted': 'Sei stato mutato',
  },
  
  en: {
    // Header
    'header.camera': 'Camera',
    'header.cameraOn': 'Camera On',
    'header.cameraOff': 'Camera Off',
    'header.online': 'Online',
    'header.search': 'Search',
    'header.admin': 'Admin',
    'header.profile': 'Profile',
    'header.settings': 'Settings',
    
    // Chat
    'chat.placeholder': 'Type a message...',
    'chat.send': 'Send',
    'chat.welcome': 'Welcome to NeverVideoChat',
    'chat.welcomeDesc': 'Start chatting with other users!',
    'chat.typing': 'is typing...',
    'chat.reply': 'Reply',
    'chat.react': 'React',
    
    // User list
    'users.online': 'Online',
    'users.you': 'You',
    'users.registered': 'Registered',
    'users.guest': 'Guest',
    'users.muted': 'Muted',
    
    // Rooms
    'rooms.general': 'General',
    'rooms.events': 'Events',
    'rooms.join': 'Join',
    'rooms.joined': 'Joined',
    
    // Modals
    'modal.close': 'Close',
    'modal.save': 'Save',
    'modal.cancel': 'Cancel',
    'modal.delete': 'Delete',
    
    // Admin
    'admin.rooms': 'Rooms',
    'admin.users': 'Users',
    'admin.banned': 'Banned',
    'admin.ips': 'Blocked IPs',
    'admin.roles': 'Roles',
    'admin.themes': 'Themes',
    
    // Settings
    'settings.language': 'Language',
    'settings.theme': 'Theme',
    'settings.notifications': 'Notifications',
    
    // Actions
    'action.kick': 'Kick',
    'action.ban': 'Ban',
    'action.mute': 'Mute',
    'action.unmute': 'Unmute',
    'action.ignore': 'Ignore',
    'action.unignore': 'Unignore',
    
    // Messages
    'msg.banned': 'You have been banned',
    'msg.kicked': 'You have been kicked',
    'msg.muted': 'You have been muted',
  },
  
  es: {
    // Header
    'header.camera': 'Cámara',
    'header.cameraOn': 'Cámara Activada',
    'header.cameraOff': 'Cámara Desactivada',
    'header.online': 'En línea',
    'header.search': 'Buscar',
    'header.admin': 'Admin',
    'header.profile': 'Perfil',
    'header.settings': 'Configuración',
    
    // Chat
    'chat.placeholder': 'Escribe un mensaje...',
    'chat.send': 'Enviar',
    'chat.welcome': 'Bienvenido a NeverVideoChat',
    'chat.welcomeDesc': '¡Comienza a chatear con otros usuarios!',
    'chat.typing': 'está escribiendo...',
    'chat.reply': 'Responder',
    'chat.react': 'Reaccionar',
    
    // User list
    'users.online': 'En línea',
    'users.you': 'Tú',
    'users.registered': 'Registrado',
    'users.guest': 'Invitado',
    'users.muted': 'Silenciado',
    
    // Rooms
    'rooms.general': 'General',
    'rooms.events': 'Eventos',
    'rooms.join': 'Unirse',
    'rooms.joined': 'Unido',
    
    // Modals
    'modal.close': 'Cerrar',
    'modal.save': 'Guardar',
    'modal.cancel': 'Cancelar',
    'modal.delete': 'Eliminar',
    
    // Admin
    'admin.rooms': 'Salas',
    'admin.users': 'Usuarios',
    'admin.banned': 'Baneados',
    'admin.ips': 'IPs Bloqueados',
    'admin.roles': 'Roles',
    'admin.themes': 'Temas',
    
    // Settings
    'settings.language': 'Idioma',
    'settings.theme': 'Tema',
    'settings.notifications': 'Notificaciones',
    
    // Actions
    'action.kick': 'Expulsar',
    'action.ban': 'Banear',
    'action.mute': 'Silenciar',
    'action.unmute': 'Desilenciar',
    'action.ignore': 'Ignorar',
    'action.unignore': 'No ignorar',
    
    // Messages
    'msg.banned': 'Has sido baneado',
    'msg.kicked': 'Has sido expulsado',
    'msg.muted': 'Has sido silenciado',
  },
  
  de: {
    // Header
    'header.camera': 'Kamera',
    'header.cameraOn': 'Kamera Ein',
    'header.cameraOff': 'Kamera Aus',
    'header.online': 'Online',
    'header.search': 'Suchen',
    'header.admin': 'Admin',
    'header.profile': 'Profil',
    'header.settings': 'Einstellungen',
    
    // Chat
    'chat.placeholder': 'Nachricht schreiben...',
    'chat.send': 'Senden',
    'chat.welcome': 'Willkommen bei NeverVideoChat',
    'chat.welcomeDesc': 'Beginne mit anderen Benutzern zu chatten!',
    'chat.typing': 'schreibt...',
    'chat.reply': 'Antworten',
    'chat.react': 'Reagieren',
    
    // User list
    'users.online': 'Online',
    'users.you': 'Du',
    'users.registered': 'Registriert',
    'users.guest': 'Gast',
    'users.muted': 'Stummgeschaltet',
    
    // Rooms
    'rooms.general': 'Allgemein',
    'rooms.events': 'Ereignisse',
    'rooms.join': 'Beitreten',
    'rooms.joined': 'Beigetreten',
    
    // Modals
    'modal.close': 'Schließen',
    'modal.save': 'Speichern',
    'modal.cancel': 'Abbrechen',
    'modal.delete': 'Löschen',
    
    // Admin
    'admin.rooms': 'Räume',
    'admin.users': 'Benutzer',
    'admin.banned': 'Gesperrt',
    'admin.ips': 'Blockierte IPs',
    'admin.roles': 'Rollen',
    'admin.themes': 'Themen',
    
    // Settings
    'settings.language': 'Sprache',
    'settings.theme': 'Thema',
    'settings.notifications': 'Benachrichtigungen',
    
    // Actions
    'action.kick': 'Kicken',
    'action.ban': 'Bannen',
    'action.mute': 'Stummschalten',
    'action.unmute': 'Stummschaltung aufheben',
    'action.ignore': 'Ignorieren',
    'action.unignore': 'Nicht ignorieren',
    
    // Messages
    'msg.banned': 'Du wurdest gebannt',
    'msg.kicked': 'Du wurdest gekickt',
    'msg.muted': 'Du wurdest stummgeschaltet',
  },
};

/* ── Get current language ── */
export function getLanguage() {
  return state.currentUser?.language || 'it';
}

/* ── Set language ── */
export function setLanguage(lang) {
  if (!state.currentUser) return;
  state.currentUser.language = lang;
  document.documentElement.lang = lang;
  applyTranslations();
}

/* ── Translate function ── */
export function t(key, fallback = '') {
  const lang = getLanguage();
  const keys = key.split('.');
  let value = translations[lang];
  
  for (const k of keys) {
    value = value?.[k];
    if (value === undefined) break;
  }
  
  return value || translations['en'][key] || fallback || key;
}

/* ── Apply translations to DOM ── */
export function applyTranslations() {
  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  
  // Update all elements with data-i18n-placeholder attribute
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  
  // Update all elements with data-i18n-title attribute
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
}

/* ── Initialize i18n ── */
export function initI18n() {
  const lang = getLanguage();
  document.documentElement.lang = lang;
  applyTranslations();
}

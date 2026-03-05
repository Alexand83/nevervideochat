/* ================================================================
   permissions.js  — sistema di permessi basato su ruoli
================================================================ */
import { state } from './state.js';

let userPermissions = null;
let userRole = null;
let customRole = null;

/* ── Carica permessi utente ──────────────────────────────────── */
export async function loadUserPermissions() {
  if (!state.supa || !state.currentUser) {
    userPermissions = null;
    userRole = null;
    customRole = null;
    return;
  }

  try {
    const { data, error } = await state.supa
      .from('profiles')
      .select('role, custom_role_id, custom_roles(*)')
      .eq('id', state.currentUser.id)
      .single();

    if (error || !data) {
      userPermissions = getDefaultPermissions('user');
      userRole = 'user';
      customRole = null;
      return;
    }

    userRole = data.role || 'user';
    customRole = data.custom_roles;

    /* Se ha un custom_role, usa i permessi del custom_role */
    if (customRole && customRole.permissions) {
      userPermissions = customRole.permissions;
    } else {
      /* Altrimenti usa i permessi del ruolo base */
      userPermissions = getDefaultPermissions(userRole);
    }
  } catch (err) {
    console.error('[Permissions] Error loading permissions:', err);
    userPermissions = getDefaultPermissions('user');
    userRole = 'user';
    customRole = null;
  }
}

/* ── Permessi predefiniti per ruolo base ──────────────────────── */
function getDefaultPermissions(role) {
  const permissions = {
    owner: {
      can_ban: true,
      can_mute: true,
      can_kick: true,
      can_delete_messages: true,
      can_edit_messages: true,
      can_manage_rooms: true,
      can_manage_users: true,
      can_manage_roles: true,
      can_view_logs: true,
      can_manage_announcements: true,
      can_view_statistics: true,
      can_post_messages: true,
    },
    admin: {
      can_ban: true,
      can_mute: true,
      can_kick: true,
      can_delete_messages: true,
      can_edit_messages: true,
      can_manage_rooms: true,
      can_manage_users: true,
      can_manage_roles: false,
      can_view_logs: true,
      can_manage_announcements: true,
      can_view_statistics: true,
      can_post_messages: true,
    },
    moderator: {
      can_ban: false,
      can_mute: true,
      can_kick: true,
      can_delete_messages: true,
      can_edit_messages: false,
      can_manage_rooms: false,
      can_manage_users: false,
      can_manage_roles: false,
      can_view_logs: true,
      can_manage_announcements: false,
      can_view_statistics: true,
      can_post_messages: true,
    },
    user: {
      can_ban: false,
      can_mute: false,
      can_kick: false,
      can_delete_messages: false,
      can_edit_messages: false,
      can_manage_rooms: false,
      can_manage_users: false,
      can_manage_roles: false,
      can_view_logs: false,
      can_manage_announcements: false,
      can_view_statistics: false,
      can_post_messages: true,
    },
  };

  return permissions[role] || permissions.user;
}

/* ── Verifica permesso ────────────────────────────────────────── */
export function hasPermission(permission) {
  if (!userPermissions) return false;
  return userPermissions[permission] === true;
}

/* ── Verifica se è admin/owner ────────────────────────────────── */
export function isAdmin() {
  return userRole === 'owner' || userRole === 'admin';
}

/* ── Verifica se è owner ──────────────────────────────────────── */
export function isOwner() {
  return userRole === 'owner';
}

/* ── Ottieni ruolo utente ──────────────────────────────────────── */
export function getUserRole() {
  return userRole;
}

/* ── Ottieni custom role ──────────────────────────────────────── */
export function getCustomRole() {
  return customRole;
}

/* ── Ottieni tutti i permessi ──────────────────────────────────── */
export function getAllPermissions() {
  return userPermissions || {};
}

/* ── Ricarica permessi (utile dopo cambi ruolo) ───────────────── */
export async function refreshPermissions() {
  await loadUserPermissions();
}

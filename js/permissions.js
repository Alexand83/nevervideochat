/* ================================================================
   permissions.js  — sistema di permessi basato su ruoli
================================================================ */
import { state } from './state.js';

let userPermissions = null;
let userRole = null;
let customRole = null;

/* ── Carica permessi utente ──────────────────────────────────── */
export async function loadUserPermissions() {
  if (!state.fb || !state.currentUser) {
    userPermissions = null;
    userRole = null;
    customRole = null;
    return;
  }

  try {
    const profileSnap = await state.fb.firestore.collection('profiles').doc(String(state.currentUser.id)).get();
    if (!profileSnap.exists) {
      userPermissions = getDefaultPermissions('user');
      userRole = 'user';
      customRole = null;
      return;
    }
    const data = profileSnap.data();
    const role = data.role || 'user';
    const customRoleId = data.custom_role_id || null;
    let customRoleData = null;
    if (customRoleId) {
      const roleSnap = await state.fb.firestore.collection('custom_roles').doc(String(customRoleId)).get();
      if (roleSnap.exists) customRoleData = roleSnap.data();
    }
    userRole = role;
    customRole = customRoleData;
    /* Solo owner ha sempre tutti i permessi; gli altri (admin, moderator, user) in base a quanto configurato dall'owner (custom role o default del ruolo) */
    if (role === 'owner') {
      userPermissions = getDefaultPermissions('owner');
    } else if (customRoleData && customRoleData.permissions) {
      const def = getDefaultPermissions('user');
      userPermissions = {
        ...def,
        ...customRoleData.permissions,
        /* Retrocompat: ruoli custom senza "own" possono ancora modificare/cancellare i propri messaggi */
        can_edit_own_messages: customRoleData.permissions.can_edit_own_messages !== false,
        can_delete_own_messages: customRoleData.permissions.can_delete_own_messages !== false,
      };
    } else {
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
export function getDefaultPermissions(role) {
  const permissions = {
    owner: {
      can_ban: true,
      can_mute: true,
      can_kick: true,
      can_disconnect: true,
      can_delete_own_messages: true,
      can_edit_own_messages: true,
      can_delete_messages: true,
      can_edit_messages: true,
      can_manage_rooms: true,
      can_manage_users: true,
      can_manage_roles: true,
      can_view_logs: true,
      can_manage_announcements: true,
      can_view_statistics: true,
      can_post_messages: true,
      can_manage_polls: true,
      can_change_avatar: true,
      can_change_nickname: true,
      can_view_cam_without_accept: true,
    },
    admin: {
      can_ban: true,
      can_mute: true,
      can_kick: true,
      can_disconnect: true,
      can_delete_own_messages: true,
      can_edit_own_messages: true,
      can_delete_messages: true,
      can_edit_messages: true,
      can_manage_rooms: true,
      can_manage_users: true,
      can_manage_roles: false,
      can_view_logs: true,
      can_manage_announcements: true,
      can_view_statistics: true,
      can_post_messages: true,
      can_manage_polls: true,
      can_change_avatar: true,
      can_change_nickname: true,
      can_view_cam_without_accept: true,
    },
    moderator: {
      can_ban: false,
      can_mute: true,
      can_kick: true,
      can_disconnect: true,
      can_delete_own_messages: true,
      can_edit_own_messages: true,
      can_delete_messages: true,
      can_edit_messages: false,
      can_manage_rooms: false,
      can_manage_users: false,
      can_manage_roles: false,
      can_view_logs: true,
      can_manage_announcements: false,
      can_view_statistics: true,
      can_post_messages: true,
      can_manage_polls: false,
      can_change_avatar: true,
      can_change_nickname: true,
      can_view_cam_without_accept: false,
    },
    user: {
      can_ban: false,
      can_mute: false,
      can_kick: false,
      can_disconnect: false,
      can_delete_own_messages: true,
      can_edit_own_messages: true,
      can_delete_messages: false,
      can_edit_messages: false,
      can_manage_rooms: false,
      can_manage_users: false,
      can_manage_roles: false,
      can_view_logs: false,
      can_manage_announcements: false,
      can_view_statistics: false,
      can_post_messages: true,
      can_manage_polls: false,
      can_change_avatar: true,
      can_change_nickname: true,
      can_view_cam_without_accept: false,
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

/**
 * Carica i permessi di UN ALTRO utente direttamente da Firebase.
 * Usato dal ricevente di cam-req per verificare in modo indipendente
 * se il richiedente ha davvero can_view_cam_without_accept — senza
 * fidarsi del campo requesterHasForceView nella payload (spoofabile).
 */
export async function loadPermissionsForUser(uid) {
  if (!state.fb) return getDefaultPermissions('user');
  try {
    const profileSnap = await state.fb.firestore.collection('profiles').doc(String(uid)).get();
    if (!profileSnap.exists) return getDefaultPermissions('user');
    const data = profileSnap.data();
    const role = data.role || 'user';
    const customRoleId = data.custom_role_id || null;
    let customRoleData = null;
    if (customRoleId) {
      const roleSnap = await state.fb.firestore.collection('custom_roles').doc(String(customRoleId)).get();
      if (roleSnap.exists) customRoleData = roleSnap.data();
    }
    if (role === 'owner') return getDefaultPermissions('owner');
    if (customRoleData?.permissions) {
      const def = getDefaultPermissions('user');
      return {
        ...def,
        ...customRoleData.permissions,
        can_edit_own_messages:   customRoleData.permissions.can_edit_own_messages   !== false,
        can_delete_own_messages: customRoleData.permissions.can_delete_own_messages !== false,
      };
    }
    return getDefaultPermissions(role);
  } catch (_) {
    return getDefaultPermissions('user');
  }
}

/* ================================================================
   admin-extensions.js  — nuove funzionalità admin
   (Ruoli, Moderazione Messaggi, Statistiche, Log, Annunci)
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { showToast, escHtml, sanitiseHtml, fmtTime } from './utils.js';
import { broadcast } from './broadcast.js';
import { hasPermission, loadUserPermissions } from './permissions.js';

/* ── Log azione admin ─────────────────────────────────────────── */
export async function logAdminAction(action, targetType, targetId, targetName, details = {}) {
  if (!state.fb || !state.currentUser) return;
  
  try {
    await state.fb.firestore.collection('admin_logs').add({
      admin_id: String(state.currentUser.id),
      admin_name: state.currentUser.name || state.currentUser.username || 'Unknown',
      action,
      target_type: targetType,
      target_id: targetId ? String(targetId) : null,
      target_name: targetName || null,
      details,
      ip_address: null,
      created_at: new Date(),
    });
  } catch (err) {
    console.error('[Admin] Error logging action:', err);
  }
}

/* ── Gestione Ruoli ──────────────────────────────────────────── */
export async function loadCustomRoles() {
  if (!dom.adminRolesList || !state.fb) return;
  
  await loadUserPermissions();
  if (!hasPermission('can_manage_roles')) {
    dom.adminRolesList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to manage roles.</p>';
    return;
  }
  
  try {
    const snap = await state.fb.firestore.collection('custom_roles').orderBy('name').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    dom.adminRolesList.innerHTML = '';
    if (!data || data.length === 0) {
      dom.adminRolesList.innerHTML = '<p class="admin-empty">No custom roles. Create one!</p>';
      return;
    }
    
    data.forEach(role => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      const perms = role.permissions || {};
      const permCount = Object.values(perms).filter(v => v === true).length;
      
      item.innerHTML = `
        <div class="admin-item-info">
          <span class="admin-item-icon" style="background: ${role.color || '#8b949e'}">👑</span>
          <div>
            <strong>${escHtml(role.name)}</strong>
            <span class="admin-item-id">ID: ${escHtml(role.id)} | ${permCount} permissions</span>
          </div>
        </div>
        <div class="admin-item-actions">
          <button class="admin-action-btn" data-action="edit" data-role-id="${escHtml(String(role.id))}">✏️ Edit</button>
          <button class="admin-action-btn admin-action-danger" data-action="delete" data-role-id="${escHtml(String(role.id))}">🗑️ Delete</button>
        </div>
      `;
      item.querySelector('[data-action="edit"]')?.addEventListener('click', () => openRoleEditModal(role));
      item.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteRole(role.id));
      dom.adminRolesList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load roles error:', err);
    showToast('⚠️ Failed to load roles.');
  }
}

export function openRoleEditModal(role = null) {
  if (!dom.roleEditModal) return;
  const title = document.getElementById('roleEditModalTitle');
  
  if (title) title.textContent = role ? 'Edit Role' : 'Create Role';
  
  if (role) {
    document.getElementById('roleEditId').value = role.id;
    document.getElementById('roleEditName').value = role.name;
    document.getElementById('roleEditColor').value = role.color || '#8b949e';
    
    const perms = role.permissions || {};
    document.getElementById('permCanPostMessages').checked = perms.can_post_messages !== false;
    document.getElementById('permCanDeleteMessages').checked = perms.can_delete_messages === true;
    document.getElementById('permCanEditMessages').checked = perms.can_edit_messages === true;
    document.getElementById('permCanMute').checked = perms.can_mute === true;
    document.getElementById('permCanKick').checked = perms.can_kick === true;
    document.getElementById('permCanBan').checked = perms.can_ban === true;
    document.getElementById('permCanManageRooms').checked = perms.can_manage_rooms === true;
    document.getElementById('permCanManageUsers').checked = perms.can_manage_users === true;
    document.getElementById('permCanManageRoles').checked = perms.can_manage_roles === true;
    document.getElementById('permCanViewLogs').checked = perms.can_view_logs === true;
    document.getElementById('permCanManageAnnouncements').checked = perms.can_manage_announcements === true;
    document.getElementById('permCanViewStatistics').checked = perms.can_view_statistics === true;
    document.getElementById('permCanChangeAvatar').checked = perms.can_change_avatar !== false;
    document.getElementById('permCanChangeNickname').checked = perms.can_change_nickname !== false;
  } else {
    /* Reset form per nuovo ruolo */
    dom.roleEditForm.reset();
    const idField = document.getElementById('roleEditId');
    if (idField) {
      idField.value = '';
      idField.removeAttribute('value'); /* Forza il reset */
    }
    document.getElementById('permCanPostMessages').checked = true;
    document.getElementById('permCanChangeAvatar').checked = true;
    document.getElementById('permCanChangeNickname').checked = true;
    console.log('[Admin] Form reset for new role. ID field value:', idField?.value);
  }
  
  dom.roleEditModal.hidden = false;
}

/* Flag per prevenire doppi salvataggi */
let isSavingRole = false;

export async function saveRole() {
  if (!state.fb) return;
  
  /* Prevenire doppi salvataggi */
  if (isSavingRole) {
    console.log('[Admin] Save role already in progress, ignoring...');
    return;
  }
  
  isSavingRole = true;
  
  /* Get save button from form */
  const saveBtn = dom.roleEditForm?.querySelector('button[type="submit"]');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    const idInput = document.getElementById('roleEditId');
    const id = idInput ? idInput.value.trim() : null;
    const name = document.getElementById('roleEditName').value.trim();
    const color = document.getElementById('roleEditColor').value;
    
    console.log('[Admin] Form values - ID:', id, 'Name:', name, 'Color:', color);
    
    if (!name) {
      showToast('⚠️ Role Name is required.');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Role';
      }
      isSavingRole = false;
      return;
    }
    
    /* Se l'ID è vuoto o contiene solo spazi, è un nuovo ruolo */
    const isNewRole = !id || id === '';
    console.log('[Admin] Is new role?', isNewRole);
    
    const permissions = {
      can_post_messages: document.getElementById('permCanPostMessages').checked,
      can_delete_messages: document.getElementById('permCanDeleteMessages').checked,
      can_edit_messages: document.getElementById('permCanEditMessages').checked,
      can_mute: document.getElementById('permCanMute').checked,
      can_kick: document.getElementById('permCanKick').checked,
      can_ban: document.getElementById('permCanBan').checked,
      can_manage_rooms: document.getElementById('permCanManageRooms').checked,
      can_manage_users: document.getElementById('permCanManageUsers').checked,
      can_manage_roles: document.getElementById('permCanManageRoles').checked,
      can_view_logs: document.getElementById('permCanViewLogs').checked,
      can_manage_announcements: document.getElementById('permCanManageAnnouncements').checked,
      can_view_statistics: document.getElementById('permCanViewStatistics').checked,
      can_change_avatar: document.getElementById('permCanChangeAvatar').checked,
      can_change_nickname: document.getElementById('permCanChangeNickname').checked,
    };
    
    const { checkAdminAccess } = await import('./admin.js');
    const hasAccess = await checkAdminAccess();
    if (!hasAccess) {
      showToast('🚫 Admin access required.');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Role';
      }
      isSavingRole = false;
      return;
    }
    
    /* Verifica aggiuntiva: controlla il ruolo nel database e l'autenticazione */
    if (!state.currentUser) {
      showToast('🚫 You must be logged in to manage roles.');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Role';
      }
      isSavingRole = false;
      return;
    }
    
    /* Verifica autenticazione */
    const { data: { user: authUser }, error: authError } = await state.fb.auth.getUser();
    console.log('[Admin] Auth user:', JSON.stringify(authUser, null, 2));
    console.log('[Admin] Current user ID:', state.currentUser.id);
    console.log('[Admin] Auth error:', authError);
    
    if (!authUser) {
      console.error('[Admin] No authenticated user found');
      showToast('🚫 Authentication required. Please log in again.');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Role';
      }
      isSavingRole = false;
      return;
    }
    
    /* Verifica ruolo nel database */
    const profileSnap = await state.fb.firestore.collection('profiles').doc(String(state.currentUser.id)).get();
    const profile = profileSnap?.data();
    
    if (!profileSnap?.exists) {
      console.error('[Admin] Error checking profile: profile not found');
      showToast('⚠️ Could not verify your role. Please try again.');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Role';
      }
      isSavingRole = false;
      return;
    }
    
    console.log('[Admin] Current user profile:', JSON.stringify(profile, null, 2));
    console.log('[Admin] User role:', profile?.role);
    console.log('[Admin] Is owner or admin?', profile?.role === 'owner' || profile?.role === 'admin');
    
    if (!profile || (profile.role !== 'owner' && profile.role !== 'admin')) {
      const roleMsg = profile?.role || 'unknown';
      console.error('[Admin] User does not have required role. Current role:', roleMsg);
      showToast('🚫 You must be owner or admin to manage roles. Your role: ' + roleMsg);
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Role';
      }
      isSavingRole = false;
      return;
    }
    
    const roleData = {
      name: escHtml(name),
      color,
      permissions,
      updated_at: new Date().toISOString(),
    };
    
    /* Controlla se si sta cercando di modificare un ruolo di sistema - solo owner può farlo */
    if (!isNewRole && id && ['owner', 'admin', 'moderator', 'user'].includes(id)) {
      /* Solo owner può modificare ruoli di sistema */
      if (profile?.role !== 'owner') {
        console.log('[Admin] Attempted to modify system role:', id, 'but user is not owner');
        showToast('⚠️ Only owner can modify system roles.');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Save Role';
        }
        isSavingRole = false;
        return;
      }
      console.log('[Admin] Owner modifying system role:', id);
    }
    
    /* Se è un nuovo ruolo, genera l'ID dal nome e verifica che non sia un ruolo di sistema */
    if (isNewRole) {
      const generatedId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      console.log('[Admin] Generated role ID:', generatedId);
      
      if (['owner', 'admin', 'moderator', 'user'].includes(generatedId)) {
        console.log('[Admin] Generated ID matches system role:', generatedId);
        showToast('⚠️ This role name conflicts with a system role. Please choose a different name.');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Save Role';
        }
        isSavingRole = false;
        return;
      }
    }
    
    console.log('[Admin] Preparing to save role. ID:', id, 'Name:', name, 'IsNewRole:', isNewRole);
    console.log('[Admin] Role data to save:', JSON.stringify(roleData, null, 2));
    
    if (!isNewRole && id) {
      console.log('[Admin] Updating role:', id);
      await state.fb.firestore.collection('custom_roles').doc(id).set(roleData, { merge: true });
      await logAdminAction('update_role', 'role', id, name);
    } else {
      const roleId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      roleData.created_at = new Date();
      console.log('[Admin] Creating role:', roleId);
      await state.fb.firestore.collection('custom_roles').doc(roleId).set(roleData, { merge: true });
      await logAdminAction('create_role', 'role', roleId, name);
    }
    
    showToast('✅ Role saved!');
    dom.roleEditModal.hidden = true;
    /* Reset form */
    dom.roleEditForm?.reset();
    /* Ricarica i ruoli */
    await loadCustomRoles();
  } catch (err) {
    console.error('[Admin] Save role error:', err);
    console.error('[Admin] Error details:', {
      message: err.message,
      code: err.code,
      details: err.details,
      hint: err.hint,
      fullError: err
    });
    
    let errorMessage = '⚠️ Failed to save role: ';
    if (err.code === '42501') {
      errorMessage += 'Permission denied. You need admin/owner role.';
    } else if (err.code === 'PGRST301' || err.message?.includes('permission denied')) {
      errorMessage += 'Database permission denied. Check RLS policies.';
    } else if (err.message) {
      errorMessage += err.message;
    } else {
      errorMessage += 'Unknown error. Check console for details.';
    }
    
    showToast(errorMessage);
  } finally {
    /* Re-enable save button */
    const btn = dom.roleEditForm?.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Save Role';
    }
    /* Reset flag dopo un breve delay per permettere al form di resettarsi */
    setTimeout(() => {
      isSavingRole = false;
    }, 500);
  }
}

export async function deleteRole(roleId) {
  const { checkAdminAccess } = await import('./admin.js');
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    showToast('🚫 Admin access required.');
    return;
  }
  
  if (['owner', 'admin', 'moderator', 'user'].includes(roleId)) {
    showToast('⚠️ Cannot delete system roles.');
    return;
  }
  
  if (!confirm(`Delete role "${roleId}"? Users with this role will lose it.`)) return;
  if (!state.fb) return;
  
  try {
    await state.fb.firestore.collection('custom_roles').doc(roleId).delete();
    
    await logAdminAction('delete_role', 'role', roleId, roleId);
    showToast('✅ Role deleted.');
    loadCustomRoles();
  } catch (err) {
    console.error('[Admin] Delete role error:', err);
    showToast('⚠️ Failed to delete role.');
  }
}

/* ── Assegna ruolo a utente ──────────────────────────────────── */
export async function assignRoleToUser(userId, roleId) {
  if (!state.fb) {
    console.error('[Admin] Firebase not available');
    return false;
  }
  
  try {
    const { checkAdminAccess } = await import('./admin.js');
    const hasAccess = await checkAdminAccess();
    if (!hasAccess && !hasPermission('can_manage_users')) {
      showToast('🚫 You do not have permission to assign roles.');
      return false;
    }
    
    const finalRoleId = roleId && roleId.trim() !== '' ? roleId.trim() : null;
    console.log('[Admin] Assigning role:', { userId, roleId, finalRoleId });
    
    if (finalRoleId) {
      const roleSnap = await state.fb.firestore.collection('custom_roles').doc(finalRoleId).get();
      if (!roleSnap.exists) {
        console.error('[Admin] Role not found:', finalRoleId);
        showToast('⚠️ Role not found.');
        return false;
      }
    }
    
    const user = state.users?.[userId] || Object.values(state.users || {}).find(u => u.id === userId);
    const userName = user?.name || userId;
    const isGuest = String(userId).startsWith('guest_');
    
    let roleToAssign = finalRoleId;
    if (isGuest && !finalRoleId) {
      const guestSnap = await state.fb.firestore.collection('custom_roles').doc('guest').get();
      if (guestSnap.exists) roleToAssign = 'guest';
    }
    
    const profileRef = state.fb.firestore.collection('profiles').doc(String(userId));
    const profileSnap = await profileRef.get();
    const existingProfile = profileSnap.exists ? profileSnap.data() : null;
    
    if (existingProfile) {
      await profileRef.set({ custom_role_id: roleToAssign }, { merge: true });
      console.log('[Admin] Role assigned successfully');
    } else {
      const profileData = {
        username: userName || (isGuest ? `Guest_${userId.slice(6, 12)}` : 'Unknown'),
        display_name: userName || (isGuest ? `Guest_${userId.slice(6, 12)}` : 'Unknown'),
        is_guest: isGuest,
        custom_role_id: roleToAssign || (isGuest ? 'guest' : null),
      };
      if (!isGuest) profileData.role = 'user';
      try {
        await profileRef.set(profileData, { merge: true });
      } catch (err) {
        if (err?.code === 'permission-denied' || err?.message?.includes('already exists')) {
          await profileRef.set({ custom_role_id: roleToAssign }, { merge: true });
        } else throw err;
      }
      console.log('[Admin] Profile created and role assigned');
    }
    
    await logAdminAction('assign_role', 'user', userId, userName, { role_id: finalRoleId });
    
    showToast('✅ Role assigned!');
    
    /* Refresh permissions if current user */
    if (String(userId) === String(state.currentUser?.id)) {
      await loadUserPermissions();
    }
    
    return true;
  } catch (err) {
    console.error('[Admin] Assign role error:', err);
    showToast('⚠️ Failed to assign role: ' + (err.message || 'Unknown error'));
    return false;
  }
}

/* ── Moderazione Messaggi ─────────────────────────────────────── */
export async function loadMessages() {
  if (!dom.adminMessagesList || !state.fb) return;
  
  await loadUserPermissions();
  if (!hasPermission('can_delete_messages')) {
    dom.adminMessagesList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to view messages.</p>';
    return;
  }
  
  try {
    const roomFilter = document.getElementById('adminMessagesRoomFilter')?.value || '';
    const statusFilter = document.getElementById('adminMessagesStatusFilter')?.value || 'all';
    const searchQuery = document.getElementById('adminMessagesSearch')?.value.toLowerCase() || '';
    
    let col = state.fb.firestore.collection('messages').orderBy('created_at', 'desc').limit(100);
    if (roomFilter) col = state.fb.firestore.collection('messages').where('room_id', '==', roomFilter).orderBy('created_at', 'desc').limit(100);
    const snap = await col.get();
    let data = snap.docs.map(d => ({ id: d.id, ...d.data(), created_at: d.data().created_at?.toDate?.() || d.data().created_at }));
    
    if (statusFilter === 'deleted') {
      data = data.filter(m => m.deleted_at);
    } else if (statusFilter === 'reported') {
      const reportedSnap = await state.fb.firestore.collection('reported_messages').where('status', '==', 'pending').get();
      const reportedIds = new Set(reportedSnap.docs.map(d => d.data().message_id));
      if (reportedIds.size === 0) {
        dom.adminMessagesList.innerHTML = '<p class="admin-empty">No reported messages.</p>';
        return;
      }
      data = data.filter(m => reportedIds.has(m.id));
    }
    
    dom.adminMessagesList.innerHTML = '';
    const filtered = searchQuery
      ? data.filter(msg =>
          (msg.username || '').toLowerCase().includes(searchQuery) ||
          (msg.content || '').toLowerCase().includes(searchQuery)
        )
      : data;
    if (filtered.length === 0) {
      dom.adminMessagesList.innerHTML = '<p class="admin-empty">No messages found.</p>';
      return;
    }
    
    filtered.forEach(msg => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      const isDeleted = !!msg.deleted_at;
      const contentStr = (msg.content || '').toString();
      const contentPreview = sanitiseHtml(contentStr).substring(0, 100);
      
      item.innerHTML = `
        <div class="admin-item-info">
          <div>
            <strong>${escHtml(msg.username || '')}</strong>
            <span class="admin-item-id">${msg.room_id} | ${fmtTime(new Date(msg.created_at))}</span>
            ${isDeleted ? '<span class="admin-badge admin-badge-danger">Deleted</span>' : ''}
          </div>
          <div style="margin-top: 8px; color: var(--tx2); font-size: var(--fz-sm);">
            ${contentPreview}${contentStr.length > 100 ? '...' : ''}
          </div>
        </div>
        <div class="admin-item-actions">
          ${!isDeleted ? `
            <button class="admin-action-btn" data-action="delete" data-msg-id="${escHtml(String(msg.id))}">🗑️ Delete</button>
            <button class="admin-action-btn" data-action="edit" data-msg-id="${escHtml(String(msg.id))}">✏️ Edit</button>
          ` : `
            <button class="admin-action-btn" data-action="restore" data-msg-id="${escHtml(String(msg.id))}">↩️ Restore</button>
          `}
        </div>
      `;
      
      if (!isDeleted) {
        item.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteMessage(msg.id, msg.username));
        item.querySelector('[data-action="edit"]')?.addEventListener('click', () => editMessage(msg));
      } else {
        item.querySelector('[data-action="restore"]')?.addEventListener('click', () => restoreMessage(msg.id));
      }
      
      dom.adminMessagesList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load messages error:', err);
    showToast('⚠️ Failed to load messages.');
  }
}

export async function deleteMessage(messageId, username) {
  if (!hasPermission('can_delete_messages')) {
    showToast('🚫 You do not have permission to delete messages.');
    return;
  }
  
  if (!confirm(`Delete message from ${escHtml(username)}?`)) return;
  if (!state.fb) return;
  
  try {
    await state.fb.firestore.collection('messages').doc(messageId).update({
      deleted_at: new Date(),
      deleted_by: String(state.currentUser.id),
    });
    
    await logAdminAction('delete_message', 'message', messageId, username);
    broadcast('message-deleted', messageId, {});
    showToast('✅ Message deleted.');
    loadMessages();
  } catch (err) {
    console.error('[Admin] Delete message error:', err);
    showToast('⚠️ Failed to delete message.');
  }
}

export async function editMessage(msg) {
  if (!hasPermission('can_edit_messages')) {
    showToast('🚫 You do not have permission to edit messages.');
    return;
  }
  
  const newContent = prompt('Edit message:', sanitiseHtml((msg.content || '').toString()).replace(/<[^>]*>/g, ''));
  if (newContent === null || newContent.trim() === (msg.content || '')) return;
  
  if (!state.fb) return;
  
  try {
    const sanitized = sanitiseHtml(newContent.trim());
    await state.fb.firestore.collection('messages').doc(msg.id).update({
      content: sanitized,
      original_content: msg.original_content || msg.content,
      edited_at: new Date(),
      edited_by: String(state.currentUser.id),
    });
    
    await logAdminAction('edit_message', 'message', msg.id, msg.username, { original: msg.content });
    broadcast('message-edited', msg.id, { content: sanitized });
    showToast('✅ Message edited.');
    loadMessages();
  } catch (err) {
    console.error('[Admin] Edit message error:', err);
    showToast('⚠️ Failed to edit message.');
  }
}

export async function restoreMessage(messageId) {
  if (!hasPermission('can_delete_messages')) {
    showToast('🚫 You do not have permission to restore messages.');
    return;
  }
  
  if (!state.fb) return;
  
  try {
    await state.fb.firestore.collection('messages').doc(messageId).update({
      deleted_at: null,
      deleted_by: null,
    });
    
    await logAdminAction('restore_message', 'message', messageId, null);
    showToast('✅ Message restored.');
    loadMessages();
  } catch (err) {
    console.error('[Admin] Restore message error:', err);
    showToast('⚠️ Failed to restore message.');
  }
}

/* ── Statistiche ──────────────────────────────────────────────── */
export async function loadStatistics() {
  if (!dom.adminStatisticsContent || !state.fb) return;
  
  const { checkAdminAccess } = await import('./admin.js');
  const hasAccess = await checkAdminAccess();
  if (!hasAccess && !hasPermission('can_view_statistics')) {
    dom.adminStatisticsContent.innerHTML = '<p class="admin-empty">🚫 You do not have permission to view statistics.</p>';
    return;
  }
  
  try {
    const [profilesSnap, messagesSnap, roomsSnap] = await Promise.all([
      state.fb.firestore.collection('profiles').get(),
      state.fb.firestore.collection('messages').get(),
      state.fb.firestore.collection('rooms').get(),
    ]);
    const userCount = profilesSnap.size;
    const messageCount = messagesSnap.size;
    const roomCount = roomsSnap.size;
    const onlineUsers = Object.keys(state.users || {}).length;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySnap = await state.fb.firestore.collection('messages').where('created_at', '>=', today).get();
    const messagesToday = todaySnap.size;
    
    dom.adminStatisticsContent.innerHTML = `
      <div class="admin-stat-card">
        <div class="admin-stat-value">${userCount || 0}</div>
        <div class="admin-stat-label">Total Users</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">${onlineUsers}</div>
        <div class="admin-stat-label">Online Now</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">${messageCount || 0}</div>
        <div class="admin-stat-label">Total Messages</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">${messagesToday || 0}</div>
        <div class="admin-stat-label">Messages Today</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">${roomCount || 0}</div>
        <div class="admin-stat-label">Rooms</div>
      </div>
    `;
  } catch (err) {
    console.error('[Admin] Load statistics error:', err);
    dom.adminStatisticsContent.innerHTML = '<p class="admin-empty">⚠️ Failed to load statistics.</p>';
  }
}

/* ── Log Admin ────────────────────────────────────────────────── */
export async function loadAdminLogs() {
  if (!dom.adminLogsList || !state.fb) return;
  
  if (!hasPermission('can_view_logs')) {
    dom.adminLogsList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to view logs.</p>';
    return;
  }
  
  try {
    const actionFilter = document.getElementById('adminLogsActionFilter')?.value || '';
    const searchQuery = document.getElementById('adminLogsSearch')?.value.toLowerCase() || '';
    
    let col = state.fb.firestore.collection('admin_logs').orderBy('created_at', 'desc').limit(200);
    if (actionFilter) col = state.fb.firestore.collection('admin_logs').where('action', '==', actionFilter).orderBy('created_at', 'desc').limit(200);
    const snap = await col.get();
    const data = snap.docs.map(d => ({ ...d.data(), id: d.id, created_at: d.data().created_at?.toDate?.() || d.data().created_at }));
    
    const filtered = searchQuery
      ? data.filter(log =>
          (log.admin_name || '').toLowerCase().includes(searchQuery) ||
          (log.target_name && log.target_name.toLowerCase().includes(searchQuery))
        )
      : data;
    
    dom.adminLogsList.innerHTML = '';
    if (!filtered || filtered.length === 0) {
      dom.adminLogsList.innerHTML = '<p class="admin-empty">No logs found.</p>';
      return;
    }
    
    filtered.forEach(log => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      const logTime = log.created_at?.toDate?.() || log.created_at;
      item.innerHTML = `
        <div class="admin-item-info">
          <div>
            <strong>${escHtml(log.action)}</strong>
            <span class="admin-item-id">by ${escHtml(log.admin_name || '')} | ${fmtTime(logTime ? new Date(logTime) : new Date())}</span>
          </div>
          ${log.target_name ? `<div style="margin-top: 4px; color: var(--tx2);">Target: ${escHtml(log.target_name)}</div>` : ''}
        </div>
      `;
      dom.adminLogsList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load logs error:', err);
    showToast('⚠️ Failed to load logs.');
  }
}

/* ── Annunci ──────────────────────────────────────────────────── */
export async function loadAnnouncements() {
  if (!dom.adminAnnouncementsList || !state.fb) return;
  
  await loadUserPermissions();
  if (!hasPermission('can_manage_announcements')) {
    dom.adminAnnouncementsList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to manage announcements.</p>';
    return;
  }
  
  try {
    const snap = await state.fb.firestore.collection('announcements').orderBy('priority', 'desc').orderBy('created_at', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    dom.adminAnnouncementsList.innerHTML = '';
    if (!data || data.length === 0) {
      dom.adminAnnouncementsList.innerHTML = '<p class="admin-empty">No announcements. Create one!</p>';
      return;
    }
    
    data.forEach(ann => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      const isExpired = ann.expires_at && new Date(ann.expires_at) < new Date();
      
      item.innerHTML = `
        <div class="admin-item-info">
          <div>
            <strong>${escHtml(ann.title)}</strong>
            <span class="admin-item-id">${ann.type} | ${fmtTime(new Date(ann.created_at))}</span>
            ${!ann.is_active ? '<span class="admin-badge">Inactive</span>' : ''}
            ${isExpired ? '<span class="admin-badge admin-badge-danger">Expired</span>' : ''}
            ${ann.is_persistent ? '<span class="admin-badge">Persistent</span>' : ''}
          </div>
          <div style="margin-top: 8px; color: var(--tx2);">${escHtml(ann.content.substring(0, 100))}${ann.content.length > 100 ? '...' : ''}</div>
        </div>
        <div class="admin-item-actions">
          <button class="admin-action-btn" data-action="edit" data-ann-id="${escHtml(String(ann.id))}">✏️ Edit</button>
          <button class="admin-action-btn ${ann.is_active ? 'admin-action-danger' : ''}" data-action="toggle" data-ann-id="${escHtml(String(ann.id))}">
            ${ann.is_active ? '⏸️ Deactivate' : '▶️ Activate'}
          </button>
          <button class="admin-action-btn admin-action-danger" data-action="delete" data-ann-id="${escHtml(String(ann.id))}">🗑️ Delete</button>
        </div>
      `;
      
      item.querySelector('[data-action="edit"]')?.addEventListener('click', () => openAnnouncementEditModal(ann));
      item.querySelector('[data-action="toggle"]')?.addEventListener('click', () => toggleAnnouncement(ann.id, !ann.is_active));
      item.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteAnnouncement(ann.id));
      dom.adminAnnouncementsList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load announcements error:', err);
    showToast('⚠️ Failed to load announcements.');
  }
}

/* ── Word Filter Management ───────────────────────────────────── */
export async function loadWordFilter() {
  const adminWordFilterList = document.getElementById('adminWordFilterList');
  if (!adminWordFilterList || !state.fb) return;
  
  await loadUserPermissions();
  const { checkAdminAccess } = await import('./admin.js');
  const hasAccess = await checkAdminAccess();
  const canModerate = hasPermission('can_mute') || hasPermission('can_kick');
  if (!hasAccess && !canModerate) {
    adminWordFilterList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to manage word filter.</p>';
    return;
  }
  
  try {
    const snap = await state.fb.firestore.collection('filtered_words').orderBy('word').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const searchTerm = (document.getElementById('adminWordFilterSearch')?.value || '').toLowerCase().trim();
    let filteredWords = data || [];
    
    if (searchTerm) {
      filteredWords = filteredWords.filter(w => 
        w.word.toLowerCase().includes(searchTerm) ||
        (w.replacement && w.replacement.toLowerCase().includes(searchTerm))
      );
    }
    
    adminWordFilterList.innerHTML = '';
    
    if (filteredWords.length === 0) {
      adminWordFilterList.innerHTML = '<p class="admin-empty">No filtered words found.</p>';
      return;
    }
    
    filteredWords.forEach(wordFilter => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      
      const actionBadge = {
        block: '<span class="admin-badge" style="background: #da3633;">Block</span>',
        replace: '<span class="admin-badge" style="background: #d29922;">Replace</span>',
        warn: '<span class="admin-badge" style="background: #1f6feb;">Warn</span>'
      }[wordFilter.action] || '';
      
      item.innerHTML = `
        <div class="admin-item-info">
          <strong>${escHtml(wordFilter.word)}</strong>
          ${actionBadge}
          ${wordFilter.replacement ? `<span class="admin-item-id">→ ${escHtml(wordFilter.replacement)}</span>` : ''}
        </div>
        <div class="admin-item-actions">
          <button class="admin-action-btn" data-action="edit" data-word-id="${escHtml(String(wordFilter.id))}">✏️ Edit</button>
          <button class="admin-action-btn admin-action-danger" data-action="delete" data-word-id="${escHtml(String(wordFilter.id))}">🗑️ Delete</button>
        </div>
      `;
      
      item.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
        openWordFilterEditModal(wordFilter);
      });
      
      item.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        deleteWordFilter(wordFilter.id, wordFilter.word);
      });
      
      adminWordFilterList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load word filter error:', err);
    showToast('⚠️ Failed to load word filter.');
  }
}

export async function saveWordFilter(wordId = null) {
  if (!state.fb || !state.currentUser) return;
  
  const wordInput = document.getElementById('wordFilterWordInput');
  const actionSelect = document.getElementById('wordFilterActionSelect');
  const replacementInput = document.getElementById('wordFilterReplacementInput');
  
  if (!wordInput || !actionSelect) return;
  
  const word = wordInput.value.trim().toLowerCase();
  const action = actionSelect.value;
  const replacement = replacementInput?.value.trim() || null;
  
  if (!word) {
    showToast('⚠️ Word cannot be empty.');
    return;
  }
  
  if (action === 'replace' && !replacement) {
    showToast('⚠️ Replacement word is required for "Replace" action.');
    return;
  }
  
  try {
    const wordData = {
      word,
      action,
      replacement: action === 'replace' ? replacement : null,
      created_by: String(state.currentUser.id),
    };
    
    if (wordId) {
      wordData.updated_at = new Date();
      await state.fb.firestore.collection('filtered_words').doc(wordId).update(wordData);
      await logAdminAction('update_word_filter', 'word_filter', wordId, word);
      showToast('✅ Word filter updated.');
    } else {
      const ref = await state.fb.firestore.collection('filtered_words').add(wordData);
      await logAdminAction('create_word_filter', 'word_filter', ref.id, word);
      showToast('✅ Word filter added.');
    }
    
    const wordFilterEditModal = document.getElementById('wordFilterEditModal');
    if (wordFilterEditModal) wordFilterEditModal.hidden = true;
    loadWordFilter();
    
    /* Refresh word filter cache */
    const { refreshFilteredWords } = await import('./word-filter.js');
    await refreshFilteredWords();
  } catch (err) {
    console.error('[Admin] Save word filter error:', err);
    showToast('⚠️ Failed to save word filter.');
  }
}

export async function deleteWordFilter(wordId, word) {
  if (!state.fb || !state.currentUser) return;
  
  if (!confirm(`Delete word filter "${word}"?`)) return;
  
  try {
    await state.fb.firestore.collection('filtered_words').doc(wordId).delete();
    
    await logAdminAction('delete_word_filter', 'word_filter', wordId, word);
    showToast('✅ Word filter deleted.');
    loadWordFilter();
    
    /* Refresh word filter cache */
    const { refreshFilteredWords } = await import('./word-filter.js');
    await refreshFilteredWords();
  } catch (err) {
    console.error('[Admin] Delete word filter error:', err);
    showToast('⚠️ Failed to delete word filter.');
  }
}

export function openWordFilterEditModal(wordFilter = null) {
  const wordFilterEditModal = document.getElementById('wordFilterEditModal');
  if (!wordFilterEditModal) {
    showToast('⚠️ Word filter modal not found.');
    return;
  }
  
  const wordInput = document.getElementById('wordFilterWordInput');
  const actionSelect = document.getElementById('wordFilterActionSelect');
  const replacementInput = document.getElementById('wordFilterReplacementInput');
  const replacementContainer = document.getElementById('wordFilterReplacementContainer');
  
  if (!wordInput || !actionSelect) return;
  
  if (wordFilter) {
    wordInput.value = wordFilter.word || '';
    actionSelect.value = wordFilter.action || 'block';
    if (replacementInput) replacementInput.value = wordFilter.replacement || '';
    document.getElementById('wordFilterEditModalTitle').textContent = 'Edit Word Filter';
  } else {
    wordInput.value = '';
    actionSelect.value = 'block';
    if (replacementInput) replacementInput.value = '';
    document.getElementById('wordFilterEditModalTitle').textContent = 'Add Word Filter';
  }
  
  /* Show/hide replacement input based on action */
  if (replacementContainer) {
    replacementContainer.hidden = actionSelect.value !== 'replace';
  }
  
  actionSelect.addEventListener('change', () => {
    if (replacementContainer) {
      replacementContainer.hidden = actionSelect.value !== 'replace';
    }
  });
  
  wordFilterEditModal.dataset.wordId = wordFilter?.id || '';
  wordFilterEditModal.hidden = false;
}

export function openAnnouncementEditModal(ann = null) {
  if (!dom.announcementEditModal) return;
  const title = document.getElementById('announcementEditModalTitle');
  
  if (title) title.textContent = ann ? 'Edit Announcement' : 'Create Announcement';
  
  if (ann) {
    document.getElementById('announcementEditId').value = ann.id;
    document.getElementById('announcementEditTitle').value = ann.title;
    document.getElementById('announcementEditContent').value = ann.content;
    document.getElementById('announcementEditType').value = ann.type || 'info';
    document.getElementById('announcementEditIsPersistent').checked = ann.is_persistent || false;
    if (ann.expires_at) {
      const date = new Date(ann.expires_at);
      const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      document.getElementById('announcementEditExpiresAt').value = localDate.toISOString().slice(0, 16);
    } else {
      document.getElementById('announcementEditExpiresAt').value = '';
    }
  } else {
    dom.announcementEditForm.reset();
    document.getElementById('announcementEditId').value = '';
  }
  
  /* Setup preview update listeners */
  setupAnnouncementPreview();
  updateAnnouncementPreview();
  
  dom.announcementEditModal.hidden = false;
}

/* ── Setup preview update listeners ─────────────────────────────── */
function setupAnnouncementPreview() {
  const titleInput = document.getElementById('announcementEditTitle');
  const contentInput = document.getElementById('announcementEditContent');
  const typeSelect = document.getElementById('announcementEditType');
  const persistentCheckbox = document.getElementById('announcementEditIsPersistent');
  
  if (titleInput) titleInput.addEventListener('input', updateAnnouncementPreview);
  if (contentInput) contentInput.addEventListener('input', updateAnnouncementPreview);
  if (typeSelect) typeSelect.addEventListener('change', updateAnnouncementPreview);
  if (persistentCheckbox) persistentCheckbox.addEventListener('change', updateAnnouncementPreview);
}

/* ── Update preview banner ───────────────────────────────────────── */
function updateAnnouncementPreview() {
  const previewContainer = document.getElementById('announcementPreviewContainer');
  const preview = document.getElementById('announcementPreview');
  if (!previewContainer || !preview) return;
  
  const title = document.getElementById('announcementEditTitle')?.value.trim() || '';
  const content = document.getElementById('announcementEditContent')?.value.trim() || '';
  const type = document.getElementById('announcementEditType')?.value || 'info';
  const isPersistent = document.getElementById('announcementEditIsPersistent')?.checked || false;
  
  /* Show preview only if there's content and it's persistent */
  if (title && content && isPersistent) {
    previewContainer.style.display = 'block';
    const typeClass = `announcement-${type}`;
    preview.className = `announcements-banner ${typeClass}`;
    preview.innerHTML = `
      <div class="announcement-content">
        <strong class="announcement-title">${escHtml(title)}</strong>
        <span class="announcement-text">${escHtml(content)}</span>
      </div>
      <button class="announcement-close" style="opacity: 0.5;" disabled>✕</button>
    `;
  } else if (title && content && !isPersistent) {
    /* Show preview for toast */
    previewContainer.style.display = 'block';
    preview.className = 'announcements-banner';
    const icon = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌',
    }[type] || 'ℹ️';
    preview.innerHTML = `
      <div class="announcement-content" style="padding: 12px; background: var(--bg3); border-radius: var(--r2); border-left: 4px solid var(--clr-primary);">
        <div style="font-size: var(--fz-sm); color: var(--tx0);">
          <strong>${icon} ${escHtml(title)}:</strong> ${escHtml(content)}
        </div>
        <div style="font-size: var(--fz-xs); color: var(--tx2); margin-top: 4px;">
          (Will appear as toast notification - bottom right, 8 seconds)
        </div>
      </div>
    `;
  } else {
    previewContainer.style.display = 'none';
  }
}

export async function saveAnnouncement() {
  if (!state.fb) return;
  
  const { checkAdminAccess } = await import('./admin.js');
  const hasAccess = await checkAdminAccess();
  if (!hasAccess && !hasPermission('can_manage_announcements')) {
    showToast('🚫 You do not have permission to manage announcements.');
    return;
  }
  
  const idInput = document.getElementById('announcementEditId');
  const id = idInput ? idInput.value.trim() : null;
  const title = document.getElementById('announcementEditTitle').value.trim();
  const content = document.getElementById('announcementEditContent').value.trim();
  const type = document.getElementById('announcementEditType').value;
  const isPersistent = document.getElementById('announcementEditIsPersistent').checked;
  const expiresAtInput = document.getElementById('announcementEditExpiresAt').value;
  const expiresAt = expiresAtInput ? new Date(expiresAtInput).toISOString() : null;
  
  if (!title || !content) {
    showToast('⚠️ Title and Content are required.');
    return;
  }
  
  try {
    const annData = {
      title: escHtml(title),
      content: escHtml(content),
      type,
      is_persistent: isPersistent,
      expires_at: expiresAt,
      created_by: String(state.currentUser.id),
    };
    
    if (id) {
      await state.fb.firestore.collection('announcements').doc(id).update(annData);
      await logAdminAction('update_announcement', 'announcement', id, title);
    } else {
      const ref = await state.fb.firestore.collection('announcements').add({ ...annData, created_at: new Date() });
      await logAdminAction('create_announcement', 'announcement', ref.id, title);
    }
    
    showToast('✅ Announcement saved!');
    dom.announcementEditModal.hidden = true;
    loadAnnouncements();
    broadcast('announcement-updated', null, {});
  } catch (err) {
    console.error('[Admin] Save announcement error:', err);
    showToast('⚠️ Failed to save announcement.');
  }
}

export async function toggleAnnouncement(annId, isActive) {
  if (!state.fb) return;
  
  try {
    await state.fb.firestore.collection('announcements').doc(annId).update({ is_active: isActive });
    
    await logAdminAction(isActive ? 'activate_announcement' : 'deactivate_announcement', 'announcement', annId, null);
    showToast(`✅ Announcement ${isActive ? 'activated' : 'deactivated'}.`);
    loadAnnouncements();
    broadcast('announcement-updated', null, {});
  } catch (err) {
    console.error('[Admin] Toggle announcement error:', err);
    showToast('⚠️ Failed to toggle announcement.');
  }
}

export async function deleteAnnouncement(annId) {
  if (!confirm('Delete this announcement?')) return;
  if (!state.fb) return;
  
  try {
    await state.fb.firestore.collection('announcements').doc(annId).delete();
    
    await logAdminAction('delete_announcement', 'announcement', annId, null);
    showToast('✅ Announcement deleted.');
    loadAnnouncements();
    broadcast('announcement-updated', null, {});
  } catch (err) {
    console.error('[Admin] Delete announcement error:', err);
    showToast('⚠️ Failed to delete announcement.');
  }
}

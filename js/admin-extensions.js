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
  if (!state.supa || !state.currentUser) return;
  
  try {
    await state.supa.from('admin_logs').insert({
      admin_id: String(state.currentUser.id),
      admin_name: state.currentUser.name || state.currentUser.username || 'Unknown',
      action,
      target_type: targetType,
      target_id: targetId ? String(targetId) : null,
      target_name: targetName || null,
      details,
      ip_address: null,
    });
  } catch (err) {
    console.error('[Admin] Error logging action:', err);
  }
}

/* ── Gestione Ruoli ──────────────────────────────────────────── */
export async function loadCustomRoles() {
  if (!dom.adminRolesList || !state.supa) return;
  try {
    const { data, error } = await state.supa
      .from('custom_roles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    
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
          <button class="admin-action-btn" data-action="edit" data-role-id="${role.id}">✏️ Edit</button>
          <button class="admin-action-btn admin-action-danger" data-action="delete" data-role-id="${role.id}">🗑️ Delete</button>
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
  } else {
    dom.roleEditForm.reset();
    document.getElementById('roleEditId').value = '';
    document.getElementById('permCanPostMessages').checked = true;
  }
  
  dom.roleEditModal.hidden = false;
}

/* Flag per prevenire doppi salvataggi */
let isSavingRole = false;

export async function saveRole() {
  if (!state.supa) return;
  
  /* Prevenire doppi salvataggi */
  if (isSavingRole) {
    console.log('[Admin] Save role already in progress, ignoring...');
    return;
  }
  
  isSavingRole = true;
  
  try {
    const idInput = document.getElementById('roleEditId');
    const id = idInput ? idInput.value.trim() : null;
    const name = document.getElementById('roleEditName').value.trim();
    const color = document.getElementById('roleEditColor').value;
    
    if (!name) {
      showToast('⚠️ Role Name is required.');
      isSavingRole = false;
      return;
    }
    
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
    };
    
    const { checkAdminAccess } = await import('./admin.js');
    const hasAccess = await checkAdminAccess();
    if (!hasAccess) {
      showToast('🚫 Admin access required.');
      isSavingRole = false;
      return;
    }
    
    const roleData = {
      name: escHtml(name),
      color,
      permissions,
      updated_at: new Date().toISOString(),
    };
    
    if (id && ['owner', 'admin', 'moderator', 'user'].includes(id)) {
      showToast('⚠️ Cannot modify system roles.');
      isSavingRole = false;
      return;
    }
    
    if (id) {
      roleData.id = id;
      const { error } = await state.supa
        .from('custom_roles')
        .update(roleData)
        .eq('id', id);
      if (error) throw error;
      await logAdminAction('update_role', 'role', id, name);
    } else {
      const roleId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      roleData.id = roleId;
      const { error } = await state.supa
        .from('custom_roles')
        .insert(roleData);
      if (error) throw error;
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
    showToast('⚠️ Failed to save role: ' + (err.message || 'Unknown error'));
  } finally {
    /* Re-enable save button */
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
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
  if (!state.supa) return;
  
  try {
    const { error } = await state.supa
      .from('custom_roles')
      .delete()
      .eq('id', roleId);
    if (error) throw error;
    
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
  if (!state.supa) {
    console.error('[Admin] Supabase not available');
    return false;
  }
  
  try {
    const { checkAdminAccess } = await import('./admin.js');
    const hasAccess = await checkAdminAccess();
    if (!hasAccess && !hasPermission('can_manage_users')) {
      showToast('🚫 You do not have permission to assign roles.');
      return false;
    }
    
    /* If roleId is empty string or null, set to null */
    const finalRoleId = roleId && roleId.trim() !== '' ? roleId.trim() : null;
    
    console.log('[Admin] Assigning role:', { userId, roleId, finalRoleId });
    
    /* First verify the role exists if not null */
    if (finalRoleId) {
      const { data: roleCheck, error: roleError } = await state.supa
        .from('custom_roles')
        .select('id')
        .eq('id', finalRoleId)
        .single();
      
      if (roleError || !roleCheck) {
        console.error('[Admin] Role not found:', finalRoleId);
        showToast('⚠️ Role not found.');
        return false;
      }
    }
    
    /* Find user in state first (before DB operations) */
    const user = state.users?.[userId] || Object.values(state.users || {}).find(u => u.id === userId);
    const userName = user?.name || userId;
    
    /* Determine if user is guest */
    const isGuest = String(userId).startsWith('guest_');
    
    /* For guests, assign default "guest" role if no role specified */
    let roleToAssign = finalRoleId;
    if (isGuest && !finalRoleId) {
      /* Check if "guest" role exists */
      const { data: guestRole } = await state.supa
        .from('custom_roles')
        .select('id')
        .eq('id', 'guest')
        .maybeSingle();
      
      if (guestRole) {
        roleToAssign = 'guest';
      }
    }
    
    /* Try to update existing profile first */
    const { error: updateError, count } = await state.supa
      .from('profiles')
      .update({ custom_role_id: roleToAssign })
      .eq('id', String(userId));
    
    if (updateError) {
      console.error('[Admin] Update profile error:', updateError);
      throw updateError;
    }
    
    /* If no rows were updated, create new profile */
    if (!count || count === 0) {
      console.log('[Admin] User not found in profiles table, creating profile:', userId);
      
      /* Try to create profile if it doesn't exist */
      const profileData = {
        id: String(userId),
        username: userName || (isGuest ? `Guest_${userId.slice(6, 12)}` : 'Unknown'),
        display_name: userName || (isGuest ? `Guest_${userId.slice(6, 12)}` : 'Unknown'),
        is_guest: isGuest,
        custom_role_id: roleToAssign || (isGuest ? 'guest' : null)
      };
      
      /* Only add role field for registered users */
      if (!isGuest) {
        profileData.role = 'user';
      }
      
      const { error: insertError } = await state.supa
        .from('profiles')
        .insert(profileData);
      
      if (insertError) {
        console.error('[Admin] Failed to create profile:', insertError);
        showToast('⚠️ User profile not found and could not be created: ' + (insertError.message || 'Unknown error'));
        return false;
      }
      
      console.log('[Admin] Profile created and role assigned');
    } else {
      console.log('[Admin] Role assigned successfully');
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
  if (!dom.adminMessagesList || !state.supa) return;
  
  try {
    const roomFilter = document.getElementById('adminMessagesRoomFilter')?.value || '';
    const statusFilter = document.getElementById('adminMessagesStatusFilter')?.value || 'all';
    const searchQuery = document.getElementById('adminMessagesSearch')?.value.toLowerCase() || '';
    
    let query = state.supa
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (roomFilter) {
      query = query.eq('room_id', roomFilter);
    }
    
    if (statusFilter === 'deleted') {
      query = query.not('deleted_at', 'is', null);
    } else if (statusFilter === 'reported') {
      /* Load reported messages separately */
      const { data: reported } = await state.supa
        .from('reported_messages')
        .select('message_id')
        .eq('status', 'pending');
      const reportedIds = reported?.map(r => r.message_id) || [];
      if (reportedIds.length > 0) {
        query = query.in('id', reportedIds);
      } else {
        dom.adminMessagesList.innerHTML = '<p class="admin-empty">No reported messages.</p>';
        return;
      }
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    dom.adminMessagesList.innerHTML = '';
    if (!data || data.length === 0) {
      dom.adminMessagesList.innerHTML = '<p class="admin-empty">No messages found.</p>';
      return;
    }
    
    /* Filter by search query */
    const filtered = searchQuery
      ? data.filter(msg => 
          msg.username.toLowerCase().includes(searchQuery) ||
          msg.content.toLowerCase().includes(searchQuery)
        )
      : data;
    
    filtered.forEach(msg => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      const isDeleted = !!msg.deleted_at;
      const contentPreview = sanitiseHtml(msg.content).substring(0, 100);
      
      item.innerHTML = `
        <div class="admin-item-info">
          <div>
            <strong>${escHtml(msg.username)}</strong>
            <span class="admin-item-id">${msg.room_id} | ${fmtTime(new Date(msg.created_at))}</span>
            ${isDeleted ? '<span class="admin-badge admin-badge-danger">Deleted</span>' : ''}
          </div>
          <div style="margin-top: 8px; color: var(--tx2); font-size: var(--fz-sm);">
            ${contentPreview}${msg.content.length > 100 ? '...' : ''}
          </div>
        </div>
        <div class="admin-item-actions">
          ${!isDeleted ? `
            <button class="admin-action-btn" data-action="delete" data-msg-id="${msg.id}">🗑️ Delete</button>
            <button class="admin-action-btn" data-action="edit" data-msg-id="${msg.id}">✏️ Edit</button>
          ` : `
            <button class="admin-action-btn" data-action="restore" data-msg-id="${msg.id}">↩️ Restore</button>
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
  if (!state.supa) return;
  
  try {
    const { error } = await state.supa
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: String(state.currentUser.id),
      })
      .eq('id', messageId);
    
    if (error) throw error;
    
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
  
  const newContent = prompt('Edit message:', sanitiseHtml(msg.content).replace(/<[^>]*>/g, ''));
  if (newContent === null || newContent.trim() === msg.content) return;
  
  if (!state.supa) return;
  
  try {
    const sanitized = sanitiseHtml(newContent.trim());
    const { error } = await state.supa
      .from('messages')
      .update({
        content: sanitized,
        original_content: msg.original_content || msg.content,
        edited_at: new Date().toISOString(),
        edited_by: String(state.currentUser.id),
      })
      .eq('id', msg.id);
    
    if (error) throw error;
    
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
  
  if (!state.supa) return;
  
  try {
    const { error } = await state.supa
      .from('messages')
      .update({
        deleted_at: null,
        deleted_by: null,
      })
      .eq('id', messageId);
    
    if (error) throw error;
    
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
  if (!dom.adminStatisticsContent || !state.supa) return;
  
  const { checkAdminAccess } = await import('./admin.js');
  const hasAccess = await checkAdminAccess();
  if (!hasAccess && !hasPermission('can_view_statistics')) {
    dom.adminStatisticsContent.innerHTML = '<p class="admin-empty">🚫 You do not have permission to view statistics.</p>';
    return;
  }
  
  try {
    /* Get user count */
    const { count: userCount } = await state.supa
      .from('profiles')
      .select('*', { count: 'exact', head: true });
    
    /* Get message count */
    const { count: messageCount } = await state.supa
      .from('messages')
      .select('*', { count: 'exact', head: true });
    
    /* Get room count */
    const { count: roomCount } = await state.supa
      .from('rooms')
      .select('*', { count: 'exact', head: true });
    
    /* Get online users (from presence) */
    const onlineUsers = Object.keys(state.users || {}).length;
    
    /* Get messages today */
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: messagesToday } = await state.supa
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());
    
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
  if (!dom.adminLogsList || !state.supa) return;
  
  if (!hasPermission('can_view_logs')) {
    dom.adminLogsList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to view logs.</p>';
    return;
  }
  
  try {
    const actionFilter = document.getElementById('adminLogsActionFilter')?.value || '';
    const searchQuery = document.getElementById('adminLogsSearch')?.value.toLowerCase() || '';
    
    let query = state.supa
      .from('admin_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    
    if (actionFilter) {
      query = query.eq('action', actionFilter);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    /* Filter by search */
    const filtered = searchQuery
      ? data.filter(log =>
          log.admin_name.toLowerCase().includes(searchQuery) ||
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
      item.innerHTML = `
        <div class="admin-item-info">
          <div>
            <strong>${escHtml(log.action)}</strong>
            <span class="admin-item-id">by ${escHtml(log.admin_name)} | ${fmtTime(new Date(log.created_at))}</span>
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
  if (!dom.adminAnnouncementsList || !state.supa) return;
  
  try {
    const { data, error } = await state.supa
      .from('announcements')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    
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
          <button class="admin-action-btn" data-action="edit" data-ann-id="${ann.id}">✏️ Edit</button>
          <button class="admin-action-btn ${ann.is_active ? 'admin-action-danger' : ''}" data-action="toggle" data-ann-id="${ann.id}">
            ${ann.is_active ? '⏸️ Deactivate' : '▶️ Activate'}
          </button>
          <button class="admin-action-btn admin-action-danger" data-action="delete" data-ann-id="${ann.id}">🗑️ Delete</button>
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
  
  dom.announcementEditModal.hidden = false;
}

export async function saveAnnouncement() {
  if (!state.supa) return;
  
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
      const { error } = await state.supa
        .from('announcements')
        .update(annData)
        .eq('id', id);
      if (error) throw error;
      await logAdminAction('update_announcement', 'announcement', id, title);
    } else {
      const { error } = await state.supa
        .from('announcements')
        .insert(annData);
      if (error) throw error;
      await logAdminAction('create_announcement', 'announcement', null, title);
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
  if (!state.supa) return;
  
  try {
    const { error } = await state.supa
      .from('announcements')
      .update({ is_active: isActive })
      .eq('id', annId);
    if (error) throw error;
    
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
  if (!state.supa) return;
  
  try {
    const { error } = await state.supa
      .from('announcements')
      .delete()
      .eq('id', annId);
    if (error) throw error;
    
    await logAdminAction('delete_announcement', 'announcement', annId, null);
    showToast('✅ Announcement deleted.');
    loadAnnouncements();
    broadcast('announcement-updated', null, {});
  } catch (err) {
    console.error('[Admin] Delete announcement error:', err);
    showToast('⚠️ Failed to delete announcement.');
  }
}

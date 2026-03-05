/* ================================================================
   admin.js  — admin panel: rooms, users, bans, IP blocks
================================================================ */
import { state }          from './state.js';
import { dom }            from './dom.js';
import { showToast, escHtml, sanitiseHtml } from './utils.js';
import { broadcast }      from './broadcast.js';
import { hasPermission, loadUserPermissions } from './permissions.js';

let currentUserRole = null;

/* ── Check if user is Owner or Admin ── */
export async function checkAdminAccess() {
  if (!state.supa || !state.currentUser) return false;
  try {
    const { data, error } = await state.supa
      .from('profiles')
      .select('role')
      .eq('id', state.currentUser.id)
      .single();
    if (error || !data) return false;
    currentUserRole = data.role || 'user';
    return currentUserRole === 'owner' || currentUserRole === 'admin';
  } catch {
    return false;
  }
}

/* ── Show/hide admin button based on role ── */
export async function updateAdminButton() {
  const hasAccess = await checkAdminAccess();
  if (dom.headerAdminBtn) {
    dom.headerAdminBtn.hidden = !hasAccess;
  }
}

/* ── Init admin panel ── */
export function initAdminPanel() {
  if (!dom.adminModal) return;

  /* Admin button click */
  dom.headerAdminBtn?.addEventListener('click', async () => {
    const hasAccess = await checkAdminAccess();
    if (hasAccess) {
      openAdminPanel();
    } else {
      showToast('🚫 Admin access required.');
    }
  });

  /* Close button */
  dom.adminModalClose?.addEventListener('click', () => {
    dom.adminModal.hidden = true;
  });

  /* Tab switching */
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchAdminTab(tabName);
    });
  });

  /* Create room button */
  dom.adminCreateRoomBtn?.addEventListener('click', () => {
    openRoomEditModal();
  });

  /* Block IP button */
  dom.adminBlockIpBtn?.addEventListener('click', () => {
    openBlockIpModal();
  });

  /* Create role button */
  dom.adminCreateRoleBtn?.addEventListener('click', () => {
    openRoleEditModal();
  });

  /* Create announcement button */
  document.getElementById('adminCreateAnnouncementBtn')?.addEventListener('click', () => {
    openAnnouncementEditModal();
  });

  /* Role edit modal */
  dom.roleEditModalClose?.addEventListener('click', () => {
    dom.roleEditModal.hidden = true;
  });
  dom.roleEditCancelBtn?.addEventListener('click', () => {
    dom.roleEditModal.hidden = true;
  });
  dom.roleEditForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveRole();
  });

  /* Announcement edit modal */
  dom.announcementEditModalClose?.addEventListener('click', () => {
    dom.announcementEditModal.hidden = true;
  });
  dom.announcementEditCancelBtn?.addEventListener('click', () => {
    dom.announcementEditModal.hidden = true;
  });
  dom.announcementEditForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveAnnouncement();
  });

  /* Message filters */
  document.getElementById('adminMessagesRoomFilter')?.addEventListener('change', loadMessages);
  document.getElementById('adminMessagesStatusFilter')?.addEventListener('change', loadMessages);
  document.getElementById('adminMessagesSearch')?.addEventListener('input', (e) => {
    clearTimeout(window.messageSearchTimeout);
    window.messageSearchTimeout = setTimeout(loadMessages, 500);
  });

  /* Log filters */
  document.getElementById('adminLogsActionFilter')?.addEventListener('change', loadAdminLogs);
  document.getElementById('adminLogsSearch')?.addEventListener('input', (e) => {
    clearTimeout(window.logSearchTimeout);
    window.logSearchTimeout = setTimeout(loadAdminLogs, 500);
  });

  /* Room edit modal */
  dom.roomEditModalClose?.addEventListener('click', () => {
    dom.roomEditModal.hidden = true;
  });
  dom.roomEditCancelBtn?.addEventListener('click', () => {
    dom.roomEditModal.hidden = true;
  });
  dom.roomEditForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveRoom();
  });
}

function switchAdminTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
  const tabId = tabName.charAt(0).toUpperCase() + tabName.slice(1);
  document.getElementById(`adminTab${tabId}`)?.classList.add('active');
  
  /* Load tab data */
  if (tabName === 'rooms') loadRooms();
  else if (tabName === 'users') loadUsers();
  else if (tabName === 'roles') loadCustomRoles();
  else if (tabName === 'messages') loadMessages();
  else if (tabName === 'banned') loadBannedUsers();
  else if (tabName === 'ips') loadBannedIPs();
  else if (tabName === 'announcements') loadAnnouncements();
  else if (tabName === 'statistics') loadStatistics();
  else if (tabName === 'logs') loadAdminLogs();
  else if (tabName === 'themes') loadThemes();
}

async function openAdminPanel() {
  dom.adminModal.hidden = false;
  switchAdminTab('rooms');
}

/* ── Rooms Management ── */
async function loadRooms() {
  if (!dom.adminRoomsList || !state.supa) return;
  try {
    const { data, error } = await state.supa.from('rooms').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    
    dom.adminRoomsList.innerHTML = '';
    if (!data || data.length === 0) {
      dom.adminRoomsList.innerHTML = '<p class="admin-empty">No rooms yet. Create one!</p>';
      return;
    }
    
    data.forEach(room => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      item.innerHTML = `
        <div class="admin-item-info">
          <span class="admin-item-icon">${room.icon || '💬'}</span>
          <div>
            <strong>${escHtml(room.name)}</strong>
            <span class="admin-item-id">ID: ${escHtml(String(room.id))}</span>
          </div>
        </div>
        <div class="admin-item-meta">
          <span class="admin-badge ${room.is_open ? 'admin-badge-success' : 'admin-badge-danger'}">
            ${room.is_open ? 'Open' : 'Closed'}
          </span>
          ${room.password ? '<span class="admin-badge">🔒 Password</span>' : ''}
        </div>
        <div class="admin-item-actions">
          <button class="admin-action-btn" data-action="edit" data-room-id="${room.id}">✏️ Edit</button>
          <button class="admin-action-btn admin-action-danger" data-action="delete" data-room-id="${room.id}">🗑️ Delete</button>
        </div>
      `;
      item.querySelector('[data-action="edit"]')?.addEventListener('click', () => openRoomEditModal(room));
      item.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteRoom(room.id));
      dom.adminRoomsList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load rooms error:', err);
    showToast('⚠️ Failed to load rooms.');
  }
}

function openRoomEditModal(room = null) {
  if (!dom.roomEditModal) return;
  const form = dom.roomEditForm;
  const title = document.getElementById('roomEditModalTitle');
  const idInput = document.getElementById('roomEditId');
  
  const isEventsCheckbox = document.getElementById('roomEditIsEventsRoom');
  const eventsOptions = document.getElementById('roomEditEventsOptions');
  const maxCamsInput = document.getElementById('roomEditMaxCams');
  const isGamesCheckbox = document.getElementById('roomEditIsGamesRoom');
  
  /* Toggle events options visibility */
  const toggleEventsOptions = () => {
    if (isEventsCheckbox.checked) {
      eventsOptions.style.display = 'block';
      if (!maxCamsInput.value) maxCamsInput.value = '4'; /* Default to 4 */
    } else {
      eventsOptions.style.display = 'none';
      maxCamsInput.value = '';
    }
  };
  
  isEventsCheckbox.onchange = toggleEventsOptions;
  
  if (room) {
    title.textContent = 'Edit Room';
    if (idInput) {
      idInput.value = room.id;
      idInput.disabled = true;
      idInput.parentElement.style.display = 'block'; // Mostra il campo ID in edit
    }
    document.getElementById('roomEditName').value = room.name;
    document.getElementById('roomEditIcon').value = room.icon || '';
    document.getElementById('roomEditIsOpen').checked = room.is_open;
    document.getElementById('roomEditPassword').value = '';
    document.getElementById('roomEditPassword').placeholder = 'Leave empty to keep current password';
    isEventsCheckbox.checked = !!(room.max_cams && room.max_cams >= 1 && room.max_cams <= 8);
    maxCamsInput.value = room.max_cams || '';
    isGamesCheckbox.checked = room.is_games_room === true;
    toggleEventsOptions();
  } else {
    title.textContent = 'Create New Room';
    form.reset();
    if (idInput) {
      idInput.value = '';
      idInput.disabled = true; // ID è auto-generato
      idInput.parentElement.style.display = 'none'; // Nascondi il campo ID in creazione
    }
    document.getElementById('roomEditPassword').placeholder = 'Leave empty for no password';
    isEventsCheckbox.checked = false;
    isGamesCheckbox.checked = false;
    toggleEventsOptions();
  }
  dom.roomEditModal.hidden = false;
}

async function saveRoom() {
  if (!state.supa) return;
  const form = dom.roomEditForm;
  const idInput = document.getElementById('roomEditId');
  const id = idInput ? parseInt(idInput.value.trim()) : null;
  const name = document.getElementById('roomEditName').value.trim();
  const icon = document.getElementById('roomEditIcon').value.trim() || '💬';
  const isOpen = document.getElementById('roomEditIsOpen').checked;
  const password = document.getElementById('roomEditPassword').value.trim();
  const isEventsRoom = document.getElementById('roomEditIsEventsRoom').checked;
  const maxCamsInput = document.getElementById('roomEditMaxCams').value.trim();
  const maxCams = isEventsRoom && maxCamsInput ? parseInt(maxCamsInput, 10) : null;
  const isGamesRoom = document.getElementById('roomEditIsGamesRoom').checked;
  
  /* Security: Validate input */
  if (!name) {
    showToast('⚠️ Room Name is required.');
    return;
  }
  
  const { MAX_ROOM_NAME_LENGTH } = await import('./config.js');
  if (name.length > MAX_ROOM_NAME_LENGTH) {
    showToast(`⚠️ Room name too long (max ${MAX_ROOM_NAME_LENGTH} characters).`);
    return;
  }
  
  /* Security: Validate maxCams range */
  if (maxCams !== null && (isNaN(maxCams) || maxCams < 1 || maxCams > 8)) {
    showToast('⚠️ Max cameras must be between 1 and 8.');
    return;
  }
  
  /* Security: Sanitize room name */
  const sanitizedName = escHtml(name);
  
  try {
    /* Security: Verify admin access before saving */
    const hasAccess = await checkAdminAccess();
    if (!hasAccess) {
      showToast('🚫 Admin access required.');
      return;
    }
    
    const roomData = {
      name: sanitizedName,
      icon: icon.substring(0, 10), /* Limit icon length */
      is_open: isOpen,
      created_by: String(state.currentUser.id), /* Security: Ensure string */
      password: password ? await hashPassword(password) : null,
      max_cams: (isEventsRoom && maxCams && maxCams >= 1 && maxCams <= 8) ? maxCams : null,
      is_games_room: isGamesRoom,
    };
    
    // Se è un edit, aggiungi l'ID
    if (id && !isNaN(id)) {
      roomData.id = id;
    }
    
    const { data, error } = await state.supa
      .from('rooms')
      .upsert(roomData, { onConflict: id ? 'id' : undefined })
      .select()
      .single();
    
    if (error) throw error;
    
    await logAdminActionLocal(id ? 'update_room' : 'create_room', 'room', id || data.id, sanitizedName);
    showToast('✅ Room saved!');
    dom.roomEditModal.hidden = true;
    loadRooms();
    
    // Ricarica le stanze disponibili e aggiorna i tab
    const { loadRoomsFromDB, renderRoomTabs } = await import('./rooms.js');
    await loadRoomsFromDB();
    renderRoomTabs();
  } catch (err) {
    console.error('[Admin] Save room error:', err);
    showToast('⚠️ Failed to save room.');
  }
}

async function deleteRoom(roomId) {
  /* Security: Verify admin access */
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    showToast('🚫 Admin access required.');
    return;
  }
  
  /* Security: Validate roomId */
  if (!roomId || (typeof roomId !== 'string' && typeof roomId !== 'number')) {
    showToast('⚠️ Invalid room ID.');
    return;
  }
  
  if (!confirm(`Delete room "${escHtml(String(roomId))}"? This cannot be undone.`)) return;
  if (!state.supa) return;
  
  try {
    const { error } = await state.supa.from('rooms').delete().eq('id', roomId);
    if (error) throw error;
    await logAdminActionLocal('delete_room', 'room', String(roomId), String(roomId));
    showToast('✅ Room deleted.');
    loadRooms();
  } catch (err) {
    console.error('[Admin] Delete room error:', err);
    showToast('⚠️ Failed to delete room.');
  }
}

/* ── Users Management ── */
async function loadUsers() {
  if (!dom.adminUsersList || !state.supa) return;
  try {
    const users = Object.values(state.rooms[state.activeRoom]?.users || {});
    dom.adminUsersList.innerHTML = '';
    
    if (users.length === 0) {
      dom.adminUsersList.innerHTML = '<p class="admin-empty">No users online.</p>';
      return;
    }
    
    users.forEach(user => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      item.innerHTML = `
        <div class="admin-item-info">
          <span class="admin-item-avatar">${user.name.charAt(0).toUpperCase()}</span>
          <div>
            <strong>${escHtml(user.name)}</strong>
            <span class="admin-item-id">ID: ${escHtml(user.id)}</span>
          </div>
        </div>
        <div class="admin-item-actions">
          <select class="admin-role-select" data-user-id="${user.id}" onchange="assignRoleToUserFromSelect('${user.id}', this.value)">
            <option value="">Assign Role...</option>
          </select>
          <button class="admin-action-btn" data-action="kick" data-user-id="${user.id}">👢 Kick</button>
          <button class="admin-action-btn" data-action="mute" data-user-id="${user.id}">🔇 Mute</button>
          <button class="admin-action-btn admin-action-danger" data-action="ban" data-user-id="${user.id}">🚫 Ban</button>
        </div>
      `;
      item.querySelector('[data-action="kick"]')?.addEventListener('click', () => kickUser(user.id, user.name));
      item.querySelector('[data-action="mute"]')?.addEventListener('click', () => muteUser(user.id, user.name));
      item.querySelector('[data-action="ban"]')?.addEventListener('click', () => banUser(user.id, user.name));
      dom.adminUsersList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load users error:', err);
    showToast('⚠️ Failed to load users.');
  }
}

async function kickUser(userId, userName) {
  /* Security: Verify admin access */
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    showToast('🚫 Admin access required.');
    return;
  }
  
  /* Security: Validate userId */
  if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
    showToast('⚠️ Invalid user ID.');
    return;
  }
  
  if (!confirm(`Kick ${escHtml(userName)}?`)) return;
  if (!state.supa) return;
  
  /* Broadcast kick event */
  broadcast('user-kicked', String(userId), { reason: 'Kicked by admin' });
  showToast(`👢 Kicked ${escHtml(userName)}`);
  loadUsers();
}

async function muteUser(userId, userName) {
  /* Security: Verify admin access */
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    showToast('🚫 Admin access required.');
    return;
  }
  
  /* Security: Validate userId */
  if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
    showToast('⚠️ Invalid user ID.');
    return;
  }
  
  const duration = prompt(`Mute ${escHtml(userName)} for how many minutes? (0 = permanent)`);
  if (duration === null) return;
  const mins = Math.max(0, Math.min(10080, parseInt(duration) || 0)); /* Max 1 week */
  if (!state.supa) return;
  
  try {
    const expiresAt = mins > 0 ? new Date(Date.now() + mins * 60 * 1000).toISOString() : null;
    const { error } = await state.supa.from('muted_users').upsert({
      user_id: String(userId), /* Security: Ensure string */
      muted_by: String(state.currentUser.id), /* Security: Ensure string */
      expires_at: expiresAt,
    }, { onConflict: 'user_id' });
    
    if (error) throw error;
    
    /* Broadcast mute event */
    broadcast('user-muted', userId, { duration: mins });
    await logAdminActionLocal('mute', 'user', userId, userName, { duration: mins });
    showToast(`🔇 Muted ${userName} ${mins > 0 ? `for ${mins} minutes` : 'permanently'}`);
    loadUsers();
  } catch (err) {
    console.error('[Admin] Mute error:', err);
    showToast('⚠️ Failed to mute user.');
  }
}

async function banUser(userId, userName) {
  /* Security: Verify admin access */
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    showToast('🚫 Admin access required.');
    return;
  }
  
  /* Security: Validate userId */
  if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
    showToast('⚠️ Invalid user ID.');
    return;
  }
  
  const reason = prompt(`Ban ${escHtml(userName)}. Reason:`);
  if (reason === null) return;
  const sanitizedReason = (reason || 'Banned by admin').substring(0, 500); /* Limit reason length */
  if (!state.supa) return;
  
  try {
    const { error } = await state.supa.from('banned_users').upsert({
      user_id: String(userId), /* Security: Ensure string */
      username: escHtml(userName).substring(0, 50), /* Security: Sanitize and limit */
      reason: escHtml(sanitizedReason), /* Security: Sanitize reason */
      banned_by: String(state.currentUser.id), /* Security: Ensure string */
    }, { onConflict: 'user_id' });
    
    if (error) throw error;
    
    /* Broadcast ban event */
    broadcast('user-banned', userId, { reason: reason || 'Banned by admin' });
    showToast(`🚫 Banned ${userName}`);
    loadUsers();
    loadBannedUsers();
  } catch (err) {
    console.error('[Admin] Ban error:', err);
    showToast('⚠️ Failed to ban user.');
  }
}

/* ── Banned Users ── */
async function loadBannedUsers() {
  if (!dom.adminBannedList || !state.supa) return;
  try {
    const { data, error } = await state.supa
      .from('banned_users')
      .select('*')
      .order('banned_at', { ascending: false });
    if (error) throw error;
    
    dom.adminBannedList.innerHTML = '';
    if (!data || data.length === 0) {
      dom.adminBannedList.innerHTML = '<p class="admin-empty">No banned users.</p>';
      return;
    }
    
    data.forEach(ban => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      item.innerHTML = `
        <div class="admin-item-info">
          <strong>${escHtml(ban.username)}</strong>
          <span class="admin-item-id">ID: ${escHtml(ban.user_id)}</span>
          ${ban.reason ? `<p class="admin-item-reason">${escHtml(ban.reason)}</p>` : ''}
        </div>
        <div class="admin-item-actions">
          <button class="admin-action-btn" data-action="unban" data-user-id="${ban.user_id}">✅ Unban</button>
        </div>
      `;
      item.querySelector('[data-action="unban"]')?.addEventListener('click', () => unbanUser(ban.user_id));
      dom.adminBannedList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load banned users error:', err);
    showToast('⚠️ Failed to load banned users.');
  }
}

async function unbanUser(userId) {
  /* Security: Verify admin access */
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    showToast('🚫 Admin access required.');
    return;
  }
  
  /* Security: Validate userId */
  if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
    showToast('⚠️ Invalid user ID.');
    return;
  }
  
  if (!state.supa) return;
  try {
    const { error } = await state.supa.from('banned_users').delete().eq('user_id', String(userId));
    if (error) throw error;
    showToast('✅ User unbanned.');
    loadBannedUsers();
  } catch (err) {
    console.error('[Admin] Unban error:', err);
    showToast('⚠️ Failed to unban user.');
  }
}

/* ── Banned IPs ── */
async function loadBannedIPs() {
  if (!dom.adminIpsList || !state.supa) return;
  try {
    const { data, error } = await state.supa
      .from('banned_ips')
      .select('*')
      .order('banned_at', { ascending: false });
    if (error) throw error;
    
    dom.adminIpsList.innerHTML = '';
    if (!data || data.length === 0) {
      dom.adminIpsList.innerHTML = '<p class="admin-empty">No blocked IPs.</p>';
      return;
    }
    
    data.forEach(ban => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      item.innerHTML = `
        <div class="admin-item-info">
          <strong>${escHtml(ban.ip)}</strong>
          ${ban.reason ? `<p class="admin-item-reason">${escHtml(ban.reason)}</p>` : ''}
        </div>
        <div class="admin-item-actions">
          <button class="admin-action-btn" data-action="unblock" data-ip="${ban.ip}">✅ Unblock</button>
        </div>
      `;
      item.querySelector('[data-action="unblock"]')?.addEventListener('click', () => unblockIP(ban.ip));
      dom.adminIpsList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load banned IPs error:', err);
    showToast('⚠️ Failed to load blocked IPs.');
  }
}

function openBlockIpModal() {
  const ip = prompt('Enter IP address or CIDR range (e.g., 192.168.1.0/24):');
  if (!ip) return;
  const reason = prompt('Reason for blocking:');
  if (reason === null) return;
  blockIP(ip, reason || '');
}

async function blockIP(ip, reason) {
  /* Security: Verify admin access */
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    showToast('🚫 Admin access required.');
    return;
  }
  
  /* Security: Validate IP format (basic validation) */
  if (!ip || typeof ip !== 'string' || !/^[\d.]+$/.test(ip.replace(/:/g, ''))) {
    showToast('⚠️ Invalid IP address.');
    return;
  }
  
  if (!state.supa) return;
  try {
    const sanitizedReason = (reason || 'Blocked by admin').substring(0, 500); /* Limit reason length */
    const { error } = await state.supa.from('banned_ips').insert({
      ip: escHtml(ip).substring(0, 45), /* Security: Sanitize and limit IP */
      reason: escHtml(sanitizedReason), /* Security: Sanitize reason */
      banned_by: String(state.currentUser.id), /* Security: Ensure string */
    });
    if (error) throw error;
    showToast('✅ IP blocked.');
    loadBannedIPs();
  } catch (err) {
    console.error('[Admin] Block IP error:', err);
    showToast('⚠️ Failed to block IP.');
  }
}

async function unblockIP(ip) {
  /* Security: Verify admin access */
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    showToast('🚫 Admin access required.');
    return;
  }
  
  /* Security: Validate IP format */
  if (!ip || typeof ip !== 'string') {
    showToast('⚠️ Invalid IP address.');
    return;
  }
  
  if (!state.supa) return;
  try {
    const { error } = await state.supa.from('banned_ips').delete().eq('ip', escHtml(ip));
    if (error) throw error;
    showToast('✅ IP unblocked.');
    loadBannedIPs();
  } catch (err) {
    console.error('[Admin] Unblock IP error:', err);
    showToast('⚠️ Failed to unblock IP.');
  }
}

/* ── Themes Management ── */
async function loadThemes() {
  const list = document.getElementById('adminThemesList');
  if (!list || !state.supa) return;
  
  try {
    const { getAllThemes } = await import('./themes.js');
    const themes = await getAllThemes();
    
    list.innerHTML = '';
    if (!themes || themes.length === 0) {
      list.innerHTML = '<p class="admin-empty">No themes found.</p>';
      return;
    }
    
    themes.forEach(theme => {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      item.innerHTML = `
        <div class="admin-item-info">
          <strong>${theme.display_name || theme.name}</strong>
          <div class="admin-item-id">ID: ${theme.id}</div>
          ${theme.is_default ? '<span class="admin-badge admin-badge-success">Default</span>' : ''}
          ${theme.is_custom ? '<span class="admin-badge">Custom</span>' : ''}
        </div>
        <div class="admin-item-actions">
          ${theme.is_custom ? `<button class="admin-action-btn admin-action-danger" onclick="window.deleteTheme('${theme.id}')">🗑️ Delete</button>` : ''}
        </div>
      `;
      list.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load themes error:', err);
    showToast('⚠️ Failed to load themes.');
  }
}

window.deleteTheme = async function(themeId) {
  if (!confirm('Are you sure you want to delete this theme?')) return;
  const { deleteTheme } = await import('./themes.js');
  if (await deleteTheme(themeId)) {
    loadThemes();
  }
};

/* ── Password hashing (simple, should use proper hashing in production) ── */
async function hashPassword(password) {
  // Simple base64 encoding for now - in production use bcrypt or similar
  return btoa(password);
}

/* ================================================================
   NUOVE FUNZIONALITÀ ADMIN - Ruoli, Moderazione, Statistiche, Log, Annunci
================================================================ */

/* ── Import nuove funzionalità ───────────────────────────────── */
import {
  logAdminAction,
  loadCustomRoles,
  openRoleEditModal,
  saveRole,
  deleteRole,
  assignRoleToUser,
  loadMessages,
  deleteMessage,
  editMessage,
  restoreMessage,
  loadStatistics,
  loadAdminLogs,
  loadAnnouncements,
  openAnnouncementEditModal,
  saveAnnouncement,
  toggleAnnouncement,
  deleteAnnouncement,
} from './admin-extensions.js';

/* ── Popola select ruoli ─────────────────────────────────────── */
async function populateRoleSelect(select, currentRoleId = null) {
  if (!state.supa) return;
  
  try {
    const { data, error } = await state.supa
      .from('custom_roles')
      .select('id, name')
      .order('name');
    if (error) throw error;
    
    /* Clear existing options except first */
    while (select.options.length > 1) {
      select.remove(1);
    }
    
    /* Add "No Role" option */
    const noRoleOption = document.createElement('option');
    noRoleOption.value = '';
    noRoleOption.textContent = 'No Role';
    if (!currentRoleId) noRoleOption.selected = true;
    select.appendChild(noRoleOption);
    
    /* Add roles */
    data.forEach(role => {
      const option = document.createElement('option');
      option.value = role.id;
      option.textContent = role.name;
      if (role.id === currentRoleId) option.selected = true;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('[Admin] Error populating role select:', err);
  }
}

/* ── Log azione admin (wrapper) ───────────────────────────────── */
async function logAdminActionLocal(action, targetType, targetId, targetName, details = {}) {
  await logAdminAction(action, targetType, targetId, targetName, details);
}

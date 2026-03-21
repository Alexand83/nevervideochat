/* ================================================================
   admin.js  — admin panel: rooms, users, bans, IP blocks
================================================================ */
import { state }          from './state.js';
import { dom }            from './dom.js';
import { showToast, escHtml, sanitiseHtml } from './utils.js';
import { broadcast }      from './broadcast.js';
import { clearBroadcastHistory } from './firebase-client.js';
import { hasPermission, loadUserPermissions } from './permissions.js';
import { renderUsers }    from './users.js?v=20260462';
import { addSystemMessage } from './chat.js?v=20260461';

let currentUserRole = null;

/* ── Check if user is Owner or Admin ── */
export async function checkAdminAccess() {
  if (!state.fb || !state.currentUser) return false;
  try {
    const snap = await state.fb.firestore.collection('profiles').doc(state.currentUser.id).get();
    const data = snap?.data();
    if (!data) return false;
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

  /* Tab switching - sidebar items */
  document.querySelectorAll('.admin-sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      const tabName = item.dataset.tab;
      switchAdminTab(tabName);
    });
  });

  /* Anti-spam (General tab) */
  document.getElementById('antispamSaveBtn')?.addEventListener('click', () => {
    saveChatAntispamFromAdminForm();
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


  /* Create word filter button */
  document.getElementById('adminCreateWordFilterBtn')?.addEventListener('click', async () => {
    const { openWordFilterEditModal } = await import('./admin-extensions.js');
    openWordFilterEditModal();
  });

  /* Word filter search */
  document.getElementById('adminWordFilterSearch')?.addEventListener('input', (e) => {
    clearTimeout(window.wordFilterSearchTimeout);
    window.wordFilterSearchTimeout = setTimeout(async () => {
      const { loadWordFilter } = await import('./admin-extensions.js');
      await loadWordFilter();
    }, 300);
  });

  /* Word filter modal */
  document.getElementById('wordFilterEditModalClose')?.addEventListener('click', () => {
    document.getElementById('wordFilterEditModal').hidden = true;
  });
  document.getElementById('wordFilterEditCancelBtn')?.addEventListener('click', () => {
    document.getElementById('wordFilterEditModal').hidden = true;
  });
  document.getElementById('wordFilterEditForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { saveWordFilter } = await import('./admin-extensions.js');
    const modal = document.getElementById('wordFilterEditModal');
    const wordId = modal?.dataset.wordId || null;
    await saveWordFilter(wordId);
  });

  /* Role edit modal */
  dom.roleEditModalClose?.addEventListener('click', () => {
    dom.roleEditModal.hidden = true;
  });
  dom.roleEditCancelBtn?.addEventListener('click', () => {
    dom.roleEditModal.hidden = true;
  });
  /* Role edit form - use one-time handler to prevent duplicates */
  if (dom.roleEditForm && !dom.roleEditForm.dataset.listenerAttached) {
    dom.roleEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { saveRole } = await import('./admin-extensions.js');
      await saveRole();
    });
    dom.roleEditForm.dataset.listenerAttached = 'true';
  }

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

  /* Users filters */
  document.getElementById('adminUsersSearch')?.addEventListener('input', (e) => {
    clearTimeout(window.usersSearchTimeout);
    window.usersSearchTimeout = setTimeout(async () => {
      await filterAndRenderUsers();
    }, 300);
  });
  document.getElementById('adminUsersRoleFilter')?.addEventListener('change', async () => {
    await filterAndRenderUsers();
  });
  document.getElementById('adminUsersStatusFilter')?.addEventListener('change', async () => {
    await filterAndRenderUsers();
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

async function switchAdminTab(tabName) {
  /* Update sidebar items */
  document.querySelectorAll('.admin-sidebar-item').forEach(item => item.classList.remove('active'));
  document.querySelector(`.admin-sidebar-item[data-tab="${tabName}"]`)?.classList.add('active');
  
  /* Update tab content */
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  const tabId = tabName.charAt(0).toUpperCase() + tabName.slice(1);
  document.getElementById(`adminTab${tabId}`)?.classList.add('active');
  
  /* Load tab data */
  if (tabName === 'general') loadGeneralAdminSettings();
  else if (tabName === 'rooms') loadRooms();
  else if (tabName === 'users') {
    await loadUsers();
    await populateUsersRoleFilter();
  }
  else if (tabName === 'roles') loadCustomRoles();
  else if (tabName === 'messages') loadMessages();
  else if (tabName === 'banned') initRestrictionsPanel();
  else if (tabName === 'ips') loadBannedIPs();
  else if (tabName === 'announcements') loadAnnouncements();
  else if (tabName === 'statistics') loadStatistics();
  else if (tabName === 'logs') loadAdminLogs();
  else if (tabName === 'themes') loadThemes();
  else if (tabName === 'wordfilter') {
    const { loadWordFilter } = await import('./admin-extensions.js');
    await loadWordFilter();
  }
  else if (tabName === 'polls') {
    const { loadPollsAdmin } = await import('./polls.js');
    await loadPollsAdmin();
  }
}

async function loadGeneralAdminSettings() {
  if (!state.fb) return;
  await checkAdminAccess();
  const isOwner = currentUserRole === 'owner';
  const saveBtn = document.getElementById('antispamSaveBtn');
  const hint = document.getElementById('antispamOwnerOnlyHint');
  if (saveBtn) {
    saveBtn.hidden = !isOwner;
    saveBtn.disabled = !isOwner;
  }
  if (hint) hint.hidden = isOwner;

  try {
    const snap = await state.fb.firestore.collection('config').doc('chat_antispam').get();
    const data = snap.data();
    const { DEFAULT_CHAT_ANTISPAM, applyChatAntispamFromDoc } = await import('./chat-antispam.js');
    const cfg = { ...DEFAULT_CHAT_ANTISPAM, ...(data || {}) };
    applyChatAntispamFromDoc(cfg);

    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = String(v);
    };
    setVal('antispamPublicMinMs', cfg.publicMinMs);
    setVal('antispamPublicMaxPerMin', cfg.publicMaxPerMinute);
    setVal('antispamPublicDupMs', cfg.publicDuplicateWindowMs);
    setVal('antispamPmMinMs', cfg.pmMinMs);
    setVal('antispamPmMaxPerMin', cfg.pmMaxPerMinute);
    setVal('antispamPmDupMs', cfg.pmDuplicateWindowMs);
  } catch (err) {
    console.warn('[Admin] load chat_antispam:', err);
    showToast('⚠️ Impossibile caricare anti-spam da database.');
  }
}

async function saveChatAntispamFromAdminForm() {
  if (!state.fb) return;
  await checkAdminAccess();
  if (currentUserRole !== 'owner') {
    showToast('🚫 Solo il proprietario può salvare le impostazioni anti-spam.');
    return;
  }
  try {
    const { buildChatAntispamPayloadFromForm } = await import('./chat-antispam.js');
    const g = (id) => parseFloat(document.getElementById(id)?.value);
    const payload = buildChatAntispamPayloadFromForm({
      publicMinMs: g('antispamPublicMinMs'),
      publicMaxPerMinute: g('antispamPublicMaxPerMin'),
      publicDuplicateWindowMs: g('antispamPublicDupMs'),
      pmMinMs: g('antispamPmMinMs'),
      pmMaxPerMinute: g('antispamPmMaxPerMin'),
      pmDuplicateWindowMs: g('antispamPmDupMs'),
    });
    await state.fb.firestore.collection('config').doc('chat_antispam').set(payload, { merge: true });
    showToast('✅ Anti-spam salvato nel database.');
  } catch (err) {
    console.error('[Admin] save chat_antispam:', err);
    showToast('⚠️ Salvataggio anti-spam fallito.');
  }
}

async function openAdminPanel() {
  await loadUserPermissions(); /* Load permissions before opening */
  dom.adminModal.hidden = false;
  switchAdminTab('rooms');
}

/* ── Rooms Management ── */
async function loadRooms() {
  if (!dom.adminRoomsList || !state.fb) return;
  
  /* Check permissions */
  await loadUserPermissions();
  if (!hasPermission('can_manage_rooms')) {
    dom.adminRoomsList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to manage rooms.</p>';
    return;
  }
  
  try {
    const snap = await state.fb.firestore.collection('rooms').orderBy('created_at', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
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
  if (!state.fb) return;
  const form = dom.roomEditForm;
  const idInput = document.getElementById('roomEditId');
  const id = idInput ? idInput.value.trim() || null : null;
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
    const hasAccess = await checkAdminAccess();
    if (!hasAccess) {
      showToast('🚫 Admin access required.');
      return;
    }
    
    const roomData = {
      name: sanitizedName,
      icon: icon.substring(0, 10),
      is_open: isOpen,
      created_by: String(state.currentUser.id),
      password: password ? await hashPassword(password) : null,
      max_cams: (isEventsRoom && maxCams && maxCams >= 1 && maxCams <= 8) ? maxCams : null,
      is_games_room: isGamesRoom,
    };
    
    const col = state.fb.firestore.collection('rooms');
    let savedId;
    if (id) {
      await col.doc(id).set(roomData, { merge: true });
      savedId = id;
    } else {
      const ref = await col.add({ ...roomData, created_at: new Date() });
      savedId = ref.id;
    }
    
    await logAdminActionLocal(id ? 'update_room' : 'create_room', 'room', savedId, sanitizedName);
    showToast('✅ Room saved!');
    dom.roomEditModal.hidden = true;
    const { loadRoomsFromDB, renderRoomTabs } = await import('./rooms.js');
    await loadRoomsFromDB();
    renderRoomTabs();
    await loadRooms();
  } catch (err) {
    console.error('[Admin] Save room error:', err);
    showToast('⚠️ Failed to save room.');
  }
}

async function deleteRoom(roomId) {
  /* Check permissions */
  if (!hasPermission('can_manage_rooms')) {
    showToast('🚫 You do not have permission to delete rooms.');
    return;
  }
  
  /* Security: Validate roomId */
  if (!roomId || (typeof roomId !== 'string' && typeof roomId !== 'number')) {
    showToast('⚠️ Invalid room ID.');
    return;
  }
  
  if (!confirm(`Delete room "${escHtml(String(roomId))}"? This cannot be undone.`)) return;
  if (!state.fb) return;
  
  try {
    await state.fb.firestore.collection('rooms').doc(String(roomId)).delete();
    await logAdminActionLocal('delete_room', 'room', String(roomId), String(roomId));
    showToast('✅ Room deleted.');
    const { loadRoomsFromDB, renderRoomTabs, switchRoom } = await import('./rooms.js');
    await loadRoomsFromDB();
    /* Se la stanza cancellata era in state.rooms, rimuovila e passa a un'altra */
    const roomIdStr = String(roomId);
    if (state.rooms[roomIdStr]) {
      state.rooms[roomIdStr].presenceCh?.unsubscribe?.();
      state.rooms[roomIdStr].dbSub?.unsubscribe?.();
      delete state.rooms[roomIdStr];
      if (state.activeRoom === roomIdStr) {
        const remaining = Object.keys(state.rooms);
        if (remaining.length) switchRoom(remaining[0]);
      }
    }
    renderRoomTabs();
    await loadRooms();
  } catch (err) {
    console.error('[Admin] Delete room error:', err);
    showToast('⚠️ Failed to delete room.');
  }
}

/* ── Users Management ── */
let allUsersCache = []; // Cache per filtri

async function loadUsers() {
  if (!dom.adminUsersList || !state.fb) return;
  
  /* Check permissions */
  await loadUserPermissions();
  if (!hasPermission('can_manage_users')) {
    dom.adminUsersList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to manage users.</p>';
    return;
  }
  
  try {
    const profilesSnap = await state.fb.firestore.collection('profiles').where('is_guest', '==', false).orderBy('display_name').get();
    const rolesSnap = await state.fb.firestore.collection('custom_roles').get();
    const roleMap = {};
    rolesSnap.docs.forEach(d => { roleMap[d.id] = d.data(); });
    
    const allProfiles = profilesSnap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, custom_roles: data.custom_role_id ? roleMap[data.custom_role_id] : null };
    });
    
    const onlineUsers = Object.values(state.rooms[state.activeRoom]?.users || {});
    const onlineUserIds = new Set(onlineUsers.map(u => u.id));
    
    allUsersCache = allProfiles.map(profile => {
      const isOnline = onlineUserIds.has(profile.id);
      return {
        id: profile.id,
        name: profile.display_name || profile.username || profile.id,
        username: profile.username,
        is_guest: profile.is_guest,
        is_online: isOnline,
        custom_role_id: profile.custom_role_id,
        custom_roles: profile.custom_roles
      };
    });
    
    /* Apply filters and render */
    await filterAndRenderUsers();
  } catch (err) {
    console.error('[Admin] Load users error:', err);
    showToast('⚠️ Failed to load users.');
  }
}

async function filterAndRenderUsers() {
  if (!dom.adminUsersList) return;
  
  const searchTerm = (document.getElementById('adminUsersSearch')?.value || '').toLowerCase().trim();
  const roleFilter = document.getElementById('adminUsersRoleFilter')?.value || '';
  const statusFilter = document.getElementById('adminUsersStatusFilter')?.value || '';
  
  let filteredUsers = [...allUsersCache];
  
  /* Apply search filter */
  if (searchTerm) {
    filteredUsers = filteredUsers.filter(user => 
      user.name.toLowerCase().includes(searchTerm) ||
      (user.username && user.username.toLowerCase().includes(searchTerm)) ||
      user.id.toLowerCase().includes(searchTerm)
    );
  }
  
  /* Apply role filter */
  if (roleFilter) {
    filteredUsers = filteredUsers.filter(user => 
      user.custom_role_id === roleFilter
    );
  }
  
  /* Apply status filter */
  if (statusFilter) {
    filteredUsers = filteredUsers.filter(user => 
      statusFilter === 'online' ? user.is_online : !user.is_online
    );
  }
  
  if (filteredUsers.length === 0) {
    dom.adminUsersList.innerHTML = '<p class="admin-empty">No users found matching your filters.</p>';
    return;
  }
  
  const profileMap = {};
  allUsersCache.forEach(u => {
    profileMap[u.id] = u;
  });
  
  dom.adminUsersList.innerHTML = '';
  
  for (const user of filteredUsers) {
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      const profile = profileMap[user.id];
      const customRole = profile?.custom_roles;
      const roleBadge = customRole 
        ? `<span class="admin-badge" style="background: ${customRole.color || '#8b949e'}; margin-left: 8px;">${escHtml(customRole.name)}</span>`
        : '';
      
      const onlineBadge = user.is_online ? '<span class="admin-badge" style="background: #4caf50; margin-left: 8px;">Online</span>' : '<span class="admin-badge" style="background: #9e9e9e; margin-left: 8px;">Offline</span>';
      
      item.innerHTML = `
        <div class="admin-item-info">
          <span class="admin-item-avatar">${escHtml((user.name || '?').charAt(0).toUpperCase() || '?')}</span>
          <div>
            <strong>${escHtml(user.name)}</strong>
            <span class="admin-item-id">ID: ${escHtml(user.id)}</span>
            ${onlineBadge}
            ${roleBadge}
          </div>
        </div>
        <div class="admin-item-actions">
          <select class="admin-role-select" data-user-id="${user.id}">
            <option value="">Assign Role...</option>
          </select>
          <button class="admin-action-btn" data-action="kick" data-user-id="${user.id}">👢 Kick</button>
          <button class="admin-action-btn" data-action="mute" data-user-id="${user.id}">🔇 Mute</button>
          <button class="admin-action-btn" data-action="disconnect" data-user-id="${user.id}">⏏ Disconnect</button>
          <button class="admin-action-btn admin-action-danger" data-action="ban" data-user-id="${user.id}">🚫 Ban</button>
        </div>
      `;
      item.querySelector('[data-action="kick"]')?.addEventListener('click', () => kickUser(user.id, user.name));
      item.querySelector('[data-action="mute"]')?.addEventListener('click', () => muteUser(user.id, user.name));
      item.querySelector('[data-action="disconnect"]')?.addEventListener('click', () => disconnectUser(user.id, user.name));
      item.querySelector('[data-action="ban"]')?.addEventListener('click', () => banUser(user.id, user.name));
      
      /* Populate role select */
      const roleSelect = item.querySelector('.admin-role-select');
      if (roleSelect) {
        await populateRoleSelect(roleSelect, profile?.custom_role_id);
        /* Remove existing listeners to prevent duplicates */
        const newSelect = roleSelect.cloneNode(true);
        roleSelect.parentNode.replaceChild(newSelect, roleSelect);
        /* Add new listener */
        newSelect.addEventListener('change', async (e) => {
          const { assignRoleToUser } = await import('./admin-extensions.js');
          const success = await assignRoleToUser(user.id, e.target.value || null);
          if (success) {
            /* Wait a bit for DB to update, then reload */
            setTimeout(() => {
              loadUsers(); /* Reload to show updated role */
            }, 500);
          } else {
            /* Reset to current role if assignment failed */
            const currentProfile = profileMap[user.id];
            await populateRoleSelect(newSelect, currentProfile?.custom_role_id);
          }
        });
      }
      
      dom.adminUsersList.appendChild(item);
    }
}

/* ── Populate role filter dropdown ── */
async function populateUsersRoleFilter() {
  const roleFilter = document.getElementById('adminUsersRoleFilter');
  if (!roleFilter || !state.fb) return;
  
  try {
    const snap = await state.fb.firestore.collection('custom_roles').orderBy('name').get();
    const roles = snap.docs.map(d => ({ id: d.id, name: d.data().name }));
    
    const currentValue = roleFilter.value;
    roleFilter.innerHTML = '<option value="">All Roles</option>';
    
    if (roles.length > 0) {
      roles.forEach(role => {
        const option = document.createElement('option');
        option.value = role.id;
        option.textContent = role.name;
        roleFilter.appendChild(option);
      });
    }
    
    /* Restore selection if it still exists */
    if (currentValue) {
      const option = roleFilter.querySelector(`option[value="${currentValue}"]`);
      if (option) roleFilter.value = currentValue;
    }
  } catch (err) {
    console.error('[Admin] Error populating role filter:', err);
  }
}

async function kickUser(userId, userName) {
  /* Check permissions */
  if (!hasPermission('can_kick')) {
    showToast('🚫 You do not have permission to kick users.');
    return;
  }
  
  /* Security: Validate userId */
  if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
    showToast('⚠️ Invalid user ID.');
    return;
  }
  
  if (!confirm(`Kick ${escHtml(userName)}?`)) return;
  if (!state.fb) return;

  try {
    const uidStr = String(userId);
    const displayName =
      (userName && String(userName).trim()) ||
      state.rooms?.[String(state.activeRoom)]?.users?.[uidStr]?.name ||
      state.lastKnownNames?.[uidStr] ||
      state.users?.find?.(u => String(u.id) === uidStr)?.name ||
      'Guest';
    state.lastKnownNames[uidStr] = displayName;

    /* Scrivi in DB così il client della vittima verifica e esce davvero (e rimuove presenza) */
    const mins = 5;
    const expiresAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
    const col = state.fb.firestore.collection('kicked_users');
    const payload = { user_id: String(userId), username: userName || null, kicked_by: String(state.currentUser.id), expires_at: expiresAt };
    const roomsSnap = await state.fb.firestore.collection('rooms').get();
    for (const doc of roomsSnap.docs) {
      await col.doc(`${userId}_${doc.id}`).set({ ...payload, room_id: doc.id }, { merge: true });
    }
    broadcast('user-kicked', String(userId), { room_id: null, expires_at: expiresAt, is_global: true });
    /* Togli subito dalla lista in tutte le stanze (kick globale) */
    for (const rId of Object.keys(state.rooms || {})) {
      state.suppressLeaveSystemMsg[String(rId) + ':' + uidStr] = { ts: Date.now(), reason: 'kick' };
      if (state.rooms[rId]?.users[uidStr]) delete state.rooms[rId].users[uidStr];
    }
    renderUsers();
    if (state.activeRoom) addSystemMessage(`👢 ${displayName} è stato kickato`, String(state.activeRoom));
    showToast(`👢 Kicked ${escHtml(displayName)}`);
    loadUsers();
  } catch (err) {
    console.error('[Admin] Kick error:', err);
    showToast('⚠️ Failed to kick user.');
  }
}

async function disconnectUser(userId, userName) {
  /* Check permissions */
  if (!hasPermission('can_disconnect')) {
    showToast('🚫 You do not have permission to disconnect users.');
    return;
  }

  /* Security: Validate userId */
  if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
    showToast('⚠️ Invalid user ID.');
    return;
  }

  if (!confirm(`Disconnect ${escHtml(userName)}? This will log them out and return them to login.`)) return;
  if (!state.fb) return;

  try {
    broadcast('force-disconnect', String(userId), {});
    /* Rimuovi subito l'utente da tutte le liste locali (come per kick) */
    const uidStr = String(userId);
    for (const rId of Object.keys(state.rooms || {})) {
      if (state.rooms[rId]?.users[uidStr]) delete state.rooms[rId].users[uidStr];
    }
    renderUsers();
    await logAdminActionLocal('disconnect', 'user', String(userId), userName);
    showToast(`⏏ Disconnected ${escHtml(userName)}`);
  } catch (err) {
    console.error('[Admin] Disconnect error:', err);
    showToast('⚠️ Failed to disconnect user.');
  }
}

async function muteUser(userId, userName) {
  /* Check permissions */
  if (!hasPermission('can_mute')) {
    showToast('🚫 You do not have permission to mute users.');
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
  if (!state.fb) return;
  
  try {
    const expiresAt = mins > 0 ? new Date(Date.now() + mins * 60 * 1000).toISOString() : null;
    await state.fb.firestore.collection('muted_users').doc(`${String(userId)}_global`).set({
      user_id: String(userId),
      room_id: null,
      muted_by: String(state.currentUser.id),
      expires_at: expiresAt,
    }, { merge: true });
    
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
  /* Check permissions */
  if (!hasPermission('can_ban')) {
    showToast('🚫 You do not have permission to ban users.');
    return;
  }
  
  /* Security: Validate userId */
  if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
    showToast('⚠️ Invalid user ID.');
    return;
  }
  
  const reason = prompt(`Ban ${escHtml(userName)}. Reason:`);
  if (reason === null) return;
  const sanitizedReason = (reason || 'Banned by admin').substring(0, 500);
  if (!state.fb) return;
  
  try {
    const uidStr = String(userId);
    const displayName =
      (userName && String(userName).trim()) ||
      state.rooms?.[String(state.activeRoom)]?.users?.[uidStr]?.name ||
      state.lastKnownNames?.[uidStr] ||
      state.users?.find?.(u => String(u.id) === uidStr)?.name ||
      'Guest';
    state.lastKnownNames[uidStr] = displayName;

    await state.fb.firestore.collection('banned_users').doc(String(userId)).set({
      user_id: String(userId),
      username: escHtml(displayName).substring(0, 50),
      reason: escHtml(sanitizedReason),
      banned_by: String(state.currentUser.id),
      banned_at: new Date(),
    }, { merge: true });
    state.bannedUserIds?.add?.(String(userId));
    
    /* Broadcast ban event */
    broadcast('user-banned', userId, { reason: reason || 'Banned by admin' });
    /* Togli subito dalla lista in tutte le stanze (come kick/disconnect) */
    for (const rId of Object.keys(state.rooms || {})) {
      state.suppressLeaveSystemMsg[String(rId) + ':' + uidStr] = { ts: Date.now(), reason: 'ban' };
      if (state.rooms[rId]?.users[uidStr]) delete state.rooms[rId].users[uidStr];
    }
    renderUsers();
    await clearBroadcastHistory(); /* niente replay al reconnect */
    if (state.activeRoom) addSystemMessage(`🚫 ${displayName} è stato bannato`, String(state.activeRoom));
    showToast(`🚫 Banned ${displayName}`);
    loadUsers();
    loadBannedUsers();
  } catch (err) {
    console.error('[Admin] Ban error:', err);
    showToast('⚠️ Failed to ban user.');
  }
}

/* ── Banned / Kicked / Muted panel ── */
function initRestrictionsPanel() {
  if (!dom.adminBannedList) return;
  document.querySelectorAll('.admin-subtab').forEach(btn => btn.classList.remove('active'));
  document.querySelector('.admin-subtab[data-restriction="banned"]')?.classList.add('active');
  document.querySelectorAll('.admin-restriction-list').forEach(el => { el.hidden = true; });
  dom.adminBannedList.hidden = false;
  loadBannedUsers();
  loadKickedUsers();
  loadMutedUsers();
  document.querySelectorAll('.admin-subtab').forEach(btn => {
    btn.replaceWith(btn.cloneNode(true));
  });
  document.querySelectorAll('.admin-subtab').forEach(btn => {
    btn.addEventListener('click', () => switchRestrictionSubtab(btn.dataset.restriction));
  });
}

function switchRestrictionSubtab(restriction) {
  document.querySelectorAll('.admin-subtab').forEach(b => b.classList.remove('active'));
  document.querySelector(`.admin-subtab[data-restriction="${restriction}"]`)?.classList.add('active');
  document.querySelectorAll('.admin-restriction-list').forEach(el => { el.hidden = true; });
  const list = document.querySelector(`.admin-restriction-list[data-list="${restriction}"]`);
  if (list) list.hidden = false;
}

/* ── Banned Users ── */
async function loadBannedUsers() {
  if (!dom.adminBannedList || !state.fb) return;
  
  await loadUserPermissions();
  if (!hasPermission('can_ban')) {
    dom.adminBannedList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to view banned users.</p>';
    return;
  }
  
  try {
    /* Carica TUTTI i documenti senza orderBy, così non escludiamo doc senza banned_at (es. guest o vecchi) */
    const snap = await state.fb.firestore.collection('banned_users').get();
    const data = snap.docs.map(d => {
      const data_ = d.data();
      return { docId: d.id, user_id: data_.user_id ?? d.id, ...data_ };
    });
    data.sort((a, b) => {
      const ta = a.banned_at?.toDate?.()?.getTime?.() ?? (a.banned_at ? new Date(a.banned_at).getTime() : 0);
      const tb = b.banned_at?.toDate?.()?.getTime?.() ?? (b.banned_at ? new Date(b.banned_at).getTime() : 0);
      return tb - ta;
    });
    
    dom.adminBannedList.innerHTML = '';
    if (!data || data.length === 0) {
      dom.adminBannedList.innerHTML = '<p class="admin-empty">No banned users.</p>';
      return;
    }
    
    data.forEach(ban => {
      const uid = String(ban.user_id);
      const isGuest = uid.startsWith('guest_');
      const guestBadge = isGuest ? '<span class="admin-badge" style="background: #6e7681; margin-left: 6px;">Guest</span>' : '';
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      item.innerHTML = `
        <div class="admin-item-info">
          <strong>${escHtml(ban.username || uid)}</strong>${guestBadge}
          <span class="admin-item-id">ID: ${escHtml(uid)}</span>
          ${ban.reason ? `<p class="admin-item-reason">${escHtml(ban.reason)}</p>` : ''}
        </div>
        <div class="admin-item-actions">
          <button class="admin-action-btn" data-action="unban" data-doc-id="${ban.docId}">✅ Unban</button>
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
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    showToast('🚫 Admin access required.');
    return;
  }
  if (!userId || typeof userId !== 'string') {
    showToast('⚠️ Invalid user.');
    return;
  }
  if (!state.fb) return;
  try {
    /* Delete ALL ban documents for this user (avoids duplicates / reappearing ban) */
    const snap = await state.fb.firestore.collection('banned_users').where('user_id', '==', userId).get();
    const batch = state.fb.firestore.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    if (snap.docs.length) {
      await batch.commit();
      state.bannedUserIds?.delete?.(String(userId));
      broadcast('user-unbanned', userId, {});
      await clearBroadcastHistory();
    }
    showToast('✅ User unbanned.');
    loadBannedUsers();
  } catch (err) {
    console.error('[Admin] Unban error:', err);
    showToast('⚠️ Failed to unban user.');
  }
}

/* ── Kicked Users ── */
async function loadKickedUsers() {
  if (!dom.adminKickedList || !state.fb) return;
  await loadUserPermissions();
  if (!hasPermission('can_kick')) {
    dom.adminKickedList.innerHTML = '<p class="admin-empty">🚫 No permission to view kicked users.</p>';
    return;
  }
  try {
    const snap = await state.fb.firestore.collection('kicked_users').get();
    const data = snap.docs.map(d => {
      const data_ = d.data();
      return { docId: d.id, user_id: data_.user_id ?? d.id, room_id: data_.room_id, expires_at: data_.expires_at, ...data_ };
    });
    data.sort((a, b) => (b.expires_at || '').localeCompare(a.expires_at || ''));
    dom.adminKickedList.innerHTML = '';
    if (!data.length) {
      dom.adminKickedList.innerHTML = '<p class="admin-empty">No kicked users.</p>';
      return;
    }
    data.forEach(row => {
      const uid = String(row.user_id);
      const hasName = row.username && String(row.username).trim();
      const looksLikeFirebaseUid = uid.length >= 20 && /^[a-zA-Z0-9]+$/.test(uid);
      const isGuest = uid.startsWith('guest_') || (looksLikeFirebaseUid && !hasName);
      const displayName = hasName ? row.username : (uid.startsWith('guest_') || looksLikeFirebaseUid ? 'Guest' : uid);
      const guestBadge = isGuest ? '<span class="admin-badge" style="background: #6e7681; margin-left: 6px;">Guest</span>' : '';
      const roomLabel = row.room_id ? `Room: ${escHtml(row.room_id)}` : 'Global';
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      item.innerHTML = `
        <div class="admin-item-info">
          <strong>${escHtml(displayName)}</strong>${guestBadge}
          <span class="admin-item-id">${roomLabel}</span>
        </div>
        <div class="admin-item-actions">
          <button class="admin-action-btn" data-action="unkick">✅ Remove kick</button>
        </div>
      `;
      item.querySelector('[data-action="unkick"]')?.addEventListener('click', () => unkickUser(row.docId));
      dom.adminKickedList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load kicked users error:', err);
    showToast('⚠️ Failed to load kicked users.');
  }
}

async function unkickUser(docId) {
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) { showToast('🚫 Admin access required.'); return; }
  if (!docId || typeof docId !== 'string') { showToast('⚠️ Invalid document.'); return; }
  if (!state.fb) return;
  try {
    await state.fb.firestore.collection('kicked_users').doc(docId).delete();
    showToast('✅ Kick removed.');
    loadKickedUsers();
  } catch (err) {
    console.error('[Admin] Unkick error:', err);
    showToast('⚠️ Failed to remove kick.');
  }
}

/* ── Muted Users ── */
async function loadMutedUsers() {
  if (!dom.adminMutedList || !state.fb) return;
  await loadUserPermissions();
  if (!hasPermission('can_mute')) {
    dom.adminMutedList.innerHTML = '<p class="admin-empty">🚫 No permission to view muted users.</p>';
    return;
  }
  try {
    const snap = await state.fb.firestore.collection('muted_users').get();
    const data = snap.docs.map(d => {
      const data_ = d.data();
      return { docId: d.id, user_id: data_.user_id ?? d.id, room_id: data_.room_id, expires_at: data_.expires_at, ...data_ };
    });
    data.sort((a, b) => (b.expires_at || '').localeCompare(a.expires_at || ''));
    dom.adminMutedList.innerHTML = '';
    if (!data.length) {
      dom.adminMutedList.innerHTML = '<p class="admin-empty">No muted users.</p>';
      return;
    }
    data.forEach(row => {
      const uid = String(row.user_id);
      const hasName = row.username && String(row.username).trim();
      const looksLikeFirebaseUid = uid.length >= 20 && /^[a-zA-Z0-9]+$/.test(uid);
      const isGuest = uid.startsWith('guest_') || (looksLikeFirebaseUid && !hasName);
      const displayName = hasName ? row.username : (uid.startsWith('guest_') || looksLikeFirebaseUid ? 'Guest' : uid);
      const guestBadge = isGuest ? '<span class="admin-badge" style="background: #6e7681; margin-left: 6px;">Guest</span>' : '';
      const roomLabel = row.room_id ? `Room: ${escHtml(row.room_id)}` : 'Global';
      const item = document.createElement('div');
      item.className = 'admin-list-item';
      item.innerHTML = `
        <div class="admin-item-info">
          <strong>${escHtml(displayName)}</strong>${guestBadge}
          <span class="admin-item-id">${roomLabel}</span>
        </div>
        <div class="admin-item-actions">
          <button class="admin-action-btn" data-action="unmute">✅ Unmute</button>
        </div>
      `;
      item.querySelector('[data-action="unmute"]')?.addEventListener('click', () => unmuteUser(row.user_id));
      dom.adminMutedList.appendChild(item);
    });
  } catch (err) {
    console.error('[Admin] Load muted users error:', err);
    showToast('⚠️ Failed to load muted users.');
  }
}

async function unmuteUser(userId) {
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) { showToast('🚫 Admin access required.'); return; }
  if (!userId || typeof userId !== 'string') { showToast('⚠️ Invalid user.'); return; }
  if (!state.fb) return;
  try {
    /* Delete ALL mute documents for this user (per-room + global) so unmute is complete */
    const snap = await state.fb.firestore.collection('muted_users').where('user_id', '==', userId).get();
    const batch = state.fb.firestore.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    if (snap.docs.length) await batch.commit();
    broadcast('user-unmuted', userId, { room_id: null });
    await clearBroadcastHistory();
    showToast('✅ User unmuted.');
    loadMutedUsers();
  } catch (err) {
    console.error('[Admin] Unmute error:', err);
    showToast('⚠️ Failed to unmute.');
  }
}

/* ── Banned IPs ── */
async function loadBannedIPs() {
  if (!dom.adminIpsList || !state.fb) return;
  
  await loadUserPermissions();
  if (!hasPermission('can_ban')) {
    dom.adminIpsList.innerHTML = '<p class="admin-empty">🚫 You do not have permission to view IP blocks.</p>';
    return;
  }
  
  try {
    const snap = await state.fb.firestore.collection('banned_ips').orderBy('banned_at', 'desc').get();
    const data = snap.docs.map(d => ({ ...d.data(), ip: d.data().ip ?? d.id }));
    
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
  
  if (!state.fb) return;
  try {
    const sanitizedReason = (reason || 'Blocked by admin').substring(0, 500);
    const safeIp = escHtml(ip).substring(0, 45).replace(/[/]/g, '_');
    await state.fb.firestore.collection('banned_ips').doc(safeIp).set({
      ip: escHtml(ip).substring(0, 45),
      reason: escHtml(sanitizedReason),
      banned_by: String(state.currentUser.id),
      banned_at: new Date(),
    }, { merge: true });
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
  
  if (!state.fb) return;
  try {
    const safeIp = String(ip).replace(/[/]/g, '_').substring(0, 45);
    await state.fb.firestore.collection('banned_ips').doc(safeIp).delete();
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
  if (!list || !state.fb) return;
  
  /* Check permissions - solo owner/admin possono gestire temi */
  await loadUserPermissions();
  const { checkAdminAccess } = await import('./admin.js');
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    list.innerHTML = '<p class="admin-empty">🚫 You do not have permission to manage themes.</p>';
    return;
  }
  
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
          <strong>${escHtml(theme.display_name || theme.name)}</strong>
          <div class="admin-item-id">ID: ${theme.id}</div>
          ${theme.is_default ? '<span class="admin-badge admin-badge-success">Default</span>' : ''}
          ${theme.is_custom ? '<span class="admin-badge">Custom</span>' : ''}
        </div>
        <div class="admin-item-actions">
          ${theme.is_custom ? `<button class="admin-action-btn admin-action-danger" data-theme-id="${escHtml(String(theme.id))}" type="button">🗑️ Delete</button>` : ''}
        </div>
      `;
      list.appendChild(item);
      const delBtn = item.querySelector('button[data-theme-id]');
      if (delBtn) delBtn.addEventListener('click', () => window.deleteTheme(theme.id));
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

/* ── Password hashing (SHA-256, sicuro per confronto lato client o RPC) ── */
async function hashPassword(password) {
  if (!password || typeof password !== 'string') return null;
  try {
    const buf = new Uint8Array(new TextEncoder().encode(password));
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    console.error('[Admin] hashPassword failed:', e);
    return null;
  }
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
  if (!state.fb) return;
  
  try {
    const snap = await state.fb.firestore.collection('custom_roles').orderBy('name').get();
    const data = snap.docs.map(d => ({ id: d.id, name: d.data().name }));
    
    select.innerHTML = '';
    const noRoleOption = document.createElement('option');
    noRoleOption.value = '';
    noRoleOption.textContent = currentRoleId ? '— Remove Role —' : '— No Role —';
    if (!currentRoleId) noRoleOption.selected = true;
    select.appendChild(noRoleOption);
    
    data.forEach(role => {
      const option = document.createElement('option');
      option.value = role.id;
      option.textContent = role.name;
      if (role.id === currentRoleId) {
        option.selected = true;
        option.textContent = `✓ ${role.name}`;
      }
      select.appendChild(option);
    });
  } catch (err) {
    console.error('[Admin] Error populating role select:', err);
  }
}

/* ── Export per uso in admin-extensions ───────────────────────── */
export { populateRoleSelect };

/* ── Log azione admin (wrapper) ───────────────────────────────── */
async function logAdminActionLocal(action, targetType, targetId, targetName, details = {}) {
  await logAdminAction(action, targetType, targetId, targetName, details);
}

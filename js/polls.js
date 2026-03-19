/* ================================================================
   polls.js — Sondaggi (globale o per stanza) con widget a colonna
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { escHtml, showToast } from './utils.js';
import { hasPermission, loadUserPermissions } from './permissions.js';

let _unsubPoll = null;
let _unsubVotes = null;
let _currentPollId = null;
let _hideTimer = null;

let _scopeMode = 'room'; // 'room' | 'global'
let _scopeRoomId = null;

function _scopeKey() {
  if (_scopeMode === 'global') return 'global';
  const rid = _scopeRoomId ?? state.activeRoom ?? 'general';
  return `room::${String(rid)}`;
}

function _clearHideTimer() {
  if (_hideTimer) clearTimeout(_hideTimer);
  _hideTimer = null;
}

function _formatMinutes(mins) {
  const m = Number(mins || 0);
  if (!isFinite(m)) return '0';
  return String(m);
}

function _toMillis(ts) {
  try {
    if (!ts) return null;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') return new Date(ts).getTime();
    if (ts?.toDate) return ts.toDate().getTime();
    if (ts?.seconds) return ts.seconds * 1000;
  } catch (_) {}
  return null;
}

function _setPanelVisible(visible) {
  if (!dom.pollsPanel) return;
  dom.pollsPanel.hidden = !visible;
}

function _renderEmpty() {
  if (!dom.pollsWidget) return;
  dom.pollsWidget.innerHTML = '';
  _setPanelVisible(false);
}

function _renderActivePoll({ poll, myVoteOptionId, voteCounts, options }) {
  if (!dom.pollsWidget) return;
  const now = Date.now();
  const expiresMs = _toMillis(poll.expires_at);
  const msLeft = expiresMs != null ? Math.max(0, expiresMs - now) : null;
  const secsLeft = msLeft != null ? Math.ceil(msLeft / 1000) : null;
  const minLeft = secsLeft != null ? Math.ceil(secsLeft / 60) : null;

  const countdownText = secsLeft != null
    ? (secsLeft <= 60 ? `${secsLeft}s` : `${minLeft}m`)
    : '';

  const votedBanner = myVoteOptionId
    ? `<div class="polls-my-vote-banner">✅ Hai già votato</div>`
    : `<div class="polls-countdown">⏳ Scade tra ${countdownText}</div>`;

  const optsHtml = options.map((o) => {
    const isVoted = myVoteOptionId && String(myVoteOptionId) === String(o.id);
    const disabled = !!myVoteOptionId;
    return `
      <button class="polls-option-btn${isVoted ? ' voted' : ''}"
        data-option-id="${escHtml(String(o.id))}"
        ${disabled ? 'disabled' : ''}>
        <span class="polls-option-text">${escHtml(o.text)}</span>
      </button>
    `;
  }).join('');

  dom.pollsWidget.innerHTML = `
    <div class="polls-q">${escHtml(poll.question || '')}</div>
    ${votedBanner}
    <div class="polls-options">${optsHtml}</div>
    <div class="polls-hint">Scelta singola.</div>
  `;
  _setPanelVisible(true);
}

function _renderResultsPoll({ poll, myVoteOptionId, voteCounts, options }) {
  if (!dom.pollsWidget) return;
  const resultsHtml = options.map((o) => {
    const count = Number(voteCounts[String(o.id)] || 0);
    const total = options.reduce((acc, x) => acc + Number(voteCounts[String(x.id)] || 0), 0);
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const isVoted = myVoteOptionId && String(myVoteOptionId) === String(o.id);
    return `
      <div class="polls-result-row">
        <div class="polls-result-top">
          <span class="polls-result-label${isVoted ? ' is-my' : ''}">
            ${escHtml(o.text)}
          </span>
          <span class="polls-result-count">${count}</span>
        </div>
        <div class="polls-result-bar">
          <div class="polls-result-fill" style="width:${pct}%;"></div>
        </div>
      </div>
    `;
  }).join('');

  dom.pollsWidget.innerHTML = `
    <div class="polls-q">${escHtml(poll.question || '')}</div>
    <div class="polls-results-title">Risultati</div>
    ${resultsHtml}
  `;
  _setPanelVisible(true);
}

function _pollShouldShowResults(poll) {
  const expiresMs = _toMillis(poll?.expires_at);
  if (expiresMs == null) return false;
  const now = Date.now();
  const ended = expiresMs <= now;
  if (!ended) return false;
  const resultsUntil = expiresMs + 5 * 60 * 1000;
  return now <= resultsUntil;
}

function _pollShouldHideNow(poll) {
  if (poll?.cancelled_at) return true;
  // Hide if we are beyond expires_at + 5 minutes.
  const expiresMs = _toMillis(poll?.expires_at);
  if (expiresMs == null) return false;
  const now = Date.now();
  return now > (expiresMs + 5 * 60 * 1000);
}

function _scheduleHide(poll) {
  _clearHideTimer();
  const pollId = String(poll?.id || _currentPollId || '');
  const expiresMs = _toMillis(poll?.expires_at);
  if (expiresMs == null) return;
  const hideAt = expiresMs + 5 * 60 * 1000;
  const delay = Math.max(0, hideAt - Date.now());
  _hideTimer = setTimeout(() => {
    // Prevent hiding a newer poll that might have been created in the meantime.
    if (pollId && pollId !== _currentPollId) return;
    _renderEmpty();
    _clearHideTimer();
  }, delay + 50);
}

function _extractOptionsArray(poll) {
  // expected shape: poll.options = [{id,text}, ...]
  const opts = Array.isArray(poll?.options) ? poll.options : [];
  return opts
    .filter(o => o && o.id != null && typeof o.text === 'string')
    .map(o => ({ id: String(o.id), text: String(o.text) }));
}

async function _subscribePollWidget() {
  if (!state.fb?.firestore) return;
  const scope = _scopeKey();

  if (_unsubPoll) {
    try { _unsubPoll(); } catch (_) {}
    _unsubPoll = null;
  }
  if (_unsubVotes) {
    try { _unsubVotes(); } catch (_) {}
    _unsubVotes = null;
  }
  _currentPollId = null;

  const col = state.fb.firestore.collection('polls');
  const query = col
    .where('scope', '==', scope)
    .orderBy('expires_at', 'desc')
    .limit(1);

  _unsubPoll = query.onSnapshot((snap) => {
    const doc = snap.docs?.[0] || null;
    if (!doc) {
      _renderEmpty();
      return;
    }

    const poll = { id: doc.id, ...doc.data() };
    if (_pollShouldHideNow(poll)) {
      _renderEmpty();
      return;
    }

    _currentPollId = doc.id;
    const options = _extractOptionsArray(poll);

    // Subscribe to votes for this poll.
    if (_unsubVotes) {
      try { _unsubVotes(); } catch (_) {}
      _unsubVotes = null;
    }

    const votesCol = state.fb.firestore.collection('polls').doc(_currentPollId).collection('votes');
    _unsubVotes = votesCol.onSnapshot((vsnap) => {
      const voteCounts = {};
      let myVoteOptionId = null;
      const myUid = state.currentUser?.id ? String(state.currentUser.id) : null;

      if (_pollShouldHideNow(poll)) {
        _renderEmpty();
        return;
      }

      vsnap.forEach((vdoc) => {
        const data = vdoc.data() || {};
        const optId = data.option_id != null ? String(data.option_id) : null;
        if (!optId) return;
        voteCounts[optId] = Number(voteCounts[optId] || 0) + 1;
        if (myUid && vdoc.id === myUid) myVoteOptionId = optId;
      });

      // Ensure all options appear in counts.
      for (const o of options) voteCounts[String(o.id)] = Number(voteCounts[String(o.id)] || 0);

      const resultsVisible = _pollShouldShowResults(poll);
      const now = Date.now();
      const expiresMs = _toMillis(poll?.expires_at);
      const ended = expiresMs != null ? expiresMs <= now : false;

      if (poll.cancelled_at) {
        _renderEmpty();
        return;
      }

      if (resultsVisible || ended) {
        _renderResultsPoll({ poll, myVoteOptionId, voteCounts, options });
        _scheduleHide(poll);
        return;
      }

      if (poll.is_active !== true) {
        // If admin disabled it while still not expired: keep it hidden.
        _renderEmpty();
        return;
      }

      _renderActivePoll({ poll, myVoteOptionId, voteCounts, options });
    });

    // If votes are empty snapshot, render will be handled by onSnapshot above.
  });
}

export function setPollScopeMode(mode) {
  _scopeMode = (mode === 'global') ? 'global' : 'room';
  if (dom.pollsScopeRoomBtn && dom.pollsScopeGlobalBtn) {
    const isRoom = _scopeMode === 'room';
    dom.pollsScopeRoomBtn.classList.toggle('active', isRoom);
    dom.pollsScopeGlobalBtn.classList.toggle('active', !isRoom);
    dom.pollsScopeRoomBtn.setAttribute('aria-selected', isRoom ? 'true' : 'false');
    dom.pollsScopeGlobalBtn.setAttribute('aria-selected', isRoom ? 'false' : 'true');
  }
  _subscribePollWidget();
}

export function setPollRoomId(roomId) {
  _scopeRoomId = roomId;
  if (state.fb?.firestore) _subscribePollWidget();
}

export function initPollsPanel() {
  if (!dom.pollsPanel) return;
  if (dom.pollsScopeRoomBtn) {
    dom.pollsScopeRoomBtn.addEventListener('click', () => setPollScopeMode('room'));
  }
  if (dom.pollsScopeGlobalBtn) {
    dom.pollsScopeGlobalBtn.addEventListener('click', () => setPollScopeMode('global'));
  }

  // Start hidden; subscribe once Firebase is ready.
  _renderEmpty();

  // Default to room.
  setPollScopeMode('room');
  setPollRoomId(state.activeRoom || 'general');
}

/* ──────────────────────────────────────────────────────────────
   ADMIN: Poll create/edit/enable/disable/delete
────────────────────────────────────────────────────────────── */

let _adminEventsAttached = false;

function _getAdminEl(id) {
  return document.getElementById(id);
}

function _pollScopeFromAdmin() {
  const scopeType = _getAdminEl('pollScopeType')?.value || 'room';
  if (scopeType === 'global') return { scope: 'global', scope_type: 'global', scope_id: 'global' };
  const roomId = state.activeRoom || 'general';
  return { scope: `room::${String(roomId)}`, scope_type: 'room', scope_id: String(roomId) };
}

async function _createOrUpdatePollFromForm(editPollId = null) {
  if (!state.fb) return;
  await loadUserPermissions();
  if (!hasPermission('can_manage_polls')) {
    showToast('🚫 You do not have permission to manage polls.');
    return;
  }

  const question = (_getAdminEl('pollQuestion')?.value || '').trim().substring(0, 300);
  if (!question) {
    showToast('⚠️ Poll question is required.');
    return;
  }

  const optionsRaw = (_getAdminEl('pollOptions')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (optionsRaw.length < 2) {
    showToast('⚠️ Provide at least 2 options (one per line).');
    return;
  }
  const options = optionsRaw.slice(0, 8).map((t, i) => ({ id: `o${i + 1}`, text: t.substring(0, 120) }));

  const durationMin = Math.max(1, Math.min(10080, parseInt(_getAdminEl('pollDurationMin')?.value, 10) || 1));
  const expiresAt = new Date(Date.now() + durationMin * 60 * 1000);

  const { scope, scope_type, scope_id } = _pollScopeFromAdmin();

  const payload = {
    question,
    options,
    expires_at: expiresAt,
    scope,
    scope_type,
    scope_id,
    is_active: true,
    cancelled_at: null,
    updated_by: String(state.currentUser?.id || ''),
    updated_at: new Date(),
    created_by: editPollId ? undefined : String(state.currentUser?.id || ''),
    created_at: editPollId ? undefined : new Date(),
  };

  // Remove undefined fields so merge is cleaner.
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  const col = state.fb.firestore.collection('polls');
  if (editPollId) {
    await col.doc(editPollId).set(payload, { merge: true });
    showToast('✅ Poll updated.');
  } else {
    const ref = await col.add(payload);
    showToast('✅ Poll created.');
    // Reset UI after create.
    _getAdminEl('pollEditId') && (_getAdminEl('pollEditId').value = '');
    _getAdminEl('pollSubmitBtn') && (_getAdminEl('pollSubmitBtn').textContent = 'Create Poll');
  }

  await loadPollsAdminList();
}

async function _setPollActive(editPollId, isActive) {
  if (!editPollId || !state.fb) return;
  await loadUserPermissions();
  if (!hasPermission('can_manage_polls')) {
    showToast('🚫 You do not have permission to manage polls.');
    return;
  }
  await state.fb.firestore.collection('polls').doc(editPollId).set({
    is_active: isActive === true,
    updated_by: String(state.currentUser?.id || ''),
    updated_at: new Date(),
  }, { merge: true });
  showToast(isActive ? '✅ Poll enabled.' : '✅ Poll disabled.');
}

async function _deletePoll(editPollId) {
  if (!editPollId || !state.fb) return;
  await loadUserPermissions();
  if (!hasPermission('can_manage_polls')) {
    showToast('🚫 You do not have permission to manage polls.');
    return;
  }
  if (!confirm('Delete this poll?')) return;
  await state.fb.firestore.collection('polls').doc(editPollId).delete();
  showToast('✅ Poll deleted.');
}

function _startEditPoll(poll) {
  _getAdminEl('pollEditId').value = String(poll.id || '');
  _getAdminEl('pollScopeType').value = poll.scope_type || 'room';
  _getAdminEl('pollQuestion').value = poll.question || '';
  _getAdminEl('pollOptions').value = (Array.isArray(poll.options) ? poll.options.map(o => o.text).join('\n') : '');
  const minsLeft = Math.max(1, Math.round((_toMillis(poll.expires_at) - Date.now()) / (60 * 1000)));
  _getAdminEl('pollDurationMin').value = String(minsLeft);
  _getAdminEl('pollSubmitBtn').textContent = 'Update Poll';
}

async function loadPollsAdminList() {
  const listEl = _getAdminEl('pollsAdminList');
  if (!listEl || !state.fb) return;
  await loadUserPermissions();
  if (!hasPermission('can_manage_polls')) {
    listEl.innerHTML = '<p class="admin-empty">🚫 No permission.</p>';
    return;
  }

  const { scope } = _pollScopeFromAdmin();
  const snap = await state.fb.firestore.collection('polls')
    .where('scope', '==', scope)
    .orderBy('created_at', 'desc')
    .limit(10)
    .get();

  const polls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  listEl.innerHTML = '';
  if (!polls.length) {
    listEl.innerHTML = '<p class="admin-empty">No polls yet.</p>';
    return;
  }

  polls.forEach((p) => {
    const expMs = _toMillis(p.expires_at);
    const isEnded = expMs != null ? expMs <= Date.now() : false;
    const status = p.cancelled_at ? 'Cancelled' : (p.is_active ? (isEnded ? 'Ended' : 'Active') : 'Disabled');
    const opts = Array.isArray(p.options) ? p.options.map(o => o.text).filter(Boolean).slice(0, 3) : [];
    const item = document.createElement('div');
    item.className = 'admin-list-item';
    item.innerHTML = `
      <div class="admin-item-info">
        <strong>${escHtml(p.question || '(no question)')}</strong>
        <div class="admin-item-id">Status: ${escHtml(status)}</div>
        <div class="admin-item-reason">Options: ${escHtml(opts.join(' | '))}${p.options?.length > 3 ? '...' : ''}</div>
      </div>
      <div class="admin-item-actions">
        <button class="admin-action-btn" data-action="edit" data-poll-id="${escHtml(String(p.id))}">✏️ Edit</button>
        <button class="admin-action-btn" data-action="toggle" data-is-active="${p.is_active ? '0' : '1'}" data-poll-id="${escHtml(String(p.id))}">
          ${p.is_active ? '⏸ Disable' : '▶️ Enable'}
        </button>
        <button class="admin-action-btn admin-action-danger" data-action="delete" data-poll-id="${escHtml(String(p.id))}">
          🗑️ Delete
        </button>
      </div>
    `;

    item.querySelector('[data-action="edit"]')?.addEventListener('click', () => _startEditPoll(p));
    item.querySelector('[data-action="toggle"]')?.addEventListener('click', async (e) => {
      const pollId = e.currentTarget?.dataset?.pollId;
      const isActive = e.currentTarget?.dataset?.isActive === '1';
      await _setPollActive(pollId, isActive);
      await loadPollsAdminList();
    });
    item.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
      const pollId = e.currentTarget?.dataset?.pollId;
      await _deletePoll(pollId);
      await loadPollsAdminList();
    });

    listEl.appendChild(item);
  });
}

export async function loadPollsAdmin() {
  if (!dom.adminModal) return;
  const tabEl = _getAdminEl('adminTabPolls');
  if (!tabEl) return;

  await loadUserPermissions();
  if (!hasPermission('can_manage_polls')) {
    const listEl = _getAdminEl('pollsAdminList');
    if (listEl) listEl.innerHTML = '<p class="admin-empty">🚫 You cannot manage polls.</p>';
    return;
  }

  if (!_adminEventsAttached) {
    _adminEventsAttached = true;
    const submitBtn = _getAdminEl('pollSubmitBtn');
    submitBtn?.addEventListener('click', async (e) => {
      e.preventDefault?.();
      const editPollId = _getAdminEl('pollEditId')?.value || '';
      await _createOrUpdatePollFromForm(editPollId || null);
    });
    _getAdminEl('pollScopeType')?.addEventListener('change', () => loadPollsAdminList());
    const createBtn = _getAdminEl('pollResetBtn');
    createBtn?.addEventListener('click', () => {
      _getAdminEl('pollEditId').value = '';
      _getAdminEl('pollSubmitBtn').textContent = 'Create Poll';
      _getAdminEl('pollQuestion').value = '';
      _getAdminEl('pollOptions').value = 'Opzione A\nOpzione B';
      _getAdminEl('pollDurationMin').value = '1';
    });
  }

  await loadPollsAdminList();
}

/* ── Voting ── */
async function _submitVote(optionId) {
  if (!_currentPollId) return;
  if (!state.fb?.firestore) return;
  if (!state.currentUser?.id) {
    showToast('⚠️ Login required.');
    return;
  }

  const uid = String(state.currentUser.id);
  const pollId = _currentPollId;
  const voteRef = state.fb.firestore.collection('polls').doc(pollId).collection('votes').doc(uid);

  try {
    await voteRef.create({
      option_id: String(optionId),
      voted_at: new Date(),
    });
    showToast('✅ Vote saved.');
  } catch (err) {
    // Usually already voted or poll expired/disabled.
    showToast('⚠️ Hai già votato o il sondaggio non e\' piu disponibile.');
  }
}

export function bindPollWidgetActions() {
  // Delegate: re-bind per render is unnecessary if we use event delegation.
  if (!dom.pollsWidget) return;
  dom.pollsWidget.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('.polls-option-btn');
    if (!btn) return;
    const optionId = btn.dataset?.optionId;
    if (!optionId) return;
    if (btn.disabled) return;
    _submitVote(optionId);
  });
}


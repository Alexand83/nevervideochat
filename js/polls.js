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
/** Timer: Firestore non notifica lo scadere del tempo — serve per passare a risultati e poi nascondere. */
let _wallClockTimer = null;

let _scopeMode = 'room'; // 'room' | 'global'
let _scopeRoomId = null;
/** Evita di chiudere il drawer mobile a ogni re-render dei voti. */
let _lastPollPanelVisible = false;

function _isMobilePollsLayout() {
  return typeof window !== 'undefined' && window.innerWidth <= 768;
}

function _scopeKey() {
  if (_scopeMode === 'global') return 'global';
  const rid = _scopeRoomId ?? state.activeRoom ?? 'general';
  return `room::${String(rid)}`;
}

/** Scope stanza corrente (sempre la stanza in chat), usato nella query unificata room+global. */
function _roomScopeKeyForWidget() {
  const rid = _scopeRoomId ?? state.activeRoom ?? 'general';
  return `room::${String(rid)}`;
}

function _isPollDisplayableCandidate(p) {
  if (_pollShouldHideNow(p)) return false;
  if (p.cancelled_at) return false;
  const expMs = _toMillis(p.expires_at);
  const ended = expMs != null ? expMs <= Date.now() : false;
  const resultsVisible = _pollShouldShowResults(p);
  return resultsVisible || ended || p.is_active === true;
}

/**
 * Preferisci lo scope del tab (Stanza / Globale); se lì non c'è nulla di mostrabile,
 * usa l'altro scope così la colonna non sparisce al cambio tab (solo al timer post-risultati).
 */
function _pickPollDocForWidget(docs, preferredScope) {
  for (const d of docs) {
    const p = { id: d.id, ...d.data() };
    if (!_isPollDisplayableCandidate(p)) continue;
    if (p.scope === preferredScope) return { doc: d, poll: p };
  }
  for (const d of docs) {
    const p = { id: d.id, ...d.data() };
    if (!_isPollDisplayableCandidate(p)) continue;
    return { doc: d, poll: p };
  }
  return null;
}

/** La visibilità della colonna deriva solo da Firestore: mostriamo solo se c'è un sondaggio in votazione o in finestra risultati (≤5 min dopo scadenza). */

function _clearHideTimer() {
  if (_hideTimer) clearTimeout(_hideTimer);
  _hideTimer = null;
}

function _clearWallClockTimer() {
  if (_wallClockTimer) {
    clearTimeout(_wallClockTimer);
    _wallClockTimer = null;
  }
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

function _closeMobilePollsDrawer() {
  if (!dom.pollsPanel) return;
  dom.pollsPanel.classList.remove('mobile-open');
  if (dom.pollsPanelOverlay) {
    dom.pollsPanelOverlay.classList.remove('show');
    dom.pollsPanelOverlay.setAttribute('aria-hidden', 'true');
  }
  if (dom.floatingPollsBtn) dom.floatingPollsBtn.setAttribute('aria-expanded', 'false');
}

function _openMobilePollsDrawer() {
  if (!dom.pollsPanel || dom.pollsPanel.classList.contains('hidden')) return;
  dom.pollsPanel.classList.add('mobile-open');
  if (dom.pollsPanelOverlay) {
    dom.pollsPanelOverlay.classList.add('show');
    dom.pollsPanelOverlay.setAttribute('aria-hidden', 'false');
  }
  if (dom.floatingPollsBtn) dom.floatingPollsBtn.setAttribute('aria-expanded', 'true');
}

function _toggleMobilePollsDrawer() {
  if (!dom.pollsPanel || dom.pollsPanel.classList.contains('hidden')) return;
  if (dom.pollsPanel.classList.contains('mobile-open')) _closeMobilePollsDrawer();
  else _openMobilePollsDrawer();
}

function _setPanelVisible(visible) {
  if (!dom.pollsPanel) return;
  const isMobile = _isMobilePollsLayout();
  const wasVisible = _lastPollPanelVisible;
  _lastPollPanelVisible = !!visible;

  dom.pollsPanel.hidden = !visible;
  dom.pollsPanel.classList.toggle('hidden', !visible);
  dom.pollsPanel.setAttribute('aria-hidden', visible ? 'false' : 'true');

  if (!visible) {
    if (dom.floatingPollsBtn) dom.floatingPollsBtn.hidden = true;
    _closeMobilePollsDrawer();
    return;
  }

  if (dom.floatingPollsBtn) {
    if (isMobile) {
      dom.floatingPollsBtn.hidden = false;
      if (!wasVisible) _closeMobilePollsDrawer();
    } else {
      dom.floatingPollsBtn.hidden = true;
      _closeMobilePollsDrawer();
    }
  }
}

/** Avviso quando il tab (Stanza/Globale) non coincide con lo scope del sondaggio mostrato (fallback). */
function _pollScopeFallbackHtml(poll) {
  const pref = _scopeKey();
  const psc = poll?.scope;
  if (!psc || pref === psc) return '';
  if (pref === 'global' && psc !== 'global') {
    return '<div class="polls-scope-notice" role="status">ℹ️ Nessun sondaggio globale attivo al momento. Stai vedendo il sondaggio della stanza.</div>';
  }
  if (pref !== 'global' && psc === 'global') {
    return '<div class="polls-scope-notice" role="status">ℹ️ Nessun sondaggio per questa stanza. Stai vedendo il sondaggio globale.</div>';
  }
  return '';
}

function _renderEmpty() {
  if (!dom.pollsWidget) return;
  dom.pollsWidget.innerHTML = '';
  _setPanelVisible(false);
}

function _renderScopeEmpty(msg = null) {
  if (!dom.pollsWidget) return;
  const text = msg || (_scopeMode === 'global'
    ? 'Nessun sondaggio globale attivo al momento.'
    : 'Nessun sondaggio attivo in questa stanza.');
  dom.pollsWidget.innerHTML = `
    <div class="polls-q">📊 Sondaggio</div>
    <div class="polls-hint">${escHtml(text)}</div>
  `;
  _setPanelVisible(true);
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

  const notice = _pollScopeFallbackHtml(poll);
  dom.pollsWidget.innerHTML = `
    ${notice}
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

/**
 * Aggiorna UI da stato poll + voti (stesso criterio del listener voti).
 * Usato dal timer a orologio: Firestore non emette eventi allo scadere di expires_at.
 */
function _applyPollVoteState(poll, options, voteCounts, myVoteOptionId) {
  if (_pollShouldHideNow(poll)) {
    _renderEmpty();
    return;
  }
  if (poll.cancelled_at) {
    _renderEmpty();
    return;
  }

  const resultsVisible = _pollShouldShowResults(poll);
  const expiresMs = _toMillis(poll?.expires_at);
  const ended = expiresMs != null ? expiresMs <= Date.now() : false;

  if (resultsVisible || ended) {
    _renderResultsPoll({ poll, myVoteOptionId, voteCounts, options });
    _scheduleHide(poll);
    return;
  }

  if (poll.is_active !== true) {
    _renderEmpty();
    return;
  }

  _renderActivePoll({ poll, myVoteOptionId, voteCounts, options });
}

async function _refreshPollWidgetFromServer(pollId) {
  if (!state.fb?.firestore || !pollId) return;
  if (String(_currentPollId) !== String(pollId)) return;
  const ref = state.fb.firestore.collection('polls').doc(String(pollId));
  const [snap, votesSnap] = await Promise.all([ref.get(), ref.collection('votes').get()]);
  if (!snap.exists) return;
  const poll = { id: snap.id, ...snap.data() };
  const options = _extractOptionsArray(poll);
  const myUid = state.currentUser?.id ? String(state.currentUser.id) : null;
  const voteCounts = {};
  let myVoteOptionId = null;
  votesSnap.forEach((vdoc) => {
    const data = vdoc.data() || {};
    const optId = data.option_id != null ? String(data.option_id) : null;
    if (!optId) return;
    voteCounts[optId] = Number(voteCounts[optId] || 0) + 1;
    if (myUid && vdoc.id === myUid) myVoteOptionId = optId;
  });
  for (const o of options) voteCounts[String(o.id)] = Number(voteCounts[String(o.id)] || 0);

  _applyPollVoteState(poll, options, voteCounts, myVoteOptionId);
}

function _scheduleWallClockPollRefresh(poll) {
  _clearWallClockTimer();
  const expiresMs = _toMillis(poll?.expires_at);
  if (expiresMs == null) return;
  const pollId = String(poll.id);
  const delayToExpiry = Math.max(0, expiresMs - Date.now());

  // Firestore non notifica lo scadere: a expires_at ricarichiamo poll+voti → risultati + _scheduleHide.
  _wallClockTimer = setTimeout(() => {
    _wallClockTimer = null;
    if (String(_currentPollId) !== pollId) return;
    _refreshPollWidgetFromServer(pollId).catch((e) => console.warn('[Polls] refresh at expiry:', e));
  }, delayToExpiry + 50);
}

async function _subscribePollWidget() {
  if (!state.fb?.firestore) return;
  const preferredScope = _scopeKey();
  const roomScope = _roomScopeKeyForWidget();
  const scopeIn = [roomScope, 'global'];

  if (_unsubPoll) {
    try { _unsubPoll(); } catch (_) {}
    _unsubPoll = null;
  }
  if (_unsubVotes) {
    try { _unsubVotes(); } catch (_) {}
    _unsubVotes = null;
  }
  _clearWallClockTimer();
  _clearHideTimer();
  _currentPollId = null;

  const col = state.fb.firestore.collection('polls');
  const query = col
    .where('scope', 'in', scopeIn)
    .orderBy('expires_at', 'desc')
    .limit(20);

  _unsubPoll = query.onSnapshot(
    (snap) => {
      const docs = snap.docs || [];
      if (!docs.length) {
        _renderEmpty();
        return;
      }

      const selected = _pickPollDocForWidget(docs, preferredScope);

      if (!selected) {
        _renderEmpty();
        return;
      }

      const { doc, poll } = selected;
      _currentPollId = doc.id;
      const options = _extractOptionsArray(poll);

      // Subscribe to votes for this poll.
      if (_unsubVotes) {
        try { _unsubVotes(); } catch (_) {}
        _unsubVotes = null;
      }

      const votesCol = state.fb.firestore.collection('polls').doc(_currentPollId).collection('votes');
      _unsubVotes = votesCol.onSnapshot(
        (vsnap) => {
          const voteCounts = {};
          let myVoteOptionId = null;
          const myUid = state.currentUser?.id ? String(state.currentUser.id) : null;

          vsnap.forEach((vdoc) => {
            const data = vdoc.data() || {};
            const optId = data.option_id != null ? String(data.option_id) : null;
            if (!optId) return;
            voteCounts[optId] = Number(voteCounts[optId] || 0) + 1;
            if (myUid && vdoc.id === myUid) myVoteOptionId = optId;
          });

          // Ensure all options appear in counts.
          for (const o of options) voteCounts[String(o.id)] = Number(voteCounts[String(o.id)] || 0);

          _applyPollVoteState(poll, options, voteCounts, myVoteOptionId);
        },
        (err) => {
          console.warn('[Polls] votes listener:', err);
        }
      );

      // Timer: quando scade expires_at senza nuovi voti, Firestore non notifica → mostra risultati.
      _scheduleWallClockPollRefresh(poll);

      // If votes are empty snapshot, render will be handled by onSnapshot above.
    },
    (err) => {
      // Usually happens while the composite index is still building.
      console.warn('[Polls] poll widget listener:', err);
      _renderScopeEmpty('Impossibile caricare il sondaggio in questo momento.');
    }
  );
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

  if (dom.floatingPollsBtn) {
    dom.floatingPollsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      _toggleMobilePollsDrawer();
    });
  }
  if (dom.pollsPanelCloseBtn) {
    dom.pollsPanelCloseBtn.addEventListener('click', () => _closeMobilePollsDrawer());
  }
  if (dom.pollsPanelOverlay) {
    dom.pollsPanelOverlay.addEventListener('click', () => _closeMobilePollsDrawer());
  }

  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const mobile = _isMobilePollsLayout();
      if (!dom.pollsPanel || !dom.floatingPollsBtn) return;
      const hasPoll = !dom.pollsPanel.classList.contains('hidden');
      if (mobile) {
        dom.floatingPollsBtn.hidden = !hasPoll;
      } else {
        dom.floatingPollsBtn.hidden = true;
        _closeMobilePollsDrawer();
      }
    }, 150);
  });

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
  const selectedRoomId = _getAdminEl('pollRoomId')?.value;
  const roomId = selectedRoomId || state.activeRoom || 'general';
  return { scope: `room::${String(roomId)}`, scope_type: 'room', scope_id: String(roomId) };
}

/** Un solo sondaggio attivo per scope: disattiva gli altri prima di crearne/attivarne uno. */
async function _deactivateOtherPollsInScope(scope, exceptId) {
  if (!state.fb?.firestore || !scope) return 0;
  const col = state.fb.firestore.collection('polls');
  const qq = await col.where('scope', '==', scope).limit(50).get();
  const batch = state.fb.firestore.batch();
  const uid = String(state.currentUser?.id || '');
  let n = 0;
  for (const d of qq.docs) {
    if (exceptId && d.id === exceptId) continue;
    const data = d.data();
    if (data.is_active === true) {
      batch.set(d.ref, {
        is_active: false,
        updated_at: new Date(),
        updated_by: uid,
      }, { merge: true });
      n++;
    }
  }
  if (n > 0) await batch.commit();
  return n;
}

async function _ensurePollAdminRooms() {
  const wrap = _getAdminEl('pollRoomSelectWrap');
  const selectEl = _getAdminEl('pollRoomId');
  const scopeTypeEl = _getAdminEl('pollScopeType');
  if (!wrap || !selectEl || !scopeTypeEl || !state.fb) return;

  // Toggle visibility based on scope type.
  const isRoom = scopeTypeEl.value === 'room';
  wrap.hidden = !isRoom;

  if (!isRoom) return;

  // Prevent re-fetching too often; but it is ok to refresh when admin opens.
  // (The room cache is kept in `rooms.js`.)
  try {
    const roomsMod = await import('./rooms.js');
    if (typeof roomsMod.loadRoomsFromDB === 'function') {
      await roomsMod.loadRoomsFromDB();
    }
    const rooms = typeof roomsMod.getAvailableRooms === 'function' ? roomsMod.getAvailableRooms() : [];

    const activeRoomId = state.activeRoom || 'general';
    const existing = String(selectEl.value || '');

    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '(seleziona una stanza)';
    selectEl.appendChild(placeholder);

    for (const r of rooms || []) {
      const opt = document.createElement('option');
      opt.value = String(r.id);
      const name = r.name ? String(r.name) : String(r.id);
      opt.textContent = `${r.id} - ${name}`;
      selectEl.appendChild(opt);
    }

    // Keep selection stable: prefer active room if nothing selected.
    if (existing) {
      selectEl.value = existing;
    } else {
      selectEl.value = String(activeRoomId);
    }
  } catch (err) {
    console.warn('[Polls] room select population:', err);
    // If it fails, still allow manual fallback to activeRoom/general.
  }
}

async function _createOrUpdatePollFromForm(editPollId = null) {
  if (!state.fb) return;
  await loadUserPermissions();
  if (!hasPermission('can_manage_polls')) {
    showToast('🚫 You do not have permission to manage polls.');
    return;
  }

  const submitBtn = _getAdminEl('pollSubmitBtn');
  const prevBtnText = submitBtn?.textContent || null;
  if (submitBtn) {
    submitBtn.disabled = true;
    if (prevBtnText) submitBtn.textContent = editPollId ? '⏳ Updating...' : '⏳ Creating...';
  }

  showToast(editPollId ? '⏳ Updating poll...' : '⏳ Creating poll...');

  try {
  const question = (_getAdminEl('pollQuestion')?.value || '').trim().substring(0, 300);
  const optionsRaw = (_getAdminEl('pollOptions')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const scopeType = _getAdminEl('pollScopeType')?.value || 'room';
  const roomChoice = _getAdminEl('pollRoomId')?.value || '';
  const durationRaw = parseInt(_getAdminEl('pollDurationMin')?.value, 10);

  if (!question) {
    showToast('⚠️ Inserisci la domanda del sondaggio.');
    return;
  }
  if (optionsRaw.length < 2) {
    showToast('⚠️ Inserisci almeno 2 opzioni (una per riga).');
    return;
  }
  if (!Number.isFinite(durationRaw) || durationRaw < 1) {
    showToast('⚠️ Inserisci una durata valida in minuti (minimo 1).');
    return;
  }
  if (scopeType === 'room' && !roomChoice && !_getAdminEl('pollRoomId')?.disabled) {
    showToast('⚠️ Seleziona una stanza per il sondaggio.');
    return;
  }
  const options = optionsRaw.slice(0, 8).map((t, i) => ({ id: `o${i + 1}`, text: t.substring(0, 120) }));

  const durationMin = Math.max(1, Math.min(10080, durationRaw || 1));
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
  const deactivated = await _deactivateOtherPollsInScope(scope, editPollId || null);

  if (editPollId) {
    await col.doc(editPollId).set(payload, { merge: true });
    showToast(deactivated > 0
      ? `✅ Sondaggio aggiornato. (${deactivated} precedente/i disattivato/i nello stesso scope.)`
      : '✅ Poll updated.');
  } else {
    await col.add(payload);
    showToast(deactivated > 0
      ? `✅ Sondaggio creato. (${deactivated} precedente/i disattivato/i nello stesso scope.)`
      : '✅ Poll created.');
    // Reset UI after create.
    _getAdminEl('pollEditId') && (_getAdminEl('pollEditId').value = '');
    _getAdminEl('pollSubmitBtn') && (_getAdminEl('pollSubmitBtn').textContent = 'Create Poll');
  }

  await loadPollsAdminList();
  } catch (err) {
    console.error('[Polls] create/update error:', err);
    const msg = err?.message || 'Unknown error';
    // Failed-precondition here is usually index-building but for writes it should be rare.
    showToast(`⚠️ Poll not saved: ${msg}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      if (prevBtnText) submitBtn.textContent = prevBtnText;
    }
  }
}

async function _setPollActive(editPollId, isActive) {
  if (!editPollId || !state.fb) return;
  await loadUserPermissions();
  if (!hasPermission('can_manage_polls')) {
    showToast('🚫 You do not have permission to manage polls.');
    return;
  }
  const uid = String(state.currentUser?.id || '');
  if (isActive === true) {
    const snap = await state.fb.firestore.collection('polls').doc(editPollId).get();
    const sc = snap.data()?.scope;
    if (sc) {
      const n = await _deactivateOtherPollsInScope(sc, editPollId);
      await state.fb.firestore.collection('polls').doc(editPollId).set({
        is_active: true,
        updated_by: uid,
        updated_at: new Date(),
      }, { merge: true });
      showToast(n > 0
        ? `✅ Sondaggio attivato. (${n} altro/i nello stesso scope disattivato/i.)`
        : '✅ Poll enabled.');
      return;
    }
  }
  await state.fb.firestore.collection('polls').doc(editPollId).set({
    is_active: isActive === true,
    updated_by: uid,
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
  let snap;
  try {
    snap = await state.fb.firestore.collection('polls')
      .where('scope', '==', scope)
      .orderBy('created_at', 'desc')
      .limit(10)
      .get();
  } catch (err) {
    console.warn('[Polls] loadPollsAdminList error:', err);
    if (err?.code === 'failed-precondition') {
      listEl.innerHTML = '<p class="admin-empty">⏳ Indici Firestore in costruzione per i polls. Riprova tra 1-2 minuti.</p>';
      showToast('⏳ Attendi: indici Firestore per i polls in costruzione.');
      return;
    }
    listEl.innerHTML = `<p class="admin-empty">⚠️ Failed to load polls.</p>`;
    showToast('⚠️ Failed to load poll list.');
    return;
  }

  const polls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  listEl.innerHTML = '';
  if (!polls.length) {
    listEl.innerHTML = '<p class="admin-empty">No polls yet.</p>';
    return;
  }

  const available = [];
  const autoClosed = [];
  const others = [];
  const now = Date.now();

  polls.forEach((p) => {
    const expMs = _toMillis(p.expires_at);
    const ended = expMs != null ? expMs <= now : false;
    if (p.cancelled_at) {
      others.push(p);
      return;
    }
    if (ended) {
      autoClosed.push(p);
      return;
    }
    if (p.is_active === true) {
      available.push(p);
      return;
    }
    others.push(p);
  });

  const renderSection = (title, items) => {
    const section = document.createElement('div');
    section.className = 'admin-list-section';
    const hdr = document.createElement('h4');
    hdr.style.margin = '10px 0 8px 0';
    hdr.textContent = `${title} (${items.length})`;
    section.appendChild(hdr);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-empty';
      empty.textContent = '—';
      section.appendChild(empty);
      listEl.appendChild(section);
      return;
    }

    items.forEach((p) => {
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

      section.appendChild(item);
    });
    listEl.appendChild(section);
  };

  renderSection('Disponibili', available);
  renderSection('Chiusi automaticamente', autoClosed);
  renderSection('Altri (disabilitati/cancellati)', others);
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
    _getAdminEl('pollScopeType')?.addEventListener('change', async () => {
      await _ensurePollAdminRooms();
      await loadPollsAdminList();
    });
    const createBtn = _getAdminEl('pollResetBtn');
    createBtn?.addEventListener('click', () => {
      _getAdminEl('pollEditId').value = '';
      _getAdminEl('pollSubmitBtn').textContent = 'Create Poll';
      _getAdminEl('pollQuestion').value = '';
      _getAdminEl('pollOptions').value = 'Opzione A\nOpzione B';
      _getAdminEl('pollDurationMin').value = '1';
    });
  }

  await _ensurePollAdminRooms();
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
  const pollRef = state.fb.firestore.collection('polls').doc(pollId);
  const voteRef = state.fb.firestore.collection('polls').doc(pollId).collection('votes').doc(uid);

  try {
    // Pre-check to provide precise UX messages instead of generic failure.
    const [pollSnap, myVoteSnap] = await Promise.all([pollRef.get(), voteRef.get()]);
    if (!pollSnap.exists) {
      showToast('⚠️ Sondaggio non trovato.');
      return;
    }
    const poll = { id: pollSnap.id, ...pollSnap.data() };
    const expiresMs = _toMillis(poll.expires_at);
    const now = Date.now();
    if (poll.cancelled_at || poll.is_active !== true) {
      showToast('⚠️ Questo sondaggio non è attivo.');
      return;
    }
    if (expiresMs != null && expiresMs <= now) {
      showToast('⚠️ Questo sondaggio è scaduto.');
      return;
    }
    if (myVoteSnap.exists) {
      showToast('⚠️ Hai già votato.');
      return;
    }

    await voteRef.set({
      option_id: String(optionId),
      voted_at: new Date(),
    });
    showToast('✅ Vote saved.');
  } catch (err) {
    console.warn('[Polls] vote error:', err);
    if (err?.code === 'already-exists') {
      showToast('⚠️ Hai già votato.');
      return;
    }
    if (err?.code === 'permission-denied') {
      showToast('⚠️ Voto non consentito (sondaggio scaduto o permessi insufficienti).');
      return;
    }
    showToast('⚠️ Errore durante il voto. Riprova.');
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


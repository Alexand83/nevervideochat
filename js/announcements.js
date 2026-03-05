/* ================================================================
   announcements.js  — gestione e visualizzazione annunci globali
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { showToast, escHtml } from './utils.js';

let announcementsListener = null;
let activeAnnouncements = [];

/* ── Carica e visualizza annunci ─────────────────────────────── */
export async function loadAndDisplayAnnouncements() {
  if (!state.supa || !dom.announcementsBanner) return;
  
  try {
    const { data, error } = await state.supa
      .from('announcements')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    /* Filter expired announcements */
    const now = new Date();
    const valid = (data || []).filter(ann => 
      !ann.expires_at || new Date(ann.expires_at) > now
    );
    
    activeAnnouncements = valid;
    renderAnnouncements();
  } catch (err) {
    console.error('[Announcements] Error loading:', err);
  }
}

/* ── Renderizza annunci ──────────────────────────────────────── */
function renderAnnouncements() {
  if (!dom.announcementsBanner) return;
  
  /* Show persistent announcements as banner */
  const persistent = activeAnnouncements.filter(ann => ann.is_persistent);
  
  if (persistent.length === 0) {
    dom.announcementsBanner.hidden = true;
    dom.announcementsBanner.innerHTML = '';
    return;
  }
  
  /* Show first persistent announcement (highest priority) */
  const ann = persistent[0];
  const typeClass = `announcement-${ann.type || 'info'}`;
  
  dom.announcementsBanner.className = `announcements-banner ${typeClass}`;
  dom.announcementsBanner.innerHTML = `
    <div class="announcement-content">
      <strong class="announcement-title">${escHtml(ann.title)}</strong>
      <span class="announcement-text">${escHtml(ann.content)}</span>
    </div>
    <button class="announcement-close" onclick="this.parentElement.hidden=true">✕</button>
  `;
  dom.announcementsBanner.hidden = false;
  
  /* Show non-persistent announcements as toasts */
  const nonPersistent = activeAnnouncements.filter(ann => !ann.is_persistent);
  nonPersistent.forEach(ann => {
    const icon = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌',
    }[ann.type || 'info'] || 'ℹ️';
    
    showToast(`${icon} ${escHtml(ann.title)}: ${escHtml(ann.content)}`, 8000);
  });
}

/* ── Inizializza listener per annunci ────────────────────────── */
export function initAnnouncementsListener() {
  if (!state.supa) return;
  
  /* Cleanup existing listener */
  if (announcementsListener) {
    announcementsListener.unsubscribe();
  }
  
  /* Subscribe to announcements changes */
  announcementsListener = state.supa
    .channel('announcements_changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'announcements',
    }, (payload) => {
      console.log('[Announcements] Change detected:', payload);
      loadAndDisplayAnnouncements();
    })
    .subscribe();
  
  /* Also listen to broadcast events */
  const { onBroadcast } = await import('./broadcast.js');
  if (onBroadcast) {
    onBroadcast('announcement-updated', () => {
      loadAndDisplayAnnouncements();
    });
  }
}

/* ── Cleanup ─────────────────────────────────────────────────── */
export function cleanupAnnouncements() {
  if (announcementsListener) {
    announcementsListener.unsubscribe();
    announcementsListener = null;
  }
}

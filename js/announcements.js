/* ================================================================
   announcements.js  — gestione e visualizzazione annunci globali
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { showToast, escHtml } from './utils.js';

let announcementsListener = null;
let activeAnnouncements = [];
let expirationCheckInterval = null;

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
    startExpirationChecker();
  } catch (err) {
    console.error('[Announcements] Error loading:', err);
  }
}

/* ── Renderizza annunci ──────────────────────────────────────── */
function renderAnnouncements() {
  if (!dom.announcementsBanner) return;
  
  /* Filter out expired announcements */
  const now = new Date();
  const valid = activeAnnouncements.filter(ann => 
    !ann.expires_at || new Date(ann.expires_at) > now
  );
  
  /* Show persistent announcements as banner */
  const persistent = valid.filter(ann => ann.is_persistent);
  
  if (persistent.length === 0) {
    dom.announcementsBanner.hidden = true;
    dom.announcementsBanner.innerHTML = '';
    /* Update header position when banner is hidden */
    updateHeaderPosition();
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
    <button class="announcement-close" id="announcementCloseBtn">✕</button>
  `;
  
  /* Add close button event listener */
  const closeBtn = document.getElementById('announcementCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      dom.announcementsBanner.hidden = true;
      updateHeaderPosition();
    });
  }
  dom.announcementsBanner.hidden = false;
  
  /* Update header position when banner is shown - use setTimeout to ensure DOM is updated */
  setTimeout(() => {
    updateHeaderPosition();
  }, 0);
  
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
export async function initAnnouncementsListener() {
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
  
  /* Also listen to broadcast events via Supabase Realtime */
  const channel = state.supa.channel('announcements_broadcast');
  channel.on('broadcast', { event: 'announcement-updated' }, () => {
    loadAndDisplayAnnouncements();
  });
  channel.subscribe();
}

/* ── Aggiorna posizione header quando banner appare/scompare ─── */
export function updateHeaderPosition() {
  const banner = dom.announcementsBanner;
  const header = document.querySelector('.app-header');
  
  if (!banner || !header) return;
  
  if (banner.hidden) {
    header.style.marginTop = '0';
    document.documentElement.style.setProperty('--banner-height', '0px');
  } else {
    const bannerHeight = banner.offsetHeight;
    header.style.marginTop = `${bannerHeight}px`;
    document.documentElement.style.setProperty('--banner-height', `${bannerHeight}px`);
  }
}

/* ── Controlla periodicamente se gli annunci sono scaduti ────── */
function startExpirationChecker() {
  /* Clear existing interval */
  if (expirationCheckInterval) {
    clearInterval(expirationCheckInterval);
  }
  
  /* Check every 30 seconds for expired announcements */
  expirationCheckInterval = setInterval(() => {
    const now = new Date();
    const hadExpired = activeAnnouncements.some(ann => 
      ann.expires_at && new Date(ann.expires_at) <= now
    );
    
    if (hadExpired) {
      console.log('[Announcements] Checking for expired announcements...');
      /* Filter out expired */
      activeAnnouncements = activeAnnouncements.filter(ann => 
        !ann.expires_at || new Date(ann.expires_at) > now
      );
      /* Re-render to hide expired announcements */
      renderAnnouncements();
    }
  }, 30000); /* Check every 30 seconds */
}

/* ── Cleanup ─────────────────────────────────────────────────── */
export function cleanupAnnouncements() {
  if (announcementsListener) {
    announcementsListener.unsubscribe();
    announcementsListener = null;
  }
  if (expirationCheckInterval) {
    clearInterval(expirationCheckInterval);
    expirationCheckInterval = null;
  }
}

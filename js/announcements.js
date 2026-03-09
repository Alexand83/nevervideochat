/* ================================================================
   announcements.js  — gestione e visualizzazione annunci globali
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { showToast, escHtml } from './utils.js';

let announcementsListener = null;
let activeAnnouncements = [];
let expirationCheckInterval = null;

function mapAnnouncement(d) {
  const data = d.data ? d.data() : d;
  const id = d.id || data.id;
  const o = { id, ...data };
  if (o.created_at && typeof o.created_at.toDate === 'function') o.created_at = o.created_at.toDate().toISOString();
  if (o.expires_at && typeof o.expires_at.toDate === 'function') o.expires_at = o.expires_at.toDate().toISOString();
  return o;
}

/* ── Carica e visualizza annunci ─────────────────────────────── */
export async function loadAndDisplayAnnouncements() {
  if (!state.fb || !dom.announcementsBanner) return;
  try {
    const snap = await state.fb.firestore.collection('announcements')
      .where('is_active', '==', true)
      .orderBy('priority', 'desc')
      .orderBy('created_at', 'desc')
      .get();
    const data = snap.docs.map(mapAnnouncement);
    const now = new Date();
    const valid = data.filter(ann => !ann.expires_at || new Date(ann.expires_at) > now);
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
  
  const icon = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
  }[ann.type || 'info'] || 'ℹ️';
  
  dom.announcementsBanner.className = `announcements-banner ${typeClass}`;
  dom.announcementsBanner.innerHTML = `
    <div class="announcement-content">
      <span class="announcement-icon">${icon}</span>
      <div class="announcement-text-wrapper">
        <strong class="announcement-title">${escHtml(ann.title)}</strong>
        <span class="announcement-text">${escHtml(ann.content)}</span>
      </div>
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
  }, 100); /* Slightly longer delay to ensure DOM is fully rendered */
  
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
  if (!state.fb) return;
  if (announcementsListener) announcementsListener();
  announcementsListener = state.fb.firestore.collection('announcements').onSnapshot(() => {
    loadAndDisplayAnnouncements();
  });
  await loadAndDisplayAnnouncements();
}

/* ── Aggiorna altezza app-main quando banner appare/scompare ─── */
export function updateHeaderPosition() {
  const banner = dom.announcementsBanner;
  const appMain = document.querySelector('.app-main');
  
  if (!banner || !appMain) return;
  
  if (banner.hidden) {
    document.documentElement.style.setProperty('--banner-height', '0px');
  } else {
    const bannerHeight = banner.offsetHeight || 0;
    document.documentElement.style.setProperty('--banner-height', `${bannerHeight}px`);
  }
  
  /* Aggiorna l'altezza di app-main per tenere conto del banner */
  const headerHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hdr-h')) || 60;
  const bannerHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--banner-height')) || 0;
  const totalTopHeight = headerHeight + bannerHeight;
  appMain.style.height = `calc(100dvh - ${totalTopHeight}px)`;
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
    announcementsListener();
    announcementsListener = null;
  }
  if (expirationCheckInterval) {
    clearInterval(expirationCheckInterval);
    expirationCheckInterval = null;
  }
}

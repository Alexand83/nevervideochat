/* ================================================================
   word-filter.js  — gestione filtro parole
================================================================ */
import { state } from './state.js';
import { dom } from './dom.js';
import { showToast, escHtml } from './utils.js';

let filteredWordsCache = [];

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── Carica parole filtrate ──────────────────────────────────── */
export async function loadFilteredWords() {
  if (!state.fb) return [];
  try {
    const snap = await state.fb.firestore.collection('filtered_words').orderBy('word').get();
    filteredWordsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return filteredWordsCache;
  } catch (err) {
    console.error('[WordFilter] Error loading filtered words:', err);
    return [];
  }
}

/* ── Filtra messaggio ─────────────────────────────────────────── */
export function filterMessage(text) {
  if (!text || !filteredWordsCache.length) return { text, blocked: false };
  
  let filteredText = text;
  let blocked = false;

  for (const wordFilter of filteredWordsCache) {
    const word = wordFilter.word.toLowerCase();
    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
    
    if (regex.test(filteredText)) {
      if (wordFilter.action === 'block') {
        blocked = true;
        break;
      } else if (wordFilter.action === 'replace') {
        filteredText = filteredText.replace(regex, wordFilter.replacement || '***');
      } else if (wordFilter.action === 'warn') {
        // Per ora solo log, in futuro si può aggiungere warn
        console.log('[WordFilter] Warning: word detected:', word);
      }
    }
  }
  
  return { text: filteredText, blocked };
}

/* ── Carica e aggiorna cache ─────────────────────────────────── */
export async function refreshFilteredWords() {
  await loadFilteredWords();
}

let wordFilterUnsubscribe = null;

/* ── Inizializza listener realtime ────────────────────────────── */
export async function initWordFilterListener() {
  if (!state.fb) return;
  if (wordFilterUnsubscribe) wordFilterUnsubscribe();
  wordFilterUnsubscribe = state.fb.firestore.collection('filtered_words').onSnapshot(async () => {
    await refreshFilteredWords();
  });
  await refreshFilteredWords();
}

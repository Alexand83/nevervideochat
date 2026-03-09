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
  if (!state.supa) return [];
  
  try {
    const { data, error } = await state.supa
      .from('filtered_words')
      .select('*')
      .order('word');
    
    if (error) throw error;
    
    filteredWordsCache = data || [];
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

/* ── Inizializza listener realtime ────────────────────────────── */
export async function initWordFilterListener() {
  if (!state.supa) return;
  
  /* Subscribe to changes */
  state.supa
    .channel('filtered_words_changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'filtered_words'
    }, async () => {
      await refreshFilteredWords();
    })
    .subscribe();
  
  /* Load initial data */
  await refreshFilteredWords();
}

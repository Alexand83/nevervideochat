/* ================================================================
   moderation.js — Moderazione AI via Firebase Cloud Function (Blaze)
   Controllo lato server: non bypassabile dal client.
================================================================ */
import { state } from './state.js';
import { firebaseConfig } from './firebase-config.js';

const MODERATE_URL = firebaseConfig?.projectId
  ? `https://europe-west1-${firebaseConfig.projectId}.cloudfunctions.net/moderate`
  : '';

export async function moderateText(text) {
  if (!state.aiModerationEnabled || !state.moderateText || !text || typeof text !== 'string') {
    return { allowed: true };
  }
  if (!MODERATE_URL) return { allowed: true };
  try {
    const res = await fetch(MODERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', text: text.trim().slice(0, 20000) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { allowed: true };
    return {
      allowed: data.allowed !== false,
      reason: data.reason || (data.allowed === false ? 'Messaggio bloccato dalla moderazione.' : undefined),
    };
  } catch (err) {
    console.warn('[Moderation] Text check failed:', err);
    return { allowed: true };
  }
}

export async function moderateImage(dataUrl) {
  if (!state.aiModerationEnabled || !state.moderateImages || !dataUrl || typeof dataUrl !== 'string') {
    return { allowed: true };
  }
  if (!MODERATE_URL) return { allowed: true };
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  if (!base64) return { allowed: true };
  try {
    const res = await fetch(MODERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image', image_base64: base64 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { allowed: true };
    return {
      allowed: data.allowed !== false,
      reason: data.reason || (data.allowed === false ? 'Immagine non consentita.' : undefined),
    };
  } catch (err) {
    console.warn('[Moderation] Image check failed:', err);
    return { allowed: true };
  }
}

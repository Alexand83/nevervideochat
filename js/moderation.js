/* ================================================================
   moderation.js — Moderazione leggera solo testo, lato client (blocklist).
   Nessuna Cloud Function, nessun ML.
================================================================ */

/** Blocklist leggera: parole/frasi bloccate (regex). */
const LIGHT_BLOCKLIST = [
  /\bputtan[aoe]\b/i,
  /\btroia\b/i,
  /\bstronz[aoe]\b/i,
  /\bvaffanculo\b/i,
  /\bcazzo\b/i,
  /\bminchia\b/i,
  /\bfottiti\b/i,
  /\bporco\s+dio\b/i,
  /\bporca\s+madonna\b/i,
];

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Controllo leggero sul testo (solo blocklist, client-side).
 * @param {string} text
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function moderateText(text) {
  if (!text || typeof text !== "string") return { allowed: true };
  const normalized = normalize(text.trim().slice(0, 20000));
  const hit = LIGHT_BLOCKLIST.find((re) => re.test(normalized));
  if (hit) {
    return { allowed: false, reason: "🚫 Messaggio bloccato dalla moderazione." };
  }
  return { allowed: true };
}

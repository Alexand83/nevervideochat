/* ================================================================
   themes.js — Theme management system
================================================================ */
import { state } from './state.js';
import { showToast } from './utils.js';

/* ── Apply theme colors to CSS variables ── */
export function applyTheme(themeData) {
  if (!themeData || !themeData.colors) return;
  
  const colors = themeData.colors;
  const root = document.documentElement;
  
  /* Apply all color variables */
  Object.entries(colors).forEach(([key, value]) => {
    const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    root.style.setProperty(cssVar, value);
  });
  
  /* Store current theme */
  state.currentTheme = themeData.id;
  
  /* Save to localStorage */
  if (state.currentUser) {
    localStorage.setItem(`theme_${state.currentUser.id}`, themeData.id);
  }
}

/* ── Load theme from database ── */
export async function loadTheme(themeId) {
  if (!state.fb) return null;
  try {
    const snap = await state.fb.firestore.collection('themes').doc(String(themeId)).get();
    if (snap.exists) {
      const data = { id: snap.id, ...snap.data() };
      applyTheme(data);
      return data;
    }
  } catch (err) {
    console.error('[Themes] Load error:', err);
    showToast('⚠️ Failed to load theme.');
  }
  return null;
}

/* ── Load user's theme preference ── */
export async function loadUserTheme() {
  if (!state.currentUser) return;
  
  /* Try to load from user profile */
  const themeId = state.currentUser.theme_id || 'dark';
  
  /* Also check localStorage as fallback */
  const storedTheme = localStorage.getItem(`theme_${state.currentUser.id}`);
  const finalThemeId = storedTheme || themeId;
  
  await loadTheme(finalThemeId);
}

/* ── Set user theme ── */
export async function setUserTheme(themeId) {
  if (!state.fb || !state.currentUser) return false;
  try {
    await state.fb.firestore.collection('profiles').doc(String(state.currentUser.id)).update({ theme_id: themeId });
    state.currentUser.theme_id = themeId;
    await loadTheme(themeId);
    showToast('✅ Theme updated.');
    return true;
  } catch (err) {
    console.error('[Themes] Set theme error:', err);
    showToast('⚠️ Failed to update theme.');
    return false;
  }
}

/* ── Get all available themes ── */
export async function getAllThemes() {
  if (!state.fb) return [];
  try {
    const snap = await state.fb.firestore.collection('themes').get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || (a.name || '').localeCompare(b.name || ''));
    return list;
  } catch (err) {
    console.error('[Themes] Load all themes error:', err);
    return [];
  }
}

/* ── Create custom theme (admin only) ── */
export async function createCustomTheme(themeData) {
  if (!state.fb || !state.currentUser) return false;
  try {
    const payload = {
      name: themeData.name,
      display_name: themeData.display_name,
      colors: themeData.colors,
      is_custom: true,
      created_by: state.currentUser.id,
    };
    const ref = state.fb.firestore.collection('themes').doc(String(themeData.id));
    await ref.set(payload);
    const snap = await ref.get();
    showToast('✅ Theme created.');
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  } catch (err) {
    console.error('[Themes] Create theme error:', err);
    showToast('⚠️ Failed to create theme.');
    return false;
  }
}

/* ── Update theme (admin only) ── */
export async function updateTheme(themeId, updates) {
  if (!state.fb) return false;
  try {
    await state.fb.firestore.collection('themes').doc(String(themeId)).update({
      ...updates,
      updated_at: new Date().toISOString(),
    });
    showToast('✅ Theme updated.');
    return true;
  } catch (err) {
    console.error('[Themes] Update theme error:', err);
    showToast('⚠️ Failed to update theme.');
    return false;
  }
}

/* ── Delete custom theme (admin only) ── */
export async function deleteTheme(themeId) {
  if (!state.fb) return false;
  try {
    const snap = await state.fb.firestore.collection('themes').doc(String(themeId)).get();
    if (!snap.exists || !snap.data()?.is_custom) {
      showToast('⚠️ Cannot delete default themes.');
      return false;
    }
    await state.fb.firestore.collection('themes').doc(String(themeId)).delete();
    showToast('✅ Theme deleted.');
    return true;
  } catch (err) {
    console.error('[Themes] Delete theme error:', err);
    showToast('⚠️ Failed to delete theme.');
    return false;
  }
}

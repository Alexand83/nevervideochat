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
  if (!state.supa) return;
  
  try {
    const { data, error } = await state.supa
      .from('themes')
      .select('*')
      .eq('id', themeId)
      .maybeSingle();
    
    if (error) throw error;
    if (data) {
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
  if (!state.supa || !state.currentUser) return false;
  
  try {
    /* Update user profile */
    const { error } = await state.supa
      .from('profiles')
      .update({ theme_id: themeId })
      .eq('id', state.currentUser.id);
    
    if (error) throw error;
    
    /* Update local state */
    state.currentUser.theme_id = themeId;
    
    /* Apply theme */
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
  if (!state.supa) return [];
  
  try {
    const { data, error } = await state.supa
      .from('themes')
      .select('*')
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Themes] Load all themes error:', err);
    return [];
  }
}

/* ── Create custom theme (admin only) ── */
export async function createCustomTheme(themeData) {
  if (!state.supa) return false;
  
  try {
    const { data, error } = await state.supa
      .from('themes')
      .insert({
        id: themeData.id,
        name: themeData.name,
        display_name: themeData.display_name,
        colors: themeData.colors,
        is_custom: true,
        created_by: state.currentUser.id,
      })
      .select()
      .single();
    
    if (error) throw error;
    showToast('✅ Theme created.');
    return data;
  } catch (err) {
    console.error('[Themes] Create theme error:', err);
    showToast('⚠️ Failed to create theme.');
    return false;
  }
}

/* ── Update theme (admin only) ── */
export async function updateTheme(themeId, updates) {
  if (!state.supa) return false;
  
  try {
    const { error } = await state.supa
      .from('themes')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', themeId);
    
    if (error) throw error;
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
  if (!state.supa) return false;
  
  /* Don't allow deleting default themes */
  try {
    const { data: theme } = await state.supa
      .from('themes')
      .select('is_custom')
      .eq('id', themeId)
      .single();
    
    if (!theme?.is_custom) {
      showToast('⚠️ Cannot delete default themes.');
      return false;
    }
    
    const { error } = await state.supa
      .from('themes')
      .delete()
      .eq('id', themeId);
    
    if (error) throw error;
    showToast('✅ Theme deleted.');
    return true;
  } catch (err) {
    console.error('[Themes] Delete theme error:', err);
    showToast('⚠️ Failed to delete theme.');
    return false;
  }
}

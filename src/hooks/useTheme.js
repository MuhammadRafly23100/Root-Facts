import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'rf.theme';
const MODES = ['light', 'dark', 'system'];

// Terapkan tema ke <html data-theme> berdasarkan pilihan & preferensi sistem.
function applyTheme(mode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  document.documentElement.setAttribute('data-theme', resolved);
}

/**
 * useTheme — kelola tema Light / Dark / System, tersimpan di localStorage,
 * dan otomatis mengikuti perubahan preferensi sistem saat mode 'system'.
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEY) || 'system');

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);

    if (theme !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyTheme('system');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((prev) => MODES[(MODES.indexOf(prev) + 1) % MODES.length]);
  }, []);

  return { theme, setTheme, cycleTheme };
}

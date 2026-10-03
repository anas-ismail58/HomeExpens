import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import type { AppLanguage } from '@/utils/i18n';

export type ThemePreference = 'light' | 'dark' | 'system';

interface PreferencesValue {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  theme: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function readTheme(): ThemePreference {
  try {
    const t = localStorage.getItem(STORAGE_KEYS.theme);
    if (t === 'light' || t === 'dark' || t === 'system') return t;
  } catch {
    /* ignore */
  }
  return 'system';
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [theme, setThemeState] = useState<ThemePreference>(readTheme);
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches);

  useEffect(() => {
    const mq = darkQuery();
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback((t: ThemePreference) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEYS.theme, t);
    } catch {
      /* ignore */
    }
  }, []);

  const setLanguage = useCallback((lang: AppLanguage) => void i18n.changeLanguage(lang), [i18n]);

  const value = useMemo<PreferencesValue>(
    () => ({ language: i18n.language as AppLanguage, setLanguage, theme, resolvedTheme, setTheme }),
    [i18n.language, setLanguage, theme, resolvedTheme, setTheme],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}

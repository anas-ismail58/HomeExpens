import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from '@/locales/ar.json';
import en from '@/locales/en.json';
import { STORAGE_KEYS } from '@/constants/storageKeys';

export type AppLanguage = 'ar' | 'en';
export const SUPPORTED_LANGUAGES: AppLanguage[] = ['ar', 'en'];

function getInitialLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.lang);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'ar';
}

export function applyDocumentDirection(lang: AppLanguage) {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: getInitialLanguage(),
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDocumentDirection(i18n.language as AppLanguage);

i18n.on('languageChanged', (lng) => {
  applyDocumentDirection(lng as AppLanguage);
  try {
    localStorage.setItem(STORAGE_KEYS.lang, lng);
  } catch {
    /* ignore */
  }
});

export default i18n;

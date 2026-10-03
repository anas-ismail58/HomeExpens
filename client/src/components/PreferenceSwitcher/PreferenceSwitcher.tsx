import { useTranslation } from 'react-i18next';
import { usePreferences, type ThemePreference } from '@/context/PreferencesContext';
import styles from './PreferenceSwitcher.module.css';

const THEMES: ThemePreference[] = ['light', 'dark', 'system'];
const THEME_LABEL_KEY: Record<ThemePreference, string> = {
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
  system: 'settings.themeSystem',
};

export function PreferenceSwitcher() {
  const { t } = useTranslation();
  const { language, setLanguage, theme, setTheme } = usePreferences();

  return (
    <div className={styles.wrap}>
      <div role="group" aria-label={t('settings.language')} className={styles.segment}>
        <button type="button" aria-pressed={language === 'ar'} onClick={() => setLanguage('ar')} lang="ar">
          العربية
        </button>
        <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')} lang="en">
          English
        </button>
      </div>

      <div role="group" aria-label={t('settings.theme')} className={styles.segment}>
        {THEMES.map((option) => (
          <button key={option} type="button" aria-pressed={theme === option} onClick={() => setTheme(option)}>
            {t(THEME_LABEL_KEY[option])}
          </button>
        ))}
      </div>
    </div>
  );
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { CURRENCIES, getExchangeRates, type CurrencyCode, type ExchangeRates } from './api';
import { translate, type Language, type StringKey } from './i18n';
import { direction, palettes, type Palette } from './theme';

export type ThemePreference = 'light' | 'dark' | 'system';
/** Amounts anywhere in the app can be shown converted to any supported currency. */
export type DisplayCurrency = CurrencyCode;
export const DISPLAY_CURRENCIES: readonly DisplayCurrency[] = CURRENCIES;

const CURRENCY_NAMES: Record<DisplayCurrency, { ar: string; en: string }> = {
  EGP: { ar: 'جنيه مصري', en: 'Egyptian pound' },
  SAR: { ar: 'ريال سعودي', en: 'Saudi riyal' },
  USD: { ar: 'دولار أمريكي', en: 'US dollar' },
  EUR: { ar: 'يورو', en: 'Euro' },
  AED: { ar: 'درهم إماراتي', en: 'UAE dirham' },
  KWD: { ar: 'دينار كويتي', en: 'Kuwaiti dinar' },
  QAR: { ar: 'ريال قطري', en: 'Qatari riyal' },
  BHD: { ar: 'دينار بحريني', en: 'Bahraini dinar' },
};

export function currencyName(code: string, language: Language) {
  return CURRENCY_NAMES[code as DisplayCurrency]?.[language] ?? code;
}

const STORAGE_KEY = 'family-expenses.preferences';

type PreferencesValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  themePreference: ThemePreference;
  setThemePreference: (theme: ThemePreference) => void;
  scheme: 'light' | 'dark';
  colors: Palette;
  rtl: boolean;
  dir: ReturnType<typeof direction>;
  locale: string;
  t: (key: StringKey, params?: Record<string, string | number>) => string;
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  rates: ExchangeRates | null;
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [language, setLanguageState] = useState<Language>('ar');
  const [themePreference, setThemeState] = useState<ThemePreference>('system');
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>('EGP');
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getExchangeRates().then(setRates).catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<{ language: Language; theme: ThemePreference; currency: DisplayCurrency }>;
        if (saved.currency && DISPLAY_CURRENCIES.includes(saved.currency)) setDisplayCurrencyState(saved.currency);
        if (saved.language === 'ar' || saved.language === 'en') setLanguageState(saved.language);
        if (saved.theme === 'light' || saved.theme === 'dark' || saved.theme === 'system') setThemeState(saved.theme);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ language, theme: themePreference, currency: displayCurrency })).catch(() => undefined);
  }, [displayCurrency, language, loaded, themePreference]);

  const setLanguage = useCallback((next: Language) => setLanguageState(next), []);
  const setThemePreference = useCallback((next: ThemePreference) => setThemeState(next), []);
  const setDisplayCurrency = useCallback((next: DisplayCurrency) => setDisplayCurrencyState(next), []);

  const value = useMemo<PreferencesValue>(() => {
    const scheme = themePreference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : themePreference;
    const rtl = language === 'ar';
    return {
      language,
      setLanguage,
      themePreference,
      setThemePreference,
      scheme,
      colors: palettes[scheme],
      rtl,
      dir: direction(rtl),
      // Always the Gregorian calendar (ar-SA defaults to Hijri on iOS); Arabic-Indic digits in Arabic.
      locale: rtl ? 'ar-EG-u-ca-gregory-nu-arab' : 'en-US-u-ca-gregory',
      t: (key, params) => translate(language, key, params),
      displayCurrency,
      setDisplayCurrency,
      rates,
    };
  }, [displayCurrency, language, rates, setDisplayCurrency, setLanguage, setThemePreference, systemScheme, themePreference]);

  // Avoid a flash of the wrong theme/language before saved preferences load.
  if (!loaded) return null;
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider');
  return value;
}

/** The UI language, or Arabic outside the provider (e.g. while preferences load). */
export function useUiLanguage(): Language {
  return useContext(PreferencesContext)?.language ?? 'ar';
}

/** Builds a style object from the current palette and text direction, memoised per theme/language. */
export function useStyles<T>(factory: (colors: Palette, dir: ReturnType<typeof direction>) => T): T {
  const { colors, dir } = usePreferences();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(colors, dir), [colors, dir]);
}

/** Locale-aware formatters (Arabic digits in Arabic, Latin in English). */
/** Converts between currencies using USD-based rates; null when a rate is missing. */
export function convert(amount: number, from: string, to: string, rates: ExchangeRates | null) {
  if (from === to) return amount;
  const fromRate = rates?.rates[from];
  const toRate = rates?.rates[to];
  return fromRate && toRate ? (amount / fromRate) * toRate : null;
}

export function useFormat() {
  const { locale, language, displayCurrency, rates } = usePreferences();
  return useMemo(() => {
    const number = new Intl.NumberFormat(locale);
    const currencyFormat = (value: number, currency: string) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
    return {
      /** Formats an amount stored in `currency`, converted to the viewer's display currency when rates are known. */
      money: (amount: string | number, currency: string) => {
        const converted = convert(Number(amount), currency, displayCurrency, rates);
        return converted === null ? currencyFormat(Number(amount), currency) : currencyFormat(converted, displayCurrency);
      },
      /** Like `money` but rounded to whole units — for small cards where every character counts. */
      moneyShort: (amount: string | number, currency: string) => {
        const converted = convert(Number(amount), currency, displayCurrency, rates);
        const [value, code] = converted === null ? [Number(amount), currency] : [converted, displayCurrency];
        return new Intl.NumberFormat(locale, { style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
      },
      /** Formats in the original currency, without conversion. */
      rawMoney: (amount: string | number, currency: string) => currencyFormat(Number(amount), currency),
      number: (value: number) => number.format(value),
      percent: (ratio: number) => new Intl.NumberFormat(locale, { style: 'percent' }).format(ratio),
      month: (month: string) =>
        new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      date: (dateOnly: string) =>
        new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${dateOnly}T00:00:00Z`)),
      fullDate: (date: Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(date),
      time: (date: Date) => new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date),
      dateTime: (occurredAt: string | null, fallback: string) =>
        occurredAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(occurredAt)) : fallback,
      name: (item: { nameAr: string; nameEn: string }) => (language === 'ar' ? item.nameAr : item.nameEn),
    };
  }, [displayCurrency, language, locale, rates]);
}

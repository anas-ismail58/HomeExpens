import type { AppLanguage } from './i18n';

export type DigitStyle = 'latn' | 'arab';

/** Locale tag with explicit numbering system so ar never silently switches digits. */
export function localeFor(lang: AppLanguage, digits: DigitStyle = 'latn'): string {
  return lang === 'ar' ? `ar-SA-u-nu-${digits}` : 'en-US';
}

const CURRENCY_DECIMALS: Record<string, number> = {
  SAR: 2, EGP: 2, USD: 2, EUR: 2, AED: 2, QAR: 2, KWD: 3, BHD: 3,
};

/** Amounts arrive from the API as strings (Decimal). */
export function formatMoney(
  amount: string | number,
  currency: string,
  lang: AppLanguage,
  digits: DigitStyle = 'latn',
): string {
  const d = CURRENCY_DECIMALS[currency] ?? 2;
  return new Intl.NumberFormat(localeFor(lang, digits), {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
  }).format(Number(amount));
}

export function formatNumber(value: number, lang: AppLanguage, digits: DigitStyle = 'latn'): string {
  return new Intl.NumberFormat(localeFor(lang, digits)).format(value);
}

/** "2026-10-03" -> localized date without timezone shift. */
export function formatDate(
  isoDate: string,
  lang: AppLanguage,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
  digits: DigitStyle = 'latn',
  calendar: 'gregory' | 'islamic-umalqura' = 'gregory',
): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const locale = lang === 'ar' ? `ar-SA-u-ca-${calendar}-nu-${digits}` : `en-US-u-ca-${calendar}`;
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

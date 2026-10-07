import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { Text } from './typography';
import type { Payment, PaymentCategory, PaymentFrequency, PaymentStatus } from './api';
import type { IconName } from './components';
import { toDateOnly } from './formControls';
import type { StringKey } from './i18n';
import { useFormat, usePreferences, useStyles } from './preferences';
import type { Palette, Tone } from './theme';

export const CATEGORIES: PaymentCategory[] = ['BILL', 'TUITION', 'COURSE', 'SUBSCRIPTION', 'RENT', 'INTERNET', 'MOBILE', 'INSURANCE', 'INSTALLMENT', 'LOAN', 'OTHER'];
export const FREQUENCIES: PaymentFrequency[] = ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'YEARLY', 'CUSTOM'];

export const CATEGORY_META: Record<PaymentCategory, { icon: IconName; tone: Tone }> = {
  BILL: { icon: 'flash', tone: 'teal' },
  TUITION: { icon: 'school', tone: 'indigo' },
  COURSE: { icon: 'book', tone: 'indigo' },
  SUBSCRIPTION: { icon: 'play-circle', tone: 'violet' },
  RENT: { icon: 'key', tone: 'amber' },
  INTERNET: { icon: 'wifi', tone: 'teal' },
  MOBILE: { icon: 'phone-portrait', tone: 'violet' },
  INSURANCE: { icon: 'shield-checkmark', tone: 'teal' },
  INSTALLMENT: { icon: 'card', tone: 'amber' },
  LOAN: { icon: 'cash', tone: 'rose' },
  OTHER: { icon: 'receipt', tone: 'rose' },
};

/** Status is always shown as icon + text, never by colour alone. */
export function statusStyle(status: PaymentStatus, c: Palette): { icon: IconName; color: string; soft: string } {
  switch (status) {
    case 'OVERDUE':
      return { icon: 'alert-circle', color: c.danger, soft: c.dangerSoft };
    case 'DUE_TODAY':
      return { icon: 'notifications', color: c.tones.amber.icon, soft: c.tones.amber.from };
    case 'DUE_SOON':
      return { icon: 'time', color: c.tones.violet.icon, soft: c.tones.violet.from };
    case 'PAID':
      return { icon: 'checkmark-circle', color: c.success, soft: c.successSoft };
    case 'CANCELLED':
      return { icon: 'close-circle', color: c.muted, soft: c.surfaceMuted };
    default:
      return { icon: 'calendar', color: c.primary, soft: c.primarySoft };
  }
}

export function StatusPill({ status }: { status: PaymentStatus }) {
  const { t, colors } = usePreferences();
  const style = statusStyle(status, colors);
  const s = useStyles((_c, d) => ({
    pill: { flexDirection: d.row, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, alignSelf: d.alignStart },
    text: { fontSize: 11, fontWeight: '800' as const },
  }));
  return (
    <View style={[s.pill, { backgroundColor: style.soft }]}>
      <Ionicons name={style.icon} size={12} color={style.color} />
      <Text style={[s.text, { color: style.color }]}>{t(`status_${status}` as StringKey)}</Text>
    </View>
  );
}

/** Human due-date text ("Today · 8:00 PM", "Tomorrow · …", "Thu 15 Oct · …") in the viewer's language. */
export function useDueText() {
  const { t, locale } = usePreferences();
  const format = useFormat();
  const time = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return format.time(new Date(2000, 0, 1, h, m));
  };
  const day = (dateOnly: string) => {
    const today = toDateOnly(new Date());
    const [y, m, d] = dateOnly.split('-').map(Number);
    const value = new Date(y, m - 1, d);
    const diff = Math.round((value.getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
    if (diff === 0) return t('today');
    if (diff === 1) return t('tomorrow');
    if (diff === -1) return t('yesterday');
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) }).format(value);
  };
  return {
    time,
    day,
    when: (payment: Pick<Payment, 'dueDate' | 'dueTime'>) => `${day(payment.dueDate)} · ${time(payment.dueTime)}`,
    instant: (iso: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)),
    frequency: (payment: Pick<Payment, 'frequency' | 'customIntervalDays'>) =>
      payment.frequency === 'CUSTOM' ? t('everyNDays', { n: format.number(payment.customIntervalDays ?? 0) }) : t(`freq_${payment.frequency}` as StringKey),
  };
}

import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './typography';
import { payPayment, type Payment } from './api';
import { IconBubble } from './components';
import { useNotifications } from './NotificationsContext';
import { CATEGORY_META, StatusPill, statusStyle, useDueText } from './paymentFormat';
import { useFormat, usePreferences, useStyles } from './preferences';
import { useCan, useSession } from './SessionContext';

/** Marks a payment paid and returns a confirmation line ("Next due: …" for recurring ones). */
export function usePayPayment() {
  const { call } = useSession();
  const { t } = usePreferences();
  const format = useFormat();
  const { syncDevice } = useNotifications();
  return async (payment: Payment) => {
    const paid = await call((s, r) => payPayment(s, payment.id, r));
    void syncDevice().catch(() => undefined);
    return paid.state === 'PAID' ? t('paidOnce') : t('paidSuccess', { date: format.date(paid.dueDate) });
  };
}

export function PaymentRow({ payment, last = false, onChanged }: { payment: Payment; last?: boolean; onChanged?: (message: string) => void }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const due = useDueText();
  const can = useCan();
  const pay = usePayPayment();
  const [busy, setBusy] = useState(false);
  const meta = CATEGORY_META[payment.category];
  const payable = payment.state === 'ACTIVE' && ['OVERDUE', 'DUE_TODAY', 'DUE_SOON'].includes(payment.status) && can('EDIT_PAYMENT');

  const s = useStyles((c, d) => ({
    row: { minHeight: 70, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 10 },
    divider: { borderBottomWidth: 1, borderBottomColor: c.hairline },
    info: { flex: 1, minWidth: 0, gap: 4 },
    title: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    meta: { color: c.muted, fontSize: 12, textAlign: d.start },
    side: { alignItems: d.alignEnd, gap: 6 },
    amount: { color: c.text, fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    pay: { minHeight: 30, paddingHorizontal: 10, borderRadius: 9, justifyContent: 'center' as const, backgroundColor: c.primary },
    payText: { color: c.primaryText, fontSize: 12, fontWeight: '800' as const },
  }));

  return (
    <Pressable onPress={() => router.push(`/payment/${payment.id}`)} style={({ pressed }) => [s.row, !last && s.divider, pressed && { opacity: 0.75 }]} accessibilityRole="button">
      <IconBubble name={meta.icon} color={colors.tones[meta.tone].icon} background={colors.tones[meta.tone].from} />
      <View style={s.info}>
        <Text style={s.title} numberOfLines={1}>{payment.name}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {due.when(payment)}{payment.isRecurring ? ` · ${due.frequency(payment)}` : ''}{payment.member ? ` · ${payment.member.name}` : ''}
        </Text>
        <StatusPill status={payment.status} />
      </View>
      <View style={s.side}>
        <Text style={s.amount}>{format.money(payment.amount, payment.currency)}</Text>
        {payable ? (
          <Pressable
            disabled={busy}
            onPress={() => {
              setBusy(true);
              pay(payment).then((message) => onChanged?.(message)).catch((err: unknown) => onChanged?.(err instanceof Error ? err.message : t('saveError'))).finally(() => setBusy(false));
            }}
            style={s.pay}
            accessibilityLabel={`${t('markPaid')} — ${payment.name}`}
          >
            {busy ? <ActivityIndicator size="small" color={colors.primaryText} /> : <Text style={s.payText}>{t('markPaid')}</Text>}
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Prominent dashboard card for a payment that is due today or overdue, with a one-tap pay action. */
export function PaymentAlertCard({ payment, onChanged }: { payment: Payment; onChanged: (message: string) => void }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const due = useDueText();
  const can = useCan();
  const pay = usePayPayment();
  const [busy, setBusy] = useState(false);
  const overdue = payment.status === 'OVERDUE';
  const style = statusStyle(payment.status, colors);

  const s = useStyles((c, d) => ({
    card: { borderRadius: 18, padding: 16, gap: 6, borderWidth: 1 },
    kicker: { fontSize: 13, fontWeight: '800' as const, textAlign: d.start },
    name: { color: c.text, fontSize: 18, fontWeight: '800' as const, textAlign: d.start },
    amount: { color: c.text, fontSize: 16, fontWeight: '700' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    when: { color: c.textSecondary, fontSize: 13, textAlign: d.start },
    button: { marginTop: 8, minHeight: 44, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, alignSelf: d.alignStart, paddingHorizontal: 18 },
    buttonText: { color: '#fff', fontSize: 14, fontWeight: '800' as const },
  }));

  return (
    <Pressable onPress={() => router.push(`/payment/${payment.id}`)} style={[s.card, { backgroundColor: style.soft, borderColor: style.color }]} accessibilityRole="button">
      <Text style={[s.kicker, { color: style.color }]}>{overdue ? t('overduePayment') : t('paymentDueToday')}</Text>
      <Text style={s.name}>{payment.name}</Text>
      <Text style={s.amount}>{format.money(payment.amount, payment.currency)}</Text>
      <Text style={s.when}>{overdue ? t('wasDue', { when: due.when(payment) }) : t('dueTodayAt', { time: due.time(payment.dueTime) })}</Text>
      {payment.state === 'ACTIVE' && can('EDIT_PAYMENT') ? (
        <Pressable
          disabled={busy}
          onPress={() => {
            setBusy(true);
            pay(payment).then(onChanged).catch((err: unknown) => onChanged(err instanceof Error ? err.message : t('saveError'))).finally(() => setBusy(false));
          }}
          style={[s.button, { backgroundColor: style.color }]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>{overdue ? t('markPaid') : t('payNow')}</Text>}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImageSourceButtons, type PreparedImage } from './attachments';
import { toDateOnly } from './formControls';
import { Text } from './typography';
import { payPayment, unpayPayment, type Payment } from './api';
import { IconBubble, PrimaryButton } from './components';
import { useNotifications } from './NotificationsContext';
import { CATEGORY_META, StatusPill, statusStyle, useDueText } from './paymentFormat';
import { useFormat, usePreferences, useStyles } from './preferences';
import { useCan, useSession } from './SessionContext';

/**
 * "Mark as paid" needs proof: `pay(payment)` opens a sheet where a screenshot of the transfer (or a
 * photo of the receipt) is attached, then records the payment with it. Resolves with a confirmation
 * line, or null if the sheet was closed. Render `sheet` once in the component that uses it.
 */
export function usePayPayment() {
  const [request, setRequest] = useState<{ payment: Payment; resolve: (message: string | null) => void } | null>(null);
  const pay = (payment: Payment) => new Promise<string | null>((resolve) => setRequest({ payment, resolve }));
  const close = (message: string | null) => {
    request?.resolve(message);
    setRequest(null);
  };
  const sheet = request ? <ReceiptSheet key={request.payment.id} payment={request.payment} onDone={close} /> : null;
  return { pay, sheet };
}

function ReceiptSheet({ payment, onDone }: { payment: Payment; onDone: (message: string | null) => void }) {
  const { call } = useSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const due = useDueText();
  const insets = useSafeAreaInsets();
  const { syncDevice } = useNotifications();
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The moment it's recorded as paid; the clock ticks while the sheet is open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const s = useStyles((c, d) => ({
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10, gap: 14 },
    grab: { alignSelf: 'center' as const, width: 40, height: 5, borderRadius: 3, backgroundColor: c.border },
    title: { color: c.text, fontSize: 18, fontWeight: '800' as const, textAlign: d.start },
    name: { color: c.textSecondary, fontSize: 14, textAlign: d.start },
    amount: { color: c.text, fontSize: 22, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    when: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, padding: 12, borderRadius: 14, backgroundColor: c.surfaceMuted },
    whenLabel: { color: c.muted, fontSize: 12, textAlign: d.start },
    whenValue: { color: c.text, fontSize: 14, fontWeight: '700' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.textSecondary, fontSize: 13, lineHeight: 19, textAlign: d.start },
    preview: { flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    thumb: { width: 84, height: 112, borderRadius: 12, backgroundColor: c.surfaceMuted },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  const confirm = async () => {
    if (!image) return;
    setBusy(true);
    setError('');
    try {
      const paid = await call((sess, r) => payPayment(sess, payment.id, { mimeType: 'image/jpeg', data: image.base64, width: image.width, height: image.height }, r));
      void syncDevice().catch(() => undefined);
      onDone(paid.state === 'PAID' ? t('paidOnce') : t('paidSuccess', { date: format.date(paid.dueDate) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !busy && onDone(null)}>
      <Pressable style={s.backdrop} onPress={() => !busy && onDone(null)} accessibilityLabel={t('close')}>
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 18 }]} onPress={() => undefined}>
          <View style={s.grab} />
          <Text style={s.title}>{t('confirmPayment')}</Text>
          <View>
            <Text style={s.name} numberOfLines={1}>{payment.name}</Text>
            <Text style={s.amount}>{format.money(payment.amount, payment.currency)}</Text>
          </View>
          <View style={s.when}>
            <Ionicons name="time-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.whenLabel}>{t('paidOnLabel')}</Text>
              <Text style={s.whenValue}>{format.fullDate(now)} · {format.time(now)}</Text>
              <Text style={s.whenLabel}>{t('forCycleDue', { date: format.date(payment.dueDate), time: due.time(payment.dueTime) })}</Text>
            </View>
          </View>
          <Text style={s.hint}>{t('receiptRequired')}</Text>
          {image ? (
            <View style={s.preview}>
              <Image source={{ uri: `data:image/jpeg;base64,${image.base64}` }} style={s.thumb} resizeMode="cover" />
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={[s.hint, { color: colors.success, fontWeight: '700' }]}>✓ {t('receiptAttached')}</Text>
                <ImageSourceButtons onPicked={setImage} onError={setError} />
              </View>
            </View>
          ) : (
            <ImageSourceButtons onPicked={setImage} onError={setError} />
          )}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <PrimaryButton label={t('markPaid')} icon="checkmark-circle" onPress={() => void confirm()} disabled={!image} busy={busy} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Undoes the last "paid" of a payment (two taps: arm, then confirm). */
export function useUnpayPayment() {
  const { call } = useSession();
  const { t } = usePreferences();
  const { syncDevice } = useNotifications();
  return async (payment: Payment) => {
    await call((s, r) => unpayPayment(s, payment.id, r));
    void syncDevice().catch(() => undefined);
    return t('undoDone');
  };
}

export function PaymentRow({ payment, last = false, onChanged }: { payment: Payment; last?: boolean; onChanged?: (message: string) => void }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const due = useDueText();
  const can = useCan();
  const { pay, sheet } = usePayPayment();
  const [busy, setBusy] = useState(false);
  const meta = CATEGORY_META[payment.category];
  const payable = payment.state === 'ACTIVE' && ['OVERDUE', 'DUE_TODAY', 'DUE_SOON'].includes(payment.status) && can('EDIT_PAYMENT');
  // Paid by mistake? A paid payment (or one whose last cycle was paid) can be undone.
  const undoable = !payable && payment.state !== 'CANCELLED' && Boolean(payment.lastPaidAt) && can('EDIT_PAYMENT');
  const unpay = useUnpayPayment();
  const [armed, setArmed] = useState(false);

  const s = useStyles((c, d) => ({
    row: { minHeight: 70, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 10 },
    divider: { borderBottomWidth: 1, borderBottomColor: c.hairline },
    info: { flex: 1, minWidth: 0, gap: 4 },
    title: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    meta: { color: c.muted, fontSize: 12, textAlign: d.start },
    side: { alignItems: d.alignEnd, gap: 6 },
    amount: { color: c.text, fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    pay: { minHeight: 30, paddingHorizontal: 10, borderRadius: 9, justifyContent: 'center' as const, backgroundColor: c.primary },
    undo: { minHeight: 30, paddingHorizontal: 10, borderRadius: 9, justifyContent: 'center' as const, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    undoArmed: { borderColor: c.danger, backgroundColor: c.dangerSoft },
    undoText: { color: c.textSecondary, fontSize: 12, fontWeight: '700' as const },
    payText: { color: c.primaryText, fontSize: 12, fontWeight: '800' as const },
  }));

  return (
    <>
    <Pressable onPress={() => router.push(`/payment/${payment.id}`)} style={({ pressed }) => [s.row, !last && s.divider, pressed && { opacity: 0.75 }]} accessibilityRole="button">
      <IconBubble name={meta.icon} color={colors.tones[meta.tone].icon} background={colors.tones[meta.tone].from} />
      <View style={s.info}>
        <Text style={s.title} numberOfLines={1}>{payment.name}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {due.when(payment)}{payment.isRecurring ? ` · ${due.frequency(payment)}` : ''}{payment.member ? ` · ${payment.member.name}` : ''}
        </Text>
        {payment.status === 'PAID' && payment.lastPaidAt ? (
          <Text style={s.meta} numberOfLines={1}>{t('paidAtTime', { date: format.date(toDateOnly(new Date(payment.lastPaidAt))), time: format.time(new Date(payment.lastPaidAt)) })}</Text>
        ) : null}
        <StatusPill status={payment.status} />
      </View>
      <View style={s.side}>
        <Text style={s.amount}>{format.money(payment.amount, payment.currency)}</Text>
        {payable ? (
          <Pressable
            disabled={busy}
            onPress={() => void pay(payment).then((message) => message && onChanged?.(message))}
            style={s.pay}
            accessibilityLabel={`${t('markPaid')} — ${payment.name}`}
          >
            {busy ? <ActivityIndicator size="small" color={colors.primaryText} /> : <Text style={s.payText}>{t('markPaid')}</Text>}
          </Pressable>
        ) : null}
        {undoable ? (
          <Pressable
            disabled={busy}
            onPress={() => {
              if (!armed) return setArmed(true);
              setBusy(true);
              unpay(payment)
                .then((message) => onChanged?.(message))
                .catch((err: unknown) => onChanged?.(err instanceof Error ? err.message : t('saveError')))
                .finally(() => { setBusy(false); setArmed(false); });
            }}
            style={[s.undo, armed && s.undoArmed]}
            accessibilityLabel={`${t('undoPaid')} — ${payment.name}`}
          >
            {busy ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={[s.undoText, armed && { color: colors.danger }]}>{armed ? t('confirmUndo') : `↩︎ ${t('undoPaid')}`}</Text>}
          </Pressable>
        ) : null}
      </View>
    </Pressable>
    {sheet}
    </>
  );
}

/** Prominent dashboard card for a payment that is due today or overdue, with a one-tap pay action. */
export function PaymentAlertCard({ payment, onChanged }: { payment: Payment; onChanged: (message: string) => void }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const due = useDueText();
  const can = useCan();
  const { pay, sheet } = usePayPayment();
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
    <>
    <Pressable onPress={() => router.push(`/payment/${payment.id}`)} style={[s.card, { backgroundColor: style.soft, borderColor: style.color }]} accessibilityRole="button">
      <Text style={[s.kicker, { color: style.color }]}>{overdue ? t('overduePayment') : t('paymentDueToday')}</Text>
      <Text style={s.name}>{payment.name}</Text>
      <Text style={s.amount}>{format.money(payment.amount, payment.currency)}</Text>
      <Text style={s.when}>{overdue ? t('wasDue', { when: due.when(payment) }) : t('dueTodayAt', { time: due.time(payment.dueTime) })}</Text>
      {payment.state === 'ACTIVE' && can('EDIT_PAYMENT') ? (
        <Pressable onPress={() => void pay(payment).then((message) => message && onChanged(message))} style={[s.button, { backgroundColor: style.color }]}>
          <Text style={s.buttonText}>{overdue ? t('markPaid') : t('payNow')}</Text>
        </Pressable>
      ) : null}
    </Pressable>
    {sheet}
    </>
  );
}

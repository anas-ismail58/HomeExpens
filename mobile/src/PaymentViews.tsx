import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImagePreview, ImageSourceButtons, type PreparedImage } from './attachments';
import { toDateOnly, ToggleRow } from './formControls';
import { Text } from './typography';
import { checkPaymentReceipt, payPayment, unpayPayment, type Payment, type ReceiptCheck } from './api';
import { IconBubble, PrimaryButton } from './components';
import { useNotifications } from './NotificationsContext';
import { CATEGORY_META, StatusPill, statusStyle, useDueText } from './paymentFormat';
import { useFormat, usePreferences, useStyles } from './preferences';
import { useCan, useSession } from './SessionContext';
import { useSubjectLabel } from './subjects';

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

/** The payment's name with its lesson subject as a small tag next to it (so you know which subject it's for). */
export function PaymentName({ payment, style, lines = 1, center = false }: { payment: Payment; style: StyleProp<TextStyle>; lines?: number; center?: boolean }) {
  const { colors } = usePreferences();
  const subjectLabel = useSubjectLabel();
  const subject = subjectLabel(payment.subject, payment.subjectName);
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 6, flexWrap: 'wrap' as const },
    tag: { flexDirection: d.row, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.lessonsSoft },
    tagText: { color: c.lessons, fontSize: 11, fontWeight: '700' as const },
  }));
  if (!subject) return <Text style={style} numberOfLines={lines}>{payment.name}</Text>;
  return (
    <View style={[s.row, center && { justifyContent: 'center' }]}>
      <Text style={[style, { flexShrink: 1 }]} numberOfLines={lines}>{payment.name}</Text>
      <View style={s.tag}>
        <Ionicons name="book" size={11} color={colors.lessons} />
        <Text style={s.tagText} numberOfLines={1}>{subject}</Text>
      </View>
    </View>
  );
}

type ItemState = 'wait' | 'ok' | 'bad' | 'unknown' | 'loading';

/** One checklist line: waiting, passed, failed or unknown. */
function CheckItem({ label, state }: { label: string; state: ItemState }) {
  const { colors } = usePreferences();
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 10 },
    text: { flex: 1, color: c.text, fontSize: 14, textAlign: d.start },
  }));
  return (
    <View style={s.row}>
      {state === 'loading' ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons
          name={state === 'ok' ? 'checkmark-circle' : state === 'bad' ? 'close-circle' : state === 'unknown' ? 'alert-circle' : 'ellipse-outline'}
          size={22}
          color={state === 'ok' ? colors.success : state === 'bad' ? colors.danger : state === 'unknown' ? colors.tones.amber.icon : colors.muted}
        />
      )}
      <Text style={[s.text, state === 'wait' && { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

type CheckState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; result: ReceiptCheck } | { kind: 'error' };

/** The receipt check's outcome as one line for the payer. */
export function useReceiptMessage() {
  const { t } = usePreferences();
  const format = useFormat();
  return (r: ReceiptCheck) => {
    const read = r.amount ? format.money(r.amount, r.currency ?? r.expectedCurrency) : '';
    switch (r.reason) {
      case null:
        return t('receiptMatch', { amount: read });
      case 'AMOUNT_DIFFERS':
        return t('receiptMismatch', { read, expected: format.money(r.expectedAmount, r.expectedCurrency) });
      case 'TRANSFER_FAILED':
        return t('receiptTransferFailed');
      case 'NOT_A_RECEIPT':
        return t('receiptNotReceipt');
      case 'AMOUNT_NOT_FOUND':
        return t('receiptNoAmount');
      case 'DATE_OUT_OF_RANGE':
        return t('receiptWrongDate', { date: r.transferDate ? format.date(r.transferDate) : '', month: format.month(r.expectedMonth) });
      case 'WRONG_RECIPIENT':
        return t('receiptWrongRecipient', { who: r.recipientNumber || r.recipientName || t('someoneElse'), name: r.teacher?.name ?? '' });
      case 'DUPLICATE':
        return t('receiptDuplicate', { name: r.usedFor?.name ?? '', date: r.usedFor ? format.dateTime(r.usedFor.paidAt, '') : '' });
      default:
        return t('receiptUnchecked');
    }
  };
}

/** "On the screenshot: 1,400 EGP · 3 Aug · to 010****5678 (Eyad)". */
function useReceiptDetails() {
  const { t } = usePreferences();
  const format = useFormat();
  return (r: ReceiptCheck) => {
    if (r.status === 'DUPLICATE' || r.status === 'UNAVAILABLE' || r.reason === 'NOT_A_RECEIPT') return null;
    const who = [r.recipientNumber, r.recipientName].filter(Boolean).join(' · ');
    const parts = [
      r.amount ? format.money(r.amount, r.currency ?? r.expectedCurrency) : null,
      r.transferDate ? format.date(r.transferDate) : t('notShownDate'),
      r.teacher ? (who ? t('toWhom', { who }) : t('notShownRecipient')) : null,
    ].filter(Boolean);
    return t('receiptRead', { details: parts.join(' · ') });
  };
}

function ReceiptSheet({ payment, onDone }: { payment: Payment; onDone: (message: string | null) => void }) {
  const { call } = useSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const due = useDueText();
  const insets = useSafeAreaInsets();
  const { syncDevice } = useNotifications();
  const receiptMessage = useReceiptMessage();
  const receiptDetails = useReceiptDetails();
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [override, setOverride] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The moment it's recorded as paid; the clock ticks while the sheet is open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const receiptOf = (picked: PreparedImage) => ({ mimeType: 'image/jpeg' as const, data: picked.base64, width: picked.width, height: picked.height });

  /** Every new screenshot is checked straight away: amount and whether it was used before. */
  const runCheck = async (picked: PreparedImage) => {
    setCheck({ kind: 'checking' });
    setOverride(false);
    try {
      const result = await call((sess, r) => checkPaymentReceipt(sess, payment.id, receiptOf(picked), r));
      setCheck({ kind: 'done', result });
    } catch {
      setCheck({ kind: 'error' });
    }
  };
  const pick = (picked: PreparedImage) => {
    setImage(picked);
    setError('');
    void runCheck(picked);
  };

  const s = useStyles((c, d) => ({
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { maxHeight: '92%' as const, backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10 },
    grab: { alignSelf: 'center' as const, width: 40, height: 5, borderRadius: 3, backgroundColor: c.border, marginBottom: 14 },
    title: { color: c.text, fontSize: 18, fontWeight: '800' as const, textAlign: d.start },
    name: { color: c.textSecondary, fontSize: 14, textAlign: d.start },
    amount: { color: c.text, fontSize: 22, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    when: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, padding: 12, borderRadius: 14, backgroundColor: c.surfaceMuted },
    whenLabel: { color: c.muted, fontSize: 12, textAlign: d.start },
    whenValue: { color: c.text, fontSize: 14, fontWeight: '700' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.textSecondary, fontSize: 13, lineHeight: 19, textAlign: d.start },
    preview: { flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    thumb: { width: 84, height: 112, borderRadius: 12, backgroundColor: c.surfaceMuted },
    checklist: { gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border },
    checkTitle: { color: c.muted, fontSize: 12, fontWeight: '800' as const, textAlign: d.start },
    result: { fontSize: 13, lineHeight: 19, fontWeight: '600' as const, textAlign: d.start },
    link: { color: c.primary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  const result = check.kind === 'done' ? check.result : null;
  const duplicate = result?.status === 'DUPLICATE';
  const canConfirm = Boolean(image) && Boolean(result) && (!result!.blocked || (result!.canOverride && override));

  /** One check's line: waiting for an image, reading, or the server's answer for it. */
  const itemFor = (key: 'amount' | 'date' | 'recipient'): ItemState => {
    if (!image) return 'wait';
    if (check.kind === 'checking') return 'loading';
    if (!result) return 'unknown';
    const value = result.checks[key];
    return value === 'ok' ? 'ok' : value === 'bad' ? 'bad' : 'unknown';
  };

  const confirm = async () => {
    if (!image || !canConfirm) return;
    setBusy(true);
    setError('');
    try {
      const paid = await call((sess, r) => payPayment(sess, payment.id, receiptOf(image), r, override));
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
          <ScrollView contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>{t('confirmPayment')}</Text>
            <View>
              <PaymentName payment={payment} style={s.name} />
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
                <Pressable onPress={() => setEnlarged(true)} accessibilityRole="imagebutton" accessibilityLabel={t('tapToEnlarge')}>
                  <Image source={{ uri: `data:image/jpeg;base64,${image.base64}` }} style={s.thumb} resizeMode="cover" />
                </Pressable>
                <View style={{ flex: 1, gap: 8 }}>
                  <Text style={[s.hint, { fontSize: 12 }]}>{t('tapToEnlarge')}</Text>
                  <ImageSourceButtons onPicked={pick} onError={setError} />
                </View>
              </View>
            ) : (
              <ImageSourceButtons onPicked={pick} onError={setError} />
            )}

            <View style={s.checklist}>
              <Text style={s.checkTitle}>{t('receiptChecklist')}</Text>
              <CheckItem label={t('chkImage')} state={image ? 'ok' : 'wait'} />
              {/* The reuse check is done on the server without the scanner, so it has a definite answer. */}
              <CheckItem label={t('chkUnique')} state={!image ? 'wait' : check.kind === 'checking' ? 'loading' : check.kind === 'error' ? 'unknown' : duplicate ? 'bad' : 'ok'} />
              <CheckItem label={t('chkAmount')} state={duplicate ? 'wait' : itemFor('amount')} />
              <CheckItem label={t('chkDate', { month: format.month(result?.expectedMonth ?? toDateOnly(now).slice(0, 7)) })} state={duplicate ? 'wait' : itemFor('date')} />
              {payment.teacher ? <CheckItem label={t('chkRecipient', { name: payment.teacher.name })} state={duplicate ? 'wait' : itemFor('recipient')} /> : null}
              {check.kind === 'checking' ? <Text style={[s.result, { color: colors.muted }]}>{t('checkingReceipt')}</Text> : null}
              {result && receiptDetails(result) ? <Text style={[s.result, { color: colors.textSecondary, fontWeight: '400' }]}>{receiptDetails(result)}</Text> : null}
              {result ? (
                <Text style={[s.result, { color: result.status === 'MATCH' ? colors.success : result.status === 'UNAVAILABLE' ? colors.tones.amber.fg : colors.danger }]}>
                  {receiptMessage(result)}
                </Text>
              ) : null}
              {check.kind === 'error' && image ? (
                <Pressable onPress={() => void runCheck(image)} accessibilityRole="button">
                  <Text style={s.error}>{t('receiptCheckError')} <Text style={s.link}>{t('retry')}</Text></Text>
                </Pressable>
              ) : null}
              {result?.blocked && result.canOverride ? (
                <ToggleRow label={t('overrideReceipt')} hint={t('overrideHint')} value={override} onChange={setOverride} />
              ) : result?.blocked ? (
                <Text style={s.hint}>{t('askFatherOverride')}</Text>
              ) : null}
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}
            <PrimaryButton label={t('markPaid')} icon="checkmark-circle" onPress={() => void confirm()} disabled={!canConfirm} busy={busy} />
          </ScrollView>
        </Pressable>
      </Pressable>
      <ImagePreview uri={enlarged && image ? `data:image/jpeg;base64,${image.base64}` : null} aspectRatio={image ? image.width / image.height : undefined} onClose={() => setEnlarged(false)} />
    </Modal>
  );
}

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
        <PaymentName payment={payment} style={s.title} />
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
      <PaymentName payment={payment} style={s.name} lines={2} />
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

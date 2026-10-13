import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { deletePayment, getPayment, type PaymentDetails } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, ConfirmDeleteButton, EmptyState, IconBubble, PrimaryButton, SectionTitle, Skeleton, SmallButton, type IconName } from '../../components';
import type { StringKey } from '../../i18n';
import { useNotifications } from '../../NotificationsContext';
import { CATEGORY_META, StatusPill, useDueText } from '../../paymentFormat';
import { PaymentName, usePayPayment } from '../../PaymentViews';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { AttachmentsSection } from '../../attachments';
import { TeacherContact } from '../../teachers';

export default function PaymentDetailsPage() {
  return (
    <WithBottomBar>
      <PaymentDetailsScreen />
    </WithBottomBar>
  );
}

function PaymentDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const due = useDueText();
  const can = useCan();
  const { pay, sheet } = usePayPayment();
  const { syncDevice } = useNotifications();
  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setPayment(await call((s, r) => getPayment(s, id, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, id, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    hero: { alignItems: 'center' as const, gap: 8, paddingVertical: 24 },
    amount: { color: c.text, fontSize: 32, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    name: { color: c.text, fontSize: 17, fontWeight: '700' as const, textAlign: 'center' as const },
    when: { color: c.textSecondary, fontSize: 14, textAlign: 'center' as const },
    notice: { color: c.success, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    histRow: { minHeight: 52, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    histText: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    histSub: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    histAmount: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 12 },
    paidCard: { flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    paidTitle: { color: c.success, fontSize: 16, fontWeight: '800' as const, textAlign: d.start },
  }));

  if (loading) {
    return (
      <View style={[s.screen, s.page]}>
        <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 30 }}>
          <Skeleton width={64} height={64} radius={20} /><Skeleton width="50%" height={30} /><Skeleton width="35%" height={14} />
        </Card>
      </View>
    );
  }
  if (!payment) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="alert-circle-outline" title={t('noPayments')} body={error || t('maybeDeleted')} />
      </View>
    );
  }

  const meta = CATEGORY_META[payment.category];
  const active = payment.state === 'ACTIVE';
  // Paid: a one-time payment that's done, or a recurring one whose last cycle was paid and whose
  // next cycle isn't due soon yet. Paying, undoing and cancelling then happen only from Edit.
  const dueSoon = ['OVERDUE', 'DUE_TODAY', 'DUE_SOON'].includes(payment.status);
  // lastPaidAt is set when a cycle is paid and cleared by "Undo paid", so an undone payment is
  // awaiting payment again even though earlier cycles stay in the history.
  const paid = payment.state === 'PAID' || (active && Boolean(payment.lastPaidAt) && !dueSoon);
  const lastPaid = payment.history[0];

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Stack.Screen
        options={{
          title: t('paymentDetails'),
          headerRight: payment.state !== 'CANCELLED' && can('EDIT_PAYMENT') ? () => <SmallButton label={t('edit')} icon="create-outline" onPress={() => router.push({ pathname: '/payment/new', params: { id: payment.id } })} /> : undefined,
        }}
      />
      <Card style={s.hero}>
        <IconBubble name={meta.icon} color={colors.tones[meta.tone].icon} background={colors.tones[meta.tone].from} size={64} />
        <Text style={s.amount}>{format.money(payment.amount, payment.currency)}</Text>
        <PaymentName payment={payment} style={s.name} lines={2} center />
        <StatusPill status={paid ? 'PAID' : payment.status} />
        {active && !paid ? <Text style={s.when}>{payment.status === 'OVERDUE' ? t('wasDue', { when: due.when(payment) }) : t('dueOn', { when: due.when(payment) })}</Text> : null}
      </Card>

      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {paid && lastPaid ? (
        <Card style={s.paidCard}>
          <IconBubble name="checkmark-circle" color={colors.success} background={colors.successSoft} size={40} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.paidTitle}>{t('paidBanner')}</Text>
            <Text style={s.histSub}>{t('paidAtTime', { date: format.fullDate(new Date(lastPaid.paidAt)), time: format.time(new Date(lastPaid.paidAt)) })}</Text>
            {active ? <Text style={s.histSub}>{t('nextCycleOn', { date: format.date(payment.dueDate) })}</Text> : null}
            {can('EDIT_PAYMENT') ? <Text style={s.histSub}>{t('paidBannerHint')}</Text> : null}
          </View>
        </Card>
      ) : null}

      {paid && payment.state !== 'CANCELLED' && can('EDIT_PAYMENT') ? (
        <PrimaryButton label={t('paidBanner')} icon="checkmark-circle" disabled onPress={() => undefined} />
      ) : null}
      {active && !paid && can('EDIT_PAYMENT') ? (
        <PrimaryButton
          label={payment.status === 'OVERDUE' ? t('markPaid') : t('payNow')}
          icon="checkmark-done"
          onPress={() => {
            void pay(payment).then((message) => {
              if (!message) return;
              setNotice(message);
              return load();
            });
          }}
        />
      ) : null}
      {sheet}

      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        <Detail icon="pricetag" label={t('category')} value={t(`cat_${payment.category}` as StringKey)} />
        <Detail icon="repeat" label={t('frequency')} value={due.frequency(payment)} divider />
        <Detail icon="calendar" label={payment.isRecurring ? t('nextDueDate') : t('dueDate')} value={format.date(payment.dueDate)} divider />
        <Detail icon="time" label={t('dueTime')} value={due.time(payment.dueTime)} divider />
        {payment.isRecurring && payment.nextDueDate ? <Detail icon="arrow-forward-circle" label={t('startDate')} value={format.date(payment.startDate)} divider /> : null}
        <Detail
          icon="alarm"
          label={t('reminder')}
          value={payment.reminderEnabled && payment.reminderAt ? due.instant(payment.reminderAt) : t('none')}
          divider
        />
        <Detail icon="person" label={t('assignedTo')} value={payment.assignee.name} divider />
        {payment.member ? <Detail icon="happy" label={t('child')} value={payment.member.name} divider /> : null}
        <Detail icon="create" label={t('createdBy')} value={payment.createdBy.name} divider />
        {payment.notes ? <Detail icon="document-text" label={t('notes')} value={payment.notes} divider /> : null}
        <Detail icon="globe" label={t('timezone')} value={payment.timezone} divider />
      </Card>

      {payment.teacher ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('teacher')} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            <TeacherContact teacher={payment.teacher} linked />
          </Card>
        </View>
      ) : null}

      {/* Receipts appear once the payment is confirmed (Pay now), and can only be viewed here. */}
      {payment.history.length ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('attachments')} />
          <Card>
            <AttachmentsSection target={{ paymentId: payment.id }} canAdd={false} refreshKey={payment.history.length} />
          </Card>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('paymentHistory')} count={payment.history.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {payment.history.length ? payment.history.map((record, index) => (
            <View key={record.id} style={[s.histRow, index > 0 && s.divider]}>
              <IconBubble name="checkmark-circle" color={colors.success} background={colors.successSoft} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={s.histText}>{format.date(record.dueDate)}</Text>
                {/* When it was actually paid: date and time. */}
                <Text style={s.histSub}>{t('paidAtTime', { date: format.fullDate(new Date(record.paidAt)), time: format.time(new Date(record.paidAt)) })}</Text>
                <Text style={s.histSub}>
                  {[record.paidBy ? t('paidBy', { name: record.paidBy.name }) : null, record.receiptIds.length ? `📎 ${t('receiptsCount', { count: format.number(record.receiptIds.length) })}` : null].filter(Boolean).join(' · ')}
                </Text>
                {record.receiptCheck ? (
                  <Text style={[s.histSub, { fontWeight: '700', color: record.receiptCheck === 'MATCH' ? colors.success : record.receiptCheck === 'UNAVAILABLE' ? colors.tones.amber.fg : colors.danger }]}>
                    {[
                      t(`receipt_${record.receiptCheck}` as StringKey),
                      record.receiptAmount && record.receiptCheck !== 'MATCH' ? format.money(record.receiptAmount, record.receiptCurrency ?? payment.currency) : null,
                      record.overridden ? t('receiptOverridden') : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <Text style={s.histAmount}>{format.money(record.amount, payment.currency)}</Text>
            </View>
          )) : <Text style={s.hint}>{t('noHistory')}</Text>}
        </Card>
      </View>

      {can('DELETE_PAYMENT') ? (
        <ConfirmDeleteButton
          label={t('deletePayment')}
          question={t('deletePaymentQuestion')}
          onConfirm={async () => {
            await call((sess, r) => deletePayment(sess, payment.id, r));
            void syncDevice().catch(() => undefined);
            if (router.canGoBack()) router.back();
            else router.replace('/payments');
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function Detail({ icon, label, value, divider = false }: { icon: IconName; label: string; value: string; divider?: boolean }) {
  const { colors } = usePreferences();
  const s = useStyles((c, d) => ({
    row: { minHeight: 54, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    label: { color: c.muted, fontSize: 14, textAlign: d.start },
    value: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.end },
  }));
  return (
    <View style={[s.row, divider && s.divider]}>
      <IconBubble name={icon} color={colors.primary} background={colors.primarySoft} size={32} />
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

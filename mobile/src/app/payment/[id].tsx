import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { cancelPayment, deletePayment, getPayment, type PaymentDetails } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, ConfirmDeleteButton, EmptyState, IconBubble, PrimaryButton, SectionTitle, Skeleton, SmallButton, type IconName } from '../../components';
import type { StringKey } from '../../i18n';
import { useNotifications } from '../../NotificationsContext';
import { CATEGORY_META, StatusPill, useDueText } from '../../paymentFormat';
import { usePayPayment } from '../../PaymentViews';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { AttachmentsSection } from '../../attachments';

export default function PaymentDetailsPage() {
  return (
    <WithBottomBar>
      <PaymentDetailsScreen />
    </WithBottomBar>
  );
}

function PaymentDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call, session } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const due = useDueText();
  const can = useCan();
  const pay = usePayPayment();
  const { syncDevice } = useNotifications();
  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);
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

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Stack.Screen
        options={{
          title: t('paymentDetails'),
          headerRight: active && can('EDIT_PAYMENT') ? () => <SmallButton label={t('edit')} icon="create-outline" onPress={() => router.push({ pathname: '/payment/new', params: { id: payment.id } })} /> : undefined,
        }}
      />
      <Card style={s.hero}>
        <IconBubble name={meta.icon} color={colors.tones[meta.tone].icon} background={colors.tones[meta.tone].from} size={64} />
        <Text style={s.amount}>{format.money(payment.amount, payment.currency)}</Text>
        <Text style={s.name}>{payment.name}</Text>
        <StatusPill status={payment.status} />
        {active ? <Text style={s.when}>{payment.status === 'OVERDUE' ? t('wasDue', { when: due.when(payment) }) : t('dueOn', { when: due.when(payment) })}</Text> : null}
      </Card>

      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {active && can('EDIT_PAYMENT') ? (
        <PrimaryButton
          label={payment.status === 'OVERDUE' ? t('markPaid') : t('payNow')}
          icon="checkmark-done"
          busy={paying}
          onPress={() => {
            setPaying(true);
            pay(payment)
              .then((message) => { setNotice(message); return load(); })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : t('saveError')))
              .finally(() => setPaying(false));
          }}
        />
      ) : null}

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

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('attachments')} />
        <Card>
          {/* New proofs attach to the most recently paid cycle when there is one. */}
          <AttachmentsSection
            target={{ paymentId: payment.id }}
            uploadTarget={payment.history[0] ? { paymentRecordId: payment.history[0].id } : undefined}
            canAdd={can('EDIT_PAYMENT') || payment.assignee.id === session.user.id}
            refreshKey={payment.history.length}
          />
        </Card>
      </View>

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('paymentHistory')} count={payment.history.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {payment.history.length ? payment.history.map((record, index) => (
            <View key={record.id} style={[s.histRow, index > 0 && s.divider]}>
              <IconBubble name="checkmark-circle" color={colors.success} background={colors.successSoft} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={s.histText}>{format.date(record.dueDate)}</Text>
                <Text style={s.histSub}>{format.fullDate(new Date(record.paidAt))}{record.paidBy ? ` · ${t('paidBy', { name: record.paidBy.name })}` : ''}</Text>
              </View>
              <Text style={s.histAmount}>{format.money(record.amount, payment.currency)}</Text>
            </View>
          )) : <Text style={s.hint}>{t('noHistory')}</Text>}
        </Card>
      </View>

      {active && can('EDIT_PAYMENT') ? (
        <ConfirmDeleteButton
          label={t('cancelPayment')}
          question={t('cancelPaymentQuestion')}
          onConfirm={async () => {
            await call((sess, r) => cancelPayment(sess, payment.id, r));
            void syncDevice().catch(() => undefined);
            await load();
          }}
        />
      ) : null}
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

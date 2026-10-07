import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPayments, type Payment, type PaymentStatus } from '../../api';
import { Card, EmptyState, ListSkeleton, ScreenHeader, SmallButton } from '../../components';
import { Chips } from '../../formControls';
import type { StringKey } from '../../i18n';
import { PaymentRow } from '../../PaymentViews';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useCan, useSession } from '../../SessionContext';

type Filter = 'OPEN' | 'ALL' | PaymentStatus;
const FILTERS: Filter[] = ['OPEN', 'OVERDUE', 'DUE_TODAY', 'DUE_SOON', 'PAID', 'CANCELLED', 'ALL'];

export default function PaymentsScreen() {
  const { call } = useSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setPayments(await call((s, r) => getPayments(s, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const counts = useMemo(() => {
    const result: Partial<Record<Filter, number>> = { ALL: payments.length, OPEN: payments.filter((p) => p.state === 'ACTIVE').length };
    for (const payment of payments) result[payment.status] = (result[payment.status] ?? 0) + 1;
    return result;
  }, [payments]);

  const visible = payments.filter((p) => (filter === 'ALL' ? true : filter === 'OPEN' ? p.state === 'ACTIVE' : p.status === filter));

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 16 },
    notice: { color: c.success, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  const label = (key: Filter) => {
    const name = key === 'OPEN' ? t('filterOpen') : key === 'ALL' ? t('filterAll') : t(`status_${key}` as StringKey);
    return counts[key] ? `${name} · ${format.number(counts[key]!)}` : name;
  };

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
      >
        <ScreenHeader
          title={t('payments')}
          subtitle={t('paymentsSubtitle')}
          action={can('ADD_PAYMENT') ? <SmallButton label={t('add')} icon="add" onPress={() => router.push('/payment/new')} /> : undefined}
        />
        <Chips options={FILTERS.filter((key) => key === 'OPEN' || key === 'ALL' || counts[key]).map((key) => ({ value: key, label: label(key) }))} value={filter} onChange={setFilter} />
        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {loading ? <ListSkeleton rows={4} /> : visible.length ? (
            visible.map((payment, index) => (
              <PaymentRow key={payment.id} payment={payment} last={index === visible.length - 1} onChanged={(message) => { setNotice(message); void load(); }} />
            ))
          ) : (
            <View>
              <EmptyState icon="calendar-outline" title={t('noPayments')} body={t('noPaymentsBody')} />
            </View>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

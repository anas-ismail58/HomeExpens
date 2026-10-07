import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPayments, type Payment, type PaymentStatus } from '../../api';
import { Card, EmptyState, GradientHero, ListSkeleton, ScreenHeader, SmallButton } from '../../components';
import { Chips } from '../../formControls';
import type { StringKey } from '../../i18n';
import { PaymentRow } from '../../PaymentViews';
import { convert, useFormat, usePreferences, useStyles } from '../../preferences';
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
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    try {
      setPayments(await call((s, r) => getPayments(s, r)));
      setLoadedAt(Date.now());
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

  // Totals in the viewer's display currency (payments can be in different currencies).
  const { displayCurrency, rates } = usePreferences();
  const totals = useMemo(() => {
    const inDisplay = (p: Payment) => convert(Number(p.amount), p.currency, displayCurrency, rates) ?? Number(p.amount);
    const open = payments.filter((p) => p.state === 'ACTIVE');
    const thisMonth = new Date(loadedAt).toISOString().slice(0, 7);
    const sum = (list: Payment[]) => list.reduce((total, p) => total + inDisplay(p), 0);
    return {
      open: sum(open),
      openCount: open.length,
      overdue: sum(open.filter((p) => p.status === 'OVERDUE')),
      week: sum(open.filter((p) => p.status === 'DUE_TODAY' || p.status === 'DUE_SOON' || (new Date(p.dueAt).getTime() - loadedAt < 7 * 86_400_000 && p.status !== 'OVERDUE'))),
      paidMonth: sum(payments.filter((p) => p.lastPaidAt?.startsWith(thisMonth))),
    };
  }, [displayCurrency, loadedAt, payments, rates]);

  const visible = payments.filter((p) => (filter === 'ALL' ? true : filter === 'OPEN' ? p.state === 'ACTIVE' : p.status === filter));

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 16 },
    heroLabel: { color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    heroAmount: { color: c.heroText, fontSize: 30, fontWeight: '800' as const, textAlign: d.start, marginTop: 4, fontVariant: ['tabular-nums' as const] },
    heroCount: { color: c.heroMuted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    split: { flexDirection: d.row, gap: 8, marginTop: 14 },
    chip: { flex: 1, minWidth: 0, borderRadius: 12, padding: 10, backgroundColor: 'rgba(255,255,255,0.14)' },
    chipLabel: { color: c.heroMuted, fontSize: 11, textAlign: d.start },
    chipValue: { color: c.heroText, fontSize: 14, fontWeight: '700' as const, marginTop: 3, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    notice: { color: c.success, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  const label = (key: Filter) => {
    const name = key === 'OPEN' ? t('filterOpen') : key === 'ALL' ? t('filterAll') : t(`status_${key}` as StringKey);
    return counts[key] ? `${name} · ${format.number(counts[key]!)}` : name;
  };

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
      >
        <ScreenHeader
          title={t('payments')}
          subtitle={t('paymentsSubtitle')}
          action={can('ADD_PAYMENT') ? <SmallButton label={t('add')} icon="add" onPress={() => router.push('/payment/new')} /> : undefined}
        />
        {payments.length ? (
          <GradientHero style={{ padding: 16 }}>
            <Text style={s.heroLabel}>{t('totalOpen')}</Text>
            <Text style={s.heroAmount} numberOfLines={1} adjustsFontSizeToFit>{format.money(totals.open, displayCurrency)}</Text>
            <Text style={s.heroCount}>{t('openCount', { count: format.number(totals.openCount) })}</Text>
            <View style={s.split}>
              <View style={s.chip}>
                <Text style={s.chipLabel}>{t('overdueTotal')}</Text>
                <Text style={s.chipValue} numberOfLines={1}>{format.money(totals.overdue, displayCurrency)}</Text>
              </View>
              <View style={s.chip}>
                <Text style={s.chipLabel}>{t('dueWeekTotal')}</Text>
                <Text style={s.chipValue} numberOfLines={1}>{format.money(totals.week, displayCurrency)}</Text>
              </View>
              <View style={s.chip}>
                <Text style={s.chipLabel}>{t('paidThisMonth')}</Text>
                <Text style={s.chipValue} numberOfLines={1}>{format.money(totals.paidMonth, displayCurrency)}</Text>
              </View>
            </View>
          </GradientHero>
        ) : null}
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

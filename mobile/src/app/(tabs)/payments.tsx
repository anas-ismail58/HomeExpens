import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAllCountriesPayments, type Payment, type PaymentStatus } from '../../api';
import { useCountries } from '../../countries';
import { countryFlag, useCountryName } from '../../CountrySwitcher';
import { totalsOf } from '../../paymentFormat';
import { Card, EmptyState, GradientHero, ListSkeleton, ScreenHeader, SmallButton } from '../../components';
import { Chips } from '../../formControls';
import type { StringKey } from '../../i18n';
import { FadeInView, useCountUp } from '../../motion';
import { PaymentRow } from '../../PaymentViews';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAutoRefresh } from '../../useAutoRefresh';
import { useCan, useSession } from '../../SessionContext';

type Filter = 'OPEN' | 'ALL' | PaymentStatus;
const FILTERS: Filter[] = ['ALL', 'OPEN', 'OVERDUE', 'DUE_TODAY', 'DUE_SOON', 'PAID', 'CANCELLED'];
const ALL = 'ALL';

/** Country and currency filters, kept while moving around the app (until it is closed). */
const kept: { country: string | null; currency: string } = { country: null, currency: ALL };

export default function PaymentsScreen() {
  const { call } = useSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const [payments, setPayments] = useState<Payment[]>([]);
  const { countries, selected: appCountry } = useCountries();
  const countryName = useCountryName();
  // Starts on the country the app shows; then the page's own choice is kept.
  const [country, setCountryState] = useState<string>(kept.country ?? (appCountry === 'all' ? ALL : appCountry));
  const [currency, setCurrencyState] = useState<string>(kept.currency);
  const setCountry = (next: string) => { kept.country = next; setCountryState(next); };
  const setCurrency = (next: string) => { kept.currency = next; setCurrencyState(next); };
  // Always start on everything: paid, unpaid and cancelled.
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setPayments(await call((s, r) => getAllCountriesPayments(s, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, t]);

  useAutoRefresh(load);

  // Country first, then currency (only the currencies that country's payments use).
  const multiCountry = countries.length > 1;
  const activeCountry = multiCountry && countries.some((c) => c.id === country) ? country : ALL;
  const inCountry = activeCountry === ALL ? payments : payments.filter((p) => p.countryId === activeCountry);
  const currencies = [...new Set(inCountry.map((p) => p.currency))].sort();
  const activeCurrency = currencies.includes(currency) ? currency : ALL;
  const scoped = activeCurrency === ALL ? inCountry : inCountry.filter((p) => p.currency === activeCurrency);

  // "Open" = still to pay: active and not already paid for this cycle (a paid monthly bill is "Paid" only).
  const isOpen = (p: Payment) => p.state === 'ACTIVE' && p.status !== 'PAID';
  const counts = useMemo(() => {
    const result: Partial<Record<Filter, number>> = { ALL: scoped.length, OPEN: scoped.filter(isOpen).length };
    for (const payment of scoped) result[payment.status] = (result[payment.status] ?? 0) + 1;
    return result;
  }, [scoped]);

  const visible = scoped.filter((p) => (filter === 'ALL' ? true : filter === 'OPEN' ? isOpen(p) : p.status === filter));
  // Totals never mix currencies: one set of totals per currency, each in its own currency.
  const byCurrency = [...new Set(visible.map((p) => p.currency))].sort().map((code) => ({
    currency: code,
    totals: totalsOf(visible.filter((p) => p.currency === code), (amount) => amount),
  }));
  const single = byCurrency.length <= 1 ? byCurrency[0] ?? { currency: activeCurrency === ALL ? currencies[0] ?? '' : activeCurrency, totals: totalsOf([], (a) => a) } : null;
  const tabTotals = single?.totals ?? totalsOf([], (a) => a);
  const displayCurrency = single?.currency ?? '';
  // The hero's numbers glide to the new tab's totals.
  const shown = { total: useCountUp(tabTotals.total), paid: useCountUp(tabTotals.paid), toPay: useCountUp(tabTotals.toPay), overdue: useCountUp(tabTotals.overdue) };
  const filtered = activeCountry !== ALL || activeCurrency !== ALL;

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 16 },
    heroLabel: { color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    heroAmount: { color: c.heroText, fontSize: 30, fontWeight: '800' as const, textAlign: d.start, marginTop: 4, fontVariant: ['tabular-nums' as const] },
    heroCount: { color: c.heroMuted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    split: { flexDirection: d.row, gap: 8, marginTop: 14 },
    chip: { flex: 1, minWidth: 0, borderRadius: 12, padding: 10, backgroundColor: 'rgba(255,255,255,0.14)' },
    chipLabel: { color: c.heroMuted, fontSize: 11, textAlign: d.start },
    bigChip: { padding: 12, backgroundColor: 'rgba(255,255,255,0.2)' },
    bigValue: { color: c.heroText, fontSize: 18, fontWeight: '800' as const, marginTop: 4, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    chipValue: { color: c.heroText, fontSize: 14, fontWeight: '700' as const, marginTop: 3, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    notice: { color: c.success, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    filterRow: { flexDirection: d.row, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: 8 },
    reset: { color: c.primary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    currencyCard: { borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.16)', gap: 6 },
    currencyHead: { flexDirection: d.row, alignItems: 'baseline' as const, justifyContent: 'space-between' as const, gap: 8 },
    currencyCode: { color: c.heroText, fontSize: 13, fontWeight: '800' as const },
    currencyTotal: { color: c.heroText, fontSize: 20, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    currencyLine: { color: c.heroMuted, fontSize: 12, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
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
        {/* The cards add up exactly the payments of the selected tab. */}
        {/* Filters: country (when the family has several) and currency; combined, kept while navigating. */}
        {multiCountry ? (
          <Chips
            options={[{ value: ALL, label: t('allCountries'), icon: 'earth' as const }, ...countries.map((c) => ({ value: c.id, label: `${countryFlag(c.code)} ${countryName(c)}` }))]}
            value={activeCountry}
            onChange={setCountry}
          />
        ) : null}
        {currencies.length > 1 || activeCurrency !== ALL ? (
          <View style={s.filterRow}>
            <Chips options={[{ value: ALL, label: t('allCurrencies') }, ...currencies.map((code) => ({ value: code, label: code }))]} value={activeCurrency} onChange={setCurrency} />
          </View>
        ) : null}
        {filtered ? (
          <Pressable onPress={() => { setCountry(ALL); setCurrency(ALL); }} accessibilityRole="button">
            <Text style={s.reset}>{t('resetFilters')}</Text>
          </Pressable>
        ) : null}
        {payments.length && !single ? (
          <GradientHero style={{ padding: 16, gap: 10 }}>
            <Text style={s.heroLabel}>{t('grandTotal')} · {label(filter).split(' · ')[0]} · {t('perCurrency')}</Text>
            {byCurrency.map(({ currency: code, totals }) => (
              <View key={code} style={s.currencyCard}>
                <View style={s.currencyHead}>
                  <Text style={s.currencyCode}>{code} · {format.number(totals.count)}</Text>
                  <Text style={s.currencyTotal} numberOfLines={1}>{format.rawMoney(totals.total, code)}</Text>
                </View>
                <Text style={s.currencyLine}>✓ {t('paidPart')}: {format.rawMoney(totals.paid, code)}   ·   {t('willPay')}: {format.rawMoney(totals.toPay, code)}</Text>
                {totals.overdue > 0 ? <Text style={s.currencyLine}>⚠️ {t('overdueTotal')}: {format.rawMoney(totals.overdue, code)}</Text> : null}
              </View>
            ))}
          </GradientHero>
        ) : null}
        {payments.length && single ? (
          <GradientHero style={{ padding: 16 }}>
            <Text style={s.heroLabel}>{t('grandTotal')} · {label(filter).split(' · ')[0]}</Text>
            <Text style={s.heroAmount} numberOfLines={1} adjustsFontSizeToFit>{format.rawMoney(shown.total, displayCurrency)}</Text>
            <Text style={s.chipLabel}>{t('paymentsCount', { count: format.number(tabTotals.count) })}</Text>
            <View style={s.split}>
              <View style={[s.chip, s.bigChip]}>
                <Text style={s.chipLabel}>✓ {t('paidPart')}</Text>
                <Text style={s.bigValue} numberOfLines={1}>{format.rawMoney(shown.paid, displayCurrency)}</Text>
                <Text style={s.chipLabel}>{t('paidCount', { count: format.number(tabTotals.paidCount) })}</Text>
              </View>
              <View style={[s.chip, s.bigChip]}>
                <Text style={s.chipLabel}>{t('willPay')}</Text>
                <Text style={s.bigValue} numberOfLines={1}>{format.rawMoney(shown.toPay, displayCurrency)}</Text>
                <Text style={s.chipLabel}>{t('paidCount', { count: format.number(tabTotals.toPayCount) })}</Text>
              </View>
            </View>
            {tabTotals.overdue > 0 ? (
              <View style={s.split}>
                <View style={s.chip}>
                  <Text style={s.chipLabel}>⚠️ {t('overdueTotal')} · {format.number(tabTotals.overdueCount)}</Text>
                  <Text style={s.chipValue} numberOfLines={1}>{format.rawMoney(shown.overdue, displayCurrency)}</Text>
                </View>
              </View>
            ) : null}
          </GradientHero>
        ) : null}
        <Chips options={FILTERS.filter((key) => key === 'OPEN' || key === 'ALL' || counts[key]).map((key) => ({ value: key, label: label(key) }))} value={filter} onChange={setFilter} />
        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {loading ? <ListSkeleton rows={4} /> : visible.length ? (
            visible.map((payment, index) => (
              // Keyed by tab too, so switching tabs replays the staggered entrance.
              <FadeInView key={`${filter}-${payment.id}`} index={index}>
                <PaymentRow payment={payment} last={index === visible.length - 1} onChanged={(message) => { setNotice(message); void load(); }} />
              </FadeInView>
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

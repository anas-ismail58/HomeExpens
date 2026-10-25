import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { addBankAccount, CURRENCIES, getBankAccounts, type BankOverview } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, GradientHero, IconBubble, ListSkeleton, PrimaryButton, SmallButton } from '../../components';
import { useCountries } from '../../countries';
import { countryFlag, useCountryName } from '../../CountrySwitcher';
import { Chips, Field, TextField } from '../../formControls';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

const ALL = 'ALL';
const AMOUNT = /^\d{0,11}(\.\d{1,3})?$/;

export default function BankPage() {
  return (
    <WithBottomBar>
      <BankScreen />
    </WithBottomBar>
  );
}

/** Bank savings: the user's own bank balances, apart from spending money. Tracking only. */
function BankScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const { countries, current, inputCurrency } = useCountries();
  const countryName = useCountryName();
  const [data, setData] = useState<BankOverview | null>(null);
  const [country, setCountry] = useState(ALL);
  const [currency, setCurrency] = useState(ALL);
  const [adding, setAdding] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [newCountry, setNewCountry] = useState<string | null>(null);
  const [newCurrency, setNewCurrency] = useState<string | null>(null);
  const [balance, setBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await call(getBankAccounts));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const pickedCountry = newCountry ?? current?.id ?? countries.find((c) => c.isDefault)?.id ?? null;
  const pickedCurrency = newCurrency ?? countries.find((c) => c.id === pickedCountry)?.currency ?? inputCurrency;
  const add = async () => {
    setBusy(true);
    try {
      const account = await call((s, r) => addBankAccount(s, { bankName: bankName.trim(), accountName: accountName.trim(), countryId: pickedCountry, currency: pickedCurrency, balance: balance.trim() || undefined }, r));
      setBankName('');
      setAccountName('');
      setBalance('');
      setAdding(false);
      router.push(`/bank/${account.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16, width: '100%' as const, maxWidth: 820, alignSelf: 'center' as const },
    note: { color: c.textSecondary, fontSize: 13, lineHeight: 20, textAlign: d.start },
    heroLabel: { color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    totalRow: { flexDirection: d.row, alignItems: 'baseline' as const, justifyContent: 'space-between' as const, marginTop: 10 },
    totalCode: { color: c.heroMuted, fontSize: 13, fontWeight: '800' as const },
    totalValue: { color: c.heroText, fontSize: 24, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    combined: { color: c.heroMuted, fontSize: 12, textAlign: d.start, marginTop: 10 },
    row: { minHeight: 64, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 10 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    name: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 12, marginTop: 2, textAlign: d.start },
    amount: { color: c.text, fontSize: 15, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (session.user.role === 'CHILD') {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  const accounts = (data?.accounts ?? []).filter((a) => (country === ALL || a.countryId === country) && (currency === ALL || a.currency === currency));
  const usedCurrencies = [...new Set((data?.accounts ?? []).map((a) => a.currency))].sort();
  // Totals of what the filters show, one per currency.
  const totals = [...new Set(accounts.map((a) => a.currency))].sort().map((code) => ({
    currency: code,
    amount: accounts.filter((a) => a.currency === code).reduce((sum, a) => sum + Number(a.balance), 0),
  }));
  const countryOf = (id: string | null) => countries.find((c) => c.id === id);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Text style={s.note}>{t('bankIntro')}</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}

      <GradientHero>
        <Text style={s.heroLabel}>{t('bankTotal')}</Text>
        {!data ? null : totals.length ? totals.map((row) => (
          <View key={row.currency} style={s.totalRow}>
            <Text style={s.totalCode}>{row.currency}</Text>
            <Text style={s.totalValue} numberOfLines={1}>{format.rawMoney(row.amount, row.currency)}</Text>
          </View>
        )) : <Text style={[s.combined, { fontSize: 14 }]}>{t('bankNoAccounts')}</Text>}
        {data?.combined && totals.length > 1 && country === ALL && currency === ALL ? (
          <Text style={s.combined}>≈ {format.rawMoney(data.combined.amount, data.combined.currency)} ({t('debtCombinedNote')})</Text>
        ) : null}
      </GradientHero>

      {countries.length > 1 ? (
        <Chips options={[{ value: ALL, label: t('allCountries'), icon: 'earth' as const }, ...countries.map((c) => ({ value: c.id, label: `${countryFlag(c.code)} ${countryName(c)}` }))]} value={country} onChange={setCountry} />
      ) : null}
      {usedCurrencies.length > 1 ? (
        <Chips options={[{ value: ALL, label: t('allCurrencies') }, ...usedCurrencies.map((code) => ({ value: code, label: code }))]} value={currency} onChange={setCurrency} />
      ) : null}

      {adding ? (
        <Card style={{ gap: 12 }}>
          <Field label={t('bankName')}><TextField value={bankName} onChange={setBankName} placeholder={t('bankNamePlaceholder')} /></Field>
          <Field label={t('bankAccountName')}><TextField value={accountName} onChange={setAccountName} placeholder={t('bankAccountNamePlaceholder')} /></Field>
          {countries.length > 1 ? (
            <Field label={t('bankCountry')}>
              <Chips options={countries.map((c) => ({ value: c.id, label: `${countryFlag(c.code)} ${countryName(c)}` }))} value={pickedCountry} onChange={setNewCountry} />
            </Field>
          ) : null}
          <Field label={t('currency')}><Chips options={CURRENCIES.map((code) => ({ value: code, label: code }))} value={pickedCurrency} onChange={setNewCurrency} /></Field>
          <Field label={`${t('bankCurrentBalance')} · ${pickedCurrency}`}><TextField value={balance} onChange={setBalance} keyboardType="decimal-pad" placeholder={format.number(0)} /></Field>
          <PrimaryButton label={t('add')} icon="add" busy={busy} disabled={!bankName.trim() || !accountName.trim() || !AMOUNT.test(balance.trim())} onPress={() => void add()} />
          <Pressable onPress={() => setAdding(false)} accessibilityRole="button"><Text style={[s.sub, { textAlign: 'center' }]}>{t('cancel')}</Text></Pressable>
        </Card>
      ) : (
        <View style={{ alignItems: 'flex-start' }}><SmallButton label={t('bankAddAccount')} icon="add" onPress={() => setAdding(true)} /></View>
      )}

      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {!data ? <ListSkeleton rows={3} /> : accounts.length ? accounts.map((account, index) => {
          const where = countryOf(account.countryId);
          return (
            <Pressable key={account.id} onPress={() => router.push(`/bank/${account.id}`)} style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && { opacity: 0.7 }]} accessibilityRole="button">
              <IconBubble name="business" color={colors.tones.teal.icon} background={colors.tones.teal.from} size={42} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{account.bankName}</Text>
                <Text style={s.sub} numberOfLines={1}>{[account.accountName, where ? `${countryFlag(where.code)} ${countryName(where)}` : null].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={s.amount}>{format.rawMoney(account.balance, account.currency)}</Text>
            </Pressable>
          );
        }) : <EmptyState icon="business-outline" title={t('bankEmptyTitle')} body={t('bankEmptyBody')} />}
      </Card>
    </ScrollView>
  );
}

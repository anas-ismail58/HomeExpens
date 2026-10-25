import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { addDebtPerson, getDebts, type DebtBalance, type DebtPerson, type DebtsOverview } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, GradientHero, ListSkeleton, PrimaryButton, SmallButton } from '../../components';
import { Chips, Field, TextField } from '../../formControls';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text, TextInput } from '../../typography';

type Show = 'ALL' | 'OWES_ME' | 'I_OWE' | 'SETTLED';

export default function DebtsPage() {
  return (
    <WithBottomBar>
      <DebtsScreen />
    </WithBottomBar>
  );
}

/** Pay to other wallet: money owed to me and money I owe, per person and per currency. Only mine. */
function DebtsScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [data, setData] = useState<DebtsOverview | null>(null);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('ALL');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await call(getDebts));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const add = async () => {
    setBusy(true);
    try {
      const person = await call((s, r) => addDebtPerson(s, { name: name.trim(), phone: phone.trim() || undefined, notes: notes.trim() || undefined }, r));
      setName('');
      setPhone('');
      setNotes('');
      setAdding(false);
      router.push(`/debts/${person.id}`);
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
    currencyCard: { borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.16)', gap: 8, marginTop: 10 },
    currencyCode: { color: c.heroText, fontSize: 13, fontWeight: '800' as const, textAlign: d.start },
    three: { flexDirection: d.row, gap: 8 },
    cell: { flex: 1, minWidth: 0 },
    cellLabel: { color: c.heroMuted, fontSize: 11, textAlign: d.start },
    cellValue: { color: c.heroText, fontSize: 15, fontWeight: '800' as const, marginTop: 2, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    combined: { color: c.heroMuted, fontSize: 12, textAlign: d.start, marginTop: 10 },
    search: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, backgroundColor: c.surface },
    searchInput: { flex: 1, minHeight: 46, color: c.text, fontSize: 15, textAlign: d.start },
    row: { minHeight: 64, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 10 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    avatar: { width: 42, height: 42, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
    avatarText: { color: c.primary, fontSize: 17, fontWeight: '800' as const },
    name: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 12, marginTop: 2, textAlign: d.start },
    amounts: { alignItems: 'flex-end' as const, gap: 2 },
    amount: { fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (session.user.role === 'CHILD') {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  const owes = (p: DebtPerson) => p.balances.some((b) => Number(b.owedToMe) > 0);
  const owe = (p: DebtPerson) => p.balances.some((b) => Number(b.iOwe) > 0);
  const q = query.trim().toLowerCase();
  const people = (data?.people ?? []).filter((p) => {
    if (q && !p.name.toLowerCase().includes(q) && !(p.phone ?? '').includes(q)) return false;
    if (show === 'OWES_ME') return owes(p);
    if (show === 'I_OWE') return owe(p);
    if (show === 'SETTLED') return !owes(p) && !owe(p);
    return true;
  });
  // One line per currency: what they owe me (green) and what I owe them (red).
  const amountLines = (balances: DebtBalance[]) =>
    balances.flatMap((b) => [
      Number(b.owedToMe) > 0 ? <Text key={`${b.currency}-in`} style={[s.amount, { color: colors.success }]}>{t('debtOwesYouShort', { amount: format.rawMoney(b.owedToMe, b.currency) })}</Text> : null,
      Number(b.iOwe) > 0 ? <Text key={`${b.currency}-out`} style={[s.amount, { color: colors.danger }]}>{t('debtYouOweShort', { amount: format.rawMoney(b.iOwe, b.currency) })}</Text> : null,
    ]);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Text style={s.note}>{t('debtsIntro')}</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}

      {/* Summary per currency: owed to me, I owe, net. */}
      <GradientHero>
        <Text style={s.heroLabel}>{t('debtsSummary')}</Text>
        {!data ? null : data.totals.length ? data.totals.map((row) => (
          <View key={row.currency} style={s.currencyCard}>
            <Text style={s.currencyCode}>{row.currency}</Text>
            <View style={s.three}>
              <View style={s.cell}><Text style={s.cellLabel}>{t('debtOwedToMe')}</Text><Text style={s.cellValue} numberOfLines={1}>{format.rawMoney(row.owedToMe, row.currency)}</Text></View>
              <View style={s.cell}><Text style={s.cellLabel}>{t('debtIOwe')}</Text><Text style={s.cellValue} numberOfLines={1}>{format.rawMoney(row.iOwe, row.currency)}</Text></View>
              <View style={s.cell}><Text style={s.cellLabel}>{t('debtNet')}</Text><Text style={s.cellValue} numberOfLines={1}>{format.rawMoney(row.net, row.currency)}</Text></View>
            </View>
          </View>
        )) : <Text style={[s.combined, { fontSize: 14 }]}>{t('debtsNothingOutstanding')}</Text>}
        {data?.combined && data.totals.length > 1 ? (
          <Text style={s.combined}>≈ {t('debtNet')}: {format.rawMoney(data.combined.net, data.combined.currency)} ({t('debtCombinedNote')})</Text>
        ) : null}
      </GradientHero>

      <View style={s.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder={t('debtSearch')} placeholderTextColor={colors.muted} style={s.searchInput} accessibilityLabel={t('debtSearch')} />
      </View>
      <Chips<Show>
        options={[
          { value: 'ALL', label: t('filterAll') },
          { value: 'OWES_ME', label: t('debtFilterOwesMe') },
          { value: 'I_OWE', label: t('debtFilterIOwe') },
          { value: 'SETTLED', label: t('debtFilterSettled') },
        ]}
        value={show}
        onChange={setShow}
      />

      {adding ? (
        <Card style={{ gap: 12 }}>
          <Field label={t('debtPersonName')}><TextField value={name} onChange={setName} placeholder={t('debtPersonNamePlaceholder')} /></Field>
          <Field label={t('debtPhoneOptional')}><TextField value={phone} onChange={setPhone} keyboardType="phone-pad" /></Field>
          <Field label={t('optionalNote')}><TextField value={notes} onChange={setNotes} /></Field>
          <PrimaryButton label={t('add')} icon="person-add" busy={busy} disabled={!name.trim()} onPress={() => void add()} />
          <Pressable onPress={() => setAdding(false)} accessibilityRole="button"><Text style={[s.sub, { textAlign: 'center' }]}>{t('cancel')}</Text></Pressable>
        </Card>
      ) : (
        <View style={{ alignItems: 'flex-start' }}><SmallButton label={t('debtAddPerson')} icon="person-add" onPress={() => setAdding(true)} /></View>
      )}

      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {!data ? <ListSkeleton rows={3} /> : people.length ? people.map((person, index) => (
          <Pressable key={person.id} onPress={() => router.push(`/debts/${person.id}`)} style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <View style={s.avatar}><Text style={s.avatarText}>{person.name.trim().charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name} numberOfLines={1}>{person.name}</Text>
              <Text style={s.sub} numberOfLines={1}>{[person.phone, person.nextDue ? t('debtDueOn', { date: format.date(person.nextDue) }) : null].filter(Boolean).join(' · ') || (person.balances.length ? '' : t('debtSettled'))}</Text>
            </View>
            <View style={s.amounts}>{amountLines(person.balances)}</View>
          </Pressable>
        )) : <EmptyState icon="people-outline" title={t('debtsEmptyTitle')} body={t('debtsEmptyBody')} />}
      </Card>
    </ScrollView>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { addPrivateEntry, deletePrivateEntry, getIncomeSummary, getPrivateMoney, type IncomeSummary, type PrivateSummary } from '../api';
import { WithBottomBar } from '../BottomBar';
import { Card, EmptyState, GradientHero, IconBubble, InlineDelete, ListSkeleton, MonthSwitcher, PrimaryButton, SectionTitle, SegmentedControl } from '../components';
import { Field, normalizeDigits, TextField, toDateOnly } from '../formControls';
import { useFormat, usePreferences, useStyles } from '../preferences';
import { useAuthedSession } from '../SessionContext';
import { Text } from '../typography';
import { shiftMonth, thisMonth } from '../useMonthlyReport';

const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;
const MASK = '••••••';

export default function PrivateMoneyPage() {
  return (
    <WithBottomBar>
      <PrivateMoneyScreen />
    </WithBottomBar>
  );
}

/** The father's private money. The server only ever returns the signed-in father's own entries. */
function PrivateMoneyScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<PrivateSummary | null>(null);
  const [budget, setBudget] = useState<IncomeSummary | null>(null);
  // Hidden by default so nobody reads the amounts over his shoulder.
  const [visible, setVisible] = useState(false);
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [privateData, familyBudget] = await Promise.all([
        call((s, r) => getPrivateMoney(s, month, r)),
        call((s, r) => getIncomeSummary(s, month, r)).catch(() => null),
      ]);
      setData(privateData);
      setBudget(familyBudget);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, month, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const value = normalizeDigits(amount);
  const valid = AMOUNT.test(value) && Number(value) > 0;
  const currency = data?.currency ?? session.family.currency;
  const money = (n: string | number) => (visible ? format.money(n, currency) : MASK);
  const balance = Number(data?.balance ?? 0);
  const familyRemaining = budget ? Number(budget.totals.remaining) : null;

  const save = async () => {
    setSaving(true);
    try {
      const date = month === thisMonth() ? toDateOnly(new Date()) : `${month}-01`;
      setData(await call((s, r) => addPrivateEntry(s, { direction, amount: value, note: note.trim() || undefined, date }, r)));
      setAmount('');
      setNote('');
      setVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18 },
    note: { color: c.textSecondary, fontSize: 13, lineHeight: 20, textAlign: d.start },
    heroTop: { flexDirection: d.row, alignItems: 'center' as const, gap: 8 },
    heroLabel: { flex: 1, color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    eye: { width: 40, height: 40, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(255,255,255,0.2)' },
    heroAmount: { color: c.heroText, fontSize: 34, fontWeight: '800' as const, textAlign: d.start, marginTop: 6, fontVariant: ['tabular-nums' as const] },
    split: { flexDirection: d.row, gap: 10, marginTop: 16 },
    chip: { flex: 1, minWidth: 0, borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.14)' },
    chipLabel: { color: c.heroMuted, fontSize: 12, textAlign: d.start },
    chipValue: { color: c.heroText, fontSize: 15, fontWeight: '700' as const, marginTop: 4, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowLabel: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    rowSub: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    rowValue: { fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    calcLabel: { flex: 1, color: c.textSecondary, fontSize: 13, textAlign: d.start },
    calcValue: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    total: { color: c.primary, fontSize: 16, fontWeight: '800' as const },
    hint: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 10 },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (session.user.role !== 'FATHER') {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Text style={s.note}>{t('privateOnlyYou')}</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}

      <GradientHero>
        <View style={s.heroTop}>
          <Text style={s.heroLabel}>{t('privateBalance')}</Text>
          <Pressable onPress={() => setVisible((v) => !v)} style={s.eye} accessibilityLabel={visible ? t('hideAmounts') : t('showAmounts')}>
            <Ionicons name={visible ? 'eye-off' : 'eye'} size={20} color={colors.heroText} />
          </Pressable>
        </View>
        <Text style={s.heroAmount} numberOfLines={1} adjustsFontSizeToFit>{data ? money(balance) : '—'}</Text>
        <View style={s.split}>
          <View style={s.chip}>
            <Text style={s.chipLabel}>{t('thisMonthIn')}</Text>
            <Text style={s.chipValue} numberOfLines={1}>{money(data?.monthIn ?? 0)}</Text>
          </View>
          <View style={s.chip}>
            <Text style={s.chipLabel}>{t('thisMonthOut')}</Text>
            <Text style={s.chipValue} numberOfLines={1}>{money(data?.monthOut ?? 0)}</Text>
          </View>
        </View>
      </GradientHero>

      {/* The calculation with private money happens only here, on the father's own screen. */}
      {familyRemaining !== null ? (
        <Card style={{ gap: 10 }}>
          <View style={s.heroTop}>
            <Text style={s.calcLabel}>{t('familyRemaining')}</Text>
            <Text style={s.calcValue}>{money(familyRemaining)}</Text>
          </View>
          <View style={s.heroTop}>
            <Text style={s.calcLabel}>+ {t('privateBalance')}</Text>
            <Text style={s.calcValue}>{money(balance)}</Text>
          </View>
          <View style={[s.heroTop, s.divider, { paddingTop: 10 }]}>
            <Text style={[s.calcLabel, { fontWeight: '700' }]}>{t('totalAvailable')}</Text>
            <Text style={[s.calcValue, s.total]}>{money(familyRemaining + balance)}</Text>
          </View>
        </Card>
      ) : null}

      <MonthSwitcher month={month} onChange={(step) => setMonth((m) => shiftMonth(m, step))} />

      <Card style={{ gap: 14 }}>
        <SegmentedControl<'IN' | 'OUT'> value={direction} onChange={setDirection} options={[{ value: 'IN', label: t('moneyIn') }, { value: 'OUT', label: t('moneyOut') }]} />
        <Field label={`${t('amount')} · ${currency}`}>
          <TextField value={amount} onChange={setAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
        </Field>
        <Field label={t('optionalNote')}>
          <TextField value={note} onChange={setNote} placeholder={t('privateNotePlaceholder')} />
        </Field>
        <PrimaryButton label={t('addEntry')} icon={direction === 'IN' ? 'arrow-down' : 'arrow-up'} busy={saving} disabled={!valid} onPress={() => void save()} />
      </Card>

      <View style={{ gap: 10 }}>
        <SectionTitle title={format.month(month)} count={data?.entries.length ?? 0} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {!data ? <ListSkeleton rows={2} /> : data.entries.length ? data.entries.map((entry, index) => {
            const incoming = entry.direction === 'IN';
            return (
              <View key={entry.id} style={[s.row, index > 0 && s.divider]}>
                <IconBubble
                  name={incoming ? 'arrow-down' : 'arrow-up'}
                  color={incoming ? colors.success : colors.danger}
                  background={incoming ? colors.successSoft : colors.dangerSoft}
                  size={36}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{entry.note || (incoming ? t('moneyIn') : t('moneyOut'))}</Text>
                  <Text style={s.rowSub}>{format.date(entry.date)}</Text>
                </View>
                <Text style={[s.rowValue, { color: incoming ? colors.success : colors.danger }]}>
                  {visible ? `${incoming ? '+' : '−'}${format.money(entry.amount, currency)}` : MASK}
                </Text>
                <InlineDelete label={entry.note ?? ''} onConfirm={async () => { await call((sess, r) => deletePrivateEntry(sess, entry.id, r)); await load(); }} />
              </View>
            );
          }) : <Text style={s.hint}>{t('noPrivateEntries')}</Text>}
        </Card>
      </View>
    </ScrollView>
  );
}

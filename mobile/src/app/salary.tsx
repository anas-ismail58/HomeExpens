import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../typography';
import { addIncome, deleteIncome, getIncomeSummary, removeSalary, setSalary, type IncomeSummary } from '../api';
import { WithBottomBar } from '../BottomBar';
import { Card, ConfirmDeleteButton, EmptyState, GradientHero, IconBubble, InlineDelete, ListSkeleton, MonthSwitcher, PrimaryButton, SectionTitle, type IconName } from '../components';
import { Chips, Field, normalizeDigits, TextField, toDateOnly } from '../formControls';
import { convert, useFormat, usePreferences, useStyles } from '../preferences';
import { useAuthedSession, useCan } from '../SessionContext';
import type { Tone } from '../theme';
import { shiftMonth, thisMonth } from '../useMonthlyReport';

const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;
const CURRENCIES = ['EGP', 'SAR', 'USD', 'EUR', 'AED', 'KWD', 'QAR', 'BHD'];

export default function SalaryPage() {
  return (
    <WithBottomBar>
      <SalaryScreen />
    </WithBottomBar>
  );
}

function SalaryScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors, rates } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const isAdmin = session.user.isAdmin;
  const [month, setMonth] = useState(thisMonth);
  const [summary, setSummary] = useState<IncomeSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [salaryAmount, setSalaryAmount] = useState<string | null>(null);
  const [payDay, setPayDay] = useState<number | null>(null);
  const [savingSalary, setSavingSalary] = useState(false);
  const [extraAmount, setExtraAmount] = useState('');
  const [salaryCurrency, setSalaryCurrency] = useState<string | null>(null);
  const [extraCurrency, setExtraCurrency] = useState<string | null>(null);
  const [extraSource, setExtraSource] = useState('');
  const [savingExtra, setSavingExtra] = useState(false);

  const load = useCallback(async () => {
    try {
      setSummary(await call((s, r) => getIncomeSummary(s, month, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, month, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The form starts from the saved salary until the father edits it.
  const amountDraft = salaryAmount ?? summary?.salary?.amount ?? '';
  const dayDraft = payDay ?? summary?.salary?.payDay ?? 1;
  const salaryValue = normalizeDigits(amountDraft);
  const familyCurrency = summary?.currency ?? session.family.currency;
  const salaryCurrencyDraft = salaryCurrency ?? summary?.salary?.currency ?? familyCurrency;
  const extraCurrencyDraft = extraCurrency ?? familyCurrency;
  // Live preview of a foreign-currency amount in the family currency.
  const inFamily = (amount: string, from: string) => (from === familyCurrency || !AMOUNT.test(amount) ? null : convert(Number(amount), from, familyCurrency, rates));
  const extraValue = normalizeDigits(extraAmount);

  const saveSalary = async () => {
    setSavingSalary(true);
    try {
      setSummary(await call((s, r) => setSalary(s, { amount: salaryValue, payDay: dayDraft, currency: salaryCurrencyDraft }, r)));
      setSalaryAmount(null);
      setSalaryCurrency(null);
      setPayDay(null);
      setMonth(thisMonth());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setSavingSalary(false);
    }
  };

  const saveExtra = async () => {
    setSavingExtra(true);
    try {
      // Extra income is dated today, or the 1st of the month being viewed.
      const date = month === thisMonth() ? toDateOnly(new Date()) : `${month}-01`;
      await call((s, r) => addIncome(s, { amount: extraValue, source: extraSource.trim(), date, currency: extraCurrencyDraft }, r));
      setExtraAmount('');
      setExtraSource('');
      setExtraCurrency(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setSavingExtra(false);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18 },
    heroLabel: { color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    heroAmount: { color: c.heroText, fontSize: 34, fontWeight: '800' as const, textAlign: d.start, marginTop: 6, fontVariant: ['tabular-nums' as const] },
    track: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 16, overflow: 'hidden' as const, flexDirection: d.row },
    fill: { height: '100%' as const, borderRadius: 5 },
    heroNote: { color: c.heroText, fontSize: 13, fontWeight: '700' as const, textAlign: d.start, marginTop: 8 },
    split: { flexDirection: d.row, gap: 10, marginTop: 16 },
    chip: { flex: 1, minWidth: 0, borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.14)' },
    chipLabel: { color: c.heroMuted, fontSize: 12, textAlign: d.start },
    chipValue: { color: c.heroText, fontSize: 15, fontWeight: '700' as const, marginTop: 4, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowLabel: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    rowSub: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    rowValue: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    days: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 6 },
    day: { width: '12.4%' as const, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 10, backgroundColor: c.surfaceMuted },
    dayActive: { backgroundColor: c.primary },
    dayText: { color: c.text, fontSize: 13, fontWeight: '600' as const },
    dayTextActive: { color: c.primaryText, fontWeight: '800' as const },
    hint: { color: c.muted, fontSize: 12, lineHeight: 18, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (!can('VIEW_INCOME')) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  const currency = summary?.currency ?? session.family.currency;
  const ratio = summary?.totals.spentRatio ?? null;
  const remaining = Number(summary?.totals.remaining ?? 0);
  const over = remaining < 0;
  const barColor = over ? colors.danger : ratio !== null && ratio > 0.85 ? colors.tones.amber.icon : '#ffffff';

  const line = (icon: IconName, tone: Tone, label: string, value: string, sub?: string, divider = true) => (
    <View style={[s.row, divider && s.divider]}>
      <IconBubble name={icon} color={colors.tones[tone].icon} background={colors.tones[tone].from} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <MonthSwitcher month={month} onChange={(amount) => setMonth((m) => shiftMonth(m, amount))} />
      {error ? <Text style={s.error}>{error}</Text> : null}

      <GradientHero>
        <Text style={s.heroLabel}>{t('remaining')}</Text>
        <Text style={s.heroAmount} numberOfLines={1} adjustsFontSizeToFit>{format.money(remaining, currency)}</Text>
        {ratio !== null ? (
          <>
            <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.min(ratio, 1) * 100) }}>
              <View style={[s.fill, { width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={s.heroNote}>
              {over ? t('overBudget', { amount: format.money(Math.abs(remaining), currency) }) : t('spentOf', { percent: format.percent(ratio) })}
            </Text>
          </>
        ) : null}
        <View style={s.split}>
          <View style={s.chip}>
            <Text style={s.chipLabel}>{t('income')}</Text>
            <Text style={s.chipValue} numberOfLines={1}>{format.money(summary?.totals.income ?? 0, currency)}</Text>
          </View>
          <View style={s.chip}>
            <Text style={s.chipLabel}>{t('monthExpenses')}</Text>
            <Text style={s.chipValue} numberOfLines={1}>{format.money(summary?.totals.expenses ?? 0, currency)}</Text>
          </View>
        </View>
      </GradientHero>

      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {!summary ? <ListSkeleton rows={3} /> : (
          <>
            {line(
              'wallet',
              'teal',
              t('salary'),
              format.money(summary.totals.salary, currency),
              summary.salary
                ? [summary.salary.currency !== currency ? format.rawMoney(summary.salary.amount, summary.salary.currency) : null, t('dayN', { day: format.number(summary.salary.payDay) })].filter(Boolean).join(' · ')
                : t('noSalary'),
              false,
            )}
            {line('add-circle', 'teal', t('extraIncome'), format.money(summary.totals.extraIncome, currency))}
            {line('home', 'amber', t('household'), format.money(summary.totals.household, currency))}
            {line('school', 'indigo', t('homeLessons'), format.money(summary.totals.lessons, currency))}
          </>
        )}
      </Card>

      {isAdmin ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('monthlySalary')} />
          <Card style={{ gap: 14 }}>
            {!summary?.salary ? <Text style={s.hint}>{t('noSalaryBody')}</Text> : null}
            <Field label={t('salaryCurrency')}>
              <Chips options={CURRENCIES.map((code) => ({ value: code, label: code }))} value={salaryCurrencyDraft} onChange={setSalaryCurrency} />
            </Field>
            <Field
              label={`${t('amount')} · ${salaryCurrencyDraft}`}
              hint={inFamily(salaryValue, salaryCurrencyDraft) !== null ? t('approxIn', { amount: format.rawMoney(inFamily(salaryValue, salaryCurrencyDraft)!, familyCurrency) }) : undefined}
            >
              <TextField value={amountDraft} onChange={setSalaryAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
            </Field>
            <Field label={t('payDay')}>
              <View style={s.days}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <Pressable key={day} onPress={() => setPayDay(day)} style={[s.day, dayDraft === day && s.dayActive]} accessibilityState={{ selected: dayDraft === day }}>
                    <Text style={[s.dayText, dayDraft === day && s.dayTextActive]}>{format.number(day)}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
            <Text style={s.hint}>{t('salaryChangeHint')}</Text>
            <PrimaryButton label={t('saveSalary')} icon="checkmark" busy={savingSalary} disabled={!AMOUNT.test(salaryValue) || Number(salaryValue) <= 0} onPress={() => void saveSalary()} />
            {summary?.salary ? (
              <ConfirmDeleteButton
                label={t('removeSalary')}
                question={t('removeSalaryQuestion')}
                onConfirm={async () => {
                  await call(removeSalary);
                  setSalaryAmount(null);
                  await load();
                }}
              />
            ) : null}
          </Card>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('extraIncome')} count={summary?.incomes.length ?? 0} />
        <Card style={{ gap: 12 }}>
          {summary?.incomes.map((income, index) => (
            <View key={income.id} style={[s.row, index > 0 && s.divider]}>
              <IconBubble name="cash" color={colors.tones.teal.icon} background={colors.tones.teal.from} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>{income.source}</Text>
                <Text style={s.rowSub}>
                  {format.date(income.date)}
                  {income.currency !== currency ? ` · ${t('approxIn', { amount: format.rawMoney(income.amountInFamilyCurrency, currency) })}` : ''}
                </Text>
              </View>
              <Text style={s.rowValue}>{format.rawMoney(income.amount, income.currency)}</Text>
              {isAdmin ? <InlineDelete label={income.source} onConfirm={async () => { await call((sess, r) => deleteIncome(sess, income.id, r)); await load(); }} /> : null}
            </View>
          ))}
          {isAdmin ? (
            <>
              <Field label={t('currency')}>
                <Chips options={CURRENCIES.map((code) => ({ value: code, label: code }))} value={extraCurrencyDraft} onChange={setExtraCurrency} />
              </Field>
              <Field
                label={`${t('amount')} · ${extraCurrencyDraft}`}
                hint={inFamily(extraValue, extraCurrencyDraft) !== null ? t('approxIn', { amount: format.rawMoney(inFamily(extraValue, extraCurrencyDraft)!, familyCurrency) }) : undefined}
              >
                <TextField value={extraAmount} onChange={setExtraAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
              </Field>
              <Field label={t('incomeSource')}><TextField value={extraSource} onChange={setExtraSource} placeholder={t('incomeSourcePlaceholder')} /></Field>
              <PrimaryButton
                label={t('addIncome')}
                icon="add"
                busy={savingExtra}
                disabled={!AMOUNT.test(extraValue) || Number(extraValue) <= 0 || !extraSource.trim()}
                onPress={() => void saveExtra()}
              />
            </>
          ) : null}
        </Card>
      </View>
    </ScrollView>
  );
}

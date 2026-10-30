import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { addBankEntry, ApiError, deleteBankAccount, deleteBankEntry, getBankAccount, setBankBalance, updateBankAccount, type BankAccount, type BankEntry, type VaultSource } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, GradientHero, IconBubble, InlineDelete, ListSkeleton, PrimaryButton, SectionTitle, SegmentedControl } from '../../components';
import { useCountries } from '../../countries';
import { countryFlag, useCountryName } from '../../CountrySwitcher';
import { Chips, Field, normalizeDigits, TextField } from '../../formControls';
import type { StringKey } from '../../i18n';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;
type Mode = 'DEPOSIT' | 'WITHDRAW' | 'BALANCE';

export default function BankAccountPage() {
  return (
    <WithBottomBar>
      <BankAccountScreen />
    </WithBottomBar>
  );
}

function BankAccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call, session } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const { countries } = useCountries();
  const countryName = useCountryName();
  const [account, setAccount] = useState<(BankAccount & { entries: BankEntry[] }) | null>(null);
  const [mode, setMode] = useState<Mode>('DEPOSIT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [source, setSource] = useState<VaultSource>('OTHER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [country, setCountry] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccount(await call((s, r) => getBankAccount(s, id, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, id, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const failed = (err: unknown) => setError(err instanceof ApiError && err.code === 'BANK_INSUFFICIENT' ? t('bankInsufficient') : err instanceof ApiError && err.code === 'PRIVATE_INSUFFICIENT' ? t('vaultPrivateInsufficient') : err instanceof Error ? err.message : t('saveError'));
  const value = normalizeDigits(amount);
  const valid = AMOUNT.test(value) && (mode === 'BALANCE' || Number(value) > 0);
  const save = async () => {
    setBusy(true);
    try {
      setAccount(await call((s, r) =>
        mode === 'BALANCE' ? setBankBalance(s, id, { balance: value, note: note.trim() || undefined }, r) : addBankEntry(s, id, { kind: mode, amount: value, source, note: note.trim() || undefined }, r),
      ));
      setAmount('');
      setNote('');
      setError('');
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };
  const saveInfo = async () => {
    setBusy(true);
    try {
      setAccount(await call((s, r) => updateBankAccount(s, id, { bankName: bankName.trim(), accountName: accountName.trim(), countryId: country }, r)));
      setEditing(false);
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16, width: '100%' as const, maxWidth: 820, alignSelf: 'center' as const },
    heroTop: { flexDirection: d.row, alignItems: 'center' as const, gap: 8 },
    heroLabel: { flex: 1, color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    heroAmount: { color: c.heroText, fontSize: 32, fontWeight: '800' as const, textAlign: d.start, marginTop: 6, fontVariant: ['tabular-nums' as const] },
    heroSub: { color: c.heroMuted, fontSize: 13, textAlign: d.start, marginTop: 4 },
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowLabel: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    rowSub: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    rowValue: { fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    note: { color: c.muted, fontSize: 12, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    center: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 10 },
  }));

  if (!account) {
    return (
      <View style={[s.screen, s.page]}>
        {error ? <EmptyState icon="alert-circle-outline" title={t('loadError')} body={error} /> : <Card><ListSkeleton rows={3} /></Card>}
      </View>
    );
  }

  const where = countries.find((c) => c.id === account.countryId);
  const kindLabel: Record<BankEntry['kind'], StringKey> = { OPENING: 'bankOpening', DEPOSIT: 'bankDeposit', WITHDRAW: 'bankWithdraw', ADJUST: 'bankAdjust' };
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: account.bankName }} />
      <GradientHero>
        <View style={s.heroTop}>
          <Text style={s.heroLabel}>{account.accountName}</Text>
          <Pressable onPress={() => { setBankName(account.bankName); setAccountName(account.accountName); setCountry(account.countryId); setEditing((v) => !v); }} accessibilityLabel={t('edit')} hitSlop={8}>
            <Ionicons name="create-outline" size={20} color={colors.heroText} />
          </Pressable>
        </View>
        <Text style={s.heroAmount} numberOfLines={1} adjustsFontSizeToFit>{format.rawMoney(account.balance, account.currency)}</Text>
        <Text style={s.heroSub}>{[account.bankName, where ? `${countryFlag(where.code)} ${countryName(where)}` : null].filter(Boolean).join(' · ')}</Text>
      </GradientHero>
      {error ? <Text style={s.error}>{error}</Text> : null}

      {editing ? (
        <Card style={{ gap: 12 }}>
          <Field label={t('bankName')}><TextField value={bankName} onChange={setBankName} /></Field>
          <Field label={t('bankAccountName')}><TextField value={accountName} onChange={setAccountName} /></Field>
          {countries.length > 1 ? (
            <Field label={t('bankCountry')}>
              <Chips options={countries.map((c) => ({ value: c.id, label: `${countryFlag(c.code)} ${countryName(c)}` }))} value={country} onChange={setCountry} />
            </Field>
          ) : null}
          <PrimaryButton label={t('save')} icon="checkmark" busy={busy} disabled={!bankName.trim() || !accountName.trim()} onPress={() => void saveInfo()} />
        </Card>
      ) : null}

      <Card style={{ gap: 14 }}>
        <SegmentedControl<Mode> value={mode} onChange={(next) => { setMode(next); setAmount(next === 'BALANCE' ? account.balance : ''); }} options={[{ value: 'DEPOSIT', label: t('bankDeposit') }, { value: 'WITHDRAW', label: t('bankWithdraw') }, { value: 'BALANCE', label: t('bankMatch') }]} />
        <Field label={`${mode === 'BALANCE' ? t('bankActualBalance') : t('amount')} · ${account.currency}`}>
          <TextField value={amount} onChange={setAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
        </Field>
        {mode !== 'BALANCE' ? (
          <Field label={mode === 'DEPOSIT' ? t('vaultFrom') : t('vaultTo')}>
            <Chips
              options={[
                { value: 'SALARY' as const, label: mode === 'DEPOSIT' ? t('vaultSourceSalary') : t('vaultSourceSalaryBack'), icon: 'wallet' as const },
                ...(session.user.role === 'FATHER' ? [{ value: 'PRIVATE' as const, label: t('vaultSourcePrivate'), icon: 'lock-closed' as const }] : []),
                { value: 'OTHER' as const, label: t('vaultSourceOther'), icon: 'cash' as const },
              ]}
              value={source}
              onChange={setSource}
            />
          </Field>
        ) : null}
        <Field label={t('optionalNote')}><TextField value={note} onChange={setNote} /></Field>
        <PrimaryButton label={t('save')} icon="checkmark" busy={busy} disabled={!valid} onPress={() => void save()} />
        <Text style={s.note}>{mode === 'BALANCE' ? t('bankMatchHint') : source === 'SALARY' ? (mode === 'DEPOSIT' ? t('bankFromSalaryHint') : t('bankToSalaryHint')) : t('bankNotSpending')}</Text>
      </Card>

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('debtHistory')} count={account.entries.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {account.entries.length ? account.entries.map((entry, index) => {
            const up = entry.kind !== 'WITHDRAW' && Number(entry.amount) >= 0;
            return (
              <View key={entry.id} style={[s.row, index > 0 && s.divider]}>
                <IconBubble name={up ? 'arrow-down' : 'arrow-up'} color={up ? colors.success : colors.danger} background={up ? colors.successSoft : colors.dangerSoft} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowLabel} numberOfLines={1}>{entry.note || t(kindLabel[entry.kind])}</Text>
                  <Text style={s.rowSub}>{[format.date(entry.date), entry.note ? t(kindLabel[entry.kind]) : null, entry.source === 'SALARY' ? t(entry.kind === 'WITHDRAW' ? 'vaultSourceSalaryBack' : 'vaultSourceSalary') : entry.source === 'PRIVATE' ? t('vaultSourcePrivate') : null].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text style={[s.rowValue, { color: up ? colors.success : colors.danger }]}>
                  {up ? '+' : '−'}{format.rawMoney(Math.abs(Number(entry.amount)), account.currency)}
                </Text>
                <InlineDelete label={t(kindLabel[entry.kind])} onConfirm={async () => { try { setAccount(await call((sess, r) => deleteBankEntry(sess, entry.id, r))); } catch (err) { failed(err); } }} />
              </View>
            );
          }) : <Text style={[s.rowSub, { paddingVertical: 14 }]}>{t('debtNoHistory')}</Text>}
        </Card>
      </View>

      <View style={s.center}>
        <Text style={s.rowSub}>{t('bankDeleteAccount')}</Text>
        <InlineDelete label={account.bankName} onConfirm={async () => { await call((sess, r) => deleteBankAccount(sess, id, r)); router.back(); }} />
      </View>
    </ScrollView>
  );
}

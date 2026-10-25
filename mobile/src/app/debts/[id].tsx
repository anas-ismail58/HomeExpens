import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import {
  addDebtEntry,
  ApiError,
  CURRENCIES,
  deleteDebtEntry,
  deleteDebtPerson,
  getDebtPerson,
  updateDebtEntry,
  updateDebtPerson,
  type DebtEntry,
  type DebtKind,
  type DebtPerson,
} from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, IconBubble, InlineDelete, ListSkeleton, PrimaryButton, SectionTitle, type IconName } from '../../components';
import { useCountries } from '../../countries';
import { Chips, DatePicker, Field, normalizeDigits, TextField, TimePicker, toDateOnly, ToggleRow } from '../../formControls';
import type { StringKey } from '../../i18n';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import type { Tone } from '../../theme';
import { Text } from '../../typography';

const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;
const KINDS: { kind: DebtKind; label: StringKey; icon: IconName; tone: Tone }[] = [
  { kind: 'LEND', label: 'debtLend', icon: 'arrow-up-circle', tone: 'amber' },
  { kind: 'RECEIVE', label: 'debtReceive', icon: 'arrow-down-circle', tone: 'teal' },
  { kind: 'BORROW', label: 'debtBorrow', icon: 'arrow-down-circle', tone: 'violet' },
  { kind: 'PAY', label: 'debtPay', icon: 'arrow-up-circle', tone: 'rose' },
];

export default function DebtPersonPage() {
  return (
    <WithBottomBar>
      <DebtPersonScreen />
    </WithBottomBar>
  );
}

type Person = DebtPerson & { entries: DebtEntry[] };

function DebtPersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const { inputCurrency } = useCountries();
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The entry being added (kind) or edited (entry id).
  const [form, setForm] = useState<{ kind: DebtKind; editing: string | null } | null>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>(inputCurrency);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => toDateOnly(new Date()));
  const [hasDue, setHasDue] = useState(false);
  const [dueDate, setDueDate] = useState(() => toDateOnly(new Date()));
  const [remind, setRemind] = useState(true);
  const [daysBefore, setDaysBefore] = useState('1');
  const [remindTime, setRemindTime] = useState('10:00');
  const [recordExpense, setRecordExpense] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      setPerson(await call((s, r) => getDebtPerson(s, id, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, id, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const failed = (err: unknown) =>
    setError(err instanceof ApiError && err.code === 'DEBT_OVERPAID' ? t('debtOverpaid') : err instanceof Error ? err.message : t('saveError'));

  const open = (kind: DebtKind, entry?: DebtEntry) => {
    setForm({ kind, editing: entry?.id ?? null });
    setAmount(entry?.amount ?? '');
    // A repayment starts in the currency that is outstanding with this person.
    const owing = person?.balances.find((b) => Number(kind === 'RECEIVE' ? b.owedToMe : kind === 'PAY' ? b.iOwe : 0) > 0)?.currency;
    setCurrency(entry?.currency ?? owing ?? inputCurrency);
    setNote(entry?.note ?? '');
    setDate(entry?.date ?? toDateOnly(new Date()));
    setHasDue(Boolean(entry?.dueDate));
    setDueDate(entry?.dueDate ?? toDateOnly(new Date()));
    setRemind(entry ? Boolean(entry.reminderAt) : true);
    setRecordExpense(Boolean(entry?.expenseId));
    setError('');
  };

  const value = normalizeDigits(amount);
  const valid = AMOUNT.test(value) && Number(value) > 0;
  const loan = form?.kind === 'LEND' || form?.kind === 'BORROW';
  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const input = {
        kind: form.kind,
        amount: value,
        currency,
        note: note.trim() || undefined,
        date,
        dueDate: loan && hasDue ? dueDate : null,
        remind: loan && hasDue && remind ? { daysBefore: Number(daysBefore), time: remindTime } : null,
        recordExpense: form.kind === 'PAY' ? recordExpense : undefined,
      };
      setPerson(await call((s, r) => (form.editing ? updateDebtEntry(s, form.editing, input, r) : addDebtEntry(s, id, input, r))));
      setForm(null);
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
      setPerson(await call((s, r) => updateDebtPerson(s, id, { name: name.trim(), phone: phone.trim() || null, notes: notes.trim() || null }, r)));
      setEditingInfo(false);
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16, width: '100%' as const, maxWidth: 820, alignSelf: 'center' as const },
    head: { flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    avatar: { width: 52, height: 52, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
    avatarText: { color: c.primary, fontSize: 22, fontWeight: '800' as const },
    name: { color: c.text, fontSize: 20, fontWeight: '800' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 13, textAlign: d.start, marginTop: 2 },
    link: { color: c.primary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    balanceRow: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 10, paddingVertical: 10 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    balanceCode: { color: c.textSecondary, fontSize: 14, fontWeight: '800' as const },
    balanceValue: { fontSize: 16, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    actions: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 10 },
    action: { flexBasis: '46%' as const, flexGrow: 1, minHeight: 64, borderRadius: 18, padding: 12, flexDirection: d.row, alignItems: 'center' as const, gap: 10 },
    actionText: { flex: 1, fontSize: 14, fontWeight: '800' as const, textAlign: d.start },
    formTitle: { color: c.text, fontSize: 17, fontWeight: '800' as const, textAlign: d.start },
    row: { minHeight: 58, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    rowLabel: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    rowValue: { fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (!person) {
    return (
      <View style={[s.screen, s.page]}>
        {error ? <EmptyState icon="alert-circle-outline" title={t('loadError')} body={error} /> : <Card><ListSkeleton rows={3} /></Card>}
      </View>
    );
  }

  const kindOf = (kind: DebtKind) => KINDS.find((k) => k.kind === kind)!;
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: person.name }} />
      {editingInfo ? (
        <Card style={{ gap: 12 }}>
          <Field label={t('debtPersonName')}><TextField value={name} onChange={setName} /></Field>
          <Field label={t('debtPhoneOptional')}><TextField value={phone} onChange={setPhone} keyboardType="phone-pad" /></Field>
          <Field label={t('optionalNote')}><TextField value={notes} onChange={setNotes} /></Field>
          <PrimaryButton label={t('save')} icon="checkmark" busy={busy} disabled={!name.trim()} onPress={() => void saveInfo()} />
        </Card>
      ) : (
        <View style={s.head}>
          <View style={s.avatar}><Text style={s.avatarText}>{person.name.trim().charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={1}>{person.name}</Text>
            {person.phone ? (
              <Pressable onPress={() => void Linking.openURL(`tel:${person.phone}`)} accessibilityRole="link"><Text style={s.link}>{person.phone}</Text></Pressable>
            ) : null}
            {person.notes ? <Text style={s.sub}>{person.notes}</Text> : null}
          </View>
          <Pressable onPress={() => { setName(person.name); setPhone(person.phone ?? ''); setNotes(person.notes ?? ''); setEditingInfo(true); }} accessibilityLabel={t('edit')} hitSlop={8}>
            <Ionicons name="create-outline" size={22} color={colors.primary} />
          </Pressable>
        </View>
      )}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {/* Balance per currency: they owe me (green), I owe them (red). */}
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {person.balances.length ? person.balances.flatMap((b) => [
          Number(b.owedToMe) > 0 ? (
            <View key={`${b.currency}-in`} style={s.balanceRow}>
              <Text style={s.balanceCode}>{t('debtOwesYou')}</Text>
              <Text style={[s.balanceValue, { color: colors.success }]}>{format.rawMoney(b.owedToMe, b.currency)}</Text>
            </View>
          ) : null,
          Number(b.iOwe) > 0 ? (
            <View key={`${b.currency}-out`} style={s.balanceRow}>
              <Text style={s.balanceCode}>{t('debtYouOwe')}</Text>
              <Text style={[s.balanceValue, { color: colors.danger }]}>{format.rawMoney(b.iOwe, b.currency)}</Text>
            </View>
          ) : null,
        ]) : <Text style={[s.sub, { paddingVertical: 14 }]}>{t('debtSettled')}</Text>}
      </Card>

      {form ? (
        <Card style={{ gap: 14 }}>
          <Text style={s.formTitle}>{t(kindOf(form.kind).label)}{form.editing ? ` · ${t('edit')}` : ''}</Text>
          <Field label={`${t('amount')} · ${currency}`}>
            <TextField value={amount} onChange={setAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
          </Field>
          <Field label={t('currency')}>
            <Chips options={CURRENCIES.map((code) => ({ value: code, label: code }))} value={currency} onChange={setCurrency} />
          </Field>
          <Field label={t('debtDate')}><DatePicker value={date} onChange={setDate} /></Field>
          {loan ? (
            <>
              <ToggleRow label={t('debtHasDueDate')} value={hasDue} onChange={setHasDue} />
              {hasDue ? (
                <>
                  <Field label={t('debtDueDate')}><DatePicker value={dueDate} onChange={setDueDate} /></Field>
                  <ToggleRow label={t('addReminderToggle')} value={remind} onChange={setRemind} />
                  {remind ? (
                    <>
                      <Chips options={['0', '1', '3', '7'].map((v) => ({ value: v, label: t(`remind_${v}` as StringKey) }))} value={daysBefore} onChange={setDaysBefore} />
                      <Field label={t('reminderTime')}><TimePicker value={remindTime} onChange={setRemindTime} /></Field>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {form.kind === 'PAY' ? <ToggleRow label={t('debtRecordExpense')} value={recordExpense} onChange={setRecordExpense} hint={t('debtRecordExpenseHint')} /> : null}
          <Field label={t('optionalNote')}><TextField value={note} onChange={setNote} /></Field>
          <PrimaryButton label={t('save')} icon="checkmark" busy={busy} disabled={!valid} onPress={() => void save()} />
          <Pressable onPress={() => setForm(null)} accessibilityRole="button"><Text style={[s.sub, { textAlign: 'center' }]}>{t('cancel')}</Text></Pressable>
        </Card>
      ) : (
        <View style={s.actions}>
          {KINDS.map((k) => {
            const tone = colors.tones[k.tone];
            return (
              <Pressable key={k.kind} onPress={() => open(k.kind)} style={({ pressed }) => [s.action, { backgroundColor: tone.from }, pressed && { opacity: 0.8 }]} accessibilityRole="button">
                <Ionicons name={k.icon} size={26} color={tone.icon} />
                <Text style={[s.actionText, { color: tone.fg }]}>{t(k.label)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('debtHistory')} count={person.entries.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {person.entries.length ? person.entries.map((entry, index) => {
            const k = kindOf(entry.kind);
            const tone = colors.tones[k.tone];
            return (
              <View key={entry.id} style={[s.row, index > 0 && s.divider]}>
                <IconBubble name={k.icon} color={tone.icon} background={tone.from} size={36} />
                <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => open(entry.kind, entry)} accessibilityRole="button" accessibilityLabel={t('edit')}>
                  <Text style={s.rowLabel} numberOfLines={1}>{entry.note || t(k.label)}</Text>
                  <Text style={s.sub} numberOfLines={1}>
                    {[format.date(entry.date), entry.dueDate ? t('debtDueOn', { date: format.date(entry.dueDate) }) : null, entry.expenseId ? t('debtLinkedExpense') : null].filter(Boolean).join(' · ')}
                  </Text>
                </Pressable>
                <Text style={[s.rowValue, { color: tone.icon }]}>{format.rawMoney(entry.amount, entry.currency)}</Text>
                <InlineDelete label={t(k.label)} onConfirm={async () => { try { setPerson(await call((sess, r) => deleteDebtEntry(sess, entry.id, r))); } catch (err) { failed(err); } }} />
              </View>
            );
          }) : <Text style={[s.sub, { paddingVertical: 14 }]}>{t('debtNoHistory')}</Text>}
        </Card>
      </View>

      <View style={[s.head, { justifyContent: 'center' }]}>
        <Text style={[s.sub, { marginTop: 0 }]}>{t('debtRemovePerson')}</Text>
        <InlineDelete label={person.name} onConfirm={async () => { await call((sess, r) => deleteDebtPerson(sess, id, r)); router.back(); }} />
      </View>
    </ScrollView>
  );
}

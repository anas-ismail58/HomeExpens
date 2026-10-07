import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '../../typography';
import {
  createPayment,
  CURRENCIES,
  getChildren,
  getMembers,
  getPayment,
  updatePayment,
  type Child,
  type CurrencyCode,
  type FamilyMember,
  type PaymentCategory,
  type PaymentFrequency,
  type PaymentInput,
} from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, PrimaryButton, ToneCard } from '../../components';
import { addDaysTo, Chips, DatePicker, Field, normalizeDigits, TextField, TIME_PATTERN, TimePicker, toDateOnly, ToggleRow } from '../../formControls';
import type { StringKey } from '../../i18n';
import { useNotifications } from '../../NotificationsContext';
import { ensureNotificationPermission } from '../../notifications';
import { CATEGORIES, CATEGORY_META, FREQUENCIES, useDueText } from '../../paymentFormat';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';

type ReminderChoice = '0' | '1' | '3' | '7' | 'custom';

/** Next date (today or later) that falls on `day` of the month, clamped to short months. */
function nextDayOfMonth(day: number) {
  const now = new Date();
  for (let k = 0; k < 2; k += 1) {
    const last = new Date(now.getFullYear(), now.getMonth() + k + 1, 0).getDate();
    const candidate = toDateOnly(new Date(now.getFullYear(), now.getMonth() + k, Math.min(day, last)));
    if (candidate >= toDateOnly(now)) return candidate;
  }
  return toDateOnly(now);
}

export default function PaymentFormPage() {
  return (
    <WithBottomBar>
      <PaymentForm />
    </WithBottomBar>
  );
}

function PaymentForm() {
  const params = useLocalSearchParams<{ id?: string; name?: string; amount?: string; currency?: string; category?: string; memberId?: string; day?: string }>();
  const editingId = params.id;
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const due = useDueText();
  const can = useCan();
  const { syncDevice } = useNotifications();

  const [loaded, setLoaded] = useState(!editingId);
  const [name, setName] = useState(params.name ?? '');
  const [amount, setAmount] = useState(params.amount ?? '');
  const [currency, setCurrency] = useState<string>(CURRENCIES.includes(params.currency as CurrencyCode) ? params.currency! : session.family.currency);
  const [category, setCategory] = useState<PaymentCategory>(CATEGORIES.includes(params.category as PaymentCategory) ? (params.category as PaymentCategory) : 'BILL');
  const [frequency, setFrequency] = useState<PaymentFrequency>('MONTHLY');
  const [intervalDays, setIntervalDays] = useState('30');
  const [dueDate, setDueDate] = useState(() => (params.day ? nextDayOfMonth(Number(params.day)) : addDaysTo(toDateOnly(new Date()), 1)));
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState('20:00');
  const [assigneeId, setAssigneeId] = useState(session.user.id);
  const [memberId, setMemberId] = useState(params.memberId ?? '');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderChoice, setReminderChoice] = useState<ReminderChoice>('0');
  const [reminderTime, setReminderTime] = useState('10:00');
  const [reminderDate, setReminderDate] = useState(dueDate);
  const [notes, setNotes] = useState('');
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [editStart, setEditStart] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    call(getMembers).then((list) => active && setMembers(list)).catch(() => undefined);
    call(getChildren).then((list) => active && setChildren(list)).catch(() => undefined);
    if (editingId) {
      call((s, r) => getPayment(s, editingId, r))
        .then((p) => {
          if (!active) return;
          setName(p.name);
          setAmount(p.amount);
          setCurrency(p.currency);
          setCategory(p.category);
          setFrequency(p.frequency);
          setIntervalDays(String(p.customIntervalDays ?? 30));
          setDueDate(p.dueDate);
          setStartDate(p.startDate !== p.dueDate ? p.startDate : null);
          setDueTime(p.dueTime);
          setAssigneeId(p.assignee.id);
          setMemberId(p.member?.id ?? '');
          setReminderEnabled(p.reminderEnabled);
          setReminderChoice(p.reminderDaysBefore != null ? (String(p.reminderDaysBefore) as ReminderChoice) : p.reminderAt ? 'custom' : '0');
          setReminderTime(p.reminderTime ?? p.dueTime);
          if (p.reminderAt && p.reminderDaysBefore == null) {
            const at = new Date(p.reminderAt);
            setReminderDate(toDateOnly(at));
            setReminderTime(`${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`);
          }
          setNotes(p.notes ?? '');
        })
        .catch((err: unknown) => active && setError(err instanceof Error ? err.message : t('loadError')))
        .finally(() => active && setLoaded(true));
    }
    return () => {
      active = false;
    };
  }, [call, editingId, t]);

  const normalizedAmount = normalizeDigits(amount);
  const validAmount = /^\d{1,11}(\.\d{1,3})?$/.test(normalizedAmount) && Number(normalizedAmount) > 0;
  const interval = Number(normalizeDigits(intervalDays));
  const validInterval = frequency !== 'CUSTOM' || (Number.isInteger(interval) && interval >= 1 && interval <= 3650);
  const [y, m, d] = dueDate.split('-').map(Number);
  const reminderMoment = (() => {
    if (!reminderEnabled || !TIME_PATTERN.test(reminderTime)) return null;
    const [hh, mm] = reminderTime.split(':').map(Number);
    if (reminderChoice === 'custom') {
      const [ry, rm, rd] = reminderDate.split('-').map(Number);
      return new Date(ry, rm - 1, rd, hh, mm);
    }
    return new Date(y, m - 1, d - Number(reminderChoice), hh, mm);
  })();
  const reminderInPast = Boolean(reminderMoment && reminderMoment.getTime() < openedAt);
  const canSave = name.trim().length > 0 && validAmount && validInterval && TIME_PATTERN.test(dueTime) && (!reminderEnabled || Boolean(reminderMoment));
  const allowed = editingId ? can('EDIT_PAYMENT') : can('ADD_PAYMENT');

  const save = async () => {
    setSaving(true);
    setError('');
    const input: PaymentInput = {
      name: name.trim(),
      amount: normalizedAmount,
      currency,
      category,
      frequency,
      customIntervalDays: frequency === 'CUSTOM' ? interval : null,
      startDate: startDate ?? dueDate,
      dueDate,
      dueTime,
      notes: notes.trim() || null,
      memberId: memberId || null,
      reminderEnabled,
      ...(session.user.role !== 'CHILD' ? { assigneeId } : {}),
      ...(reminderEnabled
        ? reminderChoice === 'custom'
          ? { reminderDaysBefore: null, reminderTime: null, reminderAt: reminderMoment!.toISOString() }
          : { reminderDaysBefore: Number(reminderChoice), reminderTime, reminderAt: null }
        : {}),
    };
    try {
      const saved = editingId ? await call((s, r) => updatePayment(s, editingId, input, r)) : await call((s, r) => createPayment(s, input, r));
      if (reminderEnabled && assigneeId === session.user.id) await ensureNotificationPermission();
      void syncDevice().catch(() => undefined);
      router.replace(`/payment/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
      setSaving(false);
    }
  };

  const s = useStyles((c, dd) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    amountWrap: { flexDirection: dd.row, alignItems: 'center' as const, gap: 10, borderWidth: 1, borderColor: c.border, borderRadius: 16, backgroundColor: c.background, paddingHorizontal: 14 },
    amountInput: { flex: 1, minWidth: 0, width: 0, minHeight: 60, color: c.text, fontSize: 26, fontWeight: '800' as const, textAlign: dd.start },
    currencyBadge: { flexShrink: 0, color: c.primary, fontSize: 14, fontWeight: '800' as const, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: c.primarySoft, overflow: 'hidden' as const },
    dateRow: { flexDirection: dd.row, alignItems: 'center' as const, gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border },
    dateText: { flex: 1, color: c.text, fontSize: 15, fontWeight: '600' as const, textAlign: dd.start },
    previewRow: { flexDirection: dd.row, alignItems: 'center' as const, gap: 10 },
    previewText: { flex: 1, fontSize: 14, fontWeight: '700' as const, textAlign: dd.start },
    warn: { color: c.danger, fontSize: 12, textAlign: dd.start },
    error: { color: c.danger, fontSize: 13, textAlign: dd.start },
  }));

  if (!allowed) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }
  if (!loaded) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;

  const people = members.filter((member) => member.role !== 'CHILD' || member.id === session.user.id || session.user.isAdmin);

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: editingId ? t('editPayment') : t('newPayment') }} />
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 16 }}>
          <Field label={t('paymentName')}>
            <TextField value={name} onChange={setName} placeholder={t('paymentNamePlaceholder')} />
          </Field>
          <Field label={t('amount')}>
            <View style={s.amountWrap}>
              <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={format.number(0)} placeholderTextColor={colors.muted} style={s.amountInput} />
              <Text style={s.currencyBadge}>{currency}</Text>
            </View>
          </Field>
          <Field label={t('currency')}>
            <Chips options={CURRENCIES.map((code) => ({ value: code, label: code }))} value={currency} onChange={setCurrency} />
          </Field>
          <Field label={t('category')}>
            <Chips options={CATEGORIES.map((key) => ({ value: key, label: t(`cat_${key}` as StringKey), icon: CATEGORY_META[key].icon }))} value={category} onChange={setCategory} />
          </Field>
        </Card>

        <Card style={{ gap: 16 }}>
          <Field label={t('frequency')}>
            <Chips options={FREQUENCIES.map((key) => ({ value: key, label: t(`freq_${key}` as StringKey) }))} value={frequency} onChange={setFrequency} />
          </Field>
          {frequency === 'CUSTOM' ? (
            <Field label={t('intervalDays')}>
              <TextField value={intervalDays} onChange={setIntervalDays} keyboardType="number-pad" />
            </Field>
          ) : null}
          <Field label={frequency === 'ONCE' ? t('dueDate') : t('nextDueDate')}>
            <DatePicker value={dueDate} onChange={(next) => { setDueDate(next); if (reminderChoice !== 'custom') setReminderDate(next); }} />
          </Field>
          {frequency !== 'ONCE' ? (
            <Field label={t('startDate')}>
              <Pressable onPress={() => setEditStart((v) => !v)} style={s.dateRow} accessibilityRole="button">
                <Ionicons name="calendar-outline" size={18} color={colors.muted} />
                <Text style={s.dateText}>{format.date(startDate ?? dueDate)}</Text>
                <Ionicons name={editStart ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
              </Pressable>
              {editStart ? <DatePicker value={startDate ?? dueDate} onChange={setStartDate} /> : null}
            </Field>
          ) : null}
          <Field label={t('dueTime')}>
            <TimePicker value={dueTime} onChange={setDueTime} />
          </Field>
        </Card>

        {people.length > 1 || children.length ? (
          <Card style={{ gap: 16 }}>
            {people.length > 1 && session.user.role !== 'CHILD' ? (
              <Field label={t('notifyWho')}>
                <Chips options={people.map((member) => ({ value: member.id, label: member.id === session.user.id ? `${member.name} (${t('you')})` : member.name, icon: 'person' as const }))} value={assigneeId} onChange={setAssigneeId} />
              </Field>
            ) : null}
            {children.length ? (
              <Field label={t('forChild')}>
                <Chips options={[{ value: '', label: t('none') }, ...children.map((child) => ({ value: child.id, label: child.name }))]} value={memberId} onChange={setMemberId} />
              </Field>
            ) : null}
          </Card>
        ) : null}

        <Card style={{ gap: 14 }}>
          <ToggleRow label={t('reminderOn')} value={reminderEnabled} onChange={setReminderEnabled} />
          {reminderEnabled ? (
            <>
              <Field label={t('reminder')}>
                <Chips
                  options={(['0', '1', '3', '7', 'custom'] as ReminderChoice[]).map((key) => ({ value: key, label: t(`remind_${key}` as StringKey) }))}
                  value={reminderChoice}
                  onChange={setReminderChoice}
                />
              </Field>
              {reminderChoice === 'custom' ? (
                <Field label={t('reminderDate')}>
                  <DatePicker value={reminderDate} onChange={setReminderDate} min={toDateOnly(new Date())} />
                </Field>
              ) : null}
              <Field label={t('reminderTime')}>
                <TimePicker value={reminderTime} onChange={setReminderTime} />
              </Field>
              {reminderMoment ? (
                <ToneCard tone="violet">
                  <View style={s.previewRow}>
                    <Ionicons name="alarm" size={24} color={colors.tones.violet.icon} />
                    <Text style={[s.previewText, { color: colors.tones.violet.fg }]}>{t('reminderPreview', { when: due.instant(reminderMoment.toISOString()) })}</Text>
                  </View>
                </ToneCard>
              ) : null}
              {reminderInPast ? <Text style={s.warn}>{t('reminderInPast')}</Text> : null}
            </>
          ) : null}
        </Card>

        <Card>
          <Field label={t('notes')}>
            <TextField value={notes} onChange={setNotes} multiline placeholder={t('notePlaceholder')} />
          </Field>
        </Card>

        {error ? <Text style={s.error}>{error}</Text> : null}
        <PrimaryButton label={t('save')} icon="checkmark" onPress={() => void save()} disabled={!canSave} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

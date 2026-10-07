import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '../../typography';
import {
  addChild,
  addHomeLesson,
  addHouseholdExpense,
  addRecurringHousehold,
  addRecurringTuition,
  getChildren,
  getHouseholdSections,
  getTeachers,
  type Child,
  type Teacher,
  type HouseholdSection,
  type RecurringFrequency,
  type ReminderOption,
} from '../../api';
import { Card, EmptyState, PrimaryButton, SegmentedControl } from '../../components';
import { Chips, DatePicker, Field, TIME_PATTERN, TimePicker, toDateOnly, ToggleRow } from '../../formControls';
import { useNotifications } from '../../NotificationsContext';
import { ensureNotificationPermission } from '../../notifications';
import { PendingImages, uploadPrepared, type PreparedImage } from '../../attachments';
import { teacherRef, TeacherPicker, type TeacherDraft } from '../../teachers';
import type { StringKey } from '../../i18n';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { WithBottomBar } from '../../BottomBar';
import { useAuthedSession, useCan } from '../../SessionContext';

type Kind = 'lesson' | 'tuition' | 'household' | 'child';

const KINDS: { kind: Kind; label: StringKey; title: StringKey }[] = [
  { kind: 'lesson', label: 'kindLesson', title: 'titleLesson' },
  { kind: 'tuition', label: 'kindTuition', title: 'titleTuition' },
  { kind: 'household', label: 'kindHousehold', title: 'titleHousehold' },
  { kind: 'child', label: 'kindChild', title: 'titleChild' },
];

const isKind = (value: unknown): value is Kind => KINDS.some((k) => k.kind === value);

type Repeat = 'ONCE' | RecurringFrequency;
type ReminderChoice = '0' | '1' | '3' | '7';

/** Current local time as "HH:MM". */
function nowTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export default function CreateScreenPage() {
  return (
    <WithBottomBar>
      <CreateScreen />
    </WithBottomBar>
  );
}

function CreateScreen() {
  const params = useLocalSearchParams<{ kind: string; childId?: string }>();
  const { call, session } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const can = useCan();
  // Only offer the kinds this member is allowed to create.
  // Each kind needs the action permission plus the service switch the father controls.
  const allowedKinds = KINDS.filter((k) =>
    k.kind === 'child'
      ? can('MANAGE_CHILDREN')
      : can('ADD_EXPENSE') &&
        (k.kind === 'household' ? can('SERVICE_HOUSEHOLD') : can('SERVICE_LESSONS') && (k.kind !== 'tuition' || can('SERVICE_RECURRING'))),
  );
  const [requestedKind, setKind] = useState<Kind>(isKind(params.kind) ? params.kind : 'lesson');
  const kind = allowedKinds.some((k) => k.kind === requestedKind) ? requestedKind : allowedKinds[0]?.kind ?? requestedKind;
  const [children, setChildren] = useState<Child[] | null>(null);
  const [sections, setSections] = useState<HouseholdSection[] | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [school, setSchool] = useState('');
  const [grade, setGrade] = useState('');
  const [childId, setChildId] = useState(params.childId ?? '');
  const [subcategoryKey, setSubcategoryKey] = useState('');
  const { syncDevice } = useNotifications();
  // When: the expense date/time, or the first due date/time for recurring ones.
  const [date, setDate] = useState(() => toDateOnly(new Date()));
  const [time, setTime] = useState(nowTime);
  const [repeat, setRepeat] = useState<Repeat>(params.kind === 'tuition' ? 'MONTHLY' : 'ONCE');
  // Reminders are on by default.
  const [remind, setRemind] = useState(true);
  const [reminderChoice, setReminderChoice] = useState<ReminderChoice>('0');
  const [reminderTime, setReminderTime] = useState('10:00');
  const [openedAt] = useState(() => Date.now());
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacher, setTeacher] = useState<TeacherDraft>({ mode: 'none' });
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    call(getChildren).then((list) => active && setChildren(list)).catch(() => active && setChildren([]));
    call(getHouseholdSections).then((list) => active && setSections(list)).catch(() => active && setSections([]));
    call(getTeachers)
      .then((list) => {
        if (!active) return;
        setTeachers(list);
        // The most common case: the same teacher as last time.
        if (list.length === 1) setTeacher({ mode: 'existing', id: list[0].id });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [call]);

  const activeChildId = (children?.some((c) => c.id === childId) ? childId : children?.[0]?.id) ?? '';
  const activeSectionKey = (sections?.some((x) => x.key === subcategoryKey) ? subcategoryKey : sections?.[0]?.key) ?? '';
  const needsChild = kind === 'lesson' || kind === 'tuition';
  const normalizedAmount = amount.trim().replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace('٫', '.');
  const validAmount = /^\d{1,11}(\.\d{1,3})?$/.test(normalizedAmount) && Number(normalizedAmount) > 0;
  // The fee form is always recurring; household can be one-off or recurring; a lesson is one-off.
  const frequency: Repeat = kind === 'tuition' ? (repeat === 'ONCE' ? 'MONTHLY' : repeat) : kind === 'household' && can('SERVICE_RECURRING') ? repeat : 'ONCE';
  const recurring = frequency !== 'ONCE';
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = TIME_PATTERN.test(time) ? time.split(':').map(Number) : [0, 0];
  const when = new Date(y, m - 1, d, hh, mm);
  // One-off reminders only make sense for a date/time that hasn't passed yet.
  const reminderPossible = can('ADD_PAYMENT') && kind !== 'child' && (recurring || when.getTime() > openedAt);
  const reminder: ReminderOption | undefined =
    reminderPossible && remind && TIME_PATTERN.test(reminderTime) ? { daysBefore: Number(reminderChoice) as ReminderOption['daysBefore'], time: reminderTime } : undefined;
  const teacherFields = needsChild ? teacherRef(teacher) : {};
  const canSubmit =
    teacherFields !== null &&
    (kind === 'child'
      ? name.trim().length > 0
      : validAmount && TIME_PATTERN.test(time) && (!needsChild || Boolean(activeChildId)) && (!recurring || description.trim().length > 0));
  const title = t(KINDS.find((k) => k.kind === kind)?.title ?? 'create');

  const submit = async () => {
    setSaving(true);
    setError('');
    const note = description.trim() || undefined;
    const occurredAt = when.toISOString();
    const section = activeSectionKey || undefined;
    try {
      let created: { reminder: unknown } | null = null;
      let expenseId: string | null = null;
      if (kind === 'lesson') {
        const lesson = await call((sess, r) => addHomeLesson(sess, { childId: activeChildId, amount: normalizedAmount, description: note, occurredAt, reminder, ...teacherFields }, r));
        created = lesson;
        expenseId = lesson.id;
      } else if (kind === 'tuition') {
        created = await call((sess, r) =>
          addRecurringTuition(sess, { childId: activeChildId, amount: normalizedAmount, description: description.trim(), frequency: frequency as RecurringFrequency, startDate: date, dueTime: time, reminder, ...teacherFields }, r),
        );
      } else if (kind === 'household' && recurring) {
        created = await call((sess, r) =>
          addRecurringHousehold(sess, { amount: normalizedAmount, subcategoryKey: section, description: description.trim(), frequency: frequency as RecurringFrequency, startDate: date, dueTime: time, reminder }, r),
        );
      } else if (kind === 'household') {
        const expense = await call((sess, r) => addHouseholdExpense(sess, { amount: normalizedAmount, subcategoryKey: section, description: note, occurredAt, reminder }, r));
        created = expense;
        expenseId = expense.id;
      } else {
        await call((sess, r) => addChild(sess, { name: name.trim(), school: school.trim() || undefined, grade: grade.trim() || undefined }, r));
      }
      // Payment screenshots picked on the form are saved with the new expense.
      if (expenseId) {
        for (const image of images) await call((sess, r) => uploadPrepared(sess, r, { expenseId: expenseId! }, image));
      }
      if (created?.reminder) {
        await ensureNotificationPermission().catch(() => false);
        void syncDevice().catch(() => undefined);
      }
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
      setSaving(false);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18 },
    field: { gap: 8 },
    label: { color: c.textSecondary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    input: { minHeight: 50, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, color: c.text, backgroundColor: c.background, fontSize: 15, textAlign: d.start },
    amountWrap: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, borderWidth: 1, borderColor: c.border, borderRadius: 16, backgroundColor: c.background, paddingHorizontal: 14 },
    // minWidth/width 0 lets the input shrink so the currency badge stays inside the box (web inputs have an intrinsic width).
    amountInput: { flex: 1, minWidth: 0, width: 0, minHeight: 64, color: c.text, fontSize: 28, fontWeight: '800' as const, textAlign: d.start },
    currency: { flexShrink: 0, color: c.primary, fontSize: 14, fontWeight: '800' as const, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: c.primarySoft, overflow: 'hidden' as const },
    options: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    option: { minHeight: 40, justifyContent: 'center' as const, paddingHorizontal: 14, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.background },
    optionActive: { borderColor: c.primary, backgroundColor: c.primarySoft },
    optionText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' as const },
    optionTextActive: { color: c.primary, fontWeight: '700' as const },
    note: { color: c.muted, fontSize: 12, textAlign: d.start },
    warn: { color: c.danger, fontSize: 13, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  const options = (items: { key: string; label: string }[], selected: string, onSelect: (key: string) => void) => (
    <View style={s.options}>
      {items.map((item) => (
        <Pressable key={item.key} onPress={() => onSelect(item.key)} style={[s.option, selected === item.key && s.optionActive]} accessibilityState={{ selected: selected === item.key }}>
          <Text style={[s.optionText, selected === item.key && s.optionTextActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder?: string) => (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} style={s.input} />
    </View>
  );

  if (!allowedKinds.length) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title }} />
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        {allowedKinds.length > 1 ? (
          <SegmentedControl<Kind> value={kind} onChange={(next) => { setKind(next); setError(''); }} options={allowedKinds.map((k) => ({ value: k.kind, label: t(k.label) }))} />
        ) : null}

        <Card style={{ gap: 18 }}>
          {kind === 'child' ? (
            <>
              {field(t('childName'), name, setName, t('childNamePlaceholder'))}
              {field(t('school'), school, setSchool)}
              {field(t('grade'), grade, setGrade)}
            </>
          ) : (
            <>
              <View style={s.field}>
                <Text style={s.label}>{t('amount')}</Text>
                <View style={s.amountWrap}>
                  <TextInput
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    placeholder={format.number(0)}
                    placeholderTextColor={colors.muted}
                    style={s.amountInput}
                    autoFocus={Platform.OS !== 'web'}
                  />
                  <Text style={s.currency}>{session.family.currency}</Text>
                </View>
              </View>

              {needsChild ? (
                <View style={s.field}>
                  <Text style={s.label}>{t('child')}</Text>
                  {children === null ? <ActivityIndicator color={colors.primary} /> : children.length ? (
                    options(children.map((c) => ({ key: c.id, label: c.name })), activeChildId, setChildId)
                  ) : (
                    <Pressable disabled={!can('MANAGE_CHILDREN')} onPress={() => setKind('child')}><Text style={s.warn}>{t('noChildrenCreate')}</Text></Pressable>
                  )}
                </View>
              ) : null}

              {needsChild ? <TeacherPicker teachers={teachers} value={teacher} onChange={setTeacher} /> : null}

              {kind === 'household' ? (
                <View style={s.field}>
                  <Text style={s.label}>{t('section')}</Text>
                  {sections === null ? <ActivityIndicator color={colors.primary} /> : sections.length ? (
                    options(sections.map((x) => ({ key: x.key ?? x.id, label: format.name(x) })), activeSectionKey, setSubcategoryKey)
                  ) : <Text style={s.note}>{t('noSectionsCreate')}</Text>}
                </View>
              ) : null}

              {field(recurring ? t('feeDescription') : t('optionalNote'), description, setDescription, recurring ? t('feePlaceholder') : t('notePlaceholder'))}
            </>
          )}
        </Card>

        {kind !== 'child' ? (
          <Card style={{ gap: 16 }}>
            {kind !== 'lesson' ? (
              <Field label={t('repeats')}>
                <Chips
                  options={(kind === 'tuition' ? (['MONTHLY', 'QUARTERLY', 'YEARLY'] as Repeat[]) : can('SERVICE_RECURRING') ? (['ONCE', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as Repeat[]) : (['ONCE'] as Repeat[])).map((value) => ({
                    value,
                    label: t(`freq_${value}` as StringKey),
                  }))}
                  value={frequency}
                  onChange={setRepeat}
                />
              </Field>
            ) : null}
            <Field label={recurring ? t('firstDueDate') : t('whenLabel')}>
              <DatePicker value={date} onChange={setDate} />
            </Field>
            <Field label={recurring ? t('dueTime') : t('time')}>
              <TimePicker value={time} onChange={setTime} />
            </Field>
            <Text style={s.note}>{recurring ? t('feeStartsToday') : t('autoTimestamp')}</Text>
          </Card>
        ) : null}

        {kind !== 'child' && !recurring ? (
          <Card style={{ gap: 12 }}>
            <Text style={s.label}>{t('attachments')}</Text>
            <PendingImages images={images} onChange={setImages} />
          </Card>
        ) : null}

        {kind !== 'child' && can('ADD_PAYMENT') ? (
          <Card style={{ gap: 14 }}>
            {reminderPossible ? (
              <>
                <ToggleRow label={t('addReminderToggle')} value={remind} onChange={setRemind} />
                {remind ? (
                  <>
                    <Field label={t('reminder')}>
                      <Chips
                        options={(['0', '1', '3', '7'] as ReminderChoice[]).map((value) => ({ value, label: t(`remind_${value}` as StringKey) }))}
                        value={reminderChoice}
                        onChange={setReminderChoice}
                      />
                    </Field>
                    <Field label={t('reminderTime')}>
                      <TimePicker value={reminderTime} onChange={setReminderTime} />
                    </Field>
                  </>
                ) : null}
              </>
            ) : (
              <Text style={s.note}>{t('reminderFutureOnly')}</Text>
            )}
          </Card>
        ) : null}

        {error ? <Text style={s.error}>{error}</Text> : null}
        <PrimaryButton label={t('save')} icon="checkmark" onPress={() => void submit()} disabled={!canSubmit} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

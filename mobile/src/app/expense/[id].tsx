import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { deleteExpense, getExpense, updateExpense, type Expense } from '../../api';
import { Card, ConfirmDeleteButton, EmptyState, IconBubble, PrimaryButton, SectionTitle, Skeleton, SmallButton, expenseNote, isHousehold, useExpenseTitle, type IconName } from '../../components';
import { Field, normalizeDigits, TextField } from '../../formControls';
import { AttachmentsSection } from '../../attachments';
import { TeacherContact } from '../../teachers';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { WithBottomBar } from '../../BottomBar';
import { useAuthedSession, useCan } from '../../SessionContext';

export default function ExpenseDetailsScreenPage() {
  return (
    <WithBottomBar>
      <ExpenseDetailsScreen />
    </WithBottomBar>
  );
}

function ExpenseDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const title = useExpenseTitle();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (current: Expense) => {
    setDraftAmount(current.amount);
    setDraftNote(expenseNote(current) ?? '');
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const amount = normalizeDigits(draftAmount);
      setExpense(await call((sess, r) => updateExpense(sess, id, { amount, description: draftNote.trim() }, r)));
      setEditing(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    let active = true;
    call((sess, r) => getExpense(sess, id, r))
      .then((result) => active && setExpense(result))
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : t('loadError')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [call, id, t]);

  const remove = async () => {
    try {
      await call((sess, r) => deleteExpense(sess, id, r));
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteError'));
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18 },
    hero: { alignItems: 'center' as const, gap: 8, paddingVertical: 28 },
    amount: { fontSize: 34, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const], marginTop: 6 },
    title: { color: c.text, fontSize: 16, fontWeight: '600' as const, textAlign: 'center' as const },
    badge: { flexDirection: d.row, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: c.primarySoft },
    badgeText: { color: c.primary, fontSize: 12, fontWeight: '700' as const },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (loading) {
    return (
      <View style={[s.screen, s.page]}>
        <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 30 }}>
          <Skeleton width={64} height={64} radius={20} /><Skeleton width="50%" height={30} /><Skeleton width="35%" height={14} />
        </Card>
        <Card><Skeleton height={14} /><Skeleton height={14} width="80%" style={{ marginTop: 18 }} /><Skeleton height={14} width="60%" style={{ marginTop: 18 }} /></Card>
      </View>
    );
  }
  if (!expense) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="alert-circle-outline" title={t('expenseNotFound')} body={error || t('maybeDeleted')} />
      </View>
    );
  }

  const household = isHousehold(expense);
  const tint = household ? colors.household : colors.lessons;
  const soft = household ? colors.householdSoft : colors.lessonsSoft;
  const occurred = expense.occurredAt ? new Date(expense.occurredAt) : null;
  const note = expenseNote(expense);

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page}>
      <Card style={s.hero}>
        <IconBubble name={household ? 'home' : 'school'} color={tint} background={soft} size={64} />
        <Text style={[s.amount, { color: tint }]}>{format.money(expense.amount, session.family.currency)}</Text>
        <Text style={s.title}>{title(expense)}</Text>
        {expense.isRecurring ? (
          <View style={s.badge}>
            <Ionicons name="repeat" size={13} color={colors.primary} />
            <Text style={s.badgeText}>{t('recurring')}</Text>
          </View>
        ) : null}
      </Card>

      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        <Detail icon="pricetag" label={t('category')} value={format.name(expense.category)} />
        {expense.subcategory ? <Detail icon="list" label={t('section')} value={format.name(expense.subcategory)} divider /> : null}
        {expense.member ? <Detail icon="person" label={t('child')} value={expense.member.name} divider /> : null}
        <Detail icon="calendar" label={t('date')} value={occurred ? format.fullDate(occurred) : format.date(expense.date)} divider />
        {occurred ? <Detail icon="time" label={t('time')} value={format.time(occurred)} divider /> : null}
        {note ? <Detail icon="document-text" label={t('note')} value={note} divider /> : null}
        {expense.createdBy ? <Detail icon="person-circle" label={t('createdBy')} value={expense.createdBy.name} divider /> : null}
      </Card>

      {expense.teacher ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('teacher')} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            <TeacherContact teacher={expense.teacher} />
          </Card>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('attachments')} count={expense.attachmentCount} />
        <Card>
          <AttachmentsSection target={{ expenseId: expense.id }} canAdd={can('EDIT_EXPENSE') || expense.createdBy?.id === session.user.id} />
        </Card>
      </View>

      {editing ? (
        <Card style={{ gap: 14 }}>
          <Field label={t('amount')}><TextField value={draftAmount} onChange={setDraftAmount} keyboardType="decimal-pad" /></Field>
          <Field label={t('optionalNote')}><TextField value={draftNote} onChange={setDraftNote} placeholder={t('notePlaceholder')} /></Field>
          <PrimaryButton label={t('save')} icon="checkmark" busy={saving} disabled={!/^\d{1,11}(\.\d{1,3})?$/.test(normalizeDigits(draftAmount)) || Number(normalizeDigits(draftAmount)) <= 0} onPress={() => void saveEdit()} />
        </Card>
      ) : can('EDIT_EXPENSE') ? (
        <View style={{ alignItems: 'center' }}>
          <SmallButton label={t('editExpense')} icon="create-outline" onPress={() => startEdit(expense)} />
        </View>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
      {can('DELETE_EXPENSE') ? <ConfirmDeleteButton label={t('deleteExpense')} question={t('deleteExpenseQuestion')} onConfirm={remove} /> : null}
    </ScrollView>
  );
}

function Detail({ icon, label, value, divider = false }: { icon: IconName; label: string; value: string; divider?: boolean }) {
  const { colors } = usePreferences();
  const s = useStyles((c, d) => ({
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    label: { color: c.muted, fontSize: 14, textAlign: d.start },
    value: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.end },
  }));
  return (
    <View style={[s.row, divider && s.divider]}>
      <IconBubble name={icon} color={colors.primary} background={colors.primarySoft} size={34} />
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

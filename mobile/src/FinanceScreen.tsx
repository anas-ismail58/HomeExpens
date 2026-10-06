import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addChild,
  addHomeLesson,
  addHouseholdExpense,
  addRecurringTuition,
  getChildren,
  getMonthlyReport,
  type Child,
  type MonthlyReport,
  type Session,
} from './api';

type EntryKind = 'lesson' | 'tuition' | 'household' | 'child' | null;
type Props = {
  session: Session;
  onSessionChange: (session: Session) => void;
  onSignOut: () => void;
  onShowStatus: () => void;
};

const HOUSEHOLD_SUBCATEGORIES = [
  { key: 'rent', label: 'الإيجار' },
  { key: 'electricity', label: 'الكهرباء' },
  { key: 'water', label: 'المياه' },
  { key: 'internet', label: 'الإنترنت' },
  { key: 'maintenance', label: 'الصيانة' },
];

function thisMonth() {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Riyadh' })
    .format(new Date())
    .slice(0, 7);
}

export function FinanceScreen({ session, onSessionChange, onSignOut, onShowStatus }: Props) {
  const [month, setMonth] = useState(thisMonth);
  const [children, setChildren] = useState<Child[]>([]);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [kind, setKind] = useState<EntryKind>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [nextChildren, nextReport] = await Promise.all([
        getChildren(session, onSessionChange),
        getMonthlyReport(session, month, onSessionChange),
      ]);
      setChildren(nextChildren);
      setReport(nextReport);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل المصاريف.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      getChildren(session, onSessionChange),
      getMonthlyReport(session, month, onSessionChange),
    ])
      .then(([nextChildren, nextReport]) => {
        if (!active) return;
        setChildren(nextChildren);
        setReport(nextReport);
        setError('');
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'تعذر تحميل المصاريف.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month, onSessionChange, session]);

  const changeMonth = (amount: number) => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    setMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  };

  const saveEntry = async (values: Record<string, string>) => {
    setSaving(true);
    try {
      if (kind === 'lesson') {
        await addHomeLesson(session, {
          childId: values.childId,
          amount: values.amount,
          description: values.description || undefined,
          occurredAt: new Date().toISOString(),
        }, onSessionChange);
      } else if (kind === 'tuition') {
        await addRecurringTuition(session, {
          childId: values.childId,
          amount: values.amount,
          description: values.description,
        }, onSessionChange);
      } else if (kind === 'household') {
        await addHouseholdExpense(session, {
          amount: values.amount,
          subcategoryKey: values.subcategoryKey || undefined,
          description: values.description || undefined,
          occurredAt: new Date().toISOString(),
        }, onSessionChange);
      } else if (kind === 'child') {
        await addChild(session, { name: values.name }, onSessionChange);
      }
      setKind(null);
      await refresh();
    } catch (err) {
      Alert.alert('لم يتم الحفظ', err instanceof Error ? err.message : 'حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  const currency = report?.currency ?? session.family.currency;
  const formatMoney = (amount: string) =>
    new Intl.NumberFormat('ar-SA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('ar-SA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#0c5949" />}
      >
        <View style={styles.header}>
          <View style={styles.brandMark}><Text style={styles.brandLetter}>م</Text></View>
          <View style={styles.headerCopy}>
            <Text style={styles.familyName}>{session.family.name}</Text>
            <Text style={styles.welcome}>{session.user.name}</Text>
          </View>
          <Pressable onPress={onShowStatus} style={styles.headerAction} accessibilityLabel="حالة الاتصال">
            <Text style={styles.headerActionText}>●</Text>
          </Pressable>
          <Pressable onPress={onSignOut} style={styles.headerAction} accessibilityLabel="تسجيل الخروج">
            <Text style={styles.signOutGlyph}>↪</Text>
          </Pressable>
        </View>

        <View style={styles.monthBar}>
          <Pressable onPress={() => changeMonth(-1)} style={styles.monthArrow} accessibilityLabel="الشهر السابق">
            <Text style={styles.monthArrowText}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>{monthLabel}</Text>
          <Pressable onPress={() => changeMonth(1)} style={styles.monthArrow} accessibilityLabel="الشهر التالي">
            <Text style={styles.monthArrowText}>›</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loading}><ActivityIndicator size="large" color="#0c5949" /></View>
        ) : (
          <>
            <View style={styles.summaryHeader}>
              <Text style={styles.sectionTitle}>ملخص المصاريف</Text>
              <Text style={styles.projectedLabel}>الفعلي + المتكرر المخطط</Text>
            </View>
            <View style={styles.summaryGrid}>
              <SummaryTile
                title="الدروس المنزلية"
                amount={formatMoney(report?.homeLessons.totalAmount ?? '0')}
                detail={`جلسات ${formatMoney(report?.homeLessons.spentAmount ?? '0')} · شهري ${formatMoney(report?.homeLessons.plannedRecurringAmount ?? '0')}`}
                color="#0c5949"
                background="#e0efe7"
              />
              <SummaryTile
                title="مصاريف المنزل"
                amount={formatMoney(report?.household.totalAmount ?? '0')}
                detail={`فعلي ${formatMoney(report?.household.spentAmount ?? '0')} · متكرر ${formatMoney(report?.household.plannedRecurringAmount ?? '0')}`}
                color="#8c5706"
                background="#f6edda"
              />
            </View>

            {report?.homeLessons.perChild.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>تكلفة الدروس حسب الطفل</Text>
                <View style={styles.childTotals}>
                  {report.homeLessons.perChild.map((child) => (
                    <View key={child.childId} style={styles.childTotalRow}>
                      <Text style={styles.childTotalName}>{child.childName}</Text>
                      <Text style={styles.childTotalAmount}>{formatMoney(child.totalAmount)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>المصروفات</Text>
                <Text style={styles.entryCount}>{report?.expenses.length ?? 0}</Text>
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {report?.expenses.length ? report.expenses.map((expense) => (
                <View key={expense.id} style={styles.expenseRow}>
                  <View style={[styles.expenseMark, { backgroundColor: expense.category.key === 'household' ? '#f6edda' : '#e0efe7' }]}>
                    <Text style={{ color: expense.category.key === 'household' ? '#8c5706' : '#0c5949', fontWeight: '700' }}>
                      {expense.category.key === 'household' ? 'م' : 'د'}
                    </Text>
                  </View>
                  <View style={styles.expenseInfo}>
                    <Text style={styles.expenseTitle} numberOfLines={1}>
                      {expense.description || expense.subcategory?.nameAr || expense.category.nameAr}
                    </Text>
                    <Text style={styles.expenseMeta} numberOfLines={1}>
                      {expense.member?.name ? `${expense.member.name} · ` : ''}{formatOccurredAt(expense.occurredAt, expense.date)}
                    </Text>
                  </View>
                  <Text style={styles.expenseAmount}>{formatMoney(expense.amount)}</Text>
                </View>
              )) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>لا توجد مصروفات لهذا الشهر</Text>
                  <Text style={styles.emptyBody}>أضف درسًا أو مصروفًا منزليًا لبدء المتابعة.</Text>
                </View>
              )}
            </View>

            <View style={styles.actionsSection}>
              <Text style={styles.sectionTitle}>إضافة</Text>
              <View style={styles.actionsGrid}>
                <ActionButton label="درس جديد" onPress={() => setKind('lesson')} />
                <ActionButton label="رسوم شهرية" onPress={() => setKind('tuition')} />
                <ActionButton label="مصروف منزلي" onPress={() => setKind('household')} />
                <ActionButton label="إضافة طفل" onPress={() => setKind('child')} secondary />
              </View>
              <Text style={styles.siriNote}>تُسجّل جلسة الدرس بتاريخ ووقت الإضافة تلقائيًا.</Text>
            </View>
          </>
        )}
      </ScrollView>

      <EntryModal
        key={kind ?? 'closed'}
        kind={kind}
        childOptions={children}
        saving={saving}
        onClose={() => setKind(null)}
        onSubmit={(values) => void saveEntry(values)}
      />
    </SafeAreaView>
  );
}

function formatOccurredAt(occurredAt: string | null, date: string) {
  if (!occurredAt) return date;
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(occurredAt));
}

function SummaryTile({ title, amount, detail, color, background }: { title: string; amount: string; detail: string; color: string; background: string }) {
  return (
    <View style={[styles.summaryTile, { backgroundColor: background }]}>
      <Text style={[styles.summaryTitle, { color }]}>{title}</Text>
      <Text style={[styles.summaryAmount, { color }]} numberOfLines={1}>{amount}</Text>
      <Text style={styles.summaryDetail} numberOfLines={2}>{detail}</Text>
    </View>
  );
}

function ActionButton({ label, onPress, secondary = false }: { label: string; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionButton, secondary && styles.actionSecondary, pressed && styles.pressed]}>
      <Text style={[styles.actionPlus, secondary && styles.actionSecondaryText]}>+</Text>
      <Text style={[styles.actionText, secondary && styles.actionSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

function EntryModal({
  kind,
  childOptions,
  saving,
  onClose,
  onSubmit,
}: {
  kind: EntryKind;
  childOptions: Child[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [childId, setChildId] = useState('');
  const [subcategoryKey, setSubcategoryKey] = useState('electricity');
  const activeChildId = childId || childOptions[0]?.id || '';

  const title = kind === 'lesson' ? 'درس جديد' : kind === 'tuition' ? 'رسوم شهرية للدروس' : kind === 'household' ? 'مصروف منزلي' : 'إضافة طفل';
  const needsChild = kind === 'lesson' || kind === 'tuition';
  const canSubmit = kind === 'child' ? name.trim().length > 0 : Number(amount) > 0 && (!needsChild || Boolean(activeChildId)) && (kind !== 'tuition' || description.trim().length > 0);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(kind)}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHeading}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} accessibilityLabel="إغلاق"><Text style={styles.closeGlyph}>×</Text></Pressable>
          </View>

          {kind === 'child' ? (
            <TextInput value={name} onChangeText={setName} placeholder="اسم الطفل" style={styles.modalInput} textAlign="right" />
          ) : (
            <>
              {needsChild ? (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>الطفل</Text>
                  {childOptions.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
                      {childOptions.map((child) => (
                        <Pressable key={child.id} onPress={() => setChildId(child.id)} style={[styles.option, childId === child.id && styles.optionActive]}>
                          <Text style={[styles.optionText, childId === child.id && styles.optionTextActive]}>{child.name}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : <Text style={styles.emptyHint}>أضف طفلًا أولًا من شاشة المصروفات.</Text>}
                </View>
              ) : null}
              <View style={styles.modalField}>
                <Text style={styles.modalLabel}>المبلغ</Text>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  style={[styles.modalInput, styles.amountInput]}
                  textAlign="left"
                />
              </View>
              {kind === 'household' ? (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>التصنيف</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
                    {HOUSEHOLD_SUBCATEGORIES.map((item) => (
                      <Pressable key={item.key} onPress={() => setSubcategoryKey(item.key)} style={[styles.option, subcategoryKey === item.key && styles.optionActive]}>
                        <Text style={[styles.optionText, subcategoryKey === item.key && styles.optionTextActive]}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              <View style={styles.modalField}>
                <Text style={styles.modalLabel}>{kind === 'tuition' ? 'وصف الرسوم' : 'ملاحظة (اختياري)'}</Text>
                <TextInput value={description} onChangeText={setDescription} placeholder={kind === 'tuition' ? 'مثل: دروس الرياضيات' : 'تفاصيل إضافية'} style={styles.modalInput} textAlign="right" />
              </View>
            </>
          )}

          <Pressable
            disabled={!canSubmit || saving}
            onPress={() => onSubmit({ amount, description, name, childId: activeChildId, subcategoryKey })}
            style={({ pressed }) => [styles.modalSubmit, pressed && styles.pressed, (!canSubmit || saving) && styles.disabled]}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>حفظ</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f3' },
  page: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 36, gap: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 43, height: 43, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: '#0c5949' },
  brandLetter: { color: '#fff', fontSize: 23, fontWeight: '700' },
  headerCopy: { flex: 1 },
  familyName: { color: '#172b27', fontSize: 16, fontWeight: '700', textAlign: 'right' },
  welcome: { color: '#61736c', fontSize: 11, marginTop: 2, textAlign: 'right' },
  headerAction: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#d5e0da', borderRadius: 10, backgroundColor: '#fff' },
  headerActionText: { color: '#19714c', fontSize: 15 },
  signOutGlyph: { color: '#61736c', fontSize: 20 },
  monthBar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#d5e0da' },
  monthTitle: { color: '#172b27', fontSize: 16, fontWeight: '700' },
  monthArrow: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  monthArrowText: { color: '#0c5949', fontSize: 29, lineHeight: 32 },
  loading: { minHeight: 210, justifyContent: 'center', alignItems: 'center' },
  summaryHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { color: '#172b27', fontSize: 15, fontWeight: '700', textAlign: 'right' },
  projectedLabel: { color: '#61736c', fontSize: 10, textAlign: 'left' },
  summaryGrid: { flexDirection: 'row', gap: 10 },
  summaryTile: { flex: 1, minWidth: 0, minHeight: 126, justifyContent: 'center', padding: 13, borderRadius: 14 },
  summaryTitle: { fontSize: 12, fontWeight: '700', textAlign: 'right' },
  summaryAmount: { fontSize: 18, fontWeight: '700', marginTop: 10, textAlign: 'right' },
  summaryDetail: { color: '#61736c', fontSize: 10, lineHeight: 15, marginTop: 6, textAlign: 'right' },
  section: { gap: 11 },
  childTotals: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14 },
  childTotalRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e9e5' },
  childTotalName: { color: '#172b27', fontSize: 13, textAlign: 'right' },
  childTotalAmount: { color: '#0c5949', fontSize: 13, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entryCount: { color: '#61736c', fontSize: 12, fontVariant: ['tabular-nums'] },
  expenseRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d5e0da' },
  expenseMark: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  expenseInfo: { flex: 1, minWidth: 0 },
  expenseTitle: { color: '#172b27', fontSize: 13, fontWeight: '600', textAlign: 'right' },
  expenseMeta: { color: '#61736c', fontSize: 10, marginTop: 4, textAlign: 'right' },
  expenseAmount: { color: '#172b27', fontSize: 12, fontWeight: '700', maxWidth: 112, textAlign: 'left' },
  emptyState: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  emptyTitle: { color: '#172b27', fontSize: 13, fontWeight: '600' },
  emptyBody: { color: '#61736c', fontSize: 11, textAlign: 'center' },
  error: { color: '#ad392d', fontSize: 12, textAlign: 'right' },
  actionsSection: { gap: 11 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionButton: { width: '48%', minHeight: 46, flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, borderRadius: 10, backgroundColor: '#0c5949' },
  actionSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d5e0da' },
  actionPlus: { color: '#fff', fontSize: 20, lineHeight: 22 },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  actionSecondaryText: { color: '#0c5949' },
  siriNote: { color: '#61736c', fontSize: 10, textAlign: 'right' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17, 32, 28, 0.42)' },
  modalSheet: { gap: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: '#f7faf8' },
  modalHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: '#172b27', fontSize: 18, fontWeight: '700', textAlign: 'right' },
  closeGlyph: { color: '#61736c', fontSize: 27, lineHeight: 30, paddingHorizontal: 6 },
  modalField: { gap: 7 },
  modalLabel: { color: '#465951', fontSize: 12, fontWeight: '600', textAlign: 'right' },
  modalInput: { minHeight: 46, borderWidth: 1, borderColor: '#d5e0da', borderRadius: 10, paddingHorizontal: 12, color: '#172b27', backgroundColor: '#fff', fontSize: 14 },
  amountInput: { fontSize: 18, fontWeight: '700' },
  optionRow: { flexDirection: 'row', gap: 7, paddingVertical: 2 },
  option: { minHeight: 37, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#d5e0da', borderRadius: 9, backgroundColor: '#fff' },
  optionActive: { borderColor: '#0c5949', backgroundColor: '#e0efe7' },
  optionText: { color: '#465951', fontSize: 11, fontWeight: '600' },
  optionTextActive: { color: '#0c5949' },
  emptyHint: { color: '#ad392d', fontSize: 11, textAlign: 'right' },
  modalSubmit: { minHeight: 47, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: '#0c5949' },
  modalSubmitText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text, TextInput } from '../../typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addHouseholdSection,
  deleteHouseholdSection,
  deleteRecurringFee,
  getChildren,
  getHouseholdSections,
  getRecurringFees,
  getTeachers,
  addTeacher,
  deleteTeacher,
  type Teacher,
  type Child,
  type HouseholdSection,
  type PermissionKey,
  type RecurringFee,
} from '../../api';
import { Card, IconBubble, InlineDelete, ListSkeleton, ScreenHeader, SectionTitle, SmallButton, ToneCard, type IconName } from '../../components';
import type { StringKey } from '../../i18n';
import type { Tone } from '../../theme';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { normalizePhone, PHONE_PATTERN, TeacherContact } from '../../teachers';
import { useSubjectLabel } from '../../subjects';
import { WalletCards } from '../../WalletCards';
import { FadeInView, PressableScale } from '../../motion';

// Each tile needs the action permission plus the service switch the father controls.
const SERVICES: { kind: string; title: StringKey; body: StringKey; icon: IconName; tone: Tone; needs: PermissionKey[] }[] = [
  { kind: 'lesson', title: 'svcLesson', body: 'svcLessonBody', icon: 'school', tone: 'indigo', needs: ['ADD_EXPENSE', 'SERVICE_LESSONS'] },
  { kind: 'tuition', title: 'svcTuition', body: 'svcTuitionBody', icon: 'repeat', tone: 'violet', needs: ['ADD_EXPENSE', 'SERVICE_RECURRING', 'SERVICE_LESSONS'] },
  { kind: 'household', title: 'svcHousehold', body: 'svcHouseholdBody', icon: 'home', tone: 'amber', needs: ['ADD_EXPENSE', 'SERVICE_HOUSEHOLD'] },
  { kind: 'child', title: 'svcChild', body: 'svcChildBody', icon: 'person-add', tone: 'teal', needs: ['MANAGE_CHILDREN'] },
];

export default function ServicesScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors, rtl } = usePreferences();
  const format = useFormat();
  const [children, setChildren] = useState<Child[]>([]);
  const [fees, setFees] = useState<RecurringFee[]>([]);
  const [sections, setSections] = useState<HouseholdSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [addingSection, setAddingSection] = useState(false);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherName, setTeacherName] = useState('');
  const [teacherPhone, setTeacherPhone] = useState('');
  const currency = session.family.currency;
  const can = useCan();
  const subjectLabel = useSubjectLabel();
  const isAdmin = session.user.isAdmin;

  const load = useCallback(async () => {
    try {
      const [nextChildren, nextFees, nextSections, nextTeachers] = await Promise.all([call(getChildren), call(getRecurringFees), call(getHouseholdSections), call(getTeachers)]);
      setTeachers(nextTeachers);
      setChildren(nextChildren);
      setFees(nextFees);
      setSections(nextSections);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (action: () => Promise<unknown>, fallback: StringKey) => {
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(fallback));
    }
  };

  const addSection = async () => {
    const name = sectionName.trim();
    if (!name) return;
    setAddingSection(true);
    await run(() => call((sess, r) => addHouseholdSection(sess, name, r)), 'saveError');
    setSectionName('');
    setAddingSection(false);
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 22 },
    grid: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 10 },
    serviceWrap: { width: '48%' as const, flexGrow: 1 },
    service: { flex: 1, gap: 8, alignItems: d.alignStart, minHeight: 170 },
    serviceTitle: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start, marginTop: 4 },
    serviceBody: { color: c.muted, fontSize: 12, lineHeight: 17, textAlign: d.start },
    reminderCard: { flexDirection: d.row, alignItems: 'center' as const, gap: 14 },
    section: { gap: 10 },
    row: { minHeight: 60, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowInfo: { flex: 1, minWidth: 0 },
    rowTitle: { color: c.text, fontSize: 15, fontWeight: '600' as const, textAlign: d.start },
    rowSub: { color: c.muted, fontSize: 12, marginTop: 3, textAlign: d.start },
    amount: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 6 },
    chips: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    chip: { flexDirection: d.row, alignItems: 'center' as const, minHeight: 40, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
    chipText: { color: c.text, fontSize: 14, fontWeight: '600' as const, paddingHorizontal: 8 },
    addRow: { flexDirection: d.row, gap: 8 },
    input: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, color: c.text, backgroundColor: c.background, fontSize: 14, textAlign: d.start },
    addButton: { width: 46, height: 46, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primary },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
      >
        <ScreenHeader title={t('tabServices')} subtitle={t('servicesSubtitle')} />

        <View style={s.grid}>
          {SERVICES.filter((service) => service.needs.every(can)).map((service, index) => (
            <FadeInView key={service.kind} index={index} style={s.serviceWrap}>
            <PressableScale style={{ flex: 1 }} onPress={() => router.push(`/create/${service.kind}`)} accessibilityRole="button">
              <ToneCard tone={service.tone} style={s.service}>
                <IconBubble name={service.icon} color={colors.tones[service.tone].icon} background={colors.tones[service.tone].bubble} size={44} />
                <Text style={[s.serviceTitle, { color: colors.tones[service.tone].fg }]}>{t(service.title)}</Text>
                <Text style={[s.serviceBody, { color: colors.tones[service.tone].fg, opacity: 0.8 }]}>{t(service.body)}</Text>
              </ToneCard>
            </PressableScale>
            </FadeInView>
          ))}
        </View>

        <PressableScale onPress={() => router.push('/payments')} accessibilityRole="button">
          <ToneCard tone="rose" style={s.reminderCard}>
            <IconBubble name="calendar" color={colors.tones.rose.icon} background={colors.tones.rose.bubble} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={[s.serviceTitle, { color: colors.tones.rose.fg, marginTop: 0 }]}>{t('payments')}</Text>
              <Text style={[s.serviceBody, { color: colors.tones.rose.fg, opacity: 0.85 }]}>{t('paymentsSubtitle')}</Text>
            </View>
            <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.tones.rose.fg} />
          </ToneCard>
        </PressableScale>

        {error ? <Text style={s.error}>{error}</Text> : null}

        {/* Allowances (عهدة): the father adds them; holders and chosen members see theirs. */}
        <WalletCards showAdd />

        {can('SERVICE_LESSONS') || can('MANAGE_CHILDREN') ? <View style={s.section}>
          <SectionTitle title={t('children')} count={children.length} action={can('MANAGE_CHILDREN') ? <SmallButton label={t('add')} icon="add" onPress={() => router.push('/create/child')} /> : undefined} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {loading ? <ListSkeleton rows={2} /> : children.length ? children.map((child, index) => (
              <Pressable
                key={child.id}
                onPress={() => router.push(`/child/${child.id}`)}
                style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
              >
                <IconBubble name="person" color={colors.lessons} background={colors.lessonsSoft} />
                <View style={s.rowInfo}>
                  <Text style={s.rowTitle}>{child.name}</Text>
                  {child.grade || child.school ? <Text style={s.rowSub} numberOfLines={1}>{[child.grade, child.school].filter(Boolean).join(' · ')}</Text> : null}
                </View>
                <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.muted} />
              </Pressable>
            )) : <Text style={s.hint}>{t('noChildren')}</Text>}
          </Card>
        </View> : null}

        {can('SERVICE_LESSONS') ? <View style={s.section}>
          <SectionTitle title={t('teachers')} count={teachers.length} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {teachers.length ? teachers.map((teacher, index) => (
              <View key={teacher.id} style={[{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 4 }, index > 0 && s.divider]}>
                <View style={{ flex: 1 }}><TeacherContact teacher={teacher} linked /></View>
                {can('DELETE_EXPENSE') ? <InlineDelete label={teacher.name} onConfirm={() => run(() => call((sess, r) => deleteTeacher(sess, teacher.id, r)), 'deleteError')} /> : null}
              </View>
            )) : loading ? <ListSkeleton rows={1} /> : <Text style={s.hint}>{t('noTeachers')}</Text>}
            {can('ADD_EXPENSE') ? (
              <View style={{ gap: 8, paddingBottom: 14, paddingTop: 6 }}>
                <TextInput value={teacherName} onChangeText={setTeacherName} placeholder={t('teacherName')} placeholderTextColor={colors.muted} style={s.input} />
                <View style={s.addRow}>
                  <TextInput value={teacherPhone} onChangeText={setTeacherPhone} placeholder={t('teacherPhone')} placeholderTextColor={colors.muted} style={s.input} keyboardType="phone-pad" />
                  <Pressable
                    disabled={!teacherName.trim() || (teacherPhone.trim() !== '' && !PHONE_PATTERN.test(normalizePhone(teacherPhone)))}
                    onPress={() => void run(async () => {
                      const phone = normalizePhone(teacherPhone).trim();
                      await call((sess, r) => addTeacher(sess, { name: teacherName.trim(), phone: phone || null }, r));
                      setTeacherName('');
                      setTeacherPhone('');
                    }, 'saveError')}
                    style={[s.addButton, (!teacherName.trim() || (teacherPhone.trim() !== '' && !PHONE_PATTERN.test(normalizePhone(teacherPhone)))) && { opacity: 0.45 }]}
                    accessibilityLabel={t('addTeacher')}
                  >
                    <Ionicons name="add" size={22} color={colors.primaryText} />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </Card>
        </View> : null}

        {can('SERVICE_RECURRING') ? <View style={s.section}>
          <SectionTitle title={t('monthlyFees')} count={fees.length} action={can('ADD_EXPENSE') && can('SERVICE_LESSONS') ? <SmallButton label={t('add')} icon="add" onPress={() => router.push('/create/tuition')} /> : undefined} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {loading ? <ListSkeleton rows={2} /> : fees.length ? fees.map((fee, index) => (
              <View key={fee.id} style={[s.row, index > 0 && s.divider]}>
                <IconBubble
                  name={fee.kind === 'HOUSEHOLD' ? 'home' : 'repeat'}
                  color={fee.kind === 'HOUSEHOLD' ? colors.household : colors.lessons}
                  background={fee.kind === 'HOUSEHOLD' ? colors.householdSoft : colors.lessonsSoft}
                />
                <View style={s.rowInfo}>
                  <Text style={s.rowTitle} numberOfLines={1}>{fee.description}</Text>
                  <Text style={s.rowSub} numberOfLines={1}>
                    {[fee.child?.name, subjectLabel(fee.subject), fee.teacher?.name, fee.section ? format.name(fee.section) : null, t(`freq_${fee.frequency}` as StringKey)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={s.amount}>{format.money(fee.amount, fee.currency)}</Text>
                {can('ADD_PAYMENT') ? (
                  <Pressable
                    hitSlop={6}
                    accessibilityLabel={t('remindMe')}
                    onPress={() => router.push({ pathname: '/payment/new', params: { name: fee.description, amount: fee.amount, currency: fee.currency, category: 'TUITION', memberId: fee.child?.id ?? '', day: String(Number(fee.startDate.slice(8, 10))) } })}
                    style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Ionicons name="notifications-outline" size={18} color={colors.primary} />
                  </Pressable>
                ) : null}
                {can('DELETE_EXPENSE') ? <InlineDelete label={fee.description} onConfirm={() => run(() => call((sess, r) => deleteRecurringFee(sess, fee.id, r)), 'deleteError')} /> : null}
              </View>
            )) : <Text style={s.hint}>{t('noFees')}</Text>}
          </Card>
        </View> : null}

        {can('SERVICE_HOUSEHOLD') ? <View style={s.section}>
          <SectionTitle title={t('householdSections')} count={sections.length} />
          <Card>
            <View style={s.chips}>
              {sections.map((section) => (
                <View key={section.id} style={s.chip}>
                  <Text style={s.chipText}>{format.name(section)}</Text>
                  {isAdmin ? <InlineDelete label={format.name(section)} onConfirm={() => run(() => call((sess, r) => deleteHouseholdSection(sess, section.id, r)), 'deleteError')} /> : null}
                </View>
              ))}
              {!sections.length && !loading ? <Text style={s.hint}>{t('noSections')}</Text> : null}
            </View>
            {isAdmin ? <View style={[s.addRow, { marginTop: 14 }]}>
              <TextInput
                value={sectionName}
                onChangeText={setSectionName}
                onSubmitEditing={() => void addSection()}
                placeholder={t('newSectionPlaceholder')}
                placeholderTextColor={colors.muted}
                style={s.input}
                returnKeyType="done"
              />
              <Pressable
                disabled={!sectionName.trim() || addingSection}
                onPress={() => void addSection()}
                style={[s.addButton, (!sectionName.trim() || addingSection) && { opacity: 0.45 }]}
                accessibilityLabel={t('addSection')}
              >
                {addingSection ? <ActivityIndicator color={colors.primaryText} size="small" /> : <Ionicons name="add" size={22} color={colors.primaryText} />}
              </Pressable>
            </View> : null}
          </Card>
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

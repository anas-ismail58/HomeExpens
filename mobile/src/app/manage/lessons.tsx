import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ApiError, addTeacher, createSubject, deleteSubject, deleteTeacher, getTeachers, updateSubject, updateTeacher, type Subject, type Teacher } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, IconBubble, InlineDelete, ListSkeleton, PrimaryButton, SectionTitle, SegmentedControl, SmallButton } from '../../components';
import { Chips, Field, TextField } from '../../formControls';
import { usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { useSubjectLabel, useSubjects } from '../../subjects';
import { normalizePhone, PHONE_PATTERN } from '../../teachers';
import { Text } from '../../typography';

export default function ManageLessonsPage() {
  return (
    <WithBottomBar>
      <ManageLessonsScreen />
    </WithBottomBar>
  );
}

type TeacherForm = { id: string | null; name: string; phone: string; subject: string };
const emptyTeacher: TeacherForm = { id: null, name: '', phone: '', subject: '' };

/** The only place teachers and subjects are added, edited and removed; lesson pages choose from them. */
function ManageLessonsScreen() {
  const { call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const can = useCan();
  const label = useSubjectLabel();
  const { subjects, loaded, reload } = useSubjects();
  const [tab, setTab] = useState<'subjects' | 'teachers'>('subjects');
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [teacher, setTeacher] = useState<TeacherForm>(emptyTeacher);

  const manage = can('ADD_EXPENSE') && can('SERVICE_LESSONS');
  const remove = can('DELETE_EXPENSE') && can('SERVICE_LESSONS');

  const loadTeachers = useCallback(async () => {
    try {
      setTeachers(await call(getTeachers));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);
  useFocusEffect(useCallback(() => { void loadTeachers(); void reload(); }, [loadTeachers, reload]));

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      await action();
      after?.();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('duplicateSubject') : err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: d.start },
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    name: { color: c.text, fontSize: 15, fontWeight: '600' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 12, marginTop: 2, textAlign: d.start },
    addRow: { flexDirection: d.row, gap: 8, alignItems: 'center' as const },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (!can('SERVICE_LESSONS')) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  const active = subjects.filter((x) => x.isActive);
  const removed = subjects.filter((x) => !x.isActive);
  const phone = normalizePhone(teacher.phone).trim();
  const teacherValid = teacher.name.trim().length > 0 && (!phone || PHONE_PATTERN.test(phone));

  const subjectRow = (subject: Subject, index: number) => (
    <View key={subject.id} style={[s.row, index > 0 && s.divider]}>
      <IconBubble name="book" color={colors.lessons} background={colors.lessonsSoft} size={34} />
      {renaming?.id === subject.id ? (
        <View style={{ flex: 1, gap: 8 }}>
          <TextField value={renaming.name} onChange={(name) => setRenaming({ id: subject.id, name })} />
          <View style={s.addRow}>
            <SmallButton label={t('save')} icon="checkmark" onPress={() => renaming.name.trim() && void run(() => call((sess, r) => updateSubject(sess, subject.id, { name: renaming.name.trim() }, r)), () => { setRenaming(null); void reload(); })} />
            <SmallButton label={t('cancel')} icon="close" onPress={() => setRenaming(null)} />
          </View>
        </View>
      ) : (
        <Pressable style={{ flex: 1 }} disabled={!manage} onPress={() => setRenaming({ id: subject.id, name: label(subject.key) })} accessibilityHint={t('kEdit')}>
          <Text style={s.name}>{label(subject.key)}</Text>
        </Pressable>
      )}
      {renaming?.id !== subject.id && manage ? <SmallButton label={t('kEdit')} icon="create-outline" onPress={() => setRenaming({ id: subject.id, name: label(subject.key) })} /> : null}
      {renaming?.id !== subject.id && remove ? <InlineDelete label={label(subject.key)} onConfirm={() => run(() => call((sess, r) => deleteSubject(sess, subject.id, r)), () => void reload())} /> : null}
    </View>
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.hint}>{t('manageHint')}</Text>
      <SegmentedControl options={[{ value: 'subjects', label: t('subjects') }, { value: 'teachers', label: t('teachers') }]} value={tab} onChange={setTab} />
      {error ? <Text style={s.error}>{error}</Text> : null}

      {tab === 'subjects' ? (
        <>
          {manage ? (
            <Card style={{ gap: 10 }}>
              <Field label={t('newSubject')}>
                <TextField value={newSubject} onChange={setNewSubject} placeholder={t('subjectName')} />
              </Field>
              <PrimaryButton
                label={t('add')}
                icon="add"
                busy={busy}
                disabled={!newSubject.trim()}
                onPress={() => void run(() => call((sess, r) => createSubject(sess, newSubject.trim(), r)), () => { setNewSubject(''); void reload(); })}
              />
            </Card>
          ) : null}
          <View style={{ gap: 10 }}>
            <SectionTitle title={t('subjects')} count={active.length} />
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {!loaded ? <ListSkeleton rows={3} /> : active.length ? active.map(subjectRow) : <Text style={[s.hint, { paddingVertical: 14 }]}>{t('noSubjects')}</Text>}
            </Card>
          </View>
          {removed.length && manage ? (
            <View style={{ gap: 10 }}>
              <SectionTitle title={t('removedSubjects')} count={removed.length} />
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                {removed.map((subject, index) => (
                  <View key={subject.id} style={[s.row, index > 0 && s.divider]}>
                    <Text style={[s.name, { flex: 1, color: colors.muted }]}>{label(subject.key)}</Text>
                    <SmallButton label={t('restore')} icon="refresh" onPress={() => void run(() => call((sess, r) => updateSubject(sess, subject.id, { isActive: true }, r)), () => void reload())} />
                  </View>
                ))}
              </Card>
            </View>
          ) : null}
        </>
      ) : (
        <>
          {manage ? (
            <Card style={{ gap: 10 }}>
              <SectionTitle title={teacher.id ? t('kEdit') : t('newTeacherTitle')} />
              <Field label={t('teacherName')}>
                <TextField value={teacher.name} onChange={(name) => setTeacher({ ...teacher, name })} placeholder={t('teacherName')} />
              </Field>
              <Field label={t('teacherPhone')}>
                <TextField value={teacher.phone} onChange={(value) => setTeacher({ ...teacher, phone: value })} placeholder={t('teacherPhone')} keyboardType="phone-pad" autoCapitalize="none" />
              </Field>
              {phone && !PHONE_PATTERN.test(phone) ? <Text style={s.error}>{t('invalidPhone')}</Text> : null}
              <Field label={t('teacherSubject')}>
                <Chips
                  options={[{ value: '', label: t('none') }, ...active.map((x) => ({ value: x.key, label: label(x.key) }))]}
                  value={teacher.subject}
                  onChange={(subject) => setTeacher({ ...teacher, subject })}
                />
              </Field>
              <PrimaryButton
                label={teacher.id ? t('saveChanges') : t('add')}
                icon={teacher.id ? 'checkmark' : 'add'}
                busy={busy}
                disabled={!teacherValid}
                onPress={() => {
                  const input = { name: teacher.name.trim(), phone: phone || null, subject: teacher.subject || null };
                  void run(
                    () => call((sess, r) => (teacher.id ? updateTeacher(sess, teacher.id, input, r) : addTeacher(sess, input, r))),
                    () => { setTeacher(emptyTeacher); void loadTeachers(); },
                  );
                }}
              />
              {teacher.id ? <SmallButton label={t('cancel')} icon="close" onPress={() => setTeacher(emptyTeacher)} /> : null}
            </Card>
          ) : null}
          <View style={{ gap: 10 }}>
            <SectionTitle title={t('teachers')} count={teachers?.length ?? 0} />
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {!teachers ? <ListSkeleton rows={3} /> : teachers.length ? teachers.map((item, index) => (
                <View key={item.id} style={[s.row, index > 0 && s.divider]}>
                  <IconBubble name="person" color={colors.lessons} background={colors.lessonsSoft} size={34} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.sub} numberOfLines={1}>{[item.phone, label(item.subject)].filter(Boolean).join(' · ')}</Text>
                  </View>
                  {manage ? <SmallButton label={t('kEdit')} icon="create-outline" onPress={() => setTeacher({ id: item.id, name: item.name, phone: item.phone ?? '', subject: item.subject ?? '' })} /> : null}
                  {remove ? <InlineDelete label={item.name} onConfirm={() => run(() => call((sess, r) => deleteTeacher(sess, item.id, r)), () => void loadTeachers())} /> : null}
                </View>
              )) : <Text style={[s.hint, { paddingVertical: 14 }]}>{t('noTeachers')}</Text>}
            </Card>
          </View>
        </>
      )}
    </ScrollView>
  );
}

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ApiError, createSubject, deleteSubject, updateSubject } from '../../api';
import { Card, IconBubble, InlineDelete, ListSkeleton, PrimaryButton, SectionTitle, SmallButton } from '../../components';
import { Field, TextField } from '../../formControls';
import { ListPage, useRowStyles } from '../../manageUi';
import { usePreferences } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { useSubjectLabel, useSubjects } from '../../subjects';
import { Text } from '../../typography';

/** Lesson subjects: added, renamed, removed and restored only here; lessons choose from this list. */
export default function SubjectsPage() {
  const { call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const can = useCan();
  const label = useSubjectLabel();
  const { subjects, loaded, reload } = useSubjects();
  const s = useRowStyles();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const manage = can('ADD_EXPENSE') && can('SERVICE_LESSONS');
  const remove = can('DELETE_EXPENSE');

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      await action();
      after?.();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('duplicateSubject') : err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const active = subjects.filter((x) => x.isActive);
  const removed = subjects.filter((x) => !x.isActive);

  return (
    <ListPage allowed={can('SERVICE_LESSONS')} error={error} hint={t('manageHint')}>
      {manage ? (
        <Card style={{ gap: 10 }}>
          <Field label={t('newSubject')}>
            <TextField value={name} onChange={setName} placeholder={t('subjectName')} />
          </Field>
          <PrimaryButton label={t('add')} icon="add" busy={busy} disabled={!name.trim()} onPress={() => void run(() => call((sess, r) => createSubject(sess, name.trim(), r)), () => setName(''))} />
        </Card>
      ) : null}
      <View style={{ gap: 10 }}>
        <SectionTitle title={t('subjects')} count={active.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {!loaded ? <ListSkeleton rows={4} /> : active.length ? active.map((subject, index) => (
            <View key={subject.id} style={[s.row, index > 0 && s.divider]}>
              <IconBubble name="book" color={colors.lessons} background={colors.lessonsSoft} size={34} />
              {renaming?.id === subject.id ? (
                <View style={{ flex: 1, gap: 8 }}>
                  <TextField value={renaming.name} onChange={(next) => setRenaming({ id: subject.id, name: next })} />
                  <View style={s.actions}>
                    <SmallButton label={t('save')} icon="checkmark" onPress={() => renaming.name.trim() && void run(() => call((sess, r) => updateSubject(sess, subject.id, { name: renaming.name.trim() }, r)), () => setRenaming(null))} />
                    <SmallButton label={t('cancel')} icon="close" onPress={() => setRenaming(null)} />
                  </View>
                </View>
              ) : (
                <>
                  <Pressable style={s.info} disabled={!manage} onPress={() => setRenaming({ id: subject.id, name: label(subject.key) })}>
                    <Text style={s.title}>{label(subject.key)}</Text>
                  </Pressable>
                  {manage ? <SmallButton label={t('kEdit')} icon="create-outline" onPress={() => setRenaming({ id: subject.id, name: label(subject.key) })} /> : null}
                  {remove ? <InlineDelete label={label(subject.key)} onConfirm={() => run(() => call((sess, r) => deleteSubject(sess, subject.id, r)))} /> : null}
                </>
              )}
            </View>
          )) : <Text style={s.empty}>{t('noSubjects')}</Text>}
        </Card>
      </View>
      {removed.length && manage ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('removedSubjects')} count={removed.length} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {removed.map((subject, index) => (
              <View key={subject.id} style={[s.row, index > 0 && s.divider]}>
                <Text style={[s.title, { flex: 1, color: colors.muted }]}>{label(subject.key)}</Text>
                <SmallButton label={t('restore')} icon="refresh" onPress={() => void run(() => call((sess, r) => updateSubject(sess, subject.id, { isActive: true }, r)))} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </ListPage>
  );
}

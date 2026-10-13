import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { addTeacher, deleteTeacher, getTeachers, updateTeacher, type Teacher } from '../../api';
import { Card, InlineDelete, ListSkeleton, PrimaryButton, SectionTitle, SmallButton } from '../../components';
import { Chips, Field, TextField } from '../../formControls';
import { ListPage, useRowStyles } from '../../manageUi';
import { usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { useSubjectLabel, useSubjects } from '../../subjects';
import { normalizePhone, PHONE_PATTERN, TeacherContact } from '../../teachers';
import { Text } from '../../typography';

type Form = { id: string | null; name: string; phone: string; subject: string };
const empty: Form = { id: null, name: '', phone: '', subject: '' };

/** Teachers: listed with their number; added, edited and removed only here. */
export default function TeachersPage() {
  const { call } = useAuthedSession();
  const { t } = usePreferences();
  const can = useCan();
  const label = useSubjectLabel();
  const { subjects } = useSubjects();
  const row = useRowStyles();
  const s = useStyles((c, d) => ({ error: { color: c.danger, fontSize: 12, textAlign: d.start } }));
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const manage = can('ADD_EXPENSE') && can('SERVICE_LESSONS');
  const remove = can('DELETE_EXPENSE');

  const load = useCallback(async () => {
    try {
      setTeachers(await call(getTeachers));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      await action();
      after?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const phone = form ? normalizePhone(form.phone).trim() : '';
  const valid = Boolean(form?.name.trim()) && (!phone || PHONE_PATTERN.test(phone));

  return (
    <ListPage allowed={can('SERVICE_LESSONS')} error={error}>
      {manage && !form ? <PrimaryButton label={t('newTeacherTitle')} icon="person-add" onPress={() => setForm(empty)} /> : null}
      {form ? (
        <Card style={{ gap: 10 }}>
          <SectionTitle title={form.id ? t('kEdit') : t('newTeacherTitle')} />
          <Field label={t('teacherName')}>
            <TextField value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder={t('teacherName')} />
          </Field>
          <Field label={t('teacherPhone')}>
            <TextField value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} placeholder={t('teacherPhone')} keyboardType="phone-pad" autoCapitalize="none" />
          </Field>
          {phone && !PHONE_PATTERN.test(phone) ? <Text style={s.error}>{t('invalidPhone')}</Text> : null}
          <Field label={t('teacherSubject')}>
            <Chips
              options={[{ value: '', label: t('none') }, ...subjects.filter((x) => x.isActive).map((x) => ({ value: x.key, label: label(x.key) }))]}
              value={form.subject}
              onChange={(subject) => setForm({ ...form, subject })}
            />
          </Field>
          <PrimaryButton
            label={form.id ? t('saveChanges') : t('add')}
            icon={form.id ? 'checkmark' : 'add'}
            busy={busy}
            disabled={!valid}
            onPress={() => {
              const input = { name: form.name.trim(), phone: phone || null, subject: form.subject || null };
              void run(() => call((sess, r) => (form.id ? updateTeacher(sess, form.id, input, r) : addTeacher(sess, input, r))), () => setForm(null));
            }}
          />
          <SmallButton label={t('cancel')} icon="close" onPress={() => setForm(null)} />
        </Card>
      ) : null}
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {!teachers ? <ListSkeleton rows={3} /> : teachers.length ? teachers.map((teacher, index) => (
          <View key={teacher.id} style={[{ paddingBottom: manage || remove ? 10 : 0 }, index > 0 && row.divider]}>
            <TeacherContact teacher={teacher} linked />
            {manage || remove ? (
              <View style={row.actions}>
                {manage ? <SmallButton label={t('kEdit')} icon="create-outline" onPress={() => setForm({ id: teacher.id, name: teacher.name, phone: teacher.phone ?? '', subject: teacher.subject ?? '' })} /> : null}
                {remove ? <InlineDelete label={teacher.name} onConfirm={() => run(() => call((sess, r) => deleteTeacher(sess, teacher.id, r)))} /> : null}
              </View>
            ) : null}
          </View>
        )) : <Text style={row.empty}>{t('noTeachers')}</Text>}
      </Card>
    </ListPage>
  );
}

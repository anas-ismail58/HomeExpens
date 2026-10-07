import { useState } from 'react';
import { View } from 'react-native';
import { Chips, Field, TextField } from './formControls';
import type { StringKey } from './i18n';
import { usePreferences } from './preferences';

/** Built-in lesson subjects, stored by key and shown translated. Must match the server list. */
export const SUBJECT_KEYS = ['math', 'arabic', 'english', 'science', 'physics', 'chemistry', 'biology', 'quran', 'islamic', 'social', 'french', 'computer', 'art'] as const;

/** Display name of a subject: translated for list keys, as typed for the family's own subjects. */
export function useSubjectLabel() {
  const { t } = usePreferences();
  return (subject: string | null | undefined) =>
    !subject ? '' : (SUBJECT_KEYS as readonly string[]).includes(subject) ? t(`subj_${subject}` as StringKey) : subject;
}

const OTHER = '__other__';

/** Choose the lesson subject from the list (plus subjects used before), or type another one. */
export function SubjectPicker({ value, onChange, used }: { value: string; onChange: (subject: string) => void; used: string[] }) {
  const { t } = usePreferences();
  const label = useSubjectLabel();
  const custom = used.filter((subject) => !(SUBJECT_KEYS as readonly string[]).includes(subject));
  const known = [...SUBJECT_KEYS, ...custom];
  const [typing, setTyping] = useState(Boolean(value) && !known.includes(value));
  return (
    <Field label={t('subject')}>
      <Chips
        options={[
          ...known.map((subject) => ({ value: subject, label: label(subject) })),
          { value: OTHER, label: t('otherSubject'), icon: 'add' as const },
        ]}
        value={typing ? OTHER : value || null}
        onChange={(next) => {
          if (next === OTHER) {
            setTyping(true);
            onChange('');
          } else {
            setTyping(false);
            onChange(next === value ? '' : next);
          }
        }}
      />
      {typing ? (
        <View>
          <TextField value={value} onChange={onChange} placeholder={t('subjectPlaceholder')} />
        </View>
      ) : null}
    </Field>
  );
}

import { router } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Pressable } from 'react-native';
import { getSubjects, type Subject } from './api';
import { Chips, Field } from './formControls';
import type { StringKey } from './i18n';
import { usePreferences, useStyles } from './preferences';
import { useCan, useSession } from './SessionContext';
import { Text } from './typography';

/** Built-in lesson subjects, stored by key and shown translated. Must match the server list. */
export const SUBJECT_KEYS = ['math', 'arabic', 'english', 'science', 'physics', 'chemistry', 'biology', 'quran', 'islamic', 'social', 'french', 'computer', 'art'] as const;

/** The family's subjects, shared by every screen and refreshed after they're managed. */
let cache: { familyId: string; list: Subject[] } | null = null;
/** One request at a time: every screen showing subject names mounts together and would each ask. */
let inFlight: { familyId: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => cache;

export function useSubjects() {
  const { session, call } = useSession();
  const familyId = session?.family.id ?? null;
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const reload = useCallback(async () => {
    if (!familyId) return;
    try {
      cache = { familyId, list: await call(getSubjects) };
      listeners.forEach((listener) => listener());
    } catch {
      // Keep what we had; labels fall back to the built-in names.
    }
  }, [call, familyId]);
  const fresh = current && current.familyId === familyId ? current.list : null;
  useEffect(() => {
    if (!familyId || fresh) return;
    if (inFlight?.familyId === familyId) return;
    const promise = reload().finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { familyId, promise };
  }, [familyId, fresh, reload]);
  return { subjects: fresh ?? [], loaded: fresh !== null, reload };
}

/** Display name of a subject: the family's name when added or renamed, otherwise the built-in translation. */
export function useSubjectLabel() {
  const { t } = usePreferences();
  const { subjects } = useSubjects();
  return (subject: string | null | undefined, familyName?: string | null) => {
    if (!subject) return '';
    if (familyName) return familyName;
    const row = subjects.find((item) => item.key === subject);
    if (row?.name) return row.name;
    return (SUBJECT_KEYS as readonly string[]).includes(subject) ? t(`subj_${subject}` as StringKey) : subject;
  };
}

/**
 * Choose the lesson subject from the family's list. Subjects are added, renamed and removed on the
 * "Teachers & subjects" page, not here. A lesson's current subject stays selectable even if it was removed.
 */
export function SubjectPicker({ value, onChange }: { value: string; onChange: (subject: string) => void }) {
  const { t } = usePreferences();
  const can = useCan();
  const label = useSubjectLabel();
  const { subjects } = useSubjects();
  const s = useStyles((c, d) => ({ link: { color: c.primary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start } }));
  const active = subjects.filter((item) => item.isActive).map((item) => item.key);
  const options = value && !active.includes(value) ? [value, ...active] : active;
  return (
    <Field label={t('subject')}>
      <Chips options={options.map((key) => ({ value: key, label: label(key) }))} value={value || null} onChange={(next) => onChange(next === value ? '' : next)} />
      {can('ADD_EXPENSE') && can('SERVICE_LESSONS') ? (
        <Pressable onPress={() => router.push('/manage/subjects')} accessibilityRole="link">
          <Text style={s.link}>{t('manageSubjects')}</Text>
        </Pressable>
      ) : null}
    </Field>
  );
}

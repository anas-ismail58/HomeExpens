import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { type Teacher, type TeacherRef } from './api';
import { useCan } from './SessionContext';
import { useSubjectLabel } from './subjects';
import { IconBubble } from './components';
import { Chips, Field, normalizeDigits } from './formControls';
import { usePreferences, useStyles } from './preferences';
import { Text } from './typography';

export const PHONE_PATTERN = /^\+?[0-9 ()-]{3,30}$/;

/** Phone as typed, with Arabic-Indic digits converted (the API only accepts 0-9). */
export function normalizePhone(value: string) {
  return normalizeDigits(value).replace(/[^\d+ ()-]/g, '');
}

/** Teacher name and number with Copy and Call buttons. `linked` makes the name open the teacher's page. */
export function TeacherContact({ teacher, compact = false, linked = false }: { teacher: Pick<Teacher, 'name' | 'phone' | 'subject'> & { id?: string }; compact?: boolean; linked?: boolean }) {
  const subjectLabel = useSubjectLabel();
  const { t, colors, rtl } = usePreferences();
  const [copied, setCopied] = useState(false);
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 12, minHeight: 56, paddingVertical: compact ? 4 : 8 },
    who: { flex: 1, minWidth: 0, flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    name: { color: c.text, fontSize: 14, fontWeight: '700' as const, textAlign: d.start },
    phone: { color: c.textSecondary, fontSize: 13, textAlign: d.start, marginTop: 2, writingDirection: 'ltr' as const },
    copied: { color: c.success, fontSize: 11, fontWeight: '700' as const, textAlign: d.start, marginTop: 2 },
    action: { width: 38, height: 38, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
  }));
  const open = linked && teacher.id ? () => router.push(`/teacher/${teacher.id}`) : undefined;
  const copy = async () => {
    if (!teacher.phone) return;
    await Clipboard.setStringAsync(teacher.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <View style={s.row}>
      <Pressable
        disabled={!open}
        onPress={open}
        style={({ pressed }) => [s.who, pressed && { opacity: 0.7 }]}
        accessibilityRole={open ? 'link' : undefined}
        accessibilityLabel={open ? `${t('teacherProfile')} ${teacher.name}` : undefined}
      >
        <IconBubble name="person" color={colors.lessons} background={colors.lessonsSoft} size={compact ? 34 : 40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.name, open && { color: colors.primary }]} numberOfLines={1}>{teacher.name}{teacher.subject ? ` · ${subjectLabel(teacher.subject)}` : ''}</Text>
          {teacher.phone ? <Text style={s.phone} selectable={!open}>{teacher.phone}</Text> : null}
          {copied ? <Text style={s.copied}>{t('copied')}</Text> : null}
        </View>
        {open ? <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.muted} /> : null}
      </Pressable>
      {teacher.phone ? (
        <>
          <Pressable onPress={() => void copy()} style={s.action} accessibilityLabel={`${t('copy')} ${teacher.phone}`}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.primary} />
          </Pressable>
          <Pressable onPress={() => void Linking.openURL(`tel:${teacher.phone!.replace(/[^\d+]/g, '')}`).catch(() => undefined)} style={s.action} accessibilityLabel={`${t('call')} ${teacher.name}`}>
            <Ionicons name="call-outline" size={18} color={colors.primary} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

export type TeacherDraft = { mode: 'none' } | { mode: 'existing'; id: string } | { mode: 'new'; name: string; phone: string };

/** API fields for the chosen teacher, or undefined when the draft is incomplete/invalid. */
export function teacherRef(draft: TeacherDraft): TeacherRef | undefined | null {
  if (draft.mode === 'none') return {};
  if (draft.mode === 'existing') return { teacherId: draft.id };
  const name = draft.name.trim();
  const phone = normalizePhone(draft.phone).trim();
  if (!name) return null;
  if (phone && !PHONE_PATTERN.test(phone)) return null;
  return { newTeacher: { name, phone: phone || null } };
}

/**
 * Choose one of the family's teachers for a lesson. Teachers are added, edited and removed on the
 * "Teachers & subjects" page; the chosen teacher's number shows here (copy / call).
 */
export function TeacherPicker({ teachers, value, onChange }: {
  teachers: Teacher[];
  value: TeacherDraft;
  onChange: (draft: TeacherDraft) => void;
  onTeacherUpdated?: (teacher: Teacher) => void;
}) {
  const { t } = usePreferences();
  const can = useCan();
  const chosen = value.mode === 'existing' ? teachers.find((teacher) => teacher.id === value.id) : undefined;
  const selected = value.mode === 'existing' ? value.id : 'none';
  const s = useStyles((c, d) => ({ link: { color: c.primary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start } }));
  return (
    <Field label={t('teacher')}>
      <Chips
        options={[
          { value: 'none', label: t('noTeacher') },
          ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.name, icon: 'person' as const })),
        ]}
        value={selected}
        onChange={(next) => onChange(next === 'none' ? { mode: 'none' } : { mode: 'existing', id: next })}
      />
      {chosen?.phone ? <TeacherContact teacher={chosen} compact /> : null}
      {can('ADD_EXPENSE') && can('SERVICE_LESSONS') ? (
        <Pressable onPress={() => router.push('/manage/teachers')} accessibilityRole="link">
          <Text style={s.link}>{t('manageTeachers')}</Text>
        </Pressable>
      ) : null}
    </Field>
  );
}

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import type { Teacher, TeacherRef } from './api';
import { IconBubble } from './components';
import { Chips, Field, normalizeDigits, TextField } from './formControls';
import { usePreferences, useStyles } from './preferences';
import { Text } from './typography';

export const PHONE_PATTERN = /^\+?[0-9 ()-]{3,30}$/;

/** Phone as typed, with Arabic-Indic digits converted (the API only accepts 0-9). */
export function normalizePhone(value: string) {
  return normalizeDigits(value).replace(/[^\d+ ()-]/g, '');
}

/** Teacher name and number with Copy and Call buttons. */
export function TeacherContact({ teacher, compact = false }: { teacher: Pick<Teacher, 'name' | 'phone' | 'subject'>; compact?: boolean }) {
  const { t, colors } = usePreferences();
  const [copied, setCopied] = useState(false);
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 12, minHeight: 56, paddingVertical: compact ? 4 : 8 },
    name: { color: c.text, fontSize: 14, fontWeight: '700' as const, textAlign: d.start },
    phone: { color: c.textSecondary, fontSize: 13, textAlign: d.start, marginTop: 2, writingDirection: 'ltr' as const },
    copied: { color: c.success, fontSize: 11, fontWeight: '700' as const, textAlign: d.start, marginTop: 2 },
    action: { width: 38, height: 38, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
  }));
  const copy = async () => {
    if (!teacher.phone) return;
    await Clipboard.setStringAsync(teacher.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <View style={s.row}>
      <IconBubble name="person" color={colors.lessons} background={colors.lessonsSoft} size={compact ? 34 : 40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.name} numberOfLines={1}>{teacher.name}{teacher.subject ? ` · ${teacher.subject}` : ''}</Text>
        {teacher.phone ? <Text style={s.phone} selectable>{teacher.phone}</Text> : null}
        {copied ? <Text style={s.copied}>{t('copied')}</Text> : null}
      </View>
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

/** Choose a saved teacher or add a new one (name + number) right on the lesson form. */
export function TeacherPicker({ teachers, value, onChange }: { teachers: Teacher[]; value: TeacherDraft; onChange: (draft: TeacherDraft) => void }) {
  const { t } = usePreferences();
  const selected = value.mode === 'existing' ? value.id : value.mode;
  const phoneInvalid = value.mode === 'new' && value.phone.trim() !== '' && !PHONE_PATTERN.test(normalizePhone(value.phone));
  const s = useStyles((c, d) => ({ error: { color: c.danger, fontSize: 12, textAlign: d.start } }));
  return (
    <Field label={t('teacher')}>
      <Chips
        options={[
          { value: 'none', label: t('noTeacher') },
          ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.name, icon: 'person' as const })),
          { value: 'new', label: t('newTeacher'), icon: 'add' as const },
        ]}
        value={selected}
        onChange={(next) => onChange(next === 'none' ? { mode: 'none' } : next === 'new' ? { mode: 'new', name: '', phone: '' } : { mode: 'existing', id: next })}
      />
      {value.mode === 'new' ? (
        <View style={{ gap: 10 }}>
          <TextField value={value.name} onChange={(name) => onChange({ ...value, name })} placeholder={t('teacherName')} />
          <TextField value={value.phone} onChange={(phone) => onChange({ ...value, phone })} placeholder={t('teacherPhone')} keyboardType="phone-pad" autoCapitalize="none" />
          {phoneInvalid ? <Text style={s.error}>{t('invalidPhone')}</Text> : null}
        </View>
      ) : null}
    </Field>
  );
}

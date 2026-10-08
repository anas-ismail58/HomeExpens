import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from './typography';
import type { IconName } from './components';
import { useFormat, usePreferences, useStyles } from './preferences';

/** "YYYY-MM-DD" for a local Date. */
export function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDaysTo(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return toDateOnly(new Date(y, m - 1, d + days));
}

/** Accepts Arabic-Indic digits and the Arabic decimal separator. */
export function normalizeDigits(value: string) {
  return value.trim().replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace('٫', '.');
}

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const s = useStyles((c, d) => ({
    field: { gap: 8 },
    label: { color: c.textSecondary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    hint: { color: c.muted, fontSize: 12, textAlign: d.start },
  }));
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function TextField({ value, onChange, placeholder, keyboardType, multiline, autoCapitalize }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'email-address' | 'number-pad' | 'numbers-and-punctuation' | 'phone-pad';
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences';
}) {
  const { colors } = usePreferences();
  const s = useStyles((c, d) => ({
    input: { minHeight: 50, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, color: c.text, backgroundColor: c.background, fontSize: 15, textAlign: d.start },
    multi: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' as const },
  }));
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType={keyboardType}
      multiline={multiline}
      autoCapitalize={autoCapitalize}
      style={[s.input, multiline && s.multi]}
    />
  );
}

export type ChipOption<T extends string> = { value: T; label: string; icon?: IconName };

/** Single-select chips that wrap onto several lines. */
export function Chips<T extends string>({ options, value, onChange }: { options: ChipOption<T>[]; value: T | null; onChange: (value: T) => void }) {
  const { colors } = usePreferences();
  const s = useStyles((c, d) => ({
    chips: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    chip: { minHeight: 40, flexDirection: d.row, alignItems: 'center' as const, gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.background },
    chipActive: { borderColor: c.primary, backgroundColor: c.primarySoft },
    chipText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' as const },
    chipTextActive: { color: c.primary, fontWeight: '800' as const },
  }));
  return (
    <View style={s.chips}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable key={option.value} onPress={() => onChange(option.value)} style={[s.chip, selected && s.chipActive]} accessibilityRole="button" accessibilityState={{ selected }}>
            {option.icon ? <Ionicons name={option.icon} size={16} color={selected ? colors.primary : colors.muted} /> : null}
            <Text style={[s.chipText, selected && s.chipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Multi-select chips (tap to add or remove). */
export function MultiChips({ options, values, onChange }: { options: ChipOption<string>[]; values: string[]; onChange: (values: string[]) => void }) {
  const { colors } = usePreferences();
  const s = useStyles((c, d) => ({
    chips: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    chip: { minHeight: 40, flexDirection: d.row, alignItems: 'center' as const, gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.background },
    chipActive: { borderColor: c.primary, backgroundColor: c.primarySoft },
    chipText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' as const },
    chipTextActive: { color: c.primary, fontWeight: '800' as const },
  }));
  return (
    <View style={s.chips}>
      {options.map((option) => {
        const selected = values.includes(option.value);
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(selected ? values.filter((v) => v !== option.value) : [...values, option.value])}
            style={[s.chip, selected && s.chipActive]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
          >
            <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={16} color={selected ? colors.primary : colors.muted} />
            <Text style={[s.chipText, selected && s.chipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Inline month calendar (no native picker needed, works the same on iOS, Android and web). */
export function DatePicker({ value, onChange, min }: { value: string; onChange: (value: string) => void; min?: string }) {
  const { t, colors, rtl, locale, language } = usePreferences();
  const format = useFormat();
  const [view, setView] = useState(() => value.slice(0, 7));
  const today = toDateOnly(new Date());
  // Arabic calendars start the week on Saturday, English on Sunday.
  const weekStart = language === 'ar' ? 6 : 0;

  const cells = useMemo(() => {
    const [y, m] = view.split('-').map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    const lead = (first - weekStart + 7) % 7;
    return [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => `${view}-${String(i + 1).padStart(2, '0')}`)];
  }, [view, weekStart]);

  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, 7 + ((weekStart + i) % 7)))),
    [locale, weekStart],
  );

  const shift = (months: number) => {
    const [y, m] = view.split('-').map(Number);
    const next = new Date(y, m - 1 + months, 1);
    setView(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  const s = useStyles((c, d) => ({
    wrap: { borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 10, backgroundColor: c.background },
    head: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 6 },
    title: { color: c.text, fontSize: 15, fontWeight: '700' as const },
    arrow: { width: 36, height: 36, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.surfaceMuted },
    grid: { flexDirection: d.row, flexWrap: 'wrap' as const },
    cell: { width: '14.2857%' as const, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
    weekday: { color: c.muted, fontSize: 12, fontWeight: '700' as const },
    day: { width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const },
    dayText: { color: c.text, fontSize: 14, fontWeight: '600' as const },
    todayRing: { borderWidth: 1, borderColor: c.primary },
    selected: { backgroundColor: c.primary },
    selectedText: { color: c.primaryText, fontWeight: '800' as const },
    disabled: { opacity: 0.3 },
    shortcuts: { flexDirection: d.row, gap: 8, marginTop: 8 },
    shortcut: { paddingHorizontal: 12, minHeight: 32, borderRadius: 10, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
    shortcutText: { color: c.primary, fontSize: 13, fontWeight: '700' as const },
  }));

  const pick = (date: string) => {
    onChange(date);
    setView(date.slice(0, 7));
  };

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Pressable onPress={() => shift(-1)} style={s.arrow} accessibilityLabel={t('prevMonth')}>
          <Ionicons name={rtl ? 'chevron-forward' : 'chevron-back'} size={18} color={colors.primary} />
        </Pressable>
        <Text style={s.title}>{format.month(view)}</Text>
        <Pressable onPress={() => shift(1)} style={s.arrow} accessibilityLabel={t('nextMonth')}>
          <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.primary} />
        </Pressable>
      </View>
      <View style={s.grid}>
        {weekdays.map((name, i) => (
          <View key={`w${i}`} style={s.cell}><Text style={s.weekday}>{name}</Text></View>
        ))}
        {cells.map((date, i) => {
          if (!date) return <View key={`e${i}`} style={s.cell} />;
          const disabled = Boolean(min && date < min);
          const selected = date === value;
          return (
            <Pressable key={date} disabled={disabled} onPress={() => pick(date)} style={s.cell} accessibilityState={{ selected, disabled }} accessibilityLabel={format.date(date)}>
              <View style={[s.day, date === today && !selected && s.todayRing, selected && s.selected, disabled && s.disabled]}>
                <Text style={[s.dayText, selected && s.selectedText]}>{format.number(Number(date.slice(8)))}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={s.shortcuts}>
        <Pressable onPress={() => pick(today)} style={s.shortcut}><Text style={s.shortcutText}>{t('today')}</Text></Pressable>
        <Pressable onPress={() => pick(addDaysTo(today, 1))} style={s.shortcut}><Text style={s.shortcutText}>{t('tomorrow')}</Text></Pressable>
      </View>
    </View>
  );
}

const TIME_PRESETS = ['08:00', '10:00', '12:00', '17:00', '20:00'];

/** Quick time chips plus a free 24h "HH:MM" field. */
export function TimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = usePreferences();
  const format = useFormat();
  const label = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return format.time(new Date(2000, 0, 1, h, m));
  };
  const s = useStyles((c, d) => ({ error: { color: c.danger, fontSize: 12, textAlign: d.start } }));
  return (
    <View style={{ gap: 8 }}>
      <Chips options={TIME_PRESETS.map((time) => ({ value: time, label: label(time) }))} value={TIME_PRESETS.includes(value) ? value : null} onChange={onChange} />
      <TextField value={value} onChange={(next) => onChange(normalizeDigits(next))} placeholder="20:00" keyboardType="numbers-and-punctuation" autoCapitalize="none" />
      {!TIME_PATTERN.test(value) ? <Text style={s.error}>{t('invalidTime')}</Text> : null}
    </View>
  );
}

/** A labelled on/off row. */
export function ToggleRow({ label, value, onChange, disabled, hint }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean; hint?: string }) {
  const { colors } = usePreferences();
  const s = useStyles((c, d) => ({
    row: { minHeight: 52, flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    label: { flex: 1, color: c.text, fontSize: 15, fontWeight: '600' as const, textAlign: d.start },
    hint: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    track: { width: 52, height: 30, borderRadius: 15, padding: 3, justifyContent: 'center' as const },
    knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  }));
  // A drawn switch keeps the same look and RTL behaviour on every platform.
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      style={[s.row, disabled && { opacity: 0.5 }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      <View style={[s.track, { backgroundColor: value ? colors.primary : colors.border, alignItems: value ? 'flex-end' : 'flex-start' }]}>
        <View style={s.knob} />
      </View>
    </Pressable>
  );
}

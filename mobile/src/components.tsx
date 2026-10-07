import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './typography';
import type { Expense } from './api';
import { useFormat, usePreferences, useStyles } from './preferences';
import { cardShadow, type Tone } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// The API fills these English placeholders when no note is given; show the section name instead.
const PLACEHOLDER_DESCRIPTIONS = new Set(['Home lesson', 'Household expense']);

export function isHousehold(expense: Pick<Expense, 'category'>) {
  return expense.category.key === 'household';
}

export function expenseNote(expense: Expense) {
  return expense.description && !PLACEHOLDER_DESCRIPTIONS.has(expense.description) ? expense.description : null;
}

export function useExpenseTitle() {
  const format = useFormat();
  return (expense: Expense) => expenseNote(expense) || format.name(expense.subcategory ?? expense.category);
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const s = useStyles((c) => ({
    card: { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.hairline, ...cardShadow(c) },
    padded: { padding: 16 },
  }));
  return <View style={[s.card, padded && s.padded, style]}>{children}</View>;
}

export function GradientHero({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = usePreferences();
  return (
    <LinearGradient
      colors={[colors.heroFrom, colors.heroTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ borderRadius: 24, padding: 20, overflow: 'hidden' }, style]}
    >
      {/* soft decorative circles */}
      <View pointerEvents="none" style={{ position: 'absolute', width: 180, height: 180, borderRadius: 90, top: -60, right: -40, backgroundColor: 'rgba(255,255,255,0.10)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', width: 120, height: 120, borderRadius: 60, bottom: -50, left: -20, backgroundColor: 'rgba(255,255,255,0.08)' }} />
      {children}
    </LinearGradient>
  );
}

export function IconBubble({ name, color, background, size = 40 }: { name: IconName; color: string; background: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, alignItems: 'center', justifyContent: 'center', backgroundColor: background }}>
      <Ionicons name={name} size={size * 0.5} color={color} />
    </View>
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (amount: number) => void }) {
  const { t, colors, rtl } = usePreferences();
  const format = useFormat();
  const s = useStyles((c, d) => ({
    bar: { height: 48, flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 4 },
    title: { color: c.text, fontSize: 15, fontWeight: '700' as const },
    arrow: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center' as const, alignItems: 'center' as const, backgroundColor: c.surfaceMuted },
  }));
  // Start-side arrow goes back in time, end-side arrow forward (mirrors in Arabic).
  return (
    <View style={s.bar}>
      <Pressable onPress={() => onChange(-1)} style={s.arrow} accessibilityLabel={t('prevMonth')}>
        <Ionicons name={rtl ? 'chevron-forward' : 'chevron-back'} size={20} color={colors.primary} />
      </Pressable>
      <Text style={s.title}>{format.month(month)}</Text>
      <Pressable onPress={() => onChange(1)} style={s.arrow} accessibilityLabel={t('nextMonth')}>
        <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}

export function ExpenseRow({ expense, currency, onPress, last = false }: { expense: Expense; currency: string; onPress: () => void; last?: boolean }) {
  const { colors } = usePreferences();
  const format = useFormat();
  const title = useExpenseTitle();
  const household = isHousehold(expense);
  const s = useStyles((c, d) => ({
    row: { minHeight: 66, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 10 },
    divider: { borderBottomWidth: 1, borderBottomColor: c.hairline },
    info: { flex: 1, minWidth: 0 },
    title: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    meta: { color: c.muted, fontSize: 12, marginTop: 4, textAlign: d.start },
    amount: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
  }));
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, !last && s.divider, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <IconBubble
        name={household ? 'home' : 'school'}
        color={household ? colors.household : colors.lessons}
        background={household ? colors.householdSoft : colors.lessonsSoft}
      />
      <View style={s.info}>
        <Text style={s.title} numberOfLines={1}>{title(expense)}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {expense.attachmentCount ? '📎 ' : ''}
          {[expense.member?.name, expense.teacher?.name].filter(Boolean).map((part) => `${part} · `).join('')}
          {format.dateTime(expense.occurredAt, expense.date)}
        </Text>
      </View>
      <Text style={s.amount}>{format.money(expense.amount, currency)}</Text>
    </Pressable>
  );
}

export function EmptyState({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { colors } = usePreferences();
  const s = useStyles((c) => ({
    wrap: { alignItems: 'center' as const, paddingVertical: 28, paddingHorizontal: 16, gap: 8 },
    title: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: 'center' as const },
    body: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' as const },
  }));
  return (
    <View style={s.wrap}>
      <IconBubble name={icon} color={colors.primary} background={colors.primarySoft} size={60} />
      <Text style={s.title}>{title}</Text>
      <Text style={s.body}>{body}</Text>
    </View>
  );
}

export function ScreenHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const s = useStyles((c, d) => ({
    header: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, minHeight: 48 },
    copy: { flex: 1 },
    title: { color: c.text, fontSize: 26, fontWeight: '800' as const, textAlign: d.start },
    subtitle: { color: c.muted, fontSize: 13, marginTop: 4, textAlign: d.start },
  }));
  return (
    <View style={s.header}>
      <View style={s.copy}>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function SectionTitle({ title, action, count }: { title: string; action?: ReactNode; count?: number }) {
  const format = useFormat();
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 8, minHeight: 32 },
    title: { color: c.text, fontSize: 16, fontWeight: '700' as const, textAlign: d.start },
    count: { color: c.muted, fontSize: 12, fontWeight: '600' as const, backgroundColor: c.surfaceMuted, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' as const },
    spacer: { flex: 1 },
  }));
  return (
    <View style={s.row}>
      <Text style={s.title}>{title}</Text>
      {count !== undefined ? <Text style={s.count}>{format.number(count)}</Text> : null}
      <View style={s.spacer} />
      {action}
    </View>
  );
}

export function SmallButton({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const { colors } = usePreferences();
  const s = useStyles((c, d) => ({
    button: { flexDirection: d.row, alignItems: 'center' as const, gap: 4, paddingHorizontal: 12, minHeight: 34, borderRadius: 10, backgroundColor: c.primarySoft },
    text: { color: c.primary, fontSize: 13, fontWeight: '700' as const },
  }));
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.button, pressed && { opacity: 0.75 }]} accessibilityRole="button">
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({ label, icon, onPress, disabled = false, busy = false }: { label: string; icon?: IconName; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const { colors } = usePreferences();
  const s = useStyles((c, d) => ({
    button: { minHeight: 52, borderRadius: 14, overflow: 'hidden' as const },
    inner: { flex: 1, minHeight: 52, flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8 },
    text: { color: c.heroText, fontSize: 15, fontWeight: '700' as const },
  }));
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [s.button, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <LinearGradient colors={[colors.heroFrom, colors.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.inner}>
        {busy ? <ActivityIndicator color={colors.heroText} /> : (
          <>
            {icon ? <Ionicons name={icon} size={19} color={colors.heroText} /> : null}
            <Text style={s.text}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  const s = useStyles((c, d) => ({
    wrap: { flexDirection: d.row, gap: 4, padding: 4, borderRadius: 14, backgroundColor: c.surfaceMuted },
    item: { flex: 1, minHeight: 38, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 10, paddingHorizontal: 6 },
    active: { backgroundColor: c.surface, ...cardShadow(c) },
    text: { color: c.muted, fontSize: 13, fontWeight: '600' as const },
    textActive: { color: c.primary, fontWeight: '700' as const },
  }));
  return (
    <View style={s.wrap}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable key={option.value} onPress={() => onChange(option.value)} style={[s.item, selected && s.active]} accessibilityRole="button" accessibilityState={{ selected }}>
            <Text style={[s.text, selected && s.textActive]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pulsing placeholder blocks shown while data loads. */
export function Skeleton({ height = 16, width = '100%', radius = 10, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = usePreferences();
  const [opacity] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ height, width, borderRadius: radius, backgroundColor: colors.surfaceMuted, opacity }, style]} />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  const s = useStyles((_c, d) => ({ row: { flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 12 } }));
  return (
    <View>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={s.row}>
          <Skeleton width={40} height={40} radius={13} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={13} width="60%" />
            <Skeleton height={10} width="35%" />
          </View>
          <Skeleton height={14} width={70} />
        </View>
      ))}
    </View>
  );
}

/** Full-width destructive button that asks for a second tap (Alert dialogs don't show on web). */
export function ConfirmDeleteButton({ label, question, onConfirm }: { label: string; question: string; onConfirm: () => Promise<void> }) {
  const { t, colors } = usePreferences();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = useStyles((c, d) => ({
    button: { minHeight: 50, flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, borderRadius: 14, backgroundColor: c.dangerSoft },
    text: { color: c.danger, fontSize: 14, fontWeight: '700' as const },
    box: { gap: 12, padding: 16, borderRadius: 16, backgroundColor: c.dangerSoft },
    question: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start, lineHeight: 21 },
    actions: { flexDirection: d.row, gap: 10 },
    action: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const },
    cancel: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    cancelText: { color: c.text, fontSize: 13, fontWeight: '700' as const },
    danger: { backgroundColor: c.danger },
    dangerText: { color: c.surface, fontSize: 13, fontWeight: '700' as const },
  }));
  const run = () => {
    setBusy(true);
    onConfirm().catch(() => undefined).finally(() => { setBusy(false); setConfirming(false); });
  };
  if (!confirming) {
    return (
      <Pressable onPress={() => setConfirming(true)} style={({ pressed }) => [s.button, pressed && { opacity: 0.78 }]}>
        <Ionicons name="trash-outline" size={18} color={colors.danger} />
        <Text style={s.text}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <View style={s.box}>
      <Text style={s.question}>{question}</Text>
      <View style={s.actions}>
        <Pressable onPress={() => setConfirming(false)} style={[s.action, s.cancel]}>
          <Text style={s.cancelText}>{t('cancel')}</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={run} style={[s.action, s.danger, busy && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.surface} /> : <Text style={s.dangerText}>{t('delete')}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

/** Small trash icon for list rows: first tap arms it, second tap deletes. */
export function InlineDelete({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> }) {
  const { t, colors } = usePreferences();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = useStyles((c) => ({
    button: { minWidth: 34, height: 34, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const },
    armed: { backgroundColor: c.danger },
    text: { color: c.surface, fontSize: 11, fontWeight: '700' as const },
  }));
  if (busy) return <ActivityIndicator size="small" color={colors.danger} style={s.button} />;
  return (
    <Pressable
      accessibilityLabel={armed ? t('confirmDeleteNamed', { name: label }) : t('deleteNamed', { name: label })}
      onPress={() => {
        if (!armed) return setArmed(true);
        setBusy(true);
        onConfirm().catch(() => undefined).finally(() => { setBusy(false); setArmed(false); });
      }}
      onBlur={() => setArmed(false)}
      hitSlop={6}
      style={[s.button, armed && s.armed]}
    >
      {armed ? <Text style={s.text}>{t('confirmDelete')}</Text> : <Ionicons name="trash-outline" size={17} color={colors.muted} />}
    </Pressable>
  );
}

/** Softly tinted gradient card for colourful sections (services, quick actions, stats). */
export function ToneCard({ tone, children, style }: { tone: Tone; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = usePreferences();
  const t = colors.tones[tone];
  return (
    <LinearGradient
      colors={[t.from, t.to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ borderRadius: 18, padding: 16, overflow: 'hidden' }, style]}
    >
      <View pointerEvents="none" style={{ position: 'absolute', width: 90, height: 90, borderRadius: 45, top: -30, right: -24, backgroundColor: t.bubble, opacity: 0.35 }} />
      {children}
    </LinearGradient>
  );
}

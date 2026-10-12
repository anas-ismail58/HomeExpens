import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ApiError, type ChildTask, type PointEntry, type PointEntryKind } from './api';
import { Card, IconBubble, InlineDelete, type IconName } from './components';
import { TextField } from './formControls';
import type { StringKey } from './i18n';
import { useFormat, usePreferences, useStyles } from './preferences';
import { Text } from './typography';

/** "12/10" style day + month, for chart axes. */
export function useShortDate() {
  const { locale } = usePreferences();
  return (dateOnly: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateOnly}T00:00:00Z`));
}

/** Short weekday names in the app language, 0 = Sunday … 6 = Saturday. */
export function useWeekdayNames() {
  const { locale } = usePreferences();
  const names = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  // 2026-10-11 is a Sunday.
  return [0, 1, 2, 3, 4, 5, 6].map((d) => names.format(new Date(Date.UTC(2026, 9, 11 + d))));
}

/** "Every day" or "Sun, Mon, Tue". */
export function useWeekdaysLabel() {
  const { t } = usePreferences();
  const names = useWeekdayNames();
  return (days: number[]) => (days.length === 7 ? t('kEveryDay') : [...days].sort().map((d) => names[d]).join('، '));
}

/** Server error codes for the points system, in the user's language. */
export function useKidsError() {
  const { t } = usePreferences();
  return (err: unknown, fallback: StringKey = 'saveError') => {
    if (err instanceof ApiError) {
      if (err.code === 'INSUFFICIENT_POINTS') return t('kNotEnoughPoints');
      if (err.code === 'PENALTY_LIMIT') return t('kPenaltyLimit');
      if (err.code === 'INSUFFICIENT_BALANCE') return t('kNotEnoughMoney');
    }
    return err instanceof Error ? err.message : t(fallback);
  };
}

export function Stars({ value, size = 16, color }: { value: number | null; size?: number; color?: string }) {
  const { colors, t, dir } = usePreferences();
  const tint = color ?? '#f5a524';
  // Stars fill from the reading start: right-to-left in Arabic.
  return (
    <View style={{ flexDirection: dir.row, gap: 2 }} accessibilityLabel={value ? `${t('kRating')} ${value}/5` : t('kNoRating')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={value && n <= value ? 'star' : 'star-outline'} size={size} color={value && n <= value ? tint : color ?? colors.muted} />
      ))}
    </View>
  );
}

const ENTRY_LOOK: Record<PointEntryKind, IconName> = {
  AWARD: 'thumbs-up',
  TASK: 'checkmark-done',
  PENALTY: 'remove-circle',
  REWARD: 'gift',
  CONVERT: 'swap-horizontal',
  PAYOUT: 'cash',
  ALLOWANCE: 'wallet',
};

/** One ledger row: what happened, who did it, and the points / money change. */
export function PointEntryRow({ entry, currency, first, onVoid }: { entry: PointEntry; currency: string; first: boolean; onVoid?: () => Promise<void> }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const positive = entry.points > 0 || (entry.points === 0 && Number(entry.amount) > 0);
  const tone = entry.kind === 'PENALTY' ? colors.danger : positive ? colors.success : colors.primary;
  const soft = entry.kind === 'PENALTY' ? colors.dangerSoft : positive ? colors.successSoft : colors.primarySoft;
  const changes = [
    entry.points ? `${entry.points > 0 ? '+' : '−'}${format.number(Math.abs(entry.points))}` : null,
    Number(entry.amount) ? `${Number(entry.amount) > 0 ? '+' : '−'}${format.money(Math.abs(Number(entry.amount)), currency)}` : null,
    entry.kind === 'ALLOWANCE' && entry.cash ? format.money(entry.cash, currency) : null,
  ].filter(Boolean);
  const s = useStyles((c, d) => ({
    row: { minHeight: 60, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    title: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 12, marginTop: 2, textAlign: d.start },
    value: { color: c.text, fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const], textAlign: d.end },
  }));
  return (
    <View style={[s.row, !first && s.divider, entry.voided && { opacity: 0.5 }]}>
      <IconBubble name={ENTRY_LOOK[entry.kind]} color={tone} background={soft} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* A conversion's server reason is just the arithmetic; show its kind instead. */}
        <Text style={[s.title, entry.voided && { textDecorationLine: 'line-through' }]} numberOfLines={2}>{entry.kind === 'CONVERT' ? t('entry_CONVERT') : entry.reason}</Text>
        <Text style={s.sub} numberOfLines={1}>
          {[entry.kind === 'CONVERT' ? null : t(`entry_${entry.kind}` as StringKey), format.date(entry.date), entry.createdBy?.name, entry.voided ? t('kUndone') : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View>{changes.map((change) => <Text key={change} style={s.value}>{change}</Text>)}</View>
      {onVoid && entry.canVoid ? <InlineDelete label={entry.reason} onConfirm={onVoid} /> : null}
    </View>
  );
}

/**
 * Earned vs deducted points per period, as paired bars from a shared zero baseline.
 * Tapping a period shows its exact values (the touch version of a hover tooltip).
 */
export function PointsBars({ data, labelOf }: { data: { key: string; earned: number; lost: number }[]; labelOf: (key: string, index: number) => string }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.earned, d.lost]));
  const height = 110;
  const s = useStyles((c, d) => ({
    legend: { flexDirection: d.row, gap: 14, flexWrap: 'wrap' as const },
    legendItem: { flexDirection: d.row, alignItems: 'center' as const, gap: 6 },
    swatch: { width: 10, height: 10, borderRadius: 2 },
    legendText: { color: c.textSecondary, fontSize: 12 },
    plot: { flexDirection: d.row, alignItems: 'flex-end' as const, height, borderBottomWidth: 1, borderBottomColor: c.border },
    group: { flex: 1, height, flexDirection: 'row' as const, alignItems: 'flex-end' as const, justifyContent: 'center' as const, gap: 2 },
    bar: { width: 7, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    labels: { flexDirection: d.row, marginTop: 4 },
    label: { flex: 1, color: c.muted, fontSize: 10, textAlign: 'center' as const },
    readout: { color: c.text, fontSize: 13, fontWeight: '600' as const, textAlign: d.start, minHeight: 18 },
  }));
  const shown = selected ?? data.length - 1;
  const current = data[shown];
  return (
    <View style={{ gap: 10 }}>
      <View style={s.legend}>
        <View style={s.legendItem}><View style={[s.swatch, { backgroundColor: colors.success }]} /><Text style={s.legendText}>{t('kEarned')}</Text></View>
        <View style={s.legendItem}><View style={[s.swatch, { backgroundColor: colors.danger }]} /><Text style={s.legendText}>{t('kLost')}</Text></View>
      </View>
      {current ? (
        <Text style={s.readout}>
          {`${labelOf(current.key, shown)}: +${format.number(current.earned)} · −${format.number(current.lost)}`}
        </Text>
      ) : null}
      <View style={s.plot}>
        {data.map((d, index) => (
          <Pressable
            key={d.key}
            style={[s.group, index === shown && { backgroundColor: colors.surfaceMuted, borderTopLeftRadius: 6, borderTopRightRadius: 6 }]}
            onPress={() => setSelected(index)}
            accessibilityRole="button"
            accessibilityLabel={`${labelOf(d.key, index)}: ${t('kEarned')} ${d.earned}, ${t('kLost')} ${d.lost}`}
          >
            <View style={[s.bar, { height: Math.max(d.earned ? 3 : 0, (d.earned / max) * (height - 8)), backgroundColor: colors.success }]} />
            <View style={[s.bar, { height: Math.max(d.lost ? 3 : 0, (d.lost / max) * (height - 8)), backgroundColor: colors.danger }]} />
          </Pressable>
        ))}
      </View>
      <View style={s.labels}>
        {data.map((d, index) => (
          <Text key={d.key} style={s.label} numberOfLines={1}>
            {data.length <= 10 || index % 5 === 0 || index === data.length - 1 ? labelOf(d.key, index) : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

type TaskAction = 'complete' | 'approve' | 'return';

function TaskButton({ label, icon, color, onPress, busy }: { label: string; icon: IconName; color: string; onPress: () => void; busy?: boolean }) {
  const s = useStyles((_c, d) => ({
    button: { minHeight: 38, paddingHorizontal: 14, borderRadius: 12, flexDirection: d.row, alignItems: 'center' as const, gap: 6, borderWidth: 1 },
    text: { fontSize: 13, fontWeight: '700' as const },
  }));
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [s.button, { borderColor: color }, (pressed || busy) && { opacity: 0.6 }]} accessibilityRole="button">
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[s.text, { color }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A card of tasks with their status and the actions the viewer may take (mark done, approve, send back
 * with a note, edit, delete). Used on the child's board and the day view.
 */
export function TaskList({ tasks, empty, busyId, onAction, onEdit, onDelete }: {
  tasks: ChildTask[];
  empty: string;
  busyId: string | null;
  onAction: (task: ChildTask, action: TaskAction, note?: string) => Promise<void>;
  onEdit?: (task: ChildTask) => void;
  onDelete?: (task: ChildTask) => Promise<void>;
}) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [returning, setReturning] = useState<{ id: string; note: string } | null>(null);
  const s = useStyles((c, d) => ({
    task: { paddingVertical: 12, gap: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    top: { flexDirection: d.row, alignItems: 'flex-start' as const, gap: 10 },
    title: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 12, marginTop: 3, textAlign: d.start },
    note: { color: c.textSecondary, fontSize: 12, marginTop: 4, textAlign: d.start },
    badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    badgeText: { fontSize: 11, fontWeight: '800' as const },
    points: { color: c.text, fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    buttons: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    hint: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 14 },
  }));
  const look = (task: ChildTask) =>
    task.status === 'APPROVED'
      ? { fg: colors.success, bg: colors.successSoft, label: t('task_APPROVED') }
      : task.status === 'COMPLETED'
        ? { fg: colors.tones.amber.fg, bg: colors.tones.amber.to, label: t('task_COMPLETED') }
        : task.status === 'MISSED'
          ? { fg: colors.muted, bg: colors.surfaceMuted, label: t('task_MISSED') }
          : task.overdue
            ? { fg: colors.danger, bg: colors.dangerSoft, label: t('taskOverdue') }
            : { fg: colors.primary, bg: colors.primarySoft, label: t('task_PENDING') };

  return (
    <Card padded={false} style={{ paddingHorizontal: 14 }}>
      {tasks.length ? tasks.map((task, index) => {
        const status = look(task);
        const busy = busyId === task.id;
        const meta = [
          task.daily ? '🔁' : null,
          !task.daily && task.dueDate ? t('kDueOn', { date: format.date(task.dueDate) }) : null,
          task.createdBy?.name,
        ].filter(Boolean).join(' · ');
        return (
          <View key={task.id} style={[s.task, index > 0 && s.divider]}>
            <View style={s.top}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.title, task.status === 'MISSED' && { color: colors.muted }]}>{task.title}</Text>
                {meta ? <Text style={s.sub}>{meta}</Text> : null}
                {task.description ? <Text style={s.note}>{task.description}</Text> : null}
                {task.reviewNote && task.status === 'PENDING' ? <Text style={[s.note, { color: colors.danger }]}>{t('kNote', { note: task.reviewNote })}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={s.points}>+{format.number(task.points)}</Text>
                <View style={[s.badge, { backgroundColor: status.bg }]}><Text style={[s.badgeText, { color: status.fg }]}>{status.label}</Text></View>
              </View>
            </View>
            {returning?.id === task.id ? (
              <View style={{ gap: 8 }}>
                <TextField value={returning.note} onChange={(note) => setReturning({ id: task.id, note })} placeholder={t('kReturnNote')} />
                <View style={s.buttons}>
                  <TaskButton label={t('sendBack')} icon="arrow-undo" color={colors.danger} busy={busy} onPress={() => void onAction(task, 'return', returning.note.trim() || undefined).then(() => setReturning(null))} />
                  <TaskButton label={t('cancel')} icon="close" color={colors.muted} onPress={() => setReturning(null)} />
                </View>
              </View>
            ) : task.canComplete || task.canApprove || task.canReturn || (task.canEdit && onEdit) ? (
              <View style={s.buttons}>
                {task.canComplete && !task.canApprove ? <TaskButton label={t('markDone')} icon="checkmark" color={colors.primary} busy={busy} onPress={() => void onAction(task, 'complete')} /> : null}
                {task.canApprove ? <TaskButton label={t('kApprove')} icon="checkmark-done" color={colors.success} busy={busy} onPress={() => void onAction(task, 'approve')} /> : null}
                {task.canReturn ? <TaskButton label={t('sendBack')} icon="arrow-undo" color={colors.danger} onPress={() => setReturning({ id: task.id, note: '' })} /> : null}
                {task.canEdit && onEdit ? <TaskButton label={t('kEdit')} icon="create-outline" color={colors.textSecondary} onPress={() => onEdit(task)} /> : null}
                {task.canEdit && onDelete ? <InlineDelete label={task.title} onConfirm={() => onDelete(task)} /> : null}
              </View>
            ) : null}
          </View>
        );
      }) : <Text style={s.hint}>{empty}</Text>}
    </Card>
  );
}


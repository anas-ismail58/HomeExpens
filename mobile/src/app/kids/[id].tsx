import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { deleteKidTask, getKidBoard, kidTaskAction, stopDailyTask, voidPointEntry, type ChildTask, type KidBoard } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, GradientHero, IconBubble, InlineDelete, ListSkeleton, SectionTitle, Skeleton, type IconName } from '../../components';
import type { StringKey } from '../../i18n';
import { PointEntryRow, PointsBars, Stars, TaskList, useKidsError, useShortDate, useWeekdaysLabel } from '../../kids';
import { CountUp, FadeInView, GrowBar, PressableScale } from '../../motion';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

type Mode = 'award' | 'penalty' | 'task' | 'daily' | 'reward' | 'convert' | 'payout' | 'allowance';

const ACHIEVEMENT_ICONS: Record<string, IconName> = {
  first_task: 'checkmark-circle',
  tasks_10: 'ribbon',
  points_100: 'star',
  points_500: 'trophy',
  clean_week: 'shield-checkmark',
  first_reward: 'gift',
};

export default function KidPage() {
  return (
    <WithBottomBar>
      <KidScreen />
    </WithBottomBar>
  );
}

function KidScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  /** "+12" / "−3", but a plain "0" for nothing. */
  const signed = (sign: string, value: number) => (value ? `${sign}${format.number(Math.abs(value))}` : format.number(0));
  const kidsError = useKidsError();
  const shortDate = useShortDate();
  const weekdaysLabel = useWeekdaysLabel();
  const [board, setBoard] = useState<KidBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyTask, setBusyTask] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBoard(await call((s, r) => getKidBoard(s, id, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, id, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const act = async (action: () => Promise<KidBoard>, taskId?: string) => {
    setBusyTask(taskId ?? null);
    setError('');
    try {
      setBoard(await action());
    } catch (err) {
      setError(kidsError(err));
    } finally {
      setBusyTask(null);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18 },
    heroTop: { flexDirection: d.row, alignItems: 'center' as const, gap: 14 },
    avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(255,255,255,0.22)' },
    avatarText: { color: c.heroText, fontSize: 24, fontWeight: '800' as const },
    name: { color: c.heroText, fontSize: 21, fontWeight: '800' as const, textAlign: d.start },
    heroLabel: { color: c.heroMuted, fontSize: 13, marginTop: 16, textAlign: d.start },
    heroPoints: { color: c.heroText, fontSize: 38, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    heroSub: { color: c.heroMuted, fontSize: 12, textAlign: d.start },
    levelRow: { flexDirection: d.row, justifyContent: 'space-between' as const, marginTop: 14, marginBottom: 6 },
    levelText: { color: c.heroText, fontSize: 13, fontWeight: '700' as const },
    split: { flexDirection: d.row, gap: 10, marginTop: 14 },
    chip: { flex: 1, minWidth: 0, borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.16)' },
    chipLabel: { color: c.heroMuted, fontSize: 12, textAlign: d.start },
    chipValue: { color: c.heroText, fontSize: 15, fontWeight: '700' as const, marginTop: 4, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    actions: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    action: { flexGrow: 1, flexBasis: '30%' as const, minHeight: 72, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, padding: 8 },
    actionText: { color: c.text, fontSize: 12, fontWeight: '700' as const, textAlign: 'center' as const },
    links: { flexDirection: d.row, gap: 8 },
    link: { flex: 1, minHeight: 46, borderRadius: 14, flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, backgroundColor: c.primarySoft },
    linkText: { color: c.primary, fontSize: 14, fontWeight: '700' as const },
    task: { paddingVertical: 12, gap: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    taskTop: { flexDirection: d.row, alignItems: 'flex-start' as const, gap: 10 },
    taskTitle: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    taskSub: { color: c.muted, fontSize: 12, marginTop: 3, textAlign: d.start },
    taskNote: { color: c.textSecondary, fontSize: 12, marginTop: 4, textAlign: d.start },
    badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    badgeText: { fontSize: 11, fontWeight: '800' as const },
    taskPoints: { color: c.text, fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    taskButtons: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    taskButton: { minHeight: 38, paddingHorizontal: 14, borderRadius: 12, flexDirection: d.row, alignItems: 'center' as const, gap: 6, borderWidth: 1, borderColor: c.border },
    taskButtonText: { fontSize: 13, fontWeight: '700' as const },
    badges: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    ach: { flexGrow: 1, flexBasis: '30%' as const, alignItems: 'center' as const, gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
    achText: { fontSize: 11, fontWeight: '700' as const, textAlign: 'center' as const },
    hint: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 14 },
    todayHead: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    todayTitle: { color: c.text, fontSize: 16, fontWeight: '800' as const, textAlign: d.start },
    dayLink: { flexDirection: d.row, alignItems: 'center' as const, gap: 4, paddingVertical: 4 },
    dayLinkText: { color: c.primary, fontSize: 13, fontWeight: '700' as const },
    todayRow: { flexDirection: d.row, gap: 8 },
    todayStat: { flex: 1, alignItems: 'center' as const, paddingVertical: 10, borderRadius: 14, backgroundColor: c.surfaceMuted },
    todayValue: { color: c.text, fontSize: 20, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    todayLabel: { color: c.muted, fontSize: 12, textAlign: d.start },
    dailyRow: { minHeight: 60, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (loading) {
    return (
      <View style={[s.screen, s.page]}>
        <Skeleton height={220} radius={24} />
        <Card><ListSkeleton rows={3} /></Card>
      </View>
    );
  }
  if (!board) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="alert-circle-outline" title={t('childNotFound')} body={error || t('loadError')} />
      </View>
    );
  }

  const { child, currency, can } = board;
  const open = (mode: Mode, extra: Record<string, string> = {}) => router.push({ pathname: '/kids/act', params: { childId: child.id, mode, ...extra } });
  const actions: { mode: Mode; label: StringKey; icon: IconName; color: string; show: boolean }[] = [
    { mode: 'award', label: 'givePoints', icon: 'thumbs-up', color: colors.success, show: can.award },
    { mode: 'task', label: 'kNewTask', icon: 'add-circle', color: colors.primary, show: can.manageTasks },
    { mode: 'daily', label: 'kNewDaily', icon: 'repeat', color: colors.primary, show: can.manageTasks },
    { mode: 'penalty', label: 'kPenalty', icon: 'remove-circle', color: colors.danger, show: can.penalize },
    { mode: 'reward', label: 'kReward', icon: 'gift', color: colors.tones.violet.icon, show: can.award },
    { mode: 'convert', label: 'convertPoints', icon: 'swap-horizontal', color: colors.tones.amber.icon, show: can.manageMoney },
    { mode: 'payout', label: 'payReward', icon: 'cash', color: colors.tones.teal.icon, show: can.manageMoney },
    { mode: 'allowance', label: 'giveAllowance', icon: 'wallet', color: colors.tones.indigo.icon, show: can.manageMoney },
  ];
  const dailyCopies = board.tasks.filter((task) => task.daily);
  const regular = board.tasks.filter((task) => !task.daily);
  const taskAction = (task: ChildTask, action: 'complete' | 'approve' | 'return', note?: string) =>
    act(() => call((sess, r) => kidTaskAction(sess, task.id, action, note, r)), task.id);
  const today = board.today;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Stack.Screen options={{ title: child.name }} />

      <GradientHero>
        <View style={s.heroTop}>
          <View style={s.avatar}><Text style={s.avatarText}>{child.name.trim().charAt(0)}</Text></View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.name}>{child.name}</Text>
            <Stars value={board.stars} color={board.stars ? undefined : 'rgba(255,255,255,0.6)'} />
          </View>
        </View>
        <Text style={s.heroLabel}>{t('kPoints')}</Text>
        <CountUp value={board.points}>
          {(shown) => <Text style={s.heroPoints} numberOfLines={1}>{format.number(Math.round(shown))}</Text>}
        </CountUp>
        <Text style={s.heroSub}>{t('pointsWorth', { amount: format.money(board.moneyValueOfPoints, currency) })}</Text>
        <View style={s.levelRow}>
          <Text style={s.levelText}>{t('levelN', { level: format.number(board.level) })}</Text>
          <Text style={[s.heroSub, { textAlign: undefined }]}>{t('toNextLevel', { count: format.number(board.size - board.progress) })}</Text>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
          <GrowBar share={board.progress / board.size} color="#ffffff" height={8} radius={4} />
        </View>
        <View style={s.split}>
          <View style={s.chip}>
            <Text style={s.chipLabel}>{t('rewardMoney')}</Text>
            <Text style={s.chipValue} numberOfLines={1}>{format.money(board.money, currency)}</Text>
          </View>
          <View style={s.chip}>
            <Text style={s.chipLabel}>{t('rTasksApproved')}</Text>
            <Text style={s.chipValue} numberOfLines={1}>{format.number(board.approvedTasks)}</Text>
          </View>
        </View>
      </GradientHero>

      {error ? <Text style={s.error}>{error}</Text> : null}

      {actions.some((a) => a.show) ? (
        <FadeInView index={1} style={s.actions}>
          {actions.filter((a) => a.show).map((a) => (
            <PressableScale key={a.mode} style={s.action} onPress={() => open(a.mode)} accessibilityRole="button">
              <Ionicons name={a.icon} size={24} color={a.color} />
              <Text style={s.actionText}>{t(a.label)}</Text>
            </PressableScale>
          ))}
        </FadeInView>
      ) : null}

      <View style={s.links}>
        <Pressable style={({ pressed }) => [s.link, pressed && { opacity: 0.8 }]} onPress={() => router.push({ pathname: '/kids/report', params: { childId: child.id } })} accessibilityRole="button">
          <Ionicons name="bar-chart" size={18} color={colors.primary} />
          <Text style={s.linkText}>{t('kReports')}</Text>
        </Pressable>
        {can.configure ? (
          <Pressable style={({ pressed }) => [s.link, pressed && { opacity: 0.8 }]} onPress={() => router.push({ pathname: '/kids/audit', params: { childId: child.id } })} accessibilityRole="button">
            <Ionicons name="document-text" size={18} color={colors.primary} />
            <Text style={s.linkText}>{t('kAudit')}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Today: points earned and lost today, and how many daily tasks are done. */}
      <Card style={{ gap: 12 }}>
        <View style={s.todayHead}>
          <Text style={s.todayTitle}>{t('kTodayPoints')}</Text>
          <Pressable onPress={() => router.push({ pathname: '/kids/day', params: { childId: child.id } })} style={({ pressed }) => [s.dayLink, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Ionicons name="calendar-outline" size={16} color={colors.primary} />
            <Text style={s.dayLinkText}>{t('kDayByDay')}</Text>
          </Pressable>
        </View>
        <View style={s.todayRow}>
          <View style={s.todayStat}><Text style={[s.todayValue, { color: colors.success }]}>{signed('+', today.earned)}</Text><Text style={s.todayLabel}>{t('kDayEarned')}</Text></View>
          <View style={s.todayStat}><Text style={[s.todayValue, { color: colors.danger }]}>{signed('−', today.lost)}</Text><Text style={s.todayLabel}>{t('kDayLost')}</Text></View>
          <View style={s.todayStat}><Text style={s.todayValue}>{signed(today.net > 0 ? '+' : '−', today.net)}</Text><Text style={s.todayLabel}>{t('kDayNet')}</Text></View>
        </View>
        {today.dailyTotal ? (
          <View style={{ gap: 6 }}>
            <Text style={s.todayLabel}>{t('kDailyProgress', { done: format.number(today.dailyDone), total: format.number(today.dailyTotal) })}</Text>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
              <GrowBar share={today.dailyDone / today.dailyTotal} color={colors.success} height={8} radius={4} />
            </View>
          </View>
        ) : null}
      </Card>

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('kTodayTasks')} count={dailyCopies.filter((task) => task.status === 'PENDING').length} />
        <TaskList tasks={dailyCopies} empty={t('kNoTodayTasks')} busyId={busyTask} onAction={taskAction} onDelete={(task) => act(() => call((sess, r) => deleteKidTask(sess, task.id, r)), task.id)} />
      </View>

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('kTasks')} count={regular.filter((task) => task.status !== 'APPROVED').length} />
        <TaskList
          tasks={regular}
          empty={t('kNoTasks')}
          busyId={busyTask}
          onAction={taskAction}
          onEdit={(task) => open('task', { taskId: task.id })}
          onDelete={(task) => act(() => call((sess, r) => deleteKidTask(sess, task.id, r)), task.id)}
        />
      </View>

      {can.manageTasks ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('kDailyTasks')} count={board.dailyTasks.length} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {board.dailyTasks.length ? board.dailyTasks.map((daily, index) => (
              <View key={daily.id} style={[s.dailyRow, index > 0 && s.divider]}>
                <IconBubble name="repeat" color={colors.primary} background={colors.primarySoft} size={36} />
                <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => open('daily', { dailyId: daily.id })} accessibilityRole="button" accessibilityHint={t('kEdit')}>
                  <Text style={s.taskTitle} numberOfLines={1}>{daily.title}</Text>
                  <Text style={s.taskSub}>{[t('kPointsEachDay', { count: format.number(daily.points) }), weekdaysLabel(daily.weekdays)].join(' · ')}</Text>
                </Pressable>
                <InlineDelete label={daily.title} onConfirm={() => act(() => call((sess, r) => stopDailyTask(sess, daily.id, r)))} />
              </View>
            )) : <Text style={s.hint}>{t('kNoDaily')}</Text>}
          </Card>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('kAchievements')} count={board.achievements.filter((a) => a.earned).length} />
        <View style={s.badges}>
          {board.achievements.map((a) => (
            <View key={a.key} style={[s.ach, { borderColor: a.earned ? colors.tones.amber.icon : colors.border, backgroundColor: a.earned ? colors.tones.amber.to : colors.surface }]}>
              <Ionicons name={ACHIEVEMENT_ICONS[a.key] ?? 'medal'} size={22} color={a.earned ? colors.tones.amber.icon : colors.muted} />
              <Text style={[s.achText, { color: a.earned ? colors.tones.amber.fg : colors.muted }]}>{t(`ach_${a.key}` as StringKey)}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('kProgress')} />
        <Card>
          <PointsBars
            data={board.weeks.map((w) => ({ key: w.start, earned: w.earned, lost: w.lost }))}
            labelOf={(key) => shortDate(key)}
          />
        </Card>
      </View>

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('kHistory')} count={board.entries.filter((e) => !e.voided).length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {board.entries.length ? board.entries.map((entry, index) => (
            <PointEntryRow
              key={entry.id}
              entry={entry}
              currency={currency}
              first={index === 0}
              onVoid={() => act(() => call((sess, r) => voidPointEntry(sess, entry.id, undefined, r)))}
            />
          )) : <Text style={s.hint}>{t('kNoEntries')}</Text>}
        </Card>
      </View>
    </ScrollView>
  );
}

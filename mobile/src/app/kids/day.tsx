import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { deleteKidTask, getKidDay, kidTaskAction, voidPointEntry, type ChildTask, type KidDay } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, ListSkeleton, SectionTitle } from '../../components';
import { addDaysTo, toDateOnly } from '../../formControls';
import { PointEntryRow, TaskList, useKidsError } from '../../kids';
import { GrowBar } from '../../motion';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

export default function KidDayPage() {
  return (
    <WithBottomBar>
      <KidDayScreen />
    </WithBottomBar>
  );
}

/** One day for a child: points earned and lost, that day's daily tasks, tasks due, and what was recorded. */
function KidDayScreen() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const { call } = useAuthedSession();
  const { t, colors, rtl } = usePreferences();
  const format = useFormat();
  /** "+12" / "−3", but a plain "0" for nothing. */
  const signed = (sign: string, value: number) => (value ? `${sign}${format.number(Math.abs(value))}` : format.number(0));
  const kidsError = useKidsError();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [day, setDay] = useState<KidDay | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setDay(await call((s, r) => getKidDay(s, childId, date, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, childId, date, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const act = async (action: () => Promise<unknown>, taskId?: string) => {
    setBusyTask(taskId ?? null);
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(kidsError(err));
    } finally {
      setBusyTask(null);
    }
  };
  const taskAction = (task: ChildTask, action: 'complete' | 'approve' | 'return', note?: string) =>
    act(() => call((sess, r) => kidTaskAction(sess, task.id, action, note, r)), task.id);

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    switcher: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    arrow: { width: 44, height: 44, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    dayTitle: { flex: 1, color: c.text, fontSize: 16, fontWeight: '800' as const, textAlign: 'center' as const },
    daySub: { color: c.muted, fontSize: 12, textAlign: 'center' as const },
    row: { flexDirection: d.row, gap: 8 },
    stat: { flex: 1, alignItems: 'center' as const, paddingVertical: 12, borderRadius: 14, backgroundColor: c.surfaceMuted },
    value: { color: c.text, fontSize: 22, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    label: { color: c.muted, fontSize: 12, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  const today = toDateOnly(new Date());
  const shown = day?.date ?? date ?? today;
  const isToday = day ? day.isToday : shown === today;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Stack.Screen options={{ title: day ? `${t('kDayByDay')} · ${day.child.name}` : t('kDayByDay') }} />

      <View style={s.switcher}>
        <Pressable style={s.arrow} onPress={() => setDate(addDaysTo(shown, -1))} accessibilityLabel={t('kPrevDay')}>
          <Ionicons name={rtl ? 'chevron-forward' : 'chevron-back'} size={20} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.dayTitle}>{isToday ? t('kToday') : format.date(shown)}</Text>
          {isToday ? <Text style={s.daySub}>{format.date(shown)}</Text> : null}
        </View>
        <Pressable style={[s.arrow, isToday && { opacity: 0.35 }]} disabled={isToday} onPress={() => setDate(addDaysTo(shown, 1))} accessibilityLabel={t('kNextDay')}>
          <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.primary} />
        </Pressable>
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}
      {!day ? <Card><ListSkeleton rows={4} /></Card> : (
        <>
          <Card style={{ gap: 12 }}>
            <View style={s.row}>
              <View style={s.stat}><Text style={[s.value, { color: colors.success }]}>{signed('+', day.earned)}</Text><Text style={s.label}>{t('kDayEarned')}</Text></View>
              <View style={s.stat}><Text style={[s.value, { color: colors.danger }]}>{signed('−', day.lost)}</Text><Text style={s.label}>{t('kDayLost')}</Text></View>
              <View style={s.stat}><Text style={s.value}>{signed(day.net > 0 ? '+' : '−', day.net)}</Text><Text style={s.label}>{t('kDayNet')}</Text></View>
            </View>
            {day.dailyTotal ? (
              <View style={{ gap: 6 }}>
                <Text style={s.label}>{t('kDailyProgress', { done: format.number(day.dailyDone), total: format.number(day.dailyTotal) })}</Text>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
                  <GrowBar share={day.dailyDone / day.dailyTotal} color={colors.success} height={8} radius={4} />
                </View>
              </View>
            ) : null}
          </Card>

          <View style={{ gap: 10 }}>
            <SectionTitle title={t('kDailyTasks')} count={day.dailyTasks.length} />
            <TaskList tasks={day.dailyTasks} empty={t('kNoTodayTasks')} busyId={busyTask} onAction={taskAction} onDelete={(task) => act(() => call((sess, r) => deleteKidTask(sess, task.id, r)), task.id)} />
          </View>

          {day.otherTasks.length ? (
            <View style={{ gap: 10 }}>
              <SectionTitle title={t('kOtherTasks')} count={day.otherTasks.length} />
              <TaskList tasks={day.otherTasks} empty="" busyId={busyTask} onAction={taskAction} onDelete={(task) => act(() => call((sess, r) => deleteKidTask(sess, task.id, r)), task.id)} />
            </View>
          ) : null}

          <View style={{ gap: 10 }}>
            <SectionTitle title={t('kHistory')} count={day.entries.filter((e) => !e.voided).length} />
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {day.entries.length
                ? day.entries.map((entry, index) => (
                    <PointEntryRow key={entry.id} entry={entry} currency={day.currency} first={index === 0} onVoid={() => act(() => call((sess, r) => voidPointEntry(sess, entry.id, undefined, r)))} />
                  ))
                : <EmptyState icon="calendar-outline" title={t('kHistory')} body={t('kNothingThisDay')} />}
            </Card>
          </View>
        </>
      )}
    </ScrollView>
  );
}

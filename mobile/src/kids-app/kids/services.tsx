import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getKids, type KidSummary } from '../../api';
import { Card, EmptyState, GradientHero, ListSkeleton, type IconName } from '../../components';
import type { StringKey } from '../../i18n';
import { kidTone, WithKidsBar } from '../../kidsShell';
import { FadeInView, PressableScale } from '../../motion';
import { usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import type { Tone } from '../../theme';
import { Text } from '../../typography';

type Mode = 'award' | 'penalty' | 'task' | 'daily' | 'reward' | 'convert' | 'payout' | 'allowance';
type Service = { key: string; label: StringKey; icon: IconName; tone: Tone; show: boolean; perChild: boolean; go: (childId: string) => Href };

export default function ServicesPage() {
  return (
    <WithKidsBar>
      <ServicesScreen />
    </WithKidsBar>
  );
}

/** Every points service in one place: pick the child once, then any action, report or setting. */
function ServicesScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const can = useCan();
  const [kids, setKids] = useState<KidSummary[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setKids(await call(getKids));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 32, gap: 18 },
    heroTitle: { color: c.heroText, fontSize: 24, fontWeight: '800' as const, textAlign: d.start },
    heroSub: { color: c.heroMuted, fontSize: 14, textAlign: d.start, marginTop: 2 },
    label: { color: c.textSecondary, fontSize: 15, fontWeight: '800' as const, textAlign: d.start, marginBottom: 10 },
    kids: { flexDirection: d.row, gap: 10, paddingVertical: 2 },
    kid: { alignItems: 'center' as const, gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 20, borderWidth: 2, minWidth: 86 },
    avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center' as const, justifyContent: 'center' as const },
    avatarText: { fontSize: 20, fontWeight: '800' as const },
    kidName: { color: c.text, fontSize: 14, fontWeight: '700' as const },
    grid: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 10 },
    tile: { flexBasis: '30%' as const, flexGrow: 1, minHeight: 104, borderRadius: 22, padding: 12, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8 },
    tileIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const },
    tileText: { fontSize: 13, fontWeight: '700' as const, textAlign: 'center' as const },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  const child = session.user.role === 'CHILD';
  const list = kids ?? [];
  const childId = child ? session.user.memberId ?? '' : picked && list.some((k) => k.id === picked) ? picked : list[0]?.id ?? '';
  const isAdmin = session.user.isAdmin;
  const act = (mode: Mode) => (id: string): Href => ({ pathname: '/kids/act', params: { childId: id, mode } });

  const groups: { title: StringKey; items: Service[] }[] = [
    {
      title: 'kGroupPoints',
      items: [
        { key: 'award', label: 'givePoints', icon: 'thumbs-up', tone: 'teal', show: can('EVALUATE_CHILDREN'), perChild: true, go: act('award') },
        { key: 'penalty', label: 'kPenalty', icon: 'remove-circle', tone: 'rose', show: can('PENALIZE_CHILDREN'), perChild: true, go: act('penalty') },
        { key: 'reward', label: 'kReward', icon: 'gift', tone: 'violet', show: can('EVALUATE_CHILDREN'), perChild: true, go: act('reward') },
      ],
    },
    {
      title: 'kGroupTasks',
      items: [
        { key: 'task', label: 'kNewTask', icon: 'add-circle', tone: 'amber', show: can('MANAGE_CHILD_TASKS'), perChild: true, go: act('task') },
        { key: 'daily', label: 'kNewDaily', icon: 'repeat', tone: 'indigo', show: can('MANAGE_CHILD_TASKS'), perChild: true, go: act('daily') },
        { key: 'board', label: 'kTasksBoard', icon: 'checkbox', tone: 'teal', show: true, perChild: true, go: (id) => `/kids/${id}` },
      ],
    },
    {
      title: 'kGroupMoney',
      items: [
        { key: 'convert', label: 'convertPoints', icon: 'swap-horizontal', tone: 'amber', show: isAdmin, perChild: true, go: act('convert') },
        { key: 'payout', label: 'payReward', icon: 'cash', tone: 'teal', show: isAdmin, perChild: true, go: act('payout') },
        { key: 'allowance', label: 'giveAllowance', icon: 'wallet', tone: 'indigo', show: isAdmin, perChild: true, go: act('allowance') },
      ],
    },
    {
      title: 'kGroupFollow',
      items: [
        { key: 'report', label: 'kReports', icon: 'bar-chart', tone: 'violet', show: true, perChild: true, go: (id) => ({ pathname: '/kids/report', params: { childId: id } }) },
        { key: 'day', label: 'kDayByDay', icon: 'calendar', tone: 'amber', show: true, perChild: true, go: (id) => ({ pathname: '/kids/day', params: { childId: id } }) },
        { key: 'audit', label: 'kAudit', icon: 'document-text', tone: 'indigo', show: isAdmin, perChild: false, go: () => '/kids/audit' },
      ],
    },
    {
      title: 'kGroupAdmin',
      items: [
        { key: 'settings', label: 'kSettings', icon: 'options', tone: 'violet', show: isAdmin, perChild: false, go: () => '/kids/settings' },
        { key: 'permissions', label: 'kPermissions', icon: 'key', tone: 'teal', show: isAdmin, perChild: false, go: () => '/kids/permissions' },
        { key: 'child', label: 'svcChild', icon: 'person-add', tone: 'rose', show: can('MANAGE_CHILDREN'), perChild: false, go: () => '/kids/new-child' },
      ],
    },
  ];

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={s.screen}
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
      >
        <GradientHero>
          <Text style={s.heroTitle}>{t('kServicesTitle')}</Text>
          <Text style={s.heroSub}>{t('kServicesHint')}</Text>
        </GradientHero>
        {error ? <Text style={s.error}>{error}</Text> : null}

        {!child ? (
          <View>
            <Text style={s.label}>{t('kForChild')}</Text>
            {kids === null ? <Card><ListSkeleton rows={1} /></Card> : list.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.kids}>
                {list.map((kid, index) => {
                  const tone = colors.tones[kidTone(index)];
                  const active = kid.id === childId;
                  return (
                    <PressableScale key={kid.id} onPress={() => setPicked(kid.id)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                      <View style={[s.kid, { borderColor: active ? tone.icon : 'transparent', backgroundColor: active ? tone.from : colors.surface }]}>
                        <View style={[s.avatar, { backgroundColor: tone.to }]}><Text style={[s.avatarText, { color: tone.fg }]}>{kid.name.trim().charAt(0)}</Text></View>
                        <Text style={s.kidName} numberOfLines={1}>{kid.name}</Text>
                      </View>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            ) : <EmptyState icon="happy-outline" title={t('kidsPoints')} body={t('kAddChildFirst')} />}
          </View>
        ) : null}

        {groups.map((group, groupIndex) => {
          const items = group.items.filter((item) => item.show);
          if (!items.length) return null;
          return (
            <FadeInView key={group.title} index={groupIndex}>
              <Text style={s.label}>{t(group.title)}</Text>
              <View style={s.grid}>
                {items.map((item) => {
                  const tone = colors.tones[item.tone];
                  const disabled = item.perChild && !childId;
                  return (
                    <Pressable
                      key={item.key}
                      disabled={disabled}
                      onPress={() => router.push(item.go(childId))}
                      style={({ pressed }) => [s.tile, { backgroundColor: tone.from }, disabled && { opacity: 0.45 }, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
                      accessibilityRole="button"
                    >
                      <View style={[s.tileIcon, { backgroundColor: tone.bubble }]}><Ionicons name={item.icon} size={24} color={tone.icon} /></View>
                      <Text style={[s.tileText, { color: tone.fg }]} numberOfLines={2}>{t(item.label)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </FadeInView>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

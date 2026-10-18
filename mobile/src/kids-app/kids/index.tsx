import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getKids, type KidSummary } from '../../api';
import { Card, EmptyState, ListSkeleton, type IconName } from '../../components';
import type { StringKey } from '../../i18n';
import { Stars } from '../../kids';
import { SkyHero } from '../../kidsDecor';
import { kidTone, WithKidsBar } from '../../kidsShell';
import { CountUp, FadeInView, PressableScale } from '../../motion';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import type { Tone } from '../../theme';
import { Text } from '../../typography';

export default function KidsPage() {
  return (
    <WithKidsBar>
      <KidsScreen />
    </WithKidsBar>
  );
}

/** Home of the kids' points app: a greeting, the family's totals, quick actions and a colorful card per child. */
function KidsScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors, rtl, locale } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const [kids, setKids] = useState<KidSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setKids(await call(getKids));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32, gap: 18 },
    top: { flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    me: { width: 48, height: 48, borderRadius: 24, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
    meText: { color: c.primary, fontSize: 22, fontWeight: '800' as const },
    hello: { color: c.text, fontSize: 21, fontWeight: '800' as const, textAlign: d.start },
    date: { color: c.muted, fontSize: 13, textAlign: d.start },
    starPill: { flexDirection: d.row, alignItems: 'center' as const, gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.accent },
    starPillText: { color: c.accentText, fontSize: 15, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    banner: { borderRadius: 28, padding: 18, gap: 14 },
    bannerRow: { flexDirection: d.row, alignItems: 'center' as const, gap: 14 },
    bannerStar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.accent, borderWidth: 4, borderColor: 'rgba(255,255,255,0.8)' },
    bannerLabel: { color: c.heroMuted, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    bannerValue: { color: c.heroText, fontSize: 38, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const], textAlign: d.start },
    totals: { flexDirection: d.row, gap: 10 },
    total: { flex: 1, flexDirection: d.row, alignItems: 'center' as const, gap: 8, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.18)' },
    totalValue: { color: c.heroText, fontSize: 20, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    totalLabel: { flex: 1, color: c.heroMuted, fontSize: 12, fontWeight: '600' as const, textAlign: d.start },
    label: { color: c.textSecondary, fontSize: 15, fontWeight: '800' as const, textAlign: d.start },
    quick: { flexDirection: d.row, gap: 10 },
    quickItem: { flex: 1, alignItems: 'center' as const, gap: 6 },
    quickCircle: { width: 62, height: 62, borderRadius: 31, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 2 },
    quickText: { fontSize: 12, fontWeight: '700' as const, textAlign: 'center' as const },
    card: { borderRadius: 26, padding: 16, gap: 12, borderWidth: 2 },
    cardTop: { flexDirection: d.row, alignItems: 'center' as const, gap: 14 },
    avatar: { width: 58, height: 58, borderRadius: 29, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 3, borderColor: c.surface },
    avatarText: { fontSize: 26, fontWeight: '800' as const },
    name: { color: c.text, fontSize: 20, fontWeight: '800' as const, textAlign: d.start },
    pointsPill: { alignItems: 'center' as const, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6 },
    points: { fontSize: 24, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    pointsLabel: { fontSize: 11, fontWeight: '700' as const },
    chips: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    chip: { flexDirection: d.row, alignItems: 'center' as const, gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: c.surface },
    chipText: { color: c.textSecondary, fontSize: 12, fontWeight: '700' as const },
    alert: { backgroundColor: c.accent },
    alertText: { color: c.accentText },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    add: { color: c.primary, fontSize: 14, fontWeight: '700' as const, textAlign: d.start },
  }));

  // A child goes straight to its own board.
  if (session.user.role === 'CHILD' && session.user.memberId) return <Redirect href={`/kids/${session.user.memberId}`} />;

  const totalPoints = kids.reduce((sum, kid) => sum + kid.points, 0);
  const awaiting = kids.reduce((sum, kid) => sum + kid.awaitingApproval, 0);
  const open = kids.reduce((sum, kid) => sum + kid.pendingTasks, 0);
  const first = kids[0]?.id;
  const quick: { label: StringKey; icon: IconName; tone: Tone; href: Href; show: boolean }[] = [
    { label: 'givePoints', icon: 'thumbs-up', tone: 'teal', href: { pathname: '/kids/act', params: { childId: first ?? '', mode: 'award' } }, show: can('EVALUATE_CHILDREN') },
    { label: 'kNewTask', icon: 'add-circle', tone: 'amber', href: { pathname: '/kids/act', params: { childId: first ?? '', mode: 'task' } }, show: can('MANAGE_CHILD_TASKS') },
    { label: 'kPenalty', icon: 'remove-circle', tone: 'rose', href: { pathname: '/kids/act', params: { childId: first ?? '', mode: 'penalty' } }, show: can('PENALIZE_CHILDREN') },
    { label: 'kAllServices', icon: 'grid', tone: 'violet', href: '/kids/services', show: true },
  ];
  // With several children the quick actions open Services, where the child is picked first.
  const quickHref = (item: (typeof quick)[number]) => (kids.length > 1 && item.href !== '/kids/services' ? '/kids/services' : item.href);

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={s.screen}
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
      >
        <View style={s.top}>
          <View style={s.me}><Text style={s.meText}>{session.user.name.trim().charAt(0)}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.hello} numberOfLines={1}>{t('kHello', { name: session.user.name })}</Text>
            <Text style={s.date} numberOfLines={1}>{new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
          </View>
          <View style={s.starPill}>
            <Ionicons name="star" size={16} color={colors.accentText} />
            <Text style={s.starPillText}>{format.number(totalPoints)}</Text>
          </View>
        </View>

        <SkyHero style={s.banner}>
          <View style={s.bannerRow}>
            <View style={s.bannerStar}><Ionicons name="trophy" size={30} color={colors.accentText} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.bannerLabel}>{t('kFamilyPoints')}</Text>
              <CountUp value={totalPoints}>{(shown) => <Text style={s.bannerValue}>{format.number(Math.round(shown))}</Text>}</CountUp>
            </View>
          </View>
          <View style={s.totals}>
            <View style={s.total}>
              <Ionicons name="hourglass" size={18} color={colors.accent} />
              <Text style={s.totalValue}>{format.number(awaiting)}</Text>
              <Text style={s.totalLabel} numberOfLines={2}>{t('kAwaitingTotal')}</Text>
            </View>
            <View style={s.total}>
              <Ionicons name="checkbox" size={18} color={colors.accent} />
              <Text style={s.totalValue}>{format.number(open)}</Text>
              <Text style={s.totalLabel} numberOfLines={2}>{t('kOpenTotal')}</Text>
            </View>
          </View>
        </SkyHero>

        {error ? <Text style={s.error}>{error}</Text> : null}

        {kids.length ? (
          <View style={{ gap: 10 }}>
            <Text style={s.label}>{t('kQuick')}</Text>
            <View style={s.quick}>
              {quick.filter((item) => item.show).map((item) => {
                const tone = colors.tones[item.tone];
                return (
                  <Pressable key={item.label} onPress={() => router.push(quickHref(item))} style={({ pressed }) => [s.quickItem, pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] }]} accessibilityRole="button">
                    <View style={[s.quickCircle, { backgroundColor: tone.from, borderColor: tone.to }]}><Ionicons name={item.icon} size={28} color={tone.icon} /></View>
                    <Text style={[s.quickText, { color: colors.textSecondary }]} numberOfLines={2}>{t(item.label)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <Text style={s.label}>{t('menuKids')}</Text>
        {loading ? <Card><ListSkeleton rows={2} /></Card> : kids.length ? kids.map((kid, index) => {
          const tone = colors.tones[kidTone(index)];
          return (
            <FadeInView key={kid.id} index={index}>
              <PressableScale onPress={() => router.push(`/kids/${kid.id}`)} accessibilityRole="button">
                <View style={[s.card, { backgroundColor: tone.from, borderColor: tone.to }]}>
                  <View style={s.cardTop}>
                    <View style={[s.avatar, { backgroundColor: tone.icon }]}>
                      <Text style={[s.avatarText, { color: '#ffffff' }]}>{kid.name.trim().charAt(0)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={s.name} numberOfLines={1}>{kid.name}</Text>
                      <Stars value={kid.stars} size={15} />
                    </View>
                    <View style={[s.pointsPill, { backgroundColor: colors.surface }]}>
                      <Text style={[s.points, { color: tone.fg }]}>{format.number(kid.points)}</Text>
                      <Text style={[s.pointsLabel, { color: tone.fg }]}>{t('kPoints')}</Text>
                    </View>
                    <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={20} color={tone.fg} />
                  </View>
                  <View style={s.chips}>
                    <View style={s.chip}>
                      <Ionicons name="checkbox-outline" size={14} color={tone.icon} />
                      <Text style={s.chipText}>{t('openTasksCount', { count: format.number(kid.pendingTasks) })}</Text>
                    </View>
                    <View style={s.chip}>
                      <Ionicons name="wallet-outline" size={14} color={tone.icon} />
                      <Text style={s.chipText}>{format.money(kid.money, kid.currency)}</Text>
                    </View>
                    {kid.awaitingApproval ? (
                      <View style={[s.chip, s.alert]}>
                        <Ionicons name="hourglass-outline" size={14} color={colors.accentText} />
                        <Text style={[s.chipText, s.alertText]}>{t('awaitingCount', { count: format.number(kid.awaitingApproval) })}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </PressableScale>
            </FadeInView>
          );
        }) : <EmptyState icon="happy-outline" title={t('kidsPoints')} body={t('kAddChildFirst')} />}
        {!loading && can('MANAGE_CHILDREN') ? (
          <Pressable onPress={() => router.push('/kids/new-child')} accessibilityRole="button">
            <Text style={s.add}>+ {t('svcChild')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

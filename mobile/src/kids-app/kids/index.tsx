import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { getKids, type KidSummary } from '../../api';
import { WithKidsBar as WithBottomBar } from '../../kidsShell';
import { Card, EmptyState, IconBubble, ListSkeleton, SmallButton } from '../../components';
import { Stars } from '../../kids';
import { FadeInView, PressableScale } from '../../motion';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { Text } from '../../typography';

export default function KidsPage() {
  return (
    <WithBottomBar>
      <KidsScreen />
    </WithBottomBar>
  );
}

function KidsScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors, rtl } = usePreferences();
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
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 14 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: d.start },
    links: { flexDirection: d.row, gap: 8, flexWrap: 'wrap' as const },
    card: { flexDirection: d.row, alignItems: 'center' as const, gap: 14 },
    name: { color: c.text, fontSize: 17, fontWeight: '800' as const, textAlign: d.start },
    meta: { color: c.muted, fontSize: 12, marginTop: 4, textAlign: d.start },
    alert: { color: c.tones.amber.fg, fontSize: 12, fontWeight: '700' as const, marginTop: 4, textAlign: d.start },
    points: { color: c.text, fontSize: 22, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const], textAlign: d.end },
    pointsLabel: { color: c.muted, fontSize: 11, textAlign: d.end },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  // A child goes straight to its own board.
  if (session.user.role === 'CHILD' && session.user.memberId) return <Redirect href={`/kids/${session.user.memberId}`} />;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Text style={s.hint}>{t('kidsPointsHint')}</Text>
      {session.user.isAdmin ? (
        <View style={s.links}>
          <SmallButton label={t('kSettings')} icon="options-outline" onPress={() => router.push('/kids/settings')} />
          <SmallButton label={t('kAudit')} icon="document-text-outline" onPress={() => router.push('/kids/audit')} />
        </View>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      {loading ? <Card><ListSkeleton rows={2} /></Card> : kids.length ? kids.map((kid, index) => (
        <FadeInView key={kid.id} index={index}>
          <PressableScale onPress={() => router.push(`/kids/${kid.id}`)} accessibilityRole="button">
            <Card style={s.card}>
              <IconBubble name="happy" color={colors.lessons} background={colors.lessonsSoft} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{kid.name}</Text>
                <View style={{ marginTop: 4 }}><Stars value={kid.stars} size={14} /></View>
                <Text style={s.meta}>{[t('openTasksCount', { count: format.number(kid.pendingTasks) }), `${t('rewardMoney')}: ${format.money(kid.money, kid.currency)}`].join(' · ')}</Text>
                {kid.awaitingApproval ? <Text style={s.alert}>{t('awaitingCount', { count: format.number(kid.awaitingApproval) })}</Text> : null}
              </View>
              <View>
                <Text style={s.points}>{format.number(kid.points)}</Text>
                <Text style={s.pointsLabel}>{t('kPoints')}</Text>
              </View>
              <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.muted} />
            </Card>
          </PressableScale>
        </FadeInView>
      )) : <EmptyState icon="happy-outline" title={t('kidsPoints')} body={t('kidsNone')} />}
      {!loading && !kids.length && can('MANAGE_CHILDREN') ? (
        <Pressable onPress={() => router.push('/create/child')}><Text style={[s.hint, { color: colors.primary, fontWeight: '700' }]}>{t('svcChild')}</Text></Pressable>
      ) : null}
    </ScrollView>
  );
}

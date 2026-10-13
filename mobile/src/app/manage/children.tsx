import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { getChildren, type Child } from '../../api';
import { Card, IconBubble, ListSkeleton, PrimaryButton } from '../../components';
import { ListPage, useRowStyles } from '../../manageUi';
import { usePreferences } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { Text } from '../../typography';

/** The family's children; each opens its own page (lessons, fees, points). */
export default function ChildrenPage() {
  const { call } = useAuthedSession();
  const { t, colors, rtl } = usePreferences();
  const can = useCan();
  const s = useRowStyles();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setChildren(await call(getChildren));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ListPage
      allowed={can('SERVICE_LESSONS') || can('MANAGE_CHILDREN')}
      error={error}
      refreshing={refreshing}
      onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }}
    >
      {can('MANAGE_CHILDREN') ? <PrimaryButton label={t('svcChild')} icon="person-add" onPress={() => router.push('/create/child')} /> : null}
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {!children ? <ListSkeleton rows={3} /> : children.length ? children.map((child, index) => (
          <Pressable key={child.id} onPress={() => router.push(`/child/${child.id}`)} style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <IconBubble name="person" color={colors.lessons} background={colors.lessonsSoft} />
            <View style={s.info}>
              <Text style={s.title}>{child.name}</Text>
              {child.grade || child.school ? <Text style={s.sub} numberOfLines={1}>{[child.grade, child.school].filter(Boolean).join(' · ')}</Text> : null}
            </View>
            <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.muted} />
          </Pressable>
        )) : <Text style={s.empty}>{t('noChildren')}</Text>}
      </Card>
    </ListPage>
  );
}

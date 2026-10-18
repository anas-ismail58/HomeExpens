import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { getPermissionMatrix, setMemberPermissions, type PermissionKey, type PermissionMatrix } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, ListSkeleton, SectionTitle } from '../../components';
import { ToggleRow } from '../../formControls';
import type { StringKey } from '../../i18n';
import { usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';

/** Whole sections of the app the member can see. */
const SERVICE_KEYS: PermissionKey[] = ['SERVICE_LESSONS', 'SERVICE_RECURRING', 'SERVICE_HOUSEHOLD', 'VIEW_PAYMENTS', 'MANAGE_CHILDREN', 'VIEW_REPORTS', 'VIEW_INCOME'];
/** Actions inside those sections. */
const ACTION_KEYS: PermissionKey[] = ['VIEW_EXPENSES', 'ADD_EXPENSE', 'EDIT_EXPENSE', 'DELETE_EXPENSE', 'ADD_PAYMENT', 'EDIT_PAYMENT', 'DELETE_PAYMENT'];

export default function PermissionsPage() {
  return (
    <WithBottomBar>
      <PermissionsScreen />
    </WithBottomBar>
  );
}

function PermissionsScreen() {
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const { session, call } = useAuthedSession();
  const { t } = usePreferences();
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setMatrix(await call(getPermissionMatrix));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /** Optimistic toggle; the server is the source of truth and is re-read on failure. */
  const toggle = async (memberId: string, key: PermissionKey, granted: boolean) => {
    setMatrix((current) =>
      current && {
        ...current,
        members: current.members.map((m) => (m.userId === memberId ? { ...m, permissions: { ...m.permissions, [key]: granted } } : m)),
      },
    );
    try {
      await call((s, r) => setMemberPermissions(s, memberId, { [key]: granted }, r));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
      await load();
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    group: { color: c.muted, fontSize: 12, fontWeight: '800' as const, textAlign: d.start, paddingTop: 12, paddingBottom: 2 },
  }));

  if (!session.user.isAdmin) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  const editable = (matrix?.members ?? []).filter((m) => m.editable).sort((a, b) => (a.userId === userId ? -1 : b.userId === userId ? 1 : 0));

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page}>
      <Text style={s.hint}>{t('permissionsHint')}</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!matrix ? <Card><ListSkeleton rows={4} /></Card> : editable.length ? editable.map((member) => (
        <View key={member.userId} style={{ gap: 10 }}>
          <SectionTitle title={`${member.name} · ${t(`role${member.role}` as StringKey)}`} />
          <Card padded={false} style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
            {[
              { title: t('permServices'), keys: SERVICE_KEYS },
              { title: t('permActions'), keys: ACTION_KEYS },
            ].map((group) => (
              <View key={group.title}>
                <Text style={s.group}>{group.title}</Text>
                {group.keys.map((key, index) => (
                  <View key={key} style={index > 0 && s.divider}>
                    <ToggleRow label={t(`perm_${key}` as StringKey)} value={Boolean(member.permissions[key])} onChange={(next) => void toggle(member.userId, key, next)} />
                  </View>
                ))}
              </View>
            ))}
          </Card>
        </View>
      )) : <EmptyState icon="people-outline" title={t('familyMembers')} body={t('inviteMember')} />}
    </ScrollView>
  );
}

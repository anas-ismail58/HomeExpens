import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { getPermissionMatrix, setMemberPermissions, type PermissionKey, type PermissionMatrix } from '../../api';
import { Card, EmptyState, ListSkeleton, SectionTitle } from '../../components';
import { ToggleRow } from '../../formControls';
import type { StringKey } from '../../i18n';
import { WithKidsBar } from '../../kidsShell';
import { usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

/** Evaluating children; never offered for a child's own login. */
const KIDS_KEYS: PermissionKey[] = ['EVALUATE_CHILDREN', 'MANAGE_CHILD_TASKS', 'PENALIZE_CHILDREN'];

export default function PointsPermissionsPage() {
  return (
    <WithKidsBar>
      <PermissionsScreen />
    </WithKidsBar>
  );
}

/** Who in the family can give points, manage tasks and penalize. The father sets this here, not in the expenses app. */
function PermissionsScreen() {
  const { session, call } = useAuthedSession();
  const { t } = usePreferences();
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [error, setError] = useState('');

  const allowed = session.user.isAdmin;
  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setMatrix(await call(getPermissionMatrix));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [allowed, call, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /** Optimistic toggle; the server is the source of truth and is re-read on failure. */
  const toggle = async (memberId: string, key: PermissionKey, granted: boolean) => {
    setMatrix((current) => current && { ...current, members: current.members.map((m) => (m.userId === memberId ? { ...m, permissions: { ...m.permissions, [key]: granted } } : m)) });
    try {
      await call((s, r) => setMemberPermissions(s, memberId, { [key]: granted }, r));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
      await load();
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32, gap: 18 },
    hint: { color: c.muted, fontSize: 14, lineHeight: 21, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
  }));

  if (!session.user.isAdmin) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  const members = (matrix?.members ?? []).filter((m) => m.editable && m.role !== 'CHILD');
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page}>
      <Text style={s.hint}>{t('kPermissionsHint')}</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!matrix ? <Card><ListSkeleton rows={3} /></Card> : members.length ? members.map((member) => (
        <View key={member.userId} style={{ gap: 10 }}>
          <SectionTitle title={`${member.name} · ${t(`role${member.role}` as StringKey)}`} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {KIDS_KEYS.map((key, index) => (
              <View key={key} style={index > 0 && s.divider}>
                <ToggleRow label={t(`perm_${key}` as StringKey)} value={Boolean(member.permissions[key])} onChange={(next) => void toggle(member.userId, key, next)} />
              </View>
            ))}
          </Card>
        </View>
      )) : <EmptyState icon="people-outline" title={t('familyMembers')} body={t('inviteMember')} />}
    </ScrollView>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Text } from '../typography';
import { getAdminFamilies, getAdminUsers, switchFamily, type AdminFamily, type AdminUser } from '../api';
import { WithBottomBar } from '../BottomBar';
import { Card, EmptyState, ListSkeleton, SectionTitle, SegmentedControl } from '../components';
import { TextField } from '../formControls';
import type { StringKey } from '../i18n';
import { useFormat, usePreferences, useStyles } from '../preferences';
import { useAuthedSession } from '../SessionContext';

type Tab = 'families' | 'users';

export default function AdminPage() {
  return (
    <WithBottomBar>
      <AdminScreen />
    </WithBottomBar>
  );
}

/** Super admin: every family and user on the platform, and entering any family without a password. */
function AdminScreen() {
  const { session, call, setSession } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [tab, setTab] = useState<Tab>('families');
  const [query, setQuery] = useState('');
  const [families, setFamilies] = useState<AdminFamily[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextFamilies, nextUsers] = await Promise.all([call(getAdminFamilies), call(getAdminUsers)]);
      setFamilies(nextFamilies);
      setUsers(nextUsers);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const enter = async (familyId: string) => {
    if (familyId === session.family.id) return;
    setSwitching(familyId);
    try {
      const next = await call((s, r) => switchFamily(s, familyId, r));
      setSession(next);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setSwitching(null);
    }
  };

  const needle = query.trim().toLowerCase();
  const shownFamilies = useMemo(
    () => (families ?? []).filter((f) => !needle || [f.name, f.owner.name, f.owner.email].some((v) => v.toLowerCase().includes(needle))),
    [families, needle],
  );
  const shownUsers = useMemo(
    () => (users ?? []).filter((u) => !needle || [u.name, u.email, u.family?.name ?? ''].some((v) => v.toLowerCase().includes(needle))),
    [users, needle],
  );

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 12 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    copy: { flex: 1, gap: 3 },
    name: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    meta: { color: c.muted, fontSize: 12, textAlign: d.start },
    enter: { flexDirection: d.row, alignItems: 'center' as const, gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: c.primarySoft },
    enterText: { color: c.primary, fontSize: 13, fontWeight: '700' as const },
    current: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: c.successSoft },
    currentText: { color: c.success, fontSize: 12, fontWeight: '700' as const },
  }));

  if (!session.user.isSuperAdmin) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  const enterButton = (familyId: string) =>
    familyId === session.family.id ? (
      <View style={s.current}><Text style={s.currentText}>{t('adminCurrentFamily')}</Text></View>
    ) : (
      <Pressable onPress={() => void enter(familyId)} disabled={switching !== null} accessibilityRole="button" style={s.enter}>
        {switching === familyId ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="log-in-outline" size={16} color={colors.primary} />}
        <Text style={s.enterText}>{t('adminEnter')}</Text>
      </Pressable>
    );

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.hint}>{t('adminHint', { family: session.family.name })}</Text>
      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'families', label: t('adminFamilies') },
          { value: 'users', label: t('adminUsers') },
        ]}
      />
      <TextField value={query} onChange={setQuery} placeholder={t('adminSearch')} autoCapitalize="none" />
      {error ? <Text style={s.error}>{error}</Text> : null}

      {tab === 'families' ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('adminFamilies')} count={families ? shownFamilies.length : undefined} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {!families ? <ListSkeleton rows={4} /> : shownFamilies.length ? shownFamilies.map((family, index) => (
              <View key={family.id} style={[s.row, index > 0 && s.divider]}>
                <View style={s.copy}>
                  <Text style={s.name}>{family.name}</Text>
                  <Text style={s.meta}>{family.owner.name} · {family.owner.email}</Text>
                  <Text style={s.meta}>
                    {t('adminFamilyCounts', {
                      users: format.number(family.counts.users),
                      children: format.number(family.counts.children),
                      expenses: format.number(family.counts.expenses),
                      payments: format.number(family.counts.payments),
                    })}
                  </Text>
                </View>
                {enterButton(family.id)}
              </View>
            )) : <EmptyState icon="people-outline" title={t('adminFamilies')} body={t('adminNoResults')} />}
          </Card>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('adminUsers')} count={users ? shownUsers.length : undefined} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {!users ? <ListSkeleton rows={6} /> : shownUsers.length ? shownUsers.map((user, index) => (
              <View key={user.id} style={[s.row, index > 0 && s.divider]}>
                <View style={s.copy}>
                  <Text style={s.name}>
                    {user.name}
                    {user.isSuperAdmin ? ` · ${t('adminSuper')}` : ''}
                    {!user.isActive ? ` · ${t('adminInactive')}` : ''}
                  </Text>
                  <Text style={s.meta}>{user.email}</Text>
                  <Text style={s.meta}>
                    {t(`role${user.role}` as StringKey)} · {user.family?.name ?? t('adminNoFamily')}
                    {user.lastLoginAt ? ` · ${t('adminLastLogin', { date: format.dateTime(user.lastLoginAt, '') })}` : ''}
                  </Text>
                </View>
                {user.family ? enterButton(user.family.id) : null}
              </View>
            )) : <EmptyState icon="person-outline" title={t('adminUsers')} body={t('adminNoResults')} />}
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { getKidAudit, type AuditEntry } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, ListSkeleton } from '../../components';
import type { StringKey } from '../../i18n';
import { usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

export default function KidAuditPage() {
  return (
    <WithBottomBar>
      <KidAuditScreen />
    </WithBottomBar>
  );
}

/** A short, human summary of what changed, from the audit details. */
function summary(entry: AuditEntry) {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  const parts = [d.title, d.reason, d.reward, d.points !== undefined ? `${d.points}` : null, d.amount ? `${d.amount}${d.currency ? ` ${d.currency}` : ''}` : null, d.note];
  return parts.filter((p) => typeof p === 'string' || typeof p === 'number').join(' · ');
}

function KidAuditScreen() {
  const { childId } = useLocalSearchParams<{ childId?: string }>();
  const { session, call } = useAuthedSession();
  const { t, locale } = usePreferences();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await call((s, r) => getKidAudit(s, childId, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, childId, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 14 },
    row: { paddingVertical: 12, gap: 3 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    title: { color: c.text, fontSize: 14, fontWeight: '700' as const, textAlign: d.start },
    detail: { color: c.textSecondary, fontSize: 13, textAlign: d.start },
    meta: { color: c.muted, fontSize: 12, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (!session.user.isAdmin) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page}>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!rows ? <Card><ListSkeleton rows={5} /></Card> : rows.length ? (
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {rows.map((row, index) => {
            const label = `audit_${row.action.replace('.', '_')}` as StringKey;
            const detail = summary(row);
            return (
              <View key={row.id} style={[s.row, index > 0 && s.divider]}>
                <Text style={s.title}>{[row.actor?.name, t(label) ?? row.action].filter(Boolean).join(' — ')}</Text>
                {detail ? <Text style={s.detail}>{detail}</Text> : null}
                <Text style={s.meta}>{[row.child?.name, when.format(new Date(row.createdAt))].filter(Boolean).join(' · ')}</Text>
              </View>
            );
          })}
        </Card>
      ) : <EmptyState icon="document-text-outline" title={t('kAudit')} body={t('kNoAudit')} />}
    </ScrollView>
  );
}

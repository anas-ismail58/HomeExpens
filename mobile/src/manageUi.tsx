import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { WithBottomBar } from './BottomBar';
import { EmptyState } from './components';
import { usePreferences, useStyles } from './preferences';
import { Text } from './typography';

/** Shared frame for the single-list pages opened from Services (children, teachers, subjects, fees, sections, allowances). */
export function ListPage({ hint, error, allowed = true, refreshing, onRefresh, children }: {
  hint?: string;
  error?: string;
  allowed?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const { t, colors } = usePreferences();
  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));
  return (
    <WithBottomBar>
      {allowed ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={s.screen}
          contentContainerStyle={s.page}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} tintColor={colors.primary} onRefresh={onRefresh} /> : undefined}
        >
          {hint ? <Text style={s.hint}>{hint}</Text> : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
          {children}
        </ScrollView>
      ) : (
        <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
          <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
        </View>
      )}
    </WithBottomBar>
  );
}

/** Row styles shared by those pages. */
export function useRowStyles() {
  return useStyles((c, d) => ({
    row: { minHeight: 60, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    info: { flex: 1, minWidth: 0 },
    title: { color: c.text, fontSize: 15, fontWeight: '600' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 12, marginTop: 3, textAlign: d.start },
    amount: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    empty: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 14 },
    actions: { flexDirection: d.row, gap: 8, alignItems: 'center' as const },
  }));
}

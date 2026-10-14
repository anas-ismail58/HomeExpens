import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { getInsights, type Insights, type InsightsPeriod } from './api';
import { Card, EmptyState, IconBubble, SectionTitle, Skeleton, SmallButton, type IconName } from './components';
import { DatePicker, toDateOnly } from './formControls';
import type { StringKey } from './i18n';
import { GrowBar } from './motion';
import { useFormat, usePreferences, useStyles } from './preferences';
import { useAuthedSession } from './SessionContext';
import type { Tone } from './theme';
import { Text } from './typography';

/** Dashboard / analytics numbers for a period, reloaded whenever the screen comes back into view. */
export function useInsights(period: InsightsPeriod, range?: { from: string; to: string }) {
  const { call } = useAuthedSession();
  const { t } = usePreferences();
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const from = range?.from;
  const to = range?.to;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await call((s, r) => getInsights(s, period, { from, to }, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, period, from, to, t]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { data, error, loading, reload };
}

/** 2 columns on phones, 3 on tablets and desktop. */
export function useColumns() {
  const { width } = useWindowDimensions();
  return width >= 720 ? 3 : 2;
}

/** One summary number. */
export function StatCard({ icon, tone, label, value, sub, onPress, loading }: { icon: IconName; tone: Tone; label: string; value: string; sub?: string; onPress?: () => void; loading?: boolean }) {
  const { colors } = usePreferences();
  const columns = useColumns();
  const s = useStyles((c, d) => ({
    card: { flexGrow: 1, gap: 6, minHeight: 112 },
    label: { color: c.textSecondary, fontSize: 12, fontWeight: '700' as const, textAlign: d.start },
    value: { color: c.text, fontSize: 19, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    sub: { color: c.muted, fontSize: 11, textAlign: d.start },
  }));
  const body = (
    <Card style={s.card}>
      <IconBubble name={icon} color={colors.tones[tone].icon} background={colors.tones[tone].from} size={34} />
      <Text style={s.label} numberOfLines={1}>{label}</Text>
      {loading ? <Skeleton height={22} width="70%" /> : <Text style={s.value} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>}
      {sub && !loading ? <Text style={s.sub} numberOfLines={1}>{sub}</Text> : null}
    </Card>
  );
  const basis = columns === 3 ? '31%' : '47%';
  return onPress ? (
    <Pressable style={({ pressed }) => [{ flexBasis: basis as `${number}%`, flexGrow: 1 }, pressed && { opacity: 0.8 }]} onPress={onPress} accessibilityRole="button">{body}</Pressable>
  ) : (
    <View style={{ flexBasis: basis as `${number}%`, flexGrow: 1 }}>{body}</View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  const s = useStyles((_c, d) => ({ grid: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 10 } }));
  return <View style={s.grid}>{children}</View>;
}

/** A short list (latest 4) with a "View all" link to its full page. */
export function RecentSection({ title, href, empty, children, count }: { title: string; href: Href; empty: string; children: ReactNode[]; count?: number }) {
  const { t } = usePreferences();
  const s = useStyles((c, d) => ({ empty: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 14 } }));
  return (
    <View style={{ gap: 10 }}>
      <SectionTitle title={title} count={count} action={<SmallButton label={t('viewAll')} icon="list" onPress={() => router.push(href)} />} />
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {children.length ? children : <Text style={s.empty}>{empty}</Text>}
      </Card>
    </View>
  );
}

const PERIODS: { value: InsightsPeriod; label: StringKey }[] = [
  { value: 'today', label: 'periodToday' },
  { value: 'week', label: 'periodWeek' },
  { value: 'month', label: 'periodMonth' },
  { value: 'custom', label: 'periodCustom' },
];

/** Today / this week / this month / custom range. */
export function PeriodFilter({ period, range, onChange }: { period: InsightsPeriod; range: { from: string; to: string }; onChange: (period: InsightsPeriod, range: { from: string; to: string }) => void }) {
  const { t } = usePreferences();
  const [editing, setEditing] = useState<'from' | 'to' | null>(null);
  const format = useFormat();
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, gap: 6, padding: 4, borderRadius: 14, backgroundColor: c.surfaceMuted },
    item: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const },
    itemOn: { backgroundColor: c.surface },
    text: { color: c.muted, fontSize: 13, fontWeight: '700' as const },
    textOn: { color: c.primary },
    dates: { flexDirection: d.row, gap: 8, marginTop: 10 },
    date: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: 12, justifyContent: 'center' as const },
    dateLabel: { color: c.muted, fontSize: 11, textAlign: d.start },
    dateValue: { color: c.text, fontSize: 14, fontWeight: '700' as const, textAlign: d.start },
  }));
  return (
    <View>
      <View style={s.row} accessibilityRole="tablist">
        {PERIODS.map((p) => (
          <Pressable key={p.value} style={[s.item, period === p.value && s.itemOn]} onPress={() => onChange(p.value, range)} accessibilityRole="tab" accessibilityState={{ selected: period === p.value }}>
            <Text style={[s.text, period === p.value && s.textOn]}>{t(p.label)}</Text>
          </Pressable>
        ))}
      </View>
      {period === 'custom' ? (
        <>
          <View style={s.dates}>
            {(['from', 'to'] as const).map((which) => (
              <Pressable key={which} style={s.date} onPress={() => setEditing(editing === which ? null : which)} accessibilityRole="button">
                <Text style={s.dateLabel}>{t(which === 'from' ? 'rangeFrom' : 'rangeTo')}</Text>
                <Text style={s.dateValue}>{format.date(range[which])}</Text>
              </Pressable>
            ))}
          </View>
          {editing ? (
            <Card style={{ marginTop: 10 }}>
              <DatePicker
                value={range[editing]}
                onChange={(value) => {
                  const next = { ...range, [editing]: value };
                  onChange('custom', next.from <= next.to ? next : { from: next.to, to: next.from });
                  setEditing(null);
                }}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export function thisMonthRange() {
  const today = toDateOnly(new Date());
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

type Series = { label: string; color: string; values: number[] };

/**
 * Bars over time for one or two series from a shared zero baseline (no second axis). Tap a column to read
 * its exact values; a legend names each series when there are two.
 */
export function SeriesBars({ labels, series, money, height = 130, labelEvery = 1 }: { labels: string[]; series: Series[]; money: (n: number) => string; height?: number; labelEvery?: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap((x) => x.values));
  const last = labels.length - 1;
  // Start on the latest column that has data (not an empty future day).
  let latest = last;
  while (latest > 0 && !series.some((x) => (x.values[latest] ?? 0) > 0)) latest--;
  const shown = selected ?? latest;
  const s = useStyles((c, d) => ({
    legend: { flexDirection: d.row, gap: 14, flexWrap: 'wrap' as const },
    legendItem: { flexDirection: d.row, alignItems: 'center' as const, gap: 6 },
    swatch: { width: 10, height: 10, borderRadius: 2 },
    legendText: { color: c.textSecondary, fontSize: 12 },
    readout: { color: c.text, fontSize: 13, fontWeight: '700' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    plot: { flexDirection: d.row, alignItems: 'flex-end' as const, height, borderBottomWidth: 1, borderBottomColor: c.border },
    group: { flex: 1, height, flexDirection: 'row' as const, alignItems: 'flex-end' as const, justifyContent: 'center' as const, gap: 2 },
    bar: { flex: 1, maxWidth: 14, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    axis: { flexDirection: d.row, marginTop: 4 },
    tick: { flex: 1, color: c.muted, fontSize: 10, textAlign: 'center' as const },
  }));
  if (!labels.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {series.length > 1 ? (
        <View style={s.legend}>
          {series.map((x) => (
            <View key={x.label} style={s.legendItem}><View style={[s.swatch, { backgroundColor: x.color }]} /><Text style={s.legendText}>{x.label}</Text></View>
          ))}
        </View>
      ) : null}
      <Text style={s.readout}>{`${labels[shown]}: ${series.map((x) => (series.length > 1 ? `${x.label} ${money(x.values[shown] ?? 0)}` : money(x.values[shown] ?? 0))).join(' · ')}`}</Text>
      <View style={s.plot}>
        {labels.map((label, index) => (
          <Pressable
            key={`${label}-${index}`}
            style={[s.group, index === shown && { backgroundColor: 'rgba(127,127,127,0.10)', borderTopLeftRadius: 6, borderTopRightRadius: 6 }]}
            onPress={() => setSelected(index)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${series.map((x) => `${x.label} ${money(x.values[index] ?? 0)}`).join(', ')}`}
          >
            {series.map((x) => (
              <View key={x.label} style={[s.bar, { height: Math.max(x.values[index] ? 3 : 0, ((x.values[index] ?? 0) / max) * (height - 6)), backgroundColor: x.color }]} />
            ))}
          </Pressable>
        ))}
      </View>
      <View style={s.axis}>
        {labels.map((label, index) => (
          <Text key={`${label}-${index}`} style={s.tick} numberOfLines={1}>{index % labelEvery === 0 || index === last ? label : ''}</Text>
        ))}
      </View>
    </View>
  );
}

/** Ranked horizontal bars (e.g. outstanding by child); the value is printed, the bar shows the share. */
export function RankBars({ rows, color, empty, max: fixedMax }: { rows: { key: string; label: string; value: number; display: string; sub?: string }[]; color: string; empty: string; max?: number }) {
  const max = fixedMax ?? Math.max(1, ...rows.map((r) => r.value));
  const s = useStyles((c, d) => ({
    row: { gap: 6, paddingVertical: 8 },
    head: { flexDirection: d.row, justifyContent: 'space-between' as const, gap: 10 },
    label: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    value: { color: c.text, fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    sub: { color: c.muted, fontSize: 11, textAlign: d.start },
    track: { height: 8, borderRadius: 4, backgroundColor: c.surfaceMuted, overflow: 'hidden' as const },
    empty: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 8 },
  }));
  if (!rows.length) return <Text style={s.empty}>{empty}</Text>;
  return (
    <View>
      {rows.map((row) => (
        <View key={row.key} style={s.row}>
          <View style={s.head}>
            <Text style={s.label} numberOfLines={1}>{row.label}</Text>
            <Text style={s.value}>{row.display}</Text>
          </View>
          {row.sub ? <Text style={s.sub}>{row.sub}</Text> : null}
          <View style={s.track}><GrowBar share={row.value / max} color={color} height={8} radius={4} /></View>
        </View>
      ))}
    </View>
  );
}

/** Paid / still to pay / overdue as one split bar with a labelled legend (never colour alone). */
export function SplitBar({ parts, empty }: { parts: { key: string; label: string; value: number; display: string; color: string; icon: IconName }[]; empty: string }) {
  const total = parts.reduce((t, p) => t + p.value, 0);
  const s = useStyles((c, d) => ({
    bar: { flexDirection: d.row, height: 14, borderRadius: 7, overflow: 'hidden' as const, backgroundColor: c.surfaceMuted, gap: 2 },
    legend: { gap: 8, marginTop: 12 },
    item: { flexDirection: d.row, alignItems: 'center' as const, gap: 8 },
    label: { flex: 1, color: c.textSecondary, fontSize: 13, textAlign: d.start },
    value: { color: c.text, fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    empty: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 8 },
  }));
  if (!total) return <Text style={s.empty}>{empty}</Text>;
  return (
    <View>
      <View style={s.bar}>
        {parts.filter((p) => p.value > 0).map((p) => <View key={p.key} style={{ flex: p.value, backgroundColor: p.color }} />)}
      </View>
      <View style={s.legend}>
        {parts.map((p) => (
          <View key={p.key} style={s.item}>
            <Ionicons name={p.icon} size={16} color={p.color} />
            <Text style={s.label}>{p.label}</Text>
            <Text style={s.value}>{p.display}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function LoadingCards() {
  return (
    <StatGrid>
      {[0, 1, 2, 3].map((i) => <View key={i} style={{ flexBasis: '47%', flexGrow: 1 }}><Skeleton height={112} radius={18} /></View>)}
    </StatGrid>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = usePreferences();
  return (
    <Card style={{ gap: 10 }}>
      <EmptyState icon="cloud-offline-outline" title={t('loadError')} body={message} />
      <SmallButton label={t('retry')} icon="refresh" onPress={onRetry} />
    </Card>
  );
}

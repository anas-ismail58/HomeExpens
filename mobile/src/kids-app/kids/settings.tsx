import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { createPointRule, getKidSettings, updateKidSettings, updatePointRule, type KidSettings, type PointRule, type PointRuleKind } from '../../api';
import { WithKidsBar as WithBottomBar } from '../../kidsShell';
import { Card, EmptyState, ListSkeleton, PrimaryButton, SectionTitle } from '../../components';
import { Field, normalizeDigits, TextField, ToggleRow } from '../../formControls';
import type { StringKey } from '../../i18n';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

const KINDS: PointRuleKind[] = ['BEHAVIOR', 'PENALTY', 'REWARD'];
const WHOLE = /^\d{1,5}$/;
const DECIMAL = /^\d{1,8}(\.\d{1,3})?$/;

type Limits = { pointValue: string; maxAwardPoints: string; maxPenaltyPoints: string; dailyPenaltyLimit: string; maxPenaltyAmount: string };

export default function KidSettingsPage() {
  return (
    <WithBottomBar>
      <KidSettingsScreen />
    </WithBottomBar>
  );
}

function KidSettingsScreen() {
  const { session, call } = useAuthedSession();
  const { t } = usePreferences();
  const [data, setData] = useState<KidSettings | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useCallback((next: KidSettings) => {
    setData(next);
    const x = next.settings;
    setLimits({ pointValue: x.pointValue, maxAwardPoints: String(x.maxAwardPoints), maxPenaltyPoints: String(x.maxPenaltyPoints), dailyPenaltyLimit: String(x.dailyPenaltyLimit), maxPenaltyAmount: x.maxPenaltyAmount });
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await call(getKidSettings));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [apply, call, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (key: string, action: () => Promise<KidSettings>) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      apply(await action());
      setNotice(t('saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(null);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18 },
    hint: { color: c.muted, fontSize: 12, lineHeight: 18, textAlign: d.start },
    notice: { color: c.success, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    row2: { flexDirection: d.row, gap: 10 },
  }));

  if (!session.user.isAdmin) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }
  if (!data || !limits) {
    return (
      <View style={[s.screen, s.page]}>
        {error ? <Text style={s.error}>{error}</Text> : <Card><ListSkeleton rows={4} /></Card>}
      </View>
    );
  }

  const currency = data.settings.currency;
  const n = (v: string) => normalizeDigits(v);
  const limitsValid =
    DECIMAL.test(n(limits.pointValue)) && Number(n(limits.pointValue)) > 0 &&
    [limits.maxAwardPoints, limits.maxPenaltyPoints, limits.dailyPenaltyLimit].every((v) => WHOLE.test(n(v)) && Number(n(v)) > 0) &&
    DECIMAL.test(n(limits.maxPenaltyAmount)) && Number(n(limits.maxPenaltyAmount)) > 0;
  const set = (key: keyof Limits) => (value: string) => setLimits({ ...limits, [key]: value });

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('kLimits')} />
        <Card style={{ gap: 12 }}>
          <Text style={s.hint}>{t('kLimitsHint')}</Text>
          <Field label={t('kPointValue', { currency })}>
            <TextField value={limits.pointValue} onChange={set('pointValue')} keyboardType="decimal-pad" />
          </Field>
          <Field label={t('kMaxAward')}>
            <TextField value={limits.maxAwardPoints} onChange={set('maxAwardPoints')} keyboardType="number-pad" />
          </Field>
          <View style={s.row2}>
            <View style={{ flex: 1 }}>
              <Field label={t('kMaxPenalty')}>
                <TextField value={limits.maxPenaltyPoints} onChange={set('maxPenaltyPoints')} keyboardType="number-pad" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('kDailyPenalty')}>
                <TextField value={limits.dailyPenaltyLimit} onChange={set('dailyPenaltyLimit')} keyboardType="number-pad" />
              </Field>
            </View>
          </View>
          <Field label={t('kMaxPenaltyAmount', { currency })}>
            <TextField value={limits.maxPenaltyAmount} onChange={set('maxPenaltyAmount')} keyboardType="decimal-pad" />
          </Field>
          <PrimaryButton
            label={t('saveChanges')}
            icon="checkmark"
            busy={busy === 'limits'}
            disabled={!limitsValid}
            onPress={() =>
              void run('limits', () =>
                call((sess, r) =>
                  updateKidSettings(sess, {
                    pointValue: n(limits.pointValue),
                    maxAwardPoints: Number(n(limits.maxAwardPoints)),
                    maxPenaltyPoints: Number(n(limits.maxPenaltyPoints)),
                    dailyPenaltyLimit: Number(n(limits.dailyPenaltyLimit)),
                    maxPenaltyAmount: n(limits.maxPenaltyAmount),
                  }, r),
                ),
              )
            }
          />
          <ToggleRow
            label={t('kAllowNegative')}
            hint={t('kAllowNegativeHint')}
            value={data.settings.allowNegativePoints}
            disabled={busy !== null}
            onChange={(next) => void run('negative', () => call((sess, r) => updateKidSettings(sess, { allowNegativePoints: next }, r)))}
          />
        </Card>
      </View>

      {KINDS.map((kind) => (
        <RuleGroup key={kind} kind={kind} rules={data.rules.filter((r) => r.kind === kind)} busy={busy} run={run} />
      ))}
    </ScrollView>
  );
}

function RuleGroup({ kind, rules, busy, run }: { kind: PointRuleKind; rules: PointRule[]; busy: string | null; run: (key: string, action: () => Promise<KidSettings>) => Promise<void> }) {
  const { call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [points, setPoints] = useState('');
  const pointsValue = normalizeDigits(points);
  const valid = name.trim().length > 0 && WHOLE.test(pointsValue) && Number(pointsValue) > 0;

  const s = useStyles((c, d) => ({
    row: { minHeight: 52, flexDirection: d.row, alignItems: 'center' as const, gap: 10, paddingVertical: 6 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    name: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    points: { color: c.text, fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    pill: { minHeight: 32, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: c.border },
    pillText: { fontSize: 12, fontWeight: '700' as const },
    form: { flexDirection: d.row, gap: 8, alignItems: 'flex-end' as const },
    hint: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 10 },
  }));
  const reset = () => {
    setEditing(null);
    setName('');
    setPoints('');
  };
  const sign = kind === 'BEHAVIOR' ? '+' : '−';

  return (
    <View style={{ gap: 10 }}>
      <SectionTitle title={t(`rules_${kind}` as StringKey)} count={rules.filter((r) => r.isActive).length} />
      <Card style={{ gap: 10 }}>
        {rules.length ? rules.map((rule, index) => (
          <View key={rule.id} style={[s.row, index > 0 && s.divider, !rule.isActive && { opacity: 0.5 }]}>
            <Pressable style={{ flex: 1 }} onPress={() => { setEditing(rule.id); setName(rule.name); setPoints(String(rule.points)); }} accessibilityRole="button" accessibilityHint={t('kEdit')}>
              <Text style={s.name}>{rule.name}{rule.isActive ? '' : ` · ${t('kRuleOff')}`}</Text>
            </Pressable>
            <Text style={[s.points, { color: kind === 'BEHAVIOR' ? colors.success : kind === 'PENALTY' ? colors.danger : colors.text }]}>{sign}{format.number(rule.points)}</Text>
            <Pressable
              style={s.pill}
              disabled={busy !== null}
              onPress={() => void run(rule.id, () => call((sess, r) => updatePointRule(sess, rule.id, { isActive: !rule.isActive }, r)))}
            >
              <Text style={[s.pillText, { color: rule.isActive ? colors.danger : colors.primary }]}>{rule.isActive ? t('kTurnOff') : t('kTurnOn')}</Text>
            </Pressable>
          </View>
        )) : <Text style={s.hint}>{t('kNoRules')}</Text>}
        <View style={s.form}>
          <View style={{ flex: 2 }}>
            <Field label={t('kRuleName')}><TextField value={name} onChange={setName} /></Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('kPointsField')}><TextField value={points} onChange={setPoints} keyboardType="number-pad" /></Field>
          </View>
        </View>
        <PrimaryButton
          label={editing ? t('saveChanges') : t('add')}
          icon={editing ? 'checkmark' : 'add'}
          busy={busy === `new-${kind}`}
          disabled={!valid}
          onPress={() =>
            void run(`new-${kind}`, () =>
              call((sess, r) =>
                editing
                  ? updatePointRule(sess, editing, { name: name.trim(), points: Number(pointsValue) }, r)
                  : createPointRule(sess, { kind, name: name.trim(), points: Number(pointsValue) }, r),
              ),
            ).then(reset)
          }
        />
        {editing ? <Pressable onPress={reset}><Text style={[s.hint, { color: colors.primary, textAlign: 'center' }]}>{t('cancel')}</Text></Pressable> : null}
      </Card>
    </View>
  );
}

import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  awardPoints,
  convertPoints,
  createDailyTask,
  createKidTask,
  getKidBoard,
  payKid,
  penalizeKid,
  redeemReward,
  updateDailyTask,
  updateKidTask,
  type KidBoard,
  type PointRuleKind,
} from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, ListSkeleton, PrimaryButton, SegmentedControl } from '../../components';
import { Chips, DatePicker, Field, MultiChips, normalizeDigits, TextField, toDateOnly } from '../../formControls';
import type { StringKey } from '../../i18n';
import { useKidsError, useWeekdayNames } from '../../kids';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

type Mode = 'award' | 'penalty' | 'task' | 'daily' | 'reward' | 'convert' | 'payout' | 'allowance';

const TITLES: Record<Mode, StringKey> = {
  award: 'givePoints',
  penalty: 'kPenalty',
  task: 'kNewTask',
  daily: 'kNewDaily',
  reward: 'kReward',
  convert: 'convertPoints',
  payout: 'payReward',
  allowance: 'giveAllowance',
};
const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;
const WHOLE = /^\d{1,5}$/;

export default function KidActionPage() {
  return (
    <WithBottomBar>
      <KidActionScreen />
    </WithBottomBar>
  );
}

function KidActionScreen() {
  const { childId, mode: rawMode, taskId, dailyId } = useLocalSearchParams<{ childId: string; mode: Mode; taskId?: string; dailyId?: string }>();
  const mode: Mode = rawMode in TITLES ? rawMode : 'award';
  const { call } = useAuthedSession();
  const { t } = usePreferences();
  const format = useFormat();
  const kidsError = useKidsError();
  const [board, setBoard] = useState<KidBoard | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Form state shared by the modes.
  const [ruleId, setRuleId] = useState('');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [penaltyOn, setPenaltyOn] = useState<'points' | 'money'>('points');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [hasDue, setHasDue] = useState<'none' | 'date'>('none');
  const [weekdays, setWeekdays] = useState<string[]>(['0', '1', '2', '3', '4', '5', '6']);
  const weekdayNames = useWeekdayNames();
  const [due, setDue] = useState(toDateOnly(new Date()));

  useEffect(() => {
    call((s, r) => getKidBoard(s, childId, r))
      .then((next) => {
        setBoard(next);
        const daily = dailyId ? next.dailyTasks.find((x) => x.id === dailyId) : undefined;
        if (daily) {
          setTitle(daily.title);
          setDetails(daily.description ?? '');
          setPoints(String(daily.points));
          setWeekdays(daily.weekdays.map(String));
        }
        const task = taskId ? next.tasks.find((x) => x.id === taskId) : undefined;
        if (task) {
          setTitle(task.title);
          setDetails(task.description ?? '');
          setPoints(String(task.points));
          if (task.dueDate) {
            setHasDue('date');
            setDue(task.dueDate);
          }
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : t('loadError')));
  }, [call, childId, taskId, dailyId, t]);

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    who: { color: c.textSecondary, fontSize: 14, textAlign: d.start },
    hint: { color: c.muted, fontSize: 12, lineHeight: 18, textAlign: d.start },
    big: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (loadError) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="alert-circle-outline" title={t('childNotFound')} body={loadError} />
      </View>
    );
  }
  if (!board) {
    return (
      <View style={[s.screen, s.page]}>
        <Card><ListSkeleton rows={3} /></Card>
      </View>
    );
  }

  const { settings, currency } = board;
  const ruleKind: PointRuleKind | null = mode === 'award' ? 'BEHAVIOR' : mode === 'penalty' ? 'PENALTY' : mode === 'reward' ? 'REWARD' : null;
  const rules = ruleKind ? board.rules.filter((r) => r.kind === ruleKind) : [];
  const rule = rules.find((r) => r.id === ruleId);
  const pointsValue = Number(normalizeDigits(points));
  const pointsOk = WHOLE.test(normalizeDigits(points)) && pointsValue > 0;
  const amountValue = normalizeDigits(amount);
  const amountOk = AMOUNT.test(amountValue) && Number(amountValue) > 0;
  const max = mode === 'penalty' ? settings.maxPenaltyPoints : settings.maxAwardPoints;
  const editing = (mode === 'task' && Boolean(taskId)) || (mode === 'daily' && Boolean(dailyId));

  // Client-side checks mirror the server so buttons are only enabled for valid input; the server decides.
  let valid = false;
  let warning = '';
  switch (mode) {
    case 'award':
      valid = Boolean(rule) || (pointsOk && pointsValue <= max && reason.trim().length > 0);
      if (pointsOk && pointsValue > max) warning = t('kMaxHint', { max: format.number(max) });
      break;
    case 'penalty':
      if (penaltyOn === 'money') {
        valid = amountOk && Number(amountValue) <= Number(settings.maxPenaltyAmount) && Number(amountValue) <= Number(board.money) && reason.trim().length > 0;
        if (amountOk && Number(amountValue) > Number(board.money)) warning = t('kNotEnoughMoney');
      } else {
        valid = Boolean(rule) || (pointsOk && pointsValue <= max && reason.trim().length > 0);
        if (pointsOk && pointsValue > max) warning = t('kMaxHint', { max: format.number(max) });
      }
      break;
    case 'reward':
      valid = Boolean(rule) && rule!.points <= board.points;
      if (rule && rule.points > board.points) warning = t('kNotEnoughPoints');
      break;
    case 'daily':
      valid = title.trim().length > 0 && pointsOk && pointsValue <= settings.maxAwardPoints && weekdays.length > 0;
      if (pointsOk && pointsValue > settings.maxAwardPoints) warning = t('kMaxHint', { max: format.number(settings.maxAwardPoints) });
      break;
    case 'task':
      valid = title.trim().length > 0 && pointsOk && pointsValue <= settings.maxAwardPoints;
      if (pointsOk && pointsValue > settings.maxAwardPoints) warning = t('kMaxHint', { max: format.number(settings.maxAwardPoints) });
      break;
    case 'convert':
      valid = pointsOk && pointsValue <= board.points;
      if (pointsOk && pointsValue > board.points) warning = t('kNotEnoughPoints');
      break;
    case 'payout':
      valid = amountOk && Number(amountValue) <= Number(board.money);
      if (amountOk && Number(amountValue) > Number(board.money)) warning = t('kNotEnoughMoney');
      break;
    case 'allowance':
      valid = amountOk;
      break;
  }

  const submit = async () => {
    setBusy(true);
    setError('');
    const why = reason.trim() || undefined;
    try {
      await call((sess, r) => {
        switch (mode) {
          case 'award':
            return awardPoints(sess, childId, rule ? { ruleId: rule.id, reason: why } : { points: pointsValue, reason: why }, r);
          case 'penalty':
            if (penaltyOn === 'money') return penalizeKid(sess, childId, { amount: amountValue, reason: why }, r);
            return penalizeKid(sess, childId, rule ? { ruleId: rule.id, reason: why } : { points: pointsValue, reason: why }, r);
          case 'reward':
            return redeemReward(sess, childId, rule!.id, r);
          case 'daily': {
            const input = { title: title.trim(), description: details.trim() || null, points: pointsValue, weekdays: weekdays.map(Number) };
            return dailyId ? updateDailyTask(sess, dailyId, input, r) : createDailyTask(sess, childId, input, r);
          }
          case 'task': {
            const input = { title: title.trim(), description: details.trim() || null, dueDate: hasDue === 'date' ? due : null, points: pointsValue };
            return editing ? updateKidTask(sess, taskId!, input, r) : createKidTask(sess, childId, input, r);
          }
          case 'convert':
            return convertPoints(sess, childId, pointsValue, r);
          case 'payout':
          case 'allowance':
            return payKid(sess, childId, mode === 'payout' ? 'payouts' : 'allowances', { amount: amountValue, note: why }, r);
        }
      });
      if (router.canGoBack()) router.back();
      else router.replace(`/kids/${childId}`);
    } catch (err) {
      setError(kidsError(err));
    } finally {
      setBusy(false);
    }
  };

  const rulePicker = (label: StringKey) => (
    <Field label={t(label)}>
      {rules.length ? (
        <Chips
          options={[...rules.map((r) => ({ value: r.id, label: `${r.name} · ${t('kCost', { count: format.number(r.points) })}` })), ...(mode === 'reward' ? [] : [{ value: '', label: t('orCustom') }])]}
          value={ruleId}
          onChange={setRuleId}
        />
      ) : <Text style={s.hint}>{t('kNoRules')}</Text>}
    </Field>
  );
  const pointsField = (hint?: string) => (
    <Field label={t('kPointsField')} hint={hint}>
      <TextField value={points} onChange={setPoints} keyboardType="number-pad" placeholder={format.number(0)} />
    </Field>
  );
  const amountField = (hint?: string) => (
    <Field label={`${t('amount')} · ${currency}`} hint={hint}>
      <TextField value={amount} onChange={setAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
    </Field>
  );
  const reasonField = (placeholder: StringKey, label: StringKey = 'kReason') => (
    <Field label={t(label)}>
      <TextField value={reason} onChange={setReason} placeholder={t(placeholder)} />
    </Field>
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: editing ? t('kEdit') : t(TITLES[mode]) }} />
      <Text style={s.who}>
        {[board.child.name, t('pointsCount', { count: format.number(board.points) }), mode === 'payout' || mode === 'penalty' ? `${t('rewardMoney')}: ${format.money(board.money, currency)}` : null].filter(Boolean).join(' · ')}
      </Text>

      <Card style={{ gap: 14 }}>
        {mode === 'award' ? (
          <>
            {rulePicker('pickBehavior')}
            {!rule ? <>{pointsField(t('kMaxHint', { max: format.number(settings.maxAwardPoints) }))}{reasonField('kReasonPlaceholder')}</> : null}
          </>
        ) : null}

        {mode === 'penalty' ? (
          <>
            <Field label={t('kDeduct')}>
              <SegmentedControl options={[{ value: 'points', label: t('kDeductPoints') }, { value: 'money', label: t('kDeductMoney') }]} value={penaltyOn} onChange={(next) => { setPenaltyOn(next); setRuleId(''); }} />
            </Field>
            {penaltyOn === 'points' ? (
              <>
                {rulePicker('pickPenalty')}
                {!rule ? pointsField(t('kMaxHint', { max: format.number(settings.maxPenaltyPoints) })) : null}
                <Text style={s.hint}>{t('kDailyLimitHint', { max: format.number(settings.dailyPenaltyLimit) })}</Text>
              </>
            ) : amountField(`${t('kMaxHint', { max: format.money(settings.maxPenaltyAmount, currency) })} · ${t('kAvailable', { amount: format.money(board.money, currency) })}`)}
            {!rule ? reasonField('kPenaltyReasonPlaceholder') : null}
          </>
        ) : null}

        {mode === 'reward' ? rulePicker('pickReward') : null}

        {mode === 'daily' ? (
          <>
            <Field label={t('kTaskTitle')}>
              <TextField value={title} onChange={setTitle} placeholder={t('kTaskTitlePlaceholder')} />
            </Field>
            <Field label={t('kTaskDetails')}>
              <TextField value={details} onChange={setDetails} multiline />
            </Field>
            {pointsField(t('kMaxHint', { max: format.number(settings.maxAwardPoints) }))}
            <Field label={t('kRepeatOn')}>
              <Chips
                options={[{ value: 'all', label: t('kEveryDay') }, { value: 'pick', label: t('kPickDays') }]}
                value={weekdays.length === 7 ? 'all' : 'pick'}
                onChange={(v) => setWeekdays(v === 'all' ? ['0', '1', '2', '3', '4', '5', '6'] : [])}
              />
              <View style={{ height: 8 }} />
              <MultiChips options={weekdayNames.map((label, day) => ({ value: String(day), label }))} values={weekdays} onChange={setWeekdays} />
            </Field>
            <Text style={s.hint}>{t('kDailyHint')}</Text>
          </>
        ) : null}

        {mode === 'task' ? (
          <>
            <Field label={t('kTaskTitle')}>
              <TextField value={title} onChange={setTitle} placeholder={t('kTaskTitlePlaceholder')} />
            </Field>
            <Field label={t('kTaskDetails')}>
              <TextField value={details} onChange={setDetails} multiline />
            </Field>
            {pointsField(t('kMaxHint', { max: format.number(settings.maxAwardPoints) }))}
            <Field label={t('kDueDate')}>
              <SegmentedControl options={[{ value: 'none', label: t('kNoDueDate') }, { value: 'date', label: t('kWithDueDate') }]} value={hasDue} onChange={setHasDue} />
            </Field>
            {hasDue === 'date' ? <DatePicker value={due} onChange={setDue} /> : null}
          </>
        ) : null}

        {mode === 'convert' ? (
          <>
            {pointsField(t('kAvailable', { amount: format.number(board.points) }))}
            <Text style={s.hint}>{t('kConvertHint', { value: format.money(settings.pointValue, currency) })}</Text>
            {pointsOk ? <Text style={s.big}>{t('kYouGet', { amount: format.money(pointsValue * Number(settings.pointValue), currency) })}</Text> : null}
          </>
        ) : null}

        {mode === 'payout' ? (
          <>
            {amountField(t('kAvailable', { amount: format.money(board.money, currency) }))}
            {reasonField('notePlaceholder', 'optionalNote')}
            <Text style={s.hint}>{t('kPayoutHint')}</Text>
          </>
        ) : null}

        {mode === 'allowance' ? (
          <>
            {amountField()}
            {reasonField('notePlaceholder', 'optionalNote')}
            <Text style={s.hint}>{t('kAllowanceHint')}</Text>
          </>
        ) : null}

        {warning ? <Text style={s.error}>{warning}</Text> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        <PrimaryButton label={editing ? t('saveChanges') : t(TITLES[mode])} icon="checkmark" busy={busy} disabled={!valid} onPress={() => void submit()} />
      </Card>
    </ScrollView>
  );
}

import { useState } from 'react';
import { View } from 'react-native';
import type { FundingPart, FundingSource } from './api';
import { Chips, Field, normalizeDigits, TextField } from './formControls';
import type { StringKey } from './i18n';
import { useFormat, usePreferences, useStyles } from './preferences';
import { useSession } from './SessionContext';
import { Text } from './typography';

export const FUNDING_SOURCES: FundingSource[] = ['SALARY', 'PERSONAL', 'HOUSEHOLD', 'OTHER'];
export const fundingLabel = (source: FundingSource): StringKey => `funding_${source}` as StringKey;
const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;
const thousandths = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
};

type Choice = FundingSource | 'SPLIT';

/**
 * "Funded by": who pays for an expense or payment — the salary, personal funds, household contributions,
 * other, or a split. Nothing is chosen until the user picks (the form can't be saved before).
 */
export function useFunding(initial?: FundingPart[] | null) {
  const [choice, setChoice] = useState<Choice | null>(() => (!initial ? null : initial.length === 1 ? initial[0].source : 'SPLIT'));
  const [parts, setParts] = useState<Partial<Record<FundingSource, string>>>(() =>
    initial && initial.length > 1 ? Object.fromEntries(initial.map((part) => [part.source, part.amount])) : {},
  );
  return { choice, setChoice, parts, setParts };
}
export type FundingState = ReturnType<typeof useFunding>;

/** The funding to send for `amount` (null until a valid choice is made), and what a split still lacks. */
export function resolveFunding(state: FundingState, amount: string): { funding: FundingPart[] | null; remainder: number } {
  const total = normalizeDigits(amount);
  if (!state.choice || !AMOUNT.test(total) || Number(total) <= 0) return { funding: null, remainder: 0 };
  if (state.choice !== 'SPLIT') return { funding: [{ source: state.choice, amount: total }], remainder: 0 };
  const filled = FUNDING_SOURCES.map((source) => ({ source, amount: normalizeDigits(state.parts[source] ?? '') })).filter((part) => part.amount !== '' && Number(part.amount) > 0);
  const valid = filled.every((part) => AMOUNT.test(part.amount));
  const sum = filled.reduce((t, part) => t + (AMOUNT.test(part.amount) ? thousandths(part.amount) : 0), 0);
  const remainder = (thousandths(total) - sum) / 1000;
  return { funding: filled.length && valid && remainder === 0 ? filled : null, remainder };
}

export function FundingPicker({ state, amount, currency }: { state: FundingState; amount: string; currency: string }) {
  const { t } = usePreferences();
  const format = useFormat();
  const { session } = useSession();
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 10 },
    label: { width: 120, color: c.textSecondary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    note: { color: c.muted, fontSize: 12, textAlign: d.start },
    warn: { color: c.danger, fontSize: 12, textAlign: d.start },
  }));
  // Personal funds are the father's private money.
  const sources = FUNDING_SOURCES.filter((source) => source !== 'PERSONAL' || session?.user.role === 'FATHER');
  const { remainder } = resolveFunding(state, amount);
  return (
    <Field label={t('fundedBy')}>
      <Chips<Choice>
        options={[...sources.map((source) => ({ value: source as Choice, label: t(fundingLabel(source)) })), { value: 'SPLIT', label: t('fundingSplit') }]}
        value={state.choice}
        onChange={state.setChoice}
      />
      {state.choice === 'SPLIT' ? (
        <View style={{ gap: 8 }}>
          {sources.map((source) => (
            <View key={source} style={s.row}>
              <Text style={s.label}>{t(fundingLabel(source))}</Text>
              <View style={{ flex: 1 }}>
                <TextField value={state.parts[source] ?? ''} onChange={(value) => state.setParts({ ...state.parts, [source]: value })} keyboardType="decimal-pad" placeholder={format.number(0)} />
              </View>
            </View>
          ))}
          <Text style={remainder === 0 ? s.note : s.warn}>
            {remainder === 0 ? t('fundingSplitDone') : t('fundingSplitLeft', { amount: format.rawMoney(remainder, currency) })}
          </Text>
        </View>
      ) : null}
      {!state.choice ? <Text style={s.note}>{t('fundingRequired')}</Text> : null}
    </Field>
  );
}

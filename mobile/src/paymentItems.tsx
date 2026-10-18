import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Payment, PaymentItem } from './api';
import { Card, SmallButton } from './components';
import { Chips, DatePicker, normalizeDigits, TextField, toDateOnly } from './formControls';
import { useFormat, usePreferences, useStyles } from './preferences';
import { useSubjectLabel, useSubjects } from './subjects';
import { Text } from './typography';

/** A lesson being edited in the payment form; `key` keeps rows stable while editing. */
export type ItemDraft = { key: string; subject: string; date: string; amount: string };

const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;
let nextKey = 0;
const newKey = () => `item-${Date.now()}-${nextKey++}`;

export const draftsFrom = (items: PaymentItem[]): ItemDraft[] =>
  items.map((item) => ({ key: newKey(), subject: item.subject ?? '', date: item.date ?? toDateOnly(new Date()), amount: item.amount }));

export const itemsFrom = (drafts: ItemDraft[]): PaymentItem[] =>
  drafts.map((draft) => ({ subject: draft.subject || null, date: draft.date, amount: normalizeDigits(draft.amount) }));

export const itemValid = (draft: ItemDraft) => {
  const amount = normalizeDigits(draft.amount);
  return Boolean(draft.subject) && AMOUNT.test(amount) && Number(amount) > 0;
};

/**
 * Exact sum of the lessons, as the server computes it: whole thousandths, so 0.1 + 0.2 is 0.3.
 * Empty when any amount isn't a number yet.
 */
export function itemsTotal(drafts: ItemDraft[]) {
  let thousandths = 0;
  for (const draft of drafts) {
    const amount = normalizeDigits(draft.amount);
    if (!AMOUNT.test(amount)) return '';
    const [whole, fraction = ''] = amount.split('.');
    thousandths += Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  }
  const whole = Math.floor(thousandths / 1000);
  const fraction = String(thousandths % 1000).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** The lessons a payment covers: subject, date and amount each; the payment amount is their total. */
export function LessonItemsEditor({ items, onChange, currency }: { items: ItemDraft[]; onChange: (items: ItemDraft[]) => void; currency: string }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const label = useSubjectLabel();
  const { subjects } = useSubjects();
  const [openDate, setOpenDate] = useState<string | null>(null);
  const s = useStyles((c, d) => ({
    head: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    title: { color: c.text, fontSize: 16, fontWeight: '800' as const, textAlign: d.start },
    hint: { color: c.muted, fontSize: 12, lineHeight: 18, textAlign: d.start },
    item: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.hairline },
    itemHead: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    itemTitle: { color: c.textSecondary, fontSize: 14, fontWeight: '800' as const },
    remove: { width: 34, height: 34, borderRadius: 17, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.dangerSoft },
    row: { flexDirection: d.row, gap: 10 },
    dateButton: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, flexDirection: d.row, alignItems: 'center' as const, gap: 8, backgroundColor: c.background },
    dateText: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    total: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.hairline },
    totalLabel: { color: c.text, fontSize: 15, fontWeight: '800' as const },
    totalValue: { color: c.primary, fontSize: 20, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
  }));
  const active = subjects.filter((x) => x.isActive).map((x) => x.key);
  const update = (key: string, patch: Partial<ItemDraft>) => onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const add = () => {
    // A new lesson starts like the last one (same subject and price), dated today.
    const last = items[items.length - 1];
    onChange([...items, { key: newKey(), subject: last?.subject ?? active[0] ?? '', date: toDateOnly(new Date()), amount: last?.amount ?? '' }]);
  };
  const total = itemsTotal(items);

  return (
    <Card style={{ gap: 12 }}>
      <View style={s.head}>
        <Text style={s.title}>{t('lessonItems')}</Text>
        <SmallButton label={t('addLessonItem')} icon="add" onPress={add} />
      </View>
      <Text style={s.hint}>{items.length ? t('lessonItemsHint') : t('lessonItemsEmpty')}</Text>
      {items.map((item, index) => {
        const options = item.subject && !active.includes(item.subject) ? [item.subject, ...active] : active;
        return (
          <View key={item.key} style={s.item}>
            <View style={s.itemHead}>
              <Text style={s.itemTitle}>{t('lessonN', { n: format.number(index + 1) })}</Text>
              <Pressable onPress={() => onChange(items.filter((x) => x.key !== item.key))} style={({ pressed }) => [s.remove, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t('removeLessonItem')}>
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
              </Pressable>
            </View>
            <Chips options={options.map((key) => ({ value: key, label: label(key) }))} value={item.subject || null} onChange={(subject) => update(item.key, { subject })} />
            <View style={s.row}>
              <Pressable onPress={() => setOpenDate(openDate === item.key ? null : item.key)} style={s.dateButton} accessibilityRole="button">
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <Text style={s.dateText} numberOfLines={1}>{format.date(item.date)}</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <TextField value={item.amount} onChange={(amount) => update(item.key, { amount })} placeholder={t('amount')} keyboardType="decimal-pad" />
              </View>
            </View>
            {openDate === item.key ? <DatePicker value={item.date} onChange={(date) => { update(item.key, { date }); setOpenDate(null); }} /> : null}
          </View>
        );
      })}
      {items.length ? (
        <View style={s.total}>
          <Text style={s.totalLabel}>{t('lessonItemsTotal', { count: format.number(items.length) })}</Text>
          <Text style={s.totalValue}>{total ? format.money(total, currency) : '—'}</Text>
        </View>
      ) : null}
    </Card>
  );
}

/** The lessons a payment covers, each with its subject, date and price, and the total. */
export function LessonItemsList({ payment }: { payment: Payment }) {
  const { t } = usePreferences();
  const format = useFormat();
  const label = useSubjectLabel();
  const s = useStyles((c, d) => ({
    title: { color: c.text, fontSize: 16, fontWeight: '800' as const, textAlign: d.start, marginBottom: 4 },
    row: { flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.hairline },
    index: { width: 28, height: 28, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
    indexText: { color: c.primary, fontSize: 13, fontWeight: '800' as const },
    name: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    sub: { color: c.muted, fontSize: 12, marginTop: 2, textAlign: d.start },
    amount: { color: c.text, fontSize: 15, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    total: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border },
    totalLabel: { color: c.text, fontSize: 15, fontWeight: '800' as const },
    totalValue: { color: c.primary, fontSize: 18, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
  }));
  return (
    <Card>
      <Text style={s.title}>{t('lessonItems')}</Text>
      {payment.items.map((item, index) => (
        <View key={item.id ?? index} style={s.row}>
          <View style={s.index}><Text style={s.indexText}>{format.number(index + 1)}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={1}>{item.subject ? label(item.subject) : t('lessonN', { n: format.number(index + 1) })}</Text>
            {item.date ? <Text style={s.sub}>{format.date(item.date)}</Text> : null}
          </View>
          <Text style={s.amount}>{format.money(item.amount, payment.currency)}</Text>
        </View>
      ))}
      <View style={s.total}>
        <Text style={s.totalLabel}>{t('lessonItemsTotal', { count: format.number(payment.items.length) })}</Text>
        <Text style={s.totalValue}>{format.money(payment.amount, payment.currency)}</Text>
      </View>
    </Card>
  );
}

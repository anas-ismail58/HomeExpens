import { router } from 'expo-router';
import { useState } from 'react';
import { ExpenseRow, Card, EmptyState, ListSkeleton, MonthSwitcher, SectionTitle } from '../../components';
import { ListPage } from '../../manageUi';
import { useFormat, usePreferences } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { shiftMonth, thisMonth, useMonthlyReport } from '../../useMonthlyReport';

/** Every expense of a month (lessons, household, paid bills…), newest first. */
export default function TransactionsPage() {
  const { session } = useAuthedSession();
  const { t } = usePreferences();
  const format = useFormat();
  const [month, setMonth] = useState(thisMonth);
  const { report, loading, refreshing, error, refresh } = useMonthlyReport(month);
  const currency = report?.currency ?? session.family.currency;
  const rows = [...(report?.expenses ?? [])].sort((a, b) => (b.occurredAt ?? b.date).localeCompare(a.occurredAt ?? a.date));
  const total = rows.reduce((sum, row) => sum + Number(row.familyAmount), 0);
  return (
    <ListPage error={error} refreshing={refreshing} onRefresh={() => void refresh()}>
      <MonthSwitcher month={month} onChange={(amount) => setMonth((m) => shiftMonth(m, amount))} />
      <SectionTitle title={`${t('allTransactionsTitle')} · ${format.money(total, currency)}`} count={rows.length} />
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {loading ? <ListSkeleton rows={5} /> : rows.length ? rows.map((row, index) => (
          <ExpenseRow key={row.id} expense={row} currency={currency} last={index === rows.length - 1} onPress={() => router.push(`/expense/${row.id}`)} />
        )) : <EmptyState icon="receipt-outline" title={t('noExpenses')} body={t('noExpensesBody')} />}
      </Card>
    </ListPage>
  );
}

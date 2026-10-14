import { router } from 'expo-router';
import { useState } from 'react';
import { ExpenseRow, Card, EmptyState, ListSkeleton, MonthSwitcher, PrimaryButton, SectionTitle, isLesson } from '../../components';
import { ListPage } from '../../manageUi';
import { useFormat, usePreferences } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { shiftMonth, thisMonth, useMonthlyReport } from '../../useMonthlyReport';

/** Every lesson of a month, newest first; each opens its details. */
export default function LessonsPage() {
  const { session } = useAuthedSession();
  const { t } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const [month, setMonth] = useState(thisMonth);
  const { report, loading, refreshing, error, refresh } = useMonthlyReport(month);
  const currency = report?.currency ?? session.family.currency;
  const lessons = (report?.expenses ?? []).filter(isLesson).sort((a, b) => (b.occurredAt ?? b.date).localeCompare(a.occurredAt ?? a.date));
  const total = lessons.reduce((sum, lesson) => sum + Number(lesson.familyAmount), 0);
  return (
    <ListPage allowed={can('SERVICE_LESSONS')} error={error} refreshing={refreshing} onRefresh={() => void refresh()}>
      {can('ADD_EXPENSE') ? <PrimaryButton label={t('newLesson')} icon="add" onPress={() => router.push('/create/lesson')} /> : null}
      <MonthSwitcher month={month} onChange={(amount) => setMonth((m) => shiftMonth(m, amount))} />
      <SectionTitle title={`${t('allLessonsTitle')} · ${format.money(total, currency)}`} count={lessons.length} />
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {loading ? <ListSkeleton rows={4} /> : lessons.length ? lessons.map((lesson, index) => (
          <ExpenseRow key={lesson.id} expense={lesson} currency={currency} last={index === lessons.length - 1} onPress={() => router.push(`/expense/${lesson.id}`)} />
        )) : <EmptyState icon="school-outline" title={t('noLessons')} body={t('noLessonsBody')} />}
      </Card>
    </ListPage>
  );
}

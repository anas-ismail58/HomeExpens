import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { getChildren, getMonthlyReport, type Child, type MonthlyReport } from './api';
import { useSession } from './SessionContext';

export function thisMonth() {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Riyadh' })
    .format(new Date())
    .slice(0, 7);
}

export function shiftMonth(month: string, amount: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Loads the month's report + children, and reloads whenever the screen regains focus. */
export function useMonthlyReport(month: string) {
  const { call } = useSession();
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const loadedMonth = useRef<string | null>(null);
  // Only the newest request may update the screen: switching months quickly must never let an
  // older (slower) response overwrite the month that's showing.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const [nextReport, nextChildren] = await Promise.all([
        call((s, onRefresh) => getMonthlyReport(s, month, onRefresh)),
        call(getChildren),
      ]);
      if (request !== latest.current) return;
      setReport(nextReport);
      setChildren(nextChildren);
      setError('');
    } catch (err) {
      if (request !== latest.current) return;
      setError(err instanceof Error ? err.message : 'تعذر تحميل المصاريف.');
    } finally {
      if (request === latest.current) {
        loadedMonth.current = month;
        setLoading(false);
      }
    }
  }, [call, month]);

  useFocusEffect(
    useCallback(() => {
      if (loadedMonth.current !== month) setLoading(true);
      void load();
    }, [load, month]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { report, children, loading, refreshing, error, refresh };
}

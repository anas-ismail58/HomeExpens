import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCountries, setSelectedCountry, type Country, type CurrencyCode } from './api';
import { useSession } from './SessionContext';

/**
 * The countries the family spends in, and which one the app is showing. 'all' combines every country in
 * the family currency. The choice is remembered per family on this device and sent with every request.
 */
type CountryState = {
  countries: Country[];
  /** A country id, or 'all'. */
  selected: string;
  /** The selected country (null when showing all). */
  current: Country | null;
  /** Currency new amounts start in: the selected country's, or the default country's for "all". */
  inputCurrency: CurrencyCode;
  /** Bumped when the selection changes, so screens can reload (used as a React key). */
  version: number;
  /** The saved selection and the country list are loaded (or the server has no countries). */
  ready: boolean;
  select: (selected: string) => void;
  reload: () => Promise<void>;
};

const CountryContext = createContext<CountryState | null>(null);
const storageKey = (familyId: string) => `country:${familyId}`;

export function CountryProvider({ children }: { children: ReactNode }) {
  const { session, call } = useSession();
  const familyId = session?.family.id ?? null;
  const familyCurrency = session?.family.currency as CurrencyCode | undefined;
  // Tagged with the family it was loaded for, so switching account never shows the previous family's list.
  const [loaded, setLoaded] = useState<{ familyId: string | null; countries: Country[]; selected: string; ready: boolean }>({ familyId: null, countries: [], selected: 'all', ready: false });
  const [version, setVersion] = useState(0);
  const mine = loaded.familyId === familyId ? loaded : { familyId, countries: [] as Country[], selected: 'all', ready: false };

  const reload = useCallback(async () => {
    if (!familyId) return;
    try {
      const list = await call(getCountries);
      // A removed country falls back to all countries.
      setLoaded((current) => {
        const wanted = current.familyId === familyId ? current.selected : 'all';
        const selected = wanted === 'all' || list.some((c) => c.id === wanted) ? wanted : 'all';
        // Set before the screens re-render, so their first requests already carry the country.
        setSelectedCountry(list.length ? selected : null);
        return { familyId, countries: list, selected, ready: true };
      });
    } catch {
      // Older servers have no countries: everything stays as before.
      setLoaded((current) => ({ ...(current.familyId === familyId ? current : { familyId, countries: [], selected: 'all' }), ready: true }));
    }
  }, [call, familyId]);

  useEffect(() => {
    if (!familyId) return;
    let active = true;
    AsyncStorage.getItem(storageKey(familyId))
      .catch(() => null)
      .then((saved) => {
        if (!active) return;
        if (saved) setLoaded((current) => ({ familyId, countries: current.familyId === familyId ? current.countries : [], selected: saved, ready: current.familyId === familyId && current.ready }));
        return reload();
      });
    return () => {
      active = false;
    };
  }, [familyId, reload]);

  // Only send a country the server knows; nothing until the list is loaded (the server then shows all).
  const effective = mine.countries.some((c) => c.id === mine.selected) ? mine.selected : 'all';
  const hasCountries = mine.countries.length > 0;
  useEffect(() => {
    setSelectedCountry(hasCountries ? effective : null);
  }, [hasCountries, effective]);

  const select = useCallback(
    (next: string) => {
      setSelectedCountry(next);
      setLoaded((current) => ({ ...current, selected: next }));
      setVersion((v) => v + 1);
      if (familyId) void AsyncStorage.setItem(storageKey(familyId), next).catch(() => undefined);
    },
    [familyId],
  );

  const countries = mine.countries;
  const value = useMemo<CountryState>(() => {
    const current = countries.find((c) => c.id === effective) ?? null;
    const fallback = countries.find((c) => c.isDefault)?.currency ?? familyCurrency ?? 'EGP';
    return { countries, selected: effective, current, inputCurrency: current?.currency ?? fallback, version, ready: mine.ready || !familyId, select, reload };
  }, [countries, effective, familyCurrency, familyId, mine.ready, reload, select, version]);

  return <CountryContext.Provider value={value}>{children}</CountryContext.Provider>;
}

/** The selected country's currency (amounts are shown in it), or null for all countries / outside the app. */
export function useSelectedCurrency(): CurrencyCode | null {
  return useContext(CountryContext)?.current?.currency ?? null;
}

export function useCountries() {
  const value = useContext(CountryContext);
  if (!value) throw new Error('useCountries must be used inside CountryProvider');
  return value;
}

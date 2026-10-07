import type { Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';

type Rates = { base: string; rates: Record<string, number>; updatedAt: string; source: string };

const SOURCE = 'https://open.er-api.com/v6/latest/USD';
const TTL_MS = 6 * 60 * 60 * 1000;
const SUPPORTED = ['EGP', 'SAR', 'USD', 'EUR', 'AED', 'KWD', 'QAR', 'BHD'];

let cache: { value: Rates; fetchedAt: number } | null = null;

/** USD-based exchange rates, cached in memory (the upstream API refreshes once a day). */
export async function getExchangeRates(): Promise<Rates> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.value;
  try {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(5000) });
    const body = (await response.json()) as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
    if (!response.ok || body.result !== 'success' || !body.rates) throw new Error('Bad rates response');
    const rates = Object.fromEntries(SUPPORTED.filter((code) => body.rates?.[code]).map((code) => [code, body.rates![code]]));
    const value = {
      base: 'USD',
      rates,
      updatedAt: new Date((body.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString(),
      source: 'open.er-api.com',
    };
    cache = { value, fetchedAt: Date.now() };
    return value;
  } catch {
    // Serve stale rates rather than failing if the upstream is briefly down.
    if (cache) return cache.value;
    throw new AppError(503, 'Exchange rates are unavailable right now', [], 'RATES_UNAVAILABLE');
  }
}

/** Converts an amount between currencies with today's rates; rates are only fetched when they differ. */
export async function convertAmount(amount: Prisma.Decimal, from: string, to: string) {
  if (from === to) return amount;
  const rates = (await getExchangeRates()).rates;
  if (!rates[from] || !rates[to]) throw new AppError(503, `No exchange rate for ${from} → ${to}`, [], 'RATES_UNAVAILABLE');
  return amount.div(rates[from]).mul(rates[to]).toDecimalPlaces(3);
}

/**
 * ZKA-safe rate-series cache (OWM-T0746).
 *
 * getRate(currency, date) is a pure client-side cache lookup. It never
 * triggers a network request scoped to a single transaction: doing that
 * per row would tell ORBI the exact dates and currencies a household
 * transacted in, which is a fingerprint even though no amount or
 * plaintext ever leaves the client. See OWM-T0159's ZKA constraint
 * section for the full argument.
 *
 * loadRateSeries / loadFullRateMatrix fetch a whole date range in one
 * request per currency -- a request shape that is identical for every
 * OWM client and does not vary with which household is asking. No
 * account id, household id, transaction id, amount, or user identifier
 * ever enters the request.
 */
import { fetchBTCRateRange, type ORBIRatePoint } from "./orbi-rates";

export type RangeFetcher = (
  target: string,
  startAt: Date,
  endAt: Date,
) => Promise<ORBIRatePoint[]>;

interface LoadedRange {
  start: string;
  end: string;
}

// currency -> UTC day key ("YYYY-MM-DD") -> rate
const cache = new Map<string, Map<string, number>>();
// currency -> ranges already fetched, so a repeated call is a no-op
const loadedRanges = new Map<string, LoadedRange[]>();

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRangeLoaded(currency: string, start: Date, end: Date): boolean {
  const ranges = loadedRanges.get(currency);
  if (!ranges) return false;
  const s = dayKey(start);
  const e = dayKey(end);
  return ranges.some((r) => r.start <= s && r.end >= e);
}

/**
 * Load the full BTC-to-`currency` rate series for [start, end] into the
 * in-memory cache. Safe to call repeatedly: a range already covered by a
 * prior load is a no-op and triggers no network call.
 */
export async function loadRateSeries(
  currency: string,
  start: Date,
  end: Date,
  fetcher: RangeFetcher = fetchBTCRateRange,
): Promise<void> {
  const target = currency.toUpperCase();
  if (target === "BTC") return;
  if (isRangeLoaded(target, start, end)) return;

  const points = await fetcher(target, start, end);

  let byDay = cache.get(target);
  if (!byDay) {
    byDay = new Map();
    cache.set(target, byDay);
  }
  // Points arrive oldest first (see fetchBTCRateRange's order clause), so
  // when more than one bucket lands on the same calendar day this keeps
  // the latest-in-day rate.
  for (const p of points) {
    byDay.set(p.bucketTs.slice(0, 10), p.rate);
  }

  const ranges = loadedRanges.get(target) ?? [];
  ranges.push({ start: dayKey(start), end: dayKey(end) });
  loadedRanges.set(target, ranges);
}

/**
 * Load the full supported matrix (every fiat currency this app supports,
 * BTC pivot) for [start, end]. This is the ZKA-safe entry point: it always
 * requests the whole matrix, never only the currencies one household
 * happens to use, so the request shape never varies with who is asking.
 */
export async function loadFullRateMatrix(
  currencies: string[],
  start: Date,
  end: Date,
  fetcher?: RangeFetcher,
): Promise<void> {
  await Promise.all(currencies.map((c) => loadRateSeries(c, start, end, fetcher)));
}

/**
 * Look up the cached BTC-to-`currency` rate for the calendar day (UTC)
 * containing `date`. Returns undefined when that day was never loaded or
 * ORBI had no CONFIRMED rate for it -- never a guess, and never today's
 * rate substituted for a missing historical one.
 */
export function getRate(currency: string, date: Date): number | undefined {
  const target = currency.toUpperCase();
  if (target === "BTC") return 1;
  const byDay = cache.get(target);
  if (!byDay) return undefined;
  return byDay.get(dayKey(date));
}

/** Test-only: clears all cached rates and load-range bookkeeping. */
export function __resetRateCacheForTests(): void {
  cache.clear();
  loadedRanges.clear();
}

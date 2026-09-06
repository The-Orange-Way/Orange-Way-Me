/**
 * ZKA-safe rate-series cache for OWM's 3-currency transaction display
 * (OWM-T0159, this ticket OWM-T0746).
 *
 * Serves getRate(currency, date) from an in-memory cache fed by
 * fetchRateMatrix (src/lib/orbi-rates.ts), which reads every supported
 * currency for a date range in one request. See that function's doc comment
 * for why the request carries no currency filter and no household, account
 * or user identifier: narrowing either would tell ORBI, a different
 * organisation, which currencies and how many distinct dates one household
 * cares about, even though no amount or plaintext is ever disclosed.
 */
import { fetchRateMatrix } from "./orbi-rates";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function cacheKey(currency: string, date: Date): string {
  return `${currency.toUpperCase()}|${dayKey(date)}`;
}

interface LoadedRange {
  start: string;
  end: string;
}

const rateCache = new Map<string, number>();
const loadedRanges: LoadedRange[] = [];
const inflight = new Map<string, Promise<void>>();

function isDayLoaded(day: string): boolean {
  return loadedRanges.some((r) => day >= r.start && day <= r.end);
}

/** The default fetch window for a single date miss: the calendar month it falls in. */
function defaultRangeFor(date: Date): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59));
  return { start, end, key: `${dayKey(start)}_${dayKey(end)}` };
}

async function loadRange(start: Date, end: Date): Promise<void> {
  const rows = await fetchRateMatrix(start, end);
  for (const row of rows) {
    rateCache.set(`${row.targetCurrency}|${row.bucketTs.slice(0, 10)}`, row.rate);
  }
  loadedRanges.push({ start: dayKey(start), end: dayKey(end) });
}

function loadOnce(start: Date, end: Date, key: string): Promise<void> {
  let p = inflight.get(key);
  if (!p) {
    p = loadRange(start, end);
    inflight.set(key, p);
  }
  return p;
}

/**
 * Prefetch the full matrix for an explicit range in one request, e.g. the
 * whole span of a household's ledger. Prefer this over relying on getRate's
 * own lazy per-month fetch when the caller already knows the range: one
 * wide request up front is safer than several narrower ones triggered
 * incidentally as a list scrolls.
 */
export async function primeRateRange(start: Date, end: Date): Promise<void> {
  await loadOnce(start, end, `${dayKey(start)}_${dayKey(end)}`);
}

/**
 * The rate for `currency` on `date`, from cache. On a miss, fetches (and
 * caches, deduped) the calendar month containing `date` so repeated lookups
 * across a month of transactions cost one request. Returns undefined, never
 * a substituted or guessed value, when no rate exists for that bucket even
 * after the fetch completes.
 */
export async function getRate(currency: string, date: Date): Promise<number | undefined> {
  const key = cacheKey(currency, date);
  if (rateCache.has(key)) return rateCache.get(key);

  const day = dayKey(date);
  if (!isDayLoaded(day)) {
    const { start, end, key: rangeKey } = defaultRangeFor(date);
    await loadOnce(start, end, rangeKey);
  }
  return rateCache.get(key);
}

/** Test-only: clear all cached state between test cases. */
export function __resetRateCacheForTests(): void {
  rateCache.clear();
  loadedRanges.length = 0;
  inflight.clear();
}

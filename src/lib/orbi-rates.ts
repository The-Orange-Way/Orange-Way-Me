/**
 * ORBI rate provider — Orange Way Phase 1 integration.
 *
 * Reads multi-source volume-weighted-median Bitcoin rates from the Orange
 * Rails Bitcoin Index (ORBI). The anon key is safe to ship in the browser
 * bundle — RLS on the Orange Rails production database blocks every write
 * path; reads return only CONFIRMED rates.
 *
 * Env (build time):
 *   VITE_ORBI_SUPABASE_URL
 *   VITE_ORBI_SUPABASE_ANON_KEY
 *
 * Wired in via:
 *   - src/lib/fx-rates.ts — convert() reads the cached live rate for BTC↔fiat
 *   - src/routes/__root.tsx — bootstraps a refresh on app load and every 60s
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let orbiClient: SupabaseClient | null = null;

function getORBIClient(): SupabaseClient {
  if (orbiClient) return orbiClient;
  const url = import.meta.env.VITE_ORBI_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_ORBI_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error("ORBI not configured");
  orbiClient = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { "x-orbi-client": "owm/0.1.0" } },
  });
  return orbiClient;
}

export interface ORBIRate {
  id: string;
  rate: number;
  tier: "A" | "B" | "B-single" | "C-composite" | "stable";
  bucketTs: string;
  providerCount: number;
  composite: boolean;
}

/**
 * The public fiat matrix fetched for every annual series request. Keeping this
 * fixed prevents a household's currency choices from becoming request data.
 */
export const ORBI_RATE_TARGETS = ["USD", "CAD", "EUR", "GBP"] as const;

export type ORBIRateTarget = (typeof ORBI_RATE_TARGETS)[number];

export type ORBIRateSeries = Readonly<Record<ORBIRateTarget, readonly ORBIRate[]>>;

const SERIES_PAGE_SIZE = 1_000;
const annualSeriesCache = new Map<number, ORBIRateSeries>();
const annualSeriesRequests = new Map<number, Promise<ORBIRateSeries | null>>();

interface ORBIRateRow {
  id: string;
  rate: number | string;
  tier: ORBIRate["tier"];
  bucket_ts: string;
  provider_count: number;
  composite: boolean;
  target_currency: string;
}

function mapRate(row: ORBIRateRow): ORBIRate {
  return Object.freeze({
    id: row.id,
    rate: Number(row.rate),
    tier: row.tier,
    bucketTs: row.bucket_ts,
    providerCount: row.provider_count,
    composite: row.composite,
  });
}

function emptyRateSeries(): Record<ORBIRateTarget, ORBIRate[]> {
  return { USD: [], CAD: [], EUR: [], GBP: [] };
}

function partitionBucketTs(effectiveAt: Date): string {
  const minuteFloor = Math.floor(effectiveAt.getTime() / 60_000) * 60_000;
  return new Date(minuteFloor - 60_000).toISOString();
}

/**
 * Point lookup for non-ledger callers. Never call this once per transaction:
 * exact request timestamps expose ledger shape. Use fetchBTCRateSeries for
 * historical transaction conversion.
 */
export async function fetchBTCRate(target: string, effectiveAt: Date): Promise<ORBIRate | null> {
  let client: SupabaseClient;
  try {
    client = getORBIClient();
  } catch {
    return null;
  }
  const bucketTs = partitionBucketTs(effectiveAt);

  const { data, error } = await client
    .from("exchange_rates")
    .select("id, rate, tier, bucket_ts, provider_count, composite")
    .eq("source_currency", "BTC")
    .eq("target_currency", target.toUpperCase())
    .eq("product", "ORBI-M")
    .eq("granularity", "1m")
    .eq("status", "CONFIRMED")
    .eq("bucket_ts", bucketTs)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    rate: Number(data.rate),
    tier: data.tier as ORBIRate["tier"],
    bucketTs: data.bucket_ts,
    providerCount: data.provider_count,
    composite: data.composite,
  };
}

/**
 * Fetch a complete calendar year's daily BTC rates for the full public fiat
 * matrix. The query never contains household, account, transaction, amount,
 * or selected-currency data, and its boundaries never reveal transaction
 * timestamps.
 *
 * Successful results are cached for this browser session, including
 * concurrent callers. Consumers must request this series outside per-row
 * rendering and do historical conversion locally.
 */
export function fetchBTCRateSeries(year: number): Promise<ORBIRateSeries | null> {
  if (!Number.isInteger(year) || year < 1970 || year > 9998) {
    return Promise.resolve(null);
  }

  const cached = annualSeriesCache.get(year);
  if (cached) return Promise.resolve(cached);

  const pending = annualSeriesRequests.get(year);
  if (pending) return pending;

  const request = (async () => {
    try {
      const series = await fetchUncachedBTCRateSeries(year);
      if (series) annualSeriesCache.set(year, series);
      return series;
    } catch {
      return null;
    } finally {
      annualSeriesRequests.delete(year);
    }
  })();
  annualSeriesRequests.set(year, request);
  return request;
}

async function fetchUncachedBTCRateSeries(year: number): Promise<ORBIRateSeries | null> {
  let client: SupabaseClient;
  try {
    client = getORBIClient();
  } catch {
    return null;
  }

  const start = `${year.toString().padStart(4, "0")}-01-01T00:00:00.000Z`;
  const end = `${(year + 1).toString().padStart(4, "0")}-01-01T00:00:00.000Z`;
  const rows: ORBIRateRow[] = [];

  for (let from = 0; ; from += SERIES_PAGE_SIZE) {
    const { data, error } = await client
      .from("exchange_rates")
      .select("id, rate, tier, bucket_ts, provider_count, composite, target_currency")
      .eq("source_currency", "BTC")
      .in("target_currency", [...ORBI_RATE_TARGETS])
      .eq("product", "ORBI-M")
      .eq("granularity", "1d")
      .eq("status", "CONFIRMED")
      .gte("bucket_ts", start)
      .lt("bucket_ts", end)
      .order("target_currency", { ascending: true })
      .order("bucket_ts", { ascending: true })
      .range(from, from + SERIES_PAGE_SIZE - 1);

    if (error || !data) return null;
    rows.push(...(data as ORBIRateRow[]));
    if (data.length < SERIES_PAGE_SIZE) break;
  }

  const series = emptyRateSeries();
  for (const row of rows) {
    if (!ORBI_RATE_TARGETS.includes(row.target_currency as ORBIRateTarget)) continue;
    series[row.target_currency as ORBIRateTarget].push(mapRate(row));
  }

  for (const target of ORBI_RATE_TARGETS) Object.freeze(series[target]);
  return Object.freeze(series);
}

export async function fetchLatestBTCRate(target: string): Promise<ORBIRate | null> {
  let client: SupabaseClient;
  try {
    client = getORBIClient();
  } catch {
    return null;
  }
  const { data, error } = await client
    .from("exchange_rates")
    .select("id, rate, tier, bucket_ts, provider_count, composite")
    .eq("source_currency", "BTC")
    .eq("target_currency", target.toUpperCase())
    .eq("product", "ORBI-M")
    .eq("granularity", "1m")
    .eq("status", "CONFIRMED")
    .order("bucket_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    rate: Number(data.rate),
    tier: data.tier as ORBIRate["tier"],
    bucketTs: data.bucket_ts,
    providerCount: data.provider_count,
    composite: data.composite,
  };
}

// ── In-memory cache so synchronous code paths (fx-rates.convert) can read
// the latest known rate without re-fetching. Updated by refreshLiveBTCRate.

interface LiveRateSnapshot {
  rate: number;
  tier: ORBIRate["tier"];
  providerCount: number;
  composite: boolean;
  fetchedAt: number;
}

const liveBTCRates = new Map<string, LiveRateSnapshot>();

export function getLiveBTCRate(target: string): LiveRateSnapshot | null {
  return liveBTCRates.get(target.toUpperCase()) ?? null;
}

/** Refresh the cache for a single fiat target. Returns the snapshot or null on failure. */
export async function refreshLiveBTCRate(target: string): Promise<LiveRateSnapshot | null> {
  const r = await fetchLatestBTCRate(target);
  if (!r) return null;
  const snap: LiveRateSnapshot = {
    rate: r.rate,
    tier: r.tier,
    providerCount: r.providerCount,
    composite: r.composite,
    fetchedAt: Date.now(),
  };
  liveBTCRates.set(target.toUpperCase(), snap);
  return snap;
}

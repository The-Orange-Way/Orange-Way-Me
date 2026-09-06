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

function partitionBucketTs(effectiveAt: Date): string {
  const minuteFloor = Math.floor(effectiveAt.getTime() / 60_000) * 60_000;
  return new Date(minuteFloor - 60_000).toISOString();
}

export interface ORBIRatePoint {
  rate: number;
  bucketTs: string;
}

/**
 * Fetch every CONFIRMED BTC-to-`target` rate bucket in [startAt, endAt] in a
 * single request. Used by the rate-series cache (OWM-T0746) to pull a whole
 * date range at once instead of one request per transaction date: a request
 * for "the full matrix for a date range" is the same request every client
 * makes, while a request for one exact bucket_ts is a fingerprint of that
 * one transaction (see OWM-T0159's ZKA constraint section). No account,
 * household, transaction, amount or user identifier is in this request.
 */
export async function fetchBTCRateRange(
  target: string,
  startAt: Date,
  endAt: Date,
): Promise<ORBIRatePoint[]> {
  let client: SupabaseClient;
  try {
    client = getORBIClient();
  } catch {
    return [];
  }

  const { data, error } = await client
    .from("exchange_rates")
    .select("rate, bucket_ts")
    .eq("source_currency", "BTC")
    .eq("target_currency", target.toUpperCase())
    .eq("product", "ORBI-M")
    .eq("granularity", "1m")
    .eq("status", "CONFIRMED")
    .gte("bucket_ts", startAt.toISOString())
    .lte("bucket_ts", endAt.toISOString())
    .order("bucket_ts", { ascending: true });

  if (error || !data) return [];
  return data.map((row) => ({ rate: Number(row.rate), bucketTs: row.bucket_ts as string }));
}

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

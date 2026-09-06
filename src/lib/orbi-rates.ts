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

// ── Bulk range read for the client-side rate-series cache (OWM-T0746). See
// src/lib/rate-series-cache.ts for the cache that consumes this.

export interface ORBIMatrixRow {
  targetCurrency: string;
  rate: number;
  bucketTs: string;
}

/**
 * Every supported BTC/fiat rate for [startDate, endDate], in ONE request.
 *
 * No target_currency filter: this always asks for the full matrix, never a
 * subset. See OWM-T0159's ZKA section for why a narrower request is a leak
 * even though no amount or plaintext is disclosed. No account, household,
 * transaction or user identifier appears anywhere in this call; the request
 * shape depends only on the date range, so it is identical for every OWM
 * client asking about the same range.
 */
export async function fetchRateMatrix(
  startDate: Date,
  endDate: Date,
  granularity: string = "1d",
): Promise<ORBIMatrixRow[]> {
  let client: SupabaseClient;
  try {
    client = getORBIClient();
  } catch {
    return [];
  }
  const { data, error } = await client
    .from("exchange_rates")
    .select("target_currency, rate, bucket_ts")
    .eq("source_currency", "BTC")
    .eq("product", "ORBI-M")
    .eq("granularity", granularity)
    .eq("status", "CONFIRMED")
    .gte("bucket_ts", startDate.toISOString())
    .lte("bucket_ts", endDate.toISOString());
  if (error || !data) return [];
  return data.map((row) => ({
    targetCurrency: String(row.target_currency).toUpperCase(),
    rate: Number(row.rate),
    bucketTs: row.bucket_ts as string,
  }));
}

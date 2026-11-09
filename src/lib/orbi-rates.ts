/**
 * ORBI rate provider -- Orange Way Phase 1 integration.
 *
 * Reads multi-source volume-weighted-median Bitcoin rates from the Orange
 * Rails Bitcoin Index (ORBI) via the orbi-rate edge function. The
 * Orange Rails credentials live in Supabase secrets server-side; the
 * browser never touches the Orange Rails project directly.
 *
 * Env (build time, already in bundle for other app features):
 *   VITE_SUPABASE_URL              App Supabase project URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY  App anon key
 *
 * Wired in via:
 *   - src/lib/fx-rates.ts         convert() reads the cached live rate for BTC/fiat
 *   - src/routes/__root.tsx       bootstraps a refresh on app load and every 60s
 *
 * OW-T0389: VITE_ORBI_SUPABASE_URL and VITE_ORBI_SUPABASE_ANON_KEY removed.
 * The Orange Rails anon key no longer appears in the browser bundle.
 */

// ── Orange Rails direct view reader (OWM-T0472) ─────────────────────────
//
// Orange Rails publishes orbi_btc_usd_latest as a read-only anonymous view.
// HELD: do NOT fill in the placeholders below until OR-T0216 publishes the
// project address and anon key (expected 2026-11-04 21:00 UTC). When that
// ticket publishes the values, replace both placeholders and merge.

// PLACEHOLDER: set to the OR project URL from OR-T0216 after 2026-11-04 21:00 UTC.
// Never commit a real URL before that ticket publishes it.
const OR_PROJECT_URL = "PLACEHOLDER_OR_PROJECT_URL";

// PLACEHOLDER: set to the OR anon (read-only) key from OR-T0216 after 2026-11-04 21:00 UTC.
// Never commit a real key before that ticket publishes it.
const OR_ANON_KEY = "PLACEHOLDER_OR_ANON_KEY";

/**
 * Read the single-row orbi_btc_usd_latest view on Orange Rails.
 *
 * The view fixes: BTC/USD, 1-minute bucket, ORBI composite, confirmed only,
 * last 2 days. No filter parameters are sent. If the latest settled price is
 * older than 2 days the view returns an empty list; this function returns null
 * and callers must show "price unavailable" -- never 0, never a stale cached
 * number.
 *
 * Anonymous read-only. No secret key.
 */
async function fetchLatestBTCRateFromView(): Promise<ORBIRate | null> {
  try {
    const url = `${OR_PROJECT_URL}/rest/v1/orbi_btc_usd_latest?select=*`;
    const resp = await fetch(url, {
      headers: {
        apikey: OR_ANON_KEY,
        Authorization: `Bearer ${OR_ANON_KEY}`,
      },
    });
    if (!resp.ok) return null;
    const rows: unknown = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return toORBIRateFromView(rows[0]);
  } catch {
    return null;
  }
}

/** Map the view's snake_case column names (bucket_ts, provider_count) to ORBIRate. */
function toORBIRateFromView(row: unknown): ORBIRate | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (r.rate === undefined || r.rate === null) return null;
  return {
    id: String(r.id ?? ""),
    rate: Number(r.rate),
    tier: r.tier as ORBIRate["tier"],
    bucketTs: String(r.bucket_ts ?? ""),
    providerCount: Number(r.provider_count ?? 0),
    composite: Boolean(r.composite),
  };
}

// ── Edge function transport ------------------------------------------------

function edgeFunctionBase(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return url ? `${url}/functions/v1/orbi-rate` : null;
}

function edgeFunctionHeaders(): HeadersInit {
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function callEdgeFunction(params: Record<string, string>): Promise<unknown> {
  const base = edgeFunctionBase();
  if (!base) return null;
  try {
    const resp = await fetch(`${base}?${new URLSearchParams(params).toString()}`, {
      headers: edgeFunctionHeaders(),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Public types -----------------------------------------------------------

export interface ORBIRate {
  id: string;
  rate: number;
  tier: "A" | "B" | "B-single" | "C-composite" | "stable";
  bucketTs: string;
  providerCount: number;
  composite: boolean;
}

// ── Rate fetchers ----------------------------------------------------------

export async function fetchBTCRate(target: string, effectiveAt: Date): Promise<ORBIRate | null> {
  const data = await callEdgeFunction({
    mode: "point",
    quote: target.toUpperCase(),
    at: effectiveAt.toISOString(),
  });
  return toORBIRate(data);
}

export async function fetchLatestBTCRate(target: string): Promise<ORBIRate | null> {
  const data = await callEdgeFunction({ mode: "latest", quote: target.toUpperCase() });
  return toORBIRate(data);
}

function toORBIRate(data: unknown): ORBIRate | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (r.rate === undefined || r.rate === null) return null;
  return {
    id: String(r.id ?? ""),
    rate: Number(r.rate),
    tier: r.tier as ORBIRate["tier"],
    bucketTs: String(r.bucketTs ?? ""),
    providerCount: Number(r.providerCount ?? 0),
    composite: Boolean(r.composite),
  };
}

// ── In-memory cache --------------------------------------------------------

/** How old a bucket timestamp can be before we consider the price stale. */
export const STALE_RATE_MAX_MS = 30 * 60 * 1_000; // 30 minutes

interface LiveRateSnapshot {
  rate: number;
  tier: ORBIRate["tier"];
  providerCount: number;
  composite: boolean;
  /** Wall-clock time when this snapshot was fetched (Date.now()). */
  fetchedAt: number;
  /** ISO timestamp of the ORBI price bucket this rate belongs to. */
  bucketTs: string;
}

const liveBTCRates = new Map<string, LiveRateSnapshot>();
const settledTargets = new Set<string>();

export function getLiveBTCRate(target: string): LiveRateSnapshot | null {
  return liveBTCRates.get(target.toUpperCase()) ?? null;
}

/** Refresh the cache for a single fiat target. Returns the snapshot or null on failure. */
export async function refreshLiveBTCRate(target: string): Promise<LiveRateSnapshot | null> {
  const r = await fetchLatestBTCRateFromView(); // was: fetchLatestBTCRate(target)
  settledTargets.add(target.toUpperCase());
  if (!r) return null;
  const snap: LiveRateSnapshot = {
    rate: r.rate,
    tier: r.tier,
    providerCount: r.providerCount,
    composite: r.composite,
    fetchedAt: Date.now(),
    bucketTs: r.bucketTs,
  };
  liveBTCRates.set(target.toUpperCase(), snap);
  return snap;
}

/**
 * True when the cached BTC rate bucket is older than STALE_RATE_MAX_MS,
 * or when no snapshot exists or the bucket timestamp is missing/invalid.
 * Returns false when the first refresh has not yet settled (no warning
 * before we know whether live data is available).
 */
export function isBtcRateStale(target: string): boolean {
  const key = target.toUpperCase();
  const snap = getLiveBTCRate(key);
  if (!snap) return settledTargets.has(key);
  if (!snap.bucketTs) return true;
  const bucketTime = new Date(snap.bucketTs).getTime();
  if (Number.isNaN(bucketTime)) return true;
  return Date.now() - bucketTime > STALE_RATE_MAX_MS;
}

// ── Bulk range read --------------------------------------------------------

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
 * shape depends only on the date range, so it is identical for every Orange
 * Way Me client asking about the same range.
 */
export async function fetchRateMatrix(
  startDate: Date,
  endDate: Date,
  granularity: string = "1d",
): Promise<ORBIMatrixRow[]> {
  const data = await callEdgeFunction({
    mode: "series",
    from: startDate.toISOString(),
    to: endDate.toISOString(),
    granularity,
  });
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      targetCurrency: String(row.targetCurrency ?? "").toUpperCase(),
      rate: Number(row.rate),
      bucketTs: String(row.bucketTs ?? ""),
    }));
}

/**
 * ORBI rate provider -- Orange Way Phase 1 integration.
 *
 * Reads multi-source volume-weighted-median Bitcoin rates from the Orange
 * Rails Bitcoin Index (ORBI) via the OWM orbi-rate edge function. The
 * Orange Rails credentials live in Supabase secrets server-side; the
 * browser never touches the Orange Rails project directly.
 *
 * Env (build time, already in bundle for other OWM features):
 *   VITE_SUPABASE_URL              OWM Supabase project URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY  OWM anon key
 *
 * Wired in via:
 *   - src/lib/fx-rates.ts         convert() reads the cached live rate for BTC/fiat
 *   - src/routes/__root.tsx       bootstraps a refresh on app load and every 60s
 *
 * OW-T0389: VITE_ORBI_SUPABASE_URL and VITE_ORBI_SUPABASE_ANON_KEY removed.
 * The Orange Rails anon key no longer appears in the browser bundle.
 */

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

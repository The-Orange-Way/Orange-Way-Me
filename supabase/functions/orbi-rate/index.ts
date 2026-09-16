/**
 * orbi-rate: server-side proxy for Orange Rails Bitcoin rate data.
 *
 * Moves VITE_ORBI_SUPABASE_URL and VITE_ORBI_SUPABASE_ANON_KEY out of the
 * browser bundle. The Orange Rails credentials live in Supabase secrets
 * (ORBI_DB_URL, ORBI_DB_ANON_KEY) and are only accessed here, server-side.
 *
 * Query params:
 *   mode=latest&quote=USD
 *     Most recent settled BTC/{quote} rate.
 *   mode=point&quote=USD&at=<iso>
 *     Rate closest to the given timestamp (historical conversion).
 *   mode=series&from=<iso>&to=<iso>&granularity=1d
 *     Full rate matrix for the date range, NO quote filter. See ZKA note.
 *
 * ZKA note (mode=series): every consumer requesting the same date range
 * must produce an identical request so no usage pattern leaks portfolio
 * currency mix. The ORBI v1 series endpoint requires a quote parameter,
 * so we always use the PostgREST path for series even when ORBI_API_KEY is
 * set. See OWM-T0159 ZKA section for the full reasoning.
 *
 * Backend priority (latest/point):
 *   1. ORBI v1 API  -- requires ORBI_API_KEY (once OR-T2437 ships).
 *   2. PostgREST fallback -- requires ORBI_DB_URL + ORBI_DB_ANON_KEY.
 *   3. 503 if neither is configured.
 *
 * Required Supabase secrets:
 *   ORBI_DB_URL       Orange Rails Supabase project URL
 *   ORBI_DB_ANON_KEY  Orange Rails anon key (same value as old VITE_ORBI_SUPABASE_ANON_KEY)
 *   ALLOWED_ORIGINS   Comma-separated allowed browser origins (already set)
 *
 * Optional Supabase secrets (set when OR-T2437 ships):
 *   ORBI_API_KEY      Application-level key from ORBI (consumer_id auth)
 *   OR_SUPABASE_URL   OR API gateway override (already set for ow-or-proxy)
 *
 * OW-T0389
 */

import { buildCorsHeaders, jsonResponse } from "../_shared/http.ts";
import { getOrGatewayFromEnv } from "../_shared/or-gateway.ts";

// v1 API (set when OR-T2437 ships and ORBI issues the application key)
const ORBI_API_KEY = Deno.env.get("ORBI_API_KEY");
const orApiBase = ORBI_API_KEY ? getOrGatewayFromEnv("orbi-rate") : null;

// PostgREST fallback: Orange Rails credentials, now server-side only
const ORBI_DB_URL = Deno.env.get("ORBI_DB_URL");
const ORBI_DB_ANON_KEY = Deno.env.get("ORBI_DB_ANON_KEY");

Deno.serve(async (req: Request) => {
  // Override allow-methods: this function is GET-only.
  const corsHeaders: Record<string, string> = {
    ...buildCorsHeaders(req),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "method not allowed" }, 405, corsHeaders);
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "latest";
  const quote = (url.searchParams.get("quote") ?? "USD").toUpperCase();
  const at = url.searchParams.get("at");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const granularity = url.searchParams.get("granularity") ?? "1d";

  try {
    if (mode === "series") {
      // Always PostgREST: ZKA requires no quote filter (see module doc).
      if (!ORBI_DB_URL || !ORBI_DB_ANON_KEY) {
        return jsonResponse({ error: "rate service not configured" }, 503, corsHeaders);
      }
      return await seriesViaPostgREST(from, to, granularity, corsHeaders);
    }

    // mode=latest or mode=point: prefer v1 API when key is available.
    if (ORBI_API_KEY && orApiBase) {
      return await latestOrPointViaApi(mode, quote, at, orApiBase, corsHeaders);
    }

    if (!ORBI_DB_URL || !ORBI_DB_ANON_KEY) {
      return jsonResponse({ error: "rate service not configured" }, 503, corsHeaders);
    }
    return await latestOrPointViaPostgREST(mode, quote, at, corsHeaders);
  } catch (err) {
    console.error("[orbi-rate] upstream error:", err);
    return jsonResponse({ error: "upstream error" }, 502, corsHeaders);
  }
});

// ── v1 API path (active once OR-T2437 ships) --------------------------------

async function latestOrPointViaApi(
  mode: string,
  quote: string,
  at: string | null,
  apiBase: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  // /v1/rates/point is not yet part of the OR-T2437 spec; fall through to
  // PostgREST for point lookups until ORBI confirms the endpoint.
  if (mode === "point") {
    return await latestOrPointViaPostgREST("point", quote, at, corsHeaders);
  }

  const apiUrl = `${apiBase}/v1/rates/latest?base=BTC&quote=${encodeURIComponent(quote)}`;
  const resp = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${ORBI_API_KEY}`,
      "x-orbi-client": "owm/0.2.0",
    },
  });

  if (!resp.ok) {
    console.error(`[orbi-rate] v1 API ${resp.status} for ${mode}/${quote}`);
    return jsonResponse({ error: "upstream error" }, 502, corsHeaders);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  return jsonResponse(shapeRate(data), 200, corsHeaders);
}

// ── PostgREST path ----------------------------------------------------------

function orbiDbHeaders(): HeadersInit {
  return {
    apikey: ORBI_DB_ANON_KEY!,
    Authorization: `Bearer ${ORBI_DB_ANON_KEY}`,
    "x-orbi-client": "owm/0.2.0",
    Accept: "application/json",
  };
}

async function latestOrPointViaPostgREST(
  mode: string,
  quote: string,
  at: string | null,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const params = new URLSearchParams();
  params.append("source_currency", "eq.BTC");
  params.append("target_currency", `eq.${quote}`);
  params.append("product", "eq.ORBI-M");
  params.append("granularity", "eq.1m");
  params.append("status", "eq.CONFIRMED");
  params.append("select", "id,rate,tier,bucket_ts,provider_count,composite");

  if (mode === "point" && at) {
    const bucketTs = minuteBucket(new Date(at));
    params.append("bucket_ts", `eq.${bucketTs}`);
    params.append("limit", "1");
  } else {
    params.append("order", "bucket_ts.desc");
    params.append("limit", "1");
  }

  const resp = await fetch(`${ORBI_DB_URL}/rest/v1/exchange_rates?${params.toString()}`, {
    headers: orbiDbHeaders(),
  });

  if (!resp.ok) {
    console.error(`[orbi-rate] PostgREST ${resp.status} for ${mode}/${quote}`);
    return jsonResponse({ error: "upstream error" }, 502, corsHeaders);
  }

  const rows = (await resp.json()) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse(null, 200, corsHeaders);
  }

  return jsonResponse(shapeRate(rows[0] as Record<string, unknown>), 200, corsHeaders);
}

async function seriesViaPostgREST(
  from: string | null,
  to: string | null,
  granularity: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (!from || !to) {
    return jsonResponse(
      { error: "from and to are required for mode=series" },
      400,
      corsHeaders,
    );
  }

  const params = new URLSearchParams();
  params.append("source_currency", "eq.BTC");
  params.append("product", "eq.ORBI-M");
  params.append("granularity", `eq.${granularity}`);
  params.append("status", "eq.CONFIRMED");
  params.append("bucket_ts", `gte.${from}`);
  params.append("bucket_ts", `lte.${to}`);
  params.append("select", "target_currency,rate,bucket_ts");
  params.append("order", "bucket_ts.asc");

  const resp = await fetch(
    `${ORBI_DB_URL}/rest/v1/exchange_rates?${params.toString()}`,
    { headers: orbiDbHeaders() },
  );

  if (!resp.ok) {
    console.error(`[orbi-rate] PostgREST series ${resp.status}`);
    return jsonResponse({ error: "upstream error" }, 502, corsHeaders);
  }

  const rows = (await resp.json()) as unknown[];
  if (!Array.isArray(rows)) {
    return jsonResponse([], 200, corsHeaders);
  }

  return jsonResponse(
    rows
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .map((r) => ({
        targetCurrency: String(r.target_currency ?? "").toUpperCase(),
        rate: Number(r.rate),
        bucketTs: String(r.bucket_ts ?? ""),
      })),
    200,
    corsHeaders,
  );
}

// ── Helpers -----------------------------------------------------------------

/** Map a DB or API row to the wire shape the frontend expects. */
function shapeRate(r: Record<string, unknown>) {
  return {
    id: String(r.id ?? ""),
    rate: Number(r.rate),
    tier: r.tier ?? null,
    bucketTs: String(r.bucket_ts ?? r.bucketTs ?? r.snapshot_ts ?? ""),
    providerCount: Number(r.provider_count ?? r.providerCount ?? 0),
    composite: Boolean(r.composite),
  };
}

/**
 * Replicate the bucket_ts calculation from orbi-rates.ts (frontend):
 * floor to the minute, step back one minute.
 */
function minuteBucket(effectiveAt: Date): string {
  const minuteFloor = Math.floor(effectiveAt.getTime() / 60_000) * 60_000;
  return new Date(minuteFloor - 60_000).toISOString();
}

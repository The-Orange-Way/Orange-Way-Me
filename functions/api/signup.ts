/**
 * Cloudflare Pages Function — signup endpoint.
 * Sends a transactional confirmation via Resend.
 *
 * Routed by the `form` field in the POST body:
 *   - "waitlist": OrangeWay marketing waitlist
 *   - "book":     Sato & the Chocolate Coins book early-access list
 *
 * Body shape and email validation are shared with the client hook via
 * `src/lib/marketing/signup-schema.ts`. That module is React-free so
 * importing it here does not pull React into the Worker bundle.
 *
 * Hardening:
 *   - Per-IP rate limit via `caches.default` (1 req / 20 sec ~= 3/min).
 *     Coarse defense against casual scrapers and burst-from-one-IP
 *     enumeration. Edge-cache writes are best-effort; for a stronger
 *     guarantee, layer Cloudflare WAF Rate Limiting Rules on top in
 *     the zone dashboard.
 *   - Upstream Resend error messages pass through `redactEmails`
 *     before any logging. Resend's failure body can echo the
 *     submitted recipient address in validation messages; without
 *     scrubbing, that real user email would land in Workers tail
 *     logs / Logpush.
 *
 * Marketing-list system of record: deliberately NOT plumbed yet. The
 * Resend "Emails" log already captures every send, which is enough
 * to reconstruct the list at launch-announcement time. Adding a
 * Resend Audience (or any second store) before there's a broadcast
 * to send only adds compliance load (GDPR Art. 13/14, Quebec Law 25,
 * CASL) without operational benefit. Roadmapped for closer to launch.
 *
 * Env vars (set on the orangeway-dev + orangeway-prod CF Pages projects):
 *   RESEND_API_KEY_OW   required, Resend API key scoped to send.orangeway.app.
 */

import {
  buildSignupRequestSchema,
  redactEmails,
  type SignupFormType,
  type SignupKidsAge,
} from "../../src/lib/marketing/signup-schema";

interface Env {
  RESEND_API_KEY_OW: string;
}

const FROM_NAME = "OrangeWay";
const FROM_ADDR = "support@send.orangeway.app"; // verified Resend sending domain
const REPLY_TO = "hello@orangeway.app"; // DEC-0304: settled contact/sender identity

const RATE_LIMIT_WINDOW_SEC = 20;

const COPY: Record<
  SignupFormType,
  { subject: string; html: (email: string, kids?: SignupKidsAge) => string }
> = {
  waitlist: {
    subject: "You're on the OrangeWay waitlist",
    html: (_email) => `
<p>Thanks for joining the OrangeWay waitlist.</p>
<p>The first 100 households get lifetime founder pricing — $100 a year, locked in forever. We'll email you before launch.</p>
<p>OrangeWay is open source: <a href="https://github.com/The-Orange-Way/Orange-Way-Me">github.com/The-Orange-Way/Orange-Way-Me</a>. Don't trust. Verify.</p>
<p>— OrangeWay</p>
<p style="color: #888; font-size: 12px;">The finance app that minds its own business around your data. Not your keys, not your privacy.</p>
<p style="color: #888; font-size: 12px;">The Orange Way Inc, 620 Veterans Drive Suite 12, Barrie, ON L4N9J4, Canada</p>`,
  },
  book: {
    subject: "We'll email you when Sato ships",
    html: (_email, kids) => {
      const kidsBlurb = (
        {
          not_yet: "Saving Sato for the future kids.",
          little: "Reading to the little ones: perfect age.",
          bigger: "Reading with bigger kids; they'll still love the pig.",
          just_me: "For the inner kid. Respect.",
        } as const
      )[kids ?? "little"];
      return `
<p>Thanks for signing up for <em>Sato &amp; the Chocolate Coins</em>.</p>
<p>${kidsBlurb}</p>
<p>We'll email you the moment the book is ready to ship. Until then, the rest of OrangeWay is being built around the same idea: helping families get good with money.</p>
<p>— OrangeWay</p>
<p style="color: #888; font-size: 12px;">The Orange Way Inc, 620 Veterans Drive Suite 12, Barrie, ON L4N9J4, Canada</p>`;
    },
  },
};

const requestSchema = buildSignupRequestSchema();

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  // Rate-limit gate (per-IP, edge-cache backed). Runs before any
  // upstream call so a flood from one IP cannot burn Resend quota.
  // cf-connecting-ip is the trusted client IP at the Cloudflare edge;
  // it's set on every request and not user-controllable.
  const clientIp = ctx.request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimited = await hitRateLimit(clientIp);
  if (rateLimited) {
    return json({ error: "rate limited" }, 429);
  }

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    const firstField = parsed.error.issues[0]?.path[0];
    const errKey = firstField === "email" ? "invalid email" : "invalid form";
    return json({ error: errKey }, 400);
  }
  const body = parsed.data;

  const copy = COPY[body.form];
  const apiKey = ctx.env.RESEND_API_KEY_OW;
  // Return the same opaque "send failed" the upstream-error path
  // returns so an unauthenticated caller can't tell the difference
  // between a missing-API-key deploy state and a Resend-rejected
  // request. Logs name the specific cause for the operator.
  if (!apiKey) {
    console.error("signup: RESEND_API_KEY_OW not configured", {
      rayId: ctx.request.headers.get("cf-ray"),
    });
    return json({ error: "send failed" }, 502);
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_ADDR}>`,
      to: [body.email],
      reply_to: REPLY_TO,
      subject: copy.subject,
      html: copy.html(body.email, body.kids),
    }),
  });

  if (!resp.ok) {
    // Resend's failure body can echo the submitted recipient address
    // in validation messages, so every field that originates from the
    // upstream string passes through redactEmails before logging.
    // Cloudflare Workers logs are short-lived by default, but Logpush
    // would turn this into a processing record; scrub at the source.
    //
    // Cap the read at 8 KiB so a hostile/buggy upstream returning a
    // megabyte body cannot tie up the worker's memory before we slice
    // the parsed fields. 8 KiB is much larger than any real Resend
    // error response we've observed; the cap is purely defensive.
    const rawDetail = await readBoundedText(resp, 8 * 1024);
    const safeDetail: { name?: string; message?: string; rawLength?: number } = {
      rawLength: rawDetail.length,
    };
    try {
      const parsedErr = JSON.parse(rawDetail) as { name?: unknown; message?: unknown };
      if (typeof parsedErr.name === "string") {
        safeDetail.name = redactEmails(parsedErr.name).slice(0, 100);
      }
      if (typeof parsedErr.message === "string") {
        safeDetail.message = redactEmails(parsedErr.message).slice(0, 200);
      }
    } catch {
      // Resend body was not JSON; leave safeDetail with rawLength only.
    }
    console.error("signup: Resend send failed", {
      rayId: ctx.request.headers.get("cf-ray"),
      status: resp.status,
      ...safeDetail,
    });
    return json({ error: "send failed" }, 502);
  }

  return json({ ok: true }, 200);
};

/**
 * Per-IP rate limit backed by `caches.default`. Returns true if the
 * client IP has hit the endpoint within the last RATE_LIMIT_WINDOW_SEC
 * seconds.
 *
 * Mechanism: cache a 204 response keyed by a synthetic URL containing
 * the IP. Cache TTL = RATE_LIMIT_WINDOW_SEC. A subsequent request from
 * the same IP within the window finds the cached response and is
 * rejected.
 *
 * Trade-offs:
 *   - Best-effort: caches.default is a per-colo edge cache. A flood
 *     spanning multiple Cloudflare colos can bypass it. For a stronger
 *     guarantee, layer WAF Rate Limiting Rules at the zone level.
 *   - Race window during cache propagation: a rapid burst (~1 ms apart)
 *     from one IP can land 2-3 requests before the cache write
 *     completes. Acceptable for a marketing signup form; the upstream
 *     Resend send is the actual expensive operation, and Resend has
 *     its own throttling.
 *   - "unknown" IPs (missing cf-connecting-ip) all share one bucket,
 *     which is conservative: any anomaly converges them.
 */
async function hitRateLimit(clientIp: string): Promise<boolean> {
  const cache = caches.default;
  const key = new Request(`https://rl.signup.ratelimit.invalid/${encodeURIComponent(clientIp)}`);
  const cached = await cache.match(key);
  if (cached) return true;
  const sentinel = new Response(null, {
    status: 204,
    headers: { "Cache-Control": `public, max-age=${RATE_LIMIT_WINDOW_SEC}` },
  });
  await cache.put(key, sentinel);
  return false;
}

/**
 * Read at most `maxBytes` of a Response body as UTF-8 text. Falls back
 * to an empty string on read errors. Used so a hostile upstream cannot
 * force the worker to buffer an unbounded body in memory before we
 * slice the fields we care about.
 */
async function readBoundedText(resp: Response, maxBytes: number): Promise<string> {
  try {
    if (!resp.body) return "";
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors
    }
    const merged = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const chunk of chunks) {
      const take = Math.min(chunk.byteLength, maxBytes - offset);
      merged.set(chunk.subarray(0, take), offset);
      offset += take;
      if (offset >= maxBytes) break;
    }
    return new TextDecoder().decode(merged);
  } catch {
    return "";
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Cloudflare Pages Function — signup endpoint.
 * Sends transactional confirmation via Resend; later will also POST to GoHighLevel.
 *
 * Routed by the `form` field in the POST body:
 *   - "waitlist": OrangeWay marketing waitlist
 *   - "book":     Sato & the Chocolate Coins book early-access list
 *
 * Env vars required (set on the orangeway-dev + orangeway-prod CF Pages projects):
 *   RESEND_API_KEY_OW   — Resend API key, scoped to send.orangeway.app
 */

interface Env {
  RESEND_API_KEY_OW: string;
}

type FormType = "waitlist" | "book";
type KidsAge = "not_yet" | "little" | "bigger" | "just_me";

interface SignupBody {
  form: FormType;
  email: string;
  kids?: KidsAge;
}

const FROM_NAME = "OrangeWay";
const FROM_ADDR = "support@send.orangeway.app"; // verified Resend sending domain
const REPLY_TO = "support@orangeway.app";

const COPY: Record<FormType, { subject: string; html: (email: string, kids?: KidsAge) => string }> =
  {
    waitlist: {
      subject: "You're on the OrangeWay waitlist",
      html: (_email) => `
<p>Thanks for joining the OrangeWay waitlist.</p>
<p>The first 100 households get lifetime founder pricing — $100 a year, locked in forever. We'll email you before launch.</p>
<p>OrangeWay is open source: <a href="https://github.com/The-Orange-Way/Orange-Way-Me">github.com/The-Orange-Way/Orange-Way-Me</a>. Don't trust. Verify.</p>
<p>— OrangeWay</p>
<p style="color: #888; font-size: 12px;">The finance app that minds its own business around your data. Not your keys, not your privacy.</p>`,
    },
    book: {
      subject: "We'll email you when Sato ships",
      html: (_email, kids) => {
        const kidsBlurb = (
          {
            not_yet: "Saving Sato for the future kids.",
            little: "Reading to the little ones — perfect age.",
            bigger: "Reading with bigger kids — they'll still love the pig.",
            just_me: "For the inner kid. Respect.",
          } as const
        )[kids ?? "little"];
        return `
<p>Thanks for signing up for <em>Sato &amp; the Chocolate Coins</em>.</p>
<p>${kidsBlurb}</p>
<p>We'll email you the moment the book is ready to ship. Until then, the rest of OrangeWay is being built around the same idea: helping families get good with money.</p>
<p>— OrangeWay</p>`;
      },
    },
  };

function emailValid(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 255;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  let body: SignupBody;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  if (!emailValid(body.email)) return json({ error: "invalid email" }, 400);
  if (body.form !== "waitlist" && body.form !== "book") return json({ error: "invalid form" }, 400);

  const copy = COPY[body.form];
  const apiKey = ctx.env.RESEND_API_KEY_OW;
  if (!apiKey) return json({ error: "server not configured" }, 500);

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
    // Log the upstream Resend error server-side for debugging, but do NOT
    // echo it into the 502 client response. Resend's error body can name
    // the verified sending identity, headers, and config that an attacker
    // probing the endpoint would use for enumeration. The client only
    // needs to know the send failed.
    //
    // Privacy note for the next contributor: do NOT add body.email (or
    // any other plaintext PII) to this log object. Resend's failure body
    // sometimes echoes the `to` field in validation messages, which is
    // why we parse the structured fields (`name`, `message`) only and
    // fall back to a length-bounded raw slice with zero PII intent.
    // Cloudflare Workers logs are short-lived by default, but a future
    // Logpush configuration would turn this into a processing record.
    const rawDetail = await resp.text().catch(() => "");
    const safeDetail: { name?: string; message?: string; rawLength?: number } = {
      rawLength: rawDetail.length,
    };
    try {
      const parsed = JSON.parse(rawDetail) as { name?: unknown; message?: unknown };
      if (typeof parsed.name === "string") safeDetail.name = parsed.name.slice(0, 100);
      if (typeof parsed.message === "string") safeDetail.message = parsed.message.slice(0, 200);
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

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Request level guard for the private wallet kill switch in ow-or-proxy.
 *
 * WHY THIS IS NOT ANOTHER stealth-flag TEST. _shared/stealth-flag.test.ts
 * proves readStealthSyncEnabled decides correctly: nine cases, every one of
 * them calling it directly with a hand written reader. Not one constructs a
 * request or imports this function. The pure decision is well covered and the
 * WIRING is covered by nothing, so a change that moves the gate below the
 * outbound body assembly, inverts it, or points the reader at another flag key
 * passes every existing check and ships a mint that no longer refuses.
 *
 * WHAT THIS DRIVES. The real index.ts, unmodified. Deno.serve is captured
 * rather than started, so the handler exercised here is the same function the
 * deployed edge runtime invokes. Nothing about the gate, the branch order or
 * the response shape is reimplemented in this file.
 *
 * WHY IT IS A DENO TEST AND NOT A VITEST ONE. index.ts imports the Supabase
 * SDK from an https URL and reads the runtime env at module load, so the Node
 * based vitest runner cannot import it at all. The unit tests next door are
 * vitest because those modules are deliberately dependency free. This one
 * cannot be. It is named *.deno-test.ts so the vitest glob
 * (supabase/functions/ **\/*.test.ts) does not collect it and fail on the
 * Deno globals.
 *
 * IT ASSERTS BOTH DIRECTIONS, DELIBERATELY. A test that can only prove the
 * refusal is indistinguishable from a gate that is stuck closed, and the
 * production flag is false, so nothing else would tell us. Switch on must
 * mint; switch off must refuse.
 *
 * NOTHING REACHES THE NETWORK. globalThis.fetch is replaced before index.ts is
 * imported, because the Supabase SDK captures the global fetch once when the
 * client is constructed. A stub installed after the import would be ignored
 * and every call below would try to dial a real host.
 */

type Handler = (req: Request) => Response | Promise<Response>;

const TEST_USER_ID = "11111111-2222-3333-4444-555555555555";

/** What the stubbed Orange Rails gateway hands back on a successful mint. */
const UPSTREAM_TOKEN = "stub-widget-token-issued-by-the-fake-gateway";

/** An allowlisted gateway host (see _shared/or-gateway.ts). Never dialled. */
const OR_GATEWAY = "https://api.orangerails.dev";

const SUPABASE_URL = "https://ow-or-proxy-guard.supabase.test";

/** The flag row the app_flags read answers with. Set per test by reset(). */
let flagBody: unknown = null;
/** HTTP status for that read. 500 models a failed read, which must refuse. */
let flagStatus = 200;

interface RecordedCall {
  url: string;
  method: string;
  body: string | null;
}
let calls: RecordedCall[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const stubFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  calls.push({
    url,
    method,
    body: init && typeof init.body === "string" ? init.body : null,
  });

  // Supabase auth: the caller's JWT resolves to this user.
  if (url.includes("/auth/v1/user")) {
    return Promise.resolve(
      json({
        id: TEST_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "guard@ow-or-proxy.test",
      }),
    );
  }
  // Rate limit RPC: well under the per hour limit.
  if (url.includes("/rest/v1/rpc/increment_ow_or_proxy_rate")) {
    return Promise.resolve(json(1));
  }
  // The kill switch read itself.
  if (url.includes("/rest/v1/app_flags")) {
    return Promise.resolve(json(flagBody, flagStatus));
  }
  // Subaccount resolution for the ordinary (non mint) endpoints.
  if (url.includes("/rest/v1/user_profiles")) {
    return Promise.resolve(json({ or_subaccount_id: "sub_guard_test" }));
  }
  // The Orange Rails gateway. Reaching the mint here is the failure this file
  // exists to catch, so it answers with a token that must never appear in a
  // refusal body.
  if (url === `${OR_GATEWAY}/functions/v1/or-link-mint-token`) {
    return Promise.resolve(json({ widget_token: UPSTREAM_TOKEN, expires_in: 300 }));
  }
  if (url.startsWith(`${OR_GATEWAY}/functions/v1/`)) {
    return Promise.resolve(json({ ok: true, connections: [] }));
  }
  // Anything else is an outbound call this guard did not anticipate. Answer
  // with a status nothing else uses so it cannot be mistaken for success.
  return Promise.resolve(json({ error: `unexpected outbound call: ${method} ${url}` }, 599));
};

globalThis.fetch = stubFetch as typeof fetch;

Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.set("SUPABASE_ANON_KEY", "guard-anon-value-not-a-real-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "guard-service-value-not-a-real-key");
Deno.env.set("OR_PLATFORM_API_KEY", "guard-platform-value-not-a-real-key");
Deno.env.set("OR_SUPABASE_URL", OR_GATEWAY);

let captured: Handler | null = null;
const denoServe = Deno as unknown as { serve: (handler: Handler) => unknown };
const realServe = denoServe.serve;
denoServe.serve = (handler: Handler) => {
  captured = handler;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
};

await import("./index.ts");

denoServe.serve = realServe;

if (!captured) {
  // Loud rather than skipped: if the import stops registering a handler this
  // file would otherwise pass while testing nothing at all.
  throw new Error(
    "ow-or-proxy/index.ts registered no handler with Deno.serve, so this guard tested nothing",
  );
}
const handler = captured as Handler;

function reset(flag: unknown, status = 200): void {
  calls = [];
  flagBody = flag;
  flagStatus = status;
}

function proxyRequest(endpoint: string, payload: Record<string, unknown> = {}): Request {
  return new Request(`${SUPABASE_URL}/functions/v1/ow-or-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer guard-caller-jwt-not-a-real-token",
    },
    body: JSON.stringify({ endpoint, payload }),
  });
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Did the flag get read, and against the key the gate is supposed to use? */
function readTheFlag(): boolean {
  return calls.some(
    (c) => c.url.includes("/rest/v1/app_flags") && c.url.includes("stealth_sync_enabled"),
  );
}

function forwardedTheMint(): boolean {
  return calls.some((c) => c.url.includes("/functions/v1/or-link-mint-token"));
}

Deno.test("switch off: the mint is refused with the stable code and nothing leaves the function", async () => {
  reset({ enabled: false });

  const res = await handler(proxyRequest("or-link-mint-token"));
  const raw = await res.text();

  expect(res.status === 503, `expected 503 while the switch is off, got ${res.status}: ${raw}`);
  const body = JSON.parse(raw) as { error?: string; message?: string };
  expect(
    body.error === "stealth_sync_disabled",
    `expected the stable code stealth_sync_disabled, got: ${raw}`,
  );
  expect(
    typeof body.message === "string" && body.message.length > 0,
    `expected human facing text alongside the code, got: ${raw}`,
  );
  expect(!raw.includes("widget_token"), `the refusal body carried a widget token: ${raw}`);
  expect(!raw.includes(UPSTREAM_TOKEN), `the refusal body carried the upstream token: ${raw}`);
  expect(
    !forwardedTheMint(),
    "the mint was forwarded to the gateway while the switch was off, so the refusal is no longer before the outbound call",
  );
  expect(
    readTheFlag(),
    `the gate never read app_flags on the stealth key. Calls made: ${calls.map((c) => c.url).join(", ")}`,
  );
});

Deno.test("switch on: the mint proceeds and the widget token is returned", async () => {
  reset({ enabled: true });

  const res = await handler(proxyRequest("or-link-mint-token", { ttl_seconds: 120 }));
  const raw = await res.text();

  expect(res.status === 200, `expected the mint to proceed while the switch is on, got ${res.status}: ${raw}`);
  const body = JSON.parse(raw) as { widget_token?: string };
  expect(
    body.widget_token === UPSTREAM_TOKEN,
    `expected the gateway's widget token to be passed through, got: ${raw}`,
  );
  expect(forwardedTheMint(), "the mint was never forwarded to the gateway while the switch was on");

  const mint = calls.find((c) => c.url.includes("/functions/v1/or-link-mint-token"));
  const forwarded = JSON.parse(mint?.body ?? "{}") as {
    app_user_id?: string;
    ttl_seconds?: number;
  };
  expect(
    forwarded.app_user_id === TEST_USER_ID,
    `the mint must bind to the authenticated user, got: ${mint?.body}`,
  );
  expect(forwarded.ttl_seconds === 120, `ttl_seconds was not passed through, got: ${mint?.body}`);
});

Deno.test("a failed flag read refuses the mint rather than assuming it is on", async () => {
  reset({ message: "app_flags is unreachable" }, 500);

  const res = await handler(proxyRequest("or-link-mint-token"));
  const raw = await res.text();

  expect(res.status === 503, `a failed flag read must refuse, got ${res.status}: ${raw}`);
  expect(
    (JSON.parse(raw) as { error?: string }).error === "stealth_sync_disabled",
    `expected the stable code on a failed read, got: ${raw}`,
  );
  expect(!forwardedTheMint(), "the mint was forwarded despite the flag read failing");
});

Deno.test("the refusal is scoped to the mint: other endpoints still work with the switch off", async () => {
  reset({ enabled: false });

  const res = await handler(proxyRequest("or-connection-list"));
  const raw = await res.text();

  // If this ever returns 503, the gate has been hoisted above the endpoint
  // branch and the switch is now refusing ordinary bank syncs too.
  expect(
    res.status === 200,
    `the switch must gate the mint only, but or-connection-list returned ${res.status}: ${raw}`,
  );
  expect(!raw.includes("stealth_sync_disabled"), `the mint refusal leaked onto another endpoint: ${raw}`);
});

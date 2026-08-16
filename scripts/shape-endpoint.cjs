#!/usr/bin/env node
/**
 * shape-endpoint.js: record the SHAPE of an OR proxy response, never its contents.
 *
 * Why this exists as a committed script instead of a throwaway in someone's
 * scratch directory: twice now a cross-org disagreement about "what does that
 * endpoint actually return" has been settled by two people reading two
 * different files and each being sure. Prose loses those arguments. A recorded
 * shape ends them in one run, and the only way the recording stays trustworthy
 * is if the redaction rules live in version control where a reviewer can check
 * them, rather than being retyped from memory each time.
 *
 * The rule this script is built around: SHAPES ONLY. Key names, typeof, array
 * lengths, string LENGTHS, and booleans. Never a string value, never an id,
 * never an address, never an amount. Redaction happens where the line is BUILT,
 * inside the page, so a value cannot reach the log even if this file is later
 * edited carelessly at the printing end.
 *
 * Booleans are the one exception and are printed as their value. That is
 * deliberate: for a flag like an availability boolean, the value IS the shape
 * question, and a boolean cannot carry an identifier.
 *
 * Usage:
 *   OW_SUPABASE_URL=https://<project>.supabase.co \
 *   CAPTURE_DIR=/path/holding/session.json+e2e-owm.txt \
 *   PW_PATH=/path/to/playwright-core \
 *   node scripts/shape-endpoint.cjs <subaccount-id>
 *
 * CAPTURE_DIR must hold:
 *   session.json   the Supabase auth session to inject
 *   e2e-owm.txt    KEY=value lines, must include OWM_DEV_Vault_Password
 * Neither file belongs in this repo and neither is read into a log line here.
 *
 * This runs against development only, and that is now enforced rather than
 * advised: the Supabase project ref is checked against an allowlist below and
 * the script refuses to start otherwise. It is a read-only capture, but it
 * authenticates as a real user, so "read-only" is not the same as harmless.
 * Both OW_APP_URL and OW_SUPABASE_URL must be set explicitly; there is no
 * default target, because a default target is a target nobody chose.
 */
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = (process.env.OW_SUPABASE_URL || "").replace(/\/+$/, "");
const CAPTURE_DIR = process.env.CAPTURE_DIR || process.cwd();
const SUB = process.argv[2];
// No default. A default target means a run with nothing configured still
// points at a hosted surface, and the one it pointed at was a real one. Make
// the operator name the target every time.
const APP_URL = process.env.OW_APP_URL || "";

if (!SUPABASE_URL || !SUB || !APP_URL) {
  console.error(
    "usage: OW_APP_URL=https://<app-host> OW_SUPABASE_URL=https://<project>.supabase.co " +
      "node scripts/shape-endpoint.cjs <subaccount-id>",
  );
  console.error("Both OW_APP_URL and OW_SUPABASE_URL are required. There is no default target.");
  process.exit(2);
}

// The auth-token key Supabase writes is derived from the project ref, so it
// follows from the URL rather than being pasted in. Hardcoding it is how this
// script silently captured nothing the first time it was pointed elsewhere.
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const AUTH_KEY = `sb-${PROJECT_REF}-auth-token`;

// This tool signs in, calls real endpoints and reads real responses. It is a
// development instrument and it must be impossible to point at anything else
// by accident.
//
// The guard is keyed on the Supabase project ref rather than on the app URL
// because the ref is what actually decides which database is answering. A URL
// can be a proxy, a preview host, a local alias or a typo away from a hosted
// one; the ref cannot. Refs are not secret: they are part of the public API
// hostname and already ship inside the client bundle.
//
// Adding a ref here is a deliberate act. If you find yourself wanting to add a
// production ref, the answer is no. Capture the shape on development and
// promote the finding, not the probe.
const ALLOWED_PROJECT_REFS = ["bogmoovbjpvcvdqrmjgt"]; // the development project

if (!ALLOWED_PROJECT_REFS.includes(PROJECT_REF)) {
  console.error(
    `REFUSED: project ref "${PROJECT_REF}" is not in this script's development allowlist.`,
  );
  console.error(
    "This tool only runs against development. Edit ALLOWED_PROJECT_REFS if a new development project exists.",
  );
  process.exit(2);
}

const { chromium } = require(process.env.PW_PATH || "playwright-core");

const readEnvFile = (key) => {
  const file = path.join(CAPTURE_DIR, "e2e-owm.txt");
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(new RegExp("^" + key + "=(.*)$"));
    if (m) {
      return m[1]
        .trim()
        .replace(/^\**|\**$/g, "")
        .replace(/^["']|["']$/g, "");
    }
  }
  return "";
};

const session = JSON.parse(fs.readFileSync(path.join(CAPTURE_DIR, "session.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.addInitScript(
    ([k, s]) => {
      try {
        localStorage.setItem(k, s);
      } catch {
        /* a blocked storage write shows up as the unlock screen below */
      }
    },
    [AUTH_KEY, JSON.stringify(session)],
  );

  // One document load only. Every later step stays in this document, because a
  // navigation re-locks the vault and a locked page then reads as an empty
  // result rather than as a failure.
  await page.goto(`${APP_URL}/connections`, { waitUntil: "domcontentloaded" });
  await sleep(9000);

  const pw = page.locator("#v-pw, input[type='password']").first();
  if (await pw.isVisible().catch(() => false)) {
    await pw.fill(readEnvFile("OWM_DEV_Vault_Password"));
    await page.getByRole("button", { name: /^unlock/i }).click();
    await sleep(12000);
  }
  if (
    await page
      .locator("text=Unlock your vault")
      .isVisible()
      .catch(() => false)
  ) {
    console.log("ABORT still locked, nothing captured");
    await browser.close();
    process.exit(1);
  }

  const out = await page
    .evaluate(
      async ({ SUB, SUPABASE_URL }) => {
        const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
        const tok = JSON.parse(localStorage.getItem(key) || "{}").access_token;

        const call = async (endpoint, payload) => {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/ow-or-proxy`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + tok },
            body: JSON.stringify({ endpoint, payload }),
          });
          let j = null;
          try {
            j = await r.json();
          } catch {
            /* a non-JSON body is itself the finding; status carries it */
          }
          return { status: r.status, j };
        };

        // typeof and size, never the value. Strings collapse to their length.
        const desc = (v) => {
          if (v === null) return "null";
          if (Array.isArray(v)) return "array[" + v.length + "]";
          const t = typeof v;
          if (t === "string") return "string(len " + v.length + ")";
          if (t === "boolean") return "boolean:" + v; // see the header: booleans are the answer
          if (t === "number") return "number";
          if (t === "object") return "object{" + Object.keys(v).sort().join(",") + "}";
          return t;
        };
        const topShape = (o) => {
          const s = {};
          for (const k of Object.keys(o || {}).sort()) s[k] = desc(o[k]);
          return s;
        };

        const T = await call("or-transactions-list", { subaccount_id: SUB, limit: 500 });
        const L = await call("or-connection-list", { subaccount_id: SUB });

        const rows = (T.j && T.j.transactions) || [];
        const rowKeySets = {};
        for (const r of rows) {
          const sig = Object.keys(r).sort().join(",");
          rowKeySets[sig] = (rowKeySets[sig] || 0) + 1;
        }
        // Distinct connection ids answer "did more than one source contribute".
        // The COUNT answers it. The ids themselves are identifiers, so they are
        // counted through a Set and never leave the page.
        const connIds = new Set(rows.map((r) => r.connection_id).filter(Boolean));

        return {
          txlist: {
            http: T.status,
            topLevelKeys: Object.keys(T.j || {}).sort(),
            topLevelShape: topShape(T.j),
            hasStealthUnavailableKey: Object.prototype.hasOwnProperty.call(
              T.j || {},
              "stealth_unavailable",
            ),
            rowCount: rows.length,
            distinctRowKeySets: rowKeySets,
            distinctConnectionIdCount: connIds.size,
          },
          connlist: {
            http: L.status,
            topLevelKeys: Object.keys(L.j || {}).sort(),
            hasStealthUnavailableKey: Object.prototype.hasOwnProperty.call(
              L.j || {},
              "stealth_unavailable",
            ),
            // Through desc() like every other field. This was the one line
            // that returned a raw value out of the page, which defeats the
            // point of building the summary from descriptors: whatever the
            // server chose to put in that field would have been printed
            // verbatim. desc() still prints booleans in full, and a boolean
            // is the answer this probe is actually after.
            stealthUnavailableValue: desc((L.j || {}).stealth_unavailable),
            connectionCount: ((L.j || {}).connections || []).length,
          },
        };
      },
      { SUB, SUPABASE_URL },
    )
    // Name and length only. This was the one path carrying unstructured text
    // out of the page, and an error message is exactly where a server likes to
    // echo back the input that caused it.
    .catch((e) => ({
      error: {
        name: (e && e.name) || typeof e,
        messageLength: String((e && e.message) || e).length,
      },
    }));

  console.log("SHAPE " + JSON.stringify(out, null, 1));
  await browser.close();
})();

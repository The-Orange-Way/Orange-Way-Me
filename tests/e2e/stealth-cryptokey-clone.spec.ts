/**
 * Can a non-extractable CryptoKey cross an origin boundary intact?
 *
 * This decides how the Stealth Sync wrapping key is handed to the connect
 * widget. Two shapes are possible:
 *
 *   base64      the platform sends the raw key bytes. The receiving origin
 *               can decrypt as well as encrypt, and can forward the bytes.
 *               This is what ships today, because it is the only shape the
 *               widget's contract accepts.
 *   CryptoKey   the platform sends the key object by structured clone. The
 *               receiving origin can use the key for exactly the operations
 *               we allowed and can never read its bytes. This is the target.
 *
 * The second shape is only worth building if the browser actually preserves
 * `extractable: false` and the usage list through a cross-origin postMessage.
 * The Web Crypto spec says a CryptoKey is serializable and that both
 * properties travel with it, but a spec is not an engine, and one engine
 * dropping it makes the whole design unshippable. So this test asks the
 * engines rather than the specification.
 *
 * It deliberately does NOT load the app. Two synthetic origins are fulfilled
 * by the test itself, which keeps the question to the one thing being asked
 * and lets the same file run against any deployment or none.
 *
 * Run it across the three engines:
 *   bunx playwright test tests/e2e/stealth-cryptokey-clone.spec.ts \
 *     --project=chromium --project=firefox --project=webkit
 */
import { test, expect, type BrowserContext } from "@playwright/test";

const PLATFORM_ORIGIN = "https://platform.stealth-clone-test";
const WIDGET_ORIGIN = "https://widget.stealth-clone-test";

/**
 * The platform side. Opens the widget, waits for its READY, then posts a
 * freshly derived non-extractable AES-GCM key with a single usage.
 *
 * One usage, not two, on purpose: the point of the CryptoKey shape is that
 * the far side gets exactly the capability we grant, so the test has to prove
 * a narrowed list survives rather than a full one.
 */
const PLATFORM_HTML = `<!doctype html><meta charset="utf-8"><title>platform</title>
<script>
  window.__result = null;
  window.addEventListener("message", function (e) {
    if (e.origin !== ${JSON.stringify(WIDGET_ORIGIN)}) return;
    if (e.data && e.data.type === "READY") {
      crypto.subtle
        .generateKey({ name: "AES-GCM", length: 256 }, /* extractable */ false, ["encrypt"])
        .then(function (key) {
          e.source.postMessage({ type: "KEY", key: key }, ${JSON.stringify(WIDGET_ORIGIN)});
        })
        .catch(function (err) {
          window.__result = { stage: "generate", error: String(err) };
        });
      return;
    }
    if (e.data && e.data.type === "REPORT") {
      window.__result = e.data.report;
    }
  });
  window.__popup = window.open(${JSON.stringify(WIDGET_ORIGIN + "/")}, "widget", "width=400,height=400");
</script>`;

/**
 * The widget side. Reports READY, then inspects whatever arrives:
 * is it a CryptoKey at all, is it still non-extractable, are the usages the
 * ones we granted, does it actually work, and does reading the bytes fail.
 */
const WIDGET_HTML = `<!doctype html><meta charset="utf-8"><title>widget</title>
<script>
  function report(r) {
    window.opener.postMessage({ type: "REPORT", report: r }, ${JSON.stringify(PLATFORM_ORIGIN)});
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== ${JSON.stringify(PLATFORM_ORIGIN)}) return;
    if (!e.data || e.data.type !== "KEY") return;
    var key = e.data.key;
    var r = {
      arrived: key != null,
      isCryptoKey: typeof CryptoKey !== "undefined" && key instanceof CryptoKey,
      extractable: key && key.extractable,
      usages: key && key.usages ? Array.prototype.slice.call(key.usages) : null,
      algorithm: key && key.algorithm ? key.algorithm.name : null,
      usable: null,
      exportRejected: null,
    };
    if (!r.isCryptoKey) {
      report(r);
      return;
    }
    crypto.subtle
      .encrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, key, new Uint8Array([1, 2, 3]))
      .then(function (ct) {
        r.usable = ct.byteLength > 0;
      })
      .catch(function (err) {
        r.usable = false;
        r.usableError = String(err);
      })
      .then(function () {
        return crypto.subtle.exportKey("raw", key).then(
          function () {
            r.exportRejected = false;
          },
          function () {
            r.exportRejected = true;
          },
        );
      })
      .then(function () {
        report(r);
      });
  });
  window.opener.postMessage({ type: "READY" }, ${JSON.stringify(PLATFORM_ORIGIN)});
</script>`;

async function serveBothOrigins(context: BrowserContext): Promise<void> {
  await context.route(PLATFORM_ORIGIN + "/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PLATFORM_HTML }),
  );
  await context.route(WIDGET_ORIGIN + "/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: WIDGET_HTML }),
  );
}

test.describe("cross-origin CryptoKey transfer", () => {
  test("a non-extractable key survives postMessage with its usages intact", async ({
    page,
    context,
  }, testInfo) => {
    await serveBothOrigins(context);
    await page.goto(PLATFORM_ORIGIN + "/");

    const report = await page.waitForFunction(
      () => (window as never as { __result: unknown }).__result,
      undefined,
      {
        timeout: 15000,
      },
    );
    const r = (await report.jsonValue()) as {
      arrived?: boolean;
      isCryptoKey?: boolean;
      extractable?: boolean;
      usages?: string[] | null;
      algorithm?: string | null;
      usable?: boolean | null;
      exportRejected?: boolean | null;
      error?: string;
      stage?: string;
    };

    // Printed on pass as well as on failure: the per-engine result is the
    // artifact this test exists to produce, and a summary is not evidence.

    console.log(`[cryptokey-clone] ${testInfo.project.name}: ${JSON.stringify(r)}`);

    expect(r.error, `key generation failed at stage ${r.stage}`).toBeUndefined();
    expect(r.arrived, "no key arrived at the receiving origin").toBe(true);
    // The failure that kills the design: some engines drop a CryptoKey to a
    // plain object or null rather than refusing the post outright.
    expect(r.isCryptoKey, "what arrived is not a CryptoKey").toBe(true);
    // Silently widening either of these would be worse than dropping the key,
    // because the design would look like it held while granting more.
    expect(r.extractable, "extractable was not preserved as false").toBe(false);
    expect(r.usages, "the usage list was not preserved exactly").toEqual(["encrypt"]);
    expect(r.algorithm).toBe("AES-GCM");
    // Granted capability works, ungranted capability does not.
    expect(r.usable, "the key that arrived cannot encrypt").toBe(true);
    expect(r.exportRejected, "the receiving origin could read the key bytes").toBe(true);
  });
});

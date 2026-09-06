/**
 * OWM-E0008 acceptance 1a, staged DEV proof (OWM-T0617).
 *
 * Compares the distinct on-chain transaction count for a deliberately
 * staged watch-only wallet against the rows OWM actually imported for
 * that account, using mempool.space as the independent source of truth
 * (never our own ledger).
 *
 * THIS IS A STAGED DEV OBSERVATION. It must never be reported as a
 * production observation, and its result must say so explicitly
 * wherever it is recorded (per OWM-T0617's acceptance criteria).
 *
 * WHY THIS SPEC CANNOT RUN ITSELF YET. Staging the wallet needs a real
 * authenticated browser session holding an unlocked vault (ZKA: no
 * listener seat holds one). This spec assumes that staging already
 * happened and takes the resulting account id as input. See OWM-T0617
 * for the staging options (CTO ruling, 2026-09-06).
 *
 * REQUIRED ENV VARS, all deliberately explicit rather than defaulted,
 * so this can never silently run against the wrong wallet or project:
 *   E2E_STEALTH_TEST_XPUB           the watch-only xpub/ypub/zpub used to
 *                                   stage the account (public key only,
 *                                   never a private key or seed)
 *   E2E_STEALTH_TEST_SCRIPT_TYPE    optional override: p2pkh | p2wpkh |
 *                                   p2sh-p2wpkh (defaults to what the
 *                                   xpub/ypub/zpub prefix implies)
 *   E2E_STEALTH_TEST_ACCOUNT_ID     the OWM accounts.id the wallet was
 *                                   staged as (id only, never a customer
 *                                   name or email)
 *   OWM_DEV_SUPABASE_URL            https://bogmoovbjpvcvdqrmjgt.supabase.co
 *   OWM_DEV_SUPABASE_SERVICE_ROLE_KEY   read-only use in this spec: only
 *                                   plaintext-by-design columns are ever
 *                                   selected, listed explicitly below
 *
 * All four E2E_STEALTH_TEST_* / OWM_DEV_* vars missing means "no wallet
 * staged yet": the test SKIPS, not fails, so a clean CI run or a
 * contributor's machine does not report a false red for a fixture that
 * does not exist yet.
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { parseExtendedKey, scanWalletTxids, type ScriptType } from "./lib/stealth-chain-truth";

const OWM_DEV_PROJECT_HOST = "bogmoovbjpvcvdqrmjgt.supabase.co";

test.describe("OWM-E0008 acceptance 1a: chain-to-import completeness (staged dev wallet)", () => {
  test("every on-chain txid has a matching imported row, and every imported row has a matching on-chain txid", async () => {
    const xpub = process.env.E2E_STEALTH_TEST_XPUB;
    const scriptTypeOverride = process.env.E2E_STEALTH_TEST_SCRIPT_TYPE as ScriptType | undefined;
    const accountId = process.env.E2E_STEALTH_TEST_ACCOUNT_ID;
    const supabaseUrl = process.env.OWM_DEV_SUPABASE_URL;
    const supabaseKey = process.env.OWM_DEV_SUPABASE_SERVICE_ROLE_KEY;

    test.skip(
      !xpub || !accountId || !supabaseUrl || !supabaseKey,
      "OWM-T0617: no watch-only wallet staged yet (E2E_STEALTH_TEST_XPUB / " +
        "E2E_STEALTH_TEST_ACCOUNT_ID / OWM_DEV_SUPABASE_URL / " +
        "OWM_DEV_SUPABASE_SERVICE_ROLE_KEY not all set). Skipping rather than " +
        "failing: this fixture does not exist by default on a clean clone.",
    );
    if (!xpub || !accountId || !supabaseUrl || !supabaseKey) return;

    const host = new URL(supabaseUrl).host;
    if (host !== OWM_DEV_PROJECT_HOST) {
      throw new Error(
        `OWM_DEV_SUPABASE_URL host is ${host}, expected ${OWM_DEV_PROJECT_HOST}. ` +
          `Refusing to run a chain-completeness comparison against any project that ` +
          `is not the OWM DEV project.`,
      );
    }

    // STEP 1: independent chain truth. Derived and queried entirely
    // outside our own infrastructure; see stealth-chain-truth.ts for why
    // these libraries and why the xpub itself never leaves this process.
    const { hdRoot, scriptType } = parseExtendedKey(xpub, scriptTypeOverride);
    const { usedAddresses, txids: chainTxids } = await scanWalletTxids(hdRoot, scriptType);

    console.log(`[OWM-T0617] script type: ${scriptType}`);
    console.log(`[OWM-T0617] used addresses (non-empty, gap-limit 20): ${usedAddresses.length}`);
    console.log(`[OWM-T0617] distinct on-chain txids: ${chainTxids.size}`);

    // STEP 2: our own imported rows, plaintext columns only. No enc_
    // column is selected here or anywhere in this file.
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from("transactions")
      .select("external_id, external_source, date, account_id")
      .eq("account_id", accountId);

    if (error) {
      throw new Error(`Supabase read failed for account ${accountId}: ${error.message}`);
    }
    const rows = data ?? [];
    const importedExternalIds = new Set(rows.map((r) => r.external_id).filter((v): v is string => !!v));

    console.log(`[OWM-T0617] imported rows for account ${accountId}: ${rows.length}`);
    console.log(`[OWM-T0617] distinct imported external_id values: ${importedExternalIds.size}`);
    console.log(
      `[OWM-T0617] external_source distribution: ${JSON.stringify(
        rows.reduce<Record<string, number>>((acc, r) => {
          const key = r.external_source ?? "(null)";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      )}`,
    );

    // STEP 3: compare, enumerate every difference by id. Never summarize
    // "0 problems found" without also showing the N it is 0 of.
    const missingFromLedger = [...chainTxids].filter((t) => !importedExternalIds.has(t));
    const extraInLedger = [...importedExternalIds].filter((id) => !chainTxids.has(id));

    console.log(
      `[OWM-T0617] on-chain txids with NO matching imported row (${missingFromLedger.length} of ${chainTxids.size}): ` +
        `${missingFromLedger.join(", ") || "(none)"}`,
    );
    console.log(
      `[OWM-T0617] imported rows with NO matching on-chain txid (${extraInLedger.length} of ${importedExternalIds.size}): ` +
        `${extraInLedger.join(", ") || "(none)"}`,
    );
    console.log(
      "[OWM-T0617] STAGED DEV OBSERVATION. This result is against a deliberately staged " +
        "watch-only dev wallet and must never be reported as a production observation.",
    );

    expect(missingFromLedger, "on-chain txids with no matching imported row").toEqual([]);
    expect(extraInLedger, "imported rows with no matching on-chain txid").toEqual([]);
  });
});

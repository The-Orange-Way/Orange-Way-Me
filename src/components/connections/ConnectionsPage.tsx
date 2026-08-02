/**
 * Connections — pure consumer of OrangeRails' hosted /connect widget.
 *
 * OW is a Plaid-style platform consumer of OR via the ow-or-proxy edge
 * function. End users never see "OrangeRails" branding; they see
 * "OrangeWay Connections" backed by a per-user OR subaccount (one per
 * vault / per Supabase user).
 *
 * Add-connection flow (post-migration to the hosted widget):
 *   1. On first mount after unlock: call or-provision → cache
 *      subaccount_id in localStorage under `or_subaccount_id_for_user_<id>`.
 *   2. Add connection: derive cred_key + txn_key from the vault MEK,
 *      open OR's hosted /connect widget (openOrConnect). The widget
 *      owns provider picking, credential entry, discovery, and
 *      source-wallet selection. It posts back the new connection_id
 *      plus the picked source_wallets via postMessage.
 *   3. Map destinations: present DestinationPickerDialog → encrypt
 *      each Personal account.id with the user vault MEK → write to
 *      connection_account_map.
 *   4. Sync: export both OR subkeys as raw base64, hand them to or-sync
 *      for one request (OR holds them in memory only, never persists).
 *   5. List / delete: regular proxy calls. Delete also wipes mapping rows.
 *
 * Key handoff:
 *   The vault's MEK is used (via HKDF) to derive a credentials subkey
 *   and a transactions subkey. Those are passed to OR in the /connect
 *   URL fragment so the widget can encrypt the credential under our
 *   key, and to or-sync for in-memory transaction decryption.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { useAccounts } from "@/hooks/useAccounts";
import { useConnectionAccountMap } from "@/hooks/useConnectionAccountMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DestinationPickerDialog, type DestinationPickerWallet } from "./DestinationPickerDialog";
import { SourceWalletBadges, type DecryptedWalletForBadges } from "./SourceWalletBadges";
import { TransactionList, type EncryptedTxRow } from "./TransactionList";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import type { Account } from "@/lib/connectors/types";
import { importOrTransactions, type OrImportTransaction } from "@/lib/orImportBridge";
import { openOrConnect, type OrLinkSourceWallet } from "@/lib/or/widget";
import { AddBankDialog } from "./AddBankDialog";
import { BankSyncDialog, type BankSyncProgress, type BankSyncOutcome } from "./BankSyncDialog";
import { registerOpk, syncQuilttConnection } from "@/lib/or/bank-sync-opk";
import { opkSealOpen } from "@/lib/or/opk";
import { humanizeError, toastError } from "@/lib/friendly-error";
import { CallProxyError, isSubaccountNotFound } from "@/lib/or/proxy-errors";

const SUBACCOUNT_LS_PREFIX = "or_subaccount_id_for_user_";

// Gate the Orange Rails stealth-sync connector to environments where it is
// actually provisioned. Branch-derived in .github/workflows/deploy.yml
// (VITE_OR_CONNECT_ENABLED), exactly like VITE_ONBOARDING_V2: "true" on the
// dev build, empty on prod. Empty folds the compare to a constant false, so
// the prod bundle never renders the "+ Connect a Bitcoin source" button and
// no route can reach the OR connect widget (DL-0393). `=== "true"` so an
// absent or empty value reads as OFF.
const OR_CONNECT_ENABLED =
  (import.meta.env.VITE_OR_CONNECT_ENABLED as string | undefined) === "true";

/** Map an OR provider_type slug to a user-facing name. Hides the plumbing
 *  (no "quiltt"/"orangerails" jargon). Banks read as "Bank" when we don't
 *  have the institution name at hand. */
function friendlyProviderName(providerType: string): string {
  const map: Record<string, string> = {
    quiltt: "Bank",
    blink: "Blink",
    strike: "Strike",
    sparrow: "Sparrow",
  };
  return map[providerType] ?? providerType.charAt(0).toUpperCase() + providerType.slice(1);
}

interface RawSourceWallet {
  id: string;
  external_wallet_id: string;
  is_synced: boolean;
  encrypted_metadata: string;
}

interface ConnectionRow {
  id: string;
  provider_type: string;
  encrypted_label: string | null;
  encrypted_credentials: string;
  status: "active" | "error" | "disconnected";
  last_sync_at: string | null;
  encrypted_last_error: string | null;
  source_wallets?: RawSourceWallet[];
  // Decrypted client-side after fetch.
  decrypted_label?: string | null;
  decrypted_last_error?: string | null;
  decrypted_wallets?: DecryptedWalletForBadges[];
}

async function callProxy(endpoint: string, payload: Record<string, unknown>): Promise<unknown> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new CallProxyError("Not authenticated", 401, null);

  const res = await supabase.functions.invoke("ow-or-proxy", {
    body: { endpoint, payload },
  });
  if (res.error) {
    // supabase-js wraps non-2xx responses as FunctionsHttpError with the
    // raw Response in .context. The default .message is "Edge Function
    // returned a non-2xx status code" — useless for branching. Parse the
    // body so callers see OR's actual error string + status code.
    let status = 0;
    let body: unknown = null;
    const ctx = (res.error as { context?: Response }).context;
    if (ctx) {
      status = ctx.status ?? 0;
      try {
        body = await ctx.clone().json();
      } catch {
        try {
          body = await ctx.clone().text();
        } catch {
          /* swallow */
        }
      }
    }
    const message =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : null) ||
      res.error.message ||
      `${endpoint} failed`;
    throw new CallProxyError(message, status, body);
  }
  if (res.data && typeof res.data === "object" && "error" in res.data && res.data.error) {
    throw new CallProxyError(String((res.data as { error: unknown }).error), 200, res.data);
  }
  return res.data;
}

/**
 * Destination mapping state. Step 1 (credentials + discovery + source-wallet
 * picking) is owned by OR's hosted widget; the only remaining V-side step
 * is mapping the picked source wallets to local accounts.
 */
type DestState =
  | { kind: "closed" }
  | { kind: "open"; connectionId: string; wallets: DestinationPickerWallet[] };

export function ConnectionsPage() {
  const { user } = useAuth();
  const {
    isUnlocked,
    encryptText,
    decryptOrCipher,
    decryptOrTxnCipher,
    exportOrCredsKey,
    exportOrTxnsKey,
    buildHouseholdSignatureFields,
    getOpkKeypair,
  } = useVault();
  const { accounts, updateAccount } = useAccounts();
  const {
    rows: connAccountMapRows,
    getActiveAccountIds,
    removeAllForConnection,
  } = useConnectionAccountMap();

  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  // OR's connection row has no encrypted_label for the Quiltt flow, so we
  // derive the institution from the first active linked Personal account.
  // This is the real fix for cards stuck on the generic "Bank" fallback for
  // connections that pre-date the AddBankDialog localStorage cache.
  const institutionByConn = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of connAccountMapRows) {
      if (!row.is_active) continue;
      if (m.has(row.or_connection_id)) continue;
      const acc = accountById.get(row.account_id);
      if (acc?.institution && acc.institution.trim().length > 0) {
        m.set(row.or_connection_id, acc.institution.trim());
      }
    }
    return m;
  }, [connAccountMapRows, accountById]);

  const userId = user?.id ?? null;

  const [subaccountId, setSubaccountId] = useState<string | null>(null);
  // Caps the stale-subaccount recovery in refreshList at one attempt per mount.
  // If OR rejects even a freshly provisioned id, clearing and re-provisioning
  // again would loop against OR for as long as the page stays open.
  const recoveredStaleSubaccountRef = useRef(false);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [securing, setSecuring] = useState(false);
  const [securingError, setSecuringError] = useState<string | null>(null);
  const [opkRegistered, setOpkRegistered] = useState(false);
  const [opkRetryNonce, setOpkRetryNonce] = useState(0);
  const [opening, setOpening] = useState(false);
  const [destPicker, setDestPicker] = useState<DestState>({ kind: "closed" });
  const [editMapping, setEditMapping] = useState<DestState>({ kind: "closed" });
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [expandedConnId, setExpandedConnId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConnectionRow | null>(null);
  const [showAddBank, setShowAddBank] = useState(false);
  // The OR connection id the bank-sync dialog should pull. null = closed.
  const [bankSyncConnId, setBankSyncConnId] = useState<string | null>(null);
  const [txRefreshKey, setTxRefreshKey] = useState(0);

  // Resolve cached subaccount on mount / when user changes.
  useEffect(() => {
    if (!user) {
      setSubaccountId(null);
      return;
    }
    const cached = localStorage.getItem(SUBACCOUNT_LS_PREFIX + user.id);
    if (cached) setSubaccountId(cached);
    // Legacy ow_bank_label_* sweep moved to AuthContext so it runs on auth
    // startup regardless of whether the user opens the Connections page.
  }, [user]);

  // Lazily provision when missing (after isUnlocked, since proxy uses JWT).
  useEffect(() => {
    if (!user || subaccountId || !isUnlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = (await callProxy("or-provision", {})) as { subaccount_id: string };
        if (cancelled) return;
        localStorage.setItem(SUBACCOUNT_LS_PREFIX + user.id, res.subaccount_id);
        setSubaccountId(res.subaccount_id);
      } catch (err) {
        if (!cancelled) {
          console.error("[Connections] provision failed", err);
          toast.error(
            humanizeError(err, "We couldn't finish setting up your connections. Try again."),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, subaccountId, isUnlocked]);

  // Register the OPK public key on OR once the subaccount exists. or-quiltt-sync
  // seals background-synced bank transactions to this key; if registration
  // fails or is skipped, OR keeps sealing under a stale (or absent) key and
  // EVERY incoming bank transaction silently fails to unseal. Surface the
  // error loudly so bank-connect is blocked until the key is on file.
  // opkRetryNonce lets the user trigger a re-run when they fix connectivity.
  useEffect(() => {
    if (!subaccountId || !isUnlocked) return;
    let cancelled = false;
    (async () => {
      setSecuring(true);
      setSecuringError(null);
      try {
        const keypair = await getOpkKeypair();
        if (cancelled) return;
        await registerOpk(callProxy, keypair);
        if (cancelled) return;
        setOpkRegistered(true);
      } catch (err) {
        if (cancelled) return;
        console.warn("[Connections] OPK registration failed", err);
        setSecuringError(humanizeError(err, "We couldn't reach our encryption service."));
        setOpkRegistered(false);
      } finally {
        if (!cancelled) setSecuring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subaccountId, isUnlocked, getOpkKeypair, callProxy, opkRetryNonce]);

  // Fetch connections list whenever subaccount + vault are ready.
  const refreshList = useCallback(async () => {
    if (!subaccountId || !isUnlocked) return;
    setLoading(true);
    // Set when the catch below hands off to the provision effect, so the
    // finally leaves the spinner up for the re-provision instead of flashing
    // the "No connections yet" empty state mid-recovery.
    let recovering = false;
    try {
      const res = (await callProxy("or-connection-list", { subaccount_id: subaccountId })) as {
        connections: ConnectionRow[];
      };
      const decoded = await Promise.all(
        (res.connections ?? []).map(async (c): Promise<ConnectionRow> => {
          let decrypted_label: string | null = null;
          let decrypted_last_error: string | null = null;
          if (c.encrypted_label) {
            try {
              decrypted_label = await decryptOrCipher(c.encrypted_label);
            } catch {
              /* cosmetic */
            }
          }
          // Bank-name fallback used to read from a cleartext localStorage
          // cache. Removed (see AddBankDialog) — the institution-name
          // fallback now derives from connection_account_map → accounts at
          // render time, which is encrypted-at-rest like everything else.
          if (c.encrypted_last_error) {
            try {
              decrypted_last_error = await decryptOrCipher(c.encrypted_last_error);
            } catch {
              /* may fail */
            }
          }

          const decrypted_wallets: DecryptedWalletForBadges[] = [];
          for (const w of c.source_wallets ?? []) {
            try {
              const json = await decryptOrCipher(w.encrypted_metadata);
              const parsed = JSON.parse(json) as { currency?: string; label?: string };
              decrypted_wallets.push({
                id: w.id,
                external_wallet_id: w.external_wallet_id,
                is_synced: w.is_synced,
                currency: parsed.currency ?? "",
                label: parsed.label ?? null,
              });
            } catch {
              decrypted_wallets.push({
                id: w.id,
                external_wallet_id: w.external_wallet_id,
                is_synced: w.is_synced,
                currency: "—",
                label: null,
              });
            }
          }

          return { ...c, decrypted_label, decrypted_last_error, decrypted_wallets };
        }),
      );
      setConnections(decoded);
    } catch (err) {
      // An id OR does not recognise is recoverable, so fix it rather than
      // report it. Dropping subaccountId re-runs the provision effect, which
      // issues one against the OR this build actually talks to and re-runs this
      // list when it lands. The OPK effect re-runs on the new id for free.
      if (isSubaccountNotFound(err) && userId && !recoveredStaleSubaccountRef.current) {
        recoveredStaleSubaccountRef.current = true;
        console.warn("[Connections] cached subaccount is unknown to OR, re-provisioning");
        localStorage.removeItem(SUBACCOUNT_LS_PREFIX + userId);
        setSubaccountId(null);
        recovering = true;
        return;
      }
      console.error("[Connections] list failed", err);
      toastError(err, "We couldn't load your connections.");
    } finally {
      if (!recovering) setLoading(false);
    }
  }, [subaccountId, isUnlocked, decryptOrCipher, userId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // ─── Add-connection: hand off to OR's hosted widget ──────────────────

  /**
   * Hand off to OR's hosted /connect widget. The widget owns the provider
   * picker, credential form, discovery, and source-wallet picker; we just
   * give it the locking keys (cred_key, txn_key) so the credential
   * ciphertext OR stores stays decryptable only by this vault. On success
   * it posts back the new connection_id plus the picked source_wallets —
   * we refresh the list and open the OW-side destination picker so the
   * user can route those wallets to their local chart of accounts.
   */
  async function handleAddConnection() {
    if (!user) {
      toast.error("Please sign in first.");
      return;
    }
    setOpening(true);
    try {
      const credKeyB64 = await exportOrCredsKey();
      const txnKeyB64 = await exportOrTxnsKey();
      const result = await openOrConnect({
        orgId: user.id,
        credKeyB64,
        txnKeyB64,
      });
      toast.success("Connection added. Credentials stored as ciphertext only.");

      await refreshList();

      const syncedWallets: OrLinkSourceWallet[] = result.source_wallets ?? [];
      if (syncedWallets.length > 0) {
        setDestPicker({
          kind: "open",
          connectionId: result.connection_id,
          wallets: syncedWallets.map((w) => ({
            external_wallet_id: w.external_wallet_id,
            currency: w.currency,
            label: w.label ?? null,
          })),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "User cancelled" || msg === "Widget closed before completion") {
        toast.info("Connection cancelled.");
      } else {
        console.error("[Connections] openOrConnect failed", err);
        toastError(err, "We couldn't open the connect window.");
      }
    } finally {
      setOpening(false);
    }
  }

  function handleDestinationDone() {
    setDestPicker({ kind: "closed" });
    void refreshList();
  }

  function handleEditMapping(conn: ConnectionRow) {
    const wallets = (conn.decrypted_wallets ?? [])
      .filter((w) => w.is_synced)
      .map((w) => ({
        external_wallet_id: w.external_wallet_id,
        currency: w.currency,
        label: w.label,
      }));
    if (wallets.length === 0) {
      toast.info("No source wallets configured for this connection. Reconnect to pick wallets.");
      return;
    }
    setEditMapping({ kind: "open", connectionId: conn.id, wallets });
  }

  // ─── Sync + Delete ────────────────────────────────────────────────────

  async function handleSync(conn: ConnectionRow) {
    if (!subaccountId) return;

    // Bank (Quiltt) connections use the OPK sealed-box path, not the
    // Bitcoin-source or-sync path. Route them to the BankSyncDialog which
    // fetches OPK-sealed rows via or-transactions-list, unseals with the
    // vault OPK key, and imports. The old or-sync path below is for
    // Bitcoin sources (Blink/Strike/etc.) only.
    if (conn.provider_type === "quiltt") {
      setBankSyncConnId(conn.id);
      return;
    }

    setSyncingId(conn.id);
    try {
      const credentials_key = await exportOrCredsKey();
      const transactions_key = await exportOrTxnsKey();
      const res = (await callProxy("or-sync", {
        subaccount_id: subaccountId,
        connection_ids: [conn.id],
        credentials_key,
        transactions_key,
      })) as {
        synced: number;
        connections: Array<{ connection_id: string; synced: number; error?: string }>;
      };

      const errs = res.connections.filter((c) => c.error);
      if (errs.length > 0) {
        const firstMsg = humanizeError(errs[0]?.error ?? "", "Something went wrong.");
        const suffix =
          errs.length > 1
            ? ` (and ${errs.length - 1} other${errs.length - 1 === 1 ? "" : "s"})`
            : "";
        if (res.synced > 0) {
          toast.warning(
            `Synced ${res.synced}; ${errs.length} connection${errs.length === 1 ? "" : "s"} had trouble: ${firstMsg}${suffix}`,
          );
        } else {
          toast.error(
            `${errs.length} connection${errs.length === 1 ? "" : "s"} couldn't sync: ${firstMsg}${suffix}`,
          );
        }
        console.warn(
          "[Connections] partial sync failures",
          errs.map((e) => ({ connection_id: e.connection_id, error: e.error })),
        );
      } else if (res.synced === 0) {
        toast.info("Up to date. No new transactions.");
      } else {
        toast.success(
          `Synced ${res.synced} transaction${res.synced === 1 ? "" : "s"} from ${
            conn.decrypted_label ||
            institutionByConn.get(conn.id) ||
            friendlyProviderName(conn.provider_type)
          }`,
        );
      }

      if (user && res.synced > 0) {
        try {
          const importResult = await importSyncedTransactionsForConnection(conn);
          if (importResult.unmapped > 0 && importResult.unmappedWalletIds.length > 0) {
            handleEditMapping(conn);
          }
        } catch (importErr) {
          console.error("[Connections] OR import bridge failed", importErr);
          toast.error(`Couldn't add transactions to your ledger. ${humanizeError(importErr)}`);
        }
      }

      await refreshList();
      setTxRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("[Connections] sync failed", err);
      toast.error(`Sync failed. ${humanizeError(err)}`);
    } finally {
      setSyncingId(null);
    }
  }

  async function handleSyncAll() {
    if (!subaccountId) return;
    if (connections.length === 0) return;
    setSyncingAll(true);
    try {
      const credentials_key = await exportOrCredsKey();
      const transactions_key = await exportOrTxnsKey();
      const res = (await callProxy("or-sync", {
        subaccount_id: subaccountId,
        connection_ids: connections.map((c) => c.id),
        credentials_key,
        transactions_key,
      })) as {
        synced: number;
        connections: Array<{ connection_id: string; synced: number; error?: string }>;
      };

      const errs = res.connections.filter((c) => c.error);
      const okCount = res.connections.filter((c) => !c.error).length;
      if (errs.length === 0) {
        if (res.synced === 0) {
          toast.info("Sync all: no new transactions across any wallet.");
        } else {
          toast.success(
            `Sync all: ${res.synced} transaction${res.synced === 1 ? "" : "s"} across ${okCount} wallet${okCount === 1 ? "" : "s"}.`,
          );
        }
      } else {
        const firstMsg = humanizeError(errs[0]?.error ?? "", "Something went wrong.");
        const suffix =
          errs.length > 1
            ? ` (and ${errs.length - 1} other${errs.length - 1 === 1 ? "" : "s"})`
            : "";
        if (res.synced > 0) {
          toast.warning(
            `Synced ${res.synced} across ${okCount} wallet${okCount === 1 ? "" : "s"}; ${errs.length} had trouble: ${firstMsg}${suffix}`,
          );
        } else {
          toast.error(
            `${errs.length} connection${errs.length === 1 ? "" : "s"} couldn't sync: ${firstMsg}${suffix}`,
          );
        }
        console.warn(
          "[Connections] sync-all partial failures",
          errs.map((e) => ({ connection_id: e.connection_id, error: e.error })),
        );
      }

      if (user) {
        const succeeded = res.connections.filter((c) => !c.error && c.synced > 0);
        for (const succ of succeeded) {
          const conn = connections.find((c) => c.id === succ.connection_id);
          if (!conn) continue;
          try {
            await importSyncedTransactionsForConnection(conn);
          } catch (importErr) {
            console.error(
              `[Connections] OR import bridge failed for ${succ.connection_id}`,
              importErr,
            );
          }
        }
      }

      await refreshList();
      setTxRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("[Connections] sync all failed", err);
      toast.error(`Sync failed. ${humanizeError(err)}`);
    } finally {
      setSyncingAll(false);
    }
  }

  /**
   * After or-sync finishes, fetch the encrypted transactions for this
   * connection from OR, decrypt them in the browser with ORT, and hand
   * them to the bridge so each routed row lands in the local
   * `transactions` table.
   */
  // OPK bank sync: fetch OPK-sealed rows for one Quiltt connection, unseal
  // with the vault OPK private key, import (re-encrypt under MEK). Drives
  // the BankSyncDialog progress UI.
  const runBankSync = useCallback(
    async (
      orConnectionId: string | null,
      onProgress: (p: BankSyncProgress) => void,
    ): Promise<BankSyncOutcome> => {
      if (!user || !subaccountId || !orConnectionId) {
        return { imported: 0, total: 0, unmapped: 0, errored: 0 };
      }
      const keypair = await getOpkKeypair();
      // Ensure the OPK is registered before pulling (covers the race where
      // the mount-effect registration hasn't completed yet). Failures here
      // MUST propagate — a missed OPK registration means OR seals every
      // incoming transaction under a stale key and the user silently loses
      // all newly-synced bank data.
      await registerOpk(callProxy, keypair);

      const result = await syncQuilttConnection({
        callProxy,
        subaccountId,
        connectionId: orConnectionId,
        keypair,
        onProgress: (done, total) => onProgress({ done, total }),
        deps: {
          supabase,
          userId: user.id,
          encryptText,
          resolveAccountIds: (cId, sourceWalletId) => getActiveAccountIds(cId, sourceWalletId),
          getAccountCurrency: (accountId) => accountById.get(accountId)?.currency,
          onError: (orTxId, err) => console.warn(`[bank-sync] tx ${orTxId} failed`, err),
          buildSignatureFields: buildHouseholdSignatureFields,
        },
      });

      // Apply per-account balance deltas for newly-inserted rows.
      for (const [accountId, net] of Object.entries(result.netByAccount)) {
        if (net === 0) continue;
        const acc = accountById.get(accountId);
        if (!acc) continue;
        const currentBal = Number(acc.balance) || 0;
        try {
          await updateAccount(accountId, { balance: String(currentBal + net) });
        } catch (balErr) {
          console.warn(`[bank-sync] balance update failed for ${accountId}`, balErr);
        }
      }

      return {
        imported: result.imported,
        total: result.total,
        unmapped: result.unmapped,
        errored: result.errored,
      };
    },
    [
      user,
      subaccountId,
      getOpkKeypair,
      encryptText,
      getActiveAccountIds,
      accountById,
      buildHouseholdSignatureFields,
      updateAccount,
    ],
  );

  async function importSyncedTransactionsForConnection(
    conn: ConnectionRow,
  ): Promise<{ unmapped: number; unmappedWalletIds: string[] }> {
    if (!user || !subaccountId) return { unmapped: 0, unmappedWalletIds: [] };
    const listRes = (await callProxy("or-transactions-list", {
      subaccount_id: subaccountId,
      limit: 500,
    })) as { transactions: EncryptedTxRow[] };
    const forThisConn = (listRes.transactions ?? []).filter((t) => t.connection_id === conn.id);
    if (forThisConn.length === 0) return { unmapped: 0, unmappedWalletIds: [] };

    const decoded: OrImportTransaction[] = [];
    let decryptFailures = 0;
    for (const row of forThisConn) {
      try {
        const json = await decryptOrTxnCipher(row.encrypted_payload);
        const payload = JSON.parse(json) as OrImportTransaction;
        decoded.push(payload);
      } catch {
        decryptFailures += 1;
      }
    }

    const result = await importOrTransactions(conn.id, decoded, {
      supabase,
      userId: user.id,
      encryptText,
      resolveAccountIds: (orConnectionId, sourceWalletId) =>
        getActiveAccountIds(orConnectionId, sourceWalletId),
      getAccountCurrency: (accountId) => accountById.get(accountId)?.currency,
      onError: (orTxId, err) => {
        console.warn(`[orImportBridge] tx ${orTxId} failed`, err);
      },
      buildSignatureFields: buildHouseholdSignatureFields,
    });

    const balanceEntries = Object.entries(result.netByAccount);
    if (balanceEntries.length > 0) {
      for (const [accountId, net] of balanceEntries) {
        if (net === 0) continue;
        const acc = accountById.get(accountId);
        if (!acc) continue;
        const currentBal = Number(acc.balance) || 0;
        try {
          await updateAccount(accountId, { balance: String(currentBal + net) });
        } catch (balErr) {
          console.warn(`[Connections] balance update failed for ${accountId}`, balErr);
        }
      }
    }

    const skipped = result.unmapped + result.untagged + decryptFailures;
    if (result.imported === 0 && skipped === 0 && result.errored === 0) {
      return { unmapped: 0, unmappedWalletIds: [] };
    }
    const parts: string[] = [];
    if (result.imported > 0) parts.push(`${result.imported} imported`);
    if (result.unmapped > 0) parts.push(`${result.unmapped} unmapped`);
    if (result.untagged > 0) parts.push(`${result.untagged} untagged`);
    if (decryptFailures > 0) parts.push(`${decryptFailures} undecryptable`);
    if (result.errored > 0) parts.push(`${result.errored} errored`);
    const summary = parts.join(", ");
    if (result.unmapped > 0 && result.unmappedWalletIds.length > 0) {
      console.warn(
        `[OW Connections] ${result.unmapped} transaction(s) skipped because these source wallets have no destination mapping:`,
        result.unmappedWalletIds,
        "→ Click 'Edit mapping' on the connection card to map them.",
      );
    }
    if (result.errored > 0 || decryptFailures > 0) {
      toast.warning(`Wallet ledger: ${summary}.`);
    } else if (result.unmapped > 0 || result.untagged > 0) {
      toast.info(`Wallet ledger: ${summary}.`);
    } else {
      toast.success(`Wallet ledger: ${summary}.`);
    }
    return { unmapped: result.unmapped, unmappedWalletIds: result.unmappedWalletIds };
  }

  function handleDelete(conn: ConnectionRow) {
    setPendingDelete(conn);
  }

  async function handleDeleteConfirmed(conn: ConnectionRow) {
    if (!subaccountId) return;
    const name =
      conn.decrypted_label ||
      institutionByConn.get(conn.id) ||
      friendlyProviderName(conn.provider_type);

    // Optimistic: drop the row immediately so the action feels instant —
    // no dead "nothing happened" gap while the network call runs. We also
    // remember it so we can restore on a genuine (non-404) failure.
    const snapshot = connections;
    setConnections((prev) => prev.filter((c) => c.id !== conn.id));

    try {
      await callProxy("or-connection-delete", {
        subaccount_id: subaccountId,
        connection_id: conn.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 / not-found means it's already gone — that's success, not error
      // (the double-click that caused this is exactly what we're fixing).
      if (!/not.?found|404/i.test(msg)) {
        console.error("[Connections] delete failed", err);
        setConnections(snapshot); // restore the row — delete genuinely failed
        toast.error("Couldn't disconnect. Give it a moment and try again.");
        return;
      }
    }

    // Clean up the local account mappings (best-effort).
    try {
      await removeAllForConnection(conn.id);
    } catch (mapErr) {
      console.warn("[Connections] removeAllForConnection failed", mapErr);
    }
    toast.success(`${name} disconnected`);
    setTxRefreshKey((k) => k + 1);
  }

  // ─── Helpers passed to TransactionList ────────────────────────────────

  const resolveAccount = useCallback(
    (accountId: string): Account | null => accountById.get(accountId) ?? null,
    [accountById],
  );

  const resolveMapping = useCallback(
    (orConnectionId: string, sourceWalletId: string) =>
      getActiveAccountIds(orConnectionId, sourceWalletId),
    [getActiveAccountIds],
  );

  const fetchEncryptedFor = useCallback(
    (connectionId: string) => async (): Promise<EncryptedTxRow[]> => {
      if (!subaccountId) return [];
      const res = (await callProxy("or-transactions-list", {
        subaccount_id: subaccountId,
        limit: 100,
      })) as { transactions: EncryptedTxRow[] };
      return (res.transactions ?? []).filter((t) => t.connection_id === connectionId);
    },
    [subaccountId],
  );

  // ─── Render ───────────────────────────────────────────────────────────

  if (!isUnlocked) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-muted-foreground">Unlock your vault to manage connections.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-4 sm:px-6 sm:py-6">
      <div className="space-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Connections</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bring every transaction from your banks and Bitcoin accounts into one place,
            automatically. Encrypted end to end with your vault key, so no one else can read your
            data.
          </p>
        </div>
        {subaccountId && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={() => setShowAddBank(true)}
              disabled={securing || !opkRegistered}
              title={
                !opkRegistered ? "Securing the connection — please wait or retry above" : undefined
              }
              data-testid="connections-add-bank"
              className="w-full"
            >
              + Connect a bank
            </Button>
            {OR_CONNECT_ENABLED && (
              <Button
                onClick={() => void handleAddConnection()}
                disabled={opening || securing || !opkRegistered}
                title={
                  !opkRegistered ? "Securing the connection — please wait or retry above" : undefined
                }
                data-testid="connections-add"
                className="w-full"
              >
                {opening ? "Opening…" : "+ Connect a Bitcoin source"}
              </Button>
            )}
            {connections.length > 1 && (
              <Button
                variant="ghost"
                onClick={() => void handleSyncAll()}
                disabled={syncingAll || syncingId !== null}
                className="w-full sm:col-span-2"
              >
                {syncingAll ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing all…
                  </>
                ) : (
                  <>Sync all connections</>
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* No setup spinner here on purpose. It used to show 'Connecting…' or
          'Securing your data…' on the empty state, and it could contradict
          itself: the provision effect only cleared its flag when the run was
          not cancelled, so a run cancelled mid-flight left the spinner up
          forever while the failure banner below said the opposite. The two
          connect buttons already disable while `securing`, and any failure
          surfaces in that banner, so the spinner carried no signal of its
          own. Setup is a background concern; it does not need its own box. */}

      {/* OPK registration failed — surface loudly. Without a registered OPK
          public key on OR, every incoming bank transaction would seal under
          a stale or absent key and never decrypt. Bank-connect is blocked
          (the AddBankDialog opener is disabled below on `!opkRegistered`)
          until the user clicks Retry and OR is reachable again. */}
      {securingError && !securing && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-destructive">Couldn't finish securing your data.</p>
            <p className="text-xs text-muted-foreground">
              Bank connect is paused until we can reach the encryption service.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpkRetryNonce((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {loading && connections.length === 0 ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : connections.length === 0 ? (
        <div className="space-y-2 rounded-md border border-dashed p-8 text-center">
          <Zap className="mx-auto h-8 w-8 text-orange-500" />
          <p className="text-sm font-medium">No connections yet</p>
          <p className="mx-auto max-w-md text-xs text-muted-foreground">
            Connect a bank or a Bitcoin source to start importing your transactions automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((c) => (
            <ConnectionCard
              key={c.id}
              conn={c}
              derivedInstitution={institutionByConn.get(c.id) ?? null}
              syncing={syncingId === c.id}
              expanded={expandedConnId === c.id}
              onToggleExpand={() => setExpandedConnId((prev) => (prev === c.id ? null : c.id))}
              onSync={() => handleSync(c)}
              onDelete={() => handleDelete(c)}
              onEditMapping={() => handleEditMapping(c)}
              fetchEncrypted={fetchEncryptedFor(c.id)}
              decrypt={
                c.provider_type === "quiltt"
                  ? async (b64: string) => {
                      const kp = await getOpkKeypair();
                      if (!kp) throw new Error("Vault locked");
                      const json = await opkSealOpen(b64, kp);
                      // Normalize the OR seal payload to the shape
                      // TransactionList expects:
                      //   description (raw bank text) → parse out the
                      //     "Merchant name:" suffix so the Memo column reads
                      //     "Mercury Credit" not "IO AUTOPAY; Merchant name…"
                      //   entry_type (CREDIT/DEBIT) → direction
                      //   account_id (Quiltt account id) → source_wallet_id
                      try {
                        const raw = JSON.parse(json) as {
                          amount?: number | string;
                          currency?: string;
                          description?: string | null;
                          entry_type?: string;
                          account_id?: string | null;
                        };
                        const description = (raw.description ?? "").trim();
                        const m = description.match(/Merchant name:\s*(.+?)(?:\s*[;|]|$)/i);
                        const counterparty = m?.[1]?.trim() || description || null;
                        const amt =
                          typeof raw.amount === "string" ? Number(raw.amount) : (raw.amount ?? 0);
                        const direction =
                          (raw.entry_type ?? "").toUpperCase() === "CREDIT" ? "in" : "out";
                        return JSON.stringify({
                          type: "bank",
                          direction,
                          amount: Number.isFinite(amt) ? Math.abs(amt) : 0,
                          currency: raw.currency ?? null,
                          description: description || null,
                          counterparty,
                          source_wallet_id: raw.account_id ?? null,
                        });
                      } catch {
                        // If normalization fails, surface the raw text so the
                        // user at least sees something.
                        return json;
                      }
                    }
                  : decryptOrTxnCipher
              }
              resolveAccount={resolveAccount}
              resolveMapping={resolveMapping}
              destinationsByWallet={Object.fromEntries(
                (c.decrypted_wallets ?? [])
                  .filter((w) => w.is_synced)
                  .map((w) => {
                    const ids = getActiveAccountIds(c.id, w.external_wallet_id);
                    const names = ids
                      .map((id) => accountById.get(id)?.name)
                      .filter((n): n is string => Boolean(n));
                    return [w.external_wallet_id, { wallet: w, accountNames: names }];
                  }),
              )}
              refreshKey={txRefreshKey}
            />
          ))}
        </div>
      )}

      {destPicker.kind === "open" && (
        <DestinationPickerDialog
          orConnectionId={destPicker.connectionId}
          wallets={destPicker.wallets}
          onCancel={() => {
            // Closing without saving still leaves the source_wallets row in
            // place; user can re-open via "Edit mapping" later.
            void refreshList();
            setDestPicker({ kind: "closed" });
          }}
          onDone={handleDestinationDone}
        />
      )}

      {editMapping.kind === "open" && (
        <DestinationPickerDialog
          orConnectionId={editMapping.connectionId}
          wallets={editMapping.wallets}
          onCancel={() => setEditMapping({ kind: "closed" })}
          onDone={() => {
            setEditMapping({ kind: "closed" });
            void refreshList();
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Delete connection?"
        description={
          pendingDelete
            ? `Delete the ${
                pendingDelete.decrypted_label ||
                institutionByConn.get(pendingDelete.id) ||
                friendlyProviderName(pendingDelete.provider_type)
              } connection? Synced transactions for this connection will also be removed. This cannot be undone.`
            : ""
        }
        cancelLabel="Cancel"
        confirmLabel="Delete connection"
        destructive
        onConfirm={async () => {
          const conn = pendingDelete;
          if (!conn) return;
          await handleDeleteConfirmed(conn);
        }}
      />

      <AddBankDialog
        open={showAddBank}
        onOpenChange={setShowAddBank}
        onConnected={(orConnectionId) => {
          void refreshList();
          // Auto-launch the first sync so the user immediately sees their
          // transactions populate. The OPK is already registered (mount
          // effect), so or-quiltt-sync will have sealed the rows.
          if (orConnectionId) setBankSyncConnId(orConnectionId);
        }}
      />

      <BankSyncDialog
        open={bankSyncConnId !== null}
        onOpenChange={(o) => {
          if (!o) setBankSyncConnId(null);
        }}
        runSync={async (onProgress) => runBankSync(bankSyncConnId, onProgress)}
        onDone={() => {
          void refreshList();
          setTxRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}

interface DestinationSummary {
  wallet: DecryptedWalletForBadges;
  accountNames: string[];
}

function ConnectionCard({
  conn,
  derivedInstitution,
  syncing,
  expanded,
  onToggleExpand,
  onSync,
  onDelete,
  onEditMapping,
  fetchEncrypted,
  decrypt,
  resolveAccount,
  resolveMapping,
  destinationsByWallet,
  refreshKey,
}: {
  conn: ConnectionRow;
  /** Institution name derived from the first linked Personal account, used
   *  when conn.decrypted_label is empty (e.g. Quiltt bank connections). */
  derivedInstitution: string | null;
  syncing: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSync: () => void;
  onDelete: () => void;
  onEditMapping: () => void;
  fetchEncrypted: () => Promise<EncryptedTxRow[]>;
  decrypt: (ciphertext: string) => Promise<string>;
  resolveAccount: (accountId: string) => Account | null;
  resolveMapping: (orConnectionId: string, sourceWalletId: string) => string[];
  destinationsByWallet: Record<string, DestinationSummary>;
  refreshKey: number;
}) {
  // Title prefers the real bank/institution name (Mercury, TD) over generic
  // provider words ("Bank"). Provider stays as a small subtitle so the user
  // still knows whether it's a bank link vs a Bitcoin wallet, without
  // burying the recognisable name.
  const providerWord = friendlyProviderName(conn.provider_type);
  const realName = conn.decrypted_label || derivedInstitution;
  const cardTitle = realName || providerWord;
  const cardSubtitle = realName ? providerWord : null;

  // User-facing status copy. Internal enum is active/error/disconnected;
  // surface it in words a non-engineer reads as actionable.
  const statusLabel =
    conn.status === "active"
      ? "Connected"
      : conn.status === "error"
        ? "Needs attention"
        : "Disconnected";
  const statusColor =
    conn.status === "active"
      ? "border-green-500/40 text-green-700 dark:text-green-400"
      : conn.status === "error"
        ? "border-destructive/40 text-destructive"
        : "border-muted text-muted-foreground";

  const wallets = conn.decrypted_wallets ?? [];
  const hasSyncedWallets = wallets.some((w) => w.is_synced);
  const noSourceWallets = wallets.length === 0;

  // Full account-map display: every linked source wallet → destination account,
  // not just the first one. Shown as a stacked list when the card is expanded
  // and as a single truncated line in the collapsed header.
  const destinationRows = Object.entries(destinationsByWallet)
    .filter(([, summary]) => summary.accountNames.length > 0)
    .map(([, summary]) => ({
      label: summary.wallet.label?.trim() || summary.wallet.currency,
      destinations: summary.accountNames,
    }));
  const destinationChips = destinationRows.map((row) => {
    const extra = row.destinations.length - 1;
    return `${row.label} → ${row.destinations[0]}${extra > 0 ? ` +${extra}` : ""}`;
  });

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-4 p-4">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={expanded}
        >
          <span className="mt-0.5 text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{cardTitle}</span>
              {cardSubtitle && (
                <span className="text-xs text-muted-foreground">· {cardSubtitle}</span>
              )}
              <Badge variant="outline" className={`text-xs ${statusColor}`}>
                {statusLabel}
              </Badge>
              {noSourceWallets && (
                <Badge
                  variant="outline"
                  className="border-amber-500/50 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400"
                  title="No accounts are linked yet. Reconnect to pick which accounts feed in."
                >
                  No accounts linked
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {conn.last_sync_at ? `Synced ${timeAgo(conn.last_sync_at)}` : "Never synced"}
            </div>
            {/* The "Default account" badge duplicates the "No accounts linked"
                warning pill above, so only render the wallet chips here when
                we actually have wallets to show. */}
            {!noSourceWallets && (
              <div className="mt-2">
                <SourceWalletBadges wallets={wallets} />
              </div>
            )}
            {/* Account-map preview. When the card is expanded we render the
                full stacked list further below; this is the at-a-glance
                truncated form for the collapsed header. */}
            {destinationChips.length > 0 && !expanded && (
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {destinationChips.join(" · ")}
              </div>
            )}
            {conn.decrypted_last_error && (
              <div className="mt-1 flex items-start gap-1 truncate text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{humanizeError(conn.decrypted_last_error)}</span>
              </div>
            )}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button onClick={onSync} disabled={syncing} variant="outline" size="sm">
            {syncing ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Syncing…
              </>
            ) : (
              "Sync"
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onEditMapping} disabled={!hasSyncedWallets}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Edit mapping
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete connection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t bg-muted/20 px-4 py-3">
          {destinationRows.length > 0 && (
            <div className="rounded-md border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Where each account feeds in
                </span>
                <button
                  type="button"
                  onClick={onEditMapping}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Edit
                </button>
              </div>
              <ul className="space-y-1.5 text-sm">
                {destinationRows.map((row, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted-foreground">{row.label}</span>
                    <span className="truncate text-right font-medium">
                      {row.destinations.join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <TransactionList
            orConnectionId={conn.id}
            fetchEncrypted={fetchEncrypted}
            decrypt={decrypt}
            resolveAccount={resolveAccount}
            resolveMapping={resolveMapping}
            refreshKey={refreshKey}
          />
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

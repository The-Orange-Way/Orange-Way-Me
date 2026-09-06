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
 *   2. Add a Bitcoin source: open the hosted /connect route with no
 *      provider named (openOrConnect), so its searchable source list
 *      appears and the user finds their own source among the full
 *      catalogue. The hosted side owns provider picking, credential
 *      entry, discovery and Stealth Sync, and reports back over
 *      postMessage. Bank connections keep their own dialog and route.
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
import { captureException, captureMessage } from "@/lib/observability/sentry";
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
import { openOrConnect, mintWidgetToken, type OrLinkSourceWallet } from "@/lib/or/widget";
import { describeLinkResult } from "@/lib/or/link-result";
import { buildDeletePlan, classifyDeleteReadback } from "@/lib/or/connection-delete";
import { planSyncAll, reportSyncAll, type SyncAllResultEntry } from "@/lib/or/sync-all";
import { planSyncRoute } from "@/lib/or/sync-route";
import { requestOrSync } from "@/lib/or/or-sync-request";
import { startStealthSyncRun, finishStealthSyncRun } from "@/lib/stealthSyncRuns";
import {
  startStealthSync,
  describeStealthProgress,
  shouldShowScanProgress,
  describeStealthFailure,
  type StealthSyncProgress,
  type StealthCursorKnowledge,
} from "@/lib/stealth/sync";
import { isStealthSyncEnabled, refreshRuntimeFlagsForDoor } from "@/lib/stealth/runtimeFlags";
import { planCatalogueAdd } from "@/lib/or/add-gate";
import { describeStealthAvailability, readStealthUnavailable } from "@/lib/stealth/availability";
import { describeImportOutcome } from "@/lib/stealth/import-outcome";
import {
  orRowsForConnection,
  sealedRecordToCipherB64,
  stealthPageFromResponse,
  withStealthSourceWallet,
  withStealthSourceWalletId,
  type StealthPageCursor,
  type StealthSealedRow,
} from "@/lib/stealth/ledger";
import type { StealthChannel } from "@/lib/stealth/channel";
import { nextTransactionsPage, type TransactionRow } from "@/lib/or/transactions-page";
import { AddBankDialog } from "./AddBankDialog";
import { BankSyncDialog, type BankSyncProgress, type BankSyncOutcome } from "./BankSyncDialog";
import { registerOpk, syncQuilttConnection } from "@/lib/or/bank-sync-opk";
import { opkSealOpen } from "@/lib/or/opk";
import { humanizeError, humanizeOrDisabledReason, toastError } from "@/lib/friendly-error";
import {
  CallProxyError,
  isSubaccountNotFound,
  proxyErrorMessageFromBody,
} from "@/lib/or/proxy-errors";

const SUBACCOUNT_LS_PREFIX = "or_subaccount_id_for_user_";

// Gate the Orange Rails stealth-sync connector to environments where it is
// actually provisioned. Branch-derived in .github/workflows/deploy.yml
// (VITE_OR_CONNECT_ENABLED). It is set to "true" on BOTH the dev and prod
// branches (OWM-T0501), so the "+ Connect a Bitcoin source" button renders
// on production too. `=== "true"` so an absent or empty value (any other
// branch, or a local build that forgets the variable) reads as OFF.
const OR_CONNECT_ENABLED = import.meta.env.VITE_OR_CONNECT_ENABLED === "true";

/** Map an OR provider_type slug to a user-facing name. Hides the plumbing
 *  (no "quiltt"/"orangerails" jargon). Banks read as "Bank" when we don't
 *  have the institution name at hand. */
function friendlyProviderName(providerType: string): string {
  const map: Record<string, string> = {
    quiltt: "Bank",
    blink: "Blink",
    strike: "Strike",
    sparrow: "Sparrow",
    xpub_stealth: "Private wallet",
  };
  const key = providerType.toLowerCase();
  return map[key] ?? providerType.charAt(0).toUpperCase() + providerType.slice(1);
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
  // Set by or-connection-list on rows that come from the stealth store rather
  // than the `connections` table. Optional because a response predating the
  // union omits it, and an absent flag must read as "not stealth" rather than
  // throw. These rows are scanned by the OR widget, not by `or-sync`, so the
  // flag is what routes Sync. `source_wallets` is always [] on them: the
  // stealth store has no equivalent table, so anything gated on wallets being
  // present is structurally false here and must branch on this instead.
  is_stealth?: boolean;
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
    // The message goes through the SAME rule as the body, not merely the same
    // length cap. proxyErrorMessageFromBody refuses a non-scalar under `error`,
    // so a list the body drops cannot ride out in the message beside it. The
    // raw String(body.error) that used to be here was the second door: the
    // constructor cap bounded that content at 200 characters rather than
    // refusing it. Both fallbacks are unchanged.
    const message = proxyErrorMessageFromBody(body) || res.error.message || `${endpoint} failed`;
    throw new CallProxyError(message, status, body);
  }
  if (res.data && typeof res.data === "object" && "error" in res.data && res.data.error) {
    // Same rule as the non-2xx branch above. There is no transport message to
    // fall back to on a 200, so when `error` is not a short scalar the endpoint
    // name is the honest answer: it says which call failed without repeating
    // the content we just refused to carry.
    throw new CallProxyError(
      proxyErrorMessageFromBody(res.data) ?? `${endpoint} failed`,
      200,
      res.data,
    );
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
    orNamespaceDisabledReason,
  } = useVault();
  const { accounts, updateAccount } = useAccounts();

  /**
   * The vault key handover for or-sync, built once and shared by both press
   * paths. or-sync is the only path in this app that takes these two keys out
   * of the vault, so there is one object that can do it and one function that
   * accepts it, and that function checks the route before it uses either
   * (OWM-T0544). callProxy is module scope and stable, so it is not a
   * dependency here.
   */
  const orSyncKeys = useMemo(
    () => ({
      exportCredentialsKey: exportOrCredsKey,
      exportTransactionsKey: exportOrTxnsKey,
      callProxy,
    }),
    [exportOrCredsKey, exportOrTxnsKey],
  );

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
  // Ids confirmed deleted in this session. Used in handleDeleteConfirmed
  // to distinguish a 404 on a previously-confirmed delete (treat as success)
  // from an unexpected 404 where the row may still exist server-side.
  const deletedConnectionIdsRef = useRef<Set<string>>(new Set());
  // The live stealth transport, when a scan is running. Held in a ref rather
  // than state because nothing renders from it and it must be stoppable from
  // the widget's own callbacks. Stopped on unmount so its window message
  // listener can never outlive this page.
  const channelRef = useRef<StealthChannel | null>(null);
  /**
   * DL-1171. What we have actually watched happen to each connection's scan
   * position, keyed by connection id.
   *
   * A ref and not state on purpose: nothing renders from it directly, it is
   * read at the moment a failure toast is built, and putting it in state would
   * re-render the whole page once per completed scan for no visible change.
   *
   * Scope is this page's lifetime, and that is not an oversight. A reload
   * empties it and the UI then correctly says it has seen no scan finish,
   * because it has not. Persisting it would mean claiming knowledge about the
   * upstream cursor that survived longer than our evidence for it.
   */
  const cursorKnowledgeRef = useRef<Map<string, StealthCursorKnowledge>>(new Map());
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [securing, setSecuring] = useState(false);
  const [securingError, setSecuringError] = useState<string | null>(null);
  const [opkRegistered, setOpkRegistered] = useState(false);
  const [opkRetryNonce, setOpkRetryNonce] = useState(0);
  const [opening, setOpening] = useState(false);
  // Connection to ring and scroll to after the connect widget closes. The
  // "you already have this" case has nothing new to show, so without this the
  // toast points at a row the user then has to hunt for themselves.
  const [highlightedConnId, setHighlightedConnId] = useState<string | null>(null);

  // The ring is an answer to a question the user just asked, not permanent
  // furniture. Drop it once it has been seen.
  useEffect(() => {
    if (!highlightedConnId) return;
    const t = setTimeout(() => setHighlightedConnId(null), 6000);
    return () => clearTimeout(t);
  }, [highlightedConnId]);
  const [destPicker, setDestPicker] = useState<DestState>({ kind: "closed" });
  const [editMapping, setEditMapping] = useState<DestState>({ kind: "closed" });
  const [syncingId, setSyncingId] = useState<string | null>(null);
  /**
   * DL-1111. The latest progress frame from the stealth widget, for whichever
   * connection `syncingId` names. Only one stealth scan runs at a time (the
   * transport keeps a single channel in `channelRef`), so a single slot is
   * enough and a map would imply a concurrency we do not have.
   *
   * Held here rather than in the card because the card unmounts and remounts
   * on every `refreshList`, and progress that resets to nothing each time the
   * list refreshes is worse than no progress at all.
   */
  const [stealthProgress, setStealthProgress] = useState<StealthSyncProgress | null>(null);
  /**
   * #313. Which row, if any, has the in-browser stealth scan path running.
   * Distinct from syncingId on purpose: syncingId is true for ANY sync of any
   * connection kind, and a private row synced by the generic path does no
   * scanning, so driving scan UI off syncingId claims work that never started.
   */
  const [stealthScanId, setStealthScanId] = useState<string | null>(null);
  // DL-1113. or-connection-list reports a failed private-wallet arm as a 200
  // with this flag set, not as an error, so without holding it here the rows
  // simply vanish and the page looks like it belongs to someone who has none.
  const [stealthUnavailable, setStealthUnavailable] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [expandedConnId, setExpandedConnId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConnectionRow | null>(null);
  const [showAddBank, setShowAddBank] = useState(false);
  // The OR connection id the bank-sync dialog should pull. null = closed.
  const [bankSyncConnId, setBankSyncConnId] = useState<string | null>(null);
  const [txRefreshKey, setTxRefreshKey] = useState(0);

  // Stop any live stealth transport when this page goes away. The channel adds
  // a window message listener, so leaving it running would keep handling frames
  // from a popup belonging to a page the user has already navigated off.
  useEffect(() => {
    return () => {
      channelRef.current?.stop();
      channelRef.current = null;
    };
  }, []);

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

  // The OR namespace can come back refused (salt rotated while unpinned,
  // most commonly right after a vault recovery) before the OPK-registration
  // effect below ever runs. Surface that specific, actionable reason through
  // the same securingError banner the OPK effect uses, rather than letting
  // the customer land on Connections and see nothing until they trigger an
  // OR action that throws.
  useEffect(() => {
    if (!orNamespaceDisabledReason) return;
    // Deliberately no else-branch clearing the banner here. The reason is
    // nulled from several places (VaultContext on unlock, subaccount change,
    // and sign-out among them), and the OPK registration effect below also
    // clears securingError itself, but only on runs where its own guard
    // (subaccountId && isUnlocked) passes; it returns early otherwise and
    // leaves securingError untouched. So the banner is not guaranteed to
    // clear on every path that nulls the reason. If that leaves it stuck
    // after the customer has fixed the problem, update this comment and the
    // effects together.
    setSecuringError(humanizeOrDisabledReason(orNamespaceDisabledReason));
  }, [orNamespaceDisabledReason]);

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
      // Read before decoding, so a decrypt problem further down cannot leave
      // the page silently pretending the arm is healthy.
      setStealthUnavailable(readStealthUnavailable(res));
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
                currency: "",
                label: null,
              });
            }
          }

          // DL-1116. A stealth connection always arrives with source_wallets
          // [], which made every wallet-keyed feature in this page
          // structurally unreachable for it: no mapping row, so no linked
          // account, so nowhere for a scanned transaction to land, so no
          // stealth wallet in the Transactions filter. Synthesize the one
          // wallet the connection already is, here rather than at each of the
          // four use sites, so the rest of the page needs no stealth branch.
          return {
            ...c,
            decrypted_label,
            decrypted_last_error,
            decrypted_wallets: withStealthSourceWallet(
              { id: c.id, is_stealth: c.is_stealth, decrypted_label },
              decrypted_wallets,
            ),
          };
        }),
      );
      setConnections(decoded);
      // Returned so a caller that just created something can check whether it
      // is actually in the list, rather than assuming the refresh it awaited
      // means the row arrived. Every existing caller ignores this.
      return decoded;
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
      // The whole list call failed, which the toast already covers. Clear the
      // partial-degradation notice rather than stacking two different
      // explanations of the same blank page on top of each other.
      setStealthUnavailable(false);
      toastError(err, "We couldn't load your connections.");
    } finally {
      if (!recovering) setLoading(false);
    }
  }, [subaccountId, isUnlocked, decryptOrCipher, userId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // ─── Add-connection: open the searchable source list ─────────────────

  /**
   * Open the connect provider's searchable source list.
   *
   * This button exists to let someone find THEIR source among the hundred or
   * so we support (exchanges, Lightning services, Bitcoin wallets, xpub).
   * Only the provider's hosted list has that catalogue and its search box, so
   * we open it and let the user pick, exactly as this button did before.
   *
   * Omitting `provider` is what makes the list appear. Naming one skips the
   * list and jumps straight into a single source, which is what this button
   * was briefly changed to do: that removed the catalogue, so anyone whose
   * source was not the one hard-coded had no route in at all.
   *
   * Picking xpub or Sparrow from the list opens Stealth Sync on the
   * provider's side. We do not drive that handshake from here; our part ends
   * when the list posts the completed connection back to us.
   *
   * The two vault keys travel in the URL fragment. They lock the stored
   * credential and the per-wallet metadata, so the connect provider holds
   * ciphertext and we hold the only keys that open it. Read immediately
   * before the call so a vault that locked while this page sat open fails
   * here rather than part-way through.
   *
   * What the fragment buys us, and what it does not, because the half
   * answer that used to be here reassured readers about a question it never
   * asked. A fragment is not sent to a server, so these keys stay out of the
   * connect provider's request logs: that threat is answered. It is NOT
   * client-side privacy. The fragment is part of the URL of a real
   * navigation (widget.ts opens the popup with window.open), so it lands in
   * that browsing context's history entry, is visible in its address bar,
   * and is readable by anything that can see the tab's URL. Do not read
   * "never sent to a server" as "nobody else can see it".
   */
  async function handleAddConnection() {
    if (!user) {
      toast.error("Please sign in first.");
      return;
    }
    // The add door of the kill switch. Same flag the sync gate below reads, so
    // one answer turns the whole feature on or off rather than half of it.
    //
    // This is above exportOrCredsKey on purpose. The catalogue we open is the
    // provider's, not ours, and its private-wallet entries seal an envelope
    // with whatever key we hand over, so refusing after the export would still
    // put the key in a popup. planCatalogueAdd names no slug here because this
    // button names none: it opens the whole list, which can reach a gated
    // entry, and that is why an unnamed add is refused while the flag is off.
    //
    // The flag is READ HERE, at the press, not taken from the copy cached when
    // the page loaded (OWM-T0504). A tab opened before operations turned the
    // switch off used to keep the old answer for as long as it stayed open, so
    // the door this gate protects stood open for exactly the customer already
    // in the app. One round trip, and it fails closed: a read that errors
    // leaves the gate false and this press is refused.
    //
    // refreshRuntimeFlagsForDoor, not the plain refresh (OWM-T0587). The plain
    // one shares a read that is already running, so a press landing part way
    // through the background tick used to be answered by a query issued before
    // the press, and a flag turned off in between was invisible to this gate.
    // The door version guarantees the answer comes from a read that started
    // after this line was reached.
    await refreshRuntimeFlagsForDoor();
    const addGate = planCatalogueAdd({ stealthSyncEnabled: isStealthSyncEnabled() });
    if (!addGate.allowed) {
      toast.error(addGate.message);
      return;
    }
    setOpening(true);
    // Snapshot BEFORE the widget opens. This is the whole trick: OR answers a
    // repeated xpub with the id of the connection the user already has, so the
    // only way to tell "new" from "you already had this" is to know what was on
    // screen a moment ago. Captured here rather than after the await, because
    // by then the refresh has already folded the two cases together.
    const knownConnectionIdsBefore = connections.map((c) => c.id);
    try {
      const credKeyB64 = await exportOrCredsKey();
      const txnKeyB64 = await exportOrTxnsKey();
      const result = await openOrConnect({
        orgId: user.id,
        credKeyB64,
        txnKeyB64,
      });
      // The widget posting a connection_id is evidence the connection was
      // created. It is NOT evidence that it is in this list, and those came
      // apart in practice: the toast fired while the refresh was still in
      // flight, so a connection that never arrived looked exactly like one
      // that had. Refresh first, then say only what the refreshed list shows.
      const rows = await refreshList();
      if (!rows) {
        // The list itself did not load, so we know the connection was created
        // and nothing about whether it is listed. Say both halves.
        toast.success("Connection added. We couldn't refresh the list just now.");
      } else {
        const report = describeLinkResult({
          result,
          knownConnectionIdsBefore,
          connectionIdsAfter: rows.map((c) => c.id),
        });
        if (report.outcome === "unknown") {
          // Created upstream, absent from the list. This is a real defect
          // rather than a slow refresh, and it used to be invisible.
          console.error("[Connections] added connection missing from list", {
            connection_id: result.connection_id,
            returned: rows.length,
          });
        }
        const say =
          report.toast.level === "success"
            ? toast.success
            : report.toast.level === "warning"
              ? toast.warning
              : toast.info;
        say(report.toast.message);
        setHighlightedConnId(report.highlightConnectionId);
      }

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

  /**
   * Scan a stealth connection by re-opening the OR widget on its sync route.
   *
   * The widget is the scanner. It fetches the sealed envelope by id, runs the
   * filter scan in this browser, and posts sealed transactions back to OR.
   * Nothing on our side scans, so this opens the widget and reports what the
   * widget says.
   *
   * This comment used to state that the widget reads `last_block_scanned` back
   * and resumes from it. We cannot observe that, so we no longer claim it.
   * What upstream confirmed is narrower: the cursor is written once at
   * completion, not per batch, and the write is guarded on having sealed at
   * least one transaction. So a scan that finds nothing does not advance it
   * either. Do not reintroduce resume language here without a recording that
   * shows a scan starting from a non-zero height.
   *
   * Every outcome below is reported from something the widget actually sent.
   * There is no success toast on the launch path: launching is not scanning,
   * and saying otherwise is the bug this ticket exists to fix.
   */
  async function handleStealthSync(conn: ConnectionRow) {
    if (!user) {
      toast.error("Please sign in first.");
      return;
    }
    // The sync door of the kill switch, READ AT THE PRESS rather than taken
    // from the copy cached when the page loaded (OWM-T0504). A tab opened
    // while the switch was on used to keep that answer for as long as it
    // stayed open, so the one customer the switch failed to reach was the
    // customer already in the app.
    //
    // It is here rather than only on the routed entry in handleSync because
    // this function has a second caller: the "Try again" action on the failure
    // toast calls it directly. One placement covers both, and it is above the
    // credentials key export below, which is the thing that must not happen
    // while the switch is off.
    //
    // Only one direction is forced, and that is deliberate. This read exists
    // to CLOSE the door: an off flag refuses here, one round trip after the
    // press. A flag turned back ON while a tab is open is left to the
    // background refresh in runtimeFlags, because a customer waiting for a
    // feature to come back is a delay, while a customer handing a key to the
    // provider origin after the switch was thrown is an incident.
    //
    // Fails closed. The read never throws and leaves the gate false on any read
    // that errors, so a flag we cannot read refuses the scan.
    //
    // refreshRuntimeFlagsForDoor, not the plain refresh (OWM-T0587). Joining a
    // query that was already in flight when the customer pressed meant the
    // answer could predate the press: the tick reads true, operations turn the
    // switch off, the press joins the pre-flip query and the credentials key
    // below crosses to the provider origin. The door version issues its own
    // read, and doors pressed together still share one of them.
    await refreshRuntimeFlagsForDoor();
    if (!isStealthSyncEnabled()) {
      toast.error(
        "Scanning a private wallet is temporarily unavailable. Your existing connections and transactions are not affected.",
      );
      return;
    }
    setSyncingId(conn.id);
    // Clear any line left over from the previous scan before this one starts.
    // Showing the last run's "97%" while a fresh scan is at zero is a lie the
    // user has no way to detect.
    setStealthProgress(null);
    setStealthScanId(conn.id);
    // DL-1447: durable run record. The insert STARTS here, before the key
    // export and the token mint, because either of those can throw: a vault
    // that locked while this page sat open, or a token mint that fails. While
    // it was written after them, such an execution wrote no row at all, so
    // this table under-reported failures in exactly the cases most likely to
    // be a real customer problem. The user saw a failed sync and an error
    // toast, and the table that exists so a sync is verifiable from our own
    // database showed nothing.
    //
    // It is deliberately NOT awaited here. Awaiting it would put one more
    // network round trip between the user's click and the popup opening, and
    // the popup is the thing a browser blocks as that gap grows. So the insert
    // runs alongside the key export, and is awaited at the launch point below,
    // or in the catch on the paths that never reach it.
    //
    // startStealthSyncRun never rejects: it catches its own errors and returns
    // null. So this promise cannot become an unhandled rejection while it sits
    // unawaited. runId stays null when the insert itself failed, and
    // finishStealthSyncRun no-ops on null rather than retrying the insert, so
    // a logging failure never blocks the sync and we never lose the fact that
    // the original write failed.
    let runId: string | null = null;
    const runIdPromise = startStealthSyncRun(user.id, conn.id);
    try {
      // Read the key immediately before use, like handleAddConnection does, so
      // a vault that locked while this page sat open fails here rather than
      // part-way through a scan.
      const credKeyB64 = await exportOrCredsKey();
      const widgetToken = await mintWidgetToken(user.id);
      runId = await runIdPromise;

      const { channel } = await startStealthSync({
        connectionId: conn.id,
        appUserId: user.id,
        credKeyB64,
        widgetToken,
        /**
         * DL-1111. The widget posts roughly one of these per second for the
         * whole scan, and until now nobody passed this callback, so all of it
         * was thrown away and the row said "Syncing" and nothing else for the
         * several minutes a first scan takes. Mirror the widget's own words
         * into the row the user is actually looking at.
         *
         * Deliberately not throttled. Each frame is a cheap state write on a
         * page that is otherwise idle while the scan runs, and a throttle
         * would make the last frame before completion arrive after the row is
         * already gone.
         */
        onProgress: (progress) => setStealthProgress(progress),
        onComplete: (outcome) => {
          channelRef.current?.stop();
          channelRef.current = null;
          setSyncingId(null);
          setStealthProgress(null);
          setStealthScanId(null);
          void finishStealthSyncRun(runId, {
            status: "success",
            rowsAttempted: outcome.txCount,
            rowsWritten: outcome.txCount,
          });
          // DL-1171. Record what this frame told us about the scan position
          // BEFORE anything else, because the next failure toast reads it and
          // an early return further down would leave it stale. Note what is
          // stored: that the widget reported a height, not that the height was
          // saved. Those are different claims and only the first is ours.
          cursorKnowledgeRef.current.set(conn.id, {
            completedScanReportedHeight: outcome.lastBlockScanned !== undefined,
            cursorUpdateFailed: outcome.cursorUpdateFailed === true,
          });
          const found = outcome.txCount;
          // Report the count when the widget gave one. When it did not, say
          // that the scan finished and nothing more: inventing "up to date"
          // from a missing number is how we got here.
          toast.success(
            found === undefined
              ? "Scan finished."
              : found === 0
                ? "Scan finished. No new transactions."
                : `Scan finished. ${found} new ${found === 1 ? "transaction" : "transactions"}.`,
          );
          // Two honesty warnings the widget reports and this app would
          // otherwise swallow when the popup closes. Neither makes the scan a
          // failure, and neither may be hidden behind the success toast.
          if (outcome.addressWindowExhausted) {
            toast.warning(
              "History may be incomplete. Matches reached the edge of the address window; reconnect this wallet with a wider window to recover older transactions.",
            );
          }
          if (outcome.cursorUpdateFailed) {
            toast.warning(
              "This scan finished but its position could not be saved, so the next sync may cover ground this one already scanned.",
            );
          }
          // DL-1116. This callback used to end at refreshList(), which is why
          // a scan could report "Sealed and stored 14 transactions" and the
          // user still saw none of them: the row was marked "Synced just now"
          // and nothing ever read the transactions back into the local
          // ledger. Both or-sync paths already call the import bridge here;
          // this one never did.
          void importAfterStealthScan(conn);
        },
        /**
         * DL-1117. The widget sends `{code, message, retryable}` and this app
         * used to read only the message, so a network blip and a wallet the
         * widget can never scan produced the same dead-end toast. It now asks
         * the widget whether trying again could help, and offers the retry
         * only when the widget said yes.
         *
         * DL-1171. What used to be written here: "the retry is safe, a scan is
         * resumable by design, the widget reads its own cursor back and picks
         * up from last_block_scanned". Every clause of that was an assumption.
         * The cursor is upstream, this app cannot observe whether it was
         * written, and a first scan covers a range of roughly a hundred
         * thousand requests, so a press that quietly starts over is minutes of
         * someone's evening, not a detail.
         *
         * What is still true and is the part worth keeping: the retry is
         * always user-initiated, it re-enters this same function, and
         * `handleStealthSync` clears the stale progress line before starting.
         * Nothing here retries on its own, and nothing should be made to.
         *
         * So the button stays and the promise goes. `describeStealthFailure`
         * adds a second sentence when we have an observed reason to think the
         * press is expensive, and stays quiet when we do not.
         */
        onError: (failure) => {
          channelRef.current?.stop();
          channelRef.current = null;
          setSyncingId(null);
          setStealthProgress(null);
          setStealthScanId(null);
          void finishStealthSyncRun(runId, {
            status: "error",
            errorCode: failure.code,
          });
          // The code is for us, not for the user: it is the difference between
          // a support conversation that starts with a cause and one that
          // starts with "it said something went wrong".
          if (failure.code) {
            console.warn(`[Connections] stealth sync failed: ${failure.code}`);
          }
          const line = describeStealthFailure(failure, cursorKnowledgeRef.current.get(conn.id));
          toast.error(
            line.message,
            line.canRetry
              ? {
                  // The caveat rides on the same toast as the button it is
                  // about. A warning in a separate toast can be dismissed
                  // first, which would leave the button and lose the sentence.
                  description: line.retryNote,
                  action: { label: "Try again", onClick: () => void handleStealthSync(conn) },
                }
              : undefined,
          );
        },
      });
      channelRef.current = channel;
    } catch (err) {
      // Popup blocked, widget never ready, closed before load, or the token
      // mint failed. All of these mean no scan was started, so say so.
      setSyncingId(null);
      setStealthProgress(null);
      setStealthScanId(null);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Connections] stealth sync could not start", err);
      toast.error(humanizeError(new Error(msg)));
      // The started row may still be in flight: this catch is reachable from
      // the key export and the token mint, both of which run before runId is
      // assigned. Resolve the insert before finishing it, or this execution
      // records nothing at all and a real failure stays invisible in the
      // table. Awaiting here costs nothing the user can feel: the sync has
      // already failed and the toast is already up.
      const startedRunId = runId ?? (await runIdPromise);
      void finishStealthSyncRun(startedRunId, { status: "error", errorCode: "launch_failed" });
    }
  }

  /**
   * DL-1086. Every one of these handlers used to `return` here with no word to
   * anyone: press Sync, press Sync all, confirm Disconnect, and the button
   * just does nothing. `subaccountId` comes from or-provision on mount, so a
   * missing one means provisioning has not finished or did not succeed, which
   * is recoverable and worth saying. A user-initiated action that declines to
   * act has to say so, or it reads as a dead button.
   */
  function requireSubaccount(): string | null {
    if (subaccountId) return subaccountId;
    toast.error("Your connection area is still being set up. Give it a moment, then reload.");
    return null;
  }

  async function handleSync(conn: ConnectionRow) {
    const subaccount = requireSubaccount();
    if (!subaccount) return;

    // WHERE this press goes is decided by planSyncRoute, from the connection
    // alone. It used to be decided inline here, and the private branch ANDed
    // in the kill switch, so switching the private wallet feature OFF did not
    // refuse a private connection: it fell through to the or-sync branch below
    // and exported two vault keys for a request or-sync answers with a 400
    // (OWM-T0530, OWM-T0528, OWM-T0533).
    const route = planSyncRoute(conn);

    // Bank (Quiltt) connections use the OPK sealed-box path, not the
    // Bitcoin-source or-sync path. Route them to the BankSyncDialog which
    // fetches OPK-sealed rows via or-transactions-list, unseals with the
    // vault OPK key, and imports. The or-sync path below is for
    // Bitcoin sources (Blink/Strike/etc.) only.
    if (route === "bank") {
      setBankSyncConnId(conn.id);
      return;
    }

    // Stealth connections are scanned by the OR widget in this browser, never
    // by or-sync: they live in the stealth store, and or-sync selects from the
    // `connections` table, which does not contain this row. Routing them below
    // would ask a function that cannot see this row whether this row is up to
    // date. Same shape as the bank branch above: a provider whose sync lives
    // somewhere else gets sent there.
    //
    // Do NOT read the branch below as a safe fallthrough. This comment used to
    // say or-sync "matches nothing and honestly returns { synced: 0 }". That
    // was never measured and it is wrong. Observed on production 2026-08-18,
    // signed in, with the network recorded: one request, or-sync via the
    // proxy, answered 400 "stealth connections cannot be synced via this
    // endpoint". It is a rejection, not an empty success, and it is raised
    // before or-sync ever selects anything.
    //
    // DL-1047 / DL-1378 / OWM-T0530: the kill switch is deliberately NOT
    // consulted in this condition. It is read at the press inside
    // handleStealthSync, which awaits refreshRuntimeFlags and refuses ABOVE
    // the credentials key export. An off switch has to refuse a private
    // connection; it must never redirect one onto the branch below, which is
    // the only branch in this handler that exports vault keys.
    //
    // Routing on is_stealth alone also matches planSyncAll, which has always
    // held private connections back from or-sync unconditionally. This path
    // was the one that disagreed.
    if (route === "private") {
      await handleStealthSync(conn);
      return;
    }

    setSyncingId(conn.id);
    try {
      // OWM-T0544. No key is exported here any more. requestOrSync asks
      // planSyncRoute itself and refuses above its own export, so deleting the
      // private arm above now stops a press rather than starting a key
      // handover: it reaches this call and is refused, instead of exporting two
      // vault keys for a request or-sync answers with a 400.
      const res = await requestOrSync(subaccount, [conn], orSyncKeys);

      // DL-1051: a status toast must be driven by positive evidence that this
      // connection was actually processed. or-sync only returns an entry for a
      // connection it attempted; if the id we requested is absent, the
      // connection was never touched (for example a stealth connection with no
      // resumable scan). Absence is the whole signal: do not infer stealth on
      // the client, and do not claim "up to date" for work that never ran.
      const attempted = res.connections.find((c) => c.connection_id === conn.id);
      if (!attempted) {
        toast.info("Nothing was synced for this connection yet.");
        await refreshList();
        setTxRefreshKey((k) => k + 1);
        return;
      }

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

      // OWM-T0717. NOT gated on res.synced. or-sync reports only what it
      // itself just fetched, so a connection whose rows were fetched on an
      // EARLIER press reports 0 forever and never gets imported. That is not
      // hypothetical: one tester's 146 transactions were fetched five minutes
      // before her account and wallet mapping existed, so the first press had
      // nowhere to file them, and every press since has honestly answered 0.
      //
      // This is the same defect DL-1116 already fixed on the stealth path, one
      // path over, and for the same reason: a sync that finds nothing new
      // still has to reconcile what is already stored.
      //
      // Safe to run unconditionally. We only reach here when `attempted` is
      // set, so the connection really was processed, and the import helper is
      // not delta based: it reads what is held for the connection and dedupes,
      // returning immediately when there is nothing to import.
      if (user) {
        try {
          const importResult = await importSyncedTransactionsForConnection(conn);
          if (importResult.unmapped > 0 && importResult.unmappedWalletIds.length > 0) {
            handleEditMapping(conn);
          }
        } catch (importErr) {
          console.error("[Connections] OR import bridge failed", importErr);
          try {
            captureException(importErr, {
              tags: { area: "or-import-bridge" },
              extra: { connectionId: conn.id },
            });
          } catch {
            // Sentry not initialised (VITE_SENTRY_DSN unset) — swallow.
          }
          toast.error(`Couldn't add transactions to your ledger. ${humanizeError(importErr)}`);
        }
      }

      await refreshList();
      setTxRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("[Connections] sync failed", err);
      try {
        captureException(err, {
          tags: { area: "connections-sync" },
          extra: { connectionId: conn.id },
        });
      } catch {
        // Sentry not initialised (VITE_SENTRY_DSN unset) — swallow.
      }
      toast.error(`Sync failed. ${humanizeError(err)}`);
    } finally {
      setSyncingId(null);
    }
  }

  async function handleSyncAll() {
    const subaccount = requireSubaccount();
    if (!subaccount) return;
    // DL-1086. The button only renders above one connection, so an empty list
    // means the list emptied between the render and the click, most likely a
    // delete landing. Rare, but "nothing happened" is the worst possible
    // answer to a press, so say which of the two it was.
    if (connections.length === 0) {
      toast.info("There is nothing to sync.");
      return;
    }

    // DL-1058. Two things were wrong here and they compounded.
    //
    // Every id went to or-sync, private ones included. or-sync selects from
    // the `connections` table and a private connection is not in it, so the id
    // matched nothing and came back as no entry at all. The reporting then
    // looked only at the total and at entries carrying an error, and an absent
    // entry is neither, so it fell through to "no new transactions across any
    // wallet". A user whose only connection was private pressed Sync all and
    // was told they were up to date while nothing had run.
    //
    // planSyncAll holds the private ones back, reportSyncAll measures what came
    // back against what was asked for, and both are tested.
    const plan = planSyncAll(connections);

    setSyncingAll(true);
    try {
      let synced = 0;
      let returned: SyncAllResultEntry[] = [];

      // Skipping the round trip when nothing is syncable now lives inside
      // requestOrSync, which answers an empty list with a zero and exports
      // nothing, so that skip holds even if this call site is edited.
      //
      // Rows are passed rather than ids so requestOrSync can check each one
      // itself. planSyncAll already holds private connections back and is
      // tested; this is the net under it, at the point the keys leave rather
      // than in the caller above it (OWM-T0544).
      const syncable = connections.filter((c) => plan.syncableIds.includes(c.id));
      const res = await requestOrSync(subaccount, syncable, orSyncKeys);
      synced = res.synced;
      returned = res.connections;

      const errs = returned.filter((c) => c.error);
      const report = reportSyncAll({
        requestedIds: plan.syncableIds,
        returned,
        synced,
        skippedPrivateCount: plan.skippedPrivateIds.length,
        stealthSyncEnabled: isStealthSyncEnabled(),
        firstErrorMessage:
          errs.length > 0
            ? humanizeError(errs[0]?.error ?? "", "Something went wrong.")
            : undefined,
      });
      for (const t of report.toasts) toast[t.level](t.message);

      if (errs.length > 0) {
        console.warn(
          "[Connections] sync-all partial failures",
          errs.map((e) => ({ connection_id: e.connection_id, error: e.error })),
        );
      }
      if (report.missingIds.length > 0) {
        // Requested and never answered for. Logged separately from errors
        // because it is a different failure: not "it went wrong" but "it never
        // ran", and the two need different fixes.
        console.warn("[Connections] sync-all: requested but never attempted", report.missingIds);
      }

      if (user) {
        // OWM-T0717, same reasoning as the single-connection path above: a
        // connection that synced cleanly with 0 new rows may still be holding
        // rows that were never imported, so `synced > 0` is not the condition.
        // Error-free is.
        const succeeded = returned.filter((c) => !c.error);
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
            try {
              captureException(importErr, {
                tags: { area: "or-import-bridge" },
                extra: { connectionId: succ.connection_id },
              });
            } catch {
              // Sentry not initialised (VITE_SENTRY_DSN unset) — swallow.
            }
          }
        }
      }

      await refreshList();
      setTxRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("[Connections] sync all failed", err);
      try {
        captureException(err, { tags: { area: "connections-sync-all" } });
      } catch {
        // Sentry not initialised (VITE_SENTRY_DSN unset) — swallow.
      }
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

      if (result.errored > 0) {
        try {
          captureMessage(
            `bank sync: ${result.errored} of ${result.total} transaction(s) failed to import`,
            {
              level: "warning",
              tags: { area: "bank-sync-import" },
              extra: { connectionId: orConnectionId, errored: result.errored, total: result.total },
            },
          );
        } catch {
          // Sentry not initialised (VITE_SENTRY_DSN unset) — swallow.
        }
      }

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

  /**
   * Page through `or-stealth-transactions-list` for one stealth connection.
   *
   * Pagination is followed rather than ignored because the default page is
   * 100 rows: a customer with a longer history would otherwise get a list
   * that looks complete and is not, which is the bug in #305 at a smaller
   * size and just as silent.
   *
   * The cursor is echoed back exactly as received and never rebuilt from the
   * last row. Both halves must travel together -- `block_height` is not
   * unique, so a height-only cursor drops the remainder of a block whenever a
   * page boundary lands inside one.
   *
   * A page that cannot be read stops the walk and returns what was collected
   * so far. Returning a partial import beats throwing away a good first page,
   * and `hasMore` is only trusted when a usable cursor came with it, so a
   * server that claims more and supplies no cursor terminates instead of
   * looping on page one.
   */
  async function fetchStealthRows(connectionId: string): Promise<StealthSealedRow[]> {
    const MAX_PAGES = 25;
    const out: StealthSealedRow[] = [];
    let cursor: StealthPageCursor | null = null;
    let skipped = 0;

    for (let i = 0; i < MAX_PAGES; i += 1) {
      let res: unknown;
      try {
        res = await callProxy("or-stealth-transactions-list", {
          connection_id: connectionId,
          ...(cursor ?? {}),
        });
      } catch (err) {
        console.warn("[Connections] stealth transaction read failed", err);
        break;
      }
      const page = stealthPageFromResponse(res, connectionId);
      out.push(...page.rows);
      skipped += page.skipped;
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }

    // A skipped row is a row the customer paid for and cannot see. It is not
    // an error the server can tell us about -- it means this build does not
    // understand an envelope version the widget wrote -- so the only place it
    // can surface is here. Counted, never silent.
    if (skipped > 0) {
      console.warn(
        `[Connections] ${skipped} stealth transaction(s) skipped: unreadable or an unsupported sealed_record version`,
      );
    }
    return out;
  }

  /**
   * Page through `or-transactions-list` for the whole subaccount (OWM-T0722).
   *
   * One call with `limit: 500` treated whatever came back as everything the
   * store held: no error, no counter, and a customer whose history ran past
   * 500 rows got a ledger that looked complete and silently was not.
   *
   * `nextTransactionsPage` is the one place that knows how to tell "may be
   * more" from "store exhausted" on this endpoint (see that module for why
   * its own `truncated` flag does not settle it alone). This loop just
   * drives it, same idiom as `fetchStealthRows` above: walk pages, stop on
   * `!hasMore`, cap at `MAX_PAGES` so a pathological response cannot spin
   * forever.
   */
  async function fetchAllTransactionRows(forSubaccountId: string): Promise<TransactionRow[]> {
    const PAGE_LIMIT = 500;
    const MAX_PAGES = 25;
    const out: TransactionRow[] = [];
    let before: string | undefined;

    for (let i = 0; i < MAX_PAGES; i += 1) {
      let res: unknown;
      try {
        res = await callProxy("or-transactions-list", {
          subaccount_id: forSubaccountId,
          limit: PAGE_LIMIT,
          ...(before ? { before } : {}),
        });
      } catch (err) {
        console.warn("[Connections] transaction list read failed", err);
        break;
      }
      const page = nextTransactionsPage(res, PAGE_LIMIT);
      out.push(...page.rows);
      if (!page.hasMore || !page.nextBefore) break;
      before = page.nextBefore;
    }
    return out;
  }

  async function importSyncedTransactionsForConnection(
    conn: ConnectionRow,
  ): Promise<{ unmapped: number; unmappedWalletIds: string[] }> {
    if (!user || !subaccountId) return { unmapped: 0, unmappedWalletIds: [] };
    const allRows = await fetchAllTransactionRows(subaccountId);
    const listRes = { transactions: allRows };
    // Shape lives in one place. Orange Rails has not finalised how stealth
    // rows come back (their DL-1174) and has ruled they will NOT be extra
    // entries in `transactions`, so nothing here may assume that array is the
    // whole answer.
    const forThisConn = orRowsForConnection(listRes, conn.id);

    // Stealth rows are NOT in that response and never will be: they are
    // sealed under a different envelope in a different store, and Orange
    // Rails ruled they must not be copied into the non-stealth table. They
    // come from their own endpoint, which is why this app read zero of them
    // for as long as it only asked the one above (#305).
    const stealthRows = conn.is_stealth ? await fetchStealthRows(conn.id) : [];

    if (forThisConn.length === 0 && stealthRows.length === 0) {
      return { unmapped: 0, unmappedWalletIds: [] };
    }

    const decoded: OrImportTransaction[] = [];
    let decryptFailures = 0;
    for (const row of forThisConn) {
      try {
        const json = await decryptOrTxnCipher(row.encrypted_payload);
        const payload = JSON.parse(json) as OrImportTransaction;
        // A stealth connection has exactly one wallet, so an untagged row is
        // an absent field rather than an ambiguous one. Without this the
        // bridge counts every stealth row `untagged` and skips it.
        decoded.push(withStealthSourceWalletId(payload, conn.id, conn.is_stealth));
      } catch {
        decryptFailures += 1;
      }
    }

    // NOT the same key. This comment used to say "same key, same decrypt"
    // and that sentence cost a working feature.
    //
    // Stealth envelopes are sealed with the CREDENTIALS subkey
    // (orangerails-creds-v1), not the transactions subkey
    // (orangerails-txns-v1). The reason is that both paths into the widget
    // hand it `credKeyB64`, under two different field names, and the widget
    // seals with whatever it was handed:
    //
    //   ADD, by navigation. src/lib/or/widget.ts buildConnectUrl puts
    //   `credKeyB64` in the /connect URL fragment under the field name
    //   `cred_key`. Orange Rails reads `cred_key` out of that fragment and
    //   passes the same value into its own inline stealth init under the
    //   field name `or_stealth_key_b64`. Two names, one key. On this path
    //   `or_stealth_key_b64` is THEIR name for it, not ours, which is why
    //   tracing that string through our connect code finds nothing.
    //
    //   SYNC, by postMessage. src/lib/stealth/sync.ts buildStealthSyncInit
    //   really does put `credKeyB64` under `or_stealth_key_b64`, from here.
    //   That one is ours, and it is the defect OWM-T0414 covers: the field
    //   named for the stealth key is carrying the credentials key.
    //
    // Whether the credentials key should be the sealing key at all is
    // OWM-T0464. This describes what the code does today, not what it
    // should do. So every stealth envelope that exists was sealed under
    // creds, while this loop was opening them with txns. An envelope only
    // opens with the key it was sealed under, so every row failed, the
    // import received an empty list, and the run summary reported zero rows
    // with zero decrypt failures -- because the bridge counts its own
    // failures, not ours. On production that surfaced as the toast
    // "Wallet ledger: 14 undecryptable" and nothing else.
    //
    // The fix is here rather than in sync.ts on purpose. Changing which key
    // is handed to the widget would orphan every envelope already stored:
    // they would still be creds-sealed and nothing would ever open them
    // again. sync.ts says exactly this and it is right.
    //
    // Both keys are tried, creds first. Creds is what today's rows use; txns
    // is attempted second so that if any row anywhere was ever sealed the
    // other way it still opens, rather than being counted as corrupt. Both
    // keys belong to this user and are already in memory, so the second
    // attempt discloses nothing and costs one AES-GCM tag check on a path
    // that only runs when the first attempt already failed.
    for (const row of stealthRows) {
      const cipherB64 = sealedRecordToCipherB64(row.sealed_record);
      let json: string | null;
      try {
        json = await decryptOrCipher(cipherB64);
      } catch {
        try {
          json = await decryptOrTxnCipher(cipherB64);
        } catch {
          json = null;
        }
      }
      if (json === null) {
        decryptFailures += 1;
        continue;
      }
      try {
        const payload = JSON.parse(json) as OrImportTransaction;
        // The OR stealth widget does not seal a stable `id` into the
        // payload. Without one, tx.id is undefined at runtime despite the
        // OrImportTransaction type, so buildRow writes external_id = NULL.
        // The unique index on (user_id, external_source, external_id)
        // treats every NULL as distinct (NULLS DISTINCT is the Postgres
        // default on a non-partial index), so every sync inserts fresh
        // duplicates rather than deduplicating. txid_blind_index_hex is
        // derived deterministically from the Bitcoin txid (chain data) and
        // is stable across re-syncs, making it the correct dedup key here.
        // The sealed (bank) path uses the same pattern: row.external_id ?? row.id.
        const payloadWithId: OrImportTransaction = payload.id
          ? payload
          : { ...payload, id: row.txid_blind_index_hex };
        decoded.push(withStealthSourceWalletId(payloadWithId, conn.id, true));
      } catch {
        // Opened but not parseable: still a failure, and a different one.
        // Counted together because the customer-facing outcome is the same.
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

    if (decryptFailures > 0) {
      try {
        captureMessage(
          `OR import: ${decryptFailures} of ${forThisConn.length + stealthRows.length} row(s) failed to open`,
          {
            level: "warning",
            tags: { area: "or-import-decrypt" },
            extra: { connectionId: conn.id, decryptFailures },
          },
        );
      } catch {
        // Sentry not initialised (VITE_SENTRY_DSN unset) — swallow.
      }
    }
    if (result.errored > 0) {
      try {
        captureMessage(`OR import: ${result.errored} of ${result.total} row(s) errored`, {
          level: "warning",
          tags: { area: "or-import-bridge" },
          extra: { connectionId: conn.id, errored: result.errored },
        });
      } catch {
        // Sentry not initialised (VITE_SENTRY_DSN unset) — swallow.
      }
    }

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

    // What to say lives in describeImportOutcome, which is pure and tested.
    // The case it exists for (DL-1506): when a vault password is changed or a
    // vault is recovered, every key derived from the rotated salt changes and
    // no previously sealed row opens again, for anyone. That used to reach the
    // customer as "Wallet ledger: 14 undecryptable", which does not say what
    // happened, whether it is permanent, or whether their money is affected.
    const outcome = describeImportOutcome({
      attempted: forThisConn.length + stealthRows.length,
      opened: decoded.length,
      imported: result.imported,
      unmapped: result.unmapped,
      untagged: result.untagged,
      errored: result.errored,
      unreadable: decryptFailures,
      unitMismatch: result.unitMismatch,
    });
    if (outcome.silent) {
      return { unmapped: 0, unmappedWalletIds: [] };
    }
    if (result.unmapped > 0 && result.unmappedWalletIds.length > 0) {
      console.warn(
        `[OW Connections] ${result.unmapped} transaction(s) skipped because these source wallets have no destination mapping:`,
        result.unmappedWalletIds,
        "→ Click 'Edit mapping' on the connection card to map them.",
      );
    }
    // Worth a log line of its own: this is the one outcome the customer can do
    // nothing about, and the one we would want to find afterwards.
    if (outcome.allUnreadable) {
      console.warn(
        `[OW Connections] every sealed row for connection ${conn.id} failed to open (${decryptFailures} of ${forThisConn.length + stealthRows.length}). Consistent with a vault key rotation after these rows were sealed (DL-1506).`,
      );
    }
    if (outcome.level === "warning") {
      toast.warning(outcome.message);
    } else if (outcome.level === "info") {
      toast.info(outcome.message);
    } else {
      toast.success(outcome.message);
    }
    return { unmapped: result.unmapped, unmappedWalletIds: result.unmappedWalletIds };
  }

  /**
   * DL-1116. Read back and import what the widget just sealed.
   *
   * Deliberately NOT gated on the widget's transaction count, because rows
   * stored by an earlier scan may never have been imported here at all. That
   * is exactly the state this ticket was filed from: fourteen rows sealed and
   * stored, zero of them in the ledger. A scan that finds nothing new still
   * has to reconcile.
   *
   * This paragraph used to note that the or-sync path took the opposite
   * approach and guarded on `res.synced > 0`. It no longer does. That guard
   * had the identical defect this comment describes and cost a tester her
   * whole history (OWM-T0717), so both paths now reconcile unconditionally.
   *
   * Failure is reported rather than swallowed. A scan that succeeded and an
   * import that failed is a different situation from a failed scan, and the
   * user's next action is the same either way, so say what happened and name
   * the retry.
   */
  async function importAfterStealthScan(conn: ConnectionRow) {
    try {
      await refreshList();
      const importResult = await importSyncedTransactionsForConnection(conn);
      setTxRefreshKey((k) => k + 1);
      // Same call to action as the or-sync path: the transactions arrived but
      // have nowhere to go until the wallet is pointed at an account. For a
      // stealth connection this dialog was previously unreachable, because
      // there was no wallet to map.
      if (importResult.unmapped > 0 && importResult.unmappedWalletIds.length > 0) {
        handleEditMapping(conn);
      }
    } catch (err) {
      console.error("[Connections] stealth ledger import failed", err);
      try {
        captureException(err, {
          tags: { area: "stealth-ledger-import" },
          extra: { connectionId: conn.id },
        });
      } catch {
        // Sentry not initialised (VITE_SENTRY_DSN unset) — swallow.
      }
      toast.error(`Couldn't add the scanned transactions to your ledger. ${humanizeError(err)}`);
    }
  }

  function handleDelete(conn: ConnectionRow) {
    setPendingDelete(conn);
  }

  async function handleDeleteConfirmed(conn: ConnectionRow) {
    // Bind the value rather than re-reading `subaccountId`: the guard is a
    // call now, so the compiler cannot narrow the outer variable for us, and
    // a non-null assertion here would be a claim rather than a check.
    const subaccount = requireSubaccount();
    if (!subaccount) return;
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
      // Private connections live in their own store, scoped by app_user_id
      // rather than by subaccount_id, so or-connection-delete looks in a table
      // this row is not in and honestly answers 404 "Connection not found in
      // this subaccount" for every one of them. Same shape as the sync branch
      // above: a provider whose store lives somewhere else gets sent there.
      // The owner is forced to the signed-in user inside ow-or-proxy, never
      // sent from here.
      const plan = buildDeletePlan({
        isStealth: conn.is_stealth,
        connectionId: conn.id,
        subaccountId: subaccount,
      });
      await callProxy(plan.endpoint, plan.payload);
      // Confirmed deleted: record the id so a follow-up 404 (double-tap,
      // retry) is correctly treated as "already gone, not an error".
      deletedConnectionIdsRef.current.add(conn.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not.?found|404/i.test(msg)) {
        // 404 is safe to treat as success only for ids we confirmed deleted
        // earlier in this session. Any other 404 may mean the row still
        // exists server-side: restore it and show an error.
        if (!deletedConnectionIdsRef.current.has(conn.id)) {
          console.error("[Connections] delete 404 on unrecognised id", err);
          setConnections(snapshot);
          toast.error("Couldn't disconnect. Give it a moment and try again.");
          return;
        }
        // Known-deleted id: the 404 was expected here, fall through to cleanup and success toast.
      } else {
        console.error("[Connections] delete failed", err);
        setConnections(snapshot);
        toast.error("Couldn't disconnect. Give it a moment and try again.");
        return;
      }
    }

    // DL-1081: a 2xx from the delete endpoint is not proof the row is gone,
    // and the optimistic removal above would otherwise hide a delete that did
    // not take. Read the list back and confirm this connection is actually
    // absent before saying "disconnected". If it is still present, that is a
    // silent failure: refreshList has already restored the row, so say so
    // rather than claim success.
    const rows = await refreshList();
    const readback = classifyDeleteReadback(rows, conn.id);
    if (readback === "silent-failure") {
      console.error("[Connections] delete returned ok but the connection is still listed", {
        connection_id: conn.id,
      });
      toast.error(
        "Couldn't disconnect. It may still be connected. Give it a moment and try again.",
      );
      setTxRefreshKey((k) => k + 1);
      return;
    }

    // Clean up the local account mappings (best-effort).
    try {
      await removeAllForConnection(conn.id);
    } catch (mapErr) {
      console.warn("[Connections] removeAllForConnection failed", mapErr);
    }
    // Read-back confirmed the connection is gone. When the list could not be
    // refreshed, say only what we know, exactly as the add path does.
    toast.success(
      readback === "confirmed-gone"
        ? `${name} disconnected`
        : `${name} disconnected. We couldn't refresh the list just now.`,
    );
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
      const res = await callProxy("or-transactions-list", {
        subaccount_id: subaccountId,
        limit: 100,
      });
      return orRowsForConnection(res, connectionId);
    },
    [subaccountId],
  );

  // ─── Render ───────────────────────────────────────────────────────────

  // DL-1113. Null in the ordinary case, so this renders unconditionally below.
  const stealthNotice = describeStealthAvailability({
    stealthUnavailable,
    connectionCount: connections.length,
  });

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
                  !opkRegistered
                    ? "Securing the connection — please wait or retry above"
                    : undefined
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

      {/* DL-1113. The private-wallet arm of or-connection-list failed and the
          endpoint reported it in a 200 rather than an error, so those rows are
          missing from the list below. Muted and not destructive on purpose:
          nothing is lost, the wallets come back when the arm does, and red
          "something failed" styling would push people toward the one recovery
          they must not attempt (delete and re-add, which DL-1079 makes a
          one-way door). aria-live so a screen reader hears the list it just
          read out was incomplete. */}
      {stealthNotice && (
        <div
          aria-live="polite"
          className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-medium">{stealthNotice.headline}</p>
            <p className="text-xs text-muted-foreground">{stealthNotice.detail}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refreshList()} disabled={loading}>
            {stealthNotice.retryLabel}
          </Button>
        </div>
      )}

      {loading && connections.length === 0 ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : connections.length === 0 && !stealthNotice ? (
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
              highlighted={highlightedConnId === c.id}
              derivedInstitution={institutionByConn.get(c.id) ?? null}
              syncing={syncingId === c.id}
              syncProgress={syncingId === c.id ? stealthProgress : null}
              scanActive={stealthScanId === c.id}
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
  highlighted,
  derivedInstitution,
  syncing,
  syncProgress,
  scanActive,
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
  /** Ring and scroll to this card: the connect widget just pointed at it. */
  highlighted: boolean;
  /** Institution name derived from the first linked Personal account, used
   *  when conn.decrypted_label is empty (e.g. Quiltt bank connections). */
  derivedInstitution: string | null;
  syncing: boolean;
  /** Latest stealth-widget progress frame, or null when this card is not the
   *  one syncing or the widget has not spoken yet. Only private (stealth)
   *  connections ever get one; bank and or-sync paths leave this null. */
  syncProgress: StealthSyncProgress | null;
  /** True only while the in-browser stealth scan is running for this row.
   *  Gates the scan-progress line; see shouldShowScanProgress. */
  scanActive: boolean;
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

  // Synced wallets with no destination account. Shown as a persistent banner
  // so users who already synced and skipped the mapping step have a clear
  // call to action. Clears reactively as wallets are mapped (no reload).
  const unmappedWalletCount = Object.values(destinationsByWallet).filter(
    (s) => s.accountNames.length === 0,
  ).length;

  // Scroll the highlighted card into view. Without this the "you already have
  // this wallet" toast names a row that may be off screen, which is only
  // marginally better than the silence it replaces.
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!highlighted) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlighted]);

  return (
    <div
      ref={cardRef}
      className={`rounded-lg border transition-shadow ${
        highlighted ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      }`}
    >
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
            {/* DL-1111. Live scan progress, in the widget's own words.
                Gated on the scan path having actually started, not on the row
                being private and syncing: only the stealth path posts progress
                frames, so any other path here renders a "Scanning" line that
                never advances and never resolves. #313 is that bug, measured on
                production, where a private row synced by the generic path
                claimed a first scan for a request already rejected on the wire.
                aria-live so a screen reader hears the scan move rather than
                being told "Syncing" once and then left in silence. */}
            {shouldShowScanProgress({ scanActive, isStealth: conn.is_stealth }) && (
              <div className="mt-1.5" aria-live="polite">
                {(() => {
                  const line = describeStealthProgress(syncProgress);
                  return (
                    <>
                      <div className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">{line.headline}</span>
                        {line.percent !== undefined && (
                          <span className="shrink-0 tabular-nums">{Math.round(line.percent)}%</span>
                        )}
                      </div>
                      {line.detail && (
                        <div className="truncate text-xs text-muted-foreground/80">
                          {line.detail}
                        </div>
                      )}
                      {line.percent !== undefined && (
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${line.percent}%` }}
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
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

      {unmappedWalletCount > 0 && (
        <div className="flex items-center justify-between gap-3 border-t bg-amber-500/5 px-4 py-2.5 text-sm">
          <span className="text-amber-700 dark:text-amber-400">
            {unmappedWalletCount === 1
              ? "1 account needs a destination"
              : `${unmappedWalletCount} accounts need a destination`}
          </span>
          <button
            type="button"
            onClick={onEditMapping}
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            Set up mapping
          </button>
        </div>
      )}

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

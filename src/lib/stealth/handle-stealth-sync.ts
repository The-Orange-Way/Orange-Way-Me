/**
 * handleStealthSync, extracted verbatim from ConnectionsPage.tsx (OWM-T0520).
 *
 * Pure code motion: no logic change. Every free variable the function used to
 * close over (user, exportOrCredsKey, channelRef, cursorKnowledgeRef, the
 * three sync-state setters, and importAfterStealthScan) is now passed in
 * through `deps` instead, so this function is callable from a plain Node
 * script without a mounted React component. Below the `deps` destructure,
 * the body is byte-identical to the version that lived in ConnectionsPage.tsx.
 *
 * ConnectionsPage keeps a thin wrapper of the same name that forwards to this
 * function with its own hooks/state/refs as `deps`, so every existing call
 * site (handleSync's private-route branch, and this function's own "Try
 * again" retry) is unaffected.
 *
 * The structural wiring test that used to read this function's source text
 * out of ConnectionsPage.tsx (kill-switch gate above the key export, the
 * gate's if-block actually returning, the retry re-entering this same
 * handler) moved with it: see __tests__/handle-stealth-sync-wiring.test.ts
 * in this directory.
 */
import { toast } from "sonner";
import type { MutableRefObject } from "react";
import { mintWidgetToken } from "@/lib/or/widget";
import { startStealthSyncRun, finishStealthSyncRun } from "@/lib/stealthSyncRuns";
import {
  startStealthSync,
  describeStealthFailure,
  type StealthSyncProgress,
  type StealthCursorKnowledge,
} from "@/lib/stealth/sync";
import { isStealthSyncEnabled, refreshRuntimeFlagsForDoor } from "@/lib/stealth/runtimeFlags";
import type { StealthChannel } from "@/lib/stealth/channel";
import { humanizeError } from "@/lib/friendly-error";
import type { ConnectionRow } from "@/components/connections/ConnectionsPage";

export interface HandleStealthSyncDeps {
  user: { id: string } | null | undefined;
  exportOrCredsKey: () => Promise<string>;
  channelRef: MutableRefObject<StealthChannel | null>;
  cursorKnowledgeRef: MutableRefObject<Map<string, StealthCursorKnowledge>>;
  setSyncingId: (id: string | null) => void;
  setStealthProgress: (p: StealthSyncProgress | null) => void;
  setStealthScanId: (id: string | null) => void;
  importAfterStealthScan: (conn: ConnectionRow) => void | Promise<void>;
}

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
  export async function handleStealthSync(conn: ConnectionRow, deps: HandleStealthSyncDeps) {
    const {
      user,
      exportOrCredsKey,
      channelRef,
      cursorKnowledgeRef,
      setSyncingId,
      setStealthProgress,
      setStealthScanId,
      importAfterStealthScan,
    } = deps;
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
                  action: { label: "Try again", onClick: () => void handleStealthSync(conn, deps) },
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

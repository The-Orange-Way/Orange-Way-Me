import { supabase } from "@/integrations/supabase/client";

/**
 * Runtime override for the stealth-sync kill switch (DL-1378).
 *
 * STEALTH_SYNC_ENABLED is derived from VITE_STEALTH_SYNC_ENABLED at build
 * time, so changing it needs a rebuild + redeploy. This module reads the live
 * value from public.app_flags and lets it override the build-time constant,
 * giving operations a kill switch that needs no redeploy.
 *
 * FAILS CLOSED (DL-1466). This module used to fall back to the build-time
 * constant, which was `true` on prod, so the gate read true until the row
 * resolved and stayed true forever if the read failed. Measured on production:
 * a 507ms window on a cold load, unbounded on a query error. A kill switch that
 * resurrects a disabled feature when infrastructure hiccups is not a kill
 * switch, and the old comment calling that "conservative" had the polarity
 * backwards for a switch whose whole job is to turn something OFF.
 *
 * The rule has no exceptions and is not changed by the refresh below: the gate
 * is false unless a successful read returned a row that says otherwise.
 *   - Before the read resolves: false.
 *   - Query FAILS (table absent, network, throw): false.
 *   - Query SUCCEEDS with no row: false (matches the seed migration).
 *   - Query SUCCEEDS with a row: that row is authoritative, both ways.
 * A refresh that fails moves the gate to false. It never promotes a stale
 * `true`, so a network blip refuses a scan rather than granting one.
 *
 * Note this makes the build-time constant irrelevant to the gate. Turning
 * stealth on is now a database change and nothing else, on every environment.
 *
 * HOW STALE THE ANSWER CAN BE (OWM-T0504). The read used to happen exactly
 * once, at application start, and the answer was cached for the life of the
 * page. Turning the flag off therefore changed what a NEW page load saw and
 * nothing at all about a tab that was already open, so the switch's real
 * latency was "until every open tab reloads", which is unbounded. That is not a
 * kill switch. The answer is now bounded, and here are the numbers rather than
 * an adjective:
 *   - A VISIBLE tab re-reads every RUNTIME_FLAG_MAX_AGE_MS (30 seconds), so its
 *     cached answer is at most 30 seconds plus one round trip old.
 *   - A BACKGROUNDED tab may have its timer throttled by the browser, so it is
 *     also re-read on visibilitychange: coming back to the tab re-reads before
 *     anything on it can be pressed.
 *   - AT A GATED DOOR the answer is not cached at all, AND the read that
 *     answers it is required to have STARTED AFTER the press. Both doors call
 *     refreshRuntimeFlagsForDoor(), which never hands back a read that was
 *     already running when the door asked. That distinction is OWM-T0587: the
 *     plain refresh shares an in-flight read, so a press landing part way
 *     through a background tick used to be answered by a query issued before
 *     the press, and a flag flipped off in between was invisible to it. A door
 *     is the only moment where staleness could let a key cross to the provider
 *     origin, so a door pays for the strict read and nothing else does.
 *
 * Considered and rejected: a Supabase realtime subscription on the row. It
 * updates an open tab with no per-press cost, but it does not bound the answer
 * at the instant of the press, and it adds a socket and a reconnect story to a
 * module whose value is that a reviewer can hold all of it at once.
 */

/**
 * How long a cached answer may be reused before the background refresh reads
 * again. Also the interval of that refresh. Exported so the tests assert
 * against the same number the module uses, rather than a copy of it.
 */
export const RUNTIME_FLAG_MAX_AGE_MS = 30_000;

let stealthSyncEnabled = false;
/** Epoch ms of the last COMPLETED read, success or failure. 0 means never. */
let lastReadAtMs = 0;
/** A read in progress, so concurrent callers share one round trip. */
let inFlight: Promise<void> | null = null;
/**
 * A fresh read queued behind an already-running one on behalf of a gated door,
 * so several doors pressed inside one round trip share it (OWM-T0587).
 */
let queuedDoorRead: Promise<void> | null = null;
/** Identifies the queued read above, so a late one cannot clear a newer slot. */
let queuedDoorEpoch = 0;
/** Set while the background refresh is installed, so installing twice is a no-op. */
let stopAutoRefresh: (() => void) | null = null;

/**
 * The effective stealth-sync gate. Read at the call site instead of the
 * build-time constant so the runtime override applies.
 *
 * Synchronous on purpose: every existing call site reads it inline, and making
 * it async would have changed the shape of code that has nothing to do with
 * this. A caller that is about to OPEN A DOOR must await refreshRuntimeFlags()
 * first; a caller that is merely rendering may read the cached answer.
 */
export function isStealthSyncEnabled(): boolean {
  return stealthSyncEnabled;
}

/**
 * One read of the flag. Never throws, and always records that a read finished
 * so a failing read cannot make the module retry on every single call.
 */
async function readRuntimeFlags(): Promise<void> {
  try {
    // app_flags was added by the DL-1394 migration and the generated Supabase
    // types have not been regenerated to include it, so a typed .from() call
    // fails the build. Query it through an untyped handle until the types are
    // regenerated; the runtime row shape ({ enabled: boolean }) is stable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("app_flags")
      .select("enabled")
      .eq("key", "stealth_sync_enabled")
      .maybeSingle();
    if (error) {
      // Query failed (table absent, network). Fail closed, do not inherit a
      // build-time default that may be true, and do not keep a previous true.
      stealthSyncEnabled = false;
      return;
    }
    // Query succeeded. A present row is authoritative; an absent row folds to
    // false because the flag is undefined server-side.
    stealthSyncEnabled = data?.enabled === true;
  } catch {
    // Same reasoning as the error branch: an unreadable flag is an off flag.
    stealthSyncEnabled = false;
  } finally {
    lastReadAtMs = Date.now();
  }
}

/**
 * Read the flag NOW, ignoring the cached answer's age. Never throws.
 *
 * Concurrent callers share the one in-flight read rather than each opening
 * their own: two buttons pressed together, or a door press landing on top of
 * the background refresh, is one query and one answer.
 */
export function refreshRuntimeFlags(): Promise<void> {
  if (inFlight) return inFlight;
  const started = readRuntimeFlags().finally(() => {
    // Only clear the slot if it is still ours. A later refresh that already
    // replaced it must not be dropped by an earlier one finishing late.
    if (inFlight === started) inFlight = null;
  });
  inFlight = started;
  return started;
}

/**
 * Read the flag for a GATED DOOR: the answer is guaranteed to come from a query
 * that STARTED AFTER this call (OWM-T0587). Never throws.
 *
 * refreshRuntimeFlags() above shares an in-flight read, which is right for a
 * background tick and wrong for a door. The sequence that leaks: the 30 second
 * tick issues its query, operations flip the row to false 50ms later, the
 * customer presses Sync at 100ms and joins the pre-flip query. It resolves
 * true, the gate opens, and the credentials key crosses to the provider origin.
 * Only the ON to OFF direction leaks, because a read that started before an OFF
 * to ON flip resolves false, which refuses.
 *
 * So a door that finds a read already running does not join it, it chains a
 * fresh read behind it. Doors pressed while that same predecessor is running
 * share the one chained read, so N concurrent presses cost one extra query and
 * not N. A door that finds nothing running simply starts its own read, which
 * already satisfies "started after the press", and pays for exactly one query.
 *
 * Fails closed like every other path here: the chained read is an ordinary
 * refresh, so an error, a throw or a missing row all leave the gate false.
 */
export function refreshRuntimeFlagsForDoor(): Promise<void> {
  const pending = inFlight;
  if (!pending) return refreshRuntimeFlags();
  if (queuedDoorRead) return queuedDoorRead;

  const epoch = ++queuedDoorEpoch;
  const chained = pending
    // readRuntimeFlags catches its own errors, so this is belt and braces: a
    // predecessor that somehow rejects must not stop a door getting its read.
    .catch(() => undefined)
    .then(() => {
      // Released HERE rather than in a finally, because from this line onward
      // the chained read has STARTED and so can no longer answer a later press.
      // Leaving it in place until the read finished would hand the next door an
      // answer from a query that began before it asked, which is the whole bug.
      if (queuedDoorEpoch === epoch) queuedDoorRead = null;
      return refreshRuntimeFlags();
    });

  queuedDoorRead = chained;
  return chained;
}

/**
 * Read the runtime flag if the cached answer is older than
 * RUNTIME_FLAG_MAX_AGE_MS. Safe to call as often as you like. Never throws.
 *
 * This is the boot call and the background tick. It is NOT the right call in
 * front of a gated door, because it can return a cached answer: use
 * refreshRuntimeFlags() there.
 */
export async function loadRuntimeFlags(): Promise<void> {
  if (lastReadAtMs !== 0 && Date.now() - lastReadAtMs < RUNTIME_FLAG_MAX_AGE_MS) return;
  await refreshRuntimeFlags();
}

/**
 * Keep an already-open tab's cached answer bounded.
 *
 * Two triggers, because one is not enough. The interval covers a tab sitting in
 * front of the user; visibilitychange covers a tab that was in the background,
 * where browsers are free to throttle timers to once a minute or worse, so the
 * interval alone would leave exactly the long-lived tab this exists for holding
 * the oldest answer.
 *
 * Returns a stop function, and calling it twice installs one set of listeners:
 * the tests install and tear down repeatedly, and a leaked interval in a test
 * file is a flake nobody enjoys tracking down.
 */
export function startRuntimeFlagAutoRefresh(): () => void {
  if (stopAutoRefresh) return stopAutoRefresh;

  const timer = setInterval(() => {
    void refreshRuntimeFlags();
  }, RUNTIME_FLAG_MAX_AGE_MS);

  const onVisibilityChange = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    void refreshRuntimeFlags();
  };

  const hasDocument = typeof document !== "undefined";
  if (hasDocument) {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  stopAutoRefresh = () => {
    clearInterval(timer);
    if (hasDocument) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    stopAutoRefresh = null;
  };
  return stopAutoRefresh;
}

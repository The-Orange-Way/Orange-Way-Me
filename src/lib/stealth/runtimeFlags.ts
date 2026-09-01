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
 *   - AT A GATED DOOR the answer is not cached at all. Both doors await
 *     refreshRuntimeFlags() before they decide, so the answer that opens a door
 *     is one round trip old, whatever the tab was doing beforehand. That is the
 *     only moment where staleness could let a key cross to the provider origin,
 *     which is why it is the moment that gets the forced read.
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

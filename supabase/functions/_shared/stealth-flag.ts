/**
 * Server side read of the private wallet (stealth) kill switch.
 *
 * WHY THIS EXISTS. public.app_flags.stealth_sync_enabled was read only by the
 * browser, once at page load. A kill switch that only the client consults is a
 * convention, not a control: a caller that does not run our JavaScript is not
 * affected by it at all. This module is the server half, so the switch holds
 * against a caller we did not write.
 *
 * IT FAILS CLOSED, IN EVERY DIRECTION. The gate answers true only when a read
 * succeeded, AND returned a row, AND that row's enabled column is exactly the
 * boolean true. A query error, a thrown exception, a missing row, a null, and a
 * value that is merely truthy (the string "true", the number 1) all answer
 * false. There is no branch in here that can answer true without a successful
 * read, which is the property to preserve if you change this file.
 *
 * NO CACHE, DELIBERATELY. The point of a runtime switch is that flipping the
 * row takes effect now. The action this guards is a person pressing a button,
 * so one indexed primary key read per call is not a load question, and a cache
 * would trade a real property for nothing.
 *
 * The read itself is injected rather than done here: this module holds no
 * Supabase client and touches no environment, so every failure path above can
 * be tested directly instead of being reasoned about.
 */

/** The app_flags primary key this gate reads. */
export const STEALTH_SYNC_FLAG_KEY = "stealth_sync_enabled";

/**
 * Stable machine readable code returned when the switch is off. The client
 * matches on this rather than on prose, so the wording below can change
 * without breaking the caller's rendering.
 */
export const STEALTH_SYNC_DISABLED_ERROR = "stealth_sync_disabled";

/** Human facing text that goes with the code above. */
export const STEALTH_SYNC_DISABLED_MESSAGE =
  "Private wallet sync is temporarily unavailable. Please try again later.";

/**
 * Anything that resolves to a Supabase style { data, error } result. Typed as
 * unknown on purpose: the narrowing happens inside readStealthSyncEnabled, so
 * no caller has to shape its query result to satisfy this signature, and a
 * client whose types drift cannot turn a security gate into a type error.
 */
export type StealthFlagReader = () => Promise<unknown>;

/**
 * True only if the flag row was read successfully and says enabled is true.
 * Every other outcome, including one this function did not anticipate, is false.
 */
export async function readStealthSyncEnabled(read: StealthFlagReader): Promise<boolean> {
  try {
    const result = await read();
    if (result === null || typeof result !== "object") return false;

    const { data, error } = result as { data?: unknown; error?: unknown };
    // A Supabase error object is truthy when the query failed. Refuse rather
    // than guess: we cannot tell "switch is on" from "database is unreachable".
    if (error) return false;
    if (data === null || typeof data !== "object") return false;

    // Strict identity, not truthiness. A row that somehow carries "false" as a
    // string, or 0, or null, must not open the door.
    return (data as { enabled?: unknown }).enabled === true;
  } catch {
    // A throw here is a read that did not happen. Same answer as a read that
    // failed: closed.
    return false;
  }
}

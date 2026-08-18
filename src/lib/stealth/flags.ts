/**
 * Kill switch for the stealth (private-connection) sync entry (DL-1047).
 *
 * handleSync routes a stealth connection to the OR widget only when this is
 * true. While it is false, a stealth connection does NOT open the widget and
 * falls through to the honest or-sync no-op path, exactly as before this entry
 * existed.
 *
 * Environment derived, same shape and reasoning as VITE_OR_CONNECT_ENABLED in
 * ConnectionsPage.tsx. Both arms are now on, dev and prod, each stated
 * explicitly in .github/workflows/deploy.yml. An unset or empty value folds the
 * compare to a constant false, so a build that forgets the variable ships dark
 * rather than shipping the widget path by accident. Changing an arm is a
 * one-line change to that workflow, never a code change here.
 *
 * Why dev is on. The switch originally hardcoded false pending "the OR-side
 * sync mode confirmed live". That condition is now met, and it was checked
 * against the deployed artifact rather than the repo: dev.orangerails.com
 * serves assets/stealth-DHQQ6zju.js (application/javascript, 76903 bytes)
 * carrying the sync route, its or-stealth-envelope-fetch and
 * or-stealth-envelope-update calls, widget_token auth, and
 * OR_STEALTH_SYNC_COMPLETE. A fabricated sibling URL under the same prefix
 * returns text/html, so that is the widget and not the SPA fallback. All three
 * edge functions the route calls accept widget-token auth, which is the only
 * auth a host-app user has.
 *
 * Why prod is on. Two requirements gated the prod arm and both are satisfied,
 * each checkable from branch history rather than on the word of this comment:
 * the DL-1174 read path reached prod in an earlier promotion, ahead of the flag
 * line, so no prod build can carry this flag without also carrying the read
 * path; and PR 278, the retry-behaviour copy, merged 2026-08-16 and its merge
 * commit is an ancestor of prod.
 *
 * The older condition, that somebody watch a scan run end to end for a host-app
 * user, is recorded as met on 2026-08-16 in the deploy workflow comment. That
 * observation is not this seat's and its measurements live in the ticket, so do
 * not treat this file as its evidence.
 *
 * What this seat did verify on production, 2026-08-18, while the prod arm was
 * still dark: Sync on a private connection issued one request, or-sync,
 * answered 400 "stealth connections cannot be synced via this endpoint". The
 * dark arm was a dead button rather than a graceful no-op, and the row
 * meanwhile claimed a scan was running. That UI half is #313, fixed in #316,
 * and it is independent of this switch.
 *
 * Typed as boolean, not a literal, so the call-site guard reads as a real
 * runtime switch and is not folded away by control-flow narrowing.
 */
export const STEALTH_SYNC_ENABLED: boolean = import.meta.env.VITE_STEALTH_SYNC_ENABLED === "true";

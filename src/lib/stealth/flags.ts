/**
 * Kill switch for the stealth (private-connection) sync entry (DL-1047).
 *
 * handleSync routes a stealth connection to the OR widget only when this is
 * true. While it is false, a stealth connection does NOT open the widget and
 * falls through to the honest or-sync no-op path, exactly as before this entry
 * existed.
 *
 * Environment derived, same shape and reasoning as VITE_OR_CONNECT_ENABLED in
 * ConnectionsPage.tsx: dev on, prod off, both arms explicit in
 * .github/workflows/deploy.yml. An unset or empty value folds the compare to a
 * constant false, so a build that forgets the variable ships dark rather than
 * shipping the widget path by accident. The prod flip is a one-line change to
 * the prod arm of that workflow, not a code change here.
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
 * What is still unproven, and why prod stays dark: nobody has yet watched a
 * scan run end to end for a host-app user. Dev on is what makes that
 * observation possible. Prod on before it would be shipping on a guess.
 *
 * Typed as boolean, not a literal, so the call-site guard reads as a real
 * runtime switch and is not folded away by control-flow narrowing.
 */
export const STEALTH_SYNC_ENABLED: boolean = import.meta.env.VITE_STEALTH_SYNC_ENABLED === "true";

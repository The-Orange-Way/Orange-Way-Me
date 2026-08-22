/**
 * How old a sync reading is, said out loud.
 *
 * DL-1460: the accounts page showed a green "Synced" badge with no age on it,
 * for any sync inside a 24 hour window. A tester opened the app and read that
 * as "synced now" when the last sync had been the previous day. The age was
 * only ever in a tooltip, and tooltips do not open on a phone, which is where
 * she was.
 *
 * These live in their own module because AccountCard.tsx is a component file
 * and exporting helpers from it breaks React Fast Refresh.
 */

/**
 * Compact age for the badge face itself, e.g. "18h ago".
 *
 * The pill is roughly 10px type inside a card, so the long form does not fit.
 * It has to fit, though: "Synced" on its own is a present-tense claim about a
 * reading that can be up to 24 hours old, and a phone user cannot open the
 * tooltip that used to be the only place the age appeared.
 */
export function timeAgoCompact(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Returns the compact badge text for the active-sync pill, or null when
 * the pill should be hidden (no sync on record, or sync is older than 24h).
 *
 * The 24-hour threshold is strictly greater-than: a sync at exactly
 * 24h 00m 00s still shows "Synced 1d ago" rather than vanishing silently.
 * Test the boundary explicitly; an off-by-one here costs a user their badge.
 */
export function syncBadgeText(lastSyncAt: string | null, now: number): string | null {
  if (!lastSyncAt) return null;
  const ageMs = now - new Date(lastSyncAt).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) return null;
  return timeAgoCompact(lastSyncAt, now);
}

export function timeAgoShort(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

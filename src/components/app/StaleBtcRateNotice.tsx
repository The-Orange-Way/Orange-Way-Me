// Shown across the signed-in app when the Bitcoin price used for conversions is
// older than the stale limit, or when no live price could be loaded at all. In
// both cases conversions to and from Bitcoin rest on an older number, so the
// customer is told instead of being shown figures that look current.
// Client-only: it reads an already-fetched snapshot. It never touches amounts,
// keys or the network.

function formatBucketDate(bucketTs: string | null): string | null {
  if (!bucketTs) return null;
  const time = new Date(bucketTs).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function StaleBtcRateNotice({ bucketTs }: { bucketTs: string | null }) {
  const dateLabel = formatBucketDate(bucketTs);
  const lastUpdate = dateLabel ? ` (last update ${dateLabel})` : "";
  const message = `Bitcoin prices are out of date${lastUpdate}.`;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="stale-btc-rate-notice"
      className="w-full border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-800"
    >
      {message} Values converted from or to Bitcoin may be wrong.
    </div>
  );
}

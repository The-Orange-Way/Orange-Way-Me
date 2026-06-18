/**
 * SourceWalletBadges — render currency chips for a connection's selected wallets.
 *
 * Adapted from orange-rails/src/components/app/SourceWalletBadges.tsx. Each
 * connection card in Connections shows which OR source wallets are being
 * synced. The wallet metadata is encrypted on OR's side, so the parent
 * decrypts the `{currency, label?}` JSON in advance and passes the plaintext
 * here for display.
 *
 * If a connection has no source_wallets configured (legacy account-wide mode)
 * we render a neutral "Default account" badge so the state is visible.
 */

export interface DecryptedWalletForBadges {
  id: string;
  external_wallet_id: string;
  is_synced: boolean;
  currency: string;
  label?: string | null;
}

interface SourceWalletBadgesProps {
  wallets: DecryptedWalletForBadges[];
}

function chipClass(currency: string): string {
  switch (currency.toUpperCase()) {
    case "BTC":
    case "SATS":
      return "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30";
    case "USD":
      return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30";
    case "CAD":
      return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30";
    case "EUR":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30";
    default:
      return "bg-muted text-muted-foreground border-input";
  }
}

export function SourceWalletBadges({ wallets }: SourceWalletBadgesProps) {
  if (wallets.length === 0) {
    return (
      <span className="inline-flex items-center rounded border border-input bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Default account
      </span>
    );
  }

  // Synced wallets first, paused ones afterwards (greyed out + line-through)
  // so the user can see at-a-glance what they previously deselected.
  const sorted = [...wallets].sort((a, b) =>
    a.is_synced === b.is_synced ? 0 : a.is_synced ? -1 : 1,
  );

  return (
    <div className="flex flex-wrap gap-1.5">
      {sorted.map((w) => {
        const label = w.label?.trim() || w.currency;
        return (
          <span
            key={w.id}
            title={w.is_synced ? `Syncing ${w.currency}` : `${w.currency} (paused)`}
            className={[
              "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              w.is_synced
                ? chipClass(w.currency)
                : "border-dashed border-muted text-muted-foreground line-through",
            ].join(" ")}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

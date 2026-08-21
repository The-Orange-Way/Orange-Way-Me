import { AlertTriangle, Building2, HelpCircle, PowerOff, Zap } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Account } from "@/lib/connectors";
import { ACCOUNT_TYPE_LABELS } from "@/lib/connectors/constants";
import { formatCurrencyWithMode } from "@/lib/format";
import { useLocaleFormat, numberLocale } from "@/lib/locale";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { useNow } from "@/hooks/useNow";

/**
 * Per-account OR connection status passed in from the AccountsPage
 * derived map. Undefined means "this account is not fed from any OR
 * connection" — the badge is hidden.
 *
 * If multiple OR connections feed this account (rare — N:M mapping
 * supported by the schema), the worst status wins:
 *   error > disconnected > active
 */
export interface AccountConnectionStatus {
  status: "active" | "error" | "disconnected" | "unknown";
  /** Decrypted error message when status === 'error', else null. */
  lastError: string | null;
  /** Most recent successful sync across all connections feeding this account. */
  lastSyncAt: string | null;
  /** Connection count feeding this account, for tooltip phrasing. */
  connectionCount: number;
}

export function AccountCard({
  account,
  onStatement,
  connectionStatus,
  txnSum,
}: {
  account: Account;
  onStatement?: (account: Account) => void;
  connectionStatus?: AccountConnectionStatus;
  /** Sum of imported transactions for this account. Used as a live balance
   *  fallback when the stored balance is still $0 (e.g. a bank wallet that
   *  was created with no opening balance and got transactions synced after). */
  txnSum?: number;
}) {
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const loc = numberLocale(prefs.numberFormat);

  const stored = Number(account.balance);
  const useTxnLive =
    Number.isFinite(stored) &&
    stored === 0 &&
    typeof txnSum === "number" &&
    Math.abs(txnSum) > 0.005;
  const displayBalance = useTxnLive ? String(txnSum) : account.balance;

  return (
    <Card
      className="flex cursor-pointer items-center justify-between gap-4 border-border p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
      role="button"
      tabIndex={0}
      onClick={() => onStatement?.(account)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onStatement?.(account);
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-medium">{account.name}</div>
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
            {ACCOUNT_TYPE_LABELS[account.type] ?? account.type}
          </Badge>
          {connectionStatus && (
            <ConnectionBadge status={connectionStatus} accountName={account.name} />
          )}
        </div>
        {account.institution && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3" />
            <span className="truncate">{account.institution}</span>
          </div>
        )}
      </div>
      <div className="text-right">
        <div className="font-mono text-lg font-semibold tabular-nums">
          {formatCurrencyWithMode(displayBalance, account.currency, prefs.btcDisplayMode, loc)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {useTxnLive
            ? "From imported transactions"
            : `Updated ${fmt.formatDate(new Date(account.updated_at))}`}
        </div>
      </div>
    </Card>
  );
}

/**
 * Tiny inline badge that surfaces the OR connection health for an
 * account. Four states:
 *
 *   active       → small green "Synced" pill (only shown if recent;
 *                  hidden for accounts that haven't synced in > 24h to
 *                  avoid badge clutter on every wallet)
 *   error        → red "Reconnect" pill with the decrypted error in a
 *                  tooltip and a click-through to /connections
 *   disconnected → muted "Disconnected" pill with click-through to
 *                  /connections to re-add
 *   unknown      → amber "Status unknown" pill, shown when OR was
 *                  unreachable so the real status could not be read.
 *                  Distinct from error: not known to be broken.
 *
 * Clicking the badge stops event propagation so the underlying card
 * click (which opens the statement sheet) doesn't fire.
 */
function ConnectionBadge({
  status,
  accountName,
}: {
  status: AccountConnectionStatus;
  accountName: string;
}) {
  const now = useNow(60_000);
  const stop = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation();

  if (status.status === "error") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/connections"
              onClick={stop}
              onKeyDown={stop}
              className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20"
            >
              <AlertTriangle className="h-3 w-3" />
              Reconnect
            </Link>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-xs text-xs">
            <p className="font-medium">Connection feeding {accountName} has an error.</p>
            {status.lastError && <p className="mt-1 text-muted-foreground">{status.lastError}</p>}
            <p className="mt-1 text-muted-foreground">Click to open Connections.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (status.status === "disconnected") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/connections"
              onClick={stop}
              onKeyDown={stop}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/70"
            >
              <PowerOff className="h-3 w-3" />
              Disconnected
            </Link>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-xs text-xs">
            <p>The OrangeRails connection feeding {accountName} is disconnected.</p>
            <p className="mt-1 text-muted-foreground">Click to re-add.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (status.status === "unknown") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/connections"
              onClick={stop}
              onKeyDown={stop}
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              <HelpCircle className="h-3 w-3" />
              Status unknown
            </Link>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-xs text-xs">
            <p className="font-medium">
              Cannot check the connection feeding {accountName} right now.
            </p>
            <p className="mt-1 text-muted-foreground">
              We could not reach OrangeRails, so this account's sync status is unknown. It is not
              necessarily broken. Click to open Connections.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // status === 'active' — only show the pill if it synced in the last 24h
  // so the badge doesn't add noise on every OR-fed wallet.
  if (!status.lastSyncAt) return null;
  const ageMs = now - new Date(status.lastSyncAt).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/connections"
            onClick={stop}
            onKeyDown={stop}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
          >
            <Zap className="h-3 w-3" />
            Synced
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="text-xs">
          <p>Synced via OrangeRails {timeAgoShort(status.lastSyncAt)}. Click to view connections.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

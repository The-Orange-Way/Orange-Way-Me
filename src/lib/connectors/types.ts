/**
 * Pluggable connector architecture.
 *
 * Each connector knows how to:
 *   - Render a flow that produces an AccountDraft (encrypted client-side
 *     before being inserted into the `accounts` table).
 *   - Optionally sync transactions or refresh balance.
 *
 * All plaintext stays in browser memory. Only encrypted blobs are persisted.
 */
import type { ComponentType } from "react";

export type ConnectorType = "manual" | "csv" | "xpub" | "simplefin" | "orange_rails";

export type AccountTypeKey =
  | "checking"
  | "savings"
  | "credit"
  | "investment"
  | "bitcoin"
  | "loan"
  | "real_estate"
  | "other";

export interface AccountDraft {
  name: string;
  type: AccountTypeKey;
  currency: string;
  institution?: string | null;
  balance: string;
  metadata?: Record<string, unknown> | null;
  /** Optional: plaintext credentials to encrypt + store in connector_credentials. */
  credentials?: Record<string, unknown>;
  /** Optional: plaintext transactions to seed (CSV import). */
  seedTransactions?: TransactionDraft[];
}

export interface TransactionDraft {
  date: string; // YYYY-MM-DD, plaintext on row
  amount: string; // signed numeric string
  description: string;
  merchant?: string | null;
  category_id?: string | null;
  memo?: string | null;
  tags?: string[] | null;
}

/**
 * Persisted account record (decrypted in memory). Mirrors the columns the UI
 * needs after `decryptAccount` has run.
 */
export interface Account {
  id: string;
  user_id: string;
  connector_type: ConnectorType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  name: string;
  type: AccountTypeKey;
  currency: string;
  institution?: string | null;
  balance: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Props every connector flow component receives. The flow component is
 * responsible for collecting input and calling onComplete with a draft.
 */
export interface ConnectorFlowProps {
  onComplete: (draft: AccountDraft) => void | Promise<void>;
  onCancel: () => void;
}

export interface Connector {
  type: ConnectorType;
  label: string;
  /** Lucide icon name — resolved by the picker UI. */
  icon: string;
  description: string;
  comingSoon?: boolean;
  /**
   * If set, the connector tile becomes a navigation link. Clicking it
   * closes the picker dialog and navigates to this TanStack Router
   * path. Used for connectors that don't fit the in-dialog flow shape
   * (e.g. OrangeRails, where the connect-and-discover flow has 4
   * stages and lives on its own page).
   *
   * When `navigateTo` is set, `FlowComponent` is never rendered.
   */
  navigateTo?: string;
  /** React component rendered as the post-selection flow. */
  FlowComponent: ComponentType<ConnectorFlowProps>;
  /** Refresh balance for read-only watchers (e.g. xpub). */
  refreshBalance?: (account: Account) => Promise<string>;
}

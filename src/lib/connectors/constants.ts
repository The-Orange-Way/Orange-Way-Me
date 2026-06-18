import type { AccountTypeKey } from "./types";

export const ACCOUNT_TYPES: { key: AccountTypeKey; label: string }[] = [
  { key: "checking", label: "Checking" },
  { key: "savings", label: "Savings" },
  { key: "credit", label: "Credit card" },
  { key: "investment", label: "Investment" },
  { key: "bitcoin", label: "Bitcoin" },
  { key: "loan", label: "Loan" },
  { key: "real_estate", label: "Real estate" },
  { key: "other", label: "Other" },
];

export const ACCOUNT_TYPE_ORDER: AccountTypeKey[] = ACCOUNT_TYPES.map((t) => t.key);

export const ACCOUNT_TYPE_LABELS: Record<AccountTypeKey, string> = ACCOUNT_TYPES.reduce(
  (acc, t) => {
    acc[t.key] = t.label;
    return acc;
  },
  {} as Record<AccountTypeKey, string>,
);

export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "BTC", "sats"] as const;

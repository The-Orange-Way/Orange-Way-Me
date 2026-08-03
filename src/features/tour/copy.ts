/**
 * TOUR_COPY -- first-run dashboard coachmarks.
 *
 * All strings are PLACEHOLDERS. CX owns the final wording.
 * Swap each value when CX delivers copy; the object shape must stay the same.
 *
 * Same pattern as ONBOARDING_COPY in src/features/onboarding/steps.tsx:
 * one exported object, one import path, one diff to review when strings change.
 *
 * OWB uses the same mechanism with its own copy object in the same shape.
 * Do not inline strings into the component -- they live here only.
 */
export const TOUR_COPY = {
  netWorth: {
    /** Bubble label for the NetWorthCard anchor. */
    label: "PLACEHOLDER: Your total picture, updated in real time.",
  },
  accounts: {
    /** Bubble label for the AccountsSummary anchor. */
    label: "PLACEHOLDER: Connect a wallet or account here to get started.",
  },
  transactions: {
    /** Bubble label for the RecentTransactions anchor. */
    label: "PLACEHOLDER: Every transaction lands here automatically.",
  },
  /** CTA on every bubble. Clicking any one of these dismisses all three. */
  dismiss: "Got it",
} as const;

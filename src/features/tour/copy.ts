/**
 * TOUR_COPY -- first-run dashboard coachmarks.
 *
 * CX owns all strings. Do not change wording here without a CX ruling in
 * the workstream Zulip topic. The Auditor checks bytes, not intent.
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
    label: "All your accounts, totalled in one private number.",
  },
  accounts: {
    /** Bubble label for the AccountsSummary anchor. */
    label: "Each account you connect shows up here.",
  },
  upcomingBills: {
    /** Bubble label for the UpcomingBills anchor. */
    label: "Bills due soon, so nothing catches you off guard.",
  },
  /** CTA on every bubble -- clicking any one dismisses all three. */
  skip: "I'll explore on my own",
  /** Toast shown once when the tour is dismissed. */
  toast: "Tap any card to get started.",
  /**
   * Heading for the user's very first dashboard visit, shown in place of the
   * time-of-day greeting until the tour is dismissed. One-time moment of truth.
   * Subsequent visits revert to "Good morning/afternoon/evening, [Name]".
   */
  arrival: "Your finances are ready. Private by design, and yours alone.",
} as const;

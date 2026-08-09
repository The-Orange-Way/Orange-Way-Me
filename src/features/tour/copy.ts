/**
 * TOUR_COPY -- first-run dashboard coachmarks.
 *
 * All strings confirmed by CX Champion (DL-0709). Update here only
 * when CX delivers new copy; the object shape must stay the same.
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
  /** Skip CTA on every bubble. Clicking any one of these dismisses the tour. */
  skip: "I'll explore on my own",
  /** Toast shown after the tour is dismissed. */
  toast: "Tap any card to get started.",
  /**
   * One-time arrival line shown on first dashboard load after onboarding completes.
   * Subsequent visits show the personalized time-of-day greeting instead.
   */
  arrival: "Your finances are ready. Private by design, and yours alone.",
} as const;

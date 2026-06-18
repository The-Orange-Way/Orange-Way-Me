/**
 * Single source of truth for Vite-time feature flags.
 *
 * Values resolved at build time from `import.meta.env`. Default to OFF
 * in production so unfinished work doesn't ship to customers.
 *
 * ── Phase 4.4 (`phase44Public`) ──────────────────────────────────────
 *
 * Phase 4.4 ships an end-to-end signing path (Household Signing Key /
 * ML-DSA-65 mutation signatures) client-side, plus auditor-role
 * invites and customer support-session grants in the UI. The server
 * side currently uses a *placeholder* verifier
 * (`public.pqc_verify_ml_dsa_65` in the
 * `20260514234456_phase4_4_household_auditor_support_osk.sql`
 * migration) that returns TRUE for any well-formed base64 string. Until
 * a real ML-DSA verifier ships server-side, marketing/UI must not
 * claim tamper-detection as a security control.
 *
 * This flag hides every Phase 4.4 customer-facing UI surface until the
 * real verifier ships. The crypto code itself is unchanged: a customer
 * who somehow calls the relevant edge functions directly still goes
 * through the same backend (which already enforces presence /
 * authorisation correctly — only the cryptographic verification is
 * cosmetic). Flipping the flag back on is a one-line CF Pages env var
 * change once the verifier lands.
 *
 * Operational note: after merge, the CF Pages env var must STAY at
 * default (unset / false) for both dev and prod environments. Only
 * flip `VITE_PHASE_4_4_PUBLIC=true` once the real ML-DSA verifier ships.
 */

const truthy = (v: string | undefined): boolean => v === "true" || v === "1" || v === "yes";

export const featureFlags = {
  /**
   * When false (default), the Phase 4.4 UI is hidden: no auditor role
   * in the invite dropdown, no expiry badges on members, no "Sign your
   * account" section, no "Customer support access" section, and the
   * global SupportSessionBanner does not render. The silent HSK mint
   * in VaultContext is also suppressed so customers don't trigger the
   * placeholder verifier inadvertently.
   *
   * When true, all Phase 4.4 surfaces become visible and operate
   * normally. Only set this once the real ML-DSA verifier ships.
   */
  phase44Public: truthy(import.meta.env.VITE_PHASE_4_4_PUBLIC),
} as const;

export type FeatureFlag = keyof typeof featureFlags;

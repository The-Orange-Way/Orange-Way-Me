/**
 * Hook wrapper around `featureFlags` for components that prefer a
 * hook API. Reads are synchronous and stable for the lifetime of the
 * build — flags are resolved at `vite build` time from
 * `import.meta.env`, so re-renders never see a flipped value.
 */
import { featureFlags, type FeatureFlag } from "@/lib/feature-flags";

export function useFeatureFlag(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}

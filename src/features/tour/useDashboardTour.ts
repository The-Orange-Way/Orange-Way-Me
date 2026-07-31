import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

/**
 * Reads and writes the dashboard tour "seen" flag.
 *
 * Persistence: user_profiles.has_seen_dashboard_tour (boolean, default false).
 * Stored server-side so the tour is not repeated when the user opens the app
 * on a new device or browser. Cross-device "seen once" is the contract.
 *
 * Returns { showTour, dismiss }.
 *   showTour -- true until the user dismisses or the flag is already set.
 *               Starts false to avoid a flash while the row is loading.
 *   dismiss  -- sets the flag locally and upserts to the server. Fire and
 *               forget: a network error on dismiss is not worth surfacing
 *               (the tour just reappears on the next cold load, which is
 *               minor friction and always self-correcting).
 *
 * Types: src/integrations/supabase/types.ts must be regenerated after the DBA
 * lands the migration. Until then the query is cast via `as any` to avoid the
 * missing-column type error. The `as any` is scoped to this file only and
 * carries a TODO so it cannot be silently forgotten.
 *
 * Design-twin note: OWB uses the same hook. Keep the signature stable.
 */
export function useDashboardTour(): { showTour: boolean; dismiss: () => void } {
  const { user } = useAuth();
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    // TODO: remove `as any` after types.ts is regenerated post-migration.
    (supabase as any)
      .from("user_profiles")
      .select("has_seen_dashboard_tour")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }: { data: { has_seen_dashboard_tour: boolean } | null }) => {
        if (cancelled) return;
        // Show if the row is missing (new user) or the flag is false.
        // Do not show if the flag is true or if auth is not ready.
        if (data === null || data.has_seen_dashboard_tour === false) {
          setShowTour(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const dismiss = useCallback(() => {
    // Hide immediately so the user sees the change at once.
    setShowTour(false);
    if (!user) return;
    // TODO: remove `as any` after types.ts is regenerated post-migration.
    (supabase as any)
      .from("user_profiles")
      .upsert(
        { user_id: user.id, has_seen_dashboard_tour: true },
        { onConflict: "user_id" },
      );
    // No await: fire-and-forget. If the write fails silently the tour
    // reappears on the next cold load -- minor friction, self-correcting.
  }, [user]);

  return { showTour, dismiss };
}

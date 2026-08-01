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
 *   dismiss  -- hides the tour immediately (setShowTour(false)) and issues
 *               the upsert. A write error is logged and not surfaced: the tour
 *               simply reappears on the next cold load, which is minor friction
 *               and self-correcting.
 *
 * Types: has_seen_dashboard_tour is hand-added to
 * src/integrations/supabase/types.ts ahead of the next `supabase gen types`
 * pass. The migration is already applied to dev, so the next regeneration
 * converges automatically.
 *
 * Design-twin note: OWB uses the same hook. Keep the signature stable.
 */
export function useDashboardTour(): { showTour: boolean; dismiss: () => void } {
  const { user } = useAuth();
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    supabase
      .from("user_profiles")
      .select("has_seen_dashboard_tour")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return;
        // Show if the row is missing (new user) or the flag is false.
        // Do not show if the flag is true, if auth is not ready, or if the
        // read failed, because a failed read is not evidence of a new user.
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
    void supabase
      .from("user_profiles")
      .upsert({ user_id: user.id, has_seen_dashboard_tour: true }, { onConflict: "user_id" })
      .then(({ error }) => {
        if (error) {
          console.warn("dashboard tour: could not persist seen flag", error.message);
        }
      });
  }, [user]);

  return { showTour, dismiss };
}

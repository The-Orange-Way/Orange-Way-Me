/**
 * HouseholdMaintenanceBanner — Phase 4.5.
 *
 * Global top-of-app banner shown to non-Owner household members while
 * a household refresh job is in an intermediate stage
 * (wrapping_members, rekeying_rows, finalizing). The Owner driving
 * the refresh sees the wizard progress UI instead, so the banner is
 * hidden for them.
 *
 * Subscribes via Supabase realtime to `household_key_rotation_jobs`
 * for the user's active household. Also polls once on mount in case
 * a job started before the subscription was live.
 *
 * Customer-first copy: no DEK/KEM/wrap. Just "Your household is
 * updating its security."
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

export interface HouseholdMaintenanceBannerProps {
  /** If omitted, the banner resolves the user's household itself (owner
   *  or active member). Passing it explicitly is still supported for
   *  callers that already have the id. */
  householdId?: string | null;
  /** If the current user is the one running the refresh, suppress the
   *  banner (they see the wizard progress UI instead). */
  currentUserId: string | null;
}

interface ActiveJob {
  id: string;
  status: string;
  started_by: string;
}

const ACTIVE_STAGES = new Set(["wrapping_members", "rekeying_rows", "finalizing"]);

export function HouseholdMaintenanceBanner({
  householdId: householdIdProp,
  currentUserId,
}: HouseholdMaintenanceBannerProps) {
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [resolvedHouseholdId, setResolvedHouseholdId] = useState<string | null>(
    householdIdProp ?? null,
  );

  // If the caller didn't pass a householdId, look one up via owned-
  // household or active membership. Keeps the banner usable from the
  // app shell without plumbing state through every layer.
  useEffect(() => {
    if (householdIdProp !== undefined) {
      setResolvedHouseholdId(householdIdProp ?? null);
      return;
    }
    if (!currentUserId) {
      setResolvedHouseholdId(null);
      return;
    }
    let active = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data: owned } = await db
        .from("households")
        .select("id")
        .eq("owner_id", currentUserId)
        .maybeSingle();
      if (!active) return;
      if (owned) {
        setResolvedHouseholdId((owned as { id: string }).id);
        return;
      }
      const { data: member } = await db
        .from("household_members")
        .select("household_id")
        .eq("user_id", currentUserId)
        .eq("status", "active")
        .order("invited_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      setResolvedHouseholdId((member as { household_id: string } | null)?.household_id ?? null);
    })();
    return () => {
      active = false;
    };
  }, [householdIdProp, currentUserId]);

  const householdId = resolvedHouseholdId;

  useEffect(() => {
    if (!householdId) {
      setActiveJob(null);
      return;
    }
    let active = true;

    const fetchLatest = async () => {
      const { data } = await supabase
        .from("household_key_rotation_jobs" as never)
        .select("id, status, started_by")
        .eq("household_id" as never, householdId)
        .in("status" as never, Array.from(ACTIVE_STAGES))
        .order("started_at" as never, { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      setActiveJob((data as ActiveJob | null) ?? null);
    };
    void fetchLatest();

    const channel = supabase
      .channel(`household-key-rotation-${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "household_key_rotation_jobs",
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          void fetchLatest();
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [householdId]);

  if (!activeJob) return null;
  if (currentUserId && activeJob.started_by === currentUserId) return null;

  return (
    <div className="flex w-full items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
      <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
      <div className="flex-1">
        <p className="font-semibold text-amber-900 dark:text-amber-200">
          Your household is updating its security.
        </p>
        <p className="text-amber-800 dark:text-amber-300">
          You can view data but can't make changes for a few minutes. If this takes longer than
          expected, reload and try again.
        </p>
      </div>
    </div>
  );
}

export default HouseholdMaintenanceBanner;

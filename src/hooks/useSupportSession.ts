/**
 * useSupportSession — Phase 4.4.
 *
 * Reads + mutates the `support_sessions` table for the Owner's
 * household. Supports:
 *   - grant: open a time-boxed (1 / 6 / 12 / 24 hour) customer support
 *     session.
 *   - end: revoke an active session immediately.
 *   - active session lookup for the global SupportSessionBanner.
 *
 * Plain-English copy at the call sites. This hook stays free of UI
 * concerns.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

export interface ActiveSupportSession {
  id: string;
  household_id: string;
  support_user_id: string;
  granted_by: string;
  granted_at: string;
  expires_at: string;
  ended_at: string | null;
}

export function useSupportSession(householdId: string | null) {
  const { user } = useAuth();
  const [session, setSession] = useState<ActiveSupportSession | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!householdId) {
      setSession(null);
      return;
    }
    setLoading(true);
    try {
      const { data } = await db()
        .from("support_sessions")
        .select("id, household_id, support_user_id, granted_by, granted_at, expires_at, ended_at")
        .eq("household_id", householdId)
        .is("ended_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("granted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setSession((data as ActiveSupportSession | null) ?? null);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grant = useCallback(
    async (supportEmail: string, durationHours: 1 | 6 | 12 | 24) => {
      if (!householdId) throw new Error("No household");
      const { error } = await supabase.functions.invoke("admin-update-household-member", {
        body: {
          household_id: householdId,
          action: "grant_support_session",
          payload: {
            support_email: supportEmail,
            duration_hours: durationHours,
          },
        },
      });
      if (error) {
        const msg = (error as { message?: string }).message ?? "Could not grant support access";
        throw new Error(msg);
      }
      await reload();
    },
    [householdId, reload],
  );

  const end = useCallback(
    async (sessionId: string) => {
      if (!householdId) throw new Error("No household");
      const { error } = await supabase.functions.invoke("admin-update-household-member", {
        body: {
          household_id: householdId,
          action: "end_support_session",
          payload: { session_id: sessionId },
        },
      });
      if (error) {
        const msg = (error as { message?: string }).message ?? "Could not end the support session";
        throw new Error(msg);
      }
      await reload();
    },
    [householdId, reload],
  );

  return { session, loading, grant, end, reload, currentUserId: user?.id ?? null };
}

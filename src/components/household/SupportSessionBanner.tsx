/**
 * SupportSessionBanner — Phase 4.4.
 *
 * Global top-of-app banner shown while a support session is active for
 * the user's household. The Owner sees an "End now" link; everyone else
 * just sees the notice.
 *
 * Plain-English copy: no "session", "grant", "OSK", "support_grant" —
 * the user sees "Support has temporary access until …".
 *
 * Mounted globally from AppShell alongside HouseholdMaintenanceBanner.
 */
import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { useNow } from "@/hooks/useNow";

export interface SupportSessionBannerProps {
  currentUserId: string | null;
}

interface ActiveSessionRow {
  id: string;
  household_id: string;
  granted_by: string;
  expires_at: string;
}

interface ResolvedHousehold {
  id: string;
  isOwner: boolean;
}

export function SupportSessionBanner({ currentUserId }: SupportSessionBannerProps) {
  const [resolved, setResolved] = useState<ResolvedHousehold | null>(null);
  const [session, setSession] = useState<ActiveSessionRow | null>(null);
  const [ending, setEnding] = useState(false);
  const now = useNow(60_000);

  // Resolve which household the user belongs to (owner first, else
  // active membership).
  useEffect(() => {
    if (!currentUserId) {
      setResolved(null);
      return;
    }
    let active = true;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data: owned } = await db
        .from("households")
        .select("id")
        .eq("owner_id", currentUserId)
        .maybeSingle();
      if (!active) return;
      if (owned) {
        setResolved({ id: (owned as { id: string }).id, isOwner: true });
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
      if (member) {
        setResolved({
          id: (member as { household_id: string }).household_id,
          isOwner: false,
        });
      } else {
        setResolved(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [currentUserId]);

  const reload = useCallback(async () => {
    if (!resolved) {
      setSession(null);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data } = await db
      .from("support_sessions")
      .select("id, household_id, granted_by, expires_at")
      .eq("household_id", resolved.id)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSession((data as ActiveSessionRow | null) ?? null);
  }, [resolved]);

  // Initial load + realtime subscription to support_sessions for this household.
  useEffect(() => {
    if (!resolved) return;
    void reload();
    const channel = supabase
      .channel(`support_sessions:${resolved.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_sessions",
          filter: `household_id=eq.${resolved.id}`,
        },
        () => {
          void reload();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [resolved, reload]);

  const endNow = useCallback(async () => {
    if (!session || !resolved) return;
    setEnding(true);
    try {
      const { error } = await supabase.functions.invoke("admin-update-household-member", {
        body: {
          household_id: resolved.id,
          action: "end_support_session",
          payload: { session_id: session.id },
        },
      });
      if (error) {
        throw new Error(
          (error as { message?: string }).message ??
            "Could not end support access. Please try again.",
        );
      }
      toast.success("Support access has ended.");
      await reload();
    } catch (err) {
      toastError(err, "Could not end support access.");
    } finally {
      setEnding(false);
    }
  }, [session, resolved, reload]);

  if (!session) return null;

  const minutesLeft = Math.max(
    0,
    Math.round((new Date(session.expires_at).getTime() - now) / 60_000),
  );
  const friendlyTimeLeft =
    minutesLeft >= 60 ? `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m` : `${minutesLeft}m`;
  const expiresAtLocal = new Date(session.expires_at).toLocaleString();

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="support-session-banner"
      className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <div>
          <strong>Support has temporary access.</strong>{" "}
          <span className="text-amber-800">
            Access ends in {friendlyTimeLeft} (around {expiresAtLocal}).
          </span>
        </div>
      </div>
      {resolved?.isOwner && (
        <Button
          variant="ghost"
          size="sm"
          className="text-amber-900 hover:bg-amber-100"
          onClick={() => void endNow()}
          disabled={ending}
        >
          {ending ? "Ending…" : "End now"}
        </Button>
      )}
    </div>
  );
}

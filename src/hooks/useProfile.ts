import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useVault } from "@/context/VaultContext";
import { useAuth } from "@/context/AuthContext";

// (supabase as any) preserves loose typing for legacy callsites where local
// interfaces (Household, HouseholdInvite, HouseholdMember) intentionally
// differ in shape from the generated DB Row types. Tightening these is a
// separate cleanup item — see follow-up tasks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

export interface UserProfile {
  displayName: string;
  avatarUrl: string | null;
}

export function useProfile() {
  const { user } = useAuth();
  const { encryptText, decryptText, isUnlocked } = useVault();
  const [profile, setProfile] = useState<UserProfile>({ displayName: "", avatarUrl: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !isUnlocked) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await db()
        .from("user_profiles")
        .select("enc_display_name, avatar_url")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const dn = data.enc_display_name
          ? await decryptText(data.enc_display_name).catch(() => "")
          : "";
        setProfile({ displayName: dn, avatarUrl: data.avatar_url });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isUnlocked, decryptText]);

  const updateDisplayName = useCallback(
    async (name: string) => {
      if (!user) throw new Error("Not authenticated");
      const enc = await encryptText(name);
      const { error } = await db()
        .from("user_profiles")
        .upsert({ user_id: user.id, enc_display_name: enc, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      setProfile((p) => ({ ...p, displayName: name }));
    },
    [user, encryptText],
  );

  return { profile, loading, updateDisplayName };
}

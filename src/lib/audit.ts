/**
 * Security-event audit logger.
 *
 * Captures user-level vault key-management events: setup, unlock,
 * recover, password change, recovery code regeneration, vault upgrade.
 *
 * Events are written to public.vault_security_events with user-scoped
 * RLS. The metadata field is a JSONB blob for low-sensitivity context
 * (key_version, etc.) — never put plaintext, PII, or long strings here.
 *
 * All calls are non-fatal: a logging failure is swallowed so the
 * underlying auth flow never breaks because of an audit write.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type VaultSecurityEvent =
  | "vault_setup"
  | "vault_unlock"
  | "vault_unlock_failed"
  | "vault_unlock_unknown_version"
  | "vault_recover"
  | "vault_password_changed"
  | "recovery_code_regenerated"
  | "vault_upgraded";

/**
 * Append a vault security event for the given user.
 * Non-fatal — any error is logged to console and swallowed.
 */
export async function logSecurityEvent(
  userId: string,
  event: VaultSecurityEvent,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase.from("vault_security_events").insert({
      user_id: userId,
      event,
      metadata: (metadata ??
        null) as Database["public"]["Tables"]["vault_security_events"]["Insert"]["metadata"],
    });
    if (error) {
      // Supabase returns HTTP errors in the response object, not as thrown
      // exceptions, so this catch-block-without-check would miss RLS failures.
      console.warn("[VaultSecurityAudit] Insert rejected:", event, error);
    }
  } catch (err) {
    console.warn("[VaultSecurityAudit] Failed to write event:", event, err);
  }
}

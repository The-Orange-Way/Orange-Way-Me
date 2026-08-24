-- Follow-up to 20260823120000_referral_codes (DL-1432): tighten the redeem
-- function's grants and search_path to match the redeem_invite_code precedent
-- set by 20260720000000_restrict_redeem_invite_code_to_authenticated.
--
-- Two corrections, both verified against the live dev ACL (bogmoovbjpvcvdqrmjgt)
-- by the DBA and the Auditor:
--
-- 1. anon still holds EXECUTE. Supabase default privileges auto-grant execute
--    on every new public function to anon, and "revoke ... from public" does
--    not strip the explicit anon grant. The function is already safe at runtime
--    (the auth.uid() null check returns 'unauthenticated' before any read or
--    write), so this is not a live breach, but the grant should match the
--    precedent and the base file comment. anon is revoked AFTER the
--    create-or-replace because create-or-replace re-applies default privileges
--    and would re-grant anon otherwise.
--
-- 2. search_path was pinned to 'public'; the precedent function pins it to ''.
--    Every reference in the body is already schema-qualified
--    (public.referral_codes, auth.uid()), so '' is a drop-in with no body edit.
--
-- Re-runnable: create-or-replace and revoke/grant are all safe to repeat.
--
-- Reversal (down note, NOT executed here): to undo, re-create the function with
--   set search_path = public and re-grant anon, or drop and re-run the base
--   migration:
--     drop function if exists public.redeem_referral_code(text);
--     drop function if exists public.referral_codes_zero_count();
--   (then re-apply 20260823120000_referral_codes.sql).

create or replace function public.redeem_referral_code(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return 'unauthenticated';
  end if;

  select owner_id into v_owner
    from public.referral_codes
    where code = p_code;

  if v_owner is null then
    return 'not_found';
  end if;
  if v_owner = v_caller then
    return 'self';
  end if;

  update public.referral_codes
    set redemption_count = redemption_count + 1
    where code = p_code;

  return 'ok';
end;
$$;

-- Only signed-in users may redeem. Strip the anon grant that create-or-replace
-- re-applies, then grant only authenticated. This matches redeem_invite_code.
revoke execute on function public.redeem_referral_code(text) from public;
revoke execute on function public.redeem_referral_code(text) from anon;
grant execute on function public.redeem_referral_code(text) to authenticated;

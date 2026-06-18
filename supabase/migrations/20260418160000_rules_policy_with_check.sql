-- Reinforce rules RLS: earlier migration at 20260418130000 dropped the policy
-- and recreated it without `with check`, which would let a malicious client
-- write rows with a mismatched user_id. Restore the stricter policy.
drop policy if exists "own rules" on public.rules;
DROP POLICY IF EXISTS "own rules" ON public.rules;
create policy "own rules" on public.rules
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

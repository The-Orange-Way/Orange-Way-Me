-- 47 PUBLIC-targeted RLS policies in schema public, retargeted to authenticated.
--
-- WHY THIS EXISTS. Read live off OWM DEV bogmoovbjpvcvdqrmjgt via
-- pg_policy.polroles joined to pg_class/pg_namespace: 47 policies across 17
-- tables target PUBLIC (polroles is null), which means every role including
-- anon is evaluated by the policy instead of being excluded before the policy
-- is reached. household_keys and a handful of others already target
-- authenticated, which is why this reads as drift rather than a deliberate
-- design choice.
--
-- SEVERITY, STATED HONESTLY. Every USING/WITH CHECK clause below compares
-- against auth.uid(), which is null for an anonymous request, so no rows
-- match and nothing is exposed today. The reason to fix it anyway: leaving
-- anon inside the policy set means the protection depends on every clause
-- staying correct forever. One clause written with an OR, or one comparison
-- where a null compares in the wrong direction, and the table becomes
-- readable. Retargeting removes the whole class of mistake instead of
-- depending on vigilance.
--
-- WHAT IS DELIBERATELY NOT TOUCHED. Two deny-all policies keep targeting
-- PUBLIC: ow_or_proxy_rate_limit_deny_all and pending_admin_emails_deny_all.
-- A deny-all is STRONGER targeting PUBLIC than authenticated, because
-- narrowing it to authenticated would leave anon outside the deny (i.e. not
-- denied at all, since there would be no policy governing it). Also not
-- touched: app_flags and beta_applications, whose PUBLIC-adjacent grants to
-- authenticated,anon are deliberate (a public flag read and a public signup
-- form), and every policy already correctly targeting authenticated.
--
-- HOW. ALTER POLICY ... TO authenticated changes only the role list. It does
-- not touch the USING or WITH CHECK expression, so there is no risk of a
-- clause being retyped incorrectly across 47 statements the way a DROP and
-- CREATE would carry.
--
-- REVERSIBLE. Re-run the same statements with PUBLIC in place of
-- authenticated to restore the prior (wider) role list.
--
-- IDEMPOTENT. ALTER POLICY ... TO is naturally re-runnable; running this file
-- twice leaves the same end state.
--
-- Full enumeration, the decision table (retarget / keep-as-PUBLIC-with-reason
-- / already-correct) and the read-only query used to find these live on
-- ticket OWM-T0494.

begin;

alter policy "own accounts delete" on public.accounts to authenticated;
alter policy "own accounts insert" on public.accounts to authenticated;
alter policy "own accounts select" on public.accounts to authenticated;
alter policy "own accounts update" on public.accounts to authenticated;

alter policy "own budgets delete" on public.budgets to authenticated;
alter policy "own budgets insert" on public.budgets to authenticated;
alter policy "own budgets select" on public.budgets to authenticated;
alter policy "own budgets update" on public.budgets to authenticated;

alter policy "own categories delete" on public.categories to authenticated;
alter policy "own categories insert" on public.categories to authenticated;
alter policy "own categories select" on public.categories to authenticated;
alter policy "own categories update" on public.categories to authenticated;

alter policy "own connection_account_map delete" on public.connection_account_map to authenticated;
alter policy "own connection_account_map insert" on public.connection_account_map to authenticated;
alter policy "own connection_account_map select" on public.connection_account_map to authenticated;
alter policy "own connection_account_map update" on public.connection_account_map to authenticated;

alter policy "own credentials delete" on public.connector_credentials to authenticated;
alter policy "own credentials insert" on public.connector_credentials to authenticated;
alter policy "own credentials select" on public.connector_credentials to authenticated;
alter policy "own credentials update" on public.connector_credentials to authenticated;

alter policy "users read own crosssell_state" on public.crosssell_state to authenticated;
alter policy "users update own crosssell_state" on public.crosssell_state to authenticated;

alter policy "own goals delete" on public.goals to authenticated;
alter policy "own goals insert" on public.goals to authenticated;
alter policy "own goals select" on public.goals to authenticated;
alter policy "own goals update" on public.goals to authenticated;

alter policy "household_invites_owner" on public.household_invites to authenticated;

alter policy "household_members_own_read" on public.household_members to authenticated;
alter policy "household_members_owner_write" on public.household_members to authenticated;

alter policy "households_owner_all" on public.households to authenticated;
alter policy "households_select_active_member" on public.households to authenticated;

alter policy "own rules" on public.rules to authenticated;

alter policy "users insert own stealth_sync_runs" on public.stealth_sync_runs to authenticated;
alter policy "users read own stealth_sync_runs" on public.stealth_sync_runs to authenticated;
alter policy "users update own stealth_sync_runs" on public.stealth_sync_runs to authenticated;

alter policy "users read own sync_events" on public.sync_events to authenticated;

alter policy "own transactions delete" on public.transactions to authenticated;
alter policy "own transactions insert" on public.transactions to authenticated;
alter policy "own transactions select" on public.transactions to authenticated;
alter policy "own transactions update" on public.transactions to authenticated;

alter policy "user_profiles_own" on public.user_profiles to authenticated;

alter policy "own vault delete" on public.vault_metadata to authenticated;
alter policy "own vault insert" on public.vault_metadata to authenticated;
alter policy "own vault select" on public.vault_metadata to authenticated;
alter policy "own vault update" on public.vault_metadata to authenticated;

alter policy "Users can insert their own vault security events" on public.vault_security_events to authenticated;
alter policy "Users can read their own vault security events" on public.vault_security_events to authenticated;

commit;

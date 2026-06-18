-- Household-level currency preferences.
--
-- Three plaintext columns on `households` that the Settings → Household →
-- Currencies screen edits. Plaintext is safe — these are display defaults,
-- not financial amounts.
--
--   primary_currency    — what the dashboard shows by default ("we think in CAD")
--   reporting_currency  — used for exports / year-end PDFs ("we file in CAD")
--   btc_display_mode    — how Bitcoin amounts render across the app
--
-- Per-user device overrides still live in localStorage via useDashboardPrefs
-- so a co-admin can flip their personal view without changing what the
-- household sees. Household defaults seed new users on first load.

alter table households
  add column if not exists primary_currency   text not null default 'USD',
  add column if not exists reporting_currency text not null default 'USD',
  add column if not exists btc_display_mode   text not null default 'btc';

alter table households
  add constraint households_primary_currency_supported
    check (primary_currency in ('USD','CAD','EUR','GBP','BTC','sats'));

alter table households
  add constraint households_reporting_currency_supported
    check (reporting_currency in ('USD','CAD','EUR','GBP','BTC','sats'));

alter table households
  add constraint households_btc_display_mode_supported
    check (btc_display_mode in ('btc','btc_easy','sats','primary'));

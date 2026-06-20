-- Collapse the vault key-derivation registry to a single strategy: v1 = Argon2id
-- (64 MiB x 3 iterations x 4 parallelism). The historical PBKDF2 (v2) and the
-- transitional Argon2id (v3) tiers no longer exist as distinct strategies: every
-- vault derives its KEK the same way, so there is one canonical version.
--
-- All vault test data was wiped before this migration, so no live row carries the
-- old 2/3 values. The UPDATE below is a defensive no-op guard in case any stray
-- row predates the wipe; it cannot corrupt data because the MEK is unchanged by a
-- version relabel.
alter table public.vault_metadata
  alter column vault_key_version set default 1;

update public.vault_metadata
  set vault_key_version = 1
  where vault_key_version is distinct from 1;

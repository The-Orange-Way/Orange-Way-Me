-- Track which KDF produced the password-derived KEK in vault_metadata.
--   Version 2 = PBKDF2-SHA256, 600,000 iterations (legacy default).
--   Version 3 = Argon2id, 64 MiB x 3 iterations x 4 parallelism (new default).
-- Existing rows default to 2; new vaults write 3; the upgrade flow rewraps the
-- MEK under an Argon2id-derived KEK and bumps the column to 3. The MEK itself
-- does not change during upgrade, so all encrypted data and blind indexes
-- remain valid without re-encryption.
alter table public.vault_metadata
  add column if not exists vault_key_version smallint not null default 2;

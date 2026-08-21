-- Pin the Orange Rails key material so a password change stops destroying data.
--
-- The problem this exists for. The Orange Rails subkeys (credentials,
-- transactions, OPK seed, stealth widget) are DERIVED in the browser from the
-- vault password and vault_metadata.kdf_salt. Changing a vault password
-- regenerates kdf_salt, so all four subkeys change, and every row already
-- sealed under the previous ones can never be opened again by anyone,
-- including us. Recovery does the same thing for the same reason. The rows stay
-- in the database; the key to them is gone. It presents to the customer as
-- transactions that quietly stop being readable.
--
-- The two columns below let the client stop re-deriving that key material and
-- start reusing the material it already has.
--
--   enc_or_mek_ciphertext  the 32 Orange Rails MEK bytes, AES-GCM sealed under
--                          the vault MEK, base64, exactly the wire format used
--                          by enc_hmac_key. The vault MEK is a random key that
--                          is wrapped rather than derived, so it survives a
--                          password change and can be recovered from the
--                          recovery code. Anything wrapped under it inherits
--                          both properties.
--
--   or_subkey_salt         the kdf_salt value that was in force when that key
--                          material was first established. The four subkeys
--                          take the salt as an HKDF salt-context, so pinning
--                          the MEK alone would not be enough: the salt has to
--                          be pinned with it or the subkeys still move.
--
--   or_key_epoch           which generation of the pair above this is. Today
--                          it is always 1. It exists so that a client meeting
--                          material it does not understand refuses instead of
--                          unwrapping bytes whose meaning has moved. That is
--                          the whole failure mode this change is closing, so
--                          shipping the fix without a way to detect a future
--                          instance of it would be careless. Refusal is in
--                          BOTH directions: a newer generation means the
--                          client is stale, an older one means a migration was
--                          written and not run.
--
-- Why this is not a new pattern and not a new risk. enc_hmac_key already does
-- exactly this, and its comment gives exactly this reason: it decouples the
-- HMAC key from the vault password so blind indexes stay valid after a
-- password change. The same decoupling was never applied to the Orange Rails
-- namespace. This applies it.
--
-- Zero-knowledge boundary is unchanged. The server stores one more opaque
-- blob, sealed under a key it has never held and cannot derive. or_subkey_salt
-- is not secret: kdf_salt itself is already stored in plaintext in this table,
-- and a salt is not key material on its own.
--
-- All three columns are nullable on purpose. All-null means "not established
-- yet", which is every existing row, and the client establishes them together
-- on the next unlock, at the one moment it can still derive the legacy value
-- correctly. Nothing here backfills, because the server cannot: it would need
-- the password. A partially populated row is not a state this code can produce
-- and the client refuses it rather than repairing it, because both possible
-- repairs silently yield a key that opens nothing.
--
-- This does not recover already-orphaned rows. Nothing can.

alter table public.vault_metadata
  add column if not exists enc_or_mek_ciphertext text,
  add column if not exists or_subkey_salt text,
  add column if not exists or_key_epoch integer;

comment on column public.vault_metadata.enc_or_mek_ciphertext is
  'Orange Rails MEK bytes sealed under the vault MEK (base64 iv||ct||tag). Null until first established by the client. Never derivable by the server.';

comment on column public.vault_metadata.or_subkey_salt is
  'The kdf_salt in force when enc_or_mek_ciphertext was established. Pinned so the Orange Rails subkeys stop moving when kdf_salt rotates. Not secret.';

comment on column public.vault_metadata.or_key_epoch is
  'Generation of the pinned pair (enc_or_mek_ciphertext, or_subkey_salt). Always 1 today. A client that meets a generation it does not know refuses rather than guessing. Not secret.';

-- Neither column may be readable or writable by anyone but the owner. The
-- table's existing row level security already scopes every policy to
-- auth.uid() = user_id and these columns inherit that, so there is no new
-- policy here on purpose: adding one would imply the existing ones do not
-- cover new columns, which is not how column-level access works on this table.

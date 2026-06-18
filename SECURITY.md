# Orange Way — Security Architecture

Orange Way stores only ciphertext. Your financial life — account
names, balances, transactions, categories, budgets, goals — is encrypted in
your browser before it reaches the database. We have no key. We cannot read
your data. Neither can anyone who breaches our servers.

Think of it like a diary with an unbreakable padlock: we store the diary,
but you're the only one who has the key — and the key never leaves your head.

---

## Encryption stack

### Layer 1 — Password → Key (PBKDF2-SHA256, Argon2id upgrade in progress)

Your vault password is transformed into a 256-bit Master Encryption Key (MEK)
using **PBKDF2-SHA256 at 600,000 iterations** — double the OWASP 2023 minimum
and above any major commercial password manager today.

> **Upgrade path:** The vault library is being updated to Argon2id (64 MiB /
> 3 iter / 4 thread — OWASP 2023 recommended parameters, already live in
> OrangeRails). A settings-based migration will let existing vaults upgrade
> without data loss.

**Crack-time estimates at current PBKDF2-600k (single RTX 4090):**

| Password                                          | Time to crack                       |
| ------------------------------------------------- | ----------------------------------- |
| 6 random lowercase chars                          | ~1 minute — don't do this           |
| 10 random lowercase chars                         | ~4 centuries                        |
| 4 EFF words (e.g. "correct-horse-battery-staple") | ~6 years                            |
| 5 EFF words                                       | ~50 million years                   |
| 6 EFF words                                       | longer than the age of the universe |

A 4-word EFF passphrase is already effectively unbreakable against any
attacker on Earth today. Five words is mathematically impossible to crack
with any hardware foreseeable in the next 50 years.

### Layer 2 — Data encryption (AES-256-GCM)

Every `enc_*` column in Supabase uses **AES-256-GCM**:

- 96-bit random IV, freshly generated for every single encrypt call
- 128-bit GCM authentication tag — any tampered ciphertext throws before
  plaintext is returned. You can never receive silently corrupted data.
- Wire format: `base64(iv[12] + ciphertext + auth_tag[16])`

### Layer 3 — Blind indexes for private search

You can search merchants and categories without the server seeing the
plaintext search term. Here is how:

1. On encrypt, compute `HMAC-SHA-256(hmac_key, lowercase(merchant_name))`
2. Store the HMAC output (a fixed-length hash) in `hmac_merchant`
3. On search, compute the same HMAC over your query term
4. The server compares hash to hash — it never sees the plaintext name

The HMAC key is derived from your MEK via HKDF with label `bbp-hmac-v1`,
completely separate from your encryption subkeys.

### Layer 4 — Per-user random salt

A 16-byte random salt is generated at vault creation and stored in
`vault_metadata.kdf_salt`. No two users have the same salt, which means:

- Rainbow tables computed for one user are useless against any other user
- Precomputation attacks against the KDF are impossible without the salt

A separate `hmac_salt` is stored for HMAC blind indexes, keeping the
encryption and search key-spaces fully independent.

### Layer 5 — Recovery code

On vault creation, Orange Way generates a **12-word BIP-39-style
recovery code** (128 bits of entropy). This code:

- Is shown exactly once (write it down, keep it offline)
- Is used to derive a recovery KEK (Key Encryption Key)
- The MEK is wrapped with the recovery KEK and stored server-side
- If you forget your vault password, the recovery code lets you reset it
  without losing any data

The server stores `recovery_ciphertext` — the MEK encrypted by your recovery
KEK. It does not store the recovery code or the recovery KEK.

---

## What the server sees

| Field                   | Supabase stores                | Supabase can read                   |
| ----------------------- | ------------------------------ | ----------------------------------- |
| Account name            | `enc_name` (ciphertext)        | Never                               |
| Account balance         | `enc_balance` (ciphertext)     | Never                               |
| Transaction amount      | `enc_amount` (ciphertext)      | Never                               |
| Transaction description | `enc_description` (ciphertext) | Never                               |
| Merchant name           | HMAC blind index only          | Never (name never stored plain)     |
| Category                | HMAC blind index only          | Never                               |
| Transaction date        | Plaintext `date` column        | Yes (needed for timeline filtering) |
| Your vault password     | Never transmitted              | Never                               |
| Recovery code           | Never stored                   | Never                               |

**What ciphertext looks like in the database:**

```
acc_id:       9f3a2c-...
enc_name:     "xK9m2p8cR7wQ4nX1jZ8vY5cD6fE0hTaB"
enc_balance:  "zR7wQ4nX1jZ8vY5cD6fE0hTaB3kL9mP"
enc_currency: "pN5vY8kM3hxK9m2p8cR7wQ4n"
```

To an attacker who breaches the database, this is indistinguishable from
random noise.

---

## Shipped vs. planned

### ✅ Shipped

- AES-256-GCM encryption for all financial fields
- PBKDF2-SHA256 at 600,000 iterations with per-user random salt
- Separate HMAC-SHA-256 blind indexes for merchant + category search
- Recovery code (12-word BIP-39 style) with MEK wrapping
- Row-level security: every Supabase table enforces `user_id = auth.uid()`
- Isolated `hmac_salt` from `kdf_salt` — search key never overlaps encrypt key

### 🔜 Planned

- **Argon2id upgrade** — port from OrangeRails (10,000× harder to brute-
  force at equivalent wall-clock cost). Opt-in migration, no data loss.
- **zxcvbn password strength meter** + EFF passphrase generator at setup
- **Post-quantum key wrapping** (hybrid X25519 + ML-KEM-768 + ML-DSA-65)
  for long-lived data protection against future quantum computers

### 🗓 Future (Household milestone)

- Multi-member household vault with role-scoped key wrapping — each member
  has their own KEM keypair; shared data keys are wrapped per recipient
- Hardware key (FIDO2/WebAuthn) as second factor for vault unlock

---

## How contributors can help

**1. Argon2id migration**
OrangeRails has a complete Argon2id implementation in `src/lib/vault.ts`,
plus a migration orchestrator in `src/lib/vault-migration.ts`. Port both
to Orange Way's vault setup and create the Supabase RPC for atomic re-key.
This is the highest-value contribution.

**2. Extended blind index coverage**
Currently only merchant + category fields have HMAC blind indexes. Goal
names and institution names would also benefit from searchability without
exposing plaintext. Implementation: same HKDF subkey derivation with a
distinct label per field (`bbp-hmac-goals-v1`, etc.).

**3. Recovery code UX audit**
The recovery flow is security-critical and high-anxiety. Review:

- Is the 12-word display copy-safe (no autocomplete, no clipboard snoop)?
- Is the "I've saved this" confirmation meaningful or rubber-stampable?
- What happens if a user loses both password and recovery code?

**4. Connector credential rotation**
SimpleFIN and xpub connectors store credentials in `enc_credentials`
(AES-GCM encrypted). Review the credential rotation flow and ensure:

- Stale credentials are zeroed in memory after disconnect
- Re-connection generates fresh encryption rather than re-encrypting old creds
- Server never sees plaintext credentials even transiently

**5. PQC port from OrangeRails**
Once the Argon2id migration is done, the PQC layer from OrangeRails
(`pqc.ts`, `key-wrapping.ts`, `signatures.ts`, `pqc-lifecycle.ts`) can be
ported directly. The interface contracts are designed to be portable.

---

## Security disclosure

Found a vulnerability? Please do not open a public GitHub issue.
Send details directly to the maintainers. We target 72-hour acknowledgment
and 90-day coordinated disclosure.

# Orange Way — Security Architecture

Orange Way stores only ciphertext. Your financial life — account
names, balances, transactions, categories, budgets, goals — is encrypted in
your browser before it reaches the database. We have no key. We cannot read
your data. Neither can anyone who breaches our servers.

Think of it like a diary with an unbreakable padlock: we store the diary,
but you're the only one who has the key — and the key never leaves your head.

---

## Encryption stack

### Layer 1: Password → Key (Argon2id, with PBKDF2 fallback for legacy vaults)

Your vault password is transformed into a 256-bit Master Encryption Key (MEK)
using **Argon2id**. The client-side implementation is shipped today; see
`src/lib/vault.ts` (`deriveMekArgon2id`, `wrapMekWithPasswordArgon2id`).

Argon2id parameters: 64 MiB memory, 3 iterations, 4 lanes. These meet the
OWASP 2023 recommendation. Memory-hardness shifts the brute-force cost from
"GPU-friendly bit-twiddling" to "GPU-hostile memory bandwidth", which is the
specific class of attack PBKDF2 is weak to.

> **A note on parallelism.** The 4-lane setting is conservative for modern
> 8+ core devices. We could double it to 8 lanes for more parallel work
> against an offline attacker. We have not: bumping `parallelism` changes
> the Argon2id output, so a vault created on a 4-lane client cannot be
> unlocked by an 8-lane client. The right way to raise this is to bump
> `vault_key_version` and ship a re-key migration that derives the new MEK
> under the new parameters and re-wraps every existing ciphertext. Tracked
> as a follow-up next to the PBKDF2 → Argon2id migration RPC.

Legacy vaults created before the Argon2id rollout still derive their MEK with
**PBKDF2-SHA256 at 600,000 iterations**, double the OWASP 2023 minimum. The
vault picks the right strategy based on the `vault_key_version` field stored
next to the vault. Unknown versions fail closed: the client refuses to unlock
rather than silently downgrade to PBKDF2.

The remaining piece is the server-side migration RPC that lets existing
vaults move from PBKDF2 to Argon2id on the next password change. Tracked
as a follow-up.

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

On vault creation, Orange Way generates a **12-word recovery code** drawn
from the EFF Large Wordlist (7,776 words). Twelve words of `log2(7776) ≈
12.9` bits each gives **~155 bits of entropy**, which exceeds BIP-39's
132-bit baseline. This code:

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

**1. Server-side Argon2id migration RPC**
The client-side Argon2id implementation is already shipped in
`src/lib/vault.ts` (see `deriveMekArgon2id`, `wrapMekWithPasswordArgon2id`).
What's still open is the Supabase RPC that lets existing PBKDF2 vaults
re-key atomically: derive the new MEK under Argon2id, re-wrap every
existing ciphertext with the new MEK, and flip `vault_key_version` on
success. The client refuses to silently downgrade, so the RPC is the only
path from a legacy vault to a modern one. Highest-value contribution open
right now.

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

## Known operational gaps

The following items are known weaknesses of the current deploy. They do
not break the zero-knowledge guarantee but they are real gaps that we
plan to close. Pull requests welcome.

**Signup / waitlist rate limiting.** `functions/api/signup.ts` accepts
POSTs without a per-IP or per-account rate limit. An attacker can burn
the email-send quota or pollute the waitlist with junk. The recommended
mitigation is a Cloudflare Rate Limiting Rule (5 req/min/IP at the page
level) or a per-IP counter in Cloudflare KV that the function checks
before forwarding to the email vendor. hCaptcha is already wired but is
not a full substitute on a high-volume target.

**Argon2id parallelism.** Fixed at 4 lanes (see the Layer 1 callout
above). Modern devices can comfortably handle 8; raising it requires a
new vault key version and a re-key migration so existing vaults stay
unlockable. Tracked alongside the PBKDF2 → Argon2id migration RPC.

**Five build-time-only npm advisories.** `vite` (Windows UNC path on the
dev server), `dompurify` `IN_PLACE` mode (unused in `src/`), and three
build-tool DoS / file-read advisories. None are reachable from user
input at runtime. Tracked for the next deps-bump PR.

## Supported versions

Orange Way Me is pre-1.0. Security reports are reviewed against `main`
(the public open-source baseline) regardless of which version surfaced
the issue. Once 1.0 ships, security patches will be backported to the
most recent minor release; older releases will not receive patches.

## Security disclosure

Found a vulnerability? Please do not open a public GitHub issue.
Send details directly to the maintainers. We target 72-hour acknowledgment
and 90-day coordinated disclosure.

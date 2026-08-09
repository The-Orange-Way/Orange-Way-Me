# Orange Way — Security Architecture

Orange Way stores only ciphertext. Your financial life — account
names, balances, transactions, categories, budgets, goals — is encrypted in
your browser before it reaches the database. We have no key. We cannot read
your data. Neither can anyone who breaches our servers.

Think of it like a diary with an unbreakable padlock: we store the diary,
but you're the only one who has the key — and the key never leaves your head.

---

## Encryption stack

### Layer 1: Password → Key (Argon2id)

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
> as a follow-up.

Every live vault uses Argon2id. The strategy registry
(`KEY_DERIVATION_STRATEGIES` in `src/lib/vault.ts`) carries a single entry,
v=1, mapping to the parameters above: the public-launch wipe removed every
vault created before the Argon2id rollout, so no production vault derives
its key with anything weaker. The vault picks its strategy from the
`vault_key_version` field, and unknown versions fail closed: the client
refuses to unlock rather than silently downgrade. (PBKDF2-SHA256 at 600,000
iterations remains in the codebase for recovery-code key derivation and the
pre-wipe vault format; no live vault uses it for password unlock.)

**Crack-time estimates, computed at PBKDF2-600k on a single RTX 4090.
Argon2id is strictly harder to attack, so read these as conservative
lower bounds:**

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

One honest exception on the way in: bank-synced transactions arrive through
Quiltt (the bank feed) and the OrangeRails connector, which briefly handles
them in the clear to seal each transaction to a key only you hold. Supabase
still only ever stores the sealed version; the table above describes what
lands at rest. The full data path is on the
[security page](https://orangeway.app/security).

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
- Argon2id key derivation (64 MiB memory, 3 iterations, 4 lanes): see
  `deriveMekArgon2id` in `src/lib/vault.ts`. Every live vault uses it; the
  public-launch wipe removed all pre-Argon2id vaults (see Layer 1 above)
- Separate HMAC-SHA-256 blind indexes for merchant + category search
- Recovery code (12-word BIP-39 style) with MEK wrapping
- Row-level security: every Supabase table enforces `user_id = auth.uid()`
- Isolated `hmac_salt` from `kdf_salt` — search key never overlaps encrypt key
- **Post-quantum key wrapping**: hybrid X25519 + ML-KEM-768 (FIPS 203) for
  long-lived household keys, so today's recorded ciphertext resists future
  quantum decryption (see `src/lib/pqc.ts`)

### 🔜 Planned

- **ML-DSA-65 per-mutation signing** (FIPS 204): implemented client-side
  behind a feature flag; ships publicly once the server-side verifier lands
- **zxcvbn password strength meter** + EFF passphrase generator at setup
- **Vault re-key migration** so a future Argon2id parameter bump (or a new
  memory-hard KDF) can roll out by bumping `vault_key_version` and
  re-wrapping existing ciphertext

### 🗓 Future (Household milestone)

- Multi-member household vault with role-scoped key wrapping — each member
  has their own KEM keypair; shared data keys are wrapped per recipient
- Hardware key (FIDO2/WebAuthn) as second factor for vault unlock

---

## How contributors can help

**1. Vault re-key migration**
Every live vault is Argon2id already (the launch wipe removed the PBKDF2
generation), but the strategy registry is designed for parameter evolution:
a future bump (say 4 lanes to 8, or a new memory-hard KDF) needs an atomic
re-key path that derives the new MEK under the new parameters, re-wraps
every existing ciphertext, and flips `vault_key_version` on success. The
client refuses to silently downgrade, so this migration is the only way to
move a vault between versions. Design it once, and every future KDF
improvement ships on top of it. Highest-value contribution open right now.

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

**5. ML-DSA-65 server-side verifier**
The PQC key-wrapping layer is shipped (`src/lib/pqc.ts`,
`src/lib/key-wrapping.ts`; hybrid X25519 + ML-KEM-768). What remains is the
signing half: client-side ML-DSA-65 per-mutation signing exists behind a
feature flag, and it ships publicly once a real server-side verifier
replaces the placeholder (see `src/lib/feature-flags.ts` for the honest
status). Building that verifier is the open contribution.

---

## Known operational gaps

The following items are known weaknesses of the current deploy. None of
them lets the server read your encrypted data at rest, but they are real
gaps that we plan to close. Pull requests welcome.

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
unlockable. Tracked as contribution idea #1 above.

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

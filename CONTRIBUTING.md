# Contributing to Orange Way

Thank you for helping. This project uses GitHub as a **marketing and trust surface** as well as a code host: strangers should understand **why** a change exists without reading the diff first.

---

## Local setup

Node 22 or newer is required — vitest 4 (our test runner) drops Node 18 and 20 doesn't ship `util.styleText`, so the test suite errors at startup on older runtimes. CI uses Node 24; pin locally via `.nvmrc` if you use nvm/fnm:

```bash
nvm install 22  # one time
nvm use         # reads .nvmrc on every cd
bun install     # install deps
bun test        # full suite, ~5s
```

Validate tests locally before pushing. Pushing untested test assertions is the single biggest source of failure-email noise on this repo. Run `bash scripts/pre-publish-scan.sh` and `bun run test` before every push.

**On a fresh clone, install the git hooks:**

```bash
bash scripts/install-hooks.sh
```

That wires three local git hooks:

- `pre-push`: runs `scripts/pre-push-gate.sh` before every push and refuses if any of the four checks below fail.
- `post-commit`: invalidates the `/pr-this` marker on every new commit (a new commit changed HEAD, so the previous gauntlet no longer covers what you're about to push).
- `post-rewrite`: same invalidation on `git commit --amend`, `git rebase`, etc.

The `pre-push` gate refuses the push if any of these fail:

1. The `/pr-this` skill has not been recorded against the current `HEAD` (marker at `.git/.pr-this-ran` must equal `git rev-parse HEAD`).
2. The pre-publish leak scanner reports anything other than clean.
3. The commits being pushed contain private / internal-only URLs (the gate scans for the founder's wiki hostnames, internal Tailscale hosts, internal email addresses, etc.).
4. `gitleaks` reports a secret-shaped string in the prepared commits.

The marker is written by `scripts/mark-pr-this-ran.sh` as the **last step** of the `/pr-this` skill, so you should never need to write it by hand. If you ever do (true emergency), the script refuses to run on a dirty tree, so the marker can't lie about what was tested.

If a push really must go through (true emergency only), the override is `PR_THIS_BYPASS=1 git push` and the gate emits a loud warning that this happened.

---

## Ground rules

1. **Never commit secrets** — no Supabase service keys, Cloudflare account IDs with embedded tokens, production URLs with credentials. Use placeholders in docs and local `.env` for real values.
2. **Migrations are law** — if you change the database, add a migration. Regenerate TypeScript types if your workflow uses generated Supabase types.
3. **Match existing patterns** — encryption goes through the shared vault + field-level helpers; never add a code path that reads sensitive data server-side.
4. **Zero-knowledge check every PR** — if your change could let the server read new content, call it out explicitly in the PR body and link to the architectural decision.

---

## How to write commits and PRs on this repo

When you ship code, your commit message and your PR description are the only record the next person (human or agent) has of why this change exists. Write them for that future reader, not for yourself.

### The one rule

**Explain WHY, not WHAT.**

Git already shows the diff — the reader can see what changed. What they cannot see is:

- what problem you were solving
- what you tried that did not work
- what you deliberately did **not** do, and why
- what future work this unblocks or leaves open
- what risks or trade-offs you accepted

Your job is to write down exactly that.

### Commit message format

```text
<type>(<scope>): <imperative one-line summary, <=72 chars>

<1-3 sentence paragraph: what problem this solves, stated so a
non-engineer could understand it.>

<optional: what you considered and rejected, one line each.>

<optional: anything the next contributor must know — follow-ups,
known limitations, pre-existing bugs you fixed incidentally to
unblock this work. Label the last one "Incidental fix:" so it's
easy to spot.>
```

- **`<type>`** is one of: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- **`<scope>`** is the area touched, e.g. `vault`, `transactions`, `dashboard`, `supabase`, `docs`

**Good example:**

```text
feat(vault): rotate MEK on password change without re-encrypt

Lets users change their vault password without re-encrypting every
row. We wrap the MEK with a new password-derived KEK and store the
wrapped MEK; the underlying row ciphertext is untouched. Keeps
password rotation O(1) instead of O(rows).

Chose wrap-and-replace over re-encrypt-all because household users
will have thousands of transactions by year 2.

Follow-up: background re-wrap when KDF iteration count is upgraded.
```

**Bad example (do not do this):**

```text
feat: update vault

Changed the vault code.
```

### PR description format

Use this shape **exactly**. One screen, not five.

```text
## Summary
One sentence: what this PR does, in plain language.

## Why
2-4 bullets: the problem and why it matters now.

## What changed
Reader's-digest grouped by file/area. Not a diff.

## What I considered and rejected
1-3 bullets, each: the alternative and why you didn't pick it.

## Risks and trade-offs
Be honest. "No risks" is almost never true.

## How to verify
The exact commands or manual steps.

## Out of scope
What you deliberately did not touch.
```

### Hard rules

- Never write **"update code"** or **"fix stuff"** as a summary.
- Never leave the **body empty** on a non-trivial commit.
- Never claim **"no risks"** or **"trivial change"** unless the diff is literally a typo or a comment.
- If you incidentally fixed a pre-existing bug, call it out under **`Incidental fix:`** in the commit body. Do not bury it in the diff.

### Test yourself before pushing

Read your own commit message and ask:

> If I had just joined this project and opened this commit six months from now, would I understand why this code exists and whether it is safe to change?

If the answer is no, rewrite it.

---

## Questions?

Open a discussion or issue. For security-sensitive reports, see `SECURITY.md`.

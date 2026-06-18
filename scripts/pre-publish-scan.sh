#!/usr/bin/env bash
# pre-publish-scan.sh — leak check for the open-source Orange Way repo.
#
# Runs a categorized grep over the source tree looking for content that
# should never ship to a public repo: legacy brand names, internal
# codenames, personal names, infrastructure hostnames, internal wiki
# URLs, milestone tags from prior internal audits, dead PR refs, and
# personally identifiable email addresses.
#
# Exit code:
#   0  — tree is clean, safe to publish or merge
#   1  — one or more categories reported a leak; review output, clean up,
#        re-run
#
# Run locally before pushing:   bash scripts/pre-publish-scan.sh
# Runs in CI as a required check (see .github/workflows/leak-check.yml).
#
# Updating the allowlist: if you introduce a brand or product reference
# that is intentional and acceptable (for example a new sibling project),
# add it to the ACCEPTABLE_PROJECTS list below AND to the leak-check
# workflow in lock-step. PRs that change this script require a second
# reviewer.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ----------------------------------------------------------------------
# Path scope
# ----------------------------------------------------------------------

EXCLUDE_DIRS=(
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=coverage
  --exclude-dir=.git
  --exclude-dir=test-results
  --exclude-dir=playwright-report
  --exclude-dir=.husky
)

# Lock files + binary assets: skip wholesale.
EXCLUDE_FILES=(
  --exclude=bun.lock
  --exclude=bun.lockb
  --exclude=package-lock.json
  --exclude=yarn.lock
  --exclude="*.png"
  --exclude="*.jpg"
  --exclude="*.jpeg"
  --exclude="*.webp"
  --exclude="*.gif"
  --exclude="*.ico"
  --exclude="*.woff"
  --exclude="*.woff2"
  --exclude="*.ttf"
  --exclude="*.eot"
)

# ----------------------------------------------------------------------
# Load-bearing exemptions
# ----------------------------------------------------------------------
#
# These files legitimately contain otherwise-forbidden tokens because the
# strings are part of an at-rest data format (vault verifier plaintext,
# Argon2id salt context, localStorage key namespace) or a wordlist that
# happens to contain substrings of forbidden tokens.
#
# When the per-category scan finds matches, results are filtered against
# these patterns so the matches are dropped without raising the exit code.

EXEMPT_GENERIC=(
  # EFF Diceware wordlist contains words like "calamari", "escalate",
  # "unlovable", "callouts" that substring-match [reserved-brand] / [reserved-brand] / etc.
  "src/assets/eff-wordlist.json"
  # This script and the PR template document the forbidden patterns
  # as examples; they intentionally contain the strings they scan for.
  "scripts/pre-publish-scan.sh"
  ".github/PULL_REQUEST_TEMPLATE.md"
  ".github/workflows/leak-check.yml"
  "CONTRIBUTING.md"
)

EXEMPT_BITBOOKS_LITERAL=(
  # Vault verifier plaintext + KDF salt contexts. Renaming corrupts every
  # existing user vault — handled by a versioned migration PR, not a
  # textual sweep.
  "src/lib/vault.ts"
  # localStorage key namespaces. Recoverable, but the migration is a
  # separate scheduled PR.
  "src/components/dashboard/CurrencySetupBanner.tsx"
  "src/components/dashboard/DashboardPage.tsx"
  "src/hooks/useDashboardPrefs.ts"
  "src/hooks/useDemoSeed.ts"
)

EXEMPT_OWM_FUNCTION_URLS=(
  # owm-or-* are deployed Supabase Edge Function URL slugs. Renaming
  # requires a coordinated client + function deploy and is scheduled
  # separately. References inside the codebase point at these slugs.
  "supabase/functions/owm-or-discover-quiltt"
  "supabase/functions/owm-or-quick-connect"
  "src/lib/or/bank-connect.ts"
  "src/lib/friendly-error.ts"
  "src/components/connections/AddBankDialog.tsx"
)

# Tailwind utility classes mb-N (margin-bottom) word-boundary-match MB.
# Same for ml-N, mt-N etc. We filter those out below.

EXIT_CODE=0

# ----------------------------------------------------------------------
# scan: run one categorized grep + exemption filter
# ----------------------------------------------------------------------
#
# Args:
#   $1  human-readable category name (printed in output)
#   $2  grep pattern (extended regex)
#   $3  grep flags (e.g. -i for case-insensitive). Empty string for none.
#   $4  extra-exemption pattern (extended regex). Empty string for none.

scan() {
  local name="$1"
  local pattern="$2"
  local flags="$3"
  local extra_exempt="$4"

  local raw
  if [[ -n "$flags" ]]; then
    raw=$(grep -rnE $flags "$pattern" . \
            "${EXCLUDE_DIRS[@]}" "${EXCLUDE_FILES[@]}" 2>/dev/null || true)
  else
    raw=$(grep -rnE "$pattern" . \
            "${EXCLUDE_DIRS[@]}" "${EXCLUDE_FILES[@]}" 2>/dev/null || true)
  fi

  if [[ -z "$raw" ]]; then
    printf "  \033[32m✓\033[0m  %s\n" "$name"
    return 0
  fi

  # Always-drop exemptions
  local drop_patterns=""
  for e in "${EXEMPT_GENERIC[@]}"; do
    drop_patterns+="${drop_patterns:+|}$(printf '%s' "$e" | sed 's/[.[\]*]/\\&/g')"
  done
  if [[ -n "$extra_exempt" ]]; then
    drop_patterns+="${drop_patterns:+|}$extra_exempt"
  fi

  local filtered
  if [[ -n "$drop_patterns" ]]; then
    filtered=$(printf '%s\n' "$raw" | grep -Ev "$drop_patterns" || true)
  else
    filtered="$raw"
  fi

  if [[ -z "$filtered" ]]; then
    printf "  \033[32m✓\033[0m  %s\n" "$name"
    return 0
  fi

  local count
  count=$(printf '%s\n' "$filtered" | wc -l)
  printf "  \033[31m✗\033[0m  %s (%d findings)\n" "$name" "$count"
  printf '%s\n' "$filtered" | sed 's/^/      /' | head -30
  if [[ "$count" -gt 30 ]]; then
    printf "      ... %d more\n" "$((count - 30))"
  fi
  EXIT_CODE=1
}

# ----------------------------------------------------------------------
# Build per-category exemption regexes
# ----------------------------------------------------------------------

# Join an array of file paths with | for grep -v use
join_pipe() {
  local IFS="|"
  printf '%s' "$*"
}

EXEMPT_BB_RE="$(join_pipe "${EXEMPT_BITBOOKS_LITERAL[@]}")"
EXEMPT_OWM_RE="$(join_pipe "${EXEMPT_OWM_FUNCTION_URLS[@]}")"

# ----------------------------------------------------------------------
# Header
# ----------------------------------------------------------------------

printf "\n\033[1m▎ Pre-publish leak scan\033[0m\n"
printf "  repo: %s\n\n" "$REPO_ROOT"

# ----------------------------------------------------------------------
# Category 1 — Legacy brand / private codebase references
# ----------------------------------------------------------------------

printf "\033[1m1. Brand + product references\033[0m\n"

scan "[reserved-brand] brand (all variants)" \
     "\\b([reserved-brand]|[reserved-brand])\\b|\\bbitbooks\\b" \
     "" \
     "$EXEMPT_BB_RE"

scan "[reserved-brand] / [reserved-brand] ledger brand" \
     "\\b([reserved-brand]|[reserved-brand]|[reserved-brand])\\b" \
     "" \
     ""

scan "[reserved-brand] builder platform" \
     "\\bLovable\\b|lovable\\.app" \
     "" \
     ""

scan "Standalone V2/V3 product references" \
     "V[23] [reserved-brand]|[reserved-brand]|[reserved-brand]|[reserved-brand]|[reserved-brand]|[reserved-brand]" \
     "" \
     ""

scan "Internal codename: MB / OWM as acronym" \
     "\\(MB\\)|MB —| in MB\\b|MB's|\\bOWM\\b" \
     "" \
     "$EXEMPT_OWM_RE"

scan "Other personal-project brands" \
     "\\b([reserved-term]|[reserved-term]|[reserved-term]|[reserved-term])\\b|[reserved-term]|[reserved-term]" \
     "" \
     ""

# ----------------------------------------------------------------------
# Category 2 — Personal names + PII
# ----------------------------------------------------------------------

printf "\n\033[1m2. Personal names + PII\033[0m\n"

# Allow "Tim May" in README (cypherpunk historical figure) — exempt that.
scan "Personal first names" \
     "\\b([name]|[name]|[name]|[name]|[name]|[name]|[name])\\b" \
     "" \
     ""

scan "External contact names" \
     "[name]|[name]" \
     "" \
     ""

scan "Personal-domain emails" \
     "@(bitbooks\\.com|abascal\\.ca|tryfaster\\.ca)" \
     "" \
     ""

# ----------------------------------------------------------------------
# Category 3 — Internal infrastructure leaks
# ----------------------------------------------------------------------

printf "\n\033[1m3. Internal infrastructure\033[0m\n"

scan "Internal hostnames" \
     "\\b([reserved-host]|[reserved-term]|[reserved-host])\\b|[reserved-host]|ubuntu@100\\." \
     "" \
     ""

scan "Internal wiki URLs" \
     "wiki\\.(abascal\\.ca|bitbooks\\.com)" \
     "" \
     ""

scan "Windows-style internal paths" \
     "C:\\\\CLAUDE|C:\\\\Users\\\\micro" \
     "" \
     ""

scan "Home-path leaks" \
     "/home/(kiwi|cactus|claude)/" \
     "" \
     ""

# ----------------------------------------------------------------------
# Category 4 — Internal milestone tags + dead PR references
# ----------------------------------------------------------------------

printf "\n\033[1m4. Internal milestone tags + dead PR refs\033[0m\n"

# D-number milestone tags. Match the specific milestone form
# ("D12:" / "D12)" / "(D12)" / "D12 —" / "D12 .") to avoid false-positives
# on UUID fragments and generic identifiers.
scan "D-number milestone tags" \
     "\\bD[0-9]{1,3}[:)] |\\(D[0-9]{1,3}\\)|\\bD[0-9]{1,3} —" \
     "" \
     ""

scan "SEC-N audit tags" \
     "\\bSEC-[0-9]+\\b|#SEC-[0-9]+" \
     "" \
     ""

scan "CQ-N code-quality tags" \
     "\\bCQ-[0-9]+\\b|#CQ-[0-9]+" \
     "" \
     ""

scan "DB-N database-audit tags" \
     "\\bDB-[0-9]+\\b|#DB-[0-9]+" \
     "" \
     ""

scan "PERF-N performance-audit tags" \
     "\\bPERF-[0-9]+\\b|#PERF-[0-9]+" \
     "" \
     ""

scan "Dead PR references" \
     "PR #[0-9]+|V[23] PR\\b|OR PR #" \
     "" \
     ""

# ----------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------

printf "\n"
if [[ "$EXIT_CODE" -eq 0 ]]; then
  printf "\033[32m▎ Tree is clean. Safe to publish or merge.\033[0m\n\n"
else
  printf "\033[31m▎ Leaks found. Clean up the items above before publishing.\033[0m\n"
  printf "  See \033[1mCONTRIBUTING.md\033[0m for the rules and exemption process.\n\n"
fi

exit "$EXIT_CODE"

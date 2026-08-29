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
  # The gitignored reserved-term list itself (never committed, but grep -r
  # would still read it from the working tree and flag its own contents).
  --exclude=.reserved-terms
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
  # The pre-push gate's private-host regex contains the literal strings
  # it scans for; install-hooks.sh references it.
  "scripts/pre-push-gate.sh"
  "scripts/install-hooks.sh"
  # The post-merge identity scan workflow's PATTERN env var contains the
  # literal strings it scans for; we exempt the file so the leak scan
  # doesn't flag the scanner.
  ".github/workflows/post-merge-identity-scan.yml"
  ".github/PULL_REQUEST_TEMPLATE.md"
  ".github/workflows/leak-check.yml"
  "CONTRIBUTING.md"
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

# ----------------------------------------------------------------------
# Reserved-term list (sourced OUT of this committed file)
# ----------------------------------------------------------------------
#
# The public tree must not carry internal-only naming: earlier project or
# experiment codenames, non-public hostnames, personal names, or private
# contact strings. The list of such reserved terms is NOT hardcoded here,
# because committing the list would publish the very strings it exists to
# keep out of the public tree. It is provided at runtime as a regex
# alternation, from either source, in this order:
#
#   1. The OW_RESERVED_TERMS environment variable (CI sources this from a
#      repository secret: see the leak-check and post-merge identity-scan
#      workflows).
#   2. A gitignored .reserved-terms file (one regex fragment per line;
#      blank lines and #-comments ignored). See .reserved-terms.example.
#
# If neither is configured the reserved-term scan is SKIPPED with a notice
# (the structural checks below still run). Outside contributors therefore
# get a working scanner with zero exposure to the internal list.

# canon_terms: stdin -> one regex alternation on stdout.
# Drops blank lines and #-comment lines, joins the rest with '|', and
# trims any leading/trailing separators. Applied to the env value as well
# as the file, so a comment line inside the secret is IGNORED rather than
# compiled into a live regex fragment that would match literal text, and
# a blank line inside it cannot become an empty alternation branch that
# matches every line in the tree.
#
# Carriage returns are deleted first. A value stored with Windows line
# endings leaves a trailing CR on every fragment, so each branch of the
# alternation would look for "term\r", match nothing anywhere in the
# tree, and report a clean scan against a list that is fully populated.
canon_terms() {
  tr -d '\r' | grep -vE '^[[:space:]]*(#|$)' | paste -sd'|' - | sed -e 's/^|*//' -e 's/|*$//'
}

RESERVED_TERMS=""
if [[ -n "${OW_RESERVED_TERMS:-}" ]]; then
  RESERVED_TERMS="$(printf '%s\n' "$OW_RESERVED_TERMS" | canon_terms)"
fi
if [[ -z "$RESERVED_TERMS" && -f .reserved-terms ]]; then
  RESERVED_TERMS="$(canon_terms < .reserved-terms)"
fi

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

  # Always-drop exemptions.
  #
  # Each entry is anchored to the PATH COLUMN of the grep -rnE output,
  # whose lines are "./path:LINE:text". An unanchored bare filename
  # matches anywhere on the line, including inside the matched text of an
  # unrelated file, which silently drops a real finding in that other
  # file. Anchor as ^\./<path>: so an entry exempts only the file it names.
  local drop_patterns=""
  local e esc
  for e in "${EXEMPT_GENERIC[@]}"; do
    esc=$(printf '%s' "$e" | sed 's/[.[\]*]/\\&/g')
    drop_patterns+="${drop_patterns:+|}^\\./${esc}:"
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

EXEMPT_OWM_RE="$(join_pipe "${EXEMPT_OWM_FUNCTION_URLS[@]}")"

# ----------------------------------------------------------------------
# Header
# ----------------------------------------------------------------------

printf "\n\033[1m▎ Pre-publish leak scan\033[0m\n"
printf "  repo: %s\n\n" "$REPO_ROOT"

# ----------------------------------------------------------------------
# Category 1: Reserved terms (internal list, sourced at runtime)
# ----------------------------------------------------------------------

printf "\033[1m1. Reserved terms\033[0m\n"

# Line-anchored exemptions for tree content that matches ONLY under
# case-insensitive comparison and is not a leak. Each entry anchors to a
# path AND to surrounding prose (^\./path:[0-9]+:.*context), so it exempts
# one line rather than a whole file, and no entry needs to carry the
# matched term itself. Never add an unanchored bare filename here.
EXEMPT_RESERVED_CI="$(join_pipe \
  "^\\./src/lib/vault-envelope\\.ts:[0-9]+:.*straight from the password" \
  "^\\./src/lib/vault\\.ts:[0-9]+:.*is not 32 bytes; refusing to use it" \
  "^\\./supabase/migrations/20260625130000_beta_allowlist\\.sql:[0-9]+:.*seeded with the migration" \
)"

if [[ -n "$RESERVED_TERMS" ]]; then
  # -i: the post-merge identity scan already compares case-insensitively.
  # This gate runs first, so it has to be at least as strict, or a term in
  # another case passes here and is only caught after the merge.
  scan "Reserved terms (internal list)" \
       "$RESERVED_TERMS" \
       "-i" \
       "$EXEMPT_RESERVED_CI"
else
  printf "  \033[33m–\033[0m  Reserved-term scan skipped (set OW_RESERVED_TERMS or add .reserved-terms)\n"
fi

# ----------------------------------------------------------------------
# Category 2: Public-safe structural checks
# ----------------------------------------------------------------------

printf "\n\033[1m2. Structural naming checks\033[0m\n"

scan "Internal codename: MB / OWM as acronym" \
     "\\(MB\\)|MB —| in MB\\b|MB's|\\bOWM\\b" \
     "" \
     "$EXEMPT_OWM_RE"

# ----------------------------------------------------------------------
# Category 3: Internal milestone tags + dead PR refs
# ----------------------------------------------------------------------

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

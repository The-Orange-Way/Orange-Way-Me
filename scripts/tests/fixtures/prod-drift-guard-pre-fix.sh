#!/usr/bin/env bash
# RECONSTRUCTED PRE-FIX VERSION of scripts/prod-drift-guard.sh, for the
# OW-T0272 regression test only. This is not run in production and must
# never be wired into a real workflow.
#
# The only change from the current script is the block that decides
# whether the ahead-compare's "files" field can be trusted: this restores
# the presence check (`has("files")`) that the fix in PR#702 (OW-T0254 /
# OW-C0591) replaced with a type check. A `files: null` response reads
# `has("files")` as true and `null | length` as 0, so a real prod-ahead
# compare silently reported clean. See scripts/prod-drift-guard.sh for the
# fixed logic and its comment explaining the same bug.
#
# The regression test runs this file against a mocked files:null compare
# and asserts it WRONGLY exits zero, proving the test would have caught
# the original bug before the fix landed.

set -euo pipefail

echo "repo: $REPO  base(dev): $BASE_BRANCH  head(prod): $HEAD_BRANCH"

PROOF_RUN=0
if [ "$BASE_BRANCH" != "dev" ] || [ "$HEAD_BRANCH" != "prod" ]; then
  PROOF_RUN=1
  echo "::warning::PROOF RUN: base='${BASE_BRANCH}' head='${HEAD_BRANCH}' is not the standing dev/prod pair. This run exercises the failure path and cannot report green."
fi

{
  echo "### prod-drift-guard (pre-fix reconstruction, test fixture only)"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

for ref in "$BASE_BRANCH" "$HEAD_BRANCH"; do
  if ! sha="$(gh api "repos/${REPO}/git/ref/heads/${ref}" --jq '.object.sha' 2>reserr.log)"; then
    echo "::error::could not resolve branch '${ref}' in ${REPO}. Refusing to report green." >&2
    cat reserr.log >&2
    exit 1
  fi
  echo "resolved ${ref} = ${sha}"
done

fail=0

ahead_json="$(gh api "repos/${REPO}/compare/${BASE_BRANCH}...${HEAD_BRANCH}")"
prod_ahead="$(echo "$ahead_json" | jq -r '.ahead_by')"
if [ "$prod_ahead" = "null" ] || [ -z "$prod_ahead" ]; then
  echo "::error::compare returned no ahead_by; refusing to pass." >&2
  exit 1
fi
echo "prod is ahead of dev by ${prod_ahead} commit(s)"
if [ "$prod_ahead" -gt 0 ]; then
  # PRE-FIX BUG: a presence check, not a type check. files:null passes
  # has("files") and "null | length" silently evaluates to 0, so a real
  # prod-ahead compare with an unreadable files field reads as clean.
  if echo "$ahead_json" | jq -e 'has("files")' >/dev/null; then
    prod_only_files="$(echo "$ahead_json" | jq -r '.files | length')"
  else
    echo "::error::prod is ahead by ${prod_ahead} commit(s) and the compare had no files field at all. Refusing to report green." >&2
    exit 1
  fi
  if [ "$prod_only_files" -gt 0 ]; then
    echo "::error::prod carries ${prod_only_files} file(s) of content that are NOT in dev. prod must never lead dev: back-merge prod into dev." >&2
    fail=1
  else
    echo "::notice::prod is ahead of dev by ${prod_ahead} commit(s) that change no files. No prod-only content, so this is not drift."
  fi
fi

behind_json="$(gh api "repos/${REPO}/compare/${HEAD_BRANCH}...${BASE_BRANCH}")"
unpromoted="$(echo "$behind_json" | jq -r '.ahead_by')"
if [ "$unpromoted" = "null" ] || [ -z "$unpromoted" ]; then
  echo "::error::compare returned no ahead_by for unpromoted count; refusing to pass." >&2
  exit 1
fi
echo "dev has ${unpromoted} unpromoted commit(s) ahead of prod"

if [ "$unpromoted" -gt "$BEHIND_COMMIT_LIMIT" ]; then
  echo "::error::dev is ${unpromoted} commits ahead of prod, over the ${BEHIND_COMMIT_LIMIT}-commit limit. Promote dev to prod." >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "prod-drift-guard (pre-fix fixture): FAIL (see errors above)"
  exit 1
fi
if [ "$PROOF_RUN" -ne 0 ]; then
  echo "prod-drift-guard (pre-fix fixture): PROOF RUN, not a verdict (base=${BASE_BRANCH}, head=${HEAD_BRANCH})"
  exit 1
fi
echo "prod-drift-guard (pre-fix fixture): PASS (prod within limits of dev)"

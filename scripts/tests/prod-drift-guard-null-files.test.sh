#!/usr/bin/env bash
# Regression test for OW-T0254 / PR#702 (OW-C0591, OW-T0272): the compare
# API can return a "files" field that is JSON null, or omit the key
# entirely, on a prod-ahead compare. scripts/prod-drift-guard.sh must
# refuse to report clean in either case rather than reading a null/absent
# files field as an empty one.
#
# What this proves, in order:
#   1. The CURRENT (fixed) script refuses (exits non-zero) on files:null.
#   2. The CURRENT script refuses on an absent files key.
#   3. The CURRENT script still passes a REAL clean array (files: []),
#      so this test cannot be satisfied by a guard that just fails always.
#   4. The RECONSTRUCTED PRE-FIX script (fixtures/prod-drift-guard-pre-fix.sh,
#      which restores the has("files") presence check the fix replaced)
#      WRONGLY exits zero on the same files:null input -- proving this
#      test would have caught the original bug before the fix landed.
#
# Uses a fake `gh` on PATH (fixtures/gh) so no network call or real repo
# is touched. All four assertions must hold for this test to pass.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
FIXED_SCRIPT="${REPO_ROOT}/scripts/prod-drift-guard.sh"
PREFIX_SCRIPT="${HERE}/fixtures/prod-drift-guard-pre-fix.sh"
FAKE_GH="${HERE}/fixtures/gh"

chmod +x "${FAKE_GH}"

pass=0
fail=0

run_case() {
  local desc="$1" script="$2" mode="$3" expect="$4"
  local rc=0
  local log
  log="$(mktemp)"
  PATH="$(dirname "${FAKE_GH}"):${PATH}" \
    BASE_BRANCH=dev HEAD_BRANCH=prod BEHIND_COMMIT_LIMIT=50 BEHIND_HOURS_LIMIT=72 \
    GH_TOKEN=fake-token REPO=test-org/test-repo FIXTURE_MODE="${mode}" \
    bash "${script}" > "${log}" 2>&1 || rc=$?

  if { [ "$expect" = "nonzero" ] && [ "$rc" -ne 0 ]; } || { [ "$expect" = "zero" ] && [ "$rc" -eq 0 ]; }; then
    echo "PASS: ${desc} (exit ${rc})"
    pass=$((pass + 1))
  else
    echo "FAIL: ${desc} (exit ${rc}, expected ${expect})"
    echo "--- script output ---"
    cat "${log}"
    echo "--- end script output ---"
    fail=$((fail + 1))
  fi
  rm -f "${log}"
}

run_case "fixed script refuses files:null on prod-ahead compare" \
  "${FIXED_SCRIPT}" null-files nonzero

run_case "fixed script refuses an absent files key on prod-ahead compare" \
  "${FIXED_SCRIPT}" missing-files nonzero

run_case "fixed script still passes a real clean array (files: [])" \
  "${FIXED_SCRIPT}" clean-array zero

run_case "pre-fix script WRONGLY passes files:null (proves this test catches the original bug)" \
  "${PREFIX_SCRIPT}" null-files zero

echo ""
echo "${pass} passed, ${fail} failed"
if [ "${fail}" -ne 0 ]; then
  exit 1
fi

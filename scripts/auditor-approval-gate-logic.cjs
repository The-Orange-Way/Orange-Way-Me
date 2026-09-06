"use strict";

// Decides whether a PR carries a qualifying approval from the Auditor
// identity. Kept as a pure function with no GitHub API calls so it can
// be unit tested with captured review payloads, and required directly
// from the CI workflow that acts on the result.
//
// Only the LATEST review per reviewer counts (same semantics GitHub's
// own merge gate uses): a later CHANGES_REQUESTED or a dismissal
// supersedes an earlier APPROVED from the same person. `reviews` must
// be in the order the GitHub API returns them (oldest first).
function evaluateAuditorApproval(reviews, prAuthorLogin, auditorLogin) {
  const latestByUser = new Map();
  for (const r of reviews || []) {
    if (!r || !r.user) continue;
    latestByUser.set(r.user.id, r);
  }

  let reason = "no approving review found";

  for (const r of latestByUser.values()) {
    if (r.state !== "APPROVED") continue;
    const u = r.user;

    if (u.login === prAuthorLogin) {
      reason = `rejected: ${u.login} is the PR author`;
      continue;
    }
    if (u.type === "Bot" || u.login === "github-actions[bot]") {
      reason = `rejected: ${u.login} is a Bot/App actor`;
      continue;
    }
    if (u.login !== auditorLogin) {
      reason = `rejected: ${u.login} is not the Auditor identity (${auditorLogin})`;
      continue;
    }

    return { approved: true, reason: `approved by ${u.login}` };
  }

  return { approved: false, reason };
}

module.exports = { evaluateAuditorApproval };

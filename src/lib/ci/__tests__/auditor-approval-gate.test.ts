import { describe, it, expect } from "vitest";
// Plain CommonJS module, shared with the GitHub Actions workflow via require();
// see scripts/auditor-approval-gate-logic.d.cts for the type declaration.
import { evaluateAuditorApproval } from "../../../../scripts/auditor-approval-gate-logic.cjs";

const AUDITOR = "Making-the-World-Orange";
const BUILDER = "the-Orange-Juicer";
const HEAD_SHA = "c3ff6bbe0000000000000000000000000000000a";
const OLD_SHA = "1037e85c157e00000000000000000000000000ff";

describe("evaluateAuditorApproval", () => {
  it("fails when there are zero reviews, so the check can fail and not just pass", () => {
    const result = evaluateAuditorApproval([], BUILDER, AUDITOR);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("no approving review");
  });

  it("rejects an APPROVED review authored by github-actions[bot]", () => {
    const reviews = [
      { state: "APPROVED", user: { id: 1, login: "github-actions[bot]", type: "Bot" } },
    ];
    const result = evaluateAuditorApproval(reviews, BUILDER, AUDITOR);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Bot/App actor");
  });

  it("rejects an APPROVED review from any user of type Bot, regardless of login", () => {
    const reviews = [{ state: "APPROVED", user: { id: 2, login: "some-app[bot]", type: "Bot" } }];
    const result = evaluateAuditorApproval(reviews, BUILDER, AUDITOR);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Bot/App actor");
  });

  it("rejects a self-approval from the PR author even if the login matches the Auditor identity", () => {
    const reviews = [{ state: "APPROVED", user: { id: 3, login: AUDITOR, type: "User" } }];
    const result = evaluateAuditorApproval(reviews, AUDITOR, AUDITOR);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("is the PR author");
  });

  it("rejects an APPROVED review from a human who is not the Auditor identity", () => {
    const reviews = [{ state: "APPROVED", user: { id: 4, login: "some-other-dev", type: "User" } }];
    const result = evaluateAuditorApproval(reviews, BUILDER, AUDITOR);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("not the Auditor identity");
  });

  it("approves when the Auditor identity has an APPROVED review and is not the author", () => {
    const reviews = [{ state: "APPROVED", user: { id: 5, login: AUDITOR, type: "User" } }];
    const result = evaluateAuditorApproval(reviews, BUILDER, AUDITOR);
    expect(result.approved).toBe(true);
  });

  it("uses only the latest review per reviewer: a later CHANGES_REQUESTED supersedes an earlier APPROVED", () => {
    const reviews = [
      { state: "APPROVED", user: { id: 6, login: AUDITOR, type: "User" } },
      { state: "CHANGES_REQUESTED", user: { id: 6, login: AUDITOR, type: "User" } },
    ];
    const result = evaluateAuditorApproval(reviews, BUILDER, AUDITOR);
    expect(result.approved).toBe(false);
  });

  it("rejects a stale Auditor approval filed against a commit that is no longer the PR's head", () => {
    const reviews = [
      { state: "APPROVED", user: { id: 7, login: AUDITOR, type: "User" }, commit_id: OLD_SHA },
    ];
    const result = evaluateAuditorApproval(reviews, BUILDER, AUDITOR, HEAD_SHA);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("stale approval");
  });

  it("approves when the Auditor's review commit_id matches the PR's current head sha", () => {
    const reviews = [
      { state: "APPROVED", user: { id: 8, login: AUDITOR, type: "User" }, commit_id: HEAD_SHA },
    ];
    const result = evaluateAuditorApproval(reviews, BUILDER, AUDITOR, HEAD_SHA);
    expect(result.approved).toBe(true);
  });
});

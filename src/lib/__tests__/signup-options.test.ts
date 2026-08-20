/**
 * @vitest-environment node
 *
 * Pins the signUp metadata contract against the Before-User-Created auth
 * hook.
 *
 * Why this file exists: the hook reads the invite code from
 * `event.user.user_metadata.invite_code`. The /join route had a valid code
 * and never put it there, so the hook rejected every invite-code signup with
 * 403 "You need an invite to create an account" while looking, from the
 * database side, entirely correct. Verified against the deployed function on
 * the dev project, 2026-08-19: the same payload with the key absent returns
 * the 403 object and with the key present returns {} and consumes one use.
 *
 * These tests fail if anyone drops `data.invite_code` again.
 */

import { describe, it, expect } from "vitest";
import { buildSignUpOptions } from "@/lib/signup-options";

describe("buildSignUpOptions", () => {
  it("puts the invite code where the auth hook reads it", () => {
    const out = buildSignUpOptions({
      emailRedirectTo: "https://example.test/",
      captchaToken: null,
      inviteCode: "SOME-CODE",
    });
    expect(out.data).toEqual({ invite_code: "SOME-CODE" });
  });

  it("omits data entirely when there is no code, so the allowlist branch runs", () => {
    const out = buildSignUpOptions({
      emailRedirectTo: "https://example.test/",
      captchaToken: null,
    });
    expect(out).not.toHaveProperty("data");
  });

  it("treats an empty-string code as no code", () => {
    const out = buildSignUpOptions({
      emailRedirectTo: "https://example.test/",
      captchaToken: null,
      inviteCode: "",
    });
    expect(out).not.toHaveProperty("data");
  });

  it("omits captchaToken when null rather than sending null", () => {
    const out = buildSignUpOptions({
      emailRedirectTo: "https://example.test/",
      captchaToken: null,
    });
    expect(out).not.toHaveProperty("captchaToken");
  });

  it("carries the captcha token and the invite code together", () => {
    const out = buildSignUpOptions({
      emailRedirectTo: "https://example.test/",
      captchaToken: "tok",
      inviteCode: "SOME-CODE",
    });
    expect(out.captchaToken).toBe("tok");
    expect(out.data).toEqual({ invite_code: "SOME-CODE" });
    expect(out.emailRedirectTo).toBe("https://example.test/");
  });
});

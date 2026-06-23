/**
 * Signup schema + submit pipeline contract tests.
 *
 * Targets the isomorphic `signup-schema.ts` module that both the
 * React hook (`useSignupForm`) and the Cloudflare Pages function at
 * `functions/api/signup.ts` import. Keeping these tests on the pure
 * core means we exercise the validation + network pipeline without
 * pulling @testing-library/react into the dev tree.
 *
 * Load-bearing surfaces tested here:
 *   - schema accepts pasted emails with stray whitespace (trim-before-
 *     validate via .pipe()), rejects malformed input with a custom
 *     error message
 *   - postSignup posts {form, email[, kids]} to /api/signup with the
 *     right content-type
 *   - returns {ok: true} on 2xx, {ok: false, err: "..."} on non-2xx,
 *     {ok: false, err: "Network..."} on fetch throw
 *   - kids field present only when the caller passes it
 */

import { describe, expect, it, vi } from "vitest";
import { buildSignupEmailSchema, postSignup, redactEmails } from "../signup-schema";

function okResponse(): Response {
  return new Response("{}", { status: 200 });
}

function errResponse(status = 500): Response {
  return new Response("{}", { status });
}

describe("buildSignupEmailSchema", () => {
  it("rejects empty email with the default error message", () => {
    const r = buildSignupEmailSchema().safeParse({ email: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("That doesn't look like an email");
    }
  });

  it("rejects malformed email with a custom error message", () => {
    const r = buildSignupEmailSchema("Bad email!").safeParse({ email: "notanemail" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("Bad email!");
    }
  });

  it("accepts pasted email with leading/trailing whitespace and trims it", () => {
    const r = buildSignupEmailSchema().safeParse({ email: "  foo@bar.com\t" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("foo@bar.com");
    }
  });
});

describe("postSignup — POST shape", () => {
  it("posts {form, email} only when kids is omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse());
    const r = await postSignup({ form: "book", email: "foo@bar.com", fetchImpl: fetchMock });
    expect(r).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/signup");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ form: "book", email: "foo@bar.com" });
  });

  it("includes kids when caller passes it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse());
    await postSignup({
      form: "book",
      email: "foo@bar.com",
      kids: "bigger",
      fetchImpl: fetchMock,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      form: "book",
      email: "foo@bar.com",
      kids: "bigger",
    });
  });

  it("posts form: waitlist when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse());
    await postSignup({ form: "waitlist", email: "foo@bar.com", fetchImpl: fetchMock });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).form).toBe("waitlist");
  });

  it("posts the trimmed email value, not the padded input", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse());
    await postSignup({ form: "book", email: "  foo@bar.com  ", fetchImpl: fetchMock });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).email).toBe("foo@bar.com");
  });
});

describe("postSignup — result shape", () => {
  it("returns {ok: true} on 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse());
    const r = await postSignup({ form: "book", email: "foo@bar.com", fetchImpl: fetchMock });
    expect(r).toEqual({ ok: true });
  });

  it("returns generic err on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(errResponse(502));
    const r = await postSignup({ form: "book", email: "foo@bar.com", fetchImpl: fetchMock });
    expect(r).toEqual({ ok: false, err: "Something went wrong. Try again in a minute." });
  });

  it("returns Network error on fetch throw", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const r = await postSignup({ form: "book", email: "foo@bar.com", fetchImpl: fetchMock });
    expect(r).toEqual({ ok: false, err: "Network error. Try again in a minute." });
  });

  it("returns validation err with no fetch call when input is malformed", async () => {
    const fetchMock = vi.fn();
    const r = await postSignup({ form: "book", email: "notanemail", fetchImpl: fetchMock });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.err).toBe("That doesn't look like an email");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("redactEmails", () => {
  it("replaces a bare email with the redaction marker", () => {
    expect(redactEmails("contact alice@example.com today")).toBe("contact <redacted-email> today");
  });

  it("redacts every email in a multi-email string", () => {
    expect(redactEmails("a@x.io and b@y.co")).toBe("<redacted-email> and <redacted-email>");
  });

  it("redacts emails that appear inside upstream JSON messages", () => {
    const upstream = '{"name":"validation_error","message":"Invalid `to`: user+tag@x.co"}';
    const out = redactEmails(upstream);
    expect(out).not.toContain("user+tag@x.co");
    expect(out).toContain("<redacted-email>");
  });

  it("handles dots, pluses, dashes, percent signs in the local part", () => {
    expect(redactEmails("first.last+filter%env-2@sub.domain.example")).toBe("<redacted-email>");
  });

  it("leaves strings without an email shape untouched", () => {
    expect(redactEmails("no email here, only @handles and prices like $5")).toBe(
      "no email here, only @handles and prices like $5",
    );
  });

  it("redacts IDN / Unicode-domain emails via the backstop pass", () => {
    const out = redactEmails("contact user@münchen.de about it");
    expect(out).not.toContain("münchen");
    expect(out).toContain("<redacted-email>");
  });

  it("redacts exotic unquoted local-parts via the backstop pass", () => {
    const out = redactEmails("ref 日本@example.jp here");
    expect(out).not.toContain("日本");
    expect(out).toContain("<redacted-email>");
  });
});

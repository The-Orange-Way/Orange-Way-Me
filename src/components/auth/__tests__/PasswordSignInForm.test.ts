/**
 * PasswordSignInForm wiring (OWM-T0035, DEC-0295 rule 4), read as source.
 *
 * WHY A SOURCE TEST AND NOT A RENDER TEST. This repo has no jsdom, no
 * happy-dom and no @testing-library in devDependencies -- vitest.config.ts
 * pins environment to "node" -- so nothing here renders JSX. See
 * connections-page-sync-wiring.test.ts for the established pattern this
 * follows: assert the facts a render test would check, by reading the
 * component's own source text.
 *
 * WHAT IT DEFENDS. DEC-0295 rule 4 requires this path to keep working and
 * keep its own tests, independent of the VITE_ONBOARDING_V2 flag. If a
 * future edit disconnects the form's submit from the onSubmit prop, drops
 * `type="password"` or `required` from the password field, or unwires the
 * forgot-password button, this fails and names which fact broke. It also
 * checks AuthScreen.tsx actually feeds the real handlers in: a component
 * that is internally correct but wired to a no-op in its only caller would
 * pass every assertion below without this last check.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FORM_SOURCE = readFileSync(new URL("../PasswordSignInForm.tsx", import.meta.url), "utf8");
const AUTH_SCREEN_SOURCE = readFileSync(
  new URL("../../app/AuthScreen.tsx", import.meta.url),
  "utf8",
);

describe("PasswordSignInForm", () => {
  it("has its own name and cites DEC-0295 rule 4 and OWM-T0035 in a header comment", () => {
    expect(FORM_SOURCE).toContain("export function PasswordSignInForm");
    expect(FORM_SOURCE).toContain("DEC-0295");
    expect(FORM_SOURCE).toContain("OWM-T0035");
  });

  it("submits the form through the onSubmit prop, not a hardcoded handler", () => {
    expect(FORM_SOURCE).toMatch(/<form\s+onSubmit=\{onSubmit\}/);
  });

  it("renders the password field as a real, required password input", () => {
    const pwField = FORM_SOURCE.slice(
      FORM_SOURCE.indexOf('id="si-pw"'),
      FORM_SOURCE.indexOf("/>", FORM_SOURCE.indexOf('id="si-pw"')),
    );
    expect(pwField).toContain('type="password"');
    expect(pwField).toContain('autoComplete="current-password"');
    expect(pwField).toContain("required");
  });

  it("wires the email field to onEmailChange, not a local-only setter", () => {
    expect(FORM_SOURCE).toMatch(/onChange=\{\(e\) => onEmailChange\(e\.target\.value\)\}/);
  });

  it("renders a Forgot-password control wired to the onForgotPassword prop", () => {
    expect(FORM_SOURCE).toContain("Forgot your password?");
    expect(FORM_SOURCE).toMatch(/onClick=\{onForgotPassword\}/);
  });
});

describe("AuthScreen wiring into PasswordSignInForm", () => {
  it("imports PasswordSignInForm from its own module", () => {
    expect(AUTH_SCREEN_SOURCE).toMatch(
      /import\s*\{\s*PasswordSignInForm\s*\}\s*from\s*"@\/components\/auth\/PasswordSignInForm"/,
    );
  });

  it("passes the real onSignIn handler as onSubmit, not an inline no-op", () => {
    expect(AUTH_SCREEN_SOURCE).toMatch(/<PasswordSignInForm[\s\S]{0,400}onSubmit=\{onSignIn\}/);
  });

  it("wires onForgotPassword to switch the tab to reset", () => {
    expect(AUTH_SCREEN_SOURCE).toMatch(
      /<PasswordSignInForm[\s\S]{0,600}onForgotPassword=\{\(\) => setTab\("reset"\)\}/,
    );
  });
});

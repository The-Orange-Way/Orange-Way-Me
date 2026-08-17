/**
 * Per-environment Content-Security-Policy mode for Cloudflare Pages.
 *
 * `public/_headers` is a static file. Vite copies it into the build output
 * verbatim, so every deployment built from a given commit used to serve the
 * identical policy no matter which project it landed on. A comment in that file
 * nonetheless claimed prod would stay Report-Only while dev ran enforcing, and
 * nothing in the repository could make that true. This plugin is that missing
 * mechanism.
 *
 * The static file carries the SAFE policy: `Content-Security-Policy-Report-Only`.
 * This plugin can only ever UPGRADE an environment to enforcing, never downgrade
 * one. If the plugin is removed, misconfigured, or never runs, every environment
 * falls back to reporting rather than blocking, which is the direction a failure
 * here should go.
 *
 * Target resolution, in order:
 *
 *   1. `OW_CSP_TARGET`, when set. The explicit override, for local builds and
 *      for reproducing a specific environment's output.
 *   2. `CF_PAGES_BRANCH`, when `CF_PAGES` is set. This is a Cloudflare Pages
 *      build. Orange Way runs two Pages projects from this one repository:
 *      `ow-dev` builds branch `dev` (orangeway.dev) and `ow-prod` builds branch
 *      `prod` (orangeway.app).
 *   3. Neither: a local build with no deployment target. Report-Only.
 *
 * On Pages with no branch name the build FAILS rather than guessing. A silent
 * fallback there is how a policy ends up on the wrong environment.
 */

import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Branches whose deployment enforces the policy. Everything else reports. */
export const ENFORCING_BRANCHES = ["dev"];

const REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only:";
const ENFORCING_HEADER = "Content-Security-Policy:";

export type CspMode = "enforce" | "report-only";

/**
 * Rewrite a `_headers` file body to the given mode.
 *
 * Exported for the unit test. Throws rather than returning the input unchanged
 * when the CSP line is missing: a `_headers` with no policy at all is a
 * regression worth failing the build over, not something to pass through.
 */
export function applyCspMode(headers: string, mode: CspMode): string {
  const hasReportOnly = headers.includes(REPORT_ONLY_HEADER);
  // Match the enforcing header only where it is not the tail of the
  // Report-Only one, so a file already in either state is detected correctly.
  const hasEnforcing = /(^|\s)Content-Security-Policy:/m.test(headers);

  if (!hasReportOnly && !hasEnforcing) {
    throw new Error(
      "_headers contains no Content-Security-Policy line. Refusing to ship a build with no policy.",
    );
  }
  if (hasReportOnly && hasEnforcing) {
    throw new Error(
      "_headers carries both an enforcing and a Report-Only Content-Security-Policy. " +
        "Which one wins is a browser detail nobody should have to look up; fix the file.",
    );
  }

  if (mode === "enforce") {
    return hasReportOnly ? headers.replace(REPORT_ONLY_HEADER, ENFORCING_HEADER) : headers;
  }
  return hasEnforcing && !hasReportOnly
    ? headers.replace(/(^|\s)Content-Security-Policy:/m, `$1${REPORT_ONLY_HEADER}`)
    : headers;
}

/**
 * Resolve the CSP mode from the environment.
 *
 * Exported for the unit test, and pure so the test does not need a build.
 */
export function resolveCspMode(env: Record<string, string | undefined>): {
  mode: CspMode;
  reason: string;
} {
  const override = env.OW_CSP_TARGET?.trim();
  if (override) {
    const mode: CspMode = ENFORCING_BRANCHES.includes(override) ? "enforce" : "report-only";
    return { mode, reason: `OW_CSP_TARGET=${override}` };
  }

  if (env.CF_PAGES) {
    const branch = env.CF_PAGES_BRANCH?.trim();
    if (!branch) {
      throw new Error(
        "CF_PAGES is set but CF_PAGES_BRANCH is empty, so the deployment target " +
          "cannot be determined. Refusing to guess which environment this build " +
          "is for. Set CF_PAGES_BRANCH, or set OW_CSP_TARGET explicitly.",
      );
    }
    const mode: CspMode = ENFORCING_BRANCHES.includes(branch) ? "enforce" : "report-only";
    return { mode, reason: `CF_PAGES_BRANCH=${branch}` };
  }

  return { mode: "report-only", reason: "local build, no deployment target" };
}

export default function cspModePlugin(): Plugin {
  return {
    name: "ow-csp-mode",
    apply: "build",
    // `closeBundle` runs after the public directory has been copied, so
    // dist/_headers exists by now. Doing this here rather than in a
    // package.json postbuild step means it runs whatever command Cloudflare
    // Pages is configured with, including a bare `vite build`.
    closeBundle() {
      const outDir = path.resolve(process.cwd(), "dist");
      const file = path.join(outDir, "_headers");

      if (!fs.existsSync(file)) {
        throw new Error(
          `${file} not found after build. public/_headers is the source of the ` +
            `security headers; a build without it ships none.`,
        );
      }

      const { mode, reason } = resolveCspMode(process.env);
      const before = fs.readFileSync(file, "utf8");
      const after = applyCspMode(before, mode);
      if (after !== before) fs.writeFileSync(file, after);

      const served = mode === "enforce" ? ENFORCING_HEADER : REPORT_ONLY_HEADER;
      // Printed on every build so the deploy log is the record of which policy
      // that deployment serves.
      console.log(`[ow-csp-mode] ${reason} -> serving "${served.slice(0, -1)}"`);
    },
  };
}

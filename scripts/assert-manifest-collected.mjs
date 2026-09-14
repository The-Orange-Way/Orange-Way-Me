#!/usr/bin/env node
/**
 * Manifest identity guard (OWM-T0359).
 *
 * The pre/post-test guards in ci.yml (Test-file inventory / Test-collection
 * verify) compare COUNTS of test files on disk vs suites vitest collected.
 * A count catches an include-glob regression but not a specific file being
 * deleted while the total count still looks plausible, because both sides
 * derive their number from the same disk state.
 *
 * This checks IDENTITY instead: every path listed in the manifest must be
 * present in the set of suite names vitest actually collected (matched by
 * suffix, so a repo-relative manifest entry matches a longer collected
 * path). Extracted out of an inline `node -e` block in ci.yml so it can
 * be fed synthetic reports and proven able to go RED, the same discipline
 * scripts/assert-tests-ran.mjs already gets in the step below it.
 *
 * Usage: node scripts/assert-manifest-collected.mjs <vitest-results.json> <manifest.txt>
 *
 * A missing or empty manifest, or a missing/unparseable report, is itself
 * a failure -- "the guard could not run" must be loud, never silently OK.
 */
import fs from "node:fs";

function fail(reason) {
  console.error(`::error::${reason}`);
  process.exit(1);
}

const reportPath = process.argv[2];
const manifestPath = process.argv[3];

if (!reportPath || !manifestPath) {
  fail("usage: assert-manifest-collected.mjs <vitest-results.json> <manifest.txt>");
}
if (!fs.existsSync(reportPath)) {
  fail(`no vitest json report at ${reportPath}`);
}
if (!fs.existsSync(manifestPath)) {
  fail(`${manifestPath} is missing, so the manifest guard cannot run.`);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (err) {
  fail(`${reportPath} is not valid JSON: ${err.message}`);
}

const collected = (Array.isArray(report.testResults) ? report.testResults : []).map(
  (t) => t.name || "",
);

const manifest = fs
  .readFileSync(manifestPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

if (manifest.length === 0) {
  fail(
    `${manifestPath} has no usable entries (every line blank or a comment). The manifest guard would check nothing.`,
  );
}

const missing = manifest.filter((m) => !collected.some((c) => c.endsWith(m)));
if (missing.length > 0) {
  fail(
    `Manifest test file(s) missing from vitest collection: ${missing.join(", ")}. A must-never-disappear test was deleted, renamed, or excluded from the include glob.`,
  );
}

console.log(
  `manifest guard OK: ${manifest.length} must-never-disappear file(s) present in the collected suite.`,
);

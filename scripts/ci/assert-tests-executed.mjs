#!/usr/bin/env node
/**
 * CI cannot tell a test that RAN from one that was skipped or
 * deleted. Ported from Orange-Way-Books tests/e2e/scripts/assert-specs-ran.mjs
 * (DL-0779), adapted from Playwright's JSON report shape to vitest's.
 *
 * The existing guards in .github/workflows/ci.yml (pre-test file count,
 * post-test suite count) are RELATIVE comparisons: they only check that
 * vitest COLLECTED as many suites as exist on disk. Neither counts EXECUTED
 * tests, so:
 *   - a file whose tests are all `describe.skip`d is still one collected
 *     suite, so COLLECTED == EXPECTED and the job goes green with zero real
 *     coverage of whatever that file was guarding.
 *   - a suite that collects but contributes zero executed tests (for any
 *     reason) is invisible to a check that only counts suites.
 *
 * This reads the vitest JSON report and fails unless:
 *   1. at least one test in the whole run actually executed (status
 *      "passed" or "failed" -- not "skipped", "pending", or "todo"), and
 *   2. every collected suite contributed at least one executed test of its
 *      own, so a single skipped file cannot hide behind other suites'
 *      totals.
 *
 * A missing or unparseable report is itself a failure, never scored as OK.
 *
 * Usage: node scripts/ci/assert-tests-executed.mjs <path-to-vitest-results.json> [expectedFileCount]
 */

import fs from "node:fs";

function fail(reason) {
  console.error(`::error::assert-tests-executed: ${reason}`);
  process.exit(1);
}

const reportPath = process.argv[2];
const expectedFilesArg = process.argv[3];
const expectedFiles = expectedFilesArg !== undefined ? Number(expectedFilesArg) : null;

if (!reportPath) {
  fail(
    "no report path given (usage: assert-tests-executed.mjs <results.json> [expectedFileCount])",
  );
}

if (!fs.existsSync(reportPath)) {
  fail(`no vitest JSON report at ${reportPath} -- the test step may not have written it`);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (err) {
  fail(`report at ${reportPath} is not valid JSON: ${err.message}`);
}

const suites = Array.isArray(report.testResults) ? report.testResults : null;
if (!suites) {
  fail(`report at ${reportPath} has no testResults array to inspect`);
}

if (expectedFiles !== null && !Number.isNaN(expectedFiles) && suites.length < expectedFiles) {
  fail(`vitest collected ${suites.length} suite(s) but ${expectedFiles} file(s) exist on disk`);
}

let totalExecuted = 0;
const emptySuites = [];

for (const suite of suites) {
  const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
  const executed = assertions.filter((a) => a.status === "passed" || a.status === "failed").length;
  totalExecuted += executed;
  if (executed === 0) {
    emptySuites.push(suite.name || suite.testFilePath || "(unnamed suite)");
  }
}

if (totalExecuted === 0) {
  fail(`0 test(s) executed across ${suites.length} collected suite(s) -- the run proved nothing`);
}

if (emptySuites.length > 0) {
  fail(
    `${emptySuites.length} collected suite(s) executed zero tests (skipped, pending, or empty): ${emptySuites.join(", ")}`,
  );
}

console.log(
  `assert-tests-executed: OK, ${totalExecuted} test(s) executed across ${suites.length} suite(s)`,
);

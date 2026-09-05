#!/usr/bin/env node
/**
 * Executed-test guard for vitest's --reporter=json output.
 *
 * OWM-T0353 (challenge OW-C0043 on OWM-T0347): the existing pre/post-test
 * steps in ci.yml compare test FILE counts (disk vs collected). That answers
 * "did the loop finish", not "did the work happen". A file whose tests are
 * all skipped -- describe.skip on the whole suite, or every `it` inside it --
 * is still one collected suite, so the file-count comparison stays green with
 * zero real coverage of whatever that suite was protecting.
 *
 * TWO checks:
 *
 * 1. Suite-wide: at least one test in the whole run must have a final status
 *    of "passed" or "failed" (i.e. it executed). A run where every test is
 *    skipped/pending/todo means nothing exercised anything, even though
 *    vitest exits 0.
 *
 * 2. Per-file, for a short list of files that must never go quiet without it
 *    being loud: each one, if present in the report, must have at least one
 *    executed (passed or failed) assertion. A file that disappears entirely
 *    is already caught by the disk-vs-collected count in ci.yml; this catches
 *    the file staying collected while every test inside it skips itself.
 *
 * Modeled on the equivalent guard in Orange-Way-Books
 * (tests/e2e/scripts/assert-specs-ran.mjs), adapted from a Playwright JSON
 * report shape to vitest's Jest-compatible JSON reporter shape:
 *   { numPassedTests, numFailedTests, testResults: [ { name, assertionResults: [ { status } ] } ] }
 *
 * Usage: node scripts/assert-tests-executed.mjs <vitest-results.json> [required-files.json]
 * The required list defaults to scripts/required-test-specs.json and can be
 * overridden by the second argument or REQUIRED_TEST_SPECS_FILE, so the CI
 * step that proves this guard can fail does not have to touch the real list.
 *
 * A missing or unparseable report, and a missing or malformed required list,
 * are failures -- never silently scored as OK.
 */

import fs from "node:fs";

const MIN_EXECUTED = 1;
const DEFAULT_REQUIRED_LIST = "scripts/required-test-specs.json";

function fail(reason) {
  console.error(`::error::executed-test guard failed: ${reason}`);
  process.exit(1);
}

function readJson(filePath, what) {
  if (!fs.existsSync(filePath)) {
    fail(`no ${what} at ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    fail(`${what} at ${filePath} is not valid JSON: ${err.message}`);
  }
  return null;
}

function normalize(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

function sameFile(reportName, requiredFile) {
  const a = normalize(reportName);
  const b = normalize(requiredFile);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function executedCount(assertionResults) {
  return (assertionResults || []).filter(
    (a) => a && (a.status === "passed" || a.status === "failed"),
  ).length;
}

const reportPath = process.argv[2];
if (!reportPath) {
  fail("no report path given (usage: assert-tests-executed.mjs <vitest-results.json> [required-files.json])");
}

const requiredListPath =
  process.argv[3] || process.env.REQUIRED_TEST_SPECS_FILE || DEFAULT_REQUIRED_LIST;

const report = readJson(reportPath, "vitest JSON report");

if (typeof report.numPassedTests !== "number" || typeof report.numFailedTests !== "number") {
  fail(`report at ${reportPath} has no numPassedTests/numFailedTests -- not a vitest JSON report`);
}

const executed = report.numPassedTests + report.numFailedTests;
const notExecuted = (report.numPendingTests || 0) + (report.numTodoTests || 0);

if (executed < MIN_EXECUTED) {
  fail(
    `${executed} test(s) executed, ${notExecuted} skipped/pending/todo; need at least ${MIN_EXECUTED}`,
  );
}

const requiredDoc = readJson(requiredListPath, "required-test list");
const required = Array.isArray(requiredDoc) ? requiredDoc : requiredDoc && requiredDoc.required;
if (!Array.isArray(required)) {
  fail(`required-test list at ${requiredListPath} has no "required" array`);
}
for (const f of required) {
  if (typeof f !== "string" || f.length === 0) {
    fail(`required-test list at ${requiredListPath} has a non-string entry: ${JSON.stringify(f)}`);
  }
}

const testResults = Array.isArray(report.testResults) ? report.testResults : [];

const problems = [];

// Check 2a: any COLLECTED suite that contributed zero executed tests. This is
// the general form of the guard -- it does not need a file to be on the
// required list to be caught, it only needs to have been collected at all.
for (const suite of testResults) {
  const name = suite && suite.name;
  if (!name) continue;
  const ran = executedCount(suite.assertionResults);
  const total = (suite.assertionResults || []).length;
  if (total > 0 && ran === 0) {
    problems.push(
      `${normalize(name)} was collected with ${total} test(s) but NONE executed (all skipped/pending/todo).`,
    );
  }
}

// Check 2b: the named presence floor. A file that is not even collected
// (renamed, moved, or deleted) is reported by name here too, distinct from
// the disk-vs-collected COUNT check already in ci.yml, so the missing file
// is named rather than just numbered.
for (const requiredFile of required) {
  const hits = testResults.filter((s) => s && s.name && sameFile(s.name, requiredFile));
  if (hits.length === 0) {
    problems.push(
      `${requiredFile} did not appear in the vitest report at all. Likely renamed, moved, or dropped from the test include glob.`,
    );
    continue;
  }
  const ran = hits.reduce((n, s) => n + executedCount(s.assertionResults), 0);
  if (ran === 0) {
    problems.push(
      `${requiredFile} was collected but contributed zero executed tests. This file is a required P0 guard and must not go quiet.`,
    );
  }
}

if (problems.length > 0) {
  for (const p of problems) {
    console.error(`::error::${p}`);
  }
  fail(`${problems.length} problem(s) found; see the error(s) above`);
}

console.log(
  `executed-test guard: OK, ${executed} test(s) executed, ${notExecuted} skipped/pending/todo; ` +
    `all ${required.length} required file(s) executed`,
);

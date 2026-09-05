#!/usr/bin/env node
/**
 * Test-execution guard (OWM-T0353).
 *
 * OWM CI already fails when zero test FILES are collected (see the pre-test
 * and post-test guards in ci.yml). Neither guard can tell a suite that ran
 * from one that was collected and then skipped or emptied out: a file whose
 * every test carries describe.skip still counts as one collected suite, and
 * COLLECTED >= EXPECTED still holds with zero real assertions run. That is
 * the live defect on Orange-Way-Books (tests/e2e/rls-cross-user.spec.ts,
 * tracked on OW-T0101/OW-T0102), where a file-scope test.skip made the real
 * cross-tenant isolation test invisible for months while the job reported
 * green.
 *
 * This closes that gap by reading vitest's json reporter output directly and
 * requiring:
 *   1. at least one test in the whole run actually EXECUTED (status "passed"
 *      or "failed", not "skipped"/"pending"/"todo") -- the same DL-0779
 *      zero-spec shape ported from Orange-Way-Books' assert-specs-ran.mjs.
 *   2. every collected suite contributed at least one executed test, so a
 *      file-scope skip on one suite cannot hide behind the other suites in
 *      the run.
 *   3. the two P0 recovery-guard suites named below are present in the
 *      report AND executed. Named explicitly so deleting either file, or a
 *      glob change that silently excludes it, is a loud named failure
 *      rather than a quiet drop in a suite count.
 *
 * Usage: node scripts/assert-tests-ran.mjs <vitest-results.json>
 *
 * A missing or unparseable report is itself a failure, never silently
 * scored as OK. "The guard could not run" must be loud.
 */
import fs from "node:fs";

const REQUIRED_SUITES = [
  "src/lib/or/__tests__/or-key-material.test.ts",
  "src/context/__tests__/resolveOrKeyMaterial.test.ts",
];

function fail(reason) {
  console.error(`::error::test-execution guard failed: ${reason}`);
  process.exit(1);
}

function normalize(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

function sameFile(reportPath, requiredPath) {
  const a = normalize(reportPath);
  const b = normalize(requiredPath);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

const reportPath = process.argv[2];
if (!reportPath) {
  fail("no report path given (usage: assert-tests-ran.mjs <vitest-results.json>)");
}
if (!fs.existsSync(reportPath)) {
  fail(`no vitest json report at ${reportPath}`);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (err) {
  fail(`${reportPath} is not valid JSON: ${err.message}`);
}

const suites = Array.isArray(report.testResults) ? report.testResults : null;
if (!suites) {
  fail(`${reportPath} has no testResults array to inspect`);
}

let totalExecuted = 0;
const bySuite = [];
for (const suite of suites) {
  const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
  const executed = assertions.filter(
    (a) => a && (a.status === "passed" || a.status === "failed"),
  ).length;
  totalExecuted += executed;
  bySuite.push({ name: suite.name || "(unnamed suite)", total: assertions.length, executed });
}

if (totalExecuted === 0) {
  fail(
    `${suites.length} suite(s) collected but 0 test(s) executed (passed+failed) across all of ` +
      `them. Every suite is either empty or entirely skipped/pending.`,
  );
}

const emptySuites = bySuite.filter((s) => s.executed === 0);
if (emptySuites.length > 0) {
  for (const s of emptySuites) {
    console.error(
      `::error::suite collected but 0 of its ${s.total} test(s) executed: ${s.name}. Likely a ` +
        `file-scope describe.skip/it.skip covering the whole file.`,
    );
  }
  fail(`${emptySuites.length} suite(s) collected with zero executed tests; see the error(s) above`);
}

const problems = [];
for (const required of REQUIRED_SUITES) {
  const hit = bySuite.find((s) => sameFile(s.name, required));
  if (!hit) {
    problems.push(
      `${required} did not appear in the run AT ALL. Likely cause: it was renamed or moved, ` +
        `or the vitest include glob in vitest.config.ts no longer matches it.`,
    );
    continue;
  }
  if (hit.executed === 0) {
    problems.push(`${required} was collected but all ${hit.total} of its test(s) skipped`);
  }
}
if (problems.length > 0) {
  for (const p of problems) console.error(`::error::required P0 suite did not execute: ${p}`);
  fail(`${problems.length} required P0 suite(s) did not execute; see the error(s) above`);
}

console.log(
  `test-execution guard: OK, ${suites.length} suite(s) collected, ${totalExecuted} test(s) ` +
    `executed across them, both P0 recovery-guard suites present and executed`,
);

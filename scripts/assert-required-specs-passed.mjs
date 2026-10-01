#!/usr/bin/env node
// Fails unless every required spec for the CURRENT event has at least one
// executed test, and every executed test in that spec PASSED.
//
// Usage: assert-required-specs-passed.mjs <required-specs.json> <results.json> <event-name>
//
// required-specs.json shape: { "required": [ { "file": "tests/e2e/x.spec.ts", "when": "push" } ] }
// results.json is the Playwright JSON reporter output (--reporter=json).
//
// Why this exists: the "Guard against zero-spec execution" step in ci.yml only
// proves SOMETHING ran. It cannot tell "the AEAD vault spec passed" from "the
// AEAD vault spec was skipped but an unrelated marketing-forms spec executed".
// A required, when-scoped spec closes that gap.

import { readFileSync } from 'node:fs'

const [, , requiredPath, resultsPath, eventName] = process.argv
if (!requiredPath || !resultsPath || !eventName) {
  console.error(
    'usage: assert-required-specs-passed.mjs <required-specs.json> <results.json> <event-name>',
  )
  process.exit(1)
}

let required
try {
  required = JSON.parse(readFileSync(requiredPath, 'utf8')).required ?? []
} catch (err) {
  console.error(`::error::could not read/parse ${requiredPath}: ${err.message}`)
  process.exit(1)
}

const applicable = required.filter((entry) => entry.when === eventName)
if (applicable.length === 0) {
  console.log(`no required spec applies to event '${eventName}'; nothing to check`)
  process.exit(0)
}

let report
try {
  report = JSON.parse(readFileSync(resultsPath, 'utf8'))
} catch (err) {
  console.error(`::error::could not read/parse ${resultsPath}: ${err.message}`)
  process.exit(1)
}

// Walk the reporter's suite tree. Suites nest arbitrarily deep (file suite ->
// describe suites -> ...); specs sit at the leaves.
function* walkSpecs(suite) {
  for (const spec of suite.specs ?? []) yield spec
  for (const child of suite.suites ?? []) yield* walkSpecs(child)
}

function testStatus(test) {
  if (test.status) return test.status
  const results = test.results ?? []
  return results.length ? results[results.length - 1].status : 'unknown'
}

let failed = false

for (const { file } of applicable) {
  const base = file.split('/').pop()
  const matchingSpecs = []
  for (const suite of report.suites ?? []) {
    for (const spec of walkSpecs(suite)) {
      const specFile = spec.file ?? ''
      if (specFile === file || specFile.endsWith(base)) matchingSpecs.push(spec)
    }
  }

  const tests = matchingSpecs.flatMap((spec) => spec.tests ?? [])
  if (tests.length === 0) {
    console.error(
      `::error::required spec '${file}' (when=${eventName}) did not run -- 0 tests found in ${resultsPath}`,
    )
    failed = true
    continue
  }

  const notPassed = tests.filter((test) => testStatus(test) !== 'expected')
  if (notPassed.length > 0) {
    console.error(
      `::error::required spec '${file}' (when=${eventName}) has ${notPassed.length}/${tests.length} test(s) not passed (status: ${notPassed
        .map(testStatus)
        .join(', ')})`,
    )
    failed = true
    continue
  }

  console.log(`required spec '${file}' (when=${eventName}): ${tests.length}/${tests.length} test(s) passed`)
}

if (failed) process.exit(1)

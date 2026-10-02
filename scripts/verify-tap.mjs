#!/usr/bin/env node
// Independent-verification helper: summarize a TAP stream produced by
//   node --test --test-reporter=tap core/tests/*.test.ts
// Usage: node scripts/verify-tap.mjs <file.tap> [--names]
// Prints the header summary block plus every top-level "not ok" test name.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const showNames = process.argv.includes('--names');
if (!file) {
  console.error('usage: node scripts/verify-tap.mjs <file.tap> [--names]');
  process.exit(2);
}
const text = readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);

const summary = {};
for (const line of lines) {
  const m = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (.*)$/.exec(line);
  if (m) summary[m[1]] = m[2].trim();
}

// Top-level tests are "not ok N - name" at nesting depth 0 (no leading spaces).
const failures = [];
let lastSubtestHeader = '';
for (const line of lines) {
  const h = /^# Subtest: (.*)$/.exec(line);
  if (h) lastSubtestHeader = h[1];
  const f = /^not ok (\d+) - (.*)$/.exec(line);
  if (f) failures.push({ id: Number(f[1]), name: f[2], suite: lastSubtestHeader });
}

// File attribution: TAP nests subtests; the outer "# Subtest:" before a failure
// that is a *.test.ts file path identifies the file for failures inside it.
const byFile = new Map();
let currentFile = null;
for (const line of lines) {
  const s = /^# Subtest: (.*\.test\.ts)$/.exec(line);
  if (s) currentFile = s[1];
  const f = /^not ok (\d+) - (.*)$/.exec(line);
  if (f && currentFile) {
    if (!byFile.has(currentFile)) byFile.set(currentFile, []);
    byFile.get(currentFile).push(f[2]);
  }
}

console.log('=== SUMMARY ===');
for (const k of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms']) {
  if (k in summary) console.log(`# ${k} ${summary[k]}`);
}
console.log(`=== TOP-LEVEL not-ok COUNT: ${failures.length} ===`);
if (showNames) for (const f of failures) console.log(`not ok ${f.id} - ${f.name}   [in ${f.suite}]`);
console.log('=== FAILURES BY TEST FILE ===');
for (const [f, names] of [...byFile.entries()].sort()) {
  console.log(`${f}: ${names.length}`);
  if (showNames) for (const n of names) console.log(`    - ${n}`);
}

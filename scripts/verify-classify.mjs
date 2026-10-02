#!/usr/bin/env node
// TAP failure classifier / differ (independent verification, V7).
// Node's TAP reporter gives every failing test a `location:` line naming the FILE and LINE,
// which is the only reliable file attribution (nested `# Subtest:` headers are ambiguous).
//
// Usage:
//   node scripts/verify-classify.mjs <tapFile>                 → list failures with file/line/error
//   node scripts/verify-classify.mjs <baseline.tap> <after.tap> → diff by name + per-file counts
import { readFileSync } from 'node:fs';

function parse(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const failures = [];
  const summary = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (.*)$/.exec(lines[i]);
    if (m) summary[m[1]] = m[2].trim();
    const f = /^not ok (\d+) - (.*)$/.exec(lines[i]);
    if (!f) continue;
    const block = [];
    for (let j = i + 1; j < lines.length && !/^(not ok|ok) \d+ - /.test(lines[j]) && !/^1\.\.\d+$/.test(lines[j]); j++) {
      block.push(lines[j]);
      if (lines[j].startsWith('...')) break;
    }
    const text = block.join('\n');
    const loc = /location: '([^']+)'/.exec(text);
    const errMatch = /error: \|-?\n?([\s\S]*?)(?=\n\s{2}(code|stack|failureType):|$)/.exec(text);
    const errLine = /error: (['"].*)$/m.exec(text);
    failures.push({
      index: Number(f[1]),
      name: f[2],
      file: loc ? loc[1].replace(/\\\\/g, '\\').split('\\').pop() : '(unknown)',
      location: loc ? loc[1] : null,
      error: (errLine ? errLine[1] : errMatch ? errMatch[1].trim().split('\n')[0] : '').slice(0, 220),
      raw: text,
    });
  }
  return { summary, failures };
}

const [a, b] = process.argv.slice(2);
if (!b) {
  const { summary, failures } = parse(a);
  console.log(`file=${a}`);
  console.log(`summary=${JSON.stringify(summary)}`);
  console.log(`top-level failures=${failures.length}`);
  const byFile = {};
  for (const f of failures) byFile[f.file] = (byFile[f.file] ?? 0) + 1;
  console.log('by file: ' + JSON.stringify(byFile, null, 1));
  console.log('\n--- failures ---');
  for (const f of failures) console.log(`#${f.index} [${f.file}] ${f.name}\n      ${f.error}`);
} else {
  const base = parse(a);
  const after = parse(b);
  console.log(`baseline: ${JSON.stringify(base.summary)}  failures=${base.failures.length}`);
  console.log(`after   : ${JSON.stringify(after.summary)}  failures=${after.failures.length}`);
  const bn = new Set(base.failures.map((f) => f.name));
  const an = new Set(after.failures.map((f) => f.name));
  const isNew = after.failures.filter((f) => !bn.has(f.name));
  const isFixed = base.failures.filter((f) => !an.has(f.name));
  console.log(`\nNEW failures (${isNew.length}):`);
  for (const f of isNew) console.log(`  [${f.file}] ${f.name}\n      ${f.error}`);
  console.log(`\nno-longer-failing (${isFixed.length}):`);
  for (const f of isFixed) console.log(`  [${f.file}] ${f.name}`);
  console.log('\nidentical failure sets:', isNew.length === 0 && isFixed.length === 0);
  // per-file counts, both sides
  const cnt = (fs) => fs.reduce((acc, f) => ((acc[f.file] = (acc[f.file] ?? 0) + 1), acc), {});
  console.log('\nper-file baseline vs after:');
  const cb = cnt(base.failures), ca = cnt(after.failures);
  for (const k of [...new Set([...Object.keys(cb), ...Object.keys(ca)])].sort()) {
    const mark = (cb[k] ?? 0) === (ca[k] ?? 0) ? ' ' : '*';
    console.log(`  ${mark} ${k}: ${cb[k] ?? 0} -> ${ca[k] ?? 0}`);
  }
}

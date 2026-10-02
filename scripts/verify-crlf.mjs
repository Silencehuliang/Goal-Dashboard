#!/usr/bin/env node
// Independent diagnosis for V7: are the Windows-only regex failures CRLF artefacts of the
// TEST (multi-line regex with \n run against a CRLF working tree), or real product drift?
//
// Method: take the exact regex literal the TAP error printed, and evaluate it against the
// client sources twice — (a) raw bytes as checked out (CRLF on this machine) and
// (b) the same text with CRLF normalised to LF. If (b) matches and (a) does not, the guard is
// broken by line endings and says nothing about the product.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const tap = process.argv[2] ?? 'tmp/verify/final-7e8e016.tap';
const dir = 'dsh-graph-host/lib/client';
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));

const text = readFileSync(tap, 'utf8');
const blocks = text.split(/\n(?=not ok \d+ - )/).filter((b) => /did not match the regular expression/.test(b));
console.log(`TAP=${tap}`);
console.log(`failure blocks containing a printed regex: ${blocks.length}\n`);

let crlfOnly = 0, real = 0, other = 0;
for (const block of blocks) {
  const name = /^not ok \d+ - (.*)$/m.exec(block)?.[1] ?? '?';
  const loc = /location: '([^']+)'/.exec(block)?.[1] ?? '';
  const m = /did not match the regular expression (\/[\s\S]*?\/[a-z]*)\. Input:/.exec(block);
  if (!m) { other++; continue; }
  let re;
  try {
    const lit = m[1];
    const lastSlash = lit.lastIndexOf('/');
    re = new RegExp(lit.slice(1, lastSlash), lit.slice(lastSlash + 1));
  } catch (e) {
    console.log(`SKIP (regex not re-parseable) ${name}: ${e.message}`);
    other++;
    continue;
  }
  const hits = [];
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8');
    const lf = raw.replace(/\r\n/g, '\n');
    const rawHit = re.test(raw);
    // fresh regex (lastIndex is stateful for /g)
    const lfHit = new RegExp(re.source, re.flags).test(lf);
    if (rawHit !== lfHit) hits.push({ f, rawHit, lfHit });
  }
  const verdict = hits.length > 0 ? 'CRLF-ARTEFACT (matches only after EOL normalisation)' : 'NOT-EXPLAINED-BY-CRLF';
  if (hits.length > 0) crlfOnly++; else real++;
  console.log(`${verdict}\n  test: ${name}\n  loc : ${loc}\n  re  : ${re.source.slice(0, 120)}\n  flip: ${JSON.stringify(hits)}\n`);
}
console.log(`--- summary: crlf-only=${crlfOnly} not-explained=${real} skipped=${other} ---`);
